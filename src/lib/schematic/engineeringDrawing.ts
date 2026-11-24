/**
 * Engineering-drawing SVG for a schematic sheet.
 *
 * This is a real vector sheet — paper-sized A4/A3/Letter, sheet border, zone
 * references, title block, symbols, pins, wires and junction dots — not a
 * rasterised canvas screenshot. Geometry comes from `drawingLayout`, the same
 * module the interactive canvas uses, so the exported sheet matches what the user
 * sees, and the paper comes from `../drawing/sheet`, the same sheet a machined
 * part or a truss is drawn on. Schematic content is not to scale (NTS); it is
 * fitted to the drawing area and printed at fixed millimetre line and text heights.
 */
import type { CanvasComponent, CanvasWire } from '../../stores/useProjectStore'
import {
  componentBounds,
  connectedPinKeys,
  drawingExtents,
  layoutComponentLabels,
  layoutNetLabels,
  pinWorldCoord,
  wireJunctions,
} from './drawingLayout'
import {
  escapeXml,
  openSheet,
  paletteFor,
  round,
  type DrawingPaper,
  type SheetPalette,
} from '../drawing/sheet'

export type { DrawingPaper } from '../drawing/sheet'

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

interface SchematicInks extends SheetPalette {
  symbol: string
  wire: string
  pin: string
  junction: string
}

/** Copper and pins read as colour on screen; on paper a schematic is one ink. */
function inks(mode: 'print' | 'screen'): SchematicInks {
  const sheet = paletteFor(mode)
  return mode === 'screen'
    ? { ...sheet, symbol: sheet.text, wire: '#34d399', pin: '#f59e0b', junction: '#34d399' }
    : { ...sheet, symbol: sheet.text, wire: sheet.text, pin: sheet.quiet, junction: sheet.text }
}

export function buildSchematicDrawing(
  components: CanvasComponent[],
  wires: CanvasWire[],
  options: SchematicDrawingOptions,
): string {
  const labels = layoutComponentLabels(components, wires)
  const netLabels = layoutNetLabels(wires, components, labels)
  const extents = drawingExtents(components, wires, labels)
  // On paper the title block lives outside the drawing area, so the model
  // frame only needs symmetric clearance around the actual content. Reusing
  // the canvas sheet frame (which reserves a bottom band) would push the
  // circuit into the top half of the page.
  const modelWidth = Math.max(240, extents.maxX - extents.minX + 60)
  const modelHeight = Math.max(150, extents.maxY - extents.minY + 60)
  const modelBox = {
    x: (extents.minX + extents.maxX) / 2 - modelWidth / 2,
    y: (extents.minY + extents.maxY) / 2 - modelHeight / 2,
    width: modelWidth,
    height: modelHeight,
  }
  const title = options.title || 'Untitled schematic'
  const palette = inks(options.palette ?? 'print')

  const sheet = openSheet({
    title,
    subject: 'schematic drawing',
    paper: options.paperSize ?? 'A4',
    palette: options.palette,
    titleId: 'drawing-title',
  })
  sheet.drawChrome()

  // Print line weights are set in millimetres and divided by the fit scale so
  // they stay constant on paper regardless of how small the model is.
  const fit = sheet.fitTo(modelBox)
  const stroke = fit.stroke

  // ── Model-space geometry (wires, junctions, symbols, pins) ───────────────
  const connected = connectedPinKeys(wires)
  const junctions = wireJunctions(wires)

  sheet.push(fit.open())

  sheet.push(
    `<g fill="none" stroke="${palette.wire}" stroke-width="${stroke(0.22)}" stroke-linecap="round" stroke-linejoin="round">`,
  )
  for (const wire of wires) {
    if (wire.points.length < 2) continue
    const points = wire.points.map((point) => `${round(point.x)},${round(point.y)}`).join(' ')
    sheet.push(`<polyline points="${points}"/>`)
  }
  sheet.push('</g>')

  sheet.push(`<g fill="${palette.junction}">`)
  for (const dot of junctions) {
    sheet.push(
      `<circle cx="${round(dot.x)}" cy="${round(dot.y)}" r="${stroke(0.55)}" data-role="junction"/>`,
    )
  }
  sheet.push('</g>')

  sheet.push(
    `<g fill="none" stroke="${palette.symbol}" stroke-width="${stroke(0.32)}" stroke-linecap="round" stroke-linejoin="round">`,
  )
  for (const comp of components) {
    const transform =
      comp.rotation === 0
        ? `translate(${round(comp.x)} ${round(comp.y)})`
        : `translate(${round(comp.x)} ${round(comp.y)}) rotate(${comp.rotation})`
    sheet.push(`<g transform="${transform}">`)
    for (const path of comp.component.symbol_data.paths ?? []) {
      sheet.push(`<path d="${escapeXml(path)}"/>`)
    }
    sheet.push('</g>')
  }
  sheet.push('</g>')

  // Open terminals get a small ring; wired terminals are covered by the wire
  // and must not paint over a junction dot at a T.
  sheet.push(`<g fill="${palette.paper}" stroke="${palette.pin}" stroke-width="${stroke(0.18)}">`)
  for (const comp of components) {
    for (const pin of comp.component.pins) {
      if (connected.has(`${comp.id}:${pin.id}`)) continue
      const at = pinWorldCoord(comp, pin)
      sheet.push(
        `<circle cx="${round(at.x)}" cy="${round(at.y)}" r="${stroke(0.5)}" data-role="pin-open"/>`,
      )
    }
  }
  sheet.push(fit.close())

  // ── Reference designators and values (paper space, fixed text size) ──────
  // The collision layout picks a side in model units; on paper the label is
  // re-anchored a fixed 2 mm off the part so print text never floats a large
  // screen-scaled gap away from its symbol.
  sheet.push(
    `<g font-family="Archivo, Arial, sans-serif" paint-order="stroke" stroke="${palette.paper}" stroke-width="0.9" stroke-linejoin="round">`,
  )
  for (const comp of components) {
    const placement = labels.get(comp.id)
    if (!placement) continue
    const part = componentBounds(comp)
    const box = placement.box
    const text = (
      x: number,
      y: number,
      line: (typeof placement.lines)[number],
      anchor: 'middle' | 'start' | 'end',
    ) =>
      sheet.push(
        `<text x="${round(x)}" y="${round(y)}" text-anchor="${anchor}" dominant-baseline="central" font-size="${line.bold ? 3.4 : 3}" font-weight="${line.bold ? '700' : '400'}" fill="${palette.text}">${escapeXml(line.text)}</text>`,
      )
    const valueLine = placement.lines.find((line) => !line.bold)
    const refLine = placement.lines.find((line) => line.bold) ?? placement.lines[0]
    const partCenterX = part.x + part.width / 2
    const partCenterY = part.y + part.height / 2

    if (box.y + box.height <= part.y) {
      // Above the part: value nearest the symbol, reference over it.
      const top = fit.toPaper(partCenterX, part.y)
      if (valueLine) {
        text(top.x, top.y - 2.4, valueLine, 'middle')
        text(top.x, top.y - 6.4, refLine, 'middle')
      } else {
        text(top.x, top.y - 3, refLine, 'middle')
      }
    } else if (box.y >= part.y + part.height) {
      const bottom = fit.toPaper(partCenterX, part.y + part.height)
      text(bottom.x, bottom.y + 2.8, refLine, 'middle')
      if (valueLine) text(bottom.x, bottom.y + 6.8, valueLine, 'middle')
    } else if (box.x >= part.x + part.width) {
      const right = fit.toPaper(part.x + part.width, partCenterY)
      if (valueLine) {
        text(right.x + 2, right.y - 2.1, refLine, 'start')
        text(right.x + 2, right.y + 1.9, valueLine, 'start')
      } else {
        text(right.x + 2, right.y, refLine, 'start')
      }
    } else {
      const left = fit.toPaper(part.x, partCenterY)
      if (valueLine) {
        text(left.x - 2, left.y - 2.1, refLine, 'end')
        text(left.x - 2, left.y + 1.9, valueLine, 'end')
      } else {
        text(left.x - 2, left.y, refLine, 'end')
      }
    }
  }
  sheet.push('</g>')

  // ── Net names (paper space, fixed text size) ─────────────────────────────
  // The layout chose a world-space box clear of parts, copper and reference
  // labels; on paper the name is centred in that box at a printed size.
  if (netLabels.length > 0) {
    sheet.push(
      `<g font-family="Archivo, Arial, sans-serif" paint-order="stroke" stroke="${palette.paper}" stroke-width="0.8" stroke-linejoin="round">`,
    )
    for (const label of netLabels) {
      const at = fit.toPaper(
        label.box.x + label.box.width / 2,
        label.box.y + label.box.height / 2,
      )
      sheet.push(
        `<text x="${round(at.x)}" y="${round(at.y)}" text-anchor="middle" dominant-baseline="central" font-size="2.6" font-weight="700" fill="${palette.wire}">${escapeXml(label.name)}</text>`,
      )
    }
    sheet.push('</g>')
  }

  sheet.drawNotes(options.notes ?? [])
  sheet.drawTitleBlock({
    title,
    projectName: options.projectName,
    revision: options.revision,
    date: options.date,
    scaleNote: options.scale ?? 'NTS',
    sizeLabel: options.paperSize ?? 'A4',
  })
  return sheet.toString()
}
