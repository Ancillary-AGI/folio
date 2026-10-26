const SI_PREFIXES: Array<[number, string]> = [
  [1e9, 'G'],
  [1e6, 'M'],
  [1e3, 'k'],
  [1, ''],
  [1e-3, 'm'],
  [1e-6, 'µ'],
  [1e-9, 'n'],
  [1e-12, 'p'],
  [1e-15, 'f'],
  [1e-18, 'a'],
  [1e-21, 'z'],
  [1e-24, 'y'],
]

/**
 * Axis and tooltip numbers with an SI prefix. A noise floor of 2e-11 must read
 * as "20 p", not "0.00" five times down the axis.
 */
export function formatEngineering(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (value === 0) return '0'
  const magnitude = Math.abs(value)
  const [scale, prefix] = SI_PREFIXES.find(([limit]) => magnitude >= limit) ?? [1e-24, 'y']
  // Round before choosing decimals: 99.9999999999 must read "100m", not
  // "100.0m", or float noise leaks into every axis label.
  const scaled = Number((value / scale).toPrecision(3))
  const decimals = Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : 2
  return `${scaled.toFixed(decimals)}${prefix}`
}
