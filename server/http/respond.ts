/**
 * HTTP plumbing shared by every route: body reading, JSON replies and CORS.
 *
 * The body reader enforces a byte cap before buffering, so a caller cannot make
 * the process allocate an unbounded string. `readJson` returns `null` for a body
 * that is not valid JSON — callers decide whether that is a 400 or a missing
 * parameter.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

/** Default request body cap. The REST layer streams rows, not documents. */
export const DEFAULT_BODY_LIMIT_BYTES = 1 << 20

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

/** Headers every response carries, including errors. */
export const CORS_HEADERS: Readonly<Record<string, string>> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS, HEAD',
  'access-control-allow-headers':
    'authorization, apikey, content-type, prefer, range, accept, accept-profile, content-profile, x-client-info, x-supabase-api-version, x-retry-count, x-upsert',
  'access-control-expose-headers': 'content-range, range',
  'access-control-max-age': '3600',
}

/** Send a JSON response. `undefined` produces an empty body. */
export function sendJson(
  res: ServerResponse,
  status: number,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...extraHeaders })
  res.end(body === undefined ? '' : JSON.stringify(body))
}

/** Send an empty response with the given status. */
export function sendEmpty(res: ServerResponse, status: number): void {
  res.writeHead(status)
  res.end()
}

/** Read the whole request body as UTF-8, refusing anything over `limit`. */
export function readBody(req: IncomingMessage, limit = DEFAULT_BODY_LIMIT_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new HttpError(413, `Request body exceeds ${limit} bytes`))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('error', reject)
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })
}

/** Parse a JSON request body, or `null` when it is absent or malformed. */
export async function readJson(req: IncomingMessage, limit?: number): Promise<unknown> {
  try {
    const raw = await readBody(req, limit)
    if (raw.trim() === '') return {}
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

/** The bearer token from the Authorization header, without verifying it. */
export function bearerToken(req: IncomingMessage): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization ?? ''))
  return match ? match[1] : null
}