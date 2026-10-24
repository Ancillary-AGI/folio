import { describe, expect, it } from 'vitest'
import { spiceEngine, type CircuitNetlist } from './spiceEngine'
import { turnsRatio } from './transformerMutual'

const closeTo = (value: number | undefined, expected: number, digits = 3) =>
  expect(value).toBeCloseTo(expected, digits)

describe('coupled inductors / transformers', () => {
  it('steps an ideal transformer voltage up by sqrt(L2/L1) in AC', async () => {
    const netlist: CircuitNetlist = {
      title: 'ideal transformer',
      components: [
        { type: 'voltage_source', name: 'V1', nodes: ['P', '0'], parameters: { value: 0, acMagnitude: 1 } },
        {
          type: 'transformer',
          name: 'T1',
          nodes: ['P', '0', 'S', '0'],
          parameters: { inductance: 1, secondaryInductance: 4, k: 1 },
        },
        { type: 'resistor', name: 'RLOAD', nodes: ['S', '0'], parameters: { resistance: 1000 } },
      ],
      analyses: [{ type: 'ac', startFreq: 1e6, stopFreq: 2e6, pointsPerDecade: 2 }],
    }

    const result = await spiceEngine.simulate(netlist)

    expect(result.success).toBe(true)
    // The source sits directly across L1, so the DC branch current is free;
    // the AC response is still exact because every device here is linear.
    expect(result.notes?.join(' ')).toContain('computed about zero bias')
    const secondary = result.waveforms.find((waveform) => waveform.name === '|V(S)|')
    expect(secondary).toBeDefined()
    // k = 1, so the secondary tracks the primary at the turns ratio.
    closeTo(secondary?.data[0].y, 2, 2)

    const primaryCurrent = result.waveforms.find((waveform) => waveform.name === '|V(P)|')
    expect(primaryCurrent?.data[0].y).toBeCloseTo(1, 6)
  })

  it('resolves a SPICE K card between two separate inductors', async () => {
    const netlist: CircuitNetlist = {
      title: 'K card',
      components: [
        { type: 'voltage_source', name: 'V1', nodes: ['P', '0'], parameters: { value: 0, acMagnitude: 1 } },
        { type: 'inductor', name: 'L1', nodes: ['P', '0'], parameters: { inductance: 1 } },
        { type: 'inductor', name: 'L2', nodes: ['S', '0'], parameters: { inductance: 4 } },
        { type: 'mutual_inductance', name: 'K1', nodes: [], parameters: { l1: 'L1', l2: 'L2', k: 1 } },
        { type: 'resistor', name: 'RLOAD', nodes: ['S', '0'], parameters: { resistance: 1000 } },
      ],
      analyses: [{ type: 'ac', startFreq: 1e6, stopFreq: 2e6, pointsPerDecade: 2 }],
    }

    const result = await spiceEngine.simulate(netlist)

    expect(result.success).toBe(true)
    const secondary = result.waveforms.find((waveform) => waveform.name === '|V(S)|')
    closeTo(secondary?.data[0].y, 2, 2)
  })

  it('couples a transient pulse through the transformer', async () => {
    const netlist: CircuitNetlist = {
      title: 'transformer transient',
      components: [
        {
          type: 'pulse_voltage_source',
          name: 'V1',
          nodes: ['P', '0'],
          parameters: { v1: 0, v2: 2, td: 0, tr: '1u', tf: '1u', pw: '1', per: '2' },
        },
        {
          type: 'transformer',
          name: 'T1',
          nodes: ['P', '0', 'S', '0'],
          parameters: { inductance: 1, secondaryInductance: 4, k: 1 },
        },
        { type: 'resistor', name: 'RLOAD', nodes: ['S', '0'], parameters: { resistance: 1000 } },
      ],
      analyses: [{ type: 'transient', stopTime: 0.06, stepTime: 1e-4 }],
    }

    const result = await spiceEngine.simulate(netlist)

    expect(result.success).toBe(true)
    const secondary = result.waveforms.find((waveform) => waveform.name === 'V(S)')
    expect(secondary).toBeDefined()
    const final = secondary?.data[secondary.data.length - 1]
    // A 2 V pulse into a 1:2 transformer settles at 4 V on the secondary.
    expect(final?.y).toBeCloseTo(4, 1)
  })

  it('keeps the coupled-inductor history under trapezoidal integration', async () => {
    const netlist: CircuitNetlist = {
      title: 'transformer transient trap',
      components: [
        {
          type: 'pulse_voltage_source',
          name: 'V1',
          nodes: ['P', '0'],
          parameters: { v1: 0, v2: 2, td: 0, tr: '1u', tf: '1u', pw: '1', per: '2' },
        },
        {
          type: 'transformer',
          name: 'T1',
          nodes: ['P', '0', 'S', '0'],
          parameters: { inductance: 1, secondaryInductance: 4, k: 1 },
        },
        { type: 'resistor', name: 'RLOAD', nodes: ['S', '0'], parameters: { resistance: 1000 } },
      ],
      analyses: [
        { type: 'transient', stopTime: 0.06, stepTime: 1e-4, integrationMethod: 'trapezoidal' },
      ],
    }

    const result = await spiceEngine.simulate(netlist)

    expect(result.success).toBe(true)
    const secondary = result.waveforms.find((waveform) => waveform.name === 'V(S)')
    expect(secondary).toBeDefined()
    const final = secondary?.data[secondary.data.length - 1]
    expect(final?.y).toBeCloseTo(4, 1)
    expect((secondary?.data ?? []).every((point) => Number.isFinite(point.y))).toBe(true)
  })

  it('keeps both coupled-current histories under Gear/BDF2', async () => {
    const netlist: CircuitNetlist = {
      title: 'transformer transient BDF2',
      components: [
        {
          type: 'pulse_voltage_source',
          name: 'V1',
          nodes: ['P', '0'],
          parameters: { v1: 0, v2: 2, td: 0, tr: '1u', tf: '1u', pw: '1', per: '2' },
        },
        {
          type: 'transformer',
          name: 'T1',
          nodes: ['P', '0', 'S', '0'],
          parameters: { inductance: 1, secondaryInductance: 4, k: 1 },
        },
        { type: 'resistor', name: 'RLOAD', nodes: ['S', '0'], parameters: { resistance: 1000 } },
      ],
      analyses: [
        { type: 'transient', stopTime: 0.06, stepTime: 1e-4, integrationMethod: 'bdf2' },
      ],
    }

    const result = await spiceEngine.simulate(netlist)

    expect(result.success).toBe(true)
    const secondary = result.waveforms.find((waveform) => waveform.name === 'V(S)')
    expect(secondary).toBeDefined()
    const final = secondary?.data[secondary.data.length - 1]
    expect(final?.y).toBeCloseTo(4, 1)
    expect((secondary?.data ?? []).every((point) => Number.isFinite(point.y))).toBe(true)
  })

  it('rejects an unphysical coupling coefficient and a dangling K card', async () => {
    const tooStrong = await spiceEngine.simulate({
      title: 'bad k',
      components: [
        {
          type: 'transformer',
          name: 'T1',
          nodes: ['P', '0', 'S', '0'],
          parameters: { inductance: 1, secondaryInductance: 1, k: 1.2 },
        },
      ],
      analyses: [{ type: 'ac', startFreq: 1e3, stopFreq: 1e4 }],
    })
    expect(tooStrong.success).toBe(false)
    expect(tooStrong.error).toContain('coupling coefficient')

    const dangling = await spiceEngine.simulate({
      title: 'dangling K',
      components: [
        { type: 'mutual_inductance', name: 'K1', nodes: [], parameters: { l1: 'L1', l2: 'L2', k: 0.9 } },
      ],
      analyses: [{ type: 'ac', startFreq: 1e3, stopFreq: 1e4 }],
    })
    expect(dangling.success).toBe(false)
    expect(dangling.error).toContain('unknown inductor')
  })

  it('reports the turns ratio for the pair', () => {
    expect(turnsRatio({
      name: 'K1',
      l1Name: 'L1',
      l2Name: 'L2',
      k: 1,
      l1Value: 1,
      l2Value: 4,
      l1p: 'P',
      l1n: '0',
      l2p: 'S',
      l2n: '0',
    })).toBe(2)
  })
})
