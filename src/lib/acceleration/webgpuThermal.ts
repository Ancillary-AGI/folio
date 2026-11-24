/**
 * WebGPU steady-state thermal solver.
 *
 * This is a real compute path, not a shader kept for show: the grid is uploaded
 * to storage buffers, a Jacobi update runs on the GPU for every cell in
 * parallel, and the result is read back and summarised by the shared CPU
 * summary code. If an adapter/device cannot be acquired the function returns
 * `null` and the caller falls back to the Worker or main-thread solver.
 *
 * Jacobi (rather than the CPU path's in-place SOR) is used because a compute
 * pass cannot synchronise across cells mid-dispatch. Float32 storage also means
 * convergence is assessed at 1 mK rather than the CPU path's 1 µK.
 */

/// <reference types="@webgpu/types" />

import { acquireWebGpuDevice } from './webgpuDevice'
import {
  MAX_THERMAL_ITERATIONS,
  prepareThermalGrid,
  summariseThermalGrid,
  thermalIterationResidual,
  type ThermalGridConfig,
  type ThermalGridResult,
} from './thermalGrid'

export const THERMAL_GRID_WGSL = /* wgsl */ `
struct ThermalParams {
  cols: u32,
  rows: u32,
  conduction: f32,
  loss: f32,
  centre: f32,
  ambient: f32,
};

@group(0) @binding(0) var<uniform> params: ThermalParams;
@group(0) @binding(1) var<storage, read> current: array<f32>;
@group(0) @binding(2) var<storage, read> power: array<f32>;
@group(0) @binding(3) var<storage, read_write> next: array<f32>;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.cols || id.y >= params.rows) {
    return;
  }

  let row = id.y;
  let col = id.x;
  let idx = row * params.cols + col;
  let left = select(col - 1u, col, col == 0u);
  let right = select(col + 1u, col, col == params.cols - 1u);
  let up = select(row - 1u, row, row == 0u);
  let down = select(row + 1u, row, row == params.rows - 1u);

  let neighbours =
    current[row * params.cols + left] +
    current[row * params.cols + right] +
    current[up * params.cols + col] +
    current[down * params.cols + col];

  next[idx] = (params.conduction * neighbours + power[idx] + params.loss * params.ambient) / params.centre;
}
`

const WORKGROUP_SIZE = 16
const GPU_CONVERGENCE_C = 1e-3
/** Below this size, buffer upload and readback cost more than the CPU solve. */
const GPU_MIN_CELLS = 1024

/**
 * Solve on a WebGPU adapter.
 *
 * @returns `null` when WebGPU is unavailable or the pass fails; callers must
 *          then use the Worker/main-thread path.
 */
export async function solveThermalGridWebGpu(
  config: ThermalGridConfig,
  maxIterations: number = 2_000,
): Promise<ThermalGridResult | null> {
  if (typeof navigator === 'undefined' || !navigator.gpu) return null

  const prepared = prepareThermalGrid(config)
  if (prepared.totalCells < GPU_MIN_CELLS) return null

  const handle = await acquireWebGpuDevice()
  if (!handle) return null

  const { device } = handle
  const destroyable: GPUBuffer[] = []

  try {
    const iterations = Math.min(Math.max(1, Math.floor(maxIterations)), MAX_THERMAL_ITERATIONS)
    const bufferSize = Math.max(16, Math.ceil((prepared.totalCells * 4) / 16) * 16)

    const shader = device.createShaderModule({ code: THERMAL_GRID_WGSL, label: 'thermal-grid' })
    const pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: shader, entryPoint: 'main' },
    })

    const paramsBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: 'thermal-params',
    })
    const gridA = device.createBuffer({
      size: bufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
      label: 'thermal-grid-a',
    })
    const gridB = device.createBuffer({
      size: bufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
      label: 'thermal-grid-b',
    })
    const powerBuffer = device.createBuffer({
      size: bufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: 'thermal-power',
    })
    const staging = device.createBuffer({
      size: bufferSize,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      label: 'thermal-readback',
    })
    destroyable.push(paramsBuffer, gridA, gridB, powerBuffer, staging)

    const initial = new Float32Array(prepared.totalCells).fill(prepared.ambientTempC)
    device.queue.writeBuffer(gridA, 0, initial)
    device.queue.writeBuffer(gridB, 0, initial)
    // The shader consumes the same W/m³ source term as the CPU solver.
    device.queue.writeBuffer(powerBuffer, 0, Float32Array.from(prepared.powerDensityGrid))

    // Uniform layout: 2 × u32 then 4 × f32, padded to 32 bytes.
    const params = new ArrayBuffer(32)
    new Uint32Array(params, 0, 2).set([prepared.cols, prepared.rows])
    new Float32Array(params, 8, 4).set([
      prepared.conduction,
      prepared.loss,
      prepared.centre,
      prepared.ambientTempC,
    ])
    device.queue.writeBuffer(paramsBuffer, 0, params)

    const bindGroupLayout = pipeline.getBindGroupLayout(0)
    const bindGroup = (source: GPUBuffer, target: GPUBuffer) =>
      device.createBindGroup({
        layout: bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: paramsBuffer } },
          { binding: 1, resource: { buffer: source } },
          { binding: 2, resource: { buffer: powerBuffer } },
          { binding: 3, resource: { buffer: target } },
        ],
      })
    const bindGroups = [bindGroup(gridA, gridB), bindGroup(gridB, gridA)]

    const encoder = device.createCommandEncoder()
    const pass = encoder.beginComputePass()
    pass.setPipeline(pipeline)
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      pass.setBindGroup(0, bindGroups[iteration % 2])
      pass.dispatchWorkgroups(
        Math.ceil(prepared.cols / WORKGROUP_SIZE),
        Math.ceil(prepared.rows / WORKGROUP_SIZE),
      )
    }
    pass.end()

    // Even iterations end in grid A (A→B, B→A, …), odd iterations in grid B.
    const finalBuffer = iterations % 2 === 0 ? gridA : gridB
    encoder.copyBufferToBuffer(finalBuffer, 0, staging, 0, bufferSize)
    device.queue.submit([encoder.finish()])
    await device.queue.onSubmittedWorkDone()

    await staging.mapAsync(GPUMapMode.READ)
    const mapped = new Float32Array(staging.getMappedRange())
    const temperatures = new Float64Array(prepared.totalCells)
    for (let index = 0; index < prepared.totalCells; index += 1) {
      temperatures[index] = mapped[index]
    }
    staging.unmap()

    for (let index = 0; index < temperatures.length; index += 1) {
      if (!Number.isFinite(temperatures[index])) return null
    }

    const residual = thermalIterationResidual(prepared, temperatures)
    return summariseThermalGrid(prepared, temperatures, iterations, residual <= GPU_CONVERGENCE_C)
  } catch {
    return null
  } finally {
    for (const buffer of destroyable) buffer.destroy()
    device.destroy()
  }
}
