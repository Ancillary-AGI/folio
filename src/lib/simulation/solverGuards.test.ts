/**
 * Input-boundary tests for the analysis drivers.
 *
 * Every case here previously produced a plausible-looking empty or degenerate
 * result: an infinite stop time became a NaN time grid, a zero point budget
 * produced no samples while still claiming convergence, and an infinite AC
 * stop frequency collapsed the sweep onto a single duplicated point. The
 * drivers must now refuse these inputs with a note.
 */
import { describe, expect, it } from 'vitest'
import { buildCircuitModel, type CircuitModel } from './circuitModel'
import { buildFrequencyGrid, buildSweepValues, runAcSweep, runTransient } from './solver'
import { runNoiseAnalysis } from './noise'
import type { CircuitNetlist, Component } from './spiceEngine'

const resistor = (name: string, nodes: [string, string], value: string): Component => ({
  type: 'resistor',
  name,
  nodes,
  parameters: { value },
})

const voltageSource = (name: string, nodes: [string, string], value: string): Component => ({
  type: 'voltage_source',
  name,
  nodes,
  parameters: { value },
})

const capacitor = (name: string, nodes: [string, string], value: string): Component => ({
  type: 'capacitor',
  name,
  nodes,
  parameters: { value },
})

function rcModel(): CircuitModel {
  const netlist: CircuitNetlist = {
    title: 'RC low pass',
    components: [
      voltageSource('V1', ['IN', '0'], '5V'),
      resistor('R1', ['IN', 'OUT'], '1kOhm'),
      capacitor('C1', ['OUT', '0'], '1uF'),
    ],
    analyses: [{ type: 'transient' }],
  }
  const built = buildCircuitModel(netlist)
  expect(built.errors).toEqual([])
  return built.model
}

describe('sweep grid guards', () => {
  it('clamps a fractional or non-positive point budget instead of returning no points', () => {
    expect(buildSweepValues({ startValue: 0, stopValue: 10, stepValue: 1, maxPoints: 2.7 })).toHaveLength(2)
    expect(buildSweepValues({ startValue: 0, stopValue: 10, stepValue: 1, maxPoints: 0 })).toHaveLength(11)
    expect(buildSweepValues({ startValue: 0, stopValue: 10, stepValue: 1, maxPoints: Number.NaN })).toHaveLength(11)
  })

  it('returns no frequency grid for a non-finite or reversed range', () => {
    expect(buildFrequencyGrid({ startFrequency: 10, stopFrequency: Number.POSITIVE_INFINITY })).toEqual([])
    expect(buildFrequencyGrid({ startFrequency: 0, stopFrequency: 1e6 })).toEqual([])
    expect(buildFrequencyGrid({ startFrequency: 1e6, stopFrequency: 10 })).toEqual([])
  })
})

describe('analysis input guards', () => {
  it('rejects a non-finite transient time span', () => {
    const result = runTransient(rcModel(), {
      temperatureCelsius: 27,
      stopTime: Number.POSITIVE_INFINITY,
      stepTime: 1e-6,
    })
    expect(result.converged).toBe(false)
    expect(result.waveforms).toEqual([])
    expect(result.notes.join(' ')).toMatch(/finite positive stop time/)
  })

  it('still produces samples when the point budget is zero or NaN', () => {
    for (const maxPoints of [0, Number.NaN, -10]) {
      const result = runTransient(rcModel(), {
        temperatureCelsius: 27,
        stopTime: 10e-6,
        stepTime: 1e-6,
        maxPoints,
      })
      expect(result.converged).toBe(true)
      expect(result.waveforms.length).toBeGreaterThan(0)
      expect(result.waveforms[0].data.length).toBeGreaterThan(0)
    }
  })

  it('rejects a non-finite AC stop frequency', () => {
    const result = runAcSweep(rcModel(), {
      temperatureCelsius: 27,
      startFrequency: 10,
      stopFrequency: Number.POSITIVE_INFINITY,
    })
    expect(result.converged).toBe(false)
    expect(result.waveforms).toEqual([])
    expect(result.notes.join(' ')).toMatch(/finite start and stop frequencies/)
  })

  it('rejects a non-finite noise stop frequency', () => {
    const result = runNoiseAnalysis(rcModel(), {
      temperatureCelsius: 27,
      startFrequency: 10,
      stopFrequency: Number.POSITIVE_INFINITY,
      outputNode: 'OUT',
    })
    expect(result.converged).toBe(false)
    expect(result.integratedRmsNoise).toBe(0)
    expect(result.notes.join(' ')).toMatch(/finite start and stop frequencies/)
  })
})
