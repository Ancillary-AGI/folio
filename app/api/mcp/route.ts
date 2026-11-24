import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { callMcpTool, listMcpTools, MCP_LIMITS } from '../../../src/lib/mcp/server'

/**
 * Folio MCP — the industry-standard agent endpoint.
 *
 * Transport: HTTP POST, JSON-RPC 2.0. The route is disabled unless
 * FOLIO_MCP_KEY is configured, and every request must send it as
 * `x-api-key`. There is deliberately no anonymous access and no default
 * credential: an endpoint that can simulate circuits is not a thing to
 * ship open-by-default.
 *
 * Only `tools/list` and `tools/call` exist today; `resources/*`,
 * `prompts/*`, `completion/*` and notifications arrive when there is a
 * real need, not for surface area.
 */

export const dynamic = 'force-dynamic'

const jsonRpcError = (id: unknown, code: number, message: string) =>
  NextResponse.json(
    { jsonrpc: '2.0', id: id ?? null, error: { code, message } },
    { status: 200 },
  )

/**
 * Compare a presented credential with the configured one without leaking its
 * length or prefix through timing. `timingSafeEqual` throws on unequal lengths,
 * so the length check has to come first — and it is not itself a secret.
 */
const credentialMatches = (presented: string | null, expected: string): boolean => {
  if (presented === null) return false
  const received = Buffer.from(presented, 'utf8')
  const wanted = Buffer.from(expected, 'utf8')
  if (received.length !== wanted.length) return false
  return timingSafeEqual(received, wanted)
}

export async function POST(request: NextRequest) {
  const configuredKey = process.env.FOLIO_MCP_KEY
  if (!configuredKey) {
    return NextResponse.json(
      { error: 'mcp_disabled', message: 'FOLIO_MCP_KEY is not configured on this deployment.' },
      { status: 503 },
    )
  }
  if (!credentialMatches(request.headers.get('x-api-key'), configuredKey)) {
    return NextResponse.json({ error: 'unauthorized', message: 'x-api-key does not match FOLIO_MCP_KEY.' }, { status: 401 })
  }

  /* The route reads the whole body, so cap it before parsing: an unauthenticated
   * or misconfigured caller must not be able to make the server buffer
   * arbitrary megabytes. */
  const declaredLength = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declaredLength) && declaredLength > MCP_LIMITS.maxBodyChars) {
    return NextResponse.json({ error: 'payload_too_large', message: `Request body exceeds ${MCP_LIMITS.maxBodyChars} characters.` }, { status: 413 })
  }
  const raw = await request.text()
  if (raw.length > MCP_LIMITS.maxBodyChars) {
    return NextResponse.json({ error: 'payload_too_large', message: `Request body exceeds ${MCP_LIMITS.maxBodyChars} characters.` }, { status: 413 })
  }

  let rpc: unknown
  try {
    rpc = JSON.parse(raw)
  } catch {
    return jsonRpcError(null, -32700, 'Parse error')
  }

  const envelope = rpc as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown }
  if (envelope?.jsonrpc !== '2.0') return jsonRpcError(envelope?.id, -32600, 'Invalid Request')
  const method = typeof envelope.method === 'string' ? envelope.method : ''

  switch (method) {
    case 'tools/list':
      return NextResponse.json({ jsonrpc: '2.0', id: envelope.id, result: { tools: listMcpTools() } })

    case 'tools/call': {
      const params = envelope.params as { name?: unknown; arguments?: unknown } | undefined
      const name = typeof params?.name === 'string' ? params.name : ''
      if (!name) return jsonRpcError(envelope.id, -32602, 'Missing tool name in params.name')
      let args: Record<string, unknown> = {}
      if (params?.arguments !== undefined) {
        if (typeof params.arguments !== 'object' || params.arguments === null || Array.isArray(params.arguments)) {
          return jsonRpcError(envelope.id, -32602, 'params.arguments must be an object')
        }
        args = params.arguments as Record<string, unknown>
      }
      try {
        const text = callMcpTool(name, args)
        return NextResponse.json({ jsonrpc: '2.0', id: envelope.id, result: { content: [{ type: 'text', text }], isError: false } })
      } catch (error) {
        return jsonRpcError(envelope.id, -32602, error instanceof Error ? error.message : String(error))
      }
    }

    default:
      return jsonRpcError(envelope.id, -32601, `Method not found: ${method}`)
  }
}
