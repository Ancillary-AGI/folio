/**
 * In-app notifications for the workbench.
 *
 * Every notification in this list was raised by something that actually
 * happened on this device: an agent job reached a terminal state, an export
 * finished, a community design opened for preview. Nothing here is scheduled,
 * synthesised or faked, and a notification that cannot be verified against a
 * real action is not emitted. The store is device-local, append-only-ish,
 * capped, and persisted under `folio.notifications.v1`; it is not synced to a
 * deployment, so two machines do not see each other's feed.
 *
 * Producers call `notifyNotification`. The bell reads via `useNotifications`.
 * Everything is deterministic for tests that need to control the clock.
 */

export const NOTIFICATIONS_STORAGE_KEY = 'folio.notifications.v1'
export const NOTIFICATION_CAP = 50

export const NOTIFICATION_KINDS = ['agent', 'export', 'community', 'checkpoint'] as const
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]

export interface AppNotification {
  id: string
  kind: NotificationKind
  title: string
  detail?: string
  at: number
  /** Set once the user has read (or dismissed) the entry. */
  readAt?: number
}

let sequence = 0
let cache: AppNotification[] | null = null
let newestFirst: AppNotification[] = []
let persistenceFailed = false
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

function isAppNotification(value: unknown): value is AppNotification {
  if (!value || typeof value !== 'object') return false
  const value_ = value as Partial<AppNotification>
  return (
    typeof value_.id === 'string' &&
    typeof value_.at === 'number' && Number.isFinite(value_.at) &&
    typeof value_.title === 'string' && value_.title.length > 0 &&
    typeof value_.kind === 'string' &&
    (NOTIFICATION_KINDS as readonly string[]).includes(value_.kind)
  )
}

function randomSuffix(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi?.getRandomValues) {
    const bytes = new Uint8Array(8)
    cryptoApi.getRandomValues(bytes)
    return `${Array.from(bytes, (byte) => byte.toString(36).padStart(2, '0')).join('')}`.slice(0, 12)
  }
  // No crypto API: the id is still unique per session, just not unguessable.
  sequence += 1
  return `${Date.now().toString(36)}${sequence.toString(36)}`
}

function refreshSnapshot(): void {
  // One cached, newest-first array. `useSyncExternalStore` requires a stable
  // reference between calls, so this is recomputed only on mutation.
  newestFirst = cache === null ? [] : [...cache].reverse()
}

function read(): AppNotification[] {
  if (cache !== null) return cache
  if (typeof localStorage === 'undefined') {
    cache = []
    refreshSnapshot()
    return cache
  }
  let raw: string | null
  try {
    raw = localStorage.getItem(NOTIFICATIONS_STORAGE_KEY)
  } catch {
    persistenceFailed = true
    cache = []
    refreshSnapshot()
    return cache
  }
  try {
    const parsed: unknown = JSON.parse(raw ?? '[]')
    cache = Array.isArray(parsed) ? parsed.filter(isAppNotification).slice(-NOTIFICATION_CAP) : []
  } catch {
    // Corrupt JSON is discarded, not a storage failure: the next write rewrites it.
    cache = []
  }
  refreshSnapshot()
  return cache
}

function persist(items: AppNotification[]): void {
  if (typeof localStorage === 'undefined') {
    persistenceFailed = true
    return
  }
  try {
    localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(items))
    persistenceFailed = false
  } catch {
    // The feed keeps working in memory; `isNotificationStorePersistent` can say so.
    persistenceFailed = true
  }
}

/** Subscribe to feed changes. Returns the unsubscribe. */
export function subscribeNotifications(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Newest first, reference-stable between mutations. */
export function getNotifications(): AppNotification[] {
  read()
  return newestFirst
}

export function unreadNotificationCount(): number {
  return read().reduce((count, item) => (item.readAt ? count : count + 1), 0)
}

/** True when persistence last failed (private mode, quota exhausted). */
export function isNotificationStorePersistent(): boolean {
  return !persistenceFailed
}

export interface NotifyInput {
  kind: NotificationKind
  /** A sentence that stands alone, e.g. "Agent finished: router escape route". */
  title: string
  /** The evidence: counts, file names, reasons. */
  detail?: string
}

/**
 * Raise a notification. Consecutive identical notifications within 3 s are
 * collapsed (double-click races, React StrictMode double effects).
 */
export function notifyNotification(input: NotifyInput, now = Date.now()): AppNotification | null {
  const title = input.title.trim()
  if (!title) return null
  const items = read()
  const last = items[items.length - 1]
  if (last && last.kind === input.kind && last.title === title && (last.detail ?? '') === (input.detail ?? '') && now - last.at < 3000) {
    return last
  }
  const notification: AppNotification = {
    id: `n-${randomSuffix()}`,
    kind: input.kind,
    title,
    at: now,
    ...(input.detail ? { detail: input.detail } : {}),
  }
  cache = [...items, notification].slice(-NOTIFICATION_CAP)
  refreshSnapshot()
  persist(cache)
  notify()
  return notification
}

export function markNotificationRead(id: string, now = Date.now()): void {
  const items = read()
  let changed = false
  cache = items.map((item) => {
    if (item.id !== id || item.readAt) return item
    changed = true
    return { ...item, readAt: now }
  })
  if (changed) {
    if (cache) {
      refreshSnapshot()
      persist(cache)
    }
    notify()
  }
}

export function markAllNotificationsRead(now = Date.now()): void {
  const items = read()
  if (items.every((item) => item.readAt)) return
  cache = items.map((item) => (item.readAt ? item : { ...item, readAt: now }))
  refreshSnapshot()
  persist(cache)
  notify()
}

/** Remove one notification permanently. */
export function dismissNotification(id: string): void {
  const items = read()
  const next = items.filter((item) => item.id !== id)
  if (next.length === items.length) return
  cache = next
  refreshSnapshot()
  persist(cache)
  notify()
}

/** Remove every notification. The bell shows the honest empty state after this. */
export function clearAllNotifications(): void {
  if (read().length === 0) return
  cache = []
  refreshSnapshot()
  persist(cache)
  notify()
}

/** Reset the store to empty. Intended for tests; the app clears via clearAllNotifications. */
export function resetNotifications(): void {
  cache = []
  newestFirst = []
  persistenceFailed = false
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(NOTIFICATIONS_STORAGE_KEY)
    } catch {
      /* ignore */
    }
  }
  notify()
}

/** Relative time label that stays honest: "just now", "4m ago", "yesterday". */
export function formatNotificationTime(at: number, now = Date.now()): string {
  const elapsed = Math.max(0, now - at)
  const minutes = Math.floor(elapsed / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
