/**
 * Role-based quotas for the administration console.
 *
 * Quotas are policy, not physics: a limit of `null` means unlimited. The owner
 * is always unlimited so a workspace can never lock itself out of
 * administration. Cloud roles are enforced by the UI helpers here and by the
 * `usage_events`/`quota_policies` schema; on a local-only device the sole owner
 * is the only principal, so the numbers describe future members honestly.
 */

export const ADMIN_ROLES = ['owner', 'admin', 'engineer', 'viewer'] as const
export type AdminRole = (typeof ADMIN_ROLES)[number]
/** A signed-in cloud account with no governance role assigned. */
export type QuotaSubject = AdminRole | 'user'

export interface QuotaLimits {
  maxProjects: number | null
  maxExportsPerDay: number | null
  maxSimulationsPerDay: number | null
  maxStorageMb: number | null
}

export type QuotaStatus = 'ok' | 'warn' | 'fail'

export interface QuotaUsage {
  projects: number
  exportsToday: number
  simulationsToday: number
  storageMb: number
}

export interface QuotaRow {
  id: 'projects' | 'exports' | 'simulations' | 'storage'
  label: string
  used: number
  limit: number | null
  unit: string
  status: QuotaStatus
}

export type QuotaDecisionKind = 'project' | 'export' | 'simulation'

export interface QuotaDecision {
  allowed: boolean
  used: number
  limit: number | null
  reason?: string
}

export const QUOTA_STORAGE_KEY = 'folio.quotas.v1'

export const ROLE_LABELS: Record<AdminRole, string> = {
  owner: 'Owner',
  admin: 'Administrator',
  engineer: 'Engineer',
  viewer: 'Viewer',
}

export const ROLE_DESCRIPTIONS: Record<AdminRole, string> = {
  owner: 'Full control, including administration and billing. Never quota-limited.',
  admin: 'Manages people, policies and usage. Never quota-limited.',
  engineer: 'Creates and edits designs. Subject to the engineering quotas below.',
  viewer: 'Read-only access. The tightest default quotas.',
}

const UNLIMITED: QuotaLimits = {
  maxProjects: null,
  maxExportsPerDay: null,
  maxSimulationsPerDay: null,
  maxStorageMb: null,
}

export const DEFAULT_QUOTA_POLICIES: Readonly<Record<AdminRole, QuotaLimits>> = {
  owner: { ...UNLIMITED },
  admin: { ...UNLIMITED },
  engineer: { maxProjects: 100, maxExportsPerDay: 200, maxSimulationsPerDay: 1000, maxStorageMb: 2048 },
  viewer: { maxProjects: 3, maxExportsPerDay: 20, maxSimulationsPerDay: 50, maxStorageMb: 100 },
}

/**
 * Unassigned accounts are treated as viewers until an administrator assigns a
 * role. Stored policies are read here so a saved engineer/viewer policy takes
 * effect in the console and in the local enforcement guards.
 */
export function subjectLimits(role: QuotaSubject): QuotaLimits {
  const policies = readQuotaPolicies()
  return role === 'user' ? policies.viewer : policies[role]
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function normalizeLimits(value: unknown, fallback: QuotaLimits): QuotaLimits {
  if (!value || typeof value !== 'object') return { ...fallback }
  const raw = value as Partial<QuotaLimits>
  const pick = (candidate: unknown, replacement: number | null): number | null =>
    candidate === null ? null : isFiniteNonNegative(candidate) ? candidate : replacement
  return {
    maxProjects: pick(raw.maxProjects, fallback.maxProjects),
    maxExportsPerDay: pick(raw.maxExportsPerDay, fallback.maxExportsPerDay),
    maxSimulationsPerDay: pick(raw.maxSimulationsPerDay, fallback.maxSimulationsPerDay),
    maxStorageMb: pick(raw.maxStorageMb, fallback.maxStorageMb),
  }
}

/** Stored policies merged over defaults, so new roles gain sane limits. */
export function readQuotaPolicies(): Record<AdminRole, QuotaLimits> {
  const result = {} as Record<AdminRole, QuotaLimits>
  for (const role of ADMIN_ROLES) result[role] = { ...DEFAULT_QUOTA_POLICIES[role] }
  if (typeof localStorage === 'undefined') return result
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(QUOTA_STORAGE_KEY) ?? '{}')
    if (!parsed || typeof parsed !== 'object') return result
    const stored = parsed as Partial<Record<AdminRole, unknown>>
    for (const role of ADMIN_ROLES) result[role] = normalizeLimits(stored[role], DEFAULT_QUOTA_POLICIES[role])
  } catch {
    // Unreadable policy falls back to defaults rather than disabling limits.
  }
  return result
}

/** Validate a single edited limit. `null` is unlimited; blank means `null`. */
export function parseQuotaLimit(input: string): number | null | undefined {
  const trimmed = input.trim()
  if (trimmed === '') return null
  const value = Number(trimmed)
  if (!Number.isFinite(value) || value < 0) return undefined
  return value
}

export function validateQuotaLimits(limits: QuotaLimits): string | null {
  const entries: Array<[string, number | null]> = [
    ['projects', limits.maxProjects],
    ['exports per day', limits.maxExportsPerDay],
    ['simulations per day', limits.maxSimulationsPerDay],
    ['storage (MB)', limits.maxStorageMb],
  ]
  for (const [label, value] of entries) {
    if (value === null) continue
    if (!Number.isFinite(value) || value < 0) return `The ${label} limit must be zero or a positive number.`
  }
  return null
}

/** Owner and administrator policies are fixed at unlimited. */
export function setQuotaPolicy(role: AdminRole, limits: QuotaLimits): { ok: boolean; error?: string } {
  if (role === 'owner' || role === 'admin') {
    return { ok: false, error: 'Owner and administrator limits are fixed at unlimited.' }
  }
  const error = validateQuotaLimits(limits)
  if (error) return { ok: false, error }
  if (typeof localStorage === 'undefined') return { ok: false, error: 'Policy storage is unavailable in this environment.' }
  try {
    const policies = readQuotaPolicies()
    policies[role] = { ...limits }
    localStorage.setItem(QUOTA_STORAGE_KEY, JSON.stringify(policies))
    return { ok: true }
  } catch {
    return { ok: false, error: 'Policy could not be saved (storage is full or blocked).' }
  }
}

export function resetQuotaPolicies(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(QUOTA_STORAGE_KEY)
  } catch {
    // ignore
  }
}

/**
 * Replace the cached policies (for example after reading `quota_policies` from
 * the cloud). Owner and administrator limits stay unlimited regardless of the
 * supplied value so administration cannot lock itself out.
 */
export function writeQuotaPolicies(policies: Record<AdminRole, QuotaLimits>): { ok: boolean; error?: string } {
  if (typeof localStorage === 'undefined') return { ok: false, error: 'Policy storage is unavailable in this environment.' }
  const normalized = {} as Record<AdminRole, QuotaLimits>
  for (const role of ADMIN_ROLES) {
    const incoming = policies[role]
    if (!incoming) return { ok: false, error: `The ${ROLE_LABELS[role]} policy is missing.` }
    const error = validateQuotaLimits(incoming)
    if (error) return { ok: false, error }
    normalized[role] = role === 'owner' || role === 'admin'
      ? { ...DEFAULT_QUOTA_POLICIES[role] }
      : { ...incoming }
  }
  try {
    localStorage.setItem(QUOTA_STORAGE_KEY, JSON.stringify(normalized))
    return { ok: true }
  } catch {
    return { ok: false, error: 'Policy cache could not be saved (storage is full or blocked).' }
  }
}

function statusFor(used: number, limit: number | null): QuotaStatus {
  if (limit === null) return 'ok'
  if (limit <= 0) return used > 0 ? 'fail' : 'ok'
  const ratio = used / limit
  if (ratio >= 1) return 'fail'
  if (ratio >= 0.8) return 'warn'
  return 'ok'
}

export function quotaRows(role: QuotaSubject, usage: QuotaUsage): QuotaRow[] {
  const limits = subjectLimits(role)
  return [
    {
      id: 'projects',
      label: 'Projects',
      used: usage.projects,
      limit: limits.maxProjects,
      unit: 'projects',
      status: statusFor(usage.projects, limits.maxProjects),
    },
    {
      id: 'exports',
      label: 'Exports today',
      used: usage.exportsToday,
      limit: limits.maxExportsPerDay,
      unit: 'exports',
      status: statusFor(usage.exportsToday, limits.maxExportsPerDay),
    },
    {
      id: 'simulations',
      label: 'Simulations today',
      used: usage.simulationsToday,
      limit: limits.maxSimulationsPerDay,
      unit: 'runs',
      status: statusFor(usage.simulationsToday, limits.maxSimulationsPerDay),
    },
    {
      id: 'storage',
      label: 'Local storage',
      used: usage.storageMb,
      limit: limits.maxStorageMb,
      unit: 'MB',
      status: statusFor(usage.storageMb, limits.maxStorageMb),
    },
  ]
}

/**
 * Decide whether one more action fits the policy. Owners, admins and viewers
 * can all create projects; the limit — not the role name — decides.
 */
export function checkQuotaCapacity(
  kind: QuotaDecisionKind,
  role: QuotaSubject,
  usage: QuotaUsage,
): QuotaDecision {
  const limits = subjectLimits(role)
  const row =
    kind === 'project'
      ? { used: usage.projects, limit: limits.maxProjects, label: 'project' }
      : kind === 'export'
        ? { used: usage.exportsToday, limit: limits.maxExportsPerDay, label: 'export' }
        : { used: usage.simulationsToday, limit: limits.maxSimulationsPerDay, label: 'simulation' }
  if (row.limit === null) return { allowed: true, used: row.used, limit: null }
  if (row.used >= row.limit) {
    return {
      allowed: false,
      used: row.used,
      limit: row.limit,
      reason: `The ${ROLE_LABELS[role === 'user' ? 'viewer' : role]} policy allows ${row.limit} ${row.label}${row.limit === 1 ? '' : 's'}${kind === 'project' ? '' : ' per day'}. ${row.used} already used.`,
    }
  }
  return { allowed: true, used: row.used, limit: row.limit }
}
