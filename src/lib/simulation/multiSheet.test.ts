/**
 * Multi-sheet netlist proofs.
 * Two sheets stitched by a global OUT label; locals stay private;
 * duplicate references rejected.
 */
import { describe, expect, it } from 'vitest'
import type { CanvasComponent, CanvasWire } from '../../stores/useProjectStore'
import { buildMultiSheetNetlist } from './multiSheet'

const placed = (id: string, reference: string, pinIds: string[]): CanvasComponent => ({
  id,
  componentId: `${id}-library`,
  component: {
    name: 'Resistor',
    category: 'passive',
    is_standard: true,
    symbol_data: { width: 40, height: 20, paths: [] },
    pins: pinIds.map((pinId, index) => ({ id: pinId, name: `Pin ${index + 1}`, x: index * 10, y: 0, type: 'passive' as const })),
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

describe('buildMultiSheetNetlist', () => {
  it('stitches a global label across sheets into one node', () => {
    const result = buildMultiSheetNetlist('two sheets', [
      {
        name: 'amp',
        components: [placed('r1', 'R1', ['1', '2'])],
        wires: [wire('w1', [{ componentId: 'r1', pinId: '2' }], 'OUT')],
      },
      {
        name: 'load',
        components: [placed('r2', 'R2', ['1', '2'])],
        wires: [wire('w2', [{ componentId: 'r2', pinId: '1' }], 'OUT')],
      },
    ], { type: 'dc' })
    expect(result.components).toHaveLength(2)
    // Both sheets' OUT pins land on the same global node.
    expect(result.components[0].nodes[1]).toBe('OUT')
    expect(result.components[1].nodes[0]).toBe('OUT')
  })

  it('keeps same-named local nets sheet-private', () => {
    const result = buildMultiSheetNetlist('locals', [
      {
        name: 'a',
        components: [placed('r1', 'R1', ['1', '2'])],
        wires: [wire('w1', [{ componentId: 'r1', pinId: '2' }], 'MID')],
      },
      {
        name: 'b',
        components: [placed('r2', 'R2', ['1', '2'])],
        wires: [wire('w2', [{ componentId: 'r2', pinId: '1' }], 'MID')],
      },
    ], { type: 'dc' })
    expect(result.components[0].nodes[1]).not.toBe(result.components[1].nodes[0])
  })

  it('rejects duplicate references across sheets', () => {
    expect(() => buildMultiSheetNetlist('dup', [
      { name: 'a', components: [placed('r1', 'R1', ['1'])], wires: [] },
      { name: 'b', components: [placed('r2', 'R1', ['1'])], wires: [] },
    ], { type: 'dc' })).toThrow(/duplicate reference/i)
  })
})
