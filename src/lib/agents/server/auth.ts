/**
 * Authorization for the built-in always-on runner.
 *
 * Three modes, in order of preference:
 *
 *  1. A per-user token signed with `FOLIO_AGENT_RUNNER_SECRET`. The token is
 *     short-lived, names one owner, and is what a hosted deployment should
 *     mint after verifying a Supabase session. Jobs are scoped to that owner.
 *  2. A shared deployment key (`FOLIO_AGENT_RUNNER_KEY`) for a single operator
 *     or a machine-to-machine integration. Every caller sees every job, which
 *     is why it is not the multi-tenant mode.
 *  3. Same-origin trust, only when explicitly enabled for a single-tenant
 *     self-hosted install. A custom request header and an Origin/Host match
 *     make a cross-site form or `<img>` unable to reach the endpoint.
 *
 * Nothing is enabled by accident: the runner reports 503 until it is switched
 * on with `FOLIO_AGENT_RUNNER_ENABLED=1` or a key/secret is configured.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

export const RUNNER_TOKEN_SCHEME = 'folio.runner-token/1' as const
export const RUNNER_TOKEN_HEADER = 'x-folio-runner' as const
const MAX_TOKEN_LENGTH = 4_096

export interface RunnerTokenPayload {
  v: typeof RUNNER_TOKEN_SCHEME
  sub: string
  exp: number
  scope: 'agent-jobs'
}

export type RunnerIdentity =
  | { ok: true; ownerId?: string; mode: 'token' | 'shared-key' | 'same-origin' }
  | { ok: false; status: number; error: string; message: string }

const env = (name: string): string | undefined => {
  const value = process.env[name]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function runnerKey(): string | undefined {
  return env('FOLIO_AGENT_RUNNER_KEY')
}

export function runnerSecret(): string | undefined {
  return env('FOLIO_AGENT_RUNNER_SECRET')
}

export function runnerEnabled(): boolean {
  return env('FOLIO_AGENT_RUNNER_ENABLED') === '1' || Boolean(runnerKey()) || Boolean(runnerSecret())
}

export function trustSameOrigin(): boolean {
  return env('FOLIO_AGENT_RUNNER_TRUST_SAME_ORIGIN') === '1'
}

const base64url = (value: Buffer): string =>
  value.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const fromBase64url = (value: string): Buffer => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4)
  return Buffer.from(padded, 'base64')
}

const sign = (secret: string, body: string): Buffer =>
  createHmac('sha256', secret).update(body).digest()

/** Mint a short-lived, owner-scoped job token. Requires the runner secret. */
export function mintRunnerToken(ownerId: string, ttlSeconds = 900, now = Date.now()): { token: string; expiresAt: number } {
  const secret = runnerSecret()
  if (!secret) throw new Error('FOLIO_AGENT_RUNNER_SECRET is not configured.')
  if (!ownerId.trim()) throw new Error('A token needs an owner id.')
  const expiresAt = Math.floor(now / 1000) + Math.max(60, Math.min(86_400, Math.floor(ttlSeconds)))
  const payload: RunnerTokenPayload = { v: RUNNER_TOKEN_SCHEME, sub: ownerId, exp: expiresAt, scope: 'agent-jobs' }
  const body = base64url(Buffer.from(JSON.stringify(payload), 'utf8'))
  const token = `${body}.${base64url(sign(secret, body))}`
  return { token, expiresAt: expiresAt * 1000 }
}

/** Verify a minted token without leaking which half was wrong. */
export function readRunnerToken(token: string, now = Date.now()): RunnerTokenPayload | undefined {
  const secret = runnerSecret()
  if (!secret || token.length > MAX_TOKEN_LENGTH) return undefined
  const [body, signature, extra] = token.split('.')
  if (!body || !signature || extra !== undefined) return undefined
  let expected: Buffer
  let received: Buffer
  try {
    expected = sign(secret, body)
    received = fromBase64url(signature)
  } catch {
    return undefined
  }
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return undefined
  let payload: unknown
  try {
    payload = JSON.parse(fromBase64url(body).toString('utf8'))
  } catch {
    return undefined
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  const value = payload as Partial<RunnerTokenPayload>
  if (value.v !== RUNNER_TOKEN_SCHEME || typeof value.sub !== 'string' || !value.sub.trim()) return undefined
  if (value.scope !== 'agent-jobs') return undefined
  if (typeof value.exp !== 'number' || value.exp * 1000 <= now) return undefined
  return value as RunnerTokenPayload
}

const constantTimeEqual = (left: string, right: string): boolean => {
  const a = Buffer.from(left, 'utf8')
  const b = Buffer.from(right, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

const presentedSecret = (headers: Headers): string | undefined => {
  const apiKey = headers.get('x-api-key')
  if (apiKey?.trim()) return apiKey.trim()
  const authorization = headers.get('authorization')
  if (authorization?.toLowerCase().startsWith('bearer ')) return authorization.slice(7).trim()
  return undefined
}

const sameOrigin = (headers: Headers): boolean => {
  const fetchSite = headers.get('sec-fetch-site')
  if (fetchSite === 'same-origin') return true
  if (fetchSite && fetchSite !== 'same-origin') return false
  const origin = headers.get('origin')
  const host = headers.get('host')
  if (!origin || !host) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

export function authorizeRunner(headers: Headers, now = Date.now()): RunnerIdentity {
  if (!runnerEnabled()) {
    return {
      ok: false,
      status: 503,
      error: 'agent_runner_disabled',
      message:
        'The built-in agent runner is switched off. Set FOLIO_AGENT_RUNNER_KEY (shared key), ' +
        'FOLIO_AGENT_RUNNER_SECRET (per-user tokens), or FOLIO_AGENT_RUNNER_ENABLED=1 together with ' +
        'FOLIO_AGENT_RUNNER_TRUST_SAME_ORIGIN=1 to enable it.',
    }
  }
  const presented = presentedSecret(headers)
  if (presented) {
    const key = runnerKey()
    if (key && constantTimeEqual(presented, key)) return { ok: true, mode: 'shared-key' }
    const token = readRunnerToken(presented, now)
    if (token) return { ok: true, ownerId: token.sub, mode: 'token' }
    return { ok: false, status: 401, error: 'unauthorized', message: 'The runner credential is not valid or has expired.' }
  }
  if (trustSameOrigin() && headers.get(RUNNER_TOKEN_HEADER) === '1' && sameOrigin(headers)) {
    return { ok: true, mode: 'same-origin' }
  }
  return {
    ok: false,
    status: 401,
    error: 'unauthorized',
    message:
      'This endpoint needs an agent-runner credential. Send x-api-key / Authorization: Bearer with the ' +
      'deployment key or a token, or enable FOLIO_AGENT_RUNNER_ENABLED=1 with ' +
      'FOLIO_AGENT_RUNNER_TRUST_SAME_ORIGIN=1 for a single-tenant install.',
  }
}

/** A caller with a per-user token may only read or cancel its own jobs. */
export function mayAccessJob(identity: RunnerIdentity, ownerId: string | undefined): boolean {
  if (!identity.ok) return false
  if (identity.mode !== 'token') return true
  return ownerId !== undefined && ownerId === identity.ownerId
}
