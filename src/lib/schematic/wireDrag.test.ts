/**
 * Wire-drag proofs: what a grabbed run and a grabbed junction do, and what
 * they must never do — tear a landed connection off its pin or turn the sheet
 * diagonal.
 */
import { describe, expect, it } from 'vitest'
import { applyWireDrag, hitWireHandle } from './wireDrag'
import type { CanvasWire } from '../../stores/useProjectStore'

const wire = (id: string, points: Array<{ x: number; y: number }>, netName = id): CanvasWire => ({
  id,
  points: points.map((point) => ({ ...point })),
  netName,
  connectedPins: [],
})

/** Every segment axis-aligned? A tidy sheet never contains a diagonal. */
const isOrthogonal = (points: Array<{ x: number; y: number }>): boolean =>
  points.slice(1).every((point, index) => {
    const previous = points[index]
    return Math.abs(previous.x - point.x) < 0.5 || Math.abs(previous.y - point.y) < 0.5
  })

const PIN_A = { x: 100, y: 50 }
const PIN_B = { x: 300, y: 50 }

describe('wire handle hit-test', () => {
  it('grabs the junction it is sitting on', () => {
    const sheet = [wire('w1', [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }])]
    const handle = hitWireHandle(sheet, { x: 101, y: 3 }, { tolerance: 8, nodeTolerance: 6 })
    expect(handle).toEqual({ kind: 'node', at: { x: 100, y: 0 } })
  })

  it('grabs the run when the pointer is away from every vertex', () => {
    const sheet = [wire('w1', [{ x: 0, y: 0 }, { x: 200, y: 0 }])]
    const handle = hitWireHandle(sheet, { x: 120, y: 4 }, { tolerance: 8, nodeTolerance: 6 })
    expect(handle).toEqual({ kind: 'segment', wireId: 'w1', index: 0 })
  })

  it('leaves a junction that sits on a pin to the part drag', () => {
    const sheet = [wire('w1', [PIN_A, { x: 200, y: 50 }])]
    const handle = hitWireHandle(
      sheet,
      { x: 100, y: 50 },
      { tolerance: 8, nodeTolerance: 6, terminals: [PIN_A] },
    )
    expect(handle).toEqual({ kind: 'segment', wireId: 'w1', index: 0 })
  })

  it('misses when the pointer is on empty sheet', () => {
    const sheet = [wire('w1', [{ x: 0, y: 0 }, { x: 200, y: 0 }])]
    expect(hitWireHandle(sheet, { x: 40, y: 40 }, { tolerance: 8, nodeTolerance: 6 })).toBeNull()
  })
})

describe('pulling a straight run', () => {
  it('slides sideways and stretches the neighbour along its own axis', () => {
    const sheet = [wire('w1', [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }])]
    const dragged = applyWireDrag(sheet, { kind: 'segment', wireId: 'w1', index: 0 }, { x: 40, y: 30 })
    // The free end rides the run; the vertical leg keeps its bottom and lengthens.
    expect(dragged[0].points).toEqual([
      { x: 0, y: 30 },
      { x: 100, y: 30 },
      { x: 100, y: 100 },
    ])
    expect(isOrthogonal(dragged[0].points)).toBe(true)
  })

  it('takes the whole collinear run, not just the segment grabbed', () => {
    const sheet = [wire('w1', [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 80 }])]
    const dragged = applyWireDrag(sheet, { kind: 'segment', wireId: 'w1', index: 1 }, { x: 0, y: 20 })
    // The redundant vertices on one straight line collapse; the lift survives.
    expect(dragged[0].points).toEqual([
      { x: 0, y: 20 },
      { x: 120, y: 20 },
      { x: 120, y: 80 },
    ])
  })

  it('slides a whole vertical run sideways, the same way as a horizontal one', () => {
    const sheet = [wire('w1', [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 30 },
      { x: 100, y: 60 },
      { x: 40, y: 60 },
    ])]
    const dragged = applyWireDrag(sheet, { kind: 'segment', wireId: 'w1', index: 2 }, { x: 30, y: 0 })
    // The three stacked vertices are ONE run, so they all move and the middle
    // collapses; the horizontal legs at either end stretch to stay joined.
    expect(dragged[0].points).toEqual([
      { x: 0, y: 0 },
      { x: 130, y: 0 },
      { x: 130, y: 60 },
      { x: 40, y: 60 },
    ])
    expect(isOrthogonal(dragged[0].points)).toBe(true)
  })

  it('dog-legs off the pins instead of pulling the ends off them', () => {
    const sheet: CanvasWire[] = [
      {
        ...wire('w1', [PIN_A, PIN_B], 'VCC'),
        connectedPins: [
          { componentId: 'U1', pinId: 'out' },
          { componentId: 'C1', pinId: 'a' },
        ],
      },
    ]
    const dragged = applyWireDrag(
      sheet,
      { kind: 'segment', wireId: 'w1', index: 0 },
      { x: 0, y: 30 },
      { grid: 10, terminals: [PIN_A, PIN_B, { x: 250, y: 200 }] },
    )
    expect(dragged[0].points).toEqual([
      { x: 100, y: 50 },
      { x: 110, y: 50 },
      { x: 110, y: 80 },
      { x: 290, y: 80 },
      { x: 290, y: 50 },
      { x: 300, y: 50 },
    ])
    expect(dragged[0].netName).toBe('VCC')
    expect(dragged[0].connectedPins).toHaveLength(2)
  })

  it('ignores motion along the run and leaves the net untouched', () => {
    const sheet = [wire('w1', [{ x: 0, y: 0 }, { x: 100, y: 0 }])]
    const dragged = applyWireDrag(sheet, { kind: 'segment', wireId: 'w1', index: 0 }, { x: 55, y: 0 })
    expect(dragged[0].points).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ])
  })

  it('keeps every other wire on the sheet', () => {
    const sheet = [wire('w1', [{ x: 0, y: 0 }, { x: 100, y: 0 }]), wire('w2', [{ x: 0, y: 40 }, { x: 100, y: 40 }])]
    const dragged = applyWireDrag(sheet, { kind: 'segment', wireId: 'w1', index: 0 }, { x: 0, y: 10 })
    expect(dragged).toHaveLength(2)
    expect(dragged[1].points).toEqual([
      { x: 0, y: 40 },
      { x: 100, y: 40 },
    ])
  })
})

describe('pulling a node', () => {
  it('moves every wire that shares the junction and re-corners the legs', () => {
    const sheet = [
      wire('w1', [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], 'A'),
      wire('w2', [{ x: 100, y: 0 }, { x: 220, y: 0 }], 'A'),
    ]
    const dragged = applyWireDrag(sheet, { kind: 'node', at: { x: 100, y: 0 } }, { x: 20, y: 30 })
    expect(dragged[0].points).toEqual([
      { x: 0, y: 0 },
      { x: 120, y: 0 },
      { x: 120, y: 100 },
      { x: 100, y: 100 },
    ])
    expect(dragged[1].points).toEqual([
      { x: 120, y: 30 },
      { x: 220, y: 30 },
      { x: 220, y: 0 },
    ])
    for (const wire of dragged) expect(isOrthogonal(wire.points)).toBe(true)
    expect(dragged[0].netName).toBe('A')
  })

  it('stretches a straight wire when its free end is pulled off-axis', () => {
    const sheet = [wire('w1', [{ x: 0, y: 0 }, { x: 100, y: 0 }])]
    const dragged = applyWireDrag(sheet, { kind: 'node', at: { x: 100, y: 0 } }, { x: 40, y: 50 })
    expect(dragged[0].points).toEqual([
      { x: 0, y: 0 },
      { x: 140, y: 0 },
      { x: 140, y: 50 },
    ])
  })

  it('a zero move changes nothing and clones nothing over the original', () => {
    const sheet = [wire('w1', [{ x: 0, y: 0 }, { x: 100, y: 0 }])]
    const dragged = applyWireDrag(sheet, { kind: 'node', at: { x: 0, y: 0 } }, { x: 0, y: 0 })
    expect(dragged[0].points).toEqual(sheet[0].points)
    expect(dragged[0].points).not.toBe(sheet[0].points)
  })

  it('leaves the untouched sheet alone', () => {
    const sheet = [wire('w1', [{ x: 0, y: 0 }, { x: 100, y: 0 }])]
    const dragged = applyWireDrag(sheet, { kind: 'node', at: { x: 500, y: 500 } }, { x: 10, y: 10 })
    expect(dragged[0].points).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ])
  })
})

describe('diagonal fallback', () => {
  it('moves the whole wire when the grabbed segment has no axis', () => {
    const sheet = [wire('w1', [{ x: 0, y: 0 }, { x: 50, y: 30 }, { x: 50, y: 90 }])]
    const dragged = applyWireDrag(sheet, { kind: 'segment', wireId: 'w1', index: 0 }, { x: 10, y: 20 })
    expect(dragged[0].points).toEqual([
      { x: 10, y: 20 },
      { x: 60, y: 50 },
      { x: 60, y: 110 },
    ])
  })
})
