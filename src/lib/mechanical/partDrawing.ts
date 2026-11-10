/**
 * Orthographic engineering drawing for a rectangular machine part.
 *
 * Third-angle projection: front view with the top view above it and the right
 * side view beside it, overall dimensions in millimetres, a pictorial view,
 * a title block and manufacturing notes. Dimensions are nominal model values —
 * the drawing never claims tolerances or finishes the model does not carry.
 *
 * The paper, chrome, notes and dimension ink are the shared sheet
 * (`../drawing/sheet`); what is specific to a machined part is the three views,
 * the standard-scale choice and the block's material, mass and part-number cells.
 */
import {
  escapeXml,
  fitText,
  formatNumber as fmt,
  linearDimension,
  openSheet,
  paletteFor,
  pickStandardScale,
  round,
  scaleLabel,
  type DrawingPaper,
} from '../drawing/sheet'

export type { DrawingPaper } from '../drawing/sheet'

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

const PICTORIAL_FRONT = '#f8fafc'
const PICTORIAL_TOP = '#e2e8f0'
const PICTORIAL_SIDE = '#cbd5e1'

const FONT = 'font-family="Inter, Arial, sans-serif"'

export function buildPartDrawing(
  part: PartDrawingInput,
  options: PartDrawingOptions = {},
): string {
  const paper = options.paperSize ?? 'A3'
  const L = part.dimensions.length * 1000
  const W = part.dimensions.width * 1000
  const H = part.dimensions.height * 1000
  if (!(L > 0 && W > 0 && H > 0)) {
    throw new Error('Part dimensions must be positive before a drawing can be produced.')
  }

  const palette = paletteFor('print')
  const sheet = openSheet({
    title: part.name,
    subject: 'mechanical part drawing',
    paper,
    titleId: 'part-drawing-title',
    // A part block states material, mass, scale, size, part number, date, drawn
    // by and sheet number, so it needs the taller two-row block.
    blockWidth: paper === 'A3' ? 150 : 132,
    blockHeight: 44,
  })
  const area = sheet.content
  const block = sheet.block

  // Overall dimensions sit outside the views, so reserve room on every side.
  const requiredAt = (scale: number) => ({
    width: L * scale + 18 + W * scale + 32,
    height: W * scale + 18 + H * scale + 30,
  })
  const scale = pickStandardScale(area.width, area.height, requiredAt)
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

  // ── Frame and zone references ────────────────────────────────────────────
  sheet.drawChrome()

  // ── Views ────────────────────────────────────────────────────────────────
  const view = (x: number, y: number, width: number, height: number) =>
    `<rect x="${round(x)}" y="${round(y)}" width="${round(width)}" height="${round(height)}"/>`
  sheet.push(
    `<g fill="none" stroke="${palette.ink}" stroke-width="0.45" stroke-linejoin="round">`,
    view(frontX, frontY, front.width, front.height),
    view(frontX, topY, top.width, top.height),
    view(sideX, frontY, side.width, side.height),
    '</g>',
  )

  // Centre lines (chain-dashed), extending slightly past each view.
  const centre = (cx: number, cy: number, halfWidth: number, halfHeight: number) => [
    `<line x1="${round(cx - halfWidth - 3)}" y1="${round(cy)}" x2="${round(cx + halfWidth + 3)}" y2="${round(cy)}"/>`,
    `<line x1="${round(cx)}" y1="${round(cy - halfHeight - 3)}" x2="${round(cx)}" y2="${round(cy + halfHeight + 3)}"/>`,
  ]
  sheet.push(
    `<g fill="none" stroke="${palette.hidden}" stroke-width="0.18" stroke-dasharray="4 1.2 0.8 1.2">`,
    ...centre(frontX + front.width / 2, frontY + front.height / 2, front.width / 2, front.height / 2),
    ...centre(frontX + top.width / 2, topY + top.height / 2, top.width / 2, top.height / 2),
    ...centre(sideX + side.width / 2, frontY + side.height / 2, side.width / 2, side.height / 2),
    '</g>',
  )

  // View captions
  sheet.push(
    `<g fill="${palette.quiet}" ${FONT} font-size="2.8" text-anchor="middle" letter-spacing="0.4">`,
    `<text x="${round(frontX + front.width / 2)}" y="${round(frontY + front.height + 7)}">FRONT VIEW</text>`,
    `<text x="${round(frontX + top.width / 2)}" y="${round(topY - 3.4)}">TOP VIEW</text>`,
    `<text x="${round(sideX + side.width / 2)}" y="${round(frontY + side.height + 7)}">RIGHT SIDE</text>`,
    '</g>',
  )

  // ── Dimensions ───────────────────────────────────────────────────────────
  sheet.push(
    `<g fill="none" stroke="${palette.ink}" ${FONT}>`,
    ...linearDimension({
      from: { x: frontX, y: frontY + front.height },
      to: { x: frontX + front.width, y: frontY + front.height },
      offset: 13,
      text: fmt(L),
      caption: 'OVERALL LENGTH',
      palette,
    }),
    ...linearDimension({
      from: { x: frontX, y: frontY },
      to: { x: frontX, y: frontY + front.height },
      offset: -13,
      text: fmt(H),
      palette,
    }),
    ...linearDimension({
      from: { x: frontX + top.width, y: topY },
      to: { x: frontX + top.width, y: topY + top.height },
      offset: 13,
      text: fmt(W),
      palette,
    }),
    '</g>',
  )

  // ── Pictorial view ──────────────────────────────────────────────────────
  // Placed above the title block, clear of the notes. The projection is a true
  // cabinet-style axon; it is never dimensioned or used for measurement.
  const isoScale = scale * 0.9
  const isoHorizontal = (L + W * 0.5) * isoScale
  const isoVertical = (H + W * 0.35) * isoScale
  const isoReadable = Math.min(H, W) * scale >= 2.5
  const isoX = area.x + area.width - isoHorizontal - 8
  const isoBase = block.y - 12
  const viewsBottom = Math.max(frontY + front.height, topY + top.height, frontY + side.height)
  if (isoReadable && isoBase - isoVertical > viewsBottom + 8) {
    const p = (x: number, y: number, z: number) => {
      // Cabinet axon: depth recovers at half true size on the 45° miter.
      const px = isoX + (x - z * 0.5) * isoScale
      const py = isoBase - (y + z * 0.35) * isoScale
      return `${round(px)},${round(py)}`
    }
    const face = (points: string, fill: string) =>
      `<polygon points="${points}" fill="${fill}" stroke="${palette.ink}" stroke-width="0.35" stroke-linejoin="round"/>`
    sheet.push(
      face(`${p(0, H, 0)} ${p(L, H, 0)} ${p(L, H, W)} ${p(0, H, W)}`, PICTORIAL_TOP),
      face(`${p(L, 0, 0)} ${p(L, H, 0)} ${p(L, H, W)} ${p(L, 0, W)}`, PICTORIAL_SIDE),
      face(`${p(0, 0, 0)} ${p(L, 0, 0)} ${p(L, H, 0)} ${p(0, H, 0)}`, PICTORIAL_FRONT),
      `<text x="${round(isoX)}" y="${round(isoBase + 8)}" ${FONT} font-size="2.6" fill="${palette.quiet}" letter-spacing="0.3">ISOMETRIC VIEW — NOT TO SCALE</text>`,
    )
  }

  // ── Notes ────────────────────────────────────────────────────────────────
  sheet.drawNotes([
    'ALL DIMENSIONS IN MILLIMETRES',
    `GENERAL TOLERANCES ${options.tolerance ?? '±0.2'} UNLESS NOTED`,
    `MATERIAL: ${part.materialName.toUpperCase()}`,
    `MASS: ${part.massKg.toFixed(2)} kg`,
    ...(options.finish ? [`FINISH: ${options.finish.toUpperCase()}`] : []),
    'DO NOT SCALE DRAWING',
    ...(options.notes ?? []),
  ])

  // ── Title block ──────────────────────────────────────────────────────────
  // A part block carries what a shop floor needs to cut the thing, so it is not
  // the generic size/scale/date/sheet row: material, mass and part number have
  // to be read off the sheet, not looked up in the app.
  const date = options.date ?? new Date().toISOString().slice(0, 10)
  const revision = options.revision ?? 'A'
  const drawnBy = options.drawnBy ?? 'FOLIO'
  const cols = [0.5, 0.14, 0.11, 0.1, 0.075, 0.075]
  const colX: number[] = [block.x]
  for (const fraction of cols) {
    colX.push(colX[colX.length - 1] + block.width * fraction)
  }

  const rule = (x1: number, y1: number, x2: number, y2: number) =>
    `<line x1="${round(x1)}" y1="${round(y1)}" x2="${round(x2)}" y2="${round(y2)}"/>`
  sheet.push(
    `<g fill="none" stroke="${palette.frame}" stroke-width="0.35">`,
    `<rect x="${round(block.x)}" y="${round(block.y)}" width="${round(block.width)}" height="${round(block.height)}" fill="${palette.paper}"/>`,
    rule(block.x, block.y + 10, block.x + block.width, block.y + 10),
    rule(block.x, block.y + 26, block.x + block.width, block.y + 26),
    rule(block.x, block.y + 36, block.x + block.width, block.y + 36),
    rule(colX[1], block.y + 26, colX[1], block.y + block.height),
    rule(colX[2], block.y + 26, colX[2], block.y + 36),
    rule(colX[3], block.y + 26, colX[3], block.y + 36),
    rule(colX[4], block.y + 26, colX[4], block.y + block.height),
    '</g>',
  )

  const text = (x: number, y: number, content: string, size: number, extra = '') =>
    `<text x="${round(x)}" y="${round(y)}" font-size="${size}"${extra}>${escapeXml(content)}</text>`
  const cellLabel = (x: number, label: string) =>
    text(x, block.y + 29.4, label, 1.7, ` fill="${palette.quiet}" letter-spacing="0.3"`)
  const cellValue = (x: number, value: string, width: number, size = 2.8) =>
    text(x, block.y + 34, fitText(value, width - 4, size), size, ` fill="${palette.ink}"`)

  sheet.push(`<g ${FONT}>`)
  sheet.push(
    text(block.x + 4, block.y + 7.2, 'FOLIO', 6, ` font-weight="700" fill="${palette.ink}" letter-spacing="0.8"`),
    text(block.x + block.width - 4, block.y + 6.6, `REV ${revision}`, 2.6, ` text-anchor="end" fill="${palette.ink}"`),
    text(block.x + 4, block.y + 14.6, 'PART TITLE', 1.8, ` fill="${palette.quiet}" letter-spacing="0.4"`),
    text(
      block.x + 4,
      block.y + 22.4,
      fitText(part.name, block.width - 8, 4.4),
      4.4,
      ` font-weight="700" fill="${palette.ink}"`,
    ),
    cellLabel(colX[0] + 3, 'MATERIAL'),
    cellValue(colX[0] + 3, part.materialName, colX[1] - colX[0]),
    cellLabel(colX[1] + 2, 'MASS'),
    cellValue(colX[1] + 2, `${part.massKg.toFixed(2)} kg`, colX[2] - colX[1]),
    cellLabel(colX[2] + 2, 'SCALE'),
    cellValue(colX[2] + 2, scaleLabel(scale), colX[3] - colX[2]),
    cellLabel(colX[3] + 2, 'SIZE'),
    cellValue(colX[3] + 2, options.paperSize ?? 'A3', colX[4] - colX[3]),
    cellLabel(colX[4] + 2, 'PART NO'),
    cellValue(colX[4] + 2, part.id.toUpperCase(), colX[6] - colX[4], 2.2),
    text(colX[0] + 3, block.y + 39.4, 'DATE', 1.7, ` fill="${palette.quiet}"`),
    text(colX[0] + 3, block.y + 42.8, date, 2.8, ` fill="${palette.ink}"`),
    text(colX[1] + 2, block.y + 39.4, 'DRAWN BY', 1.7, ` fill="${palette.quiet}"`),
    text(colX[1] + 2, block.y + 42.8, drawnBy, 2.4, ` fill="${palette.ink}"`),
    text(colX[4] + 2, block.y + 39.4, 'SHEET', 1.7, ` fill="${palette.quiet}"`),
    text(colX[4] + 2, block.y + 42.8, '1 / 1', 2.4, ` fill="${palette.ink}"`),
    ...(options.projectName
      ? [
          text(
            block.x + block.width - 4,
            block.y + block.height - 1.4,
            fitText(options.projectName, block.width - 8, 2.2),
            2.2,
            ` text-anchor="end" fill="${palette.quiet}"`,
          ),
        ]
      : []),
    '</g>',
  )

  // ── Third-angle projection symbol ────────────────────────────────────────
  const symbolX = block.x - 26
  const symbolY = block.y + block.height - 9
  sheet.push(
    `<g fill="none" stroke="${palette.ink}" stroke-width="0.3">`,
    `<circle cx="${round(symbolX)}" cy="${round(symbolY)}" r="4"/>`,
    `<circle cx="${round(symbolX)}" cy="${round(symbolY)}" r="2"/>`,
    `<path d="M ${round(symbolX + 8)} ${round(symbolY - 4)} L ${round(symbolX + 14)} ${round(symbolY - 2)} L ${round(symbolX + 14)} ${round(symbolY + 2)} L ${round(symbolX + 8)} ${round(symbolY + 4)} Z"/>`,
    `<line x1="${round(symbolX + 8)}" y1="${round(symbolY)}" x2="${round(symbolX + 14)}" y2="${round(symbolY)}" stroke-dasharray="1.5 1"/>`,
    '</g>',
    `<text x="${round(symbolX + 11)}" y="${round(symbolY + 8)}" text-anchor="middle" ${FONT} font-size="1.8" fill="${palette.quiet}">THIRD ANGLE</text>`,
  )

  return sheet.toString()
}
