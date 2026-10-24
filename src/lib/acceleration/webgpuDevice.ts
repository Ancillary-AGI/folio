/// <reference types="@webgpu/types" />

/**
 * WebGPU device acquisition for the hardware-acceleration paths.
 *
 * The rest of the app must keep working in browsers without WebGPU and under
 * jsdom, so every failure mode here — no `navigator.gpu`, no adapter, a denied
 * request, a lost device — resolves to `null` instead of throwing. Callers then
 * fall back to the Worker or main-thread implementation with the same physics.
 */

export interface WebGpuContext {
  supported: boolean
  adapterInfo?: { vendor: string; architecture: string; device: string }
  maxBufferSize?: number
  maxComputeWorkgroupSizeX?: number
  isFallback: boolean
}

export interface WebGpuHandle {
  adapter: GPUAdapter
  device: GPUDevice
  context: WebGpuContext
}

/** Request a device for a compute pass; `null` when WebGPU is unavailable. */
export async function acquireWebGpuDevice(): Promise<WebGpuHandle | null> {
  if (typeof navigator === 'undefined' || !navigator.gpu) return null

  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) return null

    const device = await adapter.requestDevice()
    const info = adapter.info
    return {
      adapter,
      device,
      context: {
        supported: true,
        adapterInfo: info
          ? {
              vendor: info.vendor ?? '',
              architecture: info.architecture ?? '',
              device: info.device ?? '',
            }
          : undefined,
        maxBufferSize: device.limits.maxBufferSize,
        maxComputeWorkgroupSizeX: device.limits.maxComputeWorkgroupSizeX,
        isFallback: false,
      },
    }
  } catch {
    return null
  }
}

/**
 * Probe support without retaining the device. Used by capability reporting;
 * analysis paths call `acquireWebGpuDevice` themselves and release the device
 * when the pass finishes.
 */
export async function probeWebGpuSupport(): Promise<WebGpuContext> {
  const handle = await acquireWebGpuDevice()
  if (!handle) return { supported: false, isFallback: true }
  handle.device.destroy()
  return handle.context
}
