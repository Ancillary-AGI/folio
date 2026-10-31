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
 *  6. Then, for every net the greedy order left without a path, a rip-up pass
 *     lifts the copper of the few nets standing in its way, routes the blocked
 *     net, and re-routes what it lifted.  An attempt that leaves anything worse
 *     off is rolled back exactly, so the pass can only ever add completed nets.
 *
 * Limitations (known):
 *   - Rip-up is bounded: at most two rounds, and each retry lifts at most
 *     RIP_MAX_VICTIMS earlier nets.  A net boxed in by more copper than that
 *     still reports itself unrouted rather than spending the session.
 *   - Manhattan distance heuristic → routes at 45° are approximated.
 *   - Grid cell size: callers pass it, and `routerGridMm` derives a defensible
 *     one from the clearance and width rules. It is still a square grid, so the
 *     lane a trace may use is the rule's gap rounded up to a whole cell.
 *   - One trace width and one spacing rule for every net: no net classes, no
 *     differential pairing, no length matching.
 *
 * Output:
 *   RouterResult contains the routed traces and any unrouted nets, suitable
 *   for feeding into fabExport.ts.
 */

import type { PlacedComponent, Net } from '../../types'
import { edgeDistanceMm, landShapeOf, shapeCircumRadiusMm, type LandShape } from '../geometry/landShape'
import { resolveFootprint, type FootprintPad } from './footprintLibrary'
import { footprintPadForPin } from './padMapping'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RouterConfig {
  boardWidthMm: number
  boardHeightMm: number
  layers: string[]         // e.g. ['F.Cu', 'B.Cu']
  gridMm: number           // grid cell size in mm (typ. 0.2 – 0.5)
  minTraceWidthMm: number  // trace width for routed segments
  minSpacingMm: number     // clearance between adjacent copper
  /**
   * Width of the copper emitted for a net, in millimetres. Defaults to
   * `minTraceWidthMm`. The search grid and its clearance masks are still built
   * from `minTraceWidthMm`, so a caller whose classes ask for wider copper
   * passes the widest class width as `minTraceWidthMm` and returns the exact
   * per-net width here: every route then reserves room for the widest net and
   * prints only the width its own class requires.
   */
  traceWidthForNet?: (netId: string) => number
  viaDrillMm: number       // via drill diameter
  viaPadMm: number         // via pad outer diameter
  viaPenalty: number       // cost units to use a via (default 5)
  /**
   * Rip-up-and-reroute sweeps after the greedy pass (default {@link RIP_MAX_ROUNDS};
   * 0 routes greedy only). Worth paying for when a net is blocked by copper that
   * has somewhere else to go, and worth turning off when it has been measured to
   * buy nothing: on a dense two-layer board the nets that fail are walled in by
   * lands, which no amount of lifting moves.
   */
  ripUpPasses?: number
  /** How much copper one blocked net may lift per attempt (default {@link RIP_MAX_VICTIMS}). */
  ripUpVictims?: number
  /**
   * Reserved regions the router must keep copper out of. Unlike an obstacle
   * land, a keep-out carries no net and is never lifted by a rip-up pass: it is
   * a constraint on the board, not a route that could be moved.
   */
  keepouts?: RouterKeepout[]
}

/**
 * A rectangular region copper may not enter, in board millimetres from the
 * origin. Omitted `layers` reserves every routing layer; an empty list reserves
 * none, which is how a keep-out that only names inner planes still forbids a
 * via barrel while leaving the routed faces free.
 */
export interface RouterKeepout {
  /** Top-left corner, millimetres. */
  xMm: number
  yMm: number
  widthMm: number
  heightMm: number
  /** Routing layers whose traces stay out; omitted means every routing layer. */
  layers?: string[]
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
  /**
   * Land extent and shape in the land's own frame, plus the rotation it was
   * placed with. A 0.8 mm-pitch QFP land is 0.3 x 1.5 mm: reserving a disc
   * around its longest dimension blankets the neighbouring lands and makes the
   * fan-out between them illegal, so a caller that knows the land pattern says
   * what shape it is.
   */
  padWidthMm?: number
  padHeightMm?: number
  padShape?: 'circle' | 'rectangle' | 'oval'
  padRotationDeg?: number
  /**
   * Drill diameter when the land is plated through. A barrel passes the whole
   * stackup, so its clearance applies to every routing layer, not only the one
   * the land is listed on.
   */
  padDrillMm?: number
  /**
   * Annulus diameter of a via the caller has already decided to drill through
   * this land — a plane stitch, or a via-in-pad. The router has to reserve its
   * clearance now, because copper routed later cannot move a via that is
   * already committed to the drill tape.
   */
  viaDiameterMm?: number
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

/**
 * Two expansion grids per layer, each reference-counted: `traceGrid` holds the
 * cells a trace centre line may not enter, `viaGrid` the cells a via landing may
 * not enter. They cannot be one grid. The gap a via annulus needs from a land is
 * `spacing + annulus/2`; the gap a trace needs is `spacing + width/2`, and the
 * two are only equal by accident. Sharing one reservation forces the router to
 * either route over copper it should have cleared or refuse a via-in-pad fan-out
 * that a fab would build all day — which is what happened on 0.5 mm-pitch BGA
 * escapes before this split.
 *
 * Counts matter rather than bits: keepouts of nearby nets overlap, and releasing
 * one land's clearance must not erase the clearance another land still owns.
 * Claims made by routed copper are released only when a rip-up pass lifts that
 * whole net, and then by exactly the count it claimed.
 */
class RoutingGrid {
  readonly cols: number
  readonly rows: number
  readonly layers: string[]
  private traceGrid: Uint16Array[]
  private viaGrid: Uint16Array[]
  /**
   * The net index that claimed a cell last, or {@link CELL_PAD} for a landing
   * area and {@link CELL_FREE} for open copper. Ownership is a *hint*: two
   * overlapping claims leave the later one recorded, which is enough for the
   * rip-up pass to pick candidates. Legality is always the counter, never this.
   */
  private owners: Int32Array[]

  constructor(config: RouterConfig) {
    this.cols = Math.ceil(config.boardWidthMm / config.gridMm) + 1
    this.rows = Math.ceil(config.boardHeightMm / config.gridMm) + 1
    this.layers = config.layers
    this.traceGrid = config.layers.map(() => new Uint16Array(this.cols * this.rows))
    this.viaGrid = config.layers.map(() => new Uint16Array(this.cols * this.rows))
    this.owners = config.layers.map(() => new Int32Array(this.cols * this.rows).fill(CELL_FREE))
  }

  private idx(col: number, row: number): number {
    return row * this.cols + col
  }

  /** May a trace centre line stand here? */
  isBlocked(layer: number, col: number, row: number): boolean {
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return true
    return this.traceGrid[layer][this.idx(col, row)] > 0
  }

  /** May a via annulus land here? */
  isViaBlocked(layer: number, col: number, row: number): boolean {
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return true
    return this.viaGrid[layer][this.idx(col, row)] > 0
  }

  /** The net index whose copper last claimed this cell, or {@link CELL_PAD}. */
  ownerAt(layer: number, col: number, row: number): number {
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return CELL_FREE
    return this.owners[layer][this.idx(col, row)]
  }

  /** Reserve (+1) or release (-1) one cell on the trace grid. */
  addTraceZone(layer: number, col: number, row: number, owner: number, add: boolean): void {
    this.bump(this.traceGrid, layer, col, row, owner, add)
  }

  /** Reserve (+1) or release (-1) one cell on the via grid, for a legal landing. */
  addViaZone(layer: number, col: number, row: number, owner: number, add: boolean): void {
    this.bump(this.viaGrid, layer, col, row, owner, add)
  }

  private bump(grid: Uint16Array[], layer: number, col: number, row: number, owner: number, add: boolean): void {
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return
    const cell = this.idx(col, row)
    const count = grid[layer][cell]
    if (add) {
      if (count < 0xffff) grid[layer][cell] = count + 1
      this.owners[layer][cell] = owner
    } else {
      if (count > 0) grid[layer][cell] = count - 1
      if (grid[layer][cell] === 0) this.owners[layer][cell] = CELL_FREE
    }
  }
}

/** Grid owner codes below zero: nothing a rip-up pass can lift. */
const CELL_FREE = -1
const CELL_PAD = -2

// ─── Clearance bands ─────────────────────────────────────────────────────────

/**
 * Copper that owns clearance around itself, and the layers it owns it on: a
 * land's real outline, or the annulus of a via the caller has already committed
 * to drill through it.
 */
type CopperBand = {
  /** True board position, never the centre of the cell it happens to fall in. */
  xMm: number
  yMm: number
  shape: LandShape
  /** Layers a later trace may not enter. */
  layers: number[]
  /**
   * Layers a later via may not land on. A via is a hole through the whole
   * stackup, so it has to clear a land whichever face that land sits on — a
   * bottom-side keep-out does not stop the drill from breaking out into it. Only
   * a surface land can leave this out, and it cannot.
   */
  viaLayers?: number[]
}

/** The two gaps a fab rule asks for, as centre-line distances from copper's edge. */
interface ClearanceGaps {
  /**
   * How far a trace centre line is barred from a piece of copper's edge.
   *
   * This is the rule's own gap — spacing plus half the trace width — widened by
   * half a grid cell. A trace runs from cell centre to cell centre, and every
   * point of that run lies within half a cell of one of them, so barring only
   * the centres the rule names lets the path itself clip the copper by up to
   * half a cell: the DRC caught that as 0.025 mm and 0.075 mm on the laptop
   * board's J2 escape, where the rule demands 0.15 mm.
   */
  traceMm: number
  /**
   * How far a via centre is barred from a piece of copper's edge. No such margin:
   * a landing sits on exactly the centre it was tested at.
   */
  viaMm: number
}

/**
 * Two numbers, not six. A trace keeps half its width plus the clearance wherever
 * it passes a neighbour, and a via keeps half its annulus plus the same
 * clearance — so the same reservation serves a trace threading between QFP lands
 * and a via-in-pad landing, and nothing pays for a gap twice. Paying for it twice
 * is what a single shared grid did: it cost the laptop board every one of its
 * 0.5 mm-pitch BGA escapes.
 */
function clearanceGaps(config: RouterConfig): ClearanceGaps {
  return {
    traceMm: config.minSpacingMm + config.minTraceWidthMm / 2 + config.gridMm / 2,
    viaMm: config.minSpacingMm + config.viaPadMm / 2,
  }
}

/** The cell sizes a derived grid is allowed to land on, in hundredths of a mm. */
const GRID_STEP_HUNDREDTHS = 5

/**
 * The routing cell the board's own rules ask for.
 *
 * Coarseness is not neutral: a routed cell bars copper out to
 * `spacing + width/2 + cell/2`, so the nearest lane a trace may run in is the
 * rule's gap rounded up to the next whole cell, and every 0.05 mm of cell adds
 * up to 0.05 mm of standing distance the fab rule never asked for. Escape lanes
 * are only a little wider than the rule, so a coarse cell closes them: the
 * schematic→board converter reported one of its two test nets unrouted at a 0.5 mm
 * cell, and routes both at the 0.2 mm this returns for its 0.2 / 0.2 rules — the
 * case `schematicToPcbConverter.test.ts` holds. Snapped down to a 0.05 mm step —
 * rounding up would put the cell back outside the clearance it is meant to
 * resolve — with a 0.05 mm floor for grids the search cannot afford and a 0.5 mm
 * cap for rules already coarser than that.
 */
export function routerGridMm(minSpacingMm: number, minTraceWidthMm: number): number {
  const ruleHundredths = Math.min(minSpacingMm, minTraceWidthMm) * 100
  // Integer hundredths, so a rule like 0.15 mm — 15.000000000000002 in binary —
  // returns the caller's own 0.15 rather than a residue of the division.
  const steps = Math.floor((ruleHundredths + 1e-6) / GRID_STEP_HUNDREDTHS)
  const hundredths = Math.min(50, Math.max(GRID_STEP_HUNDREDTHS, steps * GRID_STEP_HUNDREDTHS))
  return hundredths / 100
}

/**
 * Reserve or release the bands one piece of copper owns. Cells are measured
 * against the copper's real outline, not its bounding square — the square
 * reaches 41 % further at the corners and makes two legally spaced pads block
 * each other's landing cells.
 */
function reserveBand(
  grid: RoutingGrid,
  config: RouterConfig,
  band: CopperBand,
  gaps: ClearanceGaps,
  owner: number,
  add: boolean,
): void {
  const reachMm = shapeCircumRadiusMm(band.shape) + Math.max(gaps.traceMm, gaps.viaMm)
  const viaLayers = band.viaLayers ?? band.layers
  const anchorCol = Math.round(band.xMm / config.gridMm)
  const anchorRow = Math.round(band.yMm / config.gridMm)
  // The +1 keeps the scan honest about copper sitting up to half a cell away
  // from its anchor cell, which the grid points themselves do not know.
  const radiusCells = Math.ceil(reachMm / config.gridMm) + 1
  for (let row = anchorRow - radiusCells; row <= anchorRow + radiusCells; row += 1) {
    for (let col = anchorCol - radiusCells; col <= anchorCol + radiusCells; col += 1) {
      const dx = col * config.gridMm - band.xMm
      const dy = row * config.gridMm - band.yMm
      if (dx * dx + dy * dy > reachMm * reachMm + 1e-12) continue
      const edgeMm = edgeDistanceMm(band.shape, dx, dy)
      if (edgeMm <= gaps.traceMm + 1e-12) {
        for (const layer of band.layers) grid.addTraceZone(layer, col, row, owner, add)
      }
      if (edgeMm <= gaps.viaMm + 1e-12) {
        for (const layer of viaLayers) grid.addViaZone(layer, col, row, owner, add)
      }
    }
  }
}

type CellOffset = [number, number]

/**
 * Reserve a keep-out rectangle on the routing grids.
 *
 * `reserveBand` walks the disc that contains a land, which is right for a pad
 * and wasteful for a region that may span the board: its circle sweep would
 * visit every cell of a square it already covers. A keep-out is axis-aligned by
 * definition, so its bounding box plus the larger clearance is exactly the set
 * of cells that can violate it.
 */
function reserveKeepout(
  grid: RoutingGrid,
  config: RouterConfig,
  keepout: RouterKeepout,
  gaps: ClearanceGaps,
  traceLayers: number[],
  viaLayers: number[],
  shape: LandShape,
): void {
  const reachMm = Math.max(gaps.traceMm, gaps.viaMm)
  const centreX = keepout.xMm + keepout.widthMm / 2
  const centreY = keepout.yMm + keepout.heightMm / 2
  const minCol = Math.floor((keepout.xMm - reachMm) / config.gridMm)
  const maxCol = Math.ceil((keepout.xMm + keepout.widthMm + reachMm) / config.gridMm)
  const minRow = Math.floor((keepout.yMm - reachMm) / config.gridMm)
  const maxRow = Math.ceil((keepout.yMm + keepout.heightMm + reachMm) / config.gridMm)

  for (let row = minRow; row <= maxRow; row += 1) {
    for (let col = minCol; col <= maxCol; col += 1) {
      const edgeMm = edgeDistanceMm(shape, col * config.gridMm - centreX, row * config.gridMm - centreY)
      if (edgeMm <= gaps.traceMm + 1e-12) {
        for (const layer of traceLayers) grid.addTraceZone(layer, col, row, CELL_PAD, true)
      }
      if (edgeMm <= gaps.viaMm + 1e-12) {
        for (const layer of viaLayers) grid.addViaZone(layer, col, row, CELL_PAD, true)
      }
    }
  }
}

/** A grid-point copper's clearance, precomputed as the cells it bars on each grid. */
type BandMask = { trace: CellOffset[], via: CellOffset[] }

function offsetsWithin(config: RouterConfig, reachMm: number): CellOffset[] {
  const cells = Math.ceil(reachMm / config.gridMm)
  const offsets: CellOffset[] = []
  for (let dr = -cells; dr <= cells; dr += 1) {
    for (let dc = -cells; dc <= cells; dc += 1) {
      if (Math.hypot(dc * config.gridMm, dr * config.gridMm) <= reachMm + 1e-12) offsets.push([dc, dr])
    }
  }
  return offsets
}

function maskAround(config: RouterConfig, radiusMm: number, gaps: ClearanceGaps): BandMask {
  return {
    trace: offsetsWithin(config, radiusMm + gaps.traceMm),
    via: offsetsWithin(config, radiusMm + gaps.viaMm),
  }
}

function reserveMask(
  grid: RoutingGrid,
  col: number,
  row: number,
  layers: readonly number[],
  mask: BandMask,
  owner: number,
  add: boolean,
): void {
  for (const layer of layers) {
    for (const [dc, dr] of mask.trace) grid.addTraceZone(layer, col + dc, row + dr, owner, add)
    for (const [dc, dr] of mask.via) grid.addViaZone(layer, col + dc, row + dr, owner, add)
  }
}

/**
 * Everything one routing run needs beside the grid: the rules, the gaps they
 * work out to, the masks routed copper reserves with, and every layer index.
 * Built once, passed down, so no inner loop re-derives a number the config
 * already fixes — a board claims its copper tens of thousands of times.
 */
interface Clearance {
  config: RouterConfig
  gaps: ClearanceGaps
  traceMask: BandMask
  viaMask: BandMask
  allLayers: number[]
  /**
   * The bands a land owns, memoised. A routing run reserves and releases the
   * same lands once per net, and a board of a few thousand lands would otherwise
   * re-cut geometry that the drill tape already fixed.
   */
  bandsOf: (pad: RouterPad) => CopperBand[]
}

function clearanceOf(config: RouterConfig, layers: readonly string[]): Clearance {
  const gaps = clearanceGaps(config)
  const allLayers = layers.map((_, index) => index)
  const cache = new WeakMap<RouterPad, CopperBand[]>()
  return {
    config,
    gaps,
    traceMask: maskAround(config, config.minTraceWidthMm / 2, gaps),
    viaMask: maskAround(config, config.viaPadMm / 2, gaps),
    allLayers,
    bandsOf: (pad) => {
      const cached = cache.get(pad)
      if (cached !== undefined) return cached
      const bands = landBands(pad, config, allLayers, layers.indexOf(pad.layer))
      cache.set(pad, bands)
      return bands
    },
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

/**
 * Open-set ordering: lowest `f`, and among equal `f` the node that has travelled
 * furthest. The second term is not cosmetic. A straight-line Manhattan heuristic
 * gives every cell inside the start-goal diamond the same `f` as the direct route,
 * so a heap that stops comparing at `f` dequeues that diamond breadth-first: a
 * 600-cell span is ~180k expansions and dies on the budget, reporting a net
 * unrouted when the copper was never walled off — only the search ran out. Taking
 * deeper nodes first walks one corridor to the goal instead. Optimality is
 * untouched: nodes are still dequeued in non-decreasing `f`, and with a consistent
 * heuristic the goal is only reached once its `f` equals the true shortest cost.
 */
function precedes(a: AStarNode, b: AStarNode): boolean {
  return a.f < b.f || (a.f === b.f && a.g > b.g)
}

/** Minimal binary heap for the A* open set, ordered by {@link precedes}. */
class MinHeap {
  private data: AStarNode[] = []
  push(item: AStarNode): void {
    this.data.push(item)
    this._bubbleUp(this.data.length - 1)
  }
  pop(): AStarNode | undefined {
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
      if (!precedes(this.data[i], this.data[parent])) break
      ;[this.data[parent], this.data[i]] = [this.data[i], this.data[parent]]
      i = parent
    }
  }
  private _sinkDown(i: number): void {
    const n = this.data.length
    while (true) {
      let min = i
      const l = 2 * i + 1, r = 2 * i + 2
      if (l < n && precedes(this.data[l], this.data[min])) min = l
      if (r < n && precedes(this.data[r], this.data[min])) min = r
      if (min === i) break
      ;[this.data[min], this.data[i]] = [this.data[i], this.data[min]]
      i = min
    }
  }
}

/**
 * What one A* attempt produced: the path, or — when the search ran out of road
 * — every net whose copper owned a cell the frontier tried to step into. Those
 * owners are the candidates a rip-up pass can lift.
 *
 * `exhausted` separates the two ways a search runs out of road. If it is false
 * the frontier closed of its own accord, so every cell it could reach was tried
 * and the walls that stopped it are all land copper — which no lift can move,
 * because a land belongs to a placement, not to a route. If it is true the
 * region may have had more of it beyond the budget.
 */
interface AStarOutcome {
  path: GridNode[] | null
  blockers: Set<number>
  exhausted: boolean
}

/**
 * May the search drop a via here? A landing is copper on *every* routing layer,
 * so both the cell it leaves and the cell it arrives on have to be clear on the
 * via grid, and the arriving layer has to carry a trace too. Each of these is
 * one count lookup — the reservation already did the geometry, at the radius the
 * fab rule asks for, when the copper that owns it went down.
 */
function viaLandingClear(
  grid: RoutingGrid,
  blockers: Set<number>,
  from: number,
  to: number,
  col: number,
  row: number,
): boolean {
  const checks: Array<[number, (layer: number, c: number, r: number) => boolean]> = [
    [from, (layer, c, r) => grid.isViaBlocked(layer, c, r)],
    [to, (layer, c, r) => grid.isViaBlocked(layer, c, r)],
    [to, (layer, c, r) => grid.isBlocked(layer, c, r)],
  ]
  let clear = true
  for (const [layer, test] of checks) {
    if (!test(layer, col, row)) continue
    const owner = grid.ownerAt(layer, col, row)
    if (owner >= 0) blockers.add(owner)
    clear = false
  }
  return clear
}

function astar(
  grid: RoutingGrid,
  clr: Clearance,
  start: GridNode,
  end: GridNode,
  maxExpand = 50_000,
): AStarOutcome {
  const open = new MinHeap()
  const visited = new Map<string, AStarNode>()
  const blockers = new Set<number>()

  const startNode: AStarNode = { g: 0, h: manhattan(start, end), f: manhattan(start, end), parent: null, node: start }
  open.push(startNode)
  visited.set(key(start), startNode)

  let expanded = 0
  while (open.size > 0 && expanded < maxExpand) {
    const current = open.pop()!
    const cn = current.node

    // A cheaper path to this node was already expanded; skip the stale entry.
    // Skipping happens before the budget counts: a stale pop is heap churn, not
    // a look at the board, and charging it bought the same detour search fewer
    // real cells — the long spans then died on a budget that had been spent on
    // bookkeeping.
    if (visited.get(key(cn)) !== current) continue
    expanded++

    if (cn.layer === end.layer && cn.col === end.col && cn.row === end.row) {
      // Reconstruct path
      const path: GridNode[] = []
      let node: AStarNode | null = current
      while (node) { path.push(node.node); node = node.parent }
      return { path: path.reverse(), blockers, exhausted: false }
    }

    // Same-layer moves
    for (const [dc, dr] of DIRS4) {
      const nc = cn.col + dc, nr = cn.row + dr
      if (grid.isBlocked(cn.layer, nc, nr)) {
        const owner = grid.ownerAt(cn.layer, nc, nr)
        if (owner >= 0) blockers.add(owner)
        continue
      }
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
      if (!viaLandingClear(grid, blockers, cn.layer, layer, cn.col, cn.row)) continue
      const neighbor: GridNode = { layer, col: cn.col, row: cn.row }
      const nk = key(neighbor)
      const ng = current.g + clr.config.viaPenalty
      const existing = visited.get(nk)
      if (existing && existing.g <= ng) continue
      const h = manhattan(neighbor, end)
      const nn: AStarNode = { g: ng, h, f: ng + h, parent: current, node: neighbor }
      open.push(nn)
      visited.set(nk, nn)
    }
  }

  // The frontier ran out — either the region is walled off or the expansion
  // budget is spent. `blockers` still names every net whose copper the frontier
  // reached, which is what a rip-up pass needs either way, and `exhausted` says
  // which of the two it was: an open set that emptied itself met every wall
  // there is.
  return { path: null, blockers, exhausted: open.size > 0 }
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

/** True when `point` lies on the closed segment a–b. */
function onSegment(
  point: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
  epsilon = 1e-9,
): boolean {
  const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)
  if (Math.abs(cross) > epsilon) return false
  const dot = (point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)
  const lengthSq = (b.x - a.x) ** 2 + (b.y - a.y) ** 2
  return dot >= -epsilon && dot <= lengthSq + epsilon
}

// ─── Land copper ──────────────────────────────────────────────────────────────

/**
 * The copper a land prints, in its own frame.
 *
 * A caller that knows the footprint states the land's shape, so a 0.3 x 1.5 mm
 * QFP land reserves 0.475 mm sideways instead of the 1.075 mm a disc around its
 * long edge would — the difference between a fine-pitch part fanning out and
 * being permanently unroutable. Without a shape, the conservative 1.6 mm
 * through-hole disc (`max(viaPadMm/2, 0.8 mm)` radius) is assumed.
 */
function landOutline(pad: RouterPad, config: RouterConfig): LandShape {
  const widthMm = pad.padWidthMm
  const heightMm = pad.padHeightMm
  if (widthMm !== undefined && heightMm !== undefined && widthMm > 0 && heightMm > 0) {
    return landShapeOf({
      widthMm,
      depthMm: heightMm,
      shape: pad.padShape ?? 'rectangle',
      rotationDeg: pad.padRotationDeg,
    })
  }
  return {
    kind: 'circle',
    radiusMm: pad.padDiameterMm !== undefined ? pad.padDiameterMm / 2 : Math.max(config.viaPadMm / 2, 0.8),
  }
}

/**
 * The bands a land owns: its outline, on the layers it is copper on, plus the
 * annulus of any via the caller has already committed to drill through it — a
 * plane stitch or a via-in-pad — on *every* routing layer. A barrel reaches the
 * whole stackup, and copper routed later cannot move a via that is already on
 * the drill tape, so both reserve landings across the stackup, not only where
 * the land is listed.
 */
function landBands(
  pad: RouterPad,
  config: RouterConfig,
  allLayers: readonly number[],
  layer: number,
): CopperBand[] {
  if (layer < 0) return []
  const viaDiameterMm = pad.viaDiameterMm ?? 0
  const drilled = (pad.padDrillMm ?? 0) > 0 || viaDiameterMm > 0
  const land: CopperBand = {
    xMm: pad.x,
    yMm: pad.y,
    shape: landOutline(pad, config),
    layers: drilled ? [...allLayers] : [layer],
    // A drill breaks out on every face, so no layer may land a via here.
    viaLayers: [...allLayers],
  }
  if (viaDiameterMm <= 0) return [land]
  return [
    land,
    { xMm: pad.x, yMm: pad.y, shape: { kind: 'circle', radiusMm: viaDiameterMm / 2 }, layers: [...allLayers] },
  ]
}

/**
 * Reserve or release the clearance of every land in `pads`. Cells are measured
 * to the land's true centre, never to the centre of the grid cell it falls in:
 * a 0.25 mm grid puts that shortcut up to 0.125 mm out, which is most of the
 * 0.15 mm clearance a 0.4 mm land is supposed to keep. And they are measured to
 * the copper's *edge* plus the gap: comparing a round land against its bare
 * radius let traces cross the crystal pads on the laptop board at 0.0 mm, which
 * the DRC audit caught.
 */
function reserveLands(grid: RoutingGrid, clr: Clearance, pads: readonly RouterPad[], add: boolean): void {
  for (const pad of pads) {
    for (const band of clr.bandsOf(pad)) {
      reserveBand(grid, clr.config, band, clr.gaps, CELL_PAD, add)
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

// ─── Routing one net, and the rip-up pass that re-routes it ─────────────────

/**
 * Everything one net's route owns: the copper, the grid cells that copper
 * reserves, and whether the spanning tree came out whole. The cells keep the
 * duplicates a multi-edge net produces on purpose — releasing a route has to
 * decrement exactly the counts its claim incremented, or a net that was lifted
 * would leave the grid more blocked than it was found.
 */
interface NetRoute {
  netId: string
  pads: RouterPad[]
  cells: GridNode[]
  viaCells: GridNode[]
  traces: RouterTrace[]
  vias: RouterVia[]
  complete: boolean
  /**
   * Every span that failed was failed because the search reached the end of the
   * region it could walk and found no other net's copper on its way. Lifted
   * routes cannot open a region sealed by lands, so a rip-up pass has nothing to
   * do here — see {@link ripUpBlockedNets}.
   */
  walled: boolean
}

/** Default rip-up budget: sweeps made, and how many nets one attempt may lift. */
const RIP_MAX_ROUNDS = 2
const RIP_MAX_VICTIMS = 4

/**
 * Search this net's spanning tree on the grid as it stands, without claiming
 * anything. Whether the tree came out whole is in `route.complete`; when it did
 * not, `blockers` names the nets whose copper the frontier ran into, which is
 * what the caller can lift to open a way through.
 */
function routeNet(
  grid: RoutingGrid,
  clr: Clearance,
  netId: string,
  netPadList: RouterPad[],
): { route: NetRoute; blockers: Set<number> } {
  const cfg = clr.config
  const traceWidthMm = cfg.traceWidthForNet?.(netId) ?? cfg.minTraceWidthMm
  if (!Number.isFinite(traceWidthMm) || traceWidthMm <= 0) {
    throw new Error(`Router trace width for net "${netId}" must be positive and finite (got ${traceWidthMm}).`)
  }
  const route: NetRoute = {
    netId, pads: netPadList, cells: [], viaCells: [], traces: [], vias: [], complete: true,
    walled: false,
  }
  const blockers = new Set<number>()
  /** Set by the first span that fails with liftable copper, or with a search cut short by budget. */
  let sealedByLands = true

  for (const [padA, padB] of buildMST(netPadList)) {
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

    const outcome = astar(grid, clr, startNode, endNode)
    for (const owner of outcome.blockers) blockers.add(owner)
    if (!outcome.path) {
      route.complete = false
      if (outcome.exhausted || outcome.blockers.size > 0) sealedByLands = false
      continue
    }
    const path = outcome.path
    route.cells.push(...path)

    const { traces, vias } = pathToTracesAndVias(
      path, netId, cfg.gridMm,
      traceWidthMm,
      cfg.viaDrillMm,
      cfg.viaPadMm,
      grid.layers,
    )

    // A* starts and ends on grid nodes; pad centres rarely sit on the grid.
    // Extend the end copper to the actual pad centres so the trace visibly
    // lands on the land pattern instead of stopping up to half a cell short.
    // Skip the extension when the first/last segment already passes over the
    // pad: prepending a point between the segment's ends would draw a
    // zero-area stub, a 0° spike that DRC reports as an acute angle.
    if (traces.length > 0) {
      const first = traces[0]
      const last = traces[traces.length - 1]
      const start = first.points[0]
      const next = first.points[1]
      if (
        (!start || Math.hypot(start.x - padA.x, start.y - padA.y) > 1e-9)
        && !(start && next && onSegment(padA, start, next))
      ) {
        first.points.unshift({ x: padA.x, y: padA.y })
      }
      const end = last.points[last.points.length - 1]
      const previous = last.points[last.points.length - 2]
      if (
        (!end || Math.hypot(end.x - padB.x, end.y - padB.y) > 1e-9)
        && !(previous && end && onSegment(padB, previous, end))
      ) {
        last.points.push({ x: padB.x, y: padB.y })
      }
    }

    route.traces.push(...traces)
    route.vias.push(...vias)
    for (const via of vias) {
      route.viaCells.push({
        layer: 0,
        col: Math.round(via.x / cfg.gridMm),
        row: Math.round(via.y / cfg.gridMm),
      })
    }
  }

  route.walled = !route.complete && sealedByLands
  return { route, blockers }
}

/**
 * Put a route's copper on the grid, or take it back. A trace cell reserves the
 * clearance of a disc half its width across both grids, and a via landing
 * reserves its annulus on every routing layer — the copper this route physically
 * is, at the gap the declared rules ask for. `owner` is this route's index in the
 * caller's list, so a later search can name who is standing in the way.
 */
function claimRoute(
  grid: RoutingGrid,
  clr: Clearance,
  route: NetRoute,
  owner: number,
  claimed: boolean,
): void {
  for (const node of route.cells) {
    reserveMask(grid, node.col, node.row, [node.layer], clr.traceMask, owner, claimed)
  }
  for (const via of route.viaCells) {
    reserveMask(grid, via.col, via.row, clr.allLayers, clr.viaMask, owner, claimed)
  }
}

/**
 * The nets standing in the way of a retry, cheapest to move first: every net in
 * the set has been proved to touch this search, and the one carrying the least
 * copper is the least disturbance to put back somewhere else.
 */
function pickVictims(blockers: Set<number>, routes: NetRoute[], self: number, maxVictims: number): number[] {
  return Array.from(blockers)
    .filter((index) => index !== self && index >= 0 && index < routes.length)
    .sort((a, b) => (routes[a].cells.length - routes[b].cells.length) || a - b)
    .slice(0, maxVictims)
}

/**
 * Give every net the greedy pass could not finish one more chance, by lifting
 * the copper in its way rather than accepting the blockage.
 *
 * An attempt is all or nothing. The blocked net goes down first, then each
 * lifted net is re-routed on the grid that now carries it; if any lifted net
 * cannot come back, the attempt is rolled back cell for cell and the board ends
 * exactly where it started. That is why this pass can only raise the number of
 * completed nets, and why a net that is genuinely walled off — or one that ran
 * out of search budget rather than copper — still reports itself unrouted.
 */
function ripUpBlockedNets(
  grid: RoutingGrid,
  clr: Clearance,
  routes: NetRoute[],
  passes: number,
  maxVictims: number,
): void {
  for (let round = 0; round < passes; round += 1) {
    // Longest first: a long net is what the short-first order starves, and the
    // short nets it displaces are the cheapest to put back. The list holds
    // indexes, not route objects, because a successful attempt swaps the routes
    // it touched — a snapshot taken here would release and reclaim copper that
    // is no longer on the grid.
    const stuck = routes
      .map((route, index) => (route.complete ? -1 : index))
      .filter((index) => index >= 0)
      .sort((a, b) => spanOf(routes[b].pads) - spanOf(routes[a].pads) || a - b)
    if (stuck.length === 0) return

    for (const index of stuck) {
      const route = routes[index]
      // A net finished earlier in this round is no longer stuck; the list holds
      // indexes taken before those swaps happened.
      if (route.complete) continue
      // A region the search walked to its own walls cannot be opened by lifting a
      // route: the walls are lands, and a land belongs to a placement. This holds
      // because a land's reservation and another net's copper never share a cell —
      // the invariant that keeps `ownerAt` honest, and which the router's DRC test
      // re-measures on every finished board.
      if (route.walled) continue
      claimRoute(grid, clr, route, index, false)
      reserveLands(grid, clr, route.pads, false)

      const attempt = routeNet(grid, clr, route.netId, route.pads)
      const victims = attempt.route.complete
        ? []
        : pickVictims(attempt.blockers, routes, index, maxVictims)
      const originals = new Map<number, NetRoute>()
      const replacements = new Map<number, NetRoute>()
      const restoreVictims = (): void => {
        for (const [victim, replacement] of replacements) {
          claimRoute(grid, clr, replacement, victim, false)
        }
        replacements.clear()
        for (const [victim, original] of originals) {
          routes[victim] = original
          claimRoute(grid, clr, original, victim, true)
        }
      }

      let retry: NetRoute | null = null
      if (!attempt.route.complete && victims.length > 0) {
        for (const victim of victims) {
          originals.set(victim, routes[victim])
          claimRoute(grid, clr, routes[victim], victim, false)
        }
        retry = routeNet(grid, clr, route.netId, route.pads).route
      }
      // The blocked net's pads are copper again, before anything else is asked to
      // move. Re-routing a victim inside the window that opened them for this
      // net's own search let the replacement run straight through those pads —
      // copper on copper, which is the one thing a lift is never allowed to make.
      reserveLands(grid, clr, route.pads, true)

      let finished: NetRoute | null = null
      if (attempt.route.complete) {
        claimRoute(grid, clr, attempt.route, index, true)
        finished = attempt.route
      } else if (retry && retry.complete) {
        claimRoute(grid, clr, retry, index, true)
        const restoreOrder = [...victims]
          .sort((a, b) => spanOf(routes[a].pads) - spanOf(routes[b].pads) || a - b)
        let restored = true
        for (const victim of restoreOrder) {
          const original = originals.get(victim)!
          reserveLands(grid, clr, original.pads, false)
          const next = routeNet(grid, clr, original.netId, original.pads)
          reserveLands(grid, clr, original.pads, true)
          if (!next.route.complete) {
            restored = false
            break
          }
          claimRoute(grid, clr, next.route, victim, true)
          replacements.set(victim, next.route)
        }
        if (restored) {
          finished = retry
        } else {
          claimRoute(grid, clr, retry, index, false)
          restoreVictims()
        }
      } else if (victims.length > 0) {
        restoreVictims()
      }

      if (finished) {
        routes[index] = finished
        for (const [victim, replacement] of replacements) routes[victim] = replacement
      } else {
        // Nothing new went down: put back the partial copper this net already
        // owned, so an attempt that failed changes no other net's world. The
        // search's verdict on *why* it failed is worth keeping: a net walled in by
        // lands is not asked again in the rounds that follow.
        route.walled = attempt.route.walled
        claimRoute(grid, clr, route, index, true)
      }
    }
  }
}

// ─── Main router ─────────────────────────────────────────────────────────────

/**
 * Route all nets on the given board.
 *
 * @param pads      All component pads to connect (from schematic-to-PCB conversion)
 * @param config    Board + design rule parameters
 * @param obstacles Copper the board owns but this router must not connect — a
 *                  poured plane's lands, or a neighbour's already-finished
 *                  module. They reserve their land and clearance on the grid
 *                  exactly like a pad, and are never released, because no net of
 *                  this run will ever be allowed to grow through them.
 */
export function autoroute(
  pads: RouterPad[],
  config: RouterConfig,
  obstacles: RouterPad[] = [],
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
    ripUpPasses: config.ripUpPasses ?? RIP_MAX_ROUNDS,
    ripUpVictims: config.ripUpVictims ?? RIP_MAX_VICTIMS,
    keepouts: config.keepouts ?? [],
    traceWidthForNet: config.traceWidthForNet,
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
  const sweeps = (name: keyof RouterConfig, value: number | undefined): void => {
    if (!Number.isInteger(value) || (value as number) < 0) {
      throw new Error(`Router ${name} must be a whole number of sweeps or nets (got ${value}).`)
    }
  }
  sweeps('ripUpPasses', cfg.ripUpPasses)
  sweeps('ripUpVictims', cfg.ripUpVictims)
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

  // Obstacles are validated exactly like the copper being routed: an unlit
  // land outline that quietly blocks nothing is the worse failure.
  for (const pad of [...pads, ...obstacles]) {
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
    const sized = pad.padWidthMm !== undefined || pad.padHeightMm !== undefined
    if (sized) {
      const positiveSize = (name: string, value: number | undefined): void => {
        if (!(Number.isFinite(value) && (value as number) > 0)) {
          throw new Error(
            `Pad ${pad.componentId}:${pad.pinId} declares a land outline but its ${name} is not a positive length (${value} mm).`,
          )
        }
      }
      positiveSize('width', pad.padWidthMm)
      positiveSize('height', pad.padHeightMm)
    }
    if (pad.padDrillMm !== undefined && !(Number.isFinite(pad.padDrillMm) && pad.padDrillMm >= 0)) {
      throw new Error(
        `Pad ${pad.componentId}:${pad.pinId} has an invalid drill diameter (${pad.padDrillMm} mm).`,
      )
    }
    if (pad.padRotationDeg !== undefined && !Number.isFinite(pad.padRotationDeg)) {
      throw new Error(
        `Pad ${pad.componentId}:${pad.pinId} has a non-finite land rotation (${pad.padRotationDeg} deg).`,
      )
    }
  }

  const grid = new RoutingGrid(cfg)
  const clr = clearanceOf(cfg, cfg.layers)
  const allLayers = cfg.layers.map((_, index) => index)

  // A keep-out that names a layer the run does not route is a caller mistake,
  // not a region that quietly blocks nothing.
  for (const keepout of cfg.keepouts ?? []) {
    const where = `Keep-out at (${keepout.xMm}, ${keepout.yMm}) ${keepout.widthMm} x ${keepout.heightMm} mm`
    for (const [name, value] of [
      ['xMm', keepout.xMm],
      ['yMm', keepout.yMm],
      ['widthMm', keepout.widthMm],
      ['heightMm', keepout.heightMm],
    ] as const) {
      if (!Number.isFinite(value)) {
        throw new Error(`${where} has a non-finite ${name} (${value}).`)
      }
    }
    if (keepout.widthMm <= 0 || keepout.heightMm <= 0) {
      throw new Error(`${where} has no area.`)
    }
    for (const layer of keepout.layers ?? []) {
      if (!cfg.layers.includes(layer)) {
        throw new Error(`${where} names "${layer}", which is not a routing layer.`)
      }
    }
  }

  // Group pads by net
  const netPads = new Map<string, RouterPad[]>()
  for (const pad of pads) {
    if (!netPads.has(pad.netId)) netPads.set(pad.netId, [])
    netPads.get(pad.netId)!.push(pad)
  }

  // Every pad is an obstacle until its own net is routed; an obstacle has no
  // net in this run, so it stays put for the whole of it.
  reserveLands(grid, clr, pads, true)
  reserveLands(grid, clr, obstacles, true)

  /*
   * Keep-outs go down last and are never released. Their trace clearance applies
   * on the layers they name; their via clearance applies to every routing layer,
   * because the drill passes through all of them — a keep-out on the top film
   * still forbids a barrel that would break out inside it.
   */
  for (const keepout of cfg.keepouts ?? []) {
    const traceLayers = keepout.layers === undefined
      ? allLayers
      : keepout.layers.map(layer => cfg.layers.indexOf(layer))
    reserveKeepout(
      grid,
      cfg,
      keepout,
      clr.gaps,
      traceLayers,
      allLayers,
      {
        kind: 'rectangle',
        halfWidthMm: keepout.widthMm / 2,
        halfHeightMm: keepout.heightMm / 2,
        rotationRad: 0,
      },
    )
  }

  // Route the shortest nets first — long nets have fewer legal channels once
  // the short ones claim their copper. Reversing this order was tried on the
  // laptop board and lost nets (0.80 to 0.77 completion): a short net can detour
  // locally, a long one cannot, so the long ones lose the corridors they need.
  const routeableNets = Array.from(netPads.entries())
    .filter(([, netPadList]) => netPadList.length >= 2)
    .sort((a, b) => spanOf(a[1]) - spanOf(b[1]))

  /** One entry per routeable net, in the order the greedy pass visited them. */
  const routes: NetRoute[] = []

  for (const [netId, netPadList] of routeableNets) {
    // Own lands, and the landings their committed vias will need, open up.
    reserveLands(grid, clr, netPadList, false)
    const { route } = routeNet(grid, clr, netId, netPadList)
    claimRoute(grid, clr, route, routes.length, true)
    // Close them again: no other net may route through this one's copper.
    reserveLands(grid, clr, netPadList, true)
    routes.push(route)
  }

  ripUpBlockedNets(grid, clr, routes, cfg.ripUpPasses ?? RIP_MAX_ROUNDS, cfg.ripUpVictims ?? RIP_MAX_VICTIMS)

  const unrouted = routes.filter((route) => !route.complete).map((route) => route.netId)

  const allTraces = routes.flatMap((route) => route.traces)
  const allVias = routes.flatMap((route) => route.vias)
  let totalTraceLength = 0
  for (const trace of allTraces) {
    for (let i = 1; i < trace.points.length; i += 1) {
      totalTraceLength += Math.hypot(
        trace.points[i].x - trace.points[i - 1].x,
        trace.points[i].y - trace.points[i - 1].y,
      )
    }
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
function routingLayer(pad: FootprintPad): string {
  if (pad.layers.includes('top_copper')) return 'F.Cu'
  if (pad.layers.includes('bottom_copper')) return 'B.Cu'
  return 'F.Cu'
}

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
    const footprint = resolveFootprint(
      String(comp.properties.footprint ?? comp.component.name),
      typeof comp.component.category === 'string' ? comp.component.category : undefined,
    )
    const radians = (comp.rotation * Math.PI) / 180
    const cos = Math.cos(radians)
    const sin = Math.sin(radians)
    const scale = Number.isFinite(comp.scale) ? comp.scale : 1
    comp.component.pins.forEach((pin, pinIndex) => {
      const netId = pinToNet.get(`${comp.id}:${pin.id}`)
      if (!netId) return

      // Route to the land pattern, not the symbol: a resistor symbol is 8 mm
      // between pins while its 0805 pads are 1.8 mm apart, so traces aimed at
      // symbol geometry would miss the copper the fab actually prints.
      const packagePad = footprintPadForPin(footprint, pin.id, pinIndex, comp.component.pins.length)
      const localX = packagePad ? packagePad.position.x : pin.x * scale
      const localY = packagePad ? packagePad.position.y : pin.y * scale

      pads.push({
        netId,
        componentId: comp.id,
        pinId: pin.id,
        // Rotate the pad offset by component rotation and translate to placement
        x: comp.position.x + localX * cos - localY * sin,
        y: comp.position.y + localX * sin + localY * cos,
        layer: packagePad ? routingLayer(packagePad) : 'F.Cu',
        padDiameterMm: packagePad
          ? Math.max(packagePad.size.width, packagePad.size.height)
          : undefined,
        padWidthMm: packagePad?.size.width,
        padHeightMm: packagePad?.size.height,
        padShape: packagePad?.shape,
        padRotationDeg: comp.rotation,
        padDrillMm: packagePad?.drillDiameter,
      })
    })
  }

  return pads
}
