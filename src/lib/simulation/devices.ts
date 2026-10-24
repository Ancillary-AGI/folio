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
  n: 1e-9,
  p: 1e-12,
  f: 1e-15,
}

const VALUE_PATTERN = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*([a-zΩω℧]*)$/i

/**
 * The micro sign (`µ`, U+00B5) and Greek mu (`μ`, U+03BC) look identical and
 * users paste either one — plus capital Mu from a formula sheet. They are all
 * folded to SPICE's ASCII `u` before anything else looks at the text, so the
 * scale table keeps one spelling instead of twin keys that read as a duplicate.
 */
const normalizeMicroSigns = (text: string): string => text.replace(/[µμ]/gi, 'u')

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

  const match = VALUE_PATTERN.exec(normalizeMicroSigns(rawValue.trim()))
  if (!match) throw new Error(`${label} is not a valid SPICE value: "${rawValue}"`)

  const magnitude = Number(match[1])
  /*
   * Trailing units ("10kohm", "1uF", "1mA", "5V", "4.7kΩ"): strip a
   * leading SI word or symbol, then read the longest known scale prefix.
   * `m` before `a` is milli (1mA = 1e-3), while a bare `m` alone is also
   * milli and a bare `a`/`v`/… alone is a unit with scale 1 — so "1m" is
   * 1e-3 but "5V" is 5, never 5e15.
   */
  const suffix = match[2].toLowerCase()
  const unitStripped = suffix.replace(
    /^(ohms?|ohms|farads?|henrys?|henries|volts?|amps?|amperes?|seconds?|secs?|hertz|hz|siemens|watts?|joules?|coulombs?|teslas?|webers?|Ω|ω|℧)$/,
    '',
  )
  const scaleKeys = Object.keys(SUFFIX_SCALES).sort((a, b) => b.length - a.length)
  let prefix = ''
  for (const key of scaleKeys) {
    if (unitStripped === key || (key.length === 3 && unitStripped.startsWith(key))) {
      prefix = key
      break
    }
  }
  if (prefix === '' && unitStripped.length > 0) {
    const first = unitStripped[0]
    // A lone unit letter ("5V", "1A", "2s") is scale 1, not a prefix: only
    // the known scale letters (t g k m u n p f) count, and `m` alone IS milli.
    // (Micro signs were already folded to `u` above.)
    if (first === 't' || first === 'g' || first === 'k' || first === 'm' || first === 'u' || first === 'n' || first === 'p' || first === 'f') {
      prefix = first
    }
  }
  const scale = prefix === '' ? 1 : (SUFFIX_SCALES[prefix] ?? 1)
  const value = magnitude * scale

  if (!Number.isFinite(value)) throw new Error(`${label} is outside the supported numeric range`)
  return value
}

/**
 * Parse a physical dimension in millimetres.
 *
 * A bare number means millimetres (the unit PCB geometry is drawn in). An
 * explicit `mm` suffix is handled here because `parseSpiceValue` reads its
 * first `m` as the milli prefix and would return metres.
 */
export function parseMillimetres(
  rawValue: string | number | boolean | undefined,
  label: string,
): number | undefined {
  if (rawValue === undefined || rawValue === '') return undefined
  if (typeof rawValue === 'string') {
    const explicit = /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*mm\s*$/i.exec(rawValue)
    if (explicit) return Number(explicit[1])
  }
  return parseSpiceValue(rawValue, label)
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
  | 'transmission-line'
  | 'voltage-source'
  | 'current-source'
  | 'diode'
  | 'bjt'
  | 'mosfet'
  | 'jfet'
  | 'voltage-switch'
  | 'current-switch'
  | 'behavioral-source'
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

/**
 * Lossless transmission line (SPICE `T` element).
 *
 * Port 1 is `p`/`n` and port 2 is `p2`/`n2`. `td` is the one-way propagation
 * delay, not the round-trip time.
 */
export interface TransmissionLineDevice extends DeviceBase {
  kind: 'transmission-line'
  p2: string
  n2: string
  /** Characteristic impedance, Ω. */
  z0: number
  /** One-way propagation delay, seconds. */
  td: number
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
 * Transient source waveforms (SPICE PULSE, SINE, EXP, SFFM and PWL semantics)
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

export type SourceWaveform =
  | PulseWaveform
  | SineWaveform
  | ExpWaveform
  | SffmWaveform
  | PwlWaveform

export interface ExpWaveform {
  kind: 'exp'
  /** Initial value. */
  v1: number
  /** Pulsed value. */
  v2: number
  /** Rise delay time, seconds. */
  td1: number
  /** Rise time constant, seconds. */
  tau1: number
  /** Fall delay time, seconds. */
  td2: number
  /** Fall time constant, seconds. */
  tau2: number
}

export interface SffmWaveform {
  kind: 'sffm'
  /** Offset voltage. */
  vo: number
  /** Amplitude. */
  va: number
  /** Carrier frequency, Hz. */
  fc: number
  /** Modulation index. */
  mdi: number
  /** Signal frequency, Hz. */
  fs: number
}

export interface PwlWaveform {
  kind: 'pwl'
  /** Time/value corners, strictly increasing in time. */
  points: Array<{ time: number; value: number }>
}

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
  if (waveform.kind === 'sine') {
    if (time < waveform.td) return waveform.vo
    const elapsed = time - waveform.td
    const angle = 2 * Math.PI * waveform.freq * elapsed + (waveform.phase * Math.PI) / 180
    return waveform.vo + waveform.va * Math.exp(-waveform.theta * elapsed) * Math.sin(angle)
  }
  if (waveform.kind === 'exp') return expWaveformValue(waveform, time)
  if (waveform.kind === 'sffm') {
    const radians = 2 * Math.PI * waveform.fc * time + waveform.mdi * Math.sin(2 * Math.PI * waveform.fs * time)
    return waveform.vo + waveform.va * Math.sin(radians)
  }
  const points = waveform.points
  if (points.length === 0) return 0
  if (time <= points[0].time) return points[0].value
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]
    const current = points[index]
    if (time <= current.time) {
      const span = current.time - previous.time
      if (!(span > 0)) return current.value
      const fraction = (time - previous.time) / span
      return previous.value + fraction * (current.value - previous.value)
    }
  }
  return points[points.length - 1].value
}

/**
 * Double-exponential pulse, SPICE `EXP(v1 v2 td1 tau1 td2 tau2)`: exponential
 * rise toward `v2` from `td1`, then exponential decay back toward `v1` from
 * `td2`.
 */
export function expWaveformValue(waveform: ExpWaveform, time: number): number {
  if (time < waveform.td1) return waveform.v1
  const tau1 = waveform.tau1 > 0 ? waveform.tau1 : Number.EPSILON
  const rise = 1 - Math.exp(-(Math.min(time, waveform.td2) - waveform.td1) / tau1)
  const level = waveform.v1 + (waveform.v2 - waveform.v1) * rise
  if (time < waveform.td2) return level
  const tau2 = waveform.tau2 > 0 ? waveform.tau2 : Number.EPSILON
  return waveform.v1 + (level - waveform.v1) * Math.exp(-(time - waveform.td2) / tau2)
}

/**
 * The value a source contributes to the DC operating point.
 *
 * A waveform source rests at its initial level (`v1`/`vo`), which is also the
 * value at t = 0, so a transient run starts without a discontinuous jump.
 */
export function sourceDcValue(dcValue: number, waveform: SourceWaveform | undefined): number {
  if (!waveform) return dcValue
  switch (waveform.kind) {
    case 'pulse':
    case 'exp':
      return waveform.v1
    case 'sine':
    case 'sffm':
      return waveform.vo
    case 'pwl':
      return waveform.points.length > 0 ? waveform.points[0].value : dcValue
  }
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

export interface JfetModelParams {
  /** Transconductance coefficient, A/V². */
  beta: number
  /** Threshold (pinch-off) voltage, V (negative for N-channel). */
  vto: number
  /** Channel-length modulation, 1/V. */
  lambda: number
  /** Gate junction saturation current, A. */
  is: number
  /** Gate emission coefficient. */
  n: number
  /** Gate–source capacitance, F. */
  cgs: number
  /** Gate–drain capacitance, F. */
  cgd: number
}

export interface JfetDevice extends DeviceBase {
  kind: 'jfet'
  /** Drain, gate and source nodes (SPICE J order: drain, gate, source). */
  d: string
  g: string
  s: string
  /** N-channel or P-channel. */
  polarity: 'n' | 'p'
  model: JfetModelParams
}

export interface VoltageSwitchDevice extends DeviceBase {
  kind: 'voltage-switch'
  /** Switched terminals. */
  p: string
  n: string
  /** Controlling nodes (in+, in−). */
  ip: string
  inn: string
  /** On resistance, Ω. */
  ron: number
  /** Off resistance, Ω. */
  roff: number
  /** Threshold voltage, V. */
  vt: number
  /** Hysteresis voltage, V. */
  vh: number
}

export interface CurrentSwitchDevice extends DeviceBase {
  kind: 'current-switch'
  /** Switched terminals. */
  p: string
  n: string
  /** Name of the controlling voltage source (SPICE W ordering). */
  controlSource: string
  /** On resistance, Ω. */
  ron: number
  /** Off resistance, Ω. */
  roff: number
  /** Threshold current, A. */
  it: number
  /** Hysteresis current, A. */
  ih: number
}

export interface BehavioralSourceDevice extends DeviceBase {
  kind: 'behavioral-source'
  /** Output terminals. */
  p: string
  n: string
  /** Output is a voltage (`v`) or a current (`i`). */
  output: 'v' | 'i'
  /** Expression in `V(node)` / `I(source)` / numbers / +-*\/^ / functions. */
  expression: string
}

export interface VcvsDevice extends DeviceBase {
  kind: 'vcvs'
  /** Controlling input nodes (in+, in−). Floated first, constrained by the branch row. */
  ip: string
  inn: string
  gain: number
}

export interface VccsDevice extends DeviceBase {
  kind: 'vccs'
  /** Controlling input nodes (in+, in−). Floating (no gate current), like a MOSFET gate. */
  ip: string
  inn: string
  /** Transconductance, A/V. */
  gain: number
}

export type Device =
  | ResistorDevice
  | CapacitorDevice
  | InductorDevice
  | TransmissionLineDevice
  | VoltageSourceDevice
  | CurrentSourceDevice
  | DiodeDevice
  | BjtDevice
  | MosfetDevice
  | OpAmpDevice
  | JfetDevice
  | VoltageSwitchDevice
  | CurrentSwitchDevice
  | BehavioralSourceDevice
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
    case 'transmission-line':
      push(device.p)
      push(device.n)
      push(device.p2)
      push(device.n2)
      break
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
      push(device.internal)
      if (device.vPlusNode !== undefined) push(device.vPlusNode)
      if (device.vMinusNode !== undefined) push(device.vMinusNode)
      break
    case 'jfet':
      push(device.d)
      push(device.g)
      push(device.s)
      break
    case 'voltage-switch':
    case 'current-switch':
    case 'behavioral-source':
      push(device.p)
      push(device.n)
      // Control draws no current; discovered only when wired elsewhere.
      break
    case 'vcvs':
      push(device.p)
      push(device.n)
      // An ideal voltage source pins its output to the control input exactly,
      // so the two output nodes are the only new unknowns: control nets must
      // already exist elsewhere or the source is genuinely floating there.
      break
    case 'vccs':
      push(device.p)
      push(device.n)
      // A current source draws no control current, so its control nodes float
      // like MOSFET gates: discovered when (and only when) wired elsewhere.
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
