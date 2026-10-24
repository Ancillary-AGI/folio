import { describe, expect, it } from 'vitest'
import { ThermalAnalysisEngine, type ThermalBoundary, type ThermalNode, type ThermalSimulationConfig } from './thermalAnalysis'

const engine = new ThermalAnalysisEngine()

const node = (overrides: Partial<ThermalNode> = {}): ThermalNode => ({
  id: 'U1',
  position: { x: 0, y: 0, z: 0 },
  temperature: 25,
  powerDissipation: 0,
  material: 'FR4',
  ...overrides,
})

const config = (overrides: Partial<ThermalSimulationConfig> = {}): ThermalSimulationConfig => ({
  ambientTemperature: 25,
  convectionCoefficient: 10,
  boardMaterial: 'FR4',
  copperThickness: 0.035,
  layerCount: 4,
  simulationTime: 5000,
  timeStep: 1,
  ...overrides,
})

const convection: ThermalBoundary[] = [{ type: 'convection', heatTransferCoefficient: 10, area: 0.01 }]

describe('ThermalAnalysisEngine', () => {
  it('holds an unpowered node at ambient and reports steady state', async () => {
    const result = await engine.analyzeThermal([node()], convection, config())

    expect(result.converged).toBe(true)
    expect(result.maxTemperature).toBeCloseTo(25, 6)
    expect(result.timeToSteadyState).not.toBeNull()
    expect(result.hotspots).toEqual([])
  })

  it('reaches the analytic convection equilibrium T = Tamb + Q/(hA)', async () => {
    // Q = 1 W through hA = 10 W/(m²K) × 0.01 m² = 0.1 W/K → ΔT = 10 K.
    const result = await engine.analyzeThermal([node({ powerDissipation: 1 })], convection, config())

    expect(result.converged).toBe(true)
    expect(result.maxTemperature).toBeCloseTo(35, 1)
    // A 10 K rise is below the 20 K hotspot threshold.
    expect(result.hotspots).toEqual([])
  })

  it('cools a powered node further when radiation is enabled', async () => {
    const powered = [node({ powerDissipation: 1 })]
    const convectionOnly = await engine.analyzeThermal(powered, convection, config())
    const withRadiation = await engine.analyzeThermal(
      powered,
      [...convection, { type: 'radiation', emissivity: 0.9, area: 0.01 }],
      config(),
    )

    expect(withRadiation.maxTemperature).toBeLessThan(convectionOnly.maxTemperature)
    expect(withRadiation.maxTemperature).toBeGreaterThanOrEqual(25)
  })

  it('does not claim convergence when the simulation window is too short', async () => {
    const result = await engine.analyzeThermal(
      [node({ powerDissipation: 1 })],
      convection,
      config({ simulationTime: 0.001 }),
    )

    expect(result.converged).toBe(false)
    expect(result.timeToSteadyState).toBeNull()
  })

  it.each([
    ['zero time step', config({ timeStep: 0 }), [node()], convection],
    ['negative simulation time', config({ simulationTime: -1 }), [node()], convection],
    ['NaN ambient', config({ ambientTemperature: Number.NaN }), [node()], convection],
    ['NaN power', config(), [node({ powerDissipation: Number.NaN })], convection],
    ['NaN position', config(), [node({ position: { x: Number.NaN, y: 0, z: 0 } })], convection],
    ['negative area', config(), [node()], [{ type: 'convection' as const, area: -0.01 }]],
    ['emissivity out of range', config(), [node()], [{ type: 'radiation' as const, emissivity: 1.5, area: 0.01 }]],
    ['negative heat transfer', config(), [node()], [{ type: 'convection' as const, heatTransferCoefficient: -1, area: 0.01 }]],
  ])('rejects %s instead of simulating it', async (_label, badConfig, nodes, boundaries) => {
    await expect(engine.analyzeThermal(nodes, boundaries, badConfig)).rejects.toThrow(/rejected invalid input/)
  })
})
