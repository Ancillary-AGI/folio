/**
 * Orthogonal wire routing shared by the canvas and agent tools.
 *
 * A pin-to-pin L-route is only safe if it does not pass through another
 * terminal or an existing wire end. Passing through a pin draws a wire that
 * looks connected but is not (or vice versa, when the netlister's endpoint
 * rule joins it). Both L-shapes are scored against those obstacles and the
 * cleaner one wins; wires may still cross, which no netlister treats as a
 * connection without a junction.
 */
export interface WirePoint {
  x: number
  y: number
}

const TOLERANCE = 0.5

export function pointOnSegment(point: WirePoint, a: WirePoint, b: WirePoint): boolean {
  return point.x >= Math.min(a.x, b.x) - TOLERANCE
    && point.x <= Math.max(a.x, b.x) + TOLERANCE
    && point.y >= Math.min(a.y, b.y) - TOLERANCE
    && point.y <= Math.max(a.y, b.y) + TOLERANCE
}

const samePoint = (a: WirePoint, b: WirePoint): boolean =>
  Math.abs(a.x - b.x) < TOLERANCE && Math.abs(a.y - b.y) < TOLERANCE

function collisions(points: readonly WirePoint[], obstacles: readonly WirePoint[]): number {
  let count = 0
  for (let index = 0; index + 1 < points.length; index++) {
    const a = points[index]
    const b = points[index + 1]
    for (const obstacle of obstacles) {
      if (samePoint(obstacle, a) || samePoint(obstacle, b)) continue
      if (pointOnSegment(obstacle, a, b)) count += 1
    }
  }
  return count
}

/**
 * Route `start → end` with one corner, preferring the L-shape that avoids
 * existing terminals and wire ends. `obstacles` should include every pin and
 * wire endpoint on the sheet; the caller's own two terminals are ignored.
 */
export function routePoints(
  start: WirePoint,
  end: WirePoint,
  obstacles: readonly WirePoint[] = [],
): WirePoint[] {
  const from = { x: start.x, y: start.y }
  const to = { x: end.x, y: end.y }
  if (from.x === to.x || from.y === to.y) return [from, to]

  const horizontalFirst = [from, { x: to.x, y: from.y }, to]
  const verticalFirst = [from, { x: from.x, y: to.y }, to]
  const filtered = obstacles.filter((obstacle) => !samePoint(obstacle, from) && !samePoint(obstacle, to))
  const horizontalCost = collisions(horizontalFirst, filtered)
  const verticalCost = collisions(verticalFirst, filtered)
  return verticalCost < horizontalCost ? verticalFirst : horizontalFirst
}
