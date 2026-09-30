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
  /*
   * SPICE model cards are conventionally written in upper case (`BF=200`),
   * while the component library uses camelCase keys, so fall back to a
   * case-insensitive match before giving up.
   */
  const entries = Object.entries(parameters)
  for (const key of keys) {
    const wanted = key.toLowerCase()
    for (const [name, value] of entries) {
      if (name.toLowerCase() === wanted && value !== undefined && value !== '') return value
    }
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
  | 'bjt'
  | 'mosfet'
  | 'op-amp'
  | 'vcvs'
  | 'vccs'
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
  /** Transient waveform, when the source is a PULSE or SINE generator. */
  waveform?: SourceWaveform
}

export interface CurrentSourceDevice extends DeviceBase {
  kind: 'current-source'
  dcCurrent: number
  acMagnitude: number
  acPhaseDegrees: number
  /** Transient waveform, when the source is a PULSE or SINE generator. */
  waveform?: SourceWaveform
}

export interface DiodeDevice extends DeviceBase {
  kind: 'diode'
  saturationCurrent: number
  emissionCoefficient: number
}

/* ────────────────────────────────────────────────────────────────────────────
 * Transient source waveforms (SPICE PULSE and SINE semantics)
 * ──────────────────────────────────────────────────────────────────────────── */

export interface PulseWaveform {
  kind: 'pulse'
  /** Initial (low) level. */
  v1: number
  /** Pulsed (high) level. */
  v2: number
  /** Delay before the first pulse, seconds. */
  td: number
  /** Rise time, seconds. */
  tr: number
  /** Fall time, seconds. */
  tf: number
  /** Pulse width (high time measured from the end of the rise), seconds. */
  pw: number
  /** Period, seconds. */
  per: number
}

export interface SineWaveform {
  kind: 'sine'
  /** DC offset. */
  vo: number
  /** Peak amplitude. */
  va: number
  /** Frequency in hertz. */
  freq: number
  /** Exponential damping factor, per second (0 = undamped). */
  theta: number
  /** Phase in degrees at t = td. */
  phase: number
  /** Delay before the oscillation starts, seconds. */
  td: number
}

export type SourceWaveform = PulseWaveform | SineWaveform

/**
 * Evaluate a source waveform at `time`.
 *
 * Semantics follow SPICE exactly: before `td` a pulse sits at `v1` and a sine
 * sits at its offset `vo`; SPICE's `PULSE` measures `pw` from the end of the
 * rise to the start of the fall.
 */
export function waveformValue(waveform: SourceWaveform, time: number): number {
  if (waveform.kind === 'pulse') {
    const { v1, v2, td, tr, tf, pw, per } = waveform
    if (time < td || per <= 0) return v1
    const phase = (time - td) % per
    if (phase < tr) return v1 + ((v2 - v1) * phase) / tr
    if (phase < tr + pw) return v2
    if (phase < tr + pw + tf) return v2 + ((v1 - v2) * (phase - tr - pw)) / tf
    return v1
  }
  const { vo, va, freq, theta, phase, td } = waveform
  if (time < td) return vo
  const elapsed = time - td
  const angle = 2 * Math.PI * freq * elapsed + (phase * Math.PI) / 180
  return vo + va * Math.exp(-theta * elapsed) * Math.sin(angle)
}

/**
 * The value a source contributes to the DC operating point.
 *
 * A waveform source rests at its initial level (`v1`/`vo`), which is also the
 * value at t = 0, so a transient run starts without a discontinuous jump.
 */
export function sourceDcValue(dcValue: number, waveform: SourceWaveform | undefined): number {
  if (!waveform) return dcValue
  return waveform.kind === 'pulse' ? waveform.v1 : waveform.vo
}

/** Transient value of a source at `time`. */
export function sourceTransientValue(
  dcValue: number,
  waveform: SourceWaveform | undefined,
  time: number,
): number {
  return waveform ? waveformValue(waveform, time) : dcValue
}

/* ────────────────────────────────────────────────────────────────────────────
 * Bipolar junction transistor (Gummel–Poon, SPICE level 1)
 * ──────────────────────────────────────────────────────────────────────────── */

export interface BjtModelParams {
  /** Transport saturation current, A. */
  is: number
  /** Ideal maximum forward beta. */
  bf: number
  /** Ideal maximum reverse beta. */
  br: number
  /** Forward emission coefficient. */
  nf: number
  /** Reverse emission coefficient. */
  nr: number
  /** Forward Early voltage, V (∞ = ideal). */
  vaf: number
  /** Reverse Early voltage, V (∞ = ideal). */
  var: number
  /** Forward high-current beta rolloff corner, A (∞ = off). */
  ikf: number
  /** Reverse high-current beta rolloff corner, A (∞ = off). */
  ikr: number
  /** B–E leakage saturation current, A (0 = off). */
  ise: number
  /** B–E leakage emission coefficient. */
  ne: number
  /** B–C leakage saturation current, A (0 = off). */
  isc: number
  /** B–C leakage emission coefficient. */
  nc: number
  /** B–E zero-bias depletion capacitance, F. */
  cje: number
  /** B–E built-in potential, V. */
  vje: number
  /** B–E junction exponential factor. */
  mje: number
  /** B–C zero-bias depletion capacitance, F. */
  cjc: number
  /** B–C built-in potential, V. */
  vjc: number
  /** B–C junction exponential factor. */
  mjc: number
  /** Forward-bias capacitance blend coefficient (0..1). */
  fc: number
  /** Ideal forward transit time, s. */
  tf: number
  /** Ideal reverse transit time, s. */
  tr: number
  /** Zero-bias base resistance, Ω. */
  rb: number
  /** Collector resistance, Ω. */
  rc: number
  /** Emitter resistance, Ω. */
  re: number
}

export interface BjtDevice extends DeviceBase {
  kind: 'bjt'
  polarity: 'npn' | 'pnp'
  /** External terminals (SPICE order: collector, base, emitter). */
  c: string
  b: string
  e: string
  /**
   * Nodes the junctions and transport currents connect to. Equal to the
   * external terminals unless a series resistance splits them with an
   * internal node (RB/RC/RE > 0, as in real SPICE model cards).
   */
  cInt: string
  bInt: string
  eInt: string
  model: BjtModelParams
}

/* ────────────────────────────────────────────────────────────────────────────
 * MOSFET (SPICE level 1, Shichman–Hodges)
 * ──────────────────────────────────────────────────────────────────────────── */

export interface MosfetModelParams {
  /** Zero-bias threshold voltage, V (negative for a typical P-channel part). */
  vto: number
  /** Transconductance KP·(W/L), A/V². */
  kp: number
  /** Body-effect coefficient γ, V^0.5. */
  gamma: number
  /** Surface potential φ, V. */
  phi: number
  /** Channel-length modulation, 1/V. */
  lambda: number
  /** Body (source–bulk) diode saturation current, A. */
  is: number
  /** Body diode emission coefficient. */
  n: number
  /** Gate–source capacitance, F. */
  cgs: number
  /** Gate–drain capacitance, F. */
  cgd: number
}

export interface MosfetDevice extends DeviceBase {
  kind: 'mosfet'
  polarity: 'n' | 'p'
  d: string
  g: string
  s: string
  /** Bulk node. Equals the source for three-terminal parts. */
  b: string
  model: MosfetModelParams
}

/* ────────────────────────────────────────────────────────────────────────────
 * Op-amp macromodel and controlled sources
 * ──────────────────────────────────────────────────────────────────────────── */

export interface OpAmpDevice extends DeviceBase {
  kind: 'op-amp'
  inP: string
  inN: string
  out: string
  /** Supply rail nodes; undefined when the pin is unconnected (fixed rails). */
  vPlusNode?: string
  vMinusNode?: string
  /** Fallback rails used when the supply pins are unconnected, volts. */
  vPlusFixed: number
  vMinusFixed: number
  /** First-stage output node (internal; never exposed on the schematic). */
  internal: string
  /** Open-loop DC gain, V/V. */
  gain: number
  /** Gain–bandwidth product, Hz. */
  gbw: number
  /** Slew rate, V/s. */
  slew: number
  /** Differential input resistance, Ω. */
  rin: number
  /** Open-loop output resistance, Ω. */
  rout: number
  /** Output headroom from each rail, volts. */
  dropout: number
}

export interface VcvsDevice extends DeviceBase {
  kind: 'vcvs'
  ip: string
  inn: string
  gain: number
}

export interface VccsDevice extends DeviceBase {
  kind: 'vccs'
  ip: string
  inn: string
  /** Transconductance, A/V. */
  gain: number
}

export type Device =
  | ResistorDevice
  | CapacitorDevice
  | InductorDevice
  | VoltageSourceDevice
  | CurrentSourceDevice
  | DiodeDevice
  | BjtDevice
  | MosfetDevice
  | OpAmpDevice
  | VcvsDevice
  | VccsDevice

/**
 * Every MNA unknown a device touches, de-duplicated, in terminal order.
 *
 * `buildCircuitModel` discovers unknowns through this function, so any new
 * device (or an internal node it introduces) is registered automatically.
 */
export function deviceNodes(device: Device): string[] {
  const nodes: string[] = []
  const push = (node: string | undefined): void => {
    if (node !== undefined && !nodes.includes(node)) nodes.push(node)
  }
  switch (device.kind) {
    case 'bjt':
      push(device.c)
      push(device.b)
      push(device.e)
      push(device.cInt)
      push(device.bInt)
      push(device.eInt)
      break
    case 'mosfet':
      push(device.d)
      push(device.g)
      push(device.s)
      push(device.b)
      break
    case 'op-amp':
      push(device.inP)
      push(device.inN)
      push(device.out)
      push(device.vPlusNode)
      push(device.vMinusNode)
      push(device.internal)
      break
    case 'vcvs':
    case 'vccs':
      push(device.p)
      push(device.n)
      push(device.ip)
      push(device.inn)
      break
    default:
      push(device.p)
      push(device.n)
      break
  }
  return nodes
}

/** Internal (implementation-detail) nodes are hidden from results. */
export const isInternalNode = (node: string): boolean => node.startsWith('INT_')

/** Boltzmann constant (J/K) and elementary charge (C), in SI. */
export const BOLTZMANN = 1.380649e-23
export const ELEMENTARY_CHARGE = 1.602176634e-19

/** Thermal voltage kT/q at a temperature given in degrees Celsius. */
export function thermalVoltage(celsius: number): number {
  return (BOLTZMANN * (celsius + 273.15)) / ELEMENTARY_CHARGE
}
