/**
 * Device model and parameter parsing for the solver.
 *
 * The simulator never looks at raw `Record<string, string|number|boolean>`
 * parameters again after this module: everything is resolved once into a typed
 * `Device`. That keeps the stamping code free of parsing branches and means an
 * unparseable value fails loudly at model-build time with the component's
 * designator in the message, rather than producing a NaN deep in the matrix.
 */

/** Engineering suffixes accepted on values, SPICE-compatible where it matters. */
const SUFFIX_SCALES: Readonly<Record<string, number>> = {
  t: 1e12,
  g: 1e9,
  meg: 1e6,
  k: 1e3,
  m: 1e-3,
  mil: 25.4e-6,
  u: 1e-6,
  'µ': 1e-6,
  'μ': 1e-6,
  n: 1e-9,
  p: 1e-12,
  f: 1e-15,
}

const VALUE_PATTERN = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*([a-zµμ]*)$/i

/**
 * Parse a SPICE-style engineering value: `4.7k`, `10u`, `2.2MEG`, `100n`, `1e-3`.
 * A bare number passes through unchanged so numeric parameters always work.
 */
export function parseSpiceValue(
  rawValue: string | number | boolean | undefined,
  label: string,
): number {
  if (typeof rawValue === 'number') {
    if (!Number.isFinite(rawValue)) throw new Error(`${label} must be a finite number`)
    return rawValue
  }
  if (typeof rawValue === 'boolean') {
    throw new Error(`${label} must be a number or SPICE value, not a boolean`)
  }
  if (rawValue === undefined) throw new Error(`${label} is missing`)

  const match = VALUE_PATTERN.exec(rawValue.trim())
  if (!match) throw new Error(`${label} is not a valid SPICE value: "${rawValue}"`)

  const magnitude = Number(match[1])
  // Trailing unit words ("10kohm", "1uF") resolve to the same prefix.
  const suffix = match[2].toLowerCase().replace(/^(ohms?|farads?|henrys?|volts?|amps?|secs?)$/i, '')
  const prefix = /^(meg|mil|.)$/.exec(suffix)?.[1] ?? ''
  const scale = SUFFIX_SCALES[prefix] ?? 1
  const value = magnitude * scale

  if (!Number.isFinite(value)) throw new Error(`${label} is outside the supported numeric range`)
  return value
}

/** Read the first present parameter from a list of accepted aliases. */
export function pickParameter(
  parameters: Readonly<Record<string, string | number | boolean>>,
  ...keys: string[]
): string | number | boolean | undefined {
  for (const key of keys) {
    const value = parameters[key]
    if (value !== undefined && value !== '') return value
  }
  return undefined
}

/** Node names are compared case-insensitively and trimmed. */
export function normalizeNodeName(node: string): string {
  return node.trim().toUpperCase()
}

const GROUND_ALIASES = new Set(['0', 'GND', 'GROUND', 'AGND', 'DGND', 'VSS'])

export const isGroundNode = (node: string): boolean => GROUND_ALIASES.has(normalizeNodeName(node))

export type DeviceKind =
  | 'resistor'
  | 'capacitor'
  | 'inductor'
  | 'voltage-source'
  | 'current-source'
  | 'diode'
  | 'ground'

export interface DeviceBase {
  /** Reference designator, e.g. `R1`. */
  name: string
  /** Positive terminal node. */
  p: string
  /** Negative terminal node. */
  n: string
}

export interface ResistorDevice extends DeviceBase {
  kind: 'resistor'
  resistance: number
}

export interface CapacitorDevice extends DeviceBase {
  kind: 'capacitor'
  capacitance: number
}

export interface InductorDevice extends DeviceBase {
  kind: 'inductor'
  inductance: number
}

export interface VoltageSourceDevice extends DeviceBase {
  kind: 'voltage-source'
  dcVoltage: number
  acMagnitude: number
  acPhaseDegrees: number
}

export interface CurrentSourceDevice extends DeviceBase {
  kind: 'current-source'
  dcCurrent: number
  acMagnitude: number
  acPhaseDegrees: number
}

export interface DiodeDevice extends DeviceBase {
  kind: 'diode'
  saturationCurrent: number
  emissionCoefficient: number
}

export type Device =
  | ResistorDevice
  | CapacitorDevice
  | InductorDevice
  | VoltageSourceDevice
  | CurrentSourceDevice
  | DiodeDevice

/** Boltzmann constant (J/K) and elementary charge (C), in SI. */
export const BOLTZMANN = 1.380649e-23
export const ELEMENTARY_CHARGE = 1.602176634e-19

/** Thermal voltage kT/q at a temperature given in degrees Celsius. */
export function thermalVoltage(celsius: number): number {
  return (BOLTZMANN * (celsius + 273.15)) / ELEMENTARY_CHARGE
}
