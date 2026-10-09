/**
 * Bench-correlation proofs (Giant 4).
 *
 * A divider is the honest fixture: its envelope is narrow, so a bench
 * sample from the true circuit verifies, a 20 % drift fails, and an
 * unknown signal or an out-of-grid sample is uncovered — never verified.
 */
import { describe, expect, it } from 'vitest'
import { buildCircuitModel } from './circuitModel'
import { runOperatingPoint, type AnalysisOutcome } from './solver'
import { correlateBench, toleranceEnvelope } from './benchCorrelation'
import type { CircuitModel } from './circuitModel'

const divider = (): CircuitModel => {
  const { model, errors } = buildCircuitModel({
    title: 'bench divider',
    components: [
      { type: 'voltage_source', name: 'V1', nodes: ['IN', '0'], parameters: { value: 5 } },
      { type: 'resistor', name: 'R1', nodes: ['IN', 'OUT'], parameters: { value: '1k' } },
      { type: 'resistor', name: 'R2', nodes: ['OUT', '0'], parameters: { value: '1k' } },
    ],
    analyses: [{ type: 'dc' }],
  })
  expect(errors).toEqual([])
  return model
}

const operatingPointOf = (perturbed: CircuitModel): AnalysisOutcome =>
  runOperatingPoint(perturbed, { temperatureCelsius: 27 }).outcome

describe('twin guarantee — envelope and bench verdict', () => {
  it('builds a narrow envelope around the nominal divider midpoint', () => {
    const { bands, sweep } = toleranceEnvelope(divider(), operatingPointOf, { iterations: 60, tolerance: 0.01, seed: 7 })
    expect(sweep.converged).toBe(true)
    const band = bands.find((entry) => entry.signal === 'V(OUT)')
    expect(band).toBeDefined()
    const midpoint = band?.points[0]
    expect(midpoint).toBeDefined()
    // 1 % parts on a 2.5 V midpoint: the ±3σ band spans millivolts, not volts.
    expect(midpoint!.low).toBeGreaterThan(2.3)
    expect(midpoint!.high).toBeLessThan(2.7)
    expect(midpoint!.high - midpoint!.low).toBeLessThan(0.2)
  })

  it('verifies bench samples drawn from inside the envelope', () => {
    const { bands } = toleranceEnvelope(divider(), operatingPointOf, { iterations: 60, tolerance: 0.01, seed: 7 })
    const band = bands.find((entry) => entry.signal === 'V(OUT)')
    expect(band).toBeDefined()
    // A bench reading at the band centre is the true circuit under test.
    const centre = (band!.points[0].low + band!.points[0].high) / 2
    const verdict = correlateBench(bands, [{ signal: 'V(OUT)', x: 0, value: centre }])
    expect(verdict.verified).toBe(true)
    expect(verdict.uncovered).toEqual([])
    expect(verdict.summary).toContain('Verified')
  })

  it('rejects a drifted bench reading with a negative margin', () => {
    const { bands } = toleranceEnvelope(divider(), operatingPointOf, { iterations: 60, tolerance: 0.01, seed: 7 })
    const verdict = correlateBench(bands, [{ signal: 'V(OUT)', x: 0, value: 3.0 }])
    expect(verdict.verified).toBe(false)
    expect(verdict.samples[0].inside).toBe(false)
    expect(verdict.samples[0].margin).toBeLessThan(0)
    expect(verdict.summary).toContain('Not verified')
  })

  it('reports unknown signals and empty samples as uncovered, never verified', () => {
    const { bands } = toleranceEnvelope(divider(), operatingPointOf, { iterations: 60, tolerance: 0.01, seed: 7 })
    const unknown = correlateBench(bands, [{ signal: 'V(GHOST)', x: 0, value: 2.5 }])
    expect(unknown.verified).toBe(false)
    expect(unknown.uncovered).toHaveLength(1)
    const empty = correlateBench(bands, [])
    expect(empty.verified).toBe(false)
  })
})
