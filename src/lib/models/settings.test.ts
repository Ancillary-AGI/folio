import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MODEL_CONFIG_KEY, MODEL_KEY_RING, readProviderKey } from './credentials'
import { providerById } from './providers'
import { DEFAULT_MODEL_SETTINGS } from './settings'

const fresh = async () => {
  vi.resetModules()
  return await import('./settings')
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe('resolving an endpoint', () => {
  it('points at the local OpenAI-compatible server by default', async () => {
    const { resolveEndpoint } = await fresh()
    const endpoint = resolveEndpoint(DEFAULT_MODEL_SETTINGS, '')
    expect(endpoint.protocol).toBe('openai')
    expect(endpoint.baseUrl).toBe('http://127.0.0.1:11434/v1')
    expect(providerById('openai-compatible')?.requiresKey).toBe(false)
  })

  it('prefers the user URL and trims its trailing slash', async () => {
    const { effectiveBaseUrl, resolveEndpoint } = await fresh()
    const settings = { ...DEFAULT_MODEL_SETTINGS, providerId: 'custom', baseUrlOverride: 'https://gw.internal/v1/' }
    expect(effectiveBaseUrl(settings)).toBe('https://gw.internal/v1')
    expect(resolveEndpoint(settings, 'tok').baseUrl).toBe('https://gw.internal/v1')
  })

  it('carries the protocol the provider actually speaks', async () => {
    const { resolveEndpoint } = await fresh()
    for (const [id, protocol] of [['anthropic', 'anthropic'], ['google', 'gemini'], ['groq', 'openai']] as const) {
      expect(resolveEndpoint({ ...DEFAULT_MODEL_SETTINGS, providerId: id }, 'k').protocol).toBe(protocol)
    }
  })

  it('sends no credential to a local server that has none', async () => {
    const { resolveEndpoint } = await fresh()
    expect(resolveEndpoint(DEFAULT_MODEL_SETTINGS, '').apiKey).toBe('')
    expect(resolveEndpoint(DEFAULT_MODEL_SETTINGS, '  ollama-token  ').apiKey).toBe('ollama-token')
  })
})

describe('readiness', () => {
  it('names the one thing missing, not a generic failure', async () => {
    const { modelReadiness } = await fresh()
    expect(modelReadiness({ ...DEFAULT_MODEL_SETTINGS, enabled: false }, 'k').reason).toContain('switched off')
    expect(modelReadiness({ ...DEFAULT_MODEL_SETTINGS, providerId: 'openai' }, '').reason).toContain('needs an API key')
    expect(modelReadiness({ ...DEFAULT_MODEL_SETTINGS, providerId: 'custom', baseUrlOverride: '' }, '').reason).toContain('No base URL')
    expect(modelReadiness({ ...DEFAULT_MODEL_SETTINGS, plannerModel: '' }, '').reason).toContain('No model selected for planning')
    expect(modelReadiness({ ...DEFAULT_MODEL_SETTINGS, plannerModel: 'llama3' }, '')).toEqual({ ready: true, reason: expect.stringContaining('llama3') })
  })

  it('calls a local server ready with no key at all', async () => {
    const { modelReadiness } = await fresh()
    expect(modelReadiness({ ...DEFAULT_MODEL_SETTINGS, plannerModel: 'qwen2.5-coder' }, '').ready).toBe(true)
  })
})

describe('the settings store', () => {
  it('keeps the key out of the config object it persists', async () => {
    const { useModelSettings } = await fresh()
    const store = useModelSettings.getState()
    store.update({ providerId: 'openai', plannerModel: 'gpt-5-mini', keyPersistence: 'local' })
    store.setApiKey('sk-do-not-leak')
    const config = localStorage.getItem(MODEL_CONFIG_KEY) ?? ''
    expect(config).toContain('gpt-5-mini')
    expect(config).not.toContain('sk-do-not-leak')
    expect(localStorage.getItem(MODEL_KEY_RING)).toContain('sk-do-not-leak')
    expect(useModelSettings.getState().apiKey).toBe('sk-do-not-leak')
  })

  it('reveals the stored key when the provider is switched back to', async () => {
    const { useModelSettings } = await fresh()
    const store = useModelSettings.getState()
    store.update({ providerId: 'openai', keyPersistence: 'local' })
    store.setApiKey('sk-openai')
    store.update({ providerId: 'groq' })
    expect(useModelSettings.getState().apiKey).toBe('')
    store.update({ providerId: 'openai' })
    expect(useModelSettings.getState().apiKey).toBe('sk-openai')
  })

  it('forgets a key from every tier on request', async () => {
    const { useModelSettings } = await fresh()
    useModelSettings.getState().update({ providerId: 'anthropic', keyPersistence: 'local' })
    useModelSettings.getState().setApiKey('sk-ant')
    useModelSettings.getState().forgetApiKey()
    expect(readProviderKey('anthropic', 'local')).toBe('')
    expect(useModelSettings.getState().apiKey).toBe('')
  })

  it('defaults the utility model to the planner model when only one is typed', async () => {
    localStorage.setItem(MODEL_CONFIG_KEY, JSON.stringify({ providerId: 'openai', plannerModel: 'gpt-x' }))
    const { useModelSettings } = await fresh()
    expect(useModelSettings.getState().settings).toMatchObject({ plannerModel: 'gpt-x', utilityModel: 'gpt-x' })
  })

  it('ignores a config naming a provider that does not exist', async () => {
    localStorage.setItem(MODEL_CONFIG_KEY, JSON.stringify({ providerId: 'sketchy', plannerModel: 'x' }))
    const { useModelSettings } = await fresh()
    expect(useModelSettings.getState().settings.providerId).toBe(DEFAULT_MODEL_SETTINGS.providerId)
  })

  it('survives a corrupt config and an out-of-range temperature', async () => {
    localStorage.setItem(MODEL_CONFIG_KEY, '{{{')
    const { useModelSettings, DEFAULT_MODEL_SETTINGS: defaults } = await fresh()
    expect(useModelSettings.getState().settings).toEqual(defaults)
    localStorage.setItem(MODEL_CONFIG_KEY, JSON.stringify({ providerId: 'openai', temperature: 47 }))
    const again = await fresh()
    expect(again.useModelSettings.getState().settings.temperature).toBe(1)
  })

  it('clamps persistence to the three tiers it knows', async () => {
    localStorage.setItem(MODEL_CONFIG_KEY, JSON.stringify({ providerId: 'openai', keyPersistence: 'eternity' }))
    const { useModelSettings } = await fresh()
    expect(useModelSettings.getState().settings.keyPersistence).toBe('session')
  })
})
