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

import { buildCircuitModel, type CircuitModel } from './circuitModel'
import { resolveOutputNode, runNoiseAnalysis } from './noise'
import { runMonteCarlo } from './monteCarlo'
import { runAcSweep, runOperatingPoint, runTransient, type AnalysisOutcome } from './solver'

export interface SimulationParameters {
  type: 'dc' | 'ac' | 'transient' | 'noise' | 'montecarlo'
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
  /** Net whose voltage noise is measured, for `noise` analysis. */
  outputNode?: string
  /** Number of perturbed runs, for `montecarlo`. */
  iterations?: number
  /** Fractional R/C/L tolerance for `montecarlo` (0.05 = ±5 %). */
  tolerance?: number
  /** Seed for the `montecarlo` PRNG; the same seed reproduces the sweep. */
  seed?: number
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
}

const DEFAULT_TEMPERATURE_CELSIUS = 27

/** Run the analysis requested by `parameters` against `model`. */
function dispatch(model: CircuitModel, parameters: SimulationParameters): AnalysisOutcome {
  const temperatureCelsius = parameters.temperature ?? DEFAULT_TEMPERATURE_CELSIUS

  switch (parameters.type) {
    case 'dc':
      return runOperatingPoint(model, { temperatureCelsius }).outcome

    case 'transient':
      return runTransient(model, {
        temperatureCelsius,
        stopTime: parameters.stopTime ?? 1e-3,
        stepTime: parameters.stepTime ?? 1e-6,
        useInitialConditions: parameters.useInitialConditions ?? false,
      })

    case 'ac':
      return runAcSweep(model, {
        temperatureCelsius,
        startFrequency: parameters.startFreq ?? 10,
        stopFrequency: parameters.stopFreq ?? 1e6,
        pointsPerDecade: parameters.pointsPerDecade ?? 20,
      })

    case 'noise':
      return runNoiseAnalysis(model, {
        temperatureCelsius,
        startFrequency: parameters.startFreq ?? 10,
        stopFrequency: parameters.stopFreq ?? 1e6,
        pointsPerDecade: parameters.pointsPerDecade ?? 10,
        outputNode: parameters.outputNode,
      })

    case 'montecarlo': {
      /*
       * A tolerance sweep has to sweep a measurement, so it repeats the *parent*
       * analysis. Without an explicit parent we sweep the operating point, which
       * is the common case: "how far does my bias move over tolerance?".
       */
      const parent: SimulationParameters = { ...parameters, type: 'dc' }
      return runMonteCarlo(model, (perturbed) => dispatch(perturbed, parent), {
        iterations: parameters.iterations ?? 100,
        tolerance: parameters.tolerance ?? 0.05,
        seed: parameters.seed,
      })
    }
  }
}

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

    const { model, errors } = buildCircuitModel(netlist)
    if (errors.length > 0) {
      return {
        success: false,
        error: errors.join(' '),
        nodes: [],
        waveforms: [],
        notes: model.notes,
        analysis: parameters.type,
      }
    }

    try {
      const outcome = dispatch(model, parameters)
      return {
        success: outcome.converged,
        error: outcome.converged ? undefined : outcome.notes[0],
        nodes: outcome.nodes,
        waveforms: outcome.waveforms,
        operatingPoint: outcome.operatingPoint,
        convergenceInfo: { iterations: outcome.iterations, converged: outcome.converged },
        notes: [...model.notes, ...outcome.notes],
        analysis: parameters.type,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'The simulation failed unexpectedly.',
        nodes: [],
        waveforms: [],
        notes: model.notes,
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

    for (const component of netlist.components) {
      const value =
        component.parameters.value ?? component.parameters.dcVoltage ?? component.parameters.dc
      lines.push(
        `${component.name} ${component.nodes.join(' ')}${value !== undefined ? ` ${String(value)}` : ''}`,
      )
    }

    lines.push('')
    for (const analysis of netlist.analyses) {
      switch (analysis.type) {
        case 'dc':
          lines.push('.op')
          break
        case 'transient':
          lines.push(`.tran ${analysis.stepTime ?? 1e-6} ${analysis.stopTime ?? 1e-3}`)
          break
        case 'ac':
          lines.push(
            `.ac dec ${analysis.pointsPerDecade ?? 20} ${analysis.startFreq ?? 10} ${analysis.stopFreq ?? 1e6}`,
          )
          break
        case 'noise':
          lines.push(
            `.noise v(${analysis.outputNode ?? 'out'}) v1 dec ${analysis.pointsPerDecade ?? 10} ` +
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
    if (netlist.components.length === 0) errors.push('The circuit has no components.')
    if (netlist.analyses.length === 0) warnings.push('No analysis is selected.')

    const { model, errors: modelErrors } = buildCircuitModel(netlist)
    errors.push(...modelErrors)
    warnings.push(...model.notes)

    const nodeConnections = new Map<string, number>()
    for (const device of model.devices) {
      for (const node of [device.p, device.n]) {
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
