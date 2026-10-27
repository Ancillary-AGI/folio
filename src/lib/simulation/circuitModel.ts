/**
 * Circuit model construction.
 *
 * Turns a parsed `CircuitNetlist` into:
 *   • a typed device list (see `devices.ts`), and
 *   • the unknown vector layout used by modified nodal analysis (MNA).
 *
 * MNA layout
 * ----------
 *   [ 0 .. nodeCount-1 ]   node voltages (ground excluded)
 *   [ nodeCount .. ]       branch currents, one row per voltage source and
 *                          per inductor
 *
 * Voltage sources and inductors need a current unknown because their defining
 * equation is a voltage constraint, not a conductance. That is the point of MNA
 * over plain nodal analysis, and why a lone voltage source across two nodes is
 * solvable here while it would be singular with conductances alone.
 */

import {
  parseSpiceValue,
  parseMillimetres,
  normalizeNodeName,
  isGroundNode,
  pickParameter,
  deviceNodes,
  type BehavioralSourceDevice,
  type BjtModelParams,
  type Device,
  type InductorDevice,
  type JfetModelParams,
  type MosfetModelParams,
  type SourceWaveform,
} from './devices'
import type { CircuitNetlist, Component } from './spiceEngine'
import { microstripEffectiveEr, tdFromGeometry, z0FromGeometry } from './transmissionLine'
import { probeFromTestPoint, normalizeProbeRequests } from './probes'
import type { ProbeRequest, RawProbe } from './probes'
import type { CoupledInductorPair } from './transformerMutual'
import {
  modelCardDeviceKind,
  modelCardPolarity,
  normalizeModelCards,
  resolveModelCard,
  type ModelDeviceKind,
  type SpiceModelCard,
} from './modelLibrary'

/** Auxiliary MNA rows carrying the two port currents of a transmission line. */
export interface TransmissionLineBranchRows {
  port1: number
  port2: number
}

export interface CircuitModel {
  devices: Device[]
  /** Non-ground node names, sorted for a deterministic unknown ordering. */
  nodeNames: string[]
  /** Node name → row index. */
  nodeIndex: Map<string, number>
  /** Device name → branch-current row index (voltage sources and inductors). */
  branchRows: Map<string, number>
  /** Transmission-line port currents, keyed by device name. */
  lineRows: Map<string, TransmissionLineBranchRows>
  /** Total number of unknowns (node voltages + branch currents). */
  size: number
  /** Every node name that is ground, including aliases found on devices. */
  groundNodes: Set<string>
  /** Non-fatal observations worth surfacing to the user. */
  notes: string[]
  /** Normalized simulation probes / test points. */
  probes: ProbeRequest[]
  /** Coupled inductor pairs (SPICE `K` cards / transformer windings). */
  couplings: CoupledInductorPair[]
}

export interface BuildModelResult {
  model: CircuitModel
  /** Fatal problems. When non-empty the model must not be simulated. */
  errors: string[]
}

type DeviceKind = Device['kind']

/**
 * Component classification, in priority order. The `type` string is matched
 * first and is authoritative; the reference-designator prefix is the fallback
 * for hand-written netlists, which is the SPICE convention.
 */
const CLASSIFIERS: ReadonlyArray<{ kind: DeviceKind | 'ground'; matches: (type: string, name: string) => boolean }> = [
  /*
   * Controlled sources are matched before the independent sources and before
   * ground: their type strings also contain "voltage"/"current"/"source", and
   * a VCCS instance may carry the G designator that otherwise means ground.
   * `classify` strips every non-letter from the type string, so matchers see
   * `voltagecontrolledvoltagesource` (underscores and hyphens are gone) while
   * the name fallback still receives the raw reference designator.
   */
  {
    kind: 'vccs',
    matches: (type) => type.includes('voltagecontrolledcurrent'),
  },
  { kind: 'vcvs', matches: (type, name) => type.includes('voltagecontrolledvoltage') || /^e\d/i.test(name) },
  { kind: 'ground', matches: (type, name) => type.includes('ground') || /^gnd$|^g\d/i.test(name) },
  {
    kind: 'voltage-source',
    matches: (type, name) =>
      (type.includes('voltage') && type.includes('source') && !type.includes('controlled') && !type.includes('behavioral') && !type.includes('arbitrary')) ||
      (/^v\d/i.test(name) && !/^vsense/i.test(name)),
  },
  {
    kind: 'current-source',
    matches: (type, name) =>
      (type.includes('current') && type.includes('source') && !type.includes('controlled') && !type.includes('behavioral') && !type.includes('arbitrary')) ||
      /^i\d/i.test(name),
  },
  {
    kind: 'op-amp',
    matches: (type) => type.includes('opamp') || type.includes('op_amp') || (type.includes('operational') && type.includes('amplifier')),
  },
  {
    kind: 'transmission-line',
    matches: (type, name) =>
      type.includes('transmissionline') || type.includes('delayline') || type.includes('tline') || /^tl?\d/i.test(name),
  },
  { kind: 'mosfet', matches: (type, name) => type.includes('mosfet') || /^m\d/i.test(name) },
  { kind: 'jfet', matches: (type, name) => type.includes('jfet') || /^j\d/i.test(name) },
  {
    kind: 'voltage-switch',
    matches: (type, name) => type.includes('voltageswitch') || type.includes('voltagecontrolledswitch') || /^s\d/i.test(name),
  },
  {
    kind: 'current-switch',
    matches: (type, name) => type.includes('currentswitch') || type.includes('currentcontrolledswitch') || /^w\d/i.test(name),
  },
  {
    kind: 'behavioral-source',
    matches: (type, name) => type.includes('behavioral') || type.includes('arbitrary') || /^b\d/i.test(name),
  },
  {
    kind: 'bjt',
    matches: (type, name) =>
      type.includes('npn') || type.includes('pnp') || type.includes('bjt') || /^q\d/i.test(name),
  },
  { kind: 'capacitor', matches: (type, name) => type.includes('capacit') || /^c\d/i.test(name) },
  { kind: 'inductor', matches: (type, name) => type.includes('induct') || /^l\d/i.test(name) },
  {
    kind: 'diode',
    matches: (type, name) =>
      type.includes('diode') || type.includes('led') || type.includes('rectifier') || /^d\d/i.test(name),
  },
  {
    kind: 'resistor',
    matches: (type, name) =>
      type.includes('resistor') || type.includes('resistance') || type.includes('potentiometer') || /^r\d/i.test(name),
  },
]

function classify(component: Component): DeviceKind | 'ground' | null {
  const type = `${component.type} ${component.name}`.toLowerCase().replace(/[^a-z]/g, '')
  for (const classifier of CLASSIFIERS) {
    if (classifier.matches(type, component.name)) return classifier.kind
  }
  return null
}

/** A four-terminal transformer symbol: two windings plus a coupling factor. */
function isTransformerComponent(component: Component): boolean {
  const type = `${component.type}`.toLowerCase().replace(/[^a-z0-9]+/g, '')
  return type.includes('transformer') || type.includes('coupledinductor')
}

/** A SPICE `K` card: no terminals, references two existing inductors. */
function isCouplingComponent(component: Component): boolean {
  if (component.nodes.length !== 0) return false
  const type = `${component.type} ${component.name}`.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const referenced =
    pickParameter(component.parameters, 'l1', 'primary', 'primaryInductance') !== undefined
    && pickParameter(component.parameters, 'l2', 'secondary', 'secondaryInductance') !== undefined
    && pickParameter(component.parameters, 'k', 'coupling') !== undefined
  return referenced && (type.includes('mutual') || type.includes('coupl') || /^k\d/i.test(component.name))
}

/** Terminals emitted by the netlist builder for pins with no wire attached. */
const isUnconnectedNode = (node: string): boolean => node.startsWith('NC_')

/** Read a required numeric parameter, with the alias list and label supplied. */
function requiredValue(component: Component, label: string, ...keys: string[]): number {
  return parseSpiceValue(pickParameter(component.parameters, ...keys), `${component.name} ${label}`)
}

/** Read an optional numeric parameter, falling back to `fallback`. */
function optionalValue(component: Component, fallback: number, label: string, ...keys: string[]): number {
  const raw = pickParameter(component.parameters, ...keys)
  return raw === undefined ? fallback : parseSpiceValue(raw, `${component.name} ${label}`)
}

/** Read one of a component's physical dimensions in millimetres. */
function millimetres(component: Component, label: string, ...keys: string[]): number | undefined {
  return parseMillimetres(pickParameter(component.parameters, ...keys), `${component.name} ${label}`)
}

/**
 * Parse a gain-like parameter that accepts SPICE values as well as decibel
 * magnitudes ("100dB" → 1e5 V/V), which is how op-amp datasheets quote it.
 */
function parseGain(component: Component, fallback: number, label: string, ...keys: string[]): number {
  const raw = pickParameter(component.parameters, ...keys)
  if (raw === undefined) return fallback
  if (typeof raw === 'string') {
    const decibels = /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*dB?\s*$/i.exec(raw)
    if (decibels) return Math.pow(10, Number(decibels[1]) / 20)
  }
  return parseSpiceValue(raw, `${component.name} ${label}`)
}
/**
 * Build the transient waveform of a source: PULSE, SIN, EXP, SFFM or PWL.
 *
 * Returns `undefined` for ordinary DC parts. `v2`/`per` (pulse) and
 * `va`/`freq` (sine) are required because guessing an amplitude or a period
 * would silently produce a plausible but wrong simulation.
 */
function parseWaveform(component: Component): SourceWaveform | undefined {
  /*
   * The shape is declared either by a dedicated symbol type (`pulse_voltage_
   * source`) or by a `type`/`shape`/`waveform` parameter on a generic source,
   * which is how the DC symbol already carries its own `type: 'DC'` marker.
   */
  const declared = pickParameter(component.parameters, 'type', 'shape', 'waveform')
  const shape = `${component.type} ${component.name} ${declared ?? ''}`.toLowerCase()
  if (shape.includes('pulse')) {
    const v2 = parseSpiceValue(pickParameter(component.parameters, 'v2'), `${component.name} pulse high level (v2)`)
    const per = parseSpiceValue(pickParameter(component.parameters, 'per'), `${component.name} pulse period (per)`)
    if (!(per > 0)) throw new Error(`${component.name} pulse period (per) must be > 0.`)
    return {
      kind: 'pulse',
      v1: optionalValue(component, 0, 'pulse low level (v1)', 'v1'),
      v2,
      td: optionalValue(component, 0, 'pulse delay (td)', 'td'),
      tr: optionalValue(component, 1e-9, 'pulse rise time (tr)', 'tr'),
      tf: optionalValue(component, 1e-9, 'pulse fall time (tf)', 'tf'),
      pw: optionalValue(component, per / 2, 'pulse width (pw)', 'pw'),
      per,
    }
  }
  if (shape.includes('sine') || shape.includes('sin(')) {
    const va = parseSpiceValue(pickParameter(component.parameters, 'va'), `${component.name} sine amplitude (va)`)
    const freq = parseSpiceValue(pickParameter(component.parameters, 'freq'), `${component.name} sine frequency (freq)`)
    if (!(freq > 0)) throw new Error(`${component.name} sine frequency (freq) must be > 0.`)
    return {
      kind: 'sine',
      vo: optionalValue(component, 0, 'sine offset (vo)', 'vo'),
      va,
      freq,
      theta: optionalValue(component, 0, 'sine damping (theta)', 'theta'),
      phase: optionalValue(component, 0, 'sine phase (phase)', 'phase'),
      td: optionalValue(component, 0, 'sine delay (td)', 'td'),
    }
  }
  if (shape.includes('exp')) {
    return {
      kind: 'exp',
      v1: optionalValue(component, 0, 'exp initial value (v1)', 'v1'),
      v2: optionalValue(component, 1, 'exp pulsed value (v2)', 'v2'),
      td1: optionalValue(component, 0, 'exp rise delay (td1)', 'td1'),
      tau1: optionalValue(component, 1e-6, 'exp rise time constant (tau1)', 'tau1'),
      td2: optionalValue(component, 0, 'exp fall delay (td2)', 'td2'),
      tau2: optionalValue(component, 1e-6, 'exp fall time constant (tau2)', 'tau2'),
    }
  }
  if (shape.includes('sffm')) {
    const va = parseSpiceValue(pickParameter(component.parameters, 'va'), `${component.name} sffm amplitude (va)`)
    const fc = parseSpiceValue(pickParameter(component.parameters, 'fc'), `${component.name} sffm carrier (fc)`)
    const fs = parseSpiceValue(pickParameter(component.parameters, 'fs'), `${component.name} sffm signal (fs)`)
    if (!(fc > 0)) throw new Error(`${component.name} sffm carrier (fc) must be > 0.`)
    if (!(fs > 0)) throw new Error(`${component.name} sffm signal (fs) must be > 0.`)
    return {
      kind: 'sffm',
      vo: optionalValue(component, 0, 'sffm offset (vo)', 'vo'),
      va,
      fc,
      mdi: optionalValue(component, 0, 'sffm modulation index (mdi)', 'mdi'),
      fs,
    }
  }
  if (shape.includes('pwl') || pickParameter(component.parameters, 'points', 'pwl') !== undefined) {
    const points = parsePwlPoints(component)
    if (points.length === 0) throw new Error(`${component.name} pwl needs at least one (time, value) corner.`)
    return { kind: 'pwl', points }
  }
  return undefined
}

/**
 * Parse PWL corners from `points: "0,0 1u,5 2u,0"` or paired t0/v0/t1/v1 keys.
 * Times must be strictly increasing — a repeated time is an ambiguous edge, not
 * a zero-time ramp, and guessing would silently shift the waveform.
 */
function parsePwlPoints(component: Component): Array<{ time: number; value: number }> {
  const raw = pickParameter(component.parameters, 'points', 'pwl')
  if (typeof raw === 'string') {
    const corners = raw
      .split(/[\s;]+/)
      .filter((token) => token.length > 0)
      .map((token) => {
        const parts = token.split(',')
        if (parts.length !== 2) {
          throw new Error(`${component.name} pwl corner "${token}" must be "time,value".`)
        }
        return {
          time: parseSpiceValue(parts[0], `${component.name} pwl time`),
          value: parseSpiceValue(parts[1], `${component.name} pwl value`),
        }
      })
    assertIncreasing(corners, component.name)
    return corners
  }
  const corners: Array<{ time: number; value: number }> = []
  for (let index = 0; ; index += 1) {
    const time = pickParameter(component.parameters, `t${index}`, `time${index}`)
    const value = pickParameter(component.parameters, `v${index}`, `value${index}`)
    if (time === undefined && value === undefined) break
    if (time === undefined || value === undefined) {
      throw new Error(`${component.name} pwl corner ${index} needs both a time and a value.`)
    }
    corners.push({
      time: parseSpiceValue(time, `${component.name} pwl time ${index}`),
      value: parseSpiceValue(value, `${component.name} pwl value ${index}`),
    })
  }
  assertIncreasing(corners, component.name)
  return corners
}

function assertIncreasing(corners: Array<{ time: number; value: number }>, name: string): void {
  for (let index = 1; index < corners.length; index += 1) {
    if (!(corners[index].time > corners[index - 1].time)) {
      throw new Error(`${name} pwl times must be strictly increasing.`)
    }
  }
}

/**
 * Parse Gummel–Poon model parameters.
 *
 * Every default matches SPICE itself (verified against ngspice's parameter
 * table: `VJE/VJC = 0.75`, `MJE/MJC = 0.33`, `FC = 0.5`, `BF = 100`, `BR = 1`,
 * `NF = NR = 1`, `NE = 1.5`, `NC = 2`, `TF = TR = 0`), so a model card that
 * omits a parameter behaves exactly like the reference simulator.
 * `VAF`/`VAR`/`IKF`/`IKR` default to Infinity, meaning "not in effect".
 */
/**
 * Stock model cards keyed by part number, taken from a reference SPICE's own
 * `standard.bjt` library. The keys are bare part numbers; the lookup strips
 * manufacturer suffixes (`2N2222A` matches `2N2222`), so a suffixed symbol
 * still finds its card. Only parameters this solver models are carried over —
 * `XTB` (temperature exponent) and rating fields like `VCEO`/`ICRATING` have
 * no level-1 counterpart and are ignored. `VAR` (reverse Early) is absent on
 * purpose: reference SPICE's `standard.bjt` cards do not ship one, and the SPICE
 * default is infinity — a hand check of the library confirms this.
 *
 * Card keys are the exact SPICE names (`is`, `vaf`, `bf`, …): `modelParameter`
 * looks the card up under the canonical SPICE key only, while the user-facing
 * symbol keeps accepting every alias — so a card value can never shadow the
 * wrong field through a shared alias (`is` vs `ise`, `ikf` vs `ikr`).
 */
const BJT_MODEL_DEFAULTS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  '2N2222': { is: '1E-14', vaf: '100', bf: '200', br: '3', ikf: '0.3', cjc: '8E-12', cje: '25E-12', tf: '400E-12', tr: '100E-9', rb: '10', rc: '0.3', re: '0.2' },
  '2N3904': { is: '1E-14', vaf: '100', bf: '300', br: '4', ikf: '0.4', cjc: '4E-12', cje: '8E-12', rb: '20', rc: '0.1', re: '0.1' },
  '2N2907': { is: '1E-14', vaf: '120', bf: '250', br: '3', ikf: '0.3', cjc: '8E-12', cje: '30E-12', tf: '400E-12', tr: '100E-9', rb: '10', rc: '0.3', re: '0.2' },
  '2N3906': { is: '1E-14', vaf: '100', bf: '200', br: '4', ikf: '0.4', cjc: '4.5E-12', cje: '10E-12', rb: '20', rc: '0.1', re: '0.1' },
}

/** Part number behind the symbol's `type` property (`2N2222A` → `2N2222`).
 *
 * `type` doubles as the classification (`npn_transistor`) and as the shadow
 * carrier in hand-written netlists (`type: '2N3904'`): the classifiers consume
 * the lowercase form, the lookup consumes the stripped part number, and an
 * explicit `part`/`model`/`mpn` still wins when present.
 */
const partNumber = (component: Component): string | undefined => {
  const raw = pickParameter(component.parameters, 'part', 'model', 'mpn', 'type')
  if (typeof raw !== 'string') return undefined
  // A single trailing letter is the usual gain-bin suffix (`2N2222A`,
  // `BC547C`); anything longer is the name itself (`TL071`, `IRF540`).
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/([0-9])[A-Z]$/, '$1')
  // The classification shadows (`NPN_TRANSISTOR`, `VOLTAGE_SOURCE`) are not
  // part numbers: only a token with a digit can be one.
  if (!/\d/.test(cleaned)) return undefined
  return cleaned
}

/**
 * Merge order for every transistor parameter: a value the user typed on the
 * symbol wins, then the stock card for the part number, then the SPICE default.
 * An explicit value is never silently replaced by a library card. Infinite
 * defaults (`VAF`/`VAR`/`IKF`/`IKR` = "not in effect") are returned directly:
 * they are semantic, and `parseSpiceValue` would reject the string "Infinity".
 * The card is consulted under the single canonical SPICE key (`canonical`);
 * every other entry in `keys` is a user-facing alias the card never uses.
 */
const modelParameter = (
  component: Component,
  card: Readonly<Record<string, string>> | undefined,
  fallback: number,
  label: string,
  canonical: string,
  ...keys: string[]
): number => {
  const explicit = pickParameter(component.parameters, canonical, ...keys)
  if (explicit !== undefined) return parseSpiceValue(explicit, `${component.name} ${label}`)
  const carded = card === undefined ? undefined : pickParameter(card, canonical)
  if (carded !== undefined) return parseSpiceValue(carded, `${component.name} ${label}`)
  if (!Number.isFinite(fallback)) return fallback
  return parseSpiceValue(fallback, `${component.name} ${label}`)
}

/**
 * Card parameters this solver actually consumes, per device family.
 *
 * A reference library card carries many more fields (noise, temperature,
 * rating). Feeding those into the component would be harmless but would imply
 * they were modelled; they are reported as ignored instead.
 */
const MODELLED_CARD_PARAMETERS: Readonly<Record<ModelDeviceKind, ReadonlySet<string>>> = {
  bjt: new Set([
    'is', 'bf', 'br', 'nf', 'nr', 'vaf', 'var', 'ikf', 'ikr', 'ise', 'ne', 'isc', 'nc',
    'cje', 'vje', 'mje', 'cjc', 'vjc', 'mjc', 'fc', 'tf', 'tr', 'rb', 'rc', 're',
  ]),
  mosfet: new Set(['vto', 'kp', 'gamma', 'phi', 'lambda', 'is', 'n', 'cgs', 'cgd']),
  jfet: new Set(['beta', 'vto', 'lambda', 'is', 'n', 'cgs', 'cgd']),
  diode: new Set(['is', 'n']),
}

/**
 * Apply a `.model` card to a copied component.
 *
 * The card parameters become ordinary symbol properties, which is exactly the
 * merge point `modelParameter` already defines: an explicit symbol property
 * (spread last) wins, then the card, then the stock part-number card, then the
 * SPICE default. The card's declared type sets polarity unless the symbol
 * states one — in SPICE the card, not the reference designator, decides NPN
 * vs PNP / N vs P.
 */
function withModelCard(
  component: Component,
  card: SpiceModelCard,
  kind: ModelDeviceKind,
  notes: string[],
): Component {
  const modelled = MODELLED_CARD_PARAMETERS[kind]
  const parameters: Record<string, string | number | boolean> = {}
  const ignored: string[] = []
  for (const [key, value] of Object.entries(card.parameters)) {
    if (!modelled.has(key)) {
      ignored.push(key)
      continue
    }
    // Infinity means "not in effect" in SPICE and is the solver's own default.
    if (Number.isFinite(value)) parameters[key] = value
  }
  if (ignored.length > 0) {
    notes.push(
      `${component.name}: SPICE model ${card.name} parameters with no equivalent here are ignored: ` +
        `${ignored.join(', ')}.`,
    )
  }
  const polarity = modelCardPolarity(card)
  if (polarity && pickParameter(component.parameters, 'polarity') === undefined) {
    parameters.polarity = polarity
  }
  return { ...component, parameters: { ...parameters, ...component.parameters } }
}

function parseBjtModel(component: Component): { polarity: 'npn' | 'pnp'; model: BjtModelParams } {
  const declared = `${component.type} ${component.name}`.toLowerCase().replace(/[^a-z]/g, '')
  const requested = pickParameter(component.parameters, 'polarity')
  const polarity: 'npn' | 'pnp' =
    typeof requested === 'string' && requested.toLowerCase().includes('pnp')
      ? 'pnp'
      : declared.includes('pnp')
        ? 'pnp'
        : 'npn'
  const part = partNumber(component)
  const card = part === undefined ? undefined : BJT_MODEL_DEFAULTS[part]
  return {
    polarity,
    model: {
      is: modelParameter(component, card, 1e-14, 'saturation current (is)', 'is'),
      bf: modelParameter(component, card, 100, 'forward beta (bf)', 'bf'),
      br: modelParameter(component, card, 1, 'reverse beta (br)', 'br'),
      nf: modelParameter(component, card, 1, 'forward emission coefficient (nf)', 'nf'),
      nr: modelParameter(component, card, 1, 'reverse emission coefficient (nr)', 'nr'),
      vaf: modelParameter(component, card, Infinity, 'forward Early voltage (vaf)', 'vaf'),
      var: modelParameter(component, card, Infinity, 'reverse Early voltage (var)', 'var'),
      ikf: modelParameter(component, card, Infinity, 'forward rolloff corner (ikf)', 'ikf'),
      ikr: modelParameter(component, card, Infinity, 'reverse rolloff corner (ikr)', 'ikr'),
      ise: modelParameter(component, card, 0, 'B–E leakage current (ise)', 'ise'),
      ne: modelParameter(component, card, 1.5, 'B–E leakage coefficient (ne)', 'ne'),
      isc: modelParameter(component, card, 0, 'B–C leakage current (isc)', 'isc'),
      nc: modelParameter(component, card, 2, 'B–C leakage coefficient (nc)', 'nc'),
      cje: modelParameter(component, card, 0, 'B–E capacitance (cje)', 'cje'),
      vje: modelParameter(component, card, 0.75, 'B–E built-in potential (vje)', 'vje'),
      mje: modelParameter(component, card, 0.33, 'B–E exponent (mje)', 'mje'),
      cjc: modelParameter(component, card, 0, 'B–C capacitance (cjc)', 'cjc'),
      vjc: modelParameter(component, card, 0.75, 'B–C built-in potential (vjc)', 'vjc'),
      mjc: modelParameter(component, card, 0.33, 'B–C exponent (mjc)', 'mjc'),
      fc: modelParameter(component, card, 0.5, 'capacitance blend coefficient (fc)', 'fc'),
      tf: modelParameter(component, card, 0, 'forward transit time (tf)', 'tf'),
      tr: modelParameter(component, card, 0, 'reverse transit time (tr)', 'tr'),
      rb: modelParameter(component, card, 0, 'base resistance (rb)', 'rb'),
      rc: modelParameter(component, card, 0, 'collector resistance (rc)', 'rc'),
      re: modelParameter(component, card, 0, 'emitter resistance (re)', 're'),
    },
  }
}

/**
 * Stock level-1 cards keyed by part number. Discrete power MOSFETs ship as
 * VDMOS subcircuits in reference SPICE's `standard.mos`, whose dozens of parameters
 * have no level-1 counterpart; what a level-1 card needs is the threshold and
 * the transconductance, and those come from the datasheet instead:
 *
 *   N-channel IRF540: VGS(th) 2–4 V (use 2.8), ID = 14 A at VGS = 10 V with
 *     a ~5 V overdrive → KP ≈ 2·ID/Vov² ≈ 1.1 A/V².
 *   P-channel IRF9540: VGS(th) −2…−4 V (use −2.8), ID = −23 A at VGS = −10 V
 *     → KP ≈ 1.7 A/V².
 *
 * Large KP values are the honest consequence of real power FETs — the solver
 * handles them with the same voltage clamping as small-signal parts.
 */
const MOSFET_MODEL_DEFAULTS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  IRF540: { vto: '2.8', kp: '1.1', lambda: '0.005' },
  IRF9540: { vto: '-2.8', kp: '1.7', lambda: '0.005' },
}

/**
 * Stock JFET cards keyed by part number, from datasheet numbers:
 *
 *   2N3819: IDSS 2–20 mA (typ 10 mA), VGS(off) −8 V max (typ −3 V);
 *     beta = IDSS / VTO² ≈ 10 mA / 9 ≈ 1.1 mA/V².
 *   J201: small-signal JFET, IDSS 0.2–1 mA (typ 0.6 mA), VGS(off) −0.3…−1.5 V
 *     (typ −0.7 V); beta ≈ 0.6 mA / 0.49 ≈ 1.2 mA/V².
 */
const JFET_MODEL_DEFAULTS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  '2N3819': { beta: '1.1e-3', vto: '-3', lambda: '0.005' },
  J201: { beta: '1.2e-3', vto: '-0.7', lambda: '0.01' },
}

/** Parse SPICE JFET model parameters, with SPICE's own defaults. */
function parseJfetModel(component: Component): { polarity: 'n' | 'p'; model: JfetModelParams } {
  const declared = `${component.type} ${component.name}`.toLowerCase().replace(/[^a-z]/g, '')
  const requested = pickParameter(component.parameters, 'polarity')
  const polarity: 'n' | 'p' =
    typeof requested === 'string' && requested.toLowerCase().startsWith('p')
      ? 'p'
      : declared.includes('pchannel') || declared.includes('pjfet')
        ? 'p'
        : 'n'
  const part = partNumber(component)
  const card = part === undefined ? undefined : JFET_MODEL_DEFAULTS[part]
  return {
    polarity,
    model: {
      beta: modelParameter(component, card, 1e-4, 'transconductance (beta)', 'beta', 'kp', 'k'),
      // N-channel pinch-off is negative; a positive VTO on an N part is a sign
      // error the user will never spot from a flat IV curve, so normalise it.
      vto: modelParameter(component, card, polarity === 'n' ? -2 : 2, 'threshold (vto)', 'vto', 'vth'),
      lambda: modelParameter(component, card, 0, 'channel-length modulation (lambda)', 'lambda'),
      is: modelParameter(component, card, 1e-14, 'gate saturation current (is)', 'is'),
      n: modelParameter(component, card, 1, 'gate emission coefficient (n)', 'n'),
      cgs: modelParameter(component, card, 0, 'gate–source capacitance (cgs)', 'cgs'),
      cgd: modelParameter(component, card, 0, 'gate–drain capacitance (cgd)', 'cgd'),
    },
  }
}

/** Parse Level-1 MOSFET model parameters, with SPICE's own defaults. */
function parseMosfetModel(component: Component): { polarity: 'n' | 'p'; model: MosfetModelParams } {
  const declared = `${component.type} ${component.name}`.toLowerCase().replace(/[^a-z]/g, '')
  const requested = pickParameter(component.parameters, 'polarity')
  const polarity: 'n' | 'p' =
    typeof requested === 'string' && requested.toLowerCase().startsWith('p')
      ? 'p'
      : declared.includes('pchannel') || declared.includes('pmos')
        ? 'p'
        : 'n'
  const mosPart = partNumber(component)
  const mosCard = mosPart === undefined ? undefined : MOSFET_MODEL_DEFAULTS[mosPart]
  return {
    polarity,
    model: {
      vto: modelParameter(component, mosCard, 0, 'threshold voltage (vto)', 'vto', 'vth', 'vt'),
      kp: modelParameter(component, mosCard, 2e-5, 'transconductance (kp)', 'kp', 'k'),
      gamma: modelParameter(component, mosCard, 0, 'body effect (gamma)', 'gamma'),
      phi: modelParameter(component, mosCard, 0.6, 'surface potential (phi)', 'phi'),
      lambda: modelParameter(component, mosCard, 0, 'channel-length modulation (lambda)', 'lambda'),
      is: modelParameter(component, mosCard, 1e-14, 'body diode saturation current (is)', 'is'),
      n: modelParameter(component, mosCard, 1, 'body diode coefficient (n)', 'n'),
      cgs: modelParameter(component, mosCard, 0, 'gate–source capacitance (cgs)', 'cgs'),
      cgd: modelParameter(component, mosCard, 0, 'gate–drain capacitance (cgd)', 'cgd'),
    },
  }
}

/**
 * Stock op-amp cards keyed by part number, from the datasheet numbers every
 * E-CAD user expects:
 *
 *   LM358: GBW 1 MHz, slew 0.5 V/µs, bipolar inputs (2 MΩ differential),
 *     1.5 V headroom hits both rails on a single 32 V-capable part.
 *   TL071: JFET inputs (1 TΩ), GBW 3 MHz, slew 13 V/µs.
 *   LM741: the classic — GBW 1 MHz, slew 0.5 V/µs.
 */
const OPAMP_MODEL_DEFAULTS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  LM358: { gain: '100dB', gbw: '1MHz', slew: '0.5e6', rin: '2MEG', rout: '50', vPlus: '16', vMinus: '-16', dropout: '1.5' },
  TL071: { gain: '106dB', gbw: '3MHz', slew: '13e6', rin: '1T', rout: '50', vPlus: '15', vMinus: '-15', dropout: '1.5' },
  LM741: { gain: '100dB', gbw: '1MHz', slew: '0.5e6', rin: '2MEG', rout: '75', vPlus: '15', vMinus: '-15', dropout: '1.5' },
}

/**
 * Merge order for op-amp scalars: explicit symbol value, then the stock card,
 * then the generic default. `modelParameter` cannot be reused directly because
 * gain accepts decibels (`100dB`), which `parseSpiceValue` would reject.
 */
const opAmpParameter = (
  component: Component,
  card: Readonly<Record<string, string>> | undefined,
  fallback: string | number,
  label: string,
  ...keys: string[]
): number => {
  const explicit = pickParameter(component.parameters, ...keys)
  if (explicit !== undefined) return parseGain(component, NaN, label, ...keys)
  const carded = card === undefined ? undefined : pickParameter(card, ...keys)
  if (carded !== undefined) {
    if (typeof carded === 'string') {
      const decibels = /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*dB?\s*$/i.exec(carded)
      if (decibels) return Math.pow(10, Number(decibels[1]) / 20)
    }
    return parseSpiceValue(carded, `${component.name} ${label}`)
  }
  return typeof fallback === 'number' ? fallback : parseSpiceValue(fallback, `${component.name} ${label}`)
}

/**
 * Convert one classified component into a `Device`.
 * Returns an error message instead of throwing so a single bad part does not
 * hide every other problem in the schematic. `netlist` is the full component
 * list, for cross-references (current-controlled switches name their sensor).
 */
function toDevice(
  component: Component,
  kind: DeviceKind,
  nodes: readonly string[],
  netlist: CircuitNetlist,
): { device: Device } | { error: string } {
  /* Two-terminal devices share one code path; wider devices index explicitly. */
  const p = nodes[0]
  const n = nodes[1]
  try {
    switch (kind) {
      case 'resistor': {
        const resistance = requiredValue(component, 'resistance', 'resistance', 'value', 'r')
        if (resistance <= 0) return { error: `${component.name} resistance must be > 0 Ω (got ${resistance}).` }
        return { device: { kind, name: component.name, p, n, resistance } }
      }
      case 'capacitor': {
        const capacitance = requiredValue(component, 'capacitance', 'capacitance', 'value', 'c')
        if (capacitance <= 0) return { error: `${component.name} capacitance must be > 0 F (got ${capacitance}).` }
        return { device: { kind, name: component.name, p, n, capacitance } }
      }
      case 'inductor': {
        const inductance = requiredValue(component, 'inductance', 'inductance', 'value', 'l')
        if (inductance <= 0) return { error: `${component.name} inductance must be > 0 H (got ${inductance}).` }
        return { device: { kind, name: component.name, p, n, inductance } }
      }
      case 'transmission-line': {
        const p2 = nodes[2]
        const n2 = nodes[3]
        if (p === p2 || (isGroundNode(p) && isGroundNode(p2))) {
          return {
            error:
              `${component.name} has both positive terminals on the same net (${p}); ` +
              'a transmission line must connect two different ports in series.',
          }
        }

        const width = millimetres(component, 'trace width', 'widthMm', 'traceWidth', 'width', 'w')
        const height = millimetres(component, 'substrate height', 'heightMm', 'substrateHeight', 'height', 'h')
        const erRaw = pickParameter(component.parameters, 'er', 'epsilonR', 'dielectricConstant', 'dk')
        const epsilonR =
          erRaw === undefined ? undefined : parseSpiceValue(erRaw, `${component.name} relative permittivity (er)`)

        const z0Raw = pickParameter(component.parameters, 'z0', 'characteristicImpedance', 'impedance', 'zo')
        let z0: number
        if (z0Raw !== undefined) {
          z0 = parseSpiceValue(z0Raw, `${component.name} characteristic impedance (z0)`)
        } else if (width !== undefined && height !== undefined && epsilonR !== undefined) {
          z0 = z0FromGeometry(width, height, epsilonR)
        } else {
          return {
            error: `${component.name} needs a characteristic impedance (z0), or width/height/er to derive it.`,
          }
        }
        if (!(z0 > 0) || !Number.isFinite(z0)) {
          return { error: `${component.name} characteristic impedance must be > 0 Ω (got ${z0}).` }
        }

        const tdRaw = pickParameter(component.parameters, 'td', 'delay', 'delayTime', 'propagationDelay')
        const length = millimetres(component, 'length', 'lengthMm', 'length', 'len')
        const erEffRaw = pickParameter(component.parameters, 'erEff', 'effectiveEr', 'epsilonReff')
        const erEff =
          erEffRaw === undefined ? undefined : parseSpiceValue(erEffRaw, `${component.name} effective er (erEff)`)
        let td: number
        if (tdRaw !== undefined) {
          td = parseSpiceValue(tdRaw, `${component.name} propagation delay (td)`)
        } else if (length !== undefined && erEff !== undefined) {
          td = tdFromGeometry(length, erEff)
        } else if (length !== undefined && epsilonR !== undefined) {
          const effective =
            width !== undefined && height !== undefined ? microstripEffectiveEr(width, height, epsilonR) : epsilonR
          td = tdFromGeometry(length, effective)
        } else {
          return {
            error: `${component.name} needs a propagation delay (td), or length with er/erEff to derive it.`,
          }
        }
        if (!(td > 0) || !Number.isFinite(td)) {
          return { error: `${component.name} propagation delay must be > 0 s (got ${td}).` }
        }
        return { device: { kind, name: component.name, p, n, p2, n2, z0, td } }
      }
      case 'diode': {
        const saturationCurrent = requiredValue(
          component,
          'saturation current',
          'saturationCurrent',
          'is',
          'saturation',
        )
        const emissionCoefficient = requiredValue(
          component,
          'emission coefficient',
          'emissionCoefficient',
          'n',
          'ideality',
        )
        if (saturationCurrent <= 0) return { error: `${component.name} saturation current must be > 0 A.` }
        if (emissionCoefficient <= 0) return { error: `${component.name} emission coefficient must be > 0.` }
        return { device: { kind, name: component.name, p, n, saturationCurrent, emissionCoefficient } }
      }
      case 'voltage-source':
      case 'current-source': {
        const storageKey = kind === 'voltage-source' ? 'dcVoltage' : 'dcCurrent'
        const waveform = parseWaveform(component)
        /*
         * Electrical value aliases first: the canvas property panel edits
         * generic `value`/`voltage`/`current` fields, and library cards carry
         * shorthand aliases (`v`, `i`) — but waveform shape keys (`v1`, `v2`,
         * `vo`, `va`) must never masquerade as the DC level, or a PULSE source
         * silently reads its high level as its resting voltage.
         *
         * With no explicit DC value a waveform source rests at its initial
         * level (`v1`/`vo`), which is also the value the transient run starts
         * from, so the operating point and t = 0 agree and nothing jumps at
         * the first time step.
         */
        const explicitDc = pickParameter(
          component.parameters,
          storageKey,
          'dc',
          'value',
          'voltage',
          'current',
          'v',
          'i',
        )
        const dcValue =
          explicitDc === undefined && waveform
            ? waveform.kind === 'pulse' || waveform.kind === 'exp'
              ? waveform.v1
              : waveform.kind === 'sine' || waveform.kind === 'sffm'
                ? waveform.vo
                : waveform.points.length > 0
                  ? waveform.points[0].value
                  : 0
            : parseSpiceValue(
                explicitDc,
                `${component.name} ${kind === 'voltage-source' ? 'voltage' : 'current'}`,
              )
        /*
         * AC stimulation defaults to the DC value with zero phase. SPICE omits a
         * source from an AC sweep unless an `AC` card is present, which silently
         * plots a flat zero; for an interactive IDE the useful default is "sweep
         * the value you can already see on the source". A waveform source is
         * instead swept at its own swing (sine amplitude, or half the pulse
         * peak-to-peak, which is the square wave's fundamental amplitude scale).
         */
        const acMagnitude =
          component.parameters.acMagnitude !== undefined
            ? parseSpiceValue(component.parameters.acMagnitude, `${component.name} AC magnitude`)
            : waveform
              ? waveform.kind === 'sine' || waveform.kind === 'sffm'
                ? waveform.va
                : waveform.kind === 'pulse' || waveform.kind === 'exp'
                  ? Math.abs(waveform.v2 - waveform.v1) / 2
                  : waveform.kind === 'pwl' && waveform.points.length > 1
                    ? (Math.max(...waveform.points.map((point) => point.value)) -
                        Math.min(...waveform.points.map((point) => point.value))) /
                      2
                    : Math.abs(dcValue)
              : Math.abs(dcValue)
        const acPhaseDegrees =
          component.parameters.acPhase !== undefined
            ? parseSpiceValue(component.parameters.acPhase, `${component.name} AC phase`)
            : 0

        if (kind === 'voltage-source') {
          return {
            device: { kind, name: component.name, p, n, dcVoltage: dcValue, acMagnitude, acPhaseDegrees, waveform },
          }
        }
        return {
          device: { kind, name: component.name, p, n, dcCurrent: dcValue, acMagnitude, acPhaseDegrees, waveform },
        }
      }
      case 'bjt': {
        const { polarity, model } = parseBjtModel(component)
        const c = nodes[0]
        const b = nodes[1]
        const e = nodes[2]
        /*
         * Series parasitics (RB/RC/RE) sit between the terminal and the
         * intrinsic device, exactly as in SPICE, so the junction nodes must be
         * distinct from the terminals whenever a resistance is present. The
         * internal nodes are hidden from every result readout.
         */
        const tag = `INT_${normalizeNodeName(component.name)}`
        return {
          device: {
            kind,
            name: component.name,
            p: c,
            n: e,
            polarity,
            c,
            b,
            e,
            cInt: model.rc > 0 ? `${tag}_C` : c,
            bInt: model.rb > 0 ? `${tag}_B` : b,
            eInt: model.re > 0 ? `${tag}_E` : e,
            model,
          },
        }
      }
      case 'mosfet': {
        const { polarity, model } = parseMosfetModel(component)
        const d = nodes[0]
        const g = nodes[1]
        const s = nodes[2]
        /* A three-terminal part ties its bulk to the source, as SPICE does. */
        const b = nodes.length > 3 ? nodes[3] : s
        return { device: { kind, name: component.name, p: d, n: s, polarity, d, g, s, b, model } }
      }
      case 'op-amp': {
        const inP = nodes[0]
        const inN = nodes[1]
        const out = nodes[2]
        /*
         * Supply pins are optional: an unconnected pin means "use the fixed
         * rails from the part's parameters" (the usual 15 V / -15 V default),
         * which is what a simulator user expects from a bare op-amp symbol.
         */
        const vPlusNode = nodes.length > 3 && !isUnconnectedNode(nodes[3]) ? nodes[3] : undefined
        const vMinusNode = nodes.length > 4 && !isUnconnectedNode(nodes[4]) ? nodes[4] : undefined
        const opPart = partNumber(component)
        const opCard = opPart === undefined ? undefined : OPAMP_MODEL_DEFAULTS[opPart]
        const gain = opAmpParameter(component, opCard, 1e5, 'open-loop gain (gain)', 'gain', 'a', 'aol', 'openLoopGain')
        const gbw = opAmpParameter(component, opCard, 1e6, 'gain-bandwidth product (gbw)', 'gbw', 'unityGainFrequency')
        const slew = opAmpParameter(component, opCard, 5e5, 'slew rate (slew)', 'slew', 'slewRate')
        const rin = opAmpParameter(component, opCard, 2e6, 'input resistance (rin)', 'rin', 'inputResistance')
        const rout = opAmpParameter(component, opCard, 50, 'output resistance (rout)', 'rout', 'outputResistance')
        const vPlusFixed = opAmpParameter(component, opCard, 15, 'positive rail (vPlus)', 'vPlus', 'vPlusFixed', 'vcc', 'vpos')
        const vMinusFixed = opAmpParameter(
          component,
          opCard,
          -15,
          'negative rail (vMinus)',
          'vMinus',
          'vMinusFixed',
          'vee',
          'vneg',
        )
        const dropout = opAmpParameter(component, opCard, 1.5, 'output headroom (dropout)', 'dropout', 'headroom')
        if (!(gain > 0)) return { error: `${component.name} open-loop gain must be > 0.` }
        if (!(gbw > 0)) return { error: `${component.name} gain-bandwidth product must be > 0.` }
        if (!(slew > 0)) return { error: `${component.name} slew rate must be > 0 V/s.` }
        if (!(rin > 0)) return { error: `${component.name} input resistance must be > 0 Ω.` }
        if (!(rout > 0)) return { error: `${component.name} output resistance must be > 0 Ω.` }
        if (!(dropout >= 0)) return { error: `${component.name} output headroom must be >= 0 V.` }
        if (!(vPlusFixed > vMinusFixed)) {
          return { error: `${component.name} positive rail must be above the negative rail.` }
        }
        return {
          device: {
            kind,
            name: component.name,
            p: out,
            n: vMinusNode ?? 'GND',
            inP,
            inN,
            out,
            vPlusNode,
            vMinusNode,
            vPlusFixed,
            vMinusFixed,
            internal: `INT_${normalizeNodeName(component.name)}_OUT`,
            gain,
            gbw,
            slew,
            rin,
            rout,
            dropout,
          },
        }
      }
      case 'jfet': {
        const { polarity, model } = parseJfetModel(component)
        return {
          device: { kind, name: component.name, p: nodes[0], n: nodes[2], polarity, d: nodes[0], g: nodes[1], s: nodes[2], model },
        }
      }
      case 'voltage-switch': {
        /* SPICE S order: out+, out−, control+, control−. */
        const ron = optionalValue(component, 1, 'on resistance (ron)', 'ron', 'ronpos', 'r_on')
        const roff = optionalValue(component, 1e6, 'off resistance (roff)', 'roff', 'roffpos', 'r_off')
        const vt = optionalValue(component, 0.5, 'threshold voltage (vt)', 'vt', 'threshold')
        const vh = optionalValue(component, 0, 'hysteresis (vh)', 'vh', 'hysteresis')
        if (!(ron > 0)) return { error: `${component.name} on resistance (ron) must be > 0 Ω.` }
        if (!(roff > 0)) return { error: `${component.name} off resistance (roff) must be > 0 Ω.` }
        if (!(vh >= 0)) return { error: `${component.name} hysteresis (vh) must be >= 0 V.` }
        return {
          device: { kind, name: component.name, p: nodes[0], n: nodes[1], ip: nodes[2], inn: nodes[3], ron, roff, vt, vh },
        }
      }
      case 'current-switch': {
        /* SPICE W order: out+, out−, controlling source name. */
        const controlSource = pickParameter(component.parameters, 'control', 'controlSource', 'vsense')
        if (typeof controlSource !== 'string' || controlSource.trim() === '') {
          return { error: `${component.name} needs a controlling source name (control).` }
        }
        const sensor = controlSource.trim()
        const known = netlist.components.some(
          (candidate) => candidate.name === sensor || candidate.name.toUpperCase() === sensor.toUpperCase(),
        )
        if (!known) {
          return { error: `${component.name} senses unknown source "${sensor}".` }
        }
        const ron = optionalValue(component, 1, 'on resistance (ron)', 'ron', 'ronneg', 'r_on')
        const roff = optionalValue(component, 1e6, 'off resistance (roff)', 'roff', 'roffneg', 'r_off')
        const it = optionalValue(component, 1e-3, 'threshold current (it)', 'it', 'threshold')
        const ih = optionalValue(component, 0, 'hysteresis (ih)', 'ih', 'hysteresis')
        if (!(ron > 0)) return { error: `${component.name} on resistance (ron) must be > 0 Ω.` }
        if (!(roff > 0)) return { error: `${component.name} off resistance (roff) must be > 0 Ω.` }
        if (!(ih >= 0)) return { error: `${component.name} hysteresis (ih) must be >= 0 A.` }
        return {
          device: { kind, name: component.name, p: nodes[0], n: nodes[1], controlSource: controlSource.trim(), ron, roff, it, ih },
        }
      }
      case 'behavioral-source': {
        /* SPICE B: `V = expr` or `I = expr` selected by the output key. */
        const voltage = pickParameter(component.parameters, 'v', 'voltage', 'expression', 'expr')
        const current = pickParameter(component.parameters, 'i', 'current')
        if (voltage !== undefined && current !== undefined) {
          return { error: `${component.name} must define either a voltage (v) or a current (i), not both.` }
        }
        const expression = voltage ?? current
        if (typeof expression !== 'string' || expression.trim() === '') {
          return { error: `${component.name} needs an expression in V(node) / I(source) form (v or i).` }
        }
        const parsed = parseBehavioralExpression(expression, component.name)
        if ('error' in parsed) return parsed
        return {
          device: {
            kind,
            name: component.name,
            p: nodes[0],
            n: nodes[1],
            output: voltage !== undefined ? 'v' : 'i',
            expression: expression.trim(),
          },
        }
      }
      case 'vcvs': {
        /* SPICE order for an E element: out+, out-, in+, in-. */
        const gain = parseGain(component, 1, 'voltage gain', 'gain', 'k', 'e')
        return {
          device: {
            kind,
            name: component.name,
            p: nodes[0],
            n: nodes[1],
            ip: nodes[2],
            inn: nodes[3],
            gain,
          },
        }
      }
      case 'vccs': {
        /* SPICE order for a G element: out+, out-, in+, in-. */
        const gain = parseGain(
          component,
          1,
          'transconductance',
          'gain',
          'gm',
          'transconductance',
          'g',
        )
        return {
          device: {
            kind,
            name: component.name,
            p: nodes[0],
            n: nodes[1],
            ip: nodes[2],
            inn: nodes[3],
            gain,
          },
        }
      }
      default:
        return { error: `${component.name} is not supported by the solver.` }
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : `${component.name} could not be modelled.` }
  }
}
/**
 * Supported behavioural-source functions (all SPICE built-ins that are pure and
 * total; `table` would need a parser).
 */
export const BEHAVIORAL_FUNCTIONS: Readonly<Record<string, (...args: number[]) => number>> = {
  abs: (x) => Math.abs(x),
  sqrt: (x) => Math.sqrt(Math.max(x, 0)),
  exp: (x) => Math.exp(Math.min(x, 40)),
  // SPICE `log` is base-10, `ln` is natural.
  log: (x) => Math.log10(Math.max(x, Number.MIN_VALUE)),
  ln: (x) => Math.log(Math.max(x, Number.MIN_VALUE)),
  sin: (x) => Math.sin(x),
  cos: (x) => Math.cos(x),
  tan: (x) => Math.tan(x),
  asin: (x) => Math.asin(Math.max(-1, Math.min(1, x))),
  acos: (x) => Math.acos(Math.max(-1, Math.min(1, x))),
  atan: (x) => Math.atan(x),
  atan2: (y, x) => Math.atan2(y, x),
  sinh: (x) => Math.sinh(Math.max(-40, Math.min(40, x))),
  cosh: (x) => Math.cosh(Math.max(-40, Math.min(40, x))),
  tanh: (x) => Math.tanh(x),
  min: (...args) => Math.min(...args),
  max: (...args) => Math.max(...args),
  pow: (x, y) => Math.pow(x, y),
  pwr: (x, y) => Math.pow(Math.abs(x), y),
  'if': (condition, thenValue, elseValue) => ((condition as number) !== 0 ? thenValue : elseValue),
  u: (x) => (x > 0 ? 1 : 0),
  uramp: (x) => Math.max(x ?? 0, 0),
  sgn: (x) => (x > 0 ? 1 : x < 0 ? -1 : 0),
  limit: (x, lo, hi) => Math.min(Math.max(x ?? 0, lo ?? -Infinity), hi ?? Infinity),
}

export type BehavioralNode =
  | { kind: 'voltage'; node: string }
  | { kind: 'vdiff'; a: string; b: string }
  | { kind: 'current'; source: string }

export interface BehavioralExpression {
  rpn: ReadonlyArray<string | number>
  probes: BehavioralNode[]
}

/**
 * Validate every probe of a compiled expression against the built model.
 *
 * A V() probe over a net that exists nowhere is a typo the solver must report
 * as a model error (not a silent zero), and an I() probe over a source with no
 * branch row reads a current that does not exist. Both are caught here, once,
 * rather than per Newton iteration.
 */
export function validateBehavioralProbes(
  model: CircuitModel,
  deviceName: string,
  compiled: BehavioralExpression,
): string | null {
  for (const probe of compiled.probes) {
    if (probe.kind === 'voltage') {
      if (model.nodeIndex.get(probe.node) === undefined && !isGroundNode(probe.node)) {
        return `${deviceName} probes unknown node "${probe.node}".`
      }
    } else if (probe.kind === 'vdiff') {
      for (const node of [probe.a, probe.b]) {
        if (model.nodeIndex.get(node) === undefined && !isGroundNode(node)) {
          return `${deviceName} probes unknown node "${node}".`
        }
      }
    } else if (model.branchRows.get(probe.source) === undefined) {
      return `${deviceName} probes unknown source "${probe.source}".`
    }
  }
  return null
}

const BEHAVIORAL_CONSTANTS: Readonly<Record<string, number>> = {
  pi: Math.PI,
  e: Math.E,
}

type BehavioralToken =
  | { kind: 'number'; value: number }
  | { kind: 'probe'; index: number }
  | { kind: 'time' }
  | { kind: 'op'; op: string }
  | { kind: 'func'; name: string }
  | { kind: 'lparen' }
  | { kind: 'rparen' }
  | { kind: 'comma' }

/**
 * Compile a B-source expression to reverse-Polish tokens.
 *
 * Grammar: numbers (SPICE values), `V(node)` / `V(a,b)` / `I(source)` probes,
 * `TIME`, constants, `+ - * / ^` (unary minus supported), comparisons
 * (`> < >= <= == !=` returning 1/0), and the functions above. Anything else —
 * identifiers, assignment, property access, calls to unknown functions — is a
 * parse error, so there is no string left that could reach `eval`/`Function`.
 */
function parseBehavioralExpression(expression: string, name: string): { expression: BehavioralExpression } | { error: string } {
  const fail = (reason: string): { error: string } => ({ error: `${name} expression: ${reason}` })
  const probes: BehavioralNode[] = []
  const probeIndex = (probe: BehavioralNode): number => {
    const found = probes.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(probe))
    if (found >= 0) return found
    probes.push(probe)
    return probes.length - 1
  }
  const tokens: BehavioralToken[] = []
  const text = expression.trim()
  if (text === '') return fail('is empty.')
  let i = 0
  const isDigit = (ch: string): boolean => ch >= '0' && ch <= '9'
  let expectOperand = true
  while (i < text.length) {
    const ch = text[i]
    if (ch === ' ' || ch === '\t' || ch === '\n') {
      i += 1
      continue
    }
    if (expectOperand && (ch === '+' || ch === '-')) {
      const rest = text.slice(i + 1)
      const num = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?\s*[a-zµμ]*/i.exec(rest)
      const next = text[i + 1] ?? ''
      if (ch === '+' && (isDigit(next) || next === '.')) {
        const value = num?.[0] ?? ''
        tokens.push({ kind: 'number', value: parseSpiceValue(`+${value}`, `${name} number`) })
        i += 1 + value.length
        expectOperand = false
        continue
      }
      if (ch === '-') {
        if (isDigit(next) || next === '.') {
          const value = num?.[0] ?? ''
          tokens.push({ kind: 'number', value: parseSpiceValue(`-${value}`, `${name} number`) })
          i += 1 + value.length
          expectOperand = false
          continue
        }
        tokens.push({ kind: 'number', value: 0 })
        tokens.push({ kind: 'op', op: '-' })
        i += 1
        continue
      }
      return fail(`unexpected "${ch}".`)
    }
    if (isDigit(ch) || ch === '.') {
      const num = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?\s*[a-zµμ]*/i.exec(text.slice(i))
      if (!num) return fail(`bad number at "${text.slice(i, i + 8)}".`)
      try {
        tokens.push({ kind: 'number', value: parseSpiceValue(num[0], `${name} number`) })
      } catch {
        return fail(`bad number "${num[0]}".`)
      }
      i += num[0].length
      expectOperand = false
      continue
    }
    if (ch === '(') {
      tokens.push({ kind: 'lparen' })
      i += 1
      expectOperand = true
      continue
    }
    if (ch === ')') {
      tokens.push({ kind: 'rparen' })
      i += 1
      expectOperand = false
      continue
    }
    if (ch === ',') {
      tokens.push({ kind: 'comma' })
      i += 1
      expectOperand = true
      continue
    }
    const two = text.slice(i, i + 2)
    if (!expectOperand && (two === '>=' || two === '<=' || two === '==' || two === '!=')) {
      tokens.push({ kind: 'op', op: two })
      i += 2
      expectOperand = true
      continue
    }
    if (!expectOperand && (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '^' || ch === '>' || ch === '<')) {
      tokens.push({ kind: 'op', op: ch })
      i += 1
      expectOperand = true
      continue
    }
    if (expectOperand && ch === '*') return fail('unexpected "*".')
    const word = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(text.slice(i))
    if (!word) return fail(`unexpected "${ch}".`)
    const ident = word[0]
    const lower = ident.toLowerCase()
    let j = i + ident.length
    while (text[j] === ' ' || text[j] === '\t') j += 1
    if (text[j] === '(') {
      if (lower === 'v' || lower === 'i') {
        let depth = 0
        let k = j
        while (k < text.length) {
          if (text[k] === '(') depth += 1
          if (text[k] === ')') {
            depth -= 1
            if (depth === 0) break
          }
          k += 1
        }
        if (depth !== 0) return fail(`unclosed "${ident}(" probe.`)
        const args = text
          .slice(j + 1, k)
          .split(',')
          .map((part) => part.trim())
          .filter((part) => part.length > 0)
        if (lower === 'v') {
          if (args.length === 1) {
            tokens.push({ kind: 'probe', index: probeIndex({ kind: 'voltage', node: normalizeNodeName(args[0]) }) })
          } else if (args.length === 2) {
            tokens.push({
              kind: 'probe',
              index: probeIndex({ kind: 'vdiff', a: normalizeNodeName(args[0]), b: normalizeNodeName(args[1]) }),
            })
          } else {
            return fail('V() takes one node or two nodes.')
          }
        } else {
          if (args.length !== 1) return fail('I() takes one source name.')
          tokens.push({ kind: 'probe', index: probeIndex({ kind: 'current', source: args[0].trim().toUpperCase() }) })
        }
        i = k + 1
        expectOperand = false
        continue
      }
      if (lower === 'time') return fail('TIME takes no arguments — write TIME, not TIME().')
      if (!(lower in BEHAVIORAL_FUNCTIONS)) return fail(`unknown function "${ident}".`)
      tokens.push({ kind: 'func', name: lower })
      i += ident.length
      continue
    }
    if (lower === 'time') {
      tokens.push({ kind: 'time' })
    } else if (lower in BEHAVIORAL_CONSTANTS) {
      tokens.push({ kind: 'number', value: BEHAVIORAL_CONSTANTS[lower] })
    } else {
      return fail(`unknown name "${ident}" — use V(node), I(source), TIME, or a function.`)
    }
    i += ident.length
    expectOperand = false
  }
  if (expectOperand) return fail('ends with an operator.')
  // Shunting-yard to RPN: precedence climbs ^ → unary → * / → + − → compare.
  const output: Array<string | number> = []
  const stack: BehavioralToken[] = []
  const precedence = (op: string): number => {
    if (op === '^') return 4
    if (op === '*' || op === '/') return 3
    if (op === '+' || op === '-') return 2
    return 1
  }
  const FUNCTION_ARITY: Readonly<Record<string, number>> = {
    abs: 1,
    sqrt: 1,
    exp: 1,
    log: 1,
    ln: 1,
    sin: 1,
    cos: 1,
    tan: 1,
    asin: 1,
    acos: 1,
    atan: 1,
    atan2: 2,
    sinh: 1,
    cosh: 1,
    tanh: 1,
    min: -1,
    max: -1,
    pow: 2,
    pwr: 2,
    if: 3,
    u: 1,
    uramp: 1,
    sgn: 1,
    limit: 3,
  }
  const argCounts: number[] = []
  for (const token of tokens) {
    if (token.kind === 'number') output.push(token.value)
    else if (token.kind === 'probe') output.push(`P${token.index}`)
    else if (token.kind === 'time') output.push('T')
    else if (token.kind === 'func') {
      stack.push(token)
      argCounts.push(1)
    } else if (token.kind === 'comma') {
      if (argCounts.length === 0) return fail('misplaced comma.')
      let found = false
      while (stack.length > 0) {
        const top = stack[stack.length - 1]
        if (top.kind === 'lparen') {
          found = true
          break
        }
        const popped = stack.pop()
        if (popped?.kind === 'op') output.push(popped.op)
      }
      if (!found) return fail('misplaced comma.')
      argCounts[argCounts.length - 1] += 1
    } else if (token.kind === 'op') {
      while (stack.length > 0) {
        const top = stack[stack.length - 1]
        if (top.kind !== 'op') break
        if (precedence(top.op) < precedence(token.op)) break
        if (token.op === '^' && precedence(top.op) === precedence(token.op)) break
        output.push((stack.pop() as { kind: 'op'; op: string }).op)
      }
      stack.push(token)
    } else if (token.kind === 'lparen') {
      stack.push(token)
    } else if (token.kind === 'rparen') {
      let found = false
      while (stack.length > 0) {
        const top = stack.pop()
        if (!top) break
        if (top.kind === 'lparen') {
          found = true
          break
        }
        if (top.kind === 'op') output.push(top.op)
      }
      if (!found) return fail('mismatched ")".')
      const top = stack[stack.length - 1]
      if (top?.kind === 'func') {
        const func = (stack.pop() as { kind: 'func'; name: string }).name
        const count = argCounts.pop() ?? 1
        const arity = FUNCTION_ARITY[func] ?? 1
        if (arity >= 0 && count !== arity) return fail(`"${func}" takes ${arity} argument(s).`)
        if (arity < 0 && count < 1) return fail(`"${func}" takes at least one argument.`)
        output.push(`F:${func}:${count}`)
      } else if (argCounts.length > 0 && stack.some((entry) => entry.kind === 'lparen')) {
        void 0
      }
    }
  }
  while (stack.length > 0) {
    const top = stack.pop()
    if (!top) break
    if (top.kind === 'lparen' || top.kind === 'rparen') return fail('mismatched parenthesis.')
    if (top.kind === 'func') return fail(`unclosed function "${top.name}".`)
    if (top.kind === 'comma') return fail('misplaced comma.')
    if (top.kind === 'op') output.push(top.op)
  }
  // Arity check on the RPN itself: catches `2 +` and `sin()` structurally.
  let depth = 0
  for (const entry of output) {
    if (typeof entry === 'number' || entry === 'T' || entry.startsWith('P')) {
      depth += 1
      continue
    }
    if (entry.startsWith('F:')) {
      const count = Number(entry.split(':')[2])
      if (depth < count) return fail('a function is missing arguments.')
      depth -= count - 1
      continue
    }
    if (depth < 2) return fail(`operator "${entry}" is missing an operand.`)
    depth -= 1
  }
  if (depth !== 1) return fail('does not reduce to a single value.')
  return { expression: { rpn: output, probes } }
}

export function behavioralProbes(device: BehavioralSourceDevice): BehavioralNode[] {
  const parsed = behavioralCompiled(device)
  if ('error' in parsed) return []
  return [...parsed.expression.probes]
}

const behavioralCache = new WeakMap<BehavioralSourceDevice, { expression: BehavioralExpression } | { error: string }>()

/** Parse once per device; the expression text is fixed for the whole analysis. */
export function behavioralCompiled(device: BehavioralSourceDevice): { expression: BehavioralExpression } | { error: string } {
  const cached = behavioralCache.get(device)
  if (cached) return cached
  const parsed = parseBehavioralExpression(device.expression, device.name)
  behavioralCache.set(device, parsed)
  return parsed
}

/** Terminals each device kind consumes, in SPICE's own order. */
const MIN_TERMINALS: Record<DeviceKind | 'ground', number> = {
  resistor: 2,
  capacitor: 2,
  inductor: 2,
  'transmission-line': 4,
  'voltage-source': 2,
  'current-source': 2,
  diode: 2,
  bjt: 3,
  mosfet: 3,
  jfet: 3,
  'op-amp': 3,
  'voltage-switch': 4,
  'current-switch': 2,
  'behavioral-source': 2,
  vcvs: 4,
  vccs: 4,
  ground: 0,
}

/** Human-readable terminal names, used in error messages. */
const TERMINAL_LABELS: Record<DeviceKind | 'ground', string> = {
  resistor: 'two terminals',
  capacitor: 'two terminals',
  inductor: 'two terminals',
  'transmission-line': 'input and output port terminals',
  'voltage-source': 'two terminals',
  'current-source': 'two terminals',
  diode: 'anode and cathode',
  bjt: 'collector, base and emitter',
  mosfet: 'drain, gate and source',
  jfet: 'drain, gate and source',
  'op-amp': 'inputs and output',
  'voltage-switch': 'output and control terminals',
  'current-switch': 'output terminals plus a control source',
  'behavioral-source': 'output terminals',
  vcvs: 'output and control terminals',
  vccs: 'output and control terminals',
  ground: 'a net',
}

/** A MOSFET may add a bulk terminal; an op-amp may add supply pins. */
const MAX_TERMINALS: Record<DeviceKind, number> = { ...MIN_TERMINALS, mosfet: 4, 'op-amp': 5 }

/**
 * Build the MNA model for `netlist`.
 *
 * Never throws: topology problems come back as `errors` so the UI can list every
 * issue at once instead of surfacing one per run.
 */
export function buildCircuitModel(netlist: CircuitNetlist): BuildModelResult {
  const errors: string[] = []
  const notes: string[] = []
  const devices: Device[] = []
  const couplings: CoupledInductorPair[] = []
  const couplingCards: Component[] = []
  const lineRows = new Map<string, TransmissionLineBranchRows>()
  const groundNodes = new Set<string>(['0'])
  const nodeNames = new Set<string>()
  const modelCards = normalizeModelCards(netlist.models)

  if (netlist.components.length === 0) {
    errors.push('The circuit has no components.')
  }

  /**
   * Reference designators are MNA row keys: two components sharing one name
   * would both be stamped while a voltage-source/inductor branch row is keyed
   * by name, so the second one would silently overwrite the first constraint.
   * The netlist ingest path already rejects duplicates; the model builder is
   * the last line of defence for hand-written netlists.
   */
  const seenDesignators = new Map<string, string>()
  const claimDesignator = (component: Component): boolean => {
    const key = component.name.trim().toUpperCase()
    if (!key) return true
    const first = seenDesignators.get(key)
    if (first !== undefined) {
      errors.push(
        `Duplicate reference designator "${component.name}": ${first} already uses it. Rename one.`,
      )
      return false
    }
    seenDesignators.set(key, component.name)
    return true
  }

  /**
   * Normalize and validate a component's terminals.
   *
   * The terminal count depends on the device: three transistors and op-amps,
   * four for controlled sources. Extra terminals are ignored with a note rather
   * than an error, which keeps a mis-wired symbol usable.
   */
  const terminalsFor = (component: Component, kind: DeviceKind): string[] | null => {
    const required = MIN_TERMINALS[kind]
    if (component.nodes.length < required) {
      errors.push(
        required === 2
          ? `${component.name} needs two terminals but has ${component.nodes.length}.`
          : `${component.name} needs ${required} terminals (${TERMINAL_LABELS[kind]}) but has ` +
              `${component.nodes.length}.`,
      )
      return null
    }
    if (component.nodes.length > MAX_TERMINALS[kind]) {
      notes.push(
        required === 2
          ? `${component.name}: only the first two terminals are used by this solver.`
          : `${component.name}: only the first ${required} terminals are used by this solver.`,
      )
    }
    const nodes = component.nodes.map(normalizeNodeName)
    if (nodes.some((node) => !node)) {
      errors.push(`${component.name} has an unnamed terminal.`)
      return null
    }
    if (nodes[0] === nodes[1]) {
      notes.push(
        required === 2
          ? `${component.name} has both terminals on the same net.`
          : `${component.name} has two terminals on the same net.`,
      )
    }
    return nodes
  }

  const collectedProbes: ProbeRequest[] = []
  for (const component of netlist.components) {
    const typeNorm = (component.type ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')
    if (typeNorm.includes('testpoint') || typeNorm === 'test_point') {
      const probe = probeFromTestPoint({ name: component.name, nodes: component.nodes, parameters: component.parameters })
      if (probe) collectedProbes.push(probe)
      continue
    }
  }

  if (Array.isArray((netlist as { probes?: unknown }).probes)) {
    const { probes: normalized, errors: probeErrors } = normalizeProbeRequests((netlist as { probes: RawProbe[] }).probes)
    collectedProbes.push(...normalized)
    errors.push(...probeErrors)
  }

  for (const component of netlist.components) {
    if ((component.type ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '').includes('testpoint')) continue

    /*
     * Ground symbols are net aliases, not devices, so several of them may share
     * a label; every other reference designator must be unique.
     */
    if (classify(component) !== 'ground' && !claimDesignator(component)) continue

    if (isTransformerComponent(component)) {
      const terminals = component.nodes.map(normalizeNodeName)
      if (terminals.length < 4 || terminals.slice(0, 4).some((node) => !node)) {
        errors.push(
          `${component.name} (transformer) needs four terminals (primary in/out, secondary in/out) ` +
            `but has ${component.nodes.length}.`,
        )
        continue
      }
      try {
        const primaryInductance = requiredValue(
          component,
          'primary inductance',
          'l1',
          'primaryInductance',
          'inductance',
          'value',
        )
        const secondaryInductance = requiredValue(
          component,
          'secondary inductance',
          'l2',
          'secondaryInductance',
        )
        const couplingCoefficient = optionalValue(
          component,
          1,
          'coupling coefficient',
          'k',
          'coupling',
        )
        if (!(primaryInductance > 0) || !(secondaryInductance > 0)) {
          errors.push(`${component.name} transformer inductances must both be > 0 H.`)
          continue
        }
        if (!(couplingCoefficient > 0 && couplingCoefficient <= 1)) {
          errors.push(`${component.name} coupling coefficient k must be in (0, 1] (got ${couplingCoefficient}).`)
          continue
        }

        const [p1, n1, p2, n2] = terminals
        const primary: InductorDevice = {
          kind: 'inductor',
          name: `${component.name}_P`,
          p: p1,
          n: n1,
          inductance: primaryInductance,
        }
        const secondary: InductorDevice = {
          kind: 'inductor',
          name: `${component.name}_S`,
          p: p2,
          n: n2,
          inductance: secondaryInductance,
        }
        devices.push(primary, secondary)
        couplings.push({
          name: component.name,
          l1Name: primary.name,
          l2Name: secondary.name,
          k: couplingCoefficient,
          l1Value: primaryInductance,
          l2Value: secondaryInductance,
          l1p: p1,
          l1n: n1,
          l2p: p2,
          l2n: n2,
        })
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error))
      }
      continue
    }

    if (isCouplingComponent(component)) {
      couplingCards.push(component)
      continue
    }

    const kind = classify(component)

    if (kind === 'ground') {
      if (component.nodes.length === 0) {
        errors.push(`${component.name} is a ground symbol with no net attached.`)
        continue
      }
      groundNodes.add(normalizeNodeName(component.nodes[0]))
      continue
    }

    if (kind === null) {
      errors.push(
        `${component.name} (${component.type}) has no model in this solver. Supported: resistor, capacitor, ` +
          'inductor, lossless transmission line (T), voltage source (including PULSE/SIN/EXP/SFFM/PWL), ' +
          'current source, diode, BJT, MOSFET, JFET, op-amp, voltage/current switch (S/W), behavioral source (B), ' +
          'controlled sources, ground.',
      )
      continue
    }

    /*
     * A semiconductor may name a `.model` card instead of relying on the stock
     * part-number card. The card's declared type must match the symbol family:
     * a `.model Q1 NPN(...)` on a MOSFET is a wiring mistake, not a directive
     * to re-interpret the part.
     */
    let effective = component
    if (kind === 'bjt' || kind === 'mosfet' || kind === 'jfet' || kind === 'diode') {
      const card = resolveModelCard(component, modelCards)
      if (card) {
        const cardKind = modelCardDeviceKind(card.type)
        if (cardKind !== kind) {
          errors.push(
            `${component.name} references SPICE model ${card.name} (${card.type}), ` +
              `which is not a ${kind} model.`,
          )
          continue
        }
        effective = withModelCard(component, card, kind, notes)
      }
    }

    const terminals = terminalsFor(effective, kind)
    if (!terminals) continue

    const resolved = toDevice(effective, kind, terminals, netlist)
    if ('error' in resolved) errors.push(resolved.error)
    else devices.push(resolved.device)
  }

  /*
   * Resolve `K` cards after every winding exists, so card order in the netlist
   * does not matter. A card names two inductors; it never creates nodes.
   */
  for (const component of couplingCards) {
    try {
      const l1Name = String(
        pickParameter(component.parameters, 'l1', 'primary', 'primaryInductance') ?? '',
      ).trim()
      const l2Name = String(
        pickParameter(component.parameters, 'l2', 'secondary', 'secondaryInductance') ?? '',
      ).trim()
      const couplingCoefficient = parseSpiceValue(
        pickParameter(component.parameters, 'k', 'coupling'),
        `${component.name} coupling coefficient`,
      )
      if (!(couplingCoefficient > 0 && couplingCoefficient <= 1)) {
        errors.push(`${component.name} coupling coefficient k must be in (0, 1] (got ${couplingCoefficient}).`)
        continue
      }
      const winding = (name: string): InductorDevice | undefined =>
        devices.find(
          (device): device is InductorDevice =>
            device.kind === 'inductor' && device.name.toUpperCase() === name.toUpperCase(),
        )
      const primary = winding(l1Name)
      const secondary = winding(l2Name)
      if (!primary || !secondary) {
        const missing = [!primary ? l1Name : null, !secondary ? l2Name : null].filter(Boolean).join(', ')
        errors.push(`${component.name} couples an unknown inductor: ${missing}.`)
        continue
      }
      if (primary.name === secondary.name) {
        errors.push(`${component.name} couples ${primary.name} to itself.`)
        continue
      }
      if (
        couplings.some(
          (pair) =>
            (pair.l1Name === primary.name && pair.l2Name === secondary.name) ||
            (pair.l1Name === secondary.name && pair.l2Name === primary.name),
        )
      ) {
        errors.push(`${component.name} duplicates an existing coupling between ${primary.name} and ${secondary.name}.`)
        continue
      }
      couplings.push({
        name: component.name,
        l1Name: primary.name,
        l2Name: secondary.name,
        k: couplingCoefficient,
        l1Value: primary.inductance,
        l2Value: secondary.inductance,
        l1p: primary.p,
        l1n: primary.n,
        l2p: secondary.p,
        l2n: secondary.n,
      })
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }

  /*
   * Discover unknowns from real device terminals only. `deviceNodes` reports
   * every terminal a part touches, so transistors and op-amps contribute their
   * hidden internal nodes too. Controlled sources deliberately do NOT
   * contribute their control nodes (`devices.ts`): a VCCS gate draws no
   * current and a VCVS input is the reference of a voltage constraint, so an
   * unwired control terminal is a user error the solver must report (a
   * floating row) rather than a node the model silently invents.
   *
   * Ground unification happens here too: the netlist layer emits canonical
   * `0` for named ground nets, but a hand-written netlist may call the same
   * net GND or VSS, so every alias found on a device joins `groundNodes`.
   */
  for (const device of devices) {
    for (const node of deviceNodes(device)) {
      if (isGroundNode(node) || groundNodes.has(node)) {
        groundNodes.add(node)
        continue
      }
      if (isUnconnectedNode(node)) {
        errors.push(`${device.name} has an unconnected terminal. Connect it or delete the part.`)
        continue
      }
      nodeNames.add(node)
    }
  }

  const sortedNodes = [...nodeNames].sort()
  const nodeIndex = new Map(sortedNodes.map((node, index) => [node, index]))

  /*
   * One branch unknown per voltage constraint: independent voltage sources,
   * inductors, voltage-controlled voltage sources (whose output is defined as a
   * voltage), op-amps (whose output stage is a voltage constraint referenced
   * to its internal first stage) and voltage-output B sources (same form).
   *
   * The map is keyed BOTH by the given name and its uppercase form: netlists
   * use lowercase designators (`vsense`) while probes normalise to uppercase,
   * and a current-controlled switch that cannot find its sensor must fail
   * loudly at model time rather than read a silent zero.
   */
  const branchRows = new Map<string, number>()
  let branchCount = 0
  for (const device of devices) {
    if (device.kind === 'transmission-line') {
      /*
       * A line carries two independent port currents. They are real MNA
       * unknowns in every analysis: transient needs them for the Branin
       * equations and AC for the Y-parameter equations; DC spends them on the
       * two ideal-wire constraints (or one constraint plus the port-current
       * relation when both ports share a return). Allocating them here keeps
       * the system size identical across analyses.
       */
      const port1 = sortedNodes.length + branchCount
      branchCount += 1
      const port2 = sortedNodes.length + branchCount
      branchCount += 1
      lineRows.set(device.name, { port1, port2 })
      branchRows.set(`${device.name}#1`, port1)
      branchRows.set(`${device.name}#2`, port2)
      continue
    }
    if (
      device.kind === 'voltage-source' ||
      device.kind === 'inductor' ||
      device.kind === 'vcvs' ||
      device.kind === 'op-amp' ||
      (device.kind === 'behavioral-source' && device.output === 'v')
    ) {
      const row = sortedNodes.length + branchCount
      branchCount += 1
      branchRows.set(device.name, row)
      branchRows.set(device.name.toUpperCase(), row)
    }
  }
  const size = sortedNodes.length + branchCount

  if (sortedNodes.length === 0 && devices.length > 0 && errors.length === 0) {
    errors.push('Every net is ground — there is nothing to solve.')
  }

  return {
    model: {
      devices,
      nodeNames: sortedNodes,
      nodeIndex,
      branchRows,
      lineRows,
      size,
      groundNodes,
      notes,
      probes: collectedProbes,
      couplings,
    },
    errors,
  }
}

