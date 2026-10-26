/**
 * Durable agent-session records.
 *
 * A solo-design agent may run for minutes and hundreds of tool calls. The
 * live UI keeps the full transcript in memory; this module keeps the durable
 * part on disk (localStorage) so a session survives a reload, can be audited
 * later, or can be handed to a cloud runner. Persisted records deliberately
 * omit large SVG payloads — those are regenerated from the design on demand —
 * so a long session cannot exhaust browser storage.
 */
import type { CanvasComponent, CanvasWire } from '../../stores/useProjectStore'
import type { AutopilotGoal, AutopilotIteration, AutopilotResult } from './autopilot'

export const AGENT_SESSION_SCHEMA = 'folio.agent-session/1' as const
export const AGENT_SESSION_STORAGE_KEY = 'folio.agentSessions'
export const MAX_AGENT_SESSIONS = 40
export const MAX_AGENT_SESSION_EVENTS = 500

export type AgentSessionStatus = 'running' | 'completed' | 'failed' | 'stopped'

export type AgentSessionEventKind =
  | 'created'
  | 'goal'
  | 'observation'
  | 'tool'
  | 'iteration'
  | 'note'
  | 'error'
  | 'finished'

export interface AgentSessionEvent {
  seq: number
  at: string
  kind: AgentSessionEventKind
  message: string
  iteration?: number
  phase?: string
  tool?: string
  /** True/false for calls that needed approval; absent when auto-approved. */
  approved?: boolean
  metric?: number
  metricLabel?: string
  metricUnit?: string
  score?: number
  goalMet?: boolean
  fingerprint?: string
  /** Budget/call count after this event, for a compact progress readout. */
  calls?: number
}

export interface AgentSessionBudget {
  maxCalls: number
  maxWallMs: number
}

export interface AgentSessionBest {
  iteration: number
  knobValues: Record<string, number>
  metric?: number
  metricLabel: string
  metricUnit?: string
  score: number
  fingerprint?: string
  design: {
    components: CanvasComponent[]
    wires: CanvasWire[]
  }
}

export interface AgentSession {
  schema: typeof AGENT_SESSION_SCHEMA
  id: string
  projectId?: string
  title: string
  goal?: string
  status: AgentSessionStatus
  createdAt: string
  updatedAt: string
  budget?: AgentSessionBudget
  calls: number
  iterationCount: number
  events: AgentSessionEvent[]
  best?: AgentSessionBest
  finalFingerprint?: string
  cloudJobId?: string
  summary?: string
}

export interface SaveSessionResult {
  ok: boolean
  error?: string
}

const sessionSeq = { value: 0 }

const iso = (millis: number): string => new Date(millis).toISOString()

/** A stable, sortable id without depending on a UUID implementation. */
const newSessionId = (now: number): string => {
  sessionSeq.value += 1
  return `session-${now}-${sessionSeq.value}`
}

export interface CreateAgentSessionInput {
  title: string
  goal?: string
  projectId?: string
  budget?: AgentSessionBudget
  id?: string
  now?: number
}

export function createAgentSession(input: CreateAgentSessionInput): AgentSession {
  const now = input.now ?? Date.now()
  const stamp = iso(now)
  const base: AgentSession = {
    schema: AGENT_SESSION_SCHEMA,
    id: input.id ?? newSessionId(now),
    title: input.title,
    status: 'running',
    createdAt: stamp,
    updatedAt: stamp,
    calls: 0,
    iterationCount: 0,
    events: [],
  }
  if (input.projectId !== undefined) base.projectId = input.projectId
  if (input.goal !== undefined) base.goal = input.goal
  if (input.budget !== undefined) base.budget = { ...input.budget }
  return base
}

export type AgentSessionEventInput = Omit<AgentSessionEvent, 'seq' | 'at'> & {
  at?: number
}

/**
 * Append an event, updating the session's progress counters. Events beyond
 * `MAX_AGENT_SESSION_EVENTS` are dropped from the front so the newest history
 * always survives.
 */
export function recordAgentSessionEvent(
  session: AgentSession,
  input: AgentSessionEventInput,
  now = Date.now(),
): AgentSession {
  const { at, ...rest } = input
  const event: AgentSessionEvent = {
    ...rest,
    seq: session.events.length === 0 ? 1 : session.events[session.events.length - 1].seq + 1,
    at: iso(at ?? now),
  }
  const events = [...session.events, event]
  const trimmed = events.length > MAX_AGENT_SESSION_EVENTS
    ? events.slice(events.length - MAX_AGENT_SESSION_EVENTS)
    : events
  return {
    ...session,
    events: trimmed,
    iterationCount: input.kind === 'iteration' ? session.iterationCount + 1 : session.iterationCount,
    calls: input.calls ?? session.calls,
    updatedAt: iso(now),
  }
}

/** Summarise one autopilot iteration without persisting its SVG blobs. */
export function recordAutopilotIteration(
  session: AgentSession,
  iteration: AutopilotIteration,
  now = Date.now(),
): AgentSession {
  const input: AgentSessionEventInput = {
    kind: iteration.error ? 'error' : 'iteration',
    message: iteration.error ?? iteration.message,
    iteration: iteration.iteration,
    phase: iteration.phase,
    metric: iteration.metric,
    metricLabel: iteration.metricLabel,
    goalMet: iteration.goalMet,
  }
  if (iteration.metricUnit !== undefined) input.metricUnit = iteration.metricUnit
  if (iteration.score !== undefined) input.score = iteration.score
  if (iteration.fingerprint !== undefined) input.fingerprint = iteration.fingerprint
  return recordAgentSessionEvent(session, input, now)
}

export interface FinishSessionInput {
  status: Exclude<AgentSessionStatus, 'running'>
  summary: string
  finalFingerprint?: string
  now?: number
}

export function finishAgentSession(session: AgentSession, input: FinishSessionInput): AgentSession {
  const now = input.now ?? Date.now()
  const withFinish = recordAgentSessionEvent(
    session,
    { kind: 'finished', message: input.summary, fingerprint: input.finalFingerprint },
    now,
  )
  const finished: AgentSession = {
    ...withFinish,
    status: input.status,
    summary: input.summary,
    updatedAt: iso(now),
  }
  if (input.finalFingerprint !== undefined) finished.finalFingerprint = input.finalFingerprint
  return finished
}

/**
 * Build a completed session record from a finished autopilot run. The full
 * iteration list is reduced to timeline events; `best.design` is kept so the
 * winner can be restored without re-running the search.
 */
export function sessionFromAutopilot(
  result: AutopilotResult,
  options: { title?: string; projectId?: string; budget?: AgentSessionBudget; now?: number } = {},
): AgentSession {
  const now = options.now ?? Date.now()
  let session = createAgentSession({
    title: options.title ?? result.goal.description,
    goal: result.goal.description,
    ...(options.projectId !== undefined ? { projectId: options.projectId } : {}),
    ...(options.budget !== undefined ? { budget: options.budget } : {}),
    now,
  })
  session = recordAgentSessionEvent(session, {
    kind: 'goal',
    message: `${result.goal.analysis.type} · ${result.goal.metric.kind === 'margin' ? 'margin' : result.goal.metric.waveform}`,
  }, now)
  for (const iteration of result.iterations) {
    session = recordAutopilotIteration(session, iteration, now)
  }
  if (result.best) {
    const best: AgentSessionBest = {
      iteration: result.best.iteration,
      knobValues: { ...result.best.knobValues },
      metricLabel: result.best.metricLabel,
      score: result.best.score,
      design: {
        components: result.best.design.components,
        wires: result.best.design.wires,
      },
    }
    if (result.best.metric !== undefined) best.metric = result.best.metric
    if (result.best.metricUnit !== undefined) best.metricUnit = result.best.metricUnit
    session.best = best
  }
  return finishAgentSession(session, {
    status: result.achieved ? 'completed' : 'stopped',
    summary: result.reason,
    ...(result.fingerprint !== undefined ? { finalFingerprint: result.fingerprint } : {}),
    now,
  })
}

/** Coerce untrusted storage/JSON into a valid session, or `undefined`. */
export function parseAgentSession(value: unknown): AgentSession | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Partial<AgentSession>
  if (raw.schema !== AGENT_SESSION_SCHEMA) return undefined
  if (typeof raw.id !== 'string' || typeof raw.title !== 'string') return undefined
  if (
    raw.status !== 'running'
    && raw.status !== 'completed'
    && raw.status !== 'failed'
    && raw.status !== 'stopped'
  ) return undefined
  if (typeof raw.createdAt !== 'string' || typeof raw.updatedAt !== 'string') return undefined
  if (!Array.isArray(raw.events)) return undefined
  const events = raw.events
    .filter((event): event is AgentSessionEvent =>
      Boolean(event)
      && typeof event === 'object'
      && typeof (event as AgentSessionEvent).seq === 'number'
      && typeof (event as AgentSessionEvent).message === 'string'
      && typeof (event as AgentSessionEvent).kind === 'string'
      && typeof (event as AgentSessionEvent).at === 'string',
    )
    .slice(-MAX_AGENT_SESSION_EVENTS)
  const session: AgentSession = {
    schema: AGENT_SESSION_SCHEMA,
    id: raw.id,
    title: raw.title,
    status: raw.status,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    calls: typeof raw.calls === 'number' ? raw.calls : 0,
    iterationCount: typeof raw.iterationCount === 'number' ? raw.iterationCount : 0,
    events,
  }
  if (typeof raw.projectId === 'string') session.projectId = raw.projectId
  if (typeof raw.goal === 'string') session.goal = raw.goal
  if (typeof raw.summary === 'string') session.summary = raw.summary
  if (typeof raw.finalFingerprint === 'string') session.finalFingerprint = raw.finalFingerprint
  if (typeof raw.cloudJobId === 'string') session.cloudJobId = raw.cloudJobId
  if (raw.budget && typeof raw.budget.maxCalls === 'number' && typeof raw.budget.maxWallMs === 'number') {
    session.budget = { maxCalls: raw.budget.maxCalls, maxWallMs: raw.budget.maxWallMs }
  }
  const best = raw.best
  if (
    best
    && typeof best === 'object'
    && best.design
    && Array.isArray(best.design.components)
    && Array.isArray(best.design.wires)
    && typeof best.metricLabel === 'string'
    && typeof best.score === 'number'
    && typeof best.iteration === 'number'
  ) {
    const record: AgentSessionBest = {
      iteration: best.iteration,
      knobValues: best.knobValues && typeof best.knobValues === 'object' ? { ...best.knobValues } : {},
      metricLabel: best.metricLabel,
      score: best.score,
      design: { components: best.design.components, wires: best.design.wires },
    }
    if (typeof best.metric === 'number') record.metric = best.metric
    if (typeof best.metricUnit === 'string') record.metricUnit = best.metricUnit
    if (typeof best.fingerprint === 'string') record.fingerprint = best.fingerprint
    session.best = record
  }
  return session
}

const readSessions = (): AgentSession[] => {
  if (typeof localStorage === 'undefined') return []
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(AGENT_SESSION_STORAGE_KEY) || '[]')
    if (!Array.isArray(stored)) return []
    return stored
      .map(parseAgentSession)
      .filter((session): session is AgentSession => session !== undefined)
  } catch {
    return []
  }
}

const writeSessions = (sessions: AgentSession[]): SaveSessionResult => {
  if (typeof localStorage === 'undefined') {
    return { ok: false, error: 'Browser storage is unavailable, so this session was not persisted.' }
  }
  // Keep the newest sessions; a durable history must never grow without bound.
  const sorted = [...sessions].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  const kept = sorted.slice(0, MAX_AGENT_SESSIONS)
  try {
    localStorage.setItem(AGENT_SESSION_STORAGE_KEY, JSON.stringify(kept))
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: `Could not persist the session: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

export const agentSessionStore = {
  list(): AgentSession[] {
    return readSessions().sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  },

  get(id: string): AgentSession | undefined {
    return readSessions().find((session) => session.id === id)
  },

  save(session: AgentSession): SaveSessionResult {
    const others = readSessions().filter((candidate) => candidate.id !== session.id)
    return writeSessions([session, ...others])
  },

  delete(id: string): void {
    writeSessions(readSessions().filter((session) => session.id !== id))
  },

  clear(): void {
    if (typeof localStorage === 'undefined') return
    localStorage.removeItem(AGENT_SESSION_STORAGE_KEY)
  },
}

/**
 * Subscribe to sessions changing in another tab. Returns an unsubscribe
 * function; a no-op outside the browser. Storage events fire only for other
 * documents, which is exactly the multi-tab case this is for.
 */
export function onAgentSessionsChanged(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = (event: StorageEvent): void => {
    if (event.key === AGENT_SESSION_STORAGE_KEY) listener()
  }
  window.addEventListener('storage', handler)
  return () => window.removeEventListener('storage', handler)
}

/** Compact, human-readable line for an event, shared by UI and audit views. */
export function describeSessionEvent(event: AgentSessionEvent): string {
  const metric = event.metric !== undefined
    ? ` — ${event.metricLabel}${event.metricUnit ? ` ${formatNumber(event.metric)} ${event.metricUnit}` : ` ${formatNumber(event.metric)}`}`
    : ''
  const iteration = event.iteration !== undefined ? `#${event.iteration} ` : ''
  const phase = event.phase ? `[${event.phase}] ` : ''
  return `${iteration}${phase}${event.message}${metric}`
}

const formatNumber = (value: number): string => {
  if (!Number.isFinite(value)) return String(value)
  if (Math.abs(value) >= 1000 || (Math.abs(value) > 0 && Math.abs(value) < 0.01)) return value.toExponential(2)
  return value.toFixed(Math.abs(value) >= 10 ? 2 : 4)
}

/** A goal object plus the session it belongs to, for cloud submission. */
export interface SessionHandoff {
  session: AgentSession
  goal: AutopilotGoal
}

export function assertSessionHandoff(value: SessionHandoff): void {
  if (!value.session || value.session.schema !== AGENT_SESSION_SCHEMA) {
    throw new Error('Cannot hand off an invalid agent session.')
  }
  if (!value.goal || typeof value.goal.description !== 'string') {
    throw new Error('A cloud agent job needs a goal with a description.')
  }
}
