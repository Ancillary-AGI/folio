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
 * One argument on purpose. Chart tick formatters are called as
 * `formatter(value, index)`, so a second (options) parameter here would receive
 * the tick index and `toPrecision(0)` would throw at render time. Use
 * `formatEngineeringPrecise` when a readout needs more digits.
 */
export function formatEngineering(value: number): string {
  return formatScaled(value, 3)
}

/** The same SI-prefixed scale with six significant digits, for cursor readouts. */
export function formatEngineeringPrecise(value: number): string {
  return formatScaled(value, 6)
}

function formatScaled(value: number, significantDigits: number): string {
  if (!Number.isFinite(value)) return '—'
  if (value === 0) return '0'
  const magnitude = Math.abs(value)
  const [scale, prefix] = SI_PREFIXES.find(([limit]) => magnitude >= limit) ?? [1e-24, 'y']
  // Round before choosing decimals: 99.9999999999 must read "100m", not
  // "100.0m", or float noise leaks into every axis label.
  const digits = Math.min(Math.max(Math.trunc(significantDigits), 1), 100)
  const scaled = Number((value / scale).toPrecision(digits))
  const integralDigits = Math.abs(scaled) >= 1 ? Math.floor(Math.abs(scaled)).toString().length : 1
  const decimals = Math.min(100, Math.max(0, digits - integralDigits))
  return `${scaled.toFixed(decimals)}${prefix}`
}
