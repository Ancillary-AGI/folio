/**
 * Small fixed-size raster used to compare hand-drawn ink with symbol templates.
 *
 * Strokes are rasterised into a square canvas with a uniform scale, so a
 * wide resistor and a tall capacitor are compared without distortion. Masks
 * are dilated before scoring: two hand-drawn strokes never land on the same
 * pixel, and a strict overlap would score a correct drawing as a miss.
 */
import { pointsBounds, type Point } from './geometry'

export interface RasterOptions {
  size?: number
  padding?: number
  /** Half-width of the pen stroke in raster pixels. */
  thickness?: number
}

export const DEFAULT_RASTER_SIZE = 64
const DEFAULT_PADDING = 6

export interface Rasterized {
  size: number
  mask: Uint8Array
  /** World units per raster pixel, and the world origin of the raster. */
  scale: number
  origin: Point
}

const stampDisc = (mask: Uint8Array, size: number, cx: number, cy: number, radius: number) => {
  const r = Math.max(0, Math.ceil(radius))
  for (let dy = -r; dy <= r; dy += 1) {
    for (let dx = -r; dx <= r; dx += 1) {
      if (dx * dx + dy * dy > radius * radius) continue
      const x = Math.round(cx) + dx
      const y = Math.round(cy) + dy
      if (x < 0 || y < 0 || x >= size || y >= size) continue
      mask[y * size + x] = 1
    }
  }
}

/**
 * Rasterise polylines into a square mask, aspect-preserving and centred.
 * Returns a fully transparent raster when there is nothing to draw.
 */
export function rasterizeStrokes(
  strokes: ReadonlyArray<readonly Point[]>,
  options: RasterOptions = {},
): Rasterized {
  const size = options.size ?? DEFAULT_RASTER_SIZE
  const padding = options.padding ?? DEFAULT_PADDING
  const thickness = options.thickness ?? 1.5
  const mask = new Uint8Array(size * size)
  const all = strokes.flat()
  if (all.length === 0) return { size, mask, scale: 1, origin: { x: 0, y: 0 } }

  const bounds = pointsBounds(all)
  const inner = Math.max(4, size - padding * 2)
  const span = Math.max(bounds.width, bounds.height, 1e-6)
  const scale = inner / span
  const offsetX = (size - bounds.width * scale) / 2
  const offsetY = (size - bounds.height * scale) / 2
  const project = (point: Point): Point => ({
    x: offsetX + (point.x - bounds.x) * scale,
    y: offsetY + (point.y - bounds.y) * scale,
  })

  for (const stroke of strokes) {
    if (stroke.length === 0) continue
    if (stroke.length === 1) {
      const p = project(stroke[0])
      stampDisc(mask, size, p.x, p.y, thickness)
      continue
    }
    for (let i = 1; i < stroke.length; i += 1) {
      const a = project(stroke[i - 1])
      const b = project(stroke[i])
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2))
      for (let s = 0; s <= steps; s += 1) {
        const t = s / steps
        stampDisc(mask, size, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, thickness)
      }
    }
  }

  return {
    size,
    mask,
    scale,
    origin: { x: bounds.x, y: bounds.y },
  }
}

/** Fill a disc into a mask; used by the junction blob template. */
export function rasterizeDisc(size: number, radiusFraction = 0.22): Uint8Array {
  const mask = new Uint8Array(size * size)
  const center = size / 2
  stampDisc(mask, size, center, center, size * radiusFraction)
  return mask
}

/**
 * Binary dilation with a square structuring element, done as two separable
 * passes so the cost stays linear in the number of pixels.
 */
export function dilate(mask: Uint8Array, size: number, radius: number): Uint8Array {
  if (radius <= 0) return mask
  const horizontal = new Uint8Array(size * size)
  for (let y = 0; y < size; y += 1) {
    let count = 0
    const row = y * size
    // Sliding window over the row.
    for (let x = 0; x < Math.min(radius, size); x += 1) count += mask[row + x]
    for (let x = 0; x < size; x += 1) {
      if (x + radius < size) count += mask[row + x + radius]
      if (x - radius - 1 >= 0) count -= mask[row + x - radius - 1]
      if (count > 0) horizontal[row + x] = 1
    }
  }
  const output = new Uint8Array(size * size)
  for (let x = 0; x < size; x += 1) {
    let count = 0
    for (let y = 0; y < Math.min(radius, size); y += 1) count += horizontal[y * size + x]
    for (let y = 0; y < size; y += 1) {
      if (y + radius < size) count += horizontal[(y + radius) * size + x]
      if (y - radius - 1 >= 0) count -= horizontal[(y - radius - 1) * size + x]
      if (count > 0) output[y * size + x] = 1
    }
  }
  return output
}

/** Intersection over union of two equal-sized binary masks. */
export function maskIoU(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length || a.length === 0) return 0
  let intersection = 0
  let union = 0
  for (let i = 0; i < a.length; i += 1) {
    const bitA = a[i] !== 0 ? 1 : 0
    const bitB = b[i] !== 0 ? 1 : 0
    intersection += bitA & bitB
    union += bitA | bitB
  }
  return union === 0 ? 0 : intersection / union
}

/** Fraction of `a` that is covered by the dilated `b` (asymmetric containment). */
export function coverage(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) return 0
  let ink = 0
  let hit = 0
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === 0) continue
    ink += 1
    if (b[i] !== 0) hit += 1
  }
  return ink === 0 ? 0 : hit / ink
}
