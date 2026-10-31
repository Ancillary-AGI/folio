/**
 * Board-editing primitives for the PCB canvas.
 *
 * Everything here is pure geometry and connectivity: no React, no store, no
 * three.js. That is deliberate — these are the rules a manual editor lives by
 * (what snaps, what a click grabs, which lands are still flying free) and they
 * have to be testable without a browser. The panel consumes them and owns the
 * rendering; the undo stack owns nothing but snapshots of the caller's data.
 */
import type { RouterPad } from '../manufacturing/autorouter'
import type { PCBKeepout } from '../manufacturing/pcb'

export interface BoardPoint {
  x: number
  y: number
}

/** The panel's copper model, narrowed to what editing needs. */
export interface EditableTrace {
  id: string
  layerId: string
  width: number
  points: BoardPoint[]
  netName: string
}

export interface EditableVia {
  id: string
  position: BoardPoint
  netName: string
  /** Annular ring diameter, in the panel's spelling of the field. */
  padDiameter: number
  drillDiameter: number
}

/**
 * What the designer has moved, turned or flipped on the board.
 *
 * A part's placement is the one thing the panel owns outright: copper is
 * derived, but where a package sits is a decision. Rotation and side are part of
 * that decision because both change the land positions the router, the DRC and
 * the 3-D view read, so they belong in the same record rather than in a second
 * map that can disagree with the first.
 */
export interface PlacementEdit {
  x: number
  y: number
  rotationDeg?: number
  side?: 'top' | 'bottom'
}

/** Rotate a part by a step, normalised into [0, 360). */
export function rotateStep(rotationDeg: number | undefined, stepDeg: number): number {
  const current = Number.isFinite(rotationDeg) ? (rotationDeg as number) : 0
  return ((current + stepDeg) % 360 + 360) % 360
}

/** Round a board coordinate to the nearest grid crossing. */
export function snapToGrid(point: BoardPoint, gridMm: number): BoardPoint {
  if (!Number.isFinite(gridMm) || gridMm <= 0) return { x: point.x, y: point.y }
  // Plain `0`, never `-0`: a snapped coordinate reaches readouts, exported
  // Gerber text and hash keys, where a minus sign on zero is a defect.
  const snap = (value: number): number => {
    // `steps * gridMm` is exact arithmetic in a decimal sense but not in binary:
    // 504 steps of a 0.1 mm grid arrives as 50.400000000000006. Twelve
    // significant digits is far past any real board resolution (a 100 mm board
    // at nanometre precision needs eight), so this sheds only the representation
    // error — and a snapped value is what reaches Gerber text and coordinate
    // hash keys, where that tail would be a defect, not a rounding artefact.
    const steps = Math.round(value / gridMm)
    const clean = Number((steps * gridMm).toPrecision(12))
    return clean === 0 ? 0 : clean
  }
  return { x: snap(point.x), y: snap(point.y) }
}

/**
 * Copper layer identity across the two naming schemes this app uses: the panel
 * draws `top-cu`/`bot-cu`, the router and the footprint library speak `F.Cu` and
 * `B.Cu`. Two names for the same glass are the same layer; an inner layer is
 * only ever equal to itself, because a surface trace never touches it.
 */
const LAYER_NAMES: Record<string, string> = {
  'f.cu': 'outer-top',
  'top-cu': 'outer-top',
  'top': 'outer-top',
  'b.cu': 'outer-bottom',
  'bot-cu': 'outer-bottom',
  'bottom': 'outer-bottom',
}

export function sameCopperLayer(a?: string, b?: string): boolean {
  if (!a || !b) return false
  const left = LAYER_NAMES[a.toLowerCase()] ?? a.toLowerCase()
  const right = LAYER_NAMES[b.toLowerCase()] ?? b.toLowerCase()
  return left === right
}

/** Shortest distance from a point to a segment, with the degenerate-point case. */
export function distanceToSegment(point: BoardPoint, from: BoardPoint, to: BoardPoint): number {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const spanSq = dx * dx + dy * dy
  if (spanSq === 0) return Math.hypot(point.x - from.x, point.y - from.y)
  const t = Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / spanSq))
  return Math.hypot(point.x - (from.x + t * dx), point.y - (from.y + t * dy))
}

/**
 * The nearest land to a pointer, so routing starts and ends on copper that
 * exists rather than on the grid square closest to where a pin happens to be.
 * A land on another layer is still a valid target when it is plated through:
 * its barrel spans the stackup, so dropping a trace onto it from the opposite
 * face is a connection, not a short.
 */
export function nearestLand(
  pads: readonly RouterPad[],
  point: BoardPoint,
  radiusMm: number,
  layerId?: string,
): RouterPad | null {
  let best: RouterPad | null = null
  let bestDistance = radiusMm
  for (const pad of pads) {
    const reachable = !layerId || sameCopperLayer(pad.layer, layerId) || (pad.padDrillMm ?? 0) > 0
    if (!reachable) continue
    const distance = Math.hypot(pad.x - point.x, pad.y - point.y)
    if (distance <= bestDistance) {
      bestDistance = distance
      best = pad
    }
  }
  return best
}

/** The trace whose copper a click lands on, or null when it hits bare board. */
export function traceAt(
  traces: readonly EditableTrace[],
  point: BoardPoint,
  toleranceMm: number,
): EditableTrace | null {
  let best: EditableTrace | null = null
  let bestDistance = toleranceMm
  for (const trace of traces) {
    for (let index = 1; index < trace.points.length; index += 1) {
      const distance = distanceToSegment(point, trace.points[index - 1], trace.points[index])
      if (distance < bestDistance) {
        bestDistance = distance
        best = trace
      }
    }
  }
  return best
}

/** The via under a pointer: its annular ring plus the usual grab tolerance. */
export function viaAt(
  vias: readonly EditableVia[],
  point: BoardPoint,
  toleranceMm: number,
): EditableVia | null {
  let best: EditableVia | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const via of vias) {
    const distance = Math.hypot(via.position.x - point.x, via.position.y - point.y)
    if (distance <= via.padDiameter / 2 + toleranceMm && distance < bestDistance) {
      bestDistance = distance
      best = via
    }
  }
  return best
}

/** A flyline: two land centres the copper does not yet join. */
export interface RatsnestWire {
  netName: string
  from: BoardPoint
  to: BoardPoint
}

/**
 * Normalise two dragged corners into a drawable rectangle.
 *
 * A designer may drag in any direction; the board's document format stores the
 * top-left corner and a positive extent, so both paths have to agree here
 * rather than in the canvas.
 */
export function rectFromCorners(a: BoardPoint, b: BoardPoint): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  }
}

/**
 * The keep-out a click lands in, or null over bare board.
 *
 * Later regions win: the canvas paints them in document order, so the one drawn
 * on top is the one a pointer should pick. `toleranceMm` lets a press that lands
 * just outside a thin region still grab it.
 */
export function keepoutAt(
  keepouts: readonly PCBKeepout[],
  point: BoardPoint,
  toleranceMm = 0,
): PCBKeepout | null {
  for (let index = keepouts.length - 1; index >= 0; index -= 1) {
    const keepout = keepouts[index]
    const dx = Math.max(keepout.x - point.x, 0, point.x - (keepout.x + keepout.width))
    const dy = Math.max(keepout.y - point.y, 0, point.y - (keepout.y + keepout.height))
    if (Math.hypot(dx, dy) <= toleranceMm) return keepout
  }
  return null
}

/** Cell size for the proximity hash; also the connection tolerance. */
const COPPER_TOUCH_MM = 0.25

/**
 * Ceiling on the cells one straight run may claim. A board is limited to 500 mm
 * a side, so a segment cannot reach this in practice; the cap only exists so a
 * caller with absurd geometry cannot exhaust memory.
 */
const SPAN_CELL_CAP = 8000

/**
 * Which nodes touch each other in xy is a nearest-neighbour question, and a
 * board can carry thousands of lands. Bucket positions into a grid of the touch
 * distance and probe the nine surrounding cells instead of comparing every pair.
 */
class CopperIndex {
  /** Cells → node keys (`<node>|<layer>`), for point-like copper: vertices and vias. */
  readonly nodes = new Map<string, string[]>()
  /** Cells → `<traceId>|<layerId>`, for the body of a track between its vertices. */
  readonly spans = new Map<string, string[]>()

  addNode(key: string, point: BoardPoint): void {
    insert(this.nodes, this.cellKey(point), key)
  }

  /**
   * Register a straight run of copper along a segment.
   *
   * A land sitting in the middle of a track is connected to it, but the track's
   * polyline only has vertices at its ends and corners. Sampling the segment one
   * cell at a time is what makes those mid-span contacts visible without
   * comparing every land to every segment on the board.
   */
  addSpan(traceId: string, layerId: string, from: BoardPoint, to: BoardPoint): void {
    const length = Math.hypot(to.x - from.x, to.y - from.y)
    const steps = Math.max(1, Math.min(SPAN_CELL_CAP, Math.ceil(length / COPPER_TOUCH_MM)))
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps
      insert(this.spans, this.cellKey({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }), `${traceId}|${layerId}`)
    }
  }

  /** Keys in the nine cells around a point — enough to cover the touch distance. */
  near(point: BoardPoint): { nodes: string[], spans: string[] } {
    const { cx, cy } = this.cellOf(point)
    const nodes: string[] = []
    const spans: string[] = []
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const cell = `${cx + dx}|${cy + dy}`
        const bucketNodes = this.nodes.get(cell)
        if (bucketNodes) nodes.push(...bucketNodes)
        const bucketSpans = this.spans.get(cell)
        if (bucketSpans) spans.push(...bucketSpans)
      }
    }
    return { nodes, spans }
  }

  private cellOf(point: BoardPoint): { cx: number, cy: number } {
    return {
      cx: Math.floor(point.x / COPPER_TOUCH_MM),
      cy: Math.floor(point.y / COPPER_TOUCH_MM),
    }
  }

  private cellKey(point: BoardPoint): string {
    const { cx, cy } = this.cellOf(point)
    return `${cx}|${cy}`
  }
}

function insert(index: Map<string, string[]>, cell: string, key: string): void {
  const bucket = index.get(cell)
  if (bucket) bucket.push(key)
  else index.set(cell, [key])
}

/** Union-find over string keys. */
class DisjointSet {
  private readonly parent = new Map<string, string>()

  find(key: string): string {
    const existing = this.parent.get(key)
    if (existing === undefined) {
      this.parent.set(key, key)
      return key
    }
    if (existing === key) return key
    const root = this.find(existing)
    this.parent.set(key, root)
    return root
  }

  union(a: string, b: string): void {
    const rootA = this.find(a)
    const rootB = this.find(b)
    if (rootA !== rootB) this.parent.set(rootB, rootA)
  }
}

/** Split a `<node>|<layer>` touch key; node ids never contain a pipe. */
function splitTouch(touch: string): [string, string] {
  const separator = touch.lastIndexOf('|')
  return [touch.slice(0, separator), touch.slice(separator + 1)]
}

/**
 * The ratsnest: one straight flyline for every group of lands on a net that the
 * copper on that net does not already join.
 *
 * Connectivity is a union-find over three kinds of node — a trace, a via barrel,
 * a land. Consecutive vertices of a trace are one conductor; a via merges every
 * conductor at its position whatever layer they are on, because that is what a
 * plated hole is; a land merges with copper under it when the layer matches, or
 * when either side is plated through and the barrel spans the stackup. Whatever
 * the user has not joined stays separate, and the lines drawn between the
 * separate groups are the flighting a professional editor shows before routing.
 *
 * The solve runs one net at a time, because that is what connectivity means: a
 * land lying on someone else's trace is not routed. Measured on the laptop
 * mainboard, a shared cross-net index read 485 vias and 103 traces as joiners it
 * never were and flew 6 lines for the 14 nets the router left open — the panel
 * would have told the designer the board was nearly finished.
 *
 * Each disconnected group is represented by one of its lands, so a net pulled
 * apart into four islands gets three flylines, not the full cross product.
 */
export function ratsnest(
  pads: readonly RouterPad[],
  traces: readonly EditableTrace[],
  vias: readonly EditableVia[],
): RatsnestWire[] {
  const landsByNet = new Map<string, RouterPad[]>()
  for (const pad of pads) {
    if (!pad.netId) continue
    const group = landsByNet.get(pad.netId)
    if (group) group.push(pad)
    else landsByNet.set(pad.netId, [pad])
  }
  const copperByNet = new Map<string, { traces: EditableTrace[], vias: EditableVia[] }>()
  const copperOf = (net: string) => {
    const group = copperByNet.get(net)
    if (group) return group
    const fresh = { traces: [] as EditableTrace[], vias: [] as EditableVia[] }
    copperByNet.set(net, fresh)
    return fresh
  }
  for (const trace of traces) copperOf(trace.netName).traces.push(trace)
  for (const via of vias) copperOf(via.netName).vias.push(via)

  const wires: RatsnestWire[] = []
  for (const [netName, netPads] of landsByNet) {
    if (netPads.length < 2) continue
    const copper = copperByNet.get(netName) ?? { traces: [], vias: [] }
    const representatives = islandRepresentatives(netPads, copper.traces, copper.vias)
    for (let index = 1; index < representatives.length; index += 1) {
      wires.push({ netName, from: representatives[0], to: representatives[index] })
    }
  }
  return wires
}

/** One point per copper island the lands of one net fall into; empty when joined. */
function islandRepresentatives(
  pads: readonly RouterPad[],
  traces: readonly EditableTrace[],
  vias: readonly EditableVia[],
): BoardPoint[] {
  const set = new DisjointSet()
  const copper = new CopperIndex()

  for (const trace of traces) {
    for (let index = 0; index < trace.points.length; index += 1) {
      const key = `t:${trace.id}:${index}`
      set.find(key)
      copper.addNode(`${key}|${trace.layerId}`, trace.points[index])
      if (index > 0) set.union(`t:${trace.id}:${index - 1}`, key)
    }
    for (let index = 1; index < trace.points.length; index += 1) {
      copper.addSpan(trace.id, trace.layerId, trace.points[index - 1], trace.points[index])
    }
  }
  for (const via of vias) {
    set.find(`v:${via.id}`)
    copper.addNode(`v:${via.id}|*`, via.position)
  }

  const tracesById = new Map(traces.map(trace => [trace.id, trace]))

  /**
   * Merge `node` with everything the index offers at `point`. `onLayer` decides
   * which copper the node can legally see: a via or a plated land sees every
   * layer, a surface land only its own. The `*` marker is a via and is always
   * visible, because joining to a via is itself the layer change.
   */
  const merge = (node: string, point: BoardPoint, onLayer: (layer: string) => boolean): void => {
    const { nodes, spans } = copper.near(point)
    const seen = new Set<string>()
    for (const touch of nodes) {
      const [target, layer] = splitTouch(touch)
      if (layer === '*' || onLayer(layer)) set.union(node, target)
    }
    for (const touch of spans) {
      const [traceId, layer] = splitTouch(touch)
      if (layer !== '*' && !onLayer(layer)) continue
      if (seen.has(traceId)) continue
      seen.add(traceId)
      const trace = tracesById.get(traceId)
      if (!trace || !touchesPolyline(point, trace.points)) continue
      set.union(node, `t:${traceId}:0`)
    }
  }

  for (const via of vias) merge(`v:${via.id}`, via.position, () => true)

  for (const pad of pads) {
    const key = `p:${pad.componentId}:${pad.pinId}`
    set.find(key)
    const plated = (pad.padDrillMm ?? 0) > 0
    merge(key, { x: pad.x, y: pad.y }, layer => plated || sameCopperLayer(layer, pad.layer))
  }

  const representatives = new Map<string, BoardPoint>()
  for (const pad of pads) {
    const root = set.find(`p:${pad.componentId}:${pad.pinId}`)
    if (!representatives.has(root)) representatives.set(root, { x: pad.x, y: pad.y })
  }
  return [...representatives.values()]
}

/** Does this point lie on this polyline within the copper touch distance? */
function touchesPolyline(point: BoardPoint, points: readonly BoardPoint[]): boolean {
  for (let index = 1; index < points.length; index += 1) {
    if (distanceToSegment(point, points[index - 1], points[index]) <= COPPER_TOUCH_MM) return true
  }
  return false
}

/**
 * An undo stack that stores whole board snapshots.
 *
 * Delta-based history is the clever version and the one that loses a user's work
 * when a mutation forgets to record its inverse. Board edits are small and the
 * depth is capped, so keeping past/present/future as plain values — and keeping
 * them pure — is the version that can be trusted and tested.
 */
export interface History<T> {
  past: T[]
  present: T
  future: T[]
}

/** Edits a person can step back through: a few dozen boards is plenty. */
export const HISTORY_DEPTH = 40

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] }
}

/** Record a committed edit. Drops the redo branch: a new action after an undo
 *  abandons the undone future, exactly as every editor's history does. */
export function commitHistory<T>(history: History<T>, next: T): History<T> {
  if (next === history.present) return history
  const past = [...history.past, history.present]
  return {
    past: past.length > HISTORY_DEPTH ? past.slice(past.length - HISTORY_DEPTH) : past,
    present: next,
    future: [],
  }
}

export function undoHistory<T>(history: History<T>): History<T> {
  const previous = history.past[history.past.length - 1]
  if (previous === undefined) return history
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  }
}

export function redoHistory<T>(history: History<T>): History<T> {
  const next = history.future[0]
  if (next === undefined) return history
  return {
    past: [...history.past, history.present],
    present: next,
    future: history.future.slice(1),
  }
}
