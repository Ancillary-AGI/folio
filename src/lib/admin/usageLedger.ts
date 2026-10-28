/**
 * Device-local usage ledger for the administration console.
 *
 * The ledger is deliberately small and boring: append-only events, a hard cap,
 * and aggregation that is deterministic for a given clock. It records what the
 * workbench actually did on this device (workspace opens, demos, projects,
 * commits, exports). It is not an analytics pipeline and never leaves the
 * browser; cloud-wide usage lives in `usage_events` (see the admin migration).
 */

export const USAGE_STORAGE_KEY = 'folio.usage.v1'
export const USAGE_EVENT_CAP = 5000

export type UsageKind =
  | 'workspace.open'
  | 'demo.load'
  | 'project.create'
  | 'project.open'
  | 'vcs.commit'
  | 'export.run'
  | 'simulation.run'
  | 'agent.run'
  /** The engineer reached the last step and finished or took the hand-off. */
  | 'onboarding.complete'
  /** The guide was closed or skipped before the last step. */
  | 'onboarding.exit'
  | 'admin.open'

export interface UsageEvent {
  id: string
  at: number
  user: string
  kind: UsageKind
  detail?: Record<string, string | number | boolean>
}

export interface UsageSummary {
  total: number
  byKind: Array<{ kind: UsageKind; count: number }>
  byMode: Array<{ mode: string; count: number }>
  byUser: Array<{ user: string; count: number }>
  daily: Array<{ date: string; count: number }>
}

let sequence = 0
let cache: UsageEvent[] = []
let cacheLoaded = false
let persistenceFailed = false
const listeners = new Set<() => void>()

function isUsageEvent(value: unknown): value is UsageEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Partial<UsageEvent>
  return (
    typeof event.id === 'string' &&
    typeof event.at === 'number' && Number.isFinite(event.at) &&
    typeof event.user === 'string' &&
    typeof event.kind === 'string'
  )
}

function read(): UsageEvent[] {
  if (cacheLoaded) return cache
  cacheLoaded = true
  if (typeof localStorage === 'undefined') return cache
  let raw: string | null
  try {
    raw = localStorage.getItem(USAGE_STORAGE_KEY)
  } catch {
    // A store that refuses reads is not durable, even if writes have not run yet.
    persistenceFailed = true
    return cache
  }
  try {
    const parsed: unknown = JSON.parse(raw ?? '[]')
    cache = Array.isArray(parsed) ? parsed.filter(isUsageEvent).slice(-USAGE_EVENT_CAP) : []
  } catch {
    // Corrupt JSON is discarded, not a storage failure: the next append rewrites it.
    cache = []
  }
  return cache
}

function persist(events: UsageEvent[]): void {
  if (typeof localStorage === 'undefined') {
    persistenceFailed = true
    return
  }
  try {
    localStorage.setItem(USAGE_STORAGE_KEY, JSON.stringify(events))
    persistenceFailed = false
  } catch {
    // Storage can be full or blocked. The in-memory ledger stays usable for
    // this session; `isUsageLedgerPersistent()` lets the admin console say so.
    persistenceFailed = true
  }
}

function notify(): void {
  for (const listener of listeners) listener()
}

function sameDetail(
  left: UsageEvent['detail'],
  right: UsageEvent['detail'],
): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null)
}

/** Append an event. Consecutive duplicates inside 3 s are collapsed. */
export function recordUsage(
  kind: UsageKind,
  user: string,
  detail?: UsageEvent['detail'],
  now = Date.now(),
): UsageEvent | null {
  if (!user) return null
  const events = read()
  const last = events[events.length - 1]
  // Only a forward-in-time duplicate is collapsed. A backdated event (clock
  // correction, restored session) must still be recorded.
  if (last && last.kind === kind && last.user === user && now >= last.at && now - last.at < 3000 && sameDetail(last.detail, detail)) {
    return last
  }
  sequence += 1
  const event: UsageEvent = {
    id: `use_${now.toString(36)}_${sequence.toString(36)}`,
    at: now,
    user,
    kind,
    ...(detail ? { detail } : {}),
  }
  cache = [...events, event].slice(-USAGE_EVENT_CAP)
  persist(cache)
  notify()
  return event
}

export function getUsageEvents(): readonly UsageEvent[] {
  return read()
}

/**
 * True when the ledger is being written to durable browser storage. A blocked
 * or full store leaves the in-memory ledger usable for this session only, and
 * the administration console labels that state instead of implying durability.
 */
export function isUsageLedgerPersistent(): boolean {
  return typeof localStorage !== 'undefined' && !persistenceFailed
}

export function subscribeUsage(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Tests and the admin reset action; production code never calls this silently. */
export function resetUsageLedger(): void {
  cache = []
  cacheLoaded = true
  sequence = 0
  if (typeof localStorage === 'undefined') {
    persistenceFailed = true
  } else {
    try {
      localStorage.removeItem(USAGE_STORAGE_KEY)
      persistenceFailed = false
    } catch {
      persistenceFailed = true
    }
  }
  notify()
}

export function usageSince(days: number, now = Date.now()): UsageEvent[] {
  const bounded = Math.max(1, Math.floor(days))
  const start = now - bounded * 24 * 3600 * 1000
  return read().filter((event) => event.at >= start)
}

/** Local calendar day key (`YYYY-MM-DD`), so daily buckets match the user's clock. */
export function usageDayKey(timestamp: number): string {
  const date = new Date(timestamp)
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function summarizeUsage(events: readonly UsageEvent[], days: number, now = Date.now()): UsageSummary {
  const bounded = Math.max(1, Math.floor(days))
  const start = now - bounded * 24 * 3600 * 1000
  const scoped = events.filter((event) => event.at >= start)

  const kindCounts = new Map<UsageKind, number>()
  const modeCounts = new Map<string, number>()
  const userCounts = new Map<string, number>()
  const dailyCounts = new Map<string, number>()

  for (let offset = bounded - 1; offset >= 0; offset -= 1) {
    dailyCounts.set(usageDayKey(now - offset * 24 * 3600 * 1000), 0)
  }

  for (const event of scoped) {
    kindCounts.set(event.kind, (kindCounts.get(event.kind) ?? 0) + 1)
    const mode = event.detail?.mode
    if (typeof mode === 'string') modeCounts.set(mode, (modeCounts.get(mode) ?? 0) + 1)
    userCounts.set(event.user, (userCounts.get(event.user) ?? 0) + 1)
    const day = usageDayKey(event.at)
    dailyCounts.set(day, (dailyCounts.get(day) ?? 0) + 1)
  }

  return {
    total: scoped.length,
    byKind: [...kindCounts.entries()]
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind)),
    byMode: [...modeCounts.entries()]
      .map(([mode, count]) => ({ mode, count }))
      .sort((a, b) => b.count - a.count || a.mode.localeCompare(b.mode)),
    byUser: [...userCounts.entries()]
      .map(([user, count]) => ({ user, count }))
      .sort((a, b) => b.count - a.count || a.user.localeCompare(b.user)),
    daily: [...dailyCounts.entries()]
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  }
}

export function countUsage(
  kind: UsageKind,
  since: number,
  user?: string,
): number {
  return read().filter((event) => event.kind === kind && event.at >= since && (!user || event.user === user)).length
}
