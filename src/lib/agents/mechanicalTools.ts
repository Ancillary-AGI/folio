/**
 * Mechanical design tools wired to the live assembly.
 *
 * Every handler reads and commits through `useProjectStore`, the same store the
 * mechanical workspace renders. An agent therefore adds a part, changes its
 * section, support, or load, and immediately gets the same elevation drawing
 * and closed-form analysis a human sees — no headless copy of the model and no
 * stub geometry.
 *
 * Deletion is deliberately not exposed: trimming an assembly is a human
 * decision, while adding and reshaping parts is the iterative design loop.
 */
import type { AgentHarness, AgentTool } from './agentHarness'
import { MATERIALS } from '../mechanical/materials'
import {
  analysePart,
  buildPart,
  constraintsFor,
  partProperties,
  supportFor,
  type MechanicalPart,
  type MechanicalPartKind,
} from '../mechanical/partModel'
import { useProjectStore } from '../../stores/useProjectStore'
import { captureMechanicalSnapshot, mechanicalToSvg } from './mechanicalSnapshot'
import {
  runMechanicalAutopilot,
  type MechanicalAutopilotGoal,
  type MechanicalMetric,
  type MechanicalSizingKnob,
} from './mechanicalAutopilot'

type Args = Record<string, string | number | boolean>

const SUPPORTS = ['fixed', 'pinned', 'roller', 'free'] as const
type SupportName = (typeof SUPPORTS)[number]

function liveParts(): MechanicalPart[] {
  return useProjectStore.getState().mechanicalParts
}

function commitParts(next: MechanicalPart[]): void {
  useProjectStore.getState().setMechanicalParts(next)
}

function requirePart(parts: readonly MechanicalPart[], id: string): MechanicalPart {
  const wanted = id.trim().toLowerCase()
  const part = parts.find((candidate) => candidate.id.toLowerCase() === wanted)
  if (part) return part
  const available = parts.map((candidate) => `${candidate.id} (${candidate.name})`).join(', ') || '(no parts)'
  throw new Error(`No mechanical part "${id}". Parts: ${available}.`)
}

function positive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a finite value > 0, got ${value}.`)
  }
}

function nonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite value >= 0, got ${value}.`)
  }
}

function optionalNumber(args: Args, key: string): number | undefined {
  if (!(key in args)) return undefined
  const value = Number(args[key])
  if (!Number.isFinite(value)) throw new Error(`${key} must be a finite number, got ${args[key]}.`)
  return value
}

function readKind(value: unknown): MechanicalPartKind {
  const kind = String(value ?? '').trim().toLowerCase()
  if (kind !== 'beam' && kind !== 'plate') {
    throw new Error(`kind must be "beam" or "plate", got "${String(value ?? '')}".`)
  }
  return kind
}

function readSupport(value: unknown): SupportName {
  const support = String(value ?? '').trim().toLowerCase()
  if (!(SUPPORTS as readonly string[]).includes(support)) {
    throw new Error(`support must be one of ${SUPPORTS.join(', ')}; got "${String(value ?? '')}".`)
  }
  return support as SupportName
}

function readMaterial(value: unknown): string {
  const key = String(value ?? '').trim().toLowerCase()
  if (!MATERIALS[key]) {
    throw new Error(`Unknown material "${String(value ?? '')}". Materials: ${Object.keys(MATERIALS).join(', ')}.`)
  }
  return key
}

function uniquePartId(parts: readonly MechanicalPart[], kind: MechanicalPartKind): string {
  let index = 1
  while (parts.some((part) => part.id === `agent-${kind}-${index}`)) index += 1
  return `agent-${kind}-${index}`
}

/** The store part, or a part read from the store for a single observation. */
function snapshotFor(parts: readonly MechanicalPart[]) {
  return {
    snapshot: captureMechanicalSnapshot(parts),
    svg: mechanicalToSvg(parts, { width: 720 }),
  }
}

function partSummary(part: MechanicalPart): Record<string, unknown> {
  const snapshot = captureMechanicalSnapshot([part])
  return {
    part: snapshot.parts[0],
    warnings: snapshot.warnings,
  }
}

async function realObserve(args: Args): Promise<unknown> {
  const parts = liveParts()
  const requested = args['part']
  if (requested !== undefined) {
    const part = requirePart(parts, String(requested))
    return { source: 'store', ...snapshotFor([part]) }
  }
  return { source: 'store', ...snapshotFor(parts) }
}

async function realAddPart(args: Args): Promise<unknown> {
  const name = String(args['name'] ?? '').trim()
  if (!name) throw new Error('mech.addPart needs a part name.')
  const kind = readKind(args['kind'])
  const length = Number(args['length'])
  const width = Number(args['width'])
  const height = Number(args['height'])
  positive(length, 'length (metres)')
  positive(width, 'width (metres)')
  positive(height, 'height (metres)')

  const x = optionalNumber(args, 'x') ?? 0
  const y = optionalNumber(args, 'y') ?? 0
  const z = optionalNumber(args, 'z') ?? 0
  const materialKey = readMaterial(args['material'] ?? 'aluminum')
  const support = readSupport(args['support'] ?? 'fixed')
  const forceN = optionalNumber(args, 'forceN')
  const pressurePa = optionalNumber(args, 'pressurePa')
  if (forceN !== undefined) nonNegative(forceN, 'forceN')
  if (pressurePa !== undefined) nonNegative(pressurePa, 'pressurePa')

  const parts = liveParts()
  const part = buildPart({
    id: uniquePartId(parts, kind),
    name,
    kind,
    dimensions: { length, width, height },
    position: [x, y, z],
    materialKey,
    forces: forceN !== undefined && forceN > 0 ? [{ x: 0, y: -1, z: 0, magnitude: forceN }] : [],
    pressure: pressurePa ?? 0,
    constraints: constraintsFor(support),
  })
  commitParts([...parts, part])
  return { added: partSummary(part), parts: parts.length + 1 }
}

async function realMovePart(args: Args): Promise<unknown> {
  const id = String(args['part'] ?? '').trim()
  if (!id) throw new Error('mech.movePart needs a part id (see mech.observe).')
  const x = Number(args['x'])
  const y = Number(args['y'])
  const z = Number(args['z'])
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    throw new Error('mech.movePart needs finite x/y/z positions in metres.')
  }
  const rotationZ = optionalNumber(args, 'rotationZ')
  const parts = liveParts()
  const target = requirePart(parts, id)
  const next: MechanicalPart = {
    ...target,
    position: [x, y, z],
    rotation: rotationZ === undefined
      ? target.rotation
      : [target.rotation[0], target.rotation[1], (rotationZ * Math.PI) / 180],
    properties: { ...target.properties, centerOfMass: [x, y, z] },
  }
  commitParts(parts.map((part) => (part.id === target.id ? next : part)))
  return partSummary(next)
}

async function realResizePart(args: Args): Promise<unknown> {
  const id = String(args['part'] ?? '').trim()
  if (!id) throw new Error('mech.resizePart needs a part id (see mech.observe).')
  const length = optionalNumber(args, 'length')
  const width = optionalNumber(args, 'width')
  const height = optionalNumber(args, 'height')
  const material = args['material'] === undefined ? undefined : readMaterial(args['material'])
  if (length === undefined && width === undefined && height === undefined && material === undefined) {
    throw new Error('mech.resizePart needs at least one of length, width, height, or material.')
  }
  if (length !== undefined) positive(length, 'length (metres)')
  if (width !== undefined) positive(width, 'width (metres)')
  if (height !== undefined) positive(height, 'height (metres)')

  const parts = liveParts()
  const target = requirePart(parts, id)
  const dimensions = {
    length: length ?? target.dimensions.length,
    width: width ?? target.dimensions.width,
    height: height ?? target.dimensions.height,
  }
  const materialKey = material ?? target.materialKey
  const nextMaterial = MATERIALS[materialKey]
  const next: MechanicalPart = {
    ...target,
    dimensions,
    materialKey,
    material: nextMaterial,
    properties: partProperties(dimensions, nextMaterial, target.position),
  }
  commitParts(parts.map((part) => (part.id === target.id ? next : part)))
  return partSummary(next)
}

async function realSetSupport(args: Args): Promise<unknown> {
  const id = String(args['part'] ?? '').trim()
  if (!id) throw new Error('mech.setSupport needs a part id (see mech.observe).')
  const support = readSupport(args['support'])
  const parts = liveParts()
  const target = requirePart(parts, id)
  const flags = constraintsFor(support)
  const next: MechanicalPart = {
    ...target,
    constraints: {
      ...flags,
      displacement: { x: flags.fixed, y: true, z: flags.fixed },
      rotation: { x: true, y: flags.pinned, z: true },
    },
  }
  commitParts(parts.map((part) => (part.id === target.id ? next : part)))
  return { part: partSummary(next).part, support, analysable: supportFor(next) !== null }
}

async function realSetLoad(args: Args): Promise<unknown> {
  const id = String(args['part'] ?? '').trim()
  if (!id) throw new Error('mech.setLoad needs a part id (see mech.observe).')
  const forceN = optionalNumber(args, 'forceN')
  const pressurePa = optionalNumber(args, 'pressurePa')
  const temperatureK = optionalNumber(args, 'temperatureK')
  if (forceN === undefined && pressurePa === undefined && temperatureK === undefined) {
    throw new Error('mech.setLoad needs at least one of forceN, pressurePa, or temperatureK.')
  }
  if (forceN !== undefined) nonNegative(forceN, 'forceN')
  if (pressurePa !== undefined) nonNegative(pressurePa, 'pressurePa')
  if (temperatureK !== undefined) positive(temperatureK, 'temperatureK')

  const parts = liveParts()
  const target = requirePart(parts, id)
  const next: MechanicalPart = {
    ...target,
    loads: {
      ...target.loads,
      forces:
        forceN === undefined
          ? target.loads.forces
          : forceN > 0
            ? [{ x: 0, y: -1, z: 0, magnitude: forceN }]
            : [],
      pressure: pressurePa ?? target.loads.pressure,
      temperature: temperatureK ?? target.loads.temperature,
    },
  }
  commitParts(parts.map((part) => (part.id === target.id ? next : part)))
  return { part: partSummary(next).part }
}

async function realAnalyze(args: Args): Promise<unknown> {
  const parts = liveParts()
  const requested = args['part']
  const selected = requested === undefined ? parts : [requirePart(parts, String(requested))]
  const analyses = selected.map((part) => {
    try {
      const result = analysePart(part)
      return {
        partId: part.id,
        partName: part.name,
        support: result.support,
        stressMPa: Number((result.stressPa / 1e6).toFixed(6)),
        deflectionMm: Number((result.deflectionM * 1000).toFixed(6)),
        safetyFactor: result.safetyFactor === null ? null : Number(result.safetyFactor.toFixed(4)),
        yields: result.yields,
        naturalFrequenciesHz: result.naturalFrequenciesHz.map((value) => Number(value.toFixed(3))),
        bucklingLoadN: Number(result.bucklingLoadN.toFixed(3)),
      }
    } catch (error) {
      return {
        partId: part.id,
        partName: part.name,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })
  const warnings = analyses
    .filter((entry): entry is { partId: string; partName: string; error: string } => 'error' in entry)
    .map((entry) => ({ code: 'unsupported-part' as const, partId: entry.partId, message: entry.error }))
  return { schema: 'folio.mechanical-analysis/1', analyses, warnings }
}

const METRICS: readonly MechanicalMetric[] = [
  'mass',
  'safetyFactor',
  'deflection',
  'stress',
  'frequency',
  'buckling',
]

function readJson<T>(args: Args, key: string): T | undefined {
  const raw = args[key]
  if (raw === undefined || raw === '') return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(String(raw))
  } catch {
    throw new Error(`${key} must be valid JSON.`)
  }
  return parsed as T
}

function readMaterials(args: Args): string[] | undefined {
  const raw = args['materials']
  if (raw === undefined || String(raw).trim() === '') return undefined
  const text = String(raw).trim()
  if (text.startsWith('[')) {
    const parsed: unknown = readJson(args, 'materials')
    if (!Array.isArray(parsed)) throw new Error('materials must be a JSON array or a comma-separated list.')
    return parsed.map((entry) => String(entry).trim()).filter(Boolean)
  }
  return text.split(',').map((entry) => entry.trim()).filter(Boolean)
}

function readBoolean(args: Args, key: string): boolean {
  const value = args[key]
  return value === true || String(value).toLowerCase() === 'true'
}

async function realAutopilot(args: Args): Promise<unknown> {
  const part = String(args['part'] ?? '').trim()
  if (!part) throw new Error('mech.autopilot needs a part id (see mech.observe).')
  const metric = args['metric'] === undefined ? undefined : String(args['metric']) as MechanicalMetric
  if (metric !== undefined && !METRICS.includes(metric)) {
    throw new Error(`metric must be one of ${METRICS.join(', ')}; got "${String(args['metric'])}".`)
  }
  const direction = args['direction'] === undefined
    ? undefined
    : String(args['direction']).trim().toLowerCase()
  if (direction !== undefined && direction !== 'minimize' && direction !== 'maximize') {
    throw new Error(`direction must be "minimize" or "maximize"; got "${String(args['direction'])}".`)
  }
  const knobs = readJson<MechanicalSizingKnob[]>(args, 'knobs')
  if (knobs !== undefined && !Array.isArray(knobs)) {
    throw new Error('knobs must be a JSON array of {dimension, from, to, scale} (metres).')
  }

  const target = optionalNumber(args, 'target')
  const tolerance = optionalNumber(args, 'tolerance')
  if ((target === undefined) !== (tolerance === undefined)) {
    throw new Error('target and tolerance must be supplied together.')
  }

  const constraints = {
    ...(optionalNumber(args, 'minSafetyFactor') !== undefined ? { minSafetyFactor: optionalNumber(args, 'minSafetyFactor') } : {}),
    ...(optionalNumber(args, 'maxDeflectionMm') !== undefined ? { maxDeflectionMm: optionalNumber(args, 'maxDeflectionMm') } : {}),
    ...(optionalNumber(args, 'maxStressMPa') !== undefined ? { maxStressMPa: optionalNumber(args, 'maxStressMPa') } : {}),
    ...(optionalNumber(args, 'minFrequencyHz') !== undefined ? { minFrequencyHz: optionalNumber(args, 'minFrequencyHz') } : {}),
    ...(optionalNumber(args, 'minBucklingLoadN') !== undefined ? { minBucklingLoadN: optionalNumber(args, 'minBucklingLoadN') } : {}),
    ...(optionalNumber(args, 'maxMassKg') !== undefined ? { maxMassKg: optionalNumber(args, 'maxMassKg') } : {}),
  }

  const goal: MechanicalAutopilotGoal = { part }
  if (metric !== undefined) goal.metric = metric
  if (direction !== undefined) goal.direction = direction
  if (target !== undefined && tolerance !== undefined) goal.target = { value: target, tolerance }
  if (knobs !== undefined) goal.knobs = knobs
  const materials = readMaterials(args)
  if (materials !== undefined) goal.materials = materials
  if (Object.keys(constraints).length > 0) goal.constraints = constraints

  const samplesPerKnob = optionalNumber(args, 'samplesPerKnob')
  const refineSteps = optionalNumber(args, 'refineSteps')
  const maxIterations = optionalNumber(args, 'maxIterations')
  const includeDrawings = readBoolean(args, 'includeDrawings')

  const outcome = await runMechanicalAutopilot({
    runtime: { read: liveParts, write: commitParts },
    goal,
    ...(samplesPerKnob !== undefined ? { samplesPerKnob } : {}),
    ...(refineSteps !== undefined ? { refineSteps } : {}),
    ...(maxIterations !== undefined ? { maxIterations } : {}),
  })

  if (includeDrawings) return outcome
  // An iteration drawing is a large SVG. Keep the winner's drawing and the
  // numeric evidence for every candidate; an agent can ask for all drawings
  // when it genuinely wants to inspect each frame.
  return {
    ...outcome,
    iterations: outcome.iterations.map((iteration) => {
      const copy = { ...iteration }
      delete copy.assemblySvg
      return copy
    }),
  }
}

export function mechanicalTools(): AgentTool[] {
  return [
    {
      name: 'mech.observe',
      description: 'Observe the live mechanical assembly as canonical JSON plus a millimeter front-elevation SVG',
      parameters: { part: 'string' },
      optionalParameters: ['part'],
      handler: realObserve,
      needsApproval: false,
    },
    {
      name: 'mech.addPart',
      description: 'Add a beam or plate (dimensions and position in metres) and publish it to the mechanical workspace',
      parameters: { name: 'string', kind: 'string', length: 'number', width: 'number', height: 'number' },
      optionalParameters: ['x', 'y', 'z', 'material', 'support', 'forceN', 'pressurePa'],
      handler: realAddPart,
      needsApproval: false,
    },
    {
      name: 'mech.movePart',
      description: 'Move a part to x/y/z metres, optionally setting its in-plane rotationZ in degrees',
      parameters: { part: 'string', x: 'number', y: 'number', z: 'number' },
      optionalParameters: ['rotationZ'],
      handler: realMovePart,
      needsApproval: false,
    },
    {
      name: 'mech.resizePart',
      description: 'Resize a part (length/width/height in metres) and/or change its material, recomputing mass properties',
      parameters: { part: 'string' },
      optionalParameters: ['length', 'width', 'height', 'material'],
      handler: realResizePart,
      needsApproval: false,
    },
    {
      name: 'mech.setSupport',
      description: 'Set a part support to fixed, pinned, roller, or free; unsupported parts cannot be analysed',
      parameters: { part: 'string', support: 'string' },
      handler: realSetSupport,
      needsApproval: false,
    },
    {
      name: 'mech.setLoad',
      description: 'Replace a part load: a downward forceN (newtons), pressurePa (pascals), and/or temperatureK',
      parameters: { part: 'string' },
      optionalParameters: ['forceN', 'pressurePa', 'temperatureK'],
      handler: realSetLoad,
      needsApproval: false,
    },
    {
      name: 'mech.analyze',
      description: 'Run closed-form beam analysis (stress, deflection, safety factor, modes, buckling) on one part or all parts',
      parameters: { part: 'string' },
      optionalParameters: ['part'],
      handler: realAnalyze,
      needsApproval: false,
    },
    {
      name: 'mech.autopilot',
      description:
        'Size one part with a bounded deterministic search: sweep dimensions (metres) and materials, enforce ' +
        'safety-factor, deflection, stress, frequency, buckling, and mass limits, redraw the assembly every ' +
        'candidate, and leave the best design on the live assembly. knobs is JSON [{dimension,from,to,scale}]; ' +
        'materials is comma-separated or a JSON array.',
      parameters: { part: 'string' },
      optionalParameters: [
        'metric',
        'direction',
        'target',
        'tolerance',
        'knobs',
        'materials',
        'minSafetyFactor',
        'maxDeflectionMm',
        'maxStressMPa',
        'minFrequencyHz',
        'minBucklingLoadN',
        'maxMassKg',
        'samplesPerKnob',
        'refineSteps',
        'maxIterations',
        'includeDrawings',
      ],
      handler: realAutopilot,
      needsApproval: false,
    },
  ]
}

export function registerMechanicalTools(harness: AgentHarness): AgentTool[] {
  const tools = mechanicalTools()
  for (const tool of tools) harness.registerTool(tool)
  return tools
}
