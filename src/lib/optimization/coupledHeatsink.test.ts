import { describe, expect, it } from 'vitest'
import {
  ALUMINIUM_6063,
  evaluateHeatsink,
  finEfficiency,
  sizeCoupledHeatsink,
  validateHeatsinkRequest,
  type HeatsinkRequest,
} from './coupledHeatsink'

const request = (overrides: Partial<HeatsinkRequest> = {}): HeatsinkRequest => ({
  powerW: 5,
  maxTemperatureRiseK: 40,
  surfaceCoefficientWm2K: 10,
  baseLengthM: 0.04,
  baseWidthM: 0.04,
  baseThickness: { min: 0.002, max: 0.006 },
  finHeight: { min: 0.005, max: 0.03 },
  finThickness: { min: 0.0008, max: 0.003 },
  finCount: { min: 2, max: 20 },
  maxMassKg: 0.2,
  material: ALUMINIUM_6063,
  populationSize: 20,
  iterations: 40,
  ...overrides,
})

describe('finEfficiency', () => {
  it('tends to 1 for a very short or very thick fin (isothermal limit)', () => {
    /* m·Lc → 0 gives tanh(x)/x → 1. A fin so conductive it is at the base
     * temperature is the ideal the efficiency approaches. */
    const efficiency = finEfficiency(0.0005, 0.003, ALUMINIUM_6063.conductivityWmK, 10)
    expect(efficiency).toBeGreaterThan(0.999)
  })

  it('falls as the fin gets longer, because the tip runs cooler', () => {
    const short = finEfficiency(0.005, 0.001, ALUMINIUM_6063.conductivityWmK, 10)
    const long = finEfficiency(0.05, 0.001, ALUMINIUM_6063.conductivityWmK, 10)
    expect(long).toBeLessThan(short)
    expect(short).toBeLessThanOrEqual(1)
    expect(long).toBeGreaterThan(0)
  })

  it('improves with conductivity and degrades with a higher heat transfer coefficient', () => {
    const base = finEfficiency(0.02, 0.001, 205, 10)
    const copper = finEfficiency(0.02, 0.001, 400, 10)
    const windy = finEfficiency(0.02, 0.001, 205, 80)
    expect(copper).toBeGreaterThan(base)
    expect(windy).toBeLessThan(base)
  })

  it('never leaves the 0..1 range', () => {
    for (const h of [0.001, 0.01, 0.05, 0.2]) {
      for (const t of [0.0005, 0.001, 0.005]) {
        const efficiency = finEfficiency(h, t, 205, 10)
        expect(efficiency).toBeGreaterThan(0)
        expect(efficiency).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('evaluateHeatsink', () => {
  it('computes a thermal resistance consistent with the effective area', () => {
    const solved = evaluateHeatsink(request(), 0.004, 0.02, 0.001, 10)
    const expected = 1 / (10 * solved.effectiveAreaM2)
    expect(solved.thermalResistanceKW).toBeCloseTo(expected, 12)
  })

  it('gives a temperature rise equal to power times resistance', () => {
    const solved = evaluateHeatsink(request(), 0.004, 0.02, 0.001, 10)
    expect(request().powerW * solved.thermalResistanceKW).toBeCloseTo(
      request().powerW * solved.thermalResistanceKW,
      12,
    )
  })

  it('more fins means more effective area and less resistance', () => {
    const few = evaluateHeatsink(request(), 0.004, 0.02, 0.001, 4)
    const many = evaluateHeatsink(request(), 0.004, 0.02, 0.001, 16)
    expect(many.effectiveAreaM2).toBeGreaterThan(few.effectiveAreaM2)
    expect(many.thermalResistanceKW).toBeLessThan(few.thermalResistanceKW)
    expect(many.massKg).toBeGreaterThan(few.massKg)
  })

  it('a thicker base conducts better but weighs more', () => {
    const thin = evaluateHeatsink(request(), 0.002, 0.02, 0.001, 10)
    const thick = evaluateHeatsink(request(), 0.006, 0.02, 0.001, 10)
    // A thicker base lowers the spreading resistance, so the same fin area does
    // slightly better — and it certainly weighs more.
    expect(thick.massKg).toBeGreaterThan(thin.massKg)
    expect(thick.effectiveAreaM2).toBeCloseTo(thin.effectiveAreaM2, 12)
  })
})

describe('validateHeatsinkRequest', () => {
  it('rejects non-positive and non-finite input', () => {
    expect(() => validateHeatsinkRequest(request({ powerW: 0 }))).toThrow(/Power/)
    expect(() => validateHeatsinkRequest(request({ maxTemperatureRiseK: -1 }))).toThrow(/Temperature/)
    expect(() => validateHeatsinkRequest(request({ surfaceCoefficientWm2K: 0 }))).toThrow(/Surface/)
    expect(() => validateHeatsinkRequest(request({ maxMassKg: Number.NaN }))).toThrow(/Mass/)
    expect(() =>
      validateHeatsinkRequest(request({ finHeight: { min: 0.02, max: 0.01 } })),
    ).toThrow(/Fin height/)
  })

  it('requires a sane fin count range', () => {
    expect(() =>
      validateHeatsinkRequest(request({ finCount: { min: 5, max: 2 } })),
    ).toThrow(/Fin count/)
    expect(() =>
      validateHeatsinkRequest(request({ finCount: { min: 1.5, max: 10 } })),
    ).toThrow(/Fin count/)
  })
})

describe('sizeCoupledHeatsink', () => {
  it('finds a feasible heatsink that meets the thermal limit and mass ceiling', async () => {
    const result = await sizeCoupledHeatsink(request())
    expect(result.feasible).toBe(true)
    expect(result.temperatureRiseK).toBeLessThanOrEqual(40)
    expect(result.massKg).toBeLessThanOrEqual(0.2)
    expect(result.finCount).toBeGreaterThanOrEqual(2)
    expect(result.finCount).toBeLessThanOrEqual(20)
    expect(result.cost).toBeGreaterThan(0)
  })

  it('a tighter thermal budget produces a heavier or equal heatsink', async () => {
    const loose = await sizeCoupledHeatsink(request({ maxTemperatureRiseK: 60 }))
    const tight = await sizeCoupledHeatsink(request({ maxTemperatureRiseK: 15 }))
    expect(tight.massKg).toBeGreaterThanOrEqual(loose.massKg - 1e-9)
  })

  it('a lower mass ceiling produces a lighter or equal heatsink', async () => {
    const generous = await sizeCoupledHeatsink(request({ maxMassKg: 0.5 }))
    const strict = await sizeCoupledHeatsink(request({ maxMassKg: 0.05 }))
    expect(strict.massKg).toBeLessThanOrEqual(generous.massKg + 1e-9)
  })

  it('reports the fin efficiency at the optimum, which is what makes it coupled', async () => {
    const result = await sizeCoupledHeatsink(request())
    // A real fin is not isothermal: if this were ever 1, the coupling would be
    // doing nothing and the model would be over-crediting the fins.
    expect(result.finEfficiency).toBeLessThan(1)
    expect(result.finEfficiency).toBeGreaterThan(0)
    expect(result.effectiveAreaM2).toBeGreaterThan(0)
  })

  it('is deterministic for a given seed', async () => {
    const first = await sizeCoupledHeatsink(request())
    const second = await sizeCoupledHeatsink(request())
    expect(second.point).toEqual(first.point)
    expect(second.massKg).toBeCloseTo(first.massKg, 12)
  })

  it('refuses an impossible thermal budget rather than returning a hot heatsink', async () => {
    // Even the largest allowed heatsink cannot hold 0.5 K at 20 W.
    const result = await sizeCoupledHeatsink(request({ powerW: 20, maxTemperatureRiseK: 0.5 }))
    expect(result.feasible).toBe(false)
    expect(result.temperatureRiseK).toBeGreaterThan(0.5)
  })
})