import { describe, it, expect } from 'vitest'
import { normalizeProbeRequest, normalizeProbeRequests, probeFromTestPoint, measureProbes } from './probes'

type Model = { devices: Array<{ kind: string; name: string; p: string; n: string; resistance?: number; dcCurrent?: number }>; branchRows: Map<string, number> }

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
    const model = { devices: [], branchRows: new Map() } as Model
    const res = measureProbes(model, [{ id: 'p', label: 'p', kind: 'node-voltage', node: 'N1' }], new Map([['N1', 5]]), new Map())
    expect(res[0].value).toBe(5)
  })
  it('measureProbes resistor current via ohms law', () => {
    const model = { devices: [{ kind: 'resistor', name: 'R1', p: 'A', n: 'B', resistance: 10 }], branchRows: new Map() } as Model
    const res = measureProbes(model, [{ id: 'p', label: 'p', kind: 'device-current', device: 'R1' }], new Map([['A', 10], ['B', 0]]), new Map())
    expect(res[0].value).toBe(1)
  })
})
