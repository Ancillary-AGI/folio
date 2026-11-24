import { describe, expect, it } from 'vitest'
import { parseSpiceDeck } from './spiceImport'
import { buildCircuitModel } from './circuitModel'
import { runCircuitAnalysis } from './analysisRunner'
import { spiceEngine, type CircuitNetlist } from './spiceEngine'

function build(deck: string) {
  const imported = parseSpiceDeck(deck)
  expect(imported.errors).toEqual([])
  const built = buildCircuitModel(imported.netlist)
  expect(built.errors).toEqual([])
  return { imported, model: built.model }
}

describe('SPICE deck import', () => {
  it('imports a divider and solves the operating point from the deck', () => {
    const { imported, model } = build(`* divider
V1 in 0 10
R1 in out 1k
R2 out 0 1k
.op
.end
`)
    expect(imported.netlist.title).toBe('divider')
    expect(imported.netlist.components.map((component) => component.name)).toEqual(['V1', 'R1', 'R2'])
    expect(imported.netlist.analyses).toEqual([{ type: 'dc' }])

    const outcome = runCircuitAnalysis(model, imported.netlist.analyses[0])
    const out = outcome.nodes.find((node) => node.name === 'OUT')
    expect(outcome.converged).toBe(true)
    expect(out?.voltage).toBeCloseTo(5, 6)
  })

  it('resolves a .model card declared after the device that uses it', () => {
    const { imported, model } = build(`* diode drop
V1 in 0 5
R1 in out 1k
D1 out 0 DM
.model DM D (Is=1e-14 N=1)
.op
.end
`)
    expect(imported.netlist.models?.DM.type).toBe('D')
    const outcome = runCircuitAnalysis(model, imported.netlist.analyses[0])
    const out = outcome.nodes.find((node) => node.name === 'OUT')
    expect(outcome.converged).toBe(true)
    expect(out?.voltage).toBeGreaterThan(0.5)
    expect(out?.voltage).toBeLessThan(0.75)
  })

  it('joins continuation lines and strips full-line and inline comments', () => {
    const { imported } = build(`* continued deck
V1 in 0
+ 10 ; supply
R1 in out 1k $ series resistor
R2 out 0
+ 1k
.op
.end
`)
    const v1 = imported.netlist.components.find((component) => component.name === 'V1')
    const r2 = imported.netlist.components.find((component) => component.name === 'R2')
    expect(v1?.parameters.value).toBe('10')
    expect(r2?.parameters.value).toBe('1k')
    expect(imported.netlist.title).toBe('continued deck')
  })

  it('imports a PULSE source and the transient card that drives it', () => {
    const { imported, model } = build(`* rc pulse
V1 in 0 PULSE(0 5 0 1n 1n 0.5m 1m)
R1 in out 1k
C1 out 0 1u
.tran 10u 5m
.end
`)
    const transient = imported.netlist.analyses[0]
    expect(transient.type).toBe('transient')
    expect(transient.stepTime).toBeCloseTo(10e-6, 15)
    expect(transient.stopTime).toBeCloseTo(5e-3, 15)
    const outcome = runCircuitAnalysis(model, imported.netlist.analyses[0])
    const input = outcome.waveforms.find((waveform) => waveform.name === 'V(IN)')
    const out = outcome.waveforms.find((waveform) => waveform.name === 'V(OUT)')
    expect(outcome.converged).toBe(true)
    expect(input).toBeDefined()
    expect(out).toBeDefined()
    // The source itself must swing the full PULSE levels at the stated period.
    const levels = (input?.data ?? []).map((point) => point.y)
    expect(Math.max(...levels)).toBeCloseTo(5, 6)
    expect(Math.min(...levels)).toBeCloseTo(0, 3)
    // The RC low-pass (1 ms time constant) filters a 1 ms-period square wave to
    // a bounded ripple around its mean — proof the period was read correctly.
    const settled = out?.data[out.data.length - 1].y ?? 0
    expect(settled).toBeGreaterThan(1)
    expect(settled).toBeLessThan(3)
  })

  it('warns that only the first analysis card is solved when several are present', () => {
    const deck = parseSpiceDeck(`* two analyses
V1 in 0 10
R1 in out 1k
R2 out 0 1k
.op
.tran 0.1m 5m
.end
`)
    expect(deck.errors).toEqual([])
    expect(deck.netlist.analyses).toHaveLength(2)
    expect(deck.warnings.join(' ')).toMatch(/solves the first \(dc\)/)
  })

  it('imports AC and noise cards without inventing input-referred noise', () => {
    const ac = parseSpiceDeck(`* rc ac
V1 in 0 AC 1
R1 in out 1k
C1 out 0 1u
.ac dec 12 1 1meg
.end
`)
    expect(ac.errors).toEqual([])
    expect(ac.netlist.analyses[0]).toMatchObject({
      type: 'ac',
      pointsPerDecade: 12,
      startFreq: 1,
      stopFreq: 1e6,
    })

    const noise = parseSpiceDeck(`* noise
V1 in 0 0
R1 in out 1k
R2 out 0 1k
.noise v(out) V1 dec 10 1 1meg
.end
`)
    expect(noise.errors).toEqual([])
    expect(noise.netlist.analyses[0]).toMatchObject({
      type: 'noise',
      outputNode: 'out',
      pointsPerDecade: 10,
      startFreq: 1,
      stopFreq: 1e6,
    })
    const built = buildCircuitModel(noise.netlist)
    const outcome = runCircuitAnalysis(built.model, noise.netlist.analyses[0])
    expect(outcome.converged).toBe(true)
    expect(outcome.notes.join(' ')).toMatch(/thermal\+diode/)
  })

  it('honours .temp and .options method regardless of card order', () => {
    const { imported } = build(`* options
.options method=gear maxord=2 temp=50
V1 in 0 1
R1 in out 1k
C1 out 0 1u
.tran 10u 1m
.end
`)
    expect(imported.netlist.analyses[0]).toMatchObject({
      type: 'transient',
      temperature: 50,
      integrationMethod: 'bdf2',
    })
  })

  it('sweeps the temperature when the .dc source is TEMP', () => {
    const { imported } = build(`* thermal sweep
V1 in 0 1
R1 in out 1k
R2 out 0 1k
.dc TEMP 0 100 10
.end
`)
    expect(imported.netlist.analyses[0]).toMatchObject({
      type: 'dc-sweep',
      sweepSource: 'TEMP',
      sweepStart: 0,
      sweepStop: 100,
      sweepStep: 10,
    })
  })

  it('flattens a subcircuit instance rather than dropping it', () => {
    const imported = parseSpiceDeck(`* hierarchy
.subckt div a b
R1 a b 1k
.ends
X1 in 0 div
V1 in 0 1
.op
.end
`)
    expect(imported.errors).toEqual([])
    expect(imported.netlist.components.map((component) => component.name)).toEqual(['X1:R1', 'V1'])
  })

  it('names every unsupported construct it refuses', () => {
    const include = parseSpiceDeck('* include\n.include "models.lib"\nV1 in 0 1\n.op\n.end\n')
    expect(include.errors.join(' ')).toMatch(/\.include cannot be resolved/)

    const lin = parseSpiceDeck('* lin\nV1 in 0 AC 1\nR1 in 0 1k\n.ac lin 10 1 1k\n.end\n')
    expect(lin.errors.join(' ')).toMatch(/only a decade sweep is supported/)

    const cccs = parseSpiceDeck('* f\nV1 in 0 1\nR1 in 0 1k\nF1 0 in V1 2\n.op\n.end\n')
    expect(cccs.errors.join(' ')).toMatch(/current-controlled sources/)
  })

  it('evaluates a .param expression before parsing the element card', () => {
    const imported = parseSpiceDeck('* param\n.param r=1k\nV1 in 0 1\nR1 in 0 {r}\n.op\n.end\n')
    expect(imported.errors).toEqual([])
    expect(imported.netlist.components.find((component) => component.name === 'R1')?.parameters.value).toBe('1000')
  })

  it('round-trips the exported deck back into the same circuit', () => {
    const netlist: CircuitNetlist = {
      title: 'round trip divider',
      components: [
        { type: 'voltage_source', name: 'V1', nodes: ['in', '0'], parameters: { value: 9 } },
        { type: 'resistor', name: 'R1', nodes: ['in', 'out'], parameters: { value: 2200 } },
        { type: 'resistor', name: 'R2', nodes: ['out', '0'], parameters: { value: 1000 } },
      ],
      analyses: [{ type: 'dc' }],
    }
    const deck = spiceEngine.generateSPICENetlist(netlist)
    const imported = parseSpiceDeck(deck)
    expect(imported.errors).toEqual([])
    expect(imported.netlist.components.map((component) => component.name)).toEqual(['V1', 'R1', 'R2'])
    expect(imported.netlist.analyses).toEqual([{ type: 'dc' }])

    const original = buildCircuitModel(netlist)
    const reparsed = buildCircuitModel(imported.netlist)
    const expected = runCircuitAnalysis(original.model, { type: 'dc' })
    const actual = runCircuitAnalysis(reparsed.model, { type: 'dc' })
    const voltage = (outcome: typeof expected): number | undefined =>
      outcome.nodes.find((node) => node.name === 'OUT')?.voltage
    expect(voltage(actual)).toBeCloseTo(voltage(expected) as number, 12)
  })

  it('rejects duplicate references with the line number', () => {
    const imported = parseSpiceDeck('* dup\nV1 in 0 1\nR1 in 0 1k\nR1 in 0 2k\n.op\n.end\n')
    expect(imported.errors.join(' ')).toMatch(/duplicate reference "R1"/)
  })
})
