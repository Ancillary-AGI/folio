import { describe, expect, it } from 'vitest'
import {
  acceleratedThermalDispatch,
  queryAccelerationCapabilities,
} from './acceleratedSimulation'
import { solvePcbThermalGrid, type ThermalGridConfig } from './thermalGrid'

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

describe('acceleration capabilities', () => {
  it('reports only paths the environment actually exposes', async () => {
    const capabilities = await queryAccelerationCapabilities()
    expect(capabilities.webgpu).toBe(false)
    expect(capabilities.workerThreads).toBe(typeof Worker !== 'undefined')
    expect(['webgpu', 'worker', 'main-thread']).toContain(capabilities.recommendedThermalPath)
  })

  it('main-thread dispatch matches the direct CPU solve exactly', async () => {
    const outcome = await acceleratedThermalDispatch(board, {
      maxIterations: 500,
      prefer: 'main-thread',
    })
    const direct = solvePcbThermalGrid(board, 500)

    expect(outcome.accelerator).toBe('main-thread')
    expect(outcome.result.peakTemperatureC).toBe(direct.peakTemperatureC)
    expect(outcome.result.averageTemperatureC).toBe(direct.averageTemperatureC)
    expect(outcome.durationMs).toBeGreaterThanOrEqual(0)
  })
})
