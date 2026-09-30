import { describe, expect, it } from 'vitest'
import type { CanvasComponent, CanvasWire } from '../../stores/useProjectStore'
import { buildCircuitNetlist } from './netlistBuilder'

const placed = (id: string, reference: string, name: string, pinIds: string[]): CanvasComponent => ({
  id,
  componentId: `${id}-library`,
  component: {
    name,
    category: 'passive',
    is_standard: true,
    symbol_data: { width: 40, height: 20, paths: [] },
    pins: pinIds.map((pinId, index) => ({
      id: pinId,
      name: `Pin ${index + 1}`,
      x: index * 10,
      y: 0,
      type: 'passive' as const,
    })),
    default_properties: {},
  },
  x: 0,
  y: 0,
  rotation: 0,
  reference,
  properties: { value: '1k' },
})

const wire = (id: string, connections: CanvasWire['connectedPins'], netName?: string): CanvasWire => ({
  id,
  points: [],
  connectedPins: connections,
  netName,
})

describe('buildCircuitNetlist', () => {
  it('maps all pins on one wire to a shared node', () => {
    const result = buildCircuitNetlist('divider', [
      placed('r1', 'R1', 'Resistor', ['1', '2']),
      placed('r2', 'R2', 'Resistor', ['1', '2']),
    ], [
      wire('middle', [
        { componentId: 'r1', pinId: '2' },
        { componentId: 'r2', pinId: '1' },
      ]),
    ], { type: 'dc' })

    expect(result.components[0].nodes[1]).toBe(result.components[1].nodes[0])
  })

  it('merges wires joined at a pin and normalizes ground labels', () => {
    const result = buildCircuitNetlist('joined nets', [placed('r1', 'R1', 'Resistor', ['1', '2'])], [
      wire('first', [{ componentId: 'r1', pinId: '1' }]),
      wire('second', [{ componentId: 'r1', pinId: '1' }, { componentId: 'r1', pinId: '2' }], 'GND'),
    ], { type: 'dc' })

    expect(result.components[0].nodes).toEqual(['0', '0'])
  })

  it('rejects contradictory names on electrically connected wires', () => {
    expect(() => buildCircuitNetlist('bad nets', [placed('r1', 'R1', 'Resistor', ['1'])], [
      wire('first', [{ componentId: 'r1', pinId: '1' }], 'NET_A'),
      wire('second', [{ componentId: 'r1', pinId: '1' }], 'NET_B'),
    ], { type: 'dc' })).toThrow(/conflicting net names/i)
  })
})