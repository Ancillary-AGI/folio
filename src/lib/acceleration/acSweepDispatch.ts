/**
 * AC sweep dispatch: every frequency point is an independent complex MNA solve
 * once the bias is fixed, so the points can be split across a worker pool.
 *
 * The bias solve, the frequency grid and the waveform assembly stay on the main
 * thread. Workers receive that shared preparation and return the phasors for
 * their slice; the main thread assembles the points in sweep order. That keeps
 * the pooled response identical to the in-thread sweep — same bias, same points,
 * same order — rather than merely similar. The accelerator is a latency and
 * responsiveness choice, never a different analysis.
 */

/* Vite's `?worker` import suffix is not portable; the standard
 * `new Worker(new URL(...))` form is understood by webpack 5 and Vite. */
const createAcSweepWorker = () =>
  new Worker(new URL('./acSweepWorker', import.meta.url), { type: 'module' })
import type { AcSweepWorkerResponse } from './acSweepWorker'
import { chunkIndices } from './chunkIndices'
import type { CircuitModel } from '../simulation/circuitModel'
import {
  assembleAcSweep,
  prepareAcSweep,
  solveAcFrequencyPoints,
  type AcBias,
  type AcFrequencyPoint,
  type AcSweepOptions,
  type AnalysisOutcome,
} from '../simulation/solver'

export type AcSweepAccelerator = 'worker' | 'main-thread'

export interface AcSweepDispatchOptions extends AcSweepOptions {
  /** `auto` uses the Worker pool when the environment and point count justify it. */
  prefer?: 'auto' | AcSweepAccelerator
  /** Upper bound on threads; the pool never exceeds the point count. */
  maxWorkers?: number
  /** Test seam: a Worker-compatible factory instead of the bundled worker. */
  createWorker?: () => Worker
}

export interface AcSweepSolveOutcome {
  result: AnalysisOutcome
  /**
   * The path that produced the result. `main-thread` also covers refusals and
   * fallback after a worker fault.
   */
  accelerator: AcSweepAccelerator
  /** Threads actually used; 0 on the in-thread path. */
  workers: number
  durationMs: number
}

/** Below this many points, worker startup costs more than it can hide. */
const MIN_PARALLEL_POINTS = 64
/** A worker that never answers must not hang the analysis forever. */
const WORKER_TIMEOUT_MS = 300_000
const MAX_WORKERS = 4

/**
 * How many threads a sweep of this size would use on this machine.
 * Zero means the sweep stays in-thread.
 */
export function defaultAcSweepWorkerCount(points: number): number {
  if (!Number.isFinite(points) || points < MIN_PARALLEL_POINTS) return 0
  const cores =
    typeof navigator !== 'undefined' && Number.isFinite(navigator.hardwareConcurrency)
      ? navigator.hardwareConcurrency
      : 4
  const byCores = Math.max(1, Math.floor(cores / 2))
  const byPoints = Math.max(1, Math.floor(points / 16))
  return Math.min(MAX_WORKERS, byCores, byPoints)
}

async function runWorkerPool(
  model: CircuitModel,
  frequencies: readonly number[],
  bias: AcBias,
  gmin: number | undefined,
  workerCount: number,
  createWorker?: () => Worker,
): Promise<AcFrequencyPoint[]> {
  const chunks = chunkIndices(frequencies.length, workerCount)
  const workers: Worker[] = []
  const timers: ReturnType<typeof setTimeout>[] = []
  try {
    const pending = chunks.map(
      (indices) =>
        new Promise<AcSweepWorkerResponse>((resolve, reject) => {
          const worker = createWorker ? createWorker() : createAcSweepWorker()
          workers.push(worker)
          const timeout = setTimeout(
            () => reject(new Error('An AC sweep worker did not finish within 300 s.')),
            WORKER_TIMEOUT_MS,
          )
          timers.push(timeout)
          const settle = (action: () => void): void => {
            clearTimeout(timeout)
            action()
          }
          worker.onmessage = (event: MessageEvent<AcSweepWorkerResponse>) =>
            settle(() => resolve(event.data))
          worker.onerror = (event) =>
            settle(() => reject(new Error(event.message || 'AC sweep worker failed')))
          worker.postMessage({
            model,
            frequencies: indices.map((index) => frequencies[index]),
            bias,
            gmin,
          })
        }),
    )

    const responses = await Promise.all(pending)
    const points = new Array<AcFrequencyPoint>(frequencies.length)
    responses.forEach((response, batchIndex) => {
      if (!response.ok) throw new Error(response.error)
      const indices = chunks[batchIndex]
      if (response.points.length !== indices.length) {
        throw new Error(
          `An AC sweep worker returned ${response.points.length} point(s) for ${indices.length} frequency(s).`,
        )
      }
      response.points.forEach((point, offset) => {
        const pointIndex = indices[offset]
        if (point.frequency !== frequencies[pointIndex]) {
          throw new Error('An AC sweep worker returned points out of order.')
        }
        points[pointIndex] = point
      })
    })
    return points
  } finally {
    for (const timer of timers) clearTimeout(timer)
    for (const worker of workers) worker.terminate()
  }
}

/** Run the sweep on the fastest available path. */
export async function runAcSweepAsync(
  model: CircuitModel,
  options: AcSweepDispatchOptions,
): Promise<AcSweepSolveOutcome> {
  const started = performance.now()
  const prepared = prepareAcSweep(model, options)
  if (!prepared.ok) {
    return {
      result: prepared.outcome,
      accelerator: 'main-thread',
      workers: 0,
      durationMs: performance.now() - started,
    }
  }

  const prefer = options.prefer ?? 'auto'
  const workerReady = options.createWorker !== undefined || typeof Worker !== 'undefined'
  const requestedWorkers = Math.min(
    defaultAcSweepWorkerCount(prepared.frequencies.length),
    options.maxWorkers ?? Number.POSITIVE_INFINITY,
  )
  const workerCount = Math.max(0, Math.min(Math.floor(requestedWorkers), prepared.frequencies.length))

  if (prefer !== 'main-thread' && workerReady && workerCount >= 1) {
    try {
      const points = await runWorkerPool(
        model,
        prepared.frequencies,
        prepared.bias,
        options.gmin,
        workerCount,
        options.createWorker,
      )
      const result = assembleAcSweep(model, points, [...prepared.notes], prepared.iterations)
      result.notes.push(
        `Solved ${prepared.frequencies.length} frequency points off the main thread on ${workerCount} worker(s); ` +
          'every point was linearised about the same bias and assembled in sweep order, so the response is ' +
          'identical to the in-thread sweep.',
      )
      return {
        result,
        accelerator: 'worker',
        workers: workerCount,
        durationMs: performance.now() - started,
      }
    } catch {
      // A worker fault must not become a missing plot. The in-thread sweep is
      // the reference path: it produces the same points and reports any genuine
      // solver error to the caller.
    }
  }

  const points = solveAcFrequencyPoints(model, prepared.frequencies, prepared.bias, options.gmin)
  return {
    result: assembleAcSweep(model, points, [...prepared.notes], prepared.iterations),
    accelerator: 'main-thread',
    workers: 0,
    durationMs: performance.now() - started,
  }
}
