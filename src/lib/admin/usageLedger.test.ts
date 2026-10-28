import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  USAGE_EVENT_CAP,
  USAGE_STORAGE_KEY,
  countUsage,
  getUsageEvents,
  recordUsage,
  resetUsageLedger,
  subscribeUsage,
  summarizeUsage,
  usageDayKey,
  usageSince,
} from './usageLedger'

const HOUR = 3600_000
const DAY = 24 * HOUR

beforeEach(() => {
  localStorage.clear()
  resetUsageLedger()
})

describe('usage ledger', () => {
  it('records events and returns them newest-last', () => {
    const now = Date.UTC(2026, 0, 10, 12)
    recordUsage('workspace.open', 'u1', { mode: 'pcb' }, now)
    recordUsage('export.run', 'u1', { format: 'netlist' }, now + 1000)
    const events = getUsageEvents()
    expect(events).toHaveLength(2)
    expect(events[0].kind).toBe('workspace.open')
    expect(events[1].kind).toBe('export.run')
    expect(events[1].user).toBe('u1')
  })

  it('rejects events without a principal and collapses rapid duplicates', () => {
    expect(recordUsage('workspace.open', '', undefined, 1000)).toBeNull()
    const first = recordUsage('workspace.open', 'u1', { mode: 'pcb' }, 1000)
    const duplicate = recordUsage('workspace.open', 'u1', { mode: 'pcb' }, 2500)
    expect(duplicate?.id).toBe(first?.id)
    expect(getUsageEvents()).toHaveLength(1)
    const later = recordUsage('workspace.open', 'u1', { mode: 'pcb' }, 5000)
    expect(later?.id).not.toBe(first?.id)
    expect(getUsageEvents()).toHaveLength(2)
  })

  it('does not collapse a different mode or a different user', () => {
    const now = 1000
    recordUsage('workspace.open', 'u1', { mode: 'pcb' }, now)
    recordUsage('workspace.open', 'u1', { mode: 'rf' }, now + 10)
    recordUsage('workspace.open', 'u2', { mode: 'pcb' }, now + 20)
    expect(getUsageEvents()).toHaveLength(3)
  })

  it('persists to storage and notifies subscribers', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeUsage(listener)
    recordUsage('demo.load', 'u1', undefined, 1000)
    expect(listener).toHaveBeenCalledTimes(1)
    const stored = JSON.parse(localStorage.getItem(USAGE_STORAGE_KEY) ?? '[]') as unknown[]
    expect(stored).toHaveLength(1)
    unsubscribe()
    recordUsage('demo.load', 'u1', undefined, 9000)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('caps the ledger at the documented event count', async () => {
    const seeded = Array.from({ length: USAGE_EVENT_CAP }, (_, index) => ({
      id: `seed-${index}`,
      at: 1000 + index,
      user: 'u1',
      kind: 'workspace.open',
    }))
    localStorage.setItem(USAGE_STORAGE_KEY, JSON.stringify(seeded))
    vi.resetModules()
    const fresh = await import('./usageLedger')
    fresh.recordUsage('export.run', 'u1', undefined, 9_000_000)
    const events = fresh.getUsageEvents()
    expect(events).toHaveLength(USAGE_EVENT_CAP)
    expect(events[events.length - 1]?.kind).toBe('export.run')
    expect(events[0]?.id).toBe('seed-1')
  })

  it('filters by day window and counts per user', () => {
    const now = Date.UTC(2026, 0, 10, 12)
    recordUsage('export.run', 'u1', undefined, now)
    recordUsage('export.run', 'u2', undefined, now - 2 * DAY)
    recordUsage('export.run', 'u1', undefined, now - 10 * DAY)

    expect(usageSince(7, now)).toHaveLength(2)
    expect(countUsage('export.run', now - 3 * DAY)).toBe(2)
    expect(countUsage('export.run', now - 3 * DAY, 'u1')).toBe(1)
  })

  it('summarises kinds, modes, users and dense daily buckets', () => {
    const now = Date.UTC(2026, 0, 10, 12)
    recordUsage('workspace.open', 'u1', { mode: 'pcb' }, now)
    recordUsage('workspace.open', 'u1', { mode: 'pcb' }, now - DAY)
    recordUsage('simulation.run', 'u2', undefined, now)

    expect(getUsageEvents()).toHaveLength(3)
    const summary = summarizeUsage(getUsageEvents(), 3, now)
    expect(summary.total).toBe(3)
    expect(summary.byKind).toEqual([
      { kind: 'workspace.open', count: 2 },
      { kind: 'simulation.run', count: 1 },
    ])
    expect(summary.byMode).toEqual([{ mode: 'pcb', count: 2 }])
    expect(summary.byUser).toEqual([
      { user: 'u1', count: 2 },
      { user: 'u2', count: 1 },
    ])
    expect(summary.daily).toHaveLength(3)
    expect(summary.daily[summary.daily.length - 1]).toEqual({ date: usageDayKey(now), count: 2 })
  })

  it('reports a refused write and recovers on the next successful one', async () => {
    vi.resetModules()
    const fresh = await import('./usageLedger')
    expect(fresh.isUsageLedgerPersistent()).toBe(true)

    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    try {
      fresh.recordUsage('export.run', 'u1', undefined, 1000)
      // The event is still usable this session, but it is not durable.
      expect(fresh.getUsageEvents()).toHaveLength(1)
      expect(fresh.isUsageLedgerPersistent()).toBe(false)
    } finally {
      setItem.mockRestore()
    }

    fresh.recordUsage('demo.load', 'u1', undefined, 5000)
    expect(fresh.isUsageLedgerPersistent()).toBe(true)
  })

  it('treats a store that refuses reads as non-durable', async () => {
    vi.resetModules()
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked')
    })
    try {
      const fresh = await import('./usageLedger')
      expect(fresh.getUsageEvents()).toHaveLength(0)
      expect(fresh.isUsageLedgerPersistent()).toBe(false)
    } finally {
      getItem.mockRestore()
    }
  })

  it('ignores malformed stored rows after a fresh module load', async () => {
    localStorage.setItem(USAGE_STORAGE_KEY, JSON.stringify([{ id: 'x' }, 'nope', null]))
    vi.resetModules()
    const fresh = await import('./usageLedger')
    expect(fresh.getUsageEvents()).toHaveLength(0)
    expect(() => fresh.recordUsage('workspace.open', 'u1', undefined, 1000)).not.toThrow()
    expect(fresh.getUsageEvents()).toHaveLength(1)
  })
})
