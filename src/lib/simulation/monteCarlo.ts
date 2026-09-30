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
 * result reviewable and regression-testable.
 *
 * Statistics use raw moments (Σx and Σx²) accumulated in one pass, so the sweep
 * is O(samples × points) in time and O(signals × points) in memory instead of
 * retaining every sample.
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
 * through exactly the same machinery as transient and AC.
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

  if (signals.size === 0 && outcome.nodes.length > 0) {
    for (const node of outcome.nodes) {
      signals.set(`V(${node.name})`, { unit: 'V', points: [node.voltage ?? 0], x: [0] })
    }
  }

  return signals
}

export interface MonteCarloResult extends AnalysisOutcome {
  /** Number of samples that contributed to the statistics. */
  iterations: number
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
  const seed = options.seed ?? DEFAULT_MONTE_CARLO_SEED
  const iterations = Math.min(Math.max(1, Math.floor(options.iterations ?? 100)), MAX_MONTE_CARLO_ITERATIONS)
  const tolerance = options.tolerance ?? 0.05
  const distribution = options.distribution ?? 'gaussian'
  const random = createSeededRandom(seed)

  const notes: string[] = [
    `Monte Carlo: ${iterations} runs, ±${(tolerance * 100).toFixed(2)} % ${distribution} tolerance on R/C/L, ` +
      `seed ${seed}.`,
  ]

  let signalNames: string[] = []
  let units = new Map<string, string>()
  let xGrid: number[] = []
  let sums: number[][] = []
  let sumSquares: number[][] = []
  let completed = 0
  let converged = true

  for (let runIndex = 0; runIndex < iterations; runIndex += 1) {
    const perturbed = perturbCircuitModel(model, random, tolerance, distribution)
    const outcome = run(perturbed)
    if (!outcome.converged) {
      converged = false
      notes.push(`Run ${runIndex + 1} did not converge and was excluded from the statistics.`)
      continue
    }

    const sampled = sampleOutcome(outcome)
    if (sampled.size === 0) {
      notes.push('The selected analysis produced no signals to sample.')
      break
    }

    if (signalNames.length === 0) {
      signalNames = [...sampled.keys()]
      units = new Map([...sampled].map(([name, signal]) => [name, signal.unit]))
      xGrid = [...(sampled.values().next().value?.x ?? [])]
      sums = signalNames.map(() => new Array<number>(xGrid.length).fill(0))
      sumSquares = signalNames.map(() => new Array<number>(xGrid.length).fill(0))
    }

    let used = false
    signalNames.forEach((name, signalIndex) => {
      const signal = sampled.get(name)
      // A differing point count means the perturbed circuit changed the grid
      // (e.g. Newton bailed out early); skip that signal for this sample rather
      // than blending incomparable data.
      if (!signal || signal.points.length !== xGrid.length) return
      signal.points.forEach((value, pointIndex) => {
        sums[signalIndex][pointIndex] += value
        sumSquares[signalIndex][pointIndex] += value * value
      })
      used = true
    })
    if (used) completed += 1
  }

  if (completed === 0) {
    return {
      nodes: [],
      waveforms: [],
      iterations: 0,
      converged: false,
      notes: [...notes, 'No usable Monte Carlo samples were produced.'],
    }
  }

  const waveforms: Waveform[] = []
  signalNames.forEach((name, signalIndex) => {
    const unit = units.get(name) ?? 'V'
    const mean: Array<{ x: number; y: number }> = []
    const plusThreeSigma: Array<{ x: number; y: number }> = []
    const minusThreeSigma: Array<{ x: number; y: number }> = []

    for (let pointIndex = 0; pointIndex < xGrid.length; pointIndex += 1) {
      const x = xGrid[pointIndex]
      const meanValue = sums[signalIndex][pointIndex] / completed
      // σ² = E[x²] − (E[x])² with a floor of 0 to absorb floating-point noise.
      const variance = Math.max(0, sumSquares[signalIndex][pointIndex] / completed - meanValue * meanValue)
      const sigma = Math.sqrt(variance)
      mean.push({ x, y: meanValue })
      plusThreeSigma.push({ x, y: meanValue + 3 * sigma })
      minusThreeSigma.push({ x, y: meanValue - 3 * sigma })
    }

    waveforms.push({ name: `${name} mean`, type: 'voltage', unit, data: mean })
    waveforms.push({ name: `${name} mean +3σ`, type: 'voltage', unit, data: plusThreeSigma })
    waveforms.push({ name: `${name} mean −3σ`, type: 'voltage', unit, data: minusThreeSigma })
  })

  notes.push(
    `Statistics from ${completed} converged run(s). Envelope shown is mean ± 3σ at each point.`,
  )

  return { nodes: [], waveforms, iterations: completed, converged, notes }
}
