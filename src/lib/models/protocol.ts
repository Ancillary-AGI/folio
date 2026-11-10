/**
 * Wire translation for the three chat protocols Folio speaks.
 *
 * One file, three small mappers, so adding a vendor means adding a case here and
 * nothing anywhere else: the harness, the panel and the store all work with the
 * provider-neutral shapes in `types.ts`.
 */
import type {
  GenerationRequest,
  ModelToolCall,
  ResolvedEndpoint,
  ToolSpec,
  WireProtocol,
} from './types'

export interface HttpRequest {
  url: string
  headers: Record<string, string>
  body?: unknown
}

/** A chunk of a response, however it arrived: whole JSON or one SSE event. */
export interface ResponseChunk {
  text: string
  toolCalls: ModelToolCall[]
  inputTokens?: number
  outputTokens?: number
  /**
   * Slot the tool calls in this chunk belong to. OpenAI streams arguments for
   * one call across several deltas with the same index; Anthropic keys them by
   * content block. Without it the client cannot tell a continuation from a
   * second call.
   */
  toolCallIndex?: number
  /** False for a delta that is still accumulating arguments. */
  final?: boolean
}

const JSON_OBJECT_TOOL_SCHEMA = (tool: ToolSpec) => {
  const required = Object.keys(tool.parameters).filter((name) => !(tool.optionalParameters ?? []).includes(name))
  const typeOf = (t: 'string' | 'number' | 'boolean') => (t === 'number' ? 'number' : t)
  return {
    type: 'object',
    properties: Object.fromEntries(
      Object.entries(tool.parameters).map(([name, type]) => [name, { type: typeOf(type), description: name }]),
    ),
    required,
  }
}

/* ────────────────────────────── request ────────────────────────────── */

function authHeaders(protocol: WireProtocol, endpoint: ResolvedEndpoint): Record<string, string> {
  switch (protocol) {
    case 'anthropic':
      return {
        'x-api-key': endpoint.apiKey,
        'anthropic-version': '2023-06-01',
        // Anthropic blocks browser calls unless this is set explicitly; without
        // it a perfectly good key looks like a network failure.
        'anthropic-dangerous-direct-browser-access': 'true',
      }
    case 'gemini':
      // Gemini takes the key in the query string, so the header stays empty.
      return {}
    default:
      return endpoint.apiKey ? { Authorization: `Bearer ${endpoint.apiKey}` } : {}
  }
}

function openaiRequest(endpoint: ResolvedEndpoint, request: GenerationRequest): HttpRequest {
  const messages: unknown[] = []
  for (const message of request.messages) {
    if (message.role === 'tool') {
      messages.push({ role: 'tool', tool_call_id: message.toolCallId ?? 'call', content: message.content })
      continue
    }
    if (message.role === 'assistant' && message.toolCalls?.length) {
      messages.push({
        role: 'assistant',
        content: message.content || null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.args) },
        })),
      })
      continue
    }
    messages.push({ role: message.role, content: message.content })
  }
  const body: Record<string, unknown> = {
    model: request.model,
    messages,
    stream: true,
  }
  if (request.tools?.length) {
    body.tools = request.tools.map((tool) => ({
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: JSON_OBJECT_TOOL_SCHEMA(tool) },
    }))
  }
  if (request.temperature !== undefined) body.temperature = request.temperature
  if (request.maxTokens) body.max_tokens = request.maxTokens
  if (request.reasoningEffort && request.reasoningEffort !== 'off') body.reasoning_effort = request.reasoningEffort
  return {
    url: `${endpoint.baseUrl}/chat/completions`,
    headers: { 'Content-Type': 'application/json', ...authHeaders('openai', endpoint) },
    body,
  }
}

function anthropicRequest(endpoint: ResolvedEndpoint, request: GenerationRequest): HttpRequest {
  const system = request.messages.filter((message) => message.role === 'system').map((message) => message.content)
  const messages: unknown[] = []
  for (const message of request.messages) {
    if (message.role === 'system') continue
    if (message.role === 'tool') {
      messages.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: message.toolCallId ?? 'call', content: message.content }],
      })
      continue
    }
    if (message.role === 'assistant' && message.toolCalls?.length) {
      messages.push({
        role: 'assistant',
        content: [
          ...(message.content ? [{ type: 'text', text: message.content }] : []),
          ...message.toolCalls.map((call) => ({ type: 'tool_use', id: call.id, name: call.name, input: call.args })),
        ],
      })
      continue
    }
    messages.push({ role: message.role, content: message.content })
  }
  const body: Record<string, unknown> = {
    model: request.model,
    messages,
    max_tokens: request.maxTokens ?? 4096,
    stream: true,
  }
  if (system.length) body.system = system.join('\n\n')
  if (request.temperature !== undefined) body.temperature = request.temperature
  if (request.tools?.length) {
    body.tools = request.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: JSON_OBJECT_TOOL_SCHEMA(tool),
    }))
  }
  return {
    url: `${endpoint.baseUrl}/messages`,
    headers: { 'Content-Type': 'application/json', ...authHeaders('anthropic', endpoint) },
    body,
  }
}

function geminiRequest(endpoint: ResolvedEndpoint, request: GenerationRequest): HttpRequest {
  const system = request.messages.filter((message) => message.role === 'system').map((message) => message.content)
  const contents = request.messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [
        ...(message.content ? [{ text: message.content }] : []),
        ...(message.toolCalls ?? []).map((call) => ({ functionCall: { name: call.name, args: call.args } })),
        ...(message.role === 'tool' ? [{ functionResponse: { name: message.toolCallId ?? 'call', response: { result: message.content } } }] : []),
      ],
    }))
  const body: Record<string, unknown> = { contents }
  if (system.length) body.systemInstruction = { parts: [{ text: system.join('\n\n') }] }
  const generationConfig: Record<string, unknown> = {}
  if (request.temperature !== undefined) generationConfig.temperature = request.temperature
  if (request.maxTokens) generationConfig.maxOutputTokens = request.maxTokens
  if (request.reasoningEffort && request.reasoningEffort !== 'off' && request.reasoningEffort !== 'low') {
    // Gemini only accepts a boolean thinking flag; anything deliberate is on.
    generationConfig.thinkingConfig = { includeThoughts: true }
  }
  if (Object.keys(generationConfig).length) body.generationConfig = generationConfig
  if (request.tools?.length) {
    body.tools = [{
      functionDeclarations: request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: JSON_OBJECT_TOOL_SCHEMA(tool),
      })),
    }]
  }
  const key = endpoint.apiKey ? `&key=${encodeURIComponent(endpoint.apiKey)}` : ''
  return {
    url: `${endpoint.baseUrl}/models/${encodeURIComponent(request.model)}:streamGenerateContent?alt=sse${key}`,
    headers: { 'Content-Type': 'application/json' },
    body,
  }
}

export function buildChatRequest(protocol: WireProtocol, endpoint: ResolvedEndpoint, request: GenerationRequest): HttpRequest {
  if (protocol === 'anthropic') return anthropicRequest(endpoint, request)
  if (protocol === 'gemini') return geminiRequest(endpoint, request)
  return openaiRequest(endpoint, request)
}

/** Model catalogue endpoint, used by "test connection". */
export function buildListModelsRequest(protocol: WireProtocol, endpoint: ResolvedEndpoint): HttpRequest {
  if (protocol === 'gemini') {
    const key = endpoint.apiKey ? `?key=${encodeURIComponent(endpoint.apiKey)}` : ''
    return { url: `${endpoint.baseUrl}/models${key}`, headers: {} }
  }
  return { url: `${endpoint.baseUrl}/models`, headers: authHeaders(protocol, endpoint) }
}

export function parseModelIds(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return []
  const record = payload as Record<string, unknown>
  const list = Array.isArray(record.data) ? record.data : Array.isArray(record.models) ? record.models : []
  const ids = list
    .map((entry) => {
      if (typeof entry === 'string') return entry
      const item = entry as Record<string, unknown>
      const raw = (item.id ?? item.name ?? '') as string
      // Gemini reports `models/gemini-2.5-flash`; the API wants the last segment.
      return raw.split('/').pop() ?? raw
    })
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
  return [...new Set(ids)]
}

/* ───────────────────────────── response ────────────────────────────── */

function openaiChunk(json: Record<string, unknown>): ResponseChunk {
  const choice = (Array.isArray(json.choices) ? json.choices : [])[0] as Record<string, unknown> | undefined
  if (!choice) return { text: '', toolCalls: [] }
  const delta = (choice.delta ?? choice.message ?? {}) as Record<string, unknown>
  const toolCalls: ModelToolCall[] = []
  let toolCallIndex: number | undefined
  for (const raw of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
    const call = raw as Record<string, unknown>
    const fn = (call.function ?? {}) as Record<string, unknown>
    const partial = typeof fn.arguments === 'string' ? fn.arguments : ''
    if (typeof call.index === 'number') toolCallIndex = call.index
    toolCalls.push({
      // An empty id means a continuation of the slot, not a new call: the client
      // reassembles and a bare id here would invent a call that never was.
      id: typeof call.id === 'string' ? call.id : '',
      name: typeof fn.name === 'string' ? fn.name : '',
      args: {},
      ...(partial ? { partialArguments: partial } : {}),
    })
  }
  const usage = json.usage as Record<string, unknown> | undefined
  return {
    text: typeof delta.content === 'string' ? delta.content : '',
    toolCalls,
    toolCallIndex,
    inputTokens: typeof usage?.prompt_tokens === 'number' ? usage.prompt_tokens : undefined,
    outputTokens: typeof usage?.completion_tokens === 'number' ? usage.completion_tokens : undefined,
    final: Boolean(choice.finish_reason),
  }
}

function anthropicChunk(json: Record<string, unknown>): ResponseChunk {
  const type = json.type
  const blockIndex = typeof json.index === 'number' ? json.index : undefined
  if (type === 'message_stop' || type === 'content_block_stop') return { text: '', toolCalls: [], final: true }
  if (type === 'message_start') {
    const usage = (json.message as Record<string, unknown> | undefined)?.usage as Record<string, unknown> | undefined
    return { text: '', toolCalls: [], inputTokens: typeof usage?.input_tokens === 'number' ? usage.input_tokens : undefined }
  }
  if (type === 'delta') {
    const usage = json.usage as Record<string, unknown> | undefined
    return { text: '', toolCalls: [], outputTokens: typeof usage?.output_tokens === 'number' ? usage.output_tokens : undefined }
  }
  const block = json.content_block as Record<string, unknown> | undefined
  if (block?.type === 'tool_use') {
    return { text: '', toolCalls: [{ id: String(block.id ?? ''), name: String(block.name ?? ''), args: (block.input ?? {}) as Record<string, unknown> }], toolCallIndex: blockIndex }
  }
  const partial = json.delta as Record<string, unknown> | undefined
  if (partial?.type === 'text_delta') return { text: String(partial.text ?? ''), toolCalls: [] }
  if (partial?.type === 'input_json_delta') {
    return {
      text: '',
      toolCalls: [{ id: '', name: '', args: {}, partialArguments: String(partial.partial_json ?? '') }],
      toolCallIndex: blockIndex,
    }
  }
  return { text: '', toolCalls: [] }
}

function geminiChunk(json: Record<string, unknown>): ResponseChunk {
  const candidate = (Array.isArray(json.candidates) ? json.candidates : [])[0] as Record<string, unknown> | undefined
  const content = candidate?.content as Record<string, unknown> | undefined
  const parts = Array.isArray(content?.parts) ? (content.parts as unknown[]) : []
  const toolCalls: ModelToolCall[] = []
  let text = ''
  for (const raw of parts) {
    const part = raw as Record<string, unknown>
    if (typeof part.text === 'string' && !part.thought) text += part.text
    const call = part.functionCall as Record<string, unknown> | undefined
    if (call) toolCalls.push({ id: String(call.name ?? ''), name: String(call.name ?? ''), args: (call.args ?? {}) as Record<string, unknown> })
  }
  const usage = json.usageMetadata as Record<string, unknown> | undefined
  return {
    text,
    toolCalls,
    inputTokens: typeof usage?.promptTokenCount === 'number' ? usage.promptTokenCount : undefined,
    outputTokens: typeof usage?.candidatesTokenCount === 'number' ? usage.candidatesTokenCount : undefined,
    final: Boolean(candidate?.finishReason),
  }
}

export function parseChunk(protocol: WireProtocol, json: Record<string, unknown>): ResponseChunk {
  if (protocol === 'anthropic') return anthropicChunk(json)
  if (protocol === 'gemini') return geminiChunk(json)
  return openaiChunk(json)
}

/**
 * Non-streaming body shape (used when a server refuses `stream: true`).
 *
 * `final` is forced true: a whole body cannot still be accruing arguments, and
 * a call sealed here is the client's only chance to see it.
 */
export function parseWholeResponse(protocol: WireProtocol, json: Record<string, unknown>): ResponseChunk {
  if (protocol === 'anthropic') {
    const blocks = Array.isArray(json.content) ? (json.content as unknown[]) : []
    let text = ''
    const toolCalls: ModelToolCall[] = []
    for (const raw of blocks) {
      const block = raw as Record<string, unknown>
      if (block.type === 'text') text += String(block.text ?? '')
      if (block.type === 'tool_use') {
        toolCalls.push({ id: String(block.id ?? ''), name: String(block.name ?? ''), args: (block.input ?? {}) as Record<string, unknown> })
      }
    }
    const usage = json.usage as Record<string, unknown> | undefined
    return { text, toolCalls, inputTokens: typeof usage?.input_tokens === 'number' ? usage.input_tokens : undefined, outputTokens: typeof usage?.output_tokens === 'number' ? usage.output_tokens : undefined, final: true }
  }
  if (protocol === 'gemini') return { ...geminiChunk(json), final: true }
  const choice = (Array.isArray(json.choices) ? json.choices : [])[0] as Record<string, unknown> | undefined
  return { ...openaiChunk({ ...json, choices: [choice ?? {}] }), final: true }
}
