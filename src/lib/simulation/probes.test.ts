import { describe, it, expect } from 'vitest'
import { normalizeProbeRequest, normalizeProbeRequests, probeFromTestPoint, measureProbes } from './probes'
import type { ProbeModel, ProbeRequest } from './probes'

const model = (overrides: Partial<ProbeModel> = {}): ProbeModel => ({
  devices: [],
  branchRows: new Map(),
  nodeNames: ['N1'],
  groundNodes: new Set(['0']),
  ...overrides,
})
const voltageProbe = (node: string): ProbeRequest => ({ id: 'p', label: 'p', kind: 'node-voltage', node })

describe('probes', () => {
  it('normalizes node voltage probe', () => {
    const r = normalizeProbeRequest({ node: 'N1', kind: 'voltage' }, 0)
    expect(r.probe).toEqual({ id: 'N1', label: 'N1', kind: 'node-voltage', node: 'N1' })
  })
  it('normalizes device current probe', () => {
    const r = normalizeProbeRequest({ device: 'R1' }, 0)
    expect(r.probe).toEqual({ id: 'R1', label: 'R1', kind: 'device-current', device: 'R1' })
  })
  it('reports errors for missing refs', () => {
    const r = normalizeProbeRequest({}, 0)
    expect(r.error).toBeDefined()
  })
  it('normalizeProbeRequests collects errors', () => {
    const { probes, errors } = normalizeProbeRequests([{ node: 'A' }, {}])
    expect(probes.length).toBe(1)
    expect(errors.length).toBe(1)
  })
  it('probeFromTestPoint voltage', () => {
    const p = probeFromTestPoint({ name: 'TP1', nodes: ['N2'] })
    expect(p).toEqual({ id: 'TP1', label: 'TP1', kind: 'node-voltage', node: 'N2' })
  })
  it('probeFromTestPoint current', () => {
    const p = probeFromTestPoint({ name: 'TP2', nodes: ['N3'], parameters: { device: 'R2' } })
    expect(p).toEqual({ id: 'TP2', label: 'TP2', kind: 'device-current', device: 'R2' })
  })
  it('measureProbes node voltage', () => {
    const res = measureProbes(model(), [voltageProbe('N1')], new Map([['N1', 5]]), new Map())
    expect(res[0].value).toBe(5)
    expect(res[0].error).toBeUndefined()
  })
  it('measureProbes reports a solved 0 V net as 0 V, not as a failure', () => {
    const res = measureProbes(model(), [voltageProbe('N1')], new Map([['N1', 0]]), new Map())
    expect(res[0].value).toBe(0)
    expect(res[0].error).toBeUndefined()
  })
  it('measureProbes fails on a node that is not in the circuit', () => {
    /*
     * The old `voltages.get(node) ?? 0` answered 0 V for a typo'd net, which is
     * indistinguishable on the readout from a genuinely discharged one.
     */
    const res = measureProbes(model(), [voltageProbe('N9')], new Map([['N1', 0]]), new Map())
    expect(res[0].value).toBeNull()
    expect(res[0].error).toMatch(/Unknown node "N9"/)
    expect(res[0].error).toMatch(/not a net in this circuit/)
  })
  it('distinguishes a typo from a net that this analysis never solved', () => {
    const res = measureProbes(model({ nodeNames: ['N1', 'N2'] }), [voltageProbe('N2')], new Map([['N1', 1]]), new Map())
    expect(res[0].value).toBeNull()
    expect(res[0].error).toMatch(/is a net of this circuit but this analysis reports no voltage/)
  })
  it('reads ground as 0 V without needing a solution entry', () => {
    const res = measureProbes(
      model({ nodeNames: [], groundNodes: new Set(['0', 'GND']) }),
      [voltageProbe('GND')],
      new Map(),
      new Map(),
    )
    expect(res[0].value).toBe(0)
    expect(res[0].error).toBeUndefined()
  })
  it('measureProbes resistor current via ohms law', () => {
    const m = model({
      devices: [{ kind: 'resistor', name: 'R1', p: 'A', n: 'B', resistance: 10 }],
      nodeNames: ['A', 'B'],
    })
    const res = measureProbes(m, [{ id: 'p', label: 'p', kind: 'device-current', device: 'R1' }], new Map([['A', 10], ['B', 0]]), new Map())
    expect(res[0].value).toBe(1)
  })
  it('fails a resistor probe whose terminals are not solved', () => {
    const m = model({
      devices: [{ kind: 'resistor', name: 'R1', p: 'A', n: 'B', resistance: 10 }],
      nodeNames: ['A'],
    })
    const res = measureProbes(m, [{ id: 'p', label: 'p', kind: 'device-current', device: 'R1' }], new Map([['A', 10]]), new Map())
    expect(res[0].value).toBeNull()
    expect(res[0].error).toMatch(/Unknown node "B"/)
  })
  it('measureProbes unknown device', () => {
    const res = measureProbes(model(), [{ id: 'p', label: 'p', kind: 'device-current', device: 'R9' }], new Map(), new Map())
    expect(res[0].value).toBeNull()
    expect(res[0].error).toMatch(/Unknown device R9/)
  })
})
