/**
 * The model client.
 *
 * One job: turn a provider-neutral request into a streamed answer with parsed
 * tool calls, and say honestly what went wrong when it does not. Nothing here
 * knows about schematics or agents — that lives in `src/lib/agents`, which calls
 * this through the settings store so a designer's provider choice is respected
 * everywhere at once.
 *
 * Two failure modes are handled explicitly because they are the ones people
 * actually hit:
 *   - a browser call to a local server that has not enabled CORS, which looks
 *     like a network error and is reported as such with the fix;
 *   - a server that ignores `stream: true` and answers with one JSON body,
 *     which is parsed rather than reported as an empty answer.
 */
import {
  buildChatRequest,
  buildListModelsRequest,
  parseChunk,
  parseModelIds,
  parseWholeResponse,
  type HttpRequest,
  type ResponseChunk,
} from './protocol'
import { readSse } from './sse'
import type {
  ConnectionTest,
  GenerationDelta,
  GenerationRequest,
  GenerationResult,
  ModelToolCall,
  ResolvedEndpoint,
} from './types'

export class ModelCallError extends Error {
  constructor(message: string, readonly status?: number, readonly hint?: string) {
    super(message)
    this.name = 'ModelCallError'
  }
}

interface CallOptions {
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

/** Pull a usable sentence out of an error body: providers put it in different places. */
function describeErrorBody(status: number, text: string): string {
  const trimmed = text.trim()
  try {
    const json = JSON.parse(trimmed) as Record<string, unknown>
    const nested = (json.error ?? json) as Record<string, unknown>
    const message = typeof nested?.message === 'string' ? nested.message : typeof json.detail === 'string' ? json.detail : trimmed
    return `${status}: ${message}`.slice(0, 400)
  } catch {
    return `${status}: ${trimmed.slice(0, 200) || 'no response body'}`
  }
}

async function send(endpoint: ResolvedEndpoint, http: HttpRequest, options: CallOptions): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch
  let response: Response
  try {
    response = await fetchImpl(http.url, {
      method: http.body === undefined ? 'GET' : 'POST',
      headers: http.headers,
      ...(http.body === undefined ? {} : { body: JSON.stringify(http.body) }),
      ...(options.signal ? { signal: options.signal } : {}),
    })
  } catch (error) {
    if (options.signal?.aborted) throw error
    const target = new URL(http.url)
    const detail = error instanceof Error ? error.message : String(error)
    throw new ModelCallError(
      `Could not reach ${endpoint.providerId} at ${target.host}.`,
      undefined,
      target.protocol === 'http:'
        ? 'A server on localhost must allow this page origin (CORS). For Ollama set OLLAMA_ORIGINS, for LM Studio enable "Enable CORS" in the server options.'
        : `The browser blocked or could not complete the request: ${detail}`,
    )
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new ModelCallError(describeErrorBody(response.status, text), response.status)
  }
  if (!response.body) throw new ModelCallError(`${endpoint.providerId} returned no response body.`)
  return response
}

function jsonOrEmpty(text: string): Record<string, unknown> {
  if (!text.trim()) return {}
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    // Some gateways append a truncation notice after the final JSON object.
    const cut = text.indexOf('}')
    if (cut > 0) {
      try {
        return JSON.parse(text.slice(0, cut + 1)) as Record<string, unknown>
      } catch {
        return {}
      }
    }
    return {}
  }
}

function parseArguments(text: string): Record<string, unknown> {
  if (!text.trim()) return {}
  try {
    const value = JSON.parse(text)
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : { value }
  } catch {
    // A truncated argument blob is a real answer the user must see, not a
    // swallowed exception: the harness rejects the unknown parameter and says so.
    return { __unparsed: text }
  }
}

/**
 * Reassembles streamed tool calls. Providers differ in how they slice a call
 * across deltas, so the rule is: a slice carrying an id or a name opens a slot,
 * anything else appends to the open slot, and a slot closes with parsed
 * arguments. Emitting a half-parsed call would let the harness act on a tool
 * name the model never finished typing.
 */
class ToolCallAccumulator {
  private readonly slots: { id: string; name: string; args: string; started: boolean }[] = []
  private readonly emitted: ModelToolCall[] = []

  private slot(index: number | undefined, opens: boolean): { id: string; name: string; args: string; started: boolean } {
    const at = index ?? (opens ? this.slots.length : this.slots.length - 1)
    if (at < 0) return this.slots[0] ?? (this.slots[0] = { id: '', name: '', args: '', started: false })
    if (!this.slots[at]) this.slots[at] = { id: '', name: '', args: '', started: false }
    return this.slots[at]
  }

  push(chunk: ResponseChunk): void {
    for (const call of chunk.toolCalls) {
      const opens = Boolean(call.id || call.name)
      const target = this.slot(chunk.toolCallIndex, opens)
      if (call.id) target.id = call.id
      if (call.name) {
        target.name = call.name
        target.started = true
      }
      if (Object.keys(call.args).length) {
        // Whole-call protocols (Gemini) hand over the object at once.
        target.args = JSON.stringify(call.args)
        target.started = true
      } else if (call.partialArguments) {
        target.args += call.partialArguments
      }
    }
    if (chunk.final) this.close()
  }

  close(): ModelToolCall[] {
    for (const slot of this.slots) {
      if (!slot.started || !slot.name) continue
      if (this.emitted.some((done) => done.id === slot.id && done.name === slot.name)) continue
      this.emitted.push({ id: slot.id || `call-${this.emitted.length + 1}`, name: slot.name, args: parseArguments(slot.args) })
    }
    return this.emitted
  }
}

/** Stream one completion. Text arrives live; tool calls arrive complete. */
export async function* streamGeneration(
  endpoint: ResolvedEndpoint,
  request: GenerationRequest,
  options: CallOptions = {},
): AsyncGenerator<GenerationDelta> {
  const http = buildChatRequest(endpoint.protocol, endpoint, request)
  const response = await send(endpoint, http, options)
  const accumulator = new ToolCallAccumulator()
  const emitted = new Set<string>()
  const contentType = response.headers.get('content-type') ?? ''

  const emitCalls = (calls: ModelToolCall[]): GenerationDelta[] =>
    calls
      .filter((call) => !emitted.has(`${call.name}#${call.id}`))
      .map((call) => {
        emitted.add(`${call.name}#${call.id}`)
        return { toolCall: call }
      })

  if (contentType.includes('json')) {
    // A server that ignored `stream: true` still has a complete answer in it.
    const chunk = parseWholeResponse(endpoint.protocol, jsonOrEmpty(await response.text()))
    if (chunk.text) yield { text: chunk.text }
    // Through the accumulator, not straight to the caller: in a whole OpenAI
    // body the arguments arrive as one JSON string, and emitting the raw chunk
    // would hand the harness a tool call with no parameters at all.
    accumulator.push(chunk)
    for (const delta of emitCalls(accumulator.close())) yield delta
    if (chunk.inputTokens !== undefined || chunk.outputTokens !== undefined) {
      yield { usage: { inputTokens: chunk.inputTokens ?? 0, outputTokens: chunk.outputTokens ?? 0 } }
    }
    return
  }

  const body = response.body
  if (!body) throw new Error(`${endpoint.protocol} returned no response body to stream`)
  for await (const event of readSse(body.getReader())) {
    if (event.data === '[DONE]') break
    const json = jsonOrEmpty(event.data)
    if (!Object.keys(json).length) continue
    const chunk = parseChunk(endpoint.protocol, json)
    accumulator.push(chunk)
    if (chunk.text) yield { text: chunk.text }
    if (chunk.inputTokens !== undefined || chunk.outputTokens !== undefined) {
      yield { usage: { inputTokens: chunk.inputTokens ?? 0, outputTokens: chunk.outputTokens ?? 0 } }
    }
    // A call's name arrives before its arguments are complete, so a slot is only
    // sealed when the provider says it is done — acting on a half-built call
    // would run a tool with the parameters the model had not yet sent.
    if (chunk.final) for (const delta of emitCalls(accumulator.close())) yield delta
  }
  for (const delta of emitCalls(accumulator.close())) yield delta
}

/** One completion, buffered. This is what the harness planner uses. */
export async function generateText(
  endpoint: ResolvedEndpoint,
  request: GenerationRequest,
  options: CallOptions = {},
): Promise<GenerationResult> {
  const startedAt = Date.now()
  let text = ''
  const toolCalls: ModelToolCall[] = []
  let inputTokens = 0
  let outputTokens = 0
  for await (const delta of streamGeneration(endpoint, request, options)) {
    if (delta.text) text += delta.text
    if (delta.toolCall) toolCalls.push(delta.toolCall)
    if (delta.usage) {
      // Providers send usage cumulatively or per chunk depending on the vendor;
      // taking the maximum of each is right in both cases.
      inputTokens = Math.max(inputTokens, delta.usage.inputTokens)
      outputTokens = Math.max(outputTokens, delta.usage.outputTokens)
    }
  }
  return { text, toolCalls, usage: { inputTokens, outputTokens }, latencyMs: Date.now() - startedAt }
}

export async function listModels(endpoint: ResolvedEndpoint, options: CallOptions = {}): Promise<string[]> {
  const http = buildListModelsRequest(endpoint.protocol, endpoint)
  const response = await send(endpoint, http, options)
  const json = jsonOrEmpty(await response.text())
  const ids = parseModelIds(json)
  return ids.sort()
}

/**
 * Does this key, at this URL, actually serve a model? Reported as what the
 * check found rather than a green tick: listing models proves the endpoint and
 * the credential, and a server with the list disabled still proves the key by
 * answering one token.
 */
export async function testConnection(endpoint: ResolvedEndpoint, model: string, options: CallOptions = {}): Promise<ConnectionTest> {
  const startedAt = Date.now()
  let models: string[] = []
  try {
    models = await listModels(endpoint, options)
  } catch {
    models = []
  }
  const probe = model || models[0]
  if (!probe) {
    return {
      ok: false,
      detail: `Reached ${endpoint.baseUrl} but no model is selected and the server would not list any.`,
      latencyMs: Date.now() - startedAt,
      models,
    }
  }
  try {
    const answer = await generateText(
      endpoint,
      { model: probe, messages: [{ role: 'user', content: 'Reply with the single word: ready' }], maxTokens: 8 },
      options,
    )
    const latencyMs = Date.now() - startedAt
    return {
      ok: true,
      detail: `"${probe}" answered in ${latencyMs} ms${answer.text.trim() ? `: "${answer.text.trim().slice(0, 40)}"` : ''}.`,
      latencyMs,
      models: models.length ? models : [probe],
    }
  } catch (error) {
    const detail = error instanceof ModelCallError ? `${error.message}${error.hint ? ` ${error.hint}` : ''}` : String(error)
    return { ok: false, detail, latencyMs: Date.now() - startedAt, models }
  }
}
