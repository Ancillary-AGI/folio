import { describe, expect, it } from 'vitest'

import {
  CELL_PRESETS,
  CLASSIC_HODGKIN_HUXLEY,
  EXCITABLE_FITZHUGH_NAGUMO,
  RESTING_STATE,
  HodgkinHuxleyRateFunctions,
  detectSpikes,
  evokesSpike,
  findThresholdCurrent,
  gateSteadyState,
  meanFiringRateHertz,
  pulseTrain,
  simulateFitzHughNagumo,
  simulateHodgkinHuxley,
  simulateIntegrateAndFire,
  strengthDurationCurve,
} from './excitability'

const ZERO_STIMULUS = () => 0

describe('Hodgkin–Huxley rate functions', () => {
  it('keeps the removable singularity finite at the potentials where it sits', () => {
    // α_m = 0.1(V+40)/(1−e^−(V+40)/10) is 0/0 at −40 mV and α_n at −55 mV.
    // The limits are 0.1·10 and 0.01·10; a naive division would return NaN.
    expect(HodgkinHuxleyRateFunctions(-40).alphaM).toBeCloseTo(1, 12)
    expect(HodgkinHuxleyRateFunctions(-55).alphaN).toBeCloseTo(0.1, 12)
    // Just off the singularity the closed form and the series must agree, or the
    // branch switch would be a step in the vector field.
    for (const offset of [1e-9, 1e-7, 1e-5]) {
      expect(HodgkinHuxleyRateFunctions(-40 + offset).alphaM).toBeCloseTo(1 + offset / 20, 9)
      expect(HodgkinHuxleyRateFunctions(-40 - offset).alphaM).toBeCloseTo(1 - offset / 20, 9)
    }
    expect(HodgkinHuxleyRateFunctions(-40).betaM).toBeGreaterThan(0)
  })

  it('puts the published resting state at a fixed point of the model', () => {
    // Self-consistency, not a literature quote: the documented rest is only a
    // rest if the gates there are their own steady states and dV/dt is zero.
    const steady = gateSteadyState(RESTING_STATE.potentialMillivolts)
    expect(steady.m).toBeCloseTo(RESTING_STATE.m, 3)
    expect(steady.h).toBeCloseTo(RESTING_STATE.h, 3)
    expect(steady.n).toBeCloseTo(RESTING_STATE.n, 3)

    const samples = simulateHodgkinHuxley(CLASSIC_HODGKIN_HUXLEY, RESTING_STATE, ZERO_STIMULUS, {
      tEnd: 50,
      dt: 0.05,
    })
    const drift = samples.map((sample) => sample.potentialMillivolts - RESTING_STATE.potentialMillivolts)
    expect(Math.max(...drift.map(Math.abs))).toBeLessThan(0.05)
  })

  it('reports the total ionic current as zero when nothing is injected at rest', () => {
    const [sample] = simulateHodgkinHuxley(CLASSIC_HODGKIN_HUXLEY, RESTING_STATE, ZERO_STIMULUS, {
      tEnd: 0.1,
      dt: 0.01,
    })
    const net = sample.sodiumCurrentMicroAmpPerCm2 + sample.potassiumCurrentMicroAmpPerCm2 + sample.leakCurrentMicroAmpPerCm2
    expect(Math.abs(net)).toBeLessThan(0.05)
  })
})

describe('the all-or-none response', () => {
  const window = { tEnd: 60, dt: 0.02 }
  const shock = (amplitude: number) =>
    pulseTrain({ amplitudeMicroAmpPerCm2: amplitude, startMs: 5, durationMs: 1 })

  it('fires a full spike above threshold and no spike far below it', () => {
    const fired = simulateHodgkinHuxley(CLASSIC_HODGKIN_HUXLEY, RESTING_STATE, shock(15), window)
    const spikes = detectSpikes(fired)
    expect(spikes).toHaveLength(1)
    expect(spikes[0].peakMillivolts).toBeGreaterThan(20)
    expect(spikes[0].peakMillivolts).toBeLessThan(60)
    expect(spikes[0].followingTroughMillivolts).toBeLessThan(RESTING_STATE.potentialMillivolts)

    const quiet = simulateHodgkinHuxley(CLASSIC_HODGKIN_HUXLEY, RESTING_STATE, shock(1), window)
    expect(detectSpikes(quiet)).toHaveLength(0)
    const excursion = Math.max(...quiet.map((sample) => sample.potentialMillivolts)) - RESTING_STATE.potentialMillivolts
    expect(excursion).toBeLessThan(10)

    // The spike shape barely depends on how far above threshold the stimulus is:
    // that is what "all-or-none" means, and it is a property of the solution.
    const bigger = simulateHodgkinHuxley(CLASSIC_HODGKIN_HUXLEY, RESTING_STATE, shock(40), window)
    expect(Math.abs(detectSpikes(bigger)[0].peakMillivolts - spikes[0].peakMillivolts)).toBeLessThan(3)
  })

  it('hides behind a refractory period, then recovers', () => {
    const paired = (gapMs: number) =>
      simulateHodgkinHuxley(
        CLASSIC_HODGKIN_HUXLEY,
        RESTING_STATE,
        (time: number): number =>
          (time >= 5 && time < 6) || (time >= 5 + gapMs && time < 6 + gapMs) ? 20 : 0,
        { tEnd: 5 + gapMs + 50, dt: 0.02 },
      )
    expect(detectSpikes(paired(2))).toHaveLength(1)
    expect(detectSpikes(paired(25))).toHaveLength(2)
  })

  it('raises the firing rate with injected current', () => {
    const counts = [5, 10, 20, 50].map((amplitude) => {
      const samples = simulateHodgkinHuxley(
        CLASSIC_HODGKIN_HUXLEY,
        RESTING_STATE,
        pulseTrain({ amplitudeMicroAmpPerCm2: amplitude, startMs: 5, durationMs: 200 }),
        { tEnd: 220, dt: 0.05 },
      )
      // Count only after the response settles, so the first interval of a train
      // does not bias the comparison.
      return detectSpikes(samples).filter((spike) => spike.peakTimeMs > 30).length
    })
    for (let i = 1; i < counts.length; i += 1) expect(counts[i]).toBeGreaterThan(counts[i - 1])
  })
})

describe('solver accuracy', () => {
  it('does not depend on the reporting step once the internal step resolves the gates', () => {
    const stimulus = pulseTrain({ amplitudeMicroAmpPerCm2: 15, startMs: 5, durationMs: 1 })
    const coarse = simulateHodgkinHuxley(CLASSIC_HODGKIN_HUXLEY, RESTING_STATE, stimulus, { tEnd: 40, dt: 0.05 })
    const fine = simulateHodgkinHuxley(CLASSIC_HODGKIN_HUXLEY, RESTING_STATE, stimulus, { tEnd: 40, dt: 0.005 })
    const coarsePeak = detectSpikes(coarse)[0].peakMillivolts
    const finePeak = detectSpikes(fine)[0].peakMillivolts
    expect(Math.abs(coarsePeak - finePeak)).toBeLessThan(0.1)
    expect(Math.abs(detectSpikes(coarse)[0].peakTimeMs - detectSpikes(fine)[0].peakTimeMs)).toBeLessThan(0.05)
  })

  it('rejects a window that would never finish and parameters that are not physical', () => {
    expect(() =>
      simulateHodgkinHuxley(CLASSIC_HODGKIN_HUXLEY, RESTING_STATE, ZERO_STIMULUS, { tEnd: 1e9, dt: 1e-6 }),
    ).toThrow(/limit/)
    expect(() =>
      simulateHodgkinHuxley({ ...CLASSIC_HODGKIN_HUXLEY, capacitanceUfPerCm2: 0 }, RESTING_STATE, ZERO_STIMULUS, {
        tEnd: 10,
        dt: 0.1,
      }),
    ).toThrow(/capacitance/i)
    expect(() =>
      simulateHodgkinHuxley(CLASSIC_HODGKIN_HUXLEY, { ...RESTING_STATE, n: 1.4 }, ZERO_STIMULUS, {
        tEnd: 10,
        dt: 0.1,
      }),
    ).toThrow(/between 0 and 1/)
  })

  it('runs the second preset without pretending it is a measured cell', () => {
    const preset = CELL_PRESETS[1]
    expect(preset.note).toMatch(/Representative/)
    const samples = simulateHodgkinHuxley(
      preset.HodgkinHuxley,
      preset.initial,
      pulseTrain({ amplitudeMicroAmpPerCm2: 20, startMs: 5, durationMs: 1 }),
      { tEnd: 40, dt: 0.05 },
    )
    expect(detectSpikes(samples).length).toBeGreaterThanOrEqual(1)
  })
})

describe('spike counting', () => {
  it('uses hysteresis, so a shoulder is not a second spike', () => {
    const trace = [
      { timeMs: 0, potentialMillivolts: -65 },
      { timeMs: 1, potentialMillivolts: 10 },
      { timeMs: 2, potentialMillivolts: 40 },
      { timeMs: 3, potentialMillivolts: 5 },
      { timeMs: 4, potentialMillivolts: 30 },
      { timeMs: 5, potentialMillivolts: -10 },
      { timeMs: 6, potentialMillivolts: -70 },
      { timeMs: 7, potentialMillivolts: -65 },
    ]
    const spikes = detectSpikes(trace)
    expect(spikes).toHaveLength(1)
    expect(spikes[0].peakMillivolts).toBe(40)
    expect(spikes[0].followingTroughMillivolts).toBe(-70)
    expect(() => detectSpikes(trace, { upCrossMillivolts: 0, downCrossMillivolts: 10 })).toThrow(/inverted/)
  })

  it('turns peak times into a frequency', () => {
    const spikes = [0, 20, 40, 60].map((timeMs) => ({
      peakIndex: 0,
      peakTimeMs: timeMs,
      peakMillivolts: 30,
      followingTroughMillivolts: null,
    }))
    expect(meanFiringRateHertz(spikes)).toBeCloseTo(50, 10)
    // A single spike has no interval to average; reporting 0 Hz is the honest answer.
    expect(meanFiringRateHertz([spikes[0]])).toBe(0)
    expect(meanFiringRateHertz(spikes, 50)).toBe(0)
  })
})

describe('in-silico stimulation experiments', () => {
  it('bisects a threshold that actually straddles the response', () => {
    const { thresholdMicroAmpPerCm2, iterations } = findThresholdCurrent(
      CLASSIC_HODGKIN_HUXLEY,
      RESTING_STATE,
      10,
      { upperMicroAmpPerCm2: 30, relativeTolerance: 1e-2 },
    )
    expect(iterations).toBeGreaterThan(3)
    expect(thresholdMicroAmpPerCm2).toBeGreaterThan(1)
    expect(thresholdMicroAmpPerCm2).toBeLessThan(10)

    const window = { tEnd: 80, dt: 0.05 }
    const at = (amplitude: number) =>
      evokesSpike(
        CLASSIC_HODGKIN_HUXLEY,
        RESTING_STATE,
        pulseTrain({ amplitudeMicroAmpPerCm2: amplitude, startMs: 5, durationMs: 10 }),
        window,
      )
    expect(at(thresholdMicroAmpPerCm2)).toBe(true)
    expect(at(thresholdMicroAmpPerCm2 * 0.7)).toBe(false)
  })

  it('refuses to invent a threshold when the search ceiling never fired', () => {
    expect(() =>
      findThresholdCurrent(CLASSIC_HODGKIN_HUXLEY, RESTING_STATE, 10, { upperMicroAmpPerCm2: 0.2 }),
    ).toThrow(/never fired/)
  })

  it('produces a strength–duration curve that falls with pulse width', () => {
    const curve = strengthDurationCurve(
      CLASSIC_HODGKIN_HUXLEY,
      RESTING_STATE,
      [1, 3, 10, 30],
      { upperMicroAmpPerCm2: 40, relativeTolerance: 5e-2 },
    )
    expect(curve.points).toHaveLength(4)
    for (let i = 1; i < curve.points.length; i += 1) {
      expect(curve.points[i].thresholdMicroAmpPerCm2).toBeLessThanOrEqual(
        curve.points[i - 1].thresholdMicroAmpPerCm2 + 1e-9,
      )
    }
    expect(curve.rheobaseMicroAmpPerCm2).toBeCloseTo(
      Math.min(...curve.points.map((point) => point.thresholdMicroAmpPerCm2)),
      12,
    )
    // A 1 ms pulse must need more current than a 30 ms one — that is the whole
    // point of the curve, and it is what makes a chronaxie meaningful.
    expect(curve.points[0].thresholdMicroAmpPerCm2).toBeGreaterThan(curve.points[3].thresholdMicroAmpPerCm2)
  })

  it('lays out a pulse train with a real gap between pulses', () => {
    const train = pulseTrain({ amplitudeMicroAmpPerCm2: 10, startMs: 100, durationMs: 1 }, { repetitions: 3, periodMs: 10 })
    expect(train(99)).toBe(0)
    expect(train(100.5)).toBe(10)
    expect(train(101.5)).toBe(0)
    expect(train(110.5)).toBe(10)
    expect(train(120.5)).toBe(10)
    expect(train(130.5)).toBe(0)
    expect(() =>
      pulseTrain({ amplitudeMicroAmpPerCm2: 1, startMs: 0, durationMs: 5 }, { repetitions: 2, periodMs: 2 }),
    ).toThrow(/overlap/)
    expect(() => pulseTrain({ amplitudeMicroAmpPerCm2: 1, startMs: 0, durationMs: 1 }, { repetitions: 1.5 })).toThrow(/whole number/)
  })
})

describe('FitzHugh–Nagumo', () => {
  it('relaxes to an equilibrium that satisfies both equations', () => {
    const samples = simulateFitzHughNagumo(EXCITABLE_FITZHUGH_NAGUMO, [-1.2, -0.5], ZERO_STIMULUS, {
      tEnd: 200,
      dt: 1,
    })
    const final = samples[samples.length - 1]
    const { a, b } = EXCITABLE_FITZHUGH_NAGUMO
    expect(Math.abs(final.voltage - final.voltage ** 3 / 3 - final.recovery)).toBeLessThan(1e-6)
    expect(Math.abs(final.voltage + a - b * final.recovery)).toBeLessThan(1e-6)
  })

  it('is excitable at rest: a small kick decays, a big one costs a spike', () => {
    const small = simulateFitzHughNagumo(EXCITABLE_FITZHUGH_NAGUMO, [-1.199, -0.499], (time: number) =>
      time < 1 ? 0.2 : 0, { tEnd: 120, dt: 0.5 })
    const big = simulateFitzHughNagumo(EXCITABLE_FITZHUGH_NAGUMO, [-1.199, -0.499], (time: number) =>
      time < 1 ? 1.5 : 0, { tEnd: 120, dt: 0.5 })
    const trace = (samples: typeof small) =>
      detectSpikes(samples.map((s) => ({ timeMs: s.time, potentialMillivolts: s.voltage })), {
        upCrossMillivolts: 1,
        downCrossMillivolts: 0,
      })
    expect(trace(small)).toHaveLength(0)
    expect(trace(big)).toHaveLength(1)
  })

  it('becomes a sustained oscillator under enough steady current', () => {
    const samples = simulateFitzHughNagumo(EXCITABLE_FITZHUGH_NAGUMO, [0, 0], () => 0.5, { tEnd: 400, dt: 0.5 })
    const peaks = detectSpikes(samples.map((s) => ({ timeMs: s.time, potentialMillivolts: s.voltage })), {
      upCrossMillivolts: 1,
      downCrossMillivolts: 0,
    })
    expect(peaks.length).toBeGreaterThanOrEqual(4)
    // The first cycle still carries the transient; the rest must repeat. Peak
    // times are quantised to the 0.5 ms reporting step, so the tolerance is one
    // step rather than a claim about the continuous solution.
    const steady = peaks.slice(2).map((peak, i) => peak.peakTimeMs - peaks[i + 1].peakTimeMs)
    const mean = steady.reduce((sum, value) => sum + value, 0) / steady.length
    expect(mean).toBeGreaterThan(10)
    for (const interval of steady) {
      expect(Math.abs(interval - mean)).toBeLessThan(0.5)
    }
  })

  it('checks its parameters', () => {
    expect(() => simulateFitzHughNagumo({ ...EXCITABLE_FITZHUGH_NAGUMO, epsilon: 0 }, [0, 0], ZERO_STIMULUS, { tEnd: 10, dt: 1 })).toThrow(/timescale/)
    expect(() => simulateFitzHughNagumo(EXCITABLE_FITZHUGH_NAGUMO, [0], ZERO_STIMULUS, { tEnd: 10, dt: 1 })).toThrow(/two initial values/)
  })
})

describe('leaky integrate-and-fire', () => {
  const base = {
    tauMs: 10,
    restMillivolts: -65,
    thresholdMillivolts: -50,
    resetMillivolts: -65,
    driveMillivolts: -40,
    refractoryMs: 0,
  }

  it('hits the analytic inter-spike interval exactly', () => {
    // V(t) = V∞ + (V_reset − V∞)e^(−t/τ) reaches V_th at
    // t = τ·ln((V∞ − V_reset)/(V∞ − V_th)) = 10·ln(25/10) ms.
    const result = simulateIntegrateAndFire(base, { tEnd: 100, dt: 0.5 })
    const expected = base.tauMs * Math.log((base.driveMillivolts - base.resetMillivolts) / (base.driveMillivolts - base.thresholdMillivolts))
    expect(result.asymptoteMillivolts).toBe(-40)
    expect(result.intervalsMs.length).toBeGreaterThan(2)
    for (const interval of result.intervalsMs) expect(interval).toBeCloseTo(expected, 9)
  })

  it('adds the refractory period to the interval, not to the count', () => {
    const withRefractory = simulateIntegrateAndFire({ ...base, refractoryMs: 3 }, { tEnd: 100, dt: 0.5 })
    const plain = simulateIntegrateAndFire(base, { tEnd: 100, dt: 0.5 })
    const expected =
      base.tauMs * Math.log((base.driveMillivolts - base.resetMillivolts) / (base.driveMillivolts - base.thresholdMillivolts)) + 3
    for (const interval of withRefractory.intervalsMs) expect(interval).toBeCloseTo(expected, 9)
    expect(withRefractory.spikeTimesMs.length).toBeLessThan(plain.spikeTimesMs.length)
  })

  it('never spikes when the drive cannot reach threshold', () => {
    const silent = simulateIntegrateAndFire({ ...base, driveMillivolts: -55 }, { tEnd: 100, dt: 1 })
    expect(silent.spikeTimesMs).toHaveLength(0)
    // It relaxes to the drive instead.
    expect(silent.samples[silent.samples.length - 1].potentialMillivolts).toBeCloseTo(-55, 3)
  })

  it('rejects a threshold below rest and a reset above threshold', () => {
    expect(() => simulateIntegrateAndFire({ ...base, thresholdMillivolts: -70 }, { tEnd: 10, dt: 1 })).toThrow(/above rest/)
    expect(() => simulateIntegrateAndFire({ ...base, resetMillivolts: -40 }, { tEnd: 10, dt: 1 })).toThrow(/continuously/)
  })
})
