#!/usr/bin/env node
/**
 * Apply the auth bootstrap and every migration to a plain PostgreSQL database.
 *
 * Run this after creating a database for the local backend. Idempotent by
 * construction: each statement is applied inside a transaction, and the
 * migrations themselves use `if not exists` / guarded policies.
 *
 *   npm run backend:db
 *
 * Environment:
 *   FOLIO_PG  postgres connection string for a superuser.
 *             Default: postgres://postgres:folio-dev-only-2026@127.0.0.1:5432/postgres
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { repoRoot } from './config'

const connectionString =
  process.env.FOLIO_PG ?? 'postgres://postgres:folio-dev-only-2026@127.0.0.1:5432/postgres'

interface DatabaseCounts {
  users: string
  projects: string
  profiles: string
  tables: string
}

async function main(): Promise<void> {
  const client = new pg.Client({ connectionString })
  await client.connect()

  const apply = async (label: string, sql: string): Promise<void> => {
    process.stdout.write(`applying ${label} ... `)
    try {
      await client.query('begin')
      await client.query(sql)
      await client.query('commit')
      process.stdout.write('ok\n')
    } catch (error) {
      await client.query('rollback')
      console.error('FAILED')
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
      throw error
    }
  }

  try {
    await apply(
      'server/bootstrap-auth.sql',
      readFileSync(join(repoRoot, 'server', 'bootstrap-auth.sql'), 'utf8'),
    )

    const migrations = readdirSync(join(repoRoot, 'supabase', 'migrations'))
      .filter((name) => name.endsWith('.sql'))
      .sort()
    for (const name of migrations) {
      await apply(
        `supabase/migrations/${name}`,
        readFileSync(join(repoRoot, 'supabase', 'migrations', name), 'utf8'),
      )
    }
    await apply('server/grants.sql', readFileSync(join(repoRoot, 'server', 'grants.sql'), 'utf8'))

    const counts = await client.query<DatabaseCounts>(
      `select
         (select count(*) from auth.users) as users,
         (select count(*) from public.projects) as projects,
         (select count(*) from public.profiles) as profiles,
         (select count(*) from information_schema.tables
           where table_schema = 'public') as tables`,
    )
    console.log('database ready:', counts.rows[0])
  } finally {
    await client.end()
  }
}

void main().catch(() => {
  /* The failure has already been reported by `apply`. */
})