/**
 * Procedural symbol templates used to recognise hand-drawn schematics.
 *
 * Geometry mirrors the shipped library symbols (same proportions, same pin
 * positions) so a recognised symbol can be dropped in at the drawn location
 * and its real pins land where the designer drew the leads. Templates are
 * generated, not traced from bitmaps: there is no hidden training set, and the
 * matcher can say exactly what it compared the ink against.
 */
import { rotatePoint, type Point } from './geometry'
import { DEFAULT_RASTER_SIZE, dilate, rasterizeDisc, rasterizeStrokes } from './raster'

export type SketchTemplateId =
  | 'resistor'
  | 'capacitor'
  | 'inductor'
  | 'diode'
  | 'ground'
  | 'source'
  | 'junction'

export interface SketchTemplate {
  id: SketchTemplateId
  /** Library part this becomes on commit; null for the junction marker. */
  libraryName: string | null
  label: string
  width: number
  height: number
  pins: Point[]
  strokes: Point[][]
  /** Filled shape (dot) rather than an outline. */
  filled?: boolean
  /** Minimum number of drawn strokes a real instance has. */
  minStrokes: number
}

const arc = (
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  startDeg: number,
  endDeg: number,
  steps = 10,
): Point[] => {
  const points: Point[] = []
  for (let i = 0; i <= steps; i += 1) {
    const angle = ((startDeg + ((endDeg - startDeg) * i) / steps) * Math.PI) / 180
    points.push({ x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) })
  }
  return points
}

/** Semicircular humps above the baseline, as an inductor is normally drawn. */
const humps = (startX: number, endX: number, y: number, humpsCount: number): Point[] => {
  const radius = (endX - startX) / (humpsCount * 2)
  const points: Point[] = [{ x: startX, y }]
  for (let i = 0; i < humpsCount; i += 1) {
    const cx = startX + radius * (2 * i + 1)
    points.push(...arc(cx, y, radius, radius, 180, 360, 10).slice(1))
  }
  return points
}

export const SKETCH_TEMPLATES: readonly SketchTemplate[] = [
  {
    id: 'resistor',
    libraryName: 'Resistor',
    label: 'Resistor',
    width: 80,
    height: 30,
    pins: [
      { x: 0, y: 15 },
      { x: 80, y: 15 },
    ],
    minStrokes: 1,
    strokes: [
      [
        { x: 0, y: 15 },
        { x: 15, y: 15 },
        { x: 20, y: 5 },
        { x: 30, y: 25 },
        { x: 40, y: 5 },
        { x: 50, y: 25 },
        { x: 60, y: 5 },
        { x: 65, y: 15 },
        { x: 80, y: 15 },
      ],
    ],
  },
  {
    id: 'capacitor',
    libraryName: 'Capacitor',
    label: 'Capacitor',
    width: 60,
    height: 40,
    pins: [
      { x: 0, y: 20 },
      { x: 60, y: 20 },
    ],
    minStrokes: 2,
    strokes: [
      [
        { x: 0, y: 20 },
        { x: 25, y: 20 },
      ],
      [
        { x: 25, y: 5 },
        { x: 25, y: 35 },
      ],
      [
        { x: 35, y: 5 },
        { x: 35, y: 35 },
      ],
      [
        { x: 35, y: 20 },
        { x: 60, y: 20 },
      ],
    ],
  },
  {
    id: 'inductor',
    libraryName: 'Inductor',
    label: 'Inductor',
    width: 80,
    height: 30,
    pins: [
      { x: 0, y: 15 },
      { x: 80, y: 15 },
    ],
    minStrokes: 1,
    strokes: [
      [
        { x: 0, y: 15 },
        ...humps(6, 74, 15, 4),
        { x: 80, y: 15 },
      ],
    ],
  },
  {
    id: 'diode',
    libraryName: 'Diode',
    label: 'Diode',
    width: 60,
    height: 40,
    pins: [
      { x: 0, y: 20 },
      { x: 60, y: 20 },
    ],
    minStrokes: 2,
    strokes: [
      [
        { x: 0, y: 20 },
        { x: 25, y: 20 },
      ],
      [
        { x: 25, y: 5 },
        { x: 25, y: 35 },
        { x: 45, y: 20 },
        { x: 25, y: 5 },
      ],
      [
        { x: 45, y: 5 },
        { x: 45, y: 35 },
      ],
      [
        { x: 45, y: 20 },
        { x: 60, y: 20 },
      ],
    ],
  },
  {
    id: 'ground',
    libraryName: 'Ground',
    label: 'Ground',
    width: 40,
    height: 30,
    pins: [{ x: 20, y: 0 }],
    minStrokes: 2,
    strokes: [
      [
        { x: 20, y: 0 },
        { x: 20, y: 10 },
      ],
      [
        { x: 5, y: 10 },
        { x: 35, y: 10 },
      ],
      [
        { x: 10, y: 15 },
        { x: 30, y: 15 },
      ],
      [
        { x: 13, y: 20 },
        { x: 27, y: 20 },
      ],
    ],
  },
  {
    id: 'source',
    libraryName: 'DC Voltage Source',
    label: 'Voltage source',
    width: 60,
    height: 60,
    pins: [
      { x: 30, y: 0 },
      { x: 30, y: 60 },
    ],
    minStrokes: 1,
    strokes: [
      [
        { x: 30, y: 0 },
        { x: 30, y: 15 },
        ...arc(30, 30, 15, 15, -90, 270, 24),
        { x: 30, y: 60 },
      ],
      [
        { x: 25, y: 20 },
        { x: 35, y: 20 },
      ],
      [
        { x: 30, y: 38 },
        { x: 30, y: 42 },
      ],
    ],
  },
  {
    id: 'junction',
    libraryName: null,
    label: 'Junction',
    width: 12,
    height: 12,
    pins: [],
    minStrokes: 1,
    filled: true,
    strokes: [],
  },
]

export const SKETCH_TEMPLATES_BY_ID: ReadonlyMap<SketchTemplateId, SketchTemplate> = new Map(
  SKETCH_TEMPLATES.map((template) => [template.id, template]),
)

/** Rotations the matcher tries. Symbols on a schematic are axis-aligned. */
export const TEMPLATE_ROTATIONS = [0, 90, 180, 270] as const
export type TemplateRotation = (typeof TEMPLATE_ROTATIONS)[number]

const maskCache = new Map<string, Uint8Array>()

/**
 * Rasterised, dilated mask for a template at a rotation. Cached because the
 * matcher evaluates the same six templates against every cluster.
 */
export function templateMask(
  template: SketchTemplate,
  rotation: TemplateRotation,
  size: number = DEFAULT_RASTER_SIZE,
  dilation = 2,
): Uint8Array {
  const key = `${template.id}:${rotation}:${size}:${dilation}`
  const cached = maskCache.get(key)
  if (cached) return cached
  const base = template.filled
    ? rasterizeDisc(size, 0.2)
    : rasterizeStrokes(
        template.strokes.map((stroke) =>
          stroke.map((point) =>
            rotatePoint(point, rotation, { x: template.width / 2, y: template.height / 2 }),
          ),
        ),
        { size },
      ).mask
  const mask = dilate(base, size, dilation)
  maskCache.set(key, mask)
  return mask
}

/** Rotated template geometry (world-independent), used to place parts. */
export function rotatedTemplateStrokes(template: SketchTemplate, rotation: number): Point[][] {
  return template.strokes.map((stroke) =>
    stroke.map((point) => rotatePoint(point, rotation, { x: template.width / 2, y: template.height / 2 })),
  )
}
