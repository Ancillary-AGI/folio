/**
 * Password hashing for the local identity store.
 *
 * scrypt with a per-password salt, stored as `s1$<salt>$<hash>` in
 * `auth.users.encrypted_password`. The scheme prefix exists so the parameters can
 * change later without a migration: verification reads the stored salt and hash
 * length and derives with the same cost, so old hashes keep working.
 *
 * Both hashing and verification use the synchronous API because the rest of the
 * signup path is synchronous database work; Node's scrypt is fast enough at this
 * cost (N=16384) that the event loop stall is not observable at this scale.
 */
import crypto from 'node:crypto'

const SCHEME = 's1'
const KEY_LENGTH = 32
const SALT_BYTES = 16
const COST = { N: 16384, r: 8, p: 1 } as const

/** Hash a password into the stored `s1$salt$hash` form. */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(SALT_BYTES)
  const hash = crypto.scryptSync(password, salt, KEY_LENGTH, COST)
  return `${SCHEME}$${salt.toString('base64')}$${hash.toString('base64')}`
}

/**
 * Check a password against a stored hash.
 *
 * Returns false for a malformed record rather than throwing: an unknown scheme
 * is a refusal, not a server error.
 */
export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  const [scheme, saltB64, hashB64] = String(stored ?? '').split('$')
  if (scheme !== SCHEME || !saltB64 || !hashB64) return false

  const salt = Buffer.from(saltB64, 'base64')
  const expected = Buffer.from(hashB64, 'base64')
  if (salt.length === 0 || expected.length === 0) return false

  const actual = crypto.scryptSync(password, salt, expected.length, COST)
  if (actual.length !== expected.length) return false
  return crypto.timingSafeEqual(actual, expected)
}