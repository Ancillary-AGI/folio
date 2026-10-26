/**
 * Cloud agent transport contract.
 *
 * Local autopilot runs in the browser and needs no server. Always-on agents —
 * where a job must keep running after the user closes the tab, or several
 * subscribed users share a worker pool — require a server-side runner. This
 * module defines the wire protocol and an HTTP client for that runner so the
 * browser side is finished and testable before the infrastructure exists.
 *
 * Required infrastructure (see docs/AGENT_CLOUD.md): a job queue, a sandboxed
 * worker with this project's solver/canvas runtime, durable design storage,
 * and an authenticated token exchange. Until then, a missing configuration is
 * reported honestly instead of pretending the capability exists.
 */
import type { AutopilotGoal } from './autopilot'
import type { CadDesignState } from './cadRuntime'

export const AGENT_JOB_SCHEMA = 'folio.agent-job/1' as const

export const AGENT_CLOUD_ENDPOINTS = {
  jobs: '/v1/agent/jobs',
  job: (jobId: string) => `/v1/agent/jobs/${encodeURIComponent(jobId)}`,
  events: (jobId: string, after = 0) =>
    `/v1/agent/jobs/${encodeURIComponent(jobId)}/events?after=${Math.max(0, Math.floor(after))}`,
  cancel: (jobId: string) => `/v1/agent/jobs/${encodeURIComponent(jobId)}/cancel`,
} as const

export interface AgentJobRequest {
  schema: typeof AGENT_JOB_SCHEMA
  /** Idempotency key; re-submitting the same id must not start two jobs. */
  clientJobId: string
  title: string
  projectId?: string
  goal: AutopilotGoal
  design: CadDesignState
  firmware?: string
  budget: { maxCalls: number; maxWallMs: number }
  /** `auto` lets the runner apply low-risk edits without a human gate. */
  approvalMode: 'auto' | 'on-write'
  createdAt: string
}

export type AgentJobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'expired'

export const TERMINAL_JOB_STATES: readonly AgentJobState[] = ['succeeded', 'failed', 'cancelled', 'expired']

export interface AgentJobStatus {
  id: string
  state: AgentJobState
  createdAt?: string
  updatedAt?: string
  progress?: { step: number; total?: number; message?: string }
  message?: string
  error?: string
  result?: {
    achieved: boolean
    reason: string
    fingerprint?: string
    bestIteration?: number
    bestMetric?: number
    metricLabel?: string
    metricUnit?: string
  }
}

export type AgentJobEventType =
  | 'status'
  | 'observation'
  | 'tool'
  | 'iteration'
  | 'log'
  | 'result'
  | 'error'

export interface AgentJobEvent {
  seq: number
  at: string
  type: AgentJobEventType
  message: string
  iteration?: number
  phase?: string
  tool?: string
  metric?: number
  metricLabel?: string
  metricUnit?: string
  goalMet?: boolean
  fingerprint?: string
  /** Endpoint-specific payload (for example a schematic SVG or assessment). */
  data?: unknown
}

export interface CloudAgentTransport {
  readonly kind: 'cloud' | 'unavailable'
  readonly baseUrl?: string
  submit(request: AgentJobRequest, signal?: AbortSignal): Promise<{ jobId: string; state: AgentJobState }>
  status(jobId: string, signal?: AbortSignal): Promise<AgentJobStatus>
  events(jobId: string, after?: number, signal?: AbortSignal): Promise<AgentJobEvent[]>
  cancel(jobId: string, signal?: AbortSignal): Promise<void>
  stream(
    jobId: string,
    onEvent: (event: AgentJobEvent) => void,
    options?: { after?: number; signal?: AbortSignal },
  ): Promise<void>
}

export class CloudAgentUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CloudAgentUnavailableError'
  }
}

export interface CloudAgentConfig {
  configured: boolean
  baseUrl?: string
  token?: string
  /** Why the runner is unavailable, when it is. */
  reason?: string
}

type EnvBag = Record<string, unknown>

const envString = (env: EnvBag, key: string): string | undefined => {
  const value = env[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/**
 * Read cloud-runner settings from Vite environment variables.
 *
 * Security: every `VITE_*` value is compiled into the public bundle. The token
 * here must be a short-lived token minted by an authenticated backend, never a
 * long-lived service credential. A production deployment should exchange the
 * user's Supabase session for a scoped job token.
 */
export function cloudAgentConfigFromEnv(env: EnvBag = import.meta.env as unknown as EnvBag): CloudAgentConfig {
  const baseUrl = envString(env, 'VITE_AGENT_CLOUD_URL')
  const token = envString(env, 'VITE_AGENT_CLOUD_TOKEN')
  if (!baseUrl) {
    return {
      configured: false,
      reason:
        'No cloud agent runner is configured. Local design, simulation and autopilot work without one; ' +
        'always-on or background agents need a server-side runner. Set VITE_AGENT_CLOUD_URL ' +
        '(and a short-lived VITE_AGENT_CLOUD_TOKEN) to enable the cloud transport.',
    }
  }
  const config: CloudAgentConfig = { configured: true, baseUrl: stripTrailingSlash(baseUrl) }
  if (token) config.token = token
  return config
}

const stripTrailingSlash = (value: string): string => value.replace(/\/+$/, '')

export interface CloudTransportOptions {
  baseUrl: string
  token?: string
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch
  /** Per-request timeout; a hung worker must not freeze the UI forever. */
  timeoutMs?: number
}

const joinUrl = (baseUrl: string, path: string): string => `${stripTrailingSlash(baseUrl)}${path}`

const errorBody = async (response: Response): Promise<string> => {
  try {
    const text = (await response.text()).trim()
    return text.length > 400 ? `${text.slice(0, 400)}…` : text
  } catch {
    return ''
  }
}

const isJobState = (value: unknown): value is AgentJobState =>
  value === 'queued'
  || value === 'running'
  || value === 'succeeded'
  || value === 'failed'
  || value === 'cancelled'
  || value === 'expired'

const parseStatus = (value: unknown): AgentJobStatus => {
  if (!value || typeof value !== 'object') throw new Error('The cloud runner returned a malformed job status.')
  const raw = value as Partial<AgentJobStatus>
  if (typeof raw.id !== 'string' || !isJobState(raw.state)) {
    throw new Error('The cloud runner returned a job status without a valid id or state.')
  }
  const status: AgentJobStatus = { id: raw.id, state: raw.state }
  if (typeof raw.createdAt === 'string') status.createdAt = raw.createdAt
  if (typeof raw.updatedAt === 'string') status.updatedAt = raw.updatedAt
  if (typeof raw.message === 'string') status.message = raw.message
  if (typeof raw.error === 'string') status.error = raw.error
  if (raw.progress && typeof raw.progress.step === 'number') {
    const progress: NonNullable<AgentJobStatus['progress']> = { step: raw.progress.step }
    if (typeof raw.progress.total === 'number') progress.total = raw.progress.total
    if (typeof raw.progress.message === 'string') progress.message = raw.progress.message
    status.progress = progress
  }
  if (raw.result && typeof raw.result.achieved === 'boolean' && typeof raw.result.reason === 'string') {
    const result: NonNullable<AgentJobStatus['result']> = {
      achieved: raw.result.achieved,
      reason: raw.result.reason,
    }
    if (typeof raw.result.fingerprint === 'string') result.fingerprint = raw.result.fingerprint
    if (typeof raw.result.bestIteration === 'number') result.bestIteration = raw.result.bestIteration
    if (typeof raw.result.bestMetric === 'number') result.bestMetric = raw.result.bestMetric
    if (typeof raw.result.metricLabel === 'string') result.metricLabel = raw.result.metricLabel
    if (typeof raw.result.metricUnit === 'string') result.metricUnit = raw.result.metricUnit
    status.result = result
  }
  return status
}

const parseEvent = (value: unknown): AgentJobEvent => {
  if (!value || typeof value !== 'object') throw new Error('The cloud runner returned a malformed event.')
  const raw = value as Partial<AgentJobEvent>
  if (typeof raw.seq !== 'number' || typeof raw.message !== 'string' || typeof raw.type !== 'string') {
    throw new Error('The cloud runner returned an event without seq, type, or message.')
  }
  if (!['status', 'observation', 'tool', 'iteration', 'log', 'result', 'error'].includes(raw.type)) {
    throw new Error(`The cloud runner returned an unknown event type: ${raw.type}.`)
  }
  const event: AgentJobEvent = {
    seq: raw.seq,
    at: typeof raw.at === 'string' ? raw.at : new Date().toISOString(),
    type: raw.type as AgentJobEventType,
    message: raw.message,
  }
  if (typeof raw.iteration === 'number') event.iteration = raw.iteration
  if (typeof raw.phase === 'string') event.phase = raw.phase
  if (typeof raw.tool === 'string') event.tool = raw.tool
  if (typeof raw.metric === 'number') event.metric = raw.metric
  if (typeof raw.metricLabel === 'string') event.metricLabel = raw.metricLabel
  if (typeof raw.metricUnit === 'string') event.metricUnit = raw.metricUnit
  if (typeof raw.goalMet === 'boolean') event.goalMet = raw.goalMet
  if (typeof raw.fingerprint === 'string') event.fingerprint = raw.fingerprint
  if (raw.data !== undefined) event.data = raw.data
  return event
}

const parseJobId = (value: unknown): string => {
  if (!value || typeof value !== 'object') throw new Error('The cloud runner did not return a job id.')
  const raw = value as { jobId?: unknown; id?: unknown; state?: unknown }
  const jobId = typeof raw.jobId === 'string' ? raw.jobId : typeof raw.id === 'string' ? raw.id : undefined
  if (!jobId) throw new Error('The cloud runner did not return a job id.')
  return jobId
}

/** Build an HTTP transport for the runner contract documented in AGENT_CLOUD.md. */
export function createCloudAgentTransport(options: CloudTransportOptions): CloudAgentTransport {
  const baseUrl = stripTrailingSlash(options.baseUrl)
  if (!/^https?:\/\//i.test(baseUrl)) {
    throw new Error(`Cloud agent base URL must start with http:// or https://, received "${options.baseUrl}".`)
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    throw new Error('No fetch implementation is available for the cloud agent transport.')
  }
  const timeoutMs = options.timeoutMs ?? 30_000

  const request = async (path: string, init: RequestInit, external?: AbortSignal): Promise<Response> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const abortFromExternal = (): void => controller.abort()
    external?.addEventListener('abort', abortFromExternal)
    try {
      const headers = new Headers(init.headers)
      headers.set('Accept', 'application/json')
      if (init.body !== undefined) headers.set('Content-Type', 'application/json')
      if (options.token) headers.set('Authorization', `Bearer ${options.token}`)
      const response = await fetchImpl(joinUrl(baseUrl, path), {
        ...init,
        headers,
        signal: controller.signal,
      })
      if (!response.ok) {
        const detail = await errorBody(response)
        throw new Error(
          `Cloud agent request failed (HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''})` +
          `${detail ? `: ${detail}` : '.'}`,
        )
      }
      return response
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError' && external?.aborted) {
        throw new Error('Cloud agent request was cancelled.')
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error(`Cloud agent request timed out after ${timeoutMs} ms.`)
      }
      throw error
    } finally {
      clearTimeout(timer)
      external?.removeEventListener('abort', abortFromExternal)
    }
  }

  return {
    kind: 'cloud',
    baseUrl,

    async submit(jobRequest, signal) {
      if (jobRequest.schema !== AGENT_JOB_SCHEMA) {
        throw new Error(`Agent job schema must be ${AGENT_JOB_SCHEMA}.`)
      }
      const response = await request(
        AGENT_CLOUD_ENDPOINTS.jobs,
        { method: 'POST', body: JSON.stringify(jobRequest) },
        signal,
      )
      const body: unknown = await response.json()
      const jobId = parseJobId(body)
      const state = (body as { state?: unknown }).state
      return { jobId, state: isJobState(state) ? state : 'queued' }
    },

    async status(jobId, signal) {
      if (!jobId) throw new Error('A job id is required.')
      const response = await request(AGENT_CLOUD_ENDPOINTS.job(jobId), { method: 'GET' }, signal)
      return parseStatus(await response.json())
    },

    async events(jobId, after = 0, signal) {
      if (!jobId) throw new Error('A job id is required.')
      const response = await request(AGENT_CLOUD_ENDPOINTS.events(jobId, after), { method: 'GET' }, signal)
      const body: unknown = await response.json()
      const list = Array.isArray(body)
        ? body
        : body && typeof body === 'object' && Array.isArray((body as { events?: unknown }).events)
          ? (body as { events: unknown[] }).events
          : undefined
      if (!list) throw new Error('The cloud runner returned a malformed event list.')
      return list.map(parseEvent)
    },

    async cancel(jobId, signal) {
      if (!jobId) throw new Error('A job id is required.')
      await request(AGENT_CLOUD_ENDPOINTS.cancel(jobId), { method: 'POST' }, signal)
    },

    async stream(jobId, onEvent, streamOptions = {}) {
      if (!jobId) throw new Error('A job id is required.')
      const response = await request(
        AGENT_CLOUD_ENDPOINTS.events(jobId, streamOptions.after ?? 0),
        { method: 'GET', headers: { Accept: 'text/event-stream' } },
        streamOptions.signal,
      )
      if (!response.body) {
        throw new Error(
          'This environment cannot stream cloud agent events (no response body). ' +
          'Use status()/events() polling instead.',
        )
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let boundary = buffer.indexOf('\n\n')
          while (boundary >= 0) {
            const chunk = buffer.slice(0, boundary)
            buffer = buffer.slice(boundary + 2)
            const payload = chunk
              .split('\n')
              .filter((line) => line.startsWith('data:'))
              .map((line) => line.slice(5).trim())
              .join('\n')
            if (payload === '[DONE]') return
            if (payload) onEvent(parseEvent(JSON.parse(payload)))
            boundary = buffer.indexOf('\n\n')
          }
        }
        const tail = buffer
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('\n')
        if (tail && tail !== '[DONE]') onEvent(parseEvent(JSON.parse(tail)))
      } finally {
        reader.releaseLock()
      }
    },
  }
}

/** An inert transport that explains why cloud jobs cannot start. */
export function createUnavailableCloudTransport(reason: string): CloudAgentTransport {
  const unavailable = (): never => {
    throw new CloudAgentUnavailableError(reason)
  }
  return {
    kind: 'unavailable',
    async submit() { return unavailable() },
    async status() { return unavailable() },
    async events() { return unavailable() },
    async cancel() { unavailable() },
    async stream() { unavailable() },
  }
}

/** Pick a cloud transport from environment configuration, or an honest stub. */
export function cloudAgentTransportFromEnv(
  env: EnvBag = import.meta.env as unknown as EnvBag,
  fetchImpl?: typeof fetch,
): CloudAgentTransport {
  const config = cloudAgentConfigFromEnv(env)
  if (!config.configured || !config.baseUrl) {
    return createUnavailableCloudTransport(config.reason ?? 'No cloud agent runner is configured.')
  }
  return createCloudAgentTransport({
    baseUrl: config.baseUrl,
    ...(config.token !== undefined ? { token: config.token } : {}),
    ...(fetchImpl !== undefined ? { fetchImpl } : {}),
  })
}

/** Build a job request from session state without leaking UI-only fields. */
export function createAgentJobRequest(input: {
  sessionId: string
  title: string
  projectId?: string
  goal: AutopilotGoal
  design: CadDesignState
  firmware?: string
  budget: { maxCalls: number; maxWallMs: number }
  approvalMode?: 'auto' | 'on-write'
  now?: number
}): AgentJobRequest {
  if (!input.sessionId.trim()) throw new Error('A client job id is required.')
  if (!input.goal || typeof input.goal.description !== 'string' || !input.goal.description.trim()) {
    throw new Error('A cloud agent job needs a goal with a description.')
  }
  if (input.budget.maxCalls <= 0 || input.budget.maxWallMs <= 0) {
    throw new Error('A cloud agent job needs a positive call and wall-time budget.')
  }
  const request: AgentJobRequest = {
    schema: AGENT_JOB_SCHEMA,
    clientJobId: input.sessionId,
    title: input.title,
    goal: input.goal,
    design: input.design,
    budget: input.budget,
    approvalMode: input.approvalMode ?? 'auto',
    createdAt: new Date(input.now ?? Date.now()).toISOString(),
  }
  if (input.projectId !== undefined) request.projectId = input.projectId
  if (input.firmware !== undefined) request.firmware = input.firmware
  return request
}

export const isTerminalJobState = (state: AgentJobState): boolean => TERMINAL_JOB_STATES.includes(state)
