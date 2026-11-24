import { describe, expect, it } from 'vitest'
import { acquireWebGpuDevice, probeWebGpuSupport } from './webgpuDevice'

describe('WebGPU device probing', () => {
  it('returns a safe fallback context under jsdom without crashing', async () => {
    const context = await probeWebGpuSupport()
    expect(context.supported).toBe(false)
    expect(context.isFallback).toBe(true)
  })

  it('does not hand out a device when no adapter exists', async () => {
    await expect(acquireWebGpuDevice()).resolves.toBeNull()
  })
})
