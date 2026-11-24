/**
 * Sourcing: turn a bill of materials into ranked, costed, risk-flagged offers.
 *
 * The engine answers the three questions a buyer asks, and keeps them separate:
 *
 *   1. **What does it cost?** — every offer priced at *this* quantity, with the
 *      per-line charge included, so the cheapest offer is the cheapest invoice
 *      and not merely the lowest headline unit price.
 *   2. **Can I get it?** — stock against the required quantity, lead time, and
 *      lifecycle. A part nobody can ship is flagged before it reaches a PO.
 *   3. **What is the risk?** — single-sourced parts, obsolete parts, and lines
 *      that cannot be sourced at all. A BOM can be individually cheap and
 *      collectively fragile; that is the thing worth surfacing.
 *
 * Every offer carries its provenance and the date it was true. Reference data
 * bundled with the app is labelled `offline-catalog` and must never be presented
 * as live stock — a build that forgets that will quote old prices with a
 * straight face.
 */
import {
  priceOffer,
  rankOffers,
  roundMoney,
  type OfferCost,
  type PricedOffer,
} from './priceBreaks'

export interface SourcingLine {
  /** Stable identifier, usually the reference designator. */
  reference: string
  /** Manufacturer part number — the join key to the catalog. */
  partNumber: string
  /** How many are needed. */
  quantity: number
  /** Optional override: only these distributors are acceptable. */
  allowedDistributors?: readonly string[]
}

export interface SourcedOffer {
  distributor: string
  orderCode?: string
  stock: number
  leadTimeDays?: number
  lifecycle?: PricedOffer['lifecycle']
  currency: string
  cost: OfferCost
  /** `cost.total` converted to the report currency, when a rate is known. */
  totalInReportCurrency?: number
  source: PricedOffer['source']
  asOf: string
  /** True when stock alone cannot cover the quantity. */
  shortOnStock: boolean
  /** The shortfall in pieces, when short. */
  shortfall: number
}

export type SourcingRiskCode =
  | 'obsolete'
  | 'not-recommended'
  | 'nrnd'
  | 'insufficient-stock'
  | 'long-lead-time'
  | 'single-source'
  | 'unsourced'

export interface SourcingRisk {
  code: SourcingRiskCode
  /** One sentence a person can act on. */
  message: string
}

export interface SourcedLine {
  reference: string
  partNumber: string
  quantity: number
  /** Offers that could be priced, cheapest landed cost first. */
  offers: SourcedOffer[]
  /** The offer the engine would buy. Null when nothing can be sourced. */
  chosen: SourcedOffer | null
  /** Why no offer was chosen, when that is the case. */
  unavailableReason?: string
  /** Risk flags for this line, empty when nothing is wrong. */
  risks: SourcingRisk[]
}

export interface SourcingRequest {
  lines: readonly SourcingLine[]
  catalog: readonly PricedOffer[]
}

export interface SourcingOptions {
  /** Lead time above this many days is flagged. */
  maxLeadTimeDays?: number
  /** Convert offer totals into this currency using the supplied rates. */
  reportCurrency?: string
  /** Units of `reportCurrency` per unit of the offer currency. */
  exchangeRates?: Readonly<Record<string, number>>
}

export interface SourcingResult {
  lines: SourcedLine[]
  /**
   * Sum of the chosen offers. `0` when the total cannot be stated honestly —
   * because a line is unsourced, or because a price is in a currency with no
   * known rate. A number here is always a real total.
   */
  totalCost: number
  /** The currency `totalCost` is in, or `mixed` when it cannot be stated. */
  currency: string
  /** True when every line has a chosen offer. */
  complete: boolean
  unsourced: SourcedLine[]
  /** Every distinct risk across the BOM, for a summary panel. */
  risks: SourcingRisk[]
  /** How many offers are reference data rather than a live quote. */
  staleOffers: number
}

/** Lead time above this many days is worth a second look. */
export const DEFAULT_MAX_LEAD_TIME_DAYS = 56

const OBSOLETE_STATES: readonly PricedOffer['lifecycle'][] = [
  'obsolete',
  'not-recommended',
  'nrnd',
]

const lifecycleRisk = (state: PricedOffer['lifecycle']): SourcingRisk | undefined => {
  if (!state || !OBSOLETE_STATES.includes(state)) return undefined
  if (state === 'obsolete') {
    return {
      code: 'obsolete',
      message: 'The manufacturer has declared this part obsolete; last-time-buy stock will not last a production run.',
    }
  }
  if (state === 'not-recommended') {
    return {
      code: 'not-recommended',
      message: 'The manufacturer marks this part not recommended for new designs.',
    }
  }
  return {
    code: 'nrnd',
    message: 'The manufacturer marks this part not recommended for new designs; a successor exists.',
  }
}

const convert = (amount: number, from: string, options: SourcingOptions): number | undefined => {
  const target = options.reportCurrency
  if (!target || target === from) return amount
  const rate = options.exchangeRates?.[from]
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return undefined
  return roundMoney(amount * rate)
}

/**
 * Source every line of a request.
 *
 * Deterministic: offers are ranked by landed cost, ties broken by stock then lead
 * time, so the same input always yields the same purchase.
 */
export function sourceBom(
  request: SourcingRequest,
  options: SourcingOptions = {},
): SourcingResult {
  const maxLead = options.maxLeadTimeDays ?? DEFAULT_MAX_LEAD_TIME_DAYS

  const lines: SourcedLine[] = request.lines.map((line) => {
    if (!Number.isFinite(line.quantity) || line.quantity < 1) {
      throw new Error(`Line "${line.reference}" has an invalid quantity: ${line.quantity}.`)
    }

    const candidates = request.catalog
      .filter((offer) => offer.partNumber === line.partNumber)
      .filter(
        (offer) =>
          !line.allowedDistributors || line.allowedDistributors.includes(offer.distributor),
      )

    // Rank the catalog offers first, then decorate them with cost and risk.
    const ranked = rankOffers(candidates, line.quantity)

    const offers: SourcedOffer[] = ranked.map((offer) => {
      const cost = priceOffer(offer, line.quantity)
      const shortfall = Math.max(0, line.quantity - offer.stock)
      return {
        distributor: offer.distributor,
        orderCode: offer.orderCode,
        stock: offer.stock,
        leadTimeDays: offer.leadTimeDays,
        lifecycle: offer.lifecycle,
        currency: offer.currency,
        cost,
        totalInReportCurrency: convert(cost.total, offer.currency, options),
        source: offer.source,
        asOf: offer.asOf,
        shortOnStock: shortfall > 0,
        shortfall,
      }
    })

    const risks: SourcingRisk[] = []
    const chosen = offers[0]

    /* A lifecycle warning is about the part, so it is reported once, against the
     * offer the engine would actually buy — not once per distributor. */
    if (chosen) {
      const risk = lifecycleRisk(chosen.lifecycle)
      if (risk) risks.push(risk)
      if (chosen.shortOnStock) {
        risks.push({
          code: 'insufficient-stock',
          message: `Only ${chosen.stock} of ${line.quantity} in stock at ${chosen.distributor}; ${chosen.shortfall} short.`,
        })
      }
      if (chosen.leadTimeDays !== undefined && chosen.leadTimeDays > maxLead) {
        risks.push({
          code: 'long-lead-time',
          message: `Lead time is ${chosen.leadTimeDays} days, over the ${maxLead}-day threshold.`,
        })
      }
      if (offers.length === 1) {
        risks.push({
          code: 'single-source',
          message: `Only ${chosen.distributor} lists this part; there is no second source if it goes on allocation.`,
        })
      }
    } else {
      /* The specific reason is the one worth carrying: "no allowed distributor
       * lists this" tells the buyer to widen the search, "no offer" does not. */
      risks.push({
        code: 'unsourced',
        message: line.allowedDistributors
          ? `No allowed distributor lists ${line.partNumber}.`
          : `No distributor in the catalog lists ${line.partNumber}.`,
      })
    }

    const unavailableReason = chosen ? undefined : risks[0]?.message

    return {
      reference: line.reference,
      partNumber: line.partNumber,
      quantity: line.quantity,
      offers,
      chosen: chosen ?? null,
      unavailableReason,
      risks,
    }
  })

  const unsourced = lines.filter((line) => line.chosen === null)

  /* Totals are only summed when every chosen offer is in the report currency
   * (or no report currency was requested). Mixing currencies into one number,
   * or printing a total that omits an unsourced line, would be a lie. */
  const reportCurrency = options.reportCurrency
  let total = 0
  let summable = unsourced.length === 0
  for (const line of lines) {
    if (!line.chosen) break
    const amount = reportCurrency ? line.chosen.totalInReportCurrency : line.chosen.cost.total
    if (amount === undefined) {
      summable = false
      break
    }
    total += amount
  }

  return {
    lines,
    totalCost: summable ? roundMoney(total) : 0,
    currency: summable ? (reportCurrency ?? 'mixed') : 'mixed',
    complete: unsourced.length === 0,
    unsourced,
    risks: lines.flatMap((line) => line.risks),
    staleOffers: lines.reduce(
      (count, line) => count + line.offers.filter((o) => o.source === 'offline-catalog').length,
      0,
    ),
  }
}