import { describe, expect, it } from 'vitest'
import {
  commitHistory,
  createHistory,
  distanceToSegment,
  HISTORY_DEPTH,
  keepoutAt,
  nearestLand,
  ratsnest,
  rectFromCorners,
  redoHistory,
  sameCopperLayer,
  snapToGrid,
  traceAt,
  undoHistory,
  viaAt,
  type EditableTrace,
  type EditableVia,
} from './boardEdit'
import type { RouterPad } from '../manufacturing/autorouter'

function pad(overrides: Partial<RouterPad> & { netId: string, x: number, y: number }): RouterPad {
  return {
    componentId: 'U1',
    pinId: '1',
    layer: 'F.Cu',
    ...overrides,
  }
}

function trace(overrides: Partial<EditableTrace> & { id: string, points: EditableTrace['points'] }): EditableTrace {
  return { layerId: 'top-cu', width: 0.25, netName: 'VIN', ...overrides }
}

function via(overrides: Partial<EditableVia> & { id: string, position: EditableVia['position'] }): EditableVia {
  return { netName: 'VIN', padDiameter: 0.6, drillDiameter: 0.3, ...overrides }
}

describe('snapToGrid', () => {
  it('rounds to the nearest crossing of the requested grid', () => {
    expect(snapToGrid({ x: 7.24, y: 3.71 }, 0.5)).toEqual({ x: 7.0, y: 3.5 })
    expect(snapToGrid({ x: 7.26, y: 3.76 }, 0.5)).toEqual({ x: 7.5, y: 4.0 })
  })

  it('leaves the point alone when the grid is not a usable size', () => {
    expect(snapToGrid({ x: 1.234, y: 5.678 }, 0)).toEqual({ x: 1.234, y: 5.678 })
  })

  it('snaps negative coordinates towards zero rather than away from it', () => {
    expect(snapToGrid({ x: -0.24, y: -0.26 }, 0.5)).toEqual({ x: 0, y: -0.5 })
  })

  it('returns the grid value itself, not a binary-arithmetical approximation', () => {
    // 504 steps of 0.1 mm is 50.400000000000006 in float; a snapped coordinate
    // is exported into Gerber text, so the tail has to go.
    expect(snapToGrid({ x: 50.44, y: 40.27 }, 0.1)).toEqual({ x: 50.4, y: 40.3 })
    expect(snapToGrid({ x: 0.75, y: 1.25 }, 0.25)).toEqual({ x: 0.75, y: 1.25 })
  })
})

describe('sameCopperLayer', () => {
  it('treats the panel and router names for one face as one layer', () => {
    expect(sameCopperLayer('top-cu', 'F.Cu')).toBe(true)
    expect(sameCopperLayer('bot-cu', 'B.Cu')).toBe(true)
  })

  it('keeps opposite faces and inner layers apart', () => {
    expect(sameCopperLayer('top-cu', 'B.Cu')).toBe(false)
    expect(sameCopperLayer('in1-cu', 'F.Cu')).toBe(false)
    expect(sameCopperLayer('in1-cu', 'in1-cu')).toBe(true)
    expect(sameCopperLayer(undefined, 'F.Cu')).toBe(false)
  })
})

describe('distanceToSegment', () => {
  it('measures perpendicular distance inside the span and radial distance past it', () => {
    const from = { x: 0, y: 0 }
    const to = { x: 10, y: 0 }
    expect(distanceToSegment({ x: 5, y: 2 }, from, to)).toBeCloseTo(2)
    expect(distanceToSegment({ x: 12, y: 0 }, from, to)).toBeCloseTo(2)
    expect(distanceToSegment({ x: 3, y: 4 }, from, from)).toBeCloseTo(5)
  })
})

describe('nearestLand', () => {
  const pads = [
    pad({ netId: 'VIN', x: 10, y: 10, pinId: '1' }),
    pad({ netId: 'GND', x: 10, y: 20, pinId: '2', layer: 'B.Cu', padDrillMm: 0.3 }),
    pad({ netId: 'V3', x: 10, y: 30, pinId: '3', layer: 'B.Cu' }),
  ]

  it('returns the land inside the grab radius and nothing outside it', () => {
    expect(nearestLand(pads, { x: 10.4, y: 10.2 }, 1.2)?.pinId).toBe('1')
    expect(nearestLand(pads, { x: 0, y: 0 }, 1.2)).toBeNull()
  })

  it('ignores a surface land on the far face but accepts a plated one', () => {
    expect(nearestLand(pads, { x: 10, y: 30 }, 1.2, 'top-cu')).toBeNull()
    expect(nearestLand(pads, { x: 10, y: 20 }, 1.2, 'top-cu')?.pinId).toBe('2')
  })
})

describe('traceAt and viaAt', () => {
  const traces = [
    trace({ id: 'a', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }),
    trace({ id: 'b', points: [{ x: 0, y: 5 }, { x: 10, y: 5 }] }),
  ]

  it('grabs the copper a click lands on and lets go of bare board', () => {
    expect(traceAt(traces, { x: 4, y: 0.1 }, 0.3)?.id).toBe('a')
    expect(traceAt(traces, { x: 4, y: 5.05 }, 0.3)?.id).toBe('b')
    expect(traceAt(traces, { x: 4, y: 2 }, 0.3)).toBeNull()
  })

  it('prefers the nearer of two traces within reach', () => {
    expect(traceAt(traces, { x: 4, y: 4.8 }, 0.5)?.id).toBe('b')
  })

  it('hits a via on its annular ring, not only on its centre', () => {
    const vias = [via({ id: 'v1', position: { x: 5, y: 5 } }), via({ id: 'v2', position: { x: 50, y: 50 } })]
    expect(viaAt(vias, { x: 5.2, y: 5 }, 0.1)?.id).toBe('v1')
    expect(viaAt(vias, { x: 50.1, y: 50 }, 0.1)?.id).toBe('v2')
    expect(viaAt(vias, { x: 20, y: 20 }, 0.1)).toBeNull()
  })

  it('cannot grab a point trace that has no length', () => {
    expect(traceAt([trace({ id: 'dot', points: [{ x: 1, y: 1 }] })], { x: 1, y: 1 }, 0.3)).toBeNull()
  })
})

describe('rectFromCorners', () => {
  it('turns any two drag corners into an origin-anchored rectangle', () => {
    expect(rectFromCorners({ x: 2, y: 3 }, { x: 8, y: 9 })).toEqual({ x: 2, y: 3, width: 6, height: 6 })
  })

  it('normalises a drag that runs up and to the left', () => {
    expect(rectFromCorners({ x: 8, y: 9 }, { x: 2, y: 3 })).toEqual({ x: 2, y: 3, width: 6, height: 6 })
  })

  it('keeps a zero-width drag as a zero-width rectangle so the caller can reject it', () => {
    expect(rectFromCorners({ x: 4, y: 4 }, { x: 4, y: 9 })).toEqual({ x: 4, y: 4, width: 0, height: 5 })
  })
})

describe('keepoutAt', () => {
  const keepouts = [
    { id: 'antenna', x: 10, y: 10, width: 10, height: 10, layers: [] },
    { id: 'ac', x: 30, y: 10, width: 4, height: 4, layers: ['top-cu'] },
  ]

  it('hits inside the rectangle and lets go outside it', () => {
    expect(keepoutAt(keepouts, { x: 15, y: 15 })?.id).toBe('antenna')
    expect(keepoutAt(keepouts, { x: 25, y: 15 })).toBeNull()
  })

  it('reaches the edge and only grows with the tolerance it is given', () => {
    expect(keepoutAt(keepouts, { x: 34, y: 12 })?.id).toBe('ac')
    expect(keepoutAt(keepouts, { x: 34.4, y: 12 })).toBeNull()
    expect(keepoutAt(keepouts, { x: 34.4, y: 12 }, 0.5)?.id).toBe('ac')
  })

  it('picks the keepout drawn last when two overlap', () => {
    const overlapping = [keepouts[0], { id: 'last', x: 12, y: 12, width: 6, height: 6, layers: [] }]
    expect(keepoutAt(overlapping, { x: 13, y: 13 })?.id).toBe('last')
  })
})

describe('ratsnest', () => {
  const corners = [
    pad({ netId: 'VIN', x: 10, y: 10, pinId: '1', componentId: 'J1' }),
    pad({ netId: 'VIN', x: 40, y: 10, pinId: '1', componentId: 'C1' }),
    pad({ netId: 'VIN', x: 70, y: 10, pinId: '1', componentId: 'C2' }),
  ]

  it('flies one line per land that has no copper, not one per pair', () => {
    const wires = ratsnest(corners, [], [])
    expect(wires).toHaveLength(2)
    expect(wires.every(wire => wire.netName === 'VIN')).toBe(true)
  })

  it('says nothing about a net whose lands are already joined', () => {
    const joined = [trace({ id: 't1', points: [{ x: 10, y: 10 }, { x: 70, y: 10 }] })]
    expect(ratsnest(corners, joined, [])).toEqual([])
  })

  it('counts a partial chain as one island, so two lines become one', () => {
    const half = [trace({ id: 't1', points: [{ x: 10, y: 10 }, { x: 40, y: 10 }] })]
    const wires = ratsnest(corners, half, [])
    expect(wires).toHaveLength(1)
    expect(wires[0].to).toEqual({ x: 70, y: 10 })
  })

  it('refuses to join a surface land to copper on the far face', () => {
    const split = [
      pad({ netId: 'SIG', x: 5, y: 5, pinId: '1', componentId: 'A' }),
      pad({ netId: 'SIG', x: 25, y: 5, pinId: '1', componentId: 'B', layer: 'B.Cu' }),
    ]
    const onTop = [trace({ id: 't1', netName: 'SIG', layerId: 'top-cu', points: [{ x: 5, y: 5 }, { x: 25, y: 5 }] })]
    expect(ratsnest(split, onTop, [])).toHaveLength(1)
  })

  it('joins through a via, because that is what a plated hole is for', () => {
    const split = [
      pad({ netId: 'SIG', x: 5, y: 5, pinId: '1', componentId: 'A' }),
      pad({ netId: 'SIG', x: 25, y: 5, pinId: '1', componentId: 'B', layer: 'B.Cu' }),
    ]
    const onTop = trace({ id: 't1', netName: 'SIG', layerId: 'top-cu', points: [{ x: 5, y: 5 }, { x: 15, y: 5 }] })
    const onBottom = trace({ id: 't2', netName: 'SIG', layerId: 'bot-cu', points: [{ x: 15, y: 5 }, { x: 25, y: 5 }] })
    const hop = via({ id: 'v1', netName: 'SIG', position: { x: 15, y: 5 } })
    expect(ratsnest(split, [onTop, onBottom], [hop])).toEqual([])
    expect(ratsnest(split, [onTop, onBottom], [])).toHaveLength(1)
  })

  it('does not count another net’s copper as a connection', () => {
    // The land sits right on the VIN run. Electrically it is still open — a short
    // to VIN is not a route — so the flyline has to stay on the board.
    const split = [
      pad({ netId: 'SIG', x: 5, y: 5, pinId: '1', componentId: 'A' }),
      pad({ netId: 'SIG', x: 25, y: 5, pinId: '1', componentId: 'B' }),
    ]
    const foreign = [trace({ id: 't1', netName: 'VIN', points: [{ x: 5, y: 5 }, { x: 25, y: 5 }] })]
    const foreignHop = via({ id: 'v1', netName: 'VIN', position: { x: 5, y: 5 } })
    expect(ratsnest(split, foreign, [])).toHaveLength(1)
    expect(ratsnest(split, foreign, [foreignHop])).toHaveLength(1)
  })

  it('keeps nets apart', () => {
    const mixed = [
      ...corners,
      pad({ netId: 'GND', x: 10, y: 40, pinId: '2', componentId: 'J1' }),
      pad({ netId: 'GND', x: 40, y: 40, pinId: '2', componentId: 'C1' }),
    ]
    const wires = ratsnest(mixed, [], [])
    expect(wires.filter(wire => wire.netName === 'VIN')).toHaveLength(2)
    expect(wires.filter(wire => wire.netName === 'GND')).toHaveLength(1)
  })

  it('ignores a single-land net — there is nothing to fly to', () => {
    expect(ratsnest([corners[0]], [], [])).toEqual([])
  })
})

describe('undo history', () => {
  it('walks back and forward through committed states', () => {
    let history = createHistory(1)
    history = commitHistory(history, 2)
    history = commitHistory(history, 3)
    expect(undoHistory(history).present).toBe(2)
    expect(undoHistory(undoHistory(history)).present).toBe(1)
    expect(redoHistory(undoHistory(history)).present).toBe(3)
  })

  it('drops the redo branch when a new edit follows an undo', () => {
    let history = commitHistory(commitHistory(createHistory('a'), 'b'), 'c')
    history = undoHistory(history)
    history = commitHistory(history, 'd')
    expect(history.present).toBe('d')
    expect(redoHistory(history).present).toBe('d')
    expect(history.past).toEqual(['a', 'b'])
  })

  it('is a no-op at the ends of the stack and on an unchanged value', () => {
    const history = createHistory('only')
    expect(undoHistory(history)).toBe(history)
    expect(redoHistory(history)).toBe(history)
    expect(commitHistory(history, history.present)).toBe(history)
  })

  it('caps its depth so a long session cannot grow without bound', () => {
    let history = createHistory(0)
    for (let step = 1; step <= HISTORY_DEPTH + 25; step += 1) history = commitHistory(history, step)
    expect(history.past).toHaveLength(HISTORY_DEPTH)
    expect(history.present).toBe(HISTORY_DEPTH + 25)
  })
})
