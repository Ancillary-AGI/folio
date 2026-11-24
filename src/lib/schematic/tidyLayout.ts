/**
 * One-press tidy arrange.
 *
 * What a drafting tool does when you say "make it look like a schematic": the
 * signal flows left to right, every part sits on the drafting grid at a fixed
 * pitch, columns line up, and each wire is re-routed as a clean orthogonal run
 * between the pins it already names. Nothing electrical is decided here — nets,
 * pin membership, rotations and part values are carried through untouched, so
 * a tidy sheet and a messy one describe exactly the same circuit.
 *
 * Columns come from the net graph, not from where the parts happened to be
 * dropped: each pin's type says which side of a net drives it, the driven side
 * gets the further column, and feedback loops are cut rather than allowed to
 * contradict the layering. Connected groups stack as bands down the sheet, so
 * two unrelated circuits stay two readable blocks.
 */
import type { CanvasComponent, CanvasWire } from '../../stores/useProjectStore'
import { componentBounds, pinWorldCoord, type Point } from './drawingLayout'
import { routePoints } from './wireRouting'

export interface TidyOptions {
  /** Drafting pitch every coordinate is snapped to. */
  gridSize?: number
  /** Column pitch; defaults to the widest part plus a clearance. */
  pitchX?: number
  /** Row pitch; defaults to the tallest part plus a clearance. */
  pitchY?: number
  /** Top-left of the tidied block, in sheet units. */
  origin?: Point
}

export interface TidyResult {
  components: CanvasComponent[]
  wires: CanvasWire[]
  /** Signal stages, so the caller can say what "tidy" actually produced. */
  columns: number
  parts: number
  nets: number
}

const DEFAULT_ORIGIN: Point = { x: 60, y: 60 }
const COLUMN_CLEARANCE = 70
const ROW_CLEARANCE = 50

const snap = (value: number, grid: number): number =>
  grid > 0 ? Math.round(value / grid) * grid : Math.round(value * 1000) / 1000

const ceilTo = (value: number, grid: number): number =>
  grid > 0 ? Math.ceil(value / grid) * grid : value

const byReference = (a: CanvasComponent, b: CanvasComponent): number =>
  a.reference.localeCompare(b.reference, undefined, { numeric: true })

/** Rank a pin as the driver of its net: outputs feed, inputs and ground are fed. */
const driverRank = (type: string | undefined): number => {
  switch (type) {
    case 'output':
      return 0
    case 'power':
      return 1
    case 'io':
      return 2
    case 'passive':
      return 3
    default:
      return 4
  }
}

const cloneWire = (wire: CanvasWire): CanvasWire => ({
  ...wire,
  points: wire.points.map((point) => ({ ...point })),
  connectedPins: wire.connectedPins.map((pin) => ({ ...pin })),
})

interface PinRef {
  componentId: string
  pinId: string
}

const pinRankOf = (byId: Map<string, CanvasComponent>, pin: PinRef): number =>
  driverRank(byId.get(pin.componentId)?.component.pins.find((candidate) => candidate.id === pin.pinId)?.type)

/** Connected components of the part graph, from the wires' pin membership. */
function groupsOf(
  components: readonly CanvasComponent[],
  wires: readonly CanvasWire[],
): CanvasComponent[][] {
  const known = new Set(components.map((component) => component.id))
  const parent = new Map(components.map((component) => [component.id, component.id]))
  const find = (id: string): string => {
    let root = id
    while (parent.get(root) !== root) root = parent.get(root) as string
    let walk = id
    while (parent.get(walk) !== root) {
      const next = parent.get(walk) as string
      parent.set(walk, root)
      walk = next
    }
    return root
  }

  for (const wire of wires) {
    const owned = [...new Set(wire.connectedPins.map((pin) => pin.componentId))].filter((id) => known.has(id))
    for (let i = 1; i < owned.length; i++) {
      const a = find(owned[0])
      const b = find(owned[i])
      if (a !== b) parent.set(b, a)
    }
  }

  const buckets = new Map<string, CanvasComponent[]>()
  for (const component of components) {
    const bucket = buckets.get(find(component.id))
    if (bucket) bucket.push(component)
    else buckets.set(find(component.id), [component])
  }

  // Bands follow the order the designer already worked in: the group with the
  // highest part on the sheet takes the first row.
  const lead = (group: CanvasComponent[]): CanvasComponent =>
    group.slice().sort((a, b) => a.y - b.y || a.x - b.x || byReference(a, b))[0]
  return [...buckets.values()].sort((a, b) => {
    const left = lead(a)
    const right = lead(b)
    return left.y - right.y || left.x - right.x
  })
}

/**
 * Signal stage of every part in one connected group: longest path from a
 * driver, over a graph whose feedback edges have been cut. A part nothing
 * drives stays in the first column of its band.
 */
function stagesOf(
  group: readonly CanvasComponent[],
  wires: readonly CanvasWire[],
  byId: Map<string, CanvasComponent>,
): Map<string, number> {
  const inGroup = new Set(group.map((component) => component.id))
  const feeds = new Map<string, string[]>()
  for (const id of inGroup) feeds.set(id, [])

  for (const wire of wires) {
    const owned = wire.connectedPins.filter((pin) => inGroup.has(pin.componentId))
    if (owned.length < 2) continue
    const source = owned.reduce((best, pin) => (pinRankOf(byId, pin) < pinRankOf(byId, best) ? pin : best))
    for (const sink of owned) {
      if (sink.componentId === source.componentId) continue
      const list = feeds.get(source.componentId) as string[]
      if (!list.includes(sink.componentId)) list.push(sink.componentId)
    }
  }
  for (const list of feeds.values()) {
    list.sort((a, b) => {
      const left = byId.get(a) as CanvasComponent
      const right = byId.get(b) as CanvasComponent
      return left.x - right.x || byReference(left, right)
    })
  }

  // Depth-first pass: an edge back into the live stack is feedback, so it is
  // dropped, and everything else is recorded in finish order.
  const acyclic = new Map<string, string[]>()
  const visited = new Set<string>()
  const live = new Set<string>()
  const finish: string[] = []
  const visit = (id: string): void => {
    visited.add(id)
    live.add(id)
    const kept: string[] = []
    for (const next of feeds.get(id) ?? []) {
      if (live.has(next)) continue
      if (!visited.has(next)) visit(next)
      kept.push(next)
    }
    acyclic.set(id, kept)
    live.delete(id)
    finish.push(id)
  }
  for (const component of group.slice().sort((a, b) => a.x - b.x || byReference(a, b))) {
    if (!visited.has(component.id)) visit(component.id)
  }

  const order = [...finish].reverse()
  const stage = new Map(order.map((id) => [id, 0]))
  for (const id of order) {
    for (const next of acyclic.get(id) ?? []) {
      stage.set(next, Math.max(stage.get(next) ?? 0, (stage.get(id) ?? 0) + 1))
    }
  }
  return stage
}

/** World position of a named pin on a moved part, snapped to the grid. */
function pinAt(component: CanvasComponent, pinId: string, grid: number): Point | null {
  const pin = component.component.pins.find((candidate) => candidate.id === pinId)
  if (!pin) return null
  const at = pinWorldCoord(component, pin)
  return { x: snap(at.x, grid), y: snap(at.y, grid) }
}

/**
 * Re-route one wire between the pins it names. Two pins get the shared
 * collision-aware L-route the wire tool uses; more than two get a staircase
 * that visits every pin as a vertex of the polyline, so no terminal is left
 * sitting off the copper. A lone pin gets a short stub out of the body.
 */
function rerouteWire(
  wire: CanvasWire,
  byId: Map<string, CanvasComponent>,
  terminals: Point[],
  grid: number,
): CanvasWire {
  const owned = wire.connectedPins
    .map((pin) => {
      const component = byId.get(pin.componentId)
      return component ? pinAt(component, pin.pinId, grid) : null
    })
    .filter((point): point is Point => point !== null)
  const unique = new Map(owned.map((point) => [`${point.x}:${point.y}`, point])).values()
  const pins = [...unique]

  const next = cloneWire(wire)
  if (pins.length === 0) {
    next.points = wire.points.map((point) => ({ x: snap(point.x, grid), y: snap(point.y, grid) }))
    return next
  }
  if (pins.length === 1) {
    const at = pins[0]
    next.points = [at, { x: at.x + 2 * (grid || 10), y: at.y }]
    return next
  }

  const sorted = pins.slice().sort((a, b) => a.x - b.x || a.y - b.y)
  const points: Point[] = [sorted[0]]
  for (let i = 1; i < sorted.length; i++) {
    const leg = routePoints(points[points.length - 1], sorted[i], terminals)
    points.push(...leg.slice(1))
  }
  next.points = points
  return next
}

/** Slide a slot down until it clears the parts the designer pinned down. */
function freeOfLocked(
  x: number,
  y: number,
  width: number,
  height: number,
  locked: readonly CanvasComponent[],
  grid: number,
  pitchY: number,
): number {
  let rowY = y
  for (let tries = 0; tries < 64 && locked.length > 0; tries++) {
    const clash = locked.some((part) => {
      const box = componentBounds(part)
      return (
        x < box.x + box.width + grid && box.x < x + width + grid
        && rowY < box.y + box.height + grid && box.y < rowY + height + grid
      )
    })
    if (!clash) break
    rowY += pitchY
  }
  return rowY
}

/**
 * Arrange the sheet: signal stages as columns, grid-pitched rows, orthogonal
 * wires. Pure — it returns a new sheet and never touches the store, so the
 * caller commits the whole arrange as one undo step.
 */
export function tidySchematic(
  components: readonly CanvasComponent[],
  wires: readonly CanvasWire[],
  options: TidyOptions = {},
): TidyResult {
  const grid = options.gridSize && options.gridSize > 0 ? options.gridSize : 10
  if (components.length === 0) {
    // No parts to stage, but a stray wire still gets straightened onto the grid.
    const none = new Map<string, CanvasComponent>()
    return {
      components: [],
      wires: wires.map((wire) => rerouteWire(wire, none, [], grid)),
      columns: 0,
      parts: 0,
      nets: new Set(wires.map((wire) => wire.netName?.trim() || wire.id)).size,
    }
  }

  const widest = Math.max(...components.map((c) => c.component.symbol_data.width ?? 60))
  const tallest = Math.max(...components.map((c) => c.component.symbol_data.height ?? 40))
  const pitchX = ceilTo(options.pitchX ?? widest + COLUMN_CLEARANCE, grid)
  // An even number of grid steps keeps vertical centring on the grid as well.
  const pitchRaw = ceilTo(options.pitchY ?? tallest + ROW_CLEARANCE, grid)
  const pitchY = pitchRaw % (2 * grid) === 0 ? pitchRaw : pitchRaw + grid
  const origin = {
    x: snap(options.origin?.x ?? DEFAULT_ORIGIN.x, grid),
    y: snap(options.origin?.y ?? DEFAULT_ORIGIN.y, grid),
  }
  const locked = components.filter((component) => component.locked)
  const byId = new Map(components.map((component) => [component.id, component]))

  const placed = new Map<string, CanvasComponent>()
  let columns = 0
  let bandTop = origin.y

  for (const group of groupsOf(components, wires)) {
    const stage = stagesOf(group, wires, byId)
    const buckets = new Map<number, CanvasComponent[]>()
    for (const component of group) {
      const key = stage.get(component.id) ?? 0
      const bucket = buckets.get(key)
      if (bucket) bucket.push(component)
      else buckets.set(key, [component])
    }
    const keys = [...buckets.keys()].sort((a, b) => a - b)

    // Barycentre of the column to the left, so a net crosses itself less often
    // than it must. Ties fall back to the reference, never to chance.
    const rowIndex = new Map<string, number>()
    for (const key of keys) {
      const bucket = buckets.get(key) as CanvasComponent[]
      if (key === 0) {
        bucket.sort((a, b) => a.y - b.y || byReference(a, b))
      } else {
        const bary = new Map<string, number>()
        for (const component of bucket) {
          const above: number[] = []
          for (const wire of wires) {
            const ids = wire.connectedPins.map((pin) => pin.componentId)
            if (!ids.includes(component.id)) continue
            for (const other of ids) {
              if (other === component.id) continue
              const neighbour = byId.get(other)
              if (!neighbour) continue
              if ((stage.get(neighbour.id) ?? 0) !== key - 1) continue
              const index = rowIndex.get(neighbour.id)
              if (index !== undefined) above.push(index)
            }
          }
          bary.set(
            component.id,
            above.length > 0 ? above.reduce((sum, value) => sum + value, 0) / above.length : Number.MAX_SAFE_INTEGER,
          )
        }
        bucket.sort((a, b) => {
          const diff = (bary.get(a.id) ?? 0) - (bary.get(b.id) ?? 0)
          return diff !== 0 ? diff : byReference(a, b)
        })
      }
      bucket.forEach((component, index) => rowIndex.set(component.id, index))
    }

    const rows = Math.max(...keys.map((key) => (buckets.get(key) as CanvasComponent[]).length))
    for (const key of keys) {
      const bucket = buckets.get(key) as CanvasComponent[]
      const centring = ceilTo(((rows - bucket.length) * pitchY) / 2, grid)
      for (let index = 0; index < bucket.length; index++) {
        const component = bucket[index]
        if (component.locked) {
          placed.set(component.id, component)
          continue
        }
        const width = component.component.symbol_data.width ?? 60
        const height = component.component.symbol_data.height ?? 40
        const x = snap(origin.x + key * pitchX, grid)
        const y = freeOfLocked(x, bandTop + centring + index * pitchY, width, height, locked, grid, pitchY)
        placed.set(component.id, { ...component, x, y: snap(y, grid) })
      }
    }
    columns = Math.max(columns, keys[keys.length - 1] + 1)
    bandTop += rows * pitchY
  }

  const nextComponents = components.map((component) => placed.get(component.id) ?? component)
  const nextById = new Map(nextComponents.map((component) => [component.id, component]))
  const terminals = nextComponents.flatMap((component) =>
    component.component.pins.map((pin) => pinWorldCoord(component, pin)),
  )

  return {
    components: nextComponents,
    wires: wires.map((wire) => rerouteWire(wire, nextById, terminals, grid)),
    columns,
    parts: nextComponents.length,
    nets: new Set(wires.map((wire) => wire.netName?.trim() || wire.id)).size,
  }
}
