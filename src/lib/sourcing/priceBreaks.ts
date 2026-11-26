/**
 * Distributor price-break arithmetic.
 *
 * A distributor quotes a schedule, not a price. Compare offers at the same
 * quantity and include the per-line charge — headline unit prices are how a BOM
 * ends up cheapest on paper and dearest on the invoice.
 */

/** One quantity band of a distributor's price schedule. */
export interface PriceBreak {
  /** The smallest quantity this unit price applies to, inclusive. */
  minQty: number
  /** Unit price in the currency of the offer, per piece. */
  unitPrice: number
}

/** A priced offer for one part from one distributor. */
export interface PricedOffer {
  /** Manufacturer part number — the key a BOM line is matched on. */
  partNumber: string
  /** Manufacturer name, for display. */
  manufacturer?: string
  /** Distributor name, e.g. `Digi-Key`. */
  distributor: string
  /** The distributor's own catalogue number for the part. */
  orderCode?: string
  /** Whether the distributor stocks it or lists it as a special order. */
  stock: number
  /** Manufacturing lead time in days, when the distributor states one. */
  leadTimeDays?: number
  /** Lifecycle as the distributor reports it. */
  lifecycle?: 'active' | 'not-recommended' | 'obsolete' | 'nrnd'
  /** Unit price breaks, ascending by `minQty`. */
  priceBreaks: PriceBreak[]
  /** Currency of every price in this offer. */
  currency: string
  /** A flat charge added once per line, e.g. a cut-tape or handling fee. */
  lineCharge?: number
  /** Where this data came from, and when it was true. */
  source: 'offline-catalog' | 'live-api'
  asOf: string
}

export interface PricedOfferInput extends Omit<PricedOffer, 'priceBreaks'> {
  priceBreaks: readonly PriceBreak[]
}

/** The cost of one offer at a given quantity. */
export interface OfferCost {
  /** Unit price that applies at this quantity. */
  unitPrice: number
  /** `unitPrice × quantity`. */
  extended: number
  /** The per-line charge, or 0. */
  lineCharge: number
  /** `extended + lineCharge` — the number to compare offers by. */
  total: number
  /** The break whose price was used. */
  appliedBreak: PriceBreak | undefined
}

const CURRENCY_PRECISION = 1e-6

/** Round to cents (or the currency's minor unit) without float drift. */
export const roundMoney = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100

/** Validate a price schedule: positive prices, strictly ascending quantities. */
export function assertPriceBreaks(breaks: readonly PriceBreak[]): void {
  if (breaks.length === 0) {
    throw new Error('A price schedule needs at least one break.')
  }
  let previousMin = -Infinity
  let previousPrice = Infinity
  for (const entry of breaks) {
    if (!Number.isFinite(entry.minQty) || entry.minQty < 1) {
      throw new Error(`Price break minimum quantity must be a positive number, got ${entry.minQty}.`)
    }
    if (entry.minQty <= previousMin) {
      throw new Error('Price breaks must be in strictly ascending quantity order.')
    }
    if (!Number.isFinite(entry.unitPrice) || entry.unitPrice < 0) {
      throw new Error(`Price break for qty ${entry.minQty} has an invalid unit price.`)
    }
    // A schedule that goes *up* with quantity is almost always a transcription
    // error, and it would silently make the cheapest break the wrong one.
    if (entry.unitPrice > previousPrice) {
      throw new Error(
        `Unit price at qty ${entry.minQty} (${entry.unitPrice}) is higher than the previous break (${previousPrice}); a quantity schedule should not increase.`,
      )
    }
    previousMin = entry.minQty
    previousPrice = entry.unitPrice
  }
}

/**
 * Price one offer at a quantity.
 *
 * The applicable break is the highest `minQty` not exceeding the quantity; below
 * the first break the first break's price is used, because a distributor will not
 * sell a single piece at the 1 000-piece price.
 */
export function priceOffer(
  offer: PricedOffer,
  quantity: number,
): OfferCost {
  if (!Number.isFinite(quantity) || quantity < 1) {
    throw new Error(`Quantity must be a positive number, got ${quantity}.`)
  }
  const quantityIsWhole = Number.isInteger(quantity)
  if (!quantityIsWhole) {
    throw new Error('You cannot order a fractional part; round the quantity first.')
  }

  assertPriceBreaks(offer.priceBreaks)

  let appliedBreak: PriceBreak | undefined
  for (const entry of offer.priceBreaks) {
    if (quantity >= entry.minQty) appliedBreak = entry
  }
  // Below the first break: the first break's price is the only quote available.
  appliedBreak ??= offer.priceBreaks[0]

  const unitPrice = appliedBreak?.unitPrice ?? 0
  const extended = unitPrice * quantity
  const lineCharge = Number.isFinite(offer.lineCharge ?? 0) ? (offer.lineCharge ?? 0) : 0
  const total = extended + lineCharge

  return {
    unitPrice,
    extended: Math.abs(extended) < CURRENCY_PRECISION ? 0 : extended,
    lineCharge,
    total: Math.abs(total) < CURRENCY_PRECISION ? 0 : total,
    appliedBreak,
  }
}

/** The cheapest break's unit price — what a headline quote usually shows. */
export function bestUnitPrice(offer: PricedOffer): number {
  return offer.priceBreaks.reduce(
    (best, entry) => (entry.unitPrice < best ? entry.unitPrice : best),
    Infinity,
  )
}

/**
 * Sort offers for one part at a quantity, cheapest landed cost first.
 *
 * Ties break on stock (more is better), then on lead time — but only when both
 * offers state one. Inventing a lead time for a distributor that did not quote
 * one would penalise it for being honest; leaving the tie unresolved keeps the
 * input order, which is deterministic and does not pretend to know.
 */
export function rankOffers(offers: readonly PricedOffer[], quantity: number): PricedOffer[] {
  return [...offers].sort((a, b) => {
    const costDelta = priceOffer(a, quantity).total - priceOffer(b, quantity).total
    if (Math.abs(costDelta) > CURRENCY_PRECISION) return costDelta
    if (b.stock !== a.stock) return b.stock - a.stock
    if (a.leadTimeDays !== undefined && b.leadTimeDays !== undefined) {
      return a.leadTimeDays - b.leadTimeDays
    }
    return 0
  })
}