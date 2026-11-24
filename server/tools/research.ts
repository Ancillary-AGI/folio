/**
 * Research tool: fetch a public URL and return bounded text.
 *
 * This is what a datasheet lookup wants — the page that comes back is treated as
 * untrusted data and never interpreted by this backend. It is not an open proxy:
 * http/https only, capped bytes, text-like content types only, no credentials
 * forwarded, and a hard timeout. Bound to loopback like everything else here.
 */
import type { ServerResponse } from 'node:http'
import { HttpError, sendJson } from '../http/respond'

/** Hard cap on the response body, in bytes. */
export const RESEARCH_MAX_BYTES = 512 * 1024
/** Hard cap on the upstream request. */
export const RESEARCH_TIMEOUT_MS = 15_000

const TEXTUAL = /text|json|xml|html|markdown|javascript/i

export async function handleFetchText(res: ServerResponse, url: URL): Promise<void> {
  const target = url.searchParams.get('url')
  if (!target) throw new HttpError(400, 'Pass ?url=<https://…>', 'missing_url')

  let parsed: URL
  try {
    parsed = new URL(target)
  } catch {
    throw new HttpError(400, 'url did not parse', 'bad_url')
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new HttpError(400, 'Only http/https URLs are fetched', 'scheme_not_allowed')
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), RESEARCH_TIMEOUT_MS)

  try {
    const upstream = await fetch(parsed, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        accept: 'text/plain, text/html, application/json, application/xml, text/xml;q=0.9, */*;q=0.5',
      },
    })

    if (!upstream.ok) {
      throw new HttpError(502, `The remote replied ${upstream.status}`, 'upstream_status')
    }

    const contentType = upstream.headers.get('content-type') ?? ''
    const readable = TEXTUAL.test(contentType)
    if (!readable && contentType !== '') {
      throw new HttpError(415, `Refusing ${contentType} — only text-like content is fetched`, 'not_text')
    }

    const reader = upstream.body?.getReader()
    if (!reader) throw new HttpError(502, 'The remote replied with no body', 'no_body')

    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > RESEARCH_MAX_BYTES) {
        await reader.cancel()
        throw new HttpError(
          413,
          `Refused: body exceeds ${RESEARCH_MAX_BYTES} bytes`,
          'too_large',
        )
      }
      chunks.push(value)
    }

    const text = new TextDecoder('utf-8', { fatal: false }).decode(
      Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))),
    )
    sendJson(res, 200, {
      url: String(upstream.url),
      status: upstream.status,
      contentType,
      bytes: Buffer.byteLength(text),
      truncated: false,
      text,
    })
  } catch (error) {
    if (error instanceof HttpError) throw error
    const name = error instanceof Error ? error.name : ''
    throw new HttpError(
      502,
      name === 'AbortError'
        ? `The remote did not reply within ${RESEARCH_TIMEOUT_MS / 1000} s`
        : String(error instanceof Error ? error.message : error),
      name === 'AbortError' ? 'timeout' : 'fetch_failed',
    )
  } finally {
    clearTimeout(timer)
  }
}