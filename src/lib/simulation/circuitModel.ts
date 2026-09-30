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
  normalizeNodeName,
  isGroundNode,
  pickParameter,
  deviceNodes,
  type BjtModelParams,
  type Device,
  type MosfetModelParams,
  type SourceWaveform,
} from './devices'
import type { CircuitNetlist, Component } from './spiceEngine'

export interface CircuitModel {
  devices: Device[]
  /** Non-ground node names, sorted for a deterministic unknown ordering. */
  nodeNames: string[]
  /** Node name → row index. */
  nodeIndex: Map<string, number>
  /** Device name → branch-current row index (voltage sources and inductors). */
  branchRows: Map<string, number>
  /** Total number of unknowns (node voltages + branch currents). */
  size: number
  /** Every node name that is ground, including aliases found on devices. */
  groundNodes: Set<string>
  /** Non-fatal observations worth surfacing to the user. */
  notes: string[]
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
    matches: (type, name) => (type.includes('voltage') && type.includes('source')) || /^v\d/i.test(name),
  },
  {
    kind: 'current-source',
    matches: (type, name) => (type.includes('current') && type.includes('source')) || /^i\d/i.test(name),
  },
  {
    kind: 'op-amp',
    matches: (type) => type.includes('opamp') || type.includes('op_amp') || (type.includes('operational') && type.includes('amplifier')),
  },
  { kind: 'mosfet', matches: (type, name) => type.includes('mosfet') || /^m\d/i.test(name) },
  {
    kind: 'bjt',
    matches: (type, name) =>
      type.includes('npn') || type.includes('pnp') || type.includes('bjt') || /^q\d/i.test(name),
  },
  { kind: 'capacitor', matches: (type, name) => type.includes('capacit') || /^c\d/i.test(name) },
  { kind: 'inductor', matches: (type, name) => type.includes('induct') || /^l\d/i.test(name) },
  { kind: 'diode', matches: (type, name) => type.includes('diode') || type.includes('rectifier') || /^d\d/i.test(name) },
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
 * Build the transient waveform of a PULSE or SINE source.
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
  if (shape.includes('sine')) {
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
  return undefined
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
function parseBjtModel(component: Component): { polarity: 'npn' | 'pnp'; model: BjtModelParams } {
  const declared = `${component.type} ${component.name}`.toLowerCase().replace(/[^a-z]/g, '')
  const requested = pickParameter(component.parameters, 'polarity')
  const polarity: 'npn' | 'pnp' =
    typeof requested === 'string' && requested.toLowerCase().includes('pnp')
      ? 'pnp'
      : declared.includes('pnp')
        ? 'pnp'
        : 'npn'
  return {
    polarity,
    model: {
      is: optionalValue(component, 1e-14, 'saturation current (is)', 'is'),
      bf: optionalValue(component, 100, 'forward beta (bf)', 'bf'),
      br: optionalValue(component, 1, 'reverse beta (br)', 'br'),
      nf: optionalValue(component, 1, 'forward emission coefficient (nf)', 'nf'),
      nr: optionalValue(component, 1, 'reverse emission coefficient (nr)', 'nr'),
      vaf: optionalValue(component, Infinity, 'forward Early voltage (vaf)', 'vaf'),
      var: optionalValue(component, Infinity, 'reverse Early voltage (var)', 'var'),
      ikf: optionalValue(component, Infinity, 'forward rolloff corner (ikf)', 'ikf'),
      ikr: optionalValue(component, Infinity, 'reverse rolloff corner (ikr)', 'ikr'),
      ise: optionalValue(component, 0, 'B–E leakage current (ise)', 'ise'),
      ne: optionalValue(component, 1.5, 'B–E leakage coefficient (ne)', 'ne'),
      isc: optionalValue(component, 0, 'B–C leakage current (isc)', 'isc'),
      nc: optionalValue(component, 2, 'B–C leakage coefficient (nc)', 'nc'),
      cje: optionalValue(component, 0, 'B–E capacitance (cje)', 'cje'),
      vje: optionalValue(component, 0.75, 'B–E built-in potential (vje)', 'vje'),
      mje: optionalValue(component, 0.33, 'B–E exponent (mje)', 'mje'),
      cjc: optionalValue(component, 0, 'B–C capacitance (cjc)', 'cjc'),
      vjc: optionalValue(component, 0.75, 'B–C built-in potential (vjc)', 'vjc'),
      mjc: optionalValue(component, 0.33, 'B–C exponent (mjc)', 'mjc'),
      fc: optionalValue(component, 0.5, 'capacitance blend coefficient (fc)', 'fc'),
      tf: optionalValue(component, 0, 'forward transit time (tf)', 'tf'),
      tr: optionalValue(component, 0, 'reverse transit time (tr)', 'tr'),
      rb: optionalValue(component, 0, 'base resistance (rb)', 'rb'),
      rc: optionalValue(component, 0, 'collector resistance (rc)', 'rc'),
      re: optionalValue(component, 0, 'emitter resistance (re)', 're'),
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
  return {
    polarity,
    model: {
      vto: optionalValue(component, 0, 'threshold voltage (vto)', 'vto', 'vth', 'vt'),
      kp: optionalValue(component, 2e-5, 'transconductance (kp)', 'kp', 'k'),
      gamma: optionalValue(component, 0, 'body effect (gamma)', 'gamma'),
      phi: optionalValue(component, 0.6, 'surface potential (phi)', 'phi'),
      lambda: optionalValue(component, 0, 'channel-length modulation (lambda)', 'lambda'),
      is: optionalValue(component, 1e-14, 'body diode saturation current (is)', 'is'),
      n: optionalValue(component, 1, 'body diode coefficient (n)', 'n'),
      cgs: optionalValue(component, 0, 'gate–source capacitance (cgs)', 'cgs'),
      cgd: optionalValue(component, 0, 'gate–drain capacitance (cgd)', 'cgd'),
    },
  }
}

/**
 * Convert one classified component into a `Device`.
 * Returns an error message instead of throwing so a single bad part does not
 * hide every other problem in the schematic.
 */
function toDevice(
  component: Component,
  kind: DeviceKind,
  nodes: readonly string[],
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
         * A waveform source still needs a DC value for the operating point, but
         * its initial level (`v1`/`vo`) is a far better default than an error:
         * it is also the value the transient run starts from, so the operating
         * point and t = 0 agree and nothing jumps at the first time step.
         */
        const explicitDc = pickParameter(component.parameters, storageKey, 'dc', 'value')
        const dcValue =
          explicitDc === undefined && waveform
            ? waveform.kind === 'pulse'
              ? waveform.v1
              : waveform.vo
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
              ? waveform.kind === 'sine'
                ? waveform.va
                : Math.abs(waveform.v2 - waveform.v1) / 2
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
        const gain = parseGain(component, 1e5, 'open-loop gain (gain)', 'gain', 'a', 'aol', 'openLoopGain')
        const gbw = optionalValue(component, 1e6, 'gain-bandwidth product (gbw)', 'gbw', 'unityGainFrequency')
        const slew = optionalValue(component, 5e5, 'slew rate (slew)', 'slew', 'slewRate')
        const rin = optionalValue(component, 2e6, 'input resistance (rin)', 'rin', 'inputResistance')
        const rout = optionalValue(component, 50, 'output resistance (rout)', 'rout', 'outputResistance')
        const vPlusFixed = optionalValue(component, 15, 'positive rail (vPlus)', 'vPlus', 'vPlusFixed', 'vcc', 'vpos')
        const vMinusFixed = optionalValue(
          component,
          -15,
          'negative rail (vMinus)',
          'vMinus',
          'vMinusFixed',
          'vee',
          'vneg',
        )
        const dropout = optionalValue(component, 1.5, 'output headroom (dropout)', 'dropout', 'headroom')
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
      case 'vcvs': {
        /* SPICE order for an E element: out+, out-, in+, in-. */
        const gain = parseGain(component, 1, 'voltage gain', 'gain', 'value', 'k', 'e')
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
          'value',
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
/** Terminals each device kind consumes, in SPICE's own order. */
const MIN_TERMINALS: Record<DeviceKind | 'ground', number> = {
  resistor: 2,
  capacitor: 2,
  inductor: 2,
  'voltage-source': 2,
  'current-source': 2,
  diode: 2,
  bjt: 3,
  mosfet: 3,
  'op-amp': 3,
  vcvs: 4,
  vccs: 4,
  ground: 0,
}

/** Human-readable terminal names, used in error messages. */
const TERMINAL_LABELS: Record<DeviceKind | 'ground', string> = {
  resistor: 'two terminals',
  capacitor: 'two terminals',
  inductor: 'two terminals',
  'voltage-source': 'two terminals',
  'current-source': 'two terminals',
  diode: 'anode and cathode',
  bjt: 'collector, base and emitter',
  mosfet: 'drain, gate and source',
  'op-amp': 'inputs and output',
  vcvs: 'output and control terminals',
  vccs: 'output and control terminals',
  ground: 'a net',
}

/** An op-amp may add supply pins on top of its three signal terminals. */
const MAX_TERMINALS: Record<DeviceKind, number> = { ...MIN_TERMINALS, 'op-amp': 5 }

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
  const groundNodes = new Set<string>(['0'])
  const nodeNames = new Set<string>()

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

  for (const component of netlist.components) {
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
          'inductor, voltage source (including PULSE/SINE), current source, diode, BJT, MOSFET, op-amp, ' +
          'controlled sources, ground.',
      )
      continue
    }

    const terminals = terminalsFor(component, kind)
    if (!terminals) continue

    const resolved = toDevice(component, kind, terminals)
    if ('error' in resolved) errors.push(resolved.error)
    else devices.push(resolved.device)
  }

  /*
   * Discover unknowns from real device terminals only. `deviceNodes` reports
   * every terminal a part touches, so transistors, op-amps and controlled
   * sources contribute their control nodes, and models with series parasitics
   * (RB/RC/RE) contribute their hidden internal nodes too.
   */
  for (const device of devices) {
    for (const node of deviceNodes(device)) {
      if (isGroundNode(node) || groundNodes.has(node)) continue
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
   * voltage) and op-amps (whose output stage is a voltage constraint referenced
   * to its internal first stage).
   */
  const branchRows = new Map<string, number>()
  for (const device of devices) {
    if (
      device.kind === 'voltage-source' ||
      device.kind === 'inductor' ||
      device.kind === 'vcvs' ||
      device.kind === 'op-amp'
    ) {
      branchRows.set(device.name, sortedNodes.length + branchRows.size)
    }
  }

  if (sortedNodes.length === 0 && devices.length > 0 && errors.length === 0) {
    errors.push('Every net is ground — there is nothing to solve.')
  }

  return {
    model: {
      devices,
      nodeNames: sortedNodes,
      nodeIndex,
      branchRows,
      size: sortedNodes.length + branchRows.size,
      groundNodes,
      notes,
    },
    errors,
  }
}

