import { beforeEach, describe, expect, it } from 'vitest'
import { createAgentJobExecutor } from './jobExecutor'
import { createAgentJob } from './jobQueue'
import { useProjectStore } from '../../stores/useProjectStore'
import type { JobExecutorHooks } from './jobRunner'

const hooks = (): JobExecutorHooks => ({
  update: () => {},
  yieldUi: async () => {},
})

const control = () => ({ paused: () => false, aborted: () => false })

beforeEach(() => {
  useProjectStore.setState({
    components: [],
    wires: [],
    pcbLayout: null,
    firmwareCode: '',
  })
})

describe('agent job executor', () => {
  it('completes an inspection job against an empty sheet without inventing parts', async () => {
    const executor = createAgentJobExecutor()
    const job = createAgentJob({ prompt: 'Inspect the live schematic and report its parts, nets, and any issues.' })
    const execution = await executor(job, control(), hooks())

    expect(execution.status).toBe('completed')
    expect(job.steps.map((step) => step.tool)).toEqual(['cad.observe'])
    expect(job.steps[0].status).toBe('succeeded')
    expect(job.contextSummary).toBeDefined()
    expect(job.contextSummary!.totalTokens).toBeLessThanOrEqual(job.contextSummary!.budgetTokens)
    expect(execution.report).toContain('Verification: sheet re-observed (0 part(s)')
    expect(execution.report).toContain('deterministic keyword planning')
  })

  it('fails honestly when no plan maps to the prompt', async () => {
    const executor = createAgentJobExecutor()
    const job = createAgentJob({ prompt: 'summon the eldritch netlist' })
    const execution = await executor(job, control(), hooks())

    expect(execution.status).toBe('failed')
    expect(execution.report).toContain('No concrete plan maps to')
    expect(job.steps).toHaveLength(0)
  })

  it('reports the real engine refusal when a simulation plan hits an empty sheet', async () => {
    const executor = createAgentJobExecutor()
    const job = createAgentJob({ prompt: 'Run a DC operating point simulation on the current schematic.' })
    const execution = await executor(job, control(), hooks())

    // The netlist builds but the engine refuses it: the job fails with the
    // engine's own words rather than inventing a result.
    expect(execution.status).toBe('failed')
    expect(execution.report).toContain('Netlist invalid')
    expect(job.steps[0].tool).toBe('eda.simulate')
    expect(job.steps[0].status).toBe('failed')
  })

  it('pauses a step that needs approval and reports the request', async () => {
    const executor = createAgentJobExecutor()
    const job = createAgentJob({ prompt: 'export for fab' })
    job.steps = [
      { tool: 'eda.exportFab', rationale: 'fab', args: { project: 'current' }, status: 'pending', needsApproval: true },
    ]
    const execution = await executor(job, control(), hooks())

    expect(execution.status).toBe('paused')
    expect(execution.pendingApproval).toEqual({ stepIndex: 0, tool: 'eda.exportFab', args: { project: 'current' } })
    expect(job.steps[0].status).toBe('pending')
  })

  it('skips an approval once granted and runs the step for real', async () => {
    const executor = createAgentJobExecutor()
    const job = createAgentJob({ prompt: 'export for fab' })
    job.steps = [
      { tool: 'eda.exportFab', rationale: 'fab', args: { project: 'current' }, status: 'pending', needsApproval: true },
    ]
    job.grantedApprovals = [0]
    const execution = await executor(job, control(), hooks())

    // No routed board exists, so the real tool fails — but it ran, which is
    // what this test proves: the approval gate opened.
    expect(execution.status).toBe('failed')
    expect(job.steps[0].status).toBe('failed')
    expect(job.steps[0].error).toBeDefined()
  })

  it('resumes from the first unfinished step without re-running succeeded ones', async () => {
    const executor = createAgentJobExecutor()
    const job = createAgentJob({ prompt: 'resume' })
    job.steps = [
      { tool: 'cad.observe', rationale: 'seen', args: {}, status: 'succeeded', needsApproval: false },
      { tool: 'cad.observe', rationale: 'again', args: {}, status: 'pending', needsApproval: false },
    ]
    const execution = await executor(job, control(), hooks())

    expect(execution.status).toBe('completed')
    expect(job.steps).toHaveLength(2)
    expect(job.steps[0].status).toBe('succeeded')
    expect(job.steps[1].status).toBe('succeeded')
  })

  it('stops cooperatively when the control says so', async () => {
    const executor = createAgentJobExecutor()
    const job = createAgentJob({ prompt: 'inspect the schematic' })
    job.steps = [
      { tool: 'cad.observe', rationale: 'look', args: {}, status: 'pending', needsApproval: false },
    ]
    const execution = await executor(job, { paused: () => true, aborted: () => false }, hooks())
    expect(execution.status).toBe('paused')

    const stopped = await executor(job, { paused: () => false, aborted: () => true }, hooks())
    expect(stopped.status).toBe('stopped')
  })
})
