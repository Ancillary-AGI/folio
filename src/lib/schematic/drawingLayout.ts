/**
 * Shared schematic drawing geometry.
 *
 * The interactive canvas and the engineering-drawing SVG export must agree:
 * pin rotation, part bounds, label collision avoidance, drawing-sheet bounds
 * and junction detection all live here so a screenshot and an exported sheet
 * cannot drift apart.
 */
import type { CanvasComponent, CanvasWire } from '../../stores/useProjectStore'

export interface Point {
  x: number
  y: number
}

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export interface LabelLine {
  text: string
  fontSize: number
  bold: boolean
  /** Vertical centre of the line inside the label block. */
  centerY: number
}

export interface LabelPlacement {
  lines: LabelLine[]
  box: Bounds
}

/** Pin offset rotated by the part's rotation (degrees, clockwise positive). */
export const rotatePinCoord = (pin: Point, rotationDegrees: number): Point => {
  const radians = ((rotationDegrees % 360) * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return { x: pin.x * cos - pin.y * sin, y: pin.x * sin + pin.y * cos }
}

/** World position of a pin: part origin plus rotated offset. */
export const pinWorldCoord = (
  comp: { x: number; y: number; rotation: number },
  pin: Point,
): Point => {
  const rotated = rotatePinCoord(pin, comp.rotation)
  return { x: comp.x + rotated.x, y: comp.y + rotated.y }
}

/** Axis-aligned world bounds of a placed part's symbol body. */
export const componentBounds = (comp: CanvasComponent): Bounds => {
  const width = comp.component.symbol_data.width
  const height = comp.component.symbol_data.height
  const corners = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ].map((corner) => pinWorldCoord(comp, corner))
  const xs = corners.map((point) => point.x)
  const ys = corners.map((point) => point.y)
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  }
}

/** Rough advance width for the sans label face; good enough for collision tests. */
export const estimateTextWidth = (text: string, fontSize: number, bold: boolean): number =>
  text.length * fontSize * (bold ? 0.64 : 0.58) + 4

/** Human-readable value field, with engineering units where the property is bare. */
export const displayValueFor = (
  component: { name: string },
  properties: Record<string, string | number | boolean>,
): string => {
  // A ground symbol carries no value; printing its internal type ("earth")
  // just adds noise to the sheet.
  if (component.name === 'Ground') return ''
  if (properties.value !== undefined && properties.value !== '') {
    const raw = String(properties.value)
    if (component.name === 'Resistor' && /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(raw)) return `${raw} Ω`
    return raw
  }
  const type = typeof properties.type === 'string' ? properties.type : ''
  if (component.name.includes('Voltage Source')) {
    const amplitude = properties.va ?? properties.vo
    return [type, amplitude].filter((part) => part !== undefined && part !== '').join(' ').trim()
  }
  if (type) return type
  if (properties.voltage !== undefined) return String(properties.voltage)
  return ''
}

export const overlaps = (a: Bounds, b: Bounds): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

/**
 * Reference and value placed in world space, horizontal regardless of part
 * rotation. Placement is greedy against every part, wire segment and already
 * placed label: above first, then below, then right and left; the
 * lowest-overlap candidate wins when the sheet is genuinely congested.
 */
export function layoutComponentLabels(
  components: CanvasComponent[],
  wires: CanvasWire[],
): Map<string, LabelPlacement> {
  const placements = new Map<string, LabelPlacement>()
  const bounds = new Map(components.map((comp) => [comp.id, componentBounds(comp)]))
  const obstacles: Bounds[] = []

  for (const box of bounds.values()) {
    obstacles.push({ x: box.x - 3, y: box.y - 3, width: box.width + 6, height: box.height + 6 })
  }
  for (const wire of wires) {
    for (let k = 0; k + 1 < wire.points.length; k++) {
      const a = wire.points[k]
      const b = wire.points[k + 1]
      obstacles.push({
        x: Math.min(a.x, b.x) - 3,
        y: Math.min(a.y, b.y) - 3,
        width: Math.abs(a.x - b.x) + 6,
        height: Math.abs(a.y - b.y) + 6,
      })
    }
  }

  for (const comp of components) {
    const box = bounds.get(comp.id)
    if (!box) continue
    const value = displayValueFor(comp.component, comp.properties)
    const lines: LabelLine[] = [
      { text: comp.reference, fontSize: 11, bold: true, centerY: value ? 8 : 7 },
    ]
    if (value) lines.push({ text: value, fontSize: 10, bold: false, centerY: 21 })
    const width = Math.max(
      ...lines.map((line) => estimateTextWidth(line.text, line.fontSize, line.bold)),
    )
    const height = value ? 28 : 14
    const gap = 10
    const centerX = box.x + box.width / 2
    const centerY = box.y + box.height / 2

    const candidates: Bounds[] = [
      { x: centerX - width / 2, y: box.y - gap - height, width, height },
      { x: centerX - width / 2, y: box.y + box.height + gap, width, height },
      { x: box.x + box.width + gap, y: centerY - height / 2, width, height },
      { x: box.x - gap - width, y: centerY - height / 2, width, height },
    ]

    let chosen = candidates[0]
    let bestPenalty = Number.POSITIVE_INFINITY
    for (const candidate of candidates) {
      let penalty = 0
      for (const obstacle of obstacles) {
        if (!overlaps(candidate, obstacle)) continue
        const overlapWidth =
          Math.min(candidate.x + candidate.width, obstacle.x + obstacle.width) -
          Math.max(candidate.x, obstacle.x)
        const overlapHeight =
          Math.min(candidate.y + candidate.height, obstacle.y + obstacle.height) -
          Math.max(candidate.y, obstacle.y)
        penalty += Math.max(1, overlapWidth * overlapHeight)
      }
      if (penalty < bestPenalty) {
        bestPenalty = penalty
        chosen = candidate
        if (penalty === 0) break
      }
    }

    obstacles.push({ ...chosen })
    placements.set(comp.id, { lines, box: chosen })
  }

  return placements
}

export const SHEET_PAD_X = 50
export const SHEET_PAD_TOP = 50
/** Title block height plus clearance; content must stay above it. */
export const SHEET_PAD_BOTTOM = 130
export const SHEET_MIN_WIDTH = 600
export const SHEET_MIN_HEIGHT = 360

/** Drawing frame around a content extent; shared by canvas Fit and SVG export. */
export function frameAround(bounds: { minX: number; minY: number; maxX: number; maxY: number }): Bounds {
  let left = bounds.minX - SHEET_PAD_X
  let right = bounds.maxX + SHEET_PAD_X
  let top = bounds.minY - SHEET_PAD_TOP
  let bottom = bounds.maxY + SHEET_PAD_BOTTOM

  if (right - left < SHEET_MIN_WIDTH) {
    const extra = (SHEET_MIN_WIDTH - (right - left)) / 2
    left -= extra
    right += extra
  }
  if (bottom - top < SHEET_MIN_HEIGHT) bottom += SHEET_MIN_HEIGHT - (bottom - top)

  left = Math.floor(left / 10) * 10
  top = Math.floor(top / 10) * 10
  right = Math.ceil(right / 10) * 10
  bottom = Math.ceil(bottom / 10) * 10

  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** Union of every part, wire vertex and label block on the sheet. */
export function drawingExtents(
  components: CanvasComponent[],
  wires: CanvasWire[],
  labels?: Map<string, LabelPlacement>,
): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const grow = (x: number, y: number) => {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }

  for (const comp of components) {
    const box = componentBounds(comp)
    grow(box.x, box.y)
    grow(box.x + box.width, box.y + box.height)
    const label = labels?.get(comp.id)
    if (label) {
      grow(label.box.x, label.box.y)
      grow(label.box.x + label.box.width, label.box.y + label.box.height)
    }
  }
  for (const wire of wires) {
    for (const point of wire.points) grow(point.x, point.y)
  }

  return { minX, minY, maxX, maxY }
}

/**
 * Wire vertices that join another wire of the same net. These get a filled
 * junction dot; a crossing between different nets is not a connection.
 */
export function wireJunctions(wires: CanvasWire[]): Point[] {
  const segments: Array<{ x1: number; y1: number; x2: number; y2: number; wireId: string }> = []
  for (const wire of wires) {
    for (let k = 0; k + 1 < wire.points.length; k++) {
      segments.push({
        x1: wire.points[k].x,
        y1: wire.points[k].y,
        x2: wire.points[k + 1].x,
        y2: wire.points[k + 1].y,
        wireId: wire.id,
      })
    }
  }

  const dots: Point[] = []
  const seen = new Set<string>()
  for (const wire of wires) {
    for (const pt of wire.points) {
      const key = Math.round(pt.x) + ':' + Math.round(pt.y)
      if (seen.has(key)) continue
      const onOther = segments.some((segment) => {
        if (segment.wireId === wire.id) return false
        const other = wires.find((candidate) => candidate.id === segment.wireId)
        if (!wire.netName || other?.netName !== wire.netName) return false
        return (
          Math.min(segment.x1, segment.x2) - 0.5 <= pt.x &&
          pt.x <= Math.max(segment.x1, segment.x2) + 0.5 &&
          Math.min(segment.y1, segment.y2) - 0.5 <= pt.y &&
          pt.y <= Math.max(segment.y1, segment.y2) + 0.5
        )
      })
      if (!onOther) continue
      seen.add(key)
      dots.push({ x: pt.x, y: pt.y })
    }
  }
  return dots
}

/** Pin ids that at least one wire touches. */
export function connectedPinKeys(wires: CanvasWire[]): Set<string> {
  const keys = new Set<string>()
  for (const wire of wires) {
    for (const pin of wire.connectedPins ?? []) keys.add(`${pin.componentId}:${pin.pinId}`)
  }
  return keys
}
