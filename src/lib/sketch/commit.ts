/**
 * Turn recognised ink into real schematic objects.
 *
 * The commit step is intentionally conservative: parts are placed at library
 * size (never scaled), pinned wires snap to the nearest real pin, coincident
 * endpoints become one net, and anything the recogniser could not name is
 * reported instead of guessed. Nothing here fakes connectivity.
 */
import type { Component } from '../supabase'
import type { CanvasComponent, CanvasWire } from '../../stores/useProjectStore'
import { generateId } from '../utils'
import { rotatePinCoord } from '../schematic/drawingLayout'
import { distance, snap, type Point } from './geometry'
import type { RecognizedSymbol, SketchRecognition } from './recognize'

export interface CommitOptions {
  library: readonly Component[]
  existingComponents?: readonly CanvasComponent[]
  existingWires?: readonly CanvasWire[]
  gridSize?: number
}

export interface CommitResult {
  components: CanvasComponent[]
  wires: CanvasWire[]
  junctions: Point[]
  warnings: string[]
  /** Symbols whose library part was missing from the catalogue. */
  unmatched: string[]
}

interface PlacedPin {
  component: CanvasComponent
  componentId: string
  pinId: string
  point: Point
  type: string
  partName: string
}

const REFERENCE_LETTER: Record<string, string> = {
  Resistor: 'R',
  Capacitor: 'C',
  Inductor: 'L',
  Diode: 'D',
  Ground: 'G',
  'DC Voltage Source': 'V',
}

const nextReference = (name: string, used: Set<string>): string => {
  const prefix = REFERENCE_LETTER[name] ?? name.charAt(0).toUpperCase()
  let index = 1
  while (used.has(`${prefix}${index}`)) index += 1
  const reference = `${prefix}${index}`
  used.add(reference)
  return reference
}

const rotatedCenter = (symbol: RecognizedSymbol, width: number, height: number): Point =>
  rotatePinCoord({ x: width / 2, y: height / 2 }, symbol.rotation)

const dedupePoints = (points: readonly Point[]): Point[] => {
  const output: Point[] = []
  for (const point of points) {
    const last = output[output.length - 1]
    if (!last || distance(last, point) > 1e-6) output.push({ ...point })
  }
  return output
}

const polylineLength = (points: readonly Point[]): number => {
  let total = 0
  for (let i = 1; i < points.length; i += 1) total += distance(points[i - 1], points[i])
  return total
}

const projectOntoSegment = (point: Point, a: Point, b: Point): Point => {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return { ...a }
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared))
  return { x: a.x + dx * t, y: a.y + dy * t }
}

const median = (values: number[]): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

class Connectivity {
  private parent: number[]
  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i)
  }
  find(a: number): number {
    while (this.parent[a] !== a) {
      this.parent[a] = this.parent[this.parent[a]]
      a = this.parent[a]
    }
    return a
  }
  union(a: number, b: number) {
    const rootA = this.find(a)
    const rootB = this.find(b)
    if (rootA !== rootB) this.parent[rootB] = rootA
  }
  groups(): number[][] {
    const buckets = new Map<number, number[]>()
    for (let i = 0; i < this.parent.length; i += 1) {
      const root = this.find(i)
      const bucket = buckets.get(root)
      if (bucket) bucket.push(i)
      else buckets.set(root, [i])
    }
    return [...buckets.values()]
  }
}

/**
 * Commit a recognition result. Placement uses `symbol.center`, so an ink
 * cluster drawn at 10 mm lands at 10 mm — the recogniser never rescales the
 * resulting part, it only names it.
 */
export function commitSketch(recognition: SketchRecognition, options: CommitOptions): CommitResult {
  const grid = options.gridSize && options.gridSize > 0 ? options.gridSize : 10
  const existingComponents = options.existingComponents ?? []
  const existingWires = options.existingWires ?? []
  const libraryByName = new Map(options.library.map((part) => [part.name, part]))
  const usedReferences = new Set(existingComponents.map((component) => component.reference))
  const warnings: string[] = []
  const unmatched: string[] = []
  const components: CanvasComponent[] = []
  const pins: PlacedPin[] = []
  const symbolSizes: number[] = []

  for (const symbol of recognition.symbols) {
    const part = libraryByName.get(symbol.libraryName)
    if (!part) {
      unmatched.push(symbol.label)
      warnings.push(`No “${symbol.libraryName}” part in the library; the ${symbol.label.toLowerCase()} was left as ink.`)
      continue
    }
    const width = part.symbol_data.width
    const height = part.symbol_data.height
    const centerOffset = rotatedCenter(symbol, width, height)
    const x = snap(symbol.center.x - centerOffset.x, grid)
    const y = snap(symbol.center.y - centerOffset.y, grid)
    const component: CanvasComponent = {
      id: generateId('comp'),
      componentId: part.id ?? part.name,
      component: part,
      x,
      y,
      rotation: symbol.rotation,
      reference: nextReference(part.name, usedReferences),
      properties: { ...part.default_properties },
    }
    components.push(component)
    symbolSizes.push(Math.hypot(width, height))
    for (const pin of part.pins) {
      const rotated = rotatePinCoord({ x: pin.x, y: pin.y }, symbol.rotation)
      pins.push({
        component,
        componentId: component.id,
        pinId: pin.id,
        point: { x: x + rotated.x, y: y + rotated.y },
        type: pin.type,
        partName: part.name,
      })
    }
  }

  const symbolScale = median(symbolSizes)
  const pinSnapRadius = Math.max(grid * 1.5, symbolScale * (recognition.symbols.length > 0 ? 0.32 : 0))
  const connectTolerance = Math.max(grid * 0.55, 2)

  // Wires: snap to the grid, then to real pins when an end was drawn near one.
  const wireDrafts = recognition.wires
    .map((wire) => {
      let points = dedupePoints(wire.points.map((point) => ({ x: snap(point.x, grid), y: snap(point.y, grid) })))
      if (points.length < 2) return null
      const connectedPins: CanvasWire['connectedPins'] = []
      const attach = (endpoint: Point) => {
        let best: PlacedPin | null = null
        let bestDistance = pinSnapRadius
        for (const pin of pins) {
          const candidate = distance(pin.point, endpoint)
          if (candidate <= bestDistance) {
            bestDistance = candidate
            best = pin
          }
        }
        if (best) connectedPins.push({ componentId: best.componentId, pinId: best.pinId })
        return best ? { ...best.point } : endpoint
      }
      points[0] = attach(points[0])
      points[points.length - 1] = attach(points[points.length - 1])
      points = dedupePoints(points)
      if (polylineLength(points) < grid * 0.5) return null
      return { points, connectedPins }
    })
    .filter((wire): wire is { points: Point[]; connectedPins: CanvasWire['connectedPins'] } => wire !== null)

  // A junction dot joins wires that pass through it: insert the dot as a
  // vertex so connectivity, not proximity alone, decides the net.
  const junctions = recognition.junctions.map((junction) => ({
    x: snap(junction.center.x, grid),
    y: snap(junction.center.y, grid),
  }))
  for (const draft of wireDrafts) {
    for (const junction of junctions) {
      let closest = { index: -1, distance: Infinity, point: junction }
      for (let i = 1; i < draft.points.length; i += 1) {
        const projected = projectOntoSegment(junction, draft.points[i - 1], draft.points[i])
        const d = distance(projected, junction)
        if (d < closest.distance) closest = { index: i, distance: d, point: projected }
      }
      if (closest.index === -1 || closest.distance > connectTolerance) continue
      const atStart = distance(draft.points[0], junction) <= connectTolerance
      const atEnd = distance(draft.points[draft.points.length - 1], junction) <= connectTolerance
      if (atStart) draft.points[0] = { ...junction }
      else if (atEnd) draft.points[draft.points.length - 1] = { ...junction }
      else draft.points.splice(closest.index, 0, { ...junction })
    }
    draft.points = dedupePoints(draft.points)
  }

  // Connectivity: coincident endpoints share a net, and so do pins.
  const connectivity = new Connectivity(wireDrafts.length)
  for (let i = 0; i < wireDrafts.length; i += 1) {
    for (let j = i + 1; j < wireDrafts.length; j += 1) {
      const a = wireDrafts[i]
      const b = wireDrafts[j]
      const touches =
        distance(a.points[0], b.points[0]) <= connectTolerance ||
        distance(a.points[0], b.points[b.points.length - 1]) <= connectTolerance ||
        distance(a.points[a.points.length - 1], b.points[0]) <= connectTolerance ||
        distance(a.points[a.points.length - 1], b.points[b.points.length - 1]) <= connectTolerance ||
        // A wire that ends on another wire's interior is a T junction.
        a.points.some((point) =>
          b.points.some((other, index) =>
            index > 0 &&
            distance(point, projectOntoSegment(point, b.points[index - 1], other)) <= connectTolerance,
          ),
        ) ||
        b.points.some((point) =>
          a.points.some((other, index) =>
            index > 0 &&
            distance(point, projectOntoSegment(point, a.points[index - 1], other)) <= connectTolerance,
          ),
        )
      if (touches) connectivity.union(i, j)
    }
  }
  for (let i = 0; i < wireDrafts.length; i += 1) {
    for (let j = i + 1; j < wireDrafts.length; j += 1) {
      const sharedPin = wireDrafts[i].connectedPins.some((pin) =>
        wireDrafts[j].connectedPins.some(
          (other) => other.componentId === pin.componentId && other.pinId === pin.pinId,
        ),
      )
      if (sharedPin) connectivity.union(i, j)
    }
  }

  const usedNetNames = new Set(existingWires.map((wire) => wire.netName).filter(Boolean) as string[])
  let netIndex = 1
  const nextNetName = (): string => {
    while (usedNetNames.has(`NET${netIndex}`)) netIndex += 1
    const name = `NET${netIndex}`
    usedNetNames.add(name)
    netIndex += 1
    return name
  }

  const netNames = new Map<number, string>()
  for (const group of connectivity.groups()) {
    const ground = group.some((wireIndex) =>
      wireDrafts[wireIndex].connectedPins.some((connected) => {
        const pin = pins.find(
          (candidate) =>
            candidate.componentId === connected.componentId && candidate.pinId === connected.pinId,
        )
        return pin ? pin.type === 'ground' || pin.partName === 'Ground' : false
      }),
    )
    const name = ground ? 'GND' : nextNetName()
    for (const wireIndex of group) netNames.set(wireIndex, name)
  }

  const wires: CanvasWire[] = wireDrafts.map((draft, index) => ({
    id: generateId('wire'),
    points: draft.points,
    netName: netNames.get(index),
    connectedPins: draft.connectedPins,
  }))

  if (recognition.symbols.length > 0 && components.length === 0) {
    warnings.push('None of the recognised symbols exist in the library, so no parts were placed.')
  }
  if (recognition.wires.length > 0 && wires.length === 0) {
    warnings.push('The drawn wires were too short to keep after snapping to the grid.')
  }

  return { components, wires, junctions, warnings, unmatched }
}
