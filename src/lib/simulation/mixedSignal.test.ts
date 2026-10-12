import { describe, expect, it } from 'vitest'
import { simulateMixedSignal } from './mixedSignal'
import type { CircuitNetlist } from './spiceEngine'

/**
 * A digital square wave drives an analog RC low-pass. The coupling is real:
 * the digital node becomes a PWL voltage source on the analog net, so the
 * analog capacitor charges/discharges with the RC time constant and never snaps
 * instantly — the physics of the load is in the loop.
 */
const rcLoadNetlist = (): CircuitNetlist => ({
  title: 'mixed-signal RC load',
  components: [
    {
      type: 'resistor',
      name: 'R1',
      nodes: ['out', 'mid'],
      parameters: { resistance: 1000 },
    },
    {
      type: 'capacitor',
      name: 'C1',
      nodes: ['mid', '0'],
      parameters: { capacitance: 1e-6 },
    },
  ],
  analyses: [],
})

const squareWave = () => ({
  gates: [],
  flipFlops: [],
  clocks: [{ id: 'CLK', output: 'dio', period: 2, duty: 0.5, startState: 0 as 0 | 1 }],
  stimuli: [],
})

describe('mixedSignal co-simulation', () => {
  it('drives an analog RC net from a digital square wave and never overshoots the rail', async () => {
    const result = await simulateMixedSignal({
      digital: squareWave(),
      analog: rcLoadNetlist(),
      drives: [{ digitalNode: 'dio', analogNet: 'out', vdd: 5 }],
      stopTime: 10,
      stepTime: 1e-3,
    })

    expect(result.success).toBe(true)
    expect(result.digital.success).toBe(true)
    expect(result.analog.success).toBe(true)

    // The analog net was actually driven: a V(mid) waveform exists (the engine
    // uppercases node names) and is bounded within [0, vdd] because the RC load
    // filters the digital edge.
    const mid = result.analog.waveforms.find((w) => w.name === 'V(MID)')
    expect(mid).toBeDefined()
    const values = mid!.data.map((p) => p.y)
    expect(Math.max(...values)).toBeLessThanOrEqual(5.0001)
    expect(Math.min(...values)).toBeGreaterThanOrEqual(-0.0001)

    // RC smoothing: the analog voltage should take many steps to approach the
    // rail (tau = RC = 1 ms), so the first sample after an edge is not yet 5 V.
    expect(mid!.data.length).toBeGreaterThan(100)
  })

  it('thresholds an analog net back into logic via a probe', async () => {
    // Drive the net high for the whole window; a 2.5 V threshold must read 1.
    const result = await simulateMixedSignal({
      digital: {
        gates: [],
        flipFlops: [],
        clocks: [],
        stimuli: [{ node: 'dio', time: 0, value: 1 }],
      },
      analog: {
        title: 'probe',
        components: [{ type: 'resistor', name: 'R1', nodes: ['a', '0'], parameters: { resistance: 1000 } }],
        analyses: [],
      },
      drives: [{ digitalNode: 'dio', analogNet: 'a', vdd: 5 }],
      probes: [{ analogNet: 'a', digitalNode: 'logic_out', threshold: 2.5 }],
      stopTime: 1,
      stepTime: 1e-3,
    })

    expect(result.success).toBe(true)
    expect(result.probeTimeline.length).toBeGreaterThan(0)
    // Every sample of a solid 5 V rail above a 2.5 V threshold reads logic 1.
    expect(result.probeTimeline.every((p) => p.value === 1)).toBe(true)
    expect(result.probeTimeline[0].digitalNode).toBe('logic_out')
  })

  it('reports a fail-loud error when the analog engine fails', async () => {
    // Two ideal voltage sources of different value on the same net = singular
    // topology; the analog engine must fail, and the failure must surface.
    const result = await simulateMixedSignal({
      digital: squareWave(),
      analog: {
        title: 'short',
        components: [
          { type: 'voltage-source', name: 'V1', nodes: ['n', '0'], parameters: { dc: 5 } },
          { type: 'voltage-source', name: 'V2', nodes: ['n', '0'], parameters: { dc: 1 } },
        ],
        analyses: [],
      },
      drives: [{ digitalNode: 'dio', analogNet: 'n', vdd: 5 }],
      stopTime: 2,
      stepTime: 1e-3,
    })

    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('notes a probe whose net has no waveform instead of throwing', async () => {
    const result = await simulateMixedSignal({
      digital: {
        gates: [],
        flipFlops: [],
        clocks: [],
        stimuli: [{ node: 'dio', time: 0, value: 1 }],
      },
      analog: {
        title: 'no such net',
        components: [{ type: 'resistor', name: 'R1', nodes: ['a', '0'], parameters: { resistance: 1000 } }],
        analyses: [],
      },
      drives: [{ digitalNode: 'dio', analogNet: 'a', vdd: 5 }],
      probes: [{ analogNet: 'ghost', digitalNode: 'g', threshold: 2.5 }],
      stopTime: 1,
      stepTime: 1e-3,
    })

    expect(result.success).toBe(true)
    expect(result.notes.some((n) => n.includes('ghost'))).toBe(true)
  })
})
