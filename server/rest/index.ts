/**
 * PostgREST-compatible `/rest/v1/*` surface for the local backend.
 *
 * Every statement runs inside a transaction that first switches the role to
 * `authenticated` (or `anon`) and pins the caller's JWT claims in
 * `request.jwt.claims` — the same two-step PostgREST performs — so the access
 * decision for every row is made by PostgreSQL's own RLS policies and triggers,
 * never by this file. This is deliberately a small, refusal-happy translator,
 * not a reimplementation of PostgREST:
 *
 *   - tables and columns are checked against information_schema;
 *   - identifiers must match /^[a-z_][a-z0-9_]*$/;
 *   - values are written as escaped SQL literals, never concatenated raw;
 *   - any query shape it cannot translate exactly is refused with 400.
 *
 * Implemented: select (with count=exact / HEAD), insert (including upsert via
 * `Prefer: resolution=merge-duplicates`), update, delete, filters (eq, neq, gt,
 * gte, lt, lte, is, in), order, limit/offset, the Range header, object responses
 * for `Accept: vnd.pgrst.object+json`, and the RPCs the app calls.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Database, QueryParams } from '../db'
import { bearerToken, HttpError, readJson, sendJson } from '../http/respond'
import type { JwtPayload } from '../auth/jwt'
import { buildOrder, buildWhere, ident, literal, parseCountParam, type TableMeta } from './sql'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface RestHandlerOptions {
  db: Database
  verifyJwt: (token: string | null | undefined) => JwtPayload | null
  log?: (message: string, ...rest: unknown[]) => void
}

export interface RestHandler {
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>
  loadSchema(): Promise<void>
}

export function createRestHandler({ db, verifyJwt, log = () => {} }: RestHandlerOptions): RestHandler {
  /** table → { columns, pk } */
  const schema = new Map<string, TableMeta>()

  const loadSchema = async (): Promise<void> => {
    schema.clear()
    const tables = await db.query(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'`,
    )
    for (const { table_name: table } of tables.rows) {
      const name = String(table)
      const columns = await db.query(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = '${name.replace(/'/g, "''")}'`,
      )
      const pk = await db.query(
        `select kcu.column_name
           from information_schema.table_constraints tc
           join information_schema.key_column_usage kcu
             on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
          where tc.constraint_type = 'PRIMARY KEY'
            and tc.table_schema = 'public' and tc.table_name = '${name.replace(/'/g, "''")}'`,
      )
      schema.set(name, {
        columns: new Set(columns.rows.map((row) => String(row.column_name))),
        pk: pk.rows.map((row) => String(row.column_name)),
      })
    }
    log(`[rest] ${schema.size} tables in scope: ${[...schema.keys()].sort().join(', ')}`)
  }

  const projection = (selectParam: string | null, meta: TableMeta): string => {
    if (!selectParam || selectParam.trim() === '*') return '*'
    return selectParam
      .split(',')
      .map((raw) => {
        const column = raw.trim()
        if (!meta.columns.has(column)) throw new HttpError(400, `column ${column} does not exist`)
        return ident(column)
      })
      .join(', ')
  }

  const maybeRange = (
    req: IncomingMessage,
    searchParams: URLSearchParams,
  ): { offset?: number; limit?: number } => {
    const range = /^(?:items=)?(\d+)-(\d+)$/.exec(String(req.headers.range ?? '').trim())
    if (range && range[1] !== undefined && range[2] !== undefined) {
      const from = Number.parseInt(range[1], 10)
      const to = Number.parseInt(range[2], 10)
      return { offset: from, limit: Math.max(0, to - from + 1) }
    }
    return {
      offset: parseCountParam(searchParams.get('offset'), 'offset') ?? undefined,
      limit: parseCountParam(searchParams.get('limit'), 'limit') ?? undefined,
    }
  }

  const mapError = (res: ServerResponse, error: unknown): void => {
    const code = (error as { code?: string } | null)?.code
    const message = (error as { message?: string } | null)?.message ?? String(error)
    if (error instanceof HttpError) {
      sendJson(res, error.status, { code: error.code ?? 'PGRST', message })
      return
    }
    if (code === '42501') {
      sendJson(res, 403, { code, message })
      return
    }
    if (code === '23505' || code === '23503') {
      sendJson(res, 409, { code, message })
      return
    }
    if (code === '23502' || code === '22P02' || code === '22023' || code === 'P0001') {
      sendJson(res, 400, { code, message })
      return
    }
    log('[rest] unmapped database error:', error)
    sendJson(res, 500, { code: code ?? 'XX000', message })
  }

  const handleGet = async (
    tx: { query(sql: string, params?: QueryParams): Promise<{ rows: Record<string, unknown>[] }> },
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    table: string,
    meta: TableMeta,
    countExact: boolean,
    wantObject: boolean,
  ): Promise<void> => {
    const projectionSql = projection(url.searchParams.get('select'), meta)
    const where = buildWhere(url.searchParams, meta)
    const order = buildOrder(url.searchParams.get('order'), meta)
    const { offset, limit } = maybeRange(req, url.searchParams)
    const limitSql = limit != null ? ` limit ${limit}` : ''
    const offsetSql = offset != null ? ` offset ${offset}` : ''

    if (req.method === 'HEAD') {
      const counted = await tx.query(`select count(*)::bigint as total from ${ident(table)}${where}`)
      const total = counted.rows[0]?.total ?? 0
      res.writeHead(200, { 'content-range': `0-0/${String(total)}` })
      res.end()
      return
    }

    const rows = (
      await tx.query(
        `select ${projectionSql} from ${ident(table)}${where}${order}${limitSql}${offsetSql}`,
      )
    ).rows

    const headers: Record<string, string> = {}
    if (countExact) {
      const counted = await tx.query(`select count(*)::bigint as total from ${ident(table)}${where}`)
      const total = counted.rows[0]?.total ?? rows.length
      headers['content-range'] = `0-${Math.max(0, rows.length - 1)}/${String(total)}`
    }
    if (wantObject) {
      sendJson(res, 200, rows.length > 0 ? rows[0] : null, headers)
      return
    }
    sendJson(res, 200, rows, headers)
  }

  const handleInsert = async (
    tx: { query(sql: string, params?: QueryParams): Promise<{ rows: Record<string, unknown>[] }> },
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    table: string,
    meta: TableMeta,
    prefer: string,
    wantObject: boolean,
  ): Promise<void> => {
    const body = (await readJson(req)) as unknown
    if (body === null || (Array.isArray(body) && body.length === 0)) {
      throw new HttpError(400, 'Expected a JSON object or a non-empty array')
    }
    const rows = (Array.isArray(body) ? body : [body]) as Record<string, unknown>[]
    if (rows.some((row) => row === null || typeof row !== 'object' || Array.isArray(row))) {
      throw new HttpError(400, 'Every row must be a JSON object')
    }

    const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))]
    for (const column of columns) {
      if (!meta.columns.has(column)) throw new HttpError(400, `column ${column} does not exist`)
    }
    if (columns.length === 0) throw new HttpError(400, 'Every row must have at least one column')

    const projectionSql = projection(url.searchParams.get('select'), meta)
    const values = rows.map(
      (row) => `(${columns.map((column) => literal(row[column] ?? null)).join(', ')})`,
    )
    const merge = prefer.includes('resolution=merge-duplicates')
    const representation = prefer.includes('return=representation')
    const updatable = columns.filter((column) => !meta.pk.includes(column))
    const conflictSql =
      merge && meta.pk.length > 0
        ? ` on conflict (${meta.pk.map(ident).join(', ')}) do update set ${updatable
            .map((column) => `${ident(column)} = excluded.${ident(column)}`)
            .join(', ')}`
        : ''
    const returningSql = representation || wantObject ? ` returning ${projectionSql}` : ''

    const inserted = await tx.query(
      `insert into ${ident(table)} (${columns.map(ident).join(', ')}) values ${values.join(', ')}${conflictSql}${returningSql}`,
    )
    if (wantObject) {
      sendJson(res, 201, inserted.rows.length > 0 ? inserted.rows[0] : null)
      return
    }
    sendJson(res, 201, representation ? inserted.rows : [])
  }

  const handleUpdate = async (
    tx: { query(sql: string, params?: QueryParams): Promise<{ rows: Record<string, unknown>[] }> },
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    table: string,
    meta: TableMeta,
    prefer: string,
    wantObject: boolean,
  ): Promise<void> => {
    const body = (await readJson(req)) as Record<string, unknown> | null
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw new HttpError(400, 'Expected a JSON object')
    }
    const columns = Object.keys(body)
    if (columns.length === 0) throw new HttpError(400, 'Nothing to update')
    for (const column of columns) {
      if (!meta.columns.has(column)) throw new HttpError(400, `column ${column} does not exist`)
    }

    const where = buildWhere(url.searchParams, meta)
    const projectionSql = projection(url.searchParams.get('select'), meta)
    const representation = prefer.includes('return=representation')
    const returningSql = representation || wantObject ? ` returning ${projectionSql}` : ''
    const assignments = columns
      .map((column) => `${ident(column)} = ${literal(body[column] ?? null)}`)
      .join(', ')

    const updated = await tx.query(
      `update ${ident(table)} set ${assignments}${where}${returningSql}`,
    )
    if (wantObject) {
      sendJson(res, 200, updated.rows.length > 0 ? updated.rows[0] : null)
      return
    }
    sendJson(res, 200, representation ? updated.rows : [])
  }

  const handleDelete = async (
    tx: { query(sql: string, params?: QueryParams): Promise<{ rows: Record<string, unknown>[] }> },
    res: ServerResponse,
    url: URL,
    table: string,
    meta: TableMeta,
    prefer: string,
  ): Promise<void> => {
    const where = buildWhere(url.searchParams, meta)
    const representation = prefer.includes('return=representation')
    const deleted = await tx.query(
      `delete from ${ident(table)}${where}${representation ? ' returning *' : ''}`,
    )
    sendJson(res, 200, representation ? deleted.rows : [])
  }

  const handleRpc = async (
    tx: { query(sql: string, params?: QueryParams): Promise<{ rows: Record<string, unknown>[] }> },
    req: IncomingMessage,
    res: ServerResponse,
    path: string[],
  ): Promise<void> => {
    const name = path[1]
    if (name === 'admin_deployment_stats') {
      const result = await tx.query('select public.admin_deployment_stats() as result')
      const value = result.rows[0]?.result
      sendJson(res, 200, typeof value === 'string' ? (JSON.parse(value) as unknown) : value)
      return
    }
    if (name === 'bump_community_fork_count') {
      const body = (await readJson(req)) as { template_id?: unknown } | null
      const id = String(body?.template_id ?? '')
      if (!UUID.test(id)) throw new HttpError(400, 'template_id must be a uuid')
      await tx.query(`select public.bump_community_fork_count(${literal(id)}::uuid)`)
      res.writeHead(204)
      res.end()
      return
    }
    throw new HttpError(404, `Unknown function: ${name}`)
  }

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    // Strip the leading `rest/v1`.
    const path = url.pathname.split('/').filter(Boolean).slice(2)
    const payload = verifyJwt(bearerToken(req))
    const role = payload ? 'authenticated' : 'anon'
    const claims = payload
      ? JSON.stringify({ sub: payload.sub, aud: 'authenticated', role: 'authenticated' })
      : '{}'
    const prefer = String(req.headers.prefer ?? '')
    const wantObject = String(req.headers.accept ?? '').includes('vnd.pgrst.object+json')
    const countExact = prefer.includes('count=exact')

    try {
      await db.transaction(async (tx) => {
        await tx.query(`set local role ${role}`)
        await tx.query(`set local "request.jwt.claims" = ${literal(claims)}`)
        if (path[0] === 'rpc') {
          await handleRpc(tx, req, res, path)
          return
        }
        const table = path[0] ?? ''
        const meta = schema.get(table)
        if (!meta) throw new HttpError(404, `relation "${table}" does not exist`, '42P01')
        switch (req.method) {
          case 'GET':
          case 'HEAD':
            await handleGet(tx, req, res, url, table, meta, countExact, wantObject)
            return
          case 'POST':
            await handleInsert(tx, req, res, url, table, meta, prefer, wantObject)
            return
          case 'PATCH':
            await handleUpdate(tx, req, res, url, table, meta, prefer, wantObject)
            return
          case 'DELETE':
            await handleDelete(tx, res, url, table, meta, prefer)
            return
          default:
            throw new HttpError(405, `Method ${req.method} not allowed`)
        }
      })
    } catch (error) {
      if (res.headersSent) {
        log('[rest] error after response started:', error)
        res.end()
        return
      }
      mapError(res, error)
    }
  }

  return { handle, loadSchema }
}