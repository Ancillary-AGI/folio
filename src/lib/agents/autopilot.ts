/**
 * Closed-loop agentic design.
 *
 * Two loops share one tool surface:
 *
 *  - `runAgentLoop` is the harness for a model-driven agent. Before every
 *    decision it refreshes `cad.observe`, then executes exactly one tool call
 *    under the harness budget and audit. The model always reasons about the
 *    sheet as it is now, not as it was when the session started.
 *
 *  - `runAutopilot` is a deterministic optimisation loop that needs no model:
 *    it changes a declared knob, re-simulates the live canvas, measures the
 *    requested quantity, rates the design, and keeps the best iteration. It
 *    exists so "agentic solo design" is testable and useful today; a model can
 *    drive the same tools for goals that need invention rather than search.
 *
 * Neither loop fabricates a result: a candidate that fails to solve is
 * recorded as a failure, margins are only reported when the solver produced
 * the quantities they need, and direction-only searches say they are bounded
 * rather than claiming a global optimum.
 */
import type { AgentBudget, AgentCall, AgentHarness } from './agentHarness'
import type { CadDesignState, CadRuntime } from './cadRuntime'
import { findComponentByReference } from './cadRuntime'
import {
  createCadToolset,
  type CadAssessmentOutput,
  type CadErcOutput,
  type CadObservation,
  type CadSimulationOutput,
} from './cadTools'
import type { SimulationParameters } from '../simulation/spiceEngine'
import { statisticValue, type Statistic } from '../simulation/waveformStats'
import { parseSpiceValue } from '../simulation/devices'
import { yieldToUi } from './uiYield'

type Args = Record<string, string | number | boolean>

/* ------------------------------------------------------------------ *
 * Model-driven loop
 * ------------------------------------------------------------------ */

export type AgentDecision =
  | { tool: string; args?: Args; rationale?: string }
  | { done: true; summary: string }

export interface AgentLoopContext {
  step: number
  remainingCalls: number
  observation: CadObservation
  transcript: readonly AgentCall[]
}

export interface AgentLoopEvent {
  kind: 'observation' | 'call' | 'done' | 'budget' | 'aborted'
  step: number
  message: string
  call?: AgentCall
  observation?: CadObservation
}

export interface AgentLoopOptions {
  harness: AgentHarness
  decide: (context: AgentLoopContext) => AgentDecision | Promise<AgentDecision>
  budget: AgentBudget
  approve?: (tool: string, args: Args) => boolean | Promise<boolean>
  maxSteps?: number
  signal?: AbortSignal
  onEvent?: (event: AgentLoopEvent) => void
}

export interface AgentLoopResult {
  done: boolean
  summary: string
  calls: readonly AgentCall[]
}

const allowAll = (): boolean => true

/**
 * Run observe → decide → act until the agent says done, the budget runs out,
 * or the caller aborts. The observation call is budgeted too: an agent pays
 * for its eyes, which keeps runaway loops bounded.
 */
export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const { harness, decide, budget } = options
  const approve = options.approve ?? allowAll
  const maxSteps = options.maxSteps ?? budget.maxCalls
  const emit = options.onEvent ?? (() => {})

  for (let step = 0; step < maxSteps; step++) {
    if (options.signal?.aborted) {
      emit({ kind: 'aborted', step, message: 'Aborted by the caller.' })
      return { done: false, summary: 'Stopped by the caller.', calls: harness.auditTrail() }
    }
    let observation
    try {
      const call = await harness.call('cad.observe', {}, budget, approve)
      if (call.error) throw new Error(call.error)
      observation = call.result as CadObservation
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      emit({ kind: 'budget', step, message: `Could not observe the sheet: ${message}` })
      return { done: false, summary: message, calls: harness.auditTrail() }
    }
    emit({ kind: 'observation', step, message: `Observed ${observation.stats.components} part(s), ${observation.stats.nets} net(s).`, observation })

    let decision: AgentDecision
    try {
      decision = await decide({
        step,
        remainingCalls: Math.max(0, budget.maxCalls - harness.auditTrail().length),
        observation,
        transcript: harness.auditTrail(),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      emit({ kind: 'budget', step, message: `The planner failed: ${message}` })
      return { done: false, summary: message, calls: harness.auditTrail() }
    }

    if ('done' in decision) {
      emit({ kind: 'done', step, message: decision.summary })
      return { done: true, summary: decision.summary, calls: harness.auditTrail() }
    }

    try {
      const call = await harness.call(decision.tool, decision.args ?? {}, budget, approve)
      emit({
        kind: 'call',
        step,
        message: call.error ? `${decision.tool} failed: ${call.error}` : `${decision.tool} completed.`,
        call,
      })
      if (call.error) {
        // Failures are part of the loop: the next observation and transcript
        // show the agent what broke, and it decides whether to retry.
        continue
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      emit({ kind: 'budget', step, message })
      return { done: false, summary: message, calls: harness.auditTrail() }
    }
  }

  emit({ kind: 'budget', step: maxSteps, message: `Stopped after ${maxSteps} step(s).` })
  return {
    done: false,
    summary: `Stopped after ${maxSteps} step(s) without a completion signal.`,
    calls: harness.auditTrail(),
  }
}

/* ------------------------------------------------------------------ *
 * Deterministic autopilot
 * ------------------------------------------------------------------ */

export interface AutopilotKnob {
  reference: string
  property: string
  from: number
  to: number
  scale?: 'linear' | 'log'
}

export type AutopilotMetric =
  | { kind?: 'waveform'; waveform: string; statistic: Statistic; settled?: boolean }
  | { kind: 'margin' }

export interface AutopilotConstraints {
  ambientCelsius?: number
  thetaJa?: number
  requireErcPass?: boolean
  /** Fail a candidate if any part has no declared rating. */
  requireAllRated?: boolean
  /** Fail a candidate above this fraction of any declared limit (1 = 100 %). */
  maxWorstUtilization?: number
}

export interface AutopilotGoal {
  description: string
  analysis: SimulationParameters
  metric: AutopilotMetric
  target?: { value: number; tolerance: number }
  direction?: 'minimize' | 'maximize'
  knobs?: AutopilotKnob[]
  constraints?: AutopilotConstraints
}

export interface AutopilotIteration {
  iteration: number
  phase: 'baseline' | 'sweep' | 'refine' | 'restore'
  knobValues: Record<string, number>
  metric?: number
  metricLabel: string
  metricUnit?: string
  target?: { value: number; tolerance: number }
  score?: number
  best: boolean
  goalMet: boolean
  message: string
  error?: string
  constraintFailures: string[]
  fingerprint?: string
  schematicSvg?: string
  waveformSvg?: string
  components?: CadObservation['components']
  nets?: CadObservation['nets']
  stats?: CadObservation['stats']
  issues?: string[]
  assessment?: CadAssessmentOutput
  erc?: Pick<CadErcOutput, 'passed' | 'errors' | 'warnings'>
}

export interface AutopilotBest {
  iteration: number
  knobValues: Record<string, number>
  metric?: number
  metricLabel: string
  metricUnit?: string
  score: number
  design: { components: CadDesignState['components']; wires: CadDesignState['wires'] }
  schematicSvg?: string
  waveformSvg?: string
  assessment?: CadAssessmentOutput
}

export interface AutopilotResult {
  achieved: boolean
  reason: string
  goal: AutopilotGoal
  baselineMetric?: number
  iterations: AutopilotIteration[]
  best?: AutopilotBest
  finalDesign: { components: CadDesignState['components']; wires: CadDesignState['wires'] }
  fingerprint?: string
}

export interface AutopilotOptions {
  runtime: CadRuntime
  goal: AutopilotGoal
  /** Grid points per knob. More points = better coverage, more simulations. */
  samplesPerKnob?: number
  /** Local ± half-step refinement rounds after the grid. */
  refineSteps?: number
  /** Hard cap on simulated candidates. */
  maxIterations?: number
  /** Leave the sheet on the best design (default true). */
  restoreBest?: boolean
  signal?: AbortSignal
  onEvent?: (iteration: AutopilotIteration) => void
}

interface KnobState extends AutopilotKnob {
  componentId: string
  from: number
  to: number
}

interface Candidate {
  iteration: number
  phase: AutopilotIteration['phase']
  values: Record<string, number>
  metric?: number
  metricLabel: string
  metricUnit?: string
  score: number
  goalMet: boolean
  constraintFailures: string[]
  error?: string
  fingerprint?: string
  observation?: CadObservation
  simulation?: CadSimulationOutput
  assessment?: CadAssessmentOutput
  erc?: CadErcOutput
  /** Sheet state measured by this candidate, for restoring the winner. */
  designComponents?: CadDesignState['components']
  designWires?: CadDesignState['wires']
}

const FAILED = -Infinity

const sameValue = (a: number, b: number): boolean => {
  if (a === b) return true
  const scale = Math.max(Math.abs(a), Math.abs(b), 1e-12)
  return Math.abs(a - b) <= scale * 1e-9
}

const formatNumber = (value: number): string => {
  if (!Number.isFinite(value)) return String(value)
  const magnitude = Math.abs(value)
  if (magnitude !== 0 && (magnitude >= 1e6 || magnitude < 1e-3)) return value.toExponential(3)
  return String(Number(value.toPrecision(5)))
}

const metricLabelFor = (goal: AutopilotGoal): string => {
  if (goal.metric.kind === 'margin') return 'worst util. (% of limit)'
  const settled = goal.metric.settled ? 'settled ' : ''
  return `${goal.metric.waveform} ${settled}${goal.metric.statistic}`
}

function resolveKnobs(design: CadDesignState, knobs: readonly AutopilotKnob[]): KnobState[] {
  return knobs.map((knob) => {
    const component = findComponentByReference(design.components, knob.reference)
    if (!component) throw new Error(`Knob references ${knob.reference}, but no such part is on the sheet.`)
    if (!(knob.property in component.properties)) {
      throw new Error(`${knob.reference} has no property "${knob.property}" to tune.`)
    }
    if (!Number.isFinite(knob.from) || !Number.isFinite(knob.to)) {
      throw new Error(`Knob ${knob.reference}.${knob.property} needs finite from/to bounds.`)
    }
    if (knob.from === knob.to) throw new Error(`Knob ${knob.reference}.${knob.property} has identical bounds.`)
    if (knob.scale === 'log' && !(knob.from > 0 && knob.to > 0)) {
      throw new Error(`Log knob ${knob.reference}.${knob.property} needs positive bounds.`)
    }
    return { ...knob, componentId: component.id }
  })
}

function gridValues(knob: KnobState, samples: number): number[] {
  if (samples <= 1) return [knob.from]
  const count = Math.max(2, Math.round(samples))
  const values: number[] = []
  if (knob.scale === 'log') {
    const low = Math.log(knob.from)
    const high = Math.log(knob.to)
    for (let index = 0; index < count; index++) {
      values.push(Math.exp(low + ((high - low) * index) / (count - 1)))
    }
  } else {
    for (let index = 0; index < count; index++) {
      values.push(knob.from + ((knob.to - knob.from) * index) / (count - 1))
    }
  }
  return values
}

function summaryFor(simulation: CadSimulationOutput, name: string) {
  const wanted = name.trim().toLowerCase()
  const direct = simulation.waveforms.find((waveform) => waveform.name.toLowerCase() === wanted)
  if (direct) return direct
  if (!wanted.includes('(')) {
    return (
      simulation.waveforms.find((waveform) => waveform.name.toLowerCase() === `v(${wanted})`)
      ?? simulation.waveforms.find((waveform) => waveform.name.toLowerCase() === `i(${wanted})`)
    )
  }
  return undefined
}

function constraintFailuresFor(
  goal: AutopilotGoal,
  assessment: CadAssessmentOutput | undefined,
  erc: CadErcOutput | undefined,
): string[] {
  const constraints = goal.constraints
  if (!constraints) return []
  const failures: string[] = []
  if (constraints.requireErcPass) {
    if (!erc) failures.push('ERC was required but could not run.')
    else if (!erc.passed) failures.push(`ERC has ${erc.errors.length} error(s).`)
  }
  if (constraints.requireAllRated) {
    if (!assessment) failures.push('Rating coverage was required but no margin report could be produced.')
    else if (assessment.coverage.unrated.length > 0) {
      failures.push(`${assessment.coverage.unrated.length} part(s) have no declared rating.`)
    }
  }
  if (constraints.maxWorstUtilization !== undefined) {
    if (!assessment) failures.push('A utilisation limit was required but no margin report could be produced.')
    else if (!assessment.worst) failures.push('No rated quantity was measured, so utilisation cannot be checked.')
    else if (assessment.worst.utilization > constraints.maxWorstUtilization) {
      failures.push(
        `${assessment.worst.reference} ${assessment.worst.quantity} is at ` +
        `${(assessment.worst.utilization * 100).toFixed(1)} % (limit ${(constraints.maxWorstUtilization * 100).toFixed(0)} %).`,
      )
    }
  }
  return failures
}

function scoreOf(goal: AutopilotGoal, metric: number | undefined, failures: string[]): number {
  let score = 0
  if (goal.metric.kind === 'margin') {
    score = metric === undefined ? FAILED : -metric
  } else if (metric !== undefined) {
    if (goal.target) score = -Math.abs(metric - goal.target.value)
    else if (goal.direction === 'minimize') score = -metric
    else if (goal.direction === 'maximize') score = metric
  } else {
    score = FAILED
  }
  // Constraint violations dominate any measurement improvement.
  if (failures.length > 0) score -= 1e9 * failures.length
  return score
}

function goalMet(goal: AutopilotGoal, candidate: Candidate, baseline?: Candidate): boolean {
  if (candidate.error || candidate.metric === undefined) return false
  if (candidate.constraintFailures.length > 0) return false
  if (goal.target) return Math.abs(candidate.metric - goal.target.value) <= goal.target.tolerance
  if (goal.metric.kind === 'margin') {
    const limit = goal.constraints?.maxWorstUtilization ?? 1
    return candidate.metric <= limit
  }
  if (goal.direction === 'minimize' || goal.direction === 'maximize') {
    if (!baseline || baseline.metric === undefined) return false
    return goal.direction === 'minimize' ? candidate.metric < baseline.metric : candidate.metric > baseline.metric
  }
  // Verification goal: no target or direction, constraints already passed.
  return true
}

/**
 * Tune declared knobs on the live sheet until the goal is met or the budget
 * runs out. Every candidate is a real edit + real solve on the same canvas the
 * user is watching.
 */
export async function runAutopilot(options: AutopilotOptions): Promise<AutopilotResult> {
  const { runtime, goal } = options
  const toolset = createCadToolset(runtime)
  const emit = options.onEvent ?? (() => {})
  const samples = options.samplesPerKnob ?? 7
  const refineSteps = options.refineSteps ?? 2
  const maxIterations = options.maxIterations ?? Math.max(12, samples * Math.max(1, (goal.knobs?.length ?? 0)) * 2 + 8)
  const iterations: AutopilotIteration[] = []

  const initialDesign = runtime.read()
  const knobs = resolveKnobs(initialDesign, goal.knobs ?? [])
  const baselineValues: Record<string, number> = {}
  for (const knob of knobs) {
    const raw = initialDesign.components.find((component) => component.id === knob.componentId)?.properties[knob.property]
    const numeric = parseSpiceValue(raw as string | number, `${knob.reference}.${knob.property}`)
    if (!Number.isFinite(numeric)) throw new Error(`${knob.reference}.${knob.property} is not a finite number.`)
    baselineValues[knob.reference + '.' + knob.property] = numeric
  }

  const label = metricLabelFor(goal)
  const keyOf = (knob: AutopilotKnob): string => `${knob.reference}.${knob.property}`

  const applyKnobs = async (values: Record<string, number>): Promise<CadObservation> => {
    let observation: CadObservation | undefined
    for (const knob of knobs) {
      const key = keyOf(knob)
      const target = values[key]
      if (target === undefined) continue
      const design = runtime.read()
      const component = design.components.find((candidate) => candidate.id === knob.componentId)
      const current = component?.properties[knob.property]
      const numeric = current === undefined ? undefined : parseSpiceValue(current, key)
      if (numeric !== undefined && sameValue(numeric, target)) continue
      observation = (await toolset.invoke('cad.setProperty', {
        reference: knob.reference,
        property: knob.property,
        value: String(Number(target.toPrecision(12))),
      })) as CadObservation
    }
    return observation ?? ((await toolset.invoke('cad.observe', {})) as CadObservation)
  }

  const evaluate = async (
    iteration: number,
    phase: AutopilotIteration['phase'],
    values: Record<string, number>,
    baseline?: Candidate,
  ): Promise<Candidate> => {
    const base: Candidate = {
      iteration,
      phase,
      values: { ...values },
      metricLabel: label,
      score: FAILED,
      goalMet: false,
      constraintFailures: [],
    }
    try {
      const observation = await applyKnobs(values)
      base.observation = observation
      base.fingerprint = observation.fingerprint

      const simulation = (await toolset.invoke('cad.simulate', {
        analysis: goal.analysis.type,
        parameters: JSON.stringify(goal.analysis),
      })) as CadSimulationOutput
      base.simulation = simulation

      if (goal.metric.kind === 'margin') {
        // Metric comes from the rating report below.
      } else {
        const waveform = summaryFor(simulation, goal.metric.waveform)
        if (!waveform) {
          throw new Error(
            `Waveform "${goal.metric.waveform}" was not produced. Available: ` +
            `${simulation.waveforms.map((waveformSummary) => waveformSummary.name).join(', ')}.`,
          )
        }
        const stats = goal.metric.settled && waveform.settled ? waveform.settled : waveform.stats
        base.metric = statisticValue(stats, goal.metric.statistic)
        base.metricLabel = `${waveform.name}${goal.metric.settled && waveform.settled ? ' settled' : ''} ${goal.metric.statistic}`
        base.metricUnit = waveform.unit
      }

      const marginCapable = goal.analysis.type === 'dc' || goal.analysis.type === 'transient' || goal.analysis.type === 'dc-sweep'
      const marginsRequired = goal.metric.kind === 'margin'
        || goal.constraints?.requireAllRated === true
        || goal.constraints?.maxWorstUtilization !== undefined
      if (marginCapable) {
        try {
          base.assessment = (await toolset.invoke('cad.assess', {
            ...(goal.constraints?.ambientCelsius !== undefined ? { ambientCelsius: goal.constraints.ambientCelsius } : {}),
            ...(goal.constraints?.thetaJa !== undefined ? { thetaJa: goal.constraints.thetaJa } : {}),
          })) as CadAssessmentOutput
        } catch (error) {
          if (marginsRequired) throw error
        }
      }
      if (goal.metric.kind === 'margin') {
        if (!base.assessment) throw new Error('No margin report could be produced for this analysis.')
        base.metric = base.assessment.worst?.utilization
        base.metricLabel = base.assessment.worst
          ? `worst util. (${base.assessment.worst.reference} ${base.assessment.worst.quantity})`
          : label
        base.metricUnit = 'ratio'
        if (base.metric === undefined) {
          throw new Error('No declared ratings were measured; a margin goal needs at least one rated quantity.')
        }
      }

      if (goal.constraints?.requireErcPass) {
        base.erc = (await toolset.invoke('cad.erc', {})) as CadErcOutput
      }
      base.constraintFailures = constraintFailuresFor(goal, base.assessment, base.erc)
      base.score = scoreOf(goal, base.metric, base.constraintFailures)
      base.goalMet = goalMet(goal, base, baseline)
      const measured = runtime.read()
      base.designComponents = measured.components
      base.designWires = measured.wires
    } catch (error) {
      base.error = error instanceof Error ? error.message : String(error)
      base.score = FAILED
      base.constraintFailures = [base.error]
    }

    const iterationEvent: AutopilotIteration = {
      iteration,
      phase,
      knobValues: { ...values },
      metric: base.metric,
      metricLabel: base.metricLabel,
      metricUnit: base.metricUnit,
      target: goal.target,
      score: Number.isFinite(base.score) ? base.score : undefined,
      best: false,
      goalMet: base.goalMet,
      message: base.error
        ? `Iteration ${iteration} failed: ${base.error}`
        : `${base.metricLabel} = ${base.metric === undefined ? '—' : formatNumber(base.metric)}${base.metricUnit ? ` ${base.metricUnit}` : ''}` +
          (base.constraintFailures.length ? `; ${base.constraintFailures.join(' ')}` : ''),
      error: base.error,
      constraintFailures: base.constraintFailures,
      fingerprint: base.fingerprint,
      schematicSvg: base.observation?.schematicSvg,
      waveformSvg: base.simulation?.waveformSvg,
      components: base.observation?.components,
      nets: base.observation?.nets,
      stats: base.observation?.stats,
      issues: base.observation?.issues,
      assessment: base.assessment,
      erc: base.erc ? { passed: base.erc.passed, errors: base.erc.errors, warnings: base.erc.warnings } : undefined,
    }
    iterations.push(iterationEvent)
    emit(iterationEvent)
    return base
  }

  const abort = (): boolean => options.signal?.aborted === true

  // Baseline measurement on the sheet as it stands.
  const baseline = await evaluate(0, 'baseline', baselineValues)
  let best = baseline
  let bestIteration = 0
  let lastEvaluated = 0

  const consider = (candidate: Candidate): void => {
    lastEvaluated = candidate.iteration
    if (candidate.score > best.score || (best.error !== undefined && candidate.error === undefined)) {
      best = candidate
      bestIteration = candidate.iteration
    }
  }

  const currentValues = { ...baselineValues }
  let counter = 1
  const budgetLeft = (): boolean => counter < maxIterations && !abort()

  // A target or a utilisation limit is an acceptance test, so meeting it can
  // end the search early. A bare minimise/maximise goal has no pass/fail line:
  // `goalMet` only means "better than baseline", so breaking on the first
  // improvement would stop before the rest of the budget was measured. Sweep
  // the budget and report the best point actually measured.
  const earlyStop = Boolean(goal.target) || goal.metric.kind === 'margin'

  outer: for (let pass = 0; pass < Math.max(1, knobs.length > 1 ? 2 : 1); pass++) {
    for (const knob of knobs) {
      const key = keyOf(knob)
      for (const value of gridValues(knob, samples)) {
        if (!budgetLeft()) break outer
        currentValues[key] = value
        const candidate = await evaluate(counter++, pass === 0 ? 'sweep' : 'refine', currentValues, baseline)
        consider(candidate)
        if (earlyStop && candidate.goalMet) break outer
        await yieldToUi()
      }
    }
  }

  // Local refinement: halve the grid step around the best knob values.
  for (let round = 0; round < refineSteps && best.error === undefined && !abort(); round++) {
    for (const knob of knobs) {
      if (!budgetLeft()) break
      const key = keyOf(knob)
      const step = ((knob.to - knob.from) / Math.max(1, samples - 1)) / 2 ** (round + 1)
      const centre = best.values[key] ?? currentValues[key]
      for (const value of [centre - step, centre + step]) {
        if (!budgetLeft()) break
        if (value < Math.min(knob.from, knob.to) || value > Math.max(knob.from, knob.to)) continue
        currentValues[key] = value
        const candidate = await evaluate(counter++, 'refine', currentValues, baseline)
        consider(candidate)
        if (earlyStop && candidate.goalMet) break
        await yieldToUi()
      }
      currentValues[key] = best.values[key] ?? centre
      if (earlyStop && best.goalMet) break
    }
    if (earlyStop && best.goalMet) break
  }

  // Mark the winning iteration in the timeline. A failed measurement is not a
  // winner: when nothing solved, no row may carry a "best" badge.
  if (best.error === undefined) {
    for (const iteration of iterations) iteration.best = iteration.iteration === bestIteration
    if (iterations[bestIteration]) iterations[bestIteration].best = true
  }

  let achieved = best.goalMet
  let reason: string
  if (best.error !== undefined) {
    reason = `No candidate could be solved and measured: ${best.error}`
  } else if (achieved && goal.target && best.metric !== undefined) {
    reason = `Target met: ${best.metricLabel} = ${formatNumber(best.metric)}${best.metricUnit ? ` ${best.metricUnit}` : ''} ` +
      `(target ${formatNumber(goal.target.value)} ± ${formatNumber(goal.target.tolerance)}) ` +
      `at ${describeValues(best.values)}.`
  } else if (achieved && goal.metric.kind === 'margin' && best.metric !== undefined) {
    reason = `Worst utilisation ${(best.metric * 100).toFixed(1)} % at ${describeValues(best.values)}.`
  } else if (achieved && best.metric !== undefined && baseline.metric !== undefined) {
    reason = `Improved ${best.metricLabel} from ${formatNumber(baseline.metric)} to ${formatNumber(best.metric)}` +
      `${best.metricUnit ? ` ${best.metricUnit}` : ''} at ${describeValues(best.values)}. ` +
      'This is the best point the bounded search found; it is not a proof of a global optimum.'
  } else if (best.metric !== undefined) {
    reason = `No candidate met the goal within ${counter} measured iteration(s). ` +
      `Best: ${best.metricLabel} = ${formatNumber(best.metric)}${best.metricUnit ? ` ${best.metricUnit}` : ''} at ${describeValues(best.values)}.`
  } else {
    reason = `Measurement did not produce a usable ${best.metricLabel}.`
  }
  if (abort()) reason = `Stopped by the caller. ${reason}`

  const restoreBest = options.restoreBest !== false && best.error === undefined && best.iteration !== lastEvaluated
  if (restoreBest) {
    runtime.commit({ components: best.designComponents ?? runtime.read().components, wires: best.designWires ?? runtime.read().wires })
    // The live design was left on the last candidate; restore the winner, then
    // re-solve so the cached result matches the sheet the user is looking at.
    try {
      const observation = (await toolset.invoke('cad.observe', {})) as CadObservation
      const simulation = (await toolset.invoke('cad.simulate', {
        analysis: goal.analysis.type,
        parameters: JSON.stringify(goal.analysis),
      })) as CadSimulationOutput
      let assessment: CadAssessmentOutput | undefined
      if (best.assessment) {
        try {
          assessment = (await toolset.invoke('cad.assess', {
            ...(goal.constraints?.ambientCelsius !== undefined ? { ambientCelsius: goal.constraints.ambientCelsius } : {}),
            ...(goal.constraints?.thetaJa !== undefined ? { thetaJa: goal.constraints.thetaJa } : {}),
          })) as CadAssessmentOutput
        } catch {
          assessment = undefined
        }
      }
      const restored: AutopilotIteration = {
        iteration: counter,
        phase: 'restore',
        knobValues: { ...best.values },
        metric: best.metric,
        metricLabel: best.metricLabel,
        metricUnit: best.metricUnit,
        target: goal.target,
        score: Number.isFinite(best.score) ? best.score : undefined,
        best: true,
        goalMet: best.goalMet,
        message: `Restored the best iteration (${bestIteration}).`,
        constraintFailures: best.constraintFailures,
        fingerprint: observation.fingerprint,
        schematicSvg: observation.schematicSvg,
        waveformSvg: simulation.waveformSvg,
        components: observation.components,
        nets: observation.nets,
        stats: observation.stats,
        issues: observation.issues,
        assessment,
      }
      iterations.push(restored)
      emit(restored)
      best.observation = observation
      best.simulation = simulation
      best.assessment = assessment ?? best.assessment
    } catch (error) {
      reason += ` Restoring the best design failed: ${error instanceof Error ? error.message : String(error)}.`
      achieved = false
    }
  } else if (options.restoreBest !== false && best.error !== undefined) {
    // Every candidate failed to measure, so there is no winner to keep. Put the
    // user's original sheet back instead of leaving it on the last failed knob;
    // a search that learned nothing must not silently mutate the design.
    runtime.commit({ components: initialDesign.components, wires: initialDesign.wires })
    reason += ' The original design was restored.'
    const restored: AutopilotIteration = {
      iteration: counter,
      phase: 'restore',
      knobValues: { ...baselineValues },
      metricLabel: label,
      best: false,
      goalMet: false,
      message: `Restored the original design; no candidate could be measured (${best.error}).`,
      error: best.error,
      constraintFailures: best.constraintFailures,
      fingerprint: baseline.fingerprint,
    }
    iterations.push(restored)
    emit(restored)
  }

  // Snapshot the winner's design for the caller (revert/branch later).
  const designNow = runtime.read()
  const winnerState = best.iteration === lastEvaluated
    ? { components: designNow.components, wires: designNow.wires }
    : { components: best.designComponents ?? designNow.components, wires: best.designWires ?? designNow.wires }

  const bestResult: AutopilotBest | undefined = best.error === undefined
    ? {
        iteration: bestIteration,
        knobValues: { ...best.values },
        metric: best.metric,
        metricLabel: best.metricLabel,
        metricUnit: best.metricUnit,
        score: best.score,
        design: winnerState,
        schematicSvg: best.observation?.schematicSvg,
        waveformSvg: best.simulation?.waveformSvg,
        assessment: best.assessment,
      }
    : undefined

  return {
    achieved,
    reason,
    goal,
    baselineMetric: baseline.metric,
    iterations,
    best: bestResult,
    finalDesign: { components: designNow.components, wires: designNow.wires },
    fingerprint: best.fingerprint,
  }
}

function describeValues(values: Record<string, number>): string {
  const entries = Object.entries(values)
  if (entries.length === 0) return 'the untuned sheet'
  return entries.map(([key, value]) => `${key} = ${formatNumber(value)}`).join(', ')
}
