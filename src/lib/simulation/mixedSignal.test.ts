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

  it('scales digital ticks into analog seconds', async () => {
    /*
     * The digital deck's clock has a 2-tick period. At 1 ms per tick it runs
     * five cycles over the 10 ms analog window, so the first high phase starts
     * at 1 ms and a 1 ms RC (τ = R·C) reaches about 1.97 V by 1.5 ms. Without
     * the scale the edges would land at 1 s and 2 s — outside the window.
     */
    const result = await simulateMixedSignal({
      digital: squareWave(),
      analog: rcLoadNetlist(),
      drives: [{ digitalNode: 'dio', analogNet: 'out', vdd: 5 }],
      stopTime: 0.01,
      stepTime: 5e-5,
      timeScale: 1e-3,
    })

    expect(result.success).toBe(true)
    const mid = result.analog.waveforms.find((w) => w.name === 'V(MID)')
    expect(mid).toBeDefined()
    const times = mid!.data.map((p) => p.x)
    expect(Math.max(...times)).toBeLessThanOrEqual(0.010001)
    expect(Math.min(...times)).toBeGreaterThanOrEqual(0)

    const atOneAndAHalfMs = mid!.data.reduce((best, point) =>
      Math.abs(point.x - 1.5e-3) < Math.abs(best.x - 1.5e-3) ? point : best,
    )
    expect(atOneAndAHalfMs.y).toBeGreaterThan(1.8)
    expect(atOneAndAHalfMs.y).toBeLessThan(2.1)

    // A digital edge must be an edge, not a ramp across the whole half period:
    // the driving PWL source is low just before 1 ms and at the rail at 1 ms.
    const source = result.analog.waveforms.find((w) => w.name === 'V(OUT)')
    expect(source).toBeDefined()
    const nearest = (target: number) =>
      source!.data.reduce((best, point) =>
        Math.abs(point.x - target) < Math.abs(best.x - target) ? point : best,
      )
    expect(nearest(0.9e-3).y).toBeLessThan(0.5)
    expect(nearest(1e-3).y).toBeGreaterThan(4.5)
  })

  it('rejects a non-positive time scale instead of inventing a time base', async () => {
    await expect(
      simulateMixedSignal({
        digital: squareWave(),
        analog: rcLoadNetlist(),
        drives: [{ digitalNode: 'dio', analogNet: 'out', vdd: 5 }],
        stopTime: 10,
        stepTime: 1e-3,
        timeScale: 0,
      }),
    ).rejects.toThrow(/timeScale/)
  })

  it('rejects a non-positive window or step instead of simulating nothing', async () => {
    const base = {
      digital: squareWave(),
      analog: rcLoadNetlist(),
      drives: [{ digitalNode: 'dio', analogNet: 'out', vdd: 5 }],
    }
    const cases: Array<[number, number, RegExp]> = [
      [0, 1e-3, /stopTime/],
      [Number.NaN, 1e-3, /stopTime/],
      [10, 0, /stepTime/],
      [10, Number.NaN, /stepTime/],
    ]
    for (const [stopTime, stepTime, expected] of cases) {
      await expect(simulateMixedSignal({ ...base, stopTime, stepTime })).rejects.toThrow(expected)
    }
  })

  it('rejects a drive or probe that cannot be interpreted as a level', async () => {
    await expect(
      simulateMixedSignal({
        digital: squareWave(),
        analog: rcLoadNetlist(),
        drives: [{ digitalNode: 'dio', analogNet: 'out', vdd: Number.NaN }],
        stopTime: 10,
        stepTime: 1e-3,
      }),
    ).rejects.toThrow(/vdd/)
    await expect(
      simulateMixedSignal({
        digital: squareWave(),
        analog: rcLoadNetlist(),
        drives: [{ digitalNode: 'dio', analogNet: 'out', vdd: 5, rDrive: -10 }],
        stopTime: 10,
        stepTime: 1e-3,
      }),
    ).rejects.toThrow(/rDrive/)
    await expect(
      simulateMixedSignal({
        digital: squareWave(),
        analog: rcLoadNetlist(),
        drives: [{ digitalNode: 'dio', analogNet: 'out', vdd: 5 }],
        probes: [{ analogNet: 'out', digitalNode: 'd', threshold: Number.NaN }],
        stopTime: 10,
        stepTime: 1e-3,
      }),
    ).rejects.toThrow(/threshold/)
  })

  it('does not run the analog side when the digital simulation fails', async () => {
    const result = await simulateMixedSignal({
      digital: {
        gates: [{ id: 'g1', type: 'BUF', inputs: ['a'], output: 'y', delay: -1 }],
        stimuli: [{ node: 'a', time: 0, value: 1 }],
      },
      analog: rcLoadNetlist(),
      drives: [{ digitalNode: 'y', analogNet: 'out', vdd: 5 }],
      stopTime: 10,
      stepTime: 1e-3,
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/digital simulation failed/)
    expect(result.digital.success).toBe(false)
    expect(result.analog.success).toBe(false)
    expect(result.analog.waveforms).toEqual([])
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
