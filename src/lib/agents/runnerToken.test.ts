import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  accessToken: 'access-a',
  hasSession: true,
  sessionReads: 0,
}))

vi.mock('../cloudConfig', () => ({ isSupabaseConfigured: true }))
vi.mock('../supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => {
        state.sessionReads += 1
        if (!state.hasSession) return { data: { session: null }, error: new Error('no session') }
        return { data: { session: { access_token: state.accessToken } }, error: null }
      },
    },
  },
}))

import { currentRunnerToken, resetRunnerToken } from './runnerToken'

const fetchMock = vi.fn<typeof fetch>()

const grant = (token: string, expiresAt: number): Response =>
  new Response(JSON.stringify({ token, expiresAt }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

const authorizationOf = (call: number): string | null =>
  new Headers((fetchMock.mock.calls[call] as unknown as [string, RequestInit])[1].headers).get('Authorization')

beforeEach(() => {
  state.accessToken = 'access-a'
  state.hasSession = true
  state.sessionReads = 0
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  resetRunnerToken()
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetRunnerToken()
})

describe('currentRunnerToken', () => {
  it('exchanges the session once and reuses the token for that account', async () => {
    const now = 1_700_000_000_000
    fetchMock.mockResolvedValue(grant('runner-1', now + 600_000))

    expect(await currentRunnerToken(now)).toBe('runner-1')
    expect(await currentRunnerToken(now + 5_000)).toBe('runner-1')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/v1/agent/token')
    expect(authorizationOf(0)).toBe('Bearer access-a')
  })

  it('never reuses the previous account token after a sign-in switch', async () => {
    const now = 1_700_000_000_000
    fetchMock.mockResolvedValueOnce(grant('runner-a', now + 600_000))
    expect(await currentRunnerToken(now)).toBe('runner-a')

    state.accessToken = 'access-b'
    fetchMock.mockResolvedValueOnce(grant('runner-b', now + 600_000))
    expect(await currentRunnerToken(now + 1_000)).toBe('runner-b')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(authorizationOf(1)).toBe('Bearer access-b')
  })

  it('renews shortly before expiry instead of sending a stale credential', async () => {
    const now = 1_700_000_000_000
    fetchMock.mockResolvedValueOnce(grant('runner-short', now + 30_000))
    expect(await currentRunnerToken(now)).toBe('runner-short')

    fetchMock.mockResolvedValueOnce(grant('runner-renewed', now + 600_000))
    expect(await currentRunnerToken(now + 1_000)).toBe('runner-renewed')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('returns nothing and backs off when the deployment cannot mint a token', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"token_minting_disabled"}', { status: 503 }))
    const now = 1_700_000_000_000
    expect(await currentRunnerToken(now)).toBeUndefined()
    expect(await currentRunnerToken(now + 1_000)).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not call the token route without a signed-in session', async () => {
    state.hasSession = false
    expect(await currentRunnerToken(1_700_000_000_000)).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('retries after the backoff window has passed', async () => {
    const now = 1_700_000_000_000
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 503 }))
    expect(await currentRunnerToken(now)).toBeUndefined()

    fetchMock.mockResolvedValueOnce(grant('runner-late', now + 600_000))
    expect(await currentRunnerToken(now + 31_000)).toBe('runner-late')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
