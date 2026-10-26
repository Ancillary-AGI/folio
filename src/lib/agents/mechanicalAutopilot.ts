/**
 * Deterministic mechanical sizing loop.
 *
 * This is the mechanical twin of `runAutopilot`: it edits the live assembly,
 * re-runs the same closed-form beam analysis a human sees, checks declared
 * limits, and keeps the best measured part. Every candidate is a real store
 * write, so the 3-D viewport and the front-elevation drawing follow the search
 * while it runs.
 *
 * The search is a bounded deterministic grid over section dimensions and
 * material choices, followed by a local refinement around the best point. When
 * the declared grid is larger than the candidate budget it is sampled at evenly
 * spaced points and the result says so. It never claims a global optimum: the
 * reported design is the best point this budget measured.
 */
import {
  analysePart,
  partProperties,
  supportFor,
  type MechanicalPart,
} from '../mechanical/partModel'
import { MATERIALS } from '../mechanical/materials'
import { captureMechanicalSnapshot, mechanicalToSvg } from './mechanicalSnapshot'
import { yieldToUi } from './uiYield'

export type MechanicalDimension = 'length' | 'width' | 'height'

export type MechanicalMetric =
  | 'mass'
  | 'safetyFactor'
  | 'deflection'
  | 'stress'
  | 'frequency'
  | 'buckling'

export interface MechanicalSizingKnob {
  dimension: MechanicalDimension
  /** Bound in metres. */
  from: number
  /** Bound in metres. */
  to: number
  scale?: 'linear' | 'log'
}

export interface MechanicalSizingConstraints {
  minSafetyFactor?: number
  maxDeflectionMm?: number
  maxStressMPa?: number
  minFrequencyHz?: number
  minBucklingLoadN?: number
  maxMassKg?: number
}

export interface MechanicalAutopilotGoal {
  description?: string
  /** Part id, matched case-insensitively. */
  part: string
  metric?: MechanicalMetric
  target?: { value: number; tolerance: number }
  direction?: 'minimize' | 'maximize'
  knobs?: MechanicalSizingKnob[]
  /** Material keys from `MATERIALS`; defaults to the part's current material. */
  materials?: string[]
  constraints?: MechanicalSizingConstraints
}

export interface MechanicalAutopilotRuntime {
  read(): readonly MechanicalPart[]
  write(parts: MechanicalPart[]): void
}

export interface MechanicalSizingAnalysis {
  stressMPa: number
  deflectionMm: number
  safetyFactor: number | null
  yields: boolean
  naturalFrequenciesHz: number[]
  bucklingLoadN: number
}

export interface MechanicalAutopilotIteration {
  iteration: number
  phase: 'baseline' | 'sweep' | 'refine' | 'restore'
  partId: string
  partName: string
  /** SI dimensions in metres, plus the material key. */
  values: Record<string, number | string>
  metric?: number
  metricLabel: string
  metricUnit?: string
  target?: { value: number; tolerance: number }
  score?: number
  best: boolean
  goalMet: boolean
  constraintFailures: string[]
  message: string
  error?: string
  analysis?: MechanicalSizingAnalysis
  partMassKg?: number
  assemblyMassKg?: number
  warnings?: string[]
  assemblySvg?: string
}

export interface MechanicalAutopilotBest {
  iteration: number
  values: Record<string, number | string>
  metric?: number
  metricLabel: string
  metricUnit?: string
  score: number
  partMassKg: number
  assemblyMassKg: number
  analysis: MechanicalSizingAnalysis
  part: MechanicalPart
  assemblySvg?: string
}

export interface MechanicalAutopilotSearch {
  /** Candidates evaluated, including baseline and refinement. */
  evaluated: number
  /** Size of the declared dimension × material grid before sampling. */
  gridCandidates: number
  /** True when the budget sampled the grid instead of testing every point. */
  truncated: boolean
  samplesPerKnob: number
  maxIterations: number
  note: string
}

export interface MechanicalAutopilotResult {
  achieved: boolean
  reason: string
  goal: Required<Pick<MechanicalAutopilotGoal, 'part' | 'metric' | 'direction'>> & MechanicalAutopilotGoal
  baselineMetric?: number
  iterations: MechanicalAutopilotIteration[]
  best?: MechanicalAutopilotBest
  finalParts: MechanicalPart[]
  search: MechanicalAutopilotSearch
}

export interface MechanicalAutopilotOptions {
  runtime: MechanicalAutopilotRuntime
  goal: MechanicalAutopilotGoal
  /** Grid points per dimension knob. */
  samplesPerKnob?: number
  /** Local ± half-step refinement rounds after the grid. */
  refineSteps?: number
  /** Hard cap on evaluated candidates, including baseline and restore. */
  maxIterations?: number
  /** Leave the assembly on the best part (default true). */
  restoreBest?: boolean
  signal?: AbortSignal
  onEvent?: (iteration: MechanicalAutopilotIteration) => void
}

interface Candidate {
  iteration: number
  phase: MechanicalAutopilotIteration['phase']
  values: Record<string, number | string>
  metric?: number
  metricLabel: string
  metricUnit?: string
  score: number
  goalMet: boolean
  constraintFailures: string[]
  error?: string
  analysis?: MechanicalSizingAnalysis
  part?: MechanicalPart
  partMassKg?: number
  assemblyMassKg?: number
  warnings?: string[]
  assemblySvg?: string
}

const FAILED = -Infinity
const DIMENSIONS: readonly MechanicalDimension[] = ['length', 'width', 'height']

const METRIC_LABELS: Record<MechanicalMetric, { label: string; unit: string }> = {
  mass: { label: 'part mass', unit: 'kg' },
  safetyFactor: { label: 'safety factor', unit: 'ratio' },
  deflection: { label: 'tip deflection', unit: 'mm' },
  stress: { label: 'peak stress', unit: 'MPa' },
  frequency: { label: 'first natural frequency', unit: 'Hz' },
  buckling: { label: 'buckling load', unit: 'N' },
}

const DEFAULT_DIRECTION: Record<MechanicalMetric, 'minimize' | 'maximize'> = {
  mass: 'minimize',
  safetyFactor: 'maximize',
  deflection: 'minimize',
  stress: 'minimize',
  frequency: 'maximize',
  buckling: 'maximize',
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  const magnitude = Math.abs(value)
  if (magnitude !== 0 && (magnitude >= 1e6 || magnitude < 1e-3)) return value.toExponential(3)
  return String(Number(value.toPrecision(5)))
}

function formatMillimetres(metres: number): string {
  return `${formatNumber(metres * 1000)} mm`
}

function describeValues(values: Record<string, number | string>): string {
  return DIMENSIONS.filter((dimension) => typeof values[dimension] === 'number')
    .map((dimension) => `${dimension} ${formatMillimetres(values[dimension] as number)}`)
    .concat(`material ${String(values.material)}`)
    .join(', ')
}

function resolvePart(parts: readonly MechanicalPart[], id: string): MechanicalPart {
  const wanted = id.trim().toLowerCase()
  const part = parts.find((candidate) => candidate.id.toLowerCase() === wanted)
  if (part) return part
  const available = parts.map((candidate) => `${candidate.id} (${candidate.name})`).join(', ') || '(no parts)'
  throw new Error(`No mechanical part "${id}". Parts: ${available}.`)
}

function defaultKnobs(part: MechanicalPart): MechanicalSizingKnob[] {
  return (['width', 'height'] as const).map((dimension) => ({
    dimension,
    from: part.dimensions[dimension] * 0.5,
    to: part.dimensions[dimension] * 1.5,
    scale: 'linear',
  }))
}

function validateKnobs(knobs: readonly MechanicalSizingKnob[]): void {
  const seen = new Set<MechanicalDimension>()
  for (const knob of knobs) {
    if (!DIMENSIONS.includes(knob.dimension)) {
      throw new Error(`Unknown dimension "${String(knob.dimension)}"; use length, width, or height.`)
    }
    if (seen.has(knob.dimension)) throw new Error(`Dimension "${knob.dimension}" is tuned twice.`)
    seen.add(knob.dimension)
    if (!Number.isFinite(knob.from) || !Number.isFinite(knob.to) || knob.from <= 0 || knob.to <= 0) {
      throw new Error(`${knob.dimension} bounds must be finite and > 0 (metres), got ${knob.from}..${knob.to}.`)
    }
    if (knob.from === knob.to) {
      throw new Error(`${knob.dimension} bounds are identical; a knob needs a range.`)
    }
    if (knob.scale === 'log' && !(knob.from > 0 && knob.to > 0)) {
      throw new Error(`Log knob ${knob.dimension} needs positive bounds.`)
    }
  }
}

function validateConstraints(constraints: MechanicalSizingConstraints | undefined): void {
  if (!constraints) return
  const checks: Array<[keyof MechanicalSizingConstraints, string, boolean]> = [
    ['minSafetyFactor', 'minSafetyFactor', true],
    ['maxDeflectionMm', 'maxDeflectionMm', false],
    ['maxStressMPa', 'maxStressMPa', false],
    ['minFrequencyHz', 'minFrequencyHz', false],
    ['minBucklingLoadN', 'minBucklingLoadN', false],
    ['maxMassKg', 'maxMassKg', false],
  ]
  for (const [key, label, strictlyPositive] of checks) {
    const value = constraints[key]
    if (value === undefined) continue
    if (!Number.isFinite(value) || value < 0 || (strictlyPositive && value === 0)) {
      throw new Error(`${label} must be a finite ${strictlyPositive ? 'value > 0' : 'value >= 0'}, got ${value}.`)
    }
  }
}

function metricOf(
  metric: MechanicalMetric,
  part: MechanicalPart,
  analysis: ReturnType<typeof analysePart>,
): number | undefined {
  switch (metric) {
    case 'mass':
      return part.properties.mass
    case 'safetyFactor':
      return analysis.safetyFactor ?? undefined
    case 'deflection':
      return analysis.deflectionM * 1000
    case 'stress':
      return analysis.stressPa / 1e6
    case 'frequency':
      return analysis.naturalFrequenciesHz[0]
    case 'buckling':
      return analysis.bucklingLoadN
  }
}

function constraintFailuresFor(
  constraints: MechanicalSizingConstraints | undefined,
  part: MechanicalPart,
  analysis: ReturnType<typeof analysePart>,
): string[] {
  if (!constraints) return []
  const failures: string[] = []
  if (constraints.minSafetyFactor !== undefined) {
    if (analysis.safetyFactor === null) {
      failures.push('No safety factor can be computed for this part.')
    } else if (analysis.safetyFactor < constraints.minSafetyFactor) {
      failures.push(
        `Safety factor ${analysis.safetyFactor.toFixed(2)} is below ${constraints.minSafetyFactor}.`,
      )
    }
  }
  if (constraints.maxDeflectionMm !== undefined) {
    const deflectionMm = analysis.deflectionM * 1000
    if (deflectionMm > constraints.maxDeflectionMm) {
      failures.push(
        `Tip deflection ${formatNumber(deflectionMm)} mm exceeds ${constraints.maxDeflectionMm} mm.`,
      )
    }
  }
  if (constraints.maxStressMPa !== undefined) {
    const stressMPa = analysis.stressPa / 1e6
    if (stressMPa > constraints.maxStressMPa) {
      failures.push(`Peak stress ${formatNumber(stressMPa)} MPa exceeds ${constraints.maxStressMPa} MPa.`)
    }
  }
  if (constraints.minFrequencyHz !== undefined) {
    const frequency = analysis.naturalFrequenciesHz[0]
    if (frequency === undefined || frequency < constraints.minFrequencyHz) {
      failures.push(
        `First mode ${frequency === undefined ? 'is unavailable' : `${formatNumber(frequency)} Hz`} is below ${constraints.minFrequencyHz} Hz.`,
      )
    }
  }
  if (constraints.minBucklingLoadN !== undefined) {
    if (analysis.bucklingLoadN < constraints.minBucklingLoadN) {
      failures.push(
        `Buckling load ${formatNumber(analysis.bucklingLoadN)} N is below ${constraints.minBucklingLoadN} N.`,
      )
    }
  }
  if (constraints.maxMassKg !== undefined && part.properties.mass > constraints.maxMassKg) {
    failures.push(`Part mass ${formatNumber(part.properties.mass)} kg exceeds ${constraints.maxMassKg} kg.`)
  }
  return failures
}

function scoreOf(
  metric: number | undefined,
  target: { value: number; tolerance: number } | undefined,
  direction: 'minimize' | 'maximize',
  failures: string[],
): number {
  let score = FAILED
  if (metric !== undefined) {
    if (target) score = -Math.abs(metric - target.value)
    else score = direction === 'minimize' ? -metric : metric
  }
  if (failures.length > 0) score -= 1e9 * failures.length
  return score
}

function goalMet(
  candidate: Candidate,
  target: { value: number; tolerance: number } | undefined,
  direction: 'minimize' | 'maximize',
  baseline?: Candidate,
): boolean {
  if (candidate.error || candidate.metric === undefined) return false
  if (candidate.constraintFailures.length > 0) return false
  if (target) return Math.abs(candidate.metric - target.value) <= target.tolerance
  if (!baseline || baseline.metric === undefined) return false
  return direction === 'minimize'
    ? candidate.metric < baseline.metric
    : candidate.metric > baseline.metric
}

function gridValues(knob: MechanicalSizingKnob, samples: number): number[] {
  if (samples <= 1) return [knob.from]
  const count = Math.max(2, Math.round(samples))
  const values: number[] = []
  if (knob.scale === 'log') {
    const low = Math.log(knob.from)
    const high = Math.log(knob.to)
    for (let index = 0; index < count; index += 1) {
      values.push(Math.exp(low + ((high - low) * index) / (count - 1)))
    }
  } else {
    for (let index = 0; index < count; index += 1) {
      values.push(knob.from + ((knob.to - knob.from) * index) / (count - 1))
    }
  }
  return values
}

/**
 * Evenly spaced indices over `total` points, always including the ends. Used
 * when the declared grid is larger than the candidate budget, so the sampled
 * points still cover the whole range instead of only its first corner.
 */
function sampleIndices(total: number, wanted: number): number[] {
  if (wanted >= total) return Array.from({ length: total }, (_, index) => index)
  if (wanted <= 1) return [0]
  const indices = new Set<number>()
  for (let index = 0; index < wanted; index += 1) {
    indices.add(Math.round((index * (total - 1)) / (wanted - 1)))
  }
  return [...indices].sort((a, b) => a - b)
}

function valuesForIndex(
  index: number,
  dimensionKnobs: readonly MechanicalSizingKnob[],
  valueLists: readonly number[][],
  materials: readonly string[],
): Record<string, number | string> {
  let rest = index
  const material = materials[rest % materials.length]
  rest = Math.floor(rest / materials.length)
  const values: Record<string, number | string> = { material }
  for (let position = dimensionKnobs.length - 1; position >= 0; position -= 1) {
    const list = valueLists[position]
    values[dimensionKnobs[position].dimension] = list[rest % list.length]
    rest = Math.floor(rest / list.length)
  }
  return values
}

function withCandidatePart(
  base: MechanicalPart,
  values: Record<string, number | string>,
  knobs: readonly MechanicalSizingKnob[],
): MechanicalPart {
  const dimensions = { ...base.dimensions }
  for (const knob of knobs) {
    const value = values[knob.dimension]
    if (typeof value !== 'number') throw new Error(`Candidate is missing ${knob.dimension}.`)
    dimensions[knob.dimension] = value
  }
  const materialKey = String(values.material)
  const material = MATERIALS[materialKey]
  if (!material) throw new Error(`Unknown material "${materialKey}".`)
  return {
    ...base,
    dimensions,
    materialKey,
    material,
    properties: partProperties(dimensions, material, base.position),
  }
}

/**
 * Size one part on the live assembly. Throws before mutating anything when the
 * goal is malformed or the target cannot be analysed.
 */
export async function runMechanicalAutopilot(
  options: MechanicalAutopilotOptions,
): Promise<MechanicalAutopilotResult> {
  const { runtime } = options
  const emit = options.onEvent ?? (() => {})
  const metric = options.goal.metric ?? 'mass'
  const direction = options.goal.direction ?? DEFAULT_DIRECTION[metric]
  const target = options.goal.target
  const constraints = options.goal.constraints
  const samples = Math.round(options.samplesPerKnob ?? 5)
  const refineSteps = Math.round(options.refineSteps ?? 1)
  const maxIterations = Math.round(options.maxIterations ?? 120)
  if (samples < 2 || samples > 20) throw new Error('samplesPerKnob must be an integer from 2 to 20.')
  if (refineSteps < 0 || refineSteps > 8) throw new Error('refineSteps must be an integer from 0 to 8.')
  if (maxIterations < 2 || maxIterations > 2000) {
    throw new Error('maxIterations must be an integer from 2 to 2000.')
  }

  if (target) {
    if (!Number.isFinite(target.value)) throw new Error('A target needs a finite value.')
    if (!Number.isFinite(target.tolerance) || target.tolerance <= 0) {
      throw new Error('A target needs a positive tolerance.')
    }
  }
  validateConstraints(constraints)

  const initialParts = [...runtime.read()]
  const initialTarget = resolvePart(initialParts, options.goal.part)
  if (supportFor(initialTarget) === null) {
    throw new Error(`"${initialTarget.name}" has no support; set fixed, pinned, or roller before sizing it.`)
  }
  try {
    analysePart(initialTarget)
  } catch (error) {
    throw new Error(
      `"${initialTarget.name}" cannot be analysed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  const knobs = options.goal.knobs ?? defaultKnobs(initialTarget)
  if (knobs.length === 0) throw new Error('A sizing goal needs at least one dimension knob.')
  validateKnobs(knobs)

  const materials = [...new Set(options.goal.materials ?? [initialTarget.materialKey])]
  if (materials.length === 0) throw new Error('A sizing goal needs at least one material.')
  for (const key of materials) {
    if (!MATERIALS[key]) {
      throw new Error(`Unknown material "${key}". Materials: ${Object.keys(MATERIALS).join(', ')}.`)
    }
  }

  const label = METRIC_LABELS[metric].label
  const unit = METRIC_LABELS[metric].unit
  const valueLists = knobs.map((knob) => gridValues(knob, samples))
  const gridCandidates =
    materials.length * valueLists.reduce((product, list) => product * list.length, 1)
  // Reserve one candidate for the baseline measurement and one for restoring
  // the winner; refinement then fills whatever budget remains.
  const sweepBudget = Math.max(1, maxIterations - 2)
  const pickedIndices = sampleIndices(gridCandidates, sweepBudget)
  const truncated = pickedIndices.length < gridCandidates

  const baselineValues: Record<string, number | string> = { material: initialTarget.materialKey }
  for (const knob of knobs) baselineValues[knob.dimension] = initialTarget.dimensions[knob.dimension]

  const iterations: MechanicalAutopilotIteration[] = []
  const evaluated: Candidate[] = []

  const apply = (values: Record<string, number | string>): MechanicalPart => {
    const parts = [...runtime.read()]
    const targetPart = resolvePart(parts, initialTarget.id)
    const next = withCandidatePart(targetPart, values, knobs)
    runtime.write(parts.map((part) => (part.id === targetPart.id ? next : part)))
    return next
  }

  const evaluate = async (
    iteration: number,
    phase: MechanicalAutopilotIteration['phase'],
    values: Record<string, number | string>,
    baseline?: Candidate,
  ): Promise<Candidate> => {
    const candidate: Candidate = {
      iteration,
      phase,
      values: { ...values },
      metricLabel: label,
      score: FAILED,
      goalMet: false,
      constraintFailures: [],
    }
    try {
      const nextPart = apply(values)
      const partsNow = [...runtime.read()]
      const analysis = analysePart(nextPart)
      const snapshot = captureMechanicalSnapshot(partsNow)

      candidate.analysis = {
        stressMPa: Number((analysis.stressPa / 1e6).toFixed(6)),
        deflectionMm: Number((analysis.deflectionM * 1000).toFixed(6)),
        safetyFactor: analysis.safetyFactor === null ? null : Number(analysis.safetyFactor.toFixed(4)),
        yields: analysis.yields,
        naturalFrequenciesHz: analysis.naturalFrequenciesHz.map((value) => Number(value.toFixed(3))),
        bucklingLoadN: Number(analysis.bucklingLoadN.toFixed(3)),
      }
      candidate.part = nextPart
      candidate.partMassKg = nextPart.properties.mass
      candidate.assemblyMassKg = snapshot.summary.totalMassKg
      candidate.warnings = snapshot.warnings.map((warning) => warning.message)
      candidate.assemblySvg = mechanicalToSvg(partsNow, { width: 640 })
      candidate.metric = metricOf(metric, nextPart, analysis)
      if (candidate.metric === undefined) {
        throw new Error(`"${nextPart.name}" produced no ${label} to measure.`)
      }
      candidate.constraintFailures = constraintFailuresFor(constraints, nextPart, analysis)
      candidate.score = scoreOf(candidate.metric, target, direction, candidate.constraintFailures)
      candidate.goalMet = goalMet(candidate, target, direction, baseline)
    } catch (error) {
      candidate.error = error instanceof Error ? error.message : String(error)
      candidate.score = FAILED
      candidate.constraintFailures = [candidate.error]
    }

    const event: MechanicalAutopilotIteration = {
      iteration,
      phase,
      partId: initialTarget.id,
      partName: initialTarget.name,
      values: { ...candidate.values },
      metric: candidate.metric,
      metricLabel: candidate.metricLabel,
      metricUnit: unit,
      target,
      score: Number.isFinite(candidate.score) ? candidate.score : undefined,
      best: false,
      goalMet: candidate.goalMet,
      message: candidate.error
        ? `Iteration ${iteration} failed: ${candidate.error}`
        : `${label} = ${formatNumber(candidate.metric ?? Number.NaN)} ${unit}` +
          (candidate.constraintFailures.length ? `; ${candidate.constraintFailures.join(' ')}` : ''),
      error: candidate.error,
      constraintFailures: candidate.constraintFailures,
      analysis: candidate.analysis,
      partMassKg: candidate.partMassKg,
      assemblyMassKg: candidate.assemblyMassKg,
      warnings: candidate.warnings,
      assemblySvg: candidate.assemblySvg,
    }
    iterations.push(event)
    evaluated.push(candidate)
    emit(event)
    await yieldToUi()
    return candidate
  }

  const abort = (): boolean => options.signal?.aborted === true
  const baseline = await evaluate(0, 'baseline', baselineValues)
  let best = baseline
  let bestIteration = 0
  let counter = 1

  const consider = (candidate: Candidate): void => {
    if (candidate.score > best.score || (best.error !== undefined && candidate.error === undefined)) {
      best = candidate
      bestIteration = candidate.iteration
    }
  }

  // A target is an acceptance test, so meeting it can end the search early. A
  // bare minimise/maximise goal has no pass/fail line: sweep the budget and
  // report the best point actually measured.
  let stop = abort()

  outer: for (const index of pickedIndices) {
    if (counter >= maxIterations - 1 || abort()) break
    // The baseline already measured this corner of the grid.
    const values = valuesForIndex(index, knobs, valueLists, materials)
    if (knobs.every((knob) => values[knob.dimension] === baselineValues[knob.dimension])
      && values.material === baselineValues.material) {
      continue
    }
    const candidate = await evaluate(counter, 'sweep', values, baseline)
    counter += 1
    consider(candidate)
    if (target && candidate.goalMet) {
      stop = true
      break outer
    }
  }

  // Local refinement: halve the grid step around the best measured section.
  for (let round = 0; round < refineSteps && !stop && best.error === undefined; round += 1) {
    for (const knob of knobs) {
      if (counter >= maxIterations - 1 || abort()) break
      const dimension = knob.dimension
      const current = best.values[dimension]
      if (typeof current !== 'number') continue
      const step =
        ((knob.to - knob.from) / Math.max(1, samples - 1)) / 2 ** (round + 1)
      for (const value of [current - step, current + step]) {
        if (counter >= maxIterations - 1 || abort()) break
        const low = Math.min(knob.from, knob.to)
        const high = Math.max(knob.from, knob.to)
        if (value < low || value > high) continue
        const values = { ...best.values, [dimension]: value }
        const candidate = await evaluate(counter, 'refine', values, baseline)
        counter += 1
        consider(candidate)
        if (target && candidate.goalMet) {
          stop = true
          break
        }
      }
    }
  }

  if (best.error === undefined) {
    for (const iteration of iterations) iteration.best = iteration.iteration === bestIteration
  }

  let achieved = best.goalMet
  let reason: string
  if (best.error !== undefined) {
    reason = `No candidate could be measured: ${best.error}`
  } else if (achieved && target && best.metric !== undefined) {
    reason =
      `Target met: ${label} = ${formatNumber(best.metric)} ${unit} ` +
      `(target ${formatNumber(target.value)} ± ${formatNumber(target.tolerance)}) at ${describeValues(best.values)}.`
  } else if (achieved && best.metric !== undefined && baseline.metric !== undefined) {
    reason =
      `Improved ${label} from ${formatNumber(baseline.metric)} ${unit} to ` +
      `${formatNumber(best.metric)} ${unit} at ${describeValues(best.values)}. ` +
      'This is the best point the bounded search found; it is not a proof of a global optimum.'
  } else if (best.metric !== undefined) {
    reason =
      `No candidate improved on the baseline within ${counter} measured iteration(s). ` +
      `Best: ${label} = ${formatNumber(best.metric)} ${unit} at ${describeValues(best.values)}.`
  } else {
    reason = `The search did not produce a usable ${label}.`
  }
  if (truncated) {
    reason += ` The ${gridCandidates}-candidate grid was sampled at ${pickedIndices.length} points to stay within the candidate budget.`
  }
  if (abort()) {
    achieved = false
    reason = `Stopped by the caller. ${reason}`
  }

  const winningPart = best.part
  const restoreBest =
    options.restoreBest !== false && best.error === undefined && winningPart !== undefined && bestIteration !== counter - 1
  if (restoreBest && winningPart) {
    const partsNow = [...runtime.read()]
    runtime.write(partsNow.map((part) => (part.id === winningPart.id ? winningPart : part)))
    try {
      const partsRestored = [...runtime.read()]
      const snapshot = captureMechanicalSnapshot(partsRestored)
      const restored: MechanicalAutopilotIteration = {
        iteration: counter,
        phase: 'restore',
        partId: initialTarget.id,
        partName: initialTarget.name,
        values: { ...best.values },
        metric: best.metric,
        metricLabel: label,
        metricUnit: unit,
        target,
        score: Number.isFinite(best.score) ? best.score : undefined,
        best: true,
        goalMet: best.goalMet,
        constraintFailures: best.constraintFailures,
        message: `Restored the best iteration (${bestIteration}).`,
        analysis: best.analysis,
        partMassKg: best.partMassKg,
        assemblyMassKg: snapshot.summary.totalMassKg,
        warnings: snapshot.warnings.map((warning) => warning.message),
        assemblySvg: mechanicalToSvg(partsRestored, { width: 640 }),
      }
      iterations.push(restored)
      emit(restored)
      best.assemblySvg = restored.assemblySvg
      best.assemblyMassKg = restored.assemblyMassKg
    } catch (error) {
      reason += ` Restoring the best design failed: ${error instanceof Error ? error.message : String(error)}.`
      achieved = false
    }
  } else if (options.restoreBest !== false && best.error !== undefined) {
    runtime.write(initialParts)
    reason += ' The original assembly was restored.'
    const restored: MechanicalAutopilotIteration = {
      iteration: counter,
      phase: 'restore',
      partId: initialTarget.id,
      partName: initialTarget.name,
      values: { ...baselineValues },
      metricLabel: label,
      metricUnit: unit,
      best: false,
      goalMet: false,
      message: `Restored the original assembly; no candidate could be measured (${best.error}).`,
      error: best.error,
      constraintFailures: best.constraintFailures,
    }
    iterations.push(restored)
    emit(restored)
  }

  const finalParts = [...runtime.read()]
  const bestResult: MechanicalAutopilotBest | undefined =
    best.error === undefined && best.part && best.analysis && best.partMassKg !== undefined && best.assemblyMassKg !== undefined
      ? {
          iteration: bestIteration,
          values: { ...best.values },
          metric: best.metric,
          metricLabel: label,
          metricUnit: unit,
          score: best.score,
          partMassKg: best.partMassKg,
          assemblyMassKg: best.assemblyMassKg,
          analysis: best.analysis,
          part: best.part,
          assemblySvg: best.assemblySvg,
        }
      : undefined

  return {
    achieved,
    reason,
    goal: { ...options.goal, part: initialTarget.id, metric, direction },
    baselineMetric: baseline.metric,
    iterations,
    best: bestResult,
    finalParts,
    search: {
      evaluated: counter,
      gridCandidates,
      truncated,
      samplesPerKnob: samples,
      maxIterations,
      note:
        'Deterministic bounded grid with local refinement. The result is the best point this budget measured, not a global optimum.',
    },
  }
}
