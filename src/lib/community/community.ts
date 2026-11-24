/**
 * Community designs — designs other people proved, open for you to adopt.
 *
 * Two families live here:
 *
 *   · Curated seeds — hand-picked Folio demos shipped in the box.
 *     Opening one is exactly opening the demo: a new project is created and
 *     the demo is bootstrapped into it, so the open path is the same code the
 *     gallery already exercises.
 *
 *   · Community designs — projects people published from their own
 *     workspaces. Reads and adoptions go through Supabase when a cloud
 *     backend is configured; publishing is an explicit act that names the
 *     author and the workspace mode the design opens in.
 *
 * The payload is one shape everywhere:
 *
 *   {
 *     format: 'folio-community-template/1',
 *     name, description, discipline, authorName, workspaceMode,
 *     createdAt, design: { components, wires, pcbLayout, ... } // CheckpointData
 *   }
 *
 * `design` is exactly the object `buildCheckpointPayload()` produces, so an
 * adopted design is an ordinary checkpoint. Opening applies it to the live stores and
 * marks the project dirty; nothing is saved until the user saves.
 */
import { useAppStore } from '../../stores/useAppStore'
import { useProjectStore } from '../../stores/useProjectStore'
import { WORKSPACE_MODES } from '../../lib/workspace/modes'
import type { WorkspaceMode } from '../../stores/useAppStore'
import { supabase, isSupabaseConfigured } from '../../lib/supabase'
import { buildCheckpointPayload } from '../../lib/backup/checkpoint'
import { createDefaultMechanicalParts, type MechanicalPart } from '../../lib/mechanical/partModel'
import type { PcbSceneInput } from '../../lib/pcb/pcbScene'

export type Discipline = 'circuits' | 'control' | 'mechanical' | 'robotics' | 'rf' | 'software' | 'other'

export interface CommunityTemplate {
  /** Curated: 'curated-<demo-id>'. Community: the row uuid. */
  id: string
  name: string
  description: string
  discipline: Discipline
  authorName: string
  source: 'curated' | 'community'
  workspaceMode: WorkspaceMode
  clonedCount: number
  createdAt: number | null
}

/** The curated seeds — demos chosen because they are worth building on. */
export const CURATED_TEMPLATES: readonly CommunityTemplate[] = [
  { id: 'curated-blinker-astable', name: 'LED flasher, start to gerber', description: 'An LM358 inverting comparator with positive feedback as a relaxation oscillator: ±5 V rails, R3 and C1 set the ramp, R5 seeds a cold start. The transient solver shows the real waveforms — 1.18 s period measured, LED half the time at ~18 mA — then routes and fabs.', discipline: 'circuits', authorName: 'Folio team', source: 'curated', workspaceMode: 'schematic', clonedCount: 0, createdAt: null },
  { id: 'curated-rectifier-pcb', name: 'Half-wave rectifier, start to gerber', description: 'Schematic → transient → PCB → 3D → BOM → fab package. The reference for every new user.', discipline: 'circuits', authorName: 'Folio team', source: 'curated', workspaceMode: 'pcb', clonedCount: 0, createdAt: null },
  { id: 'curated-showcase-4l-3d', name: 'Four-layer controller board', description: 'Poured planes on named nets with anti-pads around foreign barrels — the four-layer vocabulary you actually use.', discipline: 'circuits', authorName: 'Folio team', source: 'curated', workspaceMode: 'preview3d', clonedCount: 0, createdAt: null },
  { id: 'curated-laptop-mainboard', name: 'Laptop mainboard, laid out', description: '56 packages, BGA-256 SoC, LPDDR4x pairs — the honest limit of an in-browser autorouter, with the unrouted nets named.', discipline: 'circuits', authorName: 'Folio team', source: 'curated', workspaceMode: 'pcb', clonedCount: 0, createdAt: null },
  { id: 'curated-control-motor-loop', name: 'Motor speed loop with PID', description: 'Tune a DC motor against measured step response — Z-N, SIMC, relay feedback or model-reference search.', discipline: 'control', authorName: 'Folio team', source: 'curated', workspaceMode: 'control', clonedCount: 0, createdAt: null },
  { id: 'curated-machines-bldc', name: 'BLDC drive with FOC', description: 'Field-oriented control on a dq-frame machine model with measured commutation.', discipline: 'control', authorName: 'Folio team', source: 'curated', workspaceMode: 'machines', clonedCount: 0, createdAt: null },
  { id: 'curated-rf-filter', name: 'Butterworth low-pass filter', description: 'Ladder synthesis with g-valued sections, scaling and S-parameters.', discipline: 'rf', authorName: 'Folio team', source: 'curated', workspaceMode: 'rf', clonedCount: 0, createdAt: null },
  { id: 'curated-structures-warren', name: 'Warren truss bridge', description: 'Statically determinate joints, reaction closure from the residual, Euler buckling per bar, A3 drawing from the solver.', discipline: 'mechanical', authorName: 'Folio team', source: 'curated', workspaceMode: 'structures', clonedCount: 0, createdAt: null },
  { id: 'curated-robotics-two-link', name: 'Two-link robotic arm', description: 'DH chain, analytic Jacobian, damped least-squares IK, trajectory through joint limits and obstacles.', discipline: 'robotics', authorName: 'Folio team', source: 'curated', workspaceMode: 'robotics', clonedCount: 0, createdAt: null },
  { id: 'curated-hdl-acc-cpu', name: 'Accumulator CPU, synthesized', description: 'A fetch-decode-add machine on the SKY130 teaching flow — synthesize, inspect, understand.', discipline: 'software', authorName: 'Folio team', source: 'curated', workspaceMode: 'hdl', clonedCount: 0, createdAt: null },
  { id: 'curated-mechanical-enclosure', name: 'Enclosure for the rectifier board', description: 'A case fitted to the real board outline with connector cutouts, exported as faceted STEP.', discipline: 'mechanical', authorName: 'Folio team', source: 'curated', workspaceMode: 'mechanical', clonedCount: 0, createdAt: null },
]

/** Map a curated id back to its demo scenario for the fork path. */
export const CURATED_DEMO_BY_TEMPLATE_ID: Readonly<Record<string, string>> = Object.freeze({
  'curated-blinker-astable': 'blinker-astable',
  'curated-rectifier-pcb': 'rectifier-pcb',
  'curated-showcase-4l-3d': 'showcase-4l-3d',
  'curated-laptop-mainboard': 'laptop-mainboard',
  'curated-control-motor-loop': 'control-motor-loop',
  'curated-machines-bldc': 'machines-bldc',
  'curated-rf-filter': 'rf-filter',
  'curated-structures-warren': 'structures-warren',
  'curated-robotics-two-link': 'robotics-two-link',
  'curated-hdl-acc-cpu': 'hdl-acc-cpu',
  'curated-mechanical-enclosure': 'mechanical-enclosure',
})

/* ── Payload validation ───────────────────────────────────────────────────── */

const TEMPLATE_FORMAT = 'folio-community-template/1'

export interface CommunityTemplateFile {
  format: typeof TEMPLATE_FORMAT
  name: string
  description: string
  discipline: Discipline
  authorName: string
  workspaceMode: WorkspaceMode
  createdAt: number
  design: Record<string, unknown>
}

const DISCIPLINES: readonly Discipline[] = ['circuits', 'control', 'mechanical', 'robotics', 'rf', 'software', 'other']

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${what} is missing or not an object.`)
  }
  return value as Record<string, unknown>
}

function asString(value: unknown, what: string, maxLength: number): string {
  if (typeof value !== 'string') throw new Error(`${what} must be text.`)
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${what} must not be empty.`)
  if (trimmed.length > maxLength) throw new Error(`${what} is longer than ${maxLength} characters.`)
  return trimmed
}

function asDiscipline(value: unknown): Discipline {
  return typeof value === 'string' && (DISCIPLINES as readonly string[]).includes(value) ? (value as Discipline) : 'other'
}

const KNOWN_MODES: ReadonlySet<string> = new Set(WORKSPACE_MODES.map((mode) => mode.id))

function asWorkspaceMode(value: unknown): WorkspaceMode {
  return typeof value === 'string' && KNOWN_MODES.has(value) ? (value as WorkspaceMode) : 'schematic'
}

/** Accept a parsed JSON object iff it is a well-formed template file. */
export function parseCommunityTemplate(parsed: unknown): CommunityTemplateFile {
  const record = asRecord(parsed, 'The file')
  if (record.format !== TEMPLATE_FORMAT) {
    throw new Error(`Not a Folio community template (format was ${String(record.format)}).`)
  }
  const design = asRecord(record.design, 'The design payload')
  if (!Array.isArray(design.components) || !Array.isArray(design.wires)) {
    throw new Error('The design payload must contain components and wires arrays.')
  }
  return {
    format: TEMPLATE_FORMAT,
    name: asString(record.name, 'The template name', 120),
    description: typeof record.description === 'string' ? record.description.slice(0, 600) : '',
    discipline: asDiscipline(record.discipline),
    authorName: typeof record.authorName === 'string' ? record.authorName.slice(0, 80) : 'Unknown',
    workspaceMode: asWorkspaceMode(record.workspaceMode),
    createdAt: typeof record.createdAt === 'number' && Number.isFinite(record.createdAt) ? record.createdAt : 0,
    design,
  }
}

/** Build the template file for a design — what gets published or exported. */
export function buildCommunityTemplate(
  draft: Pick<CommunityTemplate, 'name' | 'description' | 'discipline'> & { authorName?: string },
  design: Record<string, unknown> = buildCheckpointPayload(),
): CommunityTemplateFile {
  return {
    format: TEMPLATE_FORMAT,
    name: draft.name.trim(),
    description: draft.description,
    discipline: draft.discipline,
    authorName: draft.authorName ?? 'You',
    workspaceMode: useAppStore.getState().workspaceMode,
    createdAt: Date.now(),
    design,
  }
}

/* ── Fork application ─────────────────────────────────────────────────────── */

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

/*
 * A community payload crosses a trust boundary: it arrives over the network
 * by hand or from a publisher. `applyCommunityPayload` used to check only that
 * the two arrays existed and then cast each element — a crafted file could
 * place a part with no pins, a wire with NaN coordinates or a reference that
 * is a number onto the live sheet, and the netlist, ERC and exporters would
 * all chew on garbage. Each item is validated and deep-copied here; one bad
 * item fails the whole payload rather than a silently partial design.
 */
function sanitizeComponents(items: unknown[]): CanvasComponentLike[] | null {
  const out: CanvasComponentLike[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    const c = item as Record<string, unknown>
    const comp = c.component as Record<string, unknown> | undefined
    if (typeof c.id !== 'string' || !c.id) return null
    if (typeof c.componentId !== 'string' || !c.componentId) return null
    if (typeof c.reference !== 'string' || !c.reference) return null
    if (!isFiniteNumber(c.x) || !isFiniteNumber(c.y) || !isFiniteNumber(c.rotation)) return null
    if (!comp || typeof comp !== 'object' || Array.isArray(comp)) return null
    if (typeof comp.name !== 'string' || !comp.name) return null
    const symbol = comp.symbol_data as Record<string, unknown> | undefined
    if (!symbol || typeof symbol !== 'object' || !isFiniteNumber(symbol.width) || !isFiniteNumber(symbol.height)) return null
    if (!Array.isArray(comp.pins)) return null
    const pins: Array<Record<string, unknown>> = []
    for (const pin of comp.pins as unknown[]) {
      if (!pin || typeof pin !== 'object') return null
      const p = pin as Record<string, unknown>
      if (typeof p.id !== 'string' || !p.id || typeof p.name !== 'string') return null
      if (!isFiniteNumber(p.x) || !isFiniteNumber(p.y)) return null
      pins.push({ ...p })
    }
    const properties = c.properties
    if (properties !== undefined
      && (typeof properties !== 'object' || properties === null || Array.isArray(properties))) {
      return null
    }
    out.push({
      id: c.id,
      componentId: c.componentId,
      component: { ...comp, symbol_data: { ...symbol }, pins } as CanvasComponentLike['component'],
      x: c.x,
      y: c.y,
      rotation: ((c.rotation % 360) + 360) % 360,
      reference: c.reference,
      properties: { ...(properties as Record<string, string | number | boolean> | undefined) },
      ...(typeof c.locked === 'boolean' ? { locked: c.locked } : {}),
      ...(typeof c.visible === 'boolean' ? { visible: c.visible } : {}),
    })
  }
  return out
}

function sanitizeWires(items: unknown[]): CanvasWireLike[] | null {
  const out: CanvasWireLike[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    const w = item as Record<string, unknown>
    if (typeof w.id !== 'string' || !w.id) return null
    if (!Array.isArray(w.points) || w.points.length === 0) return null
    const points: Array<{ x: number; y: number }> = []
    for (const point of w.points as unknown[]) {
      if (!point || typeof point !== 'object') return null
      const p = point as Record<string, unknown>
      if (!isFiniteNumber(p.x) || !isFiniteNumber(p.y)) return null
      points.push({ x: p.x, y: p.y })
    }
    if (w.netName !== undefined && typeof w.netName !== 'string') return null
    if (!Array.isArray(w.connectedPins)) return null
    const connectedPins: Array<{ componentId: string; pinId: string }> = []
    for (const pin of w.connectedPins as unknown[]) {
      if (!pin || typeof pin !== 'object') return null
      const p = pin as Record<string, unknown>
      if (typeof p.componentId !== 'string' || !p.componentId || typeof p.pinId !== 'string' || !p.pinId) return null
      connectedPins.push({ componentId: p.componentId, pinId: p.pinId })
    }
    out.push({
      id: w.id,
      points,
      ...(typeof w.netName === 'string' ? { netName: w.netName } : {}),
      connectedPins,
    })
  }
  return out
}

type CanvasComponentLike = import('../../stores/useProjectStore').CanvasComponent
type CanvasWireLike = import('../../stores/useProjectStore').CanvasWire

function asPcbLayout(value: unknown): PcbSceneInput | null {
  if (!value || typeof value !== 'object') return null
  const layout = value as Record<string, unknown>
  return Number.isFinite(layout.widthMm) && Number.isFinite(layout.heightMm)
    && Array.isArray(layout.layers) && Array.isArray(layout.traces)
    && Array.isArray(layout.vias) && Array.isArray(layout.components)
    ? (value as PcbSceneInput)
    : null
}

function asMechanicalParts(value: unknown): MechanicalPart[] {
  return Array.isArray(value) ? (value as MechanicalPart[]) : createDefaultMechanicalParts()
}

function asDomainDesigns(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/** Apply a template payload to the live project stores. Returns success. */
export function applyCommunityPayload(canvasData: Record<string, unknown>): boolean {
  if (!Array.isArray(canvasData.components) || !Array.isArray(canvasData.wires)) return false
  const components = sanitizeComponents(canvasData.components)
  const wires = sanitizeWires(canvasData.wires)
  // One malformed item fails the whole payload — never a silently partial sheet.
  if (!components || !wires) return false
  // Every connected pin must reference a component that survived validation.
  const componentIds = new Set(components.map((component) => component.id))
  for (const wire of wires) {
    for (const pin of wire.connectedPins) {
      if (!componentIds.has(pin.componentId)) return false
    }
  }
  useProjectStore.setState({
    components: components as never[],
    wires: wires as never[],
    firmwareCode: typeof canvasData.firmwareCode === 'string' ? canvasData.firmwareCode : '',
    simulationRuns: Array.isArray(canvasData.simulationRuns) ? canvasData.simulationRuns as never[] : [],
    pcbLayout: asPcbLayout(canvasData.pcbLayout),
    mechanicalParts: asMechanicalParts(canvasData.mechanicalParts),
    domainDesigns: asDomainDesigns(canvasData.domainDesigns),
    currentSchematic: {
      id: 'community-fork', project_id: 'community-fork', name: 'Community design',
      order_index: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    } as never,
    isDirty: true,
    liveFrame: null,
  })
  return true
}

/* ── Cloud fetch / publish ────────────────────────────────────────────────── */

export interface CommunityFetchResult {
  templates: CommunityTemplate[]
  error: string | null
}

/** List published designs, newest first. Empty offline; error on failure. */
export async function fetchCommunityTemplates(): Promise<CommunityFetchResult> {
  if (!isSupabaseConfigured || !supabase) {
    return { templates: [], error: null }
  }
  const { data, error } = await supabase
    .from('community_projects')
    .select('id, name, description, discipline, author_name, workspace_mode, cloned_count, created_at')
    .order('created_at', { ascending: false })
    .limit(60)
  if (error) return { templates: [], error: error.message }
  return {
    templates: (data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      discipline: asDiscipline(row.discipline),
      authorName: row.author_name,
      source: 'community' as const,
      workspaceMode: asWorkspaceMode(row.workspace_mode),
      clonedCount: row.cloned_count ?? 0,
      createdAt: row.created_at ? Date.parse(row.created_at) : null,
    })),
    error: null,
  }
}

/** Fork a cloud template: download its payload and bump the fork counter. */
export async function fetchCommunityFork(templateId: string): Promise<{ ok: boolean; canvasData?: CommunityTemplateFile; error?: string }> {
  if (!isSupabaseConfigured || !supabase) {
    return { ok: false, error: 'This template lives in the Folio cloud — this build runs offline.' }
  }
  const { data, error } = await supabase
    .from('community_projects')
    .select('canvas_data')
    .eq('id', templateId)
    .single()
  if (error || !data) return { ok: false, error: error?.message ?? 'Template not found.' }
  try {
    const file = parseCommunityTemplate(data.canvas_data)
    // Best-effort bump; a failed counter must not block the fork.
    try {
      await supabase.rpc('bump_community_fork_count', { template_id: templateId })
    } catch {
      /* non-fatal */
    }
    return { ok: true, canvasData: file }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Template payload is invalid.' }
  }
}

/** Publish the current design as a public template. Requires cloud + session. */
export async function publishCommunityTemplate(
  draft: Pick<CommunityTemplate, 'name' | 'description' | 'discipline'>,
  authorName: string,
): Promise<{ ok: boolean; error?: string; template?: CommunityTemplate }> {
  if (!isSupabaseConfigured || !supabase) {
    return { ok: false, error: 'Publishing needs the Folio cloud. Export the template as a .json file to share it by hand.' }
  }
  const { data: sessionData } = await supabase.auth.getSession()
  const userId = sessionData?.session?.user?.id
  if (!userId) return { ok: false, error: 'Sign in to publish.' }

  const payload = buildCommunityTemplate({ ...draft, authorName })
  const { data, error } = await supabase
    .from('community_projects')
    .insert({
      author_id: userId,
      author_name: authorName,
      name: payload.name,
      description: payload.description,
      discipline: payload.discipline,
      workspace_mode: payload.workspaceMode,
      canvas_data: payload,
    })
    .select('id, created_at')
    .single()
  if (error) return { ok: false, error: error.message }
  return {
    ok: true,
    template: {
      id: data.id,
      name: payload.name,
      description: payload.description,
      discipline: payload.discipline,
      authorName,
      source: 'community',
      workspaceMode: payload.workspaceMode,
      clonedCount: 0,
      createdAt: data.created_at ? Date.parse(data.created_at) : Date.now(),
    },
  }
}

/** Serialize the current design as a downloadable template file. */
export function serializeTemplateFile(): { filename: string; text: string } {
  const name = (useProjectStore.getState().currentProject?.name ?? 'template')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'template'
  const file = buildCommunityTemplate({
    name: useProjectStore.getState().currentProject?.name ?? 'Untitled template',
    description: '',
    discipline: 'other',
    authorName: 'You',
  })
  return { filename: `${name}.folio-template.json`, text: JSON.stringify(file, null, 2) }
}

/** Apply a template file's payload to the stores. */
export function applyTemplateFile(file: CommunityTemplateFile): boolean {
  return applyCommunityPayload(file.design)
}
