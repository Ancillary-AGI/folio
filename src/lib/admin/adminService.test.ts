import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminApi, USAGE_ROW_LIMIT, type Account } from './adminService'
import { DEFAULT_QUOTA_POLICIES, type QuotaLimits } from './quotaPolicy'
import type { Operator } from './operatorSession'

/*
 * Every read and write here goes to the deployment. These tests pin the two
 * things that make the console safe to expose at a known URL: the guards that
 * stop an operator locking themselves out, and the honesty of a failed read —
 * an error is reported, never dressed up as an empty directory or a zero count.
 */

vi.mock('../cloudConfig', () => ({
  cloudConfig: { host: 'folio.example', agentRunnerConfigured: true },
}))

const operator: Operator = { id: 'op-1', name: 'Ada Ops', email: 'ops@folio.team', role: 'owner' }

interface Chain {
  select: ReturnType<typeof vi.fn>
  order: ReturnType<typeof vi.fn>
  limit: ReturnType<typeof vi.fn>
  gte: ReturnType<typeof vi.fn>
  eq: ReturnType<typeof vi.fn>
  maybeSingle: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  insert: ReturnType<typeof vi.fn>
  upsert: ReturnType<typeof vi.fn>
}

/** A thenable query builder: every terminal call resolves to the same result. */
function chain(result: { data?: unknown; error?: { message: string } | null }): Chain {
  const resolved = Promise.resolve({ data: result.data ?? null, error: result.error ?? null })
  const node: Record<string, unknown> = {}
  const terminal = vi.fn(() => resolved)
  for (const name of ['order', 'limit', 'gte', 'eq', 'maybeSingle']) node[name] = vi.fn(() => node)
  node.order = vi.fn(() => node)
  node.limit = terminal
  node.maybeSingle = terminal
  node.eq = vi.fn(() => ({ ...node, then: resolved.then.bind(resolved) }))
  const select = vi.fn(() => node)
  const update = vi.fn(() => node)
  const insert = vi.fn(() => resolved)
  const upsert = vi.fn(() => resolved)
  Object.assign(node, { select, update, insert, upsert, then: resolved.then.bind(resolved) })
  return { select, order: node.order, limit: terminal, gte: node.gte, eq: node.eq, maybeSingle: terminal, update, insert, upsert } as unknown as Chain
}

function db(tables: Record<string, unknown>, rpc?: { data?: unknown; error?: { message: string } | null }) {
  const from = vi.fn((table: string) => {
    if (!(table in tables)) throw new Error(`unexpected table ${table}`)
    return tables[table]
  })
  const rpcFn = vi.fn().mockResolvedValue(rpc ?? { data: null, error: null })
  return { client: { from, rpc: rpcFn } as unknown as SupabaseClient, from, rpc: rpcFn }
}

const accountRow = {
  id: 'u-1',
  email: 'ada@example.com',
  display_name: 'Ada',
  role: 'engineer',
  status: 'active',
  last_seen_at: '2026-11-07T09:00:00.000Z',
  created_at: '2026-01-01T00:00:00.000Z',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('account directory', () => {
  it('maps profile rows to accounts with parsed timestamps', async () => {
    const profiles = chain({ data: [accountRow] })
    const audit = chain({})
    const { client } = db({ profiles, admin_audit: audit })
    const result = await createAdminApi(client, operator).listAccounts()
    expect(result.error).toBeUndefined()
    expect(result.accounts).toEqual([{
      id: 'u-1',
      name: 'Ada',
      email: 'ada@example.com',
      role: 'engineer',
      status: 'active',
      lastSeenAt: Date.parse('2026-11-07T09:00:00.000Z'),
      createdAt: Date.parse('2026-01-01T00:00:00.000Z'),
    } satisfies Account])
    expect(profiles.order).toHaveBeenCalledWith('created_at', { ascending: true })
  })

  it('normalises an unknown role to unassigned and a missing name to the email', async () => {
    const profiles = chain({ data: [{ ...accountRow, role: 'wizard', display_name: '', status: 'weird', last_seen_at: 'not a date' }] })
    const { client } = db({ profiles })
    const { accounts } = await createAdminApi(client, operator).listAccounts()
    expect(accounts[0]).toMatchObject({ role: 'user', status: 'active', name: 'ada@example.com' })
    expect(accounts[0].lastSeenAt).toBeUndefined()
  })

  it('reports a refused read instead of an empty directory', async () => {
    const profiles = chain({ data: null, error: { message: 'permission denied for table profiles' } })
    const { client } = db({ profiles })
    const result = await createAdminApi(client, operator).listAccounts()
    expect(result.accounts).toEqual([])
    expect(result.error).toContain('permission denied')
  })

  it('survives a client that throws', async () => {
    const { client } = db({})
    const result = await createAdminApi(client, operator).listAccounts()
    expect(result.accounts).toEqual([])
    expect(result.error).toContain('unexpected table profiles')
  })
})

describe('role and status changes', () => {
  it('refuses self-demotion before touching the network', async () => {
    const { client, from } = db({})
    const result = await createAdminApi(client, operator).setRole(operator.id, 'viewer')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('cannot remove your own operator access')
    expect(from).not.toHaveBeenCalled()
  })

  it('refuses an unknown role', async () => {
    const { client, from } = db({})
    const result = await createAdminApi(client, operator).setRole('u-1', 'wizard' as never)
    expect(result.ok).toBe(false)
    expect(from).not.toHaveBeenCalled()
  })

  it('refuses suspending the account being operated with', async () => {
    const { client, from } = db({})
    const result = await createAdminApi(client, operator).setStatus(operator.id, 'suspended')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('cannot suspend the account you are operating with')
    expect(from).not.toHaveBeenCalled()
  })

  it('updates another account and appends the audit row in the same call', async () => {
    const profiles = chain({})
    const audit = chain({})
    const { client } = db({ profiles, admin_audit: audit })
    const result = await createAdminApi(client, operator).setRole('u-1', 'viewer')
    expect(result).toEqual({ ok: true })
    expect(profiles.update).toHaveBeenCalledWith({ role: 'viewer' })
    expect(audit.insert).toHaveBeenCalledWith({
      actor_id: operator.id,
      action: 'admin:role_change',
      resource: 'u-1',
      details: { role: 'viewer' },
    })
  })

  it('names the action when suspending and restoring', async () => {
    for (const [status, action] of [['suspended', 'admin:account_suspended'], ['active', 'admin:account_restored']] as const) {
      const audit = chain({})
      const { client } = db({ profiles: chain({}), admin_audit: audit })
      await createAdminApi(client, operator).setStatus('u-1', status)
      expect(audit.insert).toHaveBeenCalledWith(expect.objectContaining({ action }))
    }
  })

  it('says the change landed but left no record when the audit append fails', async () => {
    const audit = chain({ error: { message: 'row-level security violation' } })
    const { client } = db({ profiles: chain({}), admin_audit: audit })
    const result = await createAdminApi(client, operator).setRole('u-1', 'viewer')
    expect(result.ok).toBe(true)
    expect(result.warning).toContain('audit trail did not accept the row')
    expect(result.warning).toContain('row-level security violation')
  })

  it('reports a refused update as a failure, not a warning', async () => {
    const profiles = chain({ error: { message: 'Only an owner can change an owner account' } })
    const { client } = db({ profiles })
    const result = await createAdminApi(client, { ...operator, role: 'admin' }).setRole('u-1', 'viewer')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Only an owner')
  })
})

describe('usage feed', () => {
  const row = { id: 7, user_id: 'u-1', kind: 'export.run', detail: { format: 'netlist' }, created_at: new Date().toISOString() }

  it('maps deployment rows onto the shared event shape', async () => {
    const usage = chain({ data: [row] })
    const { client } = db({ usage_events: usage })
    const result = await createAdminApi(client, operator).loadUsage(14)
    expect(result.error).toBeUndefined()
    expect(result.truncated).toBe(false)
    expect(result.events).toEqual([{
      id: '7',
      at: Date.parse(row.created_at),
      user: 'u-1',
      kind: 'export.run',
      detail: { format: 'netlist' },
    }])
    expect(usage.gte).toHaveBeenCalledWith('created_at', expect.any(String))
    expect(usage.limit).toHaveBeenCalledWith(USAGE_ROW_LIMIT)
  })

  it('drops rows it cannot honestly place in time or kind', async () => {
    const usage = chain({ data: [
      row,
      { ...row, id: 8, created_at: 'yesterday' },
      { ...row, id: 9, kind: 'invented.action' },
    ] })
    const { client } = db({ usage_events: usage })
    const { events } = await createAdminApi(client, operator).loadUsage(7)
    expect(events.map((event) => event.id)).toEqual(['7'])
  })

  it('states truncation when the window holds more rows than the cap', async () => {
    const usage = chain({ data: Array.from({ length: USAGE_ROW_LIMIT }, (_, index) => ({ ...row, id: index })) })
    const { client } = db({ usage_events: usage })
    const result = await createAdminApi(client, operator).loadUsage(90)
    expect(result.truncated).toBe(true)
    expect(result.events).toHaveLength(USAGE_ROW_LIMIT)
  })

  it('reports a refused feed rather than implying nobody used the product', async () => {
    const usage = chain({ error: { message: 'permission denied for table usage_events' } })
    const { client } = db({ usage_events: usage })
    const result = await createAdminApi(client, operator).loadUsage(14)
    expect(result.events).toEqual([])
    expect(result.error).toContain('permission denied')
  })
})

describe('quota policies', () => {
  it('reads the stored policy, coercing the numeric storage column', async () => {
    const policies = chain({ data: [
      { role: 'engineer', max_projects: 12, max_exports_per_day: null, max_simulations_per_day: 40, max_storage_mb: '512.5' },
    ] })
    const { client } = db({ quota_policies: policies })
    const result = await createAdminApi(client, operator).loadPolicies()
    expect(result.error).toBeUndefined()
    expect(result.policies.engineer).toEqual({
      maxProjects: 12, maxExportsPerDay: null, maxSimulationsPerDay: 40, maxStorageMb: 512.5,
    })
    // A role with no stored row keeps its shipped default rather than becoming unlimited.
    expect(result.policies.viewer).toEqual(DEFAULT_QUOTA_POLICIES.viewer)
  })

  it('falls back to defaults and reports why when the table is unreadable', async () => {
    const policies = chain({ error: { message: 'relation does not exist' } })
    const { client } = db({ quota_policies: policies })
    const result = await createAdminApi(client, operator).loadPolicies()
    expect(result.policies).toEqual(DEFAULT_QUOTA_POLICIES)
    expect(result.error).toContain('relation does not exist')
  })

  it('refuses to edit the operator policies', async () => {
    const { client, from } = db({})
    for (const role of ['owner', 'admin'] as const) {
      const result = await createAdminApi(client, operator).savePolicy(role, DEFAULT_QUOTA_POLICIES.engineer)
      expect(result.ok).toBe(false)
      expect(result.error).toContain('fixed at unlimited')
    }
    expect(from).not.toHaveBeenCalled()
  })

  it('rejects a negative limit before writing', async () => {
    const { client, from } = db({})
    const limits: QuotaLimits = { ...DEFAULT_QUOTA_POLICIES.engineer, maxProjects: -1 }
    const result = await createAdminApi(client, operator).savePolicy('engineer', limits)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('projects')
    expect(from).not.toHaveBeenCalled()
  })

  it('upserts the policy with the acting operator and audits it', async () => {
    const policies = chain({})
    const audit = chain({})
    const { client } = db({ quota_policies: policies, admin_audit: audit })
    const limits: QuotaLimits = { maxProjects: 7, maxExportsPerDay: null, maxSimulationsPerDay: 50, maxStorageMb: 100 }
    const result = await createAdminApi(client, operator).savePolicy('engineer', limits)
    expect(result).toEqual({ ok: true })
    expect(policies.upsert).toHaveBeenCalledWith(expect.objectContaining({
      role: 'engineer',
      max_projects: 7,
      max_exports_per_day: null,
      max_simulations_per_day: 50,
      max_storage_mb: 100,
      updated_by: operator.id,
    }))
    expect(audit.insert).toHaveBeenCalledWith(expect.objectContaining({ action: 'admin:quota_policy', resource: 'engineer' }))
  })
})

describe('audit trail and deployment totals', () => {
  it('reads the append-only trail newest first', async () => {
    const audit = chain({ data: [{
      id: 3, actor_id: 'op-1', action: 'admin:role_change', resource: 'u-1',
      details: { role: 'viewer' }, created_at: '2026-11-07T09:00:00.000Z',
    }] })
    const { client } = db({ admin_audit: audit })
    const result = await createAdminApi(client, operator).loadAudit(50)
    expect(result.entries).toEqual([{
      id: '3', at: Date.parse('2026-11-07T09:00:00.000Z'), actor: 'op-1',
      action: 'admin:role_change', resource: 'u-1', details: { role: 'viewer' },
    }])
    expect(audit.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(audit.limit).toHaveBeenCalledWith(50)
  })

  it('reads deployment aggregates through the security-definer function', async () => {
    const stats = {
      projects: 42, projectsByRole: { engineer: 40, viewer: 2 }, accounts: 9, activeAccounts: 8,
      suspendedAccounts: 1, operatorAccounts: 2, usageEvents: 500, auditEvents: 12,
      exportsToday: 4, simulationsToday: 30,
    }
    const { client, rpc } = db({}, { data: stats })
    const info = await createAdminApi(client, operator).loadDeployment()
    expect(rpc).toHaveBeenCalledWith('admin_deployment_stats')
    expect(info.host).toBe('folio.example')
    expect(info.agentRunnerConfigured).toBe(true)
    expect(info.stats).toEqual(stats)
    expect(info.statsError).toBeUndefined()
  })

  it('reports missing totals instead of showing zeroes as if measured', async () => {
    const { client } = db({}, { data: null, error: { message: 'function admin_deployment_stats does not exist' } })
    const info = await createAdminApi(client, operator).loadDeployment()
    expect(info.stats).toBeNull()
    expect(info.statsError).toContain('admin_deployment_stats')
  })

  it('records the console visit as an operator action', async () => {
    const audit = chain({})
    const { client } = db({ admin_audit: audit })
    await createAdminApi(client, operator).recordOpen()
    expect(audit.insert).toHaveBeenCalledWith({
      actor_id: operator.id, action: 'admin:open', resource: 'admin-console', details: { role: 'owner' },
    })
  })
})