/**
 * Orthographic engineering drawing for a rectangular machine part.
 *
 * Third-angle projection: front view with the top view above it and the right
 * side view beside it, overall dimensions in millimetres, a pictorial view,
 * a title block and manufacturing notes. Dimensions are nominal model values —
 * the drawing never claims tolerances or finishes the model does not carry.
 */
export type DrawingPaper = 'A4' | 'A3' | 'Letter'

export interface PartDrawingInput {
  id: string
  name: string
  /** Metres, matching the mechanical model. */
  dimensions: { length: number; width: number; height: number }
  materialName: string
  massKg: number
}

export interface PartDrawingOptions {
  projectName?: string
  revision?: string
  /** ISO date (YYYY-MM-DD). Defaults to today. */
  date?: string
  paperSize?: DrawingPaper
  /** General tolerance note, e.g. "±0.2 mm". */
  tolerance?: string
  finish?: string
  notes?: string[]
  drawnBy?: string
}

interface Paper {
  width: number
  height: number
}

const PAPER: Record<DrawingPaper, Paper> = {
  A4: { width: 297, height: 210 },
  A3: { width: 420, height: 297 },
  Letter: { width: 279.4, height: 215.9 },
}

/** Standard scales as paper millimetres per model millimetre, largest first. */
const STANDARD_SCALES = [5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01, 0.005, 0.002, 0.001]

const INK = '#111827'
const QUIET = '#4b5563'
const FRAME = '#1f2937'
const PAPER_INK = '#ffffff'
const HIDDEN = '#6b7280'
const PICTORIAL_FRONT = '#f8fafc'
const PICTORIAL_TOP = '#e2e8f0'
const PICTORIAL_SIDE = '#cbd5e1'

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

const round = (value: number): number => Math.round(value * 100) / 100

const fmt = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(1)

const scaleLabel = (scale: number): string =>
  scale >= 1 ? `${scale}:1` : `1:${Math.round(1 / scale)}`

/** Trim text to the cell width using a rough advance width for Arial. */
function fitText(text: string, maxWidthMm: number, fontSizeMm: number): string {
  const maxChars = Math.max(3, Math.floor(maxWidthMm / (fontSizeMm * 0.58)))
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`
}

interface Point2 {
  x: number
  y: number
}

export function buildPartDrawing(
  part: PartDrawingInput,
  options: PartDrawingOptions = {},
): string {
  const paper = PAPER[options.paperSize ?? 'A3']
  const L = part.dimensions.length * 1000
  const W = part.dimensions.width * 1000
  const H = part.dimensions.height * 1000
  if (!(L > 0 && W > 0 && H > 0)) {
    throw new Error('Part dimensions must be positive before a drawing can be produced.')
  }

  const margin = 10
  const frame = {
    x: margin,
    y: margin,
    width: paper.width - margin * 2,
    height: paper.height - margin * 2,
  }
  const titleWidth = paper.width >= 400 ? 150 : 132
  const titleHeight = 44
  const title = {
    x: frame.x + frame.width - 4 - titleWidth,
    y: frame.y + frame.height - 4 - titleHeight,
    width: titleWidth,
    height: titleHeight,
  }

  const area = {
    x: frame.x + 8,
    y: frame.y + 8,
    width: frame.width - 16,
    height: title.y - frame.y - 14,
  }

  // Overall dimensions sit outside the views, so reserve room on every side.
  const requiredAt = (scale: number) => ({
    width: L * scale + 18 + W * scale + 32,
    height: W * scale + 18 + H * scale + 30,
  })
  const scale = STANDARD_SCALES.find((candidate) => {
    const need = requiredAt(candidate)
    return need.width <= area.width && need.height <= area.height
  })
  if (!scale) {
    throw new Error('This part is too large for the selected sheet; choose a larger paper size.')
  }

  const front = { width: L * scale, height: H * scale }
  const top = { width: L * scale, height: W * scale }
  const side = { width: W * scale, height: H * scale }
  const gap = 18
  const needed = requiredAt(scale)
  const frontX = area.x + 16 + Math.max(0, (area.width - needed.width) / 2)
  const topY = area.y + 8 + Math.max(0, (area.height - needed.height) / 2)
  const frontY = topY + top.height + gap
  const sideX = frontX + front.width + gap

  const parts: string[] = []
  const line = (x1: number, y1: number, x2: number, y2: number, extra = '') =>
    parts.push(
      `<line x1="${round(x1)}" y1="${round(y1)}" x2="${round(x2)}" y2="${round(y2)}"${extra}/>`,
    )
  const rect = (x: number, y: number, width: number, height: number, extra = '') =>
    parts.push(
      `<rect x="${round(x)}" y="${round(y)}" width="${round(width)}" height="${round(height)}"${extra}/>`,
    )
  const text = (
    x: number,
    y: number,
    content: string,
    size: number,
    extra = '',
  ) =>
    parts.push(
      `<text x="${round(x)}" y="${round(y)}" font-size="${size}"${extra}>${escapeXml(content)}</text>`,
    )

  // ── Sheet ────────────────────────────────────────────────────────────────
  parts.push('<?xml version="1.0" encoding="UTF-8"?>')
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${paper.width}mm" height="${paper.height}mm" viewBox="0 0 ${paper.width} ${paper.height}" role="img" aria-labelledby="part-drawing-title">`,
  )
  parts.push(
    `<title id="part-drawing-title">${escapeXml(part.name)} — mechanical part drawing</title>`,
  )
  parts.push(`<rect width="${paper.width}" height="${paper.height}" fill="${PAPER_INK}"/>`)

  // ── Frame and zone references ────────────────────────────────────────────
  parts.push(`<g fill="none" stroke="${FRAME}" stroke-width="0.7">`)
  rect(frame.x, frame.y, frame.width, frame.height)
  rect(frame.x + 5, frame.y + 5, frame.width - 10, frame.height - 10, ' stroke-width="0.3"')
  for (let index = 1; index < 4; index += 1) {
    const x = frame.x + (frame.width * index) / 4
    line(x, frame.y, x, frame.y + 5)
    line(x, frame.y + frame.height - 5, x, frame.y + frame.height)
  }
  for (let index = 1; index < 3; index += 1) {
    const y = frame.y + (frame.height * index) / 3
    line(frame.x, y, frame.x + 5, y)
    line(frame.x + frame.width - 5, y, frame.x + frame.width, y)
  }
  parts.push('</g>')
  parts.push(
    `<g fill="${QUIET}" font-family="Arial, Helvetica, sans-serif" font-size="3" text-anchor="middle">`,
  )
  ;['A', 'B', 'C', 'D'].forEach((zone, index) =>
    text(frame.x + (frame.width * (index + 0.5)) / 4, frame.y + 3.7, zone, 3),
  )
  ;['1', '2', '3'].forEach((zone, index) =>
    text(frame.x + 2.7, frame.y + (frame.height * (index + 0.5)) / 3 + 1, zone, 3),
  )
  parts.push('</g>')

  // ── Views ────────────────────────────────────────────────────────────────
  parts.push(
    `<g fill="none" stroke="${INK}" stroke-width="0.45" stroke-linejoin="round">`,
  )
  rect(frontX, frontY, front.width, front.height)
  rect(frontX, topY, top.width, top.height)
  rect(sideX, frontY, side.width, side.height)
  parts.push('</g>')

  // Centre lines (chain-dashed), extending slightly past each view.
  parts.push(
    `<g fill="none" stroke="${HIDDEN}" stroke-width="0.18" stroke-dasharray="4 1.2 0.8 1.2">`,
  )
  const centre = (
    cx: number,
    cy: number,
    halfWidth: number,
    halfHeight: number,
  ) => {
    line(cx - halfWidth - 3, cy, cx + halfWidth + 3, cy)
    line(cx, cy - halfHeight - 3, cx, cy + halfHeight + 3)
  }
  centre(frontX + front.width / 2, frontY + front.height / 2, front.width / 2, front.height / 2)
  centre(frontX + top.width / 2, topY + top.height / 2, top.width / 2, top.height / 2)
  centre(sideX + side.width / 2, frontY + side.height / 2, side.width / 2, side.height / 2)
  parts.push('</g>')

  // View captions
  parts.push(
    `<g fill="${QUIET}" font-family="Arial, Helvetica, sans-serif" font-size="2.8" text-anchor="middle" letter-spacing="0.4">`,
  )
  text(frontX + front.width / 2, frontY + front.height + 7, 'FRONT VIEW', 2.8)
  text(frontX + top.width / 2, topY - 3.4, 'TOP VIEW', 2.8)
  text(sideX + side.width / 2, frontY + side.height + 7, 'RIGHT SIDE', 2.8)
  parts.push('</g>')

  // ── Dimensions ───────────────────────────────────────────────────────────
  const dimensionLayer: string[] = []
  const dimLine = (x1: number, y1: number, x2: number, y2: number) =>
    dimensionLayer.push(
      `<line x1="${round(x1)}" y1="${round(y1)}" x2="${round(x2)}" y2="${round(y2)}" stroke="${INK}" stroke-width="0.18"/>`,
    )
  const arrow = (x: number, y: number, angle: number) => {
    const length = 2.2
    const half = 0.8
    const radians = (angle * Math.PI) / 180
    const cos = Math.cos(radians)
    const sin = Math.sin(radians)
    const tipX = x + cos * length
    const tipY = y + sin * length
    const leftX = x - sin * half
    const leftY = y + cos * half
    const rightX = x + sin * half
    const rightY = y - cos * half
    dimensionLayer.push(
      `<polygon points="${round(x)},${round(y)} ${round(tipX)},${round(tipY)} ${round(leftX)},${round(leftY)} ${round(rightX)},${round(rightY)}" fill="${INK}"/>`,
    )
  }
  const dimText = (x: number, y: number, value: string, rotate = 0) =>
    dimensionLayer.push(
      `<text x="${round(x)}" y="${round(y)}" font-size="3" text-anchor="middle" dominant-baseline="central" fill="${INK}" paint-order="stroke" stroke="${PAPER_INK}" stroke-width="0.9"${rotate ? ` transform="rotate(${rotate} ${round(x)} ${round(y)})"` : ''}>${escapeXml(value)}</text>`,
    )

  // Overall length under the front view.
  const lengthY = frontY + front.height + 13
  dimLine(frontX, lengthY, frontX + front.width, lengthY)
  line(frontX, frontY + front.height + 1, frontX, lengthY + 2)
  line(frontX + front.width, frontY + front.height + 1, frontX + front.width, lengthY + 2)
  arrow(frontX, lengthY, 0)
  arrow(frontX + front.width, lengthY, 180)
  dimText(frontX + front.width / 2, lengthY - 2.6, fmt(L))
  dimText(frontX + front.width / 2, lengthY + 3.4, 'OVERALL LENGTH', 0)

  // Overall height left of the front view.
  const heightX = frontX - 13
  dimLine(heightX, frontY, heightX, frontY + front.height)
  line(frontX - 1, frontY, heightX - 2, frontY)
  line(frontX - 1, frontY + front.height, heightX - 2, frontY + front.height)
  arrow(heightX, frontY, 90)
  arrow(heightX, frontY + front.height, -90)
  dimText(heightX - 2.6, frontY + front.height / 2, fmt(H), -90)

  // Overall width right of the top view.
  const widthX = frontX + top.width + 13
  dimLine(widthX, topY, widthX, topY + top.height)
  line(frontX + top.width + 1, topY, widthX + 2, topY)
  line(frontX + top.width + 1, topY + top.height, widthX + 2, topY + top.height)
  arrow(widthX, topY, 90)
  arrow(widthX, topY + top.height, -90)
  dimText(widthX + 2.6, topY + top.height / 2, fmt(W), -90)

  parts.push(`<g fill="none" stroke="${INK}" font-family="Arial, Helvetica, sans-serif">`)
  parts.push(dimensionLayer.join('\n'))
  parts.push('</g>')

  // ── Pictorial view ──────────────────────────────────────────────────────
  // Placed above the title block, clear of the notes strip. The projection is
  // a true cabinet-style axon; it is never dimensioned or used for measurement.
  const isoScale = scale * 0.9
  const isoHorizontal = (L + W * 0.5) * isoScale
  const isoVertical = (H + W * 0.35) * isoScale
  const isoReadable = Math.min(H, W) * scale >= 2.5
  const isoX = area.x + area.width - isoHorizontal - 8
  const isoBase = title.y - 12
  const viewsBottom = Math.max(frontY + front.height, topY + top.height, frontY + side.height)
  if (isoReadable && isoBase - isoVertical > viewsBottom + 8) {
    const project = (x: number, y: number, z: number): Point2 => ({
      x: isoX + (x - z * 0.5) * isoScale,
      y: isoBase - (y + z * 0.35) * isoScale,
    })
    const p = (x: number, y: number, z: number) => {
      const point = project(x, y, z)
      return `${round(point.x)},${round(point.y)}`
    }
    const face = (points: string, fill: string) =>
      parts.push(
        `<polygon points="${points}" fill="${fill}" stroke="${INK}" stroke-width="0.35" stroke-linejoin="round"/>`,
      )
    face(`${p(0, H, 0)} ${p(L, H, 0)} ${p(L, H, W)} ${p(0, H, W)}`, PICTORIAL_TOP)
    face(`${p(L, 0, 0)} ${p(L, H, 0)} ${p(L, H, W)} ${p(L, 0, W)}`, PICTORIAL_SIDE)
    face(`${p(0, 0, 0)} ${p(L, 0, 0)} ${p(L, H, 0)} ${p(0, H, 0)}`, PICTORIAL_FRONT)
    parts.push(
      `<text x="${round(isoX)}" y="${round(isoBase + 8)}" font-family="Arial, Helvetica, sans-serif" font-size="2.6" fill="${QUIET}" letter-spacing="0.3">ISOMETRIC VIEW — NOT TO SCALE</text>`,
    )
  }

  // ── Notes ────────────────────────────────────────────────────────────────
  const notes = [
    'ALL DIMENSIONS IN MILLIMETRES',
    `GENERAL TOLERANCES ${options.tolerance ?? '±0.2'} UNLESS NOTED`,
    `MATERIAL: ${part.materialName.toUpperCase()}`,
    `MASS: ${part.massKg.toFixed(2)} kg`,
    ...(options.finish ? [`FINISH: ${options.finish.toUpperCase()}`] : []),
    'DO NOT SCALE DRAWING',
    ...(options.notes ?? []),
  ]
  const notesX = frame.x + 10
  const notesTop = title.y - 4 - notes.length * 4.4
  parts.push(
    `<g font-family="Arial, Helvetica, sans-serif" fill="${QUIET}">`,
    `<text x="${round(notesX)}" y="${round(notesTop - 3)}" font-size="2.4" font-weight="700" letter-spacing="0.5">NOTES</text>`,
  )
  notes.forEach((note, index) =>
    text(notesX, notesTop + index * 4.4, note, 2.6),
  )
  parts.push('</g>')

  // ── Title block ──────────────────────────────────────────────────────────
  const date = options.date ?? new Date().toISOString().slice(0, 10)
  const revision = options.revision ?? 'A'
  const drawnBy = options.drawnBy ?? 'FOLIO'
  const cols = [0.5, 0.14, 0.11, 0.1, 0.075, 0.075]
  const colX: number[] = [title.x]
  for (const fraction of cols) {
    colX.push(colX[colX.length - 1] + title.width * fraction)
  }

  parts.push(`<g fill="none" stroke="${FRAME}" stroke-width="0.35">`)
  rect(title.x, title.y, title.width, title.height, ` fill="${PAPER_INK}"`)
  line(title.x, title.y + 10, title.x + title.width, title.y + 10)
  line(title.x, title.y + 26, title.x + title.width, title.y + 26)
  line(title.x, title.y + 36, title.x + title.width, title.y + 36)
  line(colX[1], title.y + 26, colX[1], title.y + title.height)
  line(colX[2], title.y + 26, colX[2], title.y + 36)
  line(colX[3], title.y + 26, colX[3], title.y + 36)
  line(colX[4], title.y + 26, colX[4], title.y + title.height)
  parts.push('</g>')

  parts.push(`<g font-family="Arial, Helvetica, sans-serif">`)
  text(title.x + 4, title.y + 7.2, 'FOLIO', 6, ` font-weight="700" fill="${INK}" letter-spacing="0.8"`)
  text(
    title.x + title.width - 4,
    title.y + 6.6,
    `REV ${revision}`,
    2.6,
    ` text-anchor="end" fill="${INK}"`,
  )
  text(title.x + 4, title.y + 14.6, 'PART TITLE', 1.8, ` fill="${QUIET}" letter-spacing="0.4"`)
  text(
    title.x + 4,
    title.y + 22.4,
    fitText(part.name, title.width - 8, 4.4),
    4.4,
    ` font-weight="700" fill="${INK}"`,
  )

  const cellLabel = (x: number, label: string) =>
    text(x, title.y + 29.4, label, 1.7, ` fill="${QUIET}" letter-spacing="0.3"`)
  const cellValue = (x: number, value: string, width: number, size = 2.8) =>
    text(x, title.y + 34, fitText(value, width - 4, size), size, ` fill="${INK}"`)

  cellLabel(colX[0] + 3, 'MATERIAL')
  cellValue(colX[0] + 3, part.materialName, colX[1] - colX[0])
  cellLabel(colX[1] + 2, 'MASS')
  cellValue(colX[1] + 2, `${part.massKg.toFixed(2)} kg`, colX[2] - colX[1])
  cellLabel(colX[2] + 2, 'SCALE')
  cellValue(colX[2] + 2, scaleLabel(scale), colX[3] - colX[2])
  cellLabel(colX[3] + 2, 'SIZE')
  cellValue(colX[3] + 2, options.paperSize ?? 'A3', colX[4] - colX[3])
  cellLabel(colX[4] + 2, 'PART NO')
  cellValue(colX[4] + 2, part.id.toUpperCase(), colX[6] - colX[4], 2.2)

  text(colX[0] + 3, title.y + 39.4, 'DATE', 1.7, ` fill="${QUIET}"`)
  text(colX[0] + 3, title.y + 42.8, date, 2.8, ` fill="${INK}"`)
  text(colX[1] + 2, title.y + 39.4, 'DRAWN BY', 1.7, ` fill="${QUIET}"`)
  text(colX[1] + 2, title.y + 42.8, drawnBy, 2.4, ` fill="${INK}"`)
  text(colX[4] + 2, title.y + 39.4, 'SHEET', 1.7, ` fill="${QUIET}"`)
  text(colX[4] + 2, title.y + 42.8, '1 / 1', 2.4, ` fill="${INK}"`)
  if (options.projectName) {
    text(
      title.x + title.width - 4,
      title.y + title.height - 1.4,
      fitText(options.projectName, title.width - 8, 2.2),
      2.2,
      ` text-anchor="end" fill="${QUIET}"`,
    )
  }
  parts.push('</g>')

  // ── Third-angle projection symbol ────────────────────────────────────────
  const symbolX = title.x - 26
  const symbolY = title.y + title.height - 9
  parts.push(
    `<g fill="none" stroke="${INK}" stroke-width="0.3">`,
    `<circle cx="${round(symbolX)}" cy="${round(symbolY)}" r="4"/>`,
    `<circle cx="${round(symbolX)}" cy="${round(symbolY)}" r="2"/>`,
    `<path d="M ${round(symbolX + 8)} ${round(symbolY - 4)} L ${round(symbolX + 14)} ${round(symbolY - 2)} L ${round(symbolX + 14)} ${round(symbolY + 2)} L ${round(symbolX + 8)} ${round(symbolY + 4)} Z"/>`,
    `<line x1="${round(symbolX + 8)}" y1="${round(symbolY)}" x2="${round(symbolX + 14)}" y2="${round(symbolY)}" stroke-dasharray="1.5 1"/>`,
    '</g>',
    `<text x="${round(symbolX + 11)}" y="${round(symbolY + 8)}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="1.8" fill="${QUIET}">THIRD ANGLE</text>`,
  )

  parts.push('</svg>')
  return parts.join('\n')
}
