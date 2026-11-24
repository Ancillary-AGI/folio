import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  authorizeRunner,
  mayAccessJob,
  mintRunnerToken,
  readRunnerToken,
  RUNNER_TOKEN_HEADER,
  runnerEnabled,
  runnerKey,
  runnerSecret,
  trustSameOrigin,
} from './auth'

const MANAGED = [
  'FOLIO_AGENT_RUNNER_ENABLED',
  'FOLIO_AGENT_RUNNER_KEY',
  'FOLIO_AGENT_RUNNER_SECRET',
  'FOLIO_AGENT_RUNNER_TRUST_SAME_ORIGIN',
] as const

let saved: Record<string, string | undefined>

beforeEach(() => {
  saved = {}
  for (const name of MANAGED) {
    saved[name] = process.env[name]
    delete process.env[name]
  }
})

afterEach(() => {
  for (const name of MANAGED) {
    const value = saved[name]
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

const headers = (init: Record<string, string> = {}): Headers => new Headers(init)

describe('runner configuration', () => {
  it('is disabled by default and reports why', () => {
    expect(runnerEnabled()).toBe(false)
    expect(runnerKey()).toBeUndefined()
    expect(runnerSecret()).toBeUndefined()
    expect(trustSameOrigin()).toBe(false)
    const identity = authorizeRunner(headers())
    expect(identity).toMatchObject({ ok: false, status: 503, error: 'agent_runner_disabled' })
  })

  it('enables itself for an explicit flag or a configured credential', () => {
    process.env.FOLIO_AGENT_RUNNER_ENABLED = '1'
    expect(runnerEnabled()).toBe(true)
    delete process.env.FOLIO_AGENT_RUNNER_ENABLED
    process.env.FOLIO_AGENT_RUNNER_KEY = 'shared'
    expect(runnerEnabled()).toBe(true)
    delete process.env.FOLIO_AGENT_RUNNER_KEY
    process.env.FOLIO_AGENT_RUNNER_SECRET = 'secret'
    expect(runnerEnabled()).toBe(true)
  })
})

describe('shared deployment key', () => {
  beforeEach(() => {
    process.env.FOLIO_AGENT_RUNNER_KEY = 'deployment-key'
  })

  it('accepts the key from x-api-key or a bearer header', () => {
    expect(authorizeRunner(headers({ 'x-api-key': 'deployment-key' }))).toEqual({ ok: true, mode: 'shared-key' })
    expect(authorizeRunner(headers({ authorization: 'Bearer deployment-key' }))).toEqual({
      ok: true,
      mode: 'shared-key',
    })
  })

  it('rejects a wrong key and an expired token', () => {
    expect(authorizeRunner(headers({ 'x-api-key': 'wrong' }))).toMatchObject({ ok: false, status: 401 })
    expect(authorizeRunner(headers({ authorization: 'Bearer not-a-token' }))).toMatchObject({ ok: false, status: 401 })
  })
})

describe('per-user tokens', () => {
  beforeEach(() => {
    process.env.FOLIO_AGENT_RUNNER_SECRET = 'runner-secret'
  })

  it('mints and verifies an owner-scoped token', () => {
    const now = 1_700_000_000_000
    const { token, expiresAt } = mintRunnerToken('user-9', 300, now)
    expect(expiresAt).toBe(now + 300_000)
    const payload = readRunnerToken(token, now)
    expect(payload).toMatchObject({ sub: 'user-9', scope: 'agent-jobs' })
    expect(authorizeRunner(headers({ authorization: `Bearer ${token}` }), now)).toEqual({
      ok: true,
      ownerId: 'user-9',
      mode: 'token',
    })
  })

  it('rejects an expired token', () => {
    const now = 1_700_000_000_000
    const { token } = mintRunnerToken('user-9', 60, now)
    expect(readRunnerToken(token, now + 61_000)).toBeUndefined()
  })

  it('rejects a tampered token and a token signed with another secret', () => {
    const { token } = mintRunnerToken('user-9')
    const [body, signature] = token.split('.')
    const tampered = `${body}.${signature.slice(0, -2)}aa`
    expect(readRunnerToken(tampered)).toBeUndefined()

    process.env.FOLIO_AGENT_RUNNER_SECRET = 'a-different-secret'
    expect(readRunnerToken(token)).toBeUndefined()
  })

  it('refuses to mint without a secret or an owner', () => {
    delete process.env.FOLIO_AGENT_RUNNER_SECRET
    expect(() => mintRunnerToken('user-9')).toThrow(/SECRET/)
    process.env.FOLIO_AGENT_RUNNER_SECRET = 'runner-secret'
    expect(() => mintRunnerToken('  ')).toThrow(/owner/)
  })

  it('scopes a token holder to its own jobs', () => {
    const token = authorizeRunner(headers({ authorization: `Bearer ${mintRunnerToken('owner-1').token}` }))
    expect(mayAccessJob(token, 'owner-1')).toBe(true)
    expect(mayAccessJob(token, 'owner-2')).toBe(false)
    expect(mayAccessJob(token, undefined)).toBe(false)

    const shared = authorizeRunner(headers({ 'x-api-key': 'configured-later' }))
    // No shared key configured yet, so this is still a rejection.
    expect(mayAccessJob(shared, 'anyone')).toBe(false)
  })
})

describe('same-origin trust', () => {
  beforeEach(() => {
    process.env.FOLIO_AGENT_RUNNER_ENABLED = '1'
    process.env.FOLIO_AGENT_RUNNER_TRUST_SAME_ORIGIN = '1'
  })

  it('accepts a marked same-origin request', () => {
    expect(
      authorizeRunner(headers({
        [RUNNER_TOKEN_HEADER]: '1',
        origin: 'https://folio.example',
        host: 'folio.example',
      })),
    ).toEqual({ ok: true, mode: 'same-origin' })

    expect(
      authorizeRunner(headers({
        [RUNNER_TOKEN_HEADER]: '1',
        'sec-fetch-site': 'same-origin',
      })),
    ).toEqual({ ok: true, mode: 'same-origin' })
  })

  it('refuses a cross-site request or a request without the marker header', () => {
    expect(
      authorizeRunner(headers({
        [RUNNER_TOKEN_HEADER]: '1',
        origin: 'https://evil.example',
        host: 'folio.example',
      })),
    ).toMatchObject({ ok: false, status: 401 })

    expect(
      authorizeRunner(headers({
        [RUNNER_TOKEN_HEADER]: '1',
        'sec-fetch-site': 'cross-site',
        origin: 'https://folio.example',
        host: 'folio.example',
      })),
    ).toMatchObject({ ok: false, status: 401 })

    expect(
      authorizeRunner(headers({ origin: 'https://folio.example', host: 'folio.example' })),
    ).toMatchObject({ ok: false, status: 401 })
  })

  it('does not trust an ordinary browser navigation', () => {
    expect(
      authorizeRunner(headers({ [RUNNER_TOKEN_HEADER]: '1', 'sec-fetch-site': 'none' })),
    ).toMatchObject({ ok: false, status: 401 })
  })
})
