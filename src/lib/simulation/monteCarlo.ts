/**
 * Monte Carlo tolerance analysis.
 *
 * Re-solves the circuit with component values perturbed by a tolerance band and
 * reports the mean and the ±3σ envelope of every signal. This is a real sweep:
 * every sample runs the same solver as a nominal simulation, so the spread
 * reflects the actual circuit rather than an assumed noise model.
 *
 * Reproducibility is enforced with a seeded PRNG — the same netlist, run count
 * and seed always yield the same distribution, which is what makes a Monte Carlo
 * result reviewable and regression-testable. Each run derives its own seed from
 * the sweep seed and the run index, so a run can execute on any thread without
 * changing which values it draws; the accumulator then merges runs in index
 * order, which is what lets a worker-pool sweep reproduce the in-thread result
 * exactly.
 *
 * Statistics use a one-pass Welford accumulator per point, so the sweep is
 * O(samples × points) in time and O(signals × points) in memory instead of
 * retaining every sample, without the cancellation of a raw-moment update.
 */

import { createSeededRandom, gaussianFrom } from './numeric'
import type { CircuitModel } from './circuitModel'
import type { Device } from './devices'
import type { AnalysisOutcome, Waveform } from './solver'

export interface MonteCarloOptions {
  /** Number of perturbed runs. Capped to keep the main thread responsive. */
  iterations?: number
  /** Fractional tolerance applied to R, C and L (e.g. 0.05 = ±5 %). */
  tolerance?: number
  /** Seed for the PRNG; identical seeds reproduce identical sweeps. */
  seed?: number
  /** Distribution of the perturbation. Gaussian is truncated at ±3σ. */
  distribution?: 'gaussian' | 'uniform'
}

export const DEFAULT_MONTE_CARLO_SEED = 20260101
export const MAX_MONTE_CARLO_ITERATIONS = 500

/**
 * Seed for one run, derived from the sweep seed and the run index.
 *
 * A per-run seed makes a run self-contained: a worker can execute any subset of
 * the sweep and draw exactly the values the in-thread loop would have drawn,
 * independent of scheduling and of which thread ran it.
 */
export function deriveMonteCarloRunSeed(seed: number, runIndex: number): number {
  let hash = (seed >>> 0) ^ Math.imul(runIndex + 1, 0x9e3779b1)
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b)
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35)
  return (hash ^ (hash >>> 16)) >>> 0
}

/** Devices whose values carry a manufacturing tolerance. */
const TOLERANCED_KINDS: ReadonlySet<Device['kind']> = new Set<Device['kind']>([
  'resistor',
  'capacitor',
  'inductor',
])

/**
 * Return a copy of `model` with toleranced component values perturbed.
 *
 * Source values are deliberately *not* perturbed: a supply rail's accuracy is a
 * separate specification from passive tolerance, and mixing the two hides which
 * one dominates the spread.
 */
export function perturbCircuitModel(
  model: CircuitModel,
  random: () => number,
  tolerance: number,
  distribution: 'gaussian' | 'uniform',
): CircuitModel {
  const offset = (): number => {
    if (distribution === 'uniform') return (random() * 2 - 1) * tolerance
    // Truncate the Gaussian tail at ±3σ: beyond that a "tolerance" is meaningless.
    return Math.max(-3, Math.min(3, gaussianFrom(random))) * tolerance
  }

  const devices = model.devices.map<Device>((device) => {
    if (!TOLERANCED_KINDS.has(device.kind)) return device
    const factor = 1 + offset()
    switch (device.kind) {
      case 'resistor':
        return { ...device, resistance: device.resistance * factor }
      case 'capacitor':
        return { ...device, capacitance: device.capacitance * factor }
      case 'inductor':
        return { ...device, inductance: device.inductance * factor }
      default:
        return device
    }
  })

  return { ...model, devices }
}

/** One named signal sampled on a grid. */
interface SampledSignal {
  unit: string
  points: number[]
  x: number[]
}

/**
 * Normalise an analysis outcome into `name → samples`.
 * Operating-point results become single-sample series, so a DC sweep travels
 * through exactly the same machinery as transient and AC. Node-style
 * operating points (voltages on `nodes`/`operatingPoint`) are folded in as
 * single-point `V(name)` signals — otherwise a DC tolerance sweep would
 * sample nothing and the envelope would be empty.
 */
export function sampleOutcome(outcome: AnalysisOutcome): Map<string, SampledSignal> {
  const signals = new Map<string, SampledSignal>()

  for (const waveform of outcome.waveforms) {
    signals.set(waveform.name, {
      unit: waveform.unit,
      points: waveform.data.map((point) => point.y),
      x: waveform.data.map((point) => point.x),
    })
  }

  /* A node without a solved voltage is omitted, never defaulted to 0 V: a
   * fabricated ground would silently drag the mean and inflate the spread. */
  const operatingPoint = (outcome.operatingPoint ?? {}) as Record<string, number>
  for (const node of outcome.nodes ?? []) {
    const voltage = node.voltage ?? operatingPoint[node.name]
    if (typeof voltage !== 'number' || !Number.isFinite(voltage)) continue
    signals.set(`V(${node.name})`, { unit: 'V', points: [voltage], x: [0] })
  }
  for (const [name, voltage] of Object.entries(operatingPoint)) {
    if (typeof voltage !== 'number' || !Number.isFinite(voltage)) continue
    if (!signals.has(`V(${name})`)) signals.set(`V(${name})`, { unit: 'V', points: [voltage], x: [0] })
  }

  return signals
}

export interface MonteCarloResult extends AnalysisOutcome {
  /** Number of samples that contributed to the statistics. */
  iterations: number
}

/** A validated sweep description, shared by every execution path. */
export interface MonteCarloPlan {
  iterations: number
  tolerance: number
  seed: number
  distribution: 'gaussian' | 'uniform'
  /** Opening note; the accumulator appends what each run revealed. */
  notes: string[]
}

export type MonteCarloPlanResult =
  | { ok: true; plan: MonteCarloPlan }
  | { ok: false; result: MonteCarloResult }

const rejectMonteCarlo = (reason: string): MonteCarloResult => ({
  nodes: [],
  waveforms: [],
  iterations: 0,
  converged: false,
  notes: [`Monte Carlo: ${reason}`],
})

/**
 * Validate a request and fix the run count once.
 *
 * Every path goes through this function, so an invalid sweep is rejected with
 * the same message — and the same cap — whether it runs in-thread or across a
 * worker pool.
 */
export function planMonteCarlo(options: MonteCarloOptions = {}): MonteCarloPlanResult {
  const seed = options.seed ?? DEFAULT_MONTE_CARLO_SEED
  const requestedIterations = options.iterations ?? 100
  const tolerance = options.tolerance ?? 0.05
  const distribution = options.distribution ?? 'gaussian'

  if (!Number.isFinite(requestedIterations)) {
    return { ok: false, result: rejectMonteCarlo(`iteration count must be finite, got ${requestedIterations}.`) }
  }
  /*
   * A tolerance of 1 or more lets a component reach zero or change sign, which
   * is not a manufacturing spread but a different (non-physical) circuit. Keep
   * the band strictly inside ±100 %.
   */
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance >= 1) {
    return { ok: false, result: rejectMonteCarlo(`tolerance must be finite and in [0, 1), got ${tolerance}.`) }
  }
  if (!Number.isFinite(seed)) {
    return { ok: false, result: rejectMonteCarlo(`seed must be finite, got ${seed}.`) }
  }
  if (distribution !== 'gaussian' && distribution !== 'uniform') {
    return {
      ok: false,
      result: rejectMonteCarlo(`distribution must be "gaussian" or "uniform", got "${String(distribution)}".`),
    }
  }
  const iterations = Math.min(Math.max(1, Math.floor(requestedIterations)), MAX_MONTE_CARLO_ITERATIONS)

  return {
    ok: true,
    plan: {
      iterations,
      tolerance,
      distribution,
      seed,
      notes: [
        `Monte Carlo: ${iterations} runs, ±${(tolerance * 100).toFixed(2)} % ${distribution} tolerance on R/C/L, ` +
          `seed ${seed}.`,
      ],
    },
  }
}

/** One signal reduced to the numbers the statistics need. */
export interface MonteCarloSignalSample {
  name: string
  unit: string
  points: number[]
  x: number[]
}

/** One run reduced to sampled signals; clone-safe, so a worker can return it. */
export interface MonteCarloRunSample {
  converged: boolean
  /** Solver notes for the run, e.g. why it did not converge. */
  notes: string[]
  signals: MonteCarloSignalSample[]
}

/** Normalise an outcome into a sample that can cross a worker boundary. */
export function sampleRun(outcome: AnalysisOutcome): MonteCarloRunSample {
  return {
    converged: outcome.converged,
    notes: outcome.notes,
    signals: [...sampleOutcome(outcome)].map(([name, signal]) => ({ name, ...signal })),
  }
}

/**
 * Welford accumulation shared by the in-thread and worker-pool sweeps.
 *
 * Samples must be added in run-index order. Floating-point addition is not
 * associative, so feeding the same runs in the same order is what makes a
 * pooled result *identical* to the sequential one rather than merely close.
 */
export class MonteCarloAccumulator {
  private readonly notes: string[]
  private signalNames: string[] = []
  private units = new Map<string, string>()
  private xGrid: number[] = []
  private means: number[][] = []
  private m2: number[][] = []
  private completed = 0
  private skippedRuns = 0
  private converged = true

  constructor(notes: string[]) {
    this.notes = [...notes]
  }

  /** @returns false when the sweep must stop: the run produced no signals. */
  add(runIndex: number, sample: MonteCarloRunSample): boolean {
    if (!sample.converged) {
      this.converged = false
      this.notes.push(`Run ${runIndex + 1} did not converge and was excluded from the statistics.`)
      return true
    }
    if (sample.signals.length === 0) {
      this.notes.push('The selected analysis produced no signals to sample.')
      return false
    }

    if (this.signalNames.length === 0) {
      this.signalNames = sample.signals.map((signal) => signal.name)
      this.units = new Map(sample.signals.map((signal) => [signal.name, signal.unit]))
      this.xGrid = [...(sample.signals[0]?.x ?? [])]
      this.means = this.signalNames.map(() => new Array<number>(this.xGrid.length).fill(0))
      this.m2 = this.signalNames.map(() => new Array<number>(this.xGrid.length).fill(0))
    }

    /*
     * A sample only contributes if *every* signal is present on the identical
     * grid. Accumulating the signals that happen to match and dividing them all
     * by one run count would silently bias the mean and σ of the missing ones.
     */
    const byName = new Map(sample.signals.map((signal) => [signal.name, signal]))
    const complete = this.signalNames.every((name) => {
      const signal = byName.get(name)
      if (!signal || signal.points.length !== this.xGrid.length || signal.x.length !== this.xGrid.length) {
        return false
      }
      return signal.x.every((value, index) => value === this.xGrid[index])
    })
    if (!complete) {
      this.skippedRuns += 1
      return true
    }

    this.completed += 1
    /* Welford: one pass, O(1) state per point, and no E[x²] − E[x]²
     * cancellation when a large DC offset carries a small spread. */
    this.signalNames.forEach((name, signalIndex) => {
      const signal = byName.get(name)
      if (!signal) return
      signal.points.forEach((value, pointIndex) => {
        const delta = value - this.means[signalIndex][pointIndex]
        this.means[signalIndex][pointIndex] += delta / this.completed
        this.m2[signalIndex][pointIndex] += delta * (value - this.means[signalIndex][pointIndex])
      })
    })
    return true
  }

  finish(): MonteCarloResult {
    if (this.skippedRuns > 0) {
      this.notes.push(
        `${this.skippedRuns} run(s) were excluded because a signal was missing or its sample grid differed from the nominal run.`,
      )
    }

    if (this.completed === 0) {
      return {
        nodes: [],
        waveforms: [],
        iterations: 0,
        converged: false,
        notes: [...this.notes, 'No usable Monte Carlo samples were produced.'],
      }
    }

    const waveforms: Waveform[] = []
    this.signalNames.forEach((name, signalIndex) => {
      const unit = this.units.get(name) ?? 'V'
      const mean: Array<{ x: number; y: number }> = []
      const plusThreeSigma: Array<{ x: number; y: number }> = []
      const minusThreeSigma: Array<{ x: number; y: number }> = []

      for (let pointIndex = 0; pointIndex < this.xGrid.length; pointIndex += 1) {
        const x = this.xGrid[pointIndex]
        const meanValue = this.means[signalIndex][pointIndex]
        // Sample variance from the Welford accumulator, floored to absorb round-off.
        const variance = Math.max(0, this.m2[signalIndex][pointIndex] / this.completed)
        const sigma = Math.sqrt(variance)
        mean.push({ x, y: meanValue })
        plusThreeSigma.push({ x, y: meanValue + 3 * sigma })
        minusThreeSigma.push({ x, y: meanValue - 3 * sigma })
      }

      waveforms.push({ name: `${name} mean`, type: 'voltage', unit, data: mean })
      waveforms.push({ name: `${name} mean +3σ`, type: 'voltage', unit, data: plusThreeSigma })
      waveforms.push({ name: `${name} mean −3σ`, type: 'voltage', unit, data: minusThreeSigma })
    })

    this.notes.push(`Statistics from ${this.completed} converged run(s). Envelope shown is mean ± 3σ at each point.`)

    return { nodes: [], waveforms, iterations: this.completed, converged: this.converged, notes: this.notes }
  }
}

/**
 * Run `options.iterations` perturbed solves and summarise the spread.
 *
 * @param run simulates one (possibly perturbed) model. Pass the analysis the
 *            user selected, so a tolerance sweep of a transient stays a
 *            transient sweep.
 */
export function runMonteCarlo(
  model: CircuitModel,
  run: (perturbed: CircuitModel) => AnalysisOutcome,
  options: MonteCarloOptions = {},
): MonteCarloResult {
  const planned = planMonteCarlo(options)
  if (!planned.ok) return planned.result

  const { iterations, tolerance, distribution, seed, notes } = planned.plan
  const accumulator = new MonteCarloAccumulator(notes)
  for (let runIndex = 0; runIndex < iterations; runIndex += 1) {
    const random = createSeededRandom(deriveMonteCarloRunSeed(seed, runIndex))
    const perturbed = perturbCircuitModel(model, random, tolerance, distribution)
    if (!accumulator.add(runIndex, sampleRun(run(perturbed)))) break
  }
  return accumulator.finish()
}
