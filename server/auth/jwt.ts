/**
 * Session tokens: HS256 signing and verification.
 *
 * Deliberately small and dependency-free. The token is `base64url(header) +
 * "." + base64url(payload) + "." + base64url(HMAC-SHA256)`, which is what
 * GoTrue issues, so the same token is accepted by any client that speaks
 * Supabase auth.
 *
 * Verification compares signatures with `timingSafeEqual` and rejects an expired
 * `exp` claim. A token that fails either check yields `null` — callers treat that
 * as unauthenticated rather than throwing.
 */
import crypto from 'node:crypto'

export interface JwtPayload {
  /** Subject: the user id. */
  sub?: string
  aud?: string
  role?: string
  email?: string
  iat?: number
  exp?: number
  [claim: string]: unknown
}

const base64url = (input: Buffer | string): string => Buffer.from(input).toString('base64url')

const sign = (secret: string, data: string): Buffer =>
  crypto.createHmac('sha256', secret).update(data).digest()

/** Sign a payload into a compact HS256 token. */
export function signJwt(payload: JwtPayload, secret: string): string {
  const head = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = base64url(JSON.stringify(payload))
  const signature = sign(secret, `${head}.${body}`)
  return `${head}.${body}.${base64url(signature)}`
}

/** Verify signature and expiry, returning the payload or `null`. */
export function verifyJwt(token: string | null | undefined, secret: string): JwtPayload | null {
  const parts = String(token ?? '').split('.')
  if (parts.length !== 3) return null
  const [head, body, signature] = parts
  if (!head || !body || !signature) return null

  const expected = base64url(sign(secret, `${head}.${body}`))
  const actualBuf = Buffer.from(signature)
  const expectedBuf = Buffer.from(expected)
  // Length must match before timingSafeEqual, which throws otherwise.
  if (actualBuf.length !== expectedBuf.length) return null
  if (!crypto.timingSafeEqual(actualBuf, expectedBuf)) return null

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as JwtPayload
    if (typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now()) return null
    return payload
  } catch {
    return null
  }
}