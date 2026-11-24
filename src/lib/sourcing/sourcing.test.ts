import { describe, expect, it } from 'vitest'
import { sourceBom, type SourcingLine } from './sourcing'
import type { PricedOffer } from './priceBreaks'
import { REFERENCE_CATALOG, referencePartNumbers, REFERENCE_CAPTURED_ON } from './catalog'
import { referenceProvider, resolveSourcing } from './provider'

const offer = (overrides: Partial<PricedOffer> = {}): PricedOffer => ({
  partNumber: 'PART-1',
  distributor: 'Digi-Key',
  stock: 10_000,
  currency: 'USD',
  source: 'offline-catalog',
  asOf: '2025-01-15',
  priceBreaks: [
    { minQty: 1, unitPrice: 1 },
    { minQty: 100, unitPrice: 0.5 },
  ],
  ...overrides,
})

const line = (overrides: Partial<SourcingLine> = {}): SourcingLine => ({
  reference: 'R1',
  partNumber: 'PART-1',
  quantity: 100,
  ...overrides,
})

describe('sourceBom — cost', () => {
  it('prices at the requested quantity, not the headline break', () => {
    const result = sourceBom({
      lines: [line({ quantity: 10 })],
      catalog: [offer()],
    })
    // 10 pieces sits in the 1+ band: 10 × 1.00, not the 100+ price of 0.50.
    expect(result.lines[0]?.chosen?.cost.unitPrice).toBe(1)
    expect(result.lines[0]?.chosen?.cost.extended).toBeCloseTo(10, 10)
  })

  it('picks the cheapest landed offer, including line charges', () => {
    const result = sourceBom({
      lines: [line({ quantity: 100 })],
      catalog: [
        offer({
          distributor: 'WithFee',
          lineCharge: 20,
          priceBreaks: [{ minQty: 1, unitPrice: 0.4 }],
        }),
        offer({
          distributor: 'NoFee',
          lineCharge: 0,
          priceBreaks: [{ minQty: 1, unitPrice: 0.45 }],
        }),
      ],
    })
    // 100 × 0.40 + 20 = 60.00 versus 100 × 0.45 = 45.00.
    expect(result.lines[0]?.chosen?.distributor).toBe('NoFee')
    expect(result.totalCost).toBeCloseTo(45, 10)
  })

  it('sums the chosen offers across lines', () => {
    const result = sourceBom({
      lines: [
        line({ reference: 'R1', partNumber: 'A', quantity: 100 }),
        line({ reference: 'C1', partNumber: 'B', quantity: 100 }),
      ],
      catalog: [
        offer({ partNumber: 'A', priceBreaks: [{ minQty: 1, unitPrice: 0.5 }] }),
        offer({ partNumber: 'B', priceBreaks: [{ minQty: 1, unitPrice: 0.25 }] }),
      ],
    })
    expect(result.totalCost).toBeCloseTo(75, 10)
    expect(result.complete).toBe(true)
  })

  it('refuses to print a total when a line is unsourced', () => {
    // A total that silently omits a line is the most dangerous kind.
    const result = sourceBom({
      lines: [line({ reference: 'R1' }), line({ reference: 'U1', partNumber: 'MISSING' })],
      catalog: [offer()],
    })
    expect(result.complete).toBe(false)
    expect(result.totalCost).toBe(0)
    expect(result.currency).toBe('mixed')
    expect(result.unsourced.map((entry) => entry.reference)).toEqual(['U1'])
  })

  it('converts to a report currency only when a rate is known', () => {
    const withRate = sourceBom(
      { lines: [line({ quantity: 100 })], catalog: [offer({ currency: 'EUR' })] },
      { reportCurrency: 'USD', exchangeRates: { EUR: 1.1 } },
    )
    expect(withRate.totalCost).toBeCloseTo(55, 10) // 100 × 0.5 × 1.1
    expect(withRate.currency).toBe('USD')

    const withoutRate = sourceBom(
      { lines: [line({ quantity: 100 })], catalog: [offer({ currency: 'EUR' })] },
      { reportCurrency: 'USD' },
    )
    // No rate means no honest total — not a silently unconverted one.
    expect(withoutRate.totalCost).toBe(0)
    expect(withoutRate.currency).toBe('mixed')
  })

  it('throws on an invalid line quantity rather than pricing it', () => {
    expect(() =>
      sourceBom({ lines: [line({ quantity: 0 })], catalog: [offer()] }),
    ).toThrow(/invalid quantity/)
  })
})

describe('sourceBom — risk', () => {
  it('flags an obsolete part', () => {
    const result = sourceBom({
      lines: [line({ partNumber: 'OLD' })],
      catalog: [offer({ partNumber: 'OLD', lifecycle: 'obsolete' })],
    })
    expect(result.risks.map((risk) => risk.code)).toContain('obsolete')
  })

  it('flags a not-recommended part', () => {
    const result = sourceBom({
      lines: [line({ partNumber: 'NR' })],
      catalog: [offer({ partNumber: 'NR', lifecycle: 'not-recommended' })],
    })
    expect(result.risks.map((risk) => risk.code)).toContain('not-recommended')
  })

  it('flags a line whose best offer cannot cover the quantity', () => {
    const result = sourceBom({
      lines: [line({ quantity: 5_000 })],
      catalog: [offer({ stock: 100 })],
    })
    const risk = result.risks.find((entry) => entry.code === 'insufficient-stock')
    expect(risk?.message).toContain('4,900 short'.replace(',', ''))
    expect(result.lines[0]?.chosen?.shortOnStock).toBe(true)
    expect(result.lines[0]?.chosen?.shortfall).toBe(4900)
  })

  it('flags a lead time over the threshold', () => {
    const result = sourceBom(
      { lines: [line()], catalog: [offer({ leadTimeDays: 90 })] },
      { maxLeadTimeDays: 56 },
    )
    expect(result.risks.map((risk) => risk.code)).toContain('long-lead-time')
  })

  it('accepts a lead time under the threshold', () => {
    const result = sourceBom({
      lines: [line()],
      catalog: [offer({ leadTimeDays: 14 })],
    })
    expect(result.risks.map((risk) => risk.code)).not.toContain('long-lead-time')
  })

  it('flags a single-sourced part', () => {
    const result = sourceBom({ lines: [line()], catalog: [offer()] })
    expect(result.risks.map((risk) => risk.code)).toContain('single-source')
  })

  it('does not flag a part with two distributors', () => {
    const result = sourceBom({
      lines: [line()],
      catalog: [offer({ distributor: 'A' }), offer({ distributor: 'B' })],
    })
    expect(result.risks.map((risk) => risk.code)).not.toContain('single-source')
  })

  it('reports a lifecycle risk once, not once per distributor', () => {
    const result = sourceBom({
      lines: [line()],
      catalog: [
        offer({ distributor: 'A', lifecycle: 'obsolete' }),
        offer({ distributor: 'B', lifecycle: 'obsolete' }),
      ],
    })
    expect(result.risks.filter((risk) => risk.code === 'obsolete')).toHaveLength(1)
  })

  it('flags an unsourced line and explains why', () => {
    const result = sourceBom({
      lines: [line({ partNumber: 'NOPE' })],
      catalog: [offer()],
    })
    expect(result.lines[0]?.unavailableReason).toContain('NOPE')
    expect(result.risks.map((risk) => risk.code)).toContain('unsourced')
  })

  it('respects an allowed-distributor restriction', () => {
    const result = sourceBom({
      lines: [line({ allowedDistributors: ['Mouser'] })],
      catalog: [offer({ distributor: 'Digi-Key' })],
    })
    expect(result.complete).toBe(false)
    expect(result.lines[0]?.unavailableReason).toContain('allowed distributor')
  })
})

describe('reference catalog', () => {
  it('carries provenance so it is never mistaken for a live quote', () => {
    for (const entry of REFERENCE_CATALOG) {
      expect(entry.source).toBe('offline-catalog')
      expect(entry.asOf).toBe(REFERENCE_CAPTURED_ON)
      expect(entry.priceBreaks.length).toBeGreaterThan(0)
      expect(entry.distributor.length).toBeGreaterThan(0)
    }
  })

  it('has ascending, non-increasing price breaks throughout', () => {
    for (const entry of REFERENCE_CATALOG) {
      let previousMin = 0
      let previousPrice = Infinity
      for (const band of entry.priceBreaks) {
        expect(band.minQty).toBeGreaterThan(previousMin)
        expect(band.unitPrice).toBeLessThanOrEqual(previousPrice)
        previousMin = band.minQty
        previousPrice = band.unitPrice
      }
    }
  })

  it('lists a distributor for every part it knows', () => {
    for (const [partNumber, distributors] of Object.entries(referencePartNumbers)) {
      expect(distributors.length, `no distributor for ${partNumber}`).toBeGreaterThan(0)
    }
  })

  it('sources a realistic BOM end to end', () => {
    const result = sourceBom(
      {
        lines: [
          { reference: 'R1', partNumber: 'RC0603FR-0710KL', quantity: 100 },
          { reference: 'C1', partNumber: 'CL10A106MQ8NNN', quantity: 100 },
          { reference: 'U1', partNumber: 'LM358DR', quantity: 10 },
        ],
        catalog: REFERENCE_CATALOG,
      },
      { reportCurrency: 'USD', exchangeRates: { USD: 1 } },
    )
    expect(result.complete).toBe(true)
    expect(result.totalCost).toBeGreaterThan(0)
    /* LM358DR is listed by one distributor in the reference data, which is the
     * risk this exercises: individually cheap, collectively fragile. */
    expect(
      result.lines.find((entry) => entry.partNumber === 'LM358DR')?.risks.map((r) => r.code),
    ).toContain('single-source')
    // Every offer is reference data, and the result says so.
    expect(result.staleOffers).toBe(result.lines.reduce((n, l) => n + l.offers.length, 0))
  })

  it('flags the obsolete part the catalog deliberately carries', () => {
    const result = sourceBom({
      lines: [{ reference: 'U9', partNumber: 'L293DNE', quantity: 1 }],
      catalog: REFERENCE_CATALOG,
    })
    expect(result.risks.map((risk) => risk.code)).toContain('obsolete')
  })
})

describe('resolveSourcing', () => {
  it('resolves a part number through the reference provider', async () => {
    const [resolved] = await resolveSourcing(['RC0603FR-0710KL'])
    expect(resolved?.offers.length).toBeGreaterThan(0)
    expect(resolved?.kind).toBe('offline-catalog')
    // The provenance string must make clear this is not live stock.
    expect(resolved?.detail).toMatch(/reference snapshot/i)
    expect(resolved?.live).toBe(false)
  })

  it('returns nothing for an unknown part without throwing', async () => {
    const [resolved] = await resolveSourcing(['NOT-A-PART'])
    expect(resolved?.offers).toEqual([])
    expect(resolved?.live).toBe(false)
  })

  it('reports a provider failure per part rather than aborting the batch', async () => {
    const failing = {
      name: 'broken',
      async fetch() {
        throw new Error('network down')
      },
    }
    const results = await resolveSourcing(['A', 'B'], { provider: failing })
    expect(results).toHaveLength(2)
    expect(results.every((entry) => entry.offers.length === 0)).toBe(true)
    expect(results[0]?.detail).toMatch(/network down/)
  })

  it('deduplicates part numbers before querying', async () => {
    const calls: string[] = []
    const counting = {
      name: 'counting',
      async fetch(partNumber: string) {
        calls.push(partNumber)
        return { offers: [], kind: 'disabled' as const, detail: '', asOf: '' }
      },
    }
    await resolveSourcing(['A', 'A', 'B'], { provider: counting })
    expect(calls.sort()).toEqual(['A', 'B'])
  })

  it('defaults to the reference provider', async () => {
    const resolved = await resolveSourcing(['RC0603FR-0710KL'])
    expect(resolved[0]?.kind).toBe('offline-catalog')
    // Sanity: the provider is the one that ships, not a network call.
    await expect(referenceProvider.fetch('RC0603FR-0710KL')).resolves.toMatchObject({
      kind: 'offline-catalog',
    })
  })
})