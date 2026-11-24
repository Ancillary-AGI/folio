/**
 * The sourcing provider seam.
 *
 * `sourceBom` is pure: it prices whatever catalogue it is handed. Where that
 * catalogue comes from is a separate question, and it has three honest answers:
 *
 *   - `reference` — the bundled snapshot in `./catalog`. Offline, deterministic,
 *     and stamped with the date it was captured. Good enough to estimate a build
 *     and to demo, never good enough to order from.
 *   - `live` — a distributor API. Implemented by supplying a provider that
 *     conforms to `SourcingProvider`; none ships, because every distributor
 *     terms its API differently and none should be guessed at.
 *   - `disabled` — no provider configured. Reported as such rather than silently
 *     falling back, so a caller can tell "no data" from "old data".
 *
 * The point of the seam is that a caller asks once and gets an answer that says
 * what kind of answer it is. A sourcing panel that showed reference prices
 * beside live stock without labelling them would be worse than showing nothing.
 */
import { REFERENCE_CATALOG } from './catalog'
import type { PricedOffer } from './priceBreaks'

export interface SourcingProviderResult {
  offers: PricedOffer[]
  /** Where the offers came from. */
  kind: PricedOffer['source'] | 'disabled'
  /** Human-readable provenance, e.g. `Digi-Key API, fetched 2026-11-21`. */
  detail: string
  /** When the data was true. */
  asOf: string
}

export interface SourcingProvider {
  /** A short name for diagnostics, e.g. `digikey`. */
  readonly name: string
  /** Fetch offers for one manufacturer part number. */
  fetch(partNumber: string, signal?: AbortSignal): Promise<SourcingProviderResult>
}

/** The bundled snapshot. Always answers; never claims to be live. */
export const referenceProvider: SourcingProvider = {
  name: 'reference',
  async fetch(partNumber) {
    const offers = REFERENCE_CATALOG.filter((entry) => entry.partNumber === partNumber)
    return {
      offers,
      kind: 'offline-catalog',
      detail: `Bundled reference snapshot (${REFERENCE_CATALOG.length} offers, captured ${REFERENCE_CATALOG[0]?.asOf ?? 'unknown'})`,
      asOf: REFERENCE_CATALOG[0]?.asOf ?? '',
    }
  },
}

export interface ResolveOptions {
  /** Provider to use. Defaults to the reference snapshot. */
  provider?: SourcingProvider
  signal?: AbortSignal
}

export interface ResolvedSourcing {
  offers: PricedOffer[]
  kind: SourcingProviderResult['kind']
  detail: string
  asOf: string
  /** True when at least one offer came from a live source. */
  live: boolean
}

/**
 * Resolve every part number in a list to offers, through one provider.
 *
 * A provider that throws is reported per part rather than aborting the whole
 * resolve: one missing part must not lose the pricing for the other forty.
 */
export async function resolveSourcing(
  partNumbers: readonly string[],
  options: ResolveOptions = {},
): Promise<ResolvedSourcing[]> {
  const provider = options.provider ?? referenceProvider
  const unique = [...new Set(partNumbers.map((entry) => entry.trim()).filter(Boolean))]

  return Promise.all(
    unique.map(async (partNumber): Promise<ResolvedSourcing> => {
      try {
        const result = await provider.fetch(partNumber, options.signal)
        return {
          offers: result.offers,
          kind: result.kind,
          detail: result.detail,
          asOf: result.asOf,
          live: result.kind === 'live-api',
        }
      } catch (error) {
        return {
          offers: [],
          kind: 'disabled',
          detail: `${provider.name} failed: ${error instanceof Error ? error.message : String(error)}`,
          asOf: '',
          live: false,
        }
      }
    }),
  )
}