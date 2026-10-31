/**
 * A routed, plane-poured board built entirely from the footprint library.
 *
 * Both demo boards (the 90 x 68 controller showcase and the laptop mainboard)
 * are the same construction: place parts whose lands come from
 * `footprintLibrary`, carry the rails and ground on poured inner films, stitch
 * every surface land on a plane net to its plane with a plated barrel of its own
 * net, pull each plane back from copper that is not its own, and let the real A*
 * autorouter produce the signal copper — including any net it fails to finish.
 *
 * Nothing here invents geometry. Every pad is the library's, every trace is the
 * router's, and the placement rules in `assertLandsClear` are checked before the
 * router runs, so a board that cannot physically exist fails loudly instead of
 * rendering prettily.
 */
import type { Net, PlacedComponent } from '../../types'
import type { PcbSceneInput, PcbSceneKeepout } from '../pcb/pcbScene'
import { edgeDistanceMm, landShapeOf, shapeCircumRadiusMm, shapeGapMm } from '../geometry/landShape'
import { autoroute, buildRouterPads, type RouterConfig, type RouterPad } from '../manufacturing/autorouter'
import { DEFAULT_DRC_RULES, DesignRuleChecker, type DRCResult } from '../manufacturing/drc'
import type { PCBDesign } from '../manufacturing/pcb'
import { resolveFootprint } from '../manufacturing/footprintLibrary'

export interface PlaneBoardPart {
  ref: string
  /** Footprint id from `footprintLibrary`; its pad count fixes `nets` length. */
  footprint: string
  value: string
  x: number
  y: number
  rotationDeg?: number
  /** One net name per footprint pad, in pad order. '' leaves the pad unconnected. */
  nets: string[]
  /** Moulding colour for the 3-D preview; omitted takes the family default. */
  color?: string
}

/** A plane net and the copper film it is poured on. */
export interface PlaneBoardPour {
  net: string
  layerId: string
  side: 'top' | 'bottom' | 'inner'
}

export interface PlaneBoardOutline {
  widthMm: number
  heightMm: number
  thicknessMm: number
  copperThicknessMm: number
}

export interface PlaneBoardSpec {
  /** Names this board in a failure, so the error says which design is broken. */
  name: string
  /** Prefix for generated trace and via ids, so two boards never collide. */
  idPrefix: string
  board: PlaneBoardOutline
  parts: PlaneBoardPart[]
  /** Nets the board carries on poured copper instead of routed traces. */
  planeNets: ReadonlySet<string>
  pours: PlaneBoardPour[]
  router: RouterConfig
  layers: PcbSceneInput['layers']
  /** Keep-in distance from the outline for every pour. */
  pourMarginMm: number
  /** Minimum spacing demanded between two different parts' copper. */
  landGapMm: number
  /** Clearance a plane keeps from copper that is not its own net. */
  planeClearanceMm: number
  /**
   * A surface land's preferred stitch ring: wide enough to etch, small enough to
   * sit inside the land it is joining. The board geometry decides the ring it
   * actually gets, because copper next door has a veto.
   */
  stitchPadFor: (land: { widthMm: number, depthMm: number }) => number
  /**
   * The plated hole used for plane stitches. This is deliberately not the
   * router's via: a 0.6/0.3 mm through via cannot fit between two 0.4 mm-pitch
   * balls, so a board that fans out a fine-pitch part stitches its planes with
   * the microvia geometry its fab sheet declares.
   */
  stitchVia: { drillMm: number, minAnnularRingMm: number }
}

export interface PlaneBoardLand {
  id: string
  ref: string
  net: string
  x: number
  y: number
  widthMm: number
  depthMm: number
  shape: 'circle' | 'rectangle' | 'oval'
  /** Rotation of the part that owns the land, in degrees — the frame `widthMm`/`depthMm` are measured in. */
  rotationDeg: number
  /** Board face the land sits on; only outer-layer pours see surface copper. */
  side: 'top' | 'bottom'
  /** 0 for a surface land; a plated land carries its own barrel through the stack. */
  drillMm: number
}

export interface PlaneBoardResult {
  scene: PcbSceneInput
  lands: PlaneBoardLand[]
  pads: ReturnType<typeof buildRouterPads>
  summary: {
    parts: number
    pads: number
    nets: number
    routedNets: number
    unrouted: string[]
    completion: number
    vias: number
    planeNets: string[]
    stitchVias: number
    /**
     * Plane lands with no room for a ring the fab can plate where they sit. They
     * are *not* connected to their plane, so this is a design error the layout has
     * to answer — a finer microvia, a wider pitch, or a dogbone fan-out — and the
     * board counts it rather than hiding it.
     */
    stitchSkipped: number
    keepouts: number
    traceLengthMm: number
    routeMs: number
  }
}

/** A plated barrel the scene knows about, seen from a plane's point of view. */
interface BarrelMark {
  x: number
  y: number
  net: string
  padDiameterMm: number
  drillDiameterMm: number
}

export function padCountOf(footprint: string, name: string): number {
  const resolved = resolveFootprint(footprint)
  if (!resolved) throw new Error(`${name}: footprint "${footprint}" is not in the library.`)
  return resolved.pads.length
}

export function categoryOf(footprint: string): string {
  return resolveFootprint(footprint)?.category ?? 'ic'
}

/**
 * The router wants a schematic-style component with pins, so each part carries
 * a package symbol: one pin per footprint land, all at the origin. The router
 * ignores symbol pin geometry once a land pattern resolves, so the pads it
 * routes are the real copper.
 */
export function toPlacedComponent(part: PlaneBoardPart): PlacedComponent {
  const pins = Array.from({ length: resolveFootprint(part.footprint)?.pads.length ?? 0 }, (_, index) => ({
    id: String(index + 1),
    x: 0,
    y: 0,
    name: String(index + 1),
  }))
  return {
    id: part.ref,
    componentId: `plane-board-${part.footprint}`,
    component: {
      id: `plane-board-${part.footprint}`,
      name: part.footprint,
      category: categoryOf(part.footprint),
      pins,
    } as unknown as PlacedComponent['component'],
    position: { x: part.x, y: part.y },
    rotation: part.rotationDeg ?? 0,
    scale: 1,
    reference: part.ref,
    properties: { footprint: part.footprint, value: part.value },
  }
}

export function netsFromParts(
  parts: PlaneBoardPart[],
  components: PlacedComponent[],
  planeNets: ReadonlySet<string>,
): Net[] {
  const byName = new Map<string, Net>()
  const placedIds = new Set(components.map((component) => component.id))
  for (const part of parts) {
    if (!placedIds.has(part.ref)) continue
    part.nets.forEach((net, index) => {
      // A plane net is carried by the poured copper, not by the router — this
      // is what a real board does, and it is why a 200-ball ground net does not
      // have to be threaded as a tree of thin traces.
      if (!net || planeNets.has(net)) return
      const entry = byName.get(net) ?? { id: net, name: net, connectedPins: [], wires: [] }
      entry.connectedPins.push({ componentId: part.ref, pinId: String(index + 1) })
      byName.set(net, entry)
    })
  }
  return Array.from(byName.values())
}

/** Every land on the board, in board millimetres, with the net it belongs to. */
export function landMarksOf(parts: PlaneBoardPart[]): PlaneBoardLand[] {
  const marks: PlaneBoardLand[] = []
  for (const part of parts) {
    const footprint = resolveFootprint(part.footprint)
    if (!footprint) continue
    const radians = ((part.rotationDeg ?? 0) * Math.PI) / 180
    const cos = Math.cos(radians)
    const sin = Math.sin(radians)
    footprint.pads.forEach((pad, index) => {
      marks.push({
        id: `${part.ref}.${index + 1}`,
        ref: part.ref,
        net: part.nets[index] ?? '',
        x: part.x + pad.position.x * cos - pad.position.y * sin,
        y: part.y + pad.position.x * sin + pad.position.y * cos,
        widthMm: pad.size.width,
        depthMm: pad.size.height,
        shape: pad.shape,
        rotationDeg: part.rotationDeg ?? 0,
        side: pad.layers.includes('top_copper') || !pad.layers.includes('bottom_copper') ? 'top' : 'bottom',
        drillMm: pad.drillDiameter ?? 0,
      })
    })
  }
  return marks
}

/**
 * The board's own placement rule: no two parts' copper may touch, and no land
 * may sit outside the outline or inside a pour's keep-in margin. Catching an
 * overlap here is what keeps a demo honest — a layout the router is claimed to
 * finish cannot have two nets printed on the same square of glass.
 *
 * Both tests use the land's real outline, so a part rotated 90° is measured
 * end-on rather than as the box its unrotated pattern would draw.
 *
 * Two gaps, because two different decisions are being checked. Between parts the
 * rule is the board's placement clearance (`landGapMm`, looser than the fab's):
 * where a part sits is the layout's choice. Inside one part the lands are fixed by
 * the footprint and nobody chose anything, so the test there is the fab's copper
 * spacing — a 0402's two lands are legitimately 0.2 mm apart, while two pins of the
 * same package closer than the spacing rule is a short, and was: TQFP-32's corner
 * lands, and the SOIC-8, DIP-8 and D2PAK-5 rows, all overlapped their own neighbour.
 */
export function assertLandsClear(
  marks: PlaneBoardLand[],
  board: PlaneBoardOutline,
  rules: { name: string, pourMarginMm: number, landGapMm: number, minCopperGapMm: number },
): void {
  const outsideBoard = marks.filter((mark) => {
    const { halfWidthMm, halfHeightMm } = landHalfExtentsMm(mark)
    return mark.x - halfWidthMm < rules.pourMarginMm
      || mark.y - halfHeightMm < rules.pourMarginMm
      || mark.x + halfWidthMm > board.widthMm - rules.pourMarginMm
      || mark.y + halfHeightMm > board.heightMm - rules.pourMarginMm
  })
  if (outsideBoard.length > 0) {
    throw new Error(
      `${rules.name}: lands outside the ${rules.pourMarginMm} mm keep-in edge: ${outsideBoard.map((mark) => mark.id).join(', ')}.`,
    )
  }

  const shapes = marks.map((mark) => landShapeOf(mark))
  const gaps: string[] = []
  for (let i = 0; i < marks.length; i += 1) {
    for (let j = i + 1; j < marks.length; j += 1) {
      const a = marks[i]
      const b = marks[j]
      // Copper of one net may touch its own — a package that gangs two pins, or a
      // tab that is the same rail as its neighbour.
      if (a.net !== '' && a.net === b.net) continue
      // Inside a part the lands are the footprint's, not the layout's, so the test
      // there is the fab's spacing rather than the board's placement gap. The
      // patterns themselves are audited in `footprintLibrary.test.ts`; this is the
      // board refusing to be built on a bad one.
      const requiredMm = a.ref === b.ref ? rules.minCopperGapMm : rules.landGapMm
      const dx = b.x - a.x
      const dy = b.y - a.y
      const reachMm = shapeCircumRadiusMm(shapes[i]) + shapeCircumRadiusMm(shapes[j]) + requiredMm
      // Two outlines cannot touch while further apart than their bounding discs.
      if (Math.hypot(dx, dy) >= reachMm) continue
      const gap = shapeGapMm(shapes[i], shapes[j], dx, dy)
      if (gap < requiredMm) gaps.push(`${a.id}/${b.id} (${gap.toFixed(2)} mm, needs ${requiredMm.toFixed(2)})`)
    }
  }
  if (gaps.length > 0) {
    throw new Error(
      `${rules.name}: ${gaps.length} land pair(s) closer than their clearance: ${gaps.slice(0, 8).join(', ')}${gaps.length > 8 ? ', …' : ''}.`,
    )
  }
}

/**
 * The axis-aligned half-extents a land casts on the board — its rotated bounding
 * box, which is what an outline edge test needs rather than the pattern's own
 * width and depth.
 */
function landHalfExtentsMm(land: PlaneBoardLand): { halfWidthMm: number, halfHeightMm: number } {
  const shape = landShapeOf(land)
  if (shape.kind === 'circle') return { halfWidthMm: shape.radiusMm, halfHeightMm: shape.radiusMm }
  // `shape.rotationRad`, not the part's: an oval's axis follows its long
  // dimension, so a land taller than wide points 90° from the body it belongs to.
  const rotationRad = shape.rotationRad
  const cos = Math.abs(Math.cos(rotationRad))
  const sin = Math.abs(Math.sin(rotationRad))
  if (shape.kind === 'oval') {
    // The spine leans by that rotation, and the disc that swept it adds its radius
    // whichever way it points.
    return {
      halfWidthMm: shape.halfSpanMm * cos + shape.radiusMm,
      halfHeightMm: shape.halfSpanMm * sin + shape.radiusMm,
    }
  }
  return {
    halfWidthMm: shape.halfWidthMm * cos + shape.halfHeightMm * sin,
    halfHeightMm: shape.halfWidthMm * sin + shape.halfHeightMm * cos,
  }
}

/**
 * Distance from a point offset `dx, dy` from a land's centre to that land's own
 * copper edge — negative once the point is inside the copper. The same outline
 * arithmetic the router reserves with and the DRC audits with, kept in one place
 * so a stitch plan and the copper it is checked against agree about what a
 * rotated oblong land is.
 */
function landEdgeDistanceMm(land: PlaneBoardLand, dx: number, dy: number): number {
  return edgeDistanceMm(landShapeOf(land), dx, dy)
}

/** Half the diagonal: the most copper a land can cast in any one direction. */
function landMaxReachMm(land: PlaneBoardLand): number {
  return shapeCircumRadiusMm(landShapeOf(land))
}

/**
 * The largest ring that may be centred on `mark` and still keep `clearanceMm` of
 * bare board from every piece of copper that is not its own net.
 *
 * Measured to each neighbour's real outline in the direction of travel, not to a
 * disc around it: a 0.3 x 1.5 mm QFP land reaches 0.75 mm end-on but only 0.15 mm
 * sideways, and the disc answer would refuse to stitch a land that the fab has
 * plenty of room for.
 */
function maxStitchRingMm(
  mark: PlaneBoardLand,
  marks: readonly PlaneBoardLand[],
  clearanceMm: number,
): number {
  let bestMm = Infinity
  for (const other of marks) {
    if (other === mark || other.net === mark.net) continue
    const dx = other.x - mark.x
    const dy = other.y - mark.y
    if (Math.hypot(dx, dy) - landMaxReachMm(other) - clearanceMm >= bestMm) continue
    bestMm = Math.min(bestMm, landEdgeDistanceMm(other, dx, dy) - clearanceMm)
  }
  return bestMm
}

/** One plane land and the ring it was given — or the reason it was given none. */
export interface PlaneStitchPlan {
  vias: PcbSceneInput['vias']
  /**
   * Lands whose plane connection could not be etched where they sit. Not a
   * silent drop: a fine-pitch part with no room for a microvia between its balls
   * needs a different land pattern or an HDI stackup, and the board says so.
   */
  unsitchable: Array<{ id: string, maxRingMm: number }>
}

/**
 * The plated stitches that join a plane net's surface lands to its pour. A
 * plated-through land is barrelled already and touches the plane on its own.
 *
 * A ring is the biggest disc this position can legally hold, capped by the
 * board's own via and floored by what a drill can be plated into: wanting 0.62 of
 * the land is not a licence to print a ring that short-circuits the neighbour
 * beside it, which is what the first version of this did to 25 pairs of stitches
 * on 0.4 mm-pitch copper.
 */
export function planeStitchVias(
  marks: readonly PlaneBoardLand[],
  planeNets: ReadonlySet<string>,
  stitch: { drillMm: number, minAnnularRingMm: number, maxPadMm: number },
  clearanceMm: number,
  stitchPadFor: PlaneBoardSpec['stitchPadFor'],
): PlaneStitchPlan {
  const smallestEtchableRingMm = stitch.drillMm + stitch.minAnnularRingMm * 2
  const vias: PcbSceneInput['vias'] = []
  const unsitchable: PlaneStitchPlan['unsitchable'] = []
  for (const mark of marks) {
    if (!planeNets.has(mark.net) || mark.drillMm !== 0) continue
    const wantedMm = Math.min(
      stitch.maxPadMm,
      Math.max(smallestEtchableRingMm, stitchPadFor(mark)),
    )
    const roomMm = maxStitchRingMm(mark, marks, clearanceMm)
    if (roomMm < wantedMm - 1e-9) {
      if (roomMm < smallestEtchableRingMm) {
        unsitchable.push({ id: mark.id, maxRingMm: roomMm })
        continue
      }
      vias.push(stitchOf(mark, roomMm, stitch))
      continue
    }
    vias.push(stitchOf(mark, wantedMm, stitch))
  }
  return { vias, unsitchable }
}

function stitchOf(
  mark: PlaneBoardLand,
  ringMm: number,
  stitch: { drillMm: number, minAnnularRingMm: number },
): PcbSceneInput['vias'][number] {
  return {
    id: `stitch-${mark.id}`,
    net: mark.net,
    x: mark.x,
    y: mark.y,
    padDiameterMm: ringMm,
    // A ring the room forced smaller than the declared via gets a smaller hole,
    // never a plating that cannot fit inside it.
    drillDiameterMm: Math.min(stitch.drillMm, ringMm - stitch.minAnnularRingMm * 2),
  }
}

/**
 * The board's copper as the router sees it: land to keep clear of, never copper
 * to connect. Two kinds qualify. A poured net is carried by its film, so
 * `netsFromParts` leaves its lands out of the pad list — which also left out
 * their *obstacle*, and both demo boards routed signal traces straight through a
 * ground land's position. And a land whose pin has no net in the netlist is on
 * the board for the fab but invisible to a router that only knows nets: a diode
 * with one end unconnected is the ordinary case. Each plane land carries the
 * stitch ring that will be drilled through it, because a via decided after
 * routing cannot be moved.
 */
function unplannedLandObstacles(
  marks: PlaneBoardLand[],
  planeNets: ReadonlySet<string>,
  stitches: PcbSceneInput['vias'],
): RouterPad[] {
  const ringAt = new Map(stitches.map((via) => [via.id, via.padDiameterMm]))
  return marks
    .filter((mark) => mark.net === '' || planeNets.has(mark.net))
    .map((mark) => ({
      netId: mark.net === '' ? `unconnected:${mark.id}` : mark.net,
      componentId: mark.ref,
      pinId: mark.id.slice(mark.ref.length + 1),
      x: mark.x,
      y: mark.y,
      layer: mark.side === 'top' ? 'F.Cu' : 'B.Cu',
      padWidthMm: mark.widthMm,
      padHeightMm: mark.depthMm,
      padShape: mark.shape,
      padRotationDeg: mark.rotationDeg,
      padDrillMm: mark.drillMm > 0 ? mark.drillMm : undefined,
      viaDiameterMm: ringAt.get(`stitch-${mark.id}`),
    }))
}

/**
 * Where one plane pulls back. Only copper that crosses the plane's layer can
 * short against it: barrels of other nets, and surface lands when the pour is
 * itself an outer layer on the same face. The plane's own barrels need a hole
 * just wide enough for the drill to read as a land, not a short.
 */
export function planeKeepouts(
  pour: PlaneBoardPour,
  marks: PlaneBoardLand[],
  barrels: BarrelMark[],
  clearanceMm: number,
): PcbSceneKeepout[] {
  const holes: PcbSceneKeepout[] = []
  for (const mark of marks) {
    if (mark.net === pour.net) {
      if (mark.drillMm > 0) {
        holes.push({
          x: mark.x,
          y: mark.y,
          widthMm: mark.drillMm + 0.4,
          depthMm: mark.drillMm + 0.4,
          shape: 'circle',
        })
      }
      continue
    }
    if (mark.drillMm > 0 || pour.side === mark.side) {
      holes.push({
        x: mark.x,
        y: mark.y,
        widthMm: mark.widthMm + clearanceMm * 2,
        depthMm: mark.depthMm + clearanceMm * 2,
        shape: mark.shape === 'rectangle' ? 'rectangle' : 'circle',
      })
    }
  }
  for (const barrel of barrels) {
    if (barrel.net === pour.net) continue
    holes.push({
      x: barrel.x,
      y: barrel.y,
      widthMm: barrel.padDiameterMm + clearanceMm * 2,
      depthMm: barrel.padDiameterMm + clearanceMm * 2,
      shape: 'circle',
    })
  }
  return holes
}

/**
 * Build the board: validate the placement, route the signals, then describe the
 * whole assembly as a `PcbSceneInput` so the 2-D canvas, the 3-D viewer, the DRC
 * and the fabrication export all speak about the same copper.
 */
export function buildPlaneBoard(spec: PlaneBoardSpec): PlaneBoardResult {
  for (const part of spec.parts) {
    const lands = padCountOf(part.footprint, spec.name)
    if (part.nets.length !== lands && part.nets.length !== 0) {
      throw new Error(
        `${spec.name}: ${part.ref} (${part.footprint}) has ${lands} lands but ${part.nets.length} net entries.`,
      )
    }
  }

  const components = spec.parts.map(toPlacedComponent)
  const nets = netsFromParts(spec.parts, components, spec.planeNets)
  const pads = buildRouterPads(components, nets)
  const marks = landMarksOf(spec.parts)
  assertLandsClear(marks, spec.board, {
    name: spec.name,
    pourMarginMm: spec.pourMarginMm,
    landGapMm: spec.landGapMm,
    minCopperGapMm: spec.router.minSpacingMm,
  })

  // The stitch plan is decided here, before the search, and handed to the router
  // as copper those lands will own. A via drilled after routing sits wherever the
  // pour needed a connection and cannot be moved: on both demo boards it landed
  // with 0.0 mm to a signal trace because the router had never heard of it.
  const { vias: stitches, unsitchable } = planeStitchVias(
    marks,
    spec.planeNets,
    { ...spec.stitchVia, maxPadMm: spec.router.viaPadMm },
    spec.router.minSpacingMm,
    spec.stitchPadFor,
  )
  const obstacles = unplannedLandObstacles(marks, spec.planeNets, stitches)

  const started = Date.now()
  const routed = autoroute(pads, spec.router, obstacles)
  const routeMs = Date.now() - started

  const routedVias = routed.vias.map((via, index) => ({
    id: `${spec.idPrefix}-via-${index}`,
    net: via.netId,
    x: via.x,
    y: via.y,
    padDiameterMm: via.padMm,
    drillDiameterMm: via.drillMm,
  }))
  const barrels: BarrelMark[] = [
    ...routedVias.map((via) => ({
      x: via.x,
      y: via.y,
      net: via.net ?? '',
      padDiameterMm: via.padDiameterMm,
      drillDiameterMm: via.drillDiameterMm,
    })),
    ...stitches.map((via) => ({
      x: via.x,
      y: via.y,
      net: via.net ?? '',
      padDiameterMm: via.padDiameterMm,
      drillDiameterMm: via.drillDiameterMm,
    })),
  ]
  const pours = spec.pours.map((pour) => ({
    id: `${pour.net.toLowerCase()}-plane`,
    net: pour.net,
    layerId: pour.layerId,
    marginMm: spec.pourMarginMm,
    keepouts: planeKeepouts(pour, marks, barrels, spec.planeClearanceMm),
  }))
  const keepoutCount = pours.reduce((total, pour) => total + (pour.keepouts?.length ?? 0), 0)

  const scene: PcbSceneInput = {
    widthMm: spec.board.widthMm,
    heightMm: spec.board.heightMm,
    thicknessMm: spec.board.thicknessMm,
    copperThicknessMm: spec.board.copperThicknessMm,
    layers: spec.layers,
    traces: routed.traces.map((trace, index) => ({
      id: `${spec.idPrefix}-trace-${index}`,
      net: trace.netId,
      layerId: trace.layerId === 'B.Cu' ? 'bot-cu' : 'top-cu',
      widthMm: trace.widthMm,
      points: trace.points,
    })),
    vias: [...routedVias, ...stitches],
    components: spec.parts.map((part) => ({
      id: part.ref,
      reference: part.ref,
      footprint: part.footprint,
      category: categoryOf(part.footprint),
      x: part.x,
      y: part.y,
      rotationDeg: part.rotationDeg ?? 0,
      side: 'top' as const,
      color: part.color,
    })),
    // One rectangular pour per plane net: the shape a real board uses for a
    // ground or power film, and the only pour shape these layouts declare.
    pours,
  }

  return {
    scene,
    lands: marks,
    pads,
    summary: {
      parts: spec.parts.length,
      pads: pads.length,
      nets: routed.stats.totalNets,
      routedNets: routed.stats.routedNets,
      unrouted: routed.unrouted,
      completion: routed.completionRate,
      vias: routed.stats.totalVias,
      planeNets: Array.from(spec.planeNets),
      stitchVias: stitches.length,
      stitchSkipped: unsitchable.length,
      keepouts: keepoutCount,
      traceLengthMm: routed.stats.totalTraceLength,
      routeMs,
    },
  }
}

/**
 * The finished board as the rule checker's own input: the scene's traces and
 * vias, every land the layout printed, and the rules the board was routed at.
 *
 * A plane board exists as a scene, not as a store project, so this is the only way
 * to audit its copper with the real `DesignRuleChecker` instead of trusting the
 * router's own bookkeeping. Lands keep their rotation and their barrel: a drilled
 * land is copper on both faces, which is what makes a bottom-side trace crossing a
 * through-hole a short rather than a clean pass.
 */
export function planeBoardDesign(
  spec: PlaneBoardSpec,
  scene: PcbSceneInput,
  lands: PlaneBoardLand[],
): PCBDesign {
  const bothFaces = ['top-cu', 'bot-cu']
  return {
    id: spec.name,
    name: spec.name,
    dimensions: {
      width: spec.board.widthMm,
      height: spec.board.heightMm,
      thickness: spec.board.thicknessMm,
    },
    layers: [],
    traces: scene.traces.map((trace) => ({
      id: trace.id,
      netId: trace.net,
      layerId: trace.layerId,
      width: trace.widthMm,
      points: trace.points,
      clearance: spec.router.minSpacingMm,
    })),
    vias: scene.vias.map((via) => ({
      id: via.id,
      position: { x: via.x, y: via.y },
      diameter: via.padDiameterMm,
      drillDiameter: via.drillDiameterMm,
      layers: bothFaces,
      netId: via.net,
    })),
    pads: lands
      .filter((land) => land.net !== '')
      .map((land) => ({
        id: land.id,
        componentId: land.ref,
        pinId: land.id.slice(land.ref.length + 1),
        position: { x: land.x, y: land.y },
        shape: land.shape,
        size: { width: land.widthMm, height: land.depthMm },
        rotationDeg: land.rotationDeg,
        drillDiameter: land.drillMm > 0 ? land.drillMm : undefined,
        layers: land.drillMm > 0 ? bothFaces : [land.side === 'top' ? 'top-cu' : 'bot-cu'],
        netId: land.net,
      })),
    components: [],
    nets: [],
    designRules: {
      minTraceWidth: spec.router.minTraceWidthMm,
      minTraceSpacing: spec.router.minSpacingMm,
      minViaDiameter: spec.router.viaPadMm,
      minViaDrillDiameter: spec.router.viaDrillMm,
      minPadDiameter: spec.stitchVia.minAnnularRingMm * 2 + spec.stitchVia.drillMm,
      minHoleDiameter: spec.stitchVia.drillMm,
      copperThickness: spec.board.copperThicknessMm,
      solderMaskClearance: 0.05,
      silkScreenClearance: 0.1,
    },
  }
}

/**
 * `DesignRuleChecker` over a plane board, at the board's own declared rules.
 *
 * "Its own declared rules" means the *tightest* figure on the spec, so a board
 * that says it builds a 0.1 mm / 0.05 ring microvia is audited against 0.1 mm and
 * 0.05 ring — every via it lays, stitched or routed, has to clear the process it
 * claims. Auditing the stitches against the router's 0.3 mm through-via rule
 * instead would be a different claim, and one the demo never made.
 *
 * What this does not measure, and cannot from a `PcbSceneInput`:
 *
 * - **Blind and buried vs through.** A scene via carries an x/y, a pad and a
 *   drill — no layer span — so the checker sees every hole as a through barrel.
 *   A 0.1 mm laser microvia is blind by construction, and 0.1 mm through 1.6 mm
 *   is a 16:1 aspect ratio a standard through-hole fab will not drill: these
 *   boards are HDI-class in their stitching, and the 3-D view draws a full barrel
 *   because the scene has no way to say otherwise. Drill-to-thickness ratio is
 *   not a rule in `DRCSettings` at all.
 * - **Courtyard overlap.** These layouts place parts by their land patterns and
 *   the checker's courtyard comes from a schematic symbol box, so a plane-board
 *   courtyard result would be measuring the wrong geometry. The pattern audit in
 *   `footprintLibrary.test.ts` and `assertLandsClear` above are what keep lands
 *   and bodies apart on a board like this.
 *
 * Unconnected-net, acute-angle and trace-length rules are left off: a plane board
 * carries its rails as pours, which the checker would read as unconnected, and the
 * other two are SI questions rather than fab-ability.
 */
export function planeBoardDrc(
  spec: PlaneBoardSpec,
  scene: PcbSceneInput,
  lands: PlaneBoardLand[],
): DRCResult {
  /** The smallest annular copper this board's process is asked to print. */
  const microviaPadMm = spec.stitchVia.drillMm + 2 * spec.stitchVia.minAnnularRingMm
  return new DesignRuleChecker(planeBoardDesign(spec, scene, lands), {
    ...DEFAULT_DRC_RULES,
    minTraceWidth: spec.router.minTraceWidthMm,
    minTraceClearance: spec.router.minSpacingMm,
    minViaDiameter: Math.min(spec.router.viaPadMm, microviaPadMm),
    minViaDrillDiameter: Math.min(spec.router.viaDrillMm, spec.stitchVia.drillMm),
    minHoleDiameter: spec.stitchVia.drillMm,
    minAnnularRing: spec.stitchVia.minAnnularRingMm,
    checkUnconnectedNets: false,
    checkAcuteAngles: false,
    checkTraceLength: false,
  }).runDRC()
}
