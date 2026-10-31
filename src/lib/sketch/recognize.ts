/**
 * Freehand schematic recognition.
 *
 * The ink is grouped into nearby strokes, scored against generated symbol
 * templates at the four axis-aligned rotations, and anything left over is
 * joined into wire polylines. There is no model download and no hidden
 * classifier: every decision below can be traced to a distance, a coverage
 * number or a template comparison, and ambiguous ink is reported as rejected
 * rather than silently turned into the wrong part.
 */
import {
  boundsCenter,
  boundsDiagonal,
  closedness,
  pointsBounds,
  resampleStroke,
  simplifyStroke,
  straightness,
  strokesDistance,
  strokeLength,
  distance,
  type Bounds,
  type Point,
  type Stroke,
} from './geometry'
import {
  DEFAULT_RASTER_SIZE,
  coverage,
  dilate,
  maskIoU,
  rasterizeStrokes,
} from './raster'
import {
  SKETCH_TEMPLATES,
  TEMPLATE_ROTATIONS,
  templateMask,
  type SketchTemplate,
  type SketchTemplateId,
  type TemplateRotation,
} from './templates'

export interface SketchMatch {
  template: SketchTemplate
  rotation: TemplateRotation
  /** Dilated intersection over union of the drawn ink and the template. */
  score: number
  /** Both directions of ink containment; a lopsided score means a partial fit. */
  drawCoverage: number
  templateCoverage: number
}

export interface RecognizedSymbol {
  kind: 'symbol'
  templateId: SketchTemplateId
  libraryName: string
  label: string
  rotation: TemplateRotation
  confidence: number
  bounds: Bounds
  center: Point
  strokeIndexes: number[]
  alternatives: Array<{ templateId: SketchTemplateId; label: string; rotation: TemplateRotation; confidence: number }>
}

export interface RecognizedWire {
  kind: 'wire'
  points: Point[]
  strokeIndexes: number[]
}

export interface RecognizedJunction {
  kind: 'junction'
  center: Point
  strokeIndexes: number[]
}

export interface RejectedInk {
  strokeIndexes: number[]
  reason: 'too-small' | 'closed-loop' | 'too-complex' | 'no-match'
  bounds: Bounds
}

export interface SketchRecognition {
  symbols: RecognizedSymbol[]
  wires: RecognizedWire[]
  junctions: RecognizedJunction[]
  rejected: RejectedInk[]
  /** Drawing scale in world units, for UI copy such as "ink spans 412 units". */
  inkBounds: Bounds
  /** True when no stroke produced a symbol or wire. */
  empty: boolean
}

export interface RecognizeOptions {
  rasterSize?: number
  /** Minimum dilated IoU for a symbol. */
  minSymbolScore?: number
  /** World-units distance at which two strokes are considered joined. */
  clusterTolerance?: number
  /** Larger tolerance used when chaining pen-lift wire segments. */
  chainTolerance?: number
  minWireLength?: number
  maxWireCorners?: number
  resampleSpacing?: number
}

const MIN_STROKE_POINTS = 2

const rdpPoints = (points: readonly Point[], epsilon: number): Point[] => simplifyStroke(points, epsilon)

class UnionFind {
  private parent: number[]
  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i)
  }
  find(a: number): number {
    let root = a
    while (this.parent[root] !== root) root = this.parent[root]
    while (this.parent[a] !== root) {
      const next = this.parent[a]
      this.parent[a] = root
      a = next
    }
    return root
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

interface PreparedStroke {
  index: number
  points: Point[]
  bounds: Bounds
}

const prepareStrokes = (strokes: readonly Stroke[], spacing: number): PreparedStroke[] => {
  const prepared: PreparedStroke[] = []
  strokes.forEach((stroke, index) => {
    if (!stroke || stroke.points.length < MIN_STROKE_POINTS) return
    const points = resampleStroke(stroke.points, spacing)
    if (points.length < MIN_STROKE_POINTS) return
    prepared.push({ index, points, bounds: pointsBounds(points) })
  })
  return prepared
}

const scoreMask = (drawMask: Uint8Array, template: SketchTemplate, rotation: TemplateRotation, size: number) => {
  const tplMask = templateMask(template, rotation, size)
  return {
    iou: maskIoU(drawMask, tplMask),
    drawCoverage: coverage(drawMask, tplMask),
    templateCoverage: coverage(tplMask, drawMask),
  }
}

/**
 * Rank every non-junction template against a group of strokes. Junction blobs
 * are deliberately excluded: they are tiny, and scoring them here would let a
 * dot claim a symbol cluster.
 */
export function matchStrokes(
  strokes: ReadonlyArray<readonly Point[]>,
  options: { rasterSize?: number; rotations?: readonly TemplateRotation[] } = {},
): SketchMatch[] {
  const size = options.rasterSize ?? DEFAULT_RASTER_SIZE
  const rotations = options.rotations ?? TEMPLATE_ROTATIONS
  const raster = rasterizeStrokes(strokes, { size })
  const drawMask = dilate(raster.mask, size, 2)
  const matches: SketchMatch[] = []
  for (const template of SKETCH_TEMPLATES) {
    if (template.filled) continue
    for (const rotation of rotations) {
      const { iou, drawCoverage, templateCoverage } = scoreMask(drawMask, template, rotation, size)
      matches.push({
        template,
        rotation,
        score: iou,
        drawCoverage,
        templateCoverage,
      })
    }
  }
  matches.sort((a, b) => b.score - a.score || a.template.id.localeCompare(b.template.id))
  return matches
}

const boundsGap = (a: Bounds, b: Bounds): number => {
  const dx = Math.max(0, Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width)))
  const dy = Math.max(0, Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height)))
  return Math.hypot(dx, dy)
}

const groupBounds = (strokes: readonly PreparedStroke[]): Bounds =>
  pointsBounds(strokes.flatMap((stroke) => stroke.points))

/**
 * A capacitor is two separate ink islands (each lead touches one plate), and a
 * hand-drawn symbol may be lifted mid-way. Merge clusters whose bounding boxes
 * nearly touch, with a span guard so a merge cannot stretch across the page.
 */
const mergeNearbyGroups = (
  groups: PreparedStroke[][],
  gapScale: number,
): PreparedStroke[][] => {
  let list = groups.map((group) => group.slice())
  for (let guard = 0; guard < 24; guard += 1) {
    let best: { a: number; b: number; gap: number } | null = null
    for (let a = 0; a < list.length; a += 1) {
      for (let b = a + 1; b < list.length; b += 1) {
        const gap = boundsGap(groupBounds(list[a]), groupBounds(list[b]))
        if (gap > gapScale) continue
        const combined = [...list[a], ...list[b]]
        const largest = Math.max(boundsDiagonal(groupBounds(list[a])), boundsDiagonal(groupBounds(list[b])))
        if (boundsDiagonal(groupBounds(combined)) > largest * 2.2) continue
        if (!best || gap < best.gap) best = { a, b, gap }
      }
    }
    if (!best) break
    const merged = [...list[best.a], ...list[best.b]]
    list = list.filter((_, index) => index !== best!.a && index !== best!.b)
    list.push(merged)
  }
  return list
}

/** Cluster strokes that physically touch. */
const clusterByTouch = (strokes: PreparedStroke[], tolerance: number): PreparedStroke[][] => {
  const union = new UnionFind(strokes.length)
  for (let i = 0; i < strokes.length; i += 1) {
    for (let j = i + 1; j < strokes.length; j += 1) {
      if (strokesDistance(strokes[i].points, strokes[j].points) <= tolerance) union.union(i, j)
    }
  }
  return union.groups().map((indexes) => indexes.map((index) => strokes[index]))
}

const symbolFromMatch = (
  match: SketchMatch,
  members: PreparedStroke[],
  ranked: SketchMatch[],
): RecognizedSymbol => {
  const points = members.flatMap((member) => member.points)
  const bounds = pointsBounds(points)
  return {
    kind: 'symbol',
    templateId: match.template.id,
    libraryName: match.template.libraryName ?? match.template.label,
    label: match.template.label,
    rotation: match.rotation,
    confidence: match.score,
    bounds,
    center: boundsCenter(bounds),
    strokeIndexes: members.map((member) => member.index).sort((a, b) => a - b),
    alternatives: ranked
      .filter(
        (candidate) =>
          candidate.template.id !== match.template.id && candidate.score >= match.score - 0.12,
      )
      .slice(0, 2)
      .map((candidate) => ({
        templateId: candidate.template.id,
        label: candidate.template.label,
        rotation: candidate.rotation,
        confidence: candidate.score,
      })),
  }
}

interface SubsetMatch {
  match: SketchMatch
  members: PreparedStroke[]
  ranked: SketchMatch[]
}

/**
 * Search sub-groups for the best symbol. A wire that touches a part joins
 * their cluster, and a capacitor's plates do not touch each other, so
 * connectivity is not a reliable filter: every subset of a small cluster is
 * scored and the best-scoring group wins. The cap keeps the cost bounded.
 */
const bestSubset = (
  members: PreparedStroke[],
  minScore: number,
  size: number,
): SubsetMatch | null => {
  const count = members.length
  if (count > 9) return null
  const limit = 1 << count
  let best: SubsetMatch | null = null
  for (let mask = 1; mask < limit; mask += 1) {
    const subset = members.filter((_, index) => (mask & (1 << index)) !== 0)
    if (subset.length === 1 && isStraightWireStroke(subset[0].points)) continue
    const ranked = matchStrokes(subset.map((member) => member.points), { rasterSize: size })
    const top = ranked[0]
    if (top.score < minScore) continue
    if (
      !best ||
      top.score > best.match.score + 1e-6 ||
      (Math.abs(top.score - best.match.score) <= 1e-6 && subset.length > best.members.length)
    ) {
      best = { match: top, members: subset, ranked }
    }
  }
  return best
}

/**
 * Try to read a group of strokes as one symbol. A small group is searched
 * exhaustively over its connected subsets; a large group falls back to
 * single/double stroke removal, which keeps the cost bounded.
 */
const extractSymbol = (
  members: PreparedStroke[],
  minScore: number,
  size: number,
): { symbol: RecognizedSymbol; remainder: PreparedStroke[] } | null => {
  if (members.length === 0) return null
  const full = matchStrokes(members.map((member) => member.points), { rasterSize: size })
  const fullBest = full[0]
  if (fullBest.score >= minScore) {
    return { symbol: symbolFromMatch(fullBest, members, full), remainder: [] }
  }

  let winner = bestSubset(members, minScore, size)
  if (!winner && members.length > 9) {
    const candidates: SubsetMatch[] = []
    members.forEach((_, removeIndex) => {
      const keep = members.filter((__, index) => index !== removeIndex)
      const ranked = matchStrokes(keep.map((member) => member.points), { rasterSize: size })
      candidates.push({ match: ranked[0], members: keep, ranked })
    })
    candidates.sort((a, b) => b.match.score - a.match.score)
    winner = candidates[0] ?? null
  }
  if (!winner || winner.match.score < minScore) return null
  const used = new Set(winner.members.map((member) => member.index))
  const remainder = members.filter((member) => !used.has(member.index))
  return { symbol: symbolFromMatch(winner.match, winner.members, winner.ranked), remainder }
}

interface Chain {
  points: Point[]
  strokeIndexes: number[]
}

/** Join pen-lift segments whose endpoints meet into one polyline. */
const chainStrokes = (members: PreparedStroke[], tolerance: number): Chain[] => {
  const remaining = members.slice()
  const chains: Chain[] = []
  while (remaining.length > 0) {
    const seed = remaining.shift()!
    const points = seed.points.map((point) => ({ ...point }))
    const strokeIndexes = [seed.index]
    let extended = true
    while (extended) {
      extended = false
      for (const end of ['tail', 'head'] as const) {
        const anchor = end === 'tail' ? points[points.length - 1] : points[0]
        let bestIndex = -1
        let bestDistance = tolerance
        let reverse = false
        remaining.forEach((candidate, index) => {
          const headDistance = distance(anchor, candidate.points[0])
          const tailDistance = distance(anchor, candidate.points[candidate.points.length - 1])
          const useReverse = tailDistance < headDistance
          const candidateDistance = Math.min(headDistance, tailDistance)
          if (candidateDistance <= bestDistance) {
            bestDistance = candidateDistance
            bestIndex = index
            reverse = useReverse
          }
        })
        if (bestIndex === -1) continue
        const [candidate] = remaining.splice(bestIndex, 1)
        const ordered = reverse ? [...candidate.points].reverse() : candidate.points
        if (end === 'tail') points.push(...ordered.slice(1).map((point) => ({ ...point })))
        else points.unshift(...ordered.slice(0, -1).map((point) => ({ ...point })))
        strokeIndexes.push(candidate.index)
        extended = true
      }
    }
    chains.push({ points, strokeIndexes })
  }
  return chains
}

const isClosedLoop = (points: readonly Point[]): boolean => {
  const length = strokeLength(points)
  if (length === 0) return false
  const bounds = pointsBounds(points)
  const loopClosed = closedness(points) < 0.12
  return loopClosed && length > boundsDiagonal(bounds) * 2.2
}

const isStraightWireStroke = (points: readonly Point[]): boolean => {
  if (straightness(points) < 0.94) return false
  const epsilon = Math.max(1, strokeLength(points) * 0.015)
  return rdpPoints(points, epsilon).length <= 2
}

/** Sharp direction changes: a wire has a few corners, a scribble has many. */
const sharpTurnCount = (points: readonly Point[], thresholdDegrees = 45): number => {
  let turns = 0
  for (let i = 1; i < points.length - 1; i += 1) {
    const ax = points[i].x - points[i - 1].x
    const ay = points[i].y - points[i - 1].y
    const bx = points[i + 1].x - points[i].x
    const by = points[i + 1].y - points[i].y
    const lengthA = Math.hypot(ax, ay)
    const lengthB = Math.hypot(bx, by)
    if (lengthA === 0 || lengthB === 0) continue
    const cosine = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (lengthA * lengthB)))
    const angle = (Math.acos(cosine) * 180) / Math.PI
    if (angle > thresholdDegrees) turns += 1
  }
  return turns
}

const isJunction = (
  points: readonly Point[],
  drawingDiagonal: number,
  soleStroke: boolean,
): boolean => {
  const bounds = pointsBounds(points)
  const diagonal = boundsDiagonal(bounds)
  const length = strokeLength(points)
  // A lone dot is the only ink on the sheet: bound it in absolute drawing
  // units, because "small relative to the drawing" says nothing when the dot
  // is the whole drawing. Symbols are tens of units wide by library design.
  if (soleStroke) {
    return diagonal <= 18 && length >= diagonal * 1.6
  }
  if (diagonal > drawingDiagonal * 0.08) return false
  if (diagonal < drawingDiagonal * 0.035 && points.length >= 2) return true
  return closedness(points) < 0.42 || (diagonal > 0 && length >= diagonal * 2)
}

export function recognizeSketch(
  strokes: readonly Stroke[],
  options: RecognizeOptions = {},
): SketchRecognition {
  const rasterSize = options.rasterSize ?? DEFAULT_RASTER_SIZE
  const minScore = options.minSymbolScore ?? 0.68
  const prepared = prepareStrokes(strokes, options.resampleSpacing ?? 1.5)
  const allPoints = prepared.flatMap((stroke) => stroke.points)
  const inkBounds = pointsBounds(allPoints)
  const drawingDiagonal = Math.max(boundsDiagonal(inkBounds), 1)
  const clusterTolerance = options.clusterTolerance ?? Math.max(3, drawingDiagonal * 0.006)
  const chainTolerance = options.chainTolerance ?? Math.max(6, drawingDiagonal * 0.018)
  const simplifyEpsilon = Math.max(1.2, drawingDiagonal * 0.0035)
  const minWireLength = options.minWireLength ?? Math.max(10, drawingDiagonal * 0.025)
  const maxWireCorners = options.maxWireCorners ?? 8

  const symbols: RecognizedSymbol[] = []
  const rejected: RejectedInk[] = []
  const leftOver: PreparedStroke[] = []

  // Group ink that physically touches. A capacitor is two islands ten units
  // apart, so clusters whose bounding boxes nearly touch are merged as well.
  const strokeDiagonals = prepared.map((stroke) => boundsDiagonal(stroke.bounds)).sort((a, b) => a - b)
  const medianStroke = strokeDiagonals[Math.floor(strokeDiagonals.length / 2)] ?? 0
  const gapScale = Math.max(12, medianStroke * 0.5)
  const groups = mergeNearbyGroups(clusterByTouch(prepared, clusterTolerance), gapScale).sort(
    (a, b) => b.length - a.length,
  )

  for (const group of groups) {
    let members = group
    // Each extraction may expose another symbol in the remainder.
    for (let guard = 0; guard < 8 && members.length > 0; guard += 1) {
      const extraction = extractSymbol(members, minScore, rasterSize)
      if (!extraction) break
      symbols.push(extraction.symbol)
      members = extraction.remainder
      if (members.length === 0) break
    }
    leftOver.push(...members)
  }

  // Junction dots come from tiny closed or dense strokes. They are checked
  // before wire chaining so a dot is not stretched into a stub wire.
  const junctions: RecognizedJunction[] = []
  const wireInk: PreparedStroke[] = []
  for (const member of leftOver) {
    if (isJunction(member.points, drawingDiagonal, prepared.length === 1)) {
      junctions.push({
        kind: 'junction',
        center: boundsCenter(member.bounds),
        strokeIndexes: [member.index],
      })
    } else {
      wireInk.push(member)
    }
  }

  const wires: RecognizedWire[] = []
  for (const chain of chainStrokes(wireInk, chainTolerance)) {
    const length = strokeLength(chain.points)
    const bounds = pointsBounds(chain.points)
    if (length < minWireLength) {
      rejected.push({ strokeIndexes: chain.strokeIndexes, reason: 'too-small', bounds })
      continue
    }
    if (isClosedLoop(chain.points)) {
      rejected.push({ strokeIndexes: chain.strokeIndexes, reason: 'closed-loop', bounds })
      continue
    }
    const simplified = rdpPoints(chain.points, simplifyEpsilon)
    if (simplified.length > maxWireCorners || sharpTurnCount(simplified) > 3) {
      rejected.push({ strokeIndexes: chain.strokeIndexes, reason: 'too-complex', bounds })
      continue
    }
    // A scribble that wanders in every direction is not a wire either.
    const span = Math.max(boundsDiagonal(bounds), 1)
    if (length / span > 3.4 || straightness(simplified) < 0.18) {
      rejected.push({ strokeIndexes: chain.strokeIndexes, reason: 'too-complex', bounds })
      continue
    }
    wires.push({
      kind: 'wire',
      points: simplified,
      strokeIndexes: chain.strokeIndexes.sort((a, b) => a - b),
    })
  }

  return {
    symbols: symbols.sort((a, b) => b.confidence - a.confidence),
    wires,
    junctions,
    rejected,
    inkBounds,
    empty: symbols.length === 0 && wires.length === 0 && junctions.length === 0,
  }
}
