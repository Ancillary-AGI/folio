import { describe, expect, it } from 'vitest'
import {
  ALUMINIUM_6061_T6,
  S275_STEEL,
  evaluateBeam,
  sizeCoupledBeam,
  validateBeamRequest,
  type BeamRequest,
} from './coupledBeam'

const request = (overrides: Partial<BeamRequest> = {}): BeamRequest => ({
  loadN: 500,
  spanM: 1,
  temperatureChangeK: 0,
  maxDeflectionM: 0.005,
  width: { min: 0.01, max: 0.1 },
  depth: { min: 0.01, max: 0.15 },
  material: S275_STEEL,
  populationSize: 20,
  iterations: 40,
  ...overrides,
})

describe('evaluateBeam', () => {
  it('matches the closed-form bending stress for a central point load', () => {
    /* M = PL/4, σ = M(h/2)/I with I = bh³/12, which reduces to 1.5PL/(bh²). */
    const input = request({ loadN: 1000, spanM: 2, temperatureChangeK: 0 })
    const width = 0.05
    const depth = 0.1
    const solved = evaluateBeam(input, width, depth)

    const expected = (1.5 * input.loadN * input.spanM) / (width * depth ** 2)
    expect(solved.bendingStressPa).toBeCloseTo(expected, 6)
  })

  it('matches the closed-form deflection for a central point load', () => {
    const input = request({ loadN: 1000, spanM: 2, temperatureChangeK: 0 })
    const width = 0.05
    const depth = 0.1
    const solved = evaluateBeam(input, width, depth)
    const inertia = (width * depth ** 3) / 12
    const expected = (input.loadN * input.spanM ** 3) / (48 * input.material.youngsModulusPa * inertia)
    expect(solved.deflectionM).toBeCloseTo(expected, 12)
  })

  it('adds a thermal stress independent of the section', () => {
    /* σ_th = E·α·ΔT, with no term for length or area: a fully constrained member
     * carries the same axial stress however long or thick it is. */
    const hot = request({ temperatureChangeK: 50 })
    const solved = evaluateBeam(hot, 0.05, 0.1)
    const expected = hot.material.youngsModulusPa * hot.material.thermalExpansionPerK * 50
    expect(solved.thermalStressPa).toBeCloseTo(expected, 1)

    // Same temperature, different section: the thermal part is unchanged.
    const fatter = evaluateBeam(hot, 0.2, 0.2)
    expect(fatter.thermalStressPa).toBeCloseTo(solved.thermalStressPa, 1)
    // The bending part falls with the bigger section.
    expect(fatter.bendingStressPa).toBeLessThan(solved.bendingStressPa)
  })

  it('reports a total stress that is the sum of the two parts', () => {
    const solved = evaluateBeam(request({ temperatureChangeK: 30 }), 0.05, 0.1)
    expect(solved.totalStressPa).toBeCloseTo(
      solved.bendingStressPa + solved.thermalStressPa,
      6,
    )
  })

  it('mass scales with the section', () => {
    const thin = evaluateBeam(request(), 0.02, 0.02)
    const thick = evaluateBeam(request(), 0.08, 0.08)
    expect(thick.massKg).toBeGreaterThan(thin.massKg)
    expect(thick.secondMomentM4).toBeGreaterThan(thin.secondMomentM4)
  })

  it('an aluminium beam carries less thermal stress than steel for the same ΔT', () => {
    /* E·α for aluminium is 69e9 × 23.6e-6 ≈ 1.63 MPa/K; for steel it is
     * 210e9 × 12e-6 = 2.52 MPa/K. Aluminium expands about twice as much but its
     * modulus is a third, so the product is lower. */
    const hot = { temperatureChangeK: 40 }
    const steel = evaluateBeam(request({ material: S275_STEEL, ...hot }), 0.05, 0.1)
    const alloy = evaluateBeam(request({ material: ALUMINIUM_6061_T6, ...hot }), 0.05, 0.1)
    expect(alloy.thermalStressPa).toBeLessThan(steel.thermalStressPa)
    expect(alloy.thermalStressPa).toBeGreaterThan(0)
  })
})

describe('validateBeamRequest', () => {
  it('rejects non-positive and non-finite input', () => {
    expect(() => validateBeamRequest(request({ loadN: 0 }))).toThrow(/Load/)
    expect(() => validateBeamRequest(request({ spanM: -1 }))).toThrow(/Span/)
    expect(() => validateBeamRequest(request({ maxDeflectionM: 0 }))).toThrow(/Deflection/)
    expect(() => validateBeamRequest(request({ width: { min: 0.1, max: 0.01 } }))).toThrow(/Width/)
    expect(() =>
      validateBeamRequest(request({ temperatureChangeK: Number.NaN })),
    ).toThrow(/Temperature/)
  })
})

describe('sizeCoupledBeam', () => {
  it('finds a feasible section that satisfies both limits', async () => {
    const result = await sizeCoupledBeam(request())
    expect(result.feasible).toBe(true)
    expect(result.stressUtilisation).toBeLessThanOrEqual(1)
    expect(result.deflectionUtilisation).toBeLessThanOrEqual(1)
    expect(result.massKg).toBeGreaterThan(0)
  })

  it('a hotter environment demands a heavier or equal beam', async () => {
    /* The coupling: the load is unchanged, but the thermal stress eats into the
     * allowable, so the section must grow. */
    const cool = await sizeCoupledBeam(request({ temperatureChangeK: 0 }))
    const hot = await sizeCoupledBeam(request({ temperatureChangeK: 40 }))
    expect(hot.massKg).toBeGreaterThanOrEqual(cool.massKg - 1e-9)
    expect(hot.thermalStressPa).toBeGreaterThan(0)
  })

  it('a heavier load demands a heavier or equal beam', async () => {
    const light = await sizeCoupledBeam(request({ loadN: 100 }))
    const heavy = await sizeCoupledBeam(request({ loadN: 2000 }))
    expect(heavy.massKg).toBeGreaterThanOrEqual(light.massKg - 1e-9)
  })

  it('a tighter deflection limit demands a heavier or equal beam', async () => {
    const loose = await sizeCoupledBeam(request({ maxDeflectionM: 0.02 }))
    const tight = await sizeCoupledBeam(request({ maxDeflectionM: 0.0005 }))
    expect(tight.massKg).toBeGreaterThanOrEqual(loose.massKg - 1e-9)
  })

  it('is deterministic for a given seed', async () => {
    const first = await sizeCoupledBeam(request())
    const second = await sizeCoupledBeam(request())
    expect(second.point).toEqual(first.point)
    expect(second.massKg).toBeCloseTo(first.massKg, 12)
  })

  it('refuses an impossible load rather than returning an unsafe beam', async () => {
    // Even the largest allowed section cannot hold this load.
    const result = await sizeCoupledBeam(request({ loadN: 500_000 }))
    expect(result.feasible).toBe(false)
    expect(result.totalStressPa).toBeGreaterThan(request().material.allowableStressPa)
  })
})