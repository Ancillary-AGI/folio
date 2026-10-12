import { describe, expect, it } from 'vitest'
import { analyzeSignalPath, type SignalPath } from './signalIntegrity'

const base: SignalPath = {
  geometry: { kind: 'microstrip', widthMm: 0.2, heightMm: 0.15, epsilonR: 4.3 },
  lengthMm: 50,
  driverImpedanceOhm: 10,
  loadImpedanceOhm: 1000,
  vHigh: 3.3,
}

describe('analyzeSignalPath', () => {
  it('computes a realistic 50Ω-class microstrip Z0', () => {
    const result = analyzeSignalPath(base)
    expect(result.success).toBe(true)
    // 0.2mm over 0.15mm FR-4 sits in the tens-of-ohms range.
    expect(result.z0Ohm).toBeGreaterThan(30)
    expect(result.z0Ohm).toBeLessThan(120)
  })

  it('matched line (Z0 = ZL) has zero reflection and no overshoot', () => {
    // Tune the load so it equals the computed Z0 — Γ must vanish. Use a
    // low-impedance driver so the only transition is the matched line.
    const z0 = analyzeSignalPath(base).z0Ohm
    const matched = analyzeSignalPath({ ...base, loadImpedanceOhm: z0, driverImpedanceOhm: 0.001 })
    expect(matched.gammaLoad).toBeCloseTo(0, 9)
    expect(matched.overshootVolts).toBeCloseTo(0, 9)
    expect(matched.peakVolts).toBeCloseTo(base.vHigh, 3)
  })

  it('reflection coefficient matches (ZL − Z0)/(ZL + Z0) exactly', () => {
    const result = analyzeSignalPath(base)
    const expected = (base.loadImpedanceOhm - result.z0Ohm) / (base.loadImpedanceOhm + result.z0Ohm)
    expect(result.gammaLoad).toBeCloseTo(expected, 12)
  })

  it('high-impedance load overshoots toward 2·vHigh (open-line ring)', () => {
    // Open line (ZL → ∞): Γ → 1, the reflected wave doubles the edge.
    const open = analyzeSignalPath({ ...base, loadImpedanceOhm: 1e6 })
    expect(open.gammaLoad).toBeCloseTo(1, 3)
    expect(open.peakVolts).toBeGreaterThan(base.vHigh)
    expect(open.peakVolts).toBeLessThanOrEqual(2 * base.vHigh + 1e-6)
    expect(open.overshootVolts).toBeGreaterThan(0)
  })

  it('settled level is the resistive divider at the load', () => {
    const result = analyzeSignalPath(base)
    const expected = (base.vHigh * base.loadImpedanceOhm) / (base.driverImpedanceOhm + base.loadImpedanceOhm)
    expect(result.settledVolts).toBeCloseTo(expected, 9)
  })

  it('resistive loss damps the ringing to less than the lossless peak', () => {
    const lossless = analyzeSignalPath(base)
    const lossy = analyzeSignalPath({ ...base, resistancePerMm: 0.5 })
    expect(lossy.peakVolts).toBeLessThanOrEqual(lossless.peakVolts + 1e-9)
  })

  it('propagation delay scales linearly with length', () => {
    const short = analyzeSignalPath({ ...base, lengthMm: 25 })
    const long = analyzeSignalPath({ ...base, lengthMm: 100 })
    expect(long.delayNs).toBeCloseTo(short.delayNs * 4, 3)
  })

  it('stripline is slower than microstrip for the same length (higher εeff)', () => {
    const micro = analyzeSignalPath(base)
    const strip = analyzeSignalPath({
      ...base,
      geometry: { kind: 'stripline', widthMm: 0.2, heightMm: 0.15, epsilonR: 4.3, thicknessMm: 0.3 },
    })
    expect(strip.delayNs).toBeGreaterThan(micro.delayNs)
  })

  it('fails loud on a non-positive length', () => {
    const bad = analyzeSignalPath({ ...base, lengthMm: 0 })
    expect(bad.success).toBe(false)
    expect(bad.error).toMatch(/length/i)
  })
})
