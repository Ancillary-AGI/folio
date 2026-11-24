import type { Point } from '../../types'
import { segmentDistance, polylineDistance, polylineRectDistance } from './distance'

/**
 * The outline a piece of copper owns, in board millimetres.
 *
 * One definition shared by the router that reserves clearance, the stitch planner
 * that sizes a ring against it, and the DRC that audits it. When they each kept
 * their own arithmetic, the router reserved a rotated land's real outline while
 * the checker measured its unrotated bounding box, and every end-fire part in a
 * demo reported clearances the fab would never have accepted.
 *
 * A land's copper is either a *capsule* — a spine segment swept by a disc, which
 * covers round pads and oblong (stadium) pads exactly — or a rectangle.
 */
export type LandShape =
  | { kind: 'circle'; radiusMm: number }
  /** Half extents in the land frame; `rotationRad` maps board offsets into it. */
  | { kind: 'rectangle'; halfWidthMm: number; halfHeightMm: number; rotationRad: number }
  /** Oblong: a spine of `halfSpanMm` either way along the long axis, radius `radiusMm`. */
  | { kind: 'oval'; halfSpanMm: number; radiusMm: number; rotationRad: number }

/** A footprint land as its pattern declares it: size, shape, and the rotation it was placed with. */
export interface LandFigure {
  widthMm: number
  depthMm: number
  shape: 'circle' | 'rectangle' | 'oval'
  rotationDeg?: number
}

/** Half the diagonal of a disc that contains the whole outline. */
export function shapeCircumRadiusMm(shape: LandShape): number {
  if (shape.kind === 'circle') return shape.radiusMm
  if (shape.kind === 'rectangle') return Math.hypot(shape.halfWidthMm, shape.halfHeightMm)
  return shape.halfSpanMm + shape.radiusMm
}

/**
 * The copper outline a footprint land prints.
 *
 * A circle is as wide as its largest axis, not its smallest: the copper that has
 * to be cleared is the copper that exists, and an under-read radius is a false
 * clean in the checker.
 */
export function landShapeOf(figure: LandFigure): LandShape {
  const halfWidthMm = Math.abs(figure.widthMm) / 2
  const halfDepthMm = Math.abs(figure.depthMm) / 2
  const rotationRad = ((figure.rotationDeg ?? 0) * Math.PI) / 180
  if (figure.shape === 'circle') {
    return { kind: 'circle', radiusMm: Math.max(halfWidthMm, halfDepthMm) }
  }
  if (figure.shape === 'oval') {
    const longMm = Math.max(halfWidthMm, halfDepthMm)
    const shortMm = Math.min(halfWidthMm, halfDepthMm)
    // The stadium's axis follows the land's long dimension, so a land whose long
    // axis is its depth turns 90° from the part it belongs to.
    return {
      kind: 'oval',
      halfSpanMm: longMm - shortMm,
      radiusMm: shortMm,
      rotationRad: halfWidthMm >= halfDepthMm ? rotationRad : rotationRad + Math.PI / 2,
    }
  }
  return { kind: 'rectangle', halfWidthMm, halfHeightMm: halfDepthMm, rotationRad }
}

/** A disc swept along a segment; the spine of a circle is a single point. */
function capsuleSpine(shape: LandShape, center: Point): [Point, Point] {
  if (shape.kind !== 'oval') return [center, center]
  const cos = Math.cos(shape.rotationRad) * shape.halfSpanMm
  const sin = Math.sin(shape.rotationRad) * shape.halfSpanMm
  return [
    { x: center.x - cos, y: center.y - sin },
    { x: center.x + cos, y: center.y + sin },
  ]
}

function capsuleRadiusMm(shape: LandShape): number {
  return shape.kind === 'circle' ? shape.radiusMm : shape.kind === 'oval' ? shape.radiusMm : 0
}

/** The outline's boundary, as the finite segments that trace it. */
function outlineEdges(shape: LandShape, center: Point): Array<[Point, Point]> {
  if (shape.kind !== 'rectangle') {
    // A capsule's boundary is its spine offset by the radius, so the spine is the
    // segment to measure, with the radius subtracted by the caller.
    const [a, b] = capsuleSpine(shape, center)
    return [[a, b]]
  }
  const corners = outlinePoints(shape, center)
  return corners.map((corner, index) => [corner, corners[(index + 1) % corners.length]])
}

/** Points that say "I am this outline's": a rectangle's corners, a capsule's spine ends. */
function outlinePoints(shape: LandShape, center: Point): Point[] {
  if (shape.kind !== 'rectangle') return capsuleSpine(shape, center)
  const cos = Math.cos(shape.rotationRad)
  const sin = Math.sin(shape.rotationRad)
  const corners: Array<[number, number]> = [
    [-shape.halfWidthMm, -shape.halfHeightMm],
    [shape.halfWidthMm, -shape.halfHeightMm],
    [shape.halfWidthMm, shape.halfHeightMm],
    [-shape.halfWidthMm, shape.halfHeightMm],
  ]
  return corners.map(([along, across]) => ({
    x: center.x + along * cos - across * sin,
    y: center.y + along * sin + across * cos,
  }))
}

/**
 * Distance from `dx, dy` — an offset from the shape's own centre — to its copper
 * edge. Negative inside a capsule, and inside a rectangle by how far the point
 * has crossed in from the nearest edge; zero on the boundary either way.
 */
export function edgeDistanceMm(shape: LandShape, dx: number, dy: number): number {
  if (shape.kind === 'circle') return Math.hypot(dx, dy) - shape.radiusMm
  const cos = Math.cos(shape.rotationRad)
  const sin = Math.sin(shape.rotationRad)
  const along = dx * cos + dy * sin
  const across = -dx * sin + dy * cos
  if (shape.kind === 'oval') {
    // Rotated stadium: distance to its spine, minus the radius that swept it.
    return Math.hypot(Math.max(Math.abs(along) - shape.halfSpanMm, 0), Math.abs(across)) - shape.radiusMm
  }
  const outsideX = Math.abs(along) - shape.halfWidthMm
  const outsideY = Math.abs(across) - shape.halfHeightMm
  if (outsideX >= 0 || outsideY >= 0) return Math.hypot(Math.max(outsideX, 0), Math.max(outsideY, 0))
  return Math.max(outsideX, outsideY)
}

/** Shortest distance between the two outlines' boundary segments; `a` is centred on the origin. */
function boundaryDistanceMm(a: LandShape, b: LandShape, bCenter: Point): number {
  const aEdges = outlineEdges(a, { x: 0, y: 0 })
  const bEdges = outlineEdges(b, bCenter)
  let min = Number.POSITIVE_INFINITY
  for (const [a1, a2] of aEdges) {
    for (const [b1, b2] of bEdges) {
      const distance = segmentDistance(a1, a2, b1, b2)
      if (distance < min) min = distance
      if (min === 0) return 0
    }
  }
  return min
}

/**
 * Copper-to-copper gap between two outlines whose centres are offset by `dx, dy`;
 * negative means the copper overlaps. Nothing here over-reports a gap: two
 * edge-aligned rectangles that interpenetrate without any edge crossing return 0
 * rather than their depth, and 0 fails every clearance rule the same way.
 *
 * Exact for two capsules — the boundary of a capsule is its spine at a radius, so
 * their gap is the spine-to-spine distance minus both radii. A rectangle's edges
 * and a capsule's spine are finite segments, so measuring every pair of them and
 * then probing whether one outline sits inside the other is exact in both the
 * touching and the contained case; a pure boundary measure would call a via
 * buried in a through-hole pad 0.4 mm apart.
 */
export function shapeGapMm(a: LandShape, b: LandShape, dx: number, dy: number): number {
  if (a.kind !== 'rectangle' && b.kind !== 'rectangle') {
    const spine = capsuleSpine(b, { x: dx, y: dy })
    return polylineDistance(capsuleSpine(a, { x: 0, y: 0 }), spine) - capsuleRadiusMm(a) - capsuleRadiusMm(b)
  }
  let gap = boundaryDistanceMm(a, b, { x: dx, y: dy }) - capsuleRadiusMm(a) - capsuleRadiusMm(b)
  // Containment probe: an outline whose representative point is inside the other
  // contributes its signed depth, which is negative, so the gap reads as overlap.
  for (const point of outlinePoints(a, { x: 0, y: 0 })) {
    gap = Math.min(gap, edgeDistanceMm(b, point.x - dx, point.y - dy))
  }
  for (const point of outlinePoints(b, { x: dx, y: dy })) {
    gap = Math.min(gap, edgeDistanceMm(a, point.x, point.y))
  }
  return gap
}

/**
 * Gap from a polyline in board coordinates to an outline's edge. A capsule reports
 * its signed depth — negative where the line crosses into the copper — while a
 * rectangle stops at zero, because the rect measure below compares against the
 * outline's edges rather than its interior. Every caller asks whether the gap
 * clears a positive rule, so a trace buried in a land fails it identically at 0
 * and at -0.4; what no caller may do is read a zero as "touching, and nothing
 * worse". Rotation is a rigid transform, so a rotated rectangle is measured in its
 * own frame without changing any distance.
 */
export function polylineShapeDistanceMm(points: readonly Point[], center: Point, shape: LandShape): number {
  if (points.length === 0) return Number.POSITIVE_INFINITY
  if (shape.kind === 'rectangle') {
    const cos = Math.cos(shape.rotationRad)
    const sin = Math.sin(shape.rotationRad)
    const local = points.map(point => {
      const dx = point.x - center.x
      const dy = point.y - center.y
      return { x: dx * cos + dy * sin, y: -dx * sin + dy * cos }
    })
    return polylineRectDistance(local, {
      center: { x: 0, y: 0 },
      width: shape.halfWidthMm * 2,
      height: shape.halfHeightMm * 2,
    })
  }
  return polylineDistance(points, capsuleSpine(shape, center)) - capsuleRadiusMm(shape)
}
