/**
 * Administration data access.
 *
 * Local mode has exactly one principal (the device owner), so there is no
 * server-side user directory to invent. Cloud mode reads the `profiles` table
 * created by the admin migration; when that schema is absent or unreachable the
 * console says so instead of rendering a made-up user list.
 */
import { isSupabaseConfigured, supabase } from '../supabase'
import { siemService } from '../siem/siemService'
import type { User } from '../../types'
import {
  ADMIN_ROLES,
  type AdminRole,
  type QuotaLimits,
  readQuotaPolicies,
  setQuotaPolicy,
  validateQuotaLimits,
  writeQuotaPolicies,
} from './quotaPolicy'
import { getUsageEvents, isUsageLedgerPersistent } from './usageLedger'
import { getLastCloudUsageError } from './usageRecorder'

export type MemberStatus = 'active' | 'suspended'

export interface AdminAccess {
  allowed: boolean
  role: AdminRole | 'user'
  status: MemberStatus
  reason?: string
}

export interface AdminMember {
  id: string
  name: string
  email: string
  role: AdminRole | 'user'
  status: MemberStatus
  lastSeenAt?: number
  source: 'local' | 'cloud'
}

export interface CloudUsageSummary {
  total: number
  byKind: Array<{ kind: string; count: number }>
  byUser: Array<{ user: string; count: number }>
  daily: Array<{ date: string; count: number }>
  error?: string
}

export interface AdminEnvironment {
  deployment: 'local' | 'cloud'
  supabaseConfigured: boolean
  agentCloudConfigured: boolean
  storageUsedMb: number | null
  storageQuotaMb: number | null
  ledgerEvents: number
  /** False when the browser refused to persist the ledger. */
  ledgerPersistent: boolean
  /** Last failure to mirror a usage event into `usage_events`, if any. */
  cloudUsageMirrorError: string | null
}

export interface AdminCapabilities {
  managePeople: boolean
  suspendMembers: boolean
  inviteMembers: boolean
  cloudUsageFeed: boolean
  note: string
}

const ADMIN_ROLE_SET = new Set<string>(ADMIN_ROLES)

function normalizeRole(value: unknown): AdminRole | 'user' {
  return typeof value === 'string' && ADMIN_ROLE_SET.has(value) ? (value as AdminRole) : 'user'
}

function normalizeStatus(value: unknown): MemberStatus {
  return value === 'suspended' ? 'suspended' : 'active'
}

export function isAdminRole(role: string | undefined | null): role is 'owner' | 'admin' {
  return role === 'owner' || role === 'admin'
}

/** Offline devices authenticate one local owner; cloud roles come from `profiles`. */
export function resolveLocalRole(user: User | null, offlineMode: boolean): AdminRole | 'user' {
  if (offlineMode) return 'owner'
  return normalizeRole((user as User & { role?: string } | null)?.role)
}

export async function resolveAdminAccess(user: User, offlineMode: boolean): Promise<AdminAccess> {
  if (offlineMode) {
    return { allowed: true, role: 'owner', status: 'active' }
  }
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('role,status')
      .eq('id', user.id)
      .maybeSingle()
    if (error) {
      return {
        allowed: false,
        role: 'user',
        status: 'active',
        reason: `The cloud governance schema is unavailable (${error.message}). Apply the admin migration to enable account management.`,
      }
    }
    if (!data) {
      return {
        allowed: false,
        role: 'user',
        status: 'active',
        reason: 'No governance profile exists for this account yet. An owner must create it in the cloud database.',
      }
    }
    const role = normalizeRole((data as { role?: unknown }).role)
    const status = normalizeStatus((data as { status?: unknown }).status)
    if (status === 'suspended') {
      return { allowed: false, role, status, reason: 'This account is suspended.' }
    }
    if (!isAdminRole(role)) {
      return {
        allowed: false,
        role,
        status,
        reason: 'Administrator access is required. Ask an owner to grant the administrator role.',
      }
    }
    return { allowed: true, role, status }
  } catch (error) {
    return {
      allowed: false,
      role: 'user',
      status: 'active',
      reason: `Could not reach the account directory: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

export async function listMembers(
  actor: User,
  offlineMode: boolean,
): Promise<{ members: AdminMember[]; error?: string }> {
  if (offlineMode) {
    return {
      members: [{
        id: actor.id,
        name: actor.name || 'Local User',
        email: actor.email || 'local@offline',
        role: 'owner',
        status: 'active',
        source: 'local',
      }],
    }
  }
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id,email,display_name,role,status,last_seen_at,created_at')
      .order('created_at', { ascending: true })
      .limit(500)
    if (error) return { members: [], error: error.message }
    const members = (data ?? []).map((row) => {
      const record = row as Record<string, unknown>
      const lastSeen = record.last_seen_at
      return {
        id: String(record.id ?? ''),
        name: String(record.display_name || record.email || 'Unnamed account'),
        email: String(record.email ?? ''),
        role: normalizeRole(record.role),
        status: normalizeStatus(record.status),
        ...(typeof lastSeen === 'string' && Number.isFinite(Date.parse(lastSeen)) ? { lastSeenAt: Date.parse(lastSeen) } : {}),
        source: 'cloud' as const,
      }
    }).filter((member) => member.id.length > 0)
    return { members }
  } catch (error) {
    return { members: [], error: error instanceof Error ? error.message : String(error) }
  }
}

export async function setMemberRole(
  actor: User,
  offlineMode: boolean,
  memberId: string,
  role: AdminRole,
): Promise<{ ok: boolean; error?: string }> {
  if (offlineMode) return { ok: false, error: 'Local mode has one owner; cloud accounts are managed by the cloud directory.' }
  if (!ADMIN_ROLE_SET.has(role)) return { ok: false, error: 'Unknown role.' }
  if (memberId === actor.id && !isAdminRole(role)) {
    return { ok: false, error: 'You cannot remove your own administrator access. Ask another owner to change it.' }
  }
  try {
    const { error } = await supabase.from('profiles').update({ role }).eq('id', memberId)
    if (error) return { ok: false, error: error.message }
    siemService.logAuditEvent({
      user: actor.id,
      action: 'admin:role_change',
      resource: memberId,
      details: { role },
    })
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function setMemberStatus(
  actor: User,
  offlineMode: boolean,
  memberId: string,
  status: MemberStatus,
): Promise<{ ok: boolean; error?: string }> {
  if (offlineMode) return { ok: false, error: 'Local mode has no remote accounts to suspend.' }
  if (memberId === actor.id && status === 'suspended') {
    return { ok: false, error: 'You cannot suspend your own account.' }
  }
  try {
    const { error } = await supabase.from('profiles').update({ status }).eq('id', memberId)
    if (error) return { ok: false, error: error.message }
    siemService.logAuditEvent({
      user: actor.id,
      action: status === 'suspended' ? 'admin:member_suspended' : 'admin:member_restored',
      resource: memberId,
      details: {},
    })
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function savePolicy(
  actor: User,
  offlineMode: boolean,
  role: AdminRole,
  limits: QuotaLimits,
): Promise<{ ok: boolean; error?: string }> {
  const error = validateQuotaLimits(limits)
  if (error) return { ok: false, error }
  const cached = setQuotaPolicy(role, limits)
  if (!cached.ok) return cached

  let cloudError: string | undefined
  if (!offlineMode && isSupabaseConfigured) {
    try {
      const { error: upsertError } = await supabase.from('quota_policies').upsert({
        role,
        max_projects: limits.maxProjects,
        max_exports_per_day: limits.maxExportsPerDay,
        max_simulations_per_day: limits.maxSimulationsPerDay,
        max_storage_mb: limits.maxStorageMb,
        updated_by: actor.id,
        updated_at: new Date().toISOString(),
      })
      if (upsertError) cloudError = upsertError.message
    } catch (thrown) {
      cloudError = thrown instanceof Error ? thrown.message : String(thrown)
    }
  }

  siemService.logAuditEvent({
    user: actor.id,
    action: 'admin:quota_policy',
    resource: role,
    details: { ...limits, cloudSynced: !cloudError && !offlineMode },
  })
  if (cloudError) {
    return { ok: false, error: `Saved on this device, but the cloud policy was not updated: ${cloudError}` }
  }
  return cached
}

function quotaLimit(value: unknown, fallback: number | null): number | null {
  if (value === null) return null
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

/**
 * Hydrate the local policy cache from `quota_policies` so the console shows the
 * server's policy. Returns the error text when the cloud read fails; local mode
 * has nothing to sync and returns null.
 */
export async function syncCloudPolicies(offlineMode: boolean): Promise<string | null> {
  if (offlineMode || !isSupabaseConfigured) return null
  try {
    const { data, error } = await supabase
      .from('quota_policies')
      .select('role,max_projects,max_exports_per_day,max_simulations_per_day,max_storage_mb')
    if (error) return error.message
    const policies = readQuotaPolicies()
    for (const raw of data ?? []) {
      const row = raw as Record<string, unknown>
      if (typeof row.role !== 'string' || !ADMIN_ROLE_SET.has(row.role)) continue
      const role = row.role as AdminRole
      const current = policies[role]
      policies[role] = {
        maxProjects: quotaLimit(row.max_projects, current.maxProjects),
        maxExportsPerDay: quotaLimit(row.max_exports_per_day, current.maxExportsPerDay),
        maxSimulationsPerDay: quotaLimit(row.max_simulations_per_day, current.maxSimulationsPerDay),
        maxStorageMb: quotaLimit(row.max_storage_mb, current.maxStorageMb),
      }
    }
    const written = writeQuotaPolicies(policies)
    return written.ok ? null : written.error ?? 'The local policy cache could not be updated.'
  } catch (thrown) {
    return thrown instanceof Error ? thrown.message : String(thrown)
  }
}

export async function loadCloudUsage(days: number): Promise<CloudUsageSummary> {
  if (!isSupabaseConfigured) {
    return { total: 0, byKind: [], byUser: [], daily: [], error: 'Cloud storage is not configured.' }
  }
  const since = new Date(Date.now() - Math.max(1, days) * 24 * 3600 * 1000).toISOString()
  try {
    const { data, error } = await supabase
      .from('usage_events')
      .select('user_id,kind,created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(10000)
    if (error) return { total: 0, byKind: [], byUser: [], daily: [], error: error.message }
    const byKind = new Map<string, number>()
    const byUser = new Map<string, number>()
    const daily = new Map<string, number>()
    for (let offset = days - 1; offset >= 0; offset -= 1) {
      const date = new Date(Date.now() - offset * 24 * 3600 * 1000)
      daily.set(date.toISOString().slice(0, 10), 0)
    }
    const rows = data ?? []
    for (const row of rows) {
      const record = row as Record<string, unknown>
      const kind = String(record.kind ?? 'unknown')
      const userId = String(record.user_id ?? 'unknown')
      const createdAt = String(record.created_at ?? '')
      byKind.set(kind, (byKind.get(kind) ?? 0) + 1)
      byUser.set(userId, (byUser.get(userId) ?? 0) + 1)
      const day = createdAt.slice(0, 10)
      if (daily.has(day)) daily.set(day, (daily.get(day) ?? 0) + 1)
    }
    return {
      total: rows.length,
      byKind: [...byKind.entries()].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count),
      byUser: [...byUser.entries()].map(([user, count]) => ({ user, count })).sort((a, b) => b.count - a.count),
      daily: [...daily.entries()].map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date)),
    }
  } catch (error) {
    return {
      total: 0,
      byKind: [],
      byUser: [],
      daily: [],
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/** Project count for the signed-in owner: local store, or a cloud head count. */
export async function loadProjectCount(user: User, offlineMode: boolean): Promise<{ count: number; error?: string }> {
  if (offlineMode) {
    const { offlineProjectStore } = await import('../offlineProjectStore')
    return { count: offlineProjectStore.list().filter((project) => project.user_id === user.id).length }
  }
  try {
    const { count, error } = await supabase
      .from('projects')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
    if (error) return { count: 0, error: error.message }
    return { count: count ?? 0 }
  } catch (error) {
    return { count: 0, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function loadEnvironment(): Promise<AdminEnvironment> {
  let storageUsedMb: number | null = null
  let storageQuotaMb: number | null = null
  if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
    try {
      const estimate = await navigator.storage.estimate()
      if (typeof estimate.usage === 'number') storageUsedMb = estimate.usage / (1024 * 1024)
      if (typeof estimate.quota === 'number') storageQuotaMb = estimate.quota / (1024 * 1024)
    } catch {
      // Estimates are optional; the console shows "unavailable" honestly.
    }
  }
  return {
    deployment: isSupabaseConfigured ? 'cloud' : 'local',
    supabaseConfigured: isSupabaseConfigured,
    agentCloudConfigured: Boolean(import.meta.env.VITE_AGENT_CLOUD_URL),
    storageUsedMb,
    storageQuotaMb,
    ledgerEvents: getUsageEvents().length,
    ledgerPersistent: isUsageLedgerPersistent(),
    cloudUsageMirrorError: getLastCloudUsageError(),
  }
}

export function capabilities(offlineMode: boolean): AdminCapabilities {
  return {
    managePeople: !offlineMode,
    suspendMembers: !offlineMode,
    inviteMembers: false,
    cloudUsageFeed: !offlineMode,
    note: offlineMode
      ? 'This device has a single local owner. People, invitations and cross-device usage require the cloud deployment; everything on this page still works locally.'
      : 'People and usage come from the cloud governance schema. Invitations require a server-side admin function and are intentionally not faked in the browser.',
  }
}

export function recordAdminOpen(user: User): void {
  siemService.logAuditEvent({ user: user.id, action: 'admin:open', resource: 'administration', details: {} })
}
