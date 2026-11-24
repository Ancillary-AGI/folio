/**
 * Cloud agent transport contract.
 *
 * Local autopilot runs in the browser and needs no server. Always-on agents —
 * where a job must keep running after the user closes the tab, or several
 * subscribed users share a worker pool — run on the built-in server runner in
 * `app/api/v1/agent/*` (see docs/DEPLOYMENT.md). This module defines the wire
 * protocol and the HTTP client both sides use, so a deployment can point it at
 * the bundled runner with `NEXT_PUBLIC_AGENT_CLOUD_URL=/api` or at its own
 * compatible worker with an absolute URL and a short-lived token.
 *
 * A missing configuration is reported honestly instead of pretending the
 * capability exists; local design, simulation and autopilot never need it.
 */
import type { AutopilotGoal } from './autopilot'
import { AGENT_CLOUD_URL, AGENT_CLOUD_TOKEN } from '../env'
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
    /** Knob values measured at the best iteration. */
    values?: Record<string, number>
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

/* The build-time bag: the deployment sets NEXT_PUBLIC_AGENT_CLOUD_URL (and a
 * short-lived token); the NEXT_PUBLIC_* values are inlined for the client
 * bundle by next.config.mjs. The VITE_* keys are kept as aliases so a
 * deployment migrated from the Vite build reads the same values unchanged. */
const envFromBuild: EnvBag = {
  NEXT_PUBLIC_AGENT_CLOUD_URL: AGENT_CLOUD_URL,
  NEXT_PUBLIC_AGENT_CLOUD_TOKEN: AGENT_CLOUD_TOKEN,
  VITE_AGENT_CLOUD_URL: AGENT_CLOUD_URL,
  VITE_AGENT_CLOUD_TOKEN: AGENT_CLOUD_TOKEN,
}

const envString = (env: EnvBag, key: string): string | undefined => {
  const value = env[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/**
 * Read cloud-runner settings from the build environment.
 *
 * Security: every `NEXT_PUBLIC_*` value is compiled into the public bundle. The
 * token here must be a short-lived token minted by an authenticated backend,
 * never a long-lived service credential. A root-relative URL (`/api`) selects
 * the runner shipped with this deployment and exchanges the signed-in
 * Supabase session for a scoped token at request time instead.
 */
export function cloudAgentConfigFromEnv(env: EnvBag = envFromBuild): CloudAgentConfig {
  const baseUrl = envString(env, 'NEXT_PUBLIC_AGENT_CLOUD_URL') ?? envString(env, 'VITE_AGENT_CLOUD_URL')
  const token = envString(env, 'NEXT_PUBLIC_AGENT_CLOUD_TOKEN') ?? envString(env, 'VITE_AGENT_CLOUD_TOKEN')
  if (!baseUrl) {
    return {
      configured: false,
      reason:
        'No cloud agent runner is configured. Local design, simulation and autopilot work without one; ' +
        'always-on or background agents need a server-side runner. Set NEXT_PUBLIC_AGENT_CLOUD_URL ' +
        '(/api for the bundled runner, or an absolute URL) and optionally a short-lived ' +
        'NEXT_PUBLIC_AGENT_CLOUD_TOKEN to enable the cloud transport.',
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
  /**
   * Resolve a credential immediately before each request. A hosted deployment
   * uses this to exchange the current session for a short-lived runner token,
   * so no long-lived secret is inlined into the public bundle.
   */
  tokenProvider?: () => Promise<string | undefined> | string | undefined
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch
  /** Per-request timeout; a hung worker must not freeze the UI forever. */
  timeoutMs?: number
}

const joinUrl = (baseUrl: string, path: string): string => `${stripTrailingSlash(baseUrl)}${path}`

/**
 * A base URL may be absolute, or root-relative for the runner shipped in this
 * deployment (`/api`). A relative value needs a browser origin; in a headless
 * test or worker it is a configuration error rather than a silent fetch to an
 * invented host.
 */
const absoluteBaseUrl = (raw: string): { baseUrl: string; sameOrigin: boolean } => {
  const value = raw.trim()
  const origin = typeof globalThis.location !== 'undefined' ? globalThis.location.origin : undefined
  if (/^https?:\/\//i.test(value)) {
    const baseUrl = stripTrailingSlash(value)
    let sameOrigin = false
    if (origin) {
      try {
        sameOrigin = new URL(baseUrl).origin === origin
      } catch {
        sameOrigin = false
      }
    }
    return { baseUrl, sameOrigin }
  }
  if (value.startsWith('/')) {
    if (origin) return { baseUrl: stripTrailingSlash(new URL(value, origin).toString()), sameOrigin: true }
  }
  throw new Error(
    `Cloud agent base URL must start with http://, https://, or / for the same-origin runner, received "${raw}".`,
  )
}

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
    const rawValues = (raw.result as { values?: unknown }).values
    if (rawValues && typeof rawValues === 'object' && !Array.isArray(rawValues)) {
      const values: Record<string, number> = {}
      for (const [key, value] of Object.entries(rawValues)) {
        if (typeof value === 'number' && Number.isFinite(value)) values[key] = value
      }
      if (Object.keys(values).length > 0) result.values = values
    }
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

/** Build an HTTP transport for the runner contract documented in docs/DEPLOYMENT.md. */
export function createCloudAgentTransport(options: CloudTransportOptions): CloudAgentTransport {
  const { baseUrl, sameOrigin } = absoluteBaseUrl(options.baseUrl)
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    throw new Error('No fetch implementation is available for the cloud agent transport.')
  }
  const timeoutMs = options.timeoutMs ?? 30_000

  const request = async (path: string, init: RequestInit, external?: AbortSignal): Promise<Response> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const abortFromExternal = (): void => controller.abort()
    if (external?.aborted) controller.abort()
    external?.addEventListener('abort', abortFromExternal)
    try {
      const headers = new Headers(init.headers)
      // Keep an explicit Accept (event-stream) instead of overwriting it with
      // application/json — the SSE path used to negotiate the wrong media type.
      if (!headers.has('Accept')) headers.set('Accept', 'application/json')
      if (init.body !== undefined) headers.set('Content-Type', 'application/json')
      let token = options.token
      if (!token && options.tokenProvider) {
        try {
          token = await options.tokenProvider()
        } catch {
          // A token exchange can fail because the deployment does not mint
          // tokens; fall through so same-origin or unauthenticated local
          // runners can still answer, and let the server give the real reason.
          token = undefined
        }
      }
      if (token) headers.set('Authorization', `Bearer ${token}`)
      // Marks the request as a deliberate runner call. Cross-site forms cannot
      // set it, so the same-origin trust mode has a CSRF boundary.
      if (sameOrigin) headers.set('x-folio-runner', '1')
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
      const aborted = error instanceof Error && error.name === 'AbortError'
      if (aborted && external?.aborted) throw new Error('Cloud agent request was cancelled.')
      if (aborted) throw new Error(`Cloud agent request timed out after ${timeoutMs} ms.`)
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
      const signal = streamOptions.signal
      let buffer = ''
      let cancelled = false
      /* `request()` stops linking the caller's signal once the response headers
       * arrive, because for a normal request the work is done there. A stream is
       * the exception: the body is the rest of the work, so the link is
       * re-established here. Without it, aborting mid-stream leaves `read()`
       * parked until the server happens to close. */
      const cancelReader = (): void => {
        cancelled = true
        void reader.cancel().catch(() => {})
      }
      if (signal?.aborted) cancelReader()
      else signal?.addEventListener('abort', cancelReader, { once: true })
      try {
        for (;;) {
          if (cancelled) throw new Error('Cloud agent request was cancelled.')
          const { done, value } = await reader.read()
          if (done) {
            /* A cancelled reader resolves the pending read as `done`, so a
             * cancellation must be checked here too — otherwise an abort would
             * look like a clean end of stream and report success. */
            if (cancelled) throw new Error('Cloud agent request was cancelled.')
            break
          }
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
        signal?.removeEventListener('abort', cancelReader)
        /* Release the body on every exit path, including an early `return` at
         * the DONE sentinel: `releaseLock()` alone leaves the underlying stream
         * open, which keeps the connection and its server worker alive. */
        try {
          await reader.cancel()
        } catch {
          /* already errored or closed */
        }
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

/**
 * Exchange the current Supabase session for a short-lived runner token. Loaded
 * lazily so a standalone build never pulls the auth client into the agent chunk.
 */
async function sessionRunnerToken(): Promise<string | undefined> {
  const { currentRunnerToken } = await import('./runnerToken')
  return currentRunnerToken()
}

/** Pick a cloud transport from environment configuration, or report honestly that none is configured. */
export function cloudAgentTransportFromEnv(
  env: EnvBag = envFromBuild,
  fetchImpl?: typeof fetch,
): CloudAgentTransport {
  const config = cloudAgentConfigFromEnv(env)
  if (!config.configured || !config.baseUrl) {
    return createUnavailableCloudTransport(config.reason ?? 'No cloud agent runner is configured.')
  }
  // Mark a bundled or same-origin absolute URL so the request can use the
  // token exchange (and the CSRF marker) without a static bundle secret.
  let sameOrigin = false
  try {
    sameOrigin = absoluteBaseUrl(config.baseUrl).sameOrigin
  } catch {
    sameOrigin = false
  }
  return createCloudAgentTransport({
    baseUrl: config.baseUrl,
    ...(config.token !== undefined ? { token: config.token } : {}),
    ...(config.token === undefined && sameOrigin ? { tokenProvider: sessionRunnerToken } : {}),
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
