import { describe, expect, it } from 'vitest'
import { runMonteCarlo, sampleOutcome } from './monteCarlo'
import type { CircuitModel } from './circuitModel'
import type { AnalysisOutcome } from './solver'

const emptyModel: CircuitModel = {
  devices: [],
  nodeNames: [],
  nodeIndex: new Map(),
  branchRows: new Map(),
  lineRows: new Map(),
  size: 0,
  groundNodes: new Set(),
  notes: [],
  probes: [],
  couplings: [],
}

function outcome(signals: Record<string, { points: number[]; x?: number[] }>): AnalysisOutcome {
  return {
    nodes: [],
    waveforms: Object.entries(signals).map(([name, signal]) => ({
      name,
      type: 'voltage' as const,
      unit: 'V',
      data: signal.points.map((y, index) => ({ x: signal.x?.[index] ?? 0, y })),
    })),
    iterations: 1,
    converged: true,
    notes: [],
  }
}

const meanOf = (result: AnalysisOutcome, name: string): number =>
  result.waveforms.find((waveform) => waveform.name === `${name} mean`)?.data[0].y ?? Number.NaN

describe('runMonteCarlo sample accounting', () => {
  it('excludes a run whose signals are incomplete instead of counting its other signals', () => {
    let call = 0
    const result = runMonteCarlo(
      emptyModel,
      () => {
        call += 1
        // The second run solves only part of the circuit; its A value is an
        // outlier that would badly skew the mean if counted on its own.
        return call === 2 ? outcome({ A: { points: [999] } }) : outcome({ A: { points: [10] }, B: { points: [20] } })
      },
      { iterations: 3, tolerance: 0, seed: 5 },
    )

    expect(result.iterations).toBe(2)
    expect(meanOf(result, 'A')).toBe(10)
    expect(meanOf(result, 'B')).toBe(20)
    expect(result.notes.join(' ')).toContain('1 run(s) were excluded')
  })

  it('excludes a run whose grid has the same length but different points', () => {
    let call = 0
    const result = runMonteCarlo(
      emptyModel,
      () => {
        call += 1
        if (call === 2) {
          return outcome({ A: { points: [5, 6], x: [0, 2] }, B: { points: [7, 8], x: [0, 2] } })
        }
        return outcome({ A: { points: [1, 2], x: [0, 1] }, B: { points: [3, 4], x: [0, 1] } })
      },
      { iterations: 3, tolerance: 0, seed: 9 },
    )

    expect(result.iterations).toBe(2)
    expect(result.waveforms.find((waveform) => waveform.name === 'A mean')?.data).toEqual([
      { x: 0, y: 1 },
      { x: 1, y: 2 },
    ])
    expect(result.notes.join(' ')).toContain('1 run(s) were excluded')
  })

  it('reports failure when every run is non-converged', () => {
    const result = runMonteCarlo(
      emptyModel,
      () => ({ ...outcome({ A: { points: [1] } }), converged: false, notes: ['no solution'] }),
      { iterations: 4, tolerance: 0, seed: 2 },
    )

    expect(result.converged).toBe(false)
    expect(result.iterations).toBe(0)
    expect(result.waveforms).toHaveLength(0)
  })

  it('rejects degenerate options instead of sweeping meaningless values', () => {
    const run = () => outcome({ A: { points: [1] } })
    for (const bad of [
      { tolerance: Number.NaN },
      { tolerance: -0.1 },
      { tolerance: 1 },
      { tolerance: 2 },
      { iterations: Number.NaN },
      { seed: Number.NaN },
      { distribution: 'triangular' as 'gaussian' },
    ]) {
      const result = runMonteCarlo(emptyModel, run, bad)
      expect(result.converged).toBe(false)
      expect(result.iterations).toBe(0)
      expect(result.notes.join(' ')).toMatch(/Monte Carlo:/)
    }
  })

  it('keeps a small spread on a large DC offset from being lost to cancellation', () => {
    let call = 0
    const result = runMonteCarlo(
      emptyModel,
      () => {
        call += 1
        return outcome({ A: { points: [1e6 + (call % 2 === 0 ? 1 : -1)] } })
      },
      { iterations: 4, tolerance: 0, seed: 11 },
    )

    const upper = result.waveforms.find((waveform) => waveform.name === 'A mean +3σ')?.data[0].y
    const mean = meanOf(result, 'A')
    expect(mean).toBeCloseTo(1e6, 9)
    expect(upper).toBeCloseTo(1e6 + 3, 9)
  })
})

describe('sampleOutcome', () => {
  it('normalises operating-point nodes into single-sample signals', () => {
    const sampled = sampleOutcome({
      nodes: [{ name: 'OUT', voltage: 2.5 }],
      waveforms: [],
      operatingPoint: { OUT: 2.5 },
      iterations: 3,
      converged: true,
      notes: [],
    })

    expect(sampled.get('V(OUT)')).toEqual({ unit: 'V', points: [2.5], x: [0] })
  })

  it('omits a node with no solved voltage instead of inventing 0 V', () => {
    const sampled = sampleOutcome({
      nodes: [{ name: 'OUT' }, { name: 'VCC', voltage: 5 }],
      waveforms: [],
      iterations: 1,
      converged: true,
      notes: [],
    })

    expect(sampled.has('V(OUT)')).toBe(false)
    expect(sampled.get('V(VCC)')).toEqual({ unit: 'V', points: [5], x: [0] })
  })

  it('omits non-finite operating-point entries', () => {
    const sampled = sampleOutcome({
      nodes: [],
      waveforms: [],
      operatingPoint: { OUT: Number.POSITIVE_INFINITY, VCC: 5 },
      iterations: 1,
      converged: true,
      notes: [],
    })

    expect(sampled.has('V(OUT)')).toBe(false)
    expect(sampled.has('V(VCC)')).toBe(true)
  })
})
