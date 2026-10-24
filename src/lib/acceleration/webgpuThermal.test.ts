import { describe, expect, it } from 'vitest'
import { THERMAL_GRID_WGSL, solveThermalGridWebGpu } from './webgpuThermal'
import type { ThermalGridConfig } from './thermalGrid'

const board: ThermalGridConfig = {
  boardWidthMm: 50,
  boardHeightMm: 50,
  boardThicknessMm: 1.6,
  gridResolutionMm: 1,
  effectiveConductivityWmk: 3.5,
  convectionCoeffWperM2K: 15,
  ambientTempC: 25,
  heatSources: [{ id: 'MCU_U1', xMm: 25, yMm: 25, widthMm: 7, heightMm: 7, powerWatts: 1 }],
}

describe('WebGPU thermal solver', () => {
  it('ships a compute shader with the same five-point stencil as the CPU path', () => {
    expect(THERMAL_GRID_WGSL).toContain('@compute')
    expect(THERMAL_GRID_WGSL).toContain('@workgroup_size(16, 16)')
    expect(THERMAL_GRID_WGSL).toContain('params.conduction')
    expect(THERMAL_GRID_WGSL).toContain('power[idx]')
  })

  it('returns null when WebGPU is unavailable instead of claiming acceleration', async () => {
    await expect(solveThermalGridWebGpu(board, 10)).resolves.toBeNull()
  })
})
