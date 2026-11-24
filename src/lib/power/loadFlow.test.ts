import { describe, expect, it } from 'vitest'
import {
  buildAdmittanceMatrix,
  solvePowerFlow,
  solveRadialFeeder,
  type PowerBus,
  type PowerBranch,
  type PowerFlowInput,
} from './loadFlow'

/**
 * Expectations here are closed-form or independent balances, never recorded
 * solver output. The two-bus cases are checked against the exact receiving-end
 * quadratic; the multi-bus cases against power conservation and the specified
 * voltage setpoints.
 */

const BASE_MVA = 100
const BASE_KV = 230
const Z_BASE = (BASE_KV * BASE_KV) / BASE_MVA

function inOhms(pu: number): number {
  return pu * Z_BASE
}

function slack(id: string, voltagePu = 1): PowerBus {
  return { id, type: 'slack', baseKv: BASE_KV, voltageSetpointPu: voltagePu }
}

function line(id: string, from: string, to: string, rPu: number, xPu: number, ratingMva?: number): PowerBranch {
  return {
    id,
    from,
    to,
    resistanceOhm: inOhms(rPu),
    reactanceOhm: inOhms(xPu),
    ratingMva,
  }
}

/** Exact receiving-end voltage magnitude for a two-bus radial link, per unit. */
function exactTwoBusVoltagePu(rPu: number, xPu: number, loadPpu: number, loadQpu: number, sourcePu: number): number {
  const a = 1
  const b = 2 * (rPu * loadPpu + xPu * loadQpu) - sourcePu * sourcePu
  const c = (rPu * rPu + xPu * xPu) * (loadPpu * loadPpu + loadQpu * loadQpu)
  const discriminant = b * b - 4 * a * c
  if (discriminant < 0) throw new Error('No steady-state solution exists for this load.')
  const highRoot = (-b + Math.sqrt(discriminant)) / 2
  return Math.sqrt(highRoot)
}

describe('transmission power flow', () => {
  it('matches the exact two-bus quadratic for a PQ load', () => {
    const input: PowerFlowInput = {
      baseMva: BASE_MVA,
      buses: [slack('1', 1), { id: '2', type: 'pq', baseKv: BASE_KV, loadMw: 60, loadMvar: 20 }],
      branches: [line('L12', '1', '2', 0.01, 0.1)],
    }
    const result = solvePowerFlow(input)
    expect(result.converged).toBe(true)
    const expected = exactTwoBusVoltagePu(0.01, 0.1, 0.6, 0.2, 1)
    expect(expected).toBeCloseTo(0.971452, 6)
    expect(result.buses[1].voltagePu).toBeCloseTo(expected, 9)
    expect(result.buses[1].angleDeg).toBeLessThan(0)
  })

  it('balances generation, load and losses in a three-bus network with a PV bus', () => {
    const input: PowerFlowInput = {
      baseMva: BASE_MVA,
      buses: [
        slack('1', 1.05),
        { id: '2', type: 'pv', baseKv: BASE_KV, voltageSetpointPu: 1.02, generationMw: 50, reactiveMinMvar: -200, reactiveMaxMvar: 200 },
        { id: '3', type: 'pq', baseKv: BASE_KV, loadMw: 90, loadMvar: 30 },
      ],
      branches: [
        line('L12', '1', '2', 0.02, 0.06, 100),
        line('L13', '1', '3', 0.03, 0.09, 100),
        line('L23', '2', '3', 0.025, 0.075, 100),
      ],
    }
    const result = solvePowerFlow(input)
    expect(result.converged).toBe(true)
    expect(result.buses[0].voltagePu).toBeCloseTo(1.05, 12)
    expect(result.buses[1].voltagePu).toBeCloseTo(1.02, 12)
    expect(result.buses[1].generationMw).toBeCloseTo(50, 9)
    expect(result.buses[2].angleDeg).toBeLessThan(result.buses[1].angleDeg)

    // The bus injections are the solution of the network equations; the branch
    // flows must add up to them. Conservation is checked to solver tolerance.
    const generation = result.totalGenerationMw
    const demand = result.totalLoadMw
    expect(generation - demand).toBeCloseTo(result.totalLossMw, 5)
    expect(result.totalLossMw).toBeGreaterThan(0)
    expect(result.totalLossMw).toBeLessThan(10)
    expect(Math.abs(result.maxMismatchPu)).toBeLessThan(1e-8)
  })

  it('holds a PV bus inside its reactive limit by switching it to PQ', () => {
    const input: PowerFlowInput = {
      baseMva: BASE_MVA,
      buses: [
        slack('1', 1),
        {
          id: '2',
          type: 'pv',
          baseKv: BASE_KV,
          voltageSetpointPu: 1.05,
          generationMw: 100,
          reactiveMinMvar: -10,
          reactiveMaxMvar: 10,
        },
      ],
      branches: [line('L12', '1', '2', 0.01, 0.2)],
    }
    const result = solvePowerFlow(input)
    expect(result.converged).toBe(true)
    const bus = result.buses[1]
    expect(bus.reactiveLimited).toBe(true)
    expect(bus.type).toBe('pq')
    expect(bus.generationMvar).toBeCloseTo(10, 6)
    expect(bus.voltagePu).toBeLessThan(1.05)
    expect(result.notes.join(' ')).toMatch(/held at its 10\.0 Mvar limit/)
  })

  it('leaves a PV bus at its setpoint when its reactive demand is inside the limits', () => {
    const input: PowerFlowInput = {
      baseMva: BASE_MVA,
      buses: [
        slack('1'),
        {
          id: '2',
          type: 'pv',
          baseKv: BASE_KV,
          voltageSetpointPu: 1,
          generationMw: 30,
          reactiveMinMvar: -200,
          reactiveMaxMvar: 200,
        },
      ],
      branches: [line('L12', '1', '2', 0.01, 0.1)],
    }
    const result = solvePowerFlow(input)
    expect(result.converged).toBe(true)
    expect(result.buses[1].reactiveLimited).toBe(false)
    expect(result.buses[1].voltagePu).toBeCloseTo(1, 12)
    expect(result.notes).toEqual([])
  })

  it('raises the far-end voltage by the inverse tap ratio at no load', () => {
    const input: PowerFlowInput = {
      baseMva: BASE_MVA,
      buses: [slack('1', 1), { id: '2', type: 'pq', baseKv: BASE_KV }],
      branches: [{ ...line('T12', '1', '2', 0.01, 0.1), tapRatio: 0.95 }],
    }
    const result = solvePowerFlow(input)
    expect(result.converged).toBe(true)
    expect(result.buses[1].voltagePu).toBeCloseTo(1 / 0.95, 5)
    expect(result.totalLossMw).toBeCloseTo(0, 6)
  })

  it('reports non-convergence beyond the transfer limit instead of inventing a voltage', () => {
    const input: PowerFlowInput = {
      baseMva: BASE_MVA,
      buses: [slack('1', 1), { id: '2', type: 'pq', baseKv: BASE_KV, loadMw: 800 }],
      branches: [line('L12', '1', '2', 0.01, 0.1)],
    }
    const result = solvePowerFlow(input)
    expect(result.converged).toBe(false)
    expect(result.iterations).toBeLessThanOrEqual(40)
    expect(Number.isFinite(result.maxMismatchPu)).toBe(true)
  })

  it('computes line loading against the thermal rating', () => {
    const input: PowerFlowInput = {
      baseMva: BASE_MVA,
      buses: [slack('1', 1), { id: '2', type: 'pq', baseKv: BASE_KV, loadMw: 60, loadMvar: 20 }],
      branches: [line('L12', '1', '2', 0.01, 0.1, 80)],
    }
    const result = solvePowerFlow(input)
    expect(result.converged).toBe(true)
    const loading = result.branches[0].loadingPercent
    expect(loading).not.toBeNull()
    if (loading === null) throw new Error('rating was supplied')
    expect(loading).toBeGreaterThan(60)
    expect(loading).toBeLessThan(100)
    expect(result.maxLoadingPercent).toBeCloseTo(loading, 12)
  })

  it('adds capacitive shunt susceptance to the diagonal with the documented sign', () => {
    const admittance = buildAdmittanceMatrix({
      baseMva: BASE_MVA,
      buses: [{ ...slack('1'), shuntMvar: 50, shuntMw: 2 }],
      branches: [],
    })
    expect(admittance.g[0][0]).toBeCloseTo(2 / BASE_MVA, 12)
    expect(admittance.b[0][0]).toBeCloseTo(50 / BASE_MVA, 12)
  })

  it('rejects malformed or disconnected cases with a named error', () => {
    expect(() =>
      solvePowerFlow({
        baseMva: BASE_MVA,
        buses: [slack('1'), slack('2')],
        branches: [line('L12', '1', '2', 0.01, 0.1)],
      }),
    ).toThrow(/exactly one slack/)

    expect(() =>
      solvePowerFlow({
        baseMva: BASE_MVA,
        buses: [slack('1'), { id: '2', type: 'pq', baseKv: BASE_KV }],
        branches: [],
      }),
    ).toThrow(/needs at least one branch/)

    expect(() =>
      solvePowerFlow({
        baseMva: BASE_MVA,
        buses: [slack('1'), { id: '2', type: 'pq', baseKv: BASE_KV }, { id: '3', type: 'pq', baseKv: BASE_KV }],
        branches: [line('L12', '1', '2', 0.01, 0.1)],
      }),
    ).toThrow(/cannot reach a slack bus/)

    expect(() =>
      solvePowerFlow({
        baseMva: BASE_MVA,
        buses: [slack('1'), { id: '2', type: 'pq', baseKv: BASE_KV, generationMw: 5 }],
        branches: [line('L12', '1', '2', 0.01, 0.1)],
      }),
    ).toThrow(/make it a PV bus/)

    expect(() =>
      solvePowerFlow({
        baseMva: BASE_MVA,
        buses: [slack('1'), { id: '2', type: 'pq', baseKv: BASE_KV }],
        branches: [line('L12', '1', '2', 0, 0)],
      }),
    ).toThrow(/zero series impedance/)
  })

  it('requires per-unit impedance when a branch spans two voltage levels', () => {
    const transformer: PowerBranch = {
      id: 'T1',
      from: '1',
      to: '2',
      resistanceOhm: 0.5,
      reactanceOhm: 5,
      tapRatio: 1.05,
    }
    expect(() =>
      solvePowerFlow({
        baseMva: BASE_MVA,
        buses: [slack('1'), { id: '2', type: 'pq', baseKv: 69, loadMw: 20, loadMvar: 5 }],
        branches: [transformer],
      }),
    ).toThrow(/per unit/)

    const explicit: PowerFlowInput = {
      baseMva: BASE_MVA,
      buses: [slack('1'), { id: '2', type: 'pq', baseKv: 69, loadMw: 20, loadMvar: 5 }],
      branches: [
        {
          id: 'T1',
          from: '1',
          to: '2',
          seriesImpedancePu: { resistance: 0.002, reactance: 0.08 },
          tapRatio: 1,
          ratingMva: 100,
        },
      ],
    }
    const result = solvePowerFlow(explicit)
    expect(result.converged).toBe(true)
    expect(result.buses[1].voltagePu).toBeGreaterThan(0.9)
    expect(result.buses[1].voltagePu).toBeLessThan(1)
  })
})

describe('radial distribution feeder', () => {
  const quadraticVoltage = (vs: number, r: number, x: number, pPhase: number, qPhase: number): number => {
    const a = 1
    const b = 2 * (r * pPhase + x * qPhase) - vs * vs
    const c = (r * r + x * x) * (pPhase * pPhase + qPhase * qPhase)
    const discriminant = b * b - 4 * a * c
    if (discriminant < 0) throw new Error('No solution')
    return Math.sqrt((-b + Math.sqrt(discriminant)) / 2)
  }

  it('matches the exact receiving voltage on a single loaded section', () => {
    const nominalPhase = 400 / Math.sqrt(3)
    const result = solveRadialFeeder({
      sourceKv: 0.4,
      sourceId: 'src',
      nodes: [{ id: 'src' }, { id: 'load', loadKw: 100, loadKvar: 30 }],
      sections: [{ id: 'S1', from: 'src', to: 'load', resistanceOhm: 0.05, reactanceOhm: 0.03 }],
    })
    expect(result.converged).toBe(true)
    const expected = quadraticVoltage(nominalPhase, 0.05, 0.03, 100000 / 3, 30000 / 3)
    expect(result.nodes[1].voltageV).toBeCloseTo(expected, 4)
    expect(result.nodes[1].voltagePu).toBeLessThan(1)
    expect(result.worstNodeId).toBe('load')
  })

  it('holds every node at the source voltage with no load and reports no loss', () => {
    const result = solveRadialFeeder({
      sourceKv: 11,
      sourceId: 'src',
      nodes: [{ id: 'src' }, { id: 'a' }, { id: 'b' }],
      sections: [
        { id: 'S1', from: 'src', to: 'a', resistanceOhm: 0.2, reactanceOhm: 0.3 },
        { id: 'S2', from: 'a', to: 'b', resistanceOhm: 0.2, reactanceOhm: 0.3 },
      ],
    })
    expect(result.converged).toBe(true)
    for (const node of result.nodes) expect(node.voltagePu).toBeCloseTo(1, 10)
    expect(result.totalLossKw).toBeCloseTo(0, 9)
  })

  it('balances source power against load plus copper loss', () => {
    const result = solveRadialFeeder({
      sourceKv: 0.4,
      sourceId: 'src',
      nodes: [
        { id: 'src' },
        { id: 'a', loadKw: 40, loadKvar: 10 },
        { id: 'b', loadKw: 25, loadKvar: 8, generationKw: 10 },
        { id: 'c', loadKw: 15 },
      ],
      sections: [
        { id: 'S1', from: 'src', to: 'a', resistanceOhm: 0.04, reactanceOhm: 0.02 },
        { id: 'S2', from: 'a', to: 'b', resistanceOhm: 0.06, reactanceOhm: 0.03 },
        { id: 'S3', from: 'b', to: 'c', resistanceOhm: 0.08, reactanceOhm: 0.04 },
      ],
    })
    expect(result.converged).toBe(true)
    const deliveredKw = result.totalLoadKw - result.totalGenerationKw
    const deliveredKvar = result.totalLoadKvar - result.totalGenerationKvar
    expect(result.totalLossKw).toBeGreaterThan(0)
    expect(result.totalLossKw).toBeLessThan(5)
    expect(result.sourceDeliveredKw - deliveredKw).toBeCloseTo(result.totalLossKw, 2)
    expect(result.sourceDeliveredKvar - deliveredKvar).toBeCloseTo(result.totalLossKvar, 2)
    expect(result.nodes.find((node) => node.id === 'c')?.dropPercent).toBeGreaterThan(0)
  })

  it('rejects loops, non-radial parents, source load and orphan nodes', () => {
    const base = {
      sourceKv: 11,
      sourceId: 'src',
      nodes: [{ id: 'src' }, { id: 'a', loadKw: 10 }, { id: 'b', loadKw: 10 }],
    }
    expect(() =>
      solveRadialFeeder({
        ...base,
        sections: [
          { id: 'S1', from: 'src', to: 'a', resistanceOhm: 0.1, reactanceOhm: 0.1 },
          { id: 'S2', from: 'a', to: 'b', resistanceOhm: 0.1, reactanceOhm: 0.1 },
          { id: 'S3', from: 'b', to: 'a', resistanceOhm: 0.1, reactanceOhm: 0.1 },
        ],
      }),
    ).toThrow(/more than one incoming section/)

    expect(() =>
      solveRadialFeeder({
        sourceKv: 11,
        sourceId: 'src',
        nodes: [{ id: 'src', loadKw: 5 }, { id: 'a' }],
        sections: [{ id: 'S1', from: 'src', to: 'a', resistanceOhm: 0.1, reactanceOhm: 0.1 }],
      }),
    ).toThrow(/Source node/)

    expect(() =>
      solveRadialFeeder({
        sourceKv: 11,
        sourceId: 'src',
        nodes: [{ id: 'src' }, { id: 'a' }, { id: 'island', loadKw: 10 }],
        sections: [{ id: 'S1', from: 'src', to: 'a', resistanceOhm: 0.1, reactanceOhm: 0.1 }],
      }),
    ).toThrow(/not connected to the source/)

    expect(() =>
      solveRadialFeeder({
        sourceKv: 11,
        sourceId: 'src',
        nodes: [{ id: 'src' }, { id: 'a' }],
        sections: [{ id: 'S1', from: 'src', to: 'a', resistanceOhm: 0, reactanceOhm: 0 }],
      }),
    ).toThrow(/impedance/)
  })
})
