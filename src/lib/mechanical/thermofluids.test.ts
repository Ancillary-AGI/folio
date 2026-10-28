import { describe, expect, it } from 'vitest'
import {
  analyseGasCycle,
  analysePipeFlow,
  solvePipeNetwork,
  type PipeNetworkInput,
} from './thermofluids'

describe('air-standard gas cycles', () => {
  it('Carnot efficiency is exactly 1 - Tc/Th', () => {
    const result = analyseGasCycle({ cycle: 'carnot', coldK: 300, hotK: 750, heatInputKJPerKg: 200 })
    expect(result.thermalEfficiency).toBeCloseTo(0.6, 12)
    expect(result.netWorkKJPerKg).toBeCloseTo(120, 10)
    expect(result.heatRejectedKJPerKg).toBeCloseTo(80, 10)
  })

  it('Otto reproduces the closed-form efficiency and the state temperatures', () => {
    const result = analyseGasCycle({ cycle: 'otto', coldK: 300, compressionRatio: 8, heatInputKJPerKg: 800 })
    const expected = 1 - 8 ** -0.4
    expect(result.thermalEfficiency).toBeCloseTo(expected, 10)
    const [t1, t2, t3, t4] = result.states.map((state) => state.temperatureK)
    expect(t1).toBeCloseTo(300, 10)
    expect(t2).toBeCloseTo(300 * 8 ** 0.4, 8)
    expect(t3).toBeGreaterThan(t2)
    expect(t4).toBeCloseTo(t3 / 8 ** 0.4, 8)
    expect(result.netWorkKJPerKg).toBeCloseTo(result.heatInputKJPerKg * expected, 8)
  })

  it('Diesel reproduces the closed-form efficiency with a cut-off ratio', () => {
    const result = analyseGasCycle({ cycle: 'diesel', coldK: 300, compressionRatio: 18, cutoffRatio: 2 })
    const expected = 1 - (1 / 18 ** 0.4) * ((2 ** 1.4 - 1) / (1.4 * (2 - 1)))
    expect(result.thermalEfficiency).toBeCloseTo(expected, 10)
    expect(result.thermalEfficiency).toBeGreaterThan(0.6)
    expect(result.thermalEfficiency).toBeLessThan(0.65)
  })

  it('Brayton efficiency depends only on the pressure ratio', () => {
    const result = analyseGasCycle({ cycle: 'brayton', coldK: 300, pressureRatio: 10, turbineInletK: 1500 })
    expect(result.thermalEfficiency).toBeCloseTo(1 - 10 ** (-0.4 / 1.4), 10)
    expect(result.states[1].temperatureK).toBeCloseTo(300 * 10 ** (0.4 / 1.4), 8)
    expect(result.states[3].temperatureK).toBeCloseTo(1500 / 10 ** (0.4 / 1.4), 8)
  })

  it('refuses a Brayton turbine colder than the compressor exit', () => {
    expect(() =>
      analyseGasCycle({ cycle: 'brayton', coldK: 300, pressureRatio: 20, turbineInletK: 400 }),
    ).toThrow(/turbine inlet must be hotter/)
  })

  it('Rankine charges pump and turbine work over the saturated-water table', () => {
    const result = analyseGasCycle({ cycle: 'rankine', boilerPressureBar: 40, condenserPressureBar: 0.1 })
    expect(result.thermalEfficiency).toBeGreaterThan(0.3)
    expect(result.thermalEfficiency).toBeLessThan(0.37)
    expect(result.netWorkKJPerKg).toBeLessThan(result.heatInputKJPerKg)
    expect(result.heatRejectedKJPerKg).toBeGreaterThan(0)
    const turbineExit = result.states[3]
    expect(turbineExit.quality).toBeDefined()
    expect(turbineExit.quality as number).toBeGreaterThan(0)
    expect(turbineExit.quality as number).toBeLessThan(1)
    expect(result.states[2].pressureBar).toBeCloseTo(40, 9)
  })

  it('refuses a Rankine cycle whose boiler is not above the condenser', () => {
    expect(() =>
      analyseGasCycle({ cycle: 'rankine', boilerPressureBar: 1, condenserPressureBar: 5 }),
    ).toThrow(/boiler pressure must exceed/)
  })

  it('refuses a pressure outside the saturated-water table', () => {
    expect(() =>
      analyseGasCycle({ cycle: 'rankine', boilerPressureBar: 250, condenserPressureBar: 0.1 }),
    ).toThrow(/outside the saturated-water table/)
  })
})

describe('Darcy-Weisbach pipe flow', () => {
  it('uses the laminar friction factor below Re 2300', () => {
    const result = analysePipeFlow({
      lengthM: 10,
      diameterM: 0.01,
      roughnessMm: 0.0015,
      flowM3PerS: 1e-6,
      minorLossCoefficient: 0,
    })
    expect(result.regime).toBe('laminar')
    expect(result.reynolds).toBeLessThan(2300)
    expect(result.frictionFactor).toBeCloseTo(64 / result.reynolds, 12)
    const velocityHead = result.velocityMperS ** 2 / (2 * 9.80665)
    expect(result.majorLossM).toBeCloseTo(result.frictionFactor * (10 / 0.01) * velocityHead, 10)
    expect(result.minorLossM).toBe(0)
  })

  it('solves a turbulent water main with a physically plausible loss', () => {
    const result = analysePipeFlow({
      lengthM: 20,
      diameterM: 0.05,
      roughnessMm: 0.0015,
      flowM3PerS: 0.002,
      minorLossCoefficient: 2,
    })
    expect(result.regime).toBe('turbulent')
    expect(result.reynolds).toBeGreaterThan(10_000)
    expect(result.frictionFactor).toBeGreaterThan(0.015)
    expect(result.frictionFactor).toBeLessThan(0.03)
    expect(result.velocityMperS).toBeCloseTo(0.002 / (Math.PI * 0.05 ** 2 / 4), 10)
    expect(result.majorLossM).toBeGreaterThan(0.3)
    expect(result.majorLossM).toBeLessThan(0.6)
    expect(result.minorLossM).toBeGreaterThan(0)
    expect(result.totalHeadLossM).toBeCloseTo(result.majorLossM + result.minorLossM, 12)
    expect(result.pressureDropPa).toBeCloseTo(998 * 9.80665 * result.totalHeadLossM, 6)
  })

  it('reports no loss for zero flow instead of dividing by zero', () => {
    const result = analysePipeFlow({ lengthM: 5, diameterM: 0.02, roughnessMm: 0.0015, flowM3PerS: 0 })
    expect(result.reynolds).toBe(0)
    expect(result.frictionFactor).toBe(0)
    expect(result.majorLossM).toBe(0)
    expect(result.pressureDropPa).toBe(0)
  })

  it('includes elevation in the pressure drop but not the frictional loss', () => {
    const flat = analysePipeFlow({ lengthM: 10, diameterM: 0.05, roughnessMm: 0.0015, flowM3PerS: 0.001 })
    const lifted = analysePipeFlow({
      lengthM: 10,
      diameterM: 0.05,
      roughnessMm: 0.0015,
      flowM3PerS: 0.001,
      elevationChangeM: 5,
    })
    expect(lifted.majorLossM).toBeCloseTo(flat.majorLossM, 12)
    expect(lifted.totalHeadLossM).toBeCloseTo(flat.totalHeadLossM + 5, 12)
  })

  it('rejects impossible inputs', () => {
    expect(() => analysePipeFlow({ lengthM: 0, diameterM: 0.05, roughnessMm: 0, flowM3PerS: 0.001 })).toThrow(
      /length must be > 0/,
    )
    expect(() =>
      analysePipeFlow({ lengthM: 10, diameterM: 0.05, roughnessMm: -1, flowM3PerS: 0.001 }),
    ).toThrow(/roughness cannot be negative/)
    expect(() =>
      analysePipeFlow({ lengthM: 10, diameterM: 0.05, roughnessMm: 0, flowM3PerS: -0.001 }),
    ).toThrow(/flow cannot be negative/)
  })
})

function network(): PipeNetworkInput {
  return {
    sourceId: 'Tank',
    sourceHeadM: 30,
    nodes: [
      { id: 'Tank' },
      { id: 'Junction', demandM3PerS: 0.001 },
      { id: 'House', demandM3PerS: 0.001 },
    ],
    pipes: [
      { id: 'P1', from: 'Tank', to: 'Junction', lengthM: 100, diameterM: 0.05, roughnessMm: 0.0015 },
      { id: 'P2', from: 'Junction', to: 'House', lengthM: 50, diameterM: 0.032, roughnessMm: 0.0015 },
    ],
  }
}

describe('radial pipe network', () => {
  it('fixes flows by continuity and walks heads from the source', () => {
    const result = solvePipeNetwork(network())
    const p1 = result.pipes.find((pipe) => pipe.id === 'P1')
    const p2 = result.pipes.find((pipe) => pipe.id === 'P2')
    expect(p1?.flowM3PerS).toBeCloseTo(0.002, 12)
    expect(p2?.flowM3PerS).toBeCloseTo(0.001, 12)
    expect(result.totalDemandM3PerS).toBeCloseTo(0.002, 12)
    expect(result.sourceFlowM3PerS).toBeCloseTo(0.002, 12)

    const tank = result.nodes.find((node) => node.id === 'Tank')
    const junction = result.nodes.find((node) => node.id === 'Junction')
    const house = result.nodes.find((node) => node.id === 'House')
    expect(tank?.headM).toBeCloseTo(30, 12)
    expect(junction?.headM).toBeCloseTo(30 - (p1?.headLossM ?? 0), 12)
    expect(house?.headM).toBeCloseTo((junction?.headM ?? 0) - (p2?.headLossM ?? 0), 12)
    expect(house?.headM).toBeLessThan(junction?.headM as number)
    expect(house?.pressurePa).toBeGreaterThan(0)
    expect(result.worstNodeId).toBe('House')
    expect(result.minPressurePa).toBe(house?.pressurePa)
  })

  it('subtracts elevation from static pressure without changing head', () => {
    const base = solvePipeNetwork(network())
    const raised = solvePipeNetwork({
      ...network(),
      nodes: network().nodes.map((node) =>
        node.id === 'House' ? { ...node, elevationM: 10 } : node,
      ),
    })
    const raisedHouse = raised.nodes.find((node) => node.id === 'House')
    const baseHouse = base.nodes.find((node) => node.id === 'House')
    expect(raisedHouse?.headM).toBeCloseTo(baseHouse?.headM as number, 12)
    expect(raisedHouse?.pressurePa).toBeCloseTo((baseHouse?.pressurePa as number) - 998 * 9.80665 * 10, 6)
  })

  it('refuses a loop instead of approximating it', () => {
    const looped = network()
    looped.pipes = [
      ...looped.pipes,
      { id: 'P3', from: 'House', to: 'Tank', lengthM: 10, diameterM: 0.05, roughnessMm: 0.0015 },
    ]
    expect(() => solvePipeNetwork(looped)).toThrow(/source node "Tank" has an incoming pipe/)
  })

  it('refuses a node with two parents and a disconnected branch', () => {
    const twoParents = network()
    twoParents.pipes = [
      ...twoParents.pipes,
      { id: 'P3', from: 'Tank', to: 'House', lengthM: 10, diameterM: 0.05, roughnessMm: 0.0015 },
    ]
    expect(() => solvePipeNetwork(twoParents)).toThrow(/more than one incoming pipe/)

    const detached = network()
    detached.nodes = [...detached.nodes, { id: 'Orphan', demandM3PerS: 0.001 }]
    expect(() => solvePipeNetwork(detached)).toThrow(/Orphan" is not connected to the source/)
  })

  it('refuses a demand at the source and a missing source', () => {
    const sourceDemand = network()
    sourceDemand.nodes = sourceDemand.nodes.map((node) =>
      node.id === 'Tank' ? { ...node, demandM3PerS: 0.001 } : node,
    )
    expect(() => solvePipeNetwork(sourceDemand)).toThrow(/source node cannot also draw a demand/)

    const missing = network()
    missing.sourceId = 'Lake'
    expect(() => solvePipeNetwork(missing)).toThrow(/does not exist/)
  })
})
