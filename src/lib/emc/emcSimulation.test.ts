import { describe, expect, it } from 'vitest'
import { EMCSimulationEngine, emcSimulationEngine, type EMCTrace } from './emcSimulation'

const trace = (overrides: Partial<EMCTrace> = {}): EMCTrace => ({
  id: 'CLK',
  lengthMm: 50,
  currentA: 0.1,
  frequencyHz: 1e7,
  loopAreaMm2: 10,
  ...overrides,
})

describe('EMC closed-form fields', () => {
  it('matches the small-loop far field at 3 m', () => {
    /* E = η₀·π·I·A·f²/(c²·r) with η₀ = 120π, r = 3 m. */
    const current = 1
    const area = 1e-4 // 100 mm²
    const frequency = 1e8
    const expected = (120 * Math.PI * Math.PI * current * area * frequency * frequency) / (3e8 * 3e8 * 3)

    expect(EMCSimulationEngine.loopFieldVPerM(current, area, frequency)).toBeCloseTo(expected, 15)
    // 1 A around 100 mm² at 100 MHz: about 73 dBµV/m at 3 m.
    expect(20 * Math.log10(expected / 1e-6)).toBeCloseTo(72.8, 0)
  })

  it('matches the short-dipole cable field at 3 m', () => {
    /* E = 60π·I·L·f/(c·r) with r = 3 m. */
    const expected = (60 * Math.PI * 1 * 1 * 1e6) / (3e8 * 3)
    expect(EMCSimulationEngine.cableFieldVPerM(1, 1, 1e6)).toBeCloseTo(expected, 15)
  })

  it('uses the CISPR 32 Class B band limits', () => {
    expect(EMCSimulationEngine.radiatedLimit(100e6, 'CISPR32')).toBe(40)
    expect(EMCSimulationEngine.radiatedLimit(300e6, 'CISPR32')).toBe(47)
    expect(EMCSimulationEngine.radiatedLimit(100e6, 'FCC15')).toBe(43.5)
    expect(EMCSimulationEngine.radiatedLimit(300e6, 'FCC15')).toBe(46)
  })
})

describe('EMCSimulationEngine.simulate', () => {
  it('is finite, monotonic in current, and reports its input basis', () => {
    const low = emcSimulationEngine.simulate([trace({ currentA: 0.1 })])
    const high = emcSimulationEngine.simulate([trace({ currentA: 0.2 })])

    expect(Number.isFinite(low.radiatedDBuVPerM)).toBe(true)
    expect(Number.isFinite(low.conductedDBuV)).toBe(true)
    expect(Number.isFinite(low.marginDb)).toBe(true)
    expect(low.basis).toEqual({
      traceCount: 1,
      worstFrequencyHz: 1e7,
      worstCurrentA: 0.1,
      worstCommonModeCurrentA: 0.001,
    })

    // Doubling every current adds 20·log10(2) ≈ 6.02 dB to both mechanisms.
    expect(high.radiatedDBuVPerM - low.radiatedDBuVPerM).toBeCloseTo(20 * Math.log10(2), 2)
    expect(high.hotspots[0].contribution - low.hotspots[0].contribution).toBeCloseTo(20 * Math.log10(2), 2)
  })

  it('reports zero common-mode emission when no cable is attached', () => {
    const result = emcSimulationEngine.simulate([
      trace({ commonModeCurrentA: 0, cableLengthMm: 0 }),
    ])

    // The dB conversion floors at 1e-12 V/m, so zero field reads as -120 dBµV/m.
    expect(result.hotspots[0].commonModeDBuVPerM).toBeCloseTo(-120, 6)
    expect(result.basis.worstCommonModeCurrentA).toBe(0)
    expect(result.compliant).toBe(true)
  })

  it('sorts hotspots by descending contribution', () => {
    const result = emcSimulationEngine.simulate([
      trace({ id: 'quiet', currentA: 0.01 }),
      trace({ id: 'loud', currentA: 0.5 }),
    ])

    expect(result.hotspots.map((hotspot) => hotspot.traceId)).toEqual(['loud', 'quiet'])
  })

  it('rejects empty input rather than returning a vacuous pass', () => {
    expect(() => emcSimulationEngine.simulate([])).toThrow(/at least one trace/)
  })

  it.each([
    ['NaN current', { currentA: Number.NaN }],
    ['negative current', { currentA: -0.1 }],
    ['zero frequency', { frequencyHz: 0 }],
    ['negative loop area', { loopAreaMm2: -1 }],
    ['zero length', { lengthMm: 0 }],
    ['infinite cable length', { cableLengthMm: Number.POSITIVE_INFINITY }],
  ])('rejects %s with a clear input error', (_label, overrides) => {
    expect(() => emcSimulationEngine.simulate([trace(overrides)])).toThrow(/rejected invalid trace input/)
  })
})
