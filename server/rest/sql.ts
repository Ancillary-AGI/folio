/**
 * SQL construction helpers for the PostgREST translator.
 *
 * Every value that comes from a request goes through `literal`, and every
 * identifier through `ident`. Neither concatenates raw input: `ident` validates
 * against a strict pattern before quoting, and `literal` escapes by doubling
 * single quotes. That is the boundary the REST layer's safety rests on, so these
 * two functions are the only places a request string can become SQL.
 */
import { HttpError } from '../http/respond'

const IDENT = /^[a-z_][a-z0-9_]*$/

/** Quote a table or column name, refusing anything that is not a plain ident. */
export function ident(name: string): string {
  if (!IDENT.test(name)) throw new HttpError(400, `Illegal identifier: ${name}`)
  return `"${name}"`
}

/** Render a value as a SQL literal. This is the only path values take. */
export function literal(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new HttpError(400, 'Invalid number in value')
    return String(value)
  }
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (typeof value === 'object') {
    // jsonb columns receive the JSON document; an untyped literal is cast by
    // PostgreSQL to the column type. Single quotes inside strings are doubled.
    return `'${JSON.stringify(value).replace(/'/g, "''")}'`
  }
  return `'${String(value).replace(/'/g, "''")}'`
}

/** Coerce a filter's textual value to the type it looks like. */
export function castFilterValue(raw: string): unknown {
  const trimmed = raw.trim()
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed)) return Number(trimmed)
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed === 'null') return null
  return trimmed
}

const FILTER = /^(eq|neq|gt|gte|lt|lte|is|in)\.([\s\S]*)$/
const SQL_OP: Readonly<Record<string, string>> = {
  eq: '=',
  neq: '<>',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
}

export interface TableMeta {
  columns: Set<string>
  pk: string[]
}

/** Build the `where` clause from query parameters, or '' when there are none. */
export function buildWhere(
  searchParams: URLSearchParams,
  meta: TableMeta,
): string {
  const clauses: string[] = []
  for (const [column, raw] of searchParams) {
    if (column === 'select' || column === 'order' || column === 'limit' || column === 'offset') continue
    if (!meta.columns.has(column)) throw new HttpError(400, `column ${column} does not exist`)

    const match = FILTER.exec(raw)
    if (!match) throw new HttpError(400, `Unsupported filter on ${column}: ${raw}`)
    const [, op, rawValue] = match

    if (op === 'is') {
      const target =
        rawValue === 'null' ? 'NULL' : rawValue === 'true' ? 'TRUE' : rawValue === 'false' ? 'FALSE' : null
      if (target === null) throw new HttpError(400, `Unsupported is. value: ${rawValue}`)
      clauses.push(`${ident(column)} is ${target}`)
      continue
    }
    if (op === 'in') {
      const list = rawValue
        .replace(/^\(|\)$/g, '')
        .split(',')
        .map((part) => castFilterValue(part))
      if (list.length === 0 || list.length > 200) {
        throw new HttpError(400, `in.() list out of range on ${column}`)
      }
      clauses.push(`${ident(column)} in (${list.map(literal).join(', ')})`)
      continue
    }
    const sqlOp = SQL_OP[op]
    if (!sqlOp) throw new HttpError(400, `Unsupported operator on ${column}: ${op}`)
    clauses.push(`${ident(column)} ${sqlOp} ${literal(castFilterValue(rawValue))}`)
  }
  return clauses.length > 0 ? ` where ${clauses.join(' and ')}` : ''
}

/** Build the `order by` clause, defaulting to ascending. */
export function buildOrder(value: string | null, meta: TableMeta): string {
  if (!value) return ''
  const parts = value.split(',').map((part) => {
    const [column, direction = 'asc'] = part.trim().split('.')
    if (!column || !meta.columns.has(column)) {
      throw new HttpError(400, `column ${column ?? ''} does not exist`)
    }
    const dir = direction.toLowerCase() === 'desc' ? 'desc' : 'asc'
    return `${ident(column)} ${dir}`
  })
  return ` order by ${parts.join(', ')}`
}

/** Parse a non-negative integer query parameter. */
export function parseCountParam(value: string | null, name: string): number | null {
  if (value == null) return null
  if (!/^\d+$/.test(value)) throw new HttpError(400, `${name} must be a non-negative integer`)
  return Number.parseInt(value, 10)
}