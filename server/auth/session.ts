/**
 * Session issuance and the GoTrue user shape.
 *
 * `gotrueUser` produces exactly the object Supabase clients expect from
 * `/auth/v1/user`, including the `aud`/`role` claims and the metadata split
 * between `app_metadata` (set by the operator) and `user_metadata` (set by the
 * user at signup). Getting this shape wrong breaks the client's session handling
 * even when the token itself is valid.
 */
import crypto from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Database } from '../db'
import { bearerToken } from '../http/respond'
import { signJwt, verifyJwt, type JwtPayload } from './jwt'

/** A row from `auth.users`, as returned by the driver. */
export interface AuthUserRow {
  id: string
  email: string
  encrypted_password?: string | null
  email_confirmed_at?: Date | string | null
  last_sign_in_at?: Date | string | null
  created_at?: Date | string | null
  updated_at?: Date | string | null
  raw_user_meta_data?: Record<string, unknown> | null
}

export interface SessionOptions {
  accessTokenTtlSeconds: number
  refreshTokenTtlDays: number
  jwtSecret: string
}

const iso = (value: Date | string | null | undefined): string | null => {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

/** Shape a database row as the GoTrue user object. */
export function gotrueUser(row: AuthUserRow): Record<string, unknown> {
  return {
    id: row.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: row.email,
    email_confirmed_at: iso(row.email_confirmed_at),
    confirmed_at: iso(row.email_confirmed_at),
    phone: '',
    last_sign_in_at: iso(row.last_sign_in_at),
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: row.raw_user_meta_data ?? {},
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    is_anonymous: false,
  }
}

export interface IssuedSession {
  access_token: string
  token_type: 'bearer'
  expires_in: number
  refresh_token: string
  user: Record<string, unknown>
}

/** Mint an access token, store a refresh token, and return the session body. */
export async function issueSession(
  db: Database,
  row: AuthUserRow,
  options: SessionOptions,
): Promise<IssuedSession> {
  const now = Math.floor(Date.now() / 1000)
  const accessToken = signJwt(
    {
      aud: 'authenticated',
      role: 'authenticated',
      sub: row.id,
      email: row.email,
      iat: now,
      exp: now + options.accessTokenTtlSeconds,
    },
    options.jwtSecret,
  )
  const refreshToken = crypto.randomBytes(48).toString('base64url')

  await db.query(
    `insert into auth.refresh_tokens (token, user_id, expires_at)
     values ($1, $2, now() + ($3 || ' days')::interval)`,
    [refreshToken, row.id, String(options.refreshTokenTtlDays)],
  )
  await db.query('update auth.users set last_sign_in_at = now() where id = $1', [row.id])

  return {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: options.accessTokenTtlSeconds,
    refresh_token: refreshToken,
    user: gotrueUser({ ...row, last_sign_in_at: new Date() }),
  }
}

/** The verified payload from the request's bearer token, if any. */
export function authFromHeader(req: IncomingMessage, jwtSecret: string): JwtPayload | null {
  const token = bearerToken(req)
  return token ? verifyJwt(token, jwtSecret) : null
}