import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadSignInMethods, parseSignInMethods } from './signInMethods'

describe('parseSignInMethods', () => {
  it('returns only providers the deployment enabled', () => {
    expect(parseSignInMethods({
      external: { email: true, google: false, github: true },
    })).toEqual([
      { id: 'email', label: 'Email and password' },
      { id: 'github', label: 'GitHub' },
    ])
  })

  it('lists email before the OAuth providers regardless of payload order', () => {
    expect(parseSignInMethods({
      external: { github: true, google: true, email: true },
    }).map((method) => method.id)).toEqual(['email', 'github', 'google'])
  })

  it('keeps an unknown provider visible under its key', () => {
    expect(parseSignInMethods({ external: { custom_sso: true } })).toEqual([
      { id: 'custom_sso', label: 'custom_sso' },
    ])
  })

  it('treats a malformed or missing settings payload as no reported methods', () => {
    expect(parseSignInMethods(null)).toEqual([])
    expect(parseSignInMethods({})).toEqual([])
    expect(parseSignInMethods({ external: ['email'] })).toEqual([])
    expect(parseSignInMethods({ external: { email: 'yes' } })).toEqual([])
  })
})

describe('loadSignInMethods', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('asks the deployment settings endpoint with the public key', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      external: { email: true, github: true },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const methods = await loadSignInMethods({
      url: 'https://folio.example.com/',
      anonKey: 'public-anon-key',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://folio.example.com/auth/v1/settings',
      expect.objectContaining({ headers: { apikey: 'public-anon-key' } }),
    )
    expect(methods.map((method) => method.id)).toEqual(['email', 'github'])
  })

  it('fails loudly when the identity service refuses the request', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 503 })))

    await expect(loadSignInMethods({
      url: 'https://folio.example.com',
      anonKey: 'public-anon-key',
    })).rejects.toThrow('The identity service answered 503.')
  })
})
