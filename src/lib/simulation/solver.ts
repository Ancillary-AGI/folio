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
  companionHistory,
  integrationFactor,
  type DiodeOperatingPoint,
  type RealSystem,
  type SweepOverride,
  type TransientIntegration,
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
import { createTLineState, recordTLineSample, type TLineState } from './transmissionLine'

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
  branchCurrents?: Record<string, number>
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

/** Shortest one-way delay of any line, or Infinity when the circuit has none. */
function shortestLineDelay(model: CircuitModel): number {
  let delay = Number.POSITIVE_INFINITY
  for (const device of model.devices) {
    if (device.kind === 'transmission-line') delay = Math.min(delay, device.td)
  }
  return delay
}

/**
 * Seed the delay history with the initial operating state.
 *
 * A line at DC is an ideal through connection, so its port currents come from
 * the two branch rows. Passing `null` starts the line at zero stored energy.
 */
function seedTransmissionLines(
  model: CircuitModel,
  state: TransientState,
  solution: readonly number[] | null,
  time = 0,
): void {
  if (model.lineRows.size === 0) return
  const voltages = solution ? readNodeVoltages(model, solution) : null
  const currents = solution ? readBranchCurrents(model, solution) : null
  for (const device of model.devices) {
    if (device.kind !== 'transmission-line') continue
    const lineState = createTLineState()
    state.transmissionLines.set(device.name, lineState)
    if (!voltages || !currents) {
      recordTLineSample(device, lineState, time, 0, 0, 0, 0)
      continue
    }
    const v1 = (voltages.get(device.p) ?? 0) - (voltages.get(device.n) ?? 0)
    const v2 = (voltages.get(device.p2) ?? 0) - (voltages.get(device.n2) ?? 0)
    const i1 = currents.get(`${device.name}#1`) ?? 0
    const i2 = currents.get(`${device.name}#2`) ?? 0
    recordTLineSample(device, lineState, time, v1, i1, v2, i2)
  }
}

/** Record an accepted solution into every line history. */
function recordTransmissionLines(
  model: CircuitModel,
  state: TransientState,
  solution: readonly number[],
  time: number,
): void {
  if (model.lineRows.size === 0) return
  const voltages = readNodeVoltages(model, solution)
  const currents = readBranchCurrents(model, solution)
  for (const device of model.devices) {
    if (device.kind !== 'transmission-line') continue
    const lineState = state.transmissionLines.get(device.name)
    if (!lineState) continue
    const v1 = (voltages.get(device.p) ?? 0) - (voltages.get(device.n) ?? 0)
    const v2 = (voltages.get(device.p2) ?? 0) - (voltages.get(device.n2) ?? 0)
    const i1 = currents.get(`${device.name}#1`) ?? 0
    const i2 = currents.get(`${device.name}#2`) ?? 0
    recordTLineSample(device, lineState, time, v1, i1, v2, i2)
  }
}

/** Copy a line history so a rejected time step can be rolled back exactly. */
const cloneLineStates = (states: Map<string, TLineState>): Map<string, TLineState> =>
  new Map(
    [...states].map(([name, line]) => [name, { ...line, history: [...line.history] }]),
  )

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
  /**
   * Why no solution was produced. `singular` means the topology itself is
   * indeterminate (parallel ideal sources, or an ideal source across an ideal
   * inductor); `model` means the netlist is invalid.
   */
  failure?: 'singular' | 'model'
}

/**
 * True when no device's small-signal model depends on its DC bias.
 *
 * Such a circuit has an exact AC/noise solution even when the DC operating
 * point is indeterminate — an ideal source directly across an ideal inductor,
 * for example, leaves one branch current free but does not affect the
 * frequency response of the linear network.
 */
export function isBiasIndependent(model: CircuitModel): boolean {
  return !model.devices.some((device) =>
    device.kind === 'diode' ||
    device.kind === 'bjt' ||
    device.kind === 'mosfet' ||
    device.kind === 'jfet' ||
    device.kind === 'op-amp' ||
    device.kind === 'voltage-switch' ||
    device.kind === 'current-switch' ||
    device.kind === 'behavioral-source',
  )
}

/** A model-level failure before Newton starts: no solution, but a usable state. */
function failedOperatingPoint(
  model: CircuitModel,
  thermal: number,
  note: string,
  failure: 'singular' | 'model' = 'model',
): OperatingPointResult {
  return {
    outcome: { nodes: [], waveforms: [], iterations: 0, converged: false, notes: [note] },
    diodeConductances: new Map(),
    diodeOperatingPoints: new Map(),
    semiconductor: createSemiconductorState(model, thermal),
    solution: [],
    failure,
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
      'singular',
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
      branchCurrents: Object.fromEntries(readBranchCurrents(model, newton.solution)),
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
  const maxPoints =
    Number.isFinite(options.maxPoints) && (options.maxPoints as number) >= 1
      ? Math.floor(options.maxPoints as number)
      : 2000
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
  const maxPoints =
    Number.isFinite(options.maxPoints) && (options.maxPoints as number) >= 1
      ? Math.floor(options.maxPoints as number)
      : 2000
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

/**
 * Shortest period any source waveform repeats on, seconds. A step longer than
 * half this period samples the waveform faster than Nyquist allows and the
 * result aliases — a 1 kHz sine sampled every 1 ms lands on zero crossings
 * forever and reads as a flat 0 V line.
 */
function fastestSourcePeriod(model: CircuitModel): number {
  let period = Number.POSITIVE_INFINITY
  for (const device of model.devices) {
    if (device.kind !== 'voltage-source' && device.kind !== 'current-source') continue
    const waveform = device.waveform
    if (!waveform) continue
    if (waveform.kind === 'sine' && waveform.freq > 0) period = Math.min(period, 1 / waveform.freq)
    if (waveform.kind === 'pulse' && waveform.per > 0) period = Math.min(period, waveform.per)
    if (waveform.kind === 'sffm') {
      // SFFM names its two rates `fc` (carrier) and `fs` (signal).
      if (waveform.fc > 0) period = Math.min(period, 1 / waveform.fc)
      if (waveform.fs > 0) period = Math.min(period, 1 / waveform.fs)
    }
  }
  return period
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
  /**
   * Companion-model integration rule. Backward Euler (the default) is
   * unconditionally stable and monotone. Trapezoidal is second-order accurate
   * and preserves a lossless LC oscillation far better, at the cost of ringing
   * on a stiff step. Gear/BDF2 is also second-order and A-stable but damps
   * high-frequency numerical ringing. Startup always uses backward Euler:
   * one step for trapezoidal, two for BDF2, repeated after a step-size change,
   * so no initial derivative is needed and the history always shares one `dt`.
   */
  integrationMethod?: TransientIntegration
}

/**
 * Transient analysis using backward-Euler, trapezoidal or Gear/BDF2 companion
 * models.
 *
 * The state carried between steps is the capacitor voltage/current and the
 * inductor current/voltage plus the semiconductor bias points, with a
 * second-level history for BDF2. That is all the companions need: there is no
 * hidden global state and no smoothing of the result.
 */
export function runTransient(model: CircuitModel, options: TransientOptions): AnalysisOutcome {
  const { temperatureCelsius, stopTime, stepTime, useInitialConditions = false } = options
  const maxPoints =
    Number.isFinite(options.maxPoints) && (options.maxPoints as number) >= 1
      ? Math.floor(options.maxPoints as number)
      : 2000
  const method = options.integrationMethod ?? 'backward-euler'

  if (!Number.isFinite(stopTime) || !Number.isFinite(stepTime) || !(stopTime > 0) || !(stepTime > 0)) {
    return {
      nodes: [],
      waveforms: [],
      iterations: 0,
      converged: false,
      notes: ['Transient analysis needs a finite positive stop time and step time.'],
    }
  }

  /*
   * A line history is only meaningful if the step resolves the delay: with
   * fewer than four samples per transit a reflection can be missed entirely,
   * so the delay tightens the internal step exactly as a fast source edge does.
   * The display budget may still widen it, which is reported below.
   */
  const lineDelay = shortestLineDelay(model)
  const lineLimitedStep = Number.isFinite(lineDelay) ? lineDelay / 4 : Number.POSITIVE_INFINITY
  const requestedSteps = Math.max(1, Math.ceil(stopTime / Math.min(stepTime, lineLimitedStep)))
  const steps = Math.max(1, Math.min(requestedSteps, maxPoints))
  const dt = stopTime / steps
  const edgeFloor = smallestSourceEdge(model)
  const requestedMin = options.minStepTime ?? stepTime / 1024
  const minStep = Math.max(
    Number.MIN_VALUE,
    Math.min(
      Number.isFinite(requestedMin) && requestedMin > 0 ? requestedMin : stepTime / 1024,
      edgeFloor / 4,
      Number.isFinite(lineDelay) ? lineDelay / 8 : Number.POSITIVE_INFINITY,
    ),
  )

  const state: TransientState = createTransientState()
  const notes: string[] = []
  if (Number.isFinite(lineDelay) && lineLimitedStep < stepTime) {
    notes.push(
      dt <= lineLimitedStep
        ? `Step time was reduced to ${(dt * 1e9).toFixed(2)} ns to resolve the ` +
            `${(lineDelay * 1e9).toFixed(2)} ns line delay (at least four steps per transit).`
        : `The ${(lineDelay * 1e9).toFixed(2)} ns line delay needs a step under ` +
            `${(lineLimitedStep * 1e9).toFixed(2)} ns to resolve reflections, but the ` +
            `${maxPoints}-point budget widened it to ${(dt * 1e9).toFixed(2)} ns. ` +
            `Shorten the stop time for a resolved run.`,
    )
  } else if (steps < requestedSteps) {
    notes.push(
      `Step time was widened to ${(dt * 1e6).toFixed(3)} µs to stay within the ${maxPoints}-point display ` +
        'budget. Reduce the stop time for finer resolution.',
    )
  }
  // A step longer than half the fastest period undersamples the source: the
  // plot shows an aliased artefact, not the circuit. Say so instead of letting
  // a flat line pass as a result.
  const period = fastestSourcePeriod(model)
  if (Number.isFinite(period) && dt > period / 2) {
    notes.push(
      `Step time (${(dt * 1e6).toFixed(3)} µs) is longer than half the source period ` +
        `(${(period * 1e6).toFixed(3)} µs), so the waveform is undersampled and will alias. ` +
        `Use a step under ${(period / 2 * 1e6).toFixed(3)} µs to resolve it.`,
    )
  }
  if (method === 'trapezoidal') {
    notes.push(
      'Transient integration: trapezoidal rule (second-order, A-stable). The first step and the ' +
        'first step after every step-size change use backward Euler to start the history.',
    )
  } else if (method === 'bdf2') {
    notes.push(
      'Transient integration: Gear/BDF2 (second-order, A-stable, damping). The first two steps and ' +
        'the first two steps after every step-size change use backward Euler to build the history.',
    )
  }

  let initialSolution: number[] | undefined
  const thermal = thermalVoltage(temperatureCelsius)
  const resetState = (): void => {
    for (const device of model.devices) {
      if (device.kind === 'capacitor') {
        state.capacitorVoltages.set(device.name, 0)
        state.capacitorVoltages2.set(device.name, 0)
        state.capacitorCurrents.set(device.name, 0)
      }
      if (device.kind === 'inductor') {
        state.inductorCurrents.set(device.name, 0)
        state.inductorCurrents2.set(device.name, 0)
        state.inductorVoltages.set(device.name, 0)
      }
    }
  }
  if (useInitialConditions) {
    resetState()
    // Junction and gate capacitances are bias-dependent. At rest the bias is
    // 0 V, not "unknown": seeding the zero-bias values keeps the first step
    // from ignoring a transistor's junction capacitance entirely.
    updateTransientState(model, state, new Map(), thermal, { dt: 0 })
    seedTransmissionLines(model, state, null)
  } else {
    const operatingPoint = runOperatingPoint(model, { temperatureCelsius, gmin: options.gmin })
    if (operatingPoint.solution.length === 0) {
      /*
       * An ideal source across an ideal inductor has no unique DC bias (the
       * branch-current split is arbitrary), but a transient started from rest
       * is well posed. Only a genuinely singular topology is retried this way;
       * an invalid model must still be reported.
       */
      if (operatingPoint.failure !== 'singular') {
        return { nodes: [], waveforms: [], iterations: 0, converged: false, notes: operatingPoint.outcome.notes }
      }
      resetState()
      updateTransientState(model, state, new Map(), thermal, { dt: 0 })
      seedTransmissionLines(model, state, null)
      notes.push(
        'The DC operating point is indeterminate (for example an ideal source directly across an ideal ' +
          'inductor); the transient was started from zero stored energy.',
      )
    } else {
      const voltages = readNodeVoltages(model, operatingPoint.solution)
      const currents = readBranchCurrents(model, operatingPoint.solution)
      for (const device of model.devices) {
        if (device.kind === 'capacitor') {
          const voltage = (voltages.get(device.p) ?? 0) - (voltages.get(device.n) ?? 0)
          state.capacitorVoltages.set(device.name, voltage)
          state.capacitorVoltages2.set(device.name, voltage)
          state.capacitorCurrents.set(device.name, 0)
        }
        if (device.kind === 'inductor') {
          const current = currents.get(device.name) ?? 0
          state.inductorCurrents.set(device.name, current)
          state.inductorCurrents2.set(device.name, current)
          state.inductorVoltages.set(device.name, 0)
        }
      }
      // Semiconductor junctions are charged too: without this the first time step
      // would behave as if every transistor had been sitting at 0 V.
      updateTransientState(model, state, voltages, thermal)
      // A lossless line carries the DC bias as its initial traveling-wave state,
      // so an already-energised circuit starts quiet instead of launching a
      // spurious transient from an assumed zero.
      seedTransmissionLines(model, state, operatingPoint.solution)
      initialSolution = operatingPoint.solution
    }
  }

  /*
   * Accept one solved time point into the history the next companion reads.
   * The stored current is the one the companion just implied, so trapezoidal
   * takes a consistent `i_prev` and BDF2 takes both `v_prev`/`i_prev` samples
   * from the same discrete derivative (including the backward-Euler startup).
   */
  const commitStep = (
    voltages: ReadonlyMap<string, number>,
    currents: ReadonlyMap<string, number>,
    dtUsed: number,
    methodUsed: TransientIntegration,
  ): void => {
    const factor = integrationFactor(methodUsed)
    const trapezoidal = methodUsed === 'trapezoidal'
    for (const device of model.devices) {
      if (device.kind === 'capacitor') {
        const voltage = (voltages.get(device.p) ?? 0) - (voltages.get(device.n) ?? 0)
        const previousVoltage = state.capacitorVoltages.get(device.name) ?? 0
        const previousVoltage2 = state.capacitorVoltages2.get(device.name) ?? 0
        const previousCurrent = state.capacitorCurrents.get(device.name) ?? 0
        const history = companionHistory(methodUsed, previousVoltage, previousVoltage2)
        state.capacitorVoltages2.set(device.name, previousVoltage)
        state.capacitorVoltages.set(device.name, voltage)
        state.capacitorCurrents.set(
          device.name,
          dtUsed > 0
            ? ((factor * device.capacitance) / dtUsed) * (voltage - history) -
                (trapezoidal ? previousCurrent : 0)
            : 0,
        )
      }
      if (device.kind === 'inductor') {
        state.inductorCurrents2.set(
          device.name,
          state.inductorCurrents.get(device.name) ?? 0,
        )
        state.inductorCurrents.set(device.name, currents.get(device.name) ?? 0)
        state.inductorVoltages.set(
          device.name,
          (voltages.get(device.p) ?? 0) - (voltages.get(device.n) ?? 0),
        )
      }
    }
    updateTransientState(model, state, voltages, thermal, { dt: dtUsed, method: methodUsed })
  }

  const voltageSeries = new Map<string, Array<{ x: number; y: number }>>()
  for (const node of model.nodeNames) voltageSeries.set(node, [])

  let iterations = 0
  let converged = true
  let warmStart = initialSolution
  /*
   * Backward Euler for startup: one step for trapezoidal, two for BDF2, and
   * the same count again after every step-size change. Companion history
   * belongs to one `dt` and must not be carried across a different one; the
   * second BE step is what supplies BDF2's older sample at the new step size.
   */
  const startupSteps = method === 'bdf2' ? 2 : 1
  let stepsAtCurrentDt = 0
  let stepMethod: TransientIntegration = 'backward-euler'

  for (let step = 1; step <= steps; step += 1) {
    const time = step * dt
    const newton = solveNewton(
      model,
      (system) => {
        stampTransient(system, model, dt, state, time, stepMethod)
        stampSemiconductorLinear(system, model, { dt, state, method: stepMethod })
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
      const savedCaps2 = new Map(state.capacitorVoltages2)
      const savedCapCurrents = new Map(state.capacitorCurrents)
      const savedInds = new Map(state.inductorCurrents)
      const savedInds2 = new Map(state.inductorCurrents2)
      const savedIndVoltages = new Map(state.inductorVoltages)
      const savedBjt = new Map(state.bjtJunctions)
      const savedMos = new Map(state.mosfetBias)
      const savedJfet = new Map(state.jfetBias)
      const savedOp = new Map(state.opAmpStages)
      const savedOp2 = new Map(state.opAmpStages2)
      const savedOpCurrents = new Map(state.opAmpCurrents)
      const savedLines = cloneLineStates(state.transmissionLines)
      const restore = (): void => {
        state.capacitorVoltages = new Map(savedCaps)
        state.capacitorVoltages2 = new Map(savedCaps2)
        state.capacitorCurrents = new Map(savedCapCurrents)
        state.inductorCurrents = new Map(savedInds)
        state.inductorCurrents2 = new Map(savedInds2)
        state.inductorVoltages = new Map(savedIndVoltages)
        state.bjtJunctions = new Map(savedBjt)
        state.mosfetBias = new Map(savedMos)
        state.jfetBias = new Map(savedJfet)
        state.opAmpStages = new Map(savedOp)
        state.opAmpStages2 = new Map(savedOp2)
        state.opAmpCurrents = new Map(savedOpCurrents)
        state.transmissionLines = cloneLineStates(savedLines)
      }
      let subDt = dt / 2
      let sub = warmStart
      let subSolution: number[] | undefined
      let subIterations = newton?.iterations ?? 0
      let subbed = false
      while (subDt >= minStep && subDt > 0) {
        restore()
        let cursor = stepStart
        let cursorStart = sub
        let failed = false
        // `sub` is the warm start for the first substep; later substeps warm
        // start from the previous accepted one. BDF2 again needs two BE
        // substeps so its history belongs entirely to `subDt`.
        let cursorSteps = 0
        let cursorMethod: TransientIntegration = 'backward-euler'
        while (cursor < time - subDt / 2) {
          cursor += subDt
          const attempt = solveNewton(
            model,
            (system) => {
              stampTransient(system, model, subDt, state, cursor, cursorMethod)
              stampSemiconductorLinear(system, model, { dt: subDt, state, method: cursorMethod })
            },
            { temperatureCelsius, gmin: options.gmin, initial: cursorStart, time: cursor },
          )
          subIterations += attempt?.iterations ?? 0
          if (!attempt || !attempt.converged) {
            failed = true
            break
          }
          const attemptVoltages = readNodeVoltages(model, attempt.solution)
          const attemptCurrents = readBranchCurrents(model, attempt.solution)
          commitStep(attemptVoltages, attemptCurrents, subDt, cursorMethod)
          recordTransmissionLines(model, state, attempt.solution, cursor)
          cursorStart = attempt.solution
          cursorSteps += 1
          cursorMethod = cursorSteps < startupSteps ? 'backward-euler' : method
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
        warmStart = subSolution
        iterations += subIterations
        notes.push(`Step subdivided near t = ${(time * 1e3).toFixed(4)} ms to cross a fast edge.`)
        // The state now owns a shorter-dt history; restart integration so the
        // next full step does not carry it across the changed step.
        stepsAtCurrentDt = 0
        stepMethod = 'backward-euler'
        for (const node of model.nodeNames) {
          if (isInternalNode(node)) continue
          voltageSeries.get(node)?.push({ x: time, y: voltages.get(node) ?? 0 })
        }
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
    commitStep(voltages, currents, dt, stepMethod)
    recordTransmissionLines(model, state, newton.solution, time)
    stepsAtCurrentDt += 1
    stepMethod = stepsAtCurrentDt < startupSteps ? 'backward-euler' : method

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
export function buildFrequencyGrid(
  options: Pick<AcSweepOptions, 'startFrequency' | 'stopFrequency' | 'pointsPerDecade' | 'linearPoints'>,
): number[] {
  const { startFrequency, stopFrequency, pointsPerDecade = 20, linearPoints } = options
  if (!Number.isFinite(startFrequency) || !Number.isFinite(stopFrequency) ||
    startFrequency <= 0 || stopFrequency < startFrequency) {
    return []
  }
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

  if (!Number.isFinite(startFrequency) || !Number.isFinite(stopFrequency)) {
    return {
      nodes: [],
      waveforms: [],
      iterations: 0,
      converged: false,
      notes: ['AC analysis needs finite start and stop frequencies.'],
    };
  }
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
  if (options.pointsPerDecade !== undefined &&
    (!Number.isFinite(options.pointsPerDecade) || options.pointsPerDecade < 1)) {
    return {
      nodes: [],
      waveforms: [],
      iterations: 0,
      converged: false,
      notes: ['AC analysis needs at least one frequency point per decade.'],
    }
  }
  if (options.linearPoints !== undefined && !Number.isFinite(options.linearPoints)) {
    return {
      nodes: [],
      waveforms: [],
      iterations: 0,
      converged: false,
      notes: ['AC analysis needs a finite linear point count.'],
    }
  }

  // Bias-dependent linearisation: the operating point is the physics here.
  const operatingPoint = runOperatingPoint(model, { temperatureCelsius, gmin: options.gmin, time: 0 })
  const notes = [...operatingPoint.outcome.notes]
  const biasSolved =
    !operatingPoint.failure &&
    operatingPoint.outcome.converged &&
    operatingPoint.solution.length > 0
  if (!biasSolved && (operatingPoint.failure !== 'singular' || !isBiasIndependent(model))) {
    /*
     * Linearising at a failed bias would produce a smooth, plausible-looking
     * Bode plot of a circuit that is not actually biased there. Refuse instead:
     * an AC result is only meaningful about a converged operating point.
     */
    notes.push(
      'AC analysis needs a converged DC operating point; the bias solve failed, so no frequency response was computed.',
    )
    return {
      nodes: [],
      waveforms: [],
      iterations: operatingPoint.outcome.iterations,
      converged: false,
      notes,
    }
  }
  if (!biasSolved) {
    notes.push(
      'The DC operating point is indeterminate (for example an ideal source directly across an ideal ' +
        'inductor); this circuit is linear, so the AC response was computed about zero bias.',
    )
  }
  const biasSolution = biasSolved
    ? operatingPoint.solution
    : new Array<number>(model.size).fill(0)
  const thermal = thermalVoltage(temperatureCelsius)
  const operatingVoltages = readNodeVoltages(model, biasSolution)
  const operatingCurrents = readBranchCurrents(model, biasSolution)
  const diodeConductances = biasSolved ? operatingPoint.diodeConductances : new Map<string, number>()

  const frequencies = buildFrequencyGrid(options)
  if (frequencies.length === 0) {
    notes.push('AC analysis could not build a frequency grid from the requested start, stop and point count.');
    return {
      nodes: [],
      waveforms: [],
      iterations: operatingPoint.outcome.iterations,
      converged: false,
      notes,
    }
  }
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
    stampAc(system, model, omega, diodeConductances, gmin)
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
