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
import { isSupabaseConfigured } from '../lib/supabase'
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
      label: 'Local — this device',
      detail: 'No subscription, no invoice, nothing to manage. Billing has not shipped yet; when it does, this page is where your plan will live.',
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

/** One downloadable JSON copy of everything this device holds under `folio.*` and the app store key. */
export function exportLocalData(storage: Pick<Storage, 'length' | 'key' | 'getItem'> = window.localStorage): { filename: string; json: string } {
  const dump: Record<string, string> = {}
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (key === null) continue
    dump[key] = storage.getItem(key) ?? ''
  }
  return {
    filename: `folio-local-data-${new Date().toISOString().slice(0, 10)}.json`,
    json: JSON.stringify({ exportedAt: new Date().toISOString(), keys: dump }, null, 2),
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
