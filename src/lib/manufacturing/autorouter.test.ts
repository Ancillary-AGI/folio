import { describe, expect, it } from 'vitest'
import { autoroute, buildRouterPads, type RouterConfig, type RouterPad } from './autorouter'
import type { Net, PlacedComponent } from '../../types'

const config: RouterConfig = {
  boardWidthMm: 10,
  boardHeightMm: 10,
  layers: ['F.Cu', 'B.Cu'],
  gridMm: 0.5,
  minTraceWidthMm: 0.2,
  minSpacingMm: 0.2,
  viaDrillMm: 0.3,
  viaPadMm: 0.6,
  viaPenalty: 8,
}

describe('autoroute', () => {
  it('routes a two-pad net across layers with exactly one via', () => {
    const pads: RouterPad[] = [
      { netId: 'N1', componentId: 'A', pinId: '1', x: 2, y: 2, layer: 'F.Cu' },
      { netId: 'N1', componentId: 'B', pinId: '1', x: 8, y: 8, layer: 'B.Cu' },
    ]

    const result = autoroute(pads, config)

    expect(result.unrouted).toEqual([])
    expect(result.completionRate).toBe(1)
    expect(result.vias).toHaveLength(1)
    expect(result.traces.length).toBeGreaterThan(0)
    for (const trace of result.traces) {
      expect(trace.points.length).toBeGreaterThanOrEqual(2)
      for (let i = 1; i < trace.points.length; i += 1) {
        const a = trace.points[i - 1]
        const b = trace.points[i]
        expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(0)
      }
    }
  })

  it('lands on off-grid pad centres without a zero-area stub', () => {
    // Pad A is 0.1 mm past the first grid node in the direction of travel.
    // Prepending the pad centre unconditionally drew 2.1 -> 2.0 -> 2.5, a
    // collinear reversal that DRC reports as a 0° acute-angle spike.
    const pads: RouterPad[] = [
      { netId: 'N1', componentId: 'A', pinId: '1', x: 2.1, y: 2, layer: 'F.Cu', padDiameterMm: 0.6 },
      { netId: 'N1', componentId: 'B', pinId: '1', x: 8, y: 2, layer: 'F.Cu', padDiameterMm: 0.6 },
    ]

    const result = autoroute(pads, config)

    expect(result.unrouted).toEqual([])
    const points = result.traces[0].points
    for (let i = 1; i < points.length - 1; i += 1) {
      const a = points[i - 1]
      const b = points[i]
      const c = points[i + 1]
      const ab = { x: b.x - a.x, y: b.y - a.y }
      const bc = { x: c.x - b.x, y: c.y - b.y }
      const reverses = ab.x * bc.x + ab.y * bc.y < 0 && Math.abs(ab.x * bc.y - ab.y * bc.x) < 1e-9
      expect(reverses, `vertex ${i} reverses along the same line`).toBe(false)
    }
    const start = points[0]
    const next = points[1]
    const pad = { x: 2.1, y: 2 }
    const onFirstSegment = Math.abs((next.x - start.x) * (pad.y - start.y) - (next.y - start.y) * (pad.x - start.x)) < 1e-9
      && pad.x >= Math.min(start.x, next.x) - 1e-9 && pad.x <= Math.max(start.x, next.x) + 1e-9
      && pad.y >= Math.min(start.y, next.y) - 1e-9 && pad.y <= Math.max(start.y, next.y) + 1e-9
    expect(onFirstSegment || Math.hypot(start.x - pad.x, start.y - pad.y) < 1e-9).toBe(true)
  })

  it('reports nets that cannot be connected without inventing a path', () => {
    // Both pads sit outside the board, so no legal grid cell exists.
    const pads: RouterPad[] = [
      { netId: 'N1', componentId: 'A', pinId: '1', x: -10, y: -10, layer: 'F.Cu' },
      { netId: 'N1', componentId: 'B', pinId: '1', x: 50, y: 50, layer: 'F.Cu' },
    ]

    const result = autoroute(pads, config)

    expect(result.unrouted).toEqual(['N1'])
    expect(result.traces).toEqual([])
    expect(result.completionRate).toBe(0)
  })

  it('never routes through a pad whose keepout overlaps another pad landing area', () => {
    // A routes first and owns the pad at (5,5). B's start pad at (5,3) has a
    // keepout that reaches into A's ring; releasing B's landing area must not
    // also release A's clearance, or the B trace cuts straight through it.
    const pads: RouterPad[] = [
      { netId: 'A', componentId: 'A1', pinId: '1', x: 2, y: 2, layer: 'F.Cu' },
      { netId: 'A', componentId: 'A2', pinId: '1', x: 5, y: 5, layer: 'F.Cu' },
      { netId: 'B', componentId: 'B1', pinId: '1', x: 5, y: 3, layer: 'F.Cu' },
      { netId: 'B', componentId: 'B2', pinId: '1', x: 5, y: 8, layer: 'F.Cu' },
    ]

    const result = autoroute(pads, config)

    expect(result.unrouted).toEqual([])
    const keepoutRadiusMm = Math.max(config.viaPadMm / 2, 0.8) + config.minSpacingMm + config.minTraceWidthMm / 2
    for (const trace of result.traces.filter(t => t.netId === 'B')) {
      for (const point of trace.points) {
        expect(Math.hypot(point.x - 5, point.y - 5)).toBeGreaterThanOrEqual(keepoutRadiusMm - 1e-9)
      }
    }
  })

  it('routes 1 mm-pitch SMD pads when the real pad copper is supplied', () => {
    // Without padDiameterMm the default 1.6 mm disc around each pin swallows
    // its neighbour, and both nets come back unrouted on a legal 0402 land.
    const pads: RouterPad[] = [
      { netId: 'A', componentId: 'A1', pinId: '1', x: 9.5, y: 10, layer: 'F.Cu', padDiameterMm: 0.6 },
      { netId: 'A', componentId: 'A2', pinId: '1', x: 59.5, y: 50, layer: 'F.Cu', padDiameterMm: 0.6 },
      { netId: 'B', componentId: 'A1', pinId: '2', x: 10.5, y: 10, layer: 'F.Cu', padDiameterMm: 0.6 },
      { netId: 'B', componentId: 'A2', pinId: '2', x: 60.5, y: 50, layer: 'F.Cu', padDiameterMm: 0.6 },
    ]

    const result = autoroute(pads, { ...config, boardWidthMm: 100, boardHeightMm: 80 })

    expect(result.unrouted).toEqual([])
    expect(new Set(result.traces.map((trace) => trace.netId))).toEqual(new Set(['A', 'B']))
  })

  it('rejects an invalid pad copper diameter', () => {
    const pad: RouterPad = { netId: 'N1', componentId: 'A', pinId: '1', x: 2, y: 2, layer: 'F.Cu', padDiameterMm: 0 }
    expect(() => autoroute([pad], config)).toThrow(/copper diameter/)
  })

  it('rejects a zero grid rather than reporting every net unrouted', () => {
    expect(() => autoroute([], { ...config, gridMm: 0 })).toThrow(/gridMm must be a positive/)
    expect(() => autoroute([], { ...config, boardWidthMm: Number.NaN })).toThrow(
      /boardWidthMm must be a positive/,
    )
  })

  it('rejects duplicate or empty layer names', () => {
    expect(() => autoroute([], { ...config, layers: [] })).toThrow(/at least one copper layer/)
    expect(() => autoroute([], { ...config, layers: ['F.Cu', 'F.Cu'] })).toThrow(/unique/)
  })

  it('rejects a via pad smaller than its drill', () => {
    expect(() => autoroute([], { ...config, viaDrillMm: 0.6, viaPadMm: 0.3 })).toThrow(
      /cannot be smaller/,
    )
  })

  it('rejects pads on a layer the router does not have', () => {
    const pads: RouterPad[] = [
      { netId: 'N1', componentId: 'A', pinId: '1', x: 2, y: 2, layer: 'In1.Cu' },
      { netId: 'N1', componentId: 'B', pinId: '1', x: 8, y: 8, layer: 'F.Cu' },
    ]
    expect(() => autoroute(pads, config)).toThrow(/not a routing layer/)
  })

  it('rejects non-finite pad coordinates instead of searching forever', () => {
    const pads: RouterPad[] = [
      { netId: 'N1', componentId: 'A', pinId: '1', x: Number.NaN, y: 2, layer: 'F.Cu' },
      { netId: 'N1', componentId: 'B', pinId: '1', x: 8, y: 8, layer: 'F.Cu' },
    ]
    expect(() => autoroute(pads, config)).toThrow(/non-finite coordinates/)
  })
})

describe('buildRouterPads', () => {
  it('applies placement, rotation and scale to pin coordinates', () => {
    const component = {
      id: 'c1',
      componentId: 'resistor',
      component: {
        id: 'resistor',
        name: 'Resistor',
        category: 'passive',
        symbol: { width: 40, height: 20, paths: [] },
        pins: [{ id: 'p1', name: '1', x: 10, y: 0, type: 'passive' }],
        properties: {},
      },
      position: { x: 100, y: 100 },
      rotation: 90,
      scale: 2,
      reference: 'R1',
      properties: {},
    } as PlacedComponent
    const nets = [
      { id: 'N1', name: 'N1', connectedPins: [{ componentId: 'c1', pinId: 'p1' }], wires: [] },
    ] as Net[]

    const [pad] = buildRouterPads([component], nets)

    expect(pad.x).toBeCloseTo(100, 9)
    expect(pad.y).toBeCloseTo(120, 9)
  })

  it('uses footprint land geometry, rotated with the package, when a package exists', () => {
    const component = {
      id: 'r1',
      componentId: 'resistor',
      component: {
        id: 'resistor',
        name: 'Resistor',
        category: 'passive',
        symbol: { width: 80, height: 30, paths: [] },
        pins: [
          { id: 'p1', name: '1', x: 0, y: 15, type: 'passive' },
          { id: 'p2', name: '2', x: 80, y: 15, type: 'passive' },
        ],
        properties: {},
      },
      position: { x: 20, y: 10 },
      rotation: 90,
      scale: 0.1,
      reference: 'R1',
      properties: { footprint: '0805' },
    } as PlacedComponent
    const nets = [
      {
        id: 'N1',
        name: 'N1',
        connectedPins: [
          { componentId: 'r1', pinId: 'p1' },
          { componentId: 'r1', pinId: 'p2' },
        ],
        wires: [],
      },
    ] as Net[]

    const pads = buildRouterPads([component], nets)

    expect(pads).toHaveLength(2)
    // 0805 pads are 1.8 mm apart — not the 8 mm symbol span.
    expect(pads[0].x).toBeCloseTo(20, 9)
    expect(pads[0].y).toBeCloseTo(9.1, 9)
    expect(pads[1].x).toBeCloseTo(20, 9)
    expect(pads[1].y).toBeCloseTo(10.9, 9)
    expect(pads[0].padDiameterMm).toBeCloseTo(1.0, 9)
    expect(pads[0].layer).toBe('F.Cu')
  })
})
