/**
 * Client side of the per-user runner token exchange.
 *
 * The browser never holds the runner secret. It sends its Supabase access
 * token to `/api/v1/agent/token`, which verifies the session and returns a
 * short-lived credential scoped to that user.
 *
 * The cache is keyed by the **access token**, not just by time. If one user
 * signs out and another signs in in the same tab, the second user's access
 * token differs immediately, so the first user's runner token is never reused.
 * A failed exchange is remembered briefly for the same access token so a
 * polling panel does not hammer an endpoint the deployment has not enabled.
 */
import { isSupabaseConfigured } from '../cloudConfig'

const TOKEN_ROUTE = '/api/v1/agent/token'
const EARLY_RENEW_MS = 60_000
const FAILURE_BACKOFF_MS = 30_000

interface CachedToken {
  accessToken: string
  token: string
  expiresAt: number
}

let cached: CachedToken | null = null
let inflight: { accessToken: string; promise: Promise<string | undefined> } | null = null
let blocked: { accessToken: string; until: number } | null = null

async function sessionAccessToken(): Promise<string | undefined> {
  if (!isSupabaseConfigured) return undefined
  try {
    const { supabase } = await import('../supabase')
    const { data, error } = await supabase.auth.getSession()
    if (error) return undefined
    return data.session?.access_token || undefined
  } catch {
    return undefined
  }
}

async function exchange(accessToken: string, now: number): Promise<string | undefined> {
  if (blocked && blocked.accessToken === accessToken && now < blocked.until) return undefined
  try {
    const response = await fetch(TOKEN_ROUTE, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!response.ok) {
      blocked = { accessToken, until: now + FAILURE_BACKOFF_MS }
      return undefined
    }
    const body = (await response.json()) as { token?: unknown; expiresAt?: unknown }
    if (typeof body.token !== 'string' || !body.token) {
      blocked = { accessToken, until: now + FAILURE_BACKOFF_MS }
      return undefined
    }
    const expiresAt = typeof body.expiresAt === 'number' ? body.expiresAt : now + 10 * 60_000
    cached = { accessToken, token: body.token, expiresAt }
    blocked = null
    return body.token
  } catch {
    blocked = { accessToken, until: now + FAILURE_BACKOFF_MS }
    return undefined
  }
}

/** The runner credential for the signed-in user, or undefined when unavailable. */
export async function currentRunnerToken(now = Date.now()): Promise<string | undefined> {
  const accessToken = await sessionAccessToken()
  if (!accessToken) return undefined
  if (cached && cached.accessToken === accessToken && cached.expiresAt - EARLY_RENEW_MS > now) {
    return cached.token
  }
  if (!inflight || inflight.accessToken !== accessToken) {
    const promise = exchange(accessToken, now).finally(() => {
      if (inflight?.promise === promise) inflight = null
    })
    inflight = { accessToken, promise }
  }
  return inflight.promise
}

/** Test hook: forget a cached token or backoff. */
export function resetRunnerToken(): void {
  cached = null
  inflight = null
  blocked = null
}
