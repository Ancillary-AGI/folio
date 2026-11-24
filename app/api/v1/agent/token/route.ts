import { NextRequest, NextResponse } from 'next/server'
import { mintRunnerToken, runnerSecret } from '../../../../../src/lib/agents/server/auth'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../../../../../src/lib/env'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Exchange a Supabase access token for a short-lived, owner-scoped runner
 * token. The runner never trusts a browser-provided user id: it verifies the
 * session with the deployment's own auth service, then signs the identity.
 *
 * Without Supabase and without a runner secret this route reports 503; it does
 * not fall back to an unsigned token, because an unsigned token is just a
 * header any caller can set.
 */
export async function POST(request: NextRequest) {
  if (!runnerSecret()) {
    return NextResponse.json(
      {
        error: 'token_minting_disabled',
        message: 'FOLIO_AGENT_RUNNER_SECRET is not configured. Set it to mint per-user runner tokens.',
      },
      { status: 503 },
    )
  }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return NextResponse.json(
      {
        error: 'auth_not_configured',
        message: 'Supabase is not configured on this deployment, so a session cannot be verified.',
      },
      { status: 503 },
    )
  }
  const authorization = request.headers.get('authorization')
  if (!authorization?.toLowerCase().startsWith('bearer ')) {
    return NextResponse.json({ error: 'unauthorized', message: 'Send the Supabase access token as a Bearer token.' }, { status: 401 })
  }
  const accessToken = authorization.slice(7).trim()
  if (!accessToken) {
    return NextResponse.json({ error: 'unauthorized', message: 'The Bearer token is empty.' }, { status: 401 })
  }

  let response: Response
  try {
    response = await fetch(`${SUPABASE_URL.replace(/\/+$/, '')}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    })
  } catch (error) {
    return NextResponse.json(
      { error: 'auth_unreachable', message: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    )
  }
  if (!response.ok) {
    return NextResponse.json({ error: 'unauthorized', message: 'Supabase rejected the session token.' }, { status: 401 })
  }
  let user: unknown
  try {
    user = await response.json()
  } catch {
    return NextResponse.json({ error: 'auth_malformed', message: 'Supabase returned an unreadable user record.' }, { status: 502 })
  }
  const id = user && typeof user === 'object' ? (user as { id?: unknown }).id : undefined
  if (typeof id !== 'string' || !id.trim()) {
    return NextResponse.json({ error: 'auth_malformed', message: 'Supabase returned no user id.' }, { status: 502 })
  }
  const minted = mintRunnerToken(id)
  return NextResponse.json({ token: minted.token, expiresAt: minted.expiresAt })
}
