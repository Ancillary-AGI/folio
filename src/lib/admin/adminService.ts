/**
 * Deployment data for the operator console.
 *
 * Every read here goes to the managed deployment through the console's own
 * client, and every table is restricted to operators by row-level security —
 * so a refused client is refused by the database, not just by this screen.
 * There is no local mode: a browser with no deployment behind it has no
 * accounts to manage, and inventing a directory for it would be a lie.
 *
 * Writes are audited in `admin_audit` as part of the same call. If the audit
 * append fails after a mutation succeeded, the result says so rather than
 * reporting a clean change that left no record.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { cloudConfig } from '../cloudConfig'
import {
  ADMIN_ROLES, DEFAULT_QUOTA_POLICIES, isAdminRole, validateQuotaLimits,
  type AdminRole, type QuotaLimits,
} from './quotaPolicy'
import type { Operator } from './operatorSession'
import { USAGE_KINDS, type UsageEvent, type UsageKind } from './usageLedger'

export type AccountStatus = 'active' | 'suspended'

export interface Account {
  id: string
  name: string
  email: string
  role: AdminRole | 'user'
  status: AccountStatus
  lastSeenAt?: number
  createdAt?: number
}

export interface AuditEntry {
  id: string
  at: number
  actor: string
  action: string
  resource: string
  details: Record<string, unknown>
}

export interface DeploymentStats {
  projects: number
  projectsByRole: Record<string, number>
  accounts: number
  activeAccounts: number
  suspendedAccounts: number
  operatorAccounts: number
  usageEvents: number
  auditEvents: number
  exportsToday: number
  simulationsToday: number
}

export interface DeploymentInfo {
  host: string
  agentRunnerConfigured: boolean
  stats: DeploymentStats | null
  /** Why the aggregate read failed, when it did. */
  statsError?: string
}

export interface MutationResult {
  ok: boolean
  error?: string
  /** The change landed but its audit row did not. */
  warning?: string
}

/** The deployment keeps the newest rows; a window larger than this is stated, not implied. */
export const USAGE_ROW_LIMIT = 10000

const ROLE_SET = new Set<string>(ADMIN_ROLES)
const KIND_SET = new Set<string>(USAGE_KINDS)

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function normalizeRole(value: unknown): AdminRole | 'user' {
  return typeof value === 'string' && ROLE_SET.has(value) ? (value as AdminRole) : 'user'
}

function normalizeStatus(value: unknown): AccountStatus {
  return value === 'suspended' ? 'suspended' : 'active'
}

function timestamp(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

export interface FaqEntry {
  id: string
  question: string
  answer: string
  position: number
  published: boolean
  updatedAt: number
}

export interface AdminApi {
  listAccounts(): Promise<{ accounts: Account[]; error?: string }>
  setRole(accountId: string, role: AdminRole): Promise<MutationResult>
  setStatus(accountId: string, status: AccountStatus): Promise<MutationResult>
  loadUsage(days: number): Promise<{ events: UsageEvent[]; truncated: boolean; error?: string }>
  loadPolicies(): Promise<{ policies: Record<AdminRole, QuotaLimits>; error?: string }>
  savePolicy(role: AdminRole, limits: QuotaLimits): Promise<MutationResult>
  loadAudit(limit?: number): Promise<{ entries: AuditEntry[]; error?: string }>
  loadDeployment(): Promise<DeploymentInfo>
  recordOpen(): Promise<void>
  listFaq(): Promise<{ entries: FaqEntry[]; error?: string }>
  saveFaq(entry: Omit<FaqEntry, 'id' | 'updatedAt'> & { id?: string }): Promise<MutationResult>
  deleteFaq(id: string): Promise<MutationResult>
}

export function createAdminApi(db: SupabaseClient, operator: Operator): AdminApi {
  /** Append one operator action. Returns the failure text, or null when recorded. */
  const audit = async (
    action: string,
    resource: string,
    details: Record<string, unknown> = {},
  ): Promise<string | null> => {
    try {
      const { error } = await db.from('admin_audit').insert({
        actor_id: operator.id,
        action,
        resource,
        details,
      })
      return error ? error.message : null
    } catch (error) {
      return describe(error)
    }
  }

  const audited = (warning: string | null, action: string): MutationResult =>
    warning === null
      ? { ok: true }
      : { ok: true, warning: `The ${action} was saved, but the audit trail did not accept the row: ${warning}` }

  return {
    async listAccounts() {
      try {
        const { data, error } = await db
          .from('profiles')
          .select('id,email,display_name,role,status,last_seen_at,created_at')
          .order('created_at', { ascending: true })
          .limit(500)
        if (error) return { accounts: [], error: error.message }
        const accounts = (data ?? []).map((raw) => {
          const row = raw as Record<string, unknown>
          const lastSeenAt = timestamp(row.last_seen_at)
          const createdAt = timestamp(row.created_at)
          return {
            id: String(row.id ?? ''),
            name: String(row.display_name || row.email || 'Unnamed account'),
            email: String(row.email ?? ''),
            role: normalizeRole(row.role),
            status: normalizeStatus(row.status),
            ...(lastSeenAt === undefined ? {} : { lastSeenAt }),
            ...(createdAt === undefined ? {} : { createdAt }),
          }
        }).filter((account) => account.id.length > 0)
        return { accounts }
      } catch (error) {
        return { accounts: [], error: describe(error) }
      }
    },

    async setRole(accountId, role) {
      if (!ROLE_SET.has(role)) return { ok: false, error: 'Unknown role.' }
      if (accountId === operator.id && !isAdminRole(role)) {
        return { ok: false, error: 'You cannot remove your own operator access. Ask another owner to change it.' }
      }
      try {
        const { error } = await db.from('profiles').update({ role }).eq('id', accountId)
        if (error) return { ok: false, error: error.message }
        return audited(await audit('admin:role_change', accountId, { role }), 'role change')
      } catch (error) {
        return { ok: false, error: describe(error) }
      }
    },

    async setStatus(accountId, status) {
      if (accountId === operator.id && status === 'suspended') {
        return { ok: false, error: 'You cannot suspend the account you are operating with.' }
      }
      try {
        const { error } = await db.from('profiles').update({ status }).eq('id', accountId)
        if (error) return { ok: false, error: error.message }
        return audited(
          await audit(status === 'suspended' ? 'admin:account_suspended' : 'admin:account_restored', accountId, {}),
          'status change',
        )
      } catch (error) {
        return { ok: false, error: describe(error) }
      }
    },

    async loadUsage(days) {
      const window = Math.max(1, Math.floor(days))
      const since = new Date(Date.now() - window * 24 * 3600 * 1000).toISOString()
      try {
        const { data, error } = await db
          .from('usage_events')
          .select('id,user_id,kind,detail,created_at')
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(USAGE_ROW_LIMIT)
        if (error) return { events: [], truncated: false, error: error.message }
        const rows = data ?? []
        const events: UsageEvent[] = []
        for (const raw of rows) {
          const row = raw as Record<string, unknown>
          const at = timestamp(row.created_at)
          const kind = String(row.kind ?? '')
          if (at === undefined || !KIND_SET.has(kind)) continue
          const detail = row.detail
          events.push({
            id: String(row.id ?? `${row.user_id}-${at}`),
            at,
            user: String(row.user_id ?? ''),
            kind: kind as UsageKind,
            ...(detail && typeof detail === 'object' && !Array.isArray(detail)
              ? { detail: detail as UsageEvent['detail'] }
              : {}),
          })
        }
        return { events, truncated: rows.length >= USAGE_ROW_LIMIT }
      } catch (error) {
        return { events: [], truncated: false, error: describe(error) }
      }
    },

    async loadPolicies() {
      const policies = {} as Record<AdminRole, QuotaLimits>
      for (const role of ADMIN_ROLES) policies[role] = { ...DEFAULT_QUOTA_POLICIES[role] }
      try {
        const { data, error } = await db
          .from('quota_policies')
          .select('role,max_projects,max_exports_per_day,max_simulations_per_day,max_storage_mb')
        if (error) return { policies, error: error.message }
        for (const raw of data ?? []) {
          const row = raw as Record<string, unknown>
          if (typeof row.role !== 'string' || !ROLE_SET.has(row.role)) continue
          const role = row.role as AdminRole
          const fallback = policies[role]
          // `max_storage_mb` is a numeric column, so it can arrive as a string.
          const pick = (value: unknown, replacement: number | null): number | null => {
            if (value === null) return null
            const numeric = typeof value === 'number' ? value : Number(value)
            return Number.isFinite(numeric) && numeric >= 0 ? numeric : replacement
          }
          policies[role] = {
            maxProjects: pick(row.max_projects, fallback.maxProjects),
            maxExportsPerDay: pick(row.max_exports_per_day, fallback.maxExportsPerDay),
            maxSimulationsPerDay: pick(row.max_simulations_per_day, fallback.maxSimulationsPerDay),
            maxStorageMb: pick(row.max_storage_mb, fallback.maxStorageMb),
          }
        }
        return { policies }
      } catch (error) {
        return { policies, error: describe(error) }
      }
    },

    async savePolicy(role, limits) {
      if (role === 'owner' || role === 'admin') {
        return { ok: false, error: 'Owner and administrator limits are fixed at unlimited.' }
      }
      const invalid = validateQuotaLimits(limits)
      if (invalid) return { ok: false, error: invalid }
      try {
        const { error } = await db.from('quota_policies').upsert({
          role,
          max_projects: limits.maxProjects,
          max_exports_per_day: limits.maxExportsPerDay,
          max_simulations_per_day: limits.maxSimulationsPerDay,
          max_storage_mb: limits.maxStorageMb,
          updated_by: operator.id,
          updated_at: new Date().toISOString(),
        })
        if (error) return { ok: false, error: error.message }
        return audited(await audit('admin:quota_policy', role, { ...limits }), 'policy')
      } catch (error) {
        return { ok: false, error: describe(error) }
      }
    },

    async loadAudit(limit = 200) {
      try {
        const { data, error } = await db
          .from('admin_audit')
          .select('id,actor_id,action,resource,details,created_at')
          .order('created_at', { ascending: false })
          .limit(Math.max(1, Math.floor(limit)))
        if (error) return { entries: [], error: error.message }
        const entries = (data ?? []).map((raw) => {
          const row = raw as Record<string, unknown>
          const details = row.details
          return {
            id: String(row.id ?? ''),
            at: timestamp(row.created_at) ?? 0,
            actor: String(row.actor_id ?? ''),
            action: String(row.action ?? ''),
            resource: String(row.resource ?? ''),
            details: details && typeof details === 'object' && !Array.isArray(details)
              ? details as Record<string, unknown>
              : {},
          }
        }).filter((entry) => entry.id.length > 0)
        return { entries }
      } catch (error) {
        return { entries: [], error: describe(error) }
      }
    },

    async loadDeployment() {
      const info: DeploymentInfo = {
        host: cloudConfig.host,
        agentRunnerConfigured: cloudConfig.agentRunnerConfigured,
        stats: null,
      }
      try {
        const { data, error } = await db.rpc('admin_deployment_stats')
        if (error) return { ...info, statsError: error.message }
        if (!data || typeof data !== 'object') {
          return { ...info, statsError: 'The deployment returned no statistics. Apply the operator console migration.' }
        }
        const row = data as Record<string, unknown>
        const byRole = row.projectsByRole
        info.stats = {
          projects: count(row.projects),
          projectsByRole: byRole && typeof byRole === 'object' && !Array.isArray(byRole)
            ? Object.fromEntries(Object.entries(byRole as Record<string, unknown>).map(([role, total]) => [role, count(total)]))
            : {},
          accounts: count(row.accounts),
          activeAccounts: count(row.activeAccounts),
          suspendedAccounts: count(row.suspendedAccounts),
          operatorAccounts: count(row.operatorAccounts),
          usageEvents: count(row.usageEvents),
          auditEvents: count(row.auditEvents),
          exportsToday: count(row.exportsToday),
          simulationsToday: count(row.simulationsToday),
        }
        return info
      } catch (error) {
        return { ...info, statsError: describe(error) }
      }
    },

    async recordOpen() {
      await audit('admin:open', 'admin-console', { role: operator.role })
    },

    async listFaq() {
      try {
        const { data, error } = await db
          .from('faq_entries')
          .select('id,question,answer,position,published,updated_at')
          .order('position', { ascending: true })
          .order('id', { ascending: true })
        if (error) return { entries: [], error: error.message }
        const entries = (data ?? []).map((raw) => {
          const row = raw as Record<string, unknown>
          const at = timestamp(row.updated_at)
          return {
            id: String(row.id ?? ''),
            question: String(row.question ?? ''),
            answer: String(row.answer ?? ''),
            position: Number(row.position ?? 0) || 0,
            published: row.published !== false,
            updatedAt: at ?? Date.now(),
          }
        }).filter((entry) => entry.id.length > 0)
        return { entries }
      } catch (error) {
        return { entries: [], error: describe(error) }
      }
    },

    async saveFaq({ id, question, answer, position, published }) {
      if (!question.trim() || !answer.trim()) {
        return { ok: false, error: 'FAQ entries need a question and an answer.' }
      }
      try {
        if (id) {
          const { error } = await db.from('faq_entries')
            .update({ question: question.trim(), answer: answer.trim(), position, published })
            .eq('id', id)
          if (error) return { ok: false, error: error.message }
          return audited(await audit('admin:faq_update', id, { position, published }), 'FAQ entry')
        }
        const { error } = await db.from('faq_entries')
          .insert({ question: question.trim(), answer: answer.trim(), position, published })
        if (error) return { ok: false, error: error.message }
        return audited(await audit('admin:faq_create', question.trim().slice(0, 80), { position, published }), 'FAQ entry')
      } catch (error) {
        return { ok: false, error: describe(error) }
      }
    },

    async deleteFaq(id) {
      if (!id) return { ok: false, error: 'Pick an entry first.' }
      try {
        const { error } = await db.from('faq_entries').delete().eq('id', id)
        if (error) return { ok: false, error: error.message }
        return audited(await audit('admin:faq_delete', id, {}), 'FAQ entry')
      } catch (error) {
        return { ok: false, error: describe(error) }
      }
    },
  }
}