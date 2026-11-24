/**
 * Pure data helpers for the user console.
 *
 * Everything shown here is measured on this device from the stores the
 * workbench actually writes — the usage ledger, the quota policy and raw
 * localStorage bytes. Nothing is estimated, nothing is invented, and anything
 * that cannot be measured says so instead of showing a number.
 */
import { getUsageEvents, summarizeUsage, usageSince, type UsageKind, type UsageSummary } from '../lib/admin/usageLedger'
import {
  resolveQuotaRole,
  subjectLimits,
  type QuotaSubject,
} from '../lib/admin/quotaPolicy'
import { PRICING_TIER_NAME } from '../lib/pricing'
import { isSupabaseConfigured } from '../lib/supabase'
import { toCsv } from '../lib/csv'
import type { User } from '../types'

export interface StorageEntry {
  key: string
  bytes: number
  /** Human-friendly name for the keys this app writes; the raw key for the rest. */
  label: string
}

export interface StorageSnapshot {
  totalBytes: number
  entries: StorageEntry[]
}

const KEY_LABELS: Readonly<Record<string, string>> = {
  'circuit-cad-app-store': 'Workspace state (theme, density, shortcuts)',
  'folio.usage.v1': 'Usage ledger',
  'folio.vcs.v1': 'Design history (VCS)',
  'folio.quotas.v1': 'Quota policy cache',
  'folio.local-profile': 'Local profiles',
  'folio.backups': 'Project backups',
  'folio.notifications.v1': 'In-app notifications (bell)',
  'folio.offlineProjects': 'Designs stored on this device',
  'folio.agentJobs': 'Agent job queue',
  'folio.agentSessions': 'Agent sessions',
  'folio.collabProjects.v1': 'Collaboration state',
  'folio.shortcuts.v1': 'Keyboard shortcut overrides',
  'folio.onboarding.step': 'Onboarding progress',
  'folio.onboarding.completed.v2': 'Onboarding record',
}

/** Approximate bytes for one key/value pair, UTF-16 — two bytes per code unit. */
function entryBytes(key: string, value: string): number {
  return (key.length + value.length) * 2
}

/**
 * Byte-for-byte accounting of this device's Folio storage. Lists every key,
 * not a whitelist: a number that hides keys is not a storage meter.
 */
export function storageSnapshot(
  storage: Pick<Storage, 'length' | 'key' | 'getItem'> = window.localStorage,
): StorageSnapshot {
  const entries: StorageEntry[] = []
  let totalBytes = 0
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (key === null) continue
    const value = storage.getItem(key) ?? ''
    const bytes = entryBytes(key, value)
    totalBytes += bytes
    entries.push({ key, bytes, label: KEY_LABELS[key] ?? key })
  }
  entries.sort((a, b) => b.bytes - a.bytes || a.key.localeCompare(b.key))
  return { totalBytes, entries }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`
  return `${(mb / 1024).toFixed(1)} GB`
}

export interface ConsolePlan {
  /** Stable id the UI keys copy off. */
  id: 'local' | 'cloud-viewer' | 'cloud-engineer' | 'cloud-admin' | 'cloud-owner'
  label: string
  detail: string
  role: QuotaSubject
  limits: ReturnType<typeof subjectLimits>
}

/**
 * What this account is, honestly. A standalone device is its own owner on this
 * device. A cloud account's role comes from its governance row; an unassigned
 * account is a viewer until an administrator assigns one — say so, don't hide it.
 */
export function resolvePlan(user: User | null, offlineMode: boolean): ConsolePlan {
  if (offlineMode || !isSupabaseConfigured) {
    return {
      id: 'local',
      label: `${PRICING_TIER_NAME.free} — this device`,
      detail: 'No subscription, no invoice, nothing to manage. The free tier is the standalone build: free and unlimited on this device, with no billing to ship to you.',
      role: 'owner',
      limits: subjectLimits('owner'),
    }
  }
  const role = resolveQuotaRole(user, false)
  switch (role) {
    case 'owner':
      return { id: 'cloud-owner', label: 'Owner', detail: 'Full control over this deployment, including administration and billing.', role, limits: subjectLimits(role) }
    case 'admin':
      return { id: 'cloud-admin', label: 'Administrator', detail: 'Manages people, policies and usage for this deployment.', role, limits: subjectLimits(role) }
    case 'engineer':
      return { id: 'cloud-engineer', label: 'Engineer', detail: 'Creates and edits designs under the engineering quotas below.', role, limits: subjectLimits(role) }
    case 'user':
    case 'viewer':
      return { id: 'cloud-viewer', label: role === 'user' ? 'Unassigned — viewer quotas' : 'Viewer', detail: 'A read-only role. Ask an administrator of this deployment to assign you a role.', role, limits: subjectLimits(role) }
  }
}

export interface UsageRollup {
  windowDays: number
  summary: UsageSummary
  /** The three kinds people actually ask about, pinned. */
  highlights: Array<{ kind: UsageKind; count: number }>
  totalEvents: number
}

export function usageRollup(windowDays = 30, offlineUserId?: string): UsageRollup {
  const events = getUsageEvents()
  const summary = summarizeUsage(events, windowDays)
  const scoped = usageSince(windowDays)
  const count = (kind: UsageKind): number =>
    scoped.filter((event) => event.kind === kind && (!offlineUserId || event.user === offlineUserId)).length
  return {
    windowDays,
    summary,
    highlights: [
      { kind: 'agent.run', count: count('agent.run') },
      { kind: 'simulation.run', count: count('simulation.run') },
      { kind: 'template.fork', count: count('template.fork') },
    ],
    totalEvents: summary.total,
  }
}

/**
 * One downloadable JSON copy of everything this device holds under the keys
 * this app writes — `folio.*` plus the workbench's own store key. Auth
 * material is deliberately excluded: the Supabase session for the workbench
 * (`sb-*-auth-token`) and the operator console's session (`folio.operator.session`)
 * are credentials, not user data, and a "download my data" file must never
 * carry them.
 */
const EXPORTABLE_PREFIXES = ['folio.'] as const
const EXPORTABLE_EXACT = new Set(['circuit-cad-app-store'])
const EXPORT_DENYLIST = new Set(['folio.operator.session'])

export function exportLocalData(storage: Pick<Storage, 'length' | 'key' | 'getItem'> = window.localStorage): { filename: string; json: string } {
  const dump: Record<string, string> = {}
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (key === null) continue
    if (EXPORT_DENYLIST.has(key)) continue
    const exportable = EXPORTABLE_EXACT.has(key) || EXPORTABLE_PREFIXES.some((prefix) => key.startsWith(prefix))
    if (!exportable) continue
    dump[key] = storage.getItem(key) ?? ''
  }
  return {
    filename: `folio-local-data-${new Date().toISOString().slice(0, 10)}.json`,
    json: JSON.stringify({
      exportedAt: new Date().toISOString(),
      note: 'Folio keys held by this device. Sign-in credentials are not included.',
      keys: dump,
    }, null, 2),
  }
}

export const USAGE_KIND_LABEL: Record<UsageKind, string> = {
  'workspace.open': 'Workspace opens',
  'demo.load': 'Demo loads',
  'project.create': 'Projects created',
  'project.open': 'Projects opened',
  'vcs.commit': 'History commits',
  'export.run': 'Exports',
  'simulation.run': 'Simulations',
  'agent.run': 'Agent runs',
  'onboarding.complete': 'Onboarding completed',
  'onboarding.exit': 'Onboarding exited',
  'admin.open': 'Admin console visits',
  'template.fork': 'Community designs made theirs',
}

/** Relative time, no fake precision: "just now", "12m ago", "3 days ago". */
export function relativeTime(at: number, now = Date.now()): string {
  const elapsed = Math.max(0, now - at)
  const minutes = Math.floor(elapsed / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/** The newest events, capped — what the Overview "recent activity" list shows. */
export function recentActivity(limit = 8, offlineUserId?: string): Array<{ event: ReturnType<typeof getUsageEvents>[number] }> {
  const events = getUsageEvents()
  const scoped = offlineUserId ? events.filter((event) => event.user === offlineUserId || event.user === 'offline-local') : events
  return scoped.slice(-limit).reverse().map((event) => ({ event }))
}

/** CSV of the ledger window, one line per day with per-kind totals. */
export function usageCsv(windowDays: number): { filename: string; csv: string } {
  const since = Date.now() - windowDays * 24 * 60 * 60 * 1000
  const scoped = getUsageEvents().filter((event) => event.at >= since)
  const byDay = new Map<string, Map<UsageKind, number>>()
  for (const event of scoped) {
    const date = new Date(event.at).toISOString().slice(0, 10)
    const kinds = byDay.get(date) ?? new Map<UsageKind, number>()
    kinds.set(event.kind, (kinds.get(event.kind) ?? 0) + 1)
    byDay.set(date, kinds)
  }
  const kinds = [...new Set(scoped.map((event) => event.kind))].sort()
  const header = ['date', 'total', ...kinds]
  const rows = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, kindsMap]) => {
      const total = [...kindsMap.values()].reduce((sum, count) => sum + count, 0)
      return [date, String(total), ...kinds.map((kind) => String(kindsMap.get(kind) ?? 0))]
    })
  const csv = toCsv(header, rows)
  return {
    filename: `folio-usage-${windowDays}d-${new Date().toISOString().slice(0, 10)}.csv`,
    csv,
  }
}

