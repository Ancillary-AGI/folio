/**
 * The console's pure helpers — measured, never invented.
 */
import { describe, expect, it, beforeEach } from 'vitest'
import {
  formatBytes,
  resolvePlan,
  storageSnapshot,
  usageRollup,
  exportLocalData,
} from '../console/consoleData'
import { recordUsage, resetUsageLedger } from '../lib/admin/usageLedger'

function fakeStorage(entries: Record<string, string>) {
  const keys = Object.keys(entries)
  return {
    length: keys.length,
    key: (index: number) => keys[index] ?? null,
    getItem: (key: string) => entries[key] ?? null,
  }
}

describe('storageSnapshot', () => {
  it('accounts for every key and sorts by size descending', () => {
    const storage = fakeStorage({ 'folio.usage.v1': 'abc', 'odd-custom-key': 'x'.repeat(1000) })
    const snapshot = storageSnapshot(storage)

    expect(snapshot.entries[0].key).toBe('odd-custom-key')
    expect(snapshot.entries).toHaveLength(2)
    const expected = ('odd-custom-key'.length + 1000) * 2 + ('folio.usage.v1'.length + 3) * 2
    expect(snapshot.totalBytes).toBe(expected)
    expect(snapshot.entries[0].label).toBe('odd-custom-key')
    expect(snapshot.entries[1].label).toBe('Usage ledger')
  })

  it('exports only what this app writes, never session credentials', () => {
    const storage = fakeStorage({
      'folio.vcs.v1': '{"a":1}',
      'circuit-cad-app-store': '{"state":{}}',
      'sb-abc123-auth-token': 'SECRET-SESSION',
      'folio.operator.session': 'SECRET-OPERATOR',
      'other-app.key': 'tail',
    })
    const { filename, json } = exportLocalData(storage)

    expect(filename).toMatch(/^folio-local-data-\d{4}-\d{2}-\d{2}\.json$/)
    const parsed = JSON.parse(json) as { keys: Record<string, string> }
    expect(Object.keys(parsed.keys).sort()).toEqual(['circuit-cad-app-store', 'folio.vcs.v1'])
    expect(parsed.keys['folio.vcs.v1']).toBe('{"a":1}')
    // The workbench and operator sessions are credentials, not user data.
    expect(json).not.toContain('SECRET-SESSION')
    expect(json).not.toContain('SECRET-OPERATOR')
    expect(json).not.toContain('tail')
  })
})

describe('formatBytes', () => {
  it('formats bytes, KB, MB and GB', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB')
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe('2.0 GB')
  })
})

describe('resolvePlan', () => {
  it('calls the standalone deployment what it is: free, this device', () => {
    const plan = resolvePlan(null, true)
    expect(plan.id).toBe('local')
    expect(plan.label).toContain('Free')
    expect(plan.detail).toMatch(/unlimited/i)
  })
})

describe('usageRollup', () => {
  beforeEach(() => {
    resetUsageLedger()
  })

  it('counts real ledger events, nothing more', () => {
    // The ledger collapses consecutive identical events within 3 s, so use
    // distinct kinds — each one must land.
    recordUsage('agent.run', 'user-1')
    recordUsage('simulation.run', 'user-1')
    recordUsage('template.fork', 'user-1')

    const rollup = usageRollup(30)
    expect(rollup.totalEvents).toBe(3)
    expect(rollup.highlights[0]).toEqual({ kind: 'agent.run', count: 1 })
    expect(rollup.highlights[1]).toEqual({ kind: 'simulation.run', count: 1 })
    expect(rollup.highlights[2]).toEqual({ kind: 'template.fork', count: 1 })
  })
})
