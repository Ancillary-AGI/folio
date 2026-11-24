#!/usr/bin/env node
/**
 * Promote a local account to an operator role.
 *
 *   npm run backend:promote -- someone@example.com owner
 *
 * Roles are `owner`, `admin`, `engineer` and `viewer`. The value is validated
 * against a strict pattern before it reaches SQL, and the email is escaped, so a
 * stray quote cannot break out of the statement.
 */
import { createDb } from './db'

const ROLE = /^[a-z_][a-z_]*$/

interface ProfileRow {
  email: string
  role: string
  status: string
}

async function main(): Promise<void> {
  const email = process.argv[2] ?? 'doe@example.com'
  const role = process.argv[3] ?? 'owner'

  if (!ROLE.test(role)) {
    console.error('role must be a simple word (owner, admin, engineer, viewer)')
    process.exit(1)
  }

  const db = await createDb()
  try {
    await db.exec(
      `update public.profiles set role = '${role}' where email = '${email.replace(/'/g, "''")}'`,
    )
    const rows = await db.query('select email, role, status from public.profiles order by created_at')
    console.log(JSON.stringify(rows.rows as unknown as ProfileRow[], null, 2))
  } finally {
    await db.close()
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})