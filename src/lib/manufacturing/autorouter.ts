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
  traces: RouterTrace[]
  vias: RouterVia[]
  /** Nets that could not be fully routed */
  unrouted: string[]
  /** Coverage fraction (0 – 1) */
  completionRate: number
  stats: {
    totalNets: number
    routedNets: number
    totalVias: number
    totalTraceLength: number  // mm
  }
}

// ─── Grid ────────────────────────────────────────────────────────────────────

type Cell = number  // bit flags: bit 0 = blocked, bits 1-4 = layer index

const BLOCKED = 1

class RoutingGrid {
  readonly cols: number
  readonly rows: number
  readonly layers: string[]
  private grid: Uint8Array[]   // one typed array per layer

  constructor(config: RouterConfig) {
    this.cols = Math.ceil(config.boardWidthMm / config.gridMm) + 1
    this.rows = Math.ceil(config.boardHeightMm / config.gridMm) + 1
    this.layers = config.layers
    this.grid = config.layers.map(() => new Uint8Array(this.cols * this.rows))
  }

  private idx(col: number, row: number): number {
    return row * this.cols + col
  }

  isBlocked(layer: number, col: number, row: number): boolean {
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return true
    return (this.grid[layer][this.idx(col, row)] & BLOCKED) !== 0
  }

  block(layer: number, col: number, row: number): void {
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return
    this.grid[layer][this.idx(col, row)] |= BLOCKED
  }

  /** Block a rectangular region (pad keepout) */
  blockRect(layer: number, x0: number, y0: number, x1: number, y1: number): void {
    const c0 = Math.max(0, x0), c1 = Math.min(this.cols - 1, x1)
    const r0 = Math.max(0, y0), r1 = Math.min(this.rows - 1, y1)
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.block(layer, c, r)
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

  for (let i = 1; i < path.length; i++) {
    const prev = path[i - 1]
    const curr = path[i]

    if (curr.layer !== prev.layer) {
      // Finish current segment
      currentPoints.push({ x: prev.col * gridMm, y: prev.row * gridMm })
      if (currentPoints.length >= 2) {
        traces.push({ netId, layerId: layerNames[segStart.layer], widthMm: traceWidthMm, points: [...currentPoints] })
      }
      // Place via
      vias.push({ netId, x: prev.col * gridMm, y: prev.row * gridMm, drillMm: viaDrillMm, padMm: viaPadMm })
      // Start new segment on new layer
      segStart = curr
      currentPoints.length = 0
      currentPoints.push({ x: curr.col * gridMm, y: curr.row * gridMm })
    } else {
      currentPoints.push({ x: curr.col * gridMm, y: curr.row * gridMm })
    }
  }

  // Final segment
  const last = path[path.length - 1]
  currentPoints.push({ x: last.col * gridMm, y: last.row * gridMm })
  if (currentPoints.length >= 2) {
    traces.push({ netId, layerId: layerNames[segStart.layer], widthMm: traceWidthMm, points: currentPoints })
  }

  return { traces, vias }
}

// ─── Pad blocking ─────────────────────────────────────────────────────────────

function blockPad(
  grid: RoutingGrid,
  pad: RouterPad,
  config: RouterConfig,
  excludeNet?: string,
): void {
  if (pad.netId === excludeNet) return  // don't block own net pads

  const clearanceMm = config.minSpacingMm + config.minTraceWidthMm / 2
  const padRadiusMm = Math.max(config.viaPadMm / 2, 0.8)
  const totalMm = padRadiusMm + clearanceMm

  const cx = Math.round(pad.x / config.gridMm)
  const cy = Math.round(pad.y / config.gridMm)
  const radiusCells = Math.ceil(totalMm / config.gridMm)

  const layerIndex = grid.layers.indexOf(pad.layer)
  if (layerIndex < 0) return

  grid.blockRect(layerIndex, cx - radiusCells, cy - radiusCells, cx + radiusCells, cy + radiusCells)
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
 * @param nets    Netlist (component connectivity)
 * @param config  Board + design rule parameters
 */
export function autoroute(
  pads: RouterPad[],
  _nets: Net[],
  config: RouterConfig,
): RouterResult {
  const defaultConfig: RouterConfig = {
    boardWidthMm: 100,
    boardHeightMm: 80,
    layers: ['F.Cu', 'B.Cu'],
    gridMm: 0.5,
    minTraceWidthMm: 0.2,
    minSpacingMm: 0.2,
    viaDrillMm: 0.3,
    viaPadMm: 0.6,
    viaPenalty: 8,
    ...config,
  }

  const grid = new RoutingGrid(defaultConfig)

  // Group pads by net
  const netPads = new Map<string, RouterPad[]>()
  for (const pad of pads) {
    if (!netPads.has(pad.netId)) netPads.set(pad.netId, [])
    netPads.get(pad.netId)!.push(pad)
  }

  // Block all pad keepout areas initially
  for (const pad of pads) {
    blockPad(grid, pad, defaultConfig)
  }

  const allTraces: RouterTrace[] = []
  const allVias: RouterVia[] = []
  const unrouted: string[] = []
  let totalTraceLength = 0

  // Sort nets by total pad-to-pad distance (shortest first)
  const netList = Array.from(netPads.entries()).sort((a, b) => {
    const distA = a[1].reduce((acc, p, i) => i === 0 ? 0 : acc + Math.hypot(p.x - a[1][i-1].x, p.y - a[1][i-1].y), 0)
    const distB = b[1].reduce((acc, p, i) => i === 0 ? 0 : acc + Math.hypot(p.x - b[1][i-1].x, p.y - b[1][i-1].y), 0)
    return distA - distB
  })

  for (const [netId, netPadList] of netList) {
    if (netPadList.length < 2) continue

    // Temporarily unblock own pads so we can connect to them
    for (const pad of netPadList) {
      const layerIndex = grid.layers.indexOf(pad.layer)
      if (layerIndex >= 0) {
        const cx = Math.round(pad.x / defaultConfig.gridMm)
        const cy = Math.round(pad.y / defaultConfig.gridMm)
        const layerArr = (grid as unknown as { grid: Uint8Array[] }).grid
        if (layerArr) {
          const idx = cy * grid.cols + cx
          if (layerArr[layerIndex]) layerArr[layerIndex][idx] = 0
        }
      }
    }

    const edges = buildMST(netPadList)
    let netRouted = true

    for (const [padA, padB] of edges) {
      const layerA = Math.max(0, grid.layers.indexOf(padA.layer))
      const layerB = Math.max(0, grid.layers.indexOf(padB.layer))
      const startNode: GridNode = {
        layer: layerA,
        col: Math.round(padA.x / defaultConfig.gridMm),
        row: Math.round(padA.y / defaultConfig.gridMm),
      }
      const endNode: GridNode = {
        layer: layerB,
        col: Math.round(padB.x / defaultConfig.gridMm),
        row: Math.round(padB.y / defaultConfig.gridMm),
      }

      const path = astar(grid, startNode, endNode, defaultConfig.viaPenalty)
      if (!path) {
        netRouted = false
        continue
      }

      const { traces, vias } = pathToTracesAndVias(
        path, netId, defaultConfig.gridMm,
        defaultConfig.minTraceWidthMm,
        defaultConfig.viaDrillMm,
        defaultConfig.viaPadMm,
        grid.layers,
      )

      allTraces.push(...traces)
      allVias.push(...vias)

      // Compute trace length
      for (const trace of traces) {
        for (let i = 1; i < trace.points.length; i++) {
          const dx = trace.points[i].x - trace.points[i-1].x
          const dy = trace.points[i].y - trace.points[i-1].y
          totalTraceLength += Math.sqrt(dx*dx + dy*dy)
        }
      }

      // Block routed path for subsequent nets
      for (const node of path) {
        const clearanceCells = Math.ceil(defaultConfig.minSpacingMm / defaultConfig.gridMm)
        grid.blockRect(node.layer, node.col - clearanceCells, node.row - clearanceCells,
          node.col + clearanceCells, node.row + clearanceCells)
      }
    }

    if (!netRouted) unrouted.push(netId)
  }

  const totalNets = netList.length
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
    for (const pin of comp.component.pins) {
      const netId = pinToNet.get(`${comp.id}:${pin.id}`)
      if (!netId) continue

      pads.push({
        netId,
        componentId: comp.id,
        pinId: pin.id,
        // Rotate pin position by component rotation and translate to placement
        x: comp.position.x + pin.x * Math.cos(comp.rotation * Math.PI / 180)
              - pin.y * Math.sin(comp.rotation * Math.PI / 180),
        y: comp.position.y + pin.x * Math.sin(comp.rotation * Math.PI / 180)
              + pin.y * Math.cos(comp.rotation * Math.PI / 180),
        layer: 'F.Cu',  // default to front copper (through-hole goes both sides)
      })
    }
  }

  return pads
}
