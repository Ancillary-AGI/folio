/**
 * PCB Auto-Router — Lee (Breadth-First) + A* hybrid with multi-layer support.
 *
 * Implements a grid-based routing algorithm suitable for two-layer through-hole
 * and SMD boards.  The algorithm:
 *
 *  1. Builds a routing grid from the PCB dimensions and design rules.
 *  2. For each net, gathers all pads that need to be connected.
 *  3. Routes the net using a minimum spanning tree over pad pairs, ordering
 *     pairs by Manhattan distance (shortest first — reduces crossing).
 *  4. Each individual segment uses bidirectional A* on the per-layer grid with
 *     via penalty for layer changes.
 *  5. After routing, marks all routed cells as obstacles.
 *
 * Limitations (known):
 *   - No rip-up-and-reroute: a later net that cannot find a path fails rather
 *     than evicting an earlier route.  A future version can add RR passes.
 *   - Manhattan distance heuristic → routes at 45° are approximated.
 *   - Grid cell size = max(minTraceWidth, minTraceSpacing) (conservative).
 *
 * Output:
 *   RouterResult contains the routed traces and any unrouted nets, suitable
 *   for feeding into fabExport.ts.
 */

import type { PlacedComponent, Net } from '../../types'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RouterConfig {
  boardWidthMm: number
  boardHeightMm: number
  layers: string[]         // e.g. ['F.Cu', 'B.Cu']
  gridMm: number           // grid cell size in mm (typ. 0.2 – 0.5)
  minTraceWidthMm: number  // trace width for routed segments
  minSpacingMm: number     // clearance between adjacent copper
  viaDrillMm: number       // via drill diameter
  viaPadMm: number         // via pad outer diameter
  viaPenalty: number       // cost units to use a via (default 5)
}

export interface RouterPad {
  netId: string
  componentId: string
  pinId: string
  x: number   // mm from board origin
  y: number
  layer: string
  /**
   * Copper diameter in mm. Omit for the conservative 1.6 mm through-hole disc;
   * a real footprint should pass its pad size so adjacent fine-pitch pins are
   * not over-blocked into an unroutable board.
   */
  padDiameterMm?: number
}

export interface RouterTrace {
  netId: string
  layerId: string
  widthMm: number
  points: Array<{ x: number; y: number }>
}

export interface RouterVia {
  netId: string
  x: number
  y: number
  drillMm: number
  padMm: number
}

export interface RouterResult {
  /**
   * Copper produced by the search. A net listed in `unrouted` may still have
   * partial traces here for the MST segments that did succeed; they were
   * already claimed on the grid, so the geometry matches what blocked later
   * nets.
   */
  traces: RouterTrace[]
  vias: RouterVia[]
  /** Nets with at least two pads where any MST segment found no path. */
  unrouted: string[]
  /** Fraction of routeable nets (two or more pads) fully routed, 0 – 1. */
  completionRate: number
  stats: {
    totalNets: number
    routedNets: number
    totalVias: number
    totalTraceLength: number  // mm
  }
}

// ─── Grid ────────────────────────────────────────────────────────────────────

class RoutingGrid {
  readonly cols: number
  readonly rows: number
  readonly layers: string[]
  /**
   * One reservation counter per cell. Counts matter rather than bits: pad
   * keepouts of nearby nets overlap, and releasing one pad's landing area must
   * not erase the clearance another pad still owns. Claims made by routed
   * copper are permanent and simply keep incrementing.
   */
  private grid: Uint16Array[]

  constructor(config: RouterConfig) {
    this.cols = Math.ceil(config.boardWidthMm / config.gridMm) + 1
    this.rows = Math.ceil(config.boardHeightMm / config.gridMm) + 1
    this.layers = config.layers
    this.grid = config.layers.map(() => new Uint16Array(this.cols * this.rows))
  }

  private idx(col: number, row: number): number {
    return row * this.cols + col
  }

  isBlocked(layer: number, col: number, row: number): boolean {
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return true
    return this.grid[layer][this.idx(col, row)] > 0
  }

  block(layer: number, col: number, row: number): void {
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return
    const cell = this.idx(col, row)
    if (this.grid[layer][cell] < 0xffff) this.grid[layer][cell] += 1
  }

  unblock(layer: number, col: number, row: number): void {
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return
    const cell = this.idx(col, row)
    if (this.grid[layer][cell] > 0) this.grid[layer][cell] -= 1
  }

  /** Block a rectangular region (pad keepout) */
  blockRect(layer: number, x0: number, y0: number, x1: number, y1: number): void {
    forEachCell(this, x0, y0, x1, y1, (c, r) => this.block(layer, c, r))
  }

}

function forEachCell(
  grid: RoutingGrid,
  x0: number, y0: number, x1: number, y1: number,
  fn: (col: number, row: number) => void,
): void {
  const c0 = Math.max(0, x0), c1 = Math.min(grid.cols - 1, x1)
  const r0 = Math.max(0, y0), r1 = Math.min(grid.rows - 1, y1)
  for (let row = r0; row <= r1; row += 1) {
    for (let col = c0; col <= c1; col += 1) fn(col, row)
  }
}

// ─── A* search ───────────────────────────────────────────────────────────────

interface GridNode {
  layer: number; col: number; row: number
}

interface AStarNode {
  g: number; h: number; f: number
  parent: AStarNode | null
  node: GridNode
}

const DIRS4 = [[0,1],[0,-1],[1,0],[-1,0]] as const

function manhattan(a: GridNode, b: GridNode): number {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row)
}

function key(n: GridNode): string {
  return `${n.layer},${n.col},${n.row}`
}

/** Minimal binary heap for A* open set */
class MinHeap<T extends { f: number }> {
  private data: T[] = []
  push(item: T): void {
    this.data.push(item)
    this._bubbleUp(this.data.length - 1)
  }
  pop(): T | undefined {
    if (this.data.length === 0) return undefined
    const top = this.data[0]
    const last = this.data.pop()!
    if (this.data.length > 0) { this.data[0] = last; this._sinkDown(0) }
    return top
  }
  get size(): number { return this.data.length }
  private _bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.data[parent].f <= this.data[i].f) break
      ;[this.data[parent], this.data[i]] = [this.data[i], this.data[parent]]
      i = parent
    }
  }
  private _sinkDown(i: number): void {
    const n = this.data.length
    while (true) {
      let min = i
      const l = 2 * i + 1, r = 2 * i + 2
      if (l < n && this.data[l].f < this.data[min].f) min = l
      if (r < n && this.data[r].f < this.data[min].f) min = r
      if (min === i) break
      ;[this.data[min], this.data[i]] = [this.data[i], this.data[min]]
      i = min
    }
  }
}

function astar(
  grid: RoutingGrid,
  start: GridNode,
  end: GridNode,
  viaPenalty: number,
  maxExpand = 50_000,
): GridNode[] | null {
  const open = new MinHeap<AStarNode>()
  const visited = new Map<string, AStarNode>()

  const startNode: AStarNode = { g: 0, h: manhattan(start, end), f: manhattan(start, end), parent: null, node: start }
  open.push(startNode)
  visited.set(key(start), startNode)

  let expanded = 0
  while (open.size > 0 && expanded < maxExpand) {
    expanded++
    const current = open.pop()!
    const cn = current.node

    // A cheaper path to this node was already expanded; skip the stale entry.
    if (visited.get(key(cn)) !== current) continue

    if (cn.layer === end.layer && cn.col === end.col && cn.row === end.row) {
      // Reconstruct path
      const path: GridNode[] = []
      let node: AStarNode | null = current
      while (node) { path.push(node.node); node = node.parent }
      return path.reverse()
    }

    // Same-layer moves
    for (const [dc, dr] of DIRS4) {
      const nc = cn.col + dc, nr = cn.row + dr
      if (grid.isBlocked(cn.layer, nc, nr)) continue
      const neighbor: GridNode = { layer: cn.layer, col: nc, row: nr }
      const nk = key(neighbor)
      const ng = current.g + 1
      const existing = visited.get(nk)
      if (existing && existing.g <= ng) continue
      const h = manhattan(neighbor, end)
      const nn: AStarNode = { g: ng, h, f: ng + h, parent: current, node: neighbor }
      open.push(nn)
      visited.set(nk, nn)
    }

    // Via: switch to every other layer at the same position
    for (let layer = 0; layer < grid.layers.length; layer++) {
      if (layer === cn.layer) continue
      if (grid.isBlocked(layer, cn.col, cn.row)) continue
      const neighbor: GridNode = { layer, col: cn.col, row: cn.row }
      const nk = key(neighbor)
      const ng = current.g + viaPenalty
      const existing = visited.get(nk)
      if (existing && existing.g <= ng) continue
      const h = manhattan(neighbor, end)
      const nn: AStarNode = { g: ng, h, f: ng + h, parent: current, node: neighbor }
      open.push(nn)
      visited.set(nk, nn)
    }
  }

  return null  // no path found
}

// ─── Path → traces + vias conversion ─────────────────────────────────────────

function pathToTracesAndVias(
  path: GridNode[],
  netId: string,
  gridMm: number,
  traceWidthMm: number,
  viaDrillMm: number,
  viaPadMm: number,
  layerNames: string[],
): { traces: RouterTrace[]; vias: RouterVia[] } {
  const traces: RouterTrace[] = []
  const vias: RouterVia[] = []

  if (path.length < 2) return { traces, vias }

  let segStart = path[0]
  const currentPoints: Array<{ x: number; y: number }> = [{
    x: segStart.col * gridMm,
    y: segStart.row * gridMm,
  }]
  const viaKeys = new Set<string>()

  const pushPoint = (node: GridNode): void => {
    const point = { x: node.col * gridMm, y: node.row * gridMm }
    const last = currentPoints[currentPoints.length - 1]
    // A via chain can revisit the same cell; a repeated vertex is a zero-length
    // segment and would emit degenerate geometry downstream.
    if (last && last.x === point.x && last.y === point.y) return
    currentPoints.push(point)
  }

  for (let i = 1; i < path.length; i++) {
    const prev = path[i - 1]
    const curr = path[i]

    if (curr.layer !== prev.layer) {
      // Finish current segment at the via location.
      pushPoint(prev)
      if (currentPoints.length >= 2) {
        traces.push({ netId, layerId: layerNames[segStart.layer], widthMm: traceWidthMm, points: [...currentPoints] })
      }
      // A through via covers every layer transition at this coordinate.
      const viaKey = `${prev.col},${prev.row}`
      if (!viaKeys.has(viaKey)) {
        viaKeys.add(viaKey)
        vias.push({ netId, x: prev.col * gridMm, y: prev.row * gridMm, drillMm: viaDrillMm, padMm: viaPadMm })
      }
      // Start new segment on new layer
      segStart = curr
      currentPoints.length = 0
      currentPoints.push({ x: curr.col * gridMm, y: curr.row * gridMm })
    } else {
      pushPoint(curr)
    }
  }

  // Final segment
  if (currentPoints.length >= 2) {
    traces.push({ netId, layerId: layerNames[segStart.layer], widthMm: traceWidthMm, points: [...currentPoints] })
  }

  return { traces, vias }
}

// ─── Pad blocking ─────────────────────────────────────────────────────────────

interface PadKeepout {
  layer: number
  col: number
  row: number
  radiusMm: number
}

/**
 * Keepout covering the pad plus trace half-width and copper clearance.
 *
 * The copper disc comes from `pad.padDiameterMm` when the caller knows the
 * footprint, otherwise a conservative 1.6 mm through-hole disc
 * (`max(viaPadMm/2, 0.8 mm)` radius) is assumed. Making the caller state the
 * pad size matters: the default disc around two 1 mm-pitch SMD pins overlaps
 * completely and would report a routable footprint as unroutable.
 */
function padKeepout(grid: RoutingGrid, pad: RouterPad, config: RouterConfig): PadKeepout | null {
  const layer = grid.layers.indexOf(pad.layer)
  if (layer < 0) return null

  const clearanceMm = config.minSpacingMm + config.minTraceWidthMm / 2
  const padRadiusMm = pad.padDiameterMm !== undefined
    ? pad.padDiameterMm / 2
    : Math.max(config.viaPadMm / 2, 0.8)
  return {
    layer,
    col: Math.round(pad.x / config.gridMm),
    row: Math.round(pad.y / config.gridMm),
    radiusMm: padRadiusMm + clearanceMm,
  }
}

/**
 * Reserve or release a pad's disc. Cells are tested by their centre distance,
 * not by the disc's bounding square: the square would reach 41 % further at the
 * corners and make two legally spaced pads permanently block each other's
 * landing cells once keepouts are reference-counted.
 */
function setPadKeepout(grid: RoutingGrid, pad: RouterPad, config: RouterConfig, blocked: boolean): void {
  const keepout = padKeepout(grid, pad, config)
  if (!keepout) return
  const radiusCells = Math.ceil(keepout.radiusMm / config.gridMm)
  const radiusSquared = keepout.radiusMm * keepout.radiusMm
  for (let row = keepout.row - radiusCells; row <= keepout.row + radiusCells; row += 1) {
    for (let col = keepout.col - radiusCells; col <= keepout.col + radiusCells; col += 1) {
      const dx = (col - keepout.col) * config.gridMm
      const dy = (row - keepout.row) * config.gridMm
      if (dx * dx + dy * dy > radiusSquared + 1e-12) continue
      if (blocked) grid.block(keepout.layer, col, row)
      else grid.unblock(keepout.layer, col, row)
    }
  }
}

// ─── Minimum spanning tree over pads (Prim's algorithm) ──────────────────────

function buildMST(pads: RouterPad[]): Array<[RouterPad, RouterPad]> {
  if (pads.length < 2) return []
  const inTree = new Set<number>([0])
  const edges: Array<[RouterPad, RouterPad]> = []

  while (inTree.size < pads.length) {
    let minDist = Infinity
    let bestI = -1, bestJ = -1

    for (const i of inTree) {
      for (let j = 0; j < pads.length; j++) {
        if (inTree.has(j)) continue
        const dx = pads[i].x - pads[j].x
        const dy = pads[i].y - pads[j].y
        const d = Math.sqrt(dx * dx + dy * dy)
        if (d < minDist) { minDist = d; bestI = i; bestJ = j }
      }
    }
    if (bestJ < 0) break
    edges.push([pads[bestI], pads[bestJ]])
    inTree.add(bestJ)
  }

  return edges
}

// ─── Main autorouter ─────────────────────────────────────────────────────────

/**
 * Route all nets on the given board.
 *
 * @param pads    All component pads (from schematic-to-PCB conversion)
 * @param config  Board + design rule parameters
 */
export function autoroute(
  pads: RouterPad[],
  config: RouterConfig,
): RouterResult {
  const cfg: RouterConfig = {
    boardWidthMm: config.boardWidthMm ?? 100,
    boardHeightMm: config.boardHeightMm ?? 80,
    layers: config.layers ?? ['F.Cu', 'B.Cu'],
    gridMm: config.gridMm ?? 0.5,
    minTraceWidthMm: config.minTraceWidthMm ?? 0.2,
    minSpacingMm: config.minSpacingMm ?? 0.2,
    viaDrillMm: config.viaDrillMm ?? 0.3,
    viaPadMm: config.viaPadMm ?? 0.6,
    viaPenalty: config.viaPenalty ?? 8,
  }

  // Reject configs that would otherwise build a zero-sized grid and quietly
  // report every net as unrouted.
  const positive = (name: keyof RouterConfig, value: number): void => {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`Router ${name} must be a positive finite number (got ${value}).`)
    }
  }
  const nonNegative = (name: keyof RouterConfig, value: number): void => {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`Router ${name} must be a non-negative finite number (got ${value}).`)
    }
  }
  positive('boardWidthMm', cfg.boardWidthMm)
  positive('boardHeightMm', cfg.boardHeightMm)
  positive('gridMm', cfg.gridMm)
  positive('minTraceWidthMm', cfg.minTraceWidthMm)
  positive('viaDrillMm', cfg.viaDrillMm)
  positive('viaPadMm', cfg.viaPadMm)
  nonNegative('minSpacingMm', cfg.minSpacingMm)
  nonNegative('viaPenalty', cfg.viaPenalty)
  if (cfg.layers.length === 0) throw new Error('Router needs at least one copper layer.')
  if (cfg.layers.some((layer) => typeof layer !== 'string' || layer.length === 0)) {
    throw new Error('Router layer names must be non-empty strings.')
  }
  if (new Set(cfg.layers).size !== cfg.layers.length) {
    throw new Error('Router layer names must be unique.')
  }
  if (cfg.viaPadMm < cfg.viaDrillMm) {
    throw new Error(
      `Router via pad diameter (${cfg.viaPadMm} mm) cannot be smaller than its drill (${cfg.viaDrillMm} mm).`,
    )
  }

  for (const pad of pads) {
    if (!Number.isFinite(pad.x) || !Number.isFinite(pad.y)) {
      throw new Error(
        `Pad ${pad.componentId}:${pad.pinId} has non-finite coordinates (${pad.x}, ${pad.y}).`,
      )
    }
    if (!cfg.layers.includes(pad.layer)) {
      // Silently snapping to layer 0 would route a different board.
      throw new Error(
        `Pad ${pad.componentId}:${pad.pinId} is on "${pad.layer}", which is not a routing layer.`,
      )
    }
    if (pad.netId.length === 0) {
      throw new Error(`Pad ${pad.componentId}:${pad.pinId} has no net id.`)
    }
    if (
      pad.padDiameterMm !== undefined &&
      !(Number.isFinite(pad.padDiameterMm) && pad.padDiameterMm > 0)
    ) {
      throw new Error(
        `Pad ${pad.componentId}:${pad.pinId} has an invalid copper diameter (${pad.padDiameterMm} mm).`,
      )
    }
  }

  const grid = new RoutingGrid(cfg)

  // Group pads by net
  const netPads = new Map<string, RouterPad[]>()
  for (const pad of pads) {
    if (!netPads.has(pad.netId)) netPads.set(pad.netId, [])
    netPads.get(pad.netId)!.push(pad)
  }

  // Every pad is an obstacle until its own net is routed.
  for (const pad of pads) setPadKeepout(grid, pad, cfg, true)

  const allTraces: RouterTrace[] = []
  const allVias: RouterVia[] = []
  const unrouted: string[] = []
  let totalTraceLength = 0

  // Route the shortest nets first — long nets have fewer legal channels once
  // the short ones claim their copper.
  const routeableNets = Array.from(netPads.entries())
    .filter(([, netPadList]) => netPadList.length >= 2)
    .sort((a, b) => spanOf(a[1]) - spanOf(b[1]))

  for (const [netId, netPadList] of routeableNets) {
    // Own pads (and their required landing clearance) become reachable.
    for (const pad of netPadList) setPadKeepout(grid, pad, cfg, false)

    const edges = buildMST(netPadList)
    let netRouted = true
    const netPaths: GridNode[] = []
    const netVias: RouterVia[] = []

    for (const [padA, padB] of edges) {
      const startNode: GridNode = {
        layer: Math.max(0, grid.layers.indexOf(padA.layer)),
        col: Math.round(padA.x / cfg.gridMm),
        row: Math.round(padA.y / cfg.gridMm),
      }
      const endNode: GridNode = {
        layer: Math.max(0, grid.layers.indexOf(padB.layer)),
        col: Math.round(padB.x / cfg.gridMm),
        row: Math.round(padB.y / cfg.gridMm),
      }

      const path = astar(grid, startNode, endNode, cfg.viaPenalty)
      if (!path) {
        netRouted = false
        continue
      }
      netPaths.push(...path)

      const { traces, vias } = pathToTracesAndVias(
        path, netId, cfg.gridMm,
        cfg.minTraceWidthMm,
        cfg.viaDrillMm,
        cfg.viaPadMm,
        grid.layers,
      )

      allTraces.push(...traces)
      allVias.push(...vias)
      netVias.push(...vias)

      for (const trace of traces) {
        for (let i = 1; i < trace.points.length; i++) {
          totalTraceLength += Math.hypot(
            trace.points[i].x - trace.points[i - 1].x,
            trace.points[i].y - trace.points[i - 1].y,
          )
        }
      }
    }

    // Claim the finished net's copper (with clearance) for later nets, then
    // restore its pad keepouts so no other net can route through them. The
    // trace claim includes its half-width, and a via additionally claims its
    // barrel radius; both matter on fine grids where a single cell is smaller
    // than the copper it is standing in for.
    const clearanceCells = Math.ceil(
      (cfg.minSpacingMm + cfg.minTraceWidthMm / 2) / cfg.gridMm,
    )
    for (const node of netPaths) {
      grid.blockRect(node.layer, node.col - clearanceCells, node.row - clearanceCells,
        node.col + clearanceCells, node.row + clearanceCells)
    }
    const viaCells = Math.ceil((cfg.viaPadMm / 2 + cfg.minSpacingMm) / cfg.gridMm)
    for (const via of netVias) {
      const col = Math.round(via.x / cfg.gridMm)
      const row = Math.round(via.y / cfg.gridMm)
      for (let layer = 0; layer < grid.layers.length; layer += 1) {
        grid.blockRect(layer, col - viaCells, row - viaCells, col + viaCells, row + viaCells)
      }
    }
    for (const pad of netPadList) setPadKeepout(grid, pad, cfg, true)

    if (!netRouted) unrouted.push(netId)
  }

  const totalNets = routeableNets.length
  const routedNets = totalNets - unrouted.length

  return {
    traces: allTraces,
    vias: allVias,
    unrouted,
    completionRate: totalNets > 0 ? routedNets / totalNets : 1,
    stats: {
      totalNets,
      routedNets,
      totalVias: allVias.length,
      totalTraceLength: Math.round(totalTraceLength * 100) / 100,
    },
  }
}

/** Bounding-box diagonal of a net's pads, used for short-first ordering. */
function spanOf(pads: RouterPad[]): number {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const pad of pads) {
    if (pad.x < minX) minX = pad.x
    if (pad.y < minY) minY = pad.y
    if (pad.x > maxX) maxX = pad.x
    if (pad.y > maxY) maxY = pad.y
  }
  return Math.hypot(maxX - minX, maxY - minY)
}

// ─── Convert PlacedComponent pads to RouterPad ────────────────────────────────

/**
 * Build the flat list of router pads from placed components and their net
 * assignments.  Each component pin that has a net connection becomes a pad.
 */
export function buildRouterPads(
  components: PlacedComponent[],
  nets: Net[],
): RouterPad[] {
  const pinToNet = new Map<string, string>()
  for (const net of nets) {
    for (const pin of net.connectedPins) {
      pinToNet.set(`${pin.componentId}:${pin.pinId}`, net.id)
    }
  }

  const pads: RouterPad[] = []
  for (const comp of components) {
    const radians = (comp.rotation * Math.PI) / 180
    const cos = Math.cos(radians)
    const sin = Math.sin(radians)
    const scale = Number.isFinite(comp.scale) ? comp.scale : 1
    for (const pin of comp.component.pins) {
      const netId = pinToNet.get(`${comp.id}:${pin.id}`)
      if (!netId) continue

      const localX = pin.x * scale
      const localY = pin.y * scale
      pads.push({
        netId,
        componentId: comp.id,
        pinId: pin.id,
        // Rotate pin position by component rotation and translate to placement
        x: comp.position.x + localX * cos - localY * sin,
        y: comp.position.y + localX * sin + localY * cos,
        layer: 'F.Cu',  // default to front copper (through-hole goes both sides)
      })
    }
  }

  return pads
}
