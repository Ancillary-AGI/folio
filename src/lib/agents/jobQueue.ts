/**
 * Durable agent-job records for the always-on runner.
 *
 * A job is a queued piece of agent work (inspect, simulate, route, fab) that
 * runs through plan → act → verify → report. The record persists every phase
 * transition, so a job survives a reload: a running job is recovered as paused
 * and resumes from its first unfinished step. Persisted records keep only
 * primitive step arguments and short summaries — never SVG or netlist blobs —
 * so a long queue cannot exhaust browser storage.
 */

export const AGENT_JOB_SCHEMA = 'folio.agent-job/1' as const
export const AGENT_JOB_STORAGE_KEY = 'folio.agentJobs'
export const MAX_AGENT_JOBS = 40

export type AgentJobStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'stopped'

export type AgentJobPhase = 'queued' | 'plan' | 'act' | 'verify' | 'report'

export type AgentJobStepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'denied' | 'skipped'

export interface AgentJobStep {
  tool: string
  rationale: string
  args: Record<string, string | number | boolean>
  status: AgentJobStepStatus
  /** True when this step's tool needs human approval before it can run. */
  needsApproval: boolean
  error?: string
  summary?: string
  startedAt?: number
  endedAt?: number
}

/** A step the job is paused on, waiting for the human to decide. */
export interface AgentJobApprovalRequest {
  stepIndex: number
  tool: string
  args: Record<string, string | number | boolean>
}

/** Compact evidence of the token-budgeted context the job was planned with. */
export interface AgentJobContextSummary {
  totalTokens: number
  budgetTokens: number
  dropped: string[]
}

export interface AgentJob {
  schema: typeof AGENT_JOB_SCHEMA
  id: string
  title: string
  prompt: string
  projectId?: string
  status: AgentJobStatus
  phase: AgentJobPhase
  createdAt: string
  updatedAt: string
  startedAt?: string
  finishedAt?: string
  steps: AgentJobStep[]
  report?: string
  error?: string
  /** True when a job that was running at app close was recovered as paused. */
  recoveredFromCrash?: boolean
  /** Present while the job is paused waiting for a human approval. */
  pendingApproval?: AgentJobApprovalRequest
  /** Step indices whose approval was granted; survives pause/resume. */
  grantedApprovals?: number[]
  /** Step indices whose approval was denied; survives pause/resume. */
  deniedApprovals?: number[]
  contextSummary?: AgentJobContextSummary
}

const jobSeq = { value: 0 }

const iso = (millis: number): string => new Date(millis).toISOString()

/** A stable, sortable id without depending on a UUID implementation. */
const newJobId = (now: number): string => {
  jobSeq.value += 1
  return `job-${now}-${jobSeq.value}`
}

export interface CreateAgentJobInput {
  prompt: string
  title?: string
  projectId?: string
  now?: number
}

export function createAgentJob(input: CreateAgentJobInput): AgentJob {
  const now = input.now ?? Date.now()
  const stamp = iso(now)
  const trimmed = input.prompt.trim()
  const job: AgentJob = {
    schema: AGENT_JOB_SCHEMA,
    id: newJobId(now),
    title: input.title?.trim() || trimmed.slice(0, 64) || 'Untitled job',
    prompt: trimmed,
    status: 'queued',
    phase: 'queued',
    createdAt: stamp,
    updatedAt: stamp,
    steps: [],
  }
  if (input.projectId !== undefined) job.projectId = input.projectId
  return job
}

const isJobStep = (value: unknown): value is AgentJobStep => {
  if (!value || typeof value !== 'object') return false
  const step = value as Partial<AgentJobStep>
  return (
    typeof step.tool === 'string'
    && typeof step.rationale === 'string'
    && typeof step.status === 'string'
    && typeof step.args === 'object'
    && step.args !== null
  )
}

/** Coerce untrusted storage/JSON into a valid job, or `undefined`. */
export function parseAgentJob(value: unknown): AgentJob | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Partial<AgentJob>
  if (raw.schema !== AGENT_JOB_SCHEMA) return undefined
  if (typeof raw.id !== 'string' || typeof raw.title !== 'string' || typeof raw.prompt !== 'string') return undefined
  if (raw.status !== 'queued' && raw.status !== 'running' && raw.status !== 'paused'
    && raw.status !== 'completed' && raw.status !== 'failed' && raw.status !== 'stopped') return undefined
  if (typeof raw.createdAt !== 'string' || typeof raw.updatedAt !== 'string') return undefined
  if (!Array.isArray(raw.steps)) return undefined
  const job: AgentJob = {
    schema: AGENT_JOB_SCHEMA,
    id: raw.id,
    title: raw.title,
    prompt: raw.prompt,
    status: raw.status,
    phase: typeof raw.phase === 'string' ? raw.phase : 'queued',
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    steps: raw.steps.filter(isJobStep).map((step) => ({
      tool: step.tool,
      rationale: step.rationale,
      args: { ...step.args },
      status: step.status,
      needsApproval: step.needsApproval === true,
      ...(step.error !== undefined ? { error: step.error } : {}),
      ...(step.summary !== undefined ? { summary: step.summary } : {}),
      ...(step.startedAt !== undefined ? { startedAt: step.startedAt } : {}),
      ...(step.endedAt !== undefined ? { endedAt: step.endedAt } : {}),
    })),
  }
  if (typeof raw.projectId === 'string') job.projectId = raw.projectId
  if (typeof raw.startedAt === 'string') job.startedAt = raw.startedAt
  if (typeof raw.finishedAt === 'string') job.finishedAt = raw.finishedAt
  if (typeof raw.report === 'string') job.report = raw.report
  if (typeof raw.error === 'string') job.error = raw.error
  if (raw.recoveredFromCrash === true) job.recoveredFromCrash = true
  const approval = raw.pendingApproval
  if (
    approval && typeof approval === 'object'
    && typeof (approval as AgentJobApprovalRequest).stepIndex === 'number'
    && typeof (approval as AgentJobApprovalRequest).tool === 'string'
  ) {
    job.pendingApproval = {
      stepIndex: (approval as AgentJobApprovalRequest).stepIndex,
      tool: (approval as AgentJobApprovalRequest).tool,
      args: { ...((approval as AgentJobApprovalRequest).args ?? {}) },
    }
  }
  if (Array.isArray(raw.grantedApprovals)) {
    job.grantedApprovals = raw.grantedApprovals.filter((index): index is number => typeof index === 'number')
  }
  if (Array.isArray(raw.deniedApprovals)) {
    job.deniedApprovals = raw.deniedApprovals.filter((index): index is number => typeof index === 'number')
  }
  const context = raw.contextSummary
  if (
    context && typeof context === 'object'
    && typeof (context as AgentJobContextSummary).totalTokens === 'number'
    && typeof (context as AgentJobContextSummary).budgetTokens === 'number'
    && Array.isArray((context as AgentJobContextSummary).dropped)
  ) {
    job.contextSummary = {
      totalTokens: (context as AgentJobContextSummary).totalTokens,
      budgetTokens: (context as AgentJobContextSummary).budgetTokens,
      dropped: (context as AgentJobContextSummary).dropped.filter((entry): entry is string => typeof entry === 'string'),
    }
  }
  return job
}

const readJobs = (): AgentJob[] => {
  if (typeof localStorage === 'undefined') return []
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(AGENT_JOB_STORAGE_KEY) || '[]')
    if (!Array.isArray(stored)) return []
    return stored
      .map(parseAgentJob)
      .filter((job): job is AgentJob => job !== undefined)
  } catch {
    return []
  }
}

const writeJobs = (jobs: AgentJob[]): void => {
  if (typeof localStorage === 'undefined') return
  // Keep the newest jobs; a durable queue must never grow without bound.
  const sorted = [...jobs].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  const kept = sorted.slice(0, MAX_AGENT_JOBS)
  try {
    localStorage.setItem(AGENT_JOB_STORAGE_KEY, JSON.stringify(kept))
  } catch {
    // Storage is full or unavailable; the in-memory queue keeps working for
    // this session, and the next successful write replaces the record.
  }
}

export const agentJobStore = {
  list(): AgentJob[] {
    return readJobs().sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  },

  get(id: string): AgentJob | undefined {
    return readJobs().find((job) => job.id === id)
  },

  save(job: AgentJob): void {
    const others = readJobs().filter((candidate) => candidate.id !== job.id)
    writeJobs([job, ...others])
  },

  delete(id: string): void {
    writeJobs(readJobs().filter((job) => job.id !== id))
  },

  clear(): void {
    if (typeof localStorage === 'undefined') return
    localStorage.removeItem(AGENT_JOB_STORAGE_KEY)
  },
}

/**
 * Mark every job that was persisted as `running` as `paused`: a browser
 * runner cannot keep executing after the tab closed, and claiming otherwise
 * would be a lie. The recovered flag lets the UI say what actually happened.
 * Returns the number of recovered jobs.
 */
export function recoverInterruptedJobs(now = Date.now()): number {
  const recovered = readJobs().map((job) => (
    job.status === 'running'
      ? { ...job, status: 'paused' as const, recoveredFromCrash: true, updatedAt: iso(now) }
      : job
  ))
  const count = recovered.filter((job) => job.recoveredFromCrash === true).length
  if (count > 0) writeJobs(recovered)
  return count
}
