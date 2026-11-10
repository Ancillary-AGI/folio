/**
 * The geometry of drawing a truss, kept out of the React tree.
 *
 * A lattice diagram is a projection with two habits engineers expect: the model
 * is drawn to fit whatever the viewport is, and Y points up. Screen space points
 * Y down, so the flip belongs here rather than in three components that would
 * each get it subtly wrong. Member colour is here too, because a force diagram
 * that colours tension and compression differently on the sheet than in the
 * results table is worse than no colour at all.
 */
import type { TrussDisplacement, TrussNode } from './truss'

export interface TrussView {
  /** Pixels per metre. */
  scale: number
  /** Screen x of model x = 0. */
  offsetX: number
  /** Screen y of model y = 0. */
  offsetY: number
  width: number
  height: number
}

/** A point in screen pixels. */
export interface TrussPoint {
  x: number
  y: number
}

const EMPTY_BOUNDS = { minX: 0, maxX: 1, minY: 0, maxY: 1 }

/**
 * A bar below this axial force (newtons) is drawn as carrying nothing. The solver
 * returns ~1e-12 N for a genuine zero-force member, so the cut is numerical noise,
 * not a judgement about a small real load.
 */
const ZERO_FORCE_TOLERANCE = 1e-6

function bounds(nodes: readonly TrussNode[]): typeof EMPTY_BOUNDS {
  if (nodes.length === 0) return EMPTY_BOUNDS
  const xs = nodes.map((node) => node.x)
  const ys = nodes.map((node) => node.y)
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
}

/**
 * Fit the model into `width` × `height` pixels, keeping the aspect ratio and
 * leaving `padding` px of clear edge so a bearing or an arrow head is not cut.
 */
export function fitTrussView(
  nodes: readonly TrussNode[],
  width: number,
  height: number,
  padding = 28,
): TrussView {
  const box = bounds(nodes)
  const spanX = Math.max(box.maxX - box.minX, 1e-6)
  const spanY = Math.max(box.maxY - box.minY, 1e-6)
  const scale = Math.max(
    1e-6,
    Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY),
  )
  return {
    scale,
    // Centre the drawn shape in the viewport instead of pinning it to the corner.
    offsetX: (width - scale * spanX) / 2 - box.minX * scale,
    offsetY: (height + scale * spanY) / 2 + box.minY * scale,
    width,
    height,
  }
}

/** Model metres to screen pixels: Y is flipped so the truss stands up. */
export function projectTruss(node: { x: number; y: number }, view: TrussView): TrussPoint {
  return { x: view.offsetX + node.x * view.scale, y: view.offsetY - node.y * view.scale }
}

/** Screen pixels back to model metres, for dragging a joint. */
export function unprojectTruss(point: TrussPoint, view: TrussView): { x: number; y: number } {
  return { x: (point.x - view.offsetX) / view.scale, y: (view.offsetY - point.y) / view.scale }
}

/** Snap a dragged joint to a grid in metres, so a model stays buildable. */
export function snapToGrid(value: number, pitch = 0.05): number {
  return Math.round(value / pitch) * pitch
}

/**
 * A drafting pitch in metres for a frame of this extent, picked from the steps a
 * drafter can subdivide in their head (¼, ½, 1, 2, 5, 10 m).
 *
 * A fixed 1 m grid vanishes on a 2 m canopy bracket and a fixed 0.1 m grid turns
 * a 12 m girder into graph paper, so the pitch follows the shape: the smallest
 * step that keeps it under `maxSquares` bays across.
 */
export function gridPitch(extent: number, maxSquares = 16): number {
  const steps = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10]
  const positive = Math.max(0, extent)
  const found = steps.find((step) => positive / step <= maxSquares)
  return found ?? steps[steps.length - 1]
}

/** The deflected shape, exaggerated by `scale` so a millimetre of sag reads as a shape. */
export function deflectedNode(
  node: TrussNode,
  displacement: TrussDisplacement | undefined,
  scale: number,
): TrussNode {
  if (!displacement) return node
  return { id: node.id, x: node.x + displacement.x * scale, y: node.y + displacement.y * scale }
}

/**
 * Colour for an axial force: tension one way, compression the other, and a dead
 * member grey.
 *
 * A token *name* is returned rather than a colour so that every surface reads the
 * same sign: the on-screen sheet wraps it in `hsl(var(…))` through `style`, where
 * the active theme applies, and the SVG export resolves it to a literal through
 * `chartColor`, where `var()` inside a presentation attribute would not.
 */
export function forceToken(force: number): string {
  if (Math.abs(force) < ZERO_FORCE_TOLERANCE) return '--force-neutral'
  return force > 0 ? '--force-tension' : '--force-compression'
}

/** Same rule as `forceToken`, for the swatch in the legend and the results table. */
export function forceLabel(force: number): 'Tension' | 'Compression' | 'No force' {
  if (Math.abs(force) < ZERO_FORCE_TOLERANCE) return 'No force'
  return force > 0 ? 'Tension' : 'Compression'
}

/** The arrow head for a joint load, in screen px, pointing where the force points. */
export function loadArrow(node: TrussNode, fx: number, fy: number, view: TrussView): {
  from: TrussPoint
  to: TrussPoint
} | null {
  const magnitude = Math.hypot(fx, fy)
  if (magnitude < 1e-9) return null
  const length = Math.max(22, Math.min(56, view.scale * 0.4))
  const start = projectTruss(node, view)
  const ux = fx / magnitude
  const uy = fy / magnitude
  // Screen y is inverted, so a downward force draws a downward arrow.
  return { from: start, to: { x: start.x + ux * length, y: start.y - uy * length } }
}
