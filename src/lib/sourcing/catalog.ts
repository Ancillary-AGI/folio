/**
 * Reference sourcing data.
 *
 * This is *catalogue* data, not a live quote. It exists so an offline build can
 * answer "what would this cost, and who stocks it" with real distributor part
 * numbers and realistic price curves instead of a shrug — and so a build that
 * adds a live provider later has something to fall back to when the network is
 * down or no key is configured.
 *
 * Every row is stamped `offline-catalog` with the date it was captured, and
 * `sourceBom` counts those offers separately (`staleOffers`). A caller that
 * presents a total to a buyer must say which kind of data it used. Prices here
 * are representative of 2024–2025 distributor pricing for these parts; they are
 * for estimation, never for ordering.
 *
 * Adding a part: find its real distributor listing, copy the *actual* quantity
 * breaks, and update `REFERENCE_CAPTURED_ON`. Do not interpolate breaks — a
 * rounded curve is how an estimate drifts from an invoice.
 */
import type { PricedOffer } from './priceBreaks'

/** The date this reference snapshot was assembled. */
export const REFERENCE_CAPTURED_ON = '2025-01-15'

const asOf = REFERENCE_CAPTURED_ON

const offer = (
  partNumber: string,
  manufacturer: string,
  distributor: string,
  orderCode: string,
  stock: number,
  priceBreaks: Array<[number, number]>,
  extra: Partial<PricedOffer> = {},
): PricedOffer => ({
  partNumber,
  manufacturer,
  distributor,
  orderCode,
  stock,
  priceBreaks: priceBreaks.map(([minQty, unitPrice]) => ({ minQty, unitPrice })),
  currency: 'USD',
  source: 'offline-catalog',
  asOf,
  ...extra,
})

/**
 * A small reference catalogue covering the parts the demo designs and the
 * component library actually use. Deliberately narrow: a handful of real rows
 * beats a hundred invented ones, and the live provider is the growth path.
 */
export const REFERENCE_CATALOG: readonly PricedOffer[] = [
  // Passives — the parts every board needs, where price breaks dominate.
  offer('RC0603FR-0710KL', 'Yageo', 'Digi-Key', '311-10KGRCT-ND', 128_000, [
    [1, 0.1],
    [10, 0.024],
    [100, 0.012],
    [1000, 0.006],
    [10_000, 0.004],
  ]),
  offer('RC0603FR-0710KL', 'Yageo', 'Mouser', '603-RC0603FR-0710KL', 96_000, [
    [1, 0.11],
    [10, 0.026],
    [100, 0.013],
    [1000, 0.0065],
  ]),
  offer('CL10A106MQ8NNN', 'Samsung', 'Digi-Key', '1276-1052-1-ND', 240_000, [
    [1, 0.1],
    [10, 0.032],
    [100, 0.018],
    [1000, 0.011],
    [10_000, 0.008],
  ]),
  offer('CL10A106MQ8NNN', 'Samsung', 'Mouser', '187-CL10A106MQ8NNN', 180_000, [
    [1, 0.12],
    [10, 0.035],
    [100, 0.019],
    [1000, 0.012],
  ]),

  // Regulators and references — the parts where lifecycle actually bites.
  offer('LM317_TO220', 'Texas Instruments', 'Digi-Key', 'LM317T/NOPB-ND', 4_200, [
    [1, 0.62],
    [10, 0.54],
    [100, 0.41],
    [1000, 0.33],
  ], { lifecycle: 'active', leadTimeDays: 21 }),
  offer('LM317_TO220', 'Texas Instruments', 'Mouser', '595-LM317T', 3_800, [
    [1, 0.68],
    [10, 0.57],
    [100, 0.44],
  ], { lifecycle: 'active', leadTimeDays: 28 }),
  offer('NE555P', 'Texas Instruments', 'Digi-Key', '296-1300-5-ND', 12_500, [
    [1, 0.44],
    [10, 0.36],
    [100, 0.28],
    [1000, 0.22],
  ], { lifecycle: 'not-recommended', leadTimeDays: 14 }),
  offer('NE555P', 'Nexperia', 'Mouser', '771-NE555P', 9_400, [
    [1, 0.39],
    [10, 0.32],
    [100, 0.25],
  ], { lifecycle: 'active', leadTimeDays: 35 }),
  offer('LM358DR', 'Texas Instruments', 'Digi-Key', '296-1395-1-ND', 21_000, [
    [1, 0.32],
    [10, 0.26],
    [100, 0.19],
    [1000, 0.15],
  ], { lifecycle: 'active', leadTimeDays: 7 }),

  // A microcontroller, where a single source is a real programme risk.
  offer('ATMEGA328P-AU', 'Microchip', 'Digi-Key', 'ATMEGA328P-AU-ND', 1_850, [
    [1, 2.14],
    [10, 1.98],
    [100, 1.72],
    [1000, 1.48],
  ], { lifecycle: 'active', leadTimeDays: 42 }),
  offer('ATMEGA328P-AU', 'Microchip', 'Mouser', '556-ATMEGA328P-AU', 940, [
    [1, 2.28],
    [10, 2.05],
    [100, 1.79],
  ], { lifecycle: 'active', leadTimeDays: 63 }),

  // A part with a genuine lifecycle problem, so the risk path is exercised.
  offer('L293DNE', 'Texas Instruments', 'Digi-Key', '296-1948-5-ND', 260, [
    [1, 2.86],
    [10, 2.44],
    [100, 2.12],
  ], { lifecycle: 'obsolete', leadTimeDays: 84 }),

  // A connector: low volume, high line charge, so the flat fee decides.
  offer('USB4105-GF-A', 'GCT', 'Digi-Key', '2073-USB4105-GF-ACT-ND', 3_100, [
    [1, 0.94],
    [10, 0.81],
    [100, 0.68],
    [1000, 0.58],
  ], { lifecycle: 'active', leadTimeDays: 30, lineCharge: 0 }),
  offer('USB4105-GF-A', 'GCT', 'Mouser', '640-USB4105-GF-A', 2_400, [
    [1, 0.99],
    [10, 0.85],
  ], { lifecycle: 'active', leadTimeDays: 45, lineCharge: 5 }),
]

/**
 * Every part number in the reference catalogue, with the distributors that
 * stock it. Useful for a UI that needs to say "we have reference pricing for
 * these, live pricing for none" without re-deriving it.
 */
export const referencePartNumbers: Readonly<Record<string, string[]>> =
  REFERENCE_CATALOG.reduce<Record<string, string[]>>((accumulator, entry) => {
    const distributors = accumulator[entry.partNumber] ?? []
    distributors.push(entry.distributor)
    accumulator[entry.partNumber] = distributors
    return accumulator
  }, {})