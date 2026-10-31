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
 * every pad carries the faces it exists on, so a multilayer board's Gerbers
 * match the board on screen. Inner copper is exported only when the package
 * is told how many inner films the stackup has; otherwise it is a violation
 * rather than being folded into an outer face.
 */
import type { Net, PlacedComponent, Point, Wire } from '../../types'
import { polylineDistance } from '../geometry/distance'
import { footprintLibrary, type Footprint, type FootprintPad } from './footprintLibrary'
import { footprintPadForPin } from './padMapping'

/** Capability profile of the fab house the board is ordered from. */
export interface FabProfile {
  name: string
  minTraceWidth: number
  minTraceSpacing: number
  minDrill: number
  minAnnularRing: number
  maskClearance: number
  /** Laser-drilled microvia floor for blind/buried spans. Absent means the
   *  vendor does not offer laser vias and the mechanical minimum applies. */
  minLaserDrill?: number
  /** Annular ring floor for laser microvias, smaller than a mechanical ring. */
  minMicroviaRing?: number
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
  rule: 'trace-width' | 'trace-spacing' | 'drill' | 'annular-ring' | 'footprint' | 'copper-layer' | 'via-span' | 'plane-conflict' | 'plane-floating'
  severity: 'error'
  message: string
  elementId: string
}

/** Outer copper faces. */
export type FabSide = 'top' | 'bottom'

/** One copper film in the shipped stackup: an outer face or inner film n (1 = nearest top). */
export type FabFilm = FabSide | `inner-${number}`

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
  /** Inner film number parsed from the layer id (1 = nearest the top). */
  innerIndex?: number
}

export interface ResolvedFabLayer {
  layer: FabTrace['layer']
  name: string
  innerIndex?: number
}

/**
 * Which copper film a board layer id exports to. Known inner ids carry their
 * film number; anything unrecognised comes back as `inner` without an index
 * and is refused rather than quietly folded into an outer film.
 */
export function fabLayerFromId(layerId: string): ResolvedFabLayer {
  const id = layerId.trim().toLowerCase()
  if (id === 'top-cu' || id === 'f.cu' || id === 'top') return { layer: 'top', name: layerId }
  if (id === 'bot-cu' || id === 'b.cu' || id === 'bottom') return { layer: 'bottom', name: layerId }
  const inner = /^in(?:ner)?[-_. ]?(\d+)(?:[-_. ]?cu)?$/.exec(id)
  if (inner) return { layer: 'inner', name: layerId, innerIndex: Number(inner[1]) }
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

/** What a poured plane actually connected to, so the caller can report it. */
export interface FabPlanePour {
  film: FabFilm
  netName: string
  /** Drilled pads and vias connected directly to the pour. */
  connections: number
  /** Foreign barrels given an anti-pad clearance. */
  antiPads: number
}

export interface FabPackage {
  /** filename → file content, ready to zip and upload. */
  files: Map<string, string>
  centroid: CentroidRow[]
  bom: BomRow[]
  violations: FabViolation[]
  /** One entry per plane film actually poured. */
  planes: FabPlanePour[]
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
  /** Copper films the barrel connects as 0-based film indices (0 = top,
   *  1…N = inner, N+1 = bottom). Omitted means a plated through via. */
  span?: { fromFilm: number; toFilm: number }
}

/** A plane film to pour solid copper on, tied to one net. */
export interface FabPlane {
  film: FabFilm
  netName: string
  /** Anti-pad clearance around foreign copper; defaults to the profile's
   *  minimum trace spacing. */
  clearance?: number
}

export interface FabOptions {
  boardWidth?: number
  boardHeight?: number
  profile?: FabProfile
  projectName?: string
  /** Vias from the routed board; omitting them would export open layers. */
  vias?: FabVia[]
  /** Inner copper films in the stackup, outermost first. Default 0 (two-layer
   *  board). Inner traces are refused unless their film is declared here. */
  innerLayerCount?: number
  /** Schematic nets, so pads and vias can be connected to or cleared from a
   *  plane by net rather than by guess. */
  nets?: readonly Net[]
  /** Inner films to pour solid copper on. */
  planes?: readonly FabPlane[]
}

/** Copper-to-board-edge clearance for a poured plane, in millimetres. */
export const PLANE_EDGE_CLEARANCE = 0.3

export const MAX_INNER_LAYERS = 30

/** Copper films in board order, top and bottom included. */
export function fabFilms(innerLayerCount: number): FabFilm[] {
  if (!Number.isInteger(innerLayerCount) || innerLayerCount < 0 || innerLayerCount > MAX_INNER_LAYERS) {
    throw new RangeError(`innerLayerCount must be an integer 0–${MAX_INNER_LAYERS}`)
  }
  return ['top', ...Array.from({ length: innerLayerCount }, (_, index) => `inner-${index + 1}` as FabFilm), 'bottom']
}

/** Short film label used in drill filenames and messages. */
export function filmLabel(film: FabFilm): string {
  if (film === 'top') return 'F'
  if (film === 'bottom') return 'B'
  return `In${film.slice('inner-'.length)}`
}

export interface PlacedPad {
  x: number
  y: number
  w: number
  h: number
  round: boolean
  drill?: number
  /** Copper films this pad exists on. A drilled pad is plated through, so it
   *  is flashed on every film; an SMD pad only on the outer face its part was
   *  placed on. */
  layers: FabFilm[]
  /** Net the pin lands on, resolved from the schematic when nets are supplied. */
  netName?: string
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
export function placedPads(component: PlacedComponent, footprint: Footprint, nets?: readonly Net[]): PlacedPad[] {
  const side = componentSide(component)
  const padNets = padNetByPadId(component, footprint, nets)
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
      netName: padNets?.get(pad.id),
    }
  })
}

/** Physical pad id → net id, using the same pin-to-pad mapping as the router.
 *  Pads whose pin has no net stay absent and are treated as foreign to planes. */
function padNetByPadId(
  component: PlacedComponent,
  footprint: Footprint,
  nets: readonly Net[] | undefined,
): Map<string, string> | undefined {
  if (!nets) return undefined
  const pinToNet = new Map<string, string>()
  for (const net of nets) {
    for (const pin of net.connectedPins) pinToNet.set(`${pin.componentId}:${pin.pinId}`, net.id)
  }
  const lookup = new Map<string, string>()
  component.component.pins.forEach((pin, index) => {
    const netId = pinToNet.get(`${component.id}:${pin.id}`)
    if (!netId) return
    const pad = footprintPadForPin(footprint, pin.id, index, component.component.pins.length)
    if (pad) lookup.set(pad.id, netId)
  })
  return lookup
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
    .map((wire) => {
      const resolved = wire.layerId ? fabLayerFromId(wire.layerId) : undefined
      return {
        points: wire.points,
        width: Number(wire.style?.width ?? DEFAULT_TRACE_WIDTH),
        netName: wire.netName,
        layer: resolved?.layer ?? fallbackLayer,
        layerName: wire.layerId,
        innerIndex: resolved?.innerIndex,
      }
    })
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

/**
 * Solid plane pour on an inner film. Dark polarity fills the board rectangle
 * inset by the edge clearance; clear polarity removes an anti-pad around every
 * foreign barrel; same-net barrels are flashed dark so the connection is
 * explicit rather than implied by overlap.
 */
function gerberPlane(
  title: string,
  boardWidth: number,
  boardHeight: number,
  clearance: number,
  connects: PlacedPad[],
  antiPads: PlacedPad[],
): string {
  const lines = [...gerberHeader(), `G04 ${title}*`, '%ADD10C,0.0500*%', 'D10*', 'G01*', '%LPD*%', 'G36*']
  const x0 = PLANE_EDGE_CLEARANCE
  const y0 = PLANE_EDGE_CLEARANCE
  const x1 = boardWidth - PLANE_EDGE_CLEARANCE
  const y1 = boardHeight - PLANE_EDGE_CLEARANCE
  lines.push(
    `X${coord(x0)}Y${coord(y0)}D02*`,
    `X${coord(x1)}Y${coord(y0)}D01*`,
    `X${coord(x1)}Y${coord(y1)}D01*`,
    `X${coord(x0)}Y${coord(y1)}D01*`,
    `X${coord(x0)}Y${coord(y0)}D01*`,
    'G37*',
  )
  let aperture = 11
  const flash = (pad: PlacedPad, polarity: 'LPC' | 'LPD', grow: number): void => {
    const w = pad.w + grow * 2
    const h = pad.h + grow * 2
    const round = pad.round || pad.drill !== undefined
    lines.push(
      round
        ? `%ADD${aperture}C,${Math.max(w, h).toFixed(4)}*%`
        : `%ADD${aperture}R,${w.toFixed(4)}X${h.toFixed(4)}*%`,
    )
    lines.push(`%${polarity}*%`, `D${aperture}*`, `X${coord(pad.x)}Y${coord(pad.y)}D03*`)
    aperture += 1
  }
  for (const pad of antiPads) flash(pad, 'LPC', clearance)
  lines.push('%LPD*%')
  for (const pad of connects) flash(pad, 'LPD', 0)
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
 *  and copper lands on the film for the layer it was routed on. */
export function buildFabPackage(
  components: PlacedComponent[],
  routedTraces: FabTrace[],
  options: FabOptions = {},
): FabPackage {
  const { boardWidth = 100, boardHeight = 80, profile = JLCPCB_1OZ, projectName = 'folio-pcb', vias = [], innerLayerCount = 0, nets, planes = [] } = options
  const films = fabFilms(innerLayerCount)
  const lastFilm = films.length - 1
  const violations: FabViolation[] = []
  const planeByFilm = new Map<FabFilm, FabPlane>()
  for (const plane of planes) {
    if (plane.film === 'top' || plane.film === 'bottom' || !films.includes(plane.film)) {
      violations.push({ rule: 'copper-layer', severity: 'error', message: `Plane "${plane.netName}" targets "${plane.film}", which is not an inner film of this ${films.length}-film package.`, elementId: `plane-${plane.film}` })
      continue
    }
    if (!plane.netName.trim()) {
      violations.push({ rule: 'plane-conflict', severity: 'error', message: `Plane on ${filmLabel(plane.film)} declares no net — refusing to pour unassigned copper.`, elementId: `plane-${plane.film}` })
      continue
    }
    if (planeByFilm.has(plane.film)) {
      violations.push({ rule: 'plane-conflict', severity: 'error', message: `Two planes target ${filmLabel(plane.film)}; one film can carry one pour.`, elementId: `plane-${plane.film}` })
      continue
    }
    planeByFilm.set(plane.film, plane)
  }
  const copper: Array<{ trace: FabTrace; film: FabFilm }> = []
  routedTraces.forEach((trace, index) => {
    if (trace.points.length < 2) return
    // Folding inner copper into an outer film would ship a board with the
    // wrong nets routed, so refuse it unless its film was declared.
    let film: FabFilm
    if (trace.layer === 'inner') {
      const innerIndex = trace.innerIndex
      if (innerIndex === undefined || innerIndex < 1 || innerIndex > innerLayerCount) {
        const capacity = innerLayerCount === 0 ? 'this package declares no inner films' : `this package has ${innerLayerCount} inner film(s)`
        violations.push({ rule: 'copper-layer', severity: 'error', message: `Trace ${index} is on "${trace.layerName ?? 'an inner layer'}"; ${capacity}. Pass innerLayerCount to export the stackup.`, elementId: `trace-${index}` })
        return
      }
      film = `inner-${innerIndex}`
    } else {
      film = trace.layer
    }
    const plane = planeByFilm.get(film)
    if (plane) {
      // A pour absorbs same-net copper; a foreign trace would be shorted to it.
      if (trace.netName !== plane.netName) {
        violations.push({ rule: 'plane-conflict', severity: 'error', message: `Trace ${index} (net "${trace.netName ?? 'unnamed'}") is routed on ${filmLabel(film)}, which is the "${plane.netName}" plane.`, elementId: `trace-${index}` })
      }
      return
    }
    copper.push({ trace, film })
    if (trace.width < profile.minTraceWidth) {
      violations.push({ rule: 'trace-width', severity: 'error', message: `Trace ${index} width ${trace.width} mm below ${profile.name} minimum.`, elementId: `trace-${index}` })
    }
  })
  for (let a = 0; a < copper.length; a += 1) {
    for (let b = a + 1; b < copper.length; b += 1) {
      // Clearance is a same-film rule: crossing on separate films is separated
      // by the laminate, so charging it would refuse legal multilayer boards.
      if (copper[a].film !== copper[b].film) continue
      // Copper on the same net is allowed to touch; different nets must clear.
      const netA = copper[a].trace.netName
      const netB = copper[b].trace.netName
      if (netA && netB && netA === netB) continue
      // Centre-line distance between the polylines, not just vertex distance:
      // two long crossing traces have distant vertices but zero clearance.
      const edge = polylineDistance(copper[a].trace.points, copper[b].trace.points)
        - (copper[a].trace.width + copper[b].trace.width) / 2
      if (edge < profile.minTraceSpacing) {
        violations.push({ rule: 'trace-spacing', severity: 'error', message: `Traces ${a}/${b} clear ${edge.toFixed(3)} mm, below minimum.`, elementId: `trace-${a}/trace-${b}` })
      }
    }
  }
  const pads: PlacedPad[] = []
  const throughDrills: Array<{ x: number; y: number; diameter: number }> = []
  const centroid: CentroidRow[] = []
  const bom: BomRow[] = []
  const silk: Record<FabSide, Array<{ x: number; y: number; text: string }>> = { top: [], bottom: [] }
  for (const component of components) {
    const footprint = resolveFootprint(component)
    if (!footprint) {
      violations.push({ rule: 'footprint', severity: 'error', message: `${component.reference} resolves to no IPC footprint — refusing to invent pads.`, elementId: component.id })
      continue
    }
    const placed = placedPads(component, footprint, nets)
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
      throughDrills.push({ x: pad.x, y: pad.y, diameter: pad.drill })
    }
    const side = componentSide(component)
    const value = String(component.properties.value ?? component.properties.resistance ?? component.properties.capacitance ?? '')
    centroid.push({ reference: component.reference, x: component.position.x, y: component.position.y, rotation: component.rotation, footprint: footprint.name, side: side === 'bottom' ? 'Bottom' : 'Top', value })
    bom.push({ reference: component.reference, value, footprint: footprint.name, manufacturer: String(component.properties.manufacturer ?? component.component.manufacturer ?? ''), partNumber: String(component.properties.partNumber ?? component.component.partNumber ?? '') })
    silk[side].push({ x: component.position.x, y: component.position.y + 2, text: component.reference })
  }
  const viaPads: PlacedPad[] = []
  const spanDrills = new Map<string, Array<{ x: number; y: number; diameter: number }>>()
  const spanLabels = new Map<string, string>()
  for (const via of vias) {
    const from = via.span?.fromFilm ?? 0
    const to = via.span?.toFilm ?? lastFilm
    const position = `${via.x.toFixed(2)}, ${via.y.toFixed(2)}`
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > lastFilm || from >= to) {
      violations.push({ rule: 'via-span', severity: 'error', message: `Via at ${position} spans films ${from}→${to}, not a valid range on a ${films.length}-film board.`, elementId: `${via.x}-${via.y}` })
      continue
    }
    const through = from === 0 && to === lastFilm
    const minDrill = through ? profile.minDrill : profile.minLaserDrill ?? profile.minDrill
    const minRing = through ? profile.minAnnularRing : profile.minMicroviaRing ?? profile.minAnnularRing
    if (via.drillDiameter < minDrill) {
      violations.push({ rule: 'drill', severity: 'error', message: `Via at ${position} drill ${via.drillDiameter} mm below the ${through ? 'mechanical' : 'laser'} minimum ${minDrill} mm.`, elementId: `${via.x}-${via.y}` })
    }
    const ring = (via.padDiameter - via.drillDiameter) / 2
    if (ring < minRing) {
      violations.push({ rule: 'annular-ring', severity: 'error', message: `Via at ${position} ring ${ring.toFixed(3)} mm below the ${through ? 'mechanical' : 'microvia'} minimum ${minRing} mm.`, elementId: `${via.x}-${via.y}` })
    }
    viaPads.push({
      x: via.x,
      y: via.y,
      w: via.padDiameter,
      h: via.padDiameter,
      round: true,
      drill: via.drillDiameter,
      layers: films.slice(from, to + 1),
      netName: via.netName,
    })
    if (through) {
      throughDrills.push({ x: via.x, y: via.y, diameter: via.drillDiameter })
    } else {
      const key = `${from}-${to}`
      const hits = spanDrills.get(key) ?? []
      hits.push({ x: via.x, y: via.y, diameter: via.drillDiameter })
      spanDrills.set(key, hits)
      spanLabels.set(key, `${filmLabel(films[from])}-${filmLabel(films[to])}`)
    }
  }
  /** Outer films flash the pads placed on them; inner films carry the barrels
   *  of every drilled pad, since a plated hole passes through the whole board. */
  const padsOnFilm = (film: FabFilm): PlacedPad[] => film === 'top' || film === 'bottom'
    ? pads.filter((pad) => onSide(pad, film))
    : pads.filter((pad) => pad.drill !== undefined)
  const topPads = padsOnFilm('top')
  const bottomPads = padsOnFilm('bottom')
  /** Net-aware pour geometry: barrels on the plane's net connect, every other
   *  barrel gets an anti-pad so the plane cannot short it. */
  const planeGeometry = new Map<FabFilm, { netName: string; clearance: number; connects: PlacedPad[]; antiPads: PlacedPad[] }>()
  const pours: FabPlanePour[] = []
  for (const film of films) {
    const plane = planeByFilm.get(film)
    if (!plane) continue
    const clearance = plane.clearance ?? profile.minTraceSpacing
    if (!(Number.isFinite(clearance) && clearance >= 0)) {
      violations.push({ rule: 'plane-conflict', severity: 'error', message: `Plane "${plane.netName}" on ${filmLabel(film)} declares clearance ${String(plane.clearance)}, which is not a non-negative number.`, elementId: `plane-${film}` })
      continue
    }
    const barrels = [...pads.filter((pad) => pad.drill !== undefined), ...viaPads.filter((pad) => pad.layers.includes(film))]
    const connects = barrels.filter((pad) => pad.netName !== undefined && pad.netName === plane.netName)
    const connected = new Set(connects)
    const antiPads = barrels.filter((pad) => !connected.has(pad))
    if (connects.length === 0) {
      violations.push({
        rule: 'plane-floating',
        severity: 'error',
        message: `Plane "${plane.netName}" on ${filmLabel(film)} connects to no pad or via on that net — it would be floating copper.`,
        elementId: `plane-${film}`,
      })
    }
    planeGeometry.set(film, { netName: plane.netName, clearance, connects, antiPads })
    pours.push({ film, netName: plane.netName, connections: connects.length, antiPads: antiPads.length })
  }
  const files = new Map<string, string>()
  for (const film of films) {
    const name = film === 'top'
      ? `${projectName}-F_Cu.gtl`
      : film === 'bottom'
        ? `${projectName}-B_Cu.gbl`
        : `${projectName}-${filmLabel(film)}_Cu.g${film.slice('inner-'.length)}`
    const pour = planeGeometry.get(film)
    if (pour) {
      files.set(name, gerberPlane(`${filmLabel(film)} plane (${pour.netName})`, boardWidth, boardHeight, pour.clearance, pour.connects, pour.antiPads))
      continue
    }
    const traces = copper.filter((entry) => entry.film === film).map((entry) => entry.trace)
    files.set(name, gerberCopper(`${filmLabel(film)} copper`, traces, [...padsOnFilm(film), ...viaPads.filter((pad) => pad.layers.includes(film))]))
  }
  files.set(`${projectName}-F_Mask.gts`, gerberMask('Top mask', topPads, profile.maskClearance))
  files.set(`${projectName}-B_Mask.gbs`, gerberMask('Bottom mask', bottomPads, profile.maskClearance))
  files.set(`${projectName}-F_Silk.gto`, gerberSilk('Top silk', silk.top))
  files.set(`${projectName}-B_Silk.gbo`, gerberSilk('Bottom silk', silk.bottom))
  files.set(`${projectName}-Edge_Cuts.gm1`, gerberOutline(boardWidth, boardHeight))
  files.set(`${projectName}.drl`, excellonDrill(throughDrills))
  for (const [key, hits] of spanDrills) {
    files.set(`${projectName}-${spanLabels.get(key)}.drl`, excellonDrill(hits))
  }
  files.set(`${projectName}-centroid.csv`, centroidCsv(centroid))
  files.set(`${projectName}-bom.csv`, bomCsv(bom))
  return { files, centroid, bom, violations, planes: pours, shippable: violations.length === 0 }
}

