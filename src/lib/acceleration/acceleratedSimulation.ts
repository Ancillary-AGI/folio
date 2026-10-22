/**
 * Hardware-Accelerated Simulation Dispatcher
 *
 * Routes Monte Carlo analysis to the GPU engine when WebGPU is available,
 * falls back to the CPU typed-array vectorised path otherwise.
 *
 * Also provides WASM sparse matrix solver integration when the binary is
 * available (loaded lazily so the main bundle stays lean).
 *
 * This module sits between spiceEngine.ts and the caller: when a
 * montecarlo analysis is requested, spiceEngine calls
 * `acceleratedMonteCarloDispatch()` which picks the fastest available path.
 */

import { probeWebGpuSupport } from './webgpuDevice'
import { runAcceleratedMonteCarlo, type MonteCarloRunConfig, type MonteCarloStatistics } from './gpuMonteCarlo'

// Singleton probe result (cached for the session)
let _gpuContext: Awaited<ReturnType<typeof probeWebGpuSupport>> | null = null

export async function getGpuContext() {
  if (_gpuContext) return _gpuContext
  _gpuContext = await probeWebGpuSupport()
  return _gpuContext
}

// ─── Monte Carlo ─────────────────────────────────────────────────────────────

export interface AcceleratedMCConfig extends MonteCarloRunConfig {
  /** Override: force CPU path even when GPU is available */
  forceCPU?: boolean
}

/**
 * Run Monte Carlo tolerance analysis using the fastest available path.
 *
 * Return includes the selected accelerator name so the UI can show
 * "WebGPU (100 000 iterations in 42 ms)" vs "CPU (1 000 iterations in 38 ms)".
 */
export async function acceleratedMonteCarloDispatch(
  config: AcceleratedMCConfig,
): Promise<MonteCarloStatistics & { durationMs: number }> {
  const t0 = performance.now()
  const gpu = config.forceCPU ? { supported: false } : await getGpuContext()
  
  // WebGPU path — works only when the adapter was acquired
  if (gpu.supported && !config.forceCPU) {
    try {
      const stats = await runAcceleratedMonteCarlo(config)
      return { ...stats, accelerator: 'webgpu', durationMs: performance.now() - t0 }
    } catch {
      // GPU path failed — fall through to CPU
    }
  }

  // CPU vectorised path
  const stats = await runAcceleratedMonteCarlo({ ...config })
  return { ...stats, accelerator: 'cpu-vectorized', durationMs: performance.now() - t0 }
}

// ─── Thermal grid ─────────────────────────────────────────────────────────────

export type { GpuThermalConfig, ThermalGridResult } from './gpuThermalGrid'

import { runGpuThermalDiffusion, runCpuThermalDiffusion } from './gpuThermalGrid'

export interface ThermalDispatchConfig {
  gridW: number
  gridH: number
  sources: Array<{ x: number; y: number; powerW: number }>
  ambientC: number
  thermalResistance: number
  iterations: number
  forceCPU?: boolean
}

export async function acceleratedThermalDispatch(config: ThermalDispatchConfig) {
  const t0 = performance.now()
  const gpu = config.forceCPU ? { supported: false } : await getGpuContext()

  if (gpu.supported) {
    try {
      const result = await runGpuThermalDiffusion(config as Parameters<typeof runGpuThermalDiffusion>[0])
      return { ...result, accelerator: 'webgpu', durationMs: performance.now() - t0 }
    } catch {
      // fallthrough
    }
  }

  const result = runCpuThermalDiffusion(config as Parameters<typeof runCpuThermalDiffusion>[0])
  return { ...result, accelerator: 'cpu', durationMs: performance.now() - t0 }
}

// ─── WASM sparse solver ───────────────────────────────────────────────────────

let _wasmSolverReady: boolean | null = null

/**
 * Try to load the WASM sparse solver.  Returns false if the binary is not
 * bundled (the TypeScript interface exists but the .wasm is not yet shipped).
 */
export async function tryLoadWasmSolver(): Promise<boolean> {
  if (_wasmSolverReady !== null) return _wasmSolverReady
  try {
    const { WasmSparseSolver } = await import('./wasmSparseSolver')
    const solver = new WasmSparseSolver()
    await solver.initialize()
    _wasmSolverReady = solver.isReady()
  } catch {
    _wasmSolverReady = false
  }
  return _wasmSolverReady
}

// ─── Capability report ────────────────────────────────────────────────────────

export interface AccelerationCapabilities {
  webgpu: boolean
  webgpuAdapter?: string
  wasm: boolean
  workerThreads: boolean
  maxIterationsGpu: number
  recommended: 'webgpu' | 'cpu-vectorized'
}

export async function queryAccelerationCapabilities(): Promise<AccelerationCapabilities> {
  const [gpu, wasm] = await Promise.all([getGpuContext(), tryLoadWasmSolver()])
  return {
    webgpu: gpu.supported,
    webgpuAdapter: gpu.adapterInfo ? `${gpu.adapterInfo.vendor} ${gpu.adapterInfo.device}` : undefined,
    wasm,
    workerThreads: typeof Worker !== 'undefined',
    maxIterationsGpu: gpu.supported ? 100_000 : 10_000,
    recommended: gpu.supported ? 'webgpu' : 'cpu-vectorized',
  }
}
