import { describe, expect, it } from 'vitest'
import {
  assertPriceBreaks,
  bestUnitPrice,
  priceOffer,
  rankOffers,
  roundMoney,
  type PricedOffer,
} from './priceBreaks'

const offer = (overrides: Partial<PricedOffer> = {}): PricedOffer => ({
  partNumber: 'RC0603FR-0710KL',
  manufacturer: 'Yageo',
  distributor: 'Digi-Key',
  orderCode: '311-10KGRCT-ND',
  stock: 100_000,
  currency: 'USD',
  source: 'offline-catalog',
  asOf: '2025-01-15',
  priceBreaks: [
    { minQty: 1, unitPrice: 0.1 },
    { minQty: 10, unitPrice: 0.024 },
    { minQty: 100, unitPrice: 0.012 },
  ],
  ...overrides,
})

describe('assertPriceBreaks', () => {
  it('accepts an ascending schedule', () => {
    expect(() => assertPriceBreaks(offer().priceBreaks)).not.toThrow()
  })

  it('rejects an empty schedule', () => {
    expect(() => assertPriceBreaks([])).toThrow(/at least one break/)
  })

  it('rejects non-ascending quantities', () => {
    expect(() =>
      assertPriceBreaks([
        { minQty: 100, unitPrice: 0.01 },
        { minQty: 10, unitPrice: 0.02 },
      ]),
    ).toThrow(/ascending/)
  })

  it('rejects a schedule whose price rises with quantity', () => {
    // A transcription error, and it would silently pick the wrong break.
    expect(() =>
      assertPriceBreaks([
        { minQty: 1, unitPrice: 0.01 },
        { minQty: 100, unitPrice: 0.5 },
      ]),
    ).toThrow(/higher than the previous break/)
  })

  it('rejects a zero or negative quantity', () => {
    expect(() => assertPriceBreaks([{ minQty: 0, unitPrice: 0.1 }])).toThrow(/positive/)
    expect(() => assertPriceBreaks([{ minQty: -5, unitPrice: 0.1 }])).toThrow(/positive/)
  })
})

describe('priceOffer', () => {
  it('uses the break the quantity qualifies for', () => {
    // 50 pieces sits in the 10+ band, not the 1-piece band.
    const cost = priceOffer(offer(), 50)
    expect(cost.unitPrice).toBe(0.024)
    expect(cost.extended).toBeCloseTo(1.2, 10)
    expect(cost.total).toBeCloseTo(1.2, 10)
    expect(cost.appliedBreak?.minQty).toBe(10)
  })

  it('steps down at each break boundary', () => {
    expect(priceOffer(offer(), 1).unitPrice).toBe(0.1)
    expect(priceOffer(offer(), 9).unitPrice).toBe(0.1)
    expect(priceOffer(offer(), 10).unitPrice).toBe(0.024)
    expect(priceOffer(offer(), 99).unitPrice).toBe(0.024)
    expect(priceOffer(offer(), 100).unitPrice).toBe(0.012)
  })

  it('below the first break it uses the first break, not zero', () => {
    // A fractional or zero quantity is refused; the guard is the minimum of 1.
    expect(priceOffer(offer(), 1).unitPrice).toBe(0.1)
  })

  it('adds the per-line charge once, not per piece', () => {
    const withFee = offer({ lineCharge: 5 })
    const cost = priceOffer(withFee, 100)
    // 100 × 0.012 = 1.20, plus one 5.00 handling charge.
    expect(cost.extended).toBeCloseTo(1.2, 10)
    expect(cost.lineCharge).toBe(5)
    expect(cost.total).toBeCloseTo(6.2, 10)
  })

  it('a flat line charge can make a lower unit price the dearer offer', () => {
    /* The whole reason landed cost is computed: at qty 10 a 5.00 line charge
     * dwarfs a 0.005 unit-price difference. */
    const cheapUnitDearLine = offer({
      distributor: 'A',
      lineCharge: 5,
      priceBreaks: [{ minQty: 1, unitPrice: 0.1 }],
    })
    const dearUnitCheapLine = offer({
      distributor: 'B',
      lineCharge: 0,
      priceBreaks: [{ minQty: 1, unitPrice: 0.3 }],
    })
    const quantity = 10
    expect(priceOffer(cheapUnitDearLine, quantity).total).toBeCloseTo(6, 10)
    expect(priceOffer(dearUnitCheapLine, quantity).total).toBeCloseTo(3, 10)
    expect(rankOffers([cheapUnitDearLine, dearUnitCheapLine], quantity)[0]?.distributor).toBe('B')
  })

  it('refuses a fractional or non-positive quantity', () => {
    expect(() => priceOffer(offer(), 0)).toThrow(/positive/)
    expect(() => priceOffer(offer(), 2.5)).toThrow(/fractional/)
    expect(() => priceOffer(offer(), Number.NaN)).toThrow(/positive/)
  })

  it('refuses a malformed schedule rather than pricing against it', () => {
    const broken = offer({
      priceBreaks: [
        { minQty: 100, unitPrice: 0.01 },
        { minQty: 10, unitPrice: 0.02 },
      ],
    })
    expect(() => priceOffer(broken, 50)).toThrow(/ascending/)
  })
})

describe('bestUnitPrice', () => {
  it('returns the cheapest break, ignoring quantity', () => {
    expect(bestUnitPrice(offer())).toBe(0.012)
  })
})

describe('roundMoney', () => {
  it('rounds to cents without float drift', () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3)
    expect(roundMoney(1.005)).toBe(1.01)
  })
})

describe('rankOffers', () => {
  it('orders by landed cost at the given quantity', () => {
    const ranked = rankOffers(
      [
        offer({ distributor: 'Dear', priceBreaks: [{ minQty: 1, unitPrice: 0.5 }] }),
        offer({ distributor: 'Cheap', priceBreaks: [{ minQty: 1, unitPrice: 0.1 }] }),
      ],
      10,
    )
    expect(ranked.map((entry) => entry.distributor)).toEqual(['Cheap', 'Dear'])
  })

  it('breaks a cost tie on stock, then lead time', () => {
    const samePrice = [{ minQty: 1, unitPrice: 0.1 }]
    const ranked = rankOffers(
      [
        offer({ distributor: 'LowStock', stock: 5, priceBreaks: samePrice }),
        offer({ distributor: 'Plenty', stock: 5_000, priceBreaks: samePrice }),
        offer({ distributor: 'Slow', stock: 5_000, leadTimeDays: 90, priceBreaks: samePrice }),
      ],
      10,
    )
    // Plenty and Slow tie on stock; Slow loses on lead time; LowStock loses first.
    expect(ranked[0]?.distributor).toBe('Plenty')
    expect(ranked[1]?.distributor).toBe('Slow')
    expect(ranked[2]?.distributor).toBe('LowStock')
  })

  it('does not mutate the input', () => {
    const input = [
      offer({ distributor: 'B', priceBreaks: [{ minQty: 1, unitPrice: 0.2 }] }),
      offer({ distributor: 'A', priceBreaks: [{ minQty: 1, unitPrice: 0.1 }] }),
    ]
    rankOffers(input, 10)
    expect(input.map((entry) => entry.distributor)).toEqual(['B', 'A'])
  })
})