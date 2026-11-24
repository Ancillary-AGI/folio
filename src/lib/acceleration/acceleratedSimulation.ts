/**
 * Hardware-acceleration capability reporting and dispatch.
 *
 * The e-CAD analyses are CPU-first by design. Four workloads have an
 * accelerated path: large thermal grids (WebGPU or a Worker), Monte Carlo
 * tolerance sweeps, AC frequency sweeps and noise frequency sweeps (pools of
 * Workers, one independent solve per run or frequency). This module is the
 * single place that answers “what can this browser actually accelerate?”. It
 * never advertises a path that the dispatch code cannot execute.
 */

import { probeWebGpuSupport } from './webgpuDevice'
import {
  solveThermalGridAsync,
  type ThermalAccelerator,
  type ThermalDispatchOptions,
  type ThermalSolveOutcome,
} from './thermalDispatch'
import { defaultMonteCarloWorkerCount } from './monteCarloDispatch'
import { defaultAcSweepWorkerCount } from './acSweepDispatch'
import { defaultNoiseWorkerCount } from './noiseSweepDispatch'
import { MAX_MONTE_CARLO_ITERATIONS } from '../simulation/monteCarlo'
import { MAX_AC_SWEEP_POINTS } from '../simulation/solver'
import type { ThermalGridConfig } from './thermalGrid'

export interface AccelerationCapabilities {
  webgpu: boolean
  webgpuAdapter?: string
  workerThreads: boolean
  /** Required by multi-threaded WASM solvers and zero-copy worker buffers. */
  sharedMemory: boolean
  recommendedThermalPath: ThermalAccelerator
  /**
   * Threads a maximum-size Monte Carlo sweep would use here. Zero means sweeps
   * stay in-thread (no Worker, or the sweep is too small to be worth splitting).
   */
  monteCarloWorkers: number
  /** Threads a maximum-size AC sweep would use here; zero means in-thread. */
  acSweepWorkers: number
  /** Threads a maximum-size noise sweep would use here; zero means in-thread. */
  noiseSweepWorkers: number
}

/** Probe the browser once per request; the caller decides when to re-check. */
export async function queryAccelerationCapabilities(): Promise<AccelerationCapabilities> {
  const gpu = await probeWebGpuSupport()
  const workerThreads = typeof Worker !== 'undefined'
  const adapter = gpu.adapterInfo
    ? [gpu.adapterInfo.vendor, gpu.adapterInfo.architecture, gpu.adapterInfo.device]
        .filter((part) => part.length > 0)
        .join(' ')
    : ''

  return {
    webgpu: gpu.supported,
    webgpuAdapter: adapter || undefined,
    workerThreads,
    sharedMemory: typeof SharedArrayBuffer !== 'undefined',
    recommendedThermalPath: gpu.supported ? 'webgpu' : workerThreads ? 'worker' : 'main-thread',
    monteCarloWorkers: workerThreads ? defaultMonteCarloWorkerCount(MAX_MONTE_CARLO_ITERATIONS) : 0,
    acSweepWorkers: workerThreads ? defaultAcSweepWorkerCount(MAX_AC_SWEEP_POINTS) : 0,
    noiseSweepWorkers: workerThreads ? defaultNoiseWorkerCount(MAX_AC_SWEEP_POINTS) : 0,
  }
}

/** Public acceleration entry point used by analysis panels. */
export function acceleratedThermalDispatch(
  config: ThermalGridConfig,
  options: ThermalDispatchOptions = {},
): Promise<ThermalSolveOutcome> {
  return solveThermalGridAsync(config, options)
}
