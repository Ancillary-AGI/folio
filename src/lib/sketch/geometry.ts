/**
 * Stroke geometry for freehand schematic input.
 *
 * Everything here works in the sheet's world units and is deliberately
 * dependency-free: the recogniser, the live ink preview and the image tracer
 * all speak this vocabulary.
 */

export interface Point {
  x: number
  y: number
}

export interface Stroke {
  points: Point[]
}

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)

export function strokeLength(points: readonly Point[]): number {
  let total = 0
  for (let i = 1; i < points.length; i += 1) total += distance(points[i - 1], points[i])
  return total
}

export function pointsBounds(points: readonly Point[]): Bounds {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of points) {
    if (point.x < minX) minX = point.x
    if (point.y < minY) minY = point.y
    if (point.x > maxX) maxX = point.x
    if (point.y > maxY) maxY = point.y
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

export const boundsDiagonal = (bounds: Bounds): number => Math.hypot(bounds.width, bounds.height)

export const boundsCenter = (bounds: Bounds): Point => ({
  x: bounds.x + bounds.width / 2,
  y: bounds.y + bounds.height / 2,
})

const segmentsIntersect = (a: Point, b: Point, c: Point, d: Point): boolean => {
  const cross = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  const d1 = cross(a, b, c)
  const d2 = cross(a, b, d)
  const d3 = cross(c, d, a)
  const d4 = cross(c, d, b)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

export function pointSegmentDistance(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return distance(point, a)
  let t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy))
}

/** Shortest distance between two stroke centrelines (0 when they cross). */
export function strokesDistance(a: readonly Point[], b: readonly Point[]): number {
  if (a.length === 0 || b.length === 0) return Infinity
  if (a.length === 1 && b.length === 1) return distance(a[0], b[0])
  if (a.length === 1) {
    let best = Infinity
    for (let i = 1; i < b.length; i += 1) {
      best = Math.min(best, pointSegmentDistance(a[0], b[i - 1], b[i]))
    }
    return best
  }
  if (b.length === 1) return strokesDistance(b, a)
  let best = Infinity
  for (let i = 1; i < a.length; i += 1) {
    for (let j = 1; j < b.length; j += 1) {
      if (segmentsIntersect(a[i - 1], a[i], b[j - 1], b[j])) return 0
      best = Math.min(
        best,
        pointSegmentDistance(a[i - 1], b[j - 1], b[j]),
        pointSegmentDistance(a[i], b[j - 1], b[j]),
        pointSegmentDistance(b[j - 1], a[i - 1], a[i]),
        pointSegmentDistance(b[j], a[i - 1], a[i]),
      )
    }
  }
  return best
}

/** Arc-length resample. Keeps the first and last point of the stroke. */
export function resampleStroke(points: readonly Point[], spacing: number): Point[] {
  if (points.length < 2 || spacing <= 0) return points.map((point) => ({ ...point }))
  const output: Point[] = [{ ...points[0] }]
  let carry = 0
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]
    const b = points[i]
    const segment = distance(a, b)
    if (segment === 0) continue
    let travelled = spacing - carry
    while (travelled <= segment) {
      const t = travelled / segment
      output.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
      travelled += spacing
    }
    carry = (carry + segment) % spacing
  }
  const last = points[points.length - 1]
  const tail = output[output.length - 1]
  if (distance(tail, last) > spacing * 0.25) output.push({ ...last })
  else output[output.length - 1] = { ...last }
  return output
}

/** Ramer-Douglas-Peucker simplification, iterative to stay off the call stack. */
export function simplifyStroke(points: readonly Point[], epsilon: number): Point[] {
  if (points.length <= 2 || epsilon <= 0) return points.map((point) => ({ ...point }))
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack: Array<[number, number]> = [[0, points.length - 1]]
  while (stack.length > 0) {
    const [start, end] = stack.pop()!
    let farthest = -1
    let farthestDistance = epsilon
    for (let i = start + 1; i < end; i += 1) {
      const d = pointSegmentDistance(points[i], points[start], points[end])
      if (d > farthestDistance) {
        farthestDistance = d
        farthest = i
      }
    }
    if (farthest !== -1) {
      keep[farthest] = 1
      stack.push([start, farthest], [farthest, end])
    }
  }
  const output: Point[] = []
  for (let i = 0; i < points.length; i += 1) {
    if (keep[i]) output.push({ ...points[i] })
  }
  return output
}

/** Chord over arc length: 1 for a straight line, near 0 for a closed loop. */
export function straightness(points: readonly Point[]): number {
  if (points.length < 2) return 0
  const length = strokeLength(points)
  if (length === 0) return 0
  return distance(points[0], points[points.length - 1]) / length
}

/** Endpoint gap over arc length: near 0 for a closed loop. */
export function closedness(points: readonly Point[]): number {
  if (points.length < 2) return 1
  const length = strokeLength(points)
  if (length === 0) return 1
  return distance(points[0], points[points.length - 1]) / length
}

export function rotatePoint(point: Point, degrees: number, origin: Point = { x: 0, y: 0 }): Point {
  const radians = (degrees * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const dx = point.x - origin.x
  const dy = point.y - origin.y
  return { x: origin.x + dx * cos - dy * sin, y: origin.y + dx * sin + dy * cos }
}

export const centroid = (points: readonly Point[]): Point => {
  if (points.length === 0) return { x: 0, y: 0 }
  let x = 0
  let y = 0
  for (const point of points) {
    x += point.x
    y += point.y
  }
  return { x: x / points.length, y: y / points.length }
}

/** Snap a coordinate to a grid pitch, tolerating a zero/negative pitch. */
export const snap = (value: number, pitch: number): number => {
  if (!(pitch > 0)) return value
  const snapped = Math.round(value / pitch) * pitch
  // Rounding a tiny negative coordinate yields -0, which serialises as "-0".
  return snapped === 0 ? 0 : snapped
}

/** Keep only the points of a polyline that survive simplification, preserving ends. */
export function clampPolyline(points: readonly Point[], maxPoints: number): Point[] {
  if (points.length <= maxPoints) return points.map((point) => ({ ...point }))
  const step = (points.length - 1) / (maxPoints - 1)
  const output: Point[] = []
  for (let i = 0; i < maxPoints; i += 1) output.push({ ...points[Math.round(i * step)] })
  return output
}
