/**
 * Gene-regulatory circuits: the biological analogue of a logic diagram.
 *
 * A circuit here is a set of species (a protein, a transcript, a reporter) whose
 * production is controlled by Hill functions of the other species, and every
 * species is removed at its own first-order rate. That is the standard coarse-
 * grained GRN model, and it is the level at which synthetic-biology designs are
 * actually drawn: a promoter with a repressor bound to it, not a molecular
 * dynamics trajectory.
 *
 * Equations
 * ---------
 * For species i with concentration `C_i`:
 *
 *   dC_i/dt = α_i · (L_i + (1 − L_i)·A_i) − δ_i · C_i
 *
 * where `A_i` is the promoter activity — the product over the edges into `i` of
 *   repression  1 / (1 + (C_j/K)^n)
 *   activation        (C_j/K)^n / (1 + (C_j/K)^n)
 * and `L_i` is the leak (the fraction of maximum transcription that repression
 * cannot shut off). A species with no inputs is constitutive: `A_i = 1`.
 *
 * Two vector conventions, kept apart on purpose
 * ----------------------------------------------
 * - a *state* vector holds only the integrated species, in `resolveCircuit`'s
 *   `dynamic` order — this is what the integrator carries;
 * - a *full* vector holds one entry per species, in declaration order, with the
 *   clamped species carrying their `fixedAt` value — this is what a caller reads.
 * `fullConcentrations` and `stateConcentrations` are the only conversions; every
 * mixed index into the wrong array would silently read another species' value.
 *
 * Honest limits
 * -------------
 * - Deterministic and well-mixed. Real circuits at low copy number are noisy, and
 *   a repressilator in a single cell drowns in that noise; this model cannot say
 *   anything about cell-to-cell spread, because it has no molecules, only numbers.
 * - Hill functions are a fit to thermodynamic promoter occupancy, not a mechanistic
 *   model of cooperative binding. `hill` is an empirical slope.
 * - No transcription/translation separation, no mRNA species unless one is declared,
 *   no resource competition (ribosomes and polymerases are infinite, so a real
 *   design's biggest coupling is missing), no cell growth or dilution by division
 *   unless a degradation rate is set to include it.
 * - Concentrations are dimensionless; K and α set the scale. Nothing here maps a
 *   number to nM without an externally supplied calibration.
 * - The multiplicativity of inputs assumes independent promoters. Two repressors
 *   on the same operator do not in general multiply.
 */

import {
  integrateModel,
  requireFraction,
  requireNonNegative,
  requirePositive,
  type BiologyWindow,
} from './modelSupport'
import { linearStability } from '../math/matrixEigen'

export type EdgeKind = 'repress' | 'activate'

export interface CircuitSpecies {
  id: string
  /** Display name; defaults to `id`. */
  label?: string
  /** Maximum production rate α, concentration per time unit. */
  maxProduction: number
  /** First-order removal rate δ, per time unit. */
  degradationPerTime: number
  /** Leak fraction L, 0…1: the activity remaining when the promoter is fully repressed. */
  leakFraction?: number
  /**
   * A clamped species is held at this concentration forever — an input pin, or a
   * pool so large that the circuit cannot drain it. Clamped species are read by
   * the promoters but never integrated.
   */
  fixedAt?: number
}

export interface RegulatoryEdge {
  /** Source species id. */
  from: string
  /** Species whose promoter this edge acts on. */
  to: string
  kind: EdgeKind
  /** Half-activation concentration K, in the same units as the concentrations. */
  threshold: number
  /** Empirical Hill slope. 1 is a non-cooperative binder; 2 is the usual fitted value. */
  hill: number
}

export interface GeneticCircuit {
  name?: string
  species: CircuitSpecies[]
  edges: RegulatoryEdge[]
}

export interface GeneticCircuitSample {
  time: number
  /** Full-length, species-declaration order — clamped species included. */
  concentrations: number[]
}

export interface ResolvedCircuit {
  circuit: GeneticCircuit
  /** Species indices that are integrated, in state-vector order. */
  dynamic: number[]
  /** Every species index → its slot in the state vector, or −1 when clamped. */
  stateIndex: number[]
}

function repressionFactor(normalised: number, hill: number): number {
  return 1 / (1 + normalised ** hill)
}

function activationFactor(normalised: number, hill: number): number {
  return normalised ** hill / (1 + normalised ** hill)
}

/** The factor one edge applies to its target promoter, and its derivative w.r.t. the source. */
function edgeFactor(edge: RegulatoryEdge, sourceConcentration: number): { value: number; slope: number } {
  const x = sourceConcentration / edge.threshold
  const powered = x ** edge.hill
  const denominator = (1 + powered) ** 2
  // d/dC of x^n is n·C^(n−1)/K^n; the same term differentiates both factor shapes.
  const dPowered = (edge.hill * sourceConcentration ** (edge.hill - 1)) / edge.threshold ** edge.hill
  return edge.kind === 'repress'
    ? { value: 1 / (1 + powered), slope: -dPowered / denominator }
    : { value: powered / (1 + powered), slope: dPowered / denominator }
}

export function resolveCircuit(circuit: GeneticCircuit): ResolvedCircuit {
  if (circuit.species.length === 0) throw new Error('A genetic circuit needs at least one species.')
  const ids = new Set<string>()
  for (const species of circuit.species) {
    if (!species.id) throw new Error('Every species needs an id.')
    if (ids.has(species.id)) throw new Error(`Species id "${species.id}" appears twice.`)
    ids.add(species.id)
    requireNonNegative(species.maxProduction, `Production rate of ${species.id}`)
    requirePositive(species.degradationPerTime, `Degradation rate of ${species.id}`)
    if (species.leakFraction !== undefined) {
      requireFraction(species.leakFraction, `Leak fraction of ${species.id}`)
    }
    if (species.fixedAt !== undefined) {
      requireNonNegative(species.fixedAt, `Clamped concentration of ${species.id}`)
    }
  }
  for (const edge of circuit.edges) {
    if (!ids.has(edge.from)) throw new Error(`Edge source "${edge.from}" is not a species in this circuit.`)
    if (!ids.has(edge.to)) throw new Error(`Edge target "${edge.to}" is not a species in this circuit.`)
    requirePositive(edge.threshold, `Threshold of edge ${edge.from}→${edge.to}`)
    requirePositive(edge.hill, `Hill coefficient of edge ${edge.from}→${edge.to}`)
    if (edge.kind !== 'repress' && edge.kind !== 'activate') {
      throw new Error(`Edge ${edge.from}→${edge.to} has kind "${edge.kind}", which is neither repression nor activation.`)
    }
  }

  const stateIndex: number[] = []
  const dynamic: number[] = []
  for (let index = 0; index < circuit.species.length; index += 1) {
    if (circuit.species[index].fixedAt === undefined) {
      stateIndex.push(dynamic.length)
      dynamic.push(index)
    } else {
      stateIndex.push(-1)
    }
  }
  if (dynamic.length === 0) throw new Error('Every species in this circuit is clamped, so there is nothing to simulate.')
  return { circuit, dynamic, stateIndex }
}

/** State vector → full-length vector, filling in every clamped species. */
export function fullConcentrations(resolved: ResolvedCircuit, state: readonly number[]): number[] {
  if (state.length !== resolved.dynamic.length) {
    throw new Error(`Expected a state vector of ${resolved.dynamic.length} values, got ${state.length}.`)
  }
  const full: number[] = []
  for (let index = 0; index < resolved.circuit.species.length; index += 1) {
    const slot = resolved.stateIndex[index]
    full.push(slot >= 0 ? state[slot] : (resolved.circuit.species[index].fixedAt ?? 0))
  }
  return full
}

/** Full-length vector → state vector; clamped entries are dropped, not validated. */
export function stateConcentrations(resolved: ResolvedCircuit, full: readonly number[]): number[] {
  if (full.length !== resolved.circuit.species.length) {
    throw new Error(`Expected ${resolved.circuit.species.length} concentrations, got ${full.length}.`)
  }
  return resolved.dynamic.map((index) => full[index])
}

/**
 * Promoter activity `A_i` in 0…1 for one species, from a full-length vector.
 * Multiplied over every edge into it, which is the independent-promoters
 * assumption stated at the top of the file.
 */
export function promoterActivity(resolved: ResolvedCircuit, speciesIndex: number, full: readonly number[]): number {
  const targetId = resolved.circuit.species[speciesIndex].id
  let activity = 1
  for (const edge of resolved.circuit.edges) {
    if (edge.to !== targetId) continue
    const source = resolved.circuit.species.findIndex((species) => species.id === edge.from)
    activity *= edgeFactor(edge, full[source]).value
  }
  return activity
}

/** Production minus removal for the integrated species, as an integrator callback. */
export function geneticCircuitDerivative(resolved: ResolvedCircuit): (time: number, state: readonly number[]) => number[] {
  const { circuit } = resolved
  return (_time: number, state: readonly number[]): number[] => {
    const full = fullConcentrations(resolved, state)
    return resolved.dynamic.map((index) => {
      const species = circuit.species[index]
      const leak = species.leakFraction ?? 0
      const activity = leak + (1 - leak) * promoterActivity(resolved, index, full)
      return species.maxProduction * activity - species.degradationPerTime * full[index]
    })
  }
}

/**
 * Simulate a circuit. `initial` may be a full-length vector (clamped entries
 * ignored) or one per integrated species.
 */
export function simulateGeneticCircuit(
  circuit: GeneticCircuit,
  initial: readonly number[],
  window: BiologyWindow,
): GeneticCircuitSample[] {
  const resolved = resolveCircuit(circuit)
  let state: number[]
  if (initial.length === circuit.species.length) {
    state = stateConcentrations(resolved, initial)
  } else if (initial.length === resolved.dynamic.length) {
    state = [...initial]
  } else {
    throw new Error(
      `Initial condition has ${initial.length} values; this circuit has ${circuit.species.length} species ` +
        `(${resolved.dynamic.length} of them integrated).`,
    )
  }
  for (const value of state) requireNonNegative(value, 'Initial concentration')

  // The fastest process sets the step: production and removal are both exponentials
  // with rate δ, and the Hill switch itself has no intrinsic timescale.
  const fastestTau = 1 / Math.max(...resolved.dynamic.map((index) => circuit.species[index].degradationPerTime))
  const samples = integrateModel(geneticCircuitDerivative(resolved), state, window, fastestTau)

  return samples.map((sample) => ({ time: sample.time, concentrations: fullConcentrations(resolved, sample.state) }))
}

export interface CircuitSteadyState {
  concentrations: number[]
  /** Largest |dC/dt| at the reported point, relative to `residualScale`. */
  residual: number
  /** The production/removal scale the residual is judged against. */
  residualScale: number
  converged: boolean
  /** Why a non-converged answer is what it is. */
  note: string
}

/**
 * Relax to a steady state and *prove* it: the derivative at the returned point is
 * reported as a residual, and a large residual means the circuit is oscillating
 * or settling slower than the window allows rather than sitting still.
 */
export function circuitSteadyState(
  circuit: GeneticCircuit,
  initial: readonly number[],
  window: BiologyWindow,
  tolerance = 1e-6,
): CircuitSteadyState {
  if (!Number.isFinite(tolerance) || tolerance <= 0) throw new Error('Steady-state tolerance must be positive.')
  const resolved = resolveCircuit(circuit)
  const samples = simulateGeneticCircuit(circuit, initial, window)
  const last = samples[samples.length - 1]
  const concentrations = last.concentrations
  const derivative = geneticCircuitDerivative(resolved)(last.time, stateConcentrations(resolved, concentrations))
  const residual = derivative.reduce((max, value) => Math.max(max, Math.abs(value)), 0)
  // The natural scale of a residual is the largest production rate the circuit has.
  const residualScale = Math.max(...resolved.dynamic.map((index) => circuit.species[index].maxProduction), 1)
  const converged = residual < tolerance * residualScale
  return {
    concentrations,
    residual,
    residualScale,
    converged,
    note: converged
      ? 'Settled: the reported point has near-zero production-minus-removal.'
      : `Not settled after ${window.tEnd} time units (residual ${residual.toExponential(2)} against a ${residualScale.toExponential(2)} production scale). ` +
        'The circuit is probably oscillating, or the window is shorter than its slowest relaxation.',
  }
}

/**
 * Analytic Jacobian of the circuit at a full-length concentration vector, over the
 * integrated species only.
 *
 * `A_i = Π_e f_e(C_src(e))`, so `∂A_i/∂C_j = Σ_{e→i, src(e)=j} f'_e · Π_{e′≠e} f_e′`.
 * The product of the *other* factors is formed explicitly rather than by dividing
 * `A_i` by `f_e`, because a fully repressed promoter has A_i = 0 to machine
 * precision and dividing by a factor that is zero would produce NaN.
 */
export function geneticCircuitJacobian(
  circuit: GeneticCircuit,
  full: readonly number[],
): number[][] {
  const resolved = resolveCircuit(circuit)
  if (full.length !== circuit.species.length) {
    throw new Error(`Jacobian needs one concentration per species (${circuit.species.length}), got ${full.length}.`)
  }
  const size = resolved.dynamic.length
  const jacobian: number[][] = Array.from({ length: size }, () => new Array<number>(size).fill(0))
  const slotOf = new Map<number, number>()
  resolved.dynamic.forEach((speciesIndex, slot) => slotOf.set(speciesIndex, slot))
  const indexOf = new Map<string, number>()
  circuit.species.forEach((species, index) => indexOf.set(species.id, index))

  for (const targetIndex of resolved.dynamic) {
    const species = circuit.species[targetIndex]
    const row = slotOf.get(targetIndex)
    if (row === undefined) continue
    const leak = species.leakFraction ?? 0
    const output = species.maxProduction * (1 - leak)
    jacobian[row][row] -= species.degradationPerTime

    const incoming = circuit.edges
      .map((edge) => ({ edge, source: indexOf.get(edge.from) }))
      .filter((entry) => entry.edge.to === species.id && entry.source !== undefined)
    const factors = incoming.map((entry) => edgeFactor(entry.edge, full[entry.source as number]))
    for (let e = 0; e < incoming.length; e += 1) {
      const source = incoming[e].source as number
      const column = slotOf.get(source)
      if (column === undefined) continue
      let others = 1
      for (let k = 0; k < incoming.length; k += 1) if (k !== e) others *= factors[k].value
      jacobian[row][column] += output * factors[e].slope * others
    }
  }
  return jacobian
}

/** Linear stability of the circuit at a full-length concentration vector. */
export function circuitStabilityAt(
  circuit: GeneticCircuit,
  full: readonly number[],
): { kind: 'stable' | 'unstable' | 'marginal'; margin: number; spectrum: ReturnType<typeof linearStability>['spectrum'] } {
  return linearStability(geneticCircuitJacobian(circuit, full))
}

/* ------------------------------------------------------------------ *
 * Response curves — the design-time view of one promoter
 * ------------------------------------------------------------------ */

export interface HillResponsePoint {
  concentration: number
  activity: number
}

/**
 * Dose–response of a single-input promoter: `n` sets the slope, `K` is the point
 * of half-maximal activity by construction. Useful for choosing a threshold when
 * the design needs a specific fold-change between two states.
 */
export function hillResponseCurve(
  options: { kind: EdgeKind; threshold: number; hill: number; leakFraction?: number; points?: number; until?: number },
): HillResponsePoint[] {
  requirePositive(options.threshold, 'Hill threshold')
  requirePositive(options.hill, 'Hill coefficient')
  const leak = options.leakFraction ?? 0
  requireFraction(leak, 'Hill leak fraction')
  const points = options.points ?? 40
  if (!Number.isInteger(points) || points < 2) throw new Error(`Response curve needs at least 2 points (got ${points}).`)
  const until = options.until ?? options.threshold * 20
  requirePositive(until, 'Response curve maximum concentration')

  const curve: HillResponsePoint[] = []
  for (let i = 0; i < points; i += 1) {
    const concentration = (until * i) / (points - 1)
    const factor = options.kind === 'repress'
      ? repressionFactor(concentration / options.threshold, options.hill)
      : activationFactor(concentration / options.threshold, options.hill)
    curve.push({ concentration, activity: leak + (1 - leak) * factor })
  }
  return curve
}

/**
 * Promoter output at two input levels, and the fold-change between them.
 *
 * `foldChange` is oriented so that > 1 always means "the output moves by this
 * factor as the input rises from low to high": a repressor reports low/high and
 * an activator high/low. A leaky promoter caps its own fold-change, which is the
 * number that decides whether a stage can drive the next.
 */
export function promoterFoldChange(
  options: {
    kind: EdgeKind
    threshold: number
    hill: number
    leakFraction?: number
    lowConcentration: number
    highConcentration: number
  },
): { low: number; high: number; foldChange: number } {
  requireNonNegative(options.lowConcentration, 'Fold-change low concentration')
  requireNonNegative(options.highConcentration, 'Fold-change high concentration')
  if (options.highConcentration <= options.lowConcentration) {
    throw new Error(`Fold-change high concentration (${options.highConcentration}) must exceed the low one (${options.lowConcentration}).`)
  }
  const promoter: RegulatoryEdge = {
    from: '',
    to: '',
    kind: options.kind,
    threshold: options.threshold,
    hill: options.hill,
  }
  const activity = (concentration: number): number => {
    const leak = options.leakFraction ?? 0
    return leak + (1 - leak) * edgeFactor(promoter, concentration).value
  }
  const low = activity(options.lowConcentration)
  const high = activity(options.highConcentration)
  const ratio = options.kind === 'repress' ? low / high : high / low
  return { low, high, foldChange: ratio }
}

/* ------------------------------------------------------------------ *
 * Behaviour classification — what the design actually does
 * ------------------------------------------------------------------ */

export interface OscillationReport {
  oscillates: boolean
  /** Mean peak-to-peak interval of the detected cycles, or null when too few peaks. */
  period: number | null
  peaks: number
  /** Peak-to-trough span of `leadSpecies` after the transient. */
  amplitude: number
  /** `amplitude` divided by the trace's own level. A damped spiral ends near zero. */
  relativeAmplitude: number
  /**
   * Span of the last third of the window divided by the span of the third before
   * it. One means a limit cycle; falling toward zero means the "oscillation" is a
   * transient spiral into a fixed point, which is not an oscillator.
   */
  amplitudeTrend: number
  /** Species index with the most turning points, or the widest swing when none oscillates. */
  leadSpecies: number | null
}

/**
 * Decide whether a trace is oscillating, and how fast.
 *
 * Three separate tests, because the easy one lies. A turning point counts only
 * after the trace has fallen (or risen) by `relativeAmplitude` × its own span away
 * from it — the same hysteresis the spike detector uses — which rejects the
 * monotone approach to a steady state. But a *damped* spiral also produces
 * turning points, and at long times it produces them out of pure round-off, so a
 * trace must additionally (a) swing by at least `minimumRelativeAmplitude` of its
 * own level and (b) still be swinging in the last third of the window, to the
 * degree measured by `amplitudeTrend`. Requiring three surviving peaks is what
 * turns "it wobbled" into "it cycles".
 *
 * This distinction is not decoration: the deterministic repressilator with a Hill
 * coefficient of 2 fails test (b) at every production rate, and only the noise of
 * a real cell was ever enough to keep it beating.
 */
export function detectOscillation(
  samples: readonly GeneticCircuitSample[],
  options: {
    transientFraction?: number
    relativeAmplitude?: number
    minimumRelativeAmplitude?: number
    sustainedTrend?: number
  } = {},
): OscillationReport {
  const transientFraction = options.transientFraction ?? 0.25
  const deadband = options.relativeAmplitude ?? 0.05
  const minimumRelative = options.minimumRelativeAmplitude ?? 0.02
  const sustainedTrend = options.sustainedTrend ?? 0.5
  if (transientFraction < 0 || transientFraction >= 1) {
    throw new Error(`Transient fraction must be in [0, 1) (got ${transientFraction}).`)
  }
  requirePositive(deadband, 'Oscillation deadband')
  const none: OscillationReport = {
    oscillates: false, period: null, peaks: 0, amplitude: 0,
    relativeAmplitude: 0, amplitudeTrend: 0, leadSpecies: null,
  }
  if (samples.length < 5) return none
  const tail = samples.slice(Math.floor(samples.length * transientFraction))
  if (tail.length < 9) return none

  const window = Math.floor(tail.length / 3)
  /** Peak-to-trough span of a slice. */
  const spanOf = (list: readonly number[]): number => {
    let low = Number.POSITIVE_INFINITY
    let high = Number.NEGATIVE_INFINITY
    for (const value of list) {
      if (value < low) low = value
      if (value > high) high = value
    }
    return high - low
  }
  const speciesCount = samples[0].concentrations.length
  let lead: {
    peaks: number, period: number | null, amplitude: number, relativeAmplitude: number, trend: number, index: number,
  } | null = null
  for (let index = 0; index < speciesCount; index += 1) {
    const values = tail.map((sample) => sample.concentrations[index])
    let level = 0
    for (const value of values) level = Math.max(level, Math.abs(value))
    const amplitude = spanOf(values)
    if (!(amplitude > 0)) continue
    const threshold = amplitude * deadband

    const peakTimes: number[] = []
    let trackingPeak = true
    let extremeValue = values[0]
    let extremeTime = tail[0].time
    for (let i = 1; i < values.length; i += 1) {
      const value = values[i]
      if (trackingPeak) {
        if (value > extremeValue) {
          extremeValue = value
          extremeTime = tail[i].time
        } else if (extremeValue - value >= threshold) {
          peakTimes.push(extremeTime)
          trackingPeak = false
          extremeValue = value
        }
      } else if (value < extremeValue) {
        extremeValue = value
      } else if (value - extremeValue >= threshold) {
        trackingPeak = true
        extremeValue = value
        extremeTime = tail[i].time
      }
    }

    // A trace that has already flatlined in both comparison windows is not
    // "sustained", and one that starts moving after a flat stretch is not damped,
    // so the degenerate 0/0 is resolved by which side still swings.
    const referenceSpan = spanOf(values.slice(-2 * window, -window))
    const currentSpan = spanOf(values.slice(-window))
    const candidate = {
      peaks: peakTimes.length,
      period:
        peakTimes.length >= 2
          ? peakTimes.slice(1).reduce((sum, time, i) => sum + (time - peakTimes[i]), 0) / (peakTimes.length - 1)
          : null,
      amplitude,
      relativeAmplitude: level > 0 ? amplitude / level : 0,
      trend: referenceSpan > 0 ? currentSpan / referenceSpan : currentSpan > 0 ? Number.POSITIVE_INFINITY : 0,
      index,
    }
    if (!lead) lead = candidate
    else if (candidate.peaks > lead.peaks || (candidate.peaks === lead.peaks && candidate.amplitude > lead.amplitude)) lead = candidate
  }

  if (!lead) return none
  const oscillates = lead.peaks >= 3
    && lead.relativeAmplitude >= minimumRelative
    && lead.trend >= sustainedTrend
  return {
    oscillates,
    period: oscillates ? lead.period : null,
    peaks: lead.peaks,
    amplitude: lead.amplitude,
    relativeAmplitude: lead.relativeAmplitude,
    amplitudeTrend: lead.trend,
    leadSpecies: lead.index,
  }
}

/* ------------------------------------------------------------------ *
 * Preset circuits
 * ------------------------------------------------------------------ */

export interface CircuitPreset {
  id: string
  name: string
  /** What the design is for, and what it will not do. */
  note: string
  circuit: GeneticCircuit
  /** A starting point for the simulation that is not the trivial all-zero one. */
  initial: readonly number[]
  window: BiologyWindow
}

const REPRESS = (from: string, to: string, threshold = 1, hill = 2): RegulatoryEdge => ({
  from,
  to,
  kind: 'repress',
  threshold,
  hill,
})

export const CIRCUIT_PRESETS: readonly CircuitPreset[] = [
  {
    id: 'repressilator',
    name: 'Repressilator (3-cycle)',
    note: 'Three genes each repressing the next, K = 1, α = 20. It needs a Hill coefficient of 3 to beat: with '
      + 'the usual n = 2 this deterministic model only spirals inward and stops, at every production rate up to '
      + '1000 — the original circuit kept time because gene expression is noisy, and noise is not in this model. '
      + 'Cooperativity, not α, is the design knob. Period is in model time units (the experiment was in minutes, '
      + 'with a far longer period).',
    circuit: {
      name: 'Repressilator',
      species: [
        { id: 'tetR', label: 'TetR', maxProduction: 20, degradationPerTime: 1, leakFraction: 0 },
        { id: 'cI', label: 'cI', maxProduction: 20, degradationPerTime: 1, leakFraction: 0 },
        { id: 'lacI', label: 'LacI', maxProduction: 20, degradationPerTime: 1, leakFraction: 0 },
      ],
      edges: [REPRESS('tetR', 'cI', 1, 3), REPRESS('cI', 'lacI', 1, 3), REPRESS('lacI', 'tetR', 1, 3)],
    },
    initial: [1, 0.2, 0.2],
    window: { tEnd: 120, dt: 0.1 },
  },
  {
    id: 'toggle-switch',
    name: 'Toggle switch (mutual repression)',
    note: 'Two repressors holding each other off: two stable states, so it stores a bit. Which state it takes '
      + 'is decided by the initial condition — exactly the property a memory element needs, and the reason a '
      + 'design must specify the set/reset path rather than assume one state.',
    circuit: {
      name: 'Toggle switch',
      species: [
        { id: 'A', label: 'Repressor A', maxProduction: 4, degradationPerTime: 1, leakFraction: 0.001 },
        { id: 'B', label: 'Repressor B', maxProduction: 4, degradationPerTime: 1, leakFraction: 0.001 },
      ],
      edges: [REPRESS('B', 'A'), REPRESS('A', 'B')],
    },
    initial: [3, 0.2],
    window: { tEnd: 100, dt: 0.2 },
  },
  {
    id: 'negative-autoregulation',
    name: 'Negative autoregulation',
    note: 'A repressor that shuts off its own promoter. Same steady state as the unregulated gene when the '
      + 'production rate is matched, but it gets there faster and rejects noise in α — the standard reason '
      + 'natural circuits use it.',
    circuit: {
      name: 'Negative autoregulation',
      species: [{ id: 'R', label: 'Repressor', maxProduction: 8, degradationPerTime: 1, leakFraction: 0 }],
      edges: [REPRESS('R', 'R')],
    },
    initial: [0],
    window: { tEnd: 30, dt: 0.1 },
  },
  {
    id: 'incoherent-feedforward',
    name: 'Incoherent feedforward (I1)',
    note: 'An input drives an output directly and also drives a repressor of that same output, so a step '
      + 'produces a pulse rather than a plateau. The adaptation is approximate, not perfect: perfect '
      + 'adaptation needs an integral controller, which this circuit is not.',
    circuit: {
      name: 'Incoherent feedforward loop',
      species: [
        { id: 'X', label: 'Input X', maxProduction: 0, degradationPerTime: 1, fixedAt: 4 },
        { id: 'Y', label: 'Intermediate Y', maxProduction: 4, degradationPerTime: 1, leakFraction: 0 },
        { id: 'Z', label: 'Output Z', maxProduction: 8, degradationPerTime: 1, leakFraction: 0 },
      ],
      edges: [
        { from: 'X', to: 'Y', kind: 'activate', threshold: 1, hill: 2 },
        REPRESS('Y', 'Z'),
        { from: 'X', to: 'Z', kind: 'activate', threshold: 1, hill: 2 },
      ],
    },
    initial: [0, 0.5, 0.5],
    window: { tEnd: 60, dt: 0.2 },
  },
]

export function presetCircuit(id: string): CircuitPreset {
  const found = CIRCUIT_PRESETS.find((preset) => preset.id === id)
  if (!found) throw new Error(`No circuit preset "${id}". Known presets: ${CIRCUIT_PRESETS.map((preset) => preset.id).join(', ')}.`)
  return found
}

/**
 * The design check a circuit should pass before it is built: every species
 * settles, and the reported steady state is stable under the linearisation.
 */
export function analyseCircuit(
  circuit: GeneticCircuit,
  initial: readonly number[],
  window: BiologyWindow,
): {
  steadyState: CircuitSteadyState
  stability: { kind: 'stable' | 'unstable' | 'marginal'; margin: number }
  oscillation: OscillationReport
} {
  const steadyState = circuitSteadyState(circuit, initial, window)
  const oscillation = detectOscillation(simulateGeneticCircuit(circuit, initial, window))
  if (!steadyState.converged || oscillation.oscillates) {
    // A spectrum around a point the trajectory never reaches says nothing about
    // the design, so the verdict is withheld rather than guessed.
    return { steadyState, stability: { kind: 'marginal', margin: Number.NaN }, oscillation }
  }
  const verdict = linearStability(geneticCircuitJacobian(circuit, steadyState.concentrations))
  return { steadyState, stability: { kind: verdict.kind, margin: verdict.margin }, oscillation }
}
