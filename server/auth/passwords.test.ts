import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from './passwords'

describe('password hashing', () => {
  it('derives the hash from a generated salt and returns only the hash', async () => {
    const stored = await hashPassword('correct horse battery staple')
    // A bcrypt hash: $2b$<cost>$<22-char salt><31-char digest>, 60 chars.
    expect(stored).toMatch(/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/)
    expect(stored).toHaveLength(60)
  })

  it('generates a different salt each time', async () => {
    const first = await hashPassword('same password')
    const second = await hashPassword('same password')
    expect(first).not.toBe(second)
    // Same algorithm and cost; the salt is what differs.
    expect(first.split('$').slice(0, 3).join('$')).toBe(second.split('$').slice(0, 3).join('$'))
  })

  it('verifies the right password and refuses the wrong one', async () => {
    const stored = await hashPassword('s3cret-pass')
    await expect(verifyPassword('s3cret-pass', stored)).resolves.toBe(true)
    await expect(verifyPassword('S3cret-pass', stored)).resolves.toBe(false)
    await expect(verifyPassword('', stored)).resolves.toBe(false)
  })

  it('refuses anything that is not a bcrypt hash', async () => {
    for (const stored of ['', 'nonsense', 'b1$12$abc', 'md5$abc', '$1$old']) {
      await expect(verifyPassword('pw', stored)).resolves.toBe(false)
    }
    await expect(verifyPassword('pw', null)).resolves.toBe(false)
    await expect(verifyPassword('pw', undefined)).resolves.toBe(false)
  })
})