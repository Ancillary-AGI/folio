/**
 * Monte Carlo dispatch: in-thread sweep or a pool of workers.
 *
 * A tolerance sweep is a set of independent runs, so it parallelises without
 * touching the numerics. Two properties keep the pooled answer trustworthy:
 *
 *  - every run derives its own seed from the sweep seed and its run index, so
 *    the pool draws exactly the values the in-thread loop would have drawn;
 *  - the main thread accumulates the returned samples in run-index order, so
 *    the Welford update sequence is unchanged.
 *
 * Together they make the pooled result identical to the in-thread result, not
 * merely statistically similar. The accelerator is a latency/responsiveness
 * choice, never a different analysis.
 */

import MonteCarloWorker from './monteCarloWorker?worker'
import type { MonteCarloWorkerResponse } from './monteCarloWorker'
import { chunkIndices } from './chunkIndices'
import {
  MonteCarloAccumulator,
  planMonteCarlo,
  runMonteCarlo,
  type MonteCarloOptions,
  type MonteCarloPlan,
  type MonteCarloResult,
  type MonteCarloRunSample,
} from '../simulation/monteCarlo'
import type { CircuitModel } from '../simulation/circuitModel'
import type { AnalysisOutcome } from '../simulation/solver'
import type { SimulationParameters } from '../simulation/spiceEngine'

export type MonteCarloAccelerator = 'worker' | 'main-thread'

export interface MonteCarloDispatchOptions extends MonteCarloOptions {
  /** `auto` uses the Worker pool when the environment and sweep size justify it. */
  prefer?: 'auto' | MonteCarloAccelerator
  /** Upper bound on threads; the pool never exceeds the run count. */
  maxWorkers?: number
  /** Test seam: a Worker-compatible factory instead of the bundled worker. */
  createWorker?: () => Worker
}

export interface MonteCarloSolveOutcome {
  result: MonteCarloResult
  /**
   * The path that produced the result. `main-thread` also covers validation
   * failures and fallback after a worker fault.
   */
  accelerator: MonteCarloAccelerator
  /** Threads actually used; 0 on the in-thread path. */
  workers: number
  durationMs: number
}

/** Below this many runs, worker startup costs more than it can hide. */
const MIN_PARALLEL_RUNS = 32
/** A worker that never answers must not hang the analysis forever. */
const WORKER_TIMEOUT_MS = 300_000
const MAX_WORKERS = 4

/**
 * How many threads a sweep of this size would use on this machine.
 * Zero means the sweep stays in-thread.
 */
export function defaultMonteCarloWorkerCount(iterations: number): number {
  if (!Number.isFinite(iterations) || iterations < MIN_PARALLEL_RUNS) return 0
  const cores =
    typeof navigator !== 'undefined' && Number.isFinite(navigator.hardwareConcurrency)
      ? navigator.hardwareConcurrency
      : 4
  const byCores = Math.max(1, Math.floor(cores / 2))
  const byRuns = Math.max(1, Math.floor(iterations / 8))
  return Math.min(MAX_WORKERS, byCores, byRuns)
}

/** Split run indices into contiguous, near-equal batches. */
export function chunkMonteCarloRuns(total: number, chunks: number): number[][] {
  return chunkIndices(total, chunks)
}

async function runWorkerPool(
  model: CircuitModel,
  analysis: SimulationParameters,
  plan: MonteCarloPlan,
  workerCount: number,
  createWorker?: () => Worker,
): Promise<MonteCarloRunSample[]> {
  const chunks = chunkMonteCarloRuns(plan.iterations, workerCount)
  const workers: Worker[] = []
  const timers: ReturnType<typeof setTimeout>[] = []
  try {
    const pending = chunks.map(
      (runIndices) =>
        new Promise<MonteCarloWorkerResponse>((resolve, reject) => {
          const worker = createWorker ? createWorker() : new MonteCarloWorker()
          workers.push(worker)
          const timeout = setTimeout(
            () => reject(new Error('A Monte Carlo worker did not finish within 300 s.')),
            WORKER_TIMEOUT_MS,
          )
          timers.push(timeout)
          const settle = (action: () => void): void => {
            clearTimeout(timeout)
            action()
          }
          worker.onmessage = (event: MessageEvent<MonteCarloWorkerResponse>) =>
            settle(() => resolve(event.data))
          worker.onerror = (event) =>
            settle(() => reject(new Error(event.message || 'Monte Carlo worker failed')))
          worker.postMessage({
            model,
            analysis,
            runIndices,
            tolerance: plan.tolerance,
            distribution: plan.distribution,
            seed: plan.seed,
          })
        }),
    )

    const responses = await Promise.all(pending)
    const samples = new Array<MonteCarloRunSample>(plan.iterations)
    responses.forEach((response, batchIndex) => {
      if (!response.ok) throw new Error(response.error)
      const runIndices = chunks[batchIndex]
      if (response.samples.length !== runIndices.length) {
        throw new Error(
          `A Monte Carlo worker returned ${response.samples.length} sample(s) for ${runIndices.length} run(s).`,
        )
      }
      response.samples.forEach((sample, index) => {
        samples[runIndices[index]] = sample
      })
    })
    return samples
  } finally {
    for (const timer of timers) clearTimeout(timer)
    for (const worker of workers) worker.terminate()
  }
}

/**
 * Run the sweep on the fastest available path.
 *
 * @param run the in-thread simulator for one perturbed model. It is used
 *            verbatim whenever the worker pool is unavailable, too small to
 *            justify itself, or fails.
 */
export async function runMonteCarloAsync(
  model: CircuitModel,
  analysis: SimulationParameters,
  run: (perturbed: CircuitModel) => AnalysisOutcome,
  options: MonteCarloDispatchOptions = {},
): Promise<MonteCarloSolveOutcome> {
  const started = performance.now()
  const planned = planMonteCarlo(options)
  if (!planned.ok) {
    return {
      result: planned.result,
      accelerator: 'main-thread',
      workers: 0,
      durationMs: performance.now() - started,
    }
  }
  const { plan } = planned
  const prefer = options.prefer ?? 'auto'
  const workerReady = options.createWorker !== undefined || typeof Worker !== 'undefined'
  const requestedWorkers = Math.min(
    defaultMonteCarloWorkerCount(plan.iterations),
    options.maxWorkers ?? Number.POSITIVE_INFINITY,
  )
  const workerCount = Math.max(0, Math.min(Math.floor(requestedWorkers), plan.iterations))

  if (prefer !== 'main-thread' && workerReady && workerCount >= 1) {
    try {
      const samples = await runWorkerPool(model, analysis, plan, workerCount, options.createWorker)
      const accumulator = new MonteCarloAccumulator(plan.notes)
      for (let runIndex = 0; runIndex < samples.length; runIndex += 1) {
        const sample = samples[runIndex]
        if (!sample) throw new Error(`The worker pool returned no sample for run ${runIndex + 1}.`)
        if (!accumulator.add(runIndex, sample)) break
      }
      const result = accumulator.finish()
      result.notes.push(
        `Swept off the main thread on ${workerCount} worker(s); the seeded runs and accumulation order are ` +
          'the same as the in-thread sweep, so the statistics are identical.',
      )
      return {
        result,
        accelerator: 'worker',
        workers: workerCount,
        durationMs: performance.now() - started,
      }
    } catch {
      // A worker fault must not become a missing analysis. The in-thread sweep
      // is the reference path: it produces the same samples and reports any
      // genuine solver error to the caller.
    }
  }

  const result = runMonteCarlo(model, run, options)
  return {
    result,
    accelerator: 'main-thread',
    workers: 0,
    durationMs: performance.now() - started,
  }
}
