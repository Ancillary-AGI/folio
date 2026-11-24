/**
 * Readout formatting for solver output.
 *
 * One table can hold 0.00034 and 1.2e7, and fixed decimals make one of them
 * meaningless, so the magnitude chooses the notation. Both helpers answer a
 * non-number with an em dash: a readout that prints `NaN` or `Infinity` reads as
 * a measurement the solver never made, so the placeholder has to be unmistakable.
 */

/** Decimal places for a value that fits them; the dash for one that does not. */
export function fixed(value: number | null | undefined, digits = 2): string {
  return value === null || value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(digits)
}

/** Significant digits for values that span orders of magnitude (rate constants, AUC). */
export function compact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const magnitude = Math.abs(value)
  if (magnitude === 0) return '0'
  if (magnitude < 0.001 || magnitude >= 10000) return value.toExponential(2)
  return value.toPrecision(4)
}
