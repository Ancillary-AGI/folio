/**
 * Differential-pair proofs (Pi-class leg 2).
 *
 * USB2 numbers throughout: a 1 mm mismatch is 6 ps against a 150 ps
 * budget, and a meander lobe of 1 mm amplitude kills 2 mm of skew.
 */
import { describe, expect, it } from 'vitest'
import { checkGroup, checkPair, meanderForSkew, USB2_HS, type RoutedPair } from './diffPair'

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
  ...overrides,
})

describe('differential pairs', () => {
  it('passes a matched USB pair with zero skew', () => {
    const { skewPs, violations } = checkPair(usb())
    expect(skewPs).toBe(0)
    expect(violations).toEqual([])
  })

  it('fails a 30 mm mismatch against the 150 ps budget', () => {
    // 30 mm × 6 ps/mm = 180 ps > 150 ps.
    const { skewPs, violations } = checkPair(usb({ lengthP: 65, lengthN: 35 }))
    expect(skewPs).toBeCloseTo(180, 9)
    expect(violations.some((v) => v.rule === 'intra-skew')).toBe(true)
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
    expect(() => checkGroup([usb({ lengthN: Number.NaN })], 2)).toThrow(/lengthN/)
    expect(() => checkGroup([usb(), usb()], Number.NaN)).toThrow(/match window/)
  })
})
