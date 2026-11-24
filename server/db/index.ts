/**
 * Database factory for the local backend. Two modes, one interface:
 *
 *   embedded (default) — PGlite, a real PostgreSQL compiled to WASM, stored
 *   under .backend/pglite-data. Zero system dependencies; ideal for a single
   * machine and for trying Folio without installing anything.
 *
 *   external — pointed at any reachable PostgreSQL via FOLIO_PG. Use this for a
 *   deployment-grade self-host where PGlite's single connection is a bottleneck.
 *
 * Both modes apply the auth bootstrap, the migrations and the grants on start
 * (all idempotent), so a fresh checkout works with one command.
 */
import { readFileSync, readdirSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { repoRoot } from '../config'

/** A row set as returned by either driver. */
export interface QueryResult {
  rows: Record<string, unknown>[]
}

/** Parameters passed to a parameterised statement. */
export type QueryParams = readonly unknown[]

export interface Queryable {
  /** Run statements, ignoring any result. */
  exec(sql: string): Promise<unknown>
  /** Run a parameterised query and return its rows. */
  query(sql: string, params?: QueryParams): Promise<QueryResult>
}

/** A transaction handle: same surface as the database, scoped to one unit of work. */
export type Transaction = Queryable

export interface Database extends Queryable {
  readonly mode: 'pglite' | 'postgres'
  /** Run `work` inside a transaction, rolling back if it throws. */
  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T>
  close(): Promise<void>
}

export type Logger = (message: string) => void

interface Migration {
  name: string
  sql: string
}

const migrationSources = (): Migration[] =>
  readdirSync(join(repoRoot, 'supabase', 'migrations'))
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({
      name,
      sql: readFileSync(join(repoRoot, 'supabase', 'migrations', name), 'utf8'),
    }))

const readRelative = (...segments: string[]): string =>
  readFileSync(join(repoRoot, ...segments), 'utf8')

/**
 * Apply the auth bootstrap and any pending migration, tracking what has already
 * run in `public.schema_migrations`. Fresh databases get everything; databases
 * created by an earlier version of this backend are baselined (their migrations
 * are recorded as applied without re-running them — `CREATE POLICY` has no
 * `IF NOT EXISTS`, so re-applying would fail). Safe to run on every boot.
 */
async function applySchema(db: Queryable, log: Logger): Promise<void> {
  await db.exec(readRelative('server', 'bootstrap-auth.sql'))

  const hasTable = async (name: string): Promise<boolean> => {
    const result = await db.query('select to_regclass($1) is not null as exists', [`public.${name}`])
    return result.rows[0]?.exists === true
  }

  const hasProjects = await hasTable('projects')
  if (!(await hasTable('schema_migrations'))) {
    await db.exec(
      'create table public.schema_migrations (name text primary key, applied_at timestamptz not null default now())',
    )
    if (hasProjects) {
      log('[db] baselining pre-existing database (migrations already applied)')
      for (const migration of migrationSources()) {
        await db.query(
          'insert into public.schema_migrations(name) values ($1) on conflict do nothing',
          [migration.name],
        )
      }
    }
  }

  const applied = new Set(
    (await db.query('select name from public.schema_migrations')).rows.map((row) => String(row.name)),
  )
  for (const migration of migrationSources()) {
    if (applied.has(migration.name)) continue
    log(`[db] applying supabase/migrations/${migration.name}`)
    await db.exec('begin')
    try {
      await db.exec(migration.sql)
      await db.query('insert into public.schema_migrations(name) values ($1)', [migration.name])
      await db.exec('commit')
    } catch (error) {
      await db.exec('rollback').catch(() => {})
      throw error
    }
  }
  await db.exec(readRelative('server', 'grants.sql'))
}

/**
 * `node-postgres` types its rows as `any[]`, which is wider than the `Record`
 * shape the rest of the backend consumes. This is the single conversion point.
 */
const pgQuery = async (
  run: (sql: string, params?: readonly unknown[]) => Promise<{ rows: unknown[] }>,
  sql: string,
  params?: QueryParams,
): Promise<QueryResult> => ({ rows: (await run(sql, params)).rows as Record<string, unknown>[] })

async function createPostgresDatabase(connectionString: string): Promise<Database> {
  // Imported lazily so the embedded path never loads the driver.
  const { default: pg } = await import('pg')
  const pool = new pg.Pool({ connectionString, max: 4 })

  const client = await pool.connect()
  try {
    await applySchema(
      {
        exec: async (sql) => {
          await client.query(sql)
        },
        query: async (sql, params) =>
          pgQuery((text, values) => client.query(text, values as unknown[] | undefined), sql, params),
      },
      console.log,
    )
  } finally {
    client.release()
  }

  return {
    mode: 'postgres',
    exec: async (sql) => {
      await pool.query(sql)
    },
    query: (sql, params) =>
      pgQuery((text, values) => pool.query(text, values as unknown[] | undefined), sql, params),
    transaction: async (work) => {
      const txClient = await pool.connect()
      try {
        await txClient.query('BEGIN')
        const tx: Transaction = {
          exec: async (sql) => {
            await txClient.query(sql)
          },
          query: (sql, params) =>
            pgQuery(
              (text, values) => txClient.query(text, values as unknown[] | undefined),
              sql,
              params,
            ),
        }
        const result = await work(tx)
        await txClient.query('COMMIT')
        return result
      } catch (error) {
        await txClient.query('ROLLBACK').catch(() => {})
        throw error
      } finally {
        txClient.release()
      }
    },
    close: () => pool.end(),
  }
}

async function createPgliteDatabase(dataDir: string): Promise<Database> {
  const { PGlite } = await import('@electric-sql/pglite')
  mkdirSync(dataDir, { recursive: true })
  const db = await PGlite.create({ dataDir })

  const queryable: Queryable = {
    exec: async (sql) => {
      await db.exec(sql)
    },
    query: async (sql, params) => ({
      rows: (await db.query(sql, params as unknown[] | undefined)).rows as Record<string, unknown>[],
    }),
  }
  await applySchema(queryable, console.log)

  return {
    mode: 'pglite',
    ...queryable,
    transaction: async <T,>(work: (tx: Transaction) => Promise<T>): Promise<T> => {
      let result: T | undefined
      await db.transaction(async (tx) => {
        result = await work({
          exec: async (sql) => {
            await tx.exec(sql)
          },
          query: async (sql, params) => ({
            rows: (await tx.query(sql, params as unknown[] | undefined)).rows as Record<
              string,
              unknown
            >[],
          }),
        })
      })
      return result as T
    },
    close: async () => {
      await db.close()
    },
  }
}

/** Open the configured database and bring its schema up to date. */
export async function createDb(
  dataDir: string = process.env.FOLIO_DATA_DIR?.trim() || join(repoRoot, '.backend', 'pglite-data'),
): Promise<Database> {
  const connectionString = process.env.FOLIO_PG?.trim()
  if (connectionString) return createPostgresDatabase(connectionString)
  return createPgliteDatabase(dataDir)
}