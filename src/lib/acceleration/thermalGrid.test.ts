import { describe, expect, it } from 'vitest'
import { prepareThermalGrid, solvePcbThermalGrid, type ThermalGridConfig } from './thermalGrid'

const board = (overrides: Partial<ThermalGridConfig> = {}): ThermalGridConfig => ({
  boardWidthMm: 50,
  boardHeightMm: 50,
  boardThicknessMm: 1.6,
  gridResolutionMm: 1,
  effectiveConductivityWmk: 3.5,
  convectionCoeffWperM2K: 15,
  ambientTempC: 25,
  heatSources: [{ id: 'MCU_U1', xMm: 25, yMm: 25, widthMm: 7, heightMm: 7, powerWatts: 1 }],
  ...overrides,
})

describe('PCB thermal grid solver', () => {
  it('solves a concentrated source above ambient and converges to a steady state', () => {
    const result = solvePcbThermalGrid(board(), 5000)

    expect(result.cols).toBe(50)
    expect(result.rows).toBe(50)
    expect(result.iterations).toBeGreaterThan(0)
    expect(result.converged).toBe(true)
    expect(result.peakTemperatureC).toBeGreaterThan(result.averageTemperatureC)
    expect(result.averageTemperatureC).toBeGreaterThan(25)
    expect(result.hotspots).toHaveLength(1)
    expect(result.hotspots[0].id).toBe('MCU_U1')
    // The hottest cell lies inside the 7 x 7 mm source footprint.
    expect(result.hotspots[0].tempC).toBeCloseTo(result.peakTemperatureC, 1)
    expect(result.temperatureMatrix).toHaveLength(50 * 50)
  })

  it('expresses the source term as a volumetric density that integrates to the declared power', () => {
    const prepared = prepareThermalGrid(board())
    const cellVolume = prepared.dxM * prepared.dxM * prepared.thicknessM
    let integratedWatts = 0
    for (const density of prepared.powerDensityGrid) integratedWatts += density * cellVolume
    expect(integratedWatts).toBeCloseTo(1, 9)
  })

  it('conserves energy at steady state: every watt leaves by convection', () => {
    const config = board()
    const result = solvePcbThermalGrid(config, 20000)
    expect(result.converged).toBe(true)

    const dxM = config.gridResolutionMm * 1e-3
    const thicknessM = config.boardThicknessMm * 1e-3
    const cellVolume = dxM * dxM * thicknessM
    const lossCoefficient = (2 * config.convectionCoeffWperM2K) / thicknessM
    let convectedWatts = 0
    for (const temperature of result.temperatureMatrix) {
      convectedWatts += lossCoefficient * (temperature - config.ambientTempC) * cellVolume
    }

    expect(convectedWatts).toBeCloseTo(1, 2)
  })

  it('scales temperature rise linearly with dissipated power', () => {
    const oneWatt = solvePcbThermalGrid(board(), 5000)
    const twoWatts = solvePcbThermalGrid(
      board({
        heatSources: [
          { id: 'MCU_U1', xMm: 25, yMm: 25, widthMm: 7, heightMm: 7, powerWatts: 2 },
        ],
      }),
      5000,
    )

    expect(twoWatts.peakTemperatureC - 25).toBeCloseTo((oneWatt.peakTemperatureC - 25) * 2, 1)
  })

  it('rejects invalid geometry and non-finite power', () => {
    expect(() => solvePcbThermalGrid(board({ boardWidthMm: 0 }))).toThrow(/Board dimensions/)
    expect(() => solvePcbThermalGrid(board({ boardThicknessMm: 0 }))).toThrow(/thickness/)
    expect(() => solvePcbThermalGrid(board({ gridResolutionMm: -1 }))).toThrow(/resolution/)
    expect(() =>
      solvePcbThermalGrid(
        board({
          heatSources: [
            { id: 'U1', xMm: 25, yMm: 25, widthMm: 7, heightMm: 7, powerWatts: Number.NaN },
          ],
        }),
      ),
    ).toThrow(/power/)
  })
})
