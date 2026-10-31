import { describe, expect, it } from 'vitest'
import { edgeDistanceMm, landShapeOf, polylineShapeDistanceMm, shapeCircumRadiusMm, shapeGapMm } from './landShape'

/**
 * The arithmetic every clearance decision in the tool rests on, checked against
 * distances that can be worked out by hand.
 *
 * The router reserves this outline, the stitch planner sizes a ring against it and
 * the DRC audits it, so a wrong number here is a board that prints shorted and a
 * checker that calls it clean. Each expectation below is the geometry itself — a
 * stadium's tip is `halfSpan + radius` from its centre, a rectangle's reach is the
 * hypot of its half-extents — not a figure copied out of a run.
 */
describe('landShapeOf', () => {
  it('takes a circle from its largest axis', () => {
    // Reading the small axis would under-clear the copper that exists.
    expect(landShapeOf({ widthMm: 1.4, depthMm: 0.6, shape: 'circle' })).toEqual({ kind: 'circle', radiusMm: 0.7 })
  })

  it('keeps a rectangle in the land frame with the placement rotation', () => {
    expect(landShapeOf({ widthMm: 1.2, depthMm: 0.4, shape: 'rectangle', rotationDeg: 90 })).toEqual({
      kind: 'rectangle', halfWidthMm: 0.6, halfHeightMm: 0.2, rotationRad: Math.PI / 2,
    })
  })

  it('turns a stadium whose long axis is its depth by 90 degrees', () => {
    const long = landShapeOf({ widthMm: 2, depthMm: 0.6, shape: 'oval' })
    expect(long).toEqual({ kind: 'oval', halfSpanMm: 0.7, radiusMm: 0.3, rotationRad: 0 })
    const tall = landShapeOf({ widthMm: 0.6, depthMm: 2, shape: 'oval', rotationDeg: 30 })
    expect(tall).toEqual({
      kind: 'oval', halfSpanMm: 0.7, radiusMm: 0.3, rotationRad: (30 * Math.PI) / 180 + Math.PI / 2,
    })
  })

  it('sizes a square land the same from either axis', () => {
    expect(landShapeOf({ widthMm: -0.6, depthMm: 0.6, shape: 'rectangle' })).toEqual({
      kind: 'rectangle', halfWidthMm: 0.3, halfHeightMm: 0.3, rotationRad: 0,
    })
  })
})

describe('edgeDistanceMm', () => {
  it('is zero on a circle, negative at its centre', () => {
    const disc = landShapeOf({ widthMm: 1, depthMm: 1, shape: 'circle' })
    expect(edgeDistanceMm(disc, 0.5, 0)).toBeCloseTo(0, 12)
    expect(edgeDistanceMm(disc, 0, 0)).toBeCloseTo(-0.5, 12)
    // A diagonal offset reads the same as the axis one: hypot(0.5, 0.5) - 0.5.
    expect(edgeDistanceMm(disc, 0.5, 0.5)).toBeCloseTo(0.5 * Math.SQRT2 - 0.5, 12)
  })

  it('measures a rectangle in its own rotated frame', () => {
    const rect = landShapeOf({ widthMm: 1.2, depthMm: 0.4, shape: 'rectangle', rotationDeg: 45 })
    // Half-width 0.6, half-depth 0.2: an edge point, the centre, and a diagonal.
    expect(edgeDistanceMm(rect, 0.6 * Math.SQRT1_2, 0.6 * Math.SQRT1_2)).toBeCloseTo(0, 12)
    expect(edgeDistanceMm(rect, 0, 0)).toBeCloseTo(-0.2, 12)
    // 0.8 along the long axis is 0.2 past the end, square-off against the edge.
    expect(edgeDistanceMm(rect, 0.8 * Math.SQRT1_2, 0.8 * Math.SQRT1_2)).toBeCloseTo(0.2, 12)
  })

  it('measures a stadium to its spine, less the radius that swept it', () => {
    const oval = landShapeOf({ widthMm: 2, depthMm: 0.6, shape: 'oval' })
    expect(edgeDistanceMm(oval, 1, 0)).toBeCloseTo(0, 12) // tip
    expect(edgeDistanceMm(oval, 0.5, 0.3)).toBeCloseTo(0, 12) // flank
    expect(edgeDistanceMm(oval, 0, 0)).toBeCloseTo(-0.3, 12)
    // 0.5 past the spine's end and 0.4 off axis: the round cap's diagonal.
    expect(edgeDistanceMm(oval, 1.2, 0.4)).toBeCloseTo(Math.hypot(0.5, 0.4) - 0.3, 12)
  })
})

describe('shapeGapMm', () => {
  it('subtracts both radii between two discs', () => {
    const a = landShapeOf({ widthMm: 0.6, depthMm: 0.6, shape: 'circle' })
    const b = landShapeOf({ widthMm: 1, depthMm: 1, shape: 'circle' })
    expect(shapeGapMm(a, b, 1, 0)).toBeCloseTo(0.2, 12)
    expect(shapeGapMm(a, b, 0.5, 0)).toBeCloseTo(-0.3, 12)
  })

  it('reads the true gap between two facing land edges', () => {
    const a = landShapeOf({ widthMm: 0.6, depthMm: 0.6, shape: 'rectangle' })
    expect(shapeGapMm(a, a, 1, 0)).toBeCloseTo(0.4, 12)
    expect(shapeGapMm(a, a, 2.5, 0)).toBeCloseTo(1.9, 12)
    // Edge-aligned and interpenetrating, no edge crosses another, so this is the
    // one case that reports touching instead of depth. It is never read as clear:
    // 0 is below every spacing rule a caller holds it against.
    expect(shapeGapMm(a, a, 0.5, 0)).toBe(0)
  })

  it('reports a buried hole as overlap, not as touching', () => {
    // A via pad sitting wholly inside a through-hole land has no boundary crossing,
    // so a pure boundary measure calls it 0.4 mm apart. The containment probe is
    // what turns that into the overlap it is, in both argument orders.
    const disc = landShapeOf({ widthMm: 0.6, depthMm: 0.6, shape: 'circle' })
    const land = landShapeOf({ widthMm: 2, depthMm: 1, shape: 'rectangle' })
    expect(shapeGapMm(disc, land, 0, 0)).toBeCloseTo(-0.5, 12)
    expect(shapeGapMm(land, disc, 0, 0)).toBeCloseTo(-0.5, 12)
  })

  it('measures two stadiums tip to tip along the row', () => {
    const oval = landShapeOf({ widthMm: 2, depthMm: 0.6, shape: 'oval' })
    expect(shapeGapMm(oval, oval, 2, 0)).toBeCloseTo(0, 12)
    expect(shapeGapMm(oval, oval, 2.4, 0)).toBeCloseTo(0.4, 12)
    // One end-fire, one abreast: the perpendicular row is spine-to-spine too.
    const turned = landShapeOf({ widthMm: 0.6, depthMm: 2, shape: 'oval' })
    expect(shapeGapMm(oval, turned, 1.5, 0)).toBeCloseTo(0.2, 12)
  })

  it('goes negative where a disc crosses a rotated land', () => {
    const rad = (30 * Math.PI) / 180
    const rect = landShapeOf({ widthMm: 1.2, depthMm: 0.4, shape: 'rectangle', rotationDeg: 30 })
    const disc = landShapeOf({ widthMm: 0.6, depthMm: 0.6, shape: 'circle' })
    // 0.5 across with the land's axis running up to the right puts the disc's
    // centre inside the land.
    expect(shapeGapMm(rect, disc, 0.5, 0.1)).toBeLessThan(0)
    // 1.5 mm along that same axis: 0.9 from the end, less the disc's 0.3 radius.
    expect(shapeGapMm(rect, disc, 1.5 * Math.cos(rad), 1.5 * Math.sin(rad))).toBeCloseTo(0.6, 12)
  })
})

describe('shapeCircumRadiusMm', () => {
  it('is the analytic reach of each outline', () => {
    expect(shapeCircumRadiusMm(landShapeOf({ widthMm: 1.4, depthMm: 0.6, shape: 'circle' }))).toBeCloseTo(0.7, 12)
    // A 1.2 x 0.4 land reaches to its corner: hypot(0.6, 0.2).
    expect(shapeCircumRadiusMm(landShapeOf({ widthMm: 1.2, depthMm: 0.4, shape: 'rectangle' })))
      .toBeCloseTo(Math.hypot(0.6, 0.2), 12)
    // A stadium reaches to its tip: half-span plus the cap radius.
    expect(shapeCircumRadiusMm(landShapeOf({ widthMm: 2, depthMm: 0.6, shape: 'oval', rotationDeg: 40 })))
      .toBeCloseTo(1, 12)
  })

  it('bounds the true gap from below, so a distance pre-filter cannot skip a pair', () => {
    // This is the invariant `assertLandsClear` relies on when it stops measuring
    // once two centres are `reachA + reachB + required` apart: the copper can never
    // be further apart than the centres, less the two discs that contain it.
    const shapes = [
      landShapeOf({ widthMm: 0.6, depthMm: 0.6, shape: 'circle' }),
      landShapeOf({ widthMm: 1.2, depthMm: 0.4, shape: 'rectangle', rotationDeg: 37 }),
      landShapeOf({ widthMm: 2, depthMm: 0.6, shape: 'oval', rotationDeg: 55 }),
      landShapeOf({ widthMm: 0.4, depthMm: 1.8, shape: 'oval' }),
    ]
    for (const a of shapes) {
      for (const b of shapes) {
        const slack = shapeCircumRadiusMm(a) + shapeCircumRadiusMm(b)
        for (let angle = 0; angle < 360; angle += 11) {
          const rad = (angle * Math.PI) / 180
          for (const centre of [0.8, 1.2, 2.5, 6]) {
            const dx = centre * Math.cos(rad)
            const dy = centre * Math.sin(rad)
            expect(shapeGapMm(a, b, dx, dy)).toBeGreaterThanOrEqual(centre - slack - 1e-9)
          }
        }
      }
    }
  })
})

describe('polylineShapeDistanceMm', () => {
  it('clears a rotated land by the same arithmetic the checker uses', () => {
    // A 1.2 x 0.4 land turned 90° owns 0.6 along the board's y, not its x.
    const rect = landShapeOf({ widthMm: 1.2, depthMm: 0.4, shape: 'rectangle', rotationDeg: 90 })
    const center = { x: 10, y: 5 }
    expect(polylineShapeDistanceMm([{ x: 10, y: 6.2 }], center, rect)).toBeCloseTo(0.6, 12)
    expect(polylineShapeDistanceMm([{ x: 10, y: 5.6 }], center, rect)).toBeCloseTo(0, 12)
  })

  it('measures a segment, not only its endpoints', () => {
    const oval = landShapeOf({ widthMm: 2, depthMm: 0.6, shape: 'oval' })
    const center = { x: 0, y: 0 }
    // Both endpoints sit 1 mm off in y; the run crosses the tip at x = 1.
    expect(polylineShapeDistanceMm([{ x: 1, y: 1 }, { x: 1, y: -1 }], center, oval)).toBeCloseTo(0, 12)
    expect(polylineShapeDistanceMm([{ x: 2, y: 0 }, { x: 3, y: 0 }], center, oval)).toBeCloseTo(1, 12)
    expect(polylineShapeDistanceMm([], center, oval)).toBe(Number.POSITIVE_INFINITY)
  })

  it('clamps a rectangle at touching rather than reporting a depth', () => {
    // Documented, and safe for the callers: every one of them asks whether the
    // distance clears a positive rule, and a trace buried in copper fails that
    // exactly as hard at 0 as it does at -0.4.
    const rect = landShapeOf({ widthMm: 1.2, depthMm: 0.4, shape: 'rectangle' })
    expect(polylineShapeDistanceMm([{ x: 0, y: 0 }], { x: 0, y: 0 }, rect)).toBe(0)
    // The same crossing against a stadium does report its signed depth.
    const oval = landShapeOf({ widthMm: 2, depthMm: 0.6, shape: 'oval' })
    expect(polylineShapeDistanceMm([{ x: 0, y: 0 }], { x: 0, y: 0 }, oval)).toBeCloseTo(-0.3, 12)
  })
})
