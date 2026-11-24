/**
 * Dashboard analytics over deployment rows.
 *
 * Every function here is pure: it takes the accounts and usage events the
 * console already read and returns a shape the dashboard can draw. Nothing is
 * sampled, estimated or filled with synthetic points — a day with no recorded
 * event is a zero, which is a fact the ledger can support.
 */
import type { Account } from './adminService'
import type { AccountUsage } from './usageLedger'
import {
  ADMIN_ROLES, ROLE_LABELS, type AdminRole, type QuotaLimits, type QuotaSubject,
} from './quotaPolicy'
import { usageDayKey, type UsageEvent } from './usageLedger'

const DAY_MS = 24 * 3600 * 1000
const WEEK_MS = 7 * DAY_MS

export function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** Monday 00:00 local, so a weekly bucket boundary matches a working week. */
export function startOfLocalWeek(timestamp: number): number {
  const date = new Date(startOfLocalDay(timestamp))
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7))
  return date.getTime()
}

export function eventsInWindow(events: readonly UsageEvent[], days: number, now = Date.now()): UsageEvent[] {
  const bounded = Math.max(1, Math.floor(days))
  const since = now - bounded * DAY_MS
  return events.filter((event) => event.at >= since)
}

export interface HourlyPoint {
  hour: string
  count: number
}

/** Count recorded actions by the local hour of the day. */
export function hourlyActivity(events: readonly UsageEvent[], days: number, now = Date.now()): HourlyPoint[] {
  const buckets = Array.from({ length: 24 }, (_, hour) => ({
    hour: `${String(hour).padStart(2, '0')}`,
    count: 0,
  }))
  for (const event of eventsInWindow(events, days, now)) {
    buckets[new Date(event.at).getHours()].count += 1
  }
  return buckets
}

export interface RolePoint {
  role: QuotaSubject
  label: string
  count: number
}

/** Account counts by governance role; unassigned accounts are its own slice. */
export function roleDistribution(accounts: readonly Account[]): RolePoint[] {
  const counts = new Map<QuotaSubject, number>()
  for (const account of accounts) counts.set(account.role, (counts.get(account.role) ?? 0) + 1)
  const order: QuotaSubject[] = [...ADMIN_ROLES, 'user']
  return order
    .map((role) => ({
      role,
      label: role === 'user' ? 'Unassigned' : ROLE_LABELS[role],
      count: counts.get(role) ?? 0,
    }))
    .filter((point) => point.count > 0)
}

export interface StatusPoint {
  status: Account['status']
  label: string
  count: number
}

export function statusDistribution(accounts: readonly Account[]): StatusPoint[] {
  const active = accounts.filter((account) => account.status === 'active').length
  const suspended = accounts.filter((account) => account.status === 'suspended').length
  return [
    { status: 'active' as const, label: 'Active', count: active },
    { status: 'suspended' as const, label: 'Suspended', count: suspended },
  ]
}

export interface GrowthPoint {
  date: string
 /** Accounts created inside this week. */
  created: number
  /** Accounts that existed by the end of this week. */
  total: number
}

/**
 * Weekly account growth over the last `weeks` weeks. Accounts without a
 * `created_at` are omitted rather than bucketed into an invented date.
 */
export function accountGrowth(accounts: readonly Account[], weeks = 12, now = Date.now()): GrowthPoint[] {
  const bounded = Math.max(1, Math.floor(weeks))
  const currentWeek = startOfLocalWeek(now)
  const firstWeek = currentWeek - (bounded - 1) * WEEK_MS
  const created = accounts
    .map((account) => account.createdAt)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value <= now)
    .sort((left, right) => left - right)

  return Array.from({ length: bounded }, (_, index) => {
    const start = firstWeek + index * WEEK_MS
    const end = start + WEEK_MS
    const limit = Math.min(end, now + 1)
    return {
      date: usageDayKey(start),
      created: created.filter((value) => value >= start && value < limit).length,
      total: created.filter((value) => value < limit).length,
    }
  })
}

export type PressureState = 'ok' | 'warn' | 'fail'

export interface QuotaPressureRow {
  id: string
  name: string
  role: QuotaSubject
  exports: number
  simulations: number
  limits: QuotaLimits
  ratio: number
  state: PressureState
}

function ratioOf(used: number, limit: number | null): number {
  if (limit === null) return 0
  if (limit <= 0) return used > 0 ? 1 : 0
  return used / limit
}

function pressureState(ratio: number): PressureState {
  if (ratio >= 1) return 'fail'
  if (ratio >= 0.8) return 'warn'
  return 'ok'
}

/**
 * Today's exports and solver runs per account against that account's own
 * policy. The window is the local calendar day, matching the workbench's daily
 * view; the database counts its own day (UTC by default), which the console
 * states separately.
 */
export function dailyQuotaPressure(
  accounts: readonly Account[],
  events: readonly UsageEvent[],
  policies: Readonly<Record<AdminRole, QuotaLimits>>,
  now = Date.now(),
): QuotaPressureRow[] {
  const midnight = startOfLocalDay(now)
  const totals = new Map<string, { exports: number; simulations: number }>()
  for (const event of events) {
    if (event.at < midnight || event.at > now) continue
    if (event.kind !== 'export.run' && event.kind !== 'simulation.run') continue
    const row = totals.get(event.user) ?? { exports: 0, simulations: 0 }
    if (event.kind === 'export.run') row.exports += 1
    else row.simulations += 1
    totals.set(event.user, row)
  }
  const byId = new Map(accounts.map((account) => [account.id, account]))
  return [...totals.entries()]
    .map(([id, row]) => {
      const account = byId.get(id)
      // An unassigned account is governed by the viewer policy until a role is set.
      const role: QuotaSubject = account?.role ?? 'user'
      const limits = role === 'user' ? policies.viewer : policies[role]
      const ratio = Math.max(
        ratioOf(row.exports, limits.maxExportsPerDay),
        ratioOf(row.simulations, limits.maxSimulationsPerDay),
      )
      return {
        id,
        name: account?.name ?? id,
        role,
        exports: row.exports,
        simulations: row.simulations,
        limits,
        ratio,
        state: pressureState(ratio),
      }
    })
    .sort((left, right) => right.ratio - left.ratio || right.exports + right.simulations - (left.exports + left.simulations))
}

export interface TopAccount {
  account: Account
  usage: AccountUsage
}

export function topAccounts(
  accounts: readonly Account[],
  usage: ReadonlyMap<string, AccountUsage>,
  limit = 5,
): TopAccount[] {
  const byId = new Map(accounts.map((account) => [account.id, account]))
  return [...usage.entries()]
    .filter(([id]) => byId.has(id))
    .map(([id, row]) => ({ account: byId.get(id) as Account, usage: row }))
    .sort((left, right) => right.usage.events - left.usage.events || left.account.name.localeCompare(right.account.name))
    .slice(0, Math.max(0, Math.floor(limit)))
}

export interface AttentionItem {
  id: string
  tone: 'warning' | 'destructive' | 'info'
  title: string
  detail: string
  section: 'accounts' | 'quotas' | 'usage' | 'iam'
}

/**
 * The things an operator should look at before anything else. Each entry is
 * derived from rows the console actually read; an empty list means there is
 * nothing to report, not that the check was skipped.
 */
export function attentionItems(input: {
  accounts: readonly Account[]
  pressure: readonly QuotaPressureRow[]
  activeAccounts: number
  usageError?: string
  accountsError?: string
  deploymentError?: string
}): AttentionItem[] {
  const items: AttentionItem[] = []
  const suspended = input.accounts.filter((account) => account.status === 'suspended')
  if (suspended.length > 0) {
    items.push({
      id: 'suspended',
      tone: 'warning',
      title: `${suspended.length} suspended account${suspended.length === 1 ? '' : 's'}`,
      detail: 'They cannot sign in to the workbench until an operator restores them.',
      section: 'accounts',
    })
  }
  const atLimit = input.pressure.filter((row) => row.state === 'fail')
  if (atLimit.length > 0) {
    items.push({
      id: 'at-limit',
      tone: 'destructive',
      title: `${atLimit.length} account${atLimit.length === 1 ? '' : 's'} at a daily limit`,
      detail: 'Their next export or solver run is refused by the database trigger.',
      section: 'quotas',
    })
  }
  const nearLimit = input.pressure.filter((row) => row.state === 'warn')
  if (nearLimit.length > 0) {
    items.push({
      id: 'near-limit',
      tone: 'warning',
      title: `${nearLimit.length} account${nearLimit.length === 1 ? '' : 's'} above 80% of a daily limit`,
      detail: 'A policy change may be needed before the limit stops real work.',
      section: 'quotas',
    })
  }
  const unassigned = input.accounts.filter((account) => account.role === 'user')
  if (unassigned.length > 0) {
    items.push({
      id: 'unassigned',
      tone: 'info',
      title: `${unassigned.length} account${unassigned.length === 1 ? '' : 's'} without a role`,
      detail: 'They are governed by the viewer policy until an operator assigns a role.',
      section: 'iam',
    })
  }
  if (input.accounts.length > 0 && input.activeAccounts === 0) {
    items.push({
      id: 'no-activity',
      tone: 'info',
      title: 'No account activity in this window',
      detail: 'The directory is not empty, but the usage ledger has no events in the selected window.',
      section: 'usage',
    })
  }
  if (input.usageError) {
    items.push({
      id: 'usage-error',
      tone: 'destructive',
      title: 'The usage ledger could not be read',
      detail: input.usageError,
      section: 'usage',
    })
  }
  if (input.accountsError) {
    items.push({
      id: 'accounts-error',
      tone: 'destructive',
      title: 'The account directory could not be read',
      detail: input.accountsError,
      section: 'accounts',
    })
  }
  if (input.deploymentError) {
    items.push({
      id: 'deployment-error',
      tone: 'warning',
      title: 'Deployment totals are unavailable',
      detail: input.deploymentError,
      section: 'usage',
    })
  }
  return items
}
