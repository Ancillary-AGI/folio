import { describe, expect, it } from 'vitest'
import { standardComponents } from './componentLibrary'
import { DEFAULT_SETTINGS } from './settings/registry'

/*
 * The sheet snaps part origins and wire ends to `DEFAULT_SETTINGS.gridSize`, and
 * a pin's world position is the origin plus its rotated offset, so a pin whose
 * offset is not a multiple of the grid can never have a drawn wire land on it:
 * the wire stops at the nearest intersection and the connection survives only
 * because hit-testing forgives the gap. A schematic is a machine drawing, so the
 * library itself has to sit on the grid it is placed on — and every pin it
 * declares has to be somewhere the symbol actually drew a lead.
 */
const GRID = DEFAULT_SETTINGS.gridSize

type Point = { x: number; y: number }
type Segment = { a: Point; b: Point }

/*
 * A symbol body is a list of SVG paths, and a pin is a coordinate. Nothing in
 * the type system joins them, so a symbol can declare a pin that no stroke
 * reaches: the wire snaps to the grid and stops in blank paper 10px from the
 * body, and only the generous hit-test hides it. Walking the paths into line
 * segments is how that gap gets measured.
 */
const NUMBER = /-?\d+(?:\.\d+)?/g

function pathSegments(path: string): Segment[] {
  const segments: Segment[] = []
  let subpathStart: Point | null = null
  let cursor: Point | null = null
  for (const command of path.split(/(?=[MLAVCQSTZ])/i)) {
    const letter = command[0]?.toUpperCase()
    if (!letter) continue
    const pairs: Point[] = []
    const numbers = [...command.slice(1).matchAll(NUMBER)].map((match) => Number(match[0]))
    for (let i = 0; i + 1 < numbers.length; i += 2) pairs.push({ x: numbers[i], y: numbers[i + 1] })
    if (letter === 'M') {
      subpathStart = pairs[0] ?? null
      cursor = pairs[0] ?? null
      for (let i = 1; i < pairs.length; i++) {
        if (cursor) segments.push({ a: cursor, b: pairs[i] })
        cursor = pairs[i]
      }
    } else if (letter === 'L') {
      for (const point of pairs) {
        if (cursor) segments.push({ a: cursor, b: point })
        cursor = point
      }
    } else if (letter === 'Z') {
      if (cursor && subpathStart) segments.push({ a: cursor, b: subpathStart })
      cursor = subpathStart
    } else if (numbers.length >= 2 && cursor) {
      // Arcs and Béziers end on their final two numbers; the chord to that point
      // is enough to prove a pin lands where the curve lands. (Pairing an arc's
      // seven numbers two-by-two would read its sweep flag as an x coordinate.)
      const endpoint = { x: numbers[numbers.length - 2], y: numbers[numbers.length - 1] }
      segments.push({ a: cursor, b: endpoint })
      cursor = endpoint
    }
  }
  return segments
}

function touchesGeometry(pin: Point, segments: Segment[]): boolean {
  return segments.some((segment) => {
    const dx = segment.b.x - segment.a.x
    const dy = segment.b.y - segment.a.y
    const lengthSquared = dx * dx + dy * dy
    const along = lengthSquared === 0 ? 0 : ((pin.x - segment.a.x) * dx + (pin.y - segment.a.y) * dy) / lengthSquared
    if (along < -0.0001 || along > 1.0001) return false
    return (
      Math.abs(segment.a.x + along * dx - pin.x) < 0.01 &&
      Math.abs(segment.a.y + along * dy - pin.y) < 0.01
    )
  })
}

const offGridPinDetail = () =>
  standardComponents
    .filter((part) => part.pins.some((pin) => pin.x % GRID !== 0 || pin.y % GRID !== 0))
    .map((part) =>
      `${part.name}: ${part.pins
        .filter((pin) => pin.x % GRID !== 0 || pin.y % GRID !== 0)
        .map((pin) => `${pin.name}@(${pin.x},${pin.y})`)
        .join(', ')}`,
    )
    .join(' | ')

describe('standard component library geometry', () => {
  it('is not empty and every part has pins', () => {
    expect(standardComponents.length).toBeGreaterThan(40)
    for (const part of standardComponents) {
      expect(part.pins.length, part.name).toBeGreaterThan(0)
    }
  })

  it('places every pin on the sheet grid, at any rotation', () => {
    // A 90° rotation swaps the two offsets, so both must be grid multiples.
    const offenders = standardComponents
      .filter((part) => part.pins.some((pin) => pin.x % GRID !== 0 || pin.y % GRID !== 0))
      .map((part) => part.name)
    expect(offenders, offGridPinDetail()).toEqual([])
  })

  it('draws every symbol body on the sheet grid', () => {
    const offenders = standardComponents
      .filter((part) => part.symbol_data.width % GRID !== 0 || part.symbol_data.height % GRID !== 0)
      .map((part) => `${part.name} ${part.symbol_data.width}x${part.symbol_data.height}`)
    expect(offenders).toEqual([])
  })

  it('anchors every pin to drawn geometry', () => {
    const offenders = standardComponents
      .filter((part) => {
        const segments = part.symbol_data.paths.flatMap(pathSegments)
        return part.pins.some((pin) => !touchesGeometry(pin, segments))
      })
      .map((part) => {
        const segments = part.symbol_data.paths.flatMap(pathSegments)
        return `${part.name}: ${part.pins
          .filter((pin) => !touchesGeometry(pin, segments))
          .map((pin) => `${pin.name}@(${pin.x},${pin.y})`)
          .join(', ')}`
      })
    expect(offenders).toEqual([])
  })
})
