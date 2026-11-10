import { describe, expect, it } from 'vitest'
import type { CanvasWire } from '../../stores/useProjectStore'
import { probeNet } from './netProbe'

const wire = (
  id: string,
  netName: string | undefined,
  points: CanvasWire['points'],
  connectedPins: CanvasWire['connectedPins'],
): CanvasWire => ({
  id,
  ...(netName === undefined ? {} : { netName }),
  points,
  connectedPins,
})

const wires: CanvasWire[] = [
  wire('w1', 'GND', [{ x: 0, y: 0 }, { x: 40, y: 0 }], [{ componentId: 'a', pinId: '1' }]),
  wire('w2', 'GND', [{ x: 40, y: 0 }, { x: 40, y: 30 }], [
    { componentId: 'a', pinId: '1' },
    { componentId: 'b', pinId: '2' },
  ]),
  wire('w3', undefined, [{ x: 0, y: 50 }, { x: 10, y: 50 }], [{ componentId: 'c', pinId: '3' }]),
]

describe('probeNet', () => {
  it('spans every segment of a named net and counts each pin once', () => {
    expect(probeNet(wires, 'w1')).toMatchObject({
      name: 'GND',
      pins: 2,
      segments: 2,
      length: 70,
    })
    expect(probeNet(wires, 'w1')?.wires.map((entry) => entry.id)).toEqual(['w1', 'w2'])
  })

  it('treats anonymous copper as the one wire that carries it', () => {
    expect(probeNet(wires, 'w3')).toMatchObject({
      name: null,
      pins: 1,
      segments: 1,
      length: 10,
    })
    expect(probeNet(wires, 'w3')?.wires.map((entry) => entry.id)).toEqual(['w3'])
  })

  it('returns nothing for a wire that is no longer on the sheet', () => {
    expect(probeNet(wires, 'gone')).toBeNull()
  })
})
