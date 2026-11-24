/**
 * Netlist interchange proofs.
 * The bridge must round-trip a simulated circuit through KiCad/EAGLE without
 * changing its connectivity, and reject anything it cannot represent instead
 * of dropping a terminal.
 */
import { describe, expect, it } from 'vitest'
import type { CanvasComponent, CanvasWire } from '../../stores/useProjectStore'
import { buildCircuitNetlist } from './netlistBuilder'
import {
  circuitToInterchange,
  interchangeStats,
  interchangeToSheet,
  parseInterchangeText,
} from './netlistInterchange'
import { emitKicadNetlist } from '../manufacturing/kicadNetlist'
import { serializeEagleSchematic } from '../manufacturing/eagleSchematic'

const part = (id: string, reference: string, name: string): CanvasComponent => ({
  id,
  componentId: `${id}-library`,
  component: {
    name,
    category: 'passive',
    is_standard: true,
    symbol_data: { width: 60, height: 30, paths: [] },
    pins: [
      { id: '1', name: '1', x: 0, y: 15, type: 'passive' },
      { id: '2', name: '2', x: 60, y: 15, type: 'passive' },
    ],
    default_properties: {},
  },
  x: 100,
  y: 100,
  rotation: 0,
  reference,
  properties: {},
})

const wire = (id: string, netName: string, pins: CanvasWire['connectedPins']): CanvasWire => ({
  id,
  points: [],
  netName,
  connectedPins: pins,
})

const divider = () => {
  const components = [
    { ...part('v1', 'V1', 'Voltage Source'), properties: { value: '5' } },
    { ...part('r1', 'R1', 'Resistor'), properties: { value: '1k' } },
    { ...part('r2', 'R2', 'Resistor'), properties: { value: '2k' } },
  ]
  const wires = [
    wire('w-in', 'IN', [
      { componentId: 'v1', pinId: '1' },
      { componentId: 'r1', pinId: '1' },
    ]),
    wire('w-out', 'OUT', [
      { componentId: 'r1', pinId: '2' },
      { componentId: 'r2', pinId: '1' },
    ]),
    wire('w-gnd', 'GND', [
      { componentId: 'v1', pinId: '2' },
      { componentId: 'r2', pinId: '2' },
    ]),
  ]
  return buildCircuitNetlist('divider', components, wires, { type: 'dc' })
}

describe('netlist interchange', () => {
  it('projects a circuit onto components and named nets, dropping unconnected pins', () => {
    const netlist = divider()
    netlist.components.push({ type: 'resistor', name: 'R9', nodes: ['NC_R9_1', 'OUT'], parameters: { value: '10' } })
    const interchange = circuitToInterchange(netlist)

    expect(interchange.components.map((c) => c.ref)).toEqual(['V1', 'R1', 'R2', 'R9'])
    expect(interchange.components[0].value).toBe('5')
    expect(interchange.nets.map((n) => n.name).sort()).toEqual(['GND', 'IN', 'OUT'])
    const r9Nets = interchange.nets.flatMap((n) => n.nodes.filter((node) => node.ref === 'R9'))
    expect(r9Nets).toEqual([{ ref: 'R9', pin: '2' }])
    expect(interchangeStats(interchange)).toEqual({ components: 4, nets: 3, pins: 7 })
  })

  it('round-trips connectivity through the KiCad emitter and parser', () => {
    const original = divider()
    const sheet = interchangeToSheet('round trip', parseInterchangeText(emitKicadNetlist(original)).netlist)
    const rebuilt = buildCircuitNetlist('rebuilt', sheet.components, sheet.wires, { type: 'dc' })

    expect(rebuilt.components).toHaveLength(original.components.length)
    for (const component of original.components) {
      const match = rebuilt.components.find((candidate) => candidate.name === component.name)
      expect(match).toBeDefined()
      expect(match!.type).toBe(component.type)
      expect(match!.nodes).toEqual(component.nodes)
      expect(match!.parameters.value).toBe(component.parameters.value)
    }
  })

  it('round-trips through EAGLE XML', () => {
    const interchange = circuitToInterchange(divider())
    const parsed = parseInterchangeText(serializeEagleSchematic(interchange))
    expect(parsed.format).toBe('eagle')
    expect(parsed.netlist.components.map((c) => c.ref).sort()).toEqual(['R1', 'R2', 'V1'])
    const out = parsed.netlist.nets.find((net) => net.name === 'OUT')
    expect(out?.nodes).toEqual([
      { ref: 'R1', pin: '2' },
      { ref: 'R2', pin: '1' },
    ])
  })

  it('rejects parts it cannot represent instead of truncating them', () => {
    expect(() =>
      interchangeToSheet('amp', {
        components: [{ ref: 'Q1', value: '2N3904', footprint: '' }],
        nets: [],
      }),
    ).toThrow(/Q1: unsupported import/)

    expect(() =>
      interchangeToSheet('led', {
        components: [{ ref: 'LED1', value: 'red', footprint: '' }],
        nets: [],
      }),
    ).toThrow(/unsupported import/)
  })

  it('rejects a pin claimed by two nets and a valueless part', () => {
    expect(() =>
      interchangeToSheet('short', {
        components: [{ ref: 'R1', value: '1k', footprint: '' }],
        nets: [
          { code: '1', name: 'A', nodes: [{ ref: 'R1', pin: '1' }] },
          { code: '2', name: 'B', nodes: [{ ref: 'R1', pin: '1' }] },
        ],
      }),
    ).toThrow(/pin 1 is on both net A and net B/)

    expect(() =>
      interchangeToSheet('blank', {
        components: [{ ref: 'R1', value: '', footprint: '' }],
        nets: [],
      }),
    ).toThrow(/no value/)
  })

  it('detects the format from the document root', () => {
    expect(() => parseInterchangeText('R1 1 2 1k')).toThrow(/unrecognised netlist/i)
    expect(() => parseInterchangeText('   ')).toThrow(/empty/i)
  })
})
