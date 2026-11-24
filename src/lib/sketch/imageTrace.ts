/**
 * Raster image → strokes.
 *
 * This is the "upload a photo of a schematic" path. It is deliberately a
 * classical pipeline (Otsu threshold → Zhang-Suen thinning → skeleton graph
 * walk) rather than a learned model, so the app can run it offline and state
 * exactly what it did. It works on clean line art; photographs of pencil
 * sketches with heavy shading are reported as low-confidence rather than
 * silently mangled.
 */
import { simplifyStroke, type Point } from './geometry'

export interface ImageDataLike {
  width: number
  height: number
  /** RGBA bytes, row-major (the shape of the browser's ImageData). */
  data: Uint8ClampedArray | Uint8Array
}

export interface TraceOptions {
  /** Force a luminance cut; omit to compute one with Otsu's method. */
  threshold?: number
  /** Treat light ink on a dark page as ink too. */
  invert?: boolean
  /** Downscale the longest edge before tracing; keeps the graph small. */
  maxDimension?: number
  /** Ramer-Douglas-Peucker epsilon in image pixels. */
  simplifyEpsilon?: number
}

export interface TracedStrokes {
  strokes: Point[][]
  threshold: number
  /** Fraction of pixels classified as ink before thinning. */
  inkRatio: number
  /** Size the source was downscaled to (equal to the input when untouched). */
  width: number
  height: number
}

/** Otsu's between-class variance maximisation over a 256-bin histogram. */
export function otsuThreshold(values: ArrayLike<number>): number {
  const histogram = new Float64Array(256)
  for (let i = 0; i < values.length; i += 1) histogram[Math.max(0, Math.min(255, values[i] | 0))] += 1
  const total = values.length
  if (total === 0) return 128
  let sum = 0
  for (let i = 0; i < 256; i += 1) sum += i * histogram[i]
  let sumBackground = 0
  let weightBackground = 0
  let best = -1
  let threshold = 128
  for (let t = 0; t < 256; t += 1) {
    weightBackground += histogram[t]
    if (weightBackground === 0) continue
    const weightForeground = total - weightBackground
    if (weightForeground === 0) break
    sumBackground += t * histogram[t]
    const meanBackground = sumBackground / weightBackground
    const meanForeground = (sum - sumBackground) / weightForeground
    const variance = weightBackground * weightForeground * (meanBackground - meanForeground) ** 2
    if (variance > best) {
      best = variance
      threshold = t
    }
  }
  return threshold
}

const luminanceAt = (image: ImageDataLike, index: number): number => {
  const offset = index * 4
  const alpha = image.data[offset + 3] ?? 255
  if (alpha < 16) return 255
  return (
    0.299 * (image.data[offset] ?? 255) +
    0.587 * (image.data[offset + 1] ?? 255) +
    0.114 * (image.data[offset + 2] ?? 255)
  )
}

/** Nearest-neighbour downscale so a phone photo does not produce a million-pixel graph. */
function downscale(image: ImageDataLike, maxDimension: number): { image: ImageDataLike; width: number; height: number } {
  const longest = Math.max(image.width, image.height)
  if (longest <= maxDimension) return { image, width: image.width, height: image.height }
  const scale = maxDimension / longest
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(image.height - 1, Math.floor(y / scale))
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(image.width - 1, Math.floor(x / scale))
      const from = (sourceY * image.width + sourceX) * 4
      const to = (y * width + x) * 4
      data[to] = image.data[from] ?? 255
      data[to + 1] = image.data[from + 1] ?? 255
      data[to + 2] = image.data[from + 2] ?? 255
      data[to + 3] = image.data[from + 3] ?? 255
    }
  }
  return { image: { width, height, data }, width, height }
}

/** Binary ink mask. Returns luminance statistics so the caller can warn. */
export function inkMask(image: ImageDataLike, options: { threshold?: number; invert?: boolean } = {}): {
  mask: Uint8Array
  threshold: number
  inkRatio: number
} {
  const pixelCount = image.width * image.height
  const luminance = new Uint8Array(pixelCount)
  for (let i = 0; i < pixelCount; i += 1) luminance[i] = Math.round(luminanceAt(image, i))
  const threshold = options.threshold ?? otsuThreshold(luminance)
  const invert = options.invert ?? false
  const mask = new Uint8Array(pixelCount)
  let ink = 0
  for (let i = 0; i < pixelCount; i += 1) {
    const dark = luminance[i] <= threshold
    if (dark !== invert) {
      mask[i] = 1
      ink += 1
    }
  }
  return { mask, threshold, inkRatio: pixelCount === 0 ? 0 : ink / pixelCount }
}

/** Zhang-Suen thinning to a one-pixel-wide skeleton. */
export function skeletonize(mask: Uint8Array, width: number, height: number): Uint8Array {
  const output = mask.slice()
  const neighbors = (x: number, y: number, grid: Uint8Array): number[] => [
    grid[(y - 1) * width + x], // p2 north
    grid[(y - 1) * width + x + 1], // p3 north-east
    grid[y * width + x + 1], // p4 east
    grid[(y + 1) * width + x + 1], // p5 south-east
    grid[(y + 1) * width + x], // p6 south
    grid[(y + 1) * width + x - 1], // p7 south-west
    grid[y * width + x - 1], // p8 west
    grid[(y - 1) * width + x - 1], // p9 north-west
  ]

  let changed = true
  while (changed) {
    changed = false
    for (const pass of [0, 1] as const) {
      const remove: number[] = []
      for (let y = 1; y < height - 1; y += 1) {
        for (let x = 1; x < width - 1; x += 1) {
          const index = y * width + x
          if (output[index] === 0) continue
          const [p2, p3, p4, p5, p6, p7, p8, p9] = neighbors(x, y, output)
          const filled = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9
          if (filled < 2 || filled > 6) continue
          const ring = [p2, p3, p4, p5, p6, p7, p8, p9, p2]
          let transitions = 0
          for (let i = 1; i < ring.length; i += 1) {
            if (ring[i - 1] === 0 && ring[i] === 1) transitions += 1
          }
          if (transitions !== 1) continue
          const first = pass === 0 ? p2 * p4 * p6 === 0 : p2 * p4 * p8 === 0
          const second = pass === 0 ? p4 * p6 * p8 === 0 : p2 * p6 * p8 === 0
          if (first && second) remove.push(index)
        }
      }
      if (remove.length > 0) {
        changed = true
        for (const index of remove) output[index] = 0
      }
    }
  }
  return output
}

const NEIGHBOR_OFFSETS = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
] as const

/**
 * Walk a skeleton into polylines. Traversal starts at endpoints and junctions;
 * a pure loop with no such pixels is seeded from any remaining ink.
 */
export function skeletonToStrokes(
  skeleton: Uint8Array,
  width: number,
  height: number,
  epsilon = 1.2,
): Point[][] {
  const indexOf = (x: number, y: number) => y * width + x
  const isInk = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && skeleton[indexOf(x, y)] !== 0
  const neighborsOf = (index: number): number[] => {
    const x = index % width
    const y = Math.floor(index / width)
    const output: number[] = []
    for (const [dx, dy] of NEIGHBOR_OFFSETS) {
      if (isInk(x + dx, y + dy)) output.push(indexOf(x + dx, y + dy))
    }
    return output
  }

  const degree = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = indexOf(x, y)
      if (skeleton[index] !== 0) degree[index] = neighborsOf(index).length
    }
  }

  const visitedEdges = new Set<number>()
  const edgeKey = (a: number, b: number) => {
    const low = Math.min(a, b)
    const high = Math.max(a, b)
    return low * (width * height) + high
  }
  const strokes: Point[][] = []
  const toPoint = (index: number): Point => ({ x: index % width, y: Math.floor(index / width) })

  const walk = (from: number, to: number): number[] => {
    const path = [from, to]
    visitedEdges.add(edgeKey(from, to))
    let previous = from
    let current = to
    for (let guard = 0; guard < width * height; guard += 1) {
      if (degree[current] !== 2) break
      const next = neighborsOf(current).find((candidate) => candidate !== previous && !visitedEdges.has(edgeKey(current, candidate)))
      if (next === undefined) break
      visitedEdges.add(edgeKey(current, next))
      path.push(next)
      previous = current
      current = next
    }
    return path
  }

  const seeds: number[] = []
  for (let i = 0; i < degree.length; i += 1) {
    if (skeleton[i] !== 0 && degree[i] !== 2) seeds.push(i)
  }
  for (const seed of seeds) {
    for (const neighbor of neighborsOf(seed)) {
      if (visitedEdges.has(edgeKey(seed, neighbor))) continue
      const path = walk(seed, neighbor)
      if (path.length >= 2) strokes.push(simplifyStroke(path.map(toPoint), epsilon))
    }
  }

  // Pure loops (every pixel has degree 2) have no seed above.
  for (let i = 0; i < skeleton.length; i += 1) {
    if (skeleton[i] === 0 || degree[i] !== 2) continue
    const neighbors = neighborsOf(i)
    const unvisited = neighbors.find((neighbor) => !visitedEdges.has(edgeKey(i, neighbor)))
    if (unvisited === undefined) continue
    const path = walk(i, unvisited)
    if (path.length >= 2) strokes.push(simplifyStroke(path.map(toPoint), epsilon))
  }

  return strokes.filter((stroke) => stroke.length >= 2)
}

/**
 * Map traced strokes from image pixels into sheet coordinates: uniform scale
 * so the longest source edge spans `span`, centred on `centre`. Aspect ratio
 * is preserved, so a schematic drawn in a 4:3 photo lands 4:3 on the sheet.
 */
export function fitStrokesToBox(
  strokes: ReadonlyArray<readonly Point[]>,
  source: { width: number; height: number },
  target: { center: Point; span: number },
): Point[][] {
  const longest = Math.max(source.width, source.height, 1)
  const scale = target.span > 0 ? target.span / longest : 1
  const offsetX = target.center.x - (source.width / 2) * scale
  const offsetY = target.center.y - (source.height / 2) * scale
  return strokes.map((stroke) =>
    stroke.map((point) => ({ x: offsetX + point.x * scale, y: offsetY + point.y * scale })),
  )
}

/** Full image pipeline: RGBA in, strokes out (image-pixel coordinates). */
export function traceImageToStrokes(image: ImageDataLike, options: TraceOptions = {}): TracedStrokes {
  const scaled = downscale(image, options.maxDimension ?? 1400)
  const { mask, threshold, inkRatio } = inkMask(scaled.image, {
    threshold: options.threshold,
    invert: options.invert,
  })
  if (inkRatio === 0 || inkRatio > 0.65) {
    return { strokes: [], threshold, inkRatio, width: scaled.width, height: scaled.height }
  }
  const skeleton = skeletonize(mask, scaled.width, scaled.height)
  const strokes = skeletonToStrokes(skeleton, scaled.width, scaled.height, options.simplifyEpsilon ?? 1.2)
  return { strokes, threshold, inkRatio, width: scaled.width, height: scaled.height }
}
