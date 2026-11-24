/**
 * The real executor behind the always-on runner.
 *
 * Each invocation plans against the live sheet (never a queue-time copy),
 * runs the planned steps through the same harness the Assistant uses, then
 * verifies by re-observing the sheet and running ERC, and finally reports
 * exactly what each step did. Every transition is persisted through
 * `hooks.update`, so a resumed job continues from its first unfinished step.
 *
 * The planner is deterministic (`planEdaFlow`), not a model: the context pack
 * is built and its budget is recorded on the job as evidence for a future
 * model-driven planner, and the summary says so.
 */
import { AgentHarness, type AgentBudget, type AgentCall } from './agentHarness'
import { registerCadTools } from './cadTools'
import { registerCoupledTools } from './coupledTools'
import { registerSwarmTools } from './metaHarness'
import { createStoreCadRuntime } from './cadRuntime'
import { registerEdaTools, planEdaFlow } from './edaTools'
import { registerMechanicalTools } from './mechanicalTools'
import { buildCircuitNetlist } from '../simulation/netlistBuilder'
import { buildContextPack } from './contextPack'
import type { SimulationParameters } from '../simulation/spiceEngine'
import { useProjectStore, type CanvasComponent, type CanvasWire } from '../../stores/useProjectStore'
import type { AgentJobStep } from './jobQueue'
import type { JobExecution, JobExecutor } from './jobRunner'

export const AGENT_JOB_BUDGET: AgentBudget = { maxCalls: 40, maxWallMs: 5 * 60_000, startedAt: 0 }

const analysisForPrompt = (text: string): SimulationParameters => {
  if (/transient|pulse|waveform|settle|ripple/i.test(text)) {
    return { type: 'transient', stopTime: 20e-3, stepTime: 20e-6 }
  }
  if (/\bac\b|frequency|bode|sweep/i.test(text)) {
    return { type: 'ac', startFreq: 10, stopFreq: 1e6, pointsPerDecade: 20 }
  }
  return { type: 'dc' }
}

/**
 * The PCB/fab tools operate on the placement shape (`position`, `scale`), while
 * the canvas stores an origin (`x`, `y`). Convert once, explicitly.
 */
const placedForFabrication = (components: CanvasComponent[]) =>
  components.map((component) => ({
    ...component,
    position: { x: component.x, y: component.y },
    scale: 1,
    locked: false,
    visible: true,
    selected: false,
  }))

const pcbWires = (wires: CanvasWire[]) =>
  wires.map((wire) => ({
    ...wire,
    style: { ...(wire.style ?? {}), width: wire.style?.width ?? 0.25 },
    selected: false,
  }))

const describeResult = (call: AgentCall): string => {
  const result = call.result as Record<string, unknown> | undefined
  if (!result || typeof result !== 'object') return 'done'
  const stats = result.stats as { components?: number; nets?: number; unconnectedPins?: number } | undefined
  const bits: string[] = []
  if (stats) {
    bits.push(`${stats.components ?? 0} part(s), ${stats.nets ?? 0} net(s)`)
    if (stats.unconnectedPins) bits.push(`${stats.unconnectedPins} unconnected pin(s)`)
  }
  if ('success' in result) {
    const convergence = result.convergenceInfo as { converged?: boolean } | undefined
    bits.push(result.success ? 'solved' : `failed: ${String(result.error ?? 'no solution')}`)
    if (convergence?.converged) bits.push('converged')
  }
  if ('shippable' in result) {
    const violations = Array.isArray(result.violations) ? result.violations.length : 0
    bits.push(result.shippable ? 'shippable' : `${violations} violation(s)`)
  }
  if ('traces' in result) bits.push(`${String(result.traces)} trace(s)`)
  if ('files' in result) bits.push(`${String(result.files)} file(s)`)
  if ('published' in result && result.published === true) bits.push('published')
  return bits.join(' · ') || 'done'
}

const stepSummary = (step: AgentJobStep): string => {
  const outcome = step.status === 'succeeded'
    ? step.summary ?? 'succeeded'
    : step.status === 'denied'
      ? 'denied — did not run'
      : step.status === 'skipped'
        ? 'skipped (a previous step failed)'
        : step.error
          ? `failed: ${step.error}`
          : step.status
  return `${step.tool} — ${outcome}`
}

export function createAgentJobExecutor(): JobExecutor {
  return async (job, control, hooks): Promise<JobExecution> => {
    const harness = new AgentHarness()
    registerCadTools(harness, createStoreCadRuntime())
    registerEdaTools(harness)
    registerCoupledTools(harness)
    registerSwarmTools(harness)
    registerMechanicalTools(harness)

    const budget: AgentBudget = { ...AGENT_JOB_BUDGET, startedAt: Date.now() }
    const live = useProjectStore.getState()

    // ── Plan ──────────────────────────────────────────────────────────────
    if (job.steps.length === 0) {
      job.phase = 'plan'
      hooks.update(job)
      await hooks.yieldUi()

      const pack = buildContextPack({
        goal: job.prompt,
        parts: live.components.map((component) => ({
          reference: component.reference,
          name: component.component.name,
          properties: component.properties,
        })),
        wires: live.wires,
      })
      job.contextSummary = {
        totalTokens: pack.totalTokens,
        budgetTokens: pack.budgetTokens,
        dropped: pack.dropped,
      }

      let netlistJson = ''
      let netlistError: string | undefined
      try {
        netlistJson = JSON.stringify(
          buildCircuitNetlist('agent-job', live.components, live.wires, analysisForPrompt(job.prompt)),
        )
      } catch (error) {
        netlistError = error instanceof Error ? error.message : String(error)
      }

      const plan = planEdaFlow(job.prompt, {
        netlist: netlistJson,
        components: JSON.stringify(placedForFabrication(live.components)),
        wires: JSON.stringify(pcbWires(live.wires)),
        schematic: JSON.stringify({
          id: 'current-schematic',
          name: 'Current schematic',
          components: placedForFabrication(live.components),
          wires: pcbWires(live.wires),
          nets: [],
        }),
      })
      if (!plan || plan.steps.length === 0) {
        return {
          status: 'failed',
          report: `No concrete plan maps to "${job.prompt}". Supported jobs: inspect the schematic, run DC/transient/AC simulations, run DRC, route the board, export a fab package, or analyse signal integrity.`,
        }
      }
      if (netlistError && plan.steps.some((step) => step.tool === 'eda.simulate')) {
        return {
          status: 'failed',
          report: `The plan needs a simulation, but the sheet cannot be netlisted: ${netlistError}`,
          error: netlistError,
        }
      }
      job.steps = plan.steps.map((step) => ({
        tool: step.tool,
        rationale: step.rationale,
        args: step.args,
        status: 'pending',
        needsApproval: plan.needsApproval.includes(step.tool),
      }))
      hooks.update(job)
      await hooks.yieldUi()
    }

    // ── Act ───────────────────────────────────────────────────────────────
    job.phase = 'act'
    // A resumed job retries from its first unfinished step; anything the
    // previous attempt marked skipped after a failure becomes pending again
    // so a retry that succeeds can still run the rest of the plan.
    const firstUnfinished = job.steps.findIndex((step) => step.status !== 'succeeded')
    if (firstUnfinished !== -1) {
      job.steps = job.steps.map((step, index) => (
        index >= firstUnfinished ? { ...step, status: 'pending' as const, error: undefined, summary: undefined } : step
      ))
    }
    hooks.update(job)

    const granted = job.grantedApprovals ?? []
    const denied = job.deniedApprovals ?? []
    for (let index = 0; index < job.steps.length; index++) {
      const step = job.steps[index]
      if (step.status === 'succeeded') continue
      if (control.paused()) {
        return {
          status: 'paused',
          report: `Paused at step ${index + 1} of ${job.steps.length}.`,
        }
      }
      if (control.aborted()) {
        return { status: 'stopped', report: 'Stopped by you.' }
      }
      if (denied.includes(index)) {
        job.steps[index] = { ...step, status: 'denied' }
        hooks.update(job)
        return {
          status: 'stopped',
          report: `Stopped: you denied approval for step ${index + 1} (${step.tool}), so it did not run.`,
        }
      }
      if (step.needsApproval && !granted.includes(index)) {
        return {
          status: 'paused',
          report: `Paused: step ${index + 1} (${step.tool}) needs your approval.`,
          pendingApproval: { stepIndex: index, tool: step.tool, args: { ...step.args } },
        }
      }

      job.steps[index] = { ...step, status: 'running', startedAt: Date.now() }
      hooks.update(job)
      await hooks.yieldUi()

      /* A tool that throws (budget exhausted, or a handler that rejects) must
       * become a failed *step*, not an exception out of the executor: the runner
       * would otherwise report "the executor crashed before reporting a result"
       * and leave this step stuck at `running` in the persisted record, so a
       * resume would neither re-run it nor skip it. */
      let call: AgentCall
      try {
        call = await harness.call(step.tool, step.args, budget, () => true)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        call = {
          seq: 0,
          tool: step.tool,
          args: { ...step.args },
          approved: true,
          startedAt: job.steps[index].startedAt ?? Date.now(),
          endedAt: Date.now(),
          error: message,
        }
      }
      const finished: AgentJobStep = {
        ...job.steps[index],
        status: call.error ? 'failed' : call.approved ? 'succeeded' : 'denied',
        endedAt: Date.now(),
        ...(call.error !== undefined ? { error: call.error } : {}),
        ...(!call.error ? { summary: describeResult(call) } : {}),
      }
      job.steps[index] = finished
      if (finished.status === 'failed') {
        for (let rest = index + 1; rest < job.steps.length; rest++) {
          if (job.steps[rest].status === 'pending') job.steps[rest] = { ...job.steps[rest], status: 'skipped' }
        }
      }
      hooks.update(job)
      if (finished.status === 'failed') break
      await hooks.yieldUi()
    }

    // ── Verify ────────────────────────────────────────────────────────────
    job.phase = 'verify'
    hooks.update(job)
    await hooks.yieldUi()

    let observation: AgentCall | undefined
    let erc: AgentCall | undefined
    try {
      observation = await harness.call('cad.observe', {}, budget, () => true)
    } catch (error) {
      observation = { seq: 0, tool: 'cad.observe', args: {}, approved: true, startedAt: 0, endedAt: 0, error: error instanceof Error ? error.message : String(error) }
    }
    try {
      erc = await harness.call('cad.erc', {}, budget, () => true)
    } catch (error) {
      erc = { seq: 0, tool: 'cad.erc', args: {}, approved: true, startedAt: 0, endedAt: 0, error: error instanceof Error ? error.message : String(error) }
    }

    // ── Report ────────────────────────────────────────────────────────────
    job.phase = 'report'
    const stepLines = job.steps.map((step, index) => `${index + 1}. ${stepSummary(step)}`)
    const observed = observation?.result as { stats?: { components?: number; nets?: number } } | undefined
    const ercResult = erc?.result as { passed?: boolean; errors?: unknown[] } | undefined
    const ercLine = erc?.error
      ? `ERC could not run: ${erc.error}`
      : ercResult?.passed === true
        ? 'ERC passed'
        : `ERC found ${ercResult?.errors?.length ?? 0} error(s)`
    const pack = job.contextSummary
    const packLine = pack
      ? `Planned with a ${pack.totalTokens}-token context pack (budget ${pack.budgetTokens}` +
        `${pack.dropped.length > 0 ? `; dropped: ${pack.dropped.join(', ')}` : ''}) — an estimate (chars/4), not a tokenizer count.`
      : ''
    const report = [
      `Job "${job.title}" planned ${job.steps.length} step(s) and ran to the end.`,
      packLine,
      ...stepLines,
      `Verification: sheet re-observed (${observed?.stats?.components ?? 0} part(s), ${observed?.stats?.nets ?? 0} net(s)); ${ercLine}.`,
      'The planner is deterministic keyword planning, not a language model; the report states only what each tool returned.',
    ].filter((line) => line.trim() !== '').join('\n')

    const failedStep = job.steps.find((step) => step.status === 'failed')
    hooks.update(job)
    if (failedStep) {
      return {
        status: 'failed',
        report: `Stopped after step ${job.steps.indexOf(failedStep) + 1} (${failedStep.tool}) failed: ${failedStep.error}.\n\n${report}`,
        error: failedStep.error,
      }
    }
    return { status: 'completed', report }
  }
}

/** The singleton the app mounts; tests build their own runners. */
export const agentJobExecutor = createAgentJobExecutor()
