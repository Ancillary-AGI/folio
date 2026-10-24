import ThermalWorker from './thermalWorker?worker'
import {
  prepareThermalGrid,
  solvePcbThermalGrid,
  type ThermalGridConfig,
  type ThermalGridResult,
} from './thermalGrid'
import { solveThermalGridWebGpu } from './webgpuThermal'
import type { ThermalWorkerResponse } from './thermalWorker'

export type ThermalAccelerator = 'webgpu' | 'worker' | 'main-thread'

export interface ThermalDispatchOptions {
  maxIterations?: number
  /**
   * `auto` uses WebGPU for large grids, then the Worker, then the main thread.
   * An explicit preference still falls back if that path is unavailable, so a
   * requested accelerator never turns into a failed analysis.
   */
  prefer?: 'auto' | ThermalAccelerator
}

export interface ThermalSolveOutcome {
  result: ThermalGridResult
  /** The path that actually produced the result. */
  accelerator: ThermalAccelerator
  durationMs: number
}

/** GPU upload/download only pays off once the grid is this large. */
const GPU_MIN_CELLS = 1024
/** A worker that never answers must not hang the analysis forever. */
const WORKER_TIMEOUT_MS = 30_000

/**
 * Solve the PCB thermal grid on the fastest available path.
 *
 * All paths share `prepareThermalGrid` and `summariseThermalGrid`, so the
 * accelerator affects latency, not the equations or the reported result shape.
 * Worker construction, module loading, GPU acquisition or execution failures
 * fall back to the synchronous solver rather than failing the analysis.
 */
export async function solveThermalGridAsync(
  config: ThermalGridConfig,
  options: ThermalDispatchOptions = {},
): Promise<ThermalSolveOutcome> {
  const started = performance.now()
  const maxIterations = options.maxIterations ?? 2_000
  const prefer = options.prefer ?? 'auto'
  const prepared = prepareThermalGrid(config)

  const gpuWanted = prefer === 'webgpu' || (prefer === 'auto' && prepared.totalCells >= GPU_MIN_CELLS)
  if (gpuWanted) {
    const gpuResult = await solveThermalGridWebGpu(config, maxIterations)
    // A non-converged GPU grid is a partial answer; let the CPU path try to
    // reach the requested tolerance instead of labelling it as the final result.
    if (gpuResult?.converged) {
      return { result: gpuResult, accelerator: 'webgpu', durationMs: performance.now() - started }
    }
  }

  if (prefer !== 'main-thread' && typeof Worker !== 'undefined') {
    let worker: Worker | undefined
    try {
      const activeWorker = new ThermalWorker()
      worker = activeWorker
      const result = await new Promise<ThermalGridResult>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('The thermal worker did not finish within 30 s.')),
          WORKER_TIMEOUT_MS,
        )
        const settle = (action: () => void): void => {
          clearTimeout(timeout)
          action()
        }
        activeWorker.onmessage = (event: MessageEvent<ThermalWorkerResponse>) => {
          const message = event.data
          if (!message.ok) {
            settle(() => reject(new Error(message.error)))
            return
          }
          // A non-converged grid is a partial answer; the CPU solver gets a
          // chance to reach the requested tolerance and report honestly.
          if (!message.result.converged) {
            settle(() => reject(new Error('The thermal worker did not converge.')))
            return
          }
          settle(() => resolve(message.result))
        }
        activeWorker.onerror = (event) =>
          settle(() => reject(new Error(event.message || 'Thermal worker failed')))
        activeWorker.postMessage({ config, maxIterations })
      })
      return { result, accelerator: 'worker', durationMs: performance.now() - started }
    } catch {
      // Fall through to the synchronous solver.
    } finally {
      worker?.terminate()
    }
  }

  const result = solvePcbThermalGrid(config, maxIterations)
  return { result, accelerator: 'main-thread', durationMs: performance.now() - started }
}
