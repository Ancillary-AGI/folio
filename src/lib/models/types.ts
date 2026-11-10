/**
 * The provider contract.
 *
 * Everything the agent harness needs from a model is expressed here and nothing
 * provider-specific leaks above this file: `protocols.ts` translates these
 * shapes into the wire format each vendor actually speaks, and the harness only
 * ever sees `ModelMessage`, `ToolSpec` and `GenerationResult`.
 */

export type ModelRole = 'system' | 'user' | 'assistant' | 'tool'

export interface ModelToolCall {
  id: string
  name: string
  args: Record<string, unknown>
  /**
   * Argument JSON still arriving in pieces. Providers stream a call's arguments
   * as partial JSON, so the client concatenates these and parses once at the end
   * of the block rather than pretending a fragment is a call.
   */
  partialArguments?: string
}

export interface ModelMessage {
  role: ModelRole
  content: string
  /** Assistant turn that asked for tools. */
  toolCalls?: ModelToolCall[]
  /** `role: 'tool'` — the call this message carries the result of. */
  toolCallId?: string
}

/**
 * A tool the model may call, in the harness's own shape: scalar parameters only,
 * because that is what `AgentTool` accepts and what a CAD tool genuinely needs.
 * Keeping the schema this small is what lets one definition serialise into all
 * three vendor formats without a conversion graph.
 */
export interface ToolSpec {
  name: string
  description: string
  parameters: Record<string, 'string' | 'number' | 'boolean'>
  optionalParameters?: string[]
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
}

/**
 * `off` lets the provider decide, which matters: sending a thinking budget to a
 * model that has none is an error, not a no-op.
 */
export type ReasoningEffort = 'off' | 'low' | 'medium' | 'high'

export interface GenerationRequest {
  model: string
  messages: ModelMessage[]
  tools?: ToolSpec[]
  temperature?: number
  maxTokens?: number
  reasoningEffort?: ReasoningEffort
}

export interface StreamOptions {
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

/** One increment of a streamed response. */
export interface GenerationDelta {
  text?: string
  /**
   * A tool call, complete or still accruing. Providers stream arguments as
   * partial JSON, so the client reassembles before emitting; a delta here is
   * always parseable.
   */
  toolCall?: ModelToolCall
  usage?: TokenUsage
}

export interface GenerationResult {
  text: string
  toolCalls: ModelToolCall[]
  usage: TokenUsage
  latencyMs: number
  /** The model string the provider actually served, when it reports one. */
  servedModel?: string
}

export interface ResolvedEndpoint {
  providerId: string
  protocol: WireProtocol
  baseUrl: string
  apiKey: string
}

export type WireProtocol = 'openai' | 'anthropic' | 'gemini'

export type ProviderAuth = 'bearer' | 'anthropic-header' | 'query-key' | 'none'

export interface ModelProvider {
  id: string
  label: string
  protocol: WireProtocol
  auth: ProviderAuth
  defaultBaseUrl: string
  /** False for local servers that answer without a credential. */
  requiresKey: boolean
  /**
   * True when the endpoint is expected to run on the user's machine. The UI
   * uses this to explain CORS rather than pretending the failure is mysterious.
   */
  local: boolean
  docsUrl?: string
  note: string
}

export interface ConnectionTest {
  ok: boolean
  /** What the check proves, in one sentence a user can act on. */
  detail: string
  latencyMs: number
  models: string[]
}
