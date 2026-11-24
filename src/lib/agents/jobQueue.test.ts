import { beforeEach, describe, expect, it } from 'vitest'
import {
  AGENT_JOB_STORAGE_KEY,
  agentJobStore,
  createAgentJob,
  MAX_AGENT_JOBS,
  parseAgentJob,
  recoverInterruptedJobs,
} from './jobQueue'

beforeEach(() => {
  localStorage.clear()
})

describe('createAgentJob', () => {
  it('creates a queued job with a title derived from the prompt', () => {
    const job = createAgentJob({ prompt: '  inspect the schematic  ', projectId: 'p1', now: 1000 })
    expect(job.status).toBe('queued')
    expect(job.phase).toBe('queued')
    expect(job.prompt).toBe('inspect the schematic')
    expect(job.title).toBe('inspect the schematic')
    expect(job.projectId).toBe('p1')
    expect(job.createdAt).toBe(new Date(1000).toISOString())
    expect(job.steps).toEqual([])
  })

  it('truncates long prompts in the title', () => {
    const prompt = 'x'.repeat(200)
    expect(createAgentJob({ prompt }).title).toHaveLength(64)
  })
})

describe('parseAgentJob', () => {
  it('rejects records with the wrong schema, status, or steps shape', () => {
    const valid = createAgentJob({ prompt: 'inspect' })
    expect(parseAgentJob({ ...valid, schema: 'folio.agent-job/0' })).toBeUndefined()
    expect(parseAgentJob({ ...valid, status: 'flying' })).toBeUndefined()
    expect(parseAgentJob({ ...valid, steps: 'nope' })).toBeUndefined()
    expect(parseAgentJob(null)).toBeUndefined()
    expect(parseAgentJob('text')).toBeUndefined()
  })

  it('round-trips steps, approvals and the context summary through the store', () => {
    const job = createAgentJob({ prompt: 'route the board', now: 2000 })
    job.steps = [
      { tool: 'eda.route', rationale: 'route it', args: { schematic: '{}' }, status: 'succeeded', needsApproval: false },
      { tool: 'eda.exportFab', rationale: 'fab it', args: { project: 'current' }, status: 'pending', needsApproval: true },
    ]
    job.grantedApprovals = [0]
    job.pendingApproval = { stepIndex: 1, tool: 'eda.exportFab', args: { project: 'current' } }
    job.contextSummary = { totalTokens: 12, budgetTokens: 1200, dropped: ['transcript'] }
    agentJobStore.save(job)

    const restored = agentJobStore.get(job.id)
    expect(restored).toBeDefined()
    expect(restored?.steps).toHaveLength(2)
    expect(restored?.steps[1].needsApproval).toBe(true)
    expect(restored?.grantedApprovals).toEqual([0])
    expect(restored?.pendingApproval?.stepIndex).toBe(1)
    expect(restored?.contextSummary).toEqual({ totalTokens: 12, budgetTokens: 1200, dropped: ['transcript'] })
  })

  it('ignores corrupt storage instead of crashing', () => {
    localStorage.setItem(AGENT_JOB_STORAGE_KEY, '{not json')
    expect(agentJobStore.list()).toEqual([])
  })
})

describe('agentJobStore bounds', () => {
  it('keeps only the newest jobs', () => {
    for (let index = 0; index < MAX_AGENT_JOBS + 5; index++) {
      const job = createAgentJob({ prompt: `job ${index}`, now: 10_000 + index })
      agentJobStore.save(job)
    }
    const jobs = agentJobStore.list()
    expect(jobs).toHaveLength(MAX_AGENT_JOBS)
    expect(jobs.map((job) => job.prompt)).not.toContain('job 0')
    expect(jobs.map((job) => job.prompt)).toContain(`job ${MAX_AGENT_JOBS + 4}`)
  })

  it('deletes and clears', () => {
    const job = createAgentJob({ prompt: 'inspect' })
    agentJobStore.save(job)
    agentJobStore.delete(job.id)
    expect(agentJobStore.get(job.id)).toBeUndefined()
    agentJobStore.save(createAgentJob({ prompt: 'other' }))
    agentJobStore.clear()
    expect(agentJobStore.list()).toEqual([])
  })
})

describe('recoverInterruptedJobs', () => {
  it('marks persisted running jobs as paused with the recovered flag', () => {
    const running = createAgentJob({ prompt: 'inspect', now: 3000 })
    running.status = 'running'
    running.steps = [
      { tool: 'cad.observe', rationale: 'look', args: {}, status: 'running', needsApproval: false },
    ]
    const queued = createAgentJob({ prompt: 'simulate', now: 4000 })
    agentJobStore.save(running)
    agentJobStore.save(queued)

    const count = recoverInterruptedJobs(5000)
    expect(count).toBe(1)
    const recovered = agentJobStore.get(running.id)
    expect(recovered?.status).toBe('paused')
    expect(recovered?.recoveredFromCrash).toBe(true)
    expect(recovered?.updatedAt).toBe(new Date(5000).toISOString())
    expect(agentJobStore.get(queued.id)?.status).toBe('queued')
  })

  it('returns zero when nothing was running', () => {
    agentJobStore.save(createAgentJob({ prompt: 'inspect' }))
    expect(recoverInterruptedJobs()).toBe(0)
  })

  it('counts only the jobs this launch recovered, not every job ever recovered', () => {
    /* `recoveredFromCrash` stays true on the record forever, so counting the
     * flag reported a total that grew on every restart. */
    const first = createAgentJob({ prompt: 'inspect', now: 3000 })
    first.status = 'running'
    agentJobStore.save(first)
    expect(recoverInterruptedJobs(4000)).toBe(1)

    // Second launch: the same job is paused, not running — nothing to recover.
    expect(recoverInterruptedJobs(5000)).toBe(0)
  })

  it('gives each job a unique id', () => {
    /* Ids used to be `job-<millis>-<module counter>`, and the counter restarted
     * at 0 on every load, so a same-millisecond job from a previous session
     * would overwrite the record in the store. */
    const ids = new Set<string>()
    for (let index = 0; index < MAX_AGENT_JOBS; index += 1) {
      const job = createAgentJob({ prompt: 'inspect', now: 1000 })
      ids.add(job.id)
      agentJobStore.save(job)
    }
    expect(ids.size).toBe(MAX_AGENT_JOBS)
    expect(agentJobStore.list()).toHaveLength(MAX_AGENT_JOBS)
  })
})
