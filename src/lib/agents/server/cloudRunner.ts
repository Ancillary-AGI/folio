/**
 * Server-side always-on agent runner.
 *
 * This is the process behind `docs/DEPLOYMENT.md`: it keeps a durable queue
 * of agent jobs, executes each one in a headless CAD runtime, and records an
 * append-only event stream that the browser consumes by polling or SSE. It is
 * deliberately transport-free — the Next.js routes, or any other host, are a
 * thin adapter over this class.
 *
 * The runner reuses the same `runAutopilot` loop and the same solver modules
 * the browser uses, so a cloud job is not a second implementation of the
 * design engine. What changes is the runtime: a memory-backed CAD sheet built
 * from the request's `design`, never a browser store.
 *
 * Honest limits: one process, one queue, one worker by default. It resumes a
 * job that was running when the process restarted instead of losing it, but it
 * does not provide multi-tenant sandboxing, per-job CPU accounting, or a
 * distributed queue. Those remain deployment concerns, stated in the docs.
 */
import { randomUUID } from 'node:crypto'
import { createMemoryCadRuntime, cloneDesign, type CadDesignState } from '../cadRuntime'
import { runAutopilot, type AutopilotGoal, type AutopilotIteration } from '../autopilot'

export const CLOUD_JOB_SCHEMA = 'folio.agent-job/1' as const

export type CloudJobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'expired'

export const TERMINAL_CLOUD_JOB_STATES: readonly CloudJobState[] = [
  'succeeded',
  'failed',
  'cancelled',
  'expired',
]

export const isTerminalCloudJobState = (state: CloudJobState): boolean =>
  TERMINAL_CLOUD_JOB_STATES.includes(state)

export type CloudJobEventType =
  | 'status'
  | 'observation'
  | 'tool'
  | 'iteration'
  | 'log'
  | 'result'
  | 'error'

export interface CloudJobEvent {
  seq: number
  at: string
  type: CloudJobEventType
  message: string
  iteration?: number
  phase?: string
  tool?: string
  metric?: number
  metricLabel?: string
  metricUnit?: string
  goalMet?: boolean
  fingerprint?: string
  data?: unknown
}

export interface CloudJobResult {
  achieved: boolean
  reason: string
  fingerprint?: string
  bestIteration?: number
  bestMetric?: number
  metricLabel?: string
  metricUnit?: string
  /** Knob values measured at the best iteration. */
  values?: Record<string, number>
}

export interface CloudJobStatus {
  id: string
  state: CloudJobState
  createdAt: string
  updatedAt: string
  progress?: { step: number; total?: number; message?: string }
  message?: string
  error?: string
  result?: CloudJobResult
}

export interface CloudJobBudget {
  maxCalls: number
  maxWallMs: number
}

export interface CloudJobRequest {
  schema: typeof CLOUD_JOB_SCHEMA
  clientJobId: string
  title: string
  projectId?: string
  goal: AutopilotGoal
  design: CadDesignState
  firmware?: string
  budget: CloudJobBudget
  approvalMode: 'auto' | 'on-write'
  createdAt?: string
}

export interface CloudJobRecord {
  schema: typeof CLOUD_JOB_SCHEMA
  id: string
  clientJobId: string
  title: string
  projectId?: string
  goal: AutopilotGoal
  design: CadDesignState
  firmware?: string
  budget: CloudJobBudget
  approvalMode: 'auto' | 'on-write'
  state: CloudJobState
  createdAt: string
  updatedAt: string
  startedAt?: string
  finishedAt?: string
  progress?: { step: number; total?: number; message?: string }
  message?: string
  error?: string
  result?: CloudJobResult
  events: CloudJobEvent[]
  /** Last event sequence number; monotonic for the life of the job. */
  seq: number
  attempts: number
  /** Identity a per-user token was minted for; absent for a shared key. */
  ownerId?: string
}

export interface CloudJobStore {
  load(): Promise<void>
  get(id: string): CloudJobRecord | undefined
  /** Idempotency lookup. `ownerId` scopes the key to one authenticated user. */
  findByClientJobId(clientJobId: string, ownerId?: string): CloudJobRecord | undefined
  list(): readonly CloudJobRecord[]
  save(job: CloudJobRecord): Promise<void>
  delete(id: string): Promise<void>
}

export interface CloudExecutorContext {
  job: CloudJobRecord
  emit: (event: Omit<CloudJobEvent, 'seq' | 'at'>) => void
  signal: AbortSignal
}

export interface CloudExecution {
  state: 'succeeded' | 'failed' | 'cancelled' | 'expired'
  result?: CloudJobResult
  message?: string
  error?: string
}

export type CloudExecutor = (context: CloudExecutorContext) => Promise<CloudExecution>

export interface CloudRunnerOptions {
  store: CloudJobStore
  now?: () => number
  /** Parallel jobs. Defaults to 1 so one heavy solve cannot starve the host. */
  maxConcurrent?: number
  /** Hard wall-clock cap a request cannot raise. Defaults to 15 minutes. */
  maxWallMs?: number
  /** Event ring size per job. Defaults to 2,000. */
  maxEvents?: number
  executor?: CloudExecutor
  onLog?: (line: string) => void
}

const iso = (millis: number): string => new Date(millis).toISOString()

const positiveNumber = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isAnalysis = (value: unknown): value is AutopilotGoal['analysis'] => {
  if (!isRecord(value)) return false
  return ['dc', 'dc-sweep', 'transient', 'ac', 'noise', 'montecarlo'].includes(String(value.type))
}

const isMetric = (value: unknown): value is AutopilotGoal['metric'] => {
  if (!isRecord(value)) return false
  if (value.kind === 'margin') return true
  return typeof value.waveform === 'string' && typeof value.statistic === 'string'
}

/**
 * Validate an untrusted request before it becomes a durable job. The runner is
 * a server endpoint, so "the TypeScript type says it is a goal" is not a trust
 * boundary: arrays, numbers and strings are checked here.
 */
export function parseCloudJobRequest(value: unknown): { ok: true; request: CloudJobRequest } | { ok: false; error: string } {
  if (!isRecord(value)) return { ok: false, error: 'The job body must be a JSON object.' }
  if (value.schema !== CLOUD_JOB_SCHEMA) {
    return { ok: false, error: `schema must be "${CLOUD_JOB_SCHEMA}".` }
  }
  if (typeof value.clientJobId !== 'string' || !value.clientJobId.trim()) {
    return { ok: false, error: 'clientJobId is required and must be a non-empty string.' }
  }
  if (value.clientJobId.length > 200) return { ok: false, error: 'clientJobId is longer than 200 characters.' }
  const goal = value.goal
  if (!isRecord(goal)) return { ok: false, error: 'goal must be an object.' }
  if (typeof goal.description !== 'string' || !goal.description.trim()) {
    return { ok: false, error: 'goal.description is required.' }
  }
  if (!isAnalysis(goal.analysis)) return { ok: false, error: 'goal.analysis.type must be dc, dc-sweep, transient, ac, noise or montecarlo.' }
  if (!isMetric(goal.metric)) return { ok: false, error: 'goal.metric must name a waveform and statistic, or kind "margin".' }
  if (goal.knobs !== undefined) {
    if (!Array.isArray(goal.knobs) || goal.knobs.length > 24) {
      return { ok: false, error: 'goal.knobs must be an array of at most 24 knobs.' }
    }
    for (const knob of goal.knobs) {
      if (
        !isRecord(knob)
        || typeof knob.reference !== 'string' || !knob.reference.trim()
        || typeof knob.property !== 'string' || !knob.property.trim()
        || typeof knob.from !== 'number' || !Number.isFinite(knob.from)
        || typeof knob.to !== 'number' || !Number.isFinite(knob.to)
        || (knob.scale !== undefined && knob.scale !== 'linear' && knob.scale !== 'log')
      ) {
        return {
          ok: false,
          error: 'Every knob needs a reference, a property, finite from/to bounds and an optional linear/log scale.',
        }
      }
    }
  }
  const design = value.design
  if (!isRecord(design)) return { ok: false, error: 'design must be an object with components and wires.' }
  if (!Array.isArray(design.components)) return { ok: false, error: 'design.components must be an array.' }
  if (!Array.isArray(design.wires)) return { ok: false, error: 'design.wires must be an array.' }
  if (design.components.length > 5_000) return { ok: false, error: 'design.components exceeds the 5,000-part limit.' }
  if (design.wires.length > 20_000) return { ok: false, error: 'design.wires exceeds the 20,000-wire limit.' }
  for (const component of design.components) {
    if (!isRecord(component) || typeof component.id !== 'string') {
      return { ok: false, error: 'Every design component needs a string id.' }
    }
    const symbol = component.component
    if (!isRecord(symbol) || !Array.isArray(symbol.pins)) {
      return { ok: false, error: `Component ${component.id} has no symbol pins.` }
    }
    if (!isRecord(component.properties)) {
      return { ok: false, error: `Component ${component.id} has no properties object.` }
    }
  }
  for (const wire of design.wires) {
    if (!isRecord(wire) || typeof wire.id !== 'string' || !Array.isArray(wire.points) || !Array.isArray(wire.connectedPins)) {
      return { ok: false, error: 'Every wire needs a string id, a points array and a connectedPins array.' }
    }
  }

  const budgetInput = isRecord(value.budget) ? value.budget : {}
  const budget: CloudJobBudget = {
    maxCalls: Math.min(5_000, positiveNumber(budgetInput.maxCalls, 120)),
    maxWallMs: Math.min(3_600_000, positiveNumber(budgetInput.maxWallMs, 300_000)),
  }
  const approvalMode = value.approvalMode === 'on-write' ? 'on-write' : 'auto'
  const request: CloudJobRequest = {
    schema: CLOUD_JOB_SCHEMA,
    clientJobId: value.clientJobId.trim(),
    title: typeof value.title === 'string' && value.title.trim() ? value.title.trim().slice(0, 200) : goal.description.slice(0, 200),
    goal: goal as unknown as AutopilotGoal,
    design: {
      components: design.components as CadDesignState['components'],
      wires: design.wires as CadDesignState['wires'],
      firmware: typeof design.firmware === 'string' ? design.firmware : '',
    },
    budget,
    approvalMode,
  }
  if (typeof value.projectId === 'string' && value.projectId.trim()) request.projectId = value.projectId.trim().slice(0, 200)
  if (typeof value.firmware === 'string') request.firmware = value.firmware
  if (typeof value.createdAt === 'string' && !Number.isNaN(Date.parse(value.createdAt))) request.createdAt = value.createdAt
  return { ok: true, request }
}

/**
 * The production executor: measure real candidates on a headless copy of the
 * submitted sheet. It maps each autopilot iteration to one durable event so a
 * client that reconnects can replay the run rather than restart it.
 */
export function createAutopilotExecutor(): CloudExecutor {
  return async ({ job, emit, signal }) => {
    const runtime = createMemoryCadRuntime({
      components: job.design.components,
      wires: job.design.wires,
      firmware: job.firmware ?? job.design.firmware ?? '',
    })
    const maxIterations = Math.max(4, Math.min(400, Math.round(job.budget.maxCalls / 2)))
    const samplesPerKnob = Math.max(3, Math.min(15, Math.ceil(Math.sqrt(maxIterations / Math.max(1, job.goal.knobs?.length ?? 1)))))
    emit({ type: 'status', message: `Worker started: up to ${maxIterations} measured candidate(s).` })

    const result = await runAutopilot({
      runtime,
      goal: job.goal,
      samplesPerKnob,
      maxIterations,
      restoreBest: true,
      signal,
      onEvent: (iteration: AutopilotIteration) => {
        emit({
          type: 'iteration',
          message: iteration.message,
          iteration: iteration.iteration,
          phase: iteration.phase,
          ...(iteration.metric !== undefined ? { metric: iteration.metric } : {}),
          metricLabel: iteration.metricLabel,
          ...(iteration.metricUnit !== undefined ? { metricUnit: iteration.metricUnit } : {}),
          goalMet: iteration.goalMet,
          ...(iteration.fingerprint !== undefined ? { fingerprint: iteration.fingerprint } : {}),
          data: {
            knobValues: iteration.knobValues,
            best: iteration.best,
            constraintFailures: iteration.constraintFailures,
          },
        })
      },
    })

    const best = result.best
    const final: CloudJobResult = {
      achieved: result.achieved,
      reason: result.reason,
      ...(result.fingerprint !== undefined ? { fingerprint: result.fingerprint } : {}),
      ...(best
        ? {
            bestIteration: best.iteration,
            ...(best.metric !== undefined ? { bestMetric: best.metric } : {}),
            metricLabel: best.metricLabel,
            ...(best.metricUnit !== undefined ? { metricUnit: best.metricUnit } : {}),
            values: best.knobValues,
          }
        : {}),
    }
    return { state: 'succeeded', result: final, message: result.reason }
  }
}

/** Durable, single-process job runner. */
export class CloudAgentRunner {
  private readonly store: CloudJobStore
  private readonly now: () => number
  private readonly maxConcurrent: number
  private readonly maxWallMs: number
  private readonly maxEvents: number
  private readonly executor: CloudExecutor
  private readonly onLog: (line: string) => void
  private readonly aborters = new Map<string, AbortController>()
  private readonly timedOut = new Set<string>()
  /* One entry per idempotency key currently being submitted. Two callers
   * racing the same `clientJobId` both find nothing in the store and would
   * both insert; the promise map makes the loser await the winner's job. */
  private readonly submitting = new Map<string, Promise<{ job: CloudJobRecord; created: boolean }>>()
  private running = 0
  private started = false
  private ready: Promise<void> | null = null
  private tickScheduled = false

  constructor(options: CloudRunnerOptions) {
    this.store = options.store
    this.now = options.now ?? Date.now
    this.maxConcurrent = Math.max(1, Math.floor(options.maxConcurrent ?? 1))
    this.maxWallMs = Math.max(1_000, Math.floor(options.maxWallMs ?? 15 * 60_000))
    this.maxEvents = Math.max(50, Math.floor(options.maxEvents ?? 2_000))
    this.executor = options.executor ?? createAutopilotExecutor()
    this.onLog = options.onLog ?? (() => {})
  }

  /** Load persisted jobs and requeue work a restart interrupted. */
  async init(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        await this.store.load()
        await this.recover()
      })()
    }
    return this.ready
  }

  start(): void {
    this.started = true
    this.kick()
  }

  stop(): void {
    this.started = false
  }

  get(id: string): CloudJobRecord | undefined {
    return this.store.get(id)
  }

  findByClientJobId(clientJobId: string, ownerId?: string): CloudJobRecord | undefined {
    return this.store.findByClientJobId(clientJobId, ownerId)
  }

  status(id: string): CloudJobStatus | undefined {
    const job = this.store.get(id)
    if (!job) return undefined
    return {
      id: job.id,
      state: job.state,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      ...(job.progress !== undefined ? { progress: { ...job.progress } } : {}),
      ...(job.message !== undefined ? { message: job.message } : {}),
      ...(job.error !== undefined ? { error: job.error } : {}),
      ...(job.result !== undefined ? { result: { ...job.result } } : {}),
    }
  }

  events(id: string, after = 0): CloudJobEvent[] {
    const job = this.store.get(id)
    if (!job) return []
    return job.events.filter((event) => event.seq > after).map((event) => ({ ...event }))
  }

  ownerOf(id: string): string | undefined {
    return this.store.get(id)?.ownerId
  }

  /**
   * Queue a job. `clientJobId` is the idempotency key: re-submitting it returns
   * the original job and does not start a second run — including when the two
   * submissions arrive at the same moment, which is what the `submitting` map
   * serialises.
   */
  async submit(
    request: CloudJobRequest,
    ownerId?: string,
  ): Promise<{ job: CloudJobRecord; created: boolean }> {
    if (request.approvalMode === 'on-write') {
      // There is no approval channel in this process. Refusing is honest;
      // silently downgrading to auto would apply writes nobody approved.
      throw new Error(
        'approval_not_supported: the built-in runner has no human approval channel; submit with approvalMode "auto".',
      )
    }
    const key = `${ownerId ?? ''} ${request.clientJobId}`
    const inFlight = this.submitting.get(key)
    if (inFlight) return inFlight

    const submission = this.insertJob(request, ownerId)
    this.submitting.set(key, submission)
    try {
      return await submission
    } finally {
      this.submitting.delete(key)
    }
  }

  private async insertJob(
    request: CloudJobRequest,
    ownerId?: string,
  ): Promise<{ job: CloudJobRecord; created: boolean }> {
    await this.init()
    const existing = this.store.findByClientJobId(request.clientJobId, ownerId)
    if (existing) return { job: existing, created: false }

    const now = this.now()
    const stamp = iso(now)
    const job: CloudJobRecord = {
      schema: CLOUD_JOB_SCHEMA,
      id: `job-${randomUUID()}`,
      clientJobId: request.clientJobId,
      title: request.title,
      goal: structuredClone(request.goal),
      design: cloneDesign(request.design),
      budget: { ...request.budget },
      approvalMode: request.approvalMode,
      state: 'queued',
      createdAt: request.createdAt ?? stamp,
      updatedAt: stamp,
      events: [],
      seq: 0,
      attempts: 0,
    }
    if (request.projectId !== undefined) job.projectId = request.projectId
    if (request.firmware !== undefined) job.firmware = request.firmware
    if (ownerId !== undefined) job.ownerId = ownerId
    this.pushEvent(job, {
      type: 'status',
      message: `Queued "${job.title}" (${request.approvalMode === 'auto' ? 'auto-approve' : 'approval on write'}).`,
    })
    await this.store.save(job)
    this.kick()
    return { job, created: true }
  }

  async cancel(id: string): Promise<boolean> {
    await this.init()
    const job = this.store.get(id)
    if (!job || isTerminalCloudJobState(job.state)) return false
    if (job.state === 'queued') {
      job.state = 'cancelled'
      job.finishedAt = iso(this.now())
      this.pushEvent(job, { type: 'status', message: 'Cancelled before it started.' })
      await this.store.save(job)
      return true
    }
    job.state = 'cancelled'
    this.pushEvent(job, { type: 'status', message: 'Cancellation requested; stopping before the next measurement.' })
    job.message = 'Cancellation requested.'
    await this.store.save(job)
    this.aborters.get(id)?.abort()
    return true
  }

  private async recover(): Promise<void> {
    for (const job of this.store.list()) {
      if (job.state !== 'running') continue
      job.attempts += 1
      if (job.attempts > 2) {
        job.state = 'failed'
        job.error = 'The runner restarted twice while this job was executing.'
        job.finishedAt = iso(this.now())
        this.pushEvent(job, { type: 'error', message: job.error })
      } else {
        job.state = 'queued'
        job.message = 'Recovered after a runner restart; queued to run again.'
        this.pushEvent(job, { type: 'status', message: job.message })
      }
      await this.store.save(job)
    }
  }

  private pushEvent(job: CloudJobRecord, event: Omit<CloudJobEvent, 'seq' | 'at'>): void {
    job.seq += 1
    const stamp = iso(this.now())
    job.updatedAt = stamp
    job.events.push({ seq: job.seq, at: stamp, ...event })
    if (job.events.length > this.maxEvents) {
      job.events.splice(0, job.events.length - this.maxEvents)
    }
  }

  private kick(): void {
    if (!this.started || this.tickScheduled) return
    this.tickScheduled = true
    queueMicrotask(() => {
      this.tickScheduled = false
      while (this.running < this.maxConcurrent) {
        const next = this.store
          .list()
          .filter((job) => job.state === 'queued')
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0]
        if (!next) return
        next.state = 'running'
        next.startedAt = next.startedAt ?? iso(this.now())
        next.attempts += 1
        this.pushEvent(next, { type: 'status', message: `Worker ${this.running + 1} picked the job up.` })
        this.running += 1
        void this.run(next)
          .catch((error) => {
            this.onLog(`Agent job ${next.id} crashed: ${error instanceof Error ? error.message : String(error)}`)
          })
          .finally(() => {
            this.running -= 1
            this.kick()
          })
      }
    })
  }

  private async run(job: CloudJobRecord): Promise<void> {
    const controller = new AbortController()
    this.aborters.set(job.id, controller)
    const wallMs = Math.min(this.maxWallMs, job.budget.maxWallMs)
    const timer = setTimeout(() => {
      this.timedOut.add(job.id)
      this.pushEvent(job, { type: 'status', message: `Wall-clock budget of ${wallMs} ms reached; stopping.` })
      controller.abort()
    }, wallMs)
    ;(timer as unknown as { unref?: () => void }).unref?.()
    this.pushEvent(job, { type: 'status', message: `Running with a ${wallMs} ms wall clock.` })
    await this.store.save(job)

    try {
      const execution = await this.executor({
        job,
        signal: controller.signal,
        emit: (event) => {
          this.pushEvent(job, event)
          if (event.type === 'iteration' && event.iteration !== undefined) {
            job.progress = {
              step: event.iteration,
              total: Math.max(1, job.budget.maxCalls),
              message: event.message,
            }
          }
        },
      })
      // A cancel may have set the state while the executor was finishing; the
      // caller's decision wins, and the result is still kept as evidence.
      const cancelled = job.state === 'cancelled'
      const expired = this.timedOut.has(job.id)
      job.state = cancelled ? 'cancelled' : expired ? 'expired' : execution.state
      if (execution.result !== undefined) job.result = execution.result
      if (execution.message !== undefined) job.message = execution.message
      if (execution.error !== undefined) job.error = execution.error
      job.finishedAt = iso(this.now())
      if (job.state === 'succeeded') {
        this.pushEvent(job, {
          type: 'result',
          message: execution.result?.reason ?? execution.message ?? 'Job finished.',
          ...(execution.result?.achieved !== undefined ? { goalMet: execution.result.achieved } : {}),
          ...(execution.result?.fingerprint !== undefined ? { fingerprint: execution.result.fingerprint } : {}),
          ...(execution.result?.metricLabel !== undefined ? { metricLabel: execution.result.metricLabel } : {}),
          ...(execution.result?.metricUnit !== undefined ? { metricUnit: execution.result.metricUnit } : {}),
          ...(execution.result?.bestMetric !== undefined ? { metric: execution.result.bestMetric } : {}),
        })
      } else if (job.state === 'cancelled' || job.state === 'expired') {
        this.pushEvent(job, { type: 'status', message: job.state === 'expired' ? 'Expired at the wall clock.' : 'Cancelled.' })
      } else {
        this.pushEvent(job, { type: 'error', message: execution.error ?? execution.message ?? 'The job failed.' })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const cancelled = job.state === 'cancelled'
      const expired = this.timedOut.has(job.id)
      job.state = cancelled ? 'cancelled' : expired ? 'expired' : 'failed'
      job.error = cancelled || expired ? undefined : message
      job.message = cancelled ? 'Cancelled.' : expired ? 'Expired at the wall clock.' : 'The executor raised an error.'
      job.finishedAt = iso(this.now())
      this.pushEvent(job, {
        type: cancelled || expired ? 'status' : 'error',
        message: job.error ?? job.message,
      })
    } finally {
      clearTimeout(timer)
      this.timedOut.delete(job.id)
      this.aborters.delete(job.id)
      await this.store.save(job)
    }
  }
}
