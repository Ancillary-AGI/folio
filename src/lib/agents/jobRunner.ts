/**
 * The always-on agent job runner.
 *
 * Jobs queue up while the human keeps working and run in the background of the
 * same app: plan → act → verify → report, one job at a time. Everything the
 * executor reports is persisted per step, so a job can pause (by request, for
 * an approval, or because the tab closed) and resume from its first unfinished
 * step without re-running completed work.
 *
 * Honest scope: "always-on" means "runs while Folio is open". A closed tab
 * cannot execute anything, so a job that was running at close is recovered as
 * paused and the UI says so. Genuine 24/7 execution needs the server-side
 * runner documented in docs/AGENT_CLOUD.md.
 */
import { yieldToUi } from './uiYield'
import {
  agentJobStore,
  createAgentJob,
  recoverInterruptedJobs,
  type AgentJob,
  type AgentJobApprovalRequest,
  type AgentJobStep,
} from './jobQueue'

export interface JobControl {
  /** Cooperative pause: checked by the executor between steps. */
  paused(): boolean
  /** Cooperative cancel: checked by the executor between steps. */
  aborted(): boolean
}

export interface JobExecutorHooks {
  /** Persist the job as it is right now and notify subscribers. */
  update(job: AgentJob): void
  /** Yield one macrotask so the UI can render between steps. */
  yieldUi(): Promise<void>
}

export interface JobExecution {
  status: 'completed' | 'failed' | 'paused' | 'stopped'
  report: string
  error?: string
  /** Attached when the pause is waiting for a human approval. */
  pendingApproval?: AgentJobApprovalRequest
}

export type JobExecutor = (
  job: AgentJob,
  control: JobControl,
  hooks: JobExecutorHooks,
) => Promise<JobExecution>

export interface EnqueueJobInput {
  prompt: string
  title?: string
  projectId?: string
}

export interface AgentJobRunner {
  list(): AgentJob[]
  get(id: string): AgentJob | undefined
  enqueue(input: EnqueueJobInput): AgentJob | null
  pause(id: string): boolean
  resume(id: string): boolean
  cancel(id: string): boolean
  remove(id: string): boolean
  decideApproval(id: string, approved: boolean): boolean
  /** Mark persisted running jobs as paused (app restart). Returns the count. */
  recover(): number
  start(): void
  stop(): void
  /** Resolves when the queue is idle; useful for tests and busy indicators. */
  waitUntilIdle(): Promise<void>
  subscribe(listener: () => void): () => void
}

export interface CreateJobRunnerOptions {
  executor: JobExecutor
  now?: () => number
  /** Test hook: run every persisted job through this filter on load. */
  yieldUi?: () => Promise<void>
}

const iso = (millis: number): string => new Date(millis).toISOString()

const cloneJob = (job: AgentJob): AgentJob => ({
  ...job,
  steps: job.steps.map((step) => ({ ...step, args: { ...step.args } })),
  ...(job.grantedApprovals !== undefined ? { grantedApprovals: [...job.grantedApprovals] } : {}),
  ...(job.deniedApprovals !== undefined ? { deniedApprovals: [...job.deniedApprovals] } : {}),
  ...(job.pendingApproval !== undefined
    ? { pendingApproval: { ...job.pendingApproval, args: { ...job.pendingApproval.args } } }
    : {}),
})

export function createAgentJobRunner(options: CreateJobRunnerOptions): AgentJobRunner {
  const now = options.now ?? Date.now
  const yieldTask = options.yieldUi ?? yieldToUi
  const listeners = new Set<() => void>()
  let snapshot: AgentJob[] = agentJobStore.list()
  let started = false
  let currentTick: Promise<void> | null = null
  const pauseFlags = new Set<string>()
  const cancelFlags = new Set<string>()

  const notify = (): void => {
    for (const listener of listeners) listener()
  }

  const persist = (job: AgentJob): void => {
    agentJobStore.save(job)
    snapshot = snapshot.map((candidate) => (candidate.id === job.id ? job : candidate))
    notify()
  }

  const replace = (job: AgentJob): AgentJob => {
    agentJobStore.save(job)
    const index = snapshot.findIndex((candidate) => candidate.id === job.id)
    if (index === -1) {
      snapshot = [job, ...snapshot]
    } else {
      snapshot = snapshot.map((candidate) => (candidate.id === job.id ? job : candidate))
    }
    notify()
    return job
  }

  const removeFromSnapshot = (id: string): void => {
    snapshot = snapshot.filter((candidate) => candidate.id !== id)
    notify()
  }

  const markFinished = (job: AgentJob, status: AgentJob['status'], report: string, error?: string): AgentJob => {
    const finished: AgentJob = {
      ...job,
      status,
      report,
      finishedAt: iso(now()),
      updatedAt: iso(now()),
      ...(error !== undefined ? { error } : {}),
    }
    persist(finished)
    return finished
  }

  /** The job the runner picks next: oldest queued job (FIFO). */
  const nextQueued = (): AgentJob | undefined => snapshot
    .filter((job) => job.status === 'queued')
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0]

  const tick = (): Promise<void> => {
    if (currentTick) return currentTick
    const run = runLoop().finally(() => {
      currentTick = null
    })
    currentTick = run
    return run
  }

  const runLoop = async (): Promise<void> => {
    while (started) {
      const queued = nextQueued()
      if (!queued) break
      const job = replace({
        ...cloneJob(queued),
        status: 'running',
        ...(queued.startedAt === undefined ? { startedAt: iso(now()) } : {}),
        error: undefined,
        updatedAt: iso(now()),
      })

      const control: JobControl = {
        paused: () => pauseFlags.has(job.id),
        aborted: () => cancelFlags.has(job.id),
      }
      const hooks: JobExecutorHooks = {
        update: (next) => {
          persist({ ...next, updatedAt: iso(now()) })
        },
        yieldUi: () => yieldTask(),
      }

      let execution: JobExecution
      try {
        execution = await options.executor(cloneJob(job), control, hooks)
      } catch (error) {
        execution = {
          status: 'failed',
          report: 'The executor crashed before reporting a result.',
          error: error instanceof Error ? error.message : String(error),
        }
      }
      pauseFlags.delete(job.id)
      cancelFlags.delete(job.id)

      // The executor persisted its step-by-step progress through
      // hooks.update; finalise the latest record, not the pre-run clone.
      const latest = snapshot.find((candidate) => candidate.id === job.id) ?? job
      if (execution.status === 'completed' || execution.status === 'failed') {
        markFinished(latest, execution.status, execution.report, execution.error)
      } else if (execution.status === 'stopped') {
        markFinished(latest, 'stopped', execution.report)
      } else {
        persist({
          ...latest,
          status: 'paused',
          report: execution.report,
          ...(execution.error !== undefined ? { error: execution.error } : {}),
          ...(execution.pendingApproval !== undefined ? { pendingApproval: execution.pendingApproval } : {}),
          updatedAt: iso(now()),
        })
      }
      await yieldTask()
    }
  }

  const kick = (): void => {
    if (started && !currentTick && nextQueued()) void tick()
  }

  return {
    list: () => snapshot,

    get: (id) => snapshot.find((job) => job.id === id),

    enqueue: (input) => {
      const prompt = input.prompt.trim()
      if (!prompt) return null
      const job = createAgentJob({
        prompt,
        ...(input.title?.trim() ? { title: input.title.trim() } : {}),
        ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
        now: now(),
      })
      snapshot = [job, ...snapshot]
      agentJobStore.save(job)
      notify()
      kick()
      return job
    },

    pause: (id) => {
      const job = snapshot.find((candidate) => candidate.id === id)
      if (!job) return false
      if (job.status === 'queued') {
        persist({ ...job, status: 'paused', updatedAt: iso(now()) })
        return true
      }
      if (job.status === 'running') {
        pauseFlags.add(id)
        return true
      }
      return false
    },

    resume: (id) => {
      const job = snapshot.find((candidate) => candidate.id === id)
      if (!job || job.status !== 'paused') return false
      // A job paused for an approval resumes through decideApproval, never
      // around it: resuming here would re-ask the same unanswered question.
      if (job.pendingApproval) return false
      persist({ ...job, status: 'queued', updatedAt: iso(now()) })
      kick()
      return true
    },

    cancel: (id) => {
      const job = snapshot.find((candidate) => candidate.id === id)
      if (!job) return false
      if (job.status === 'queued' || job.status === 'paused') {
        markFinished(job, 'stopped', 'Stopped before it could run.')
        return true
      }
      if (job.status === 'running') {
        cancelFlags.add(id)
        return true
      }
      return false
    },

    remove: (id) => {
      const job = snapshot.find((candidate) => candidate.id === id)
      if (!job) return false
      if (job.status === 'running') return false
      agentJobStore.delete(id)
      removeFromSnapshot(id)
      return true
    },

    decideApproval: (id, approved) => {
      const job = snapshot.find((candidate) => candidate.id === id)
      if (!job || job.status !== 'paused' || !job.pendingApproval) return false
      const stepIndex = job.pendingApproval.stepIndex
      const granted = job.grantedApprovals ?? []
      const denied = job.deniedApprovals ?? []
      persist({
        ...job,
        status: 'queued',
        pendingApproval: undefined,
        grantedApprovals: approved && !granted.includes(stepIndex) ? [...granted, stepIndex] : granted,
        deniedApprovals: !approved && !denied.includes(stepIndex) ? [...denied, stepIndex] : denied,
        updatedAt: iso(now()),
      })
      kick()
      return true
    },

    recover: () => {
      const count = recoverInterruptedJobs(now())
      if (count > 0) {
        snapshot = agentJobStore.list()
        notify()
      }
      return count
    },

    start: () => {
      if (started) return
      started = true
      kick()
    },

    stop: () => {
      started = false
    },

    waitUntilIdle: async () => {
      while (currentTick) await currentTick
    },

    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export type { AgentJobStep }
