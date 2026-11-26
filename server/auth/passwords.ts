/**
 * Password hashing: bcrypt at cost 12.
 *
 * A per-password salt is generated and used to derive the hash. bcrypt embeds
 * both the salt and the cost in the returned string, so the hash is all that
 * needs storing and verification needs no other input.
 */
import bcrypt from 'bcryptjs'

const ROUNDS = 12

export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(ROUNDS)
  return bcrypt.hash(password, salt)
}

/** False for anything that is not a bcrypt hash, rather than throwing. */
export async function verifyPassword(
  password: string,
  stored: string | null | undefined,
): Promise<boolean> {
  const value = String(stored ?? '')
  if (!value.startsWith('$2')) return false
  try {
    return await bcrypt.compare(password, value)
  } catch {
    return false
  }
}