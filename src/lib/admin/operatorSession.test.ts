import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  OPERATOR_STORAGE_KEY, _resetOperatorClientForTesting, operatorClient, resolveOperator, signInOperator, signOutOperator,
} from './operatorSession'

/*
 * The console's door. Authority is the `profiles` row the server holds, so every
 * refusal here must come from a read — never from a local guess, and never from
 * the workbench's session.
 */

const createClient = vi.hoisted(() => vi.fn())
vi.mock('@supabase/supabase-js', () => ({ createClient }))
vi.mock('../cloudConfig', () => ({
  isSupabaseConfigured: true,
  cloudConfig: {
    url: 'https://folio.example',
    anonKey: 'anon-key',
    configured: true,
    host: 'folio.example',
    agentRunnerConfigured: false,
  },
}))

interface FakeOptions {
  user?: { id: string; email?: string } | null
  authError?: string
  profile?: Record<string, unknown> | null
  profileError?: string
  signInError?: string
  signOutThrows?: boolean
}

function fakeDb(options: FakeOptions = {}) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: options.profile ?? null,
    error: options.profileError ? { message: options.profileError } : null,
  })
  const eq = vi.fn(() => ({ maybeSingle }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  const getUser = vi.fn().mockResolvedValue({
    data: { user: options.user ?? null },
    error: options.authError ? { message: options.authError } : null,
  })
  const signInWithPassword = vi.fn().mockResolvedValue({
    data: {},
    error: options.signInError ? { message: options.signInError } : null,
  })
  const signOut = vi.fn().mockImplementation(async () => {
    if (options.signOutThrows) throw new Error('network down')
    return { error: null }
  })
  const db = { auth: { getUser, signInWithPassword, signOut }, from } as unknown as SupabaseClient
  return { db, getUser, signInWithPassword, signOut, from, select, eq, maybeSingle }
}

const ownerRow = { id: 'op-1', email: 'ops@folio.team', display_name: 'Ada Ops', role: 'owner', status: 'active' }

beforeEach(() => {
  localStorage.clear()
  _resetOperatorClientForTesting()
  createClient.mockReset()
  createClient.mockReturnValue({ auth: {}, from: vi.fn() })
})

describe('operator session', () => {
  it('keeps its own storage key so a designer session cannot open the console', () => {
    expect(OPERATOR_STORAGE_KEY).toBe('folio.operator.session')
    const client = operatorClient()
    expect(client).not.toBeNull()
    expect(createClient).toHaveBeenCalledWith('https://folio.example', 'anon-key', {
      auth: {
        storageKey: OPERATOR_STORAGE_KEY,
        persistSession: true,
        autoRefreshToken: true,
        // A `#access_token` in the address bar must not be adopted as an operator session.
        detectSessionInUrl: false,
      },
    })
  })

  it('reuses one client instead of opening a second auth store', () => {
    const first = operatorClient()
    expect(operatorClient()).toBe(first)
    expect(createClient).toHaveBeenCalledTimes(1)
  })

  it('returns no operator and no invented reason when nobody is signed in', async () => {
    const { db, from } = fakeDb({ user: null })
    await expect(resolveOperator(db)).resolves.toEqual({ operator: null })
    expect(from).not.toHaveBeenCalled()
  })

  it('reports an unreadable session instead of granting access', async () => {
    const { db } = fakeDb({ authError: 'token expired' })
    const result = await resolveOperator(db)
    expect(result.operator).toBeNull()
    expect(result.reason).toContain('token expired')
  })

  it('names the missing migration when the governance table is absent', async () => {
    const { db } = fakeDb({ user: { id: 'op-1' }, profileError: 'relation "profiles" does not exist' })
    const result = await resolveOperator(db)
    expect(result.operator).toBeNull()
    expect(result.reason).toContain('admin migration')
  })

  it('refuses an account with no governance row', async () => {
    const { db } = fakeDb({ user: { id: 'op-1' }, profile: null })
    const result = await resolveOperator(db)
    expect(result.operator).toBeNull()
    expect(result.reason).toContain('No governance profile')
  })

  it('refuses a suspended operator', async () => {
    const { db } = fakeDb({ user: { id: 'op-1' }, profile: { ...ownerRow, status: 'suspended' } })
    const result = await resolveOperator(db)
    expect(result.operator).toBeNull()
    expect(result.reason).toContain('suspended')
  })

  it('tells a designer that this console is not theirs', async () => {
    for (const role of ['engineer', 'viewer', 'user', '']) {
      const { db } = fakeDb({ user: { id: 'op-1' }, profile: { ...ownerRow, role } })
      const result = await resolveOperator(db)
      expect(result.operator).toBeNull()
      expect(result.reason).toContain('does not operate it')
    }
  })

  it('admits an active owner and administrator with the server-held identity', async () => {
    for (const role of ['owner', 'admin'] as const) {
      const { db, eq } = fakeDb({ user: { id: 'op-1', email: 'session@folio.team' }, profile: { ...ownerRow, role } })
      const result = await resolveOperator(db)
      expect(result.operator).toEqual({ id: 'op-1', name: 'Ada Ops', email: 'ops@folio.team', role })
      expect(result.reason).toBeUndefined()
      expect(eq).toHaveBeenCalledWith('id', 'op-1')
    }
  })

  it('falls back to the session email when the profile carries no name', async () => {
    const { db } = fakeDb({
      user: { id: 'op-1', email: 'session@folio.team' },
      profile: { id: 'op-1', email: '', display_name: '', role: 'admin', status: 'active' },
    })
    const result = await resolveOperator(db)
    expect(result.operator).toMatchObject({ name: 'session@folio.team', email: 'session@folio.team' })
  })

  it('reports an unreachable directory rather than admitting the session', async () => {
    const { db } = fakeDb({ user: { id: 'op-1' } })
    ;(db.from as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error('offline') })
    const result = await resolveOperator(db)
    expect(result.operator).toBeNull()
    expect(result.reason).toContain('offline')
  })
})

describe('operator sign-in', () => {
  it('refuses an empty form without touching the network', async () => {
    const { db, signInWithPassword } = fakeDb()
    const result = await signInOperator(db, '  ', '')
    expect(result.operator).toBeNull()
    expect(result.error).toContain('Enter the operator email and password')
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it('gives the same refusal for a wrong password and a non-operator account', async () => {
    const wrong = fakeDb({ signInError: 'invalid credentials' })
    const refused = await signInOperator(wrong.db, 'someone@folio.team', 'secret')
    expect(refused.operator).toBeNull()
    expect(refused.error).toBe('Those credentials were not accepted for this deployment.')
    // A rejected sign-in must not leave a half-open session behind.
    expect(wrong.signOut).toHaveBeenCalledTimes(1)

    const designer = fakeDb({ user: { id: 'u-2' }, profile: { ...ownerRow, id: 'u-2', role: 'engineer' } })
    const result = await signInOperator(designer.db, 'designer@folio.team', 'secret')
    expect(result.operator).toBeNull()
    expect(result.error).toBeUndefined()
    expect(result.reason).toContain('does not operate it')
    expect(designer.signOut).toHaveBeenCalledTimes(1)
  })

  it('admits an operator and trims the address it sends', async () => {
    const { db, signInWithPassword } = fakeDb({ user: { id: 'op-1' }, profile: ownerRow })
    const result = await signInOperator(db, '  ops@folio.team  ', 'secret')
    expect(signInWithPassword).toHaveBeenCalledWith({ email: 'ops@folio.team', password: 'secret' })
    expect(result.operator).toMatchObject({ id: 'op-1', role: 'owner' })
  })

  it('reports an unreachable identity service', async () => {
    const { db, signInWithPassword } = fakeDb()
    signInWithPassword.mockRejectedValue(new Error('fetch failed'))
    const result = await signInOperator(db, 'ops@folio.team', 'secret')
    expect(result.operator).toBeNull()
    expect(result.error).toContain('fetch failed')
  })
})

describe('operator sign-out', () => {
  it('clears the local session even when the remote sign-out fails', async () => {
    localStorage.setItem(OPERATOR_STORAGE_KEY, '{"access_token":"x"}')
    const { db, signOut } = fakeDb({ signOutThrows: true })
    await signOutOperator(db)
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(OPERATOR_STORAGE_KEY)).toBeNull()
  })

  it('leaves the workbench session alone', async () => {
    localStorage.setItem(OPERATOR_STORAGE_KEY, 'operator')
    localStorage.setItem('folio-workbench-session', 'designer')
    const { db } = fakeDb()
    await signOutOperator(db)
    expect(localStorage.getItem(OPERATOR_STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem('folio-workbench-session')).toBe('designer')
  })
})