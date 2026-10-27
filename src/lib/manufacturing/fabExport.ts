/**
 * Fab-grade manufacturing export (Giant 2).
 *
 * The old `exportToGerber` emitted a single RS-274X file of schematic wire
 * coordinates with fixed pad flashes and a hard-coded outline — no bottom
 * copper, no masks, no silk, no Excellon drill (the `pcb.ts` engine even
 * emitted drill *as Gerber*, the wrong format), no centroid, no
 * fab-profile DRC. This module builds the whole package instead, gated on
 * DRC against a real fab profile (JLCPCB 1 oz defaults). Fail-loud: a
 * component with no resolvable footprint is a violation, never a guess.
 *
 * All coordinates in millimetres. Rotation is degrees on screen, applied
 * to footprint pads around the placement origin.
 *
 * Layer truth: every segment declares the copper face it is etched on and
 * every pad carries the faces it exists on, so a two-layer board's Gerbers
 * match the board on screen. Copper on an inner layer is a violation — this
 * package has no inner-layer film to put it on.
 */
import type { PlacedComponent, Point, Wire } from '../../types'
import { polylineDistance } from '../geometry/distance'
import { footprintLibrary, type Footprint, type FootprintPad } from './footprintLibrary'

/** Capability profile of the fab house the board is ordered from. */
export interface FabProfile {
  name: string
  minTraceWidth: number
  minTraceSpacing: number
  minDrill: number
  minAnnularRing: number
  maskClearance: number
}

/** JLCPCB 1 oz copper defaults — the profile the tests gate against. */
export const JLCPCB_1OZ: FabProfile = {
  name: 'JLCPCB 1oz',
  minTraceWidth: 0.127,
  minTraceSpacing: 0.127,
  minDrill: 0.3,
  minAnnularRing: 0.15,
  maskClearance: 0.05,
}

export interface FabViolation {
  rule: 'trace-width' | 'trace-spacing' | 'drill' | 'annular-ring' | 'footprint' | 'copper-layer'
  severity: 'error'
  message: string
  elementId: string
}

/** Outer copper faces a two-layer Gerber package can film. */
export type FabSide = 'top' | 'bottom'

/** Trace width used when the incoming geometry does not carry one. */
export const DEFAULT_TRACE_WIDTH = 0.2

/**
 * One etched segment. `layer` is required: copper whose face is guessed ends
 * up in the wrong film, and the fab builds an open board that the DRC still
 * calls clean.
 */
export interface FabTrace {
  points: Point[]
  width: number
  netName?: string
  layer: FabSide | 'inner'
  /** Original layer id for inner copper, so the violation can name it. */
  layerName?: string
}

/**
 * Which outer face a board layer id exports to. Anything that is not one of
 * the two outer copper layers comes back as `inner` and is refused rather
 * than quietly folded into F_Cu.
 */
export function fabLayerFromId(layerId: string): { layer: FabTrace['layer']; name: string } {
  const id = layerId.trim().toLowerCase()
  if (id === 'top-cu' || id === 'f.cu' || id === 'top') return { layer: 'top', name: layerId }
  if (id === 'bot-cu' || id === 'b.cu' || id === 'bottom') return { layer: 'bottom', name: layerId }
  return { layer: 'inner', name: layerId }
}

/**
 * Placement face of a part. Board placement is still top-only everywhere in
 * the app, so a part reaches the bottom solely by declaring it; anything else
 * stays on the top face instead of being silently mirrored.
 */
export function componentSide(component: PlacedComponent): FabSide {
  const declared = String(component.properties.layer ?? component.properties.side ?? '').trim().toLowerCase()
  return declared === 'bottom' || declared === 'b.cu' || declared === 'bot-cu' || declared === 'bot' ? 'bottom' : 'top'
}

export interface CentroidRow {
  reference: string
  x: number
  y: number
  /** Top-view rotation. Fab houses that mirror bottom placements need the
   *  angle reflected about the X axis; the pick-and-place file keeps the raw
   *  board rotation and says so rather than guessing a convention. */
  rotation: number
  footprint: string
  side: 'Top' | 'Bottom'
  value: string
}

export interface BomRow {
  reference: string
  value: string
  footprint: string
  manufacturer: string
  partNumber: string
}

export interface FabPackage {
  /** filename → file content, ready to zip and upload. */
  files: Map<string, string>
  centroid: CentroidRow[]
  bom: BomRow[]
  violations: FabViolation[]
  /** True when a fab house may be sent the package. */
  shippable: boolean
}

/**
 * Routed plated through-hole. Copper exists on both sides; the mask is left
 * closed (tented vias), which is the JLCPCB default.
 */
export interface FabVia {
  x: number
  y: number
  drillDiameter: number
  padDiameter: number
  netName?: string
}

export interface FabOptions {
  boardWidth?: number
  boardHeight?: number
  profile?: FabProfile
  projectName?: string
  /** Vias from the routed board; omitting them would export open layers. */
  vias?: FabVia[]
}

export interface PlacedPad {
  x: number
  y: number
  w: number
  h: number
  round: boolean
  drill?: number
  /** Copper faces this pad exists on. A drilled pad is plated through, so it
   *  is flashed on both; an SMD pad only on the face its part was placed on. */
  layers: FabSide[]
}

export const onSide = (pad: PlacedPad, side: FabSide): boolean => pad.layers.includes(side)

export const coord = (v: number): string => String(Math.round(v * 1_000_000))

export const rotate = (x: number, y: number, degrees: number): { x: number; y: number } => {
  const radians = ((degrees % 360) * Math.PI) / 180
  return { x: x * Math.cos(radians) - y * Math.sin(radians), y: x * Math.sin(radians) + y * Math.cos(radians) }
}

/**
 * Resolve the IPC footprint: an explicit `footprint` property wins,
 * otherwise the category maps to the stock footprint of that family.
 * `undefined` means the caller records a violation — never invent pads.
 */
export function resolveFootprint(component: PlacedComponent): Footprint | undefined {
  const explicit = String(component.properties.footprint ?? '').trim()
  if (explicit) {
    const direct = footprintLibrary.getFootprint(explicit)
    if (direct) return direct
    const byName = footprintLibrary.getAllFootprints().find((entry) => entry.name === explicit)
    if (byName) return byName
  }
  const family = footprintLibrary.getFootprintsByCategory(component.component.category?.toLowerCase() ?? '')
  if (family.length > 0) {
    return family.find((entry) => entry.id.includes('0805') || entry.id.includes('0603')) ?? family[0]
  }
  return undefined
}

/** Footprint pads placed at the component origin, rotation applied. The pad's
 *  copper faces follow the placement: plated through-hole pads are annular
 *  rings on both sides, surface pads live on the face the part sits on. */
export function placedPads(component: PlacedComponent, footprint: Footprint): PlacedPad[] {
  const side = componentSide(component)
  return footprint.pads.map((pad) => {
    const offset = rotate(pad.position.x, pad.position.y, component.rotation)
    return {
      x: component.position.x + offset.x,
      y: component.position.y + offset.y,
      w: pad.size.width,
      h: pad.size.height,
      round: pad.shape === 'circle',
      drill: pad.drillDiameter,
      layers: padCopperSides(pad, side),
    }
  })
}

function padCopperSides(pad: FootprintPad, placementSide: FabSide): FabSide[] {
  if (pad.drillDiameter !== undefined) return ['top', 'bottom']
  const declared: FabSide = pad.layers.includes('bottom_copper') && !pad.layers.includes('top_copper') ? 'bottom' : 'top'
  return [placementSide === 'bottom' || declared === 'bottom' ? 'bottom' : 'top']
}

/** A schematic wire plus the optional copper face an agent payload declares. */
export interface FabWireInput extends Wire {
  layerId?: string
}

/**
 * Sheet wires as fab copper. The schematic `Wire` has no copper layer, so a
 * `layerId` on the incoming record decides the face; without one the caller
 * states which face the geometry belongs on.
 */
export function fabTracesFromWires(wires: readonly FabWireInput[], fallbackLayer: FabSide = 'top'): FabTrace[] {
  return wires
    .filter((wire) => wire.points.length >= 2)
    .map((wire) => ({
      points: wire.points,
      width: Number(wire.style?.width ?? DEFAULT_TRACE_WIDTH),
      netName: wire.netName,
      layer: wire.layerId ? fabLayerFromId(wire.layerId).layer : fallbackLayer,
      layerName: wire.layerId,
    }))
}

function gerberHeader(): string[] {
  return ['G04 Generated by Folio fabExport*', '%FSLAX36Y36*%', '%MOMM*%']
}

function gerberCopper(
  title: string,
  traces: Array<{ points: Array<{ x: number; y: number }>; width: number }>,
  pads: PlacedPad[],
): string {
  const lines = [...gerberHeader(), `G04 ${title}*`]
  const widths = Array.from(new Set(traces.map((trace) => trace.width))).sort((a, b) => a - b)
  const apertureOf = new Map<number, number>()
  widths.forEach((width, index) => {
    apertureOf.set(width, 10 + index)
    lines.push(`%ADD${10 + index}C,${width.toFixed(4)}*%`)
  })
  lines.push('%TA.AperFunction,Conductor*%', 'G01*')
  for (const trace of traces) {
    if (trace.points.length < 2) continue
    lines.push(`D${apertureOf.get(trace.width)}*`)
    lines.push(`X${coord(trace.points[0].x)}Y${coord(trace.points[0].y)}D02*`)
    for (let i = 1; i < trace.points.length; i += 1) {
      lines.push(`X${coord(trace.points[i].x)}Y${coord(trace.points[i].y)}D01*`)
    }
  }
  let aperture = 30
  for (const pad of pads) {
    lines.push(
      pad.drill || pad.round
        ? `%ADD${aperture}C,${Math.max(pad.w, pad.h).toFixed(4)}*%`
        : `%ADD${aperture}R,${pad.w.toFixed(4)}X${pad.h.toFixed(4)}*%`,
    )
    lines.push(`D${aperture}*`, `X${coord(pad.x)}Y${coord(pad.y)}D03*`)
    aperture += 1
  }
  lines.push('M02*')
  return lines.join('\n')
}

function gerberMask(title: string, pads: PlacedPad[], clearance: number): string {
  const lines = [...gerberHeader(), `G04 ${title}*`, '%TA.AperFunction,Soldermask*%', 'G01*']
  let aperture = 10
  for (const pad of pads) {
    const w = pad.w + clearance * 2
    const h = pad.h + clearance * 2
    lines.push(
      pad.round || pad.drill
        ? `%ADD${aperture}C,${Math.max(w, h).toFixed(4)}*%`
        : `%ADD${aperture}R,${w.toFixed(4)}X${h.toFixed(4)}*%`,
    )
    lines.push(`D${aperture}*`, `X${coord(pad.x)}Y${coord(pad.y)}D03*`)
    aperture += 1
  }
  lines.push('M02*')
  return lines.join('\n')
}


function gerberSilk(title: string, labels: Array<{ x: number; y: number; text: string }>): string {
  const lines = [...gerberHeader(), `G04 ${title}*`, '%TA.AperFunction,Legend*%']
  lines.push('%ADD10C,0.1000*%', 'D10*', 'G01*')
  for (const label of labels) {
    const w = Math.max(1, label.text.length * 0.6)
    lines.push(`G04 ${label.text}*`)
    lines.push(`X${coord(label.x - w / 2)}Y${coord(label.y - 0.5)}D02*`)
    lines.push(`X${coord(label.x + w / 2)}Y${coord(label.y - 0.5)}D01*`)
    lines.push(`X${coord(label.x + w / 2)}Y${coord(label.y + 0.5)}D01*`)
    lines.push(`X${coord(label.x - w / 2)}Y${coord(label.y + 0.5)}D01*`)
    lines.push(`X${coord(label.x - w / 2)}Y${coord(label.y - 0.5)}D01*`)
  }
  lines.push('M02*')
  return lines.join('\n')
}

function gerberOutline(boardWidth: number, boardHeight: number): string {
  const lines = [...gerberHeader(), 'G04 Board outline Edge.Cuts*', '%ADD10C,0.0500*%', 'D10*', 'G01*']
  const corners: Array<[number, number]> = [[0, 0], [boardWidth, 0], [boardWidth, boardHeight], [0, boardHeight], [0, 0]]
  lines.push(`X${coord(corners[0][0])}Y${coord(corners[0][1])}D02*`)
  for (let i = 1; i < corners.length; i += 1) lines.push(`X${coord(corners[i][0])}Y${coord(corners[i][1])}D01*`)
  lines.push('M02*')
  return lines.join('\n')
}

/** True Excellon drill: M48 header, metric, tool table, G90, T-selects, M30. */
export function excellonDrill(hits: Array<{ x: number; y: number; diameter: number }>): string {
  const lines = ['M48', '; Generated by Folio fabExport', 'METRIC,TZ', 'G90']
  const diameters = Array.from(new Set(hits.map((hit) => hit.diameter))).sort((a, b) => a - b)
  diameters.forEach((diameter, index) => lines.push(`T${index + 1}C${diameter.toFixed(3)}`))
  lines.push('G05')
  diameters.forEach((diameter, index) => {
    lines.push(`T${index + 1}`)
    for (const hit of hits.filter((entry) => entry.diameter === diameter)) {
      lines.push(`X${hit.x.toFixed(3)}Y${hit.y.toFixed(3)}`)
    }
  })
  lines.push('M30')
  return lines.join('\n')
}

export function centroidCsv(rows: CentroidRow[]): string {
  const body = rows.map((row) => `${row.reference},${row.x.toFixed(3)},${row.y.toFixed(3)},${row.rotation},${row.footprint},${row.side},${row.value}`)
  return ['Designator,Mid X,Mid Y,Rotation,Footprint,Side,Value', ...body].join('\n')
}

export function bomCsv(rows: BomRow[]): string {
  const body = rows.map((row) => `${row.reference},${row.value},${row.footprint},${row.manufacturer},${row.partNumber}`)
  return ['Reference,Value,Footprint,Manufacturer,PartNumber', ...body].join('\n')
}

/** Build the complete fab package. Pads come from IPC footprints, never glyphs,
 *  and copper lands on the film for the face it was routed on. */
export function buildFabPackage(
  components: PlacedComponent[],
  routedTraces: FabTrace[],
  options: FabOptions = {},
): FabPackage {
  const { boardWidth = 100, boardHeight = 80, profile = JLCPCB_1OZ, projectName = 'folio-pcb', vias = [] } = options
  const violations: FabViolation[] = []
  const copper: FabTrace[] = []
  routedTraces.forEach((trace, index) => {
    if (trace.points.length < 2) return
    // Inner copper has no film in a two-layer package. Folding it into F_Cu
    // would ship a board with the wrong nets routed, so refuse it instead.
    if (trace.layer === 'inner') {
      violations.push({ rule: 'copper-layer', severity: 'error', message: `Trace ${index} is on "${trace.layerName ?? 'an inner layer'}"; this package films only F_Cu and B_Cu.`, elementId: `trace-${index}` })
      return
    }
    if (trace.width < profile.minTraceWidth) {
      violations.push({ rule: 'trace-width', severity: 'error', message: `Trace ${index} width ${trace.width} mm below ${profile.name} minimum.`, elementId: `trace-${index}` })
    }
    copper.push(trace)
  })
  for (let a = 0; a < copper.length; a += 1) {
    for (let b = a + 1; b < copper.length; b += 1) {
      // Clearance is a same-face rule: top crossing bottom is separated by the
      // laminate, so charging it would refuse legal two-layer boards.
      if (copper[a].layer !== copper[b].layer) continue
      // Copper on the same net is allowed to touch; different nets must clear.
      const netA = copper[a].netName
      const netB = copper[b].netName
      if (netA && netB && netA === netB) continue
      // Centre-line distance between the polylines, not just vertex distance:
      // two long crossing traces have distant vertices but zero clearance.
      const edge = polylineDistance(copper[a].points, copper[b].points)
        - (copper[a].width + copper[b].width) / 2
      if (edge < profile.minTraceSpacing) {
        violations.push({ rule: 'trace-spacing', severity: 'error', message: `Traces ${a}/${b} clear ${edge.toFixed(3)} mm, below minimum.`, elementId: `trace-${a}/trace-${b}` })
      }
    }
  }
  const pads: PlacedPad[] = []
  const drills: Array<{ x: number; y: number; diameter: number }> = []
  const centroid: CentroidRow[] = []
  const bom: BomRow[] = []
  const silk: Record<FabSide, Array<{ x: number; y: number; text: string }>> = { top: [], bottom: [] }
  for (const component of components) {
    const footprint = resolveFootprint(component)
    if (!footprint) {
      violations.push({ rule: 'footprint', severity: 'error', message: `${component.reference} resolves to no IPC footprint — refusing to invent pads.`, elementId: component.id })
      continue
    }
    const placed = placedPads(component, footprint)
    pads.push(...placed)
    for (const pad of placed) {
      if (!pad.drill) continue
      if (pad.drill < profile.minDrill) {
        violations.push({ rule: 'drill', severity: 'error', message: `${component.reference} drill ${pad.drill} mm below minimum.`, elementId: component.id })
      }
      const ring = (Math.min(pad.w, pad.h) - pad.drill) / 2
      if (ring < profile.minAnnularRing) {
        violations.push({ rule: 'annular-ring', severity: 'error', message: `${component.reference} ring ${ring.toFixed(3)} mm below minimum.`, elementId: component.id })
      }
      drills.push({ x: pad.x, y: pad.y, diameter: pad.drill })
    }
    const side = componentSide(component)
    const value = String(component.properties.value ?? component.properties.resistance ?? component.properties.capacitance ?? '')
    centroid.push({ reference: component.reference, x: component.position.x, y: component.position.y, rotation: component.rotation, footprint: footprint.name, side: side === 'bottom' ? 'Bottom' : 'Top', value })
    bom.push({ reference: component.reference, value, footprint: footprint.name, manufacturer: String(component.properties.manufacturer ?? component.component.manufacturer ?? ''), partNumber: String(component.properties.partNumber ?? component.component.partNumber ?? '') })
    silk[side].push({ x: component.position.x, y: component.position.y + 2, text: component.reference })
  }
  const topPads = pads.filter((pad) => onSide(pad, 'top'))
  const bottomPads = pads.filter((pad) => onSide(pad, 'bottom'))
  const viaPads: PlacedPad[] = []
  for (const via of vias) {
    if (via.drillDiameter < profile.minDrill) {
      violations.push({ rule: 'drill', severity: 'error', message: `Via at ${via.x.toFixed(2)}, ${via.y.toFixed(2)} drill ${via.drillDiameter} mm below minimum.`, elementId: `${via.x}-${via.y}` })
    }
    const ring = (via.padDiameter - via.drillDiameter) / 2
    if (ring < profile.minAnnularRing) {
      violations.push({ rule: 'annular-ring', severity: 'error', message: `Via at ${via.x.toFixed(2)}, ${via.y.toFixed(2)} ring ${ring.toFixed(3)} mm below minimum.`, elementId: `${via.x}-${via.y}` })
    }
    viaPads.push({
      x: via.x,
      y: via.y,
      w: via.padDiameter,
      h: via.padDiameter,
      round: true,
      drill: via.drillDiameter,
      layers: ['top', 'bottom'],
    })
    drills.push({ x: via.x, y: via.y, diameter: via.drillDiameter })
  }
  const tracesOn = (side: FabSide): FabTrace[] => copper.filter((trace) => trace.layer === side)
  const files = new Map<string, string>()
  files.set(`${projectName}-F_Cu.gtl`, gerberCopper('Top copper', tracesOn('top'), [...topPads, ...viaPads]))
  files.set(`${projectName}-B_Cu.gbl`, gerberCopper('Bottom copper', tracesOn('bottom'), [...bottomPads, ...viaPads]))
  files.set(`${projectName}-F_Mask.gts`, gerberMask('Top mask', topPads, profile.maskClearance))
  files.set(`${projectName}-B_Mask.gbs`, gerberMask('Bottom mask', bottomPads, profile.maskClearance))
  files.set(`${projectName}-F_Silk.gto`, gerberSilk('Top silk', silk.top))
  files.set(`${projectName}-B_Silk.gbo`, gerberSilk('Bottom silk', silk.bottom))
  files.set(`${projectName}-Edge_Cuts.gm1`, gerberOutline(boardWidth, boardHeight))
  files.set(`${projectName}.drl`, excellonDrill(drills))
  files.set(`${projectName}-centroid.csv`, centroidCsv(centroid))
  files.set(`${projectName}-bom.csv`, bomCsv(bom))
  return { files, centroid, bom, violations, shippable: violations.length === 0 }
}

