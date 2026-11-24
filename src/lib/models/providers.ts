import type { ModelProvider } from './types'

/**
 * Providers a designer can point Folio at.
 *
 * Folio is agent-first but not vendor-locked: an engineer with a GPU runs a
 * local model and pays nothing, one under an NDA points at their own gateway,
 * and one evaluating the product uses a hosted key. All three are the same
 * interface — the only differences are the wire protocol, where the credential
 * goes, and the base URL.
 *
 * `openai-compatible` is the important entry: Ollama, LM Studio, llama.cpp,
 * vLLM, SGLang, llama-facade and most gateways all speak the OpenAI chat
 * schema, so a user with any of them pastes a URL and is done.
 */
export const MODEL_PROVIDERS: readonly ModelProvider[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    protocol: 'openai',
    auth: 'bearer',
    defaultBaseUrl: 'https://api.openai.com/v1',
    requiresKey: true,
    local: false,
    docsUrl: 'https://platform.openai.com/docs/api-reference/chat',
    note: 'Chat Completions with function calling. Keys are used from this browser only.',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    protocol: 'anthropic',
    auth: 'anthropic-header',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    requiresKey: true,
    local: false,
    docsUrl: 'https://docs.anthropic.com/en/api/messages',
    note: 'Messages API. Browser calls need the CORS opt-in header, which Folio sends.',
  },
  {
    id: 'google',
    label: 'Google Gemini',
    protocol: 'gemini',
    auth: 'query-key',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    requiresKey: true,
    local: false,
    docsUrl: 'https://ai.google.dev/api/generate-content',
    note: 'generateContent with function declarations.',
  },
  {
    id: 'openai-compatible',
    label: 'Local or self-hosted (OpenAI-compatible)',
    protocol: 'openai',
    auth: 'bearer',
    defaultBaseUrl: 'http://127.0.0.1:11434/v1',
    requiresKey: false,
    local: true,
    docsUrl: 'https://github.com/ollama/ollama/blob/main/docs/openai-compatibility.md',
    note: 'Ollama, LM Studio, llama.cpp, vLLM, SGLang or any gateway that speaks /chat/completions.',
  },
  {
    id: 'groq',
    label: 'Groq',
    protocol: 'openai',
    auth: 'bearer',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    requiresKey: true,
    local: false,
    note: 'Fast OpenAI-compatible inference; good for the quick-response path.',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    protocol: 'openai',
    auth: 'bearer',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    requiresKey: true,
    local: false,
    note: 'One key, many models. Set the base URL per deployment if you self-host it.',
  },
  {
    id: 'custom',
    label: 'Custom gateway',
    protocol: 'openai',
    auth: 'bearer',
    defaultBaseUrl: '',
    requiresKey: false,
    local: false,
    note: 'Your own endpoint. Leave the key empty if the gateway authenticates another way.',
  },
]

export const PROVIDERS_BY_ID: Readonly<Record<string, ModelProvider>> = Object.fromEntries(
  MODEL_PROVIDERS.map((provider) => [provider.id, provider]),
)

export function providerById(id: string | undefined | null): ModelProvider | undefined {
  return id ? PROVIDERS_BY_ID[id] : undefined
}

/**
 * Where a key is allowed to live.
 *
 * `session` keeps the credential in memory for this tab only, which is what a
 * designer on a shared machine wants; `local` writes it to this browser's
 * storage. A key never enters a project, a design snapshot, a VCS commit or an
 * agent transcript — those all sync and get exported, and a token in a design
 * file is a breach with a paper trail.
 */
export type KeyPersistence = 'memory' | 'session' | 'local'

export const KEY_PERSISTENCE_LABELS: Readonly<Record<KeyPersistence, string>> = {
  memory: 'This tab only (cleared on reload)',
  session: 'This browser tab (session storage)',
  local: 'This device (local storage)',
}
