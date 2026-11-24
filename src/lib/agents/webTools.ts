/**
 * Research tools for the agent surface.
 *
 * A Folio agent can already read the sheet, run the solver and reason from
 * datasheets it was handed. These two tools add the missing reach: looking
 * something up. They exist only when the deployment has an HTTP origin that
 * serves `/tools/fetch-text` (the self-hosted backend, or a hosted proxy you
 * point the app at) — against a standalone build nothing is registered, so
 * the agent never claims a capability the build cannot perform.
 *
 * Nothing here retries, follows more than 5 redirects, executes fetched
 * content, or sends credentials. The fetched page is untrusted data, handed
 * to the model as text and nothing else.
 */
import type { AgentHarness, AgentTool } from './agentHarness'
import { parseDatasheetText } from '../ai/datasheetParser'

export interface WebFetchResult {
  url: string
  status: number
  contentType: string
  bytes: number
  truncated: boolean
  text: string
}

export type WebFetcher = (url: string, maxBytes?: number) => Promise<WebFetchResult>

const MAX_FETCH_BYTES = 512 * 1024

/** Fetch a URL through this deployment's own origin; undefined when none. */
export function makeDefaultWebFetcher(origin: string | undefined): WebFetcher | undefined {
  if (!origin) return undefined
  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    return undefined
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined
  const base = parsed.origin
  return async (url, maxBytes = MAX_FETCH_BYTES) => {
    if (maxBytes > MAX_FETCH_BYTES) throw new Error(`Refusing more than ${MAX_FETCH_BYTES} bytes`)
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new Error('That URL does not parse')
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('Only http/https URLs can be fetched')
    }
    const response = await fetch(`${base}/tools/fetch-text?url=${encodeURIComponent(parsed.href)}`, {
      headers: { accept: 'application/json' },
    })
    if (!response.ok) {
      let detail = ''
      try { detail = (await response.json() as { message?: string })?.message ?? '' } catch { /* body not json */ }
      throw new Error(detail || `The backend replied ${response.status}`)
    }
    const body = await response.json() as WebFetchResult
    if (!body || typeof body.text !== 'string') throw new Error('The backend returned no text')
    return body
  }
}

const toolError = (error: unknown): { ok: false; error: string } => ({
  ok: false,
  error: error instanceof Error ? error.message : String(error),
})

/**
 * The research toolset. `web.fetch` reads any public page the deployment can
 * reach; `web.datasheet` additionally parses the page as a datasheet and
 * returns the extracted part profile. Neither tool sees, follows, or acts
 * on anything but text.
 */
export function createWebTools(fetcher: WebFetcher): AgentTool[] {
  return [
    {
      name: 'web.fetch',
      description:
        'Fetch a public web page and return its text (capped, untrusted). Use for datasheets, reference designs, app notes and vendor pages. Content is returned verbatim; nothing is executed or interpreted by this tool.',
      parameters: { url: 'string', maxBytes: 'number' },
      optionalParameters: ['maxBytes'],
      needsApproval: false,
      handler: async (args) => {
        const url = String(args.url ?? '').trim()
        if (!url) throw new Error('url is required')
        try {
          const cap = typeof args.maxBytes === 'number' ? Math.max(1, Math.min(MAX_FETCH_BYTES, Math.floor(args.maxBytes))) : MAX_FETCH_BYTES
          const result = await fetcher(url, cap)
          return { ok: true, ...result }
        } catch (error) {
          return toolError(error)
        }
      },
    },
    {
      name: 'web.datasheet',
      description:
        'Fetch a datasheet URL and return its extracted profile: part number, manufacturer, pinout with directions, electrical headline values and the package with land-pattern dimensions. English documents with a pin table only; PDF pages give no usable text.',
      parameters: { url: 'string' },
      needsApproval: false,
      handler: async (args) => {
        const url = String(args.url ?? '').trim()
        if (!url) throw new Error('url is required')
        try {
          const fetched = await fetcher(url, MAX_FETCH_BYTES)
          const ingested = parseDatasheetText(fetched.text)
          return {
            ok: true,
            url: fetched.url,
            status: fetched.status,
            partNumber: ingested.partNumber,
            manufacturer: ingested.manufacturer,
            category: ingested.category,
            description: ingested.description,
            pins: ingested.pins.map((pin) => ({ number: pin.number, name: pin.name, kind: pin.kind, description: pin.description })),
            electrical: ingested.electrical,
            packaging: ingested.packaging,
            note: ingested.packaging.packageStated === false
              ? 'Package not stated in the source; defaults used for land pattern — verify before committing copper.'
              : 'Package stated in the source.',
          }
        } catch (error) {
          return toolError(error)
        }
      },
    },
  ]
}

/** Register the research toolset when — and only when — the deployment can serve it. */
export function registerWebTools(harness: AgentHarness, fetcher: WebFetcher | undefined): number {
  if (!fetcher) return 0
  for (const tool of createWebTools(fetcher)) harness.registerTool(tool)
  return 2
}
