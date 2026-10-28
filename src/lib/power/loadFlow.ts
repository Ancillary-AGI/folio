/**
 * Balanced AC power flow for transmission networks and radial distribution
 * feeders.
 *
 * Transmission uses the classic positive-sequence model: per-unit admittances,
 * constant-power loads, and a polar Newton–Raphson solve. PV buses that hit a
 * reactive limit are re-solved as PQ buses at that limit, which is the standard
 * way to keep a generator inside its capability curve. Slack reactive power is
 * unbounded and is reported, not limited.
 *
 * The radial solver is a backward/forward sweep on a tree: currents accumulate
 * from the leaves, then voltages are updated from the source. It converges
 * linearly and has no Jacobian, which suits distribution feeders where the
 * R/X ratio defeats the transmission decoupling assumptions.
 *
 * Neither solver claims transient stability, protection coordination,
 * three-phase imbalance, harmonics, or EMT behaviour. Both are steady-state
 * positive-sequence calculations with balanced constant-power loads.
 */

import { solveLinearSystem } from '../ml/linalg'

export type BusType = 'slack' | 'pv' | 'pq'

export interface PowerBus {
  id: string
  name?: string
  type: BusType
  /** Nominal line-to-line voltage, kV. */
  baseKv: number
  /** Three-phase load, MW and Mvar. Positive numbers consume. */
  loadMw?: number
  loadMvar?: number
  /** Scheduled generation at a PV or slack bus, MW. */
  generationMw?: number
  /** Voltage setpoint for a PV or slack bus, per unit. */
  voltageSetpointPu?: number
  /** Reactive limits at a PV bus, Mvar; positive injects into the network. */
  reactiveMinMvar?: number
  reactiveMaxMvar?: number
  /** Shunt conductance drawn at 1 pu, MW. */
  shuntMw?: number
  /**
   * Shunt susceptance at 1 pu, Mvar. Positive is capacitive, so it supplies
   * reactive power and reduces the injection the rest of the network must meet.
   */
  shuntMvar?: number
}

export interface PowerBranch {
  id: string
  from: string
  to: string
  /** Series resistance and reactance, Ω, when both ends share a base kV. */
  resistanceOhm?: number
  reactanceOhm?: number
  /**
   * Series impedance directly in per unit, for branches between different
   * voltage levels (transformers) where an ohm value has no single base.
   */
  seriesImpedancePu?: { resistance: number; reactance: number }
  /** Total line-charging susceptance, Mvar at 1 pu (positive capacitive). */
  chargingMvar?: number
  /** Off-nominal tap at the `from` end; 1 is nominal. */
  tapRatio?: number
  /** Thermal rating, MVA. */
  ratingMva?: number
}

export interface PowerFlowInput {
  /** Three-phase power base, MVA. */
  baseMva: number
  buses: readonly PowerBus[]
  branches: readonly PowerBranch[]
  /** Per-unit mismatch at which the solve is considered converged. */
  tolerance?: number
  maxIterations?: number
}

export interface BusResult {
  id: string
  name?: string
  type: BusType
  /** True when a PV bus was held at a reactive limit and solved as PQ. */
  reactiveLimited: boolean
  voltagePu: number
  angleDeg: number
  generationMw: number
  generationMvar: number
  loadMw: number
  loadMvar: number
  netInjectionMw: number
  netInjectionMvar: number
}

export interface BranchResult {
  id: string
  from: string
  to: string
  fromFlowMw: number
  fromFlowMvar: number
  toFlowMw: number
  toFlowMvar: number
  lossMw: number
  lossMvar: number
  /** Highest end flow as a percentage of the thermal rating, or null without one. */
  loadingPercent: number | null
}

export interface PowerFlowResult {
  converged: boolean
  iterations: number
  /** Largest per-unit mismatch at the final iterate. */
  maxMismatchPu: number
  buses: BusResult[]
  branches: BranchResult[]
  totalGenerationMw: number
  totalGenerationMvar: number
  totalLoadMw: number
  totalLoadMvar: number
  totalLossMw: number
  totalLossMvar: number
  minVoltagePu: number
  maxLoadingPercent: number | null
  /** Generator limits that were enforced during the solve. */
  notes: string[]
}

export interface AdmittanceMatrix {
  busIds: string[]
  /** Real part of Y in per unit. */
  g: number[][]
  /** Imaginary part of Y in per unit. */
  b: number[][]
}

const DEFAULT_TOLERANCE = 1e-8
const DEFAULT_MAX_ITERATIONS = 40
const MAX_STEP_HALVINGS = 5
/** Below this per-unit voltage an iterate is not physically meaningful. */
const MIN_VOLTAGE_PU = 0.05

interface Complex {
  re: number
  im: number
}

const complex = (re: number, im: number): Complex => ({ re, im })

const cAdd = (a: Complex, b: Complex): Complex => complex(a.re + b.re, a.im + b.im)
const cSub = (a: Complex, b: Complex): Complex => complex(a.re - b.re, a.im - b.im)
const cMul = (a: Complex, b: Complex): Complex =>
  complex(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re)
const cDiv = (a: Complex, b: Complex): Complex => {
  const denominator = b.re * b.re + b.im * b.im
  if (denominator === 0) throw new Error('Complex division by zero.')
  return complex((a.re * b.re + a.im * b.im) / denominator, (a.im * b.re - a.re * b.im) / denominator)
}
const cConj = (a: Complex): Complex => complex(a.re, -a.im)

function requireFinite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} must be a finite number.`)
  return value
}

function requirePositive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be greater than zero.`)
  return value
}

function branchSeriesImpedancePu(branch: PowerBranch, fromBus: PowerBus, toBus: PowerBus, baseMva: number): Complex {
  if (branch.seriesImpedancePu) {
    const { resistance, reactance } = branch.seriesImpedancePu
    requireFinite(resistance, `Branch ${branch.id} per-unit resistance`)
    requireFinite(reactance, `Branch ${branch.id} per-unit reactance`)
    if (resistance === 0 && reactance === 0) {
      throw new Error(`Branch ${branch.id} has zero series impedance, which would short its two buses.`)
    }
    return complex(resistance, reactance)
  }
  if (fromBus.baseKv !== toBus.baseKv) {
    throw new Error(
      `Branch ${branch.id} joins buses at ${fromBus.baseKv} kV and ${toBus.baseKv} kV; give its series impedance in per unit.`,
    )
  }
  const resistance = requireFinite(branch.resistanceOhm ?? 0, `Branch ${branch.id} resistance`)
  const reactance = requireFinite(branch.reactanceOhm ?? 0, `Branch ${branch.id} reactance`)
  if (resistance < 0 || reactance < 0) {
    throw new Error(`Branch ${branch.id} has negative series impedance.`)
  }
  if (resistance === 0 && reactance === 0) {
    throw new Error(`Branch ${branch.id} has zero series impedance, which would short its two buses.`)
  }
  const zBase = (fromBus.baseKv * fromBus.baseKv) / baseMva
  return complex(resistance / zBase, reactance / zBase)
}

interface PreparedNetwork {
  baseMva: number
  buses: PowerBus[]
  branches: PowerBranch[]
  busIndex: Map<string, number>
  g: number[][]
  b: number[][]
}

function prepareNetwork(input: PowerFlowInput): PreparedNetwork {
  const baseMva = requirePositive(input.baseMva, 'Base MVA')
  if (input.buses.length === 0) throw new Error('A power-flow case needs at least one bus.')
  if (input.branches.length === 0 && input.buses.length > 1) {
    throw new Error('A network with several buses needs at least one branch.')
  }

  const buses = [...input.buses]
  const busIndex = new Map<string, number>()
  buses.forEach((bus, index) => {
    if (bus.id.trim() === '') throw new Error(`Bus ${index + 1} has no id.`)
    if (busIndex.has(bus.id)) throw new Error(`Duplicate bus id "${bus.id}".`)
    requirePositive(bus.baseKv, `Bus ${bus.id} base kV`)
    if (!['slack', 'pv', 'pq'].includes(bus.type)) throw new Error(`Bus ${bus.id} has unknown type "${bus.type}".`)
    if (bus.type === 'slack' || bus.type === 'pv') {
      requirePositive(bus.voltageSetpointPu ?? 0, `Bus ${bus.id} voltage setpoint`)
    }
    if (bus.type === 'pv' && bus.reactiveMinMvar !== undefined && bus.reactiveMaxMvar !== undefined) {
      if (bus.reactiveMinMvar > bus.reactiveMaxMvar) {
        throw new Error(`Bus ${bus.id} reactive minimum exceeds its maximum.`)
      }
    }
    busIndex.set(bus.id, index)
  })

  const slackBuses = buses.filter((bus) => bus.type === 'slack')
  if (slackBuses.length !== 1) {
    throw new Error('A power-flow case needs exactly one slack bus; solve each island separately.')
  }
  for (const bus of buses) {
    if (bus.type === 'pq' && (bus.generationMw ?? 0) !== 0) {
      throw new Error(`Bus ${bus.id} is a PQ bus but has scheduled generation; make it a PV bus.`)
    }
  }

  const branches = [...input.branches]
  branches.forEach((branch) => {
    const fromIndex = busIndex.get(branch.from)
    const toIndex = busIndex.get(branch.to)
    if (fromIndex === undefined) throw new Error(`Branch ${branch.id} starts at unknown bus "${branch.from}".`)
    if (toIndex === undefined) throw new Error(`Branch ${branch.id} ends at unknown bus "${branch.to}".`)
    if (fromIndex === toIndex) throw new Error(`Branch ${branch.id} connects bus "${branch.from}" to itself.`)
    if (branch.ratingMva !== undefined) requirePositive(branch.ratingMva, `Branch ${branch.id} rating`)
    if (branch.tapRatio !== undefined) requirePositive(branch.tapRatio, `Branch ${branch.id} tap ratio`)
    if (branch.chargingMvar !== undefined) requireFinite(branch.chargingMvar, `Branch ${branch.id} charging`)
    branchSeriesImpedancePu(branch, buses[fromIndex], buses[toIndex], baseMva)
  })

  const size = buses.length
  const g = Array.from({ length: size }, () => new Array<number>(size).fill(0))
  const b = Array.from({ length: size }, () => new Array<number>(size).fill(0))

  for (const branch of branches) {
    const from = busIndex.get(branch.from) as number
    const to = busIndex.get(branch.to) as number
    const z = branchSeriesImpedancePu(branch, buses[from], buses[to], baseMva)
    const y = cDiv(complex(1, 0), z)
    const tap = branch.tapRatio ?? 1
    const chargingPu = (branch.chargingMvar ?? 0) / baseMva
    const shuntHalf = complex(0, chargingPu / 2)

    const yff = cAdd(cDiv(y, complex(tap * tap, 0)), cDiv(shuntHalf, complex(tap * tap, 0)))
    const yft = cDiv(complex(-y.re, -y.im), complex(tap, 0))
    const ytf = yft
    const ytt = cAdd(y, shuntHalf)

    g[from][from] += yff.re
    b[from][from] += yff.im
    g[from][to] += yft.re
    b[from][to] += yft.im
    g[to][from] += ytf.re
    b[to][from] += ytf.im
    g[to][to] += ytt.re
    b[to][to] += ytt.im
  }

  buses.forEach((bus, index) => {
    const conductance = (bus.shuntMw ?? 0) / baseMva
    const susceptance = (bus.shuntMvar ?? 0) / baseMva
    requireFinite(conductance, `Bus ${bus.id} shunt MW`)
    requireFinite(susceptance, `Bus ${bus.id} shunt Mvar`)
    g[index][index] += conductance
    b[index][index] += susceptance
  })

  // Every bus must be able to reach a slack bus; an island without one has no
  // angle reference or frequency source, and its voltages are undetermined.
  const adjacency = buses.map(() => new Set<number>())
  for (const branch of branches) {
    const from = busIndex.get(branch.from) as number
    const to = busIndex.get(branch.to) as number
    adjacency[from].add(to)
    adjacency[to].add(from)
  }
  const reached = new Set<number>()
  const queue: number[] = []
  for (const bus of slackBuses) {
    const index = busIndex.get(bus.id) as number
    reached.add(index)
    queue.push(index)
  }
  while (queue.length > 0) {
    const current = queue.shift() as number
    for (const neighbour of adjacency[current]) {
      if (!reached.has(neighbour)) {
        reached.add(neighbour)
        queue.push(neighbour)
      }
    }
  }
  if (reached.size !== size) {
    const orphaned = buses.filter((_, index) => !reached.has(index)).map((bus) => bus.id)
    throw new Error(`Bus${orphaned.length > 1 ? 'es' : ''} ${orphaned.join(', ')} cannot reach a slack bus.`)
  }

  return { baseMva, buses, branches, busIndex, g, b }
}

/** The per-unit admittance matrix, exposed for inspection and tests. */
export function buildAdmittanceMatrix(input: PowerFlowInput): AdmittanceMatrix {
  const network = prepareNetwork(input)
  return { busIds: network.buses.map((bus) => bus.id), g: network.g, b: network.b }
}

function injections(
  network: PreparedNetwork,
  voltage: readonly number[],
  angle: readonly number[],
): { p: number[]; q: number[] } {
  const { g, b } = network
  const size = network.buses.length
  const p = new Array<number>(size).fill(0)
  const q = new Array<number>(size).fill(0)
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j < size; j += 1) {
      const theta = angle[i] - angle[j]
      const cos = Math.cos(theta)
      const sin = Math.sin(theta)
      p[i] += voltage[i] * voltage[j] * (g[i][j] * cos + b[i][j] * sin)
      q[i] += voltage[i] * voltage[j] * (g[i][j] * sin - b[i][j] * cos)
    }
  }
  return { p, q }
}

interface SolveSpec {
  types: BusType[]
  pSpecified: number[]
  qSpecified: number[]
}

function buildSpec(network: PreparedNetwork, types: BusType[], qOverride: Map<number, number>): SolveSpec {
  const busCount = network.buses.length
  const pSpecified = new Array<number>(busCount).fill(0)
  const qSpecified = new Array<number>(busCount).fill(0)
  network.buses.forEach((bus, index) => {
    const loadMw = bus.loadMw ?? 0
    const loadMvar = bus.loadMvar ?? 0
    requireFinite(loadMw, `Bus ${bus.id} load MW`)
    requireFinite(loadMvar, `Bus ${bus.id} load Mvar`)
    pSpecified[index] =
      types[index] === 'pv' || types[index] === 'slack'
        ? ((bus.generationMw ?? 0) - loadMw) / network.baseMva
        : -loadMw / network.baseMva
    qSpecified[index] = qOverride.has(index)
      ? ((qOverride.get(index) as number) - loadMvar) / network.baseMva
      : -loadMvar / network.baseMva
  })
  return { types, pSpecified, qSpecified }
}

interface NewtonState {
  voltage: number[]
  angle: number[]
  maxMismatch: number
  iterations: number
  converged: boolean
}

function newtonRaphson(
  network: PreparedNetwork,
  spec: SolveSpec,
  tolerance: number,
  maxIterations: number,
  initial?: { voltage: readonly number[]; angle: readonly number[] },
): NewtonState {
  const size = network.buses.length
  const slackIndex = spec.types.findIndex((type) => type === 'slack')
  const nonSlack: number[] = []
  const pqUnknowns: number[] = []
  const voltage = initial ? [...initial.voltage] : new Array<number>(size).fill(1)
  const angle = initial ? [...initial.angle] : new Array<number>(size).fill(0)

  network.buses.forEach((bus, index) => {
    if (spec.types[index] === 'slack') {
      voltage[index] = bus.voltageSetpointPu as number
      return
    }
    // Every non-slack bus contributes an active-power equation and an angle
    // unknown; PQ buses add the reactive equation and a voltage unknown.
    nonSlack.push(index)
    if (spec.types[index] === 'pq') {
      pqUnknowns.push(index)
      if (!initial) voltage[index] = 1
    } else {
      voltage[index] = bus.voltageSetpointPu as number
    }
  })
  angle[slackIndex] = 0

  let maxMismatch = Number.POSITIVE_INFINITY
  let iteration = 0
  for (; iteration < maxIterations; iteration += 1) {
    const { p, q } = injections(network, voltage, angle)
    const mismatch: number[] = []
    for (const index of nonSlack) mismatch.push(spec.pSpecified[index] - p[index])
    for (const index of pqUnknowns) mismatch.push(spec.qSpecified[index] - q[index])
    maxMismatch = mismatch.reduce((worst, value) => Math.max(worst, Math.abs(value)), 0)
    if (maxMismatch <= tolerance) {
      return { voltage, angle, maxMismatch, iterations: iteration, converged: true }
    }

    const jacobian: number[][] = Array.from({ length: mismatch.length }, () => new Array<number>(mismatch.length).fill(0))
    const pRows = nonSlack.length

    nonSlack.forEach((i, row) => {
      nonSlack.forEach((j, column) => {
        if (i === j) jacobian[row][column] = -q[i] - network.b[i][i] * voltage[i] * voltage[i]
        else {
          const theta = angle[i] - angle[j]
          jacobian[row][column] =
            voltage[i] * voltage[j] * (network.g[i][j] * Math.sin(theta) - network.b[i][j] * Math.cos(theta))
        }
      })
      pqUnknowns.forEach((j, offset) => {
        const column = pRows + offset
        if (i === j) jacobian[row][column] = p[i] / voltage[i] + network.g[i][i] * voltage[i]
        else {
          const theta = angle[i] - angle[j]
          jacobian[row][column] =
            voltage[i] * (network.g[i][j] * Math.cos(theta) + network.b[i][j] * Math.sin(theta))
        }
      })
    })

    pqUnknowns.forEach((i, offset) => {
      const row = pRows + offset
      nonSlack.forEach((j, column) => {
        if (i === j) jacobian[row][column] = p[i] - network.g[i][i] * voltage[i] * voltage[i]
        else {
          const theta = angle[i] - angle[j]
          jacobian[row][column] =
            -voltage[i] * voltage[j] * (network.g[i][j] * Math.cos(theta) + network.b[i][j] * Math.sin(theta))
        }
      })
      pqUnknowns.forEach((j, columnOffset) => {
        const column = pRows + columnOffset
        if (i === j) jacobian[row][column] = q[i] / voltage[i] - network.b[i][i] * voltage[i]
        else {
          const theta = angle[i] - angle[j]
          jacobian[row][column] =
            voltage[i] * (network.g[i][j] * Math.sin(theta) - network.b[i][j] * Math.cos(theta))
        }
      })
    })

    let step: number[]
    try {
      step = solveLinearSystem(jacobian, mismatch)
    } catch {
      return { voltage, angle, maxMismatch, iterations: iteration, converged: false }
    }
    if (step.some((value) => !Number.isFinite(value))) {
      return { voltage, angle, maxMismatch, iterations: iteration, converged: false }
    }

    // Backtracking: a full Newton step can overshoot on stressed cases. Keep
    // halving until the mismatch falls or the step is small enough to try.
    let accepted = false
    for (let halving = 0; halving <= MAX_STEP_HALVINGS && !accepted; halving += 1) {
      const factor = 2 ** -halving
      const trialVoltage = [...voltage]
      const trialAngle = [...angle]
      nonSlack.forEach((index, position) => {
        trialAngle[index] += factor * step[position]
      })
      pqUnknowns.forEach((index, position) => {
        trialVoltage[index] += factor * step[pRows + position]
      })
      const feasible = pqUnknowns.every((index) => trialVoltage[index] >= MIN_VOLTAGE_PU)
      if (!feasible) continue
      const trial = injections(network, trialVoltage, trialAngle)
      let trialWorst = 0
      nonSlack.forEach((index) => {
        trialWorst = Math.max(trialWorst, Math.abs(spec.pSpecified[index] - trial.p[index]))
      })
      pqUnknowns.forEach((index) => {
        trialWorst = Math.max(trialWorst, Math.abs(spec.qSpecified[index] - trial.q[index]))
      })
      if (trialWorst < maxMismatch || halving === MAX_STEP_HALVINGS) {
        for (let index = 0; index < size; index += 1) {
          voltage[index] = trialVoltage[index]
          angle[index] = trialAngle[index]
        }
        accepted = true
      }
    }
    if (!accepted) {
      return { voltage, angle, maxMismatch, iterations: iteration, converged: false }
    }
  }

  return { voltage, angle, maxMismatch, iterations: iteration, converged: false }
}

function branchFlows(
  network: PreparedNetwork,
  voltage: readonly number[],
  angle: readonly number[],
  branch: PowerBranch,
): { from: Complex; to: Complex; loss: Complex } {
  const from = network.busIndex.get(branch.from) as number
  const to = network.busIndex.get(branch.to) as number
  const z = branchSeriesImpedancePu(branch, network.buses[from], network.buses[to], network.baseMva)
  const y = cDiv(complex(1, 0), z)
  const tap = branch.tapRatio ?? 1
  const chargingPu = (branch.chargingMvar ?? 0) / network.baseMva
  const vFrom = complex(voltage[from] * Math.cos(angle[from]), voltage[from] * Math.sin(angle[from]))
  const vTo = complex(voltage[to] * Math.cos(angle[to]), voltage[to] * Math.sin(angle[to]))

  const yff = cAdd(cDiv(y, complex(tap * tap, 0)), complex(0, chargingPu / 2 / (tap * tap)))
  const yft = cDiv(complex(-y.re, -y.im), complex(tap, 0))
  const ytt = cAdd(y, complex(0, chargingPu / 2))

  const iFrom = cAdd(cMul(yff, vFrom), cMul(yft, vTo))
  const iTo = cAdd(cMul(ytt, vTo), cMul(yft, vFrom))
  const sFrom = cMul(vFrom, cConj(iFrom))
  const sTo = cMul(vTo, cConj(iTo))
  return { from: sFrom, to: sTo, loss: cAdd(sFrom, sTo) }
}

/**
 * Solve a transmission case with polar Newton–Raphson.
 *
 * Throws for input that cannot describe a solvable network (duplicate ids,
 * unknown branch ends, no slack, an island). A network that is well-formed but
 * cannot be solved returns `converged: false` with the last iterate, so the UI
 * can report the failure without inventing voltages.
 */
export function solvePowerFlow(input: PowerFlowInput): PowerFlowResult {
  const network = prepareNetwork(input)
  const tolerance = input.tolerance ?? DEFAULT_TOLERANCE
  if (!(tolerance > 0)) throw new Error('Convergence tolerance must be greater than zero.')
  const maxIterations = Math.max(1, Math.floor(input.maxIterations ?? DEFAULT_MAX_ITERATIONS))

  const baseTypes: BusType[] = network.buses.map((bus) => bus.type)
  const qLimits = new Map<number, number>()
  const notes: string[] = []
  const limited = new Set<number>()

  let spec = buildSpec(network, baseTypes, qLimits)
  let state = newtonRaphson(network, spec, tolerance, maxIterations)

  for (let round = 0; round < network.buses.length; round += 1) {
    if (!state.converged) break
    const { q } = injections(network, state.voltage, state.angle)
    let changed = false
    network.buses.forEach((bus, index) => {
      if (spec.types[index] !== 'pv') return
      const qGenerationMvar = (q[index] + (bus.loadMvar ?? 0) / network.baseMva) * network.baseMva
      const minimum = bus.reactiveMinMvar
      const maximum = bus.reactiveMaxMvar
      let clamped: number | undefined
      if (maximum !== undefined && qGenerationMvar > maximum) clamped = maximum
      else if (minimum !== undefined && qGenerationMvar < minimum) clamped = minimum
      if (clamped === undefined) return
      changed = true
      limited.add(index)
      spec.types[index] = 'pq'
      qLimits.set(index, clamped)
      notes.push(
        `Bus ${bus.id} needed ${qGenerationMvar.toFixed(1)} Mvar and was held at its ${clamped.toFixed(1)} Mvar limit; it is now solved as a PQ bus.`,
      )
    })
    if (!changed) break
    spec = buildSpec(network, spec.types, qLimits)
    state = newtonRaphson(network, spec, tolerance, maxIterations, state)
  }

  const { p, q } = injections(network, state.voltage, state.angle)

  const buses: BusResult[] = network.buses.map((bus, index) => {
    const loadMw = bus.loadMw ?? 0
    const loadMvar = bus.loadMvar ?? 0
    const generationMw =
      spec.types[index] === 'slack' || spec.types[index] === 'pv'
        ? bus.type === 'slack'
          ? (p[index] + loadMw / network.baseMva) * network.baseMva
          : (bus.generationMw ?? 0)
        : bus.type === 'pv'
          ? (bus.generationMw ?? 0)
          : 0
    const generationMvar =
      spec.types[index] === 'slack'
        ? (q[index] + loadMvar / network.baseMva) * network.baseMva
        : spec.types[index] === 'pv'
          ? (q[index] + loadMvar / network.baseMva) * network.baseMva
          : bus.type === 'pv'
            ? (qLimits.get(index) ?? (q[index] + loadMvar / network.baseMva) * network.baseMva)
            : 0
    return {
      id: bus.id,
      name: bus.name,
      type: spec.types[index],
      reactiveLimited: limited.has(index),
      voltagePu: state.voltage[index],
      angleDeg: (state.angle[index] * 180) / Math.PI,
      generationMw,
      generationMvar,
      loadMw,
      loadMvar,
      netInjectionMw: p[index] * network.baseMva,
      netInjectionMvar: q[index] * network.baseMva,
    }
  })

  const branches: BranchResult[] = network.branches.map((branch) => {
    const flows = branchFlows(network, state.voltage, state.angle, branch)
    const fromFlowMw = flows.from.re * network.baseMva
    const fromFlowMvar = flows.from.im * network.baseMva
    const toFlowMw = flows.to.re * network.baseMva
    const toFlowMvar = flows.to.im * network.baseMva
    const highestMva = Math.max(
      Math.hypot(fromFlowMw, fromFlowMvar),
      Math.hypot(toFlowMw, toFlowMvar),
    )
    return {
      id: branch.id,
      from: branch.from,
      to: branch.to,
      fromFlowMw,
      fromFlowMvar,
      toFlowMw,
      toFlowMvar,
      lossMw: flows.loss.re * network.baseMva,
      lossMvar: flows.loss.im * network.baseMva,
      loadingPercent: branch.ratingMva === undefined ? null : (highestMva / branch.ratingMva) * 100,
    }
  })

  const totalGenerationMw = buses.reduce((sum, bus) => sum + bus.generationMw, 0)
  const totalGenerationMvar = buses.reduce((sum, bus) => sum + bus.generationMvar, 0)
  const totalLoadMw = buses.reduce((sum, bus) => sum + bus.loadMw, 0)
  const totalLoadMvar = buses.reduce((sum, bus) => sum + bus.loadMvar, 0)
  const totalLossMw = branches.reduce((sum, branch) => sum + branch.lossMw, 0)
  const totalLossMvar = branches.reduce((sum, branch) => sum + branch.lossMvar, 0)
  const loadings = branches
    .map((branch) => branch.loadingPercent)
    .filter((value): value is number => value !== null)
  const minVoltagePu = buses.reduce((minimum, bus) => Math.min(minimum, bus.voltagePu), Number.POSITIVE_INFINITY)

  return {
    converged: state.converged,
    iterations: state.iterations,
    maxMismatchPu: state.maxMismatch,
    buses,
    branches,
    totalGenerationMw,
    totalGenerationMvar,
    totalLoadMw,
    totalLoadMvar,
    totalLossMw,
    totalLossMvar,
    minVoltagePu,
    maxLoadingPercent: loadings.length > 0 ? Math.max(...loadings) : null,
    notes,
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Radial distribution
 * ──────────────────────────────────────────────────────────────────────────── */

export interface FeederSection {
  id: string
  from: string
  to: string
  /** Per-phase series resistance and reactance, Ω. */
  resistanceOhm: number
  reactanceOhm: number
}

export interface FeederNode {
  id: string
  /** Three-phase load, kW and kvar. Positive numbers consume. */
  loadKw?: number
  loadKvar?: number
  /** Distributed generation, kW and kvar. Positive numbers inject. */
  generationKw?: number
  generationKvar?: number
}

export interface RadialFeederInput {
  /** Nominal line-to-line voltage at the source, kV. */
  sourceKv: number
  /** Source voltage in per unit of nominal; defaults to 1. */
  sourceVoltagePu?: number
  sourceId: string
  nodes: readonly FeederNode[]
  sections: readonly FeederSection[]
  tolerance?: number
  maxIterations?: number
}

export interface FeederNodeResult {
  id: string
  voltageV: number
  voltagePu: number
  /** Voltage drop from nominal, percent of nominal. */
  dropPercent: number
  angleDeg: number
  loadKw: number
  loadKvar: number
  generationKw: number
  generationKvar: number
}

export interface FeederSectionResult {
  id: string
  from: string
  to: string
  currentA: number
  lossKw: number
  lossKvar: number
  dropPercent: number
}

export interface RadialFeederResult {
  converged: boolean
  iterations: number
  nodes: FeederNodeResult[]
  sections: FeederSectionResult[]
  totalLoadKw: number
  totalLoadKvar: number
  totalGenerationKw: number
  totalGenerationKvar: number
  /** Power entering the feeder at the source, including losses. */
  sourceDeliveredKw: number
  sourceDeliveredKvar: number
  totalLossKw: number
  totalLossKvar: number
  minVoltagePu: number
  worstNodeId: string
}

/** Solve a radial feeder by backward/forward sweep. */
export function solveRadialFeeder(input: RadialFeederInput): RadialFeederResult {
  const sourceKv = requirePositive(input.sourceKv, 'Source kV')
  const sourcePu = requirePositive(input.sourceVoltagePu ?? 1, 'Source voltage')
  const tolerance = input.tolerance ?? 1e-7
  if (!(tolerance > 0)) throw new Error('Convergence tolerance must be greater than zero.')
  const maxIterations = Math.max(1, Math.floor(input.maxIterations ?? 200))

  const nodeIds = new Set<string>()
  for (const node of input.nodes) {
    if (node.id.trim() === '') throw new Error('Every feeder node needs an id.')
    if (nodeIds.has(node.id)) throw new Error(`Duplicate feeder node "${node.id}".`)
    nodeIds.add(node.id)
  }
  if (!nodeIds.has(input.sourceId)) throw new Error(`Source node "${input.sourceId}" is not in the feeder.`)

  const parentOf = new Map<string, FeederSection>()
  const children = new Map<string, FeederSection[]>()
  for (const node of input.nodes) children.set(node.id, [])
  for (const section of input.sections) {
    requirePositive(section.resistanceOhm + section.reactanceOhm, `Section ${section.id} impedance`)
    if (section.resistanceOhm < 0 || section.reactanceOhm < 0) {
      throw new Error(`Section ${section.id} has negative resistance or reactance.`)
    }
    if (!nodeIds.has(section.from)) throw new Error(`Section ${section.id} starts at unknown node "${section.from}".`)
    if (!nodeIds.has(section.to)) throw new Error(`Section ${section.id} ends at unknown node "${section.to}".`)
    if (section.from === section.to) throw new Error(`Section ${section.id} connects a node to itself.`)
    if (parentOf.has(section.to)) {
      throw new Error(`Node "${section.to}" has more than one incoming section; the feeder must be radial.`)
    }
    parentOf.set(section.to, section)
    ;(children.get(section.from) as FeederSection[]).push(section)
  }

  if (parentOf.has(input.sourceId)) {
    throw new Error(`Source node "${input.sourceId}" has an incoming section; the feeder would contain a loop.`)
  }
  for (const node of input.nodes) {
    if (node.id !== input.sourceId && !parentOf.has(node.id)) {
      throw new Error(`Node "${node.id}" is not connected to the source.`)
    }
  }
  // Reachability also rules out loops that miss the source and sections that
  // duplicate a child under separate parents (already rejected above).
  const visited = new Set<string>([input.sourceId])
  const queue = [input.sourceId]
  while (queue.length > 0) {
    const current = queue.shift() as string
    for (const section of children.get(current) as FeederSection[]) {
      if (visited.has(section.to)) throw new Error(`The feeder contains a loop through node "${section.to}".`)
      visited.add(section.to)
      queue.push(section.to)
    }
  }
  if (visited.size !== input.nodes.length) {
    const stray = input.nodes.filter((node) => !visited.has(node.id)).map((node) => node.id)
    throw new Error(`Node${stray.length > 1 ? 's' : ''} ${stray.join(', ')} are not reachable from the source.`)
  }

  const nominalPhaseV = (sourceKv * 1000) / Math.sqrt(3)
  const sourceMagnitude = nominalPhaseV * sourcePu
  const voltage = new Map<string, Complex>()
  for (const node of input.nodes) voltage.set(node.id, complex(sourceMagnitude, 0))

  // Loads are three-phase totals; the sweep works in per-phase volts and amps,
  // so each node's power is divided by three before the current is formed.
  const netPower = new Map<string, Complex>()
  for (const node of input.nodes) {
    const loadKw = requireFinite(node.loadKw ?? 0, `Node ${node.id} load kW`)
    const loadKvar = requireFinite(node.loadKvar ?? 0, `Node ${node.id} load kvar`)
    const generationKw = requireFinite(node.generationKw ?? 0, `Node ${node.id} generation kW`)
    const generationKvar = requireFinite(node.generationKvar ?? 0, `Node ${node.id} generation kvar`)
    if (loadKw < 0 || loadKvar < 0 || generationKw < 0 || generationKvar < 0) {
      throw new Error(`Node ${node.id} has a negative load or generation value.`)
    }
    if (node.id === input.sourceId && (loadKw !== 0 || loadKvar !== 0 || generationKw !== 0 || generationKvar !== 0)) {
      throw new Error(`Source node "${node.id}" cannot carry load or generation; attach them to a child node.`)
    }
    netPower.set(node.id, complex(((loadKw - generationKw) * 1000) / 3, ((loadKvar - generationKvar) * 1000) / 3))
  }

  const order: string[] = []
  {
    const stack: Array<{ id: string; visitedChildren: boolean }> = [{ id: input.sourceId, visitedChildren: false }]
    while (stack.length > 0) {
      const entry = stack.pop() as { id: string; visitedChildren: boolean }
      if (entry.visitedChildren) {
        order.push(entry.id)
        continue
      }
      stack.push({ id: entry.id, visitedChildren: true })
      for (const section of children.get(entry.id) as FeederSection[]) {
        stack.push({ id: section.to, visitedChildren: false })
      }
    }
  }

  let iteration = 0
  let converged = false
  let branchCurrent = new Map<string, Complex>()
  for (; iteration < maxIterations; iteration += 1) {
    branchCurrent = new Map<string, Complex>()
    for (const section of input.sections) branchCurrent.set(section.id, complex(0, 0))

    // Backward: each node sends its own load current plus every child current.
    for (const id of order) {
      const v = voltage.get(id) as Complex
      const magnitudeSquared = v.re * v.re + v.im * v.im
      let current = complex(0, 0)
      if (magnitudeSquared > 1e-26) {
        const s = netPower.get(id) as Complex
        // I = conj(S / V)
        current = cConj(cDiv(s, v))
      }
      for (const section of children.get(id) as FeederSection[]) {
        current = cAdd(current, branchCurrent.get(section.id) as Complex)
      }
      const incoming = parentOf.get(id)
      if (incoming) branchCurrent.set(incoming.id, current)
    }

    // Forward: walk from the source, applying V_child = V_parent − Z·I.
    let largestChange = 0
    const walk = [input.sourceId]
    while (walk.length > 0) {
      const id = walk.shift() as string
      for (const section of children.get(id) as FeederSection[]) {
        const parentVoltage = voltage.get(id) as Complex
        const current = branchCurrent.get(section.id) as Complex
        const z = complex(section.resistanceOhm, section.reactanceOhm)
        const childVoltage = cSub(parentVoltage, cMul(z, current))
        const previous = voltage.get(section.to) as Complex
        largestChange = Math.max(largestChange, Math.hypot(childVoltage.re - previous.re, childVoltage.im - previous.im))
        voltage.set(section.to, childVoltage)
        walk.push(section.to)
      }
    }

    if (largestChange <= tolerance * nominalPhaseV) {
      converged = true
      iteration += 1
      break
    }
  }

  const nodes: FeederNodeResult[] = input.nodes.map((node) => {
    const v = voltage.get(node.id) as Complex
    const magnitude = Math.hypot(v.re, v.im)
    const loadKw = node.loadKw ?? 0
    const loadKvar = node.loadKvar ?? 0
    const generationKw = node.generationKw ?? 0
    const generationKvar = node.generationKvar ?? 0
    return {
      id: node.id,
      voltageV: magnitude,
      voltagePu: magnitude / nominalPhaseV,
      dropPercent: ((nominalPhaseV - magnitude) / nominalPhaseV) * 100,
      angleDeg: (Math.atan2(v.im, v.re) * 180) / Math.PI,
      loadKw,
      loadKvar,
      generationKw,
      generationKvar,
    }
  })

  const sections: FeederSectionResult[] = input.sections.map((section) => {
    const current = branchCurrent.get(section.id) as Complex
    const magnitude = Math.hypot(current.re, current.im)
    const z = complex(section.resistanceOhm, section.reactanceOhm)
    const lossPerPhase = cMul(complex(magnitude * magnitude, 0), z)
    const fromVoltage = voltage.get(section.from) as Complex
    const toVoltage = voltage.get(section.to) as Complex
    return {
      id: section.id,
      from: section.from,
      to: section.to,
      currentA: magnitude,
      lossKw: (lossPerPhase.re * 3) / 1000,
      lossKvar: (lossPerPhase.im * 3) / 1000,
      dropPercent: ((Math.hypot(fromVoltage.re, fromVoltage.im) - Math.hypot(toVoltage.re, toVoltage.im)) /
        nominalPhaseV) *
        100,
    }
  })

  const totalLoadKw = input.nodes.reduce((sum, node) => sum + (node.loadKw ?? 0), 0)
  const totalLoadKvar = input.nodes.reduce((sum, node) => sum + (node.loadKvar ?? 0), 0)
  const totalGenerationKw = input.nodes.reduce((sum, node) => sum + (node.generationKw ?? 0), 0)
  const totalGenerationKvar = input.nodes.reduce((sum, node) => sum + (node.generationKvar ?? 0), 0)
  const totalLossKw = sections.reduce((sum, section) => sum + section.lossKw, 0)
  const totalLossKvar = sections.reduce((sum, section) => sum + section.lossKvar, 0)
  const minVoltagePu = nodes.reduce((minimum, node) => Math.min(minimum, node.voltagePu), Number.POSITIVE_INFINITY)
  const worstNodeId = nodes.reduce((worst, node) => (node.voltagePu < worst.voltagePu ? node : worst), nodes[0]).id

  const sourceCurrent = input.sections
    .filter((section) => section.from === input.sourceId)
    .reduce((sum, section) => cAdd(sum, branchCurrent.get(section.id) as Complex), complex(0, 0))
  const sourcePower = cMul(complex(sourceMagnitude, 0), cConj(sourceCurrent))

  return {
    converged,
    iterations: iteration,
    nodes,
    sections,
    totalLoadKw,
    totalLoadKvar,
    totalGenerationKw,
    totalGenerationKvar,
    sourceDeliveredKw: (sourcePower.re * 3) / 1000,
    sourceDeliveredKvar: (sourcePower.im * 3) / 1000,
    totalLossKw,
    totalLossKvar,
    minVoltagePu,
    worstNodeId,
  }
}
