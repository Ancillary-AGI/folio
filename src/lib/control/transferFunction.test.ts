import { describe, expect, it } from 'vitest'
import {
  bodeResponse,
  isControllable,
  isObservable,
  polynomialRoots,
  simulateImpulse,
  simulateStep,
  stabilityMargins,
  stepResponseMetrics,
  tfDcGain,
  tfFeedback,
  tfParallel,
  tfPoles,
  tfSeries,
  tfStability,
  tfToStateSpace,
  tfZeros,
  type SimulationSample,
} from './transferFunction'

function at(samples: readonly SimulationSample[], time: number): number {
  let best = samples[0]
  for (const sample of samples) {
    if (Math.abs(sample.timeSeconds - time) < Math.abs(best.timeSeconds - time)) best = sample
  }
  return best.output
}

describe('transfer-function algebra', () => {
  it('computes the closed loop of G = 1/(s+1) with unity negative feedback as 1/(s+2)', () => {
    const closed = tfFeedback({ numerator: [1], denominator: [1, 1] })
    expect(closed.numerator).toEqual([1])
    expect(closed.denominator).toEqual([1, 2])

    const response = simulateStep(closed, { tEndSeconds: 10, dtSeconds: 0.005 })
    expect(at(response, 10)).toBeCloseTo(0.5, 6)
  })

  it('multiplies series blocks and adds parallel blocks', () => {
    const first = { numerator: [1], denominator: [1, 1] }
    const second = { numerator: [2], denominator: [1, 2] }
    const series = tfSeries(first, second)
    expect(series.numerator).toEqual([2])
    expect(series.denominator).toEqual([1, 3, 2])

    const parallel = tfParallel(first, second)
    expect(parallel.numerator).toEqual([3, 4])
    expect(parallel.denominator).toEqual([1, 3, 2])
  })

  it('reports DC gain and integrator behaviour', () => {
    expect(tfDcGain({ numerator: [2], denominator: [1, 2] })).toBe(1)
    expect(tfDcGain({ numerator: [1], denominator: [1, 0] })).toBe(Infinity)
  })
})

describe('roots and stability', () => {
  it('finds real and complex roots of a cubic and a quadratic', () => {
    const cubic = polynomialRoots([1, 6, 11, 6]).map((root) => root.re).sort((a, b) => a - b)
    expect(cubic[0]).toBeCloseTo(-3, 9)
    expect(cubic[1]).toBeCloseTo(-2, 9)
    expect(cubic[2]).toBeCloseTo(-1, 9)

    const quadratic = polynomialRoots([1, 2, 5])
    const real = quadratic.map((root) => root.re)
    const imaginary = quadratic.map((root) => root.im).sort((a, b) => a - b)
    expect(real[0]).toBeCloseTo(-1, 12)
    expect(real[1]).toBeCloseTo(-1, 12)
    expect(imaginary[0]).toBeCloseTo(-2, 12)
    expect(imaginary[1]).toBeCloseTo(2, 12)
  })

  it('classifies stable, marginal and unstable plants from their poles', () => {
    expect(tfStability({ numerator: [1], denominator: [1, 1] })).toBe('stable')
    expect(tfStability({ numerator: [1], denominator: [1, 0] })).toBe('marginal')
    expect(tfStability({ numerator: [1], denominator: [1, 0, -1] })).toBe('unstable')
    expect(tfPoles({ numerator: [1], denominator: [1, 2, 5] })).toHaveLength(2)
  })

  it('exposes zeros and rejects malformed polynomials', () => {
    expect(tfZeros({ numerator: [1, 3], denominator: [1, 1] })[0].re).toBeCloseTo(-3, 12)
    expect(() => tfPoles({ numerator: [1], denominator: [0, 0] })).toThrow(/zero polynomial/)
    expect(() => polynomialRoots([1, Number.NaN])).toThrow(/not finite/)
  })
})

describe('time-domain simulation', () => {
  it('matches the analytic first-order step response and its metrics', () => {
    const tf = { numerator: [1], denominator: [1, 1] }
    const samples = simulateStep(tf, { tEndSeconds: 8, dtSeconds: 0.001 })
    expect(at(samples, 1)).toBeCloseTo(1 - Math.exp(-1), 6)
    expect(at(samples, 5)).toBeCloseTo(1 - Math.exp(-5), 6)

    const metrics = stepResponseMetrics(samples)
    // At t = 8 s the true response is 1 − e⁻⁸ = 0.9996645, which is the
    // steady state these samples can report.
    expect(metrics.steadyState).toBeCloseTo(1 - Math.exp(-8), 6)
    expect(metrics.overshootPct).toBeCloseTo(0, 4)
    expect(metrics.riseTimeSeconds).toBeCloseTo(Math.log(9), 2)
    // The band is centred on the last sample (1 − e⁻⁸), not on 1, so it is
    // crossed slightly before the ideal ln(50) instant.
    expect(Math.abs(metrics.settlingTimeSeconds - Math.log(50))).toBeLessThanOrEqual(0.02)
  })

  it('matches the analytic underdamped second-order step response', () => {
    const zeta = 0.5
    const omegaN = 2
    const tf = { numerator: [omegaN * omegaN], denominator: [1, 2 * zeta * omegaN, omegaN * omegaN] }
    const samples = simulateStep(tf, { tEndSeconds: 10, dtSeconds: 0.0005 })
    const omegaD = omegaN * Math.sqrt(1 - zeta * zeta)

    for (const time of [0.5, 1, 2, 4]) {
      const analytic = 1 - Math.exp(-zeta * omegaN * time) *
        (Math.cos(omegaD * time) + (zeta / Math.sqrt(1 - zeta * zeta)) * Math.sin(omegaD * time))
      expect(at(samples, time)).toBeCloseTo(analytic, 5)
    }

    const metrics = stepResponseMetrics(samples)
    expect(metrics.overshootPct).toBeCloseTo(Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta)) * 100, 1)
  })

  it('matches the analytic impulse response and flags direct feed-through', () => {
    const impulse = simulateImpulse(
      { numerator: [1], denominator: [1, 1] },
      { tEndSeconds: 5, dtSeconds: 0.001 },
    )
    expect(impulse.hasDirectTerm).toBe(false)
    expect(at(impulse.samples, 1)).toBeCloseTo(Math.exp(-1), 6)

    const direct = simulateImpulse(
      { numerator: [1, 1], denominator: [1, 2] },
      { tEndSeconds: 5, dtSeconds: 0.001 },
    )
    expect(direct.hasDirectTerm).toBe(true)
    expect(at(direct.samples, 1)).toBeCloseTo(-Math.exp(-2), 6)
  })

  it('converts a proper transfer function to a matching state space', () => {
    const ss = tfToStateSpace({ numerator: [1, 2], denominator: [1, 3, 2] })
    expect(ss.a).toEqual([[0, 1], [-2, -3]])
    expect(ss.b).toEqual([0, 1])
    expect(ss.c).toEqual([2, 1])
    expect(ss.d).toBe(0)

    const samples = simulateStep({ numerator: [1, 2], denominator: [1, 3, 2] }, { tEndSeconds: 6, dtSeconds: 0.002 })
    // (s+2)/((s+1)(s+2)) = 1/(s+1), so the step response is unchanged.
    expect(at(samples, 2)).toBeCloseTo(1 - Math.exp(-2), 5)

    const direct = tfToStateSpace({ numerator: [1, 1], denominator: [1, 2] })
    expect(direct.d).toBe(1)
  })

  it('rejects improper systems and impossible simulation settings', () => {
    expect(() => tfToStateSpace({ numerator: [1, 0, 0], denominator: [1, 1] })).toThrow(/improper/)
    expect(() => simulateStep({ numerator: [1], denominator: [1, 1] }, { tEndSeconds: 0, dtSeconds: 0.1 })).toThrow(/end time/)
    expect(() => simulateStep({ numerator: [1], denominator: [1, 1] }, { tEndSeconds: 1, dtSeconds: 0 })).toThrow(/step/)
    expect(() => simulateStep({ numerator: [1], denominator: [1, 1] }, { tEndSeconds: 1, dtSeconds: 1e-9 })).toThrow(/limit/)
  })

  it('detects uncontrollable and unobservable realisations', () => {
    expect(isControllable(tfToStateSpace({ numerator: [1], denominator: [1, 3, 2] }))).toBe(true)
    expect(isObservable(tfToStateSpace({ numerator: [1], denominator: [1, 3, 2] }))).toBe(true)
    // Pole-zero cancellation at −1: controllable canonical form loses observability.
    expect(isObservable(tfToStateSpace({ numerator: [1, 1], denominator: [1, 3, 2] }))).toBe(false)
  })
})

describe('frequency response and margins', () => {
  it('puts the first-order corner at −3 dB and −45°', () => {
    const cornerHz = 1 / (2 * Math.PI)
    const bode = bodeResponse(
      { numerator: [1], denominator: [1, 1] },
      { fMinHz: cornerHz / 10, fMaxHz: cornerHz * 10, points: 3 },
    )
    expect(bode[1].magnitudeDb).toBeCloseTo(-3.0103, 3)
    expect(bode[1].phaseDeg).toBeCloseTo(-45, 6)
  })

  it('gives an integrator a constant −20 dB/decade slope and −90° phase', () => {
    const bode = bodeResponse(
      { numerator: [1], denominator: [1, 0] },
      { fMinHz: 0.1, fMaxHz: 100, points: 4 },
    )
    const slope = (bode[2].magnitudeDb - bode[0].magnitudeDb) / 2
    expect(slope).toBeCloseTo(-20, 9)
    expect(bode[1].phaseDeg).toBeCloseTo(-90, 9)
  })

  it('measures the textbook margins of 1/(s(s+1))', () => {
    const margins = stabilityMargins(
      { numerator: [1], denominator: [1, 1, 0] },
      { fMinHz: 1e-3, fMaxHz: 1e3 },
    )
    expect(margins.phaseMarginDeg).toBeCloseTo(51.83, 0)
    expect(margins.gainMarginDb).toBe(Infinity)
    expect(margins.closedLoopStable).toBe(true)
    expect(margins.gainCrossoverHz).toBeCloseTo(Math.sqrt((Math.sqrt(5) - 1) / 2) / (2 * Math.PI), 3)
  })

  it('measures finite gain and phase margins of 2/(s+1)^3', () => {
    const margins = stabilityMargins(
      { numerator: [2], denominator: [1, 3, 3, 1] },
      { fMinHz: 1e-3, fMaxHz: 1e3 },
    )
    expect(margins.gainMarginDb).toBeCloseTo(12.041, 0)
    expect(margins.phaseMarginDeg).toBeCloseTo(67.6, 0)
    expect(margins.closedLoopStable).toBe(true)
  })

  it('keeps a type-2 loop on the −180° low-frequency branch, not +180°', () => {
    // 1/(s²(s+1)) starts two integrators deep: the asymptotic phase is −180° and
    // it only gets worse. atan2 returns the principal value, whose sign at the
    // wrap is numerically arbitrary, so the trace must be anchored by counting
    // the poles at the origin rather than trusting the first sample.
    const bode = bodeResponse(
      { numerator: [1], denominator: [1, 1, 0, 0] },
      { fMinHz: 0.01, fMaxHz: 10, points: 4 },
    )
    const firstOmega = 2 * Math.PI * 0.01
    expect(bode[0].phaseDeg).toBeCloseTo(-180 - (Math.atan(firstOmega) * 180) / Math.PI, 9)
    expect(bode[0].phaseDeg).toBeLessThan(-180)
    expect(bode[3].phaseDeg).toBeLessThan(bode[0].phaseDeg)
  })

  it('reports the true −41° phase margin of the unstable 1/(s²(s+1)) loop', () => {
    // |L| = 1 where ω²·√(1+ω²) = 1, i.e. ω² is the real root of x³+x²−1 = 0, so
    // ω = 0.868837 rad/s, and ∠L = −180° − atan(ω) makes PM = −atan(ω) = −41.0°.
    // Routh on s³+s²+1 (first column 1, 1, 0, 1) says the closed loop is unstable,
    // which is the same verdict; a branch offset would have reported +319°.
    const omegaCrossover = Math.sqrt(0.7548776662)
    const margins = stabilityMargins(
      { numerator: [1], denominator: [1, 1, 0, 0] },
      { fMinHz: 1e-3, fMaxHz: 1e2 },
    )
    expect(margins.phaseMarginDeg).toBeCloseTo(-(Math.atan(omegaCrossover) * 180) / Math.PI, 1)
    expect(margins.gainCrossoverHz).toBeCloseTo(omegaCrossover / (2 * Math.PI), 4)
    expect(margins.closedLoopStable).toBe(false)
  })

  it('reports a negative margin when the closed loop is unstable', () => {
    // 10/(s+1)^3 has 20 dB of gain at the −180° crossover, so GM = −2 dB.
    const margins = stabilityMargins(
      { numerator: [10], denominator: [1, 3, 3, 1] },
      { fMinHz: 1e-3, fMaxHz: 1e3 },
    )
    expect(margins.gainMarginDb).toBeCloseTo(-1.94, 1)
    expect(margins.closedLoopStable).toBe(false)
  })

  it('rejects invalid frequency ranges', () => {
    expect(() => bodeResponse({ numerator: [1], denominator: [1, 1] }, { fMinHz: 0, fMaxHz: 1 })).toThrow(/start frequency/)
    expect(() => bodeResponse({ numerator: [1], denominator: [1, 1] }, { fMinHz: 10, fMaxHz: 1 })).toThrow(/end frequency/)
    expect(() => bodeResponse({ numerator: [1], denominator: [1, 1] }, { fMinHz: 1, fMaxHz: 10, points: 1 })).toThrow(/point count/)
  })
})
