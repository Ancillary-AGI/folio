/**
 * Analysis drivers: operating point, transient and AC sweep.
 *
 * Every routine here is a thin, readable wrapper around the matrix assembled by
 * `stamping.ts` and solved by `numeric.ts`. Nothing fabricates a waveform: if an
 * analysis cannot be computed the caller receives an error, never a plausible
 * looking curve.
 */

import { solveRealSystem, solveComplexSystem, cAbs } from './numeric'
import { thermalVoltage } from './devices'
import type { CircuitModel } from './circuitModel'
import {
  createComplexSystem,
  createRealSystem,
  stampAc,
  stampDc,
  stampNonlinearDiodes,
  stampTransient,
  createTransientState,
  diodeCurrentAndConductance,
  type DiodeOperatingPoint,
  type RealSystem,
  type TransientState,
} from './stamping'

/** Default conductance added to every node so a floating net is at least solvable. */
export const DEFAULT_GMIN = 1e-12

export interface Waveform {
  name: string
  type: 'voltage' | 'current' | 'power'
  unit: string
  data: Array<{ x: number; y: number }>
}

export interface AnalysisOutcome {
  /** Node voltages, populated for operating-point style results. */
  nodes: Array<{ name: string; voltage?: number; current?: number }>
  waveforms: Waveform[]
  operatingPoint?: Record<string, number>
  iterations: number
  converged: boolean
  notes: string[]
}

/** Voltage above which a node is almost certainly floating rather than real. */
const IMPLAUSIBLE_VOLTAGE = 1e6

/**
 * Add `gmin` to every node diagonal.
 *
 * This is what SPICE does and it is not a fudge: it models the finite insulation
 * resistance of a real board (~1 TΩ), and it keeps a genuinely floating net from
 * producing a singular matrix that surfaces as an unhelpful "matrix is
 * singular" message. Nodes solved to an implausible voltage are reported
 * explicitly instead (see `collectImplausibleNodes`).
 */
function stampGmin(system: RealSystem, model: CircuitModel, gmin: number): void {
  for (let index = 0; index < model.nodeNames.length; index += 1) {
    system.matrix[index][index] += gmin
  }
}

export interface NewtonOptions {
  temperatureCelsius: number
  gmin?: number
  maxIterations?: number
  relativeTolerance?: number
  absoluteTolerance?: number
  /** Warm start; pass the previous time step's solution for fast convergence. */
  initial?: readonly number[]
}

export interface NewtonResult {
  solution: number[]
  diodeOperatingPoints: Map<string, DiodeOperatingPoint>
  iterations: number
  converged: boolean
}

/**
 * Solve a possibly-nonlinear system with Newton–Raphson.
 *
 * @param stampLinear stamps the linear part (resistors, sources, companions).
 * @returns `null` when the matrix is singular on every iteration, which means
 *          the topology has no solution at all — e.g. two ideal voltage sources
 *          of different values in parallel.
 */
export function solveNewton(
  model: CircuitModel,
  stampLinear: (system: RealSystem) => void,
  options: NewtonOptions,
): NewtonResult | null {
  const {
    temperatureCelsius,
    gmin = DEFAULT_GMIN,
    maxIterations = 100,
    relativeTolerance = 1e-6,
    absoluteTolerance = 1e-9,
  } = options
  const thermal = thermalVoltage(temperatureCelsius)

  // Start diodes at a modest forward bias: that is where the exponential is
  // well-conditioned, and it avoids the first iteration exploding.
  let diodeOperatingPoints = new Map<string, DiodeOperatingPoint>()
  for (const device of model.devices) {
    if (device.kind === 'diode') diodeOperatingPoints.set(device.name, { voltage: 0.6, current: 0 })
  }

  let solution = options.initial ? [...options.initial] : new Array<number>(model.size).fill(0)

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const system = createRealSystem(model)
    stampLinear(system)
    stampGmin(system, model, gmin)
    stampNonlinearDiodes(system, model, diodeOperatingPoints, thermal, gmin)

    const next = solveRealSystem(system.matrix, system.rhs)
    if (!next) return null

    let converged = true
    for (let index = 0; index < model.size; index += 1) {
      const previous = solution[index]
      const current = next[index]
      const tolerance = relativeTolerance * Math.max(Math.abs(current), Math.abs(previous)) + absoluteTolerance
      if (Math.abs(current - previous) > tolerance) converged = false
    }

    const updatedPoints = new Map<string, DiodeOperatingPoint>()
    for (const device of model.devices) {
      if (device.kind !== 'diode') continue
      const p = model.nodeIndex.get(device.p)
      const n = model.nodeIndex.get(device.n)
      const junctionVoltage = (p === undefined ? 0 : next[p]) - (n === undefined ? 0 : next[n])
      const { current } = diodeCurrentAndConductance(device, junctionVoltage, thermal)
      updatedPoints.set(device.name, { voltage: junctionVoltage, current })
    }

    solution = next
    diodeOperatingPoints = updatedPoints
    if (converged) return { solution, diodeOperatingPoints, iterations: iteration, converged: true }
  }

  return { solution, diodeOperatingPoints, iterations: maxIterations, converged: false }
}

/** Map a solution vector onto named node voltages (ground included). */
export function readNodeVoltages(model: CircuitModel, solution: readonly number[]): Map<string, number> {
  const voltages = new Map<string, number>()
  voltages.set('0', 0)
  for (const node of model.groundNodes) voltages.set(node, 0)
  model.nodeNames.forEach((name, index) => voltages.set(name, solution[index]))
  return voltages
}

/** Map a solution vector onto branch currents, keyed by device name. */
export function readBranchCurrents(model: CircuitModel, solution: readonly number[]): Map<string, number> {
  const currents = new Map<string, number>()
  for (const [name, row] of model.branchRows) currents.set(name, solution[row])
  return currents
}

/** Report nodes whose solved voltage cannot be physical. */
export function collectImplausibleNodes(voltages: ReadonlyMap<string, number>): string[] {
  const notes: string[] = []
  for (const [name, voltage] of voltages) {
    if (name === '0') continue
    if (!Number.isFinite(voltage) || Math.abs(voltage) > IMPLAUSIBLE_VOLTAGE) {
      notes.push(`${name} solved to ${voltage.toPrecision(4)} V, which suggests a floating or unterminated net.`)
    }
  }
  return notes
}

/* ────────────────────────────────────────────────────────────────────────────
 * Operating point
 * ──────────────────────────────────────────────────────────────────────────── */

export interface OperatingPointOptions {
  temperatureCelsius: number
  gmin?: number
}

export interface OperatingPointResult {
  outcome: AnalysisOutcome
  /** Diode conductances at the operating point, for AC/noise linearisation. */
  diodeConductances: Map<string, number>
  /** Full diode bias points (voltage and current), for noise budgeting. */
  diodeOperatingPoints: Map<string, DiodeOperatingPoint>
  solution: number[]
}

/**
 * Solve the DC operating point.
 *
 * Capacitors are open and inductors are short, which is the definition of a DC
 * operating point. The function also returns the small-signal conductance of
 * every diode so that AC and noise analyses can linearise about exactly this
 * bias rather than guessing.
 */
export function runOperatingPoint(model: CircuitModel, options: OperatingPointOptions): OperatingPointResult {
  const newton = solveNewton(model, (system) => stampDc(system, model), {
    temperatureCelsius: options.temperatureCelsius,
    gmin: options.gmin,
  })

  if (!newton) {
    return {
      outcome: {
        nodes: [],
        waveforms: [],
        iterations: 0,
        converged: false,
        notes: [
          'The circuit has no unique operating point. Check for two ideal voltage sources of different ' +
            'values in parallel, or a voltage source short-circuited by a wire.',
        ],
      },
      diodeConductances: new Map(),
      diodeOperatingPoints: new Map(),
      solution: [],
    }
  }

  const voltages = readNodeVoltages(model, newton.solution)
  const thermal = thermalVoltage(options.temperatureCelsius)
  const diodeConductances = new Map<string, number>()
  for (const device of model.devices) {
    if (device.kind !== 'diode') continue
    const point = newton.diodeOperatingPoints.get(device.name)
    if (!point) continue
    diodeConductances.set(device.name, diodeCurrentAndConductance(device, point.voltage, thermal).conductance)
  }

  const notes = collectImplausibleNodes(voltages)
  if (!newton.converged) {
    notes.push(
      `The operating point did not converge after ${newton.iterations} Newton iterations. ` +
        'Check for a floating net, a missing return path, or a diode with no current limit.',
    )
  }

  return {
    outcome: {
      nodes: [...voltages.entries()].map(([name, voltage]) => ({ name, voltage })),
      waveforms: [],
      operatingPoint: Object.fromEntries(voltages),
      iterations: newton.iterations,
      converged: newton.converged,
      notes,
    },
    diodeConductances,
    diodeOperatingPoints: newton.diodeOperatingPoints,
    solution: newton.solution,
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Transient
 * ──────────────────────────────────────────────────────────────────────────── */

export interface TransientOptions {
  temperatureCelsius: number
  stopTime: number
  stepTime: number
  /**
   * `false` (the default, matching SPICE) starts from the DC operating point, so
   * a capacitor charged at DC begins charged. `true` starts from zero stored
   * energy — what you want when watching an RC circuit charge.
   */
  useInitialConditions?: boolean
  gmin?: number
  /** Upper bound on internal steps, to keep the UI responsive. */
  maxPoints?: number
}

/**
 * Transient analysis using backward Euler.
 *
 * The state carried between steps is exactly the capacitor voltages and inductor
 * currents: that is all the companion models need. There is no hidden global
 * state and no smoothing of the result.
 */
export function runTransient(model: CircuitModel, options: TransientOptions): AnalysisOutcome {
  const { temperatureCelsius, stopTime, stepTime, useInitialConditions = false } = options
  const maxPoints = options.maxPoints ?? 2000

  if (!(stopTime > 0) || !(stepTime > 0)) {
    return {
      nodes: [],
      waveforms: [],
      iterations: 0,
      converged: false,
      notes: ['Transient analysis needs a positive stop time and step time.'],
    }
  }

  const requestedSteps = Math.max(1, Math.ceil(stopTime / stepTime))
  const steps = Math.min(requestedSteps, maxPoints)
  const dt = stopTime / steps

  const state: TransientState = createTransientState()
  const notes: string[] = []
  if (steps < requestedSteps) {
    notes.push(
      `Step time was widened to ${(dt * 1e6).toFixed(3)} µs to stay within the ${maxPoints}-point display ` +
        'budget. Reduce the stop time for finer resolution.',
    )
  }

  let initialSolution: number[] | undefined
  if (useInitialConditions) {
    for (const device of model.devices) {
      if (device.kind === 'capacitor') state.capacitorVoltages.set(device.name, 0)
      if (device.kind === 'inductor') state.inductorCurrents.set(device.name, 0)
    }
  } else {
    const operatingPoint = runOperatingPoint(model, { temperatureCelsius, gmin: options.gmin })
    if (operatingPoint.solution.length === 0) {
      return { nodes: [], waveforms: [], iterations: 0, converged: false, notes: operatingPoint.outcome.notes }
    }
    const voltages = readNodeVoltages(model, operatingPoint.solution)
    const currents = readBranchCurrents(model, operatingPoint.solution)
    for (const device of model.devices) {
      if (device.kind === 'capacitor') {
        state.capacitorVoltages.set(device.name, (voltages.get(device.p) ?? 0) - (voltages.get(device.n) ?? 0))
      }
      if (device.kind === 'inductor') {
        state.inductorCurrents.set(device.name, currents.get(device.name) ?? 0)
      }
    }
    initialSolution = operatingPoint.solution
  }

  const voltageSeries = new Map<string, Array<{ x: number; y: number }>>()
  for (const node of model.nodeNames) voltageSeries.set(node, [])

  let iterations = 0
  let converged = true
  let warmStart = initialSolution

  for (let step = 1; step <= steps; step += 1) {
    const newton = solveNewton(model, (system) => stampTransient(system, model, dt, state), {
      temperatureCelsius,
      gmin: options.gmin,
      initial: warmStart,
    })

    const time = step * dt
    if (!newton) {
      notes.push(`The transient solve failed at t = ${(time * 1e3).toFixed(4)} ms (singular matrix).`)
      converged = false
      break
    }

    iterations += newton.iterations
    if (!newton.converged) {
      notes.push(`Newton did not converge at t = ${(time * 1e3).toFixed(4)} ms.`)
      converged = false
      break
    }

    warmStart = newton.solution
    const voltages = readNodeVoltages(model, newton.solution)
    const currents = readBranchCurrents(model, newton.solution)

    for (const device of model.devices) {
      if (device.kind === 'capacitor') {
        state.capacitorVoltages.set(device.name, (voltages.get(device.p) ?? 0) - (voltages.get(device.n) ?? 0))
      }
      if (device.kind === 'inductor') {
        state.inductorCurrents.set(device.name, currents.get(device.name) ?? 0)
      }
    }

    for (const node of model.nodeNames) {
      voltageSeries.get(node)?.push({ x: time, y: voltages.get(node) ?? 0 })
    }
  }

  const waveforms: Waveform[] = []
  for (const [node, data] of voltageSeries) {
    if (data.length === 0) continue
    waveforms.push({ name: `V(${node})`, type: 'voltage', unit: 'V', data })
  }

  return { nodes: [], waveforms, iterations, converged, notes }
}

/* ────────────────────────────────────────────────────────────────────────────
 * AC sweep
 * ──────────────────────────────────────────────────────────────────────────── */

export interface AcSweepOptions {
  temperatureCelsius: number
  startFrequency: number
  stopFrequency: number
  /** Logarithmic sweep density. Ignored when `linearPoints` is given. */
  pointsPerDecade?: number
  /** Use a linear frequency sweep with this many points instead. */
  linearPoints?: number
  gmin?: number
  /** Node used to derive the phase reference for Bode-style plots. */
  referenceNode?: string
}

/** Build the frequency grid for an AC sweep. */
export function buildFrequencyGrid(options: AcSweepOptions): number[] {
  const { startFrequency, stopFrequency, pointsPerDecade = 20, linearPoints } = options
  if (linearPoints !== undefined && linearPoints > 0) {
    const count = Math.min(Math.max(2, Math.floor(linearPoints)), 2000)
    const step = (stopFrequency - startFrequency) / (count - 1)
    return Array.from({ length: count }, (_, index) => startFrequency + index * step)
  }

  const decades = Math.log10(stopFrequency / startFrequency)
  const count = Math.min(Math.max(2, Math.round(decades * pointsPerDecade) + 1), 2000)
  const ratio = Math.pow(stopFrequency / startFrequency, 1 / (count - 1))
  return Array.from({ length: count }, (_, index) => startFrequency * Math.pow(ratio, index))
}

/**
 * AC small-signal sweep.
 *
 * Solves the complex MNA system once per frequency point. Diodes are linearised
 * at the DC operating point, which the routine computes first — so an AC result
 * always describes the bias you actually designed, not an arbitrary one.
 *
 * Waveforms are returned as magnitude (in volts) with the frequency in hertz on
 * `x`, plus a matching phase waveform in degrees. A magnitude-only plot hides
 * the sign that tells you which way a feedback loop goes, so both are emitted.
 */
export function runAcSweep(model: CircuitModel, options: AcSweepOptions): AnalysisOutcome {
  const {
    temperatureCelsius,
    startFrequency,
    stopFrequency,
    gmin = DEFAULT_GMIN,
  } = options

  if (!(startFrequency > 0) || !(stopFrequency > 0)) {
    return {
      nodes: [],
      waveforms: [],
      iterations: 0,
      converged: false,
      notes: ['AC analysis needs positive start and stop frequencies.'],
    }
  }
  if (stopFrequency < startFrequency) {
    return {
      nodes: [],
      waveforms: [],
      iterations: 0,
      converged: false,
      notes: ['AC analysis needs a stop frequency at least as large as the start frequency.'],
    }
  }

  // Bias-dependent linearisation: the operating point is the physics here.
  const operatingPoint = runOperatingPoint(model, { temperatureCelsius, gmin })
  const notes = [...operatingPoint.outcome.notes]

  const frequencies = buildFrequencyGrid(options)
  const magnitude = new Map<string, Array<{ x: number; y: number }>>()
  const phase = new Map<string, Array<{ x: number; y: number }>>()
  for (const node of model.nodeNames) {
    magnitude.set(node, [])
    phase.set(node, [])
  }

  let converged = true
  for (const frequency of frequencies) {
    const omega = 2 * Math.PI * frequency
    const system = createComplexSystem(model)
    stampAc(system, model, omega, operatingPoint.diodeConductances, gmin)

    const solution = solveComplexSystem(system.matrix, system.rhs)
    if (!solution) {
      notes.push(`The AC solve is singular at ${frequency.toPrecision(4)} Hz.`)
      converged = false
      break
    }

    model.nodeNames.forEach((node, index) => {
      const value = solution[index]
      magnitude.get(node)?.push({ x: frequency, y: cAbs(value) })
      phase.get(node)?.push({ x: frequency, y: (Math.atan2(value.im, value.re) * 180) / Math.PI })
    })
  }

  const waveforms: Waveform[] = []
  for (const node of model.nodeNames) {
    const magnitudeData = magnitude.get(node) ?? []
    const phaseData = phase.get(node) ?? []
    if (magnitudeData.length > 0) {
      waveforms.push({ name: `|V(${node})|`, type: 'voltage', unit: 'V', data: magnitudeData })
    }
    if (phaseData.length > 0) {
      waveforms.push({ name: `phase V(${node})`, type: 'voltage', unit: 'deg', data: phaseData })
    }
  }

  return { nodes: [], waveforms, iterations: operatingPoint.outcome.iterations, converged, notes }
}
