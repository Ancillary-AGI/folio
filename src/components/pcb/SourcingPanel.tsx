'use client'

/**
 * Sourcing — what the board would cost and who can supply it.
 *
 * The same engine `eda.source` gives the agent, rendered for a person. It prices
 * every part at the quantity being built (not the headline unit price), adds any
 * per-line charge, and reports stock, lead time and lifecycle risks.
 *
 * The provenance is stated on screen, not buried: this build reads the bundled
 * reference snapshot unless a live provider is configured, and reference prices
 * are for estimation. Presenting them as a quote would be the defect this guards.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle, PackageSearch } from 'lucide-react'
import type { PlacedComponent } from '../../types'
import { sourceBom, type SourcingResult, type SourcingRiskCode } from '../../lib/sourcing/sourcing'
import { REFERENCE_CATALOG, REFERENCE_CAPTURED_ON } from '../../lib/sourcing/catalog'

interface SourcingPanelProps {
  components: readonly PlacedComponent[]
}

const money = (value: number, currency: string): string => {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency === 'mixed' ? 'USD' : currency,
      maximumFractionDigits: 4,
    }).format(value)
  } catch {
    // An unknown currency code must not blank the row.
    return `${value.toFixed(4)} ${currency}`
  }
}

const RiskBadge = ({ code }: { code: SourcingRiskCode }) => {
  const label: Record<SourcingRiskCode, string> = {
    obsolete: 'Obsolete',
    'not-recommended': 'Not recommended',
    nrnd: 'NRND',
    'insufficient-stock': 'Short on stock',
    'long-lead-time': 'Long lead time',
    'single-source': 'Single source',
    unsourced: 'No source',
  }
  return (
    <span className="rounded border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[10px] text-warning">
      {label[code]}
    </span>
  )
}

export default function SourcingPanel({ components }: SourcingPanelProps) {
  const [quantity, setQuantity] = useState(100)
  const [result, setResult] = useState<SourcingResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  /* One line per distinct part number, with the references that use it and the
   * quantity actually on the sheet. */
  const lines = useMemo(() => {
    const byPart = new Map<string, { references: string[]; count: number }>()
    for (const component of components) {
      const partNumber = component.component.partNumber?.trim()
      if (!partNumber) continue
      const entry = byPart.get(partNumber) ?? { references: [], count: 0 }
      entry.references.push(component.reference)
      entry.count += 1
      byPart.set(partNumber, entry)
    }
    return [...byPart.entries()].map(([partNumber, entry]) => ({
      partNumber,
      reference: entry.references.join(', '),
      quantity: Math.max(quantity, entry.count),
    }))
  }, [components, quantity])

  const run = useCallback(async () => {
    setError(null)
    try {
      setResult(sourceBom({ lines, catalog: REFERENCE_CATALOG }, { reportCurrency: 'USD' }))
    } catch (cause) {
      setResult(null)
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [lines])

  useEffect(() => {
    void run()
  }, [run])

  const unsourced = useMemo(
    () => components.filter((component) => !component.component.partNumber?.trim()),
    [components],
  )

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-foreground">Sourcing</h2>
          <p className="text-xs text-muted-foreground">
            {`Cost and availability for the parts on this board. Reference data captured ${REFERENCE_CAPTURED_ON}, `
              + 'not a live quote — confirm with the distributor before ordering.'}
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label htmlFor="sourcing-quantity" className="text-xs font-medium text-foreground">
              Build quantity
            </label>
            <input
              id="sourcing-quantity"
              type="number"
              min={1}
              step={1}
              value={quantity}
              onChange={(event) => setQuantity(Math.max(1, Math.floor(Number(event.target.value) || 1)))}
              className="w-24 rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground"
            />
          </div>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </p>
      )}

      {result && (
        <>
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/30 p-2 text-xs">
            <span className="font-medium text-foreground">
              {result.complete
                ? `${money(result.totalCost, result.currency)} for ${lines.length} part${lines.length === 1 ? '' : 's'}`
                : 'Total not stated — some parts have no source'}
            </span>
            <span className="text-muted-foreground">
              {`${result.staleOffers} offer(s) from the reference snapshot`}
            </span>
            {!result.complete && (
              <span className="text-warning">
                {`${result.unsourced.length} part(s) unsourced`}
              </span>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <caption className="sr-only">Costed offers per part</caption>
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th scope="col" className="py-1 pr-2 font-medium">Part</th>
                  <th scope="col" className="py-1 pr-2 font-medium">Qty</th>
                  <th scope="col" className="py-1 pr-2 font-medium">Source</th>
                  <th scope="col" className="py-1 pr-2 text-right font-medium">Unit</th>
                  <th scope="col" className="py-1 pr-2 text-right font-medium">Extended</th>
                  <th scope="col" className="py-1 pr-2 font-medium">Flags</th>
                </tr>
              </thead>
              <tbody>
                {result.lines.map((line) => (
                  <tr key={line.partNumber} className="border-b border-border/60 align-top">
                    <th scope="row" className="py-1.5 pr-2 text-left font-normal">
                      <span className="block font-medium text-foreground">{line.partNumber}</span>
                      <span className="block text-[11px] text-muted-foreground">{line.reference}</span>
                    </th>
                    <td className="py-1.5 pr-2 tabular-nums text-muted-foreground">{line.quantity}</td>
                    <td className="py-1.5 pr-2">
                      {line.chosen ? (
                        <>
                          <span className="block text-foreground">{line.chosen.distributor}</span>
                          <span className="block text-[11px] text-muted-foreground">
                            {`${line.chosen.stock.toLocaleString()} in stock`}
                          </span>
                        </>
                      ) : (
                        <span className="text-warning">{line.unavailableReason ?? 'No source'}</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {line.chosen ? money(line.chosen.cost.unitPrice, line.chosen.currency) : '—'}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {line.chosen ? money(line.chosen.cost.total, line.chosen.currency) : '—'}
                    </td>
                    <td className="py-1.5 pr-2">
                      <div className="flex flex-wrap gap-1">
                        {line.risks.map((risk) => <RiskBadge key={risk.code} code={risk.code} />)}
                        {line.risks.length === 0 && (
                          <CheckCircle className="h-3.5 w-3.5 text-success" aria-label="No sourcing risk" />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {unsourced.length > 0 && (
            <div className="rounded border border-warning/40 bg-warning/10 p-2">
              <p className="flex items-center gap-1.5 text-xs font-medium text-warning">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                {`${unsourced.length} part(s) have no manufacturer part number`}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {`${unsourced.map((component) => component.reference).join(', ')} — add a part number so they can be sourced.`}
              </p>
            </div>
          )}
        </>
      )}

      {!result && !error && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <PackageSearch className="h-3.5 w-3.5" aria-hidden="true" />
          Add parts with a manufacturer part number to see cost and availability.
        </p>
      )}
    </div>
  )
}