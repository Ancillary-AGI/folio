/**
 * Circuit simulation engine — public facade.
 *
 * This module owns the shape of a simulation request/result and nothing else.
 * All numerics live in the modules beside it:
 *
 *   numeric.ts      complex arithmetic, LU solvers, seeded PRNG
 *   devices.ts      device model + SPICE value parsing
 *   circuitModel.ts netlist → typed devices + MNA unknown layout
 *   stamping.ts     device → matrix contributions (DC / transient / AC)
 *   solver.ts       Newton iteration, operating point, transient, AC sweep
 *   noise.ts        adjoint-method output noise
 *   monteCarlo.ts   seeded tolerance sweep
 *
 * Every analysis returns numbers derived from the circuit that was drawn. When
 * an analysis cannot be computed (singular topology, missing output net,
 * non-convergence) the result carries `success: false` and an explanation —
 * never a synthesised curve.
 */

import { buildCircuitModel } from './circuitModel'
import { deviceNodes, isInternalNode, parseMillimetres, parseSpiceValue } from './devices'
import { resolveOutputNode } from './noise'
import { runMonteCarloAsync } from '../acceleration/monteCarloDispatch'
import { runAcSweepAsync } from '../acceleration/acSweepDispatch'
import { runNoiseSweepAsync } from '../acceleration/noiseSweepDispatch'
import { DEFAULT_TEMPERATURE_CELSIUS, resolveTemperatureCelsius, runCircuitAnalysis } from './analysisRunner'
import { type AnalysisOutcome } from './solver'
import { microstripEffectiveEr, tdFromGeometry, z0FromGeometry } from './transmissionLine'
import { normalizeModelCards, resolveModelCard, type SpiceModelCard } from './modelLibrary'

export interface SimulationParameters {
  type: 'dc' | 'dc-sweep' | 'transient' | 'ac' | 'noise' | 'montecarlo'
  startTime?: number
  stopTime?: number
  stepTime?: number
  startFreq?: number
  stopFreq?: number
  pointsPerDecade?: number
  /** Operating temperature in degrees Celsius. Defaults to 27 °C. */
  temperature?: number
  /**
   * Start a transient from zero stored energy instead of the DC operating point.
   * `false` matches SPICE (`.tran` without `UIC`).
   */
  useInitialConditions?: boolean
  /**
   * Transient companion-model integration rule. `backward-euler` (default) is
   * unconditionally stable and monotone; `trapezoidal` is second-order accurate
   * and preserves LC oscillation; `bdf2` (Gear order 2) is also second-order
   * and A-stable but damps high-frequency numerical ringing.
   */
  integrationMethod?: 'backward-euler' | 'trapezoidal' | 'bdf2'
  /** Net whose voltage noise is measured, for `noise` analysis. */
  outputNode?: string
  /** Number of perturbed runs, for `montecarlo`. */
  iterations?: number
  /** Fractional R/C/L tolerance for `montecarlo` (0.05 = ±5 %). */
  tolerance?: number
  /** Seed for the `montecarlo` PRNG; the same seed reproduces the sweep. */
  seed?: number
  /**
   * `dc-sweep`: reference designator of the component to step (`V1`, `RLOAD`),
   * or `TEMP` to step the junction temperature. Its value is the plot's x axis.
   */
  sweepSource?: string
  /** `dc-sweep`: first value of the sweep. */
  sweepStart?: number
  /** `dc-sweep`: last value of the sweep. */
  sweepStop?: number
  /** `dc-sweep`: value added per point; its sign sets the direction. */
  sweepStep?: number
}

export interface SimulationNode {
  name: string
  voltage?: number
  current?: number
}

export interface SimulationResult {
  success: boolean
  error?: string
  nodes: SimulationNode[]
  waveforms: Array<{
    name: string
    type: 'voltage' | 'current' | 'power'
    unit: string
    data: Array<{ x: number; y: number }>
  }>
  operatingPoint?: Record<string, number>
  convergenceInfo?: {
    iterations: number
    converged: boolean
  }
  /** Diagnostics: floating nets, non-convergence, step-size adjustments. */
  notes?: string[]
  /** Which analysis produced this result, for the UI to label the plot. */
  analysis?: SimulationParameters['type']
  /** Probe measurements derived from the solved circuit. */
  probes?: import('./probes').ProbeResult[]
  /**
   * Branch currents at the final solved point (sources, inductors, controlled
   * sources), and current through every device whose model defines one.
   * Together with `operatingPoint` this is what a ratings/thermal check needs.
   */
  branchCurrents?: Record<string, number>
  deviceCurrents?: Record<string, number>
  /** Junction/ambient temperature the solve used, °C. */
  temperatureCelsius?: number
}

export interface Component {
  type: string
  name: string
  nodes: string[]
  parameters: Record<string, string | number | boolean>
}

export interface CircuitNetlist {
  title: string
  components: Component[]
  analyses: SimulationParameters[]
  options?: Record<string, string | number | boolean>
  probes?: import('./probes').RawProbe[]
  /**
   * SPICE `.model` cards, keyed by name. A semiconductor component references
   * one through its `model`/`part`/`mpn`/`type` property; the card's values
   * override the stock part-number card, and a value typed on the symbol still
   * wins over both.
   */
  models?: Record<string, SpiceModelCard>
}


/**
 * Render one netlist component as a SPICE element line.
 *
 * Each family gets its own card form — a JFET is a `J` line with its model
 * name, a switch is an `S`/`W` line with its model name, a B source is its
 * expression — so the exported deck is the circuit that was simulated, not a
 * bare reference designator with a value appended.
 */
function renderSpiceElement(component: Component, modelCards = new Map<string, SpiceModelCard>()): string {
  const parameters = component.parameters
  const first = (value: unknown): string | undefined => (value === undefined ? undefined : String(value))
  const parameter = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = first(parameters[key])
      if (value !== undefined && value !== '') return value
    }
    const entries = Object.entries(parameters)
    for (const key of keys) {
      const wanted = key.toLowerCase()
      for (const [name, value] of entries) {
        if (name.toLowerCase() === wanted) {
          const text = first(value)
          if (text !== undefined && text !== '') return text
        }
      }
    }
    return undefined
  }
  const type = `${parameter('type', 'part', 'model') ?? ''}`.toLowerCase()
  const nodes = component.nodes.join(' ')
  const model = parameter('part', 'model', 'type', 'mpn') ?? type.split(/[^a-z0-9]+/)[0] ?? 'DEFAULT'
  if (/transformer|coupledinductor/.test(`${component.type} ${type}`.toLowerCase())) {
    const l1 = parameter('l1', 'primaryInductance', 'inductance', 'value') ?? '1'
    const l2 = parameter('l2', 'secondaryInductance') ?? l1
    const k = parameter('k', 'coupling') ?? '1'
    const [p1, n1, p2, n2] = component.nodes
    return (
      `L${component.name}_P ${p1} ${n1} ${l1}\n` +
      `L${component.name}_S ${p2} ${n2} ${l2}\n` +
      `K${component.name} L${component.name}_P L${component.name}_S ${k}`
    )
  }
  if (component.nodes.length === 0 && /mutual|coupl/.test(`${component.type} ${type}`.toLowerCase())) {
    const l1 = parameter('l1', 'primary') ?? ''
    const l2 = parameter('l2', 'secondary') ?? ''
    const k = parameter('k', 'coupling') ?? '1'
    return `K${component.name} ${l1} ${l2} ${k}`.trim()
  }
  if (/transmissionline|delayline|tline/.test(`${component.type} ${type}`.toLowerCase()) || /^tl?\d/i.test(component.name)) {
    const [p1, n1, p2, n2] = component.nodes
    if (!p1 || !n1 || !p2 || !n2) {
      return `* ${component.name}: a transmission line needs four terminals (p1 n1 p2 n2)`
    }
    const width = parseMillimetres(parameter('widthMm', 'traceWidth', 'width', 'w'), `${component.name} trace width`)
    const height = parseMillimetres(
      parameter('heightMm', 'substrateHeight', 'height', 'h'),
      `${component.name} substrate height`,
    )
    const erRaw = parameter('er', 'epsilonR', 'dielectricConstant', 'dk')
    const epsilonR = erRaw === undefined ? undefined : parseSpiceValue(erRaw, `${component.name} relative permittivity (er)`)
    const z0Parameter = parameter('z0', 'characteristicImpedance', 'impedance', 'zo')
    const z0 =
      z0Parameter ??
      (width !== undefined && height !== undefined && epsilonR !== undefined
        ? String(z0FromGeometry(width, height, epsilonR))
        : '50')

    const length = parseMillimetres(parameter('lengthMm', 'length', 'len'), `${component.name} length`)
    const erEffRaw = parameter('erEff', 'effectiveEr', 'epsilonReff')
    const erEff = erEffRaw === undefined ? undefined : parseSpiceValue(erEffRaw, `${component.name} effective er (erEff)`)
    let td = parameter('td', 'delay', 'delayTime', 'propagationDelay')
    if (td === undefined && length !== undefined && erEff !== undefined) {
      td = String(tdFromGeometry(length, erEff))
    } else if (td === undefined && length !== undefined && epsilonR !== undefined) {
      const effective =
        width !== undefined && height !== undefined ? microstripEffectiveEr(width, height, epsilonR) : epsilonR
      td = String(tdFromGeometry(length, effective))
    }
    if (td === undefined) {
      return `* ${component.name}: a transmission line needs TD, or length with er/erEff`
    }
    const reference = /^t/i.test(component.name) ? component.name : `T${component.name}`
    return `${reference} ${p1} ${n1} ${p2} ${n2} Z0=${z0} TD=${td}`
  }
  if (/jfet|^j\d/i.test(`${component.type} ${component.name} ${type}`)) {
    return `${component.name} ${nodes} ${model}`.trim()
  }

  /*
   * Transistor and diode element lines carry a model name; without one the
   * exported deck is not valid SPICE (`Q1 c b e` is missing its fourth token).
   * A resolved `.model` card names the element exactly as the card is written,
   * so a deck exported from a sheet with custom cards refers to them.
   */
  const kindText = `${component.type} ${type} ${component.name}`.toLowerCase()
  const shadow = /^(npn|pnp|bjt|transistor|mosfet|nmos|pmos|jfet|diode)([_ -]|$)/
  const declaredModel = parameter('model', 'part', 'mpn', 'type')
  const cleanModel = declaredModel && !shadow.test(declaredModel.toLowerCase()) ? declaredModel : undefined
  const resolvedCard = resolveModelCard(component, modelCards)
  const cardModel = resolvedCard?.name ?? cleanModel

  if (/mosfet|nmos|pmos|^m\d/i.test(kindText)) {
    const [drain, gate, source, bulk] = component.nodes
    if (!drain || !gate || !source) {
      return `* ${component.name}: a MOSFET needs drain, gate and source terminals`
    }
    // The solver ties bulk to source implicitly; the exported M line says so.
    const polarity = /pmos|p[_-]?channel/.test(kindText) && !/nmos|n[_-]?channel/.test(kindText)
    return `${component.name} ${drain} ${gate} ${source} ${bulk ?? source} ${cardModel ?? (polarity ? 'PMOS' : 'NMOS')}`
  }
  if (/bjt|transistor|npn|pnp|^q\d/i.test(kindText)) {
    const polarity = /pnp/i.test(kindText) && !/npn/i.test(kindText)
    return `${component.name} ${nodes} ${cardModel ?? (polarity ? 'PNP' : 'NPN')}`.trim()
  }
  if (/diode|^d\d/i.test(kindText)) {
    return `${component.name} ${nodes} ${cardModel ?? 'D'}`.trim()
  }
  if (/voltageswitch|voltagecontrolledswitch/.test(type) || /^s\d/i.test(component.name)) {
    return `${component.name} ${nodes} ${model}`.trim()
  }
  if (/currentswitch|currentcontrolledswitch/.test(type) || /^w\d/i.test(component.name)) {
    const control = parameter('control', 'controlSource', 'vsense', 'v') ?? 'VSENSE'
    return `${component.name} ${nodes} ${control} ${model}`.trim()
  }
  if (/behavioral|arbitrary/.test(type) || /^b\d/i.test(component.name)) {
    const voltage = parameter('v', 'voltage', 'expression', 'expr')
    const current = parameter('i', 'current')
    if (voltage !== undefined) return `${component.name} ${nodes} V=${voltage}`.trim()
    if (current !== undefined) return `${component.name} ${nodes} I=${current}`.trim()
    return `${component.name} ${nodes}`.trim()
  }
  const kind = `${component.type} ${type}`
  if (/pulse/.test(kind)) {
    const get = (key: string, fallback: string): string => parameter(key) ?? fallback
    return (
      `${component.name} ${nodes} PULSE(${get('v1', '0')} ${get('v2', '5')} ${get('td', '0')} ` +
      `${get('tr', '1n')} ${get('tf', '1n')} ${get('pw', '5u')} ${get('per', '10u')})`
    ).trim()
  }
  if (/sine|sin\(/.test(kind)) {
    const get = (key: string, fallback: string): string => parameter(key) ?? fallback
    return (
      `${component.name} ${nodes} SIN(${get('vo', '0')} ${get('va', '1')} ${get('freq', '1k')} ` +
      `${get('td', '0')} ${get('theta', '0')} ${get('phase', '0')})`
    ).trim()
  }
  if (/exp/.test(kind)) {
    const get = (key: string, fallback: string): string => parameter(key) ?? fallback
    return (
      `${component.name} ${nodes} EXP(${get('v1', '0')} ${get('v2', '1')} ${get('td1', '0')} ` +
      `${get('tau1', '1u')} ${get('td2', '0')} ${get('tau2', '1u')})`
    ).trim()
  }
  if (/sffm/.test(kind)) {
    const get = (key: string, fallback: string): string => parameter(key) ?? fallback
    return (
      `${component.name} ${nodes} SFFM(${get('vo', '0')} ${get('va', '1')} ${get('fc', '1k')} ` +
      `${get('mdi', '0')} ${get('fs', '100')})`
    ).trim()
  }
  if (/pwl/.test(kind) || parameter('points', 'pwl') !== undefined) {
    const points = parameter('points', 'pwl') ?? ''
    return `${component.name} ${nodes} PWL(${points})`.trim()
  }
  const value = parameter('value', 'dcVoltage', 'dcCurrent', 'dc', 'voltage', 'current', 'resistance', 'capacitance', 'inductance')
  return `${component.name} ${nodes}${value !== undefined ? ` ${value}` : ''}`.trim()
}

/** The independent voltage source the `.noise` card refers to: the first
 * one in the deck, identified with the same rule the model builder uses. */
function firstVoltageSourceName(components: Component[]): string {
  const matches = components.find((component) => {
    const type = component.type.toLowerCase()
    const name = component.name.toLowerCase()
    return (
      (type.includes('voltage') && type.includes('source')
        && !type.includes('controlled') && !type.includes('behavioral') && !type.includes('arbitrary'))
      || (/^v\d/i.test(name) && !/^vsense/i.test(name))
    )
  })
  return matches?.name ?? 'v1'
}

export { runCircuitAnalysis, DEFAULT_TEMPERATURE_CELSIUS } from './analysisRunner'

class SPICEEngine {
  private isInitialized = false

  /**
   * The solver is pure TypeScript and needs no warm-up, but the lifecycle is
   * kept so a future WASM or worker backend can be slotted in without touching
   * call sites.
   */
  async initialize(): Promise<void> {
    this.isInitialized = true
  }

  async simulate(netlist: CircuitNetlist): Promise<SimulationResult> {
    if (!this.isInitialized) await this.initialize()

    const parameters = netlist.analyses[0]
    if (!parameters) {
      return {
        success: false,
        error: 'Select an analysis before running the simulation.',
        nodes: [],
        waveforms: [],
      }
    }
    // One analysis per run: anything beyond the first used to vanish with no
    // signal, which reads as "everything solved" when it did not.
    const droppedAnalyses = netlist.analyses.slice(1)
    const droppedNote = droppedAnalyses.length > 0
      ? `Only the first analysis ran (${parameters.type}); ${droppedAnalyses.map((analysis) => analysis.type).join(', ')} card(s) were not run.`
      : null
    const extraNotes = droppedNote ? [droppedNote] : []

    const { model, errors } = buildCircuitModel(netlist)
    if (errors.length > 0) {
      return {
        success: false,
        error: errors.join(' '),
        nodes: [],
        waveforms: [],
        notes: [...model.notes, ...extraNotes],
        analysis: parameters.type,
      }
    }

    try {
      /*
       * Three analyses are made of independent units and can use a worker pool:
       * a tolerance sweep (one run per sample), an AC sweep (one complex solve
       * per frequency) and a noise sweep (one adjoint solve per frequency). Each
       * pool reproduces the in-thread result exactly — the same seeds, bias and
       * assembly order — so the acceleration changes how long the answer takes
       * to arrive, not what the answer is.
       */
      let outcome: AnalysisOutcome
      if (parameters.type === 'montecarlo') {
        const parent: SimulationParameters = { ...parameters, type: 'dc' }
        const swept = await runMonteCarloAsync(
          model,
          parent,
          (perturbed) => runCircuitAnalysis(perturbed, parent),
          {
            iterations: parameters.iterations ?? 100,
            tolerance: parameters.tolerance ?? 0.05,
            seed: parameters.seed,
          },
        )
        outcome = swept.result
      } else if (parameters.type === 'ac') {
        const swept = await runAcSweepAsync(model, {
          temperatureCelsius: resolveTemperatureCelsius(parameters),
          startFrequency: parameters.startFreq ?? 10,
          stopFrequency: parameters.stopFreq ?? 1e6,
          pointsPerDecade: parameters.pointsPerDecade ?? 20,
        })
        outcome = swept.result
      } else if (parameters.type === 'noise') {
        const swept = await runNoiseSweepAsync(model, {
          temperatureCelsius: resolveTemperatureCelsius(parameters),
          startFrequency: parameters.startFreq ?? 10,
          stopFrequency: parameters.stopFreq ?? 1e6,
          pointsPerDecade: parameters.pointsPerDecade ?? 10,
          outputNode: parameters.outputNode,
        })
        outcome = swept.result
      } else {
        outcome = runCircuitAnalysis(model, parameters)
      }
      const { measureProbes } = await import('./probes')
      const voltages = new Map(Object.entries(outcome.operatingPoint ?? {}))
      const branchCurrents = new Map(Object.entries(outcome.branchCurrents ?? {}))
      const deviceCurrents = new Map(Object.entries(outcome.deviceCurrents ?? {}))
      const probeResults = measureProbes(model, model.probes, voltages, branchCurrents, deviceCurrents)
      /*
       * A probe that could not be measured carries `value: null` and a reason.
       * Those reasons are pushed into the notes so the failure reaches the
       * readout instead of vanishing with the missing value.
       */
      const probeNotes = probeResults
        .filter((probe) => probe.error)
        .map((probe) => `Probe ${probe.label}: ${probe.error}`)
      return {
        success: outcome.converged,
        error: outcome.converged
          ? undefined
          : outcome.notes[0] ?? 'The solver did not converge.',
        nodes: outcome.nodes,
        waveforms: outcome.waveforms,
        operatingPoint: outcome.operatingPoint,
        convergenceInfo: { iterations: outcome.iterations, converged: outcome.converged },
        notes: [...model.notes, ...outcome.notes, ...probeNotes, ...extraNotes],
        analysis: parameters.type,
        probes: probeResults,
        branchCurrents: outcome.branchCurrents,
        deviceCurrents: outcome.deviceCurrents,
        temperatureCelsius: parameters.temperature ?? DEFAULT_TEMPERATURE_CELSIUS,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'The simulation failed unexpectedly.',
        nodes: [],
        waveforms: [],
        notes: [...model.notes, ...extraNotes],
        analysis: parameters.type,
      }
    }
  }

  /**
   * Render a SPICE deck for the netlist. Useful for export, for review by another
   * engineer, and for cross-checking results against ngspice.
   */
  generateSPICENetlist(netlist: CircuitNetlist): string {
    const lines: string[] = [`* ${netlist.title || 'Untitled circuit'}`, '* Generated by Folio', '']
    const modelCards = normalizeModelCards(netlist.models)

    for (const component of netlist.components) {
      lines.push(renderSpiceElement(component, modelCards))
    }

    lines.push('')
    for (const card of new Set(modelCards.values())) {
      const parameters = Object.entries(card.parameters)
        .filter(([, value]) => Number.isFinite(value))
        .map(([key, value]) => `${key}=${value}`)
        .join(' ')
      lines.push(`.model ${card.name} ${card.type} (${parameters})`)
    }
    if (modelCards.size > 0) lines.push('')
    for (const analysis of netlist.analyses) {
      switch (analysis.type) {
        case 'dc':
          lines.push('.op')
          break
        case 'dc-sweep': {
          /*
           * `.dc <source> <start> <stop> <step>`, or `.dc TEMP …` for a thermal
           * sweep — the same card any SPICE tool reads back.
           */
          const target = (analysis.sweepSource ?? '').trim() || 'TEMP'
          lines.push(
            `.dc ${target} ${analysis.sweepStart ?? 0} ${analysis.sweepStop ?? 5} ` +
              `${analysis.sweepStep ?? 0.1}`,
          )
          break
        }
        case 'transient': {
          // `.tran Tstep Tstop [Tstart [Tmax]] [UIC]`
          const uic = analysis.useInitialConditions ? ' UIC' : ''
          lines.push(`.tran ${analysis.stepTime ?? 1e-6} ${analysis.stopTime ?? 1e-3}${uic}`)
          if (analysis.integrationMethod === 'trapezoidal') {
            lines.push('.options method=trap')
          } else if (analysis.integrationMethod === 'bdf2') {
            // Gear order 2 is BDF2; SPICE defaults to a lower order on startup
            // and may adapt it, so this pins the exported rule.
            lines.push('.options method=gear maxord=2')
          } else {
            // SPICE has no backward-Euler switch; say so rather than let a
            // cross-check against ngspice silently compare different rules.
            lines.push('* Folio integrates this run with backward Euler; SPICE .tran defaults to trapezoidal.')
          }
          break
        }
        case 'ac':
          lines.push(
            `.ac dec ${analysis.pointsPerDecade ?? 20} ${analysis.startFreq ?? 10} ${analysis.stopFreq ?? 1e6}`,
          )
          break
        case 'noise':
          lines.push(
            `.noise v(${analysis.outputNode ?? 'out'}) ${firstVoltageSourceName(netlist.components)} ` +
              `dec ${analysis.pointsPerDecade ?? 10} ` +
              `${analysis.startFreq ?? 10} ${analysis.stopFreq ?? 1e6}`,
          )
          break
        case 'montecarlo':
          lines.push(
            `* Monte Carlo: ${analysis.iterations ?? 100} runs, ` +
              `±${((analysis.tolerance ?? 0.05) * 100).toFixed(1)} %`,
          )
          break
      }
    }

    if (netlist.options) {
      for (const [key, value] of Object.entries(netlist.options)) {
        lines.push(`.options ${key}=${String(value)}`)
      }
    }

    lines.push('.end')
    return `${lines.join('\n')}\n`
  }

  /**
   * Pre-flight validation.
   *
   * Structural checks (ground reference, floating nets) are combined with the
   * model builder's own findings, so the user sees everything that would stop a
   * simulation in one pass instead of one problem per run.
   */
  async validateNetlist(netlist: CircuitNetlist): Promise<{
    isValid: boolean
    errors: string[]
    warnings: string[]
  }> {
    const errors: string[] = []
    const warnings: string[] = []

    if (!netlist.title) warnings.push('The netlist has no title.')
    if (netlist.analyses.length === 0) warnings.push('No analysis is selected.')

    /*
     * `buildCircuitModel` already reports an empty component list, so the
     * message must not be pushed twice here.
     */
    const { model, errors: modelErrors } = buildCircuitModel(netlist)
    errors.push(...modelErrors)
    warnings.push(...model.notes)

    const nodeConnections = new Map<string, number>()
    for (const device of model.devices) {
      // Every real terminal counts, including both ports of a line and the
      // base/gate of a transistor; model-internal taps are not schematic nets.
      for (const node of deviceNodes(device)) {
        if (isInternalNode(node)) continue
        nodeConnections.set(node, (nodeConnections.get(node) ?? 0) + 1)
      }
    }

    const hasGroundReference = netlist.components.some((component) =>
      component.nodes.some((node) => node === '0' || node.trim().toUpperCase() === 'GND'),
    )
    if (!hasGroundReference && model.groundNodes.size === 1 && model.devices.length > 0) {
      errors.push('The circuit has no ground reference. Add a ground symbol, or name a net "0".')
    }

    for (const [node, connections] of nodeConnections) {
      if (connections < 2 && !model.groundNodes.has(node)) {
        warnings.push(`Net "${node}" connects to only one terminal and will float.`)
      }
    }

    const analysis = netlist.analyses[0]
    if (analysis?.temperature !== undefined) {
      if (!Number.isFinite(analysis.temperature) || analysis.temperature <= -273.15) {
        errors.push('Temperature must be a finite value above absolute zero (-273.15 °C).')
      }
    }
    if (analysis?.type === 'noise' && !resolveOutputNode(model, analysis.outputNode)) {
      errors.push(
        analysis.outputNode
          ? `Noise analysis: output net "${analysis.outputNode}" does not exist in this circuit.`
          : 'Noise analysis: choose an output net, or name one "OUT".',
      )
    }

    return { isValid: errors.length === 0, errors, warnings }
  }

  /** Release any resources. A no-op for the pure-TypeScript solver. */
  dispose(): void {
    this.isInitialized = false
  }
}

export const spiceEngine = new SPICEEngine()
