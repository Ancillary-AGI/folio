/**
 * A fabrication drawing of a pin-jointed truss: elevation, setting-out
 * dimensions, bearings, loads and a bar schedule.
 *
 * This is the sheet a site engineer pins up. It is drawn from the same
 * `TrussModel` the solver reads and the same `TrussResult` the panel shows, so a
 * bar cannot be drawn in one place on paper and solved in another — the defect
 * that makes most "CAD export" features decorative. Two honesty rules hold it
 * together: the scale written in the title block is the scale the geometry is
 * drawn at, and a model the solver refused is stamped as unanalysed rather than
 * printed with a schedule of zeroes.
 *
 * Units: the model is metres and newtons, the sheet is millimetres of paper. The
 * preferred-scale series (ISO 5455) is in paper mm per model mm, so it is scaled
 * by 1000 once, at the boundary, and never again.
 */
import {
  dimensionInk,
  escapeXml,
  fitBoxAt,
  formatNumber,
  linearDimension,
  openSheet,
  paletteFor,
  pickStandardScale,
  round,
  scaleLabel,
  type Box,
  type DrawingPaper,
  type Sheet,
  type SheetPalette,
} from '../drawing/sheet'
import {
  TRUSS_MATERIALS,
  type TrussMember,
  type TrussModel,
  type TrussNode,
  type TrussResult,
  type TrussSupport,
} from './truss'
import { trussDeterminacy } from './trussPresets'

export interface TrussDrawingInput {
  /** The model the solver was run on, not a display copy of it. */
  model: TrussModel
  /** The solver's answer, or `null` when the model refused to solve. */
  result: TrussResult | null
  /** Why it refused, when it did. Printed on the sheet, not left in the panel. */
  status?: string | null
}

export interface TrussDrawingOptions {
  title: string
  projectName?: string
  revision?: string
  /** ISO date (YYYY-MM-DD). Defaults to today. */
  date?: string
  paperSize?: DrawingPaper
  /** Extra lines appended to the notes strip. */
  notes?: string[]
  palette?: 'print' | 'screen'
}

const FONT = 'font-family="Inter, Arial, sans-serif"'

/** Bar schedule geometry, in paper millimetres. */
const ROW_MM = 4.4
const HEADER_MM = 6.4
const GROUP_MM = 132
/**
 * How much of the sheet the schedule may take. A 40-bar frame listed in full
 * would leave the elevation a strip too small to dimension, and a drawing whose
 * geometry cannot be read is not a drawing — so the list stops and says so.
 */
const SCHEDULE_SHARE = 0.5

interface ScheduleRow {
  id: string
  ends: string
  lengthMm: number
  areaMm2: number
  forceKn: string
  stressMpa: string
  utilisation: string
}

interface ScheduleColumn {
  header: string
  width: number
  align: 'start' | 'end'
  cell: (row: ScheduleRow) => string
}

const SCHEDULE_COLUMNS: ScheduleColumn[] = [
  { header: 'BAR', width: 18, align: 'start', cell: (row) => row.id },
  { header: 'ENDS', width: 30, align: 'start', cell: (row) => row.ends },
  { header: 'L mm', width: 20, align: 'end', cell: (row) => formatNumber(Math.round(row.lengthMm)) },
  { header: 'A mm²', width: 20, align: 'end', cell: (row) => formatNumber(Math.round(row.areaMm2)) },
  { header: 'F kN', width: 20, align: 'end', cell: (row) => row.forceKn },
  { header: 'σ MPa', width: 16, align: 'end', cell: (row) => row.stressMpa },
  // Utilisation is dimensionless |σ|/strength; over 1 the bar is over its own capacity.
  { header: 'U', width: 8, align: 'end', cell: (row) => row.utilisation },
]

function scheduleRow(
  member: TrussMember,
  byId: ReadonlyMap<string, TrussNode>,
  result: TrussResult | null,
): ScheduleRow {
  const a = byId.get(member.from)
  const b = byId.get(member.to)
  const lengthM = a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0
  const demand = result?.members[member.id]
  return {
    id: member.id,
    ends: `${member.from}→${member.to}`,
    lengthMm: lengthM * 1000,
    areaMm2: member.area * 1e6,
    forceKn: demand ? (demand.force / 1e3).toFixed(2) : '—',
    stressMpa: demand ? (demand.stress / 1e6).toFixed(1) : '—',
    utilisation: demand ? `${demand.utilisation.toFixed(2)}${demand.utilisation > 1 ? '*' : ''}` : '—',
  }
}

/**
 * How the bar schedule is laid out on a given content area.
 *
 * The plan is computed once and shared: the elevation is sized from the height
 * the schedule claims, so a bar cannot be listed in a band the drawing does not
 * reserve for it.
 */
interface SchedulePlan {
  lefts: number[]
  perGroup: number
  /** Rows that fit; the rest are named by the note under the table. */
  listed: number
  height: number
}

function planSchedule(content: Box, rowCount: number): SchedulePlan {
  const groups = content.width >= GROUP_MM * 2 + 12 ? 2 : 1
  const gutter = groups === 2 ? 10 : 0
  const room = Math.max(1, Math.floor((content.height * SCHEDULE_SHARE - HEADER_MM) / ROW_MM))
  const perGroup = Math.min(room, Math.max(1, Math.ceil(rowCount / groups)))
  const start = content.x + (content.width - (groups * GROUP_MM + gutter)) / 2
  return {
    lefts: Array.from({ length: groups }, (_, index) => start + index * (GROUP_MM + gutter)),
    perGroup,
    listed: groups * perGroup,
    height: HEADER_MM + perGroup * ROW_MM + 8,
  }
}

const columnOffset = (columnIndex: number): number =>
  SCHEDULE_COLUMNS.slice(0, columnIndex).reduce((sum, column) => sum + column.width, 0)

function drawSchedule(
  sheet: Sheet,
  area: Box,
  plan: SchedulePlan,
  rows: ScheduleRow[],
  palette: SheetPalette,
): void {
  const shown = rows.slice(0, plan.listed)

  sheet.push(`<g ${FONT} font-size="2.2" fill="${palette.ink}">`)
  shown.forEach((row, index) => {
    const group = Math.floor(index / plan.perGroup)
    const within = index - group * plan.perGroup
    const y = area.y + HEADER_MM + within * ROW_MM + ROW_MM / 2
    SCHEDULE_COLUMNS.forEach((column, columnIndex) => {
      const x = plan.lefts[group] + columnOffset(columnIndex) + (column.align === 'end' ? column.width - 1.5 : 1.5)
      sheet.push(
        `<text x="${round(x)}" y="${round(y)}" text-anchor="${column.align === 'end' ? 'end' : 'start'}" dominant-baseline="central">${escapeXml(column.cell(row))}</text>`,
      )
    })
  })
  sheet.push('</g>')

  const bottom = area.y + HEADER_MM + plan.perGroup * ROW_MM
  sheet.push(
    `<g fill="none" stroke="${palette.frame}" stroke-width="0.3">`,
    ...plan.lefts.map(
      (left) => `<rect x="${round(left)}" y="${round(area.y)}" width="${GROUP_MM}" height="${round(bottom - area.y)}"/>`,
    ),
    ...plan.lefts.map(
      (left) => `<line x1="${round(left)}" y1="${round(area.y + HEADER_MM)}" x2="${round(left + GROUP_MM)}" y2="${round(area.y + HEADER_MM)}"/>`,
    ),
    '</g>',
    `<g ${FONT} font-size="2.2" font-weight="700" fill="${palette.ink}">`,
    ...plan.lefts.flatMap((left) =>
      SCHEDULE_COLUMNS.map((column, columnIndex) => {
        const x = left + columnOffset(columnIndex) + (column.align === 'end' ? column.width - 1.5 : 1.5)
        return `<text x="${round(x)}" y="${round(area.y + 4.2)}" text-anchor="${column.align === 'end' ? 'end' : 'start'}">${escapeXml(column.header)}</text>`
      }),
    ),
    '</g>',
  )

  if (rows.length > plan.listed) {
    sheet.push(
      `<text x="${round(area.x)}" y="${round(bottom + 4)}" ${FONT} font-size="2.2" fill="${palette.quiet}">${escapeXml(`${rows.length - plan.listed} further bars are in the model and are listed in the results table.`)}</text>`,
    )
  }
}

/**
 * The bearing symbol, drawn on the outside of the shape at the joint it holds.
 *
 * A truss model says which axes a support holds but not which side of the joint
 * the pier is on, so the triangle sits away from the mid-height (or mid-span) of
 * the frame — the one reading that cannot contradict the model — and the axes
 * held are drawn into the symbol rather than guessed from where it sits.
 */
function drawSupport(
  sheet: Sheet,
  support: TrussSupport,
  at: { x: number; y: number },
  side: 'below' | 'above' | 'left' | 'right',
  palette: SheetPalette,
): void {
  const height = 5
  const half = 4
  const dy = side === 'below' ? 1 : side === 'above' ? -1 : 0
  const dx = side === 'left' ? -1 : side === 'right' ? 1 : 0
  const base = { x: at.x + dx * height, y: at.y + dy * height }
  const cornerA = { x: base.x + dy * half, y: base.y + dx * half }
  const cornerB = { x: base.x - dy * half, y: base.y - dx * half }
  const lines = [
    `<polygon points="${round(at.x)},${round(at.y)} ${round(cornerA.x)},${round(cornerA.y)} ${round(cornerB.x)},${round(cornerB.y)}" fill="${palette.paper}" stroke="${palette.ink}" stroke-width="0.3"/>`,
    // The ground line and its hatching sit on the face away from the frame.
    `<line x1="${round(cornerA.x + dx)}" y1="${round(cornerA.y + dy)}" x2="${round(cornerB.x - dx)}" y2="${round(cornerB.y - dy)}" stroke="${palette.ink}" stroke-width="0.3"/>`,
  ]
  for (let index = 0; index <= 2; index += 1) {
    const px = cornerA.x + ((cornerB.x - cornerA.x) * index) / 2
    const py = cornerA.y + ((cornerB.y - cornerA.y) * index) / 2
    lines.push(
      `<line x1="${round(px)}" y1="${round(py)}" x2="${round(px + dx * 3 - dy * 2)}" y2="${round(py + dy * 3 - dx * 2)}" stroke="${palette.ink}" stroke-width="0.22"/>`,
    )
  }
  if (support.holdsY && !support.holdsX) {
    // A roller: it takes the vertical and lets the frame breathe along its axis.
    lines.push(
      `<circle cx="${round(base.x + dx * 2)}" cy="${round(base.y + dy * 2)}" r="1.3" fill="${palette.paper}" stroke="${palette.ink}" stroke-width="0.3"/>`,
    )
  }
  sheet.push(`<g fill="none">${lines.join('')}</g>`)
}

export function buildTrussDrawing(input: TrussDrawingInput, options: TrussDrawingOptions): string {
  const { model, result } = input
  if (model.nodes.length < 2) {
    throw new Error('A truss drawing needs at least two joints to dimension between.')
  }
  const palette = paletteFor(options.palette)
  const sheet = openSheet({
    title: options.title,
    subject: 'truss framing drawing',
    paper: options.paperSize ?? 'A3',
    palette: options.palette,
    titleId: 'truss-drawing-title',
  })
  sheet.drawChrome()

  const byId = new Map(model.nodes.map((node) => [node.id, node]))
  const xs = model.nodes.map((node) => node.x)
  const ys = model.nodes.map((node) => node.y)
  const bounds = {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  }
  const spanMm = (bounds.maxX - bounds.minX) * 1000
  const riseMm = (bounds.maxY - bounds.minY) * 1000

  // The schedule lives under the elevation, so the drawing gets what is left.
  const rows = model.members.map((member) => scheduleRow(member, byId, result))
  const plan = planSchedule(sheet.content, rows.length)
  const elevation: Box = {
    x: sheet.content.x,
    y: sheet.content.y,
    width: sheet.content.width,
    height: Math.max(sheet.content.height - plan.height, 40),
  }
  // A rise dimension and its value hang off the left of the frame, a span and a
  // row of panel pitches sit under it, and bearings stick out at the joints.
  const requiredAt = (paperPerModelMm: number) => ({
    width: spanMm * paperPerModelMm + 44,
    height: riseMm * paperPerModelMm + 58,
  })
  const standard = pickStandardScale(elevation.width, elevation.height, requiredAt)
  if (!standard) {
    throw new Error(
      'This truss does not fit at any preferred scale on the selected sheet; choose a larger paper size.',
    )
  }
  // Y is flipped here rather than in the transform: a lattice stands up, and a
  // drawing that shows a gable truss hanging below its tie beam is not a drawing.
  const fit = fitBoxAt(
    {
      x: bounds.minX,
      y: -bounds.maxY,
      width: Math.max(bounds.maxX - bounds.minX, 1e-6),
      height: Math.max(bounds.maxY - bounds.minY, 1e-6),
    },
    elevation,
    // Paper mm per model metre; the declared scale stays in the preferred series.
    standard * 1000,
  )
  const project = (node: TrussNode) => fit.toPaper(node.x, -node.y)

  if (!result) {
    sheet.push(
      `<text x="${round(elevation.x)}" y="${round(elevation.y + 6)}" ${FONT} font-size="3.2" font-weight="700" fill="${palette.ink}" letter-spacing="0.4">NOT ANALYSED — ${escapeXml(input.status ?? 'the solver returned no result')}</text>`,
    )
  }

  // ── Bars ─────────────────────────────────────────────────────────────────
  const drawn = model.members
    .map((member) => ({ member, a: byId.get(member.from), b: byId.get(member.to) }))
    .filter((entry): entry is { member: TrussMember; a: TrussNode; b: TrussNode } =>
      Boolean(entry.a && entry.b),
    )
  sheet.push(`<g fill="none" stroke="${palette.ink}" stroke-linecap="round" stroke-width="0.45">`)
  for (const { a, b } of drawn) {
    const from = project(a)
    const to = project(b)
    sheet.push(
      `<line x1="${round(from.x)}" y1="${round(from.y)}" x2="${round(to.x)}" y2="${round(to.y)}"/>`,
    )
  }
  sheet.push('</g>')

  // ── Joints and their ids ─────────────────────────────────────────────────
  const midHeight = (bounds.minY + bounds.maxY) / 2
  sheet.push(`<g ${FONT} font-size="2.4" fill="${palette.quiet}">`)
  for (const node of model.nodes) {
    const at = project(node)
    sheet.push(
      `<circle cx="${round(at.x)}" cy="${round(at.y)}" r="1.1" fill="${palette.paper}" stroke="${palette.ink}" stroke-width="0.3"/>`,
      // A top-chord joint is labelled above, a bottom-chord joint below, so the
      // id never sits on the bars that meet there.
      `<text x="${round(at.x + 1.8)}" y="${round(at.y + (node.y >= midHeight ? -2.4 : 4.2))}">${escapeXml(node.id)}</text>`,
    )
  }
  sheet.push('</g>')

  // ── Bar ids and axial forces, stood off the bar along its normal ────────
  sheet.push(`<g ${FONT} font-size="2.2" fill="${palette.text}">`)
  for (const { member, a, b } of drawn) {
    const from = project(a)
    const to = project(b)
    const dx = to.x - from.x
    const dy = to.y - from.y
    const length = Math.hypot(dx, dy) || 1
    const demand = result?.members[member.id]
    const force = demand ? ` ${demand.force >= 0 ? 'T' : 'C'}${Math.abs(demand.force / 1e3).toFixed(1)}` : ''
    sheet.push(
      `<text x="${round((from.x + to.x) / 2 - (dy / length) * 3)}" y="${round((from.y + to.y) / 2 + (dx / length) * 3)}" text-anchor="middle" dominant-baseline="central">${escapeXml(`${member.id}${force}`)}</text>`,
    )
  }
  sheet.push('</g>')

  // ── Bearings ─────────────────────────────────────────────────────────────
  const midX = (bounds.minX + bounds.maxX) / 2
  for (const support of model.supports) {
    const node = byId.get(support.node)
    if (!node) continue
    const side = support.holdsY
      ? node.y >= midHeight
        ? 'above'
        : 'below'
      : node.x >= midX
        ? 'right'
        : 'left'
    drawSupport(sheet, support, project(node), side, palette)
  }

  // ── Loads ────────────────────────────────────────────────────────────────
  const ink = dimensionInk(palette)
  for (const load of model.loads) {
    const node = byId.get(load.node)
    if (!node) continue
    const magnitude = Math.hypot(load.fx, load.fy)
    if (magnitude < 1e-9) continue
    const at = project(node)
    const ux = load.fx / magnitude
    // Paper y is down and model y is up, hence the sign flip on the vertical.
    const uy = -load.fy / magnitude
    const head = { x: at.x + ux * 13, y: at.y + uy * 13 }
    const butt = { x: head.x - ux * 2.2, y: head.y - uy * 2.2 }
    const degrees = (Math.atan2(uy, ux) * 180) / Math.PI
    sheet.push(
      `<line x1="${round(at.x + ux * 1.6)}" y1="${round(at.y + uy * 1.6)}" x2="${round(butt.x)}" y2="${round(butt.y)}" stroke="${palette.ink}" stroke-width="0.35"/>`,
      ink.arrow(butt, degrees),
      `<text x="${round(head.x + ux * 3.4)}" y="${round(head.y + uy * 3.4)}" ${FONT} font-size="2.4" fill="${palette.ink}" text-anchor="middle" dominant-baseline="central">${escapeXml(`${(magnitude / 1e3).toFixed(1)} kN`)}</text>`,
    )
  }

  // ── Setting-out dimensions ──────────────────────────────────────────────
  const projected = model.nodes.map(project)
  const bottomY = Math.max(...projected.map((point) => point.y))
  const topY = Math.min(...projected.map((point) => point.y))
  const leftX = Math.min(...projected.map((point) => point.x))
  const rightX = Math.max(...projected.map((point) => point.x))
  sheet.push(`<g ${FONT} stroke="${palette.ink}" fill="none">`)
  sheet.push(
    ...linearDimension({
      from: { x: leftX, y: bottomY },
      to: { x: rightX, y: bottomY },
      offset: 14,
      text: formatNumber(Math.round(spanMm)),
      caption: 'OVERALL SPAN',
      palette,
    }),
  )
  if (riseMm > 0) {
    sheet.push(
      ...linearDimension({
        from: { x: leftX, y: topY },
        to: { x: leftX, y: bottomY },
        offset: -14,
        text: formatNumber(Math.round(riseMm)),
        caption: 'RISE',
        palette,
      }),
    )
  }
  sheet.push('</g>')

  // The panel pitches, which is what the bars get cut to.
  const pitches = [...new Set(model.nodes.map((node) => node.x))].sort((a, b) => a - b)
  if (pitches.length > 1) {
    sheet.push(`<g ${FONT} stroke="${palette.ink}" fill="none">`)
    for (let index = 1; index < pitches.length; index += 1) {
      const y = bottomY
      sheet.push(
        ...linearDimension({
          from: { x: fit.offsetX + pitches[index - 1] * fit.scale, y },
          to: { x: fit.offsetX + pitches[index] * fit.scale, y },
          offset: 28,
          text: formatNumber(Math.round((pitches[index] - pitches[index - 1]) * 1000)),
          palette,
        }),
      )
    }
    sheet.push('</g>')
  }

  // ── Bar schedule ─────────────────────────────────────────────────────────
  drawSchedule(
    sheet,
    { x: sheet.content.x, y: elevation.y + elevation.height + 6, width: sheet.content.width, height: plan.height },
    plan,
    rows,
    palette,
  )

  // ── Notes and title block ────────────────────────────────────────────────
  const determinacy = trussDeterminacy(model)
  const materials = [...new Set(model.members.map((member) => member.material))].map(
    (id) => TRUSS_MATERIALS[id],
  )
  sheet.drawNotes([
    `${determinacy.members} BARS + ${determinacy.restraints} RESTRAINTS vs ${2 * determinacy.joints} FOR ${determinacy.joints} JOINTS — ${determinacy.kind.toUpperCase()}`,
    result
      ? "BAR FORCES ARE THE SOLVER'S; TENSION POSITIVE; * MARKS A BAR OVER ITS OWN CAPACITY"
      : 'NO BAR FORCE IS STATED ON THIS SHEET: THE MODEL DID NOT SOLVE',
    'PIN-JOINTED MODEL: BARS CARRY AXIAL FORCE ONLY AND LOADS ACT AT JOINTS',
    'SELF-WEIGHT IS NOT INCLUDED UNLESS IT IS LOADED AT A JOINT',
    materials.map((material) => `${material.label} (${material.source})`).join('; '),
    'NO PARTIAL SAFETY FACTORS OR LOAD COMBINATIONS: THIS SHEET SCREENS, IT DOES NOT CERTIFY',
    'BEARINGS SIT ON THE OUTSIDE OF THE FRAME AT THE JOINT THEY HOLD; AXES HELD ARE SHOWN IN THE SYMBOL',
    ...(options.notes ?? []),
  ])
  sheet.drawTitleBlock({
    title: options.title,
    projectName: options.projectName,
    revision: options.revision,
    date: options.date,
    scaleNote: scaleLabel(standard),
    cells: [
      { label: 'SIZE', value: options.paperSize ?? 'A3' },
      { label: 'SCALE', value: scaleLabel(standard) },
      { label: 'SPAN', value: `${formatNumber(Math.round(spanMm / 100) / 10)} m` },
      { label: 'BARS', value: String(model.members.length) },
      { label: 'DATE', value: options.date ?? new Date().toISOString().slice(0, 10) },
      { label: 'SHEET', value: '1/1' },
    ],
  })
  return sheet.toString()
}
