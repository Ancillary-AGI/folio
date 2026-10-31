import { describe, expect, it } from 'vitest'
import { autoroute, buildRouterPads, routerGridMm, type RouterConfig, type RouterPad, type RouterResult } from './autorouter'
import { landShapeOf, polylineShapeDistanceMm, shapeGapMm } from '../geometry/landShape'
import type { LandShape } from '../geometry/landShape'
import type { Net, PlacedComponent, Point } from '../../types'

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

  it('escapes two 0.8 mm-pitch BGA lands that leave the package the same way', () => {
    // The ball map a fine-pitch package puts down holds two different nets 0.8 mm
    // apart with both of them escaping west. Their landing keepouts touch at this
    // pitch, so if the first net takes the cell between the lands the second is
    // walled in and comes back unrouted — which is the shape of the failure the
    // crystal pair showed on the laptop board.
    const fine: RouterConfig = { ...config, boardWidthMm: 20, boardHeightMm: 20, gridMm: 0.25, minSpacingMm: 0.15 }
    const pads: RouterPad[] = [
      { netId: 'XIN', componentId: 'U', pinId: '1', x: 10, y: 9.4, layer: 'F.Cu', padWidthMm: 0.4, padHeightMm: 0.4, padShape: 'rectangle' },
      { netId: 'XIN', componentId: 'U', pinId: '2', x: 1, y: 15, layer: 'F.Cu', padWidthMm: 0.4, padHeightMm: 0.4, padShape: 'rectangle' },
      { netId: 'XOUT', componentId: 'U', pinId: '3', x: 10, y: 10.2, layer: 'F.Cu', padWidthMm: 0.4, padHeightMm: 0.4, padShape: 'rectangle' },
      { netId: 'XOUT', componentId: 'U', pinId: '4', x: 1, y: 12, layer: 'F.Cu', padWidthMm: 0.4, padHeightMm: 0.4, padShape: 'rectangle' },
    ]

    const result = autoroute(pads, fine)

    expect(result.unrouted).toEqual([])
    // Copper of one net may not come closer to the other net's land than the
    // spacing rule, which is what a fab's short is measured by: the polyline is a
    // centreline, so half the trace width is added back before the comparison.
    const land = landShapeOf({ widthMm: 0.4, depthMm: 0.4, shape: 'rectangle' })
    for (const net of ['XIN', 'XOUT']) {
      const foreign = net === 'XIN' ? { x: 10, y: 10.2 } : { x: 10, y: 9.4 }
      for (const trace of result.traces.filter((t) => t.netId === net)) {
        expect(polylineShapeDistanceMm(trace.points, foreign, land)).toBeGreaterThanOrEqual(
          fine.minSpacingMm + trace.widthMm / 2,
        )
      }
    }
  })

  it('routes around a keep-out instead of through it', () => {
    const pads: RouterPad[] = [
      { netId: 'N1', componentId: 'A', pinId: '1', x: 2, y: 3, layer: 'F.Cu', padDiameterMm: 0.6 },
      { netId: 'N1', componentId: 'B', pinId: '1', x: 8, y: 3, layer: 'F.Cu', padDiameterMm: 0.6 },
    ]
    const keepout = { xMm: 4, yMm: 0, widthMm: 2, heightMm: 6 }
    const result = autoroute(pads, { ...config, keepouts: [keepout] })

    expect(result.unrouted).toEqual([])
    const region = landShapeOf({ widthMm: keepout.widthMm, depthMm: keepout.heightMm, shape: 'rectangle' })
    const centre = { x: keepout.xMm + keepout.widthMm / 2, y: keepout.yMm + keepout.heightMm / 2 }
    // The reservation bars a trace centre out to the rule's gap; every routed
    // point must stand that far from the reserved edge.
    const minimum = config.minSpacingMm + config.minTraceWidthMm / 2
    for (const trace of result.traces) {
      expect(polylineShapeDistanceMm(trace.points, centre, region)).toBeGreaterThanOrEqual(minimum - 1e-9)
    }
  })

  it('leaves a net unrouted when a keep-out seals its only channel', () => {
    const pads: RouterPad[] = [
      { netId: 'N1', componentId: 'A', pinId: '1', x: 2, y: 5, layer: 'F.Cu', padDiameterMm: 0.6 },
      { netId: 'N1', componentId: 'B', pinId: '1', x: 8, y: 5, layer: 'F.Cu', padDiameterMm: 0.6 },
    ]
    // A full-height band bars both copper layers, so a detour or a via cannot
    // finish the net — which is exactly what the keep-out is for.
    const result = autoroute(pads, {
      ...config,
      keepouts: [{ xMm: 4.5, yMm: 0, widthMm: 1, heightMm: 10 }],
    })

    expect(result.unrouted).toEqual(['N1'])
  })

  it('bars vias from a keep-out that names no routed layer, yet lets traces cross', () => {
    // An inner-plane keep-out must not close the face the router works on, but a
    // drill through the stackup would break out inside it, so the barrel has to
    // land outside the band.
    const pads: RouterPad[] = [
      { netId: 'N1', componentId: 'A', pinId: '1', x: 2, y: 5, layer: 'F.Cu', padDiameterMm: 0.6 },
      { netId: 'N1', componentId: 'B', pinId: '1', x: 8, y: 5, layer: 'B.Cu', padDiameterMm: 0.6 },
    ]
    const result = autoroute(pads, {
      ...config,
      keepouts: [{ xMm: 4, yMm: 0, widthMm: 2, heightMm: 10, layers: [] }],
    })

    expect(result.unrouted).toEqual([])
    const viaGap = config.minSpacingMm + config.viaPadMm / 2
    for (const via of result.vias) {
      expect(via.x <= 4 - viaGap + 1e-9 || via.x >= 6 + viaGap - 1e-9).toBe(true)
    }
    // The same copper had to get from one side of the band to the other, so at
    // least one trace point lies inside the region that still blocks drills.
    expect(result.traces.some(trace => trace.points.some(point => point.x > 4 && point.x < 6))).toBe(true)
  })

  it('rejects a keep-out on a layer the router does not have', () => {
    expect(() => autoroute([], {
      ...config,
      keepouts: [{ xMm: 1, yMm: 1, widthMm: 2, heightMm: 2, layers: ['In1.Cu'] }],
    })).toThrow(/not a routing layer/)
    expect(() => autoroute([], {
      ...config,
      keepouts: [{ xMm: 1, yMm: 1, widthMm: 0, heightMm: 2 }],
    })).toThrow(/no area/)
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

describe('routerGridMm', () => {
  it('keeps the cell inside the rule it is protecting', () => {
    expect(routerGridMm(0.2, 0.2)).toBe(0.2)
    expect(routerGridMm(0.15, 0.2)).toBe(0.15)
    expect(routerGridMm(0.2, 0.15)).toBe(0.15)
  })

  it('caps a coarse rule at 0.5 mm and floors a finer one at 0.05 mm', () => {
    expect(routerGridMm(0.9, 0.7)).toBe(0.5)
    expect(routerGridMm(0.04, 0.02)).toBe(0.05)
  })

  it('snaps a rule that is not a whole step down, never up', () => {
    // Rounding up would put the cell back outside the clearance it resolves.
    expect(routerGridMm(0.13, 0.2)).toBe(0.1)
  })
})

/**
 * A finer rule set than the shared `config`: these exercise clearance against a
 * land's real outline, which needs sub-millimetre cells to be visible at all.
 */
const fineConfig: RouterConfig = {
  boardWidthMm: 20,
  boardHeightMm: 20,
  layers: ['F.Cu', 'B.Cu'],
  gridMm: 0.1,
  minTraceWidthMm: 0.2,
  minSpacingMm: 0.2,
  viaDrillMm: 0.3,
  viaPadMm: 0.6,
  viaPenalty: 6,
}

describe('land keepouts follow the real copper', () => {
  it('reserves a long thin land as its rectangle, not as a disc around its long edge', () => {
    // U1's land at (10, 10) is 0.3 x 1.5 mm standing across the corridor B needs.
    // A disc around it reserves max(w, h)/2 + clearance = 1.05 mm, which refuses a
    // trace 1.0 mm away; the rectangle only reserves 0.15 + 0.3 sideways, so the
    // gap IPC actually allows becomes routable.
    const pads: RouterPad[] = [
      { netId: 'A', componentId: 'U1', pinId: '1', x: 10, y: 10, layer: 'F.Cu', padWidthMm: 0.3, padHeightMm: 1.5, padShape: 'rectangle' },
      { netId: 'A', componentId: 'U1', pinId: '2', x: 4, y: 10, layer: 'F.Cu', padWidthMm: 0.3, padHeightMm: 1.5, padShape: 'rectangle' },
      { netId: 'B', componentId: 'R1', pinId: '1', x: 11, y: 2, layer: 'F.Cu', padDiameterMm: 0.6 },
      { netId: 'B', componentId: 'R1', pinId: '2', x: 11, y: 18, layer: 'F.Cu', padDiameterMm: 0.6 },
    ]

    const result = autoroute(pads, fineConfig)

    expect(result.unrouted).toEqual([])
    const bPoints = result.traces.filter((trace) => trace.netId === 'B').flatMap((trace) => trace.points)
    expect(bPoints.length).toBeGreaterThan(0)
    // Inside the 1.05 mm disc the old model would have reserved: the corridor is
    // only reachable because the keepout is anisotropic.
    expect(bPoints.some((point) => Math.hypot(point.x - 10, point.y - 10) < 1.05)).toBe(true)
  })

  it('reserves the same copper as a disc when the caller names no outline', () => {
    // Contrast case for the test above: identical land size declared only as a
    // diameter, so the conservative disc applies and 1.0 mm is inside it.
    const pads: RouterPad[] = [
      { netId: 'A', componentId: 'U1', pinId: '1', x: 10, y: 10, layer: 'F.Cu', padDiameterMm: 1.5 },
      { netId: 'A', componentId: 'U1', pinId: '2', x: 4, y: 10, layer: 'F.Cu', padDiameterMm: 1.5 },
      { netId: 'B', componentId: 'R1', pinId: '1', x: 11, y: 2, layer: 'F.Cu', padDiameterMm: 0.6 },
      { netId: 'B', componentId: 'R1', pinId: '2', x: 11, y: 18, layer: 'F.Cu', padDiameterMm: 0.6 },
    ]

    const result = autoroute(pads, fineConfig)

    expect(result.unrouted).toEqual([])
    for (const point of result.traces.filter((trace) => trace.netId === 'B').flatMap((trace) => trace.points)) {
      expect(Math.hypot(point.x - 10, point.y - 10)).toBeGreaterThanOrEqual(1.05 - 1e-9)
    }
  })

  it('rotates the land outline with the part so the reservation stays on the land', () => {
    // The same 0.3 x 1.5 mm land turned through 90° lies *along* the corridor, so
    // the wide 1.5 mm dimension is what blocks it. Rotation is part of the shape,
    // not a detail the keepout may ignore.
    const pads: RouterPad[] = [
      { netId: 'A', componentId: 'U1', pinId: '1', x: 10, y: 10, layer: 'F.Cu', padWidthMm: 0.3, padHeightMm: 1.5, padShape: 'rectangle', padRotationDeg: 90 },
      { netId: 'A', componentId: 'U1', pinId: '2', x: 4, y: 10, layer: 'F.Cu', padWidthMm: 0.3, padHeightMm: 1.5, padShape: 'rectangle', padRotationDeg: 90 },
      { netId: 'B', componentId: 'R1', pinId: '1', x: 11, y: 2, layer: 'F.Cu', padDiameterMm: 0.6 },
      { netId: 'B', componentId: 'R1', pinId: '2', x: 11, y: 18, layer: 'F.Cu', padDiameterMm: 0.6 },
    ]

    const result = autoroute(pads, fineConfig)

    expect(result.unrouted).toEqual([])
    // Land edge now 0.75 mm toward B plus 0.3 mm clearance: copper may not come
    // inside 1.05 mm of the pad centre along the corridor axis.
    for (const point of result.traces.filter((trace) => trace.netId === 'B').flatMap((trace) => trace.points)) {
      if (Math.abs(point.y - 10) > 1e-9) continue
      expect(Math.abs(point.x - 10)).toBeGreaterThanOrEqual(1.05 - 1e-9)
    }
  })

  it('reserves a plated through-hole on every routing layer, not just its own', () => {
    // A drilled land is a copper barrel through the whole stackup. Reserving only
    // the layer the pad was placed on let a bottom-side trace cross straight over
    // it, which is a short the router reported as clean.
    const pads: RouterPad[] = [
      { netId: 'A', componentId: 'C1', pinId: '1', x: 10, y: 10, layer: 'F.Cu', padDiameterMm: 1.9, padDrillMm: 0.9 },
      { netId: 'A', componentId: 'C1', pinId: '2', x: 10, y: 16, layer: 'F.Cu', padDiameterMm: 1.9, padDrillMm: 0.9 },
      { netId: 'B', componentId: 'R1', pinId: '1', x: 4, y: 10, layer: 'B.Cu', padDiameterMm: 0.6 },
      { netId: 'B', componentId: 'R1', pinId: '2', x: 16, y: 10, layer: 'B.Cu', padDiameterMm: 0.6 },
    ]

    const result = autoroute(pads, fineConfig)

    expect(result.unrouted).toEqual([])
    // Pad edge (0.95) + clearance (0.2) + trace half-width (0.1) = 1.25 mm.
    for (const point of result.traces.filter((trace) => trace.netId === 'B').flatMap((trace) => trace.points)) {
      expect(Math.hypot(point.x - 10, point.y - 10)).toBeGreaterThanOrEqual(1.25 - 1e-9)
    }
  })

  it('leaves an unplated surface land clear on the other copper layer', () => {
    // The mirror of the case above: a pure SMD land has no barrel, so the bottom
    // layer is genuinely free over it. Blocking that too would cost escapes the
    // board does not need to give up.
    const pads: RouterPad[] = [
      { netId: 'A', componentId: 'U1', pinId: '1', x: 10, y: 10, layer: 'F.Cu', padWidthMm: 1.0, padHeightMm: 1.0, padShape: 'rectangle' },
      { netId: 'A', componentId: 'U1', pinId: '2', x: 10, y: 16, layer: 'F.Cu', padWidthMm: 1.0, padHeightMm: 1.0, padShape: 'rectangle' },
      { netId: 'B', componentId: 'R1', pinId: '1', x: 4, y: 10, layer: 'B.Cu', padDiameterMm: 0.6 },
      { netId: 'B', componentId: 'R1', pinId: '2', x: 16, y: 10, layer: 'B.Cu', padDiameterMm: 0.6 },
    ]

    const result = autoroute(pads, fineConfig)

    expect(result.unrouted).toEqual([])
    const crossed = result.traces
      .filter((trace) => trace.netId === 'B' && trace.layerId === 'B.Cu')
      .flatMap((trace) => trace.points)
      .some((point) => Math.hypot(point.x - 10, point.y - 10) < 0.2)
    expect(crossed).toBe(true)
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

  it('carries the land outline, plating and rotation the clearance model needs', () => {
    const component = {
      id: 'c1',
      componentId: 'capacitor',
      component: {
        id: 'capacitor',
        name: 'Capacitor',
        category: 'capacitor',
        symbol: { width: 40, height: 20, paths: [] },
        pins: [
          { id: 'p1', name: '1', x: 0, y: 10, type: 'passive' },
          { id: 'p2', name: '2', x: 40, y: 10, type: 'passive' },
        ],
        properties: {},
      },
      position: { x: 20, y: 20 },
      rotation: 90,
      scale: 0.1,
      reference: 'C1',
      properties: { footprint: 'ELEC-6.3' },
    } as PlacedComponent
    const nets = [
      {
        id: 'N1',
        name: 'N1',
        connectedPins: [
          { componentId: 'c1', pinId: 'p1' },
          { componentId: 'c1', pinId: 'p2' },
        ],
        wires: [],
      },
    ] as Net[]

    const pads = buildRouterPads([component], nets)

    // A 6.3 mm electrolytic can is plated: without the drill the router reserves
    // only the top layer and routes the back straight through the barrel.
    expect(pads[0].padShape).toBe('circle')
    expect(pads[0].padWidthMm).toBeCloseTo(1.9, 9)
    expect(pads[0].padHeightMm).toBeCloseTo(1.9, 9)
    expect(pads[0].padDrillMm).toBeCloseTo(0.9, 9)
    expect(pads[0].padRotationDeg).toBe(90)
    expect(pads[0].layer).toBe('F.Cu')
  })
})

/**
 * The copper a router pad prints, in the shared outline model that the DRC and
 * the plane-stitch planner also measure.
 */
function landOf(pad: RouterPad): LandShape {
  const diameterMm = pad.padDiameterMm ?? 1.6
  return landShapeOf({
    widthMm: pad.padWidthMm ?? diameterMm,
    depthMm: pad.padHeightMm ?? diameterMm,
    shape: pad.padShape ?? 'circle',
    rotationDeg: pad.padRotationDeg,
  })
}

/**
 * Audit the copper one run produced against every land it does not own, at the
 * gap the declared rules ask for.
 *
 * This is the invariant the rip-up pass broke when it left the blocked net's own
 * pads open while re-routing a victim: the replacement ran straight through those
 * pads, and the board reported itself clean because the checker that looked only
 * at copper-to-copper never saw the land's reservation. Traces of a net that did
 * not finish are audited too — partial copper is still copper on the board.
 */
function assertClearOfForeignLands(pads: RouterPad[], result: RouterResult, cfg: RouterConfig): void {
  for (const trace of result.traces) {
    for (const land of pads) {
      if (land.netId === trace.netId) continue
      // An unplated SMD land is copper on its own layer only, so another layer is
      // genuinely free above it. A plated one has a barrel through the stackup.
      if ((land.padDrillMm ?? 0) === 0 && land.layer !== trace.layerId) continue
      const gap = polylineShapeDistanceMm(trace.points as Point[], { x: land.x, y: land.y }, landOf(land))
      expect(gap, `trace of ${trace.netId} versus land ${land.componentId}:${land.pinId}`).toBeGreaterThanOrEqual(
        cfg.minSpacingMm + trace.widthMm / 2 - 1e-9,
      )
    }
  }
  for (const via of result.vias) {
    // A committed via landing is copper on every routing layer, exactly like the
    // drilled land the reservation treats it as.
    const landing: LandShape = { kind: 'circle', radiusMm: via.padMm / 2 }
    for (const land of pads) {
      if (land.netId === via.netId) continue
      const gap = shapeGapMm(landing, landOf(land), land.x - via.x, land.y - via.y)
      expect(gap, `via of ${via.netId} versus land ${land.componentId}:${land.pinId}`).toBeGreaterThanOrEqual(
        cfg.minSpacingMm - 1e-9,
      )
    }
  }
}

/**
 * Fourteen nets crossing an 18 x 18 mm board. The arrangement is frozen from a
 * seeded sweep rather than generated here, because it is the shape where the
 * greedy short-first order starves a net that lifting a neighbour can free: seven
 * nets finish in the greedy pass, eight with one rip-up sweep.
 */
const congestedConfig: RouterConfig = {
  boardWidthMm: 18,
  boardHeightMm: 18,
  layers: ['F.Cu', 'B.Cu'],
  gridMm: 0.5,
  minTraceWidthMm: 0.2,
  minSpacingMm: 0.2,
  viaDrillMm: 0.3,
  viaPadMm: 0.6,
  viaPenalty: 8,
}

const congestedPads: RouterPad[] = [
  [17, 4.5, 10.5, 11], [17, 14.5, 15.5, 2], [15.5, 8, 8.5, 12], [2.5, 15, 13.5, 17.5],
  [16, 9.5, 6.5, 8.5], [5.5, 10.5, 16, 6], [8.5, 15.5, 9.5, 3.5], [8.5, 6, 14, 17.5],
  [6, 9, 17, 10], [9.5, 12.5, 3, 3], [9.5, 3, 17.5, 14], [2.5, 10.5, 12, 12],
  [5, 16.5, 11, 13.5], [6, 3, 6, 10],
].flatMap(([ax, ay, bx, by], index) => ([
  { netId: `R${index}`, componentId: `R${index}A`, pinId: '1', x: ax, y: ay, layer: 'F.Cu', padDiameterMm: 0.6 },
  { netId: `R${index}`, componentId: `R${index}B`, pinId: '1', x: bx, y: by, layer: 'F.Cu', padDiameterMm: 0.6 },
]))

describe('rip-up keeps the copper it lifts legal', () => {
  it('recovers a net the greedy order starved and never loses one it had finished', () => {
    const greedy = autoroute(congestedPads, { ...congestedConfig, ripUpPasses: 0 })
    const ripped = autoroute(congestedPads, congestedConfig)

    expect(greedy.stats.routedNets).toBe(7)
    expect(ripped.stats.routedNets).toBe(8)
    // Every attempt is all or nothing, so a lifted net that cannot come back puts
    // the board back exactly as it was: the unrouted set can only shrink.
    expect(ripped.unrouted.filter((netId) => !greedy.unrouted.includes(netId))).toEqual([])
    assertClearOfForeignLands(congestedPads, ripped, congestedConfig)
  })

  it('keeps lifted copper out of a fine-pitch land row it re-routes beside', () => {
    // Two facing rows of 0.8 mm-pitch lands, one turned through 30°, with nets
    // escaping from each. The bands of adjacent lands overlap, so the only legal
    // escapes are around the row ends — and a victim re-routed inside a window
    // that was opened for another net's search laid copper straight into them.
    const row = (side: 'top' | 'bottom', y: number, far: number): RouterPad[] =>
      Array.from({ length: 6 }, (_, index) => {
        const x = 7.6 + index * 0.8
        const netId = `${side}${index}`
        return [
          {
            netId, componentId: `U1`, pinId: String(index + 1), x, y, layer: 'F.Cu',
            padWidthMm: 0.3, padHeightMm: 1.5, padShape: 'rectangle' as const,
            padRotationDeg: index === 2 ? 30 : 0,
          },
          {
            netId, componentId: `R${netId}`, pinId: '1', x: 4 + index * 2.4, y: far, layer: 'F.Cu',
            padDiameterMm: 0.6,
          },
        ]
      }).flat()
    const pads: RouterPad[] = [...row('bottom', 11, 17), ...row('top', 9, 3)]

    const result = autoroute(pads, fineConfig)

    expect(result.traces.length).toBeGreaterThan(0)
    assertClearOfForeignLands(pads, result, fineConfig)
  })

  it('rejects a rip-up budget that is not a whole number of sweeps', () => {
    expect(() => autoroute([], { ...config, ripUpPasses: 1.5 })).toThrow(/ripUpPasses must be a whole number/)
    expect(() => autoroute([], { ...config, ripUpVictims: -1 })).toThrow(/ripUpVictims must be a whole number/)
  })
})
