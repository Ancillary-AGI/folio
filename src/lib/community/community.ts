/**
 * Community templates — designs other people proved, free to fork.
 *
 * Two families of template live here:
 *
 *   · Curated seeds — hand-picked Folio demos, CC-BY-4.0, shipped in the box.
 *     Forking one is exactly opening the demo: a new project is created and
 *     the demo is bootstrapped into it, so the fork path is the same code the
 *     gallery already exercises.
 *
 *   · Community templates — projects people published from their own
 *     workspaces under an open licence. Reads and forks go through Supabase
 *     when a cloud backend is configured; publishing is an explicit act that
 *     names the licence the fork carries.
 *
 * The payload is one shape everywhere:
 *
 *   {
 *     format: 'folio-community-template/1',
 *     name, description, discipline, license, authorName, workspaceMode,
 *     createdAt, design: { components, wires, pcbLayout, ... } // CheckpointData
 *   }
 *
 * `design` is exactly the object `buildCheckpointPayload()` produces, so a
 * template is a forkable checkpoint. Fork applies it to the live stores and
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

export type CommunityLicense = 'cc-by-4.0' | 'cc0-1.0'
export type Discipline = 'circuits' | 'control' | 'mechanical' | 'robotics' | 'rf' | 'software' | 'other'

export interface CommunityTemplate {
  /** Curated: 'curated-<demo-id>'. Community: the row uuid. */
  id: string
  name: string
  description: string
  discipline: Discipline
  license: CommunityLicense
  authorName: string
  source: 'curated' | 'community'
  workspaceMode: WorkspaceMode
  clonedCount: number
  createdAt: number | null
}

/** The curated seeds — demos chosen because they are worth building on. */
export const CURATED_TEMPLATES: readonly CommunityTemplate[] = [
  { id: 'curated-rectifier-pcb', name: 'Half-wave rectifier, start to gerber', description: 'Schematic → transient → PCB → 3D → BOM → fab package. The reference for every new user.', discipline: 'circuits', license: 'cc-by-4.0', authorName: 'Folio team', source: 'curated', workspaceMode: 'pcb', clonedCount: 0, createdAt: null },
  { id: 'curated-showcase-4l-3d', name: 'Four-layer controller board', description: 'Poured planes on named nets with anti-pads around foreign barrels — the four-layer vocabulary you actually use.', discipline: 'circuits', license: 'cc-by-4.0', authorName: 'Folio team', source: 'curated', workspaceMode: 'preview3d', clonedCount: 0, createdAt: null },
  { id: 'curated-laptop-mainboard', name: 'Laptop mainboard, laid out', description: '56 packages, BGA-256 SoC, LPDDR4x pairs — the honest limit of an in-browser autorouter, with the unrouted nets named.', discipline: 'circuits', license: 'cc-by-4.0', authorName: 'Folio team', source: 'curated', workspaceMode: 'pcb', clonedCount: 0, createdAt: null },
  { id: 'curated-control-motor-loop', name: 'Motor speed loop with PID', description: 'Tune a DC motor against measured step response — Z-N, SIMC, relay feedback or model-reference search.', discipline: 'control', license: 'cc-by-4.0', authorName: 'Folio team', source: 'curated', workspaceMode: 'control', clonedCount: 0, createdAt: null },
  { id: 'curated-machines-bldc', name: 'BLDC drive with FOC', description: 'Field-oriented control on a dq-frame machine model with measured commutation.', discipline: 'control', license: 'cc-by-4.0', authorName: 'Folio team', source: 'curated', workspaceMode: 'machines', clonedCount: 0, createdAt: null },
  { id: 'curated-rf-filter', name: 'Butterworth low-pass filter', description: 'Ladder synthesis with g-valued sections, scaling and S-parameters.', discipline: 'rf', license: 'cc-by-4.0', authorName: 'Folio team', source: 'curated', workspaceMode: 'rf', clonedCount: 0, createdAt: null },
  { id: 'curated-structures-warren', name: 'Warren truss bridge', description: 'Statically determinate joints, reaction closure from the residual, Euler buckling per bar, A3 drawing from the solver.', discipline: 'mechanical', license: 'cc-by-4.0', authorName: 'Folio team', source: 'curated', workspaceMode: 'structures', clonedCount: 0, createdAt: null },
  { id: 'curated-robotics-two-link', name: 'Two-link robotic arm', description: 'DH chain, analytic Jacobian, damped least-squares IK, trajectory through joint limits and obstacles.', discipline: 'robotics', license: 'cc-by-4.0', authorName: 'Folio team', source: 'curated', workspaceMode: 'robotics', clonedCount: 0, createdAt: null },
  { id: 'curated-hdl-acc-cpu', name: 'Accumulator CPU, synthesized', description: 'A fetch-decode-add machine on the SKY130 teaching flow — synthesize, inspect, understand.', discipline: 'software', license: 'cc-by-4.0', authorName: 'Folio team', source: 'curated', workspaceMode: 'hdl', clonedCount: 0, createdAt: null },
  { id: 'curated-mechanical-enclosure', name: 'Enclosure for the rectifier board', description: 'A case fitted to the real board outline with connector cutouts, exported as faceted STEP.', discipline: 'mechanical', license: 'cc-by-4.0', authorName: 'Folio team', source: 'curated', workspaceMode: 'mechanical', clonedCount: 0, createdAt: null },
]

/** Map a curated id back to its demo scenario for the fork path. */
export const CURATED_DEMO_BY_TEMPLATE_ID: Readonly<Record<string, string>> = Object.freeze({
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

const LICENSE_LABEL: Readonly<Record<CommunityLicense, string>> = {
  'cc-by-4.0': 'CC-BY-4.0',
  'cc0-1.0': 'CC0-1.0',
}

export function licenseLabel(license: CommunityLicense): string {
  return LICENSE_LABEL[license]
}

/* ── Payload validation ───────────────────────────────────────────────────── */

const TEMPLATE_FORMAT = 'folio-community-template/1'

export interface CommunityTemplateFile {
  format: typeof TEMPLATE_FORMAT
  name: string
  description: string
  discipline: Discipline
  license: CommunityLicense
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

function asLicense(value: unknown): CommunityLicense {
  if (value === 'cc-by-4.0' || value === 'cc0-1.0') return value
  throw new Error('License must be cc-by-4.0 or cc0-1.0.')
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
  const license = asLicense(record.license)
  return {
    format: TEMPLATE_FORMAT,
    name: asString(record.name, 'The template name', 120),
    description: typeof record.description === 'string' ? record.description.slice(0, 600) : '',
    discipline: asDiscipline(record.discipline),
    license,
    authorName: typeof record.authorName === 'string' ? record.authorName.slice(0, 80) : 'Unknown',
    workspaceMode: asWorkspaceMode(record.workspaceMode),
    createdAt: typeof record.createdAt === 'number' && Number.isFinite(record.createdAt) ? record.createdAt : 0,
    design,
  }
}

/** Build the template file for a design — what gets published or exported. */
export function buildCommunityTemplate(
  draft: Pick<CommunityTemplate, 'name' | 'description' | 'discipline' | 'license'> & { authorName?: string },
  design: Record<string, unknown> = buildCheckpointPayload(),
): CommunityTemplateFile {
  return {
    format: TEMPLATE_FORMAT,
    name: draft.name.trim(),
    description: draft.description,
    discipline: draft.discipline,
    license: draft.license,
    authorName: draft.authorName ?? 'You',
    workspaceMode: useAppStore.getState().workspaceMode,
    createdAt: Date.now(),
    design,
  }
}

/* ── Fork application ─────────────────────────────────────────────────────── */

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
  useProjectStore.setState({
    components: canvasData.components as never[],
    wires: canvasData.wires as never[],
    firmwareCode: typeof canvasData.firmwareCode === 'string' ? canvasData.firmwareCode : '',
    simulationRuns: Array.isArray(canvasData.simulationRuns) ? canvasData.simulationRuns as never[] : [],
    pcbLayout: asPcbLayout(canvasData.pcbLayout),
    mechanicalParts: asMechanicalParts(canvasData.mechanicalParts),
    domainDesigns: asDomainDesigns(canvasData.domainDesigns),
    currentSchematic: {
      id: 'community-fork', project_id: 'community-fork', name: 'Forked template',
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

/** List published templates, newest first. Empty offline; error on failure. */
export async function fetchCommunityTemplates(): Promise<CommunityFetchResult> {
  if (!isSupabaseConfigured || !supabase) {
    return { templates: [], error: null }
  }
  const { data, error } = await supabase
    .from('community_projects')
    .select('id, name, description, discipline, license, author_name, workspace_mode, cloned_count, created_at')
    .order('created_at', { ascending: false })
    .limit(60)
  if (error) return { templates: [], error: error.message }
  return {
    templates: (data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      discipline: asDiscipline(row.discipline),
      license: row.license === 'cc0-1.0' ? 'cc0-1.0' : 'cc-by-4.0',
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
  draft: Pick<CommunityTemplate, 'name' | 'description' | 'discipline' | 'license'>,
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
      license: payload.license,
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
      license: payload.license,
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
    license: 'cc-by-4.0',
    authorName: 'You',
  })
  return { filename: `${name}.folio-template.json`, text: JSON.stringify(file, null, 2) }
}

/** Apply a template file's payload to the stores. */
export function applyTemplateFile(file: CommunityTemplateFile): boolean {
  return applyCommunityPayload(file.design)
}
