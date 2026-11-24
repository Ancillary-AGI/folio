import { describe, expect, it } from 'vitest'
import {
  buildChatRequest,
  buildListModelsRequest,
  parseChunk,
  parseModelIds,
  parseWholeResponse,
} from './protocol'
import type { GenerationRequest, ResolvedEndpoint, ToolSpec } from './types'

const endpoint = (over: Partial<ResolvedEndpoint> = {}): ResolvedEndpoint => ({
  providerId: 'openai',
  protocol: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'sk-test',
  ...over,
})

const tool: ToolSpec = {
  name: 'cad.setProperty',
  description: 'Set one component property',
  parameters: { reference: 'string', property: 'string', value: 'string' },
  optionalParameters: ['property'],
}

const request = (over: Partial<GenerationRequest> = {}): GenerationRequest => ({
  model: 'gpt-test',
  messages: [{ role: 'user', content: 'hello' }],
  ...over,
})

const bodyOf = (http: { body?: unknown }) => http.body as Record<string, unknown>

describe('request building', () => {
  it('speaks OpenAI chat completions with bearer auth and a tool schema', () => {
    const http = buildChatRequest('openai', endpoint(), request({ tools: [tool], temperature: 0.3, maxTokens: 64 }))
    expect(http.url).toBe('https://api.openai.com/v1/chat/completions')
    expect(http.headers.Authorization).toBe('Bearer sk-test')
    const body = bodyOf(http)
    expect(body.stream).toBe(true)
    expect(body.temperature).toBe(0.3)
    expect(body.max_tokens).toBe(64)
    expect(body.reasoning_effort).toBeUndefined()
    const tools = body.tools as { function: { name: string; parameters: { required: string[]; properties: Record<string, { type: string }> } } }[]
    const fn = tools[0].function
    expect(fn.name).toBe('cad.setProperty')
    expect(fn.parameters.required).toEqual(['reference', 'value'])
    expect(fn.parameters.properties.property.type).toBe('string')
  })

  it('carries an assistant tool call and its result as the protocol expects', () => {
    const http = buildChatRequest('openai', endpoint(), request({
      messages: [
        { role: 'assistant', content: '', toolCalls: [{ id: 'call-1', name: 'cad.observe', args: {} }] },
        { role: 'tool', content: '{"parts":2}', toolCallId: 'call-1' },
      ],
    }))
    const messages = bodyOf(http).messages as Record<string, unknown>[]
    expect(messages[0].tool_calls).toEqual([{ id: 'call-1', type: 'function', function: { name: 'cad.observe', arguments: '{}' } }])
    expect(messages[1]).toEqual({ role: 'tool', tool_call_id: 'call-1', content: '{"parts":2}' })
  })

  it('sends reasoning effort only when the user asked for it', () => {
    const off = bodyOf(buildChatRequest('openai', endpoint(), request({ reasoningEffort: 'off' })))
    expect(off.reasoning_effort).toBeUndefined()
    const high = bodyOf(buildChatRequest('openai', endpoint(), request({ reasoningEffort: 'high' })))
    expect(high.reasoning_effort).toBe('high')
  })

  it('uses the Anthropic headers that a browser call needs and folds system messages', () => {
    const http = buildChatRequest('anthropic', endpoint({ providerId: 'anthropic', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'sk-ant' }), request({
      messages: [{ role: 'system', content: 'rules' }, { role: 'user', content: 'hi' }, { role: 'tool', content: 'ok', toolCallId: 'a' }],
    }))
    expect(http.url).toBe('https://api.anthropic.com/messages')
    expect(http.headers['x-api-key']).toBe('sk-ant')
    expect(http.headers['anthropic-version']).toBe('2023-06-01')
    // Without this header a perfectly good key is refused, which looks like a network failure.
    expect(http.headers['anthropic-dangerous-direct-browser-access']).toBe('true')
    const body = bodyOf(http)
    expect(body.system).toBe('rules')
    expect(body.max_tokens).toBe(4096)
    expect(body.messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: 'ok' }] },
    ])
  })

  it('puts a Gemini key in the query and streams with alt=sse', () => {
    const http = buildChatRequest('gemini', endpoint({ providerId: 'google', protocol: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', apiKey: 'AIza' }), request({
      model: 'gemini-2.5-flash',
      messages: [{ role: 'assistant', content: 'ok' }, { role: 'tool', content: 'x', toolCallId: 'cad.observe' }],
    }))
    expect(http.url).toContain('/models/gemini-2.5-flash:streamGenerateContent?alt=sse')
    expect(http.url).toContain('key=AIza')
    expect(http.headers.Authorization).toBeUndefined()
    const body = bodyOf(http)
    expect(body.systemInstruction).toBeUndefined()
    const contents = body.contents as { role: string; parts: Record<string, unknown>[] }[]
    expect(contents[0].role).toBe('model')
    // Gemini answers a function call with a functionResponse part named after the tool.
    expect(contents[1].parts.find((part) => part.functionResponse)?.functionResponse).toEqual({ name: 'cad.observe', response: { result: 'x' } })
  })

  it('turns a deliberate Gemini effort into the thinking flag, and a low one into nothing', () => {
    const low = bodyOf(buildChatRequest('gemini', endpoint({ protocol: 'gemini', baseUrl: 'https://x/v1' }), request({ reasoningEffort: 'low' })))
    expect(low.generationConfig).toBeUndefined()
    const high = bodyOf(buildChatRequest('gemini', endpoint({ protocol: 'gemini', baseUrl: 'https://x/v1' }), request({ reasoningEffort: 'high' })))
    expect((high.generationConfig as Record<string, unknown>).thinkingConfig).toEqual({ includeThoughts: true })
  })

  it('sends no Authorization header to a local server that has no key', () => {
    const http = buildChatRequest('openai', endpoint({ providerId: 'openai-compatible', baseUrl: 'http://127.0.0.1:11434/v1', apiKey: '' }), request())
    expect(http.headers.Authorization).toBeUndefined()
  })

  it('lists models per protocol', () => {
    expect(buildListModelsRequest('openai', endpoint()).url).toBe('https://api.openai.com/v1/models')
    expect(buildListModelsRequest('openai', endpoint()).headers.Authorization).toBe('Bearer sk-test')
    expect(buildListModelsRequest('gemini', endpoint({ protocol: 'gemini', baseUrl: 'https://g/v1beta' })).url).toBe('https://g/v1beta/models?key=sk-test')
    expect(buildListModelsRequest('anthropic', endpoint({ protocol: 'anthropic', baseUrl: 'https://api.anthropic.com' })).headers['x-api-key']).toBe('sk-test')
  })
})

describe('response parsing', () => {
  it('reassembles an OpenAI streamed call from its fragments', () => {
    const first = parseChunk('openai', { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'cad.simulate', arguments: '' } }] } }] })
    expect(first.toolCalls[0]).toMatchObject({ id: 'c1', name: 'cad.simulate' })
    expect(first.toolCalls[0].args).toEqual({})
    const middle = parseChunk('openai', { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"analysis"' } }] } }] })
    expect(middle.toolCalls[0].partialArguments).toBe('{"analysis"')
    expect(middle.final).toBe(false)
    const last = parseChunk('openai', { choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 11, completion_tokens: 4 } })
    expect(last.final).toBe(true)
    expect(last.inputTokens).toBe(11)
    expect(last.outputTokens).toBe(4)
  })

  it('reads text out of an OpenAI delta and ignores reasoning-only parts', () => {
    expect(parseChunk('openai', { choices: [{ delta: { content: 'Vout is 3' } }] }).text).toBe('Vout is 3')
    expect(parseChunk('openai', { choices: [] }).text).toBe('')
  })

  it('reads Anthropic content blocks and incremental input json', () => {
    const open = parseChunk('anthropic', { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu1', name: 'cad.erc', input: {} } })
    expect(open.toolCalls[0]).toMatchObject({ id: 'tu1', name: 'cad.erc' })
    expect(open.toolCallIndex).toBe(1)
    const partial = parseChunk('anthropic', { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"ref' } })
    expect(partial.toolCalls[0].partialArguments).toBe('{"ref')
    expect(parseChunk('anthropic', { type: 'content_block_stop' }).final).toBe(true)
    expect(parseChunk('anthropic', { type: 'message_stop' }).final).toBe(true)
    expect(parseChunk('anthropic', { type: 'message_start', message: { usage: { input_tokens: 7 } } }).inputTokens).toBe(7)
    expect(parseChunk('anthropic', { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } }).text).toBe('hi')
  })

  it('reads Gemini parts, skipping thought text', () => {
    const chunk = parseChunk('gemini', {
      candidates: [{ content: { parts: [{ text: 'thinking', thought: true }, { text: 'answer' }, { functionCall: { name: 'cad.observe', args: {} } }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 },
    })
    expect(chunk.text).toBe('answer')
    expect(chunk.toolCalls[0]).toEqual({ id: 'cad.observe', name: 'cad.observe', args: {} })
    expect(chunk.final).toBe(true)
    expect(chunk.inputTokens).toBe(5)
    expect(chunk.outputTokens).toBe(2)
  })

  it('parses a whole non-streaming body from each protocol', () => {
    const openai = parseWholeResponse('openai', { choices: [{ message: { content: 'done', tool_calls: [{ id: 'c', function: { name: 'cad.erc', arguments: '{}' } }], } }] })
    expect(openai.text).toBe('done')
    expect(openai.toolCalls[0].name).toBe('cad.erc')
    expect(openai.final).toBe(true)
    const anthropic = parseWholeResponse('anthropic', { content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', id: 't1', name: 'cad.observe', input: { a: 1 } }], usage: { input_tokens: 3 } })
    expect(anthropic.text).toBe('ok')
    expect(anthropic.toolCalls[0].args).toEqual({ a: 1 })
    expect(anthropic.inputTokens).toBe(3)
    expect(parseWholeResponse('gemini', { candidates: [{ content: { parts: [{ text: 'yo' }] } }] }).text).toBe('yo')
  })
})

describe('model listing', () => {
  it('reads ids from a data list, a models list and bare strings', () => {
    expect(parseModelIds({ data: [{ id: 'b' }, { id: 'a' }] })).toEqual(['b', 'a'])
    expect(parseModelIds({ models: ['x', 'y'] })).toEqual(['x', 'y'])
    expect(parseModelIds([]) ).toEqual([])
    expect(parseModelIds(null)).toEqual([])
  })

  it('strips the models/ prefix Gemini reports and removes duplicates', () => {
    expect(parseModelIds({ models: [{ name: 'models/gemini-2.5-pro' }, { name: 'models/gemini-2.5-pro' }] })).toEqual(['gemini-2.5-pro'])
  })
})
