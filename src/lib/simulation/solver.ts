/**
 * Analysis drivers: operating point, transient and AC sweep.
 *
 * Every routine here is a thin, readable wrapper around the matrix assembled by
 * `stamping.ts` and solved by `numeric.ts`. Nothing fabricates a waveform: if an
 * analysis cannot be computed the caller receives an error, never a plausible
 * looking curve.
 */

import { solveRealSystem, solveComplexSystem, cAbs } from './numeric'
import { isInternalNode, thermalVoltage } from './devices'
import { behavioralCompiled, validateBehavioralProbes, type CircuitModel } from './circuitModel'
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
  type SweepOverride,
  type TransientState,
} from './stamping'
import {
  createSemiconductorState,
  readSemiconductorState,
  stampSemiconductorLinear,
  stampSemiconductorNonlinear,
  stampSemiconductorSmallSignal,
  updateTransientState,
  type SemiconductorState,
} from './semiconductors'

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
  /** Transient clock carried into B-source TIME probes. */
  time?: number
}

export interface NewtonResult {
  solution: number[]
  diodeOperatingPoints: Map<string, DiodeOperatingPoint>
  /** BJT/MOSFET/op-amp bias points at the solution. */
  semiconductor: SemiconductorState
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

  /*
   * BJTs, MOSFETs and op-amps start from a plausible bias too (see
   * `createSemiconductorState`), and their companions are rebuilt from the
   * previous iterate on every pass — including the op-amp output clamp, whose
   * rails are the supply nodes as the iterate currently sees them.
   */
  let semiconductor = createSemiconductorState(model, thermal)

  let solution = options.initial ? [...options.initial] : new Array<number>(model.size).fill(0)

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const system = createRealSystem(model)
    stampLinear(system)
    stampGmin(system, model, gmin)
    stampNonlinearDiodes(system, model, diodeOperatingPoints, thermal, gmin)
    stampSemiconductorNonlinear(system, model, semiconductor, thermal, readNodeVoltages(model, solution), gmin, {
      currents: readBranchCurrents(model, solution),
      time: options.time ?? 0,
    })

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
      const rawVoltage = (p === undefined ? 0 : next[p]) - (n === undefined ? 0 : next[n])
      // SPICE pnjlim: a forward step beyond ~2× thermal cries wolf — limit
      // the change per iteration so the exponential cannot slingshot Newton
      // into overflow. Reverse is unbounded (well-conditioned).
      const previous = diodeOperatingPoints.get(device.name)?.voltage ?? 0
      const vt = device.emissionCoefficient * thermal
      let junctionVoltage = rawVoltage
      if (rawVoltage > 0) {
        const change = rawVoltage - previous
        const critical = 2 * vt
        if (change > critical) {
          junctionVoltage = previous + vt * (2 + Math.log(Math.max(change / vt - 1, 1e-12)))
        }
      }
      const { current } = diodeCurrentAndConductance(device, junctionVoltage, thermal)
      updatedPoints.set(device.name, { voltage: junctionVoltage, current })
    }

    solution = next
    diodeOperatingPoints = updatedPoints
    // Switch hysteresis lives in the previous iterate's state, but every other
    // bias point is rebuilt from the new solution: carry the switch states over.
    // Without this an S/W device forgets which side of its band it is on and
    // the state written during stamping is discarded every iteration.
    semiconductor = readSemiconductorState(model, readNodeVoltages(model, next), thermal, semiconductor)
    if (converged) {
      return { solution, diodeOperatingPoints, semiconductor, iterations: iteration, converged: true }
    }
  }

  return { solution, diodeOperatingPoints, semiconductor, iterations: maxIterations, converged: false }
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
  /** Substitute one device's DC value, or the junction temperature (DC sweep). */
  override?: SweepOverride
  /**
   * Warm start for Newton. The DC sweep passes the previous point's solution:
   * consecutive points of a sweep are nearly the same circuit, so this is where
   * most of a sweep's speed comes from.
   */
  initial?: readonly number[]
  /** Transient clock carried into B-source TIME probes (transient analysis). */
  time?: number
}

export interface OperatingPointResult {
  outcome: AnalysisOutcome
  /** Diode conductances at the operating point, for AC/noise linearisation. */
  diodeConductances: Map<string, number>
  /** Full diode bias points (voltage and current), for noise budgeting. */
  diodeOperatingPoints: Map<string, DiodeOperatingPoint>
  /** BJT, MOSFET and op-amp bias points at the operating point. */
  semiconductor: SemiconductorState
  solution: number[]
}

/** A model-level failure before Newton starts: no solution, but a usable state. */
function failedOperatingPoint(model: CircuitModel, thermal: number, note: string): OperatingPointResult {
  return {
    outcome: { nodes: [], waveforms: [], iterations: 0, converged: false, notes: [note] },
    diodeConductances: new Map(),
    diodeOperatingPoints: new Map(),
    semiconductor: createSemiconductorState(model, thermal),
    solution: [],
  }
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
  /*
   * A temperature sweep changes the thermal voltage, so it is resolved once here
   * and every downstream call (Newton's linearisation, the returned bias points)
   * uses that same value rather than each re-reading the nominal setting.
   */
  const temperatureCelsius =
    options.override?.kind === 'temperature' ? options.override.value : options.temperatureCelsius
  const thermal = thermalVoltage(temperatureCelsius)

  // A B source probing a net or source that does not exist is a model error,
  // reported once before Newton starts rather than as a silent zero per step.
  for (const device of model.devices) {
    if (device.kind !== 'behavioral-source') continue
    const parsed = behavioralCompiled(device)
    if ('error' in parsed) {
      return failedOperatingPoint(model, thermal, parsed.error)
    }
    const invalid = validateBehavioralProbes(model, device.name, parsed.expression)
    if (invalid) return failedOperatingPoint(model, thermal, invalid)
  }

  const newton = solveNewton(
    model,
    (system) => {
      stampDc(system, model, options.override)
      /*
       * The bias-independent half of every semiconductor device: the BJT series
       * resistances (RB/RC/RE) and the op-amp's input resistance and first-stage
       * load. They are ordinary linear elements, so they are stamped here in the
       * same pass `solveNewton` rebuilds each iteration — a BJT whose internal
       * base node is never tied to its terminal is simply an open circuit, and
       * the operating point would read "every transistor off" with no error.
       * `semiconductors.ts` owns the stamps (hence the call rather than a case
       * in `stampDc`), and the transient path adds them beside its companions.
       */
      stampSemiconductorLinear(system, model)
    },
    {
      temperatureCelsius,
      gmin: options.gmin,
      initial: options.initial,
      time: options.time,
    },
  )

  if (!newton) {
    return failedOperatingPoint(model, thermal,
      'The circuit has no unique operating point. Check for two ideal voltage sources of different ' +
        'values in parallel, or a voltage source short-circuited by a wire.',
    )
  }

  const voltages = readNodeVoltages(model, newton.solution)
  const diodeConductances = new Map<string, number>()
  for (const device of model.devices) {
    if (device.kind !== 'diode') continue
    const point = newton.diodeOperatingPoints.get(device.name)
    if (!point) continue
    diodeConductances.set(device.name, diodeCurrentAndConductance(device, point.voltage, thermal).conductance)
  }

  /*
   * Model-internal nodes (BJT series-resistance taps, the op-amp first stage)
   * are solved but never shown: they are not schematic nets, and a user cannot
   * probe them. They stay in `voltages`, which the callers use for
   * linearisation.
   */
  const visible = new Map([...voltages].filter(([name]) => !isInternalNode(name) && name !== '0'))
  const notes = collectImplausibleNodes(visible)
  if (!newton.converged) {
    notes.push(
      `The operating point did not converge after ${newton.iterations} Newton iterations. ` +
        'Check for a floating net, a missing return path, or a diode with no current limit.',
    )
  }

  return {
    outcome: {
      nodes: [...visible.entries()].map(([name, voltage]) => ({ name, voltage })),
      waveforms: [],
      operatingPoint: Object.fromEntries(visible),
      iterations: newton.iterations,
      converged: newton.converged,
      notes,
    },
    diodeConductances,
    diodeOperatingPoints: newton.diodeOperatingPoints,
    semiconductor: newton.semiconductor,
    solution: newton.solution,
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * DC sweep
 * ──────────────────────────────────────────────────────────────────────────── */

/** What a DC sweep varies, and over what interval. */
export interface DcSweepOptions {
  /** Nominal junction temperature, °C. Replaced per point by a temperature sweep. */
  temperatureCelsius: number
  /** Reference designator of the device to vary, e.g. `V1`. */
  deviceName?: string
  /** Vary the junction temperature instead of a device (SPICE's `temp` sweep). */
  sweepTemperature?: boolean
  startValue: number
  stopValue: number
  /** Step magnitude and direction; its sign picks the sweep direction. */
  stepValue: number
  gmin?: number
  /** Upper bound on points, so a sweep cannot outgrow the plot. */
  maxPoints?: number
}

/** One solved sweep point. */
export interface DcSweepPoint {
  /** The swept value: volts, amperes, ohms or °C. */
  value: number
  /** Node name → voltage, internal model nodes excluded. */
  voltages: Record<string, number>
}

export interface DcSweepResult {
  outcome: AnalysisOutcome
  points: DcSweepPoint[]
}

/**
 * Build the swept values.
 *
 * SPICE's own rules, including the one that catches people out: the sign of the
 * step decides the direction, and a step whose sign disagrees with the interval
 * is an empty sweep rather than an infinite one.
 */
export function buildSweepValues(options: {
  startValue: number
  stopValue: number
  stepValue: number
  maxPoints?: number
}): number[] {
  const { startValue, stopValue, stepValue } = options
  const maxPoints = options.maxPoints ?? 2000
  if (!Number.isFinite(startValue) || !Number.isFinite(stopValue) || !Number.isFinite(stepValue)) return []
  if (stepValue === 0) return []
  if (stopValue > startValue && stepValue < 0) return []
  if (stopValue < startValue && stepValue > 0) return []

  const span = Math.abs(stopValue - startValue)
  const step = Math.abs(stepValue)
  const rawPoints = span / step
  const points = Math.floor(rawPoints + 1e-9) + 1
  const exact = Math.abs(rawPoints - Math.round(rawPoints)) < 1e-9
  const count = Math.min(points, maxPoints)

  const values: number[] = []
  for (let index = 0; index < count; index += 1) {
    /*
     * The final point is snapped to `stopValue` when the interval is an exact
     * multiple of the step: a thousand float additions drift, and a sweep whose
     * last point is 4.999999999 instead of 5 is a sweep nobody can line up with
     * a hand calculation.
     */
    values.push(exact && index === points - 1 ? stopValue : startValue + index * stepValue)
  }
  return values
}

/** Human-readable point label, with the unit the swept device actually uses. */
function sweepLabel(options: DcSweepOptions, model: CircuitModel, value: number): string {
  if (options.sweepTemperature) return `T = ${value} °C`
  const device = model.devices.find((candidate) => candidate.name === options.deviceName)
  const unit =
    device?.kind === 'voltage-source'
      ? ' V'
      : device?.kind === 'current-source'
        ? ' A'
        : device?.kind === 'resistor'
          ? ' Ω'
          : ''
  return `${options.deviceName} = ${value}${unit}`
}

/**
 * Sweep one device value — or the temperature — and record the bias at each step.
 *
 * Every point is a full, warm-started Newton solve of the same network, so the
 * result is the circuit's own DC transfer characteristic and not an
 * interpolation between two endpoints. The substitution goes through the same
 * stamping code as the operating point, which is what makes a sweep point and a
 * standalone operating point of the same circuit agree exactly.
 *
 * Branch currents are recorded beside the node voltages, so a diode or a
 * transistor can be plotted as the current curve a datasheet would show rather
 * than only as a voltage.
 */
export function runDcSweep(model: CircuitModel, options: DcSweepOptions): DcSweepResult {
  const maxPoints = options.maxPoints ?? 2000
  const values = buildSweepValues({ ...options, maxPoints })
  const notes: string[] = []

  if (options.sweepTemperature !== true) {
    const named = options.deviceName ?? ''
    if (!model.devices.some((device) => device.name === named)) {
      return {
        outcome: {
          nodes: [],
          waveforms: [],
          iterations: 0,
          converged: false,
          notes: [
            named
              ? `DC sweep: no component named "${named}" in this circuit.`
              : 'DC sweep: choose the component to sweep, or sweep the temperature.',
          ],
        },
        points: [],
      }
    }
  }

  if (values.length === 0) {
    return {
      outcome: {
        nodes: [],
        waveforms: [],
        iterations: 0,
        converged: false,
        notes: [
          'A DC sweep needs a non-zero step whose sign runs from the start value to the stop value.',
        ],
      },
      points: [],
    }
  }

  const span = Math.abs(options.stopValue - options.startValue)
  const requestedPoints = Math.floor(span / Math.abs(options.stepValue) + 1e-9) + 1
  if (values.length < requestedPoints) {
    notes.push(
      `The sweep was limited to ${maxPoints} points. Increase the step to cover ` +
        `${options.startValue} … ${options.stopValue} in one pass.`,
    )
  }

  const voltageSeries = new Map<string, Array<{ x: number; y: number }>>()
  for (const node of model.nodeNames) {
    if (!isInternalNode(node)) voltageSeries.set(node, [])
  }
  const currentSeries = new Map<string, Array<{ x: number; y: number }>>()

  const points: DcSweepPoint[] = []
  let warmStart: readonly number[] | undefined
  let iterations = 0
  let converged = true

  for (const value of values) {
    const override: SweepOverride = options.sweepTemperature
      ? { kind: 'temperature', value }
      : { kind: 'device', name: options.deviceName as string, value }

    const solved = runOperatingPoint(model, {
      temperatureCelsius: options.temperatureCelsius,
      gmin: options.gmin,
      override,
      initial: warmStart,
    })

    if (solved.solution.length === 0) {
      notes.push(`The sweep could not be solved at ${sweepLabel(options, model, value)}.`)
      converged = false
      break
    }

    iterations += solved.outcome.iterations
    if (!solved.outcome.converged) {
      notes.push(`Newton did not converge at ${sweepLabel(options, model, value)}.`)
      converged = false
      break
    }

    // The next point starts from this one: consecutive sweep points are nearly
    // the same circuit, which is where a sweep gets its speed.
    warmStart = solved.solution
    const voltages = readNodeVoltages(model, solved.solution)
    for (const [node, series] of voltageSeries) {
      series.push({ x: value, y: voltages.get(node) ?? 0 })
    }

    for (const [name, current] of readBranchCurrents(model, solved.solution)) {
      const series = currentSeries.get(name) ?? []
      series.push({ x: value, y: current })
      currentSeries.set(name, series)
    }

    points.push({
      value,
      voltages: Object.fromEntries(
        [...voltages].filter(([name]) => name !== '0' && !isInternalNode(name)),
      ),
    })
  }

  const waveforms: Waveform[] = []
  for (const [node, data] of voltageSeries) {
    if (data.length === 0) continue
    waveforms.push({ name: `V(${node})`, type: 'voltage', unit: 'V', data })
  }
  for (const [name, data] of currentSeries) {
    if (data.length === 0) continue
    waveforms.push({ name: `I(${name})`, type: 'current', unit: 'A', data })
  }

  return { outcome: { nodes: [], waveforms, iterations, converged, notes }, points }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Transient
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Fastest transition any source waveform demands, seconds. A 10 ns PULSE edge
 * straddled by a 1 ms step is a 5 V discontinuity in one Newton solve —
 * uncrossable. The retry controller subdivides down to a fraction of this
 * edge, not to an arbitrary fraction of the display step.
 */
function smallestSourceEdge(model: CircuitModel): number {
  let edge = Number.POSITIVE_INFINITY
  for (const device of model.devices) {
    if (device.kind !== 'voltage-source' && device.kind !== 'current-source') continue
    const waveform = device.waveform
    if (!waveform) continue
    if (waveform.kind === 'pulse') {
      if (waveform.tr > 0) edge = Math.min(edge, waveform.tr)
      if (waveform.tf > 0) edge = Math.min(edge, waveform.tf)
    } else if (waveform.kind === 'sine') {
      if (waveform.freq > 0) edge = Math.min(edge, 1 / (waveform.freq * 20))
    } else if (waveform.kind === 'exp') {
      if (waveform.tau1 > 0) edge = Math.min(edge, waveform.tau1 / 5)
      if (waveform.tau2 > 0) edge = Math.min(edge, waveform.tau2 / 5)
    } else if (waveform.kind === 'pwl' && waveform.points.length > 1) {
      for (let index = 1; index < waveform.points.length; index += 1) {
        const span = waveform.points[index].time - waveform.points[index - 1].time
        if (span > 0) edge = Math.min(edge, span)
      }
    }
  }
  return Number.isFinite(edge) ? edge : 1e-6
}

export interface TransientOptions {
  temperatureCelsius: number
  stopTime: number
  stepTime: number
  /** See `smallestSourceEdge` below for why the retry floor tracks edges.
   * `false` (the default, matching SPICE) starts from the DC operating point, so
   * a capacitor charged at DC begins charged. `true` starts from zero stored
   * energy — what you want when watching an RC circuit charge.
   */
  useInitialConditions?: boolean
  gmin?: number
  /** Upper bound on internal steps, to keep the UI responsive. */
  maxPoints?: number
  /** Smallest step the retry controller may shrink to before giving up. */
  minStepTime?: number
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
  const edgeFloor = smallestSourceEdge(model)
  const minStep = Math.min(options.minStepTime ?? stepTime / 1024, edgeFloor / 4)

  const state: TransientState = createTransientState()
  const notes: string[] = []
  if (steps < requestedSteps) {
    notes.push(
      `Step time was widened to ${(dt * 1e6).toFixed(3)} µs to stay within the ${maxPoints}-point display ` +
        'budget. Reduce the stop time for finer resolution.',
    )
  }

  let initialSolution: number[] | undefined
  const thermal = thermalVoltage(temperatureCelsius)
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
    // Semiconductor junctions are charged too: without this the first time step
    // would behave as if every transistor had been sitting at 0 V.
    updateTransientState(model, state, voltages, thermal)
    initialSolution = operatingPoint.solution
  }

  const voltageSeries = new Map<string, Array<{ x: number; y: number }>>()
  for (const node of model.nodeNames) voltageSeries.set(node, [])

  let iterations = 0
  let converged = true
  let warmStart = initialSolution

  for (let step = 1; step <= steps; step += 1) {
    const time = step * dt
    const newton = solveNewton(
      model,
      (system) => {
        stampTransient(system, model, dt, state, time)
        stampSemiconductorLinear(system, model, { dt, state })
      },
      {
        temperatureCelsius,
        gmin: options.gmin,
        initial: warmStart,
        time,
      },
    )

    if ((!newton || !newton.converged) && dt > minStep) {
      const stepStart = time - dt
      const savedCaps = new Map(state.capacitorVoltages)
      const savedInds = new Map(state.inductorCurrents)
      const savedBjt = new Map(state.bjtJunctions)
      const savedMos = new Map(state.mosfetBias)
      const savedJfet = new Map(state.jfetBias)
      const savedOp = new Map(state.opAmpStages)
      const restore = (): void => {
        state.capacitorVoltages = new Map(savedCaps)
        state.inductorCurrents = new Map(savedInds)
        state.bjtJunctions = new Map(savedBjt)
        state.mosfetBias = new Map(savedMos)
        state.jfetBias = new Map(savedJfet)
        state.opAmpStages = new Map(savedOp)
      }
      let subDt = dt / 2
      let sub = warmStart
      let subSolution: number[] | undefined
      let subbed = false
      while (subDt >= minStep) {
        restore()
        let cursor = stepStart
        let cursorStart = sub
        let failed = false
        while (cursor < time - subDt / 2) {
          cursor += subDt
          const attempt = solveNewton(
            model,
            (system) => {
              stampTransient(system, model, subDt, state, cursor)
              stampSemiconductorLinear(system, model, { dt: subDt, state })
            },
            { temperatureCelsius, gmin: options.gmin, initial: cursorStart, time: cursor },
          )
          if (!attempt || !attempt.converged) {
            failed = true
            break
          }
          const attemptVoltages = readNodeVoltages(model, attempt.solution)
          const attemptCurrents = readBranchCurrents(model, attempt.solution)
          for (const device of model.devices) {
            if (device.kind === 'capacitor') {
              state.capacitorVoltages.set(device.name, (attemptVoltages.get(device.p) ?? 0) - (attemptVoltages.get(device.n) ?? 0))
            }
            if (device.kind === 'inductor') {
              state.inductorCurrents.set(device.name, attemptCurrents.get(device.name) ?? 0)
            }
          }
          updateTransientState(model, state, attemptVoltages, thermal)
          cursorStart = attempt.solution
        }
        if (!failed) {
          subbed = true
          subSolution = cursorStart
          break
        }
        subDt /= 2
        sub = warmStart
      }
      if (!subbed) {
        restore()
      }
      if (subbed) {
        // The subdivision already converged THROUGH `time`: its state is the
        // answer. Re-solving the full step from scratch re-crosses the edge
        // and re-fails — instead accept the subdivided solution directly.
        const voltages = readNodeVoltages(model, subSolution as number[])
        const currents = readBranchCurrents(model, subSolution as number[])
        warmStart = subSolution
        iterations += 1
        notes.push(`Step subdivided near t = ${(time * 1e3).toFixed(4)} ms to cross a fast edge.`)
        for (const node of model.nodeNames) {
          if (isInternalNode(node)) continue
          voltageSeries.get(node)?.push({ x: time, y: voltages.get(node) ?? 0 })
        }
        void currents
        continue
      }
    }

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
    updateTransientState(model, state, voltages, thermal)

    for (const node of model.nodeNames) {
      if (isInternalNode(node)) continue
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
  const operatingPoint = runOperatingPoint(model, { temperatureCelsius, gmin: options.gmin, time: 0 })
  const notes = [...operatingPoint.outcome.notes]
  const thermal = thermalVoltage(temperatureCelsius)
  const operatingVoltages = readNodeVoltages(model, operatingPoint.solution)
  const operatingCurrents = readBranchCurrents(model, operatingPoint.solution)

  const frequencies = buildFrequencyGrid(options)
  const magnitude = new Map<string, Array<{ x: number; y: number }>>()
  const phase = new Map<string, Array<{ x: number; y: number }>>()
  for (const node of model.nodeNames) {
    if (isInternalNode(node)) continue
    magnitude.set(node, [])
    phase.set(node, [])
  }

  let converged = true
  for (const frequency of frequencies) {
    const omega = 2 * Math.PI * frequency
    const system = createComplexSystem(model)
    stampAc(system, model, omega, operatingPoint.diodeConductances, gmin)
    stampSemiconductorSmallSignal(system, model, operatingPoint.semiconductor, thermal, omega, operatingVoltages, {
      currents: operatingCurrents,
      time: 0,
    })

    const solution = solveComplexSystem(system.matrix, system.rhs)
    if (!solution) {
      notes.push(`The AC solve is singular at ${frequency.toPrecision(4)} Hz.`)
      converged = false
      break
    }

    model.nodeNames.forEach((node, index) => {
      const data = magnitude.get(node)
      if (!data || !phase.has(node)) return
      const value = solution[index]
      data.push({ x: frequency, y: cAbs(value) })
      phase.get(node)?.push({ x: frequency, y: (Math.atan2(value.im, value.re) * 180) / Math.PI })
    })
  }

  const waveforms: Waveform[] = []
  for (const node of model.nodeNames) {
    if (isInternalNode(node)) continue
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
