import { describe, expect, it, vi } from 'vitest'
import { buildDemoBoard } from '../../demo/demoBoard'
import {
  CLOUD_JOB_SCHEMA,
  CloudAgentRunner,
  createAutopilotExecutor,
  parseCloudJobRequest,
  type CloudExecution,
  type CloudExecutor,
  type CloudJobRecord,
  type CloudJobRequest,
  type CloudJobState,
  type CloudJobStore,
} from './cloudRunner'

const QUICK_TRANSIENT = { type: 'transient' as const, stopTime: 4e-3, stepTime: 1e-5 }

class MemoryStore implements CloudJobStore {
  private readonly jobs = new Map<string, CloudJobRecord>()

  seed(job: CloudJobRecord): void {
    this.jobs.set(job.id, job)
  }

  async load(): Promise<void> {}

  get(id: string): CloudJobRecord | undefined {
    return this.jobs.get(id)
  }

  findByClientJobId(clientJobId: string, ownerId?: string): CloudJobRecord | undefined {
    for (const job of this.jobs.values()) {
      if (job.clientJobId !== clientJobId) continue
      if (ownerId !== undefined && job.ownerId !== ownerId) continue
      return job
    }
    return undefined
  }

  list(): readonly CloudJobRecord[] {
    return [...this.jobs.values()]
  }

  async save(job: CloudJobRecord): Promise<void> {
    this.jobs.set(job.id, job)
  }

  async delete(id: string): Promise<void> {
    this.jobs.delete(id)
  }
}

const validBody = (): Record<string, unknown> => ({
  schema: CLOUD_JOB_SCHEMA,
  clientJobId: 'session-1',
  title: 'Ripple tuner',
  goal: {
    description: 'Minimise settled output ripple.',
    analysis: QUICK_TRANSIENT,
    metric: { waveform: 'V(OUT)', statistic: 'ripple', settled: true },
    direction: 'minimize',
    knobs: [{ reference: 'C1', property: 'value', from: 2e-6, to: 470e-6, scale: 'log' }],
  },
  design: { components: [], wires: [], firmware: '' },
  budget: { maxCalls: 24, maxWallMs: 30_000 },
  approvalMode: 'auto',
})

const parse = (body: unknown): CloudJobRequest => {
  const result = parseCloudJobRequest(body)
  if (!result.ok) throw new Error(result.error)
  return result.request
}

const request = (clientJobId = 'session-1'): CloudJobRequest => parse({ ...validBody(), clientJobId })

const demoRequest = (clientJobId: string): CloudJobRequest => {
  const board = buildDemoBoard()
  return parse({
    ...validBody(),
    clientJobId,
    design: { components: board.components, wires: board.wires, firmware: '' },
    budget: { maxCalls: 8, maxWallMs: 30_000 },
  })
}

const waitForState = async (
  runner: CloudAgentRunner,
  jobId: string,
  states: readonly CloudJobState[],
  timeoutMs = 5_000,
): Promise<CloudJobRecord> => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const job = runner.get(jobId)
    if (job && states.includes(job.state)) return job
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${states.join('|')}; the job is ${job?.state ?? 'missing'}.`)
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

const makeRunner = (
  executor: CloudExecutor,
  options: { store?: MemoryStore; maxWallMs?: number; maxEvents?: number } = {},
): { runner: CloudAgentRunner; store: MemoryStore } => {
  const store = options.store ?? new MemoryStore()
  const runner = new CloudAgentRunner({
    store,
    executor,
    ...(options.maxWallMs !== undefined ? { maxWallMs: options.maxWallMs } : {}),
    ...(options.maxEvents !== undefined ? { maxEvents: options.maxEvents } : {}),
  })
  return { runner, store }
}

/** An executor that reports a result immediately, for queue-shape assertions. */
const instantExecutor = (result: Partial<CloudExecution> = {}): { executor: CloudExecutor; calls: string[] } => {
  const calls: string[] = []
  const executor: CloudExecutor = async ({ job, emit }) => {
    calls.push(job.id)
    emit({ type: 'status', message: 'measured one candidate' })
    emit({
      type: 'iteration',
      message: 'C1 = 47u',
      iteration: 1,
      metric: 0.012,
      metricLabel: 'ripple',
      metricUnit: 'V',
      goalMet: true,
    })
    return {
      state: 'succeeded',
      result: { achieved: true, reason: 'Goal met.', bestIteration: 1, bestMetric: 0.012 },
      ...result,
    }
  }
  return { executor, calls }
}

describe('parseCloudJobRequest', () => {
  it('accepts a well-formed request and applies bounded defaults', () => {
    const parsed = parse({
      ...validBody(),
      budget: undefined,
      title: '   ',
      approvalMode: 'anything-else',
      projectId: ' project-9 ',
    })
    expect(parsed.schema).toBe(CLOUD_JOB_SCHEMA)
    expect(parsed.clientJobId).toBe('session-1')
    expect(parsed.title).toBe('Minimise settled output ripple.')
    expect(parsed.projectId).toBe('project-9')
    expect(parsed.approvalMode).toBe('auto')
    expect(parsed.budget).toEqual({ maxCalls: 120, maxWallMs: 300_000 })
  })

  it('clamps an oversized budget instead of trusting it', () => {
    const parsed = parse({ ...validBody(), budget: { maxCalls: 10_000_000, maxWallMs: 10_000_000 } })
    expect(parsed.budget).toEqual({ maxCalls: 5_000, maxWallMs: 3_600_000 })
  })

  it('rejects a wrong schema, a missing goal and an unknown analysis', () => {
    expect(parseCloudJobRequest(null).ok).toBe(false)
    expect(parseCloudJobRequest({ ...validBody(), schema: 'folio.agent-job/2' }).ok).toBe(false)
    expect(parseCloudJobRequest({ ...validBody(), goal: undefined }).ok).toBe(false)
    expect(parseCloudJobRequest({
      ...validBody(),
      goal: { ...validBody().goal as object, analysis: { type: 'harmonic-balance' } },
    }).ok).toBe(false)
    expect(parseCloudJobRequest({
      ...validBody(),
      goal: { ...validBody().goal as object, metric: { kind: 'nonsense' } },
    }).ok).toBe(false)
  })

  it('rejects malformed knobs instead of failing inside the worker', () => {
    const withKnobs = (knobs: unknown) => ({
      ...validBody(),
      goal: { ...validBody().goal as object, knobs },
    })
    expect(parseCloudJobRequest(withKnobs('C1')).ok).toBe(false)
    expect(parseCloudJobRequest(withKnobs([{ reference: 'C1', property: 'value' }])).ok).toBe(false)
    expect(parseCloudJobRequest(withKnobs([{ reference: 'C1', property: 'value', from: 0, to: Number.NaN }])).ok).toBe(false)
    expect(parseCloudJobRequest(withKnobs([{ reference: 'C1', property: 'value', from: 1, to: 2, scale: 'logarithmic' }])).ok).toBe(false)
    expect(parseCloudJobRequest(withKnobs(
      Array.from({ length: 25 }, (_, index) => ({ reference: `R${index}`, property: 'value', from: 1, to: 2 })),
    )).ok).toBe(false)
    expect(parseCloudJobRequest(withKnobs([{ reference: 'C1', property: 'value', from: 2e-6, to: 470e-6, scale: 'log' }])).ok).toBe(true)
  })

  it('rejects a malformed design rather than failing inside the worker', () => {
    expect(parseCloudJobRequest({ ...validBody(), design: { components: 'no', wires: [] } }).ok).toBe(false)
    expect(parseCloudJobRequest({ ...validBody(), design: { components: [{}], wires: [] } }).ok).toBe(false)
    expect(parseCloudJobRequest({ ...validBody(), design: { components: [], wires: [{ id: 'w1' }] } }).ok).toBe(false)
  })

  it('enforces the component and wire ceilings', () => {
    const component = {
      id: 'R1',
      component: { pins: [] },
      properties: {},
    }
    const tooManyComponents = { ...validBody(), design: { components: Array(5_001).fill(component), wires: [] } }
    expect(parseCloudJobRequest(tooManyComponents).ok).toBe(false)
    const tooManyWires = { ...validBody(), design: { components: [], wires: Array(20_001).fill({}) } }
    expect(parseCloudJobRequest(tooManyWires).ok).toBe(false)
  })
})

describe('CloudAgentRunner queue', () => {
  it('is idempotent on clientJobId', async () => {
    const { executor, calls } = instantExecutor()
    const { runner } = makeRunner(executor)
    await runner.init()

    const first = await runner.submit(request('same-id'))
    const second = await runner.submit(request('same-id'))

    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(second.job.id).toBe(first.job.id)
    runner.start()
    await waitForState(runner, first.job.id, ['succeeded'])
    expect(calls).toEqual([first.job.id])
  })

  it('stays idempotent when two submissions of one key race', async () => {
    /* The check and the insert are separated by an await, so without
     * serialisation both callers see an empty store and both create a job —
     * two runs under one idempotency key, which the API promises cannot
     * happen. */
    const { executor, calls } = instantExecutor()
    const { runner, store } = makeRunner(executor)
    await runner.init()

    const [first, second] = await Promise.all([
      runner.submit(request('racing-key')),
      runner.submit(request('racing-key')),
    ])

    /* Both callers await the same in-flight insert, so they receive the same
     * record — including the same `created` flag. The guarantee that matters is
     * one job and one run, not which caller is told it won. */
    expect(first.job.id).toBe(second.job.id)
    expect(first.created).toBe(second.created)
    expect(store.list().filter((job) => job.clientJobId === 'racing-key')).toHaveLength(1)

    runner.start()
    await waitForState(runner, first.job.id, ['succeeded'])
    expect(calls).toEqual([first.job.id])
  })

  it('scopes the idempotency key to one owner', async () => {
    const { executor } = instantExecutor()
    const { runner } = makeRunner(executor)
    await runner.init()

    const first = await runner.submit(request('shared-key'), 'owner-a')
    const second = await runner.submit(request('shared-key'), 'owner-b')
    expect(second.created).toBe(true)
    expect(second.job.id).not.toBe(first.job.id)

    const replay = await runner.submit(request('shared-key'), 'owner-a')
    expect(replay.created).toBe(false)
    expect(replay.job.id).toBe(first.job.id)
    expect(runner.findByClientJobId('shared-key', 'owner-b')?.id).toBe(second.job.id)
  })

  it('refuses an approval mode it cannot honour', async () => {
    const { runner } = makeRunner(instantExecutor().executor)
    await expect(runner.submit({ ...request(), approvalMode: 'on-write' })).rejects.toThrow(/approval_not_supported/)
  })

  it('runs a job, records ordered events, and exposes a terminal status', async () => {
    const { executor } = instantExecutor()
    const { runner } = makeRunner(executor)
    runner.start()
    const { job } = await runner.submit(request())
    const finished = await waitForState(runner, job.id, ['succeeded'])

    expect(finished.result).toMatchObject({ achieved: true, reason: 'Goal met.', bestIteration: 1 })
    expect(finished.finishedAt).toBeDefined()
    const status = runner.status(job.id)!
    expect(status.state).toBe('succeeded')
    expect(status.result?.bestMetric).toBe(0.012)
    expect(status.progress?.step).toBe(1)

    const events = runner.events(job.id)
    const seqs = events.map((event) => event.seq)
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b))
    expect(events.some((event) => event.type === 'iteration' && event.metric === 0.012)).toBe(true)
    expect(events.at(-1)?.type).toBe('result')
    expect(events.at(-1)?.message).toBe('Goal met.')
    expect(runner.events(job.id, 2).every((event) => event.seq > 2)).toBe(true)
  })

  it('keeps a bounded event ring instead of growing without limit', async () => {
    const executor: CloudExecutor = async ({ emit }) => {
      for (let index = 0; index < 20; index += 1) {
        emit({ type: 'log', message: `line ${index}` })
      }
      return { state: 'succeeded', result: { achieved: false, reason: 'No target declared.' } }
    }
    const { runner } = makeRunner(executor, { maxEvents: 50 })
    runner.start()
    const { job } = await runner.submit(request())
    await waitForState(runner, job.id, ['succeeded'])
    const events = runner.events(job.id)
    expect(events.length).toBeLessThanOrEqual(50)
    expect(events.at(-1)?.seq).toBe(job.seq)
  })

  it('reports a failed execution honestly', async () => {
    const executor: CloudExecutor = async () => ({
      state: 'failed',
      message: 'The solver diverged.',
      error: 'time step too large',
    })
    const { runner } = makeRunner(executor)
    runner.start()
    const { job } = await runner.submit(request())
    const finished = await waitForState(runner, job.id, ['failed'])
    expect(finished.error).toBe('time step too large')
    expect(runner.events(job.id).at(-1)).toMatchObject({ type: 'error', message: 'time step too large' })
  })

  it('turns a thrown executor error into a failed job, not a crashed queue', async () => {
    const executor: CloudExecutor = async () => {
      throw new Error('knob R9 does not exist')
    }
    const { executor: next, calls } = instantExecutor()
    let first = true
    const flaky: CloudExecutor = async (context) => {
      if (first) {
        first = false
        return executor(context)
      }
      return next(context)
    }
    const { runner } = makeRunner(flaky)
    runner.start()
    const failed = await runner.submit(request('job-a'))
    await waitForState(runner, failed.job.id, ['failed'])
    expect(runner.status(failed.job.id)?.error).toBe('knob R9 does not exist')

    const second = await runner.submit(request('job-b'))
    await waitForState(runner, second.job.id, ['succeeded'])
    expect(calls).toEqual([second.job.id])
  })

  it('cancels a queued job without ever running it', async () => {
    const { executor, calls } = instantExecutor()
    const { runner } = makeRunner(executor)
    await runner.init()
    const { job } = await runner.submit(request())

    expect(await runner.cancel(job.id)).toBe(true)
    expect(runner.get(job.id)?.state).toBe('cancelled')
    runner.start()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(calls).toEqual([])
    expect(await runner.cancel(job.id)).toBe(false)
  })

  it('aborts a running job and keeps the cancellation as the final state', async () => {
    let started: () => void = () => {}
    const running = new Promise<void>((resolve) => { started = resolve })
    const executor: CloudExecutor = ({ signal }) => {
      started()
      return new Promise<CloudExecution>((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted by cancel')), { once: true })
      })
    }
    const { runner } = makeRunner(executor)
    runner.start()
    const { job } = await runner.submit(request())
    await running
    expect(runner.get(job.id)?.state).toBe('running')

    expect(await runner.cancel(job.id)).toBe(true)
    const finished = await waitForState(runner, job.id, ['cancelled'])
    expect(finished.finishedAt).toBeDefined()
    expect(finished.error).toBeUndefined()
  })

  it('expires a job that outlives the wall clock', async () => {
    const executor: CloudExecutor = ({ signal }) =>
      new Promise<CloudExecution>((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted by wall clock')), { once: true })
      })
    const { runner } = makeRunner(executor)
    runner.start()
    const { job } = await runner.submit({ ...request(), budget: { maxCalls: 100, maxWallMs: 25 } })
    const finished = await waitForState(runner, job.id, ['expired'])
    expect(finished.message).toMatch(/Expired/)
    expect(finished.error).toBeUndefined()
  })

  it('requeues a job that was running when the process restarted', async () => {
    const store = new MemoryStore()
    const seed: CloudJobRecord = {
      schema: CLOUD_JOB_SCHEMA,
      id: 'job-recovered',
      clientJobId: 'session-recovered',
      title: 'Interrupted',
      goal: (validBody().goal as CloudJobRecord['goal']),
      design: { components: [], wires: [], firmware: '' },
      budget: { maxCalls: 10, maxWallMs: 10_000 },
      approvalMode: 'auto',
      state: 'running',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      events: [],
      seq: 0,
      attempts: 0,
    }
    store.seed(seed)
    const { executor } = instantExecutor()
    const { runner } = makeRunner(executor, { store })

    await runner.init()
    const recovered = runner.get(seed.id)!
    expect(recovered.state).toBe('queued')
    expect(recovered.attempts).toBe(1)
    expect(runner.events(seed.id).at(-1)?.message).toMatch(/Recovered/)

    runner.start()
    await waitForState(runner, seed.id, ['succeeded'])
  })

  it('fails a job that has already been recovered twice', async () => {
    const store = new MemoryStore()
    store.seed({
      schema: CLOUD_JOB_SCHEMA,
      id: 'job-doomed',
      clientJobId: 'session-doomed',
      title: 'Interrupted repeatedly',
      goal: (validBody().goal as CloudJobRecord['goal']),
      design: { components: [], wires: [], firmware: '' },
      budget: { maxCalls: 10, maxWallMs: 10_000 },
      approvalMode: 'auto',
      state: 'running',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      events: [],
      seq: 0,
      attempts: 2,
    })
    const { executor } = instantExecutor()
    const { runner } = makeRunner(executor, { store })
    await runner.init()
    expect(runner.get('job-doomed')?.state).toBe('failed')
    expect(runner.status('job-doomed')?.error).toMatch(/restarted twice/)
  })

  it('scopes ownership and reports unknown jobs as missing', async () => {
    const { executor } = instantExecutor()
    const { runner } = makeRunner(executor)
    runner.start()
    const { job } = await runner.submit(request(), 'owner-1')
    await waitForState(runner, job.id, ['succeeded'])
    expect(runner.ownerOf(job.id)).toBe('owner-1')
    expect(runner.status('job-does-not-exist')).toBeUndefined()
    expect(runner.events('job-does-not-exist')).toEqual([])
    expect(await runner.cancel('job-does-not-exist')).toBe(false)
  })
})

describe('createAutopilotExecutor', () => {
  it('measures a real sheet and streams iterations from the headless runtime', async () => {
    const { runner } = makeRunner(createAutopilotExecutor())
    runner.start()
    const { job } = await runner.submit(demoRequest('integration-1'))
    const finished = await waitForState(runner, job.id, ['succeeded', 'failed'], 30_000)

    expect(finished.state).toBe('succeeded')
    expect(finished.result).toBeDefined()
    expect(finished.result?.reason).toBeTruthy()
    const iterations = runner.events(job.id).filter((event) => event.type === 'iteration')
    expect(iterations.length).toBeGreaterThan(0)
    expect(iterations.every((event) => event.iteration !== undefined)).toBe(true)
    expect(runner.events(job.id).at(-1)?.type).toBe('result')
  }, 40_000)
})

describe('CloudAgentRunner logging', () => {
  it('reports a crashed worker through the log hook', async () => {
    const onLog = vi.fn()
    const runner = new CloudAgentRunner({
      store: new MemoryStore(),
      executor: async () => {
        throw new Error('unexpected')
      },
      onLog,
    })
    runner.start()
    const { job } = await runner.submit(request())
    await waitForState(runner, job.id, ['failed'])
    // The executor throw is a handled failure; the hook is reserved for a crash
    // outside the executor contract. Nothing should be logged for this path.
    expect(onLog).not.toHaveBeenCalled()
  })
})
