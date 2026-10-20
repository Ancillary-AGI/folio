/**
 * Hardware Acceleration: WebGPU Device Management and Capability Probing.
 * Provides high-performance GPU compute capabilities for parallel Monte Carlo sweeps,
 * 2D/3D thermal grid diffusion, and field solving, with transparent fallback.
 */

export interface WebGpuContext {
  supported: boolean;
  adapterInfo?: { vendor: string; architecture: string; device: string };
  maxBufferSize?: number;
  maxComputeWorkgroupSizeX?: number;
  isFallback: boolean;
}

/**
 * Probe WebGPU support and initialize the device if available.
 */
export async function probeWebGpuSupport(): Promise<WebGpuContext> {
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
    return {
      supported: false,
      isFallback: true,
    };
  }

  try {
    const gpu = (navigator as unknown as { gpu: { requestAdapter: () => Promise<unknown> } }).gpu;
    const adapter = (await gpu.requestAdapter()) as {
      requestDevice: () => Promise<{ limits: { maxBufferSize: number; maxComputeWorkgroupSizeX: number } }>;
      info?: { vendor: string; architecture: string; device: string };
    } | null;

    if (!adapter) {
      return { supported: false, isFallback: true };
    }

    const device = await adapter.requestDevice();
    return {
      supported: true,
      adapterInfo: adapter.info,
      maxBufferSize: device.limits.maxBufferSize,
      maxComputeWorkgroupSizeX: device.limits.maxComputeWorkgroupSizeX,
      isFallback: false,
    };
  } catch {
    return { supported: false, isFallback: true };
  }
}
