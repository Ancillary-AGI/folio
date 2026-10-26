import { describe, expect, it } from 'vitest'
import { buildDemoBoard } from '../demo/demoBoard'
import { createMemoryCadRuntime } from './cadRuntime'
import {
  createCadToolset,
  registerCadTools,
  type CadAssessmentOutput,
  type CadErcOutput,
  type CadObservation,
  type CadSimulationOutput,
} from './cadTools'
import { AgentHarness } from './agentHarness'
import { runAgentLoop, runAutopilot } from './autopilot'
import { parseSpiceValue } from '../simulation/devices'

const demoRuntime = () => {
  const board = buildDemoBoard()
  return createMemoryCadRuntime({ components: board.components, wires: board.wires })
}

const QUICK_TRANSIENT = { type: 'transient' as const, stopTime: 4e-3, stepTime: 1e-5 }

describe('cad tools — agents operate the live sheet', () => {
  it('observes canonical nets, terminal geometry, and an SVG', async () => {
    const tools = createCadToolset(demoRuntime())
    const observation = (await tools.invoke('cad.observe')) as CadObservation
    expect(observation.stats.components).toBe(6)
    expect(observation.nets.map((net) => net.name)).toEqual(['0', 'MID', 'OUT', 'SRC'])
    expect(observation.fingerprint).toMatch(/^[0-9a-f]+$/)
    const diode = observation.components.find((component) => component.reference === 'D1')!
    expect(diode.terminals.map((terminal) => terminal.ref)).toEqual(['D1.A', 'D1.K'])
    expect(diode.terminals[0].x).toBe(190)
    expect(diode.terminals[0].y).toBe(180)
    expect(observation.schematicSvg).toContain('<svg')
    expect(observation.schematicSvg).toContain('D1')
    expect(observation.issues).toEqual([])
  })

  it('adds, removes, and undoes a part with a unique reference', async () => {
    const tools = createCadToolset(demoRuntime())
    const added = (await tools.invoke('cad.addPart', {
      symbol: 'resistor',
      properties: JSON.stringify({ value: '1k' }),
    })) as CadObservation & { added: { reference: string; terminals: unknown[] } }
    expect(added.stats.components).toBe(7)
    expect(added.added.reference).toBe('R1')
    expect(added.added.terminals).toHaveLength(2)

    const removed = (await tools.invoke('cad.removePart', { reference: 'R1' })) as CadObservation
    expect(removed.stats.components).toBe(6)

    const undone = (await tools.invoke('cad.undo')) as CadObservation & { undone: boolean }
    expect(undone.undone).toBe(true)
    expect(undone.stats.components).toBe(7)
  })

  it('rejects malformed values and unknown symbols with the offending name', async () => {
    const tools = createCadToolset(demoRuntime())
    await expect(
      tools.invoke('cad.setProperty', { reference: 'C1', property: 'value', value: 'not-a-capacitance' }),
    ).rejects.toThrow(/C1\.value/)
    await expect(tools.invoke('cad.addPart', { symbol: 'flux capacitor' })).rejects.toThrow(/Unknown symbol/)
    await expect(
      tools.invoke('cad.connect', { from: 'D1.nope', to: 'RLOAD.1' }),
    ).rejects.toThrow(/D1 has no terminal/)
  })

  it('builds and measures a circuit from scratch, then rates it against declared limits', async () => {
    const runtime = createMemoryCadRuntime()
    const tools = createCadToolset(runtime)
    await tools.invoke('cad.addPart', {
      symbol: 'DC Voltage Source', reference: 'V1', x: 80, y: 160,
      properties: JSON.stringify({ vo: '5V' }),
    })
    await tools.invoke('cad.addPart', {
      symbol: 'Resistor', reference: 'R1', x: 240, y: 160,
      properties: JSON.stringify({ value: '10', footprint: '1206' }),
    })
    await tools.invoke('cad.addPart', { symbol: 'Ground', reference: 'G1', x: 160, y: 260 })
    await tools.invoke('cad.connect', { from: 'V1.+', to: 'R1.1' })
    await tools.invoke('cad.connect', { from: 'R1.2', to: 'V1.-' })
    await tools.invoke('cad.connect', { from: 'V1.-', to: 'G1.GND' })

    await expect(tools.invoke('cad.assess')).rejects.toThrow(/simulate/)
    const simulation = (await tools.invoke('cad.simulate', { analysis: 'dc' })) as CadSimulationOutput
    expect(simulation.success).toBe(true)
    expect(Math.abs(simulation.deviceCurrents?.['R1'] ?? 0)).toBeCloseTo(0.5, 3)

    const overloaded = (await tools.invoke('cad.assess')) as CadAssessmentOutput
    expect(overloaded.status.fail).toBeGreaterThan(0)
    expect(overloaded.worst?.reference).toBe('R1')
    expect(overloaded.worst?.quantity).toBe('power')
    expect(overloaded.limitingFactor).toMatch(/R1/)

    await tools.invoke('cad.setProperty', { reference: 'R1', property: 'value', value: '1000' })
    await tools.invoke('cad.simulate', { analysis: 'dc' })
    const healthy = (await tools.invoke('cad.assess')) as CadAssessmentOutput
    expect(healthy.status.fail).toBe(0)
    expect(healthy.worst?.utilization).toBeLessThan(0.2)
  })

  it('taps a named rail with a real T-junction and keeps the net canonical', async () => {
    const runtime = demoRuntime()
    const tools = createCadToolset(runtime)
    const added = (await tools.invoke('cad.addPart', {
      symbol: 'Capacitor', reference: 'C2', x: 360, y: 200,
      properties: JSON.stringify({ value: '22uF', voltage: '50V', footprint: '1206' }),
      rotation: 90,
    })) as CadObservation
    expect(added.stats.components).toBe(7)

    await tools.invoke('cad.connect', { from: 'C2.1', to: 'net:OUT' })
    await tools.invoke('cad.connect', { from: 'C2.2', to: 'G1.GND' })
    const observed = (await tools.invoke('cad.observe')) as CadObservation
    const out = observed.nets.find((net) => net.name === 'OUT')!
    const ground = observed.nets.find((net) => net.name === '0')!
    expect(out.pins).toContain('C2.1')
    expect(ground.pins).toContain('C2.2')

    const simulation = (await tools.invoke('cad.simulate', {
      analysis: 'transient',
      parameters: JSON.stringify(QUICK_TRANSIENT),
    })) as CadSimulationOutput
    expect(simulation.success).toBe(true)
    expect(simulation.waveforms.some((waveform) => waveform.name === 'V(OUT)')).toBe(true)
    expect(simulation.waveformSvg).toContain('<svg')
  })

  it('disconnects one terminal from a shared rail without severing the others', async () => {
    const runtime = demoRuntime()
    const tools = createCadToolset(runtime)
    const result = (await tools.invoke('cad.disconnect', {
      from: 'RLOAD.1',
      to: 'D1.cathode',
    })) as CadObservation & { removedWires: string[] }
    expect(result.removedWires.length).toBeGreaterThan(0)
    const out = result.nets.find((net) => net.name === 'OUT')
    const pins = out?.pins ?? []
    expect(pins).toContain('D1.K')
    expect(pins).toContain('C1.1')
    expect(pins).not.toContain('RLOAD.1')
    expect(result.issues).toEqual([])
  })

  it('runs ERC and flags an unconnected new terminal', async () => {
    const runtime = demoRuntime()
    const tools = createCadToolset(runtime)
    const clean = (await tools.invoke('cad.erc')) as CadErcOutput
    expect(clean.passed).toBe(true)
    expect(clean.unconnectedTerminals).toEqual([])

    await tools.invoke('cad.addPart', { symbol: 'Resistor', reference: 'R9' })
    const dirty = (await tools.invoke('cad.erc')) as CadErcOutput
    expect(dirty.unconnectedTerminals).toEqual(['R9.1', 'R9.2'])
  })

  it('exports the solved sheet as a SPICE deck', async () => {
    const tools = createCadToolset(demoRuntime())
    const deck = (await tools.invoke('cad.exportNetlist', { format: 'spice' })) as { deck: string }
    expect(deck.deck).toContain('* Agent export')
    expect(deck.deck).toContain('RLOAD')
    expect(deck.deck).toContain('.op')
  })

  it('refuses to short two differently named nets', async () => {
    const tools = createCadToolset(demoRuntime())
    await expect(
      tools.invoke('cad.connect', { from: 'D1.cathode', to: 'RSRC.1' }),
    ).rejects.toThrow(/shorts two named nets/)
  })
})

describe('closed-loop autopilot', () => {
  it('tunes the filter on the live canvas, measures every iteration, and rests on the best design', async () => {
    const runtime = demoRuntime()
    const events: number[] = []
    const result = await runAutopilot({
      runtime,
      goal: {
        description: 'Minimise settled output ripple on the demo rectifier.',
        analysis: QUICK_TRANSIENT,
        metric: { waveform: 'V(OUT)', statistic: 'ripple', settled: true },
        direction: 'minimize',
        knobs: [{ reference: 'C1', property: 'value', from: 2e-6, to: 470e-6, scale: 'log' }],
      },
      samplesPerKnob: 4,
      refineSteps: 1,
      maxIterations: 8,
      onEvent: (iteration) => events.push(iteration.iteration),
    })

    expect(result.achieved).toBe(true)
    expect(result.iterations.length).toBeGreaterThanOrEqual(3)
    expect(events.length).toBe(result.iterations.length)
    expect(result.baselineMetric).toBeDefined()
    expect(result.best?.metric).toBeDefined()
    expect(result.best!.metric!).toBeLessThan(result.baselineMetric!)

    const successful = result.iterations.filter((iteration) => iteration.error === undefined)
    for (const iteration of successful) {
      expect(iteration.schematicSvg).toContain('<svg')
      expect(iteration.waveformSvg).toContain('<svg')
      expect(iteration.fingerprint).toMatch(/^[0-9a-f]+$/)
    }
    expect(successful.some((iteration) => iteration.assessment)).toBe(true)

    const capacitor = runtime.read().components.find((component) => component.reference === 'C1')!
    expect(parseSpiceValue(capacitor.properties['value'], 'C1.value')).toBeGreaterThan(1e-5)
    expect(result.reason).toMatch(/Improved/)

    // The restored design is the one the cached result belongs to.
    const tools = createCadToolset(runtime)
    const assessment = (await tools.invoke('cad.assess')) as CadAssessmentOutput
    expect(assessment.fingerprint).toBe(result.fingerprint)
  })
})

describe('model-driven agent loop', () => {
  it('refreshes the observation before every decision and audits each call', async () => {
    const runtime = demoRuntime()
    const harness = new AgentHarness()
    registerCadTools(harness, runtime)
    const budget = { maxCalls: 8, maxWallMs: 30_000, startedAt: Date.now() }
    const seen: number[] = []

    const result = await runAgentLoop({
      harness,
      budget,
      decide: ({ step, observation }) => {
        seen.push(observation.stats.components)
        if (step === 0) {
          return { tool: 'cad.setProperty', args: { reference: 'C1', property: 'value', value: '22uF' } }
        }
        return { done: true, summary: 'C1 updated after seeing the sheet.' }
      },
    })

    expect(result.done).toBe(true)
    expect(seen).toEqual([6, 6])
    expect(harness.auditTrail().map((call) => call.tool)).toEqual([
      'cad.observe', 'cad.setProperty', 'cad.observe',
    ])
    const capacitor = runtime.read().components.find((component) => component.reference === 'C1')!
    expect(capacitor.properties['value']).toBe('22uF')
  })

  it('stops at the budget instead of looping forever', async () => {
    const harness = new AgentHarness()
    registerCadTools(harness, demoRuntime())
    const budget = { maxCalls: 3, maxWallMs: 30_000, startedAt: Date.now() }
    const result = await runAgentLoop({
      harness,
      budget,
      maxSteps: 5,
      decide: () => ({ tool: 'cad.undo' }),
    })
    expect(result.done).toBe(false)
    expect(result.summary).toMatch(/budget exhausted/i)
    expect(harness.auditTrail().length).toBe(3)
  })
})
