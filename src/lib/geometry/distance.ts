import type { Point } from '../../types'

/** Shortest distance from `p` to the finite segment `a`–`b`. */
export function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSq = dx * dx + dy * dy
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

function orientation(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

/** True when `p` lies on the segment `a`–`b` (inclusive of the endpoints). */
function onSegment(p: Point, a: Point, b: Point): boolean {
  return (
    Math.min(a.x, b.x) <= p.x &&
    p.x <= Math.max(a.x, b.x) &&
    Math.min(a.y, b.y) <= p.y &&
    p.y <= Math.max(a.y, b.y) &&
    orientation(a, b, p) === 0
  )
}

/**
 * Shortest distance between two finite segments.
 *
 * A proper crossing is zero. Collinear overlaps and endpoint touches are
 * detected explicitly: checking only strict sign changes misses the case
 * where one segment ends exactly on the other, which is precisely how two
 * orthogonal copper traces touch and short in a layout.
 */
export function segmentDistance(a1: Point, a2: Point, b1: Point, b2: Point): number {
  const o1 = orientation(a1, a2, b1)
  const o2 = orientation(a1, a2, b2)
  const o3 = orientation(b1, b2, a1)
  const o4 = orientation(b1, b2, a2)
  if (o1 * o2 < 0 && o3 * o4 < 0) return 0
  if (o1 === 0 && onSegment(b1, a1, a2)) return 0
  if (o2 === 0 && onSegment(b2, a1, a2)) return 0
  if (o3 === 0 && onSegment(a1, b1, b2)) return 0
  if (o4 === 0 && onSegment(a2, b1, b2)) return 0
  return Math.min(
    pointSegmentDistance(a1, b1, b2),
    pointSegmentDistance(a2, b1, b2),
    pointSegmentDistance(b1, a1, a2),
    pointSegmentDistance(b2, a1, a2),
  )
}

/**
 * Shortest distance between two polylines. A single-point polyline is treated
 * as a degenerate segment, so callers need no special case.
 */
export function polylineDistance(a: readonly Point[], b: readonly Point[]): number {
  if (a.length === 0 || b.length === 0) return Number.POSITIVE_INFINITY
  let min = Number.POSITIVE_INFINITY
  const aSegments = Math.max(1, a.length - 1)
  const bSegments = Math.max(1, b.length - 1)
  for (let i = 0; i < aSegments; i += 1) {
    const a1 = a[i]
    const a2 = a[Math.min(i + 1, a.length - 1)]
    for (let j = 0; j < bSegments; j += 1) {
      const b1 = b[j]
      const b2 = b[Math.min(j + 1, b.length - 1)]
      const distance = segmentDistance(a1, a2, b1, b2)
      if (distance < min) min = distance
      if (min === 0) return 0
    }
  }
  return min
}

/** Total centre-line length of a polyline, in the coordinate unit (mm). */
export function polylineLength(points: readonly Point[]): number {
  let length = 0
  for (let i = 1; i < points.length; i += 1) {
    length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  }
  return length
}

export interface Rect {
  center: Point
  width: number
  height: number
}

export function pointInRect(p: Point, rect: Rect): boolean {
  return (
    Math.abs(p.x - rect.center.x) <= rect.width / 2 &&
    Math.abs(p.y - rect.center.y) <= rect.height / 2
  )
}

/**
 * Shortest distance between a polyline and an axis-aligned rectangle. Exact:
 * containment and edge crossings both resolve to zero.
 */
export function polylineRectDistance(points: readonly Point[], rect: Rect): number {
  if (points.length === 0 || rect.width <= 0 || rect.height <= 0) {
    return Number.POSITIVE_INFINITY
  }
  if (points.some(point => pointInRect(point, rect))) return 0

  const hw = rect.width / 2
  const hh = rect.height / 2
  const corners: Point[] = [
    { x: rect.center.x - hw, y: rect.center.y - hh },
    { x: rect.center.x + hw, y: rect.center.y - hh },
    { x: rect.center.x + hw, y: rect.center.y + hh },
    { x: rect.center.x - hw, y: rect.center.y + hh },
  ]

  let min = Number.POSITIVE_INFINITY
  const segments = Math.max(1, points.length - 1)
  for (let i = 0; i < segments; i += 1) {
    const a = points[i]
    const b = points[Math.min(i + 1, points.length - 1)]
    for (let edge = 0; edge < 4; edge += 1) {
      const distance = segmentDistance(a, b, corners[edge], corners[(edge + 1) % 4])
      if (distance === 0) return 0
      if (distance < min) min = distance
    }
  }
  return min
}

/** Shortest distance between a polyline and a circle (negative when overlapping). */
export function polylineCircleDistance(
  points: readonly Point[],
  center: Point,
  radius: number,
): number {
  return polylineDistance(points, [center]) - radius
}
