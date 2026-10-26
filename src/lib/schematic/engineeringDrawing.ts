/**
 * Engineering-drawing SVG for a schematic sheet.
 *
 * This is a real vector sheet — paper-sized A4/A3/Letter, sheet border, zone
 * references, title block, symbols, pins, wires and junction dots — not a
 * rasterised canvas screenshot. Geometry comes from `drawingLayout`, the same
 * module the interactive canvas uses, so the exported sheet matches what the
 * user sees. Schematic content is not to scale (NTS); it is fitted to the
 * drawing area and printed at fixed millimetre line and text heights.
 */
import type { CanvasComponent, CanvasWire } from '../../stores/useProjectStore'
import {
  componentBounds,
  connectedPinKeys,
  drawingExtents,
  layoutComponentLabels,
  pinWorldCoord,
  wireJunctions,
} from './drawingLayout'

export type DrawingPaper = 'A4' | 'A3' | 'Letter'

export interface SchematicDrawingOptions {
  title: string
  projectName?: string
  revision?: string
  /** ISO date (YYYY-MM-DD). Defaults to today. */
  date?: string
  paperSize?: DrawingPaper
  /** Revision note drawn in the title block's title row, e.g. "NTS". */
  scale?: string
  /** Extra lines in the notes strip beside the title block. */
  notes?: string[]
  /** Ink palette; `print` is black-on-white, `screen` follows the dark UI. */
  palette?: 'print' | 'screen'
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

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

const round = (value: number): number => Math.round(value * 100) / 100

/** Trim a string to a cell width using a rough advance width for Arial. */
function fitText(text: string, maxWidthMm: number, fontSizeMm: number): string {
  const maxChars = Math.max(3, Math.floor(maxWidthMm / (fontSizeMm * 0.58)))
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`
}

const paletteFor = (mode: 'print' | 'screen') =>
  mode === 'screen'
    ? {
        paper: '#0b1017',
        frame: '#9fb0c2',
        text: '#e5edf5',
        quiet: '#9fb0c2',
        symbol: '#e5edf5',
        wire: '#34d399',
        pin: '#f59e0b',
        junction: '#34d399',
        halo: '#0b1017',
      }
    : {
        paper: '#ffffff',
        frame: '#1f2937',
        text: '#111827',
        quiet: '#4b5563',
        symbol: '#111827',
        // Printed schematics are monochrome ink; colour is reserved for screen.
        wire: '#111827',
        pin: '#4b5563',
        junction: '#111827',
        halo: '#ffffff',
      }

export function buildSchematicDrawing(
  components: CanvasComponent[],
  wires: CanvasWire[],
  options: SchematicDrawingOptions,
): string {
  const labels = layoutComponentLabels(components, wires)
  const extents = drawingExtents(components, wires, labels)
  // On paper the title block lives outside the drawing area, so the model
  // frame only needs symmetric clearance around the actual content. Reusing
  // the canvas sheet frame (which reserves a bottom band) would push the
  // circuit into the top half of the page.
  const modelWidth = Math.max(240, extents.maxX - extents.minX + 60)
  const modelHeight = Math.max(150, extents.maxY - extents.minY + 60)
  const modelFrame = {
    x: (extents.minX + extents.maxX) / 2 - modelWidth / 2,
    y: (extents.minY + extents.maxY) / 2 - modelHeight / 2,
    width: modelWidth,
    height: modelHeight,
  }
  const paper = PAPER[options.paperSize ?? 'A4']
  const date = options.date ?? new Date().toISOString().slice(0, 10)
  const revision = options.revision ?? 'A'
  const scaleNote = options.scale ?? 'NTS'
  const palette = paletteFor(options.palette ?? 'print')
  const title = options.title || 'Untitled schematic'

  const margin = 10
  const frame = {
    x: margin,
    y: margin,
    width: paper.width - margin * 2,
    height: paper.height - margin * 2,
  }
  const blockWidth = Math.min(150, frame.width * 0.52)
  const blockHeight = 36
  const block = {
    x: frame.x + frame.width - 4 - blockWidth,
    y: frame.y + frame.height - 4 - blockHeight,
    width: blockWidth,
    height: blockHeight,
  }

  // Keep all drawing content above the title block; that band is reserved for
  // the block and the notes, so nothing can overprint either.
  const content = {
    x: frame.x + 8,
    y: frame.y + 8,
    width: frame.width - 16,
    height: block.y - frame.y - 12,
  }
  const scale = Math.max(
    0.0001,
    Math.min(content.width / modelFrame.width, content.height / modelFrame.height),
  )
  const offsetX = content.x + (content.width - modelFrame.width * scale) / 2 - modelFrame.x * scale
  const offsetY = content.y + (content.height - modelFrame.height * scale) / 2 - modelFrame.y * scale
  const toPaper = (x: number, y: number) => ({
    x: offsetX + x * scale,
    y: offsetY + y * scale,
  })

  // Print line weights are set in millimetres and divided by the fit scale so
  // they stay constant on paper regardless of how small the model is.
  const stroke = (mm: number) => round(mm / scale)

  const parts: string[] = []
  parts.push('<?xml version="1.0" encoding="UTF-8"?>')
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${paper.width}mm" height="${paper.height}mm" viewBox="0 0 ${paper.width} ${paper.height}" role="img" aria-labelledby="drawing-title">`,
  )
  parts.push(`<title id="drawing-title">${escapeXml(title)} — schematic drawing</title>`)
  parts.push(`<rect width="${paper.width}" height="${paper.height}" fill="${palette.paper}"/>`)

  // ── Sheet border and zones ────────────────────────────────────────────────
  parts.push(
    `<g fill="none" stroke="${palette.frame}" stroke-width="0.7">`,
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
  parts.push(
    `<g fill="${palette.quiet}" font-family="Inter, Arial, sans-serif" font-size="2.8" text-anchor="middle">`,
  )
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

  // ── Model-space geometry (wires, junctions, symbols, pins) ───────────────
  const connected = connectedPinKeys(wires)
  const junctions = wireJunctions(wires)

  parts.push(`<g transform="translate(${round(offsetX)} ${round(offsetY)}) scale(${round(scale * 100000) / 100000})">`)

  parts.push(
    `<g fill="none" stroke="${palette.wire}" stroke-width="${stroke(0.22)}" stroke-linecap="round" stroke-linejoin="round">`,
  )
  for (const wire of wires) {
    if (wire.points.length < 2) continue
    const points = wire.points
      .map((point) => `${round(point.x)},${round(point.y)}`)
      .join(' ')
    parts.push(`<polyline points="${points}"/>`)
  }
  parts.push('</g>')

  parts.push(`<g fill="${palette.junction}">`)
  for (const dot of junctions) {
    parts.push(
      `<circle cx="${round(dot.x)}" cy="${round(dot.y)}" r="${stroke(0.55)}" data-role="junction"/>`,
    )
  }
  parts.push('</g>')

  parts.push(
    `<g fill="none" stroke="${palette.symbol}" stroke-width="${stroke(0.32)}" stroke-linecap="round" stroke-linejoin="round">`,
  )
  for (const comp of components) {
    const transform =
      comp.rotation === 0
        ? `translate(${round(comp.x)} ${round(comp.y)})`
        : `translate(${round(comp.x)} ${round(comp.y)}) rotate(${comp.rotation})`
    parts.push(`<g transform="${transform}">`)
    for (const path of comp.component.symbol_data.paths ?? []) {
      parts.push(`<path d="${escapeXml(path)}"/>`)
    }
    parts.push('</g>')
  }
  parts.push('</g>')

  // Open terminals get a small ring; wired terminals are covered by the wire
  // and must not paint over a junction dot at a T.
  parts.push(`<g fill="${palette.paper}" stroke="${palette.pin}" stroke-width="${stroke(0.18)}">`)
  for (const comp of components) {
    for (const pin of comp.component.pins) {
      if (connected.has(`${comp.id}:${pin.id}`)) continue
      const at = pinWorldCoord(comp, pin)
      parts.push(
        `<circle cx="${round(at.x)}" cy="${round(at.y)}" r="${stroke(0.5)}" data-role="pin-open"/>`,
      )
    }
  }
  parts.push('</g>')

  parts.push('</g>')

  // ── Reference designators and values (paper space, fixed text size) ──────
  // The collision layout picks a side in model units; on paper the label is
  // re-anchored a fixed 2 mm off the part so print text never floats a large
  // screen-scaled gap away from its symbol.
  parts.push(
    `<g font-family="Inter, Arial, sans-serif" paint-order="stroke" stroke="${palette.halo}" stroke-width="0.9" stroke-linejoin="round">`,
  )
  for (const comp of components) {
    const placement = labels.get(comp.id)
    if (!placement) continue
    const part = componentBounds(comp)
    const box = placement.box
    const text = (x: number, y: number, line: (typeof placement.lines)[number], anchor: 'middle' | 'start' | 'end') =>
      parts.push(
        `<text x="${round(x)}" y="${round(y)}" text-anchor="${anchor}" dominant-baseline="central" font-size="${line.bold ? 3.4 : 3}" font-weight="${line.bold ? '700' : '400'}" fill="${palette.text}">${escapeXml(line.text)}</text>`,
      )
    const valueLine = placement.lines.find((line) => !line.bold)
    const refLine = placement.lines.find((line) => line.bold) ?? placement.lines[0]
    const partCenterX = part.x + part.width / 2
    const partCenterY = part.y + part.height / 2

    if (box.y + box.height <= part.y) {
      // Above the part: value nearest the symbol, reference over it.
      const top = toPaper(partCenterX, part.y)
      if (valueLine) {
        text(top.x, top.y - 2.4, valueLine, 'middle')
        text(top.x, top.y - 6.4, refLine, 'middle')
      } else {
        text(top.x, top.y - 3, refLine, 'middle')
      }
    } else if (box.y >= part.y + part.height) {
      const bottom = toPaper(partCenterX, part.y + part.height)
      text(bottom.x, bottom.y + 2.8, refLine, 'middle')
      if (valueLine) text(bottom.x, bottom.y + 6.8, valueLine, 'middle')
    } else if (box.x >= part.x + part.width) {
      const right = toPaper(part.x + part.width, partCenterY)
      if (valueLine) {
        text(right.x + 2, right.y - 2.1, refLine, 'start')
        text(right.x + 2, right.y + 1.9, valueLine, 'start')
      } else {
        text(right.x + 2, right.y, refLine, 'start')
      }
    } else {
      const left = toPaper(part.x, partCenterY)
      if (valueLine) {
        text(left.x - 2, left.y - 2.1, refLine, 'end')
        text(left.x - 2, left.y + 1.9, valueLine, 'end')
      } else {
        text(left.x - 2, left.y, refLine, 'end')
      }
    }
  }
  parts.push('</g>')

  // ── Notes strip (bottom band, left of the title block) ───────────────────
  const notes = options.notes ?? []
  if (notes.length > 0) {
    const noteX = frame.x + 8
    const maxWidth = block.x - noteX - 12
    const noteTop = block.y + 10
    parts.push(
      `<g font-family="Inter, Arial, sans-serif" font-size="2.4" fill="${palette.quiet}">`,
      `<text x="${noteX}" y="${round(noteTop)}" font-weight="700" font-size="2.2" letter-spacing="0.3">NOTES</text>`,
    )
    notes.forEach((note, index) => {
      parts.push(
        `<text x="${noteX}" y="${round(noteTop + 5.4 + index * 4.2)}">${escapeXml(fitText(note, maxWidth, 2.4))}</text>`,
      )
    })
    parts.push('</g>')
  }

  // ── Title block ──────────────────────────────────────────────────────────
  const quarter = block.width / 4
  parts.push(
    `<g fill="none" stroke="${palette.frame}" stroke-width="0.35">`,
    `<rect x="${round(block.x)}" y="${round(block.y)}" width="${round(block.width)}" height="${round(block.height)}" fill="${palette.paper}"/>`,
    `<line x1="${round(block.x)}" y1="${round(block.y + 9)}" x2="${round(block.x + block.width)}" y2="${round(block.y + 9)}"/>`,
    `<line x1="${round(block.x)}" y1="${round(block.y + 24)}" x2="${round(block.x + block.width)}" y2="${round(block.y + 24)}"/>`,
  )
  for (let index = 1; index <= 3; index += 1) {
    const x = block.x + quarter * index
    parts.push(
      `<line x1="${round(x)}" y1="${round(block.y + 24)}" x2="${round(x)}" y2="${round(block.y + block.height)}"/>`,
    )
  }
  parts.push('</g>')

  parts.push(`<g font-family="Inter, Arial, sans-serif">`)
  parts.push(
    `<text x="${round(block.x + 4)}" y="${round(block.y + 6.6)}" font-size="5.2" font-weight="700" fill="${palette.text}" letter-spacing="0.6">FOLIO</text>`,
    `<text x="${round(block.x + block.width - 4)}" y="${round(block.y + 6.4)}" text-anchor="end" font-size="2.5" fill="${palette.quiet}">REV ${escapeXml(revision)}</text>`,
    `<text x="${round(block.x + 4)}" y="${round(block.y + 13)}" font-size="1.7" fill="${palette.quiet}" letter-spacing="0.3">TITLE</text>`,
    `<text x="${round(block.x + 4)}" y="${round(block.y + 20.4)}" font-size="4" font-weight="700" fill="${palette.text}">${escapeXml(fitText(title, block.width - 8, 4))}</text>`,
  )

  const cells = [
    { label: 'SIZE', value: options.paperSize ?? 'A4' },
    { label: 'SCALE', value: scaleNote },
    { label: 'DATE', value: date },
    { label: 'SHEET', value: '1/1' },
  ]
  cells.forEach((cell, index) => {
    const x = block.x + quarter * index + 3
    parts.push(
      `<text x="${round(x)}" y="${round(block.y + 27.6)}" font-size="1.6" fill="${palette.quiet}" letter-spacing="0.3">${cell.label}</text>`,
      `<text x="${round(x)}" y="${round(block.y + 32.4)}" font-size="2.6" fill="${palette.text}">${escapeXml(cell.value)}</text>`,
    )
  })
  if (options.projectName && options.projectName !== title) {
    parts.push(
      `<text x="${round(block.x + block.width - 4)}" y="${round(block.y + 13)}" text-anchor="end" font-size="2.1" fill="${palette.quiet}">${escapeXml(fitText(options.projectName, block.width * 0.6, 2.1))}</text>`,
    )
  }
  parts.push('</g>')

  parts.push('</svg>')
  return parts.join('\n')
}
