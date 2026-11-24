/**
 * GoTrue-compatible `/auth/v1/*` routes.
 *
 * Only the email-and-password flow is implemented, because that is what a
 * self-hosted deployment can actually complete without a registered OAuth app.
 * `/authorize` therefore answers honestly in the browser rather than returning a
 * bare JSON error, and `/settings` reports which providers exist.
 *
 * Sign-in is rate-limited by the identity service in the hosted product; here the
 * guard is that an unknown account and a wrong password return the *same*
 * refusal, so the endpoint is not an account-enumeration oracle.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Database } from '../db'
import { readJson, sendJson } from '../http/respond'
import {
  authFromHeader,
  gotrueUser,
  issueSession,
  type AuthUserRow,
  type SessionOptions,
} from './session'
import { hashPassword, verifyPassword } from './passwords'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const MIN_PASSWORD_LENGTH = 6

export interface AuthContext {
  db: Database
  options: SessionOptions
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const fail = (res: ServerResponse, status: number, error: string, description: string): void => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify({ error, error_description: description, msg: description }))
}

const unauthorized = (res: ServerResponse): void => {
  res.writeHead(401, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify({ code: 401, msg: 'Invalid JWT', error_code: 'bad_jwt' }))
}

/** Minimal escaping for the value interpolated into the HTML page below. */
const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      default:
        return '&#39;'
    }
  })

export async function handleSignup(
  ctx: AuthContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = asRecord(await readJson(req))
  const email = String(body?.email ?? '').trim()
  const password = String(body?.password ?? '')

  if (!EMAIL.test(email)) return fail(res, 400, 'email_address_invalid', 'Invalid email address')
  if (password.length < MIN_PASSWORD_LENGTH) {
    return fail(
      res,
      400,
      'weak_password',
      `Password should be at least ${MIN_PASSWORD_LENGTH} characters`,
    )
  }

  const existing = await ctx.db.query(
    'select id from auth.users where lower(email) = lower($1)',
    [email],
  )
  if (existing.rows.length > 0) {
    return fail(res, 400, 'user_already_exists', 'User already registered')
  }

  // Accept either the flat `data` or GoTrue's `options.data` metadata shape.
  const metadata = body?.data ?? asRecord(body?.options)?.data ?? {}
  const result = await ctx.db.query(
    `insert into auth.users (email, encrypted_password, email_confirmed_at, raw_user_meta_data, last_sign_in_at)
     values ($1, $2, now(), $3::jsonb, now())
     returning *`,
    [email, hashPassword(password), JSON.stringify(metadata)],
  )

  // GoTrue with autoconfirm returns the session object on signup.
  const session = await issueSession(ctx.db, result.rows[0] as unknown as AuthUserRow, ctx.options)
  sendJson(res, 200, session)
}

export async function handleToken(
  ctx: AuthContext,
  req: IncomingMessage,
  res: ServerResponse,
  grantType: string | null,
): Promise<void> {
  const body = asRecord(await readJson(req))

  if (grantType === 'refresh_token') {
    const token = String(body?.refresh_token ?? '')
    if (!token) {
      return fail(res, 400, 'refresh_token_not_found', 'Missing refresh token')
    }
    const found = await ctx.db.query(
      `select users.*
         from auth.refresh_tokens as tokens
         join auth.users as users on users.id = tokens.user_id
        where tokens.token = $1 and tokens.expires_at > now()`,
      [token],
    )
    if (found.rows.length === 0) {
      return fail(res, 400, 'invalid_grant', 'Invalid refresh token')
    }
    // Refresh tokens are single-use: rotate on every redemption.
    await ctx.db.query('delete from auth.refresh_tokens where token = $1', [token])
    const session = await issueSession(ctx.db, found.rows[0] as unknown as AuthUserRow, ctx.options)
    sendJson(res, 200, session)
    return
  }

  if (grantType !== 'password') {
    return fail(res, 400, 'unsupported_grant_type', `Unsupported grant type: ${grantType ?? ''}`)
  }

  const email = String(body?.email ?? '').trim()
  const password = String(body?.password ?? '')
  const result = await ctx.db.query('select * from auth.users where lower(email) = lower($1)', [email])
  const row = result.rows[0] as unknown as AuthUserRow | undefined

  // One refusal for both cases: unknown account and wrong password.
  if (!row || !verifyPassword(password, row.encrypted_password)) {
    return fail(res, 400, 'invalid_grant', 'Invalid login credentials')
  }
  const session = await issueSession(ctx.db, row, ctx.options)
  sendJson(res, 200, session)
}

export async function handleLogout(
  ctx: AuthContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const payload = authFromHeader(req, ctx.options.jwtSecret)
  if (payload?.sub) {
    await ctx.db
      .query('delete from auth.refresh_tokens where user_id = $1', [payload.sub])
      .catch(() => {})
  }
  res.writeHead(204)
  res.end()
}

export async function handleUser(
  ctx: AuthContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const payload = authFromHeader(req, ctx.options.jwtSecret)
  if (!payload?.sub) return unauthorized(res)

  const result = await ctx.db.query('select * from auth.users where id = $1', [payload.sub])
  const row = result.rows[0] as unknown as AuthUserRow | undefined
  if (!row) return unauthorized(res)

  sendJson(res, 200, gotrueUser(row))
}

export function handleSettings(res: ServerResponse): void {
  sendJson(res, 200, {
    app_settings: {},
    external: { email: true, google: false, github: false },
    mailer_autoconfirm: true,
    disable_signup: false,
  })
}

export function handleAuthorize(res: ServerResponse, url: URL): void {
  const provider = url.searchParams.get('provider') ?? 'this provider'
  /* OAuth needs a registered provider with the hosted identity service; a local
   * email/password backend cannot complete it. Say so in the browser instead of
   * dropping into a bare JSON error. */
  res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' })
  res.end(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Sign-in unavailable</title>` +
      `<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#0b0b0f;color:#e7e7ea}` +
      `main{max-width:34rem;padding:2rem}a{color:#8ab4ff}</style></head>` +
      `<body><main><h1 style="font-size:1.25rem">${escapeHtml(provider)} sign-in is not available here</h1>` +
      `<p>This self-hosted Folio backend does email and password only — ${escapeHtml(
        provider,
      )} OAuth requires a hosted identity provider with registered apps.</p>` +
      `<p><a href="/app">Back to Folio and sign in with your email and password</a></p></main></body></html>`,
  )
}