/**
 * EDA tools wired to the live board (never stubs).
 *
 * `eda.route` runs the same placement and autorouter as the PCB panel and
 * publishes the result to `useProjectStore`, so the 2-D canvas and 3-D preview
 * show the agent's copper immediately. `eda.drc` checks that routed copper with
 * `DesignRuleChecker`; `eda.exportFab` builds the real Gerber/Excellon package.
 * Headless callers that have no store can pass the sheet as JSON instead.
 */
import { AgentHarness, type AgentTool } from './agentHarness'
import { spiceEngine, type CircuitNetlist } from '../simulation/spiceEngine'
import { buildFabPackage, fabTracesFromWires, JLCPCB_1OZ, type FabOptions, type FabProfile } from '../manufacturing/fabExport'
import { DesignRuleChecker, type DRCSettings, type DRCViolation } from '../manufacturing/drc'
import { polylineDistance } from '../geometry/distance'
import type { PCBDesign } from '../manufacturing/pcb'
import type { PcbSceneInput } from '../pcb/pcbScene'
import {
  fabCopperFromRoutedTraces,
  netsFromWires,
  placeFromRoutedLayout,
  placeSchematicOnBoard,
  routePlacedBoard,
  sceneFromRouting,
  type BoardSize,
} from '../pcb/boardLayout'
import { useProjectStore, type CanvasComponent, type CanvasWire } from '../../stores/useProjectStore'
import type { FabWireInput } from '../manufacturing/fabExport'
import { capturePcbSnapshot, pcbToSvg } from './pcbSnapshot'

export interface EdaPlanStep { tool: string; args: Record<string, string | number | boolean>; rationale: string; }
export interface EdaPlan { goal: string; steps: EdaPlanStep[]; needsApproval: string[]; }

/** Real simulation: validate + run the netlist through the SPICE engine. */
async function realSimulate(args: Record<string, string | number | boolean>): Promise<unknown> {
  const raw = args['netlist'];
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('eda.simulate needs a netlist JSON string.');
  let netlist: CircuitNetlist;
  try {
    netlist = JSON.parse(raw) as CircuitNetlist;
  } catch {
    throw new Error('eda.simulate: netlist is not valid JSON.');
  }
  if (!netlist || !Array.isArray(netlist.components)) throw new Error('eda.simulate needs a netlist object.');
  const validation = await spiceEngine.validateNetlist(netlist);
  if (!validation.isValid) throw new Error(`Netlist invalid: ${validation.errors.join('; ')}`);
  return spiceEngine.simulate(netlist);
}

interface SheetPayload {
  components: CanvasComponent[]
  wires: CanvasWire[]
}

/**
 * Live sheet wins, because it is what the human is looking at. The JSON
 * fallback keeps headless plans (no store, no browser) working. Payload
 * coordinates are canvas units, the same space `CanvasComponent.x` uses.
 */
function readSheet(args: Record<string, string | number | boolean>): { sheet: SheetPayload; source: 'store' | 'payload' } {
  const store = useProjectStore.getState()
  if (store.components.length > 0) {
    return { sheet: { components: store.components, wires: store.wires }, source: 'store' }
  }
  const raw = args['schematic'] ?? args['components']
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error('eda.route needs a live sheet or a schematic JSON payload with components + wires.')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('eda.route: schematic is not valid JSON.')
  }
  const record = (parsed ?? {}) as { components?: unknown; wires?: unknown }
  if (!Array.isArray(record.components)) throw new Error('eda.route: schematic needs a components array.')
  const components = (record.components as Array<CanvasComponent & { position?: { x: number; y: number } }>).map((component) => ({
    ...component,
    x: Number.isFinite(component.x) ? component.x : component.position?.x ?? 0,
    y: Number.isFinite(component.y) ? component.y : component.position?.y ?? 0,
  }))
  const wires = Array.isArray(record.wires) ? record.wires as CanvasWire[] : []
  return { sheet: { components, wires }, source: 'payload' }
}

function readBoardSize(args: Record<string, string | number | boolean>): BoardSize | undefined {
  const width = Number(args['boardWidth'])
  const height = Number(args['boardHeight'])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined
  return { width, height }
}

/** Real route: place + autoroute the sheet and publish the board for preview. */
async function realRoute(args: Record<string, string | number | boolean>): Promise<unknown> {
  const { sheet, source } = readSheet(args)
  if (sheet.components.length === 0) throw new Error('eda.route: the sheet has no components to place.')
  const size = readBoardSize(args)
  const placement = placeSchematicOnBoard(sheet.components, size)
  const routing = routePlacedBoard(placement.components, sheet.wires, placement.size)
  const layout = sceneFromRouting(placement.components, placement.size, routing)
  useProjectStore.getState().setPcbLayout(layout)
  return {
    published: true,
    source,
    board: { widthMm: placement.size.width, heightMm: placement.size.height },
    components: layout.components.length,
    traces: layout.traces.length,
    vias: layout.vias.length,
    unrouted: routing.result.unrouted,
    completionRate: Number(routing.result.completionRate.toFixed(3)),
    stats: routing.result.stats,
  }
}

/**
 * Move one placed part and re-route atomically.
 *
 * A moved pad invalidates every trace that ended on it; publishing the old
 * copper with a moved body would let DRC call a broken board shippable. The
 * tool therefore re-runs the real autorouter over the updated placement and
 * reports any net it could not finish.
 */
async function realMovePart(args: Record<string, string | number | boolean>): Promise<unknown> {
  const reference = String(args['reference'] ?? '').trim()
  if (!reference) throw new Error('eda.movePart needs the reference designator (or component id) to move.')
  const x = Number(args['x'])
  const y = Number(args['y'])
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error('eda.movePart needs finite x/y board coordinates in millimetres.')
  }

  const store = useProjectStore.getState()
  const layout = store.pcbLayout
  if (!layout) throw new Error('eda.movePart: no routed board. Run eda.route first.')
  if (store.components.length === 0 || store.wires.length === 0) {
    throw new Error(
      'eda.movePart: the live schematic (components + wires) is required to re-route the moved part; payload-only boards are read-only.',
    )
  }

  const placement = placeFromRoutedLayout(store.components, layout)
  const target = placement.components.find(
    (component) => component.reference === reference || component.id === reference,
  )
  if (!target) throw new Error(`eda.movePart: no placed part with reference "${reference}" on the routed board.`)

  const rotation = args['rotation'] === undefined ? target.rotation : Number(args['rotation'])
  if (!Number.isFinite(rotation)) throw new Error('eda.movePart: rotation must be a finite angle in degrees.')

  const body = capturePcbSnapshot(layout).components.find(
    (component) => component.id === target.id || component.reference === target.reference,
  )?.body
  const radians = (rotation * Math.PI) / 180
  const halfWidth = body
    ? Math.abs((body.widthMm / 2) * Math.cos(radians)) + Math.abs((body.depthMm / 2) * Math.sin(radians))
    : 0
  const halfDepth = body
    ? Math.abs((body.widthMm / 2) * Math.sin(radians)) + Math.abs((body.depthMm / 2) * Math.cos(radians))
    : 0
  if (
    x - halfWidth < 0 || x + halfWidth > layout.widthMm
    || y - halfDepth < 0 || y + halfDepth > layout.heightMm
  ) {
    throw new Error(
      `eda.movePart: ${target.reference} at (${x}, ${y}) would put its body outside the ${layout.widthMm} x ${layout.heightMm} mm board.`,
    )
  }

  const moved = placement.components.map((component) => (
    component === target ? { ...component, position: { x, y }, rotation } : component
  ))
  const routing = routePlacedBoard(moved, store.wires, placement.size)
  const next = sceneFromRouting(moved, placement.size, routing)
  useProjectStore.getState().setPcbLayout(next)

  return {
    published: true,
    reference: target.reference,
    position: { x, y },
    rotation,
    traces: next.traces.length,
    vias: next.vias.length,
    unrouted: routing.result.unrouted,
    completionRate: Number(routing.result.completionRate.toFixed(3)),
    warnings: capturePcbSnapshot(next).warnings.map((warning) => warning.message),
  }
}

/**
 * Add copper the autorouter did not produce (a stub, a repair, an antenna).
 * Off-board points are refused rather than clipped; clearance and net
 * conflicts are left to `eda.drc`, which the agent should run next.
 */
async function realAddTrace(args: Record<string, string | number | boolean>): Promise<unknown> {
  const layout = useProjectStore.getState().pcbLayout
  if (!layout) throw new Error('eda.addTrace: no routed board. Run eda.route first.')
  const net = String(args['net'] ?? '').trim()
  if (!net) throw new Error('eda.addTrace needs the net name the copper belongs to.')
  const layerId = String(args['layerId'] ?? 'top-cu')
  const layer = layout.layers.find((entry) => entry.id === layerId)
  if (!layer || layer.kind !== 'copper') {
    throw new Error(`eda.addTrace: "${layerId}" is not a copper layer on this board.`)
  }
  const widthMm = args['widthMm'] === undefined ? 0.25 : Number(args['widthMm'])
  if (!Number.isFinite(widthMm) || widthMm <= 0) {
    throw new Error('eda.addTrace: widthMm must be a positive number.')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(String(args['points'] ?? ''))
  } catch {
    throw new Error('eda.addTrace: points must be a JSON array of {x, y} board coordinates.')
  }
  if (!Array.isArray(parsed) || parsed.length < 2) {
    throw new Error('eda.addTrace: points needs at least two {x, y} vertices.')
  }
  const points = parsed.map((entry, index) => {
    const point = (entry ?? {}) as { x?: unknown; y?: unknown }
    const x = Number(point.x)
    const y = Number(point.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error(`eda.addTrace: vertex ${index} is not a finite {x, y} point.`)
    }
    if (x < 0 || x > layout.widthMm || y < 0 || y > layout.heightMm) {
      throw new Error(`eda.addTrace: vertex ${index} (${x}, ${y}) is outside the ${layout.widthMm} x ${layout.heightMm} mm board.`)
    }
    return { x, y }
  })
  for (let index = 0; index + 1 < points.length; index += 1) {
    if (points[index].x === points[index + 1].x && points[index].y === points[index + 1].y) {
      throw new Error(`eda.addTrace: vertices ${index} and ${index + 1} are identical.`)
    }
  }

  const ids = new Set(layout.traces.map((trace) => trace.id))
  let sequence = layout.traces.length + 1
  while (ids.has(`agent-trace-${sequence}`)) sequence += 1
  const trace = { id: `agent-trace-${sequence}`, net, layerId, widthMm, points }
  const next: PcbSceneInput = { ...layout, traces: [...layout.traces, trace] }
  useProjectStore.getState().setPcbLayout(next)
  return {
    published: true,
    trace,
    traces: next.traces.length,
    warnings: capturePcbSnapshot(next).warnings.map((warning) => warning.message),
  }
}

/** Drop a plated via on the routed board. DRC checks the annular ring. */
async function realAddVia(args: Record<string, string | number | boolean>): Promise<unknown> {
  const layout = useProjectStore.getState().pcbLayout
  if (!layout) throw new Error('eda.addVia: no routed board. Run eda.route first.')
  const net = String(args['net'] ?? '').trim()
  if (!net) throw new Error('eda.addVia needs the net name the via belongs to.')
  const x = Number(args['x'])
  const y = Number(args['y'])
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error('eda.addVia needs finite x/y board coordinates in millimetres.')
  }
  if (x < 0 || x > layout.widthMm || y < 0 || y > layout.heightMm) {
    throw new Error(`eda.addVia: (${x}, ${y}) is outside the ${layout.widthMm} x ${layout.heightMm} mm board.`)
  }
  const padDiameterMm = args['padDiameterMm'] === undefined ? 0.6 : Number(args['padDiameterMm'])
  const drillDiameterMm = args['drillDiameterMm'] === undefined ? 0.3 : Number(args['drillDiameterMm'])
  if (!Number.isFinite(padDiameterMm) || !Number.isFinite(drillDiameterMm)) {
    throw new Error('eda.addVia: pad and drill diameters must be finite numbers.')
  }
  if (padDiameterMm <= drillDiameterMm || drillDiameterMm <= 0) {
    throw new Error('eda.addVia: the pad must be larger than a positive drill.')
  }

  const ids = new Set(layout.vias.map((via) => via.id))
  let sequence = layout.vias.length + 1
  while (ids.has(`agent-via-${sequence}`)) sequence += 1
  const via = { id: `agent-via-${sequence}`, net, x, y, padDiameterMm, drillDiameterMm }
  const next: PcbSceneInput = { ...layout, vias: [...layout.vias, via] }
  useProjectStore.getState().setPcbLayout(next)
  return {
    published: true,
    via,
    vias: next.vias.length,
    warnings: capturePcbSnapshot(next).warnings.map((warning) => warning.message),
  }
}

/**
 * Observe the routed board. The live layout wins because it is what the 2-D
 * canvas and 3-D preview draw; a board payload keeps headless callers working.
 */
async function realObserve(args: Record<string, string | number | boolean>): Promise<unknown> {
  const raw = args['board']
  let layout: PcbSceneInput
  let source: 'store' | 'payload'
  if (typeof raw === 'string' && raw.trim()) {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error('eda.observe: board is not valid JSON.')
    }
    const record = (parsed ?? {}) as Partial<PcbSceneInput>
    if (
      !Number.isFinite(record.widthMm)
      || !Number.isFinite(record.heightMm)
      || !Array.isArray(record.layers)
      || !Array.isArray(record.traces)
    ) {
      throw new Error('eda.observe: board payload needs widthMm, heightMm, layers, traces and components.')
    }
    layout = {
      ...record,
      vias: Array.isArray(record.vias) ? record.vias : [],
      components: Array.isArray(record.components) ? record.components : [],
    } as PcbSceneInput
    source = 'payload'
  } else {
    const live = useProjectStore.getState().pcbLayout
    if (!live) throw new Error('eda.observe: no routed board. Run eda.route first or pass a board JSON payload.')
    layout = live
    source = 'store'
  }
  return {
    source,
    snapshot: capturePcbSnapshot(layout),
    svg: pcbToSvg(layout),
  }
}

/** Only the JLCPCB profile is implemented; refuse to pretend otherwise. */
function fabProfileFromArg(raw: unknown): FabProfile {
  const name = String(raw ?? 'JLCPCB_1oz')
  if (/jlc/i.test(name)) return JLCPCB_1OZ
  throw new Error(`Unknown fab profile "${name}". Supported profiles: JLCPCB_1oz.`)
}

function rulesFromProfile(profile: FabProfile): Partial<DRCSettings> {
  const viaDiameter = profile.minDrill + profile.minAnnularRing * 2
  return {
    minTraceWidth: profile.minTraceWidth,
    minTraceClearance: profile.minTraceSpacing,
    // The profile states the drill and the ring separately; subtract an epsilon
    // so a via built at exactly those minima is not rejected by float noise.
    minViaDiameter: Math.max(0, viaDiameter - 1e-9),
    minViaDrillDiameter: profile.minDrill,
    minHoleDiameter: profile.minDrill,
    minAnnularRing: profile.minAnnularRing,
  }
}

function designFromLayout(layout: PcbSceneInput, profile: FabProfile): PCBDesign {
  const nets = new Set<string>()
  for (const trace of layout.traces) if (trace.net) nets.add(trace.net)
  for (const via of layout.vias) if (via.net) nets.add(via.net)
  return {
    id: 'agent-routed-board',
    name: 'Routed board',
    dimensions: { width: layout.widthMm, height: layout.heightMm, thickness: layout.thicknessMm },
    layers: layout.layers.map((layer) => ({
      id: layer.id,
      name: layer.name,
      type: layer.kind === 'copper' ? 'copper' : layer.kind === 'silk' ? 'silk_screen' : 'solder_mask',
      thickness: layer.thicknessMm ?? 0.035,
      material: layer.kind === 'copper' ? 'copper' : 'solder_mask',
    })),
    traces: layout.traces.map((trace) => ({
      id: trace.id,
      netId: trace.net,
      layerId: trace.layerId,
      width: trace.widthMm,
      points: trace.points,
      clearance: profile.minTraceSpacing,
    })),
    vias: layout.vias.map((via) => ({
      id: via.id,
      position: { x: via.x, y: via.y },
      diameter: via.padDiameterMm,
      drillDiameter: via.drillDiameterMm,
      layers: ['top-cu', 'bot-cu'],
      netId: via.net,
    })),
    // Copper geometry is authoritative; footprint courtyards are not stored in
    // the scene, and inventing them here would report parts that are not drawn.
    pads: [],
    components: [],
    nets: Array.from(nets).map((name) => ({ id: name, name, connectedPins: [], wires: [] })),
    designRules: {
      minTraceWidth: profile.minTraceWidth,
      minTraceSpacing: profile.minTraceSpacing,
      minViaDiameter: profile.minDrill + profile.minAnnularRing * 2,
      minViaDrillDiameter: profile.minDrill,
      minPadDiameter: 0.2,
      minHoleDiameter: profile.minDrill,
      copperThickness: 0.035,
      solderMaskClearance: profile.maskClearance,
      silkScreenClearance: 0.15,
    },
  }
}

interface RoutedDrcReport {
  isValid: boolean
  violations: DRCViolation[]
  summary: { errors: number; warnings: number; totalViolations: number }
  unroutedNets: string[]
  splitNets: Array<{ net: string; groups: number }>
  traces: number
  vias: number
}

/** Connected copper groups among one net's traces and vias. Two elements are
 *  joined when their copper touches, so a net the router only partly finished
 *  is reported as split instead of passing on the strength of any copper. */
function copperGroups(layout: PcbSceneInput, netId: string): number {
  const traces = layout.traces.filter((trace) => trace.net === netId)
  const vias = layout.vias.filter((via) => via.net === netId)
  const count = traces.length + vias.length
  if (count <= 1) return count
  const parent = Array.from({ length: count }, (_, index) => index)
  const find = (index: number): number => {
    let root = index
    while (parent[root] !== root) root = parent[root]
    while (parent[index] !== root) {
      const next = parent[index]
      parent[index] = root
      index = next
    }
    return root
  }
  const union = (a: number, b: number): void => {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA !== rootB) parent[rootB] = rootA
  }
  const touching = (gap: number): boolean => gap <= 1e-6
  for (let i = 0; i < traces.length; i += 1) {
    for (let j = i + 1; j < traces.length; j += 1) {
      const a = traces[i]
      const b = traces[j]
      if (a.layerId !== b.layerId) continue
      if (touching(polylineDistance(a.points, b.points) - (a.widthMm + b.widthMm) / 2)) union(i, j)
    }
  }
  for (let i = 0; i < traces.length; i += 1) {
    const trace = traces[i]
    for (let j = 0; j < vias.length; j += 1) {
      const via = vias[j]
      const gap = polylineDistance(trace.points, [{ x: via.x, y: via.y }])
        - trace.widthMm / 2 - via.padDiameterMm / 2
      if (touching(gap)) union(i, traces.length + j)
    }
  }
  for (let i = 0; i < vias.length; i += 1) {
    for (let j = i + 1; j < vias.length; j += 1) {
      const a = vias[i]
      const b = vias[j]
      const gap = Math.hypot(a.x - b.x, a.y - b.y) - (a.padDiameterMm + b.padDiameterMm) / 2
      if (touching(gap)) union(traces.length + i, traces.length + j)
    }
  }
  const roots = new Set<number>()
  for (let index = 0; index < count; index += 1) roots.add(find(index))
  return roots.size
}

/** DRC of the copper the board actually carries, plus obviously unrouted nets. */
function checkRoutedLayout(layout: PcbSceneInput, profile: FabProfile): RoutedDrcReport {
  const design = designFromLayout(layout, profile)
  const result = new DesignRuleChecker(design, rulesFromProfile(profile)).runDRC()
  const sheetNets = netsFromWires(useProjectStore.getState().wires)
  const unroutedNets: string[] = []
  const splitNets: Array<{ net: string; groups: number }> = []
  for (const net of sheetNets) {
    if (net.connectedPins.length < 2) continue
    const traces = layout.traces.filter((trace) => trace.net === net.id)
    const vias = layout.vias.filter((via) => via.net === net.id)
    if (traces.length + vias.length === 0) {
      unroutedNets.push(net.id)
      continue
    }
    const groups = copperGroups(layout, net.id)
    if (groups > 1) splitNets.push({ net: net.id, groups })
  }
  const violations: DRCViolation[] = [...result.violations]
  for (const netId of unroutedNets) {
    violations.push({
      type: 'unconnected_net',
      severity: 'warning',
      message: `Net "${netId}" has terminals but no routed copper`,
      location: { x: 0, y: 0 },
      elementId: netId,
    })
  }
  for (const problem of splitNets) {
    violations.push({
      type: 'unconnected_net',
      severity: 'warning',
      message: `Net "${problem.net}" copper is split into ${problem.groups} disconnected groups`,
      location: { x: 0, y: 0 },
      elementId: problem.net,
    })
  }
  const errors = violations.filter((violation) => violation.severity === 'error').length
  const warnings = violations.filter((violation) => violation.severity === 'warning').length
  return {
    isValid: errors === 0,
    violations,
    summary: { errors, warnings, totalViolations: violations.length },
    unroutedNets,
    splitNets,
    traces: layout.traces.length,
    vias: layout.vias.length,
  }
}

/** Real DRC: routed copper when a board exists, fab-gated sheet otherwise. */
async function realDrc(args: Record<string, string | number | boolean>): Promise<unknown> {
  const profile = fabProfileFromArg(args['profile'])
  const layout = useProjectStore.getState().pcbLayout
  if (layout) {
    const report = checkRoutedLayout(layout, profile)
    return {
      source: 'routed-layout',
      shippable: report.isValid && report.unroutedNets.length === 0 && report.splitNets.length === 0,
      traces: report.traces,
      vias: report.vias,
      unroutedNets: report.unroutedNets,
      splitNets: report.splitNets,
      summary: report.summary,
      violations: report.violations,
    }
  }

  const rawC = args['components']
  const rawW = args['wires']
  if (typeof rawC !== 'string' || typeof rawW !== 'string') {
    throw new Error('No routed board on the canvas. Run eda.route first (or pass components + wires JSON).')
  }
  let components: Parameters<typeof buildFabPackage>[0]
  let wires: FabWireInput[]
  try {
    components = JSON.parse(rawC)
    wires = JSON.parse(rawW) as FabWireInput[]
  } catch {
    throw new Error('eda.drc: components/wires are not valid JSON.')
  }
  if (!Array.isArray(components) || !Array.isArray(wires)) throw new Error('eda.drc needs components + wires arrays.')
  const pack = buildFabPackage(components, fabTracesFromWires(wires), { profile })
  return {
    source: 'schematic',
    shippable: pack.shippable,
    summary: { errors: pack.violations.length, warnings: 0, totalViolations: pack.violations.length },
    violations: pack.violations,
  }
}

function fabPackageForLiveBoard(profile: FabProfile, projectName: string): { layout: PcbSceneInput; pkg: ReturnType<typeof buildFabPackage> } | null {
  const store = useProjectStore.getState()
  const layout = store.pcbLayout
  if (!layout) return null
  const placement = placeFromRoutedLayout(store.components, layout)
  const pkg = buildFabPackage(placement.components, fabCopperFromRoutedTraces(layout.traces.map((trace) => ({
    id: trace.id,
    points: trace.points,
    width: trace.widthMm,
    netName: trace.net,
    layerId: trace.layerId,
  }))), {
    profile,
    projectName,
    boardWidth: layout.widthMm,
    boardHeight: layout.heightMm,
    vias: layout.vias.map((via) => ({
      x: via.x,
      y: via.y,
      drillDiameter: via.drillDiameterMm,
      padDiameter: via.padDiameterMm,
      netName: via.net,
    })),
  })
  return { layout, pkg }
}

function safeProjectName(raw: unknown): string {
  const name = String(raw ?? '').trim()
  if (!name || name === 'current') return 'folio-pcb'
  return name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'folio-pcb'
}

/** Real fab export: the routed board's actual copper, gated on DRC. */
async function realExportFab(args: Record<string, string | number | boolean>): Promise<unknown> {
  const profile = fabProfileFromArg(args['profile'])
  const projectName = safeProjectName(args['project'])
  const live = fabPackageForLiveBoard(profile, projectName)

  if (live) {
    const report = checkRoutedLayout(live.layout, profile)
    const shippable = live.pkg.shippable
      && report.isValid
      && report.unroutedNets.length === 0
      && report.splitNets.length === 0
    return {
      source: 'routed-layout',
      project: projectName,
      shippable,
      refused: !shippable,
      files: live.pkg.files.size,
      manifest: Array.from(live.pkg.files.keys()),
      centroid: live.pkg.centroid.length,
      bom: live.pkg.bom.length,
      unroutedNets: report.unroutedNets,
      splitNets: report.splitNets,
      violations: [...live.pkg.violations, ...report.violations],
    }
  }

  const rawC = args['components']
  const rawW = args['wires']
  if (typeof rawC !== 'string' || typeof rawW !== 'string') {
    throw new Error('No routed board to export. Run eda.route first (or pass components + wires JSON).')
  }
  let components: Parameters<typeof buildFabPackage>[0]
  let wires: FabWireInput[]
  try {
    components = JSON.parse(rawC)
    wires = JSON.parse(rawW) as FabWireInput[]
  } catch {
    throw new Error('eda.exportFab: components/wires are not valid JSON.')
  }
  const options: FabOptions = { profile, projectName }
  const pack = buildFabPackage(components, fabTracesFromWires(wires), options)
  return {
    source: 'schematic',
    project: projectName,
    shippable: pack.shippable,
    refused: !pack.shippable,
    files: pack.files.size,
    manifest: Array.from(pack.files.keys()),
    centroid: pack.centroid.length,
    bom: pack.bom.length,
    violations: pack.violations,
  }
}

export function edaTools(): AgentTool[] {
  return [
    { name: 'eda.simulate', description: 'Validate + simulate a SPICE netlist (JSON string)', parameters: { netlist: 'string' }, handler: realSimulate, needsApproval: false },
    {
      name: 'eda.route',
      description: 'Place + autoroute the live sheet and publish the board to the 2-D/3-D views',
      parameters: { schematic: 'string', boardWidth: 'number', boardHeight: 'number' },
      optionalParameters: ['schematic', 'boardWidth', 'boardHeight'],
      handler: realRoute,
      needsApproval: false,
    },
    {
      name: 'eda.observe',
      description: 'Observe the routed board as canonical JSON plus an SVG top view (live board or a board JSON payload)',
      parameters: { board: 'string' },
      optionalParameters: ['board'],
      handler: realObserve,
      needsApproval: false,
    },
    {
      name: 'eda.movePart',
      description: 'Move (and optionally rotate) one placed part on the routed board, then re-route so copper matches the new pads',
      parameters: { reference: 'string', x: 'number', y: 'number', rotation: 'number' },
      optionalParameters: ['rotation'],
      handler: realMovePart,
      needsApproval: false,
    },
    {
      name: 'eda.addTrace',
      description: 'Add one copper trace segment chain on a net; off-board points are refused and DRC should be run next',
      parameters: { net: 'string', points: 'string', layerId: 'string', widthMm: 'number' },
      optionalParameters: ['layerId', 'widthMm'],
      handler: realAddTrace,
      needsApproval: false,
    },
    {
      name: 'eda.addVia',
      description: 'Add one plated via on a net; the pad must be larger than the drill and the point must be on the board',
      parameters: { net: 'string', x: 'number', y: 'number', padDiameterMm: 'number', drillDiameterMm: 'number' },
      optionalParameters: ['padDiameterMm', 'drillDiameterMm'],
      handler: realAddVia,
      needsApproval: false,
    },
    {
      name: 'eda.drc',
      description: 'DRC the routed copper; falls back to a fab-gated sheet when no board is routed',
      parameters: { profile: 'string', components: 'string', wires: 'string' },
      optionalParameters: ['profile', 'components', 'wires'],
      handler: realDrc,
      needsApproval: false,
    },
    {
      name: 'eda.exportFab',
      description: 'Emit the routed board as a Gerber/Excellon package (returns the manifest; never claims a package that DRC refuses)',
      parameters: { project: 'string', profile: 'string', components: 'string', wires: 'string' },
      optionalParameters: ['project', 'profile', 'components', 'wires'],
      handler: realExportFab,
      needsApproval: true,
    },
  ];
}

/** Meta-plan: simulate → route → observe → DRC → export, reviewable before execution. */
export function planEdaRun(goal: string): EdaPlan {
  const steps: EdaPlanStep[] = [
    { tool: 'eda.simulate', args: { netlist: 'main' }, rationale: 'Verify behavior before layout.' },
    { tool: 'eda.route', args: { schematic: 'main' }, rationale: 'Route the verified schematic.' },
    { tool: 'eda.observe', args: {}, rationale: 'Inspect the routed copper as JSON + SVG before rule checks.' },
    { tool: 'eda.drc', args: { profile: 'JLCPCB_1oz' }, rationale: 'Gate fabrication on fab rules.' },
    { tool: 'eda.exportFab', args: { project: 'main' }, rationale: 'Emit shippable fab package.' },
  ];
  return { goal, steps, needsApproval: ['eda.exportFab'] };
}

export function registerEdaTools(harness: AgentHarness): void {
  for (const tool of edaTools()) harness.registerTool(tool);
}

/**
 * planEdaFlow — Intent-to-plan: maps a user's natural language goal to an
 * EdaPlan with pre-filled args from the current design state.
 *
 * This is intentionally a simple keyword router; a future version would use
 * an LLM to decompose arbitrary goals.
 */
export function planEdaFlow(
  goal: string,
  context: { netlist: string; components: string; wires: string; schematic: string },
): EdaPlan | null {
  const g = goal.toLowerCase()

  const wantsInspection = g.includes('inspect') || g.includes('observe') || g.includes('review')
  const namesSchematic = g.includes('schematic') || g.includes('sheet') || g.includes('circuit')
  if (wantsInspection && namesSchematic) {
    return {
      goal,
      steps: [{ tool: 'cad.observe', args: {}, rationale: 'Observe the live sheet as canonical JSON plus an SVG drawing.' }],
      needsApproval: [],
    }
  }

  if (g.includes('simulat') || g.includes('spice') || g.includes('operating') || g.includes('dc') || g.includes('transient') || g.includes('ac sweep')) {
    return {
      goal,
      steps: [{ tool: 'eda.simulate', args: { netlist: context.netlist }, rationale: 'Run SPICE simulation on current schematic.' }],
      needsApproval: [],
    }
  }

  if (g.includes('drc') || g.includes('design rule') || g.includes('check')) {
    return {
      goal,
      steps: [{ tool: 'eda.drc', args: { profile: 'JLCPCB_1oz' }, rationale: 'Run DRC against JLCPCB profile on the routed copper.' }],
      needsApproval: [],
    }
  }

  if (g.includes('route') || g.includes('layout') || g.includes('pcb')) {
    return {
      goal,
      steps: [
        { tool: 'eda.simulate', args: { netlist: context.netlist }, rationale: 'Verify schematic before routing.' },
        { tool: 'eda.route', args: { schematic: context.schematic }, rationale: 'Auto-route all nets on 2 layers.' },
        { tool: 'eda.observe', args: {}, rationale: 'Inspect the routed board before accepting it.' },
        { tool: 'eda.drc', args: { profile: 'JLCPCB_1oz' }, rationale: 'Gate on DRC.' },
      ],
      needsApproval: [],
    }
  }

  if (g.includes('export') || g.includes('gerber') || g.includes('fab') || g.includes('manufactur')) {
    return {
      goal,
      steps: [
        { tool: 'eda.simulate', args: { netlist: context.netlist }, rationale: 'Verify before fab.' },
        { tool: 'eda.drc', args: { profile: 'JLCPCB_1oz' }, rationale: 'Check DRC.' },
        { tool: 'eda.exportFab', args: { project: 'current' }, rationale: 'Emit fab package.' },
      ],
      needsApproval: ['eda.exportFab'],
    }
  }

  if (g.includes('signal integrity') || g.includes('impedance') || g.includes('si ')) {
    return {
      goal,
      steps: [
        { tool: 'eda.drc', args: { profile: 'JLCPCB_1oz' }, rationale: 'Check trace rules for SI.' },
      ],
      needsApproval: [],
    }
  }

  // Full flow: simulate → route → DRC → export, with the live payloads.
  if (g.includes('full') || g.includes('complete') || g.includes('all') || g.includes('everything')) {
    return {
      goal,
      steps: [
        { tool: 'eda.simulate', args: { netlist: context.netlist }, rationale: 'Verify behavior before layout.' },
        { tool: 'eda.route', args: { schematic: context.schematic }, rationale: 'Route the verified schematic.' },
        { tool: 'eda.drc', args: { profile: 'JLCPCB_1oz' }, rationale: 'Gate fabrication on fab rules.' },
        { tool: 'eda.exportFab', args: { project: 'current' }, rationale: 'Emit the shippable fab package.' },
      ],
      needsApproval: ['eda.exportFab'],
    }
  }

  return null
}
