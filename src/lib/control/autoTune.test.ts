/**
 * Verification for the tuning layer.
 *
 * Every expected number is computed from the published rule or from the analytic
 * response of the plant under test — never read back off the code being tested.
 * Where a method is an approximation (the relay describing function is one) the
 * tolerance says so out loud instead of being widened until it passes.
 */
import { describe, expect, it } from 'vitest'

import { fitFopdt } from '../ml/systemIdentification'
import {
  autoTuneByRelay,
  gainsFromFopdt,
  gainsFromUltimateCycle,
  INFEASIBLE_COST,
  loopEvaluation,
  relayAutoTune,
  simulateDiscreteLoop,
  suggestGainBounds,
  tuneBySearch,
  tuneBySurrogate,
  type LoopSpec,
} from './autoTune'

/** `2/(0.5s + 1)` — self-regulating first order, dc gain 2, τ 0.5 s. */
const firstOrder = { numerator: [2], denominator: [0.5, 1] }
/** `1/(s + 1)³`: its exact −180° crossing is ω = √3 rad/s with |G| = 1/8. */
const triplePole = { numerator: [1], denominator: [1, 3, 3, 1] }

const ULTIMATE_GAIN = 8
const ULTIMATE_PERIOD = (2 * Math.PI) / Math.sqrt(3)

/** Ideal FOPDT step curve, `K(1 − e^−(t−L)/τ)`, sampled finely enough to fit exactly. */
function fopdtFixture(gain: number, tau: number, deadTime: number) {
  const interval = 0.001
  // Twenty time constants of record: the gain is read from a tail *average*, so a
  // curve that has not fully plateaued reports a hair below its asymptote.
  const times = Array.from({ length: Math.round(20 * tau / interval) + 1 }, (_, index) => index * interval)
  const response = times.map((time) =>
    time >= deadTime ? gain * (1 - Math.exp(-(time - deadTime) / tau)) : 0,
  )
  // `fromValue` is stated rather than averaged from the first samples: this record
  // starts moving inside its own leading window, and a fitter that guessed the
  // baseline there would report a wrong gain.
  return fitFopdt(times, response, { stepSize: 1, fromValue: 0 })
}

describe('rule-based tuning on an identified model', () => {
  const model = fopdtFixture(2, 0.5, 0.1)

  it('recovers the FOPDT parameters the fixture was built from', () => {
    expect(model.gain).toBeCloseTo(2, 6)
    expect(model.timeConstant).toBeCloseTo(0.5, 5)
    expect(model.deadTime).toBeCloseTo(0.1, 5)
    expect(model.validityNotes).toEqual([])
  })

  it('applies the Ziegler–Nichols open-loop coefficients exactly', () => {
    const K = model.gain
    const tau = model.timeConstant
    const deadTime = model.deadTime

    const proportional = gainsFromFopdt(model, { rule: 'ziegler-nichols', structure: 'P' })
    expect(proportional.gains.kp).toBeCloseTo((0.5 * tau) / (K * deadTime), 10)
    expect(proportional.gains.ki).toBe(0)
    expect(proportional.gains.kd).toBe(0)
    expect(proportional.structure).toBe('P')

    const pid = gainsFromFopdt(model, { rule: 'ziegler-nichols', structure: 'PID' })
    const kp = (0.6 * tau) / (K * deadTime)
    expect(pid.gains.kp).toBeCloseTo(kp, 10)
    expect(pid.gains.ki).toBeCloseTo(kp / (0.5 * tau), 10)
    expect(pid.gains.kd).toBeCloseTo(kp * 0.125 * tau, 10)
    // The rule's own warning about what it is tuned for must travel with it.
    expect(pid.notes.some((note) => /40 % overshoot/.test(note))).toBe(true)
  })

  it('flags a delay-dominant plant, where Ziegler–Nichols is known to over-tune', () => {
    const delayDominant = fopdtFixture(1, 0.2, 0.3)
    const tuning = gainsFromFopdt(delayDominant, { rule: 'ziegler-nichols', structure: 'PI' })
    expect(tuning.notes.some((note) => /delay-dominant/.test(note))).toBe(true)
    expect(tuning.notes.some((note) => /Dead time is (\d+(?:\.\d+)?) %/.test(note))).toBe(true)
  })

  it('refuses Ziegler–Nichols when the model has no dead time and names the alternative', () => {
    expect(() =>
      gainsFromFopdt({ ...model, deadTime: 0 }, { rule: 'ziegler-nichols' }),
    ).toThrow(/Use rule "simc"/)
  })

  it('runs SIMC λ-tuning and degenerates a PID request to PI on a first-order model', () => {
    const K = model.gain
    const tau = model.timeConstant
    const deadTime = model.deadTime
    const lambda = deadTime
    const simc = gainsFromFopdt(model, { rule: 'simc', structure: 'PID', lambdaSeconds: lambda })
    expect(simc.gains.kd).toBe(0)
    expect(simc.gains.kp).toBeCloseTo(tau / (K * (lambda + deadTime)), 10)
    expect(simc.gains.ki).toBeCloseTo(
      simc.gains.kp / Math.min(tau, 4 * (lambda + deadTime)),
      10,
    )
    expect(simc.notes.some((note) => /degenerates to PI/.test(note))).toBe(true)

    // λ defaults to the dead time, and the documented conservative setting keeps
    // the loop slower than the delay it is measuring.
    const defaultLambda = gainsFromFopdt(model, { rule: 'simc', structure: 'PI' })
    expect(defaultLambda.detail['lambda seconds']).toBeCloseTo(deadTime, 12)
    const slow = gainsFromFopdt(model, { rule: 'simc', structure: 'PI', lambdaSeconds: 3 * deadTime })
    expect(slow.gains.kp).toBeLessThan(defaultLambda.gains.kp)
  })

  it('reports a reverse-acting model as reverse-acting instead of hiding the sign', () => {
    const inverting = { ...model, gain: -Math.abs(model.gain) }
    const tuning = gainsFromFopdt(inverting, { rule: 'simc', structure: 'PI' })
    expect(tuning.gains.kp).toBeLessThan(0)
    expect(tuning.gains.ki).toBeLessThan(0)
    expect(tuning.notes.some((note) => /reverse-acting/.test(note))).toBe(true)
  })
})

describe('ultimate-cycle rules', () => {
  it('uses the closed-loop Ziegler–Nichols coefficients', () => {
    const pid = gainsFromUltimateCycle(
      { ultimateGain: ULTIMATE_GAIN, periodSeconds: ULTIMATE_PERIOD },
      { structure: 'PID' },
    )
    expect(pid.gains.kp).toBeCloseTo(0.6 * ULTIMATE_GAIN, 10)
    expect(pid.gains.ki).toBeCloseTo((0.6 * ULTIMATE_GAIN) / (ULTIMATE_PERIOD / 2), 10)
    expect(pid.gains.kd).toBeCloseTo(0.6 * ULTIMATE_GAIN * (ULTIMATE_PERIOD / 8), 10)

    const pi = gainsFromUltimateCycle(
      { ultimateGain: ULTIMATE_GAIN, periodSeconds: ULTIMATE_PERIOD },
      { structure: 'PI' },
    )
    expect(pi.gains.kp).toBeCloseTo(0.45 * ULTIMATE_GAIN, 10)
    expect(pi.gains.ki).toBeCloseTo((0.45 * ULTIMATE_GAIN) / (ULTIMATE_PERIOD / 1.2), 10)
    expect(pi.gains.kd).toBe(0)

    const proportional = gainsFromUltimateCycle(
      { ultimateGain: ULTIMATE_GAIN, periodSeconds: ULTIMATE_PERIOD },
      { structure: 'P' },
    )
    expect(proportional.gains.kp).toBeCloseTo(0.5 * ULTIMATE_GAIN, 10)
    expect(proportional.gains.ki).toBe(0)
  })

  it('rejects a non-positive ultimate gain instead of tuning on it', () => {
    expect(() => gainsFromUltimateCycle({ ultimateGain: -8, periodSeconds: 3 })).toThrow(/Ultimate gain/)
    expect(() => gainsFromUltimateCycle({ ultimateGain: 8, periodSeconds: 0 })).toThrow(/period must be positive/)
  })
})

describe('relay auto-tuning', () => {
  const options = {
    relayAmplitude: 1,
    hysteresis: 0,
    dtSeconds: 0.002,
    tEndSeconds: 60,
    warmupCycles: 6,
    cyclesToMeasure: 5,
  }

  it('finds the analytic −180° crossing of 1/(s+1)³', () => {
    const relay = relayAutoTune(triplePole, options)
    // The describing function is an amplitude-domain average, and the plant only
    // attenuates the relay's third harmonic by ~10 %, so a few percent is the
    // method's accuracy — not a code error. That accuracy is asserted, not waved away.
    expect(Math.abs(relay.ultimateGain / ULTIMATE_GAIN - 1)).toBeLessThan(0.05)
    expect(Math.abs(relay.periodSeconds / ULTIMATE_PERIOD - 1)).toBeLessThan(0.02)
    // a = 4d/(π·Ku) for a zero-hysteresis relay.
    expect(Math.abs(relay.amplitude / ((4 * 1) / (Math.PI * ULTIMATE_GAIN)) - 1)).toBeLessThan(0.05)
    expect(relay.switches).toBeGreaterThan(21)
    expect(relay.amplitudeSpreadFraction).toBeLessThan(0.01)
    expect(relay.periodSpreadFraction).toBeLessThan(0.01)
    expect(relay.notes).toEqual([expect.stringMatching(/Hysteresis is zero/)])
  })

  it('says so when the cycle has not settled yet', () => {
    // The relay envelope grows into the limit cycle over ~8 cycles, so measuring
    // from the first crossing reads a transient. That must be reported, not passed
    // off as a critical gain.
    const early = relayAutoTune(triplePole, { ...options, warmupCycles: 1 })
    expect(early.amplitudeSpreadFraction).toBeGreaterThan(0.1)
    expect(early.notes.some((note) => /had not settled/.test(note))).toBe(true)
    // A still-growing envelope reads a *small* amplitude, and Ku = 4d/(πa) turns
    // that into an over-estimated critical gain — the wrong direction to be wrong.
    expect(early.ultimateGain).toBeGreaterThan(ULTIMATE_GAIN * 1.2)
  })

  it('chains the relay measurement into gains through autoTuneByRelay', () => {
    const tuned = autoTuneByRelay(triplePole, { ...options, structure: 'PID' })
    expect(tuned.tuning.rule).toBe('ziegler-nichols')
    expect(tuned.tuning.gains.kp).toBeCloseTo(0.6 * tuned.relay.ultimateGain, 10)
    expect(Math.abs(tuned.tuning.gains.kp / (0.6 * ULTIMATE_GAIN) - 1)).toBeLessThan(0.05)
    // The relay's caveats must survive the chain, not be replaced by the rule's.
    expect(tuned.tuning.notes).toEqual(expect.arrayContaining([expect.stringMatching(/Hysteresis is zero/)]))
  })

  it('reports the hysteresis phase lag it is introducing', () => {
    // A 0.05 band on a ~0.16 cycle is a real phase shift, so the loop oscillates
    // slower and the record has to be longer to see enough of it.
    const relay = relayAutoTune(triplePole, { ...options, hysteresis: 0.05, tEndSeconds: 60 })
    const lagDeg = Math.asin(Math.min(1, 0.05 / relay.amplitude)) * (180 / Math.PI)
    expect(lagDeg).toBeGreaterThan(3)
    expect(relay.notes.some((note) => /relay phase lag/.test(note))).toBe(true)
    // Ku = 4d/(π·√(a² − h²)): the band inflates the inferred critical gain
    // relative to the zero-hysteresis estimate 4d/(πa), and the arithmetic uses
    // the corrected root, not the amplitude.
    expect(relay.ultimateGain).toBeCloseTo(4 / (Math.PI * Math.sqrt(relay.amplitude ** 2 - 0.05 ** 2)), 10)
    expect(relay.ultimateGain).toBeGreaterThan(4 / (Math.PI * relay.amplitude))
  })

  it('refuses to invent a critical gain for a loop that never switches', () => {
    expect(() =>
      relayAutoTune(triplePole, { ...options, hysteresis: 5, tEndSeconds: 20 }),
    ).toThrow(/only switched 0 times/)
  })
})

describe('closed-loop cost evaluation', () => {
  const spec: LoopSpec = { plant: firstOrder, tEndSeconds: 5, dtSeconds: 0.005 }

  it('reproduces the analytic proportional response of a first-order plant', () => {
    const evaluation = loopEvaluation({ kp: 1, ki: 0, kd: 0 }, spec)
    expect(evaluation.structure).toBe('P')
    // Loop: 2/(0.5s + 3) → dc 2/3, single pole at −6 s⁻¹, no overshoot.
    expect(evaluation.metrics.steadyState).toBeCloseTo(2 / 3, 8)
    expect(evaluation.steadyStateError).toBeCloseTo(1 / 3, 8)
    expect(evaluation.metrics.overshootPct).toBeLessThan(1e-9)
    expect(evaluation.spectralAbscissa).toBeCloseTo(-6, 8)
    // An error held at the full step for the full horizon would score 1.
    expect(evaluation.normalisedError).toBeGreaterThan(0.3)
    expect(evaluation.normalisedError).toBeLessThan(0.34)
  })

  it('makes an unenforced margin target visible instead of silently ignoring it', () => {
    const evaluation = loopEvaluation({ kp: 1, ki: 0, kd: 0 }, spec)
    expect(evaluation.margins).toBeNull()
    expect(evaluation.breakdown.margin).toBe(0)
    expect(evaluation.notes.some((note) => /No marginScan supplied/.test(note))).toBe(true)
  })

  it('penalises a low-margin candidate once a margin scan is supplied', () => {
    const scanned: LoopSpec = {
      ...spec,
      plant: triplePole,
      tEndSeconds: 30,
      dtSeconds: 0.01,
      marginScan: { fMinHz: 1e-3, fMaxHz: 50, points: 4000 },
    }
    const marginal = loopEvaluation({ kp: 7, ki: 0, kd: 0 }, scanned)
    // At |L| = 1 with kp = 7 the phase is −3·atan(√(7^(2/3) − 1)) ≈ −175°.
    expect(marginal.margins?.phaseMarginDeg).toBeGreaterThan(0)
    expect(marginal.margins?.phaseMarginDeg).toBeLessThan(30)
    expect(marginal.breakdown.margin).toBeGreaterThan(0)
    const blind = loopEvaluation({ kp: 7, ki: 0, kd: 0 }, { ...scanned, marginScan: undefined })
    expect(blind.breakdown.margin).toBe(0)
  })

  it('scores an unstable loop with the documented abscissa penalty and stays finite', () => {
    const unstable = loopEvaluation(
      { kp: 20, ki: 0, kd: 0 },
      { plant: triplePole, tEndSeconds: 30, dtSeconds: 0.01 },
    )
    expect(unstable.spectralAbscissa).toBeGreaterThan(0)
    expect(unstable.breakdown.stability).toBeCloseTo(1e3 * unstable.spectralAbscissa, 6)
    expect(unstable.notes.some((note) => /Closed loop unstable/.test(note))).toBe(true)
    expect(Number.isFinite(unstable.cost)).toBe(true)
  })

  it('reports a diverging simulation as infeasible with undefined metrics', () => {
    const wild = loopEvaluation(
      { kp: 1e7, ki: 0, kd: 0 },
      { plant: triplePole, tEndSeconds: 60, dtSeconds: 0.05 },
    )
    expect(wild.cost).toBe(INFEASIBLE_COST)
    expect(Number.isNaN(wild.metrics.overshootPct)).toBe(true)
    expect(Number.isNaN(wild.itae)).toBe(true)
    expect(wild.breakdown.stability).toBe(INFEASIBLE_COST)
    expect(wild.notes.some((note) => /not realisable/.test(note))).toBe(true)
  })

  it('prefers the PI loop that removes the steady-state error a P loop leaves', () => {
    const long: LoopSpec = { plant: firstOrder, tEndSeconds: 10, dtSeconds: 0.002 }
    const proportional = loopEvaluation({ kp: 1, ki: 0, kd: 0 }, long)
    const integral = loopEvaluation({ kp: 1, ki: 1.5, kd: 0 }, long)
    expect(integral.structure).toBe('PI')
    expect(Math.abs(integral.steadyStateError)).toBeLessThan(1e-6)
    expect(integral.cost).toBeLessThan(proportional.cost)
  })

  it('rejects an inconsistent spec instead of tuning against a meaningless one', () => {
    expect(() => loopEvaluation({ kp: 1, ki: 0, kd: 0 }, { ...spec, dtSeconds: 0 })).toThrow(/sample interval/)
    expect(() => loopEvaluation({ kp: 1, ki: 0, kd: 0 }, { ...spec, tEndSeconds: 0.02 })).toThrow(/horizon holds only/)
    expect(() =>
      loopEvaluation({ kp: Number.NaN, ki: 0, kd: 0 }, spec),
    ).toThrow(/non-finite kp/)
    expect(() => loopEvaluation({ kp: 1, ki: 0, kd: 0 }, spec, {}, { error: -1 })).toThrow(/Cost weight error/)
  })
})

describe('tuning by search over the simulation', () => {
  const spec: LoopSpec = { plant: firstOrder, tEndSeconds: 8, dtSeconds: 0.004 }
  const bounds = [{ low: 0.1, high: 5 }, { low: 0.1, high: 20 }]

  it('stays inside its simulation budget and returns a reproducible winner', () => {
    const sluggish = loopEvaluation({ kp: 0.2, ki: 0.2, kd: 0 }, spec)
    const tuned = tuneBySearch(spec, {
      structure: 'PI',
      bounds,
      maxEvaluations: 150,
      seed: 11,
    })
    expect(tuned.method).toBe('differential-evolution')
    expect(tuned.evaluations).toBeLessThanOrEqual(150)
    expect(tuned.evaluation.cost).toBeLessThan(sluggish.cost)
    expect(Math.abs(tuned.evaluation.steadyStateError)).toBeLessThan(0.02)
    // The reported metrics come from one deterministic re-evaluation.
    expect(loopEvaluation(tuned.gains, spec).cost).toBeCloseTo(tuned.evaluation.cost, 12)
    expect(tuned.history.length).toBeGreaterThan(1)
  })

  it('keeps Nelder-Mead a local method and honours its start point', () => {
    const local = tuneBySearch(spec, {
      structure: 'PI',
      bounds,
      method: 'nelder-mead',
      start: [0.3, 0.3],
      maxEvaluations: 120,
    })
    expect(local.method).toBe('nelder-mead')
    expect(local.evaluations).toBeLessThanOrEqual(120)
    expect(local.evaluation.cost).toBeLessThanOrEqual(loopEvaluation({ kp: 0.3, ki: 0.3, kd: 0 }, spec).cost)
  })

  it('rejects a bound set that does not match the requested structure', () => {
    expect(() =>
      tuneBySearch(spec, { structure: 'PID', bounds, maxEvaluations: 60 }),
    ).toThrow(/PID tuning needs 3 gain bounds/)
    expect(() =>
      tuneBySearch(spec, { structure: 'P', bounds: [{ low: 0.1, high: 5 }, { low: 0, high: 1 }], maxEvaluations: 60 }),
    ).toThrow(/P tuning needs 1 gain bounds/)
  })

  it('suggests a defensible search box around the Ziegler–Nichols gains', () => {
    const model = fopdtFixture(2, 0.5, 0.1)
    const reference = gainsFromFopdt(model, { rule: 'ziegler-nichols', structure: 'PID' })
    const suggested = suggestGainBounds(model, 'PID')
    expect(suggested).toHaveLength(3)
    expect(suggested[0].low).toBeCloseTo(Math.abs(reference.gains.kp) / 10, 10)
    expect(suggested[0].high).toBeCloseTo(Math.abs(reference.gains.kp) * 10, 10)
    // A reverse-acting plant gets the box mirrored, not clipped at zero. The
    // anchor is the P-rule gain, since that is the structure asked for.
    const proportionalReference = gainsFromFopdt(model, { rule: 'ziegler-nichols', structure: 'P' })
    const mirrored = suggestGainBounds({ ...model, gain: -Math.abs(model.gain) }, 'P')
    expect(mirrored).toHaveLength(1)
    expect(mirrored[0].low).toBeCloseTo(-10 * proportionalReference.gains.kp, 10)
    expect(mirrored[0].high).toBeCloseTo(-proportionalReference.gains.kp / 10, 10)
    expect(mirrored[0].high).toBeLessThan(0)
  })
})

describe('surrogate-assisted tuning', () => {
  const spec: LoopSpec = { plant: firstOrder, tEndSeconds: 8, dtSeconds: 0.004 }
  const options = {
    structure: 'PI' as const,
    bounds: [{ low: 0.1, high: 5 }, { low: 0.1, high: 20 }],
    maxSimulations: 24,
    initialDesignSize: 8,
    surrogateRounds: 20,
    acquisitionCandidates: 200,
    seed: 3,
  }

  it('never spends more simulations than the budget allows', () => {
    const run = tuneBySurrogate(spec, options)
    expect(run.simulations).toBe(run.samples.length)
    expect(run.simulations).toBeLessThanOrEqual(options.maxSimulations)
    expect(run.simulations).toBeGreaterThanOrEqual(options.initialDesignSize)
    expect(run.roundsUsed).toBe(run.simulations - options.initialDesignSize)
    if (run.termination === 'budget') expect(run.simulations).toBe(options.maxSimulations)
  })

  it('reports the best simulated design, and is reproducible from its seed', () => {
    const run = tuneBySurrogate(spec, options)
    const bestCost = Math.min(...run.samples.map((sample) => sample.cost))
    expect(run.evaluation.cost).toBeCloseTo(bestCost, 9)
    const repeat = tuneBySurrogate(spec, options)
    expect(repeat.samples.map((sample) => sample.cost)).toEqual(run.samples.map((sample) => sample.cost))
    // Surrogate work is free: only the recorded designs cost a simulation, and
    // each recorded cost is exactly what its gains produce.
    for (const sample of run.samples.slice(0, 3)) {
      expect(loopEvaluation({ kp: sample.parameters[0], ki: sample.parameters[1], kd: 0 }, spec).cost).toBeCloseTo(sample.cost, 12)
    }
  })

  it('beats its own initial design and says how much work it did', () => {
    const run = tuneBySurrogate(spec, options)
    const initial = run.samples.slice(0, options.initialDesignSize).map((sample) => sample.cost)
    expect(run.evaluation.cost).toBeLessThanOrEqual(Math.min(...initial))
    expect(run.notes[0]).toMatch(/probed at \d+ real simulations/)
    expect(run.history[0]).toBeCloseTo(Math.min(...initial), 12)
  })

  it('refuses a configuration that cannot cover the box', () => {
    expect(() => tuneBySurrogate(spec, { ...options, initialDesignSize: 3 })).toThrow(/at least 4 points/)
    expect(() => tuneBySurrogate(spec, { ...options, initialDesignSize: 30 })).toThrow(/exceeds the 24-simulation budget/)
    expect(() => tuneBySurrogate(spec, { ...options, maxSimulations: 24.5 })).toThrow(/positive integer/)
    expect(() => tuneBySurrogate(spec, { ...options, acquisitionCandidates: 4 })).toThrow(/≥ 16/)
  })
})

describe('sampled-loop verification with a real actuator', () => {
  it('counts the saturated samples an ideal tuning hides', () => {
    const gains = { kp: 5, ki: 20, kd: 0 }
    const limited = simulateDiscreteLoop(firstOrder, gains, {
      dtSeconds: 0.002,
      tEndSeconds: 4,
      setpoint: 1,
      limits: { minOutput: -1, maxOutput: 1 },
    })
    expect(limited.saturatedSamples).toBeGreaterThan(0)
    expect(limited.samples.some((sample) => sample.saturated)).toBe(true)
    expect(limited.notes.some((note) => /hit its limit/.test(note))).toBe(true)
    // The output never exceeds the actuator: a linear simulation would have asked for 5 V.
    for (const sample of limited.samples) {
      expect(sample.control).toBeLessThanOrEqual(1 + 1e-12)
      expect(sample.control).toBeGreaterThanOrEqual(-1 - 1e-12)
    }
    // Conditional integration still converges to the setpoint: y_ss needs u = 0.5.
    expect(limited.samples[limited.samples.length - 1].output).toBeCloseTo(1, 3)

    const ideal = simulateDiscreteLoop(firstOrder, gains, {
      dtSeconds: 0.002,
      tEndSeconds: 4,
      setpoint: 1,
    })
    expect(ideal.saturatedSamples).toBe(0)
    expect(ideal.notes.some((note) => /No actuator limits/.test(note))).toBe(true)
    expect(Math.max(...ideal.samples.map((sample) => sample.control))).toBeGreaterThan(1)
  })

  it('names a missing integrator when the loop leaves an offset', () => {
    const proportionalOnly = simulateDiscreteLoop(firstOrder, { kp: 1, ki: 0, kd: 0 }, {
      dtSeconds: 0.005,
      tEndSeconds: 5,
      setpoint: 1,
    })
    // Analytic: 1/(1 + Kp·K) = 1/3 of the step remains.
    const last = proportionalOnly.samples[proportionalOnly.samples.length - 1]
    expect(last.error).toBeCloseTo(1 / 3, 4)
    expect(proportionalOnly.notes.some((note) => /missing integrator/.test(note))).toBe(true)
  })

  it('follows a time-varying reference through the same sampled loop', () => {
    const ramp = simulateDiscreteLoop(firstOrder, { kp: 2, ki: 50, kd: 0 }, {
      dtSeconds: 0.002,
      tEndSeconds: 2,
      setpoint: (time) => (time > 1 ? 1 : 0),
    })
    expect(ramp.samples[0].output).toBe(0)
    expect(ramp.samples[ramp.samples.length - 1].output).toBeCloseTo(1, 2)
  })

  it('rejects an unresolvable sampling interval', () => {
    expect(() =>
      simulateDiscreteLoop(firstOrder, { kp: 1, ki: 1, kd: 0 }, { dtSeconds: 0, tEndSeconds: 1 }),
    ).toThrow(/0 < dtSeconds < tEndSeconds/)
  })
})
