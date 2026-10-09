/**
 * Bench correlation — the twin guarantee, mechanism not checklist (Giant 4).
 *
 * The onboarding text honestly said "correlate predictions against bench
 * measurements" with no mechanism behind it. This module is the mechanism:
 * a Monte Carlo tolerance envelope over the simulated circuit, bench
 * samples captured over WebSerial, and a verdict that stamps the project
 * "Verified" only when every measured point lands inside the predicted
 * envelope. Anything else is a typed failure — never a passing stamp on
 * an uncorrelated board.
 */
import { runMonteCarlo, type MonteCarloResult } from './monteCarlo'
import type { CircuitModel } from './circuitModel'
import type { AnalysisOutcome } from './solver'

export interface EnvelopeBand {
  signal: string
  unit: string
  points: Array<{ x: number; low: number; high: number }>
}

export interface BenchSample {
  /** Signal name as emitted by the solver, e.g. `V(OUT)`. */
  signal: string
  x: number
  value: number
}

export interface SampleVerdict {
  sample: BenchSample
  inside: boolean
  /** Signed distance to the nearest band edge (≥ 0 inside, < 0 outside). */
  margin: number
}

export interface CorrelationVerdict {
  verified: boolean
  samples: SampleVerdict[]
  uncovered: string[]
  summary: string
}

const WAVEFORM_SUFFIX = / mean( ([+−]3σ|mean))?$/

const baseName = (waveformName: string): string => waveformName.replace(WAVEFORM_SUFFIX, '')

/**
 * Run the seeded tolerance sweep and fold the mean/±3σ waveforms into
 * per-signal low/high bands. `run` is the parent analysis applied to each
 * perturbed model — the same dispatch the engine uses.
 */
export function toleranceEnvelope(
  model: CircuitModel,
  run: (perturbed: CircuitModel) => AnalysisOutcome,
  options: { iterations?: number; tolerance?: number; seed?: number } = {},
): { bands: EnvelopeBand[]; sweep: MonteCarloResult } {
  const sweep = runMonteCarlo(model, run, {
    iterations: options.iterations ?? 100,
    tolerance: options.tolerance ?? 0.05,
    seed: options.seed ?? 20260101,
  })
  const bySignal = new Map<string, { unit: string; mean: Array<{ x: number; y: number }>; plus?: Array<{ x: number; y: number }>; minus?: Array<{ x: number; y: number }> }>()
  for (const waveform of sweep.waveforms) {
    const name = baseName(waveform.name)
    const entry = bySignal.get(name) ?? { unit: waveform.unit, mean: [] }
    entry.unit = waveform.unit
    if (waveform.name.endsWith('mean')) entry.mean = waveform.data
    else if (waveform.name.includes('+3σ')) entry.plus = waveform.data
    else if (waveform.name.includes('−3σ')) entry.minus = waveform.data
    bySignal.set(name, entry)
  }
  const bands: EnvelopeBand[] = []
  for (const [signal, entry] of bySignal) {
    if (entry.mean.length === 0 || !entry.plus || !entry.minus) continue
    bands.push({
      signal,
      unit: entry.unit,
      points: entry.mean.map((point, index) => ({
        x: point.x,
        low: entry.minus?.[index]?.y ?? point.y,
        high: entry.plus?.[index]?.y ?? point.y,
      })),
    })
  }
  return { bands, sweep }
}

/** Linear interpolation of the band at `x`; `undefined` outside the grid. */
function bandAt(band: EnvelopeBand, x: number): { low: number; high: number } | undefined {
  const points = band.points
  if (points.length === 0) return undefined
  if (points.length === 1) {
    return x === points[0].x ? { low: points[0].low, high: points[0].high } : undefined
  }
  if (x < points[0].x || x > points[points.length - 1].x) return undefined
  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1]
    const current = points[i]
    if (x >= previous.x && x <= current.x) {
      const span = current.x - previous.x
      const fraction = span === 0 ? 0 : (x - previous.x) / span
      return {
        low: previous.low + (current.low - previous.low) * fraction,
        high: previous.high + (current.high - previous.high) * fraction,
      }
    }
  }
  return undefined
}

/**
 * Compare bench samples against the predicted envelope. `verified` is true
 * only when every sample lands inside its signal's band — no averaging, no
 * waivers. Samples for signals with no band, or outside the simulated
 * grid, are reported in `uncovered` and fail the verdict.
 */
export function correlateBench(bands: EnvelopeBand[], samples: BenchSample[]): CorrelationVerdict {
  const bySignal = new Map(bands.map((band) => [band.signal, band]))
  const verdicts: SampleVerdict[] = []
  const uncovered: string[] = []
  for (const sample of samples) {
    const band = bySignal.get(sample.signal)
    if (!band) {
      uncovered.push(`${sample.signal}: no predicted band`)
      verdicts.push({ sample, inside: false, margin: Number.NEGATIVE_INFINITY })
      continue
    }
    const interpolated = bandAt(band, sample.x)
    if (!interpolated) {
      uncovered.push(`${sample.signal} at x=${sample.x}: outside simulated grid`)
      verdicts.push({ sample, inside: false, margin: Number.NEGATIVE_INFINITY })
      continue
    }
    const inside = sample.value >= interpolated.low && sample.value <= interpolated.high
    const margin = Math.min(sample.value - interpolated.low, interpolated.high - sample.value)
    verdicts.push({ sample, inside, margin })
  }
  const verified = samples.length > 0 && verdicts.every((verdict) => verdict.inside)
  const insideCount = verdicts.filter((verdict) => verdict.inside).length
  return {
    verified,
    samples: verdicts,
    uncovered,
    summary: verified
      ? `Verified: ${insideCount}/${samples.length} bench samples inside the predicted tolerance envelope.`
      : `Not verified: ${insideCount}/${samples.length} bench samples inside the envelope.`,
  }
}

