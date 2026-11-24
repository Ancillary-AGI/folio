/**
 * Getting a biology run off the main thread, with the answer unchanged.
 *
 * `solveBioRun` is the only implementation of the analysis: the worker entry calls
 * it in a worker, the fallback calls it here, and a test can call it directly. What
 * differs between the paths is which thread waits, never what comes back.
 *
 * The fallback is not a shortcut. A host without a working worker — a jsdom test, a
 * page whose worker failed to construct — still has to produce the same run, so it
 * pays the same synchronous cost the worker was meant to avoid. That is the honest
 * trade: the view asks for an answer, and this gives it the fastest way it can find
 * to get one.
 */
import type { BioRunRequest, BioRunResponse } from './bioRunWorker'

/* Vite's `?worker` import suffix is not portable; the standard
 * `new Worker(new URL(...))` form is understood by webpack 5 (asset modules),
 * Vite and the test runners. The worker spins per run and is terminated on
 * answer or cancel. */
const createBioRunWorker = () =>
  new Worker(new URL('./bioRunWorker', import.meta.url), { type: 'module' })
import { solveBioRun, type BioRunJob, type BioRunResult } from './bioRunCore'

export type BioRunAccelerator = 'worker' | 'main-thread'

export interface BioRunOutcome {
  /** `done` carries the result, `failed` the solver's own message, `cancelled` neither. */
  status: 'done' | 'failed' | 'cancelled'
  result: BioRunResult | null
  error: string | null
  accelerator: BioRunAccelerator
  durationMs: number
}

export interface BioRunHandle {
  /** Always settles; a solver refusal is a `failed` outcome, not a rejected promise. */
  promise: Promise<BioRunOutcome>
  /** Stop the run: a worker mid-job is terminated and the answer will not arrive. */
  cancel: () => void
}

export interface BioRunOptions {
  /** `auto` uses a worker whenever the host can construct one. */
  prefer?: 'auto' | BioRunAccelerator
  /** Test seam: a Worker-compatible factory instead of the bundled worker. */
  createWorker?: () => Worker
}

/** A worker that never answers must not strand the view on a pending run forever. */
const WORKER_WATCHDOG_MS = 300_000

const outcome = (
  status: BioRunOutcome['status'],
  accelerator: BioRunAccelerator,
  started: number,
  result: BioRunResult | null = null,
  error: string | null = null,
): BioRunOutcome => ({ status, result, error, accelerator, durationMs: performance.now() - started })

function runInThread(job: BioRunJob): BioRunHandle {
  const started = performance.now()
  let cancelled = false
  let release: ((why: 'cancelled') => void) | null = null
  const promise = new Promise<BioRunOutcome>((resolve) => {
    release = (why) => resolve(outcome(why, 'main-thread', started))
    void Promise.resolve()
      .then(() => {
        if (cancelled) {
          release?.('cancelled')
          return
        }
        try {
          resolve(outcome('done', 'main-thread', started, solveBioRun(job)))
        } catch (error) {
          resolve(outcome('failed', 'main-thread', started, null, error instanceof Error ? error.message : String(error)))
        }
      })
  })
  return {
    promise,
    cancel: () => {
      cancelled = true
      release?.('cancelled')
    },
  }
}

/**
 * Start `job` on the fastest path the host offers.
 *
 * The worker is per run and is terminated as soon as it answers, so a dial dragged
 * across ten values costs ten short-lived threads rather than one that outlives the
 * view. Superseding a run cancels it: an answer nobody is waiting for is still CPU
 * the tab is not using for anything else.
 */
export function runBioRun(job: BioRunJob, options: BioRunOptions = {}): BioRunHandle {
  const prefer = options.prefer ?? 'auto'
  if (prefer === 'main-thread') return runInThread(job)

  let worker: Worker
  try {
    worker = options.createWorker ? options.createWorker() : createBioRunWorker()
  } catch {
    return runInThread(job)
  }

  const started = performance.now()
  let settled = false
  let timeout: ReturnType<typeof setTimeout> | null = null
  let release: ((value: BioRunOutcome) => void) | null = null

  const settle = (value: BioRunOutcome): void => {
    if (settled) return
    settled = true
    if (timeout !== null) clearTimeout(timeout)
    worker.terminate()
    release?.(value)
  }

  const promise = new Promise<BioRunOutcome>((resolve) => {
    release = resolve
    timeout = setTimeout(
      () => settle(outcome('failed', 'worker', started, null, `A biology worker did not finish this run within ${WORKER_WATCHDOG_MS / 1000} s.`)),
      WORKER_WATCHDOG_MS,
    )
    worker.onmessage = (event: MessageEvent<BioRunResponse>) => {
      const message = event.data
      if (!message || typeof message !== 'object' || typeof message.ok !== 'boolean') {
        settle(outcome('failed', 'worker', started, null, 'The biology worker answered with something that was not a run.'))
        return
      }
      settle(
        message.ok
          ? outcome('done', 'worker', started, message.result)
          : outcome('failed', 'worker', started, null, message.error),
      )
    }
    worker.onerror = (event) =>
      settle(outcome('failed', 'worker', started, null, event.message || 'The biology worker stopped without an answer.'))
    const request: BioRunRequest = { token: 0, job }
    worker.postMessage(request)
  })

  return {
    promise,
    cancel: () => settle(outcome('cancelled', 'worker', started)),
  }
}
