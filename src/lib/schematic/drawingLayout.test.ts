import { describe, expect, it } from 'vitest'
import { componentBounds, layoutNetLabels, overlaps } from './drawingLayout'
import type { CanvasComponent, CanvasWire } from '../../stores/useProjectStore'
import type { Component } from '../supabase'

const resistor: Component = {
  id: 'lib-r',
  name: 'Resistor',
  category: 'passive',
  is_standard: true,
  symbol_data: { width: 40, height: 20, paths: [] },
  pins: [
    { id: '1', name: 'A', x: 0, y: 10, type: 'passive' },
    { id: '2', name: 'B', x: 40, y: 10, type: 'passive' },
  ],
  default_properties: {},
}

const placed = (x: number, y: number): CanvasComponent => ({
  id: 'r1',
  componentId: 'lib-r',
  component: resistor,
  x,
  y,
  rotation: 0,
  reference: 'R1',
  properties: {},
})

const wire = (id: string, netName: string | undefined, points: CanvasWire['points']): CanvasWire => ({
  id,
  ...(netName === undefined ? {} : { netName }),
  points,
  connectedPins: [],
})

describe('layoutNetLabels', () => {
  it('labels every named net and none of the anonymous copper', () => {
    const labels = layoutNetLabels(
      [
        wire('a', 'VCC', [{ x: 0, y: 0 }, { x: 200, y: 0 }]),
        wire('b', 'GND', [{ x: 0, y: 120 }, { x: 200, y: 120 }]),
        wire('c', undefined, [{ x: 0, y: 240 }, { x: 100, y: 240 }]),
      ],
      [],
    )

    expect(labels.map((label) => label.name).sort()).toEqual(['GND', 'VCC'])
  })

  it('anchors the name to the longest segment of the net', () => {
    const labels = layoutNetLabels(
      [
        wire('short', 'VCC', [{ x: 0, y: 0 }, { x: 20, y: 0 }]),
        wire('long', 'VCC', [{ x: 0, y: 80 }, { x: 200, y: 80 }]),
      ],
      [],
    )

    const [label] = labels
    expect(label.box.x + label.box.width / 2).toBeGreaterThan(80)
    expect(label.box.x + label.box.width / 2).toBeLessThan(120)
  })

  it('keeps labels off the parts and off each other', () => {
    const part = placed(80, -20)
    const labels = layoutNetLabels(
      [
        wire('a', 'VCC', [{ x: 0, y: 0 }, { x: 200, y: 0 }]),
        wire('b', 'GND', [{ x: 0, y: 40 }, { x: 200, y: 40 }]),
      ],
      [part],
    )

    const partBox = componentBounds(part)
    for (const label of labels) {
      expect(overlaps(label.box, partBox)).toBe(false)
    }
    const [first, second] = labels
    if (first && second) expect(overlaps(first.box, second.box)).toBe(false)
  })
})
