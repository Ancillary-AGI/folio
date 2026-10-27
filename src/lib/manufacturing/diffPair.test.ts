/**
 * Differential-pair proofs (Pi-class leg 2).
 *
 * USB2 numbers throughout: the pair rides on ε_eff 3.24 laminate, so 1 mm of
 * mismatch is ≈ 6 ps against a 150 ps budget, and a meander lobe of 1 mm
 * amplitude kills 2 mm of skew. Coupling is measured from polylines, so the
 * geometry tests say what the copper actually does rather than trusting a
 * typed-in gap.
 */
import { describe, expect, it } from 'vitest'
import {
  checkGroup,
  checkPair,
  measureCoupling,
  meanderForSkew,
  USB2_HS,
  type RoutedPair,
  type RoutedTrace,
} from './diffPair'

/** ε_eff that reproduces the usual 6 ps/mm on FR-4. */
const ER_EFF = 3.24

const usb = (overrides: Partial<RoutedPair> = {}): RoutedPair => ({
  name: 'USB_DP_DM',
  netP: 'USB_DP',
  netN: 'USB_DM',
  targetZ: USB2_HS.targetZ,
  skewBudgetPs: USB2_HS.skewBudgetPs,
  lengthP: 50,
  lengthN: 50,
  gap: 0.15,
  coupledLength: 45,
  erEff: ER_EFF,
  ...overrides,
})

const run = (x0: number, y: number, length: number, widthMm = 0.2): RoutedTrace => ({
  points: [
    { x: x0, y },
    { x: x0 + length, y },
  ],
  widthMm,
})

describe('differential pairs', () => {
  it('passes a matched USB pair with zero skew', () => {
    const { skewPs, violations } = checkPair(usb())
    expect(skewPs).toBe(0)
    expect(violations).toEqual([])
  })

  it('fails a 30 mm mismatch against the 150 ps budget', () => {
    // 30 mm × 6.004 ps/mm ≈ 180 ps > 150 ps.
    const { skewPs, violations } = checkPair(usb({ lengthP: 65, lengthN: 35 }))
    expect(skewPs).toBeCloseTo(180.12, 2)
    expect(violations.some((v) => v.rule === 'intra-skew')).toBe(true)
  })

  it('reads more skew for the same mismatch on a slower laminate', () => {
    const mismatch = usb({ lengthP: 55, lengthN: 45 })
    const fast = checkPair(mismatch).skewPs
    const slow = checkPair({ ...mismatch, erEff: 4.4 }).skewPs
    expect(slow).toBeGreaterThan(fast)
  })

  it('fails loose coupling below 70 %', () => {
    expect(checkPair(usb({ coupledLength: 20 })).violations.some((v) => v.rule === 'coupling')).toBe(true)
  })

  it('fails a non-positive gap', () => {
    expect(checkPair(usb({ gap: 0 })).violations.some((v) => v.rule === 'gap')).toBe(true)
  })

  it('passes a group inside the window and fails a straggler', () => {
    const a = usb({ name: 'DQ0' })
    const b = usb({ name: 'DQ1', lengthP: 51, lengthN: 51 })
    expect(checkGroup([a, b], 2)).toEqual([])
    const straggler = usb({ name: 'DQ2', lengthP: 60, lengthN: 60 })
    const violations = checkGroup([a, b, straggler], 2)
    expect(violations.some((v) => v.pair === 'DQ0' || v.pair === 'DQ1')).toBe(true)
    expect(violations.some((v) => v.pair === 'DQ2')).toBe(false)
  })

  it('sizes a meander that covers the skew within one lobe', () => {
    const meander = meanderForSkew(5, 1, 3)
    expect(meander.lobeLength).toBe(2)
    expect(meander.lobes).toBe(3)
    expect(meander.total).toBeGreaterThanOrEqual(5)
    expect(meander.total - 5).toBeLessThan(meander.lobeLength)
    expect(meanderForSkew(0, 1, 3).lobes).toBe(0)
  })

  it('reports the room a meander needs, not only the length it adds', () => {
    const meander = meanderForSkew(5, 1, 3)
    // Three lobes at 3 mm pitch eat 9 mm of straight run and 1 mm to the side.
    expect(meander.runMm).toBe(9)
    expect(meander.keepoutMm).toBe(1)
    expect(meanderForSkew(0, 1, 3).runMm).toBe(0)
  })

  it('measures the gap and parallel length of two routed runs', () => {
    // 0.2 mm wide traces 0.35 mm apart, centre-to-centre → 0.15 mm edge gap.
    const measurement = measureCoupling([run(0, 0, 10)], [run(0, 0.35, 10)], 0.2)
    expect(measurement.minGapMm).toBeCloseTo(0.15, 9)
    expect(measurement.coupledLengthMm).toBeCloseTo(10, 9)
    expect(measurement.longerLegMm).toBeCloseTo(10, 9)
    expect(measurement.parallelRatio).toBeCloseTo(1, 9)
  })

  it('counts only the part of a run that stays parallel', () => {
    const p = { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 6 }], widthMm: 0.2 }
    const n = run(0, 0.3, 10)
    const measurement = measureCoupling([p], [n], 0.2)
    // The straight 10 mm ride together; the diverging leg stops being coupled
    // about 0.5 mm in, so a whole-segment "nearest approach" would lie. The
    // leg crosses in front of the N run's end and comes closer there (0.257 mm
    // centre-to-centre) than the parallel section does (0.3 mm).
    expect(measurement.minGapMm).toBeCloseTo(0.0572, 3)
    expect(measurement.coupledLengthMm).toBeGreaterThan(10.2)
    expect(measurement.coupledLengthMm).toBeLessThan(10.8)
    expect(measurement.longerLegMm).toBeCloseTo(10 + Math.hypot(10, 6), 6)
    expect(measurement.parallelRatio).toBeLessThan(0.55)
  })

  it('reads a negative gap when the copper overlaps', () => {
    const measurement = measureCoupling([run(0, 0, 10)], [run(0, 0.1, 10)], 0.2)
    expect(measurement.minGapMm).toBeLessThan(0)
  })

  it('rejects coupling measurement without a declared threshold or real copper', () => {
    expect(() => measureCoupling([run(0, 0, 10)], [run(0, 0.3, 10)], 0)).toThrow(/gap threshold/)
    expect(() => measureCoupling([run(0, 0, 10)], [], 0.2)).toThrow(/N side/)
    expect(() => measureCoupling([{ points: [{ x: 0, y: 0 }], widthMm: 0.2 }], [run(0, 0, 1)], 0.2)).toThrow(/P side/)
    expect(() => measureCoupling([run(0, 0, 10, 0)], [run(0, 0.3, 10)], 0.2)).toThrow(/width/)
  })

  it('rejects a degenerate meander geometry instead of returning Infinity', () => {
    expect(() => meanderForSkew(5, 0, 3)).toThrow(/amplitude/)
    expect(() => meanderForSkew(5, -1, 3)).toThrow(/amplitude/)
    expect(() => meanderForSkew(5, Number.NaN, 3)).toThrow(/amplitude/)
    expect(() => meanderForSkew(5, 1, 0)).toThrow(/period/)
    expect(() => meanderForSkew(Number.NaN, 1, 3)).toThrow(/skew/)
  })

  it('rejects non-finite routed lengths instead of silently passing', () => {
    expect(() => checkPair(usb({ lengthP: Number.NaN }))).toThrow(/lengthP/)
    expect(() => checkPair(usb({ skewBudgetPs: Number.POSITIVE_INFINITY }))).toThrow(/skew budget/)
    expect(() => checkPair(usb({ erEff: Number.NaN }))).toThrow(/erEff/)
    expect(() => checkPair(usb({ erEff: 0.5 }))).toThrow(/erEff/)
    expect(() => checkGroup([usb({ lengthN: Number.NaN })], 2)).toThrow(/lengthN/)
    expect(() => checkGroup([usb(), usb()], Number.NaN)).toThrow(/match window/)
  })
})
