import { describe, expect, it, vi } from 'vitest'
import { ModelCallError, generateText, listModels, streamGeneration, testConnection } from './client'
import type { GenerationRequest, ResolvedEndpoint } from './types'

const encoder = new TextEncoder()

/** An in-memory body: `readSse` only needs a reader-shaped object. */
function readerOf(chunks: Uint8Array[]) {
  let at = 0
  return {
    read: async () => (at < chunks.length ? { done: false as const, value: chunks[at++] } : { done: true as const, value: undefined }),
    cancel: async () => {},
    releaseLock: () => {},
  }
}

function responseOf(text: string, contentType = 'text/event-stream'): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => contentType },
    body: { getReader: () => readerOf(text ? [encoder.encode(text)] : []) },
    text: async () => text,
  } as unknown as Response
}

function errorResponse(status: number, body: string): Response {
  return {
    ok: false,
    status,
    headers: { get: () => 'application/json' },
    body: { getReader: () => readerOf([]) },
    text: async () => body,
  } as unknown as Response
}

/** A whole JSON body, which is how a `stream: true`-ignoring server answers. */
function jsonBody(text: string): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    body: { getReader: () => readerOf([]) },
    text: async () => text,
  } as unknown as Response
}

const sse = (...events: unknown[]) => `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}`
const stubFetch = (response: Response) => vi.fn(async () => response) as unknown as typeof fetch

const endpoint: ResolvedEndpoint = {
  providerId: 'openai',
  protocol: 'openai',
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'sk-test',
}

const request = (over: Partial<GenerationRequest> = {}): GenerationRequest => ({
  model: 'm',
  messages: [{ role: 'user', content: 'go' }],
  ...over,
})

describe('streaming a completion', () => {
  it('reassembles text and one tool call split across deltas', async () => {
    const body = sse(
      { choices: [{ delta: { content: 'Vout ' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'cad.simulate', arguments: '{"anal' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ysis":"dc"}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 40, completion_tokens: 7 } },
    )
    const answer = await generateText(endpoint, request(), { fetchImpl: stubFetch(responseOf(body)) })
    expect(answer.text).toBe('Vout ')
    expect(answer.toolCalls).toEqual([{ id: 'c1', name: 'cad.simulate', args: { analysis: 'dc' } }])
    expect(answer.usage).toEqual({ inputTokens: 40, outputTokens: 7 })
    expect(answer.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('delivers a truncated call as an unparsed blob, never as a plausible partial call', async () => {
    const body = sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'cad.movePart', arguments: '{"x"' } }] } }] })
    const calls: Array<{ name: string; args: Record<string, unknown> }> = []
    for await (const delta of streamGeneration(endpoint, request(), { fetchImpl: stubFetch(responseOf(body)) })) {
      if (delta.toolCall) calls.push(delta.toolCall)
    }
    expect(calls).toHaveLength(1)
    // The socket closed mid-arguments. Inventing `{x: undefined}` would let the
    // harness run a move with a made-up coordinate; the raw fragment is kept and
    // the required-parameter check in the harness rejects it out loud.
    expect(calls[0]).toEqual({ id: 'c1', name: 'cad.movePart', args: { __unparsed: '{"x"' } })
  })

  it('parses a body from a server that ignored stream: true', async () => {
    const whole = JSON.stringify({
      choices: [{ message: { content: 'done', tool_calls: [{ id: 'c9', function: { name: 'cad.erc', arguments: '{"deep":true}' } }] }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    })
    const answer = await generateText(endpoint, request(), { fetchImpl: stubFetch(responseOf(whole, 'application/json')) })
    expect(answer.text).toBe('done')
    expect(answer.toolCalls[0].args).toEqual({ deep: true })
    expect(answer.usage).toEqual({ inputTokens: 5, outputTokens: 2 })
  })

  it('flushes a final event that arrived without its blank line', async () => {
    const body = `${sse({ choices: [{ delta: { content: 'one' } }] })}data: {"choices":[{"delta":{"content":"two"}}]}`
    const answer = await generateText(endpoint, request(), { fetchImpl: stubFetch(responseOf(body)) })
    expect(answer.text).toBe('onetwo')
  })

  it('counts the largest usage report when a server sends it per chunk', async () => {
    const body = sse(
      { choices: [{ delta: {} }], usage: { prompt_tokens: 10, completion_tokens: 1 } },
      { choices: [{ delta: {} }], usage: { prompt_tokens: 10, completion_tokens: 4 } },
    )
    const answer = await generateText(endpoint, request(), { fetchImpl: stubFetch(responseOf(body)) })
    expect(answer.usage).toEqual({ inputTokens: 10, outputTokens: 4 })
  })
})

describe('failure reporting', () => {
  it('surfaces the provider message and status from an error body', async () => {
    const fetchImpl = stubFetch(errorResponse(401, JSON.stringify({ error: { message: 'Incorrect API key provided' } })))
    const error = await generateText(endpoint, request(), { fetchImpl }).catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(ModelCallError)
    expect((error as ModelCallError).status).toBe(401)
    expect((error as ModelCallError).message).toContain('Incorrect API key provided')
  })

  it('names CORS when a localhost server refuses the page origin', async () => {
    const local: ResolvedEndpoint = { ...endpoint, providerId: 'openai-compatible', baseUrl: 'http://127.0.0.1:11434/v1', apiKey: '' }
    const fetchImpl = vi.fn(async () => { throw new TypeError('Failed to fetch') }) as unknown as typeof fetch
    const error = await generateText(local, request(), { fetchImpl }).catch((cause: unknown) => cause)
    expect((error as ModelCallError).message).toContain('openai-compatible at 127.0.0.1:11434')
    // The user has to be told what to change, not just that something failed.
    expect((error as ModelCallError).hint).toContain('OLLAMA_ORIGINS')
  })

  it('lets an abort through untouched', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchImpl = vi.fn(async () => { throw new DOMException('Aborted', 'AbortError') }) as unknown as typeof fetch
    await expect(generateText(endpoint, request(), { fetchImpl, signal: controller.signal })).rejects.toThrow(/Aborted/)
  })

  it('reports an empty body instead of an empty answer', async () => {
    const response = { ok: true, status: 200, headers: { get: () => 'text/event-stream' }, body: null } as unknown as Response
    await expect(generateText(endpoint, request(), { fetchImpl: stubFetch(response) })).rejects.toThrow(/no response body/)
  })
})

describe('listing and testing a connection', () => {
  it('lists ids in a stable order', async () => {
    const response = jsonBody(JSON.stringify({ data: [{ id: 'zeta' }, { id: 'alpha' }] }))
    await expect(listModels(endpoint, { fetchImpl: stubFetch(response) })).resolves.toEqual(['alpha', 'zeta'])
  })

  it('proves a key by answering one token when the server will not list models', async () => {
    const list = errorResponse(404, 'no route')
    const chat = responseOf(sse({ choices: [{ delta: { content: 'ready' }, finish_reason: 'stop' }] }))
    let calls = 0
    const fetchImpl = vi.fn(async (url: string) => {
      calls += 1
      return String(url).endsWith('/models') ? list : chat
    }) as unknown as typeof fetch
    const result = await testConnection(endpoint, 'llama-local', { fetchImpl })
    expect(calls).toBe(2)
    expect(result.ok).toBe(true)
    expect(result.detail).toContain('answered')
    expect(result.models).toEqual(['llama-local'])
  })

  it('says plainly when there is nothing to call', async () => {
    const fetchImpl = stubFetch(errorResponse(404, 'no route'))
    const result = await testConnection(endpoint, '', { fetchImpl })
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('no model is selected')
  })

  it('reports the real answer and latency on a working endpoint', async () => {
    const models = jsonBody(JSON.stringify({ data: [{ id: 'gpt-x' }] }))
    const chat = responseOf(sse({ choices: [{ delta: { content: 'ready' }, finish_reason: 'stop' }] }))
    const fetchImpl = vi.fn(async (url: string) => (String(url).endsWith('/models') ? models : chat)) as unknown as typeof fetch
    const result = await testConnection(endpoint, '', { fetchImpl })
    expect(result.ok).toBe(true)
    expect(result.detail).toContain('"gpt-x"')
    expect(result.detail).toContain('"ready"')
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
  })
})
