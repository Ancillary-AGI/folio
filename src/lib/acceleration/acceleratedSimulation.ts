/**
 * Hardware-acceleration capability reporting and dispatch.
 *
 * The e-CAD analyses are CPU-first by design, but large thermal grids can use
 * WebGPU or a Worker. This module is the single place that answers “what can
 * this browser actually accelerate?” and forwards thermal work to the chosen
 * path. It never advertises a path that the dispatch code cannot execute.
 */

import { probeWebGpuSupport } from './webgpuDevice'
import {
  solveThermalGridAsync,
  type ThermalAccelerator,
  type ThermalDispatchOptions,
  type ThermalSolveOutcome,
} from './thermalDispatch'
import type { ThermalGridConfig } from './thermalGrid'

export interface AccelerationCapabilities {
  webgpu: boolean
  webgpuAdapter?: string
  workerThreads: boolean
  /** Required by multi-threaded WASM solvers and zero-copy worker buffers. */
  sharedMemory: boolean
  recommendedThermalPath: ThermalAccelerator
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
  }
}

/** Public acceleration entry point used by analysis panels. */
export function acceleratedThermalDispatch(
  config: ThermalGridConfig,
  options: ThermalDispatchOptions = {},
): Promise<ThermalSolveOutcome> {
  return solveThermalGridAsync(config, options)
}
