/**
 * The paper half of every engineering drawing Folio exports.
 *
 * A drawing sheet is the same object whatever the domain: a paper size, a border
 * with zone references, a title block in the lower right, a notes strip beside it,
 * and dimensions drawn as extension lines, arrows and millimetre-high text. Only
 * the geometry in the middle differs — one builder draws symbols and wires, another
 * three orthographic views, another a lattice of bars.
 *
 * Each of those used to write the paper out again from scratch, which is how a
 * sheet can end up with a title block two millimetres in a different place, or a
 * dimension arrow a different length, depending on which domain you happened to
 * draw. Here the paper is written once and every domain's builder composes geometry
 * onto it, so a Folio drawing reads as a Folio drawing whatever it is a drawing of.
 *
 * Units are millimetres of paper, with the origin at the top-left corner and Y
 * pointing down. Model units belong to the caller: `fitTo` resolves the mapping and
 * the builder never thinks about paper again.
 */

export type DrawingPaper = 'A4' | 'A3' | 'Letter'

export interface PaperSize {
  width: number
  height: number
}

/** Trimmed paper in millimetres, portrait dimensions as landscape sheet. */
const PAPER: Record<DrawingPaper, PaperSize> = {
  A4: { width: 297, height: 210 },
  A3: { width: 420, height: 297 },
  Letter: { width: 279.4, height: 215.9 },
}

export function paperSize(paper: DrawingPaper | undefined): PaperSize {
  return PAPER[paper ?? 'A4']
}

export interface SheetPalette {
  /** Sheet background; also the halo behind text so it reads over geometry. */
  paper: string
  frame: string
  text: string
  quiet: string
  ink: string
  hidden: string
}

const PRINT: SheetPalette = {
  paper: '#ffffff',
  frame: '#1f2937',
  text: '#111827',
  quiet: '#4b5563',
  ink: '#111827',
  hidden: '#6b7280',
}

const SCREEN: SheetPalette = {
  paper: '#0b1017',
  frame: '#9fb0c2',
  text: '#e5edf5',
  quiet: '#9fb0c2',
  ink: '#e5edf5',
  hidden: '#64748b',
}

export function paletteFor(mode: 'print' | 'screen' = 'print'): SheetPalette {
  return mode === 'screen' ? SCREEN : PRINT
}

/** The typeface family used for every string on a sheet. */
const FONT = 'Archivo, Arial, sans-serif'

export const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

export const round = (value: number): number => Math.round(value * 100) / 100

/** A dimension value: whole numbers stay whole, a fraction gets one decimal. */
export const formatNumber = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(1)

/**
 * Trim a string to a cell width using a rough advance width for Arial.
 *
 * A title block cell that overruns its rule is worse than an ellipsis: the sheet
 * stops looking like a drawing. 0.58 em per character is the normal-hyphenation
 * average for this face, which is close enough that a string that fits here fits
 * on paper without measuring glyphs.
 */
export function fitText(text: string, maxWidthMm: number, fontSizeMm: number): string {
  const maxChars = Math.max(3, Math.floor(maxWidthMm / (fontSizeMm * 0.58)))
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`
}

/**
 * Scales as paper millimetres per model millimetre, largest first, in the series
 * a drafter is allowed to write in the scale box (ISO 5455 preferred scales).
 */
export const STANDARD_SCALES = [5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01, 0.005, 0.002, 0.001]

export function scaleLabel(scale: number): string {
  return scale >= 1 ? `${scale}:1` : `1:${Math.round(1 / scale)}`
}

/**
 * The largest standard scale at which the drawing still fits the area.
 *
 * `needed` is given the scale and returns the paper extent the views require,
 * because the reserve for dimension lines and view captions is proportional to
 * the views. `null` means nothing in the preferred series fits, and the caller
 * must tell the user to pick a bigger sheet rather than inventing a scale.
 */
export function pickStandardScale(
  areaWidth: number,
  areaHeight: number,
  needed: (scale: number) => { width: number; height: number },
): number | null {
  return (
    STANDARD_SCALES.find((scale) => {
      const need = needed(scale)
      return need.width <= areaWidth && need.height <= areaHeight
    }) ?? null
  )
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export interface SheetOptions {
  /** Text in the title row of the block, and in the file's accessible name. */
  title: string
  /** The `<title>` suffix that says what kind of sheet this is. */
  subject: string
  paper?: DrawingPaper
  palette?: 'print' | 'screen'
  /** `id` of the `<title>` element; a page with two sheets needs two ids. */
  titleId?: string
  /** Revision letter, date and scale are read out of `fields` when drawn. */
  blockWidth?: number
  blockHeight?: number
}

export interface TitleBlockFields {
  title: string
  revision?: string
  date?: string
  scaleNote?: string
  /** The label printed in the SIZE cell; defaults to the paper name. */
  sizeLabel?: string
  sheet?: string
  projectName?: string
  /**
   * The lower band of label/value cells, left to right. Defaults to the ISO
   * habit of size, scale, date, sheet — a domain with other business (material
   * and mass, say) draws its own block instead of squeezing it in here.
   */
  cells?: Array<{ label: string; value: string }>
}

/**
 * One sheet, in the middle of being written.
 *
 * `push` appends markup in paint order, so the chrome goes down first and the
 * geometry over it. The sheet does not know what any of its content means, which
 * is why it can serve a schematic, a bracket and a truss without a special case.
 */
export interface Sheet {
  paper: DrawingPaper
  size: PaperSize
  palette: SheetPalette
  /** The printed border. */
  frame: Box
  /** The inner border that zone ticks sit against. */
  zoneFrame: Box
  /** Where geometry may go: inside the border, above the title block. */
  content: Box
  block: Box
  push(...lines: string[]): void
  /** Border, zone ticks and the A–D / 1–3 letters around the edge. */
  drawChrome(): void
  /**
   * Fit a model box into the content area, centred, at the largest scale that
   * keeps it inside. `padding` is paper millimetres of clear edge.
   */
  fitTo(model: Box, padding?: number): ModelFit
  /** The strip of notes immediately left of, and above, the title block. */
  drawNotes(lines: readonly string[]): void
  drawTitleBlock(fields: TitleBlockFields): void
  /** The finished document, XML declaration included. */
  toString(): string
}

export interface ModelFit {
  /** Paper millimetres per model unit. */
  scale: number
  offsetX: number
  offsetY: number
  toPaper(x: number, y: number): { x: number; y: number }
  /**
   * A stroke width, in model units, that prints at `mm` of paper whatever the
   * fit scale turned out to be. Print line weights are specified in millimetres
   * (ISO 128), never as a fraction of the model.
   */
  stroke(mm: number): number
  /** Open and close a group that puts model-space geometry on the sheet. */
  open(): string
  close(): string
}

/**
 * Fit a model box into any area of paper, centred, at the largest scale that
 * keeps it inside.
 *
 * A sheet offers its whole content area to `Sheet.fitTo`, but a framing drawing
 * with a schedule on it has to fit the elevation into a band of that area, so the
 * arithmetic is exposed for both.
 */
export function fitBox(model: Box, area: Box, padding = 0): ModelFit {
  const scale = Math.max(
    0.0001,
    Math.min(
      Math.max(area.width - padding * 2, 1e-6) / Math.max(model.width, 1e-6),
      Math.max(area.height - padding * 2, 1e-6) / Math.max(model.height, 1e-6),
    ),
  )
  return fitBoxAt(model, area, scale, padding)
}

/**
 * The same centring as `fitBox`, at a scale the caller has already chosen.
 *
 * A drawing states its scale in the title block, so the scale printed there must
 * be the scale the geometry was drawn at — not the largest fit, which is generally
 * some odd number no drafter would write down.
 */
export function fitBoxAt(model: Box, area: Box, scale: number, padding = 0): ModelFit {
  const width = Math.max(model.width, 1e-6)
  const height = Math.max(model.height, 1e-6)
  const box = {
    width: Math.max(area.width - padding * 2, 1e-6),
    height: Math.max(area.height - padding * 2, 1e-6),
  }
  const offsetX = area.x + padding + (box.width - width * scale) / 2 - model.x * scale
  const offsetY = area.y + padding + (box.height - height * scale) / 2 - model.y * scale
  return {
    scale,
    offsetX,
    offsetY,
    toPaper: (x, y) => ({ x: offsetX + x * scale, y: offsetY + y * scale }),
    stroke: (mm) => round(mm / scale),
    open: () =>
      `<g transform="translate(${round(offsetX)} ${round(offsetY)}) scale(${round(scale * 100000) / 100000})">`,
    close: () => '</g>',
  }
}

export function openSheet(options: SheetOptions): Sheet {
  const paper = options.paper ?? 'A4'
  const size = paperSize(paper)
  const palette = paletteFor(options.palette)
  const parts: string[] = []

  const margin = 10
  const frame = { x: margin, y: margin, width: size.width - margin * 2, height: size.height - margin * 2 }
  const blockWidth = options.blockWidth ?? Math.min(150, frame.width * 0.52)
  const blockHeight = options.blockHeight ?? 36
  const block = {
    x: frame.x + frame.width - 4 - blockWidth,
    y: frame.y + frame.height - 4 - blockHeight,
    width: blockWidth,
    height: blockHeight,
  }
  // Nothing may overprint the block or the notes, so the drawing area stops above it.
  const content = {
    x: frame.x + 8,
    y: frame.y + 8,
    width: frame.width - 16,
    height: block.y - frame.y - 12,
  }

  parts.push('<?xml version="1.0" encoding="UTF-8"?>')
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}mm" height="${size.height}mm" viewBox="0 0 ${size.width} ${size.height}" role="img" aria-labelledby="${options.titleId ?? 'sheet-title'}">`,
  )
  parts.push(
    `<title id="${options.titleId ?? 'sheet-title'}">${escapeXml(options.title)} — ${escapeXml(options.subject)}</title>`,
  )
  parts.push(`<rect width="${size.width}" height="${size.height}" fill="${palette.paper}"/>`)

  const sheet: Sheet = {
    paper,
    size,
    palette,
    frame,
    zoneFrame: { x: frame.x + 5, y: frame.y + 5, width: frame.width - 10, height: frame.height - 10 },
    content,
    block,
    push(...lines: string[]) {
      parts.push(...lines)
    },
    drawChrome() {
      parts.push(`<g fill="none" stroke="${palette.frame}" stroke-width="0.7">`)
      parts.push(
        `<rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}"/>`,
        `<rect x="${frame.x + 5}" y="${frame.y + 5}" width="${frame.width - 10}" height="${frame.height - 10}" stroke-width="0.3"/>`,
      )
      for (let index = 1; index <= 3; index += 1) {
        const x = frame.x + (frame.width * index) / 4
        parts.push(
          `<line x1="${round(x)}" y1="${frame.y}" x2="${round(x)}" y2="${frame.y + 5}"/>`,
          `<line x1="${round(x)}" y1="${frame.y + frame.height - 5}" x2="${round(x)}" y2="${frame.y + frame.height}"/>`,
        )
      }
      for (let index = 1; index <= 2; index += 1) {
        const y = frame.y + (frame.height * index) / 3
        parts.push(
          `<line x1="${frame.x}" y1="${round(y)}" x2="${frame.x + 5}" y2="${round(y)}"/>`,
          `<line x1="${frame.x + frame.width - 5}" y1="${round(y)}" x2="${frame.x + frame.width}" y2="${round(y)}"/>`,
        )
      }
      parts.push('</g>')
      parts.push(`<g fill="${palette.quiet}" font-family="${FONT}" font-size="2.8" text-anchor="middle">`)
      ;['A', 'B', 'C', 'D'].forEach((zone, index) => {
        parts.push(
          `<text x="${round(frame.x + (frame.width * (index + 0.5)) / 4)}" y="${round(frame.y + 3.7)}">${zone}</text>`,
        )
      })
      ;['1', '2', '3'].forEach((zone, index) => {
        parts.push(
          `<text x="${round(frame.x + 2.6)}" y="${round(frame.y + (frame.height * (index + 0.5)) / 3 + 1)}">${zone}</text>`,
        )
      })
      parts.push('</g>')
    },
    fitTo(model, padding = 0) {
      return fitBox(model, content, padding)
    },
    drawNotes(lines) {
      if (lines.length === 0) return
      const noteX = frame.x + 8
      const maxWidth = block.x - noteX - 12
      const noteTop = block.y + 10
      parts.push(
        `<g font-family="${FONT}" font-size="2.4" fill="${palette.quiet}">`,
        `<text x="${noteX}" y="${round(noteTop)}" font-weight="700" font-size="2.2" letter-spacing="0.3">NOTES</text>`,
      )
      lines.forEach((note, index) => {
        parts.push(
          `<text x="${noteX}" y="${round(noteTop + 5.4 + index * 4.2)}">${escapeXml(fitText(note, maxWidth, 2.4))}</text>`,
        )
      })
      parts.push('</g>')
    },
    drawTitleBlock(fields) {
      const cells = fields.cells ?? [
        { label: 'SIZE', value: fields.sizeLabel ?? sheet.paper },
        { label: 'SCALE', value: fields.scaleNote ?? 'NTS' },
        { label: 'DATE', value: fields.date ?? new Date().toISOString().slice(0, 10) },
        { label: 'SHEET', value: fields.sheet ?? '1/1' },
      ]
      const title = fields.title
      const revision = fields.revision ?? 'A'
      const column = block.width / cells.length
      parts.push(
        `<g fill="none" stroke="${palette.frame}" stroke-width="0.35">`,
        `<rect x="${round(block.x)}" y="${round(block.y)}" width="${round(block.width)}" height="${round(block.height)}" fill="${palette.paper}"/>`,
        `<line x1="${round(block.x)}" y1="${round(block.y + 9)}" x2="${round(block.x + block.width)}" y2="${round(block.y + 9)}"/>`,
        `<line x1="${round(block.x)}" y1="${round(block.y + 24)}" x2="${round(block.x + block.width)}" y2="${round(block.y + 24)}"/>`,
      )
      for (let index = 1; index < cells.length; index += 1) {
        const x = block.x + column * index
        parts.push(
          `<line x1="${round(x)}" y1="${round(block.y + 24)}" x2="${round(x)}" y2="${round(block.y + block.height)}"/>`,
        )
      }
      parts.push('</g>')

      parts.push(`<g font-family="${FONT}">`)
      parts.push(
        `<text x="${round(block.x + 4)}" y="${round(block.y + 6.6)}" font-size="5.2" font-weight="700" fill="${palette.text}" letter-spacing="0.6">FOLIO</text>`,
        `<text x="${round(block.x + block.width - 4)}" y="${round(block.y + 6.4)}" text-anchor="end" font-size="2.5" fill="${palette.quiet}">REV ${escapeXml(revision)}</text>`,
        `<text x="${round(block.x + 4)}" y="${round(block.y + 13)}" font-size="1.7" fill="${palette.quiet}" letter-spacing="0.3">TITLE</text>`,
        `<text x="${round(block.x + 4)}" y="${round(block.y + 20.4)}" font-size="4" font-weight="700" fill="${palette.text}">${escapeXml(fitText(title, block.width - 8, 4))}</text>`,
      )
      cells.forEach((cell, index) => {
        const x = block.x + column * index + 3
        parts.push(
          `<text x="${round(x)}" y="${round(block.y + 27.6)}" font-size="1.6" fill="${palette.quiet}" letter-spacing="0.3">${escapeXml(cell.label)}</text>`,
          `<text x="${round(x)}" y="${round(block.y + 32.4)}" font-size="2.6" fill="${palette.text}">${escapeXml(fitText(cell.value, column - 6, 2.6))}</text>`,
        )
      })
      if (fields.projectName && fields.projectName !== title) {
        parts.push(
          `<text x="${round(block.x + block.width - 4)}" y="${round(block.y + 13)}" text-anchor="end" font-size="2.1" fill="${palette.quiet}">${escapeXml(fitText(fields.projectName, block.width * 0.6, 2.1))}</text>`,
        )
      }
      parts.push('</g>')
    },
    toString() {
      // Not `parts.push('</svg>')`: a sheet read twice must close exactly once.
      return [...parts, '</svg>'].join('\n')
    },
  }
  return sheet
}

/* ── Dimensioning ──────────────────────────────────────────────────────────── */

export interface Point {
  x: number
  y: number
}

/**
 * The ink a dimension is drawn with, in paper millimetres.
 *
 * A dimension line is thin (0.18 mm), its text is 3 mm high, and the halo behind
 * the text is the paper colour, so a number crossing a leader stays legible. The
 * 2.2 mm arrow is the closed ISO wedge. Every domain that measures anything on a
 * sheet uses these, so a line does not become thicker in whichever module was
 * written last.
 */
export interface DimensionInk {
  /** A filled arrowhead with its butt at `at`, pointing along `angle` in degrees. */
  arrow(at: Point, angle: number): string
  /** A thin witness (extension) line from the feature out to the dimension line. */
  witness(from: Point, to: Point): string
  /** A thin dimension line with arrowheads at both ends. */
  run(from: Point, to: Point): string
  /** Dimension text, centred on the point; `rotate` tilts it for a vertical run. */
  text(at: Point, value: string, options?: { rotate?: number; size?: number; quiet?: boolean }): string
}

export function dimensionInk(palette: SheetPalette): DimensionInk {
  const arrowLength = 2.2
  const arrowHalf = 0.8
  const ink: DimensionInk = {
    arrow(at, angle) {
      const radians = (angle * Math.PI) / 180
      const cos = Math.cos(radians)
      const sin = Math.sin(radians)
      const tip = { x: at.x + cos * arrowLength, y: at.y + sin * arrowLength }
      const left = { x: at.x - sin * arrowHalf, y: at.y + cos * arrowHalf }
      const right = { x: at.x + sin * arrowHalf, y: at.y - cos * arrowHalf }
      return `<polygon points="${round(at.x)},${round(at.y)} ${round(tip.x)},${round(tip.y)} ${round(left.x)},${round(left.y)} ${round(right.x)},${round(right.y)}" fill="${palette.ink}"/>`
    },
    witness(from, to) {
      return `<line x1="${round(from.x)}" y1="${round(from.y)}" x2="${round(to.x)}" y2="${round(to.y)}" stroke="${palette.ink}" stroke-width="0.14"/>`
    },
    run(from, to) {
      const horizontal = Math.abs(to.y - from.y) < Math.abs(to.x - from.x)
      return [
        `<line x1="${round(from.x)}" y1="${round(from.y)}" x2="${round(to.x)}" y2="${round(to.y)}" stroke="${palette.ink}" stroke-width="0.18"/>`,
        horizontal
          ? `${ink.arrow(from, 0)}${ink.arrow(to, 180)}`
          : `${ink.arrow(from, 90)}${ink.arrow(to, -90)}`,
      ].join('')
    },
    text(at, value, options) {
      const rotate = options?.rotate
      const size = options?.size ?? 3
      return `<text x="${round(at.x)}" y="${round(at.y)}" font-size="${size}" text-anchor="middle" dominant-baseline="central" fill="${options?.quiet ? palette.quiet : palette.ink}" paint-order="stroke" stroke="${palette.paper}" stroke-width="0.9"${rotate ? ` transform="rotate(${rotate} ${round(at.x)} ${round(at.y)})"` : ''}>${escapeXml(value)}</text>`
    },
  }
  return ink
}

/**
 * A linear dimension across one feature, in paper millimetres.
 *
 * This is the piece of drafting every domain needs and each used to hand-place:
 * witness lines that start 1 mm clear of the feature and overshoot the dimension
 * line by 2 mm, arrowheads inboard, the value 2.6 mm off the line on the reading
 * side, and an optional caption on the far side. A positive `offset` puts the line
 * below (or right of) the feature, a negative one above (or left of) it, which is
 * how a drawing keeps its dimensions outside the views without colliding.
 */
export function linearDimension(options: {
  from: Point
  to: Point
  /** Distance from the feature to the dimension line, in millimetres. */
  offset: number
  text: string
  caption?: string
  palette: SheetPalette
}): string[] {
  const { from, to, offset, palette } = options
  const ink = dimensionInk(palette)
  if (Math.abs(to.y - from.y) < Math.abs(to.x - from.x)) {
    const y = offset >= 0 ? Math.max(from.y, to.y) + offset : Math.min(from.y, to.y) + offset
    const mid = { x: (from.x + to.x) / 2, y }
    return [
      ink.witness({ x: from.x, y: from.y + (offset >= 0 ? 1 : -1) }, { x: from.x, y: y + (offset >= 0 ? 2 : -2) }),
      ink.witness({ x: to.x, y: to.y + (offset >= 0 ? 1 : -1) }, { x: to.x, y: y + (offset >= 0 ? 2 : -2) }),
      ink.run({ x: from.x, y }, { x: to.x, y }),
      ink.text({ x: mid.x, y: y - 2.6 }, options.text),
      ...(options.caption
        ? [ink.text({ x: mid.x, y: y + 3.4 }, options.caption, { size: 2.2, quiet: true })]
        : []),
    ]
  }
  const x = offset >= 0 ? Math.max(from.x, to.x) + offset : Math.min(from.x, to.x) + offset
  return [
    ink.witness({ x: from.x + (offset >= 0 ? 1 : -1), y: from.y }, { x: x + (offset >= 0 ? 2 : -2), y: from.y }),
    ink.witness({ x: to.x + (offset >= 0 ? 1 : -1), y: to.y }, { x: x + (offset >= 0 ? 2 : -2), y: to.y }),
    ink.run({ x, y: from.y }, { x, y: to.y }),
    ink.text({ x: x + (offset >= 0 ? 2.6 : -2.6), y: (from.y + to.y) / 2 }, options.text, { rotate: -90 }),
    ...(options.caption
      ? [ink.text({ x: x + (offset >= 0 ? -3.4 : 3.4), y: (from.y + to.y) / 2 }, options.caption, { size: 2.2, quiet: true, rotate: -90 })]
      : []),
  ]
}
