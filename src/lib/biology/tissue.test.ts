import { describe, expect, it } from 'vitest'
import { EXCITABLE_FITZHUGH_NAGUMO, fitzhughNagumoDerivative } from './excitability'
import type { FitzHughNagumoParameters } from './excitability'
import {
  FAST_STRAND_CABLE,
  INCOHERENT_POPULATION,
  PACEMAKER_POPULATION,
  TISSUE_PRESETS,
  activationWaveSpeed,
  cableDiffusivity,
  empiricalHalfWidthHertz,
  fitzhughNagumoRest,
  lorentzianFrequencies,
  orderParameter,
  simulateCable,
  simulateOscillatorPopulation,
  synchronisationCurve,
  type CableActivation,
  type CableOptions,
} from './tissue'
import type { BiologyWindow } from './modelSupport'

/**
 * Every number asserted here was measured off these runs, not looked up. Where the
 * model is claimed to reproduce a law — √D scaling, K_c = 2γ, mesh-independent
 * velocity — the assertion is a bound around the measurement, because the law is
 * what the run is being asked whether it agrees with.
 */

const CONDUCTING: CableOptions = {
  ...FAST_STRAND_CABLE,
  lengthMm: 5,
  stimulusLengthMm: 0.25,
  stimulusDurationMs: 2,
  stimulusAmplitude: 4,
}

/** The reporting cadence also quantises crossing times, so this is a coarse one. */
const SHORT_RUN: BiologyWindow = { tEnd: 12, dt: 0.2 }

const cable = (overrides: Partial<CableOptions> = {}, window = SHORT_RUN) =>
  simulateCable({ ...CONDUCTING, ...overrides }, window)

/** Compartments the wave conducted to: the ones under the electrode are not conduction. */
function conductedActivations(result: ReturnType<typeof cable>): CableActivation[] {
  return result.activations.filter((activation) => activation.cellIndex >= result.stimulatedCells)
}

describe('the cable', () => {
  it('turns cable constants into a diffusivity, and refuses nonsense ones', () => {
    // 1/(r_a·c_m) with r_a in Ω/mm and c_m in F/mm is 1/s; /1000 makes it mm²/ms.
    expect(cableDiffusivity(1e6, 1e-9)).toBeCloseTo(1, 12)
    expect(cableDiffusivity(2e6, 1e-9)).toBeCloseTo(0.5, 12)
    expect(cableDiffusivity(1e6, 2e-9)).toBeCloseTo(0.5, 12)
    expect(() => cableDiffusivity(0, 1e-9)).toThrow(/Axial resistance/)
    expect(() => cableDiffusivity(1e6, -1)).toThrow(/Membrane capacitance/)
    expect(() => cableDiffusivity(Number.NaN, 1e-9)).toThrow(/Axial resistance/)
  })

  it('finds a resting point that is actually a rest', () => {
    const rest = fitzhughNagumoRest(EXCITABLE_FITZHUGH_NAGUMO)
    const { a, b } = EXCITABLE_FITZHUGH_NAGUMO
    // Both nullclines hold at the answer, to the precision of the bisection.
    expect(b * (rest.v - rest.v ** 3 / 3)).toBeCloseTo(rest.v + a, 12)
    expect(rest.w).toBeCloseTo((rest.v + a) / b, 12)
    const derivative = fitzhughNagumoDerivative(EXCITABLE_FITZHUGH_NAGUMO, () => 0)(0, [rest.v, rest.w])
    expect(Math.abs(derivative[0]!)).toBeLessThan(1e-12)
    expect(Math.abs(derivative[1]!)).toBeLessThan(1e-12)
    // Rest means the Jacobian is stable at it: negative trace, positive determinant.
    const trace = 1 - rest.v ** 2 - EXCITABLE_FITZHUGH_NAGUMO.epsilon * b
    const determinant = EXCITABLE_FITZHUGH_NAGUMO.epsilon * (1 - b + b * rest.v ** 2)
    expect(rest.v).toBeLessThan(0)
    expect(trace).toBeLessThan(0)
    expect(determinant).toBeGreaterThan(0)
  })

  it('skips the middle branch even when the fast nullcline alone calls it stable', () => {
    // ε = 0.5, b = 4 puts the determinant condition, v² > (b−1)/b, above the trace
    // condition, v² > 1 − εb, and the middle crossing satisfies only the trace. It is
    // a saddle: a cable started there runs away instead of waiting for a stimulus.
    const kinetics: FitzHughNagumoParameters = { epsilon: 0.5, a: -0.5, b: 4 }
    const rest = fitzhughNagumoRest(kinetics)
    const trace = 1 - rest.v ** 2 - kinetics.epsilon * kinetics.b
    const determinant = kinetics.epsilon * (1 - kinetics.b + kinetics.b * rest.v ** 2)
    expect(Math.abs(rest.v)).toBeGreaterThan(Math.sqrt((kinetics.b - 1) / kinetics.b))
    expect(trace).toBeLessThan(0)
    expect(determinant).toBeGreaterThan(0)
  })

  it('says so when the kinetics self-oscillate and there is no rest to build on', () => {
    // a = 0 leaves one crossing, on the middle branch; b < 1 leaves the only
    // crossing where the trace is positive. Either way the oscillator never rests.
    expect(() => fitzhughNagumoRest({ epsilon: 0.08, a: 0, b: 0.8 })).toThrow(/no stable resting point/)
    expect(() => fitzhughNagumoRest({ epsilon: 0.08, a: 0.7, b: 0.2 })).toThrow(/no stable resting point/)
    expect(() => fitzhughNagumoRest({ epsilon: 0, a: 0.7, b: 0.8 })).toThrow(/timescale ratio/)
    expect(() => fitzhughNagumoRest({ epsilon: 0.08, a: 0.7, b: 0 })).toThrow(/recovery coefficient/)
  })

  it('refuses a cable that cannot be one', () => {
    expect(() => cable({ cells: 2 })).toThrow(/at least three compartments/)
    expect(() => cable({ cells: 40.5 })).toThrow(/at least three compartments/)
    expect(() => cable({ lengthMm: 0 })).toThrow(/Cable length/)
    expect(() => cable({ diffusivityMm2PerMs: 0 })).toThrow(/diffusivity/)
    expect(() => cable({ stimulusLengthMm: 0 })).toThrow(/Stimulus length/)
    expect(() => cable({ stimulusDurationMs: 0 })).toThrow(/Stimulus duration/)
    expect(() => cable({ stimulusAmplitude: Number.NaN })).toThrow(/Stimulus amplitude/)
    expect(() => cable({}, { tEnd: 12, dt: 0.2, method: 'rk4' })).not.toThrow()
    expect(() => cable({ activationThreshold: Number.NaN })).toThrow(/Activation threshold/)
  })

  it('launches a front that crosses the strand, once per compartment', () => {
    const result = cable()
    expect(result.compartmentSizeMm).toBeCloseTo(5 / 40, 12)
    expect(result.stimulatedCells).toBe(2)
    expect(result.restingVoltage).toBeCloseTo(fitzhughNagumoRest(EXCITABLE_FITZHUGH_NAGUMO).v, 12)
    // Every compartment of the strand fires, and fires once.
    expect(result.activatedCells).toBe(40)
    expect(new Set(result.activations.map((activation) => activation.cellIndex)).size).toBe(40)
    expect(result.blockedAfterMm).toBeNull()
    expect(result.velocityMmPerMs).not.toBeNull()
    for (const activation of result.activations) {
      expect(activation.peakVoltage).toBeGreaterThan(1)
      expect(activation.activationTimeMs).toBeGreaterThanOrEqual(0)
    }
    // Fire at full height everywhere or not at all. A FitzHugh–Nagumo spike is not
    // perfectly all-or-none — its height depends on the recovery variable at the
    // moment of the upstroke, and along a strand that takes a recovery time to
    // cross, the recovery variable varies — so the claim is the one that survives:
    // every compartment that fires fires a full spike, and three quarters of the
    // launch strength and a full one give the same heights to about one percent.
    const peaks = conductedActivations(result).map((activation) => activation.peakVoltage)
    for (const peak of peaks) {
      expect(peak).toBeGreaterThan(1.55)
      expect(peak).toBeLessThan(1.82)
    }
    const weak = cable({ stimulusAmplitude: 3 })
    const weakPeaks = conductedActivations(weak).map((activation) => activation.peakVoltage)
    for (const peak of weakPeaks) {
      expect(peak).toBeGreaterThan(1.55)
      expect(peak).toBeLessThan(1.82)
    }
    const lowest = Math.min(...peaks)
    const lowestWeak = Math.min(...weakPeaks)
    expect(Math.abs(lowest - lowestWeak) / lowestWeak).toBeLessThan(0.03)
    // One travelling front: the crossings march down the strand, and the only
    // tolerance is the one reporting sample two neighbours can share.
    const byPosition = [...result.activations].sort((x, y) => x.cellIndex - y.cellIndex)
    for (let i = 1; i < byPosition.length; i += 1) {
      expect(byPosition[i]!.activationTimeMs).toBeGreaterThanOrEqual(byPosition[i - 1]!.activationTimeMs - 1e-9)
    }
    expect(byPosition[byPosition.length - 1]!.activationTimeMs).toBeGreaterThan(byPosition[0]!.activationTimeMs)
  })

  it('measures a speed that does not move when the mesh does', { timeout: 180_000 }, () => {
    const meshes = [20, 40, 80].map((cells) => cable({ cells }))
    const speeds = meshes.map((result) => result.velocityMmPerMs)
    for (const speed of speeds) expect(speed).not.toBeNull()
    // A stimulus defined in millimetres stays the same stimulus while the mesh
    // changes: the same 0.25 mm is 1 compartment at 20 cells and 4 at 80.
    expect(meshes.map((result) => result.stimulatedCells)).toEqual([1, 2, 4])
    for (const result of meshes) expect(result.activatedCells).toBe(result.traces[0]!.voltages.length)
    const values = speeds as number[]
    const spread = (Math.max(...values) - Math.min(...values)) / Math.min(...values)
    expect(spread).toBeLessThan(0.01)
    // Three compartment sizes, one number: the speed is the cable's, not the grid's.
    for (const value of values) expect(value).toBeGreaterThan(0.6)
    for (const value of values) expect(value).toBeLessThan(0.67)
  })

  it('runs the front faster the better the strand couples, at about the square root', { timeout: 180_000 }, () => {
    // A 3 mm strand so the coarse mesh still resolves the front: Δx = 0.075 mm.
    const speeds = [0.5, 0.25, 0.125].map(
      (diffusivityMm2PerMs) => cable({ lengthMm: 3, diffusivityMm2PerMs }).velocityMmPerMs,
    ) as number[]
    for (const speed of speeds) expect(speed).toBeGreaterThan(0)
    expect(speeds[0]!).toBeGreaterThan(speeds[1]!)
    expect(speeds[1]!).toBeGreaterThan(speeds[2]!)
    // θ ∝ √D would halve the speed for a quarter of the coupling. Discrete
    // compartments and a front only a few cells wide cost it a little of that, so
    // the exponent is what is measured — and a linear law (1) or a saturated one (0)
    // both fail this bound.
    const exponent = Math.log(speeds[0]! / speeds[2]!) / Math.log(0.5 / 0.125)
    expect(exponent).toBeGreaterThan(0.4)
    expect(exponent).toBeLessThan(0.75)
    expect(speeds[2]!).toBeLessThan(speeds[0]! / 2.05)
    expect(speeds[2]!).toBeGreaterThan(speeds[0]! / 2.6)
  })

  it('refuses a mesh finer than a stable step can be paid for', () => {
    // Δx = 0.0125 mm wants a 7.8 µs step, which is 1.5 million of them: the ceiling
    // throws instead of integrating an unstable cable.
    expect(() => cable({ cells: 400, lengthMm: 5 })).toThrow(/stable step/)
    expect(() => cable({}, { tEnd: 1e6, dt: 0.2 })).toThrow(/output steps/)
  })

  it('blocks below the launch strength, and only because of the strand it is loaded by', () => {
    const blocked = cable({ stimulusAmplitude: 2 })
    expect(blocked.velocityMmPerMs).toBeNull()
    // Nothing crosses the threshold anywhere: the axial load of the resting strand
    // downstream drains the stimulus faster than the reaction can regenerate.
    expect(blocked.activatedCells).toBe(0)
    expect(blocked.blockedAfterMm).toBe(0)
    // Traces exist even for a run that never fires: the electrotonic response is the
    // finding, and a panel has to be able to show it.
    expect(blocked.traces.length).toBeGreaterThan(20)
    expect(Math.max(...blocked.traces.flatMap((trace) => trace.voltages))).toBeLessThanOrEqual(0)
    // One more unit of current and the very same cable conducts.
    expect(cable({ stimulusAmplitude: 3 }).blockedAfterMm).toBeNull()
  })

  it('needs a longer pulse to launch than a shorter one of the same strength', { timeout: 180_000 }, () => {
    // The strength-duration relation: 8 units for half a millisecond does nothing,
    // the same 8 units for 2 ms crosses the strand.
    expect(cable({ stimulusAmplitude: 8, stimulusDurationMs: 0.5 }).blockedAfterMm).not.toBeNull()
    const longer = cable({ stimulusAmplitude: 8, stimulusDurationMs: 2 })
    expect(longer.blockedAfterMm).toBeNull()
    // Stronger stimuli do measure faster, and that is the establishment of the front
    // inside the fit rather than the cable changing: see the note in the header.
    expect(longer.velocityMmPerMs!).toBeGreaterThan(cable({ stimulusAmplitude: 4 }).velocityMmPerMs!)
    // And a weak pulse stretched out launches where the short weak one did not.
    expect(cable({ stimulusAmplitude: 3, stimulusDurationMs: 0.5 }).blockedAfterMm).not.toBeNull()
    expect(cable({ stimulusAmplitude: 3, stimulusDurationMs: 5 }).blockedAfterMm).toBeNull()
  })

  it('times the front over the compartments it conducted to, not the electrode', () => {
    const result = cable()
    const conducted = conductedActivations(result)
    expect(conducted.length).toBe(38)
    // The exported fit is the same one the result reports, given the same cells.
    expect(activationWaveSpeed(conducted)).toBeCloseTo(result.velocityMmPerMs!, 12)
    // Including the stimulated compartments moves the number, which is the reason
    // the cable leaves them out: they fire when the pulse charges them.
    const whole = activationWaveSpeed(result.activations)
    expect(whole).not.toBeNull()
    expect(Math.abs(whole! - result.velocityMmPerMs!)).toBeGreaterThan(1e-4)
  })

  it('fits a line, and says when there is no line to fit', () => {
    const at = (positionMm: number, activationTimeMs: number): CableActivation => ({
      cellIndex: Math.round(positionMm * 100),
      positionMm,
      activationTimeMs,
      peakVoltage: 1.8,
    })
    // 0.4 mm in 1 ms is 0.4 mm/ms: the fit is of time against position, then inverted.
    expect(activationWaveSpeed([at(0, 0), at(0.4, 1)])).toBeCloseTo(0.4, 12)
    expect(activationWaveSpeed([at(0, 0), at(0, 1)])).toBeNull()
    expect(activationWaveSpeed([at(0, 0)])).toBeNull()
    expect(activationWaveSpeed([])).toBeNull()
    // Times that run backwards along the strand are not a wave heading anywhere.
    expect(() => activationWaveSpeed([at(0, 5), at(1, 2)] as CableActivation[])).toThrow(/do not increase/)
    // A cell that never fired has no crossing time at all, and cannot tilt the fit.
    // Dropping it leaves (0, 1 ms) and (2, 3 ms): 2 mm in 2 ms is 1 mm/ms.
    expect(activationWaveSpeed([at(0, 1), { ...at(1, 2), activationTimeMs: Number.NaN }, at(2, 3)])).toBeCloseTo(1, 9)
  })

  it('ships presets that do what their notes claim', { timeout: 180_000 }, () => {
    const byId = new Map(
      TISSUE_PRESETS.map((preset) => [preset.id, simulateCable(preset.cable, preset.window)]),
    )
    expect(byId.size).toBe(TISSUE_PRESETS.length)
    const fast = byId.get('conducting-strand')!
    const slow = byId.get('slow-strand')!
    const blocked = byId.get('subthreshold-block')!
    // The notes quote 0.64 mm/ms across in about 8 ms, and 0.30 mm/ms firing the far
    // end at 15 ms. Those are the measurements the notes were written from.
    expect(fast.velocityMmPerMs!).toBeGreaterThan(0.6)
    expect(fast.velocityMmPerMs!).toBeLessThan(0.67)
    expect(fast.blockedAfterMm).toBeNull()
    expect(fast.activatedCells).toBe(fast.traces[0]!.voltages.length)
    const lastFast = fast.activations[fast.activations.length - 1]!
    expect(lastFast.activationTimeMs).toBeGreaterThan(6)
    expect(lastFast.activationTimeMs).toBeLessThan(9)
    expect(slow.velocityMmPerMs!).toBeGreaterThan(0.27)
    expect(slow.velocityMmPerMs!).toBeLessThan(0.33)
    const lastSlow = slow.activations[slow.activations.length - 1]!
    expect(lastSlow.activationTimeMs).toBeGreaterThan(13)
    expect(lastSlow.activationTimeMs).toBeLessThan(17)
    expect(blocked.velocityMmPerMs).toBeNull()
    expect(blocked.activatedCells).toBe(0)
    // Four times less coupling, half the speed: the three presets are three states.
    expect(fast.velocityMmPerMs!).toBeGreaterThan(slow.velocityMmPerMs! * 1.7)
    expect(slow.velocityMmPerMs!).toBeGreaterThan(0)
  })
})

describe('the population', () => {
  it('samples a Lorentzian that holds half its members inside ±γ', () => {
    const frequencies = lorentzianFrequencies(1, 0.1, 100)
    expect(frequencies).toHaveLength(100)
    expect([...frequencies].sort((a, b) => a - b)).toEqual(frequencies)
    const center = frequencies[50]!
    expect(center).toBeCloseTo(1, 2)
    // The tails of a Lorentzian are enormous by design: a quantile sample shows them.
    expect(Math.max(...frequencies)).toBeGreaterThan(5)
    expect(Math.min(...frequencies)).toBeLessThan(-3)
    // Half-width at half-maximum, read off the sample rather than quoted back.
    const gamma = empiricalHalfWidthHertz(frequencies)
    expect(gamma).toBeGreaterThan(0.09)
    expect(gamma).toBeLessThan(0.105)
    const inside = frequencies.filter((frequency) => Math.abs(frequency - center) <= gamma).length
    expect(inside).toBeGreaterThanOrEqual(frequencies.length / 2 - 1)
    expect(inside).toBeLessThanOrEqual(frequencies.length / 2 + 1)
    // Deterministic: the same call is the same population, so a measured onset
    // cannot disagree with the prediction for reasons of sampling luck.
    expect(lorentzianFrequencies(1, 0.1, 100)).toEqual(frequencies)
    expect(() => lorentzianFrequencies(1, 0.1, 1)).toThrow(/at least two oscillators/)
    expect(() => lorentzianFrequencies(0, 0.1, 10)).toThrow(/Central frequency/)
    expect(() => lorentzianFrequencies(1, 0, 10)).toThrow(/half-width/)
  })

  it('measures the order parameter the way the order parameter is defined', () => {
    expect(orderParameter([0, 0, 0]).r).toBeCloseTo(1, 12)
    expect(orderParameter([0.7, 0.7, 0.7]).meanPhaseRadians).toBeCloseTo(0.7, 12)
    // Three phases a third of a turn apart cancel exactly.
    const spread = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3]
    expect(orderParameter(spread).r).toBeLessThan(1e-15)
    expect(orderParameter([0, Math.PI]).r).toBeLessThan(1e-15)
    // Half a turn apart is the other extreme of the same two-point sum.
    expect(orderParameter([0, 0.001]).r).toBeGreaterThan(0.99)
    expect(() => orderParameter([])).toThrow(/at least one phase/)
    expect(() => orderParameter([0, Number.NaN])).toThrow(/Oscillator phase/)
  })

  it('runs uncoupled oscillators at exactly their own frequencies', () => {
    const frequencies = lorentzianFrequencies(1, 0.1, 50)
    const run = simulateOscillatorPopulation({ naturalFrequenciesHz: frequencies, couplingHertz: 0 }, { tEnd: 40, dt: 0.2 })
    const phases = frequencies.map((_, index) => (2 * Math.PI * index) / frequencies.length)
    for (const sample of run.samples) {
      for (let i = 0; i < frequencies.length; i += 1) {
        const expected = phases[i]! + 2 * Math.PI * frequencies[i]! * sample.timeSecond
        const drift = sample.phasesRadians[i]! - expected
        // θ̇ = ω is linear with a constant slope, so any Runge-Kutta step is exact.
        // Anything but round-off here is a bug in how the state or the time is passed.
        expect(Math.abs(Math.atan2(Math.sin(drift), Math.cos(drift)))).toBeLessThan(1e-6)
      }
    }
    // Equally spaced initial phases cancel to nothing and stay incoherent.
    expect(run.samples[0]!.orderParameter).toBeLessThan(1e-12)
    expect(run.steadyStateOrder).toBeLessThan(0.1)
    expect(run.predictedCriticalCouplingHz).toBeCloseTo(2 * empiricalHalfWidthHertz(frequencies), 12)
  })

  it('locks identical oscillators onto the frequency they already shared', () => {
    // Phases a half-radian apart, not an even comb: evenly spaced identical clocks
    // are an exact unstable equilibrium of the mean field and would sit at R = 0
    // until round-off broke it. See the note on `simulateOscillatorPopulation`.
    const frequencies = new Array<number>(12).fill(1)
    const run = simulateOscillatorPopulation(
      { naturalFrequenciesHz: frequencies, initialPhasesRadians: frequencies.map((_, index) => 0.5 * index), couplingHertz: 0.5 },
      { tEnd: 40, dt: 0.1 },
    )
    expect(run.samples[0]!.orderParameter).toBeLessThan(0.1)
    expect(run.steadyStateOrder).toBeGreaterThan(0.99)
    expect(run.unlockedFrequenciesHz).toHaveLength(0)
    const first = run.samples[0]!
    const last = run.samples[run.samples.length - 1]!
    // The mean phase is wrapped, so unwind it one sample at a time: at 0.1 s apart a
    // 1 Hz population moves less than a quarter turn per sample and the count is exact.
    let turns = 0
    for (let i = 1; i < run.samples.length; i += 1) {
      const step = run.samples[i]!.meanPhaseRadians - run.samples[i - 1]!.meanPhaseRadians
      turns += Math.atan2(Math.sin(step), Math.cos(step)) / (2 * Math.PI)
    }
    // Coupling pulls the phases together but must not move the shared frequency.
    const measuredHertz = turns / (last.timeSecond - first.timeSecond)
    expect(measuredHertz).toBeCloseTo(1, 3)
  })

  it('agrees more the harder it is coupled, and starts agreeing where theory says', { timeout: 180_000 }, () => {
    const frequencies = lorentzianFrequencies(1, 0.1, 50)
    const predicted = 2 * empiricalHalfWidthHertz(frequencies)
    const curve = synchronisationCurve({
      naturalFrequenciesHz: frequencies,
      couplingsHertz: [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.6],
      window: { tEnd: 100, dt: 0.5 },
    })
    expect(curve.sweepSpacingHertz).toBeCloseTo(0.05, 12)
    const order = curve.points.map((point) => point.orderParameter)
    // Monotone up to the sampling noise of the baseline, which is 1/√N ≈ 0.14.
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i]!).toBeGreaterThan(order[i - 1]! - 0.02)
    }
    const baseline = Math.max(...order.slice(0, 3))
    expect(baseline).toBeLessThan(0.13)
    expect(order[order.length - 1]!).toBeGreaterThan(0.8)
    // The transition is bracketed between the last point still inside the baseline's
    // own noise band and the first clearly out of it, and the mean-field K_c = 2γ is
    // inside that bracket. Measured here: quiet through 0.15, risen at 0.2, K_c = 0.194.
    const risenIndex = curve.points.findIndex((point) => point.orderParameter > baseline + 0.05)
    expect(risenIndex).toBeGreaterThan(0)
    const risen = curve.points[risenIndex]!
    const lastQuiet = curve.points[risenIndex - 1]!
    expect(predicted).toBeGreaterThan(lastQuiet.couplingHertz)
    expect(predicted).toBeLessThanOrEqual(risen.couplingHertz)
    // Half-locked is a different question and lands well past the onset.
    expect(curve.couplingAtLockLevelHertz!).toBeGreaterThan(predicted)
    expect(() => synchronisationCurve({ naturalFrequenciesHz: frequencies, couplingsHertz: [0.1], window: { tEnd: 10, dt: 1 } })).toThrow(/at least two coupling/)
    expect(() =>
      synchronisationCurve({ naturalFrequenciesHz: frequencies, couplingsHertz: [0.1, 0.2], window: { tEnd: 10, dt: 1 }, lockLevel: 1.5 }),
    ).toThrow(/between 0 and 1/)
  })

  it('refuses a population that is not one', () => {
    expect(() => simulateOscillatorPopulation({ naturalFrequenciesHz: [1], couplingHertz: 0.1 }, { tEnd: 10, dt: 1 })).toThrow(
      /at least two oscillators/,
    )
    expect(() =>
      simulateOscillatorPopulation({ naturalFrequenciesHz: [1, Number.NaN], couplingHertz: 0.1 }, { tEnd: 10, dt: 1 }),
    ).toThrow(/Natural frequency/)
    expect(() =>
      simulateOscillatorPopulation({ naturalFrequenciesHz: [1, 1.2], couplingHertz: -0.1 }, { tEnd: 10, dt: 1 }),
    ).toThrow(/Coupling strength/)
    expect(() =>
      simulateOscillatorPopulation(
        { naturalFrequenciesHz: [1, 1.2], initialPhasesRadians: [0], couplingHertz: 0.1 },
        { tEnd: 10, dt: 1 },
      ),
    ).toThrow(/one phase/)
    expect(() =>
      simulateOscillatorPopulation(
        { naturalFrequenciesHz: [1, 1.2], initialPhasesRadians: [0, Number.NaN], couplingHertz: 0.1 },
        { tEnd: 10, dt: 1 },
      ),
    ).toThrow(/Oscillator phase/)
  })

  it('ships populations that are locked and unlocked, as named', () => {
    const locked = simulateOscillatorPopulation(PACEMAKER_POPULATION, { tEnd: 60, dt: 0.2 })
    const loose = simulateOscillatorPopulation(INCOHERENT_POPULATION, { tEnd: 60, dt: 0.2 })
    expect(locked.predictedCriticalCouplingHz).toBeGreaterThan(0.15)
    expect(locked.predictedCriticalCouplingHz).toBeLessThan(0.25)
    // Coupling at twice the predicted onset: the population agrees, a few of its
    // far-tailed members excepted.
    expect(PACEMAKER_POPULATION.couplingHertz).toBeGreaterThan(2 * locked.predictedCriticalCouplingHz)
    expect(locked.steadyStateOrder).toBeGreaterThan(0.6)
    expect(locked.unlockedFrequenciesHz.length).toBeLessThan(locked.naturalFrequenciesHz.length / 4)
    expect(INCOHERENT_POPULATION.couplingHertz).toBeLessThan(locked.predictedCriticalCouplingHz)
    expect(loose.steadyStateOrder).toBeLessThan(0.1)
    expect(loose.unlockedFrequenciesHz.length).toBeGreaterThan(locked.unlockedFrequenciesHz.length)
    // The two share a spread, so only the coupling differs between them.
    expect(loose.naturalFrequenciesHz).toEqual(locked.naturalFrequenciesHz)
  })

  it('sizes its own step from the fastest thing in it', () => {
    const frequencies = lorentzianFrequencies(1, 0.1, 20)
    // A wide spread is a fast system: the same output cadence has to be paid for
    // with more internal work, and the ceiling says so out loud.
    const loose = simulateOscillatorPopulation({ naturalFrequenciesHz: frequencies, couplingHertz: 0.1 }, { tEnd: 40, dt: 0.4 })
    // 40 s at a 0.4 s cadence is exactly a hundred reporting intervals, and the last
    // reported sample is exactly the end of the run. That only holds because the
    // internal grid is computed from the step index: a drifting accumulated clock puts
    // the endpoint one sample off the reporting stride and the run reports it twice.
    expect(loose.samples).toHaveLength(101)
    expect(loose.samples[0]!.timeSecond).toBe(0)
    expect(loose.samples[100]!.timeSecond).toBe(40)
    for (let i = 1; i < loose.samples.length; i += 1) {
      expect(loose.samples[i]!.timeSecond - loose.samples[i - 1]!.timeSecond).toBeCloseTo(0.4, 9)
    }
    expect(() =>
      simulateOscillatorPopulation({ naturalFrequenciesHz: frequencies, couplingHertz: 0.1 }, { tEnd: 1e5, dt: 0.4 }),
    ).toThrow(/stable step|output steps/)
  })
})
