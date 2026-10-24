import { describe, expect, it } from 'vitest'
import { analyzeEyeDiagram, analyzeSignalPath, optimiseTraceWidth, type SignalPath } from './signalIntegrity'

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

  it('adds (1 + ΓL)·V⁺ from each returning wave, not 2·V⁺', () => {
    /*
     * Pick ΓL = +0.5 (ZL = 3·Z0) and Γs = −0.5 (Rs = Z0/3). The first wave
     * returning to the load is V⁺·ΓL·Γs = −0.25·V⁺ and contributes
     * −0.25·V⁺·(1 + 0.5) = −0.375·V⁺. The open-circuit simplification 2·V⁺
     * would contribute −0.5·V⁺ and report a different load voltage.
     */
    const z0 = analyzeSignalPath(base).z0Ohm
    const result = analyzeSignalPath({
      ...base,
      loadImpedanceOhm: 3 * z0,
      driverImpedanceOhm: z0 / 3,
      reflections: 1,
    })
    const launched = (base.vHigh * z0) / (z0 / 3 + z0)
    const afterFirstArrival = launched * (1 + 0.5)
    const expectedAfterRoundTrip = afterFirstArrival - 0.25 * launched * 1.5

    expect(result.gammaLoad).toBeCloseTo(0.5, 9)
    expect(result.gammaSource).toBeCloseTo(-0.5, 9)
    expect(result.ringing[1].volts).toBeCloseTo(expectedAfterRoundTrip, 9)
    expect(result.ringing[1].volts).not.toBeCloseTo(afterFirstArrival - 0.5 * launched, 9)
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

  it('applies the round-trip loss once per echo, not cumulatively', () => {
    /*
     * ΓL = Γs = 0.5 and a round-trip loss a. Echo k must be launched·0.25^k·a^k.
     * The old loop multiplied an ever-growing damp factor, producing a^(k(k+1)/2):
     * its second echo used a³ instead of a² and under-reported late ringing.
     */
    const z0 = analyzeSignalPath(base).z0Ohm
    const lengthMm = 50
    const resistancePerMm = 0.1
    const loss = Math.exp((-resistancePerMm * lengthMm) / z0)
    const result = analyzeSignalPath({
      ...base,
      lengthMm,
      resistancePerMm,
      loadImpedanceOhm: 3 * z0,
      driverImpedanceOhm: 3 * z0,
      reflections: 3,
    })
    const launched = (base.vHigh * z0) / (3 * z0 + z0)
    const firstEcho = launched * 0.25 * loss
    const secondEcho = firstEcho * 0.25 * loss

    expect(result.ringing[1].volts - result.ringing[0].volts).toBeCloseTo(firstEcho * 1.5, 12)
    expect(result.ringing[2].volts - result.ringing[1].volts).toBeCloseTo(secondEcho * 1.5, 12)
    expect(result.ringing[2].volts - result.ringing[1].volts).not.toBeCloseTo(
      launched * 0.25 ** 2 * loss ** 3 * 1.5,
      12,
    )
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

  it.each([
    ['non-positive permittivity', { ...base, geometry: { ...base.geometry, epsilonR: 0 } }],
    ['sub-vacuum permittivity', { ...base, geometry: { ...base.geometry, epsilonR: 0.5 } }],
    ['non-positive height', { ...base, geometry: { ...base.geometry, heightMm: 0 } }],
    ['negative resistance', { ...base, resistancePerMm: -1 }],
    ['negative reflections', { ...base, reflections: -1 }],
    ['fractional reflections', { ...base, reflections: 2.5 }],
    [
      'zero stripline spacing',
      { ...base, geometry: { kind: 'stripline', widthMm: 0.2, heightMm: 0.15, epsilonR: 4.3, thicknessMm: 0 } },
    ],
  ])('fails loud on %s instead of throwing', (_label, path) => {
    const bad = analyzeSignalPath(path as SignalPath)
    expect(bad.success).toBe(false)
    expect(bad.error).toBeTruthy()
  })
})

describe('analyzeEyeDiagram', () => {
  const z0 = analyzeSignalPath(base).z0Ohm
  const matched: SignalPath = { ...base, loadImpedanceOhm: z0, driverImpedanceOhm: z0 }

  it('produces the full matched-line level as eye height', () => {
    const eye = analyzeEyeDiagram(matched, { dataRateMbps: 100, riseTimeNs: 0.1 })
    expect(eye.success).toBe(true)
    // A matched line has ΓL = Γs = 0: the driver divider 3.3 V · Z0/(Rs + Z0).
    expect(eye.eyeHeightVolts).toBeCloseTo((base.vHigh * z0) / (z0 + z0), 6)
    expect(eye.maxLowVolts).toBeCloseTo(0, 6)
    expect([...eye.trajectories].map((trajectory) => trajectory.bit)).toContain(1)
    expect([...eye.trajectories].map((trajectory) => trajectory.bit)).toContain(0)
  })

  it('opens almost the whole UI on a matched line with a fast edge', () => {
    const eye = analyzeEyeDiagram(matched, { dataRateMbps: 100, riseTimeNs: 0.1 })
    // UI = 10 ns; the 10–90 % edge is 0.1 ns, so only the crossing consumes eye width.
    expect(eye.eyeWidthNs).toBeGreaterThan(9.5)
    expect(eye.eyeWidthNs).toBeLessThanOrEqual(10)
    expect(eye.eyeWidthUi).toBeCloseTo(eye.eyeWidthNs / 10, 12)
  })

  it('reduces eye width when the same edge occupies more of a shorter UI', () => {
    const slow = analyzeEyeDiagram(matched, { dataRateMbps: 100, riseTimeNs: 0.1 })
    const fast = analyzeEyeDiagram(matched, { dataRateMbps: 1000, riseTimeNs: 0.1 })
    expect(fast.eyeWidthNs).toBeLessThan(slow.eyeWidthNs)
    expect(fast.eyeHeightVolts).toBeCloseTo(slow.eyeHeightVolts, 6)
  })

  it('includes reflected overshoot in the trajectory instead of hiding it', () => {
    const open = analyzeEyeDiagram(
      { ...base, loadImpedanceOhm: 1e6 },
      { dataRateMbps: 400, riseTimeNs: 0.2 },
    )
    expect(open.success).toBe(true)
    const peak = Math.max(
      ...open.trajectories.flatMap((trajectory) => trajectory.points.map((point) => point.volts)),
    )
    expect(peak).toBeGreaterThan(base.vHigh)
    expect(open.notes.join(' ')).toMatch(/no crosstalk, jitter/i)
  })

  it('is deterministic for the same pattern and options', () => {
    const first = analyzeEyeDiagram(matched, { dataRateMbps: 250, riseTimeNs: 0.2 })
    const second = analyzeEyeDiagram(matched, { dataRateMbps: 250, riseTimeNs: 0.2 })
    expect(second.eyeHeightVolts).toBe(first.eyeHeightVolts)
    expect(second.trajectories).toEqual(first.trajectories)
  })

  it.each([
    ['zero data rate', { dataRateMbps: 0, riseTimeNs: 0.1 }, /data rate/i],
    ['negative rise time', { dataRateMbps: 100, riseTimeNs: -1 }, /rise time/i],
    ['too few samples', { dataRateMbps: 100, riseTimeNs: 0.1, samplesPerUi: 4 }, /samples per UI/i],
    ['edge longer than one UI', { dataRateMbps: 1000, riseTimeNs: 2 }, /edge is longer/i],
  ])('fails loud on %s', (_label, options, message) => {
    const eye = analyzeEyeDiagram(matched, options as Parameters<typeof analyzeEyeDiagram>[1])
    expect(eye.success).toBe(false)
    expect(eye.error).toMatch(message)
    expect(eye.trajectories).toEqual([])
  })
})

describe('optimiseTraceWidth', () => {
  it('finds a width whose recomputed impedance matches the 50Ω target', () => {
    const suggestion = optimiseTraceWidth(base, 50)
    expect(suggestion.achieved).toBe(true)
    expect(suggestion.widthMm).toBeGreaterThan(0.05)
    expect(suggestion.widthMm).toBeLessThan(1)
    expect(suggestion.z0Ohm).toBeCloseTo(50, 1)
  })

  it('reports the reachable range when the target is impossible', () => {
    const suggestion = optimiseTraceWidth(base, 5000)
    expect(suggestion.achieved).toBe(false)
    expect(suggestion.widthMm).toBe(base.geometry.widthMm)
    expect(suggestion.note).toMatch(/outside the reachable range/i)
  })

  it('rejects a non-physical target instead of returning a width', () => {
    const suggestion = optimiseTraceWidth(base, 0)
    expect(suggestion.achieved).toBe(false)
    expect(suggestion.note).toMatch(/positive target impedance/i)
  })

  it('reports invalid geometry instead of throwing from the optimiser', () => {
    const suggestion = optimiseTraceWidth({
      ...base,
      geometry: { ...base.geometry, epsilonR: 0.5 },
    })
    expect(suggestion.achieved).toBe(false)
    expect(suggestion.z0Ohm).toBeNaN()
    expect(suggestion.note).toMatch(/permittivity|\ber\b/i)
  })
})
