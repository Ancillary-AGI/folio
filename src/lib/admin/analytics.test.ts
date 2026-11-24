import { describe, expect, it } from 'vitest'
import type { Account } from './adminService'
import { DEFAULT_QUOTA_POLICIES, type QuotaLimits } from './quotaPolicy'
import type { AccountUsage, UsageEvent } from './usageLedger'
import {
  accountGrowth, attentionItems, dailyQuotaPressure, eventsInWindow, hourlyActivity,
  roleDistribution, startOfLocalDay, startOfLocalWeek, statusDistribution, topAccounts,
} from './analytics'

const NOW = new Date(2026, 10, 18, 15, 30, 0, 0).getTime()

function account(overrides: Partial<Account> & Pick<Account, 'id'>): Account {
  return {
    id: overrides.id,
    name: overrides.name ?? overrides.id,
    email: overrides.email ?? `${overrides.id}@example.com`,
    role: overrides.role ?? 'engineer',
    status: overrides.status ?? 'active',
    lastSeenAt: overrides.lastSeenAt,
    createdAt: overrides.createdAt,
  }
}

function event(at: number, overrides: Partial<UsageEvent> = {}): UsageEvent {
  return {
    id: `event-${at}-${overrides.kind ?? 'project.open'}`,
    at,
    user: overrides.user ?? 'u-1',
    kind: overrides.kind ?? 'project.open',
    detail: overrides.detail,
  }
}

const policies: Record<'owner' | 'admin' | 'engineer' | 'viewer', QuotaLimits> = {
  ...DEFAULT_QUOTA_POLICIES,
  engineer: { maxProjects: 10, maxExportsPerDay: 4, maxSimulationsPerDay: 10, maxStorageMb: 100 },
  viewer: { maxProjects: 2, maxExportsPerDay: 1, maxSimulationsPerDay: 2, maxStorageMb: 20 },
}

describe('time windows', () => {
  it('starts a local day and week at midnight', () => {
    const day = new Date(startOfLocalDay(NOW))
    expect(day.getHours()).toBe(0)
    expect(day.getMinutes()).toBe(0)
    const week = new Date(startOfLocalWeek(NOW))
    expect(week.getHours()).toBe(0)
    expect(week.getDay()).toBe(1)
  })

  it('keeps only events inside the requested day window', () => {
    const events = [event(NOW), event(NOW - 8 * 24 * 3600 * 1000)]
    expect(eventsInWindow(events, 7, NOW)).toHaveLength(1)
  })

  it('buckets events by the local hour of day', () => {
    const morning = new Date(2026, 10, 17, 9, 0, 0, 0).getTime()
    const afternoon = new Date(2026, 10, 17, 15, 0, 0, 0).getTime()
    const hours = hourlyActivity([event(morning), event(morning + 1), event(afternoon)], 7, NOW)
    expect(hours).toHaveLength(24)
    expect(hours[9].count).toBe(2)
    expect(hours[15].count).toBe(1)
  })
})

describe('directory distributions', () => {
  const accounts = [
    account({ id: 'u-1', role: 'owner' }),
    account({ id: 'u-2', role: 'admin' }),
    account({ id: 'u-3', role: 'engineer' }),
    account({ id: 'u-4', role: 'engineer', status: 'suspended' }),
    account({ id: 'u-5', role: 'user' }),
  ]

  it('counts roles in governance order and omits empty slices', () => {
    expect(roleDistribution(accounts)).toEqual([
      { role: 'owner', label: 'Owner', count: 1 },
      { role: 'admin', label: 'Administrator', count: 1 },
      { role: 'engineer', label: 'Engineer', count: 2 },
      { role: 'user', label: 'Unassigned', count: 1 },
    ])
  })

  it('counts every account by status', () => {
    expect(statusDistribution(accounts)).toEqual([
      { status: 'active', label: 'Active', count: 4 },
      { status: 'suspended', label: 'Suspended', count: 1 },
    ])
  })
})

describe('account growth', () => {
  it('fills every week, separates creations and keeps a running total', () => {
    const thisWeek = NOW
    const lastWeek = thisWeek - 7 * 24 * 3600 * 1000
    const accounts = [
      account({ id: 'u-1', createdAt: lastWeek }),
      account({ id: 'u-2', createdAt: thisWeek }),
      account({ id: 'u-3', createdAt: thisWeek }),
      // A missing date is omitted, never bucketed into an invented week.
      account({ id: 'u-4' }),
    ]
    const growth = accountGrowth(accounts, 3, NOW)
    expect(growth).toHaveLength(3)
    const last = growth[growth.length - 1]
    expect(last.created).toBe(2)
    expect(last.total).toBe(3)
    expect(growth[1].created).toBe(1)
    expect(growth[1].total).toBe(1)
  })
})

describe('daily quota pressure', () => {
  const accounts = [
    account({ id: 'u-1', name: 'Ada', role: 'engineer' }),
    account({ id: 'u-2', name: 'Grace', role: 'viewer' }),
    account({ id: 'u-3', name: 'Linus', role: 'user' }),
  ]

  it('uses each account policy and sorts the hottest first', () => {
    const events = [
      event(NOW, { user: 'u-1', kind: 'export.run' }),
      event(NOW, { user: 'u-1', kind: 'export.run' }),
      event(NOW, { user: 'u-1', kind: 'simulation.run' }),
      event(NOW, { user: 'u-2', kind: 'export.run' }),
      event(NOW, { user: 'u-3', kind: 'export.run' }),
      // Outside today: must not count.
      event(NOW - 2 * 24 * 3600 * 1000, { user: 'u-1', kind: 'export.run' }),
    ]
    const rows = dailyQuotaPressure(accounts, events, policies, NOW)
    /* "Hottest" is pressure — used against that account's own limit — not raw
     * volume. u-1 is the busiest account (three events) but sits at half its
     * engineer export allowance, so it is 'ok' and sorts last. u-2 and u-3 both
     * spend their whole viewer allowance (ratio 1) and tie; the volume
     * tie-break leaves them in first-seen order. */
    expect(rows.map((row) => row.id)).toEqual(['u-2', 'u-3', 'u-1'])
    // A viewer gets one export; one is the whole policy.
    expect(rows[0]).toMatchObject({ exports: 1, role: 'viewer', state: 'fail' })
    // An unassigned account is governed by the viewer policy.
    expect(rows[1]).toMatchObject({ exports: 1, role: 'user', state: 'fail' })
    expect(rows[1].limits).toEqual(policies.viewer)
    // Two of four exports and one of ten solver runs: half pressure, 'ok'.
    expect(rows[2]).toMatchObject({ exports: 2, simulations: 1, ratio: 0.5, state: 'ok' })
  })

  it('treats an unlimited policy as no pressure', () => {
    const rows = dailyQuotaPressure(
      [account({ id: 'u-1', role: 'engineer' })],
      [event(NOW, { kind: 'export.run' }), event(NOW, { kind: 'export.run' })],
      { ...policies, engineer: { ...policies.engineer, maxExportsPerDay: null } },
      NOW,
    )
    expect(rows[0].state).toBe('ok')
    expect(rows[0].ratio).toBe(0)
  })
})

describe('top accounts and attention', () => {
  const accounts = [
    account({ id: 'u-1', name: 'Ada', role: 'engineer' }),
    account({ id: 'u-2', name: 'Grace', role: 'viewer', status: 'suspended' }),
    account({ id: 'u-3', name: 'Linus', role: 'user' }),
  ]

  it('ranks only accounts that exist in the directory', () => {
    const usage = new Map<string, AccountUsage>([
      ['u-1', { user: 'u-1', events: 8, lastAt: NOW, topKind: 'export.run', kinds: [] }],
      ['u-2', { user: 'u-2', events: 2, lastAt: NOW, topKind: 'project.open', kinds: [] }],
      ['ghost', { user: 'ghost', events: 99, lastAt: NOW, topKind: 'project.open', kinds: [] }],
    ])
    expect(topAccounts(accounts, usage, 2).map((row) => row.account.id)).toEqual(['u-1', 'u-2'])
  })

  it('reports suspended, at-limit, unassigned and failed reads', () => {
    const items = attentionItems({
      accounts,
      pressure: [{
        id: 'u-1', name: 'Ada', role: 'engineer', exports: 4, simulations: 0,
        limits: policies.engineer, ratio: 1, state: 'fail',
      }],
      activeAccounts: 0,
      usageError: 'permission denied',
    })
    expect(items.map((item) => item.id)).toEqual([
      'suspended', 'at-limit', 'unassigned', 'no-activity', 'usage-error',
    ])
    expect(items.find((item) => item.id === 'suspended')?.tone).toBe('warning')
    expect(items.find((item) => item.id === 'at-limit')?.section).toBe('quotas')
    expect(items.find((item) => item.id === 'usage-error')?.detail).toContain('permission denied')
  })

  it('returns nothing when the rows read have nothing to report', () => {
    expect(attentionItems({ accounts: [account({ id: 'u-1' })], pressure: [], activeAccounts: 1 })).toEqual([])
  })
})
