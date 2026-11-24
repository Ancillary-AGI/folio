/**
 * The user's model configuration, in one store.
 *
 * The config — provider, base URL, model names, reasoning effort — is not a
 * secret and is safe to keep as one object. The API key is, so it lives in the
 * key ring (`credentials.ts`) and is read only at the moment a request is
 * built. Nothing here is ever written into a project or a design snapshot.
 */
import { create } from 'zustand'
import { MODEL_PROVIDERS, providerById, type KeyPersistence } from './providers'
import { clearProviderKey, readProviderKey, readStoredConfig, writeProviderKey, writeStoredConfig } from './credentials'
import type { ReasoningEffort, ResolvedEndpoint } from './types'

export interface ModelSettings {
  providerId: string
  /** Empty means the provider's own default; a custom gateway needs a URL. */
  baseUrlOverride: string
  /** The deliberate model: plans, critiques, explains. */
  plannerModel: string
  /** The quick model: completes, classifies, names. */
  utilityModel: string
  reasoningEffort: ReasoningEffort
  temperature: number
  keyPersistence: KeyPersistence
  /** Off means Folio runs its own deterministic tools and heuristics, visibly. */
  enabled: boolean
}

export const DEFAULT_MODEL_SETTINGS: ModelSettings = {
  providerId: 'openai-compatible',
  baseUrlOverride: '',
  plannerModel: '',
  utilityModel: '',
  reasoningEffort: 'off',
  temperature: 0.2,
  keyPersistence: 'session',
  enabled: true,
}

function readInitial(): ModelSettings {
  return readConfigJson() ?? DEFAULT_MODEL_SETTINGS
}

/** The config namespace belongs to `credentials.ts`; this file never names it. */
function readConfigJson(): ModelSettings | null {
  try {
    const raw = readStoredConfig()
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const value = parsed as Partial<ModelSettings>
    if (!providerById(value.providerId ?? '')) return null
    return {
      ...DEFAULT_MODEL_SETTINGS,
      ...value,
      providerId: value.providerId as string,
      baseUrlOverride: typeof value.baseUrlOverride === 'string' ? value.baseUrlOverride : '',
      plannerModel: typeof value.plannerModel === 'string' ? value.plannerModel : '',
      utilityModel: typeof value.plannerModel === 'string' && typeof value.utilityModel !== 'string'
        ? value.plannerModel
        : (typeof value.utilityModel === 'string' ? value.utilityModel : ''),
      reasoningEffort: (['off', 'low', 'medium', 'high'] as const).includes(value.reasoningEffort as ReasoningEffort)
        ? (value.reasoningEffort as ReasoningEffort)
        : 'off',
      temperature: typeof value.temperature === 'number' ? Math.min(1, Math.max(0, value.temperature)) : 0.2,
      keyPersistence: (['memory', 'session', 'local'] as const).includes(value.keyPersistence as KeyPersistence)
        ? (value.keyPersistence as KeyPersistence)
        : 'session',
      enabled: value.enabled !== false,
    }
  } catch {
    return null
  }
}

interface ModelStore {
  settings: ModelSettings
  apiKey: string
  update(patch: Partial<ModelSettings>): void
  setApiKey(key: string): void
  forgetApiKey(): void
}

export const useModelSettings = create<ModelStore>((set, get) => ({
  settings: readInitial(),
  apiKey: '',
  update: (patch) => {
    const next = { ...get().settings, ...patch }
    writeStoredConfig(JSON.stringify(next))
    // Reveal the key for the provider being switched to, from the tier the user
    // chose; the field is a view of the ring, never a second copy of it.
    set({
      settings: next,
      apiKey: patch.keyPersistence || patch.providerId ? readProviderKey(next.providerId, next.keyPersistence) : get().apiKey,
    })
  },
  setApiKey: (key) => {
    const { providerId, keyPersistence } = get().settings
    writeProviderKey(providerId, key, keyPersistence)
    set({ apiKey: key })
  },
  forgetApiKey: () => {
    const { providerId } = get().settings
    clearProviderKey(providerId)
    set({ apiKey: '' })
  },
}))

// The store starts with the key for the saved provider already loaded, so a
// returning user is one click from a test rather than having to re-paste.
{
  const initial = useModelSettings.getState().settings
  useModelSettings.setState({ apiKey: readProviderKey(initial.providerId, initial.keyPersistence) })
}

export function effectiveBaseUrl(settings: ModelSettings): string {
  const override = settings.baseUrlOverride.trim()
  if (override) return override.replace(/\/+$/, '')
  return (providerById(settings.providerId)?.defaultBaseUrl ?? '').replace(/\/+$/, '')
}

/** The full picture a request needs: provider, URL, protocol and key together. */
export function resolveEndpoint(settings = useModelSettings.getState().settings, apiKey = useModelSettings.getState().apiKey): ResolvedEndpoint {
  const provider = providerById(settings.providerId) ?? MODEL_PROVIDERS[0]
  return {
    providerId: provider.id,
    protocol: provider.protocol,
    baseUrl: effectiveBaseUrl(settings),
    // A non-secret header still goes through the auth shape so a local server
    // without a key and a hosted one with a key take the same path.
    apiKey: provider.auth === 'none' ? '' : apiKey.trim(),
  }
}

/**
 * Whether a model may be called at all, with the reason when it may not. The
 * agent surface shows this instead of failing mid-run: "no key" is a thing the
 * user can fix in ten seconds, and finding out after three steps is not.
 */
export function modelReadiness(settings = useModelSettings.getState().settings, apiKey = useModelSettings.getState().apiKey): { ready: boolean; reason: string } {
  const provider = providerById(settings.providerId)
  if (!provider) return { ready: false, reason: 'No model provider is selected.' }
  if (!settings.enabled) return { ready: false, reason: `${provider.label} is configured but switched off.` }
  if (!effectiveBaseUrl(settings)) return { ready: false, reason: 'No base URL for this provider.' }
  if (provider.requiresKey && !apiKey.trim()) return { ready: false, reason: `${provider.label} needs an API key.` }
  if (!settings.plannerModel.trim()) return { ready: false, reason: 'No model selected for planning.' }
  return { ready: true, reason: `${provider.label} · ${settings.plannerModel}` }
}
