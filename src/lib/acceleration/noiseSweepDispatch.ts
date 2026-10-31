/**
 * Noise sweep dispatch: once the bias and source densities are fixed, every
 * frequency is an independent adjoint solve, so the points can be split across
 * a worker pool.
 *
 * The bias solve and the frequency grid stay on the main thread. Workers get
 * that shared plan and return their slice; the main thread assembles in sweep
 * order with netlist-ordered contributions. The pooled spectrum is therefore
 * identical to the in-thread one, not merely close, and a worker fault falls
 * back to the in-thread path.
 */

import NoiseSweepWorker from './noiseSweepWorker?worker'
import type { NoiseSweepWorkerResponse } from './noiseSweepWorker'
import { chunkIndices } from './chunkIndices'
import type { CircuitModel } from '../simulation/circuitModel'
import {
  assembleNoiseAnalysis,
  prepareNoiseAnalysis,
  solveNoiseFrequencyPoints,
  type NoiseOptions,
  type NoisePlan,
  type NoisePoint,
  type NoiseResult,
} from '../simulation/noise'

export type NoiseSweepAccelerator = 'worker' | 'main-thread'

export interface NoiseSweepDispatchOptions extends NoiseOptions {
  /** `auto` uses the Worker pool when the environment and point count justify it. */
  prefer?: 'auto' | NoiseSweepAccelerator
  /** Upper bound on threads; the pool never exceeds the point count. */
  maxWorkers?: number
  /** Test seam: a Worker-compatible factory instead of the bundled worker. */
  createWorker?: () => Worker
}

export interface NoiseSweepSolveOutcome {
  result: NoiseResult
  /**
   * The path that produced the result. `main-thread` also covers refusals and
   * fallback after a worker fault.
   */
  accelerator: NoiseSweepAccelerator
  /** Threads actually used; 0 on the in-thread path. */
  workers: number
  durationMs: number
}

/** Below this many points, worker startup costs more than it can hide. */
const MIN_PARALLEL_POINTS = 32
/** A worker that never answers must not hang the analysis forever. */
const WORKER_TIMEOUT_MS = 300_000
const MAX_WORKERS = 4

/**
 * How many threads a sweep of this size would use on this machine.
 * Zero means the sweep stays in-thread.
 */
export function defaultNoiseWorkerCount(points: number): number {
  if (!Number.isFinite(points) || points < MIN_PARALLEL_POINTS) return 0
  const cores =
    typeof navigator !== 'undefined' && Number.isFinite(navigator.hardwareConcurrency)
      ? navigator.hardwareConcurrency
      : 4
  const byCores = Math.max(1, Math.floor(cores / 2))
  const byPoints = Math.max(1, Math.floor(points / 8))
  return Math.min(MAX_WORKERS, byCores, byPoints)
}

async function runWorkerPool(
  model: CircuitModel,
  plan: NoisePlan,
  gmin: number | undefined,
  workerCount: number,
  createWorker?: () => Worker,
): Promise<NoisePoint[]> {
  const chunks = chunkIndices(plan.frequencies.length, workerCount)
  const workers: Worker[] = []
  const timers: ReturnType<typeof setTimeout>[] = []
  try {
    const pending = chunks.map(
      (indices) =>
        new Promise<NoiseSweepWorkerResponse>((resolve, reject) => {
          const worker = createWorker ? createWorker() : new NoiseSweepWorker()
          workers.push(worker)
          const timeout = setTimeout(
            () => reject(new Error('A noise sweep worker did not finish within 300 s.')),
            WORKER_TIMEOUT_MS,
          )
          timers.push(timeout)
          const settle = (action: () => void): void => {
            clearTimeout(timeout)
            action()
          }
          worker.onmessage = (event: MessageEvent<NoiseSweepWorkerResponse>) =>
            settle(() => resolve(event.data))
          worker.onerror = (event) =>
            settle(() => reject(new Error(event.message || 'noise sweep worker failed')))
          worker.postMessage({
            model,
            frequencies: indices.map((index) => plan.frequencies[index]),
            bias: plan.bias,
            outputIndex: plan.outputIndex,
            gmin,
          })
        }),
    )

    const responses = await Promise.all(pending)
    const points = new Array<NoisePoint>(plan.frequencies.length)
    responses.forEach((response, batchIndex) => {
      if (!response.ok) throw new Error(response.error)
      const indices = chunks[batchIndex]
      if (response.points.length !== indices.length) {
        throw new Error(
          `A noise sweep worker returned ${response.points.length} point(s) for ${indices.length} frequency(s).`,
        )
      }
      response.points.forEach((point, offset) => {
        const pointIndex = indices[offset]
        if (point.frequency !== plan.frequencies[pointIndex]) {
          throw new Error('A noise sweep worker returned points out of order.')
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
export async function runNoiseSweepAsync(
  model: CircuitModel,
  options: NoiseSweepDispatchOptions,
): Promise<NoiseSweepSolveOutcome> {
  const started = performance.now()
  const prepared = prepareNoiseAnalysis(model, options)
  if (!prepared.ok) {
    return {
      result: prepared.result,
      accelerator: 'main-thread',
      workers: 0,
      durationMs: performance.now() - started,
    }
  }
  const { plan } = prepared
  const prefer = options.prefer ?? 'auto'
  const workerReady = options.createWorker !== undefined || typeof Worker !== 'undefined'
  const requestedWorkers = Math.min(
    defaultNoiseWorkerCount(plan.frequencies.length),
    options.maxWorkers ?? Number.POSITIVE_INFINITY,
  )
  const workerCount = Math.max(0, Math.min(Math.floor(requestedWorkers), plan.frequencies.length))

  if (prefer !== 'main-thread' && workerReady && workerCount >= 1) {
    try {
      const points = await runWorkerPool(model, plan, options.gmin, workerCount, options.createWorker)
      const result = assembleNoiseAnalysis(plan, points)
      result.notes.push(
        `Solved ${plan.frequencies.length} noise frequencies off the main thread on ${workerCount} worker(s); ` +
          'every frequency used the same bias and source densities and was assembled in sweep order, so the ' +
          'spectrum is identical to the in-thread sweep.',
      )
      return {
        result,
        accelerator: 'worker',
        workers: workerCount,
        durationMs: performance.now() - started,
      }
    } catch {
      // A worker fault must not become a missing spectrum. The in-thread sweep
      // is the reference path: it produces the same points and reports any
      // genuine solver error to the caller.
    }
  }

  const points = solveNoiseFrequencyPoints(
    model,
    plan.frequencies,
    plan.bias,
    plan.outputIndex,
    options.gmin,
  )
  return {
    result: assembleNoiseAnalysis(plan, points),
    accelerator: 'main-thread',
    workers: 0,
    durationMs: performance.now() - started,
  }
}
