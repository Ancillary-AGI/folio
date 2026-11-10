/**
 * Refresh the workbench's quota cache from the deployment.
 *
 * Operators set policy in the admin console; the workbench enforces a local
 * pre-check so it can refuse an action before spending the designer's time on
 * it. Without this read the pre-check would keep using the shipped defaults
 * while the server enforced something else. The server remains authoritative:
 * a failed read leaves the cache alone and reports why.
 */
import { isSupabaseConfigured, supabase } from '../supabase'
import {
  ADMIN_ROLES, readQuotaPolicies, writeQuotaPolicies,
  type AdminRole, type QuotaLimits, type QuotaSubject,
} from './quotaPolicy'

const ROLE_SET = new Set<string>(ADMIN_ROLES)

function limit(value: unknown, fallback: number | null): number | null {
  if (value === null) return null
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

/** Returns the error text when the read failed, or null when the cache is current. */
export async function syncQuotaPoliciesFromCloud(): Promise<string | null> {
  if (!isSupabaseConfigured) return null
  try {
    const { data, error } = await supabase
      .from('quota_policies')
      .select('role,max_projects,max_exports_per_day,max_simulations_per_day,max_storage_mb')
    if (error) return error.message
    const policies = readQuotaPolicies()
    for (const raw of data ?? []) {
      const row = raw as Record<string, unknown>
      if (typeof row.role !== 'string' || !ROLE_SET.has(row.role)) continue
      const role = row.role as AdminRole
      const current: QuotaLimits = policies[role]
      policies[role] = {
        maxProjects: limit(row.max_projects, current.maxProjects),
        maxExportsPerDay: limit(row.max_exports_per_day, current.maxExportsPerDay),
        maxSimulationsPerDay: limit(row.max_simulations_per_day, current.maxSimulationsPerDay),
        maxStorageMb: limit(row.max_storage_mb, current.maxStorageMb),
      }
    }
    const written = writeQuotaPolicies(policies)
    return written.ok ? null : written.error ?? 'The local policy cache could not be updated.'
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/**
 * The signed-in account's own governance role, for the local pre-check only.
 *
 * A session token carries no role, so without this read every cloud account
 * would be pre-checked against the viewer policy. An unreadable profile fails
 * closed to `user` (the tightest policy) — the server still decides what the
 * account may actually do.
 */
export async function readOwnGovernanceRole(userId: string): Promise<QuotaSubject> {
  if (!isSupabaseConfigured || !userId) return 'user'
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('role,status')
      .eq('id', userId)
      .maybeSingle()
    if (error || !data) return 'user'
    const row = data as Record<string, unknown>
    if (row.status === 'suspended') return 'viewer'
    const role = row.role
    return typeof role === 'string' && (ROLE_SET.has(role)) ? (role as AdminRole) : 'user'
  } catch {
    return 'user'
  }
}