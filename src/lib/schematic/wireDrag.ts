/**
 * Pulling wires about the sheet, the way a drafting editor does it.
 *
 * Two handles, and they behave differently on purpose. A straight run slides
 * sideways only — its neighbours stretch along their own axes so the sheet
 * stays orthogonal — and a run that starts or ends on a component pin dog-legs
 * off that pin instead of tearing the connection away from it. A node handle
 * takes every wire vertex that shares the point, which is how a junction moves
 * without dragging the rails that pass through it.
 *
 * Pins are deliberately NOT node handles. A junction sitting on a pin belongs
 * to the part, and the part drag has its own rules for keeping wires landed.
 */
import type { CanvasWire } from '../../stores/useProjectStore'
import { pointSegmentDistance } from '../geometry/distance'

export interface WirePoint {
  x: number
  y: number
}

export type WireHandle =
  | { kind: 'segment'; wireId: string; index: number }
  | { kind: 'node'; at: WirePoint }

export interface HandleOptions {
  /** How close the pointer must come to a run to grab it, in sheet units. */
  tolerance: number
  /** Grab radius for a vertex. Smaller than `tolerance` on purpose. */
  nodeTolerance: number
  /** World position of every pin on the sheet. */
  terminals?: readonly WirePoint[]
}

export interface DragOptions {
  /** Drafting grid: also the length of the stub a dog-leg leaves a pin with. */
  grid?: number
  terminals?: readonly WirePoint[]
}

/** Matches the orthogonal-routing tolerance: sub-half-unit counts as coincident. */
const EPS = 0.5

const same = (a: WirePoint, b: WirePoint): boolean =>
  Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS

const pointKey = (p: WirePoint): string => `${Math.round(p.x)}:${Math.round(p.y)}`

const cloneWire = (wire: CanvasWire): CanvasWire => ({
  ...wire,
  points: wire.points.map((point) => ({ ...point })),
  connectedPins: wire.connectedPins.map((pin) => ({ ...pin })),
})

/**
 * Drop vertices that carry no information: repeated points, and corners that
 * do not actually turn. A junction between two wires never needs a redundant
 * vertex of its own — the other wire's segment still passes through the point,
 * which is what junction detection looks for.
 */
function simplify(points: readonly WirePoint[]): WirePoint[] {
  const kept: WirePoint[] = []
  for (const point of points) {
    const last = kept[kept.length - 1]
    if (last && same(last, point)) continue
    kept.push({ x: point.x, y: point.y })
  }
  if (kept.length < 3) return kept

  const out: WirePoint[] = []
  for (let i = 0; i < kept.length; i++) {
    if (i > 0 && i < kept.length - 1) {
      const a = kept[i - 1]
      const b = kept[i]
      const c = kept[i + 1]
      const flatY = Math.abs(a.y - b.y) < EPS && Math.abs(b.y - c.y) < EPS
      const flatX = Math.abs(a.x - b.x) < EPS && Math.abs(b.x - c.x) < EPS
      if (flatY || flatX) continue
    }
    out.push(kept[i])
  }
  return out
}

/**
 * The maximal straight run through segment `index`, as point indices.
 * Consecutive segments on the same axis are collinear by construction: they
 * share a vertex, and a vertex cannot be two distances from one axis line.
 */
function runOf(
  points: readonly WirePoint[],
  index: number,
): { start: number; end: number; axis: 'h' | 'v' | null } {
  const a = points[index]
  const b = points[index + 1]
  const horizontal = Math.abs(a.y - b.y) < EPS && Math.abs(a.x - b.x) >= EPS
  const vertical = Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) >= EPS
  if (!horizontal && !vertical) return { start: index, end: index + 1, axis: null }

  const aligned = (p: WirePoint, q: WirePoint): boolean =>
    horizontal ? Math.abs(p.y - q.y) < EPS : Math.abs(p.x - q.x) < EPS

  let start = index
  while (start > 0 && aligned(points[start - 1], points[start])) start--
  let end = index + 1
  while (end + 1 < points.length && aligned(points[end], points[end + 1])) end++
  return { start, end, axis: horizontal ? 'h' : 'v' }
}

/** Grab the junction the pointer is on, else the nearest run. */
export function hitWireHandle(
  wires: readonly CanvasWire[],
  world: WirePoint,
  options: HandleOptions,
): WireHandle | null {
  const terminals = options.terminals ?? []

  let node: WirePoint | null = null
  let nodeDist = options.nodeTolerance
  const seen = new Set<string>()
  for (const wire of wires) {
    for (const point of wire.points) {
      const key = pointKey(point)
      if (seen.has(key)) continue
      seen.add(key)
      if (terminals.some((terminal) => same(terminal, point))) continue
      const distance = Math.hypot(point.x - world.x, point.y - world.y)
      if (distance > nodeDist) continue
      nodeDist = distance
      node = point
    }
  }
  if (node) return { kind: 'node', at: { x: node.x, y: node.y } }

  let best: WireHandle | null = null
  let bestDist = options.tolerance
  for (const wire of wires) {
    for (let index = 0; index + 1 < wire.points.length; index++) {
      const a = wire.points[index]
      const b = wire.points[index + 1]
      if (same(a, b)) continue
      const distance = pointSegmentDistance(world, a, b)
      if (distance > bestDist) continue
      bestDist = distance
      best = { kind: 'segment', wireId: wire.id, index }
    }
  }
  return best
}

/**
 * A pulled junction takes its vertex and nothing else, so each leg that used to
 * be axis-aligned and is now diagonal gets a corner back. The corner keeps the
 * leg's own original departure direction, which is what makes a dragged elbow
 * read as two clean runs rather than a bent one.
 */
function repairLegs(
  original: readonly WirePoint[],
  moved: readonly WirePoint[],
): WirePoint[] {
  const out: WirePoint[] = []
  for (let i = 0; i < moved.length; i++) {
    const a = moved[i]
    out.push(a)
    const b = moved[i + 1]
    if (!b) continue
    if (Math.abs(a.x - b.x) < EPS || Math.abs(a.y - b.y) < EPS) continue
    const wasHorizontal = Math.abs(original[i].y - original[i + 1].y) < EPS
    out.push(wasHorizontal ? { x: b.x, y: a.y } : { x: a.x, y: b.y })
  }
  return out
}

/** Pull a junction: every vertex on it, in every wire, goes with it. */
function dragNode(
  wires: readonly CanvasWire[],
  at: WirePoint,
  offset: WirePoint,
): CanvasWire[] {
  return wires.map((wire) => {
    if (!wire.points.some((point) => same(point, at))) return cloneWire(wire)
    const moved = wire.points.map((point) =>
      same(point, at) ? { x: point.x + offset.x, y: point.y + offset.y } : { x: point.x, y: point.y },
    )
    return { ...cloneWire(wire), points: simplify(repairLegs(wire.points, moved)) }
  })
}

/**
 * Slide one straight run sideways. The motion along the run is ignored, which
 * is what makes the handle feel like a rail rather than a rubber band: the run
 * keeps its length and its neighbours stretch to stay joined.
 */
function dragSegment(
  wires: readonly CanvasWire[],
  wireId: string,
  index: number,
  offset: WirePoint,
  options: DragOptions,
): CanvasWire[] {
  const wire = wires.find((candidate) => candidate.id === wireId)
  if (!wire) return wires.map(cloneWire)
  if (index < 0 || index + 1 >= wire.points.length) return wires.map(cloneWire)

  const origin = wire.points
  const run = runOf(origin, index)
  const grid = options.grid ?? 10
  const terminals = options.terminals ?? []

  // A diagonal segment has no sideways of its own, so the whole wire moves.
  if (run.axis === null) {
    return wires.map((candidate) =>
      candidate.id === wireId
        ? {
            ...cloneWire(candidate),
            points: candidate.points.map((point) => ({
              x: point.x + offset.x,
              y: point.y + offset.y,
            })),
          }
        : cloneWire(candidate),
    )
  }

  const perpendicular = run.axis === 'h' ? offset.y : offset.x
  if (Math.abs(perpendicular) < EPS) return wires.map(cloneWire)

  const along = (point: WirePoint): number => (run.axis === 'h' ? point.x : point.y)
  const across = (point: WirePoint): number => (run.axis === 'h' ? point.y : point.x)
  const slide = (point: WirePoint): WirePoint =>
    run.axis === 'h' ? { x: point.x, y: point.y + perpendicular } : { x: point.x + perpendicular, y: point.y }
  const at = (alongValue: number, acrossValue: number): WirePoint =>
    run.axis === 'h' ? { x: alongValue, y: acrossValue } : { x: acrossValue, y: alongValue }

  const moved = origin.map((point, i) =>
    i >= run.start && i <= run.end ? slide(point) : { x: point.x, y: point.y })

  const direction = Math.sign(along(origin[run.end]) - along(origin[run.start])) || 1
  const reach = Math.abs(along(origin[run.end]) - along(origin[run.start]))
  // Third of the run, so two dog-legs on a short wire can never cross over.
  const stub = Math.min(grid, reach / 3)

  const leftPinned = run.start === 0 && terminals.some((terminal) => same(terminal, origin[0]))
  const rightPinned =
    run.end === origin.length - 1 && terminals.some((terminal) => same(terminal, origin[origin.length - 1]))

  if (leftPinned && stub > EPS) {
    const anchor = along(origin[0]) + direction * stub
    moved.splice(0, 1, { ...origin[0] }, at(anchor, across(origin[0])), at(anchor, across(origin[0]) + perpendicular))
  }
  if (rightPinned && stub > EPS) {
    const last = origin[origin.length - 1]
    const anchor = along(last) - direction * stub
    moved.splice(
      moved.length - 1,
      1,
      at(anchor, across(last) + perpendicular),
      at(anchor, across(last)),
      { ...last },
    )
  }

  return wires.map((candidate) =>
    candidate.id === wireId ? { ...cloneWire(candidate), points: simplify(moved) } : cloneWire(candidate),
  )
}

/**
 * Apply a drag and return the whole sheet's wires, so the caller can commit
 * the edit as one undo step. `offset` is in sheet units and is expected to
 * already be grid-snapped by the caller.
 */
export function applyWireDrag(
  wires: readonly CanvasWire[],
  handle: WireHandle,
  offset: WirePoint,
  options: DragOptions = {},
): CanvasWire[] {
  if (Math.abs(offset.x) < EPS && Math.abs(offset.y) < EPS) return wires.map(cloneWire)
  if (Math.abs(offset.x) < EPS && Math.abs(offset.y) < EPS) return wires.map(cloneWire)
  if (handle.kind === 'node') return dragNode(wires, handle.at, offset)
  return dragSegment(wires, handle.wireId, handle.index, offset, options)
}
