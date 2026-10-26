import { beforeEach, describe, expect, it, vi } from 'vitest'
import { supabase } from '../supabase'
import { siemService } from '../siem/siemService'
import {
  capabilities,
  isAdminRole,
  listMembers,
  resolveAdminAccess,
  resolveLocalRole,
  setMemberRole,
  setMemberStatus,
} from './adminService'
import type { User } from '../../types'

vi.mock('../supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { from: vi.fn() },
}))

const fromMock = supabase.from as unknown as ReturnType<typeof vi.fn>

const actor: User = { id: 'actor-1', name: 'Ada', email: 'ada@example.com', role: 'owner' }

/** Chain used by `.select(...).eq(...).maybeSingle()` / `.order().limit()`. */
function selectChain(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(result)
  const limit = vi.fn().mockResolvedValue(result)
  const order = vi.fn(() => ({ limit }))
  const eq = vi.fn(() => ({ maybeSingle, order }))
  const select = vi.fn(() => ({ eq, order, limit }))
  return { select, eq, order, limit, maybeSingle }
}

beforeEach(() => {
  fromMock.mockReset()
  localStorage.clear()
})

describe('administration access', () => {
  it('recognises administrator roles only', () => {
    expect(isAdminRole('owner')).toBe(true)
    expect(isAdminRole('admin')).toBe(true)
    expect(isAdminRole('engineer')).toBe(false)
    expect(isAdminRole(undefined)).toBe(false)
  })

  it('treats a local device as its owner and an unassigned cloud account as user', () => {
    expect(resolveLocalRole(actor, true)).toBe('owner')
    expect(resolveLocalRole({ ...actor, role: 'engineer' as unknown as User['role'] }, false)).toBe('engineer')
    expect(resolveLocalRole({ ...actor, role: 'admin' }, false)).toBe('admin')
    expect(resolveLocalRole({ ...actor, role: 'mystery' as unknown as User['role'] }, false)).toBe('user')
    expect(resolveLocalRole(null, false)).toBe('user')
  })

  it('allows the offline owner without touching the network', async () => {
    await expect(resolveAdminAccess(actor, true)).resolves.toEqual({
      allowed: true,
      role: 'owner',
      status: 'active',
    })
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('reads a cloud governance profile and denies suspended accounts', async () => {
    const adminChain = selectChain({ data: { role: 'admin', status: 'active' }, error: null })
    fromMock.mockReturnValueOnce(adminChain as never)
    await expect(resolveAdminAccess(actor, false)).resolves.toMatchObject({ allowed: true, role: 'admin' })

    const suspended = selectChain({ data: { role: 'owner', status: 'suspended' }, error: null })
    fromMock.mockReturnValueOnce(suspended as never)
    const denied = await resolveAdminAccess(actor, false)
    expect(denied.allowed).toBe(false)
    expect(denied.reason).toContain('suspended')
  })

  it('explains missing schema and missing profile instead of inventing access', async () => {
    fromMock.mockReturnValueOnce(selectChain({ data: null, error: { message: 'relation does not exist' } }) as never)
    const schema = await resolveAdminAccess(actor, false)
    expect(schema.allowed).toBe(false)
    expect(schema.reason).toContain('admin migration')

    fromMock.mockReturnValueOnce(selectChain({ data: null, error: null }) as never)
    const missing = await resolveAdminAccess(actor, false)
    expect(missing.allowed).toBe(false)
    expect(missing.reason).toContain('No governance profile')
  })

  it('lists the local owner honestly', async () => {
    const result = await listMembers(actor, true)
    expect(result.members).toEqual([{
      id: 'actor-1',
      name: 'Ada',
      email: 'ada@example.com',
      role: 'owner',
      status: 'active',
      source: 'local',
    }])
    expect(result.error).toBeUndefined()
  })

  it('refuses local role changes', async () => {
    await expect(setMemberRole(actor, true, 'someone', 'engineer')).resolves.toMatchObject({ ok: false })
    await expect(setMemberStatus(actor, true, 'someone', 'suspended')).resolves.toMatchObject({ ok: false })
  })

  it('prevents an administrator from removing their own access', async () => {
    const result = await setMemberRole(actor, false, actor.id, 'viewer')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('cannot remove your own administrator access')
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('updates another member and audits the change', async () => {
    const eq = vi.fn().mockResolvedValue({ error: null })
    const update = vi.fn(() => ({ eq }))
    fromMock.mockReturnValueOnce({ update } as never)
    const result = await setMemberRole(actor, false, 'member-2', 'engineer')
    expect(result).toEqual({ ok: true })
    expect(update).toHaveBeenCalledWith({ role: 'engineer' })
    expect(eq).toHaveBeenCalledWith('id', 'member-2')
    expect(siemService.getAuditTrail({ limit: 1 })[0]?.action).toBe('admin:role_change')
  })

  it('refuses to suspend the acting account', async () => {
    const result = await setMemberStatus(actor, false, actor.id, 'suspended')
    expect(result.ok).toBe(false)
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('labels cloud-only capabilities without faking invitations', () => {
    expect(capabilities(true).inviteMembers).toBe(false)
    expect(capabilities(false).inviteMembers).toBe(false)
    expect(capabilities(true).note).toContain('cloud deployment')
    expect(capabilities(false).note).toContain('server-side admin function')
  })
})
