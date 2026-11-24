/**
 * Net probing for the sheet's hover preview. A wire stands for its whole net:
 * named copper spans every segment carrying that name, anonymous copper is the
 * one wire. The summary uses the same figures as the net inspector, so the HUD
 * and the dock can never disagree about pins, segments or length.
 */
import type { CanvasWire } from '../../stores/useProjectStore'

export interface NetProbe {
  name: string | null
  wires: CanvasWire[]
  pins: number
  segments: number
  length: number
}

export function probeNet(wires: CanvasWire[], wireId: string): NetProbe | null {
  const target = wires.find((wire) => wire.id === wireId)
  if (!target) return null
  const members = target.netName
    ? wires.filter((wire) => wire.netName === target.netName)
    : [target]
  const pins = new Set<string>()
  let segments = 0
  let length = 0
  for (const wire of members) {
    for (const connection of wire.connectedPins) {
      pins.add(`${connection.componentId}:${connection.pinId}`)
    }
    for (let index = 1; index < wire.points.length; index++) {
      const a = wire.points[index - 1]
      const b = wire.points[index]
      length += Math.hypot(b.x - a.x, b.y - a.y)
      segments++
    }
  }
  return { name: target.netName ?? null, wires: members, pins: pins.size, segments, length }
}
