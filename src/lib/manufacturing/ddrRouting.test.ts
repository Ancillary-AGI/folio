/**
 * DDR routing proofs (Pi-class leg 7).
 */
import { describe, expect, it } from 'vitest'
import { checkDqsGroup, checkFlyby, DDR3_1600 } from './ddrRouting'

describe('DDR routing', () => {
  it('passes a matched DQS group', () => {
    const { skewPs, violations } = checkDqsGroup({ name: 'DQS0', strobeLength: 40, dqLengths: [40.2, 39.8, 40.1, 40, 39.9, 40.3, 40, 39.8], windowMm: DDR3_1600.dqWindowMm })
    expect(violations).toEqual([])
    expect(skewPs[0]).toBeCloseTo(1.2, 9)
  })

  it('fails a bit outside the window with its index', () => {
    const { violations } = checkDqsGroup({ name: 'DQS1', strobeLength: 40, dqLengths: [40, 41.5, 40, 40, 40, 40, 40, 40], windowMm: DDR3_1600.dqWindowMm })
    expect(violations).toHaveLength(1)
    expect(violations[0].bit).toBe(1)
    expect(violations[0].mismatchMm).toBeCloseTo(1.5, 9)
  })

  it('passes fly-by inside the window and fails a straggler', () => {
    expect(checkFlyby({ clockLength: 50, addrLengths: [50.5, 49.6, 50.2], windowMm: DDR3_1600.flybyWindowMm })).toEqual([])
    expect(checkFlyby({ clockLength: 50, addrLengths: [50.2, 53, 50.1], windowMm: DDR3_1600.flybyWindowMm })).toHaveLength(1)
  })
})
