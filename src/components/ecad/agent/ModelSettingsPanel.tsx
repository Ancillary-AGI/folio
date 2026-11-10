/**
 * Models — bring your own mind.
 *
 * Folio's deterministic CAD tools and its reflex path work with no model at all,
 * which is what makes the agent usable on a machine under NDA or off the grid.
 * This panel is the other half: point the planner at a hosted API, or at a model
 * running on this machine, and every agent surface uses it immediately.
 *
 * The credential is the one field that does not behave like the rest of the app.
 * It goes into a separate storage namespace from the configuration, in the tier
 * the user chooses, and it never enters a project, a design snapshot, a version
 * commit or an agent transcript — those all sync and get exported.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, CheckCircle, Eye, EyeOff, KeyRound, Plug, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '../../ui/button'
import { Input } from '../../ui/input'
import { RangeControl } from '../../ui/range-control'
import { KEY_PERSISTENCE_LABELS, MODEL_PROVIDERS, providerById, type KeyPersistence } from '../../../lib/models/providers'
import { clearProviderKey, providersWithStoredKeys, readProviderKey } from '../../../lib/models/credentials'
import { modelReadiness, resolveEndpoint, useModelSettings } from '../../../lib/models/settings'
import { listModels, ModelCallError, testConnection } from '../../../lib/models/client'
import type { ConnectionTest, ReasoningEffort } from '../../../lib/models/types'

const EFFORTS: ReadonlyArray<{ value: ReasoningEffort; label: string }> = [
  { value: 'off', label: 'Let the provider decide' },
  { value: 'low', label: 'Quick — little or no thinking' },
  { value: 'medium', label: 'Deliberate' },
  { value: 'high', label: 'Deep — slowest, most careful' },
]

const PERSISTENCE_ORDER: readonly KeyPersistence[] = ['session', 'local', 'memory']

const fieldClass = 'h-8 border-input bg-card text-xs'

function describeFailure(error: unknown): string {
  if (error instanceof ModelCallError) return `${error.message}${error.hint ? ` — ${error.hint}` : ''}`
  return error instanceof Error ? error.message : String(error)
}

export default function ModelSettingsPanel() {
  const settings = useModelSettings((state) => state.settings)
  const apiKey = useModelSettings((state) => state.apiKey)
  const update = useModelSettings((state) => state.update)
  const setApiKey = useModelSettings((state) => state.setApiKey)
  const forgetApiKey = useModelSettings((state) => state.forgetApiKey)

  const provider = providerById(settings.providerId) ?? MODEL_PROVIDERS[0]
  const readiness = modelReadiness(settings, apiKey)
  const [models, setModels] = useState<string[]>([])
  const [busy, setBusy] = useState<'none' | 'list' | 'test'>('none')
  const [notice, setNotice] = useState<string | null>(null)
  const [result, setResult] = useState<ConnectionTest | null>(null)
  const [keyVisible, setKeyVisible] = useState(false)
  const [stored, setStored] = useState<string[]>(() => providersWithStoredKeys())
  const abort = useRef<AbortController | null>(null)

  useEffect(() => () => abort.current?.abort(), [])

  // Memoised so the two actions below keep a stable identity between renders that
  // change nothing; `resolveEndpoint` returns a fresh object every call.
  const endpoint = useMemo(() => resolveEndpoint(settings, apiKey), [settings, apiKey])

  const refresh = useCallback(async () => {
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    setBusy('list')
    setNotice(null)
    try {
      const ids = await listModels(endpoint, { signal: controller.signal })
      setModels(ids)
      if (!ids.length) setNotice('The server answered but listed no models. Type the model id yourself.')
    } catch (error) {
      setNotice(describeFailure(error))
    } finally {
      setBusy('none')
    }
  }, [endpoint])

  const check = useCallback(async () => {
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    setBusy('test')
    setResult(null)
    setNotice(null)
    try {
      setResult(await testConnection(endpoint, settings.plannerModel, { signal: controller.signal }))
    } catch (error) {
      setResult({ ok: false, detail: describeFailure(error), latencyMs: 0, models: [] })
    } finally {
      setBusy('none')
      setStored(providersWithStoredKeys())
    }
  }, [endpoint, settings.plannerModel])

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <div className="space-y-3">
        <section className="rounded-lg border border-border bg-card p-3" aria-labelledby="models-status">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id="models-status" className="text-xs font-medium text-muted-foreground">
              Reasoning status
            </h3>
            <span
              className={`cad-chip ml-auto ${
                readiness.ready ? 'border-success/40 bg-success/15 text-success' : ''
              }`}
            >
              {readiness.ready ? <CheckCircle size={11} /> : <AlertCircle size={11} />}
              {readiness.ready ? 'Planner ready' : 'Reflex only'}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {readiness.ready
              ? `${readiness.reason} answers multi-step work. Lookups and single edits are still answered locally, free and instantly.`
              : `${readiness.reason} — Folio keeps answering what it can measure, and says so when a request needs a planner.`}
          </p>
        </section>

        <section className="space-y-2 rounded-lg border border-border bg-card p-3" aria-labelledby="models-provider">
          <h3 id="models-provider" className="text-xs font-medium text-muted-foreground">
            Provider
          </h3>
          <label className="block text-xs">
            <span className="mb-1 block text-muted-foreground">Where the models come from</span>
            <select
              className={`w-full ${fieldClass}`}
              value={settings.providerId}
              onChange={(event) => update({ providerId: event.target.value })}
            >
              {MODEL_PROVIDERS.map((entry) => (
                <option key={entry.id} value={entry.id}>{entry.label}</option>
              ))}
            </select>
          </label>
          <p className="text-xs text-muted-foreground">{provider.note}</p>

          <label className="block text-xs">
            <span className="mb-1 block text-muted-foreground">
              Server URL{provider.defaultBaseUrl ? ` (default ${provider.defaultBaseUrl})` : ''}
            </span>
            <Input
              className={fieldClass}
              placeholder={provider.defaultBaseUrl || 'https://your-gateway.example/v1'}
              value={settings.baseUrlOverride}
              onChange={(event) => update({ baseUrlOverride: event.target.value })}
              spellCheck={false}
            />
          </label>
          {provider.local && (
            <p className="text-xs text-muted-foreground">
              A server on this machine must allow this page as an origin. Ollama: start it with{' '}
              <code className="rounded bg-muted px-1 font-mono">OLLAMA_ORIGINS=*</code>. LM Studio: enable
              &quot;Serve with CORS&quot;.
            </p>
          )}
        </section>

        <section className="space-y-2 rounded-lg border border-border bg-card p-3" aria-labelledby="models-key">
          <h3 id="models-key" className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <KeyRound size={12} /> Credential
          </h3>
          <div className="flex gap-2">
            <Input
              className="h-8 flex-1 border-input bg-card text-xs"
              type={keyVisible ? 'text' : 'password'}
              placeholder={provider.requiresKey ? 'paste the provider key' : 'usually empty for a local server'}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              aria-label={`API key for ${provider.label}`}
              spellCheck={false}
              autoComplete="off"
            />
            <Button
              size="sm"
              variant="ghost"
              className="h-8 border border-border text-muted-foreground hover:text-foreground"
              onClick={() => setKeyVisible((current) => !current)}
              aria-label={keyVisible ? 'Hide the API key' : 'Show the API key'}
              title="Show or mask the key so you can check what you typed.">
              {keyVisible ? <EyeOff size={13} /> : <Eye size={13} />}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Keep it
              <select
                className={`h-8 ${fieldClass}`}
                value={settings.keyPersistence}
                onChange={(event) => update({ keyPersistence: event.target.value as KeyPersistence })}
                aria-label="Where the API key is kept"
              >
                {PERSISTENCE_ORDER.map((tier) => (
                  <option key={tier} value={tier}>{KEY_PERSISTENCE_LABELS[tier]}</option>
                ))}
              </select>
            </label>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 border border-border text-xs text-muted-foreground hover:text-destructive"
              onClick={() => {
                clearProviderKey(provider.id)
                forgetApiKey()
                setStored(providersWithStoredKeys())
                setNotice(`Removed the ${provider.label} key from every tier on this browser.`)
              }}
              disabled={!apiKey && !stored.includes(provider.id)}
              aria-label={`Forget the stored key for ${provider.label}`}
            >
              <Trash2 size={12} className="mr-1" />Forget
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {stored.length
              ? `Keys are held for: ${stored.join(', ')}.`
              : 'No key is stored on this browser.'}{' '}
            A key is never written into a project, a design snapshot, a version commit or an agent transcript.
          </p>
        </section>

        <section className="space-y-2 rounded-lg border border-border bg-card p-3" aria-labelledby="models-names">
          <div className="flex items-center gap-2">
            <h3 id="models-names" className="text-xs font-medium text-muted-foreground">
              Models
            </h3>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto h-7 border border-border text-xs text-muted-foreground hover:text-foreground"
              onClick={() => { void refresh() }}
              disabled={busy !== 'none'}
              aria-label="Ask this server which models it serves"
            >
              <RefreshCw size={11} className={`mr-1 ${busy === 'list' ? 'animate-spin' : ''}`} />
              {busy === 'list' ? 'Listing…' : 'List models'}
            </Button>
          </div>
          <label className="block text-xs">
            <span className="mb-1 block text-muted-foreground">Planner — multi-step work, the System 2 path</span>
            <Input
              className={fieldClass}
              list="planner-models"
              placeholder={models[0] ?? 'e.g. llama3.3, gpt-5-mini, gemini-2.5-pro'}
              value={settings.plannerModel}
              onChange={(event) => update({ plannerModel: event.target.value })}
              spellCheck={false}
            />
          </label>
          <label className="block text-xs">
            <span className="mb-1 block text-muted-foreground">Quick model — naming, classification, completions</span>
            <Input
              className={fieldClass}
              list="utility-models"
              placeholder={models[0] ?? 'e.g. qwen2.5-coder:7b'}
              value={settings.utilityModel}
              onChange={(event) => update({ utilityModel: event.target.value })}
              spellCheck={false}
            />
          </label>
          {models.length > 0 && (
            <datalist id="planner-models">
              {models.map((id) => <option key={id} value={id} />)}
            </datalist>
          )}
          {models.length > 0 && (
            <datalist id="utility-models">
              {models.map((id) => <option key={id} value={id} />)}
            </datalist>
          )}
          {models.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {models.slice(0, 12).map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => update({ plannerModel: id, utilityModel: settings.utilityModel || id })}
                  className="cad-ctl font-mono text-muted-foreground"
                  aria-label={`Use ${id} as the planner model`}
                >
                  {id}
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-3 rounded-lg border border-border bg-card p-3" aria-labelledby="models-behaviour">
          <h3 id="models-behaviour" className="text-xs font-medium text-muted-foreground">
            Behaviour
          </h3>
          <label className="block text-xs">
            <span className="mb-1 block text-muted-foreground">How hard the planner should think</span>
            <select
              className={`w-full ${fieldClass}`}
              value={settings.reasoningEffort}
              onChange={(event) => update({ reasoningEffort: event.target.value as ReasoningEffort })}
            >
              {EFFORTS.map((entry) => (
                <option key={entry.value} value={entry.value}>{entry.label}</option>
              ))}
            </select>
          </label>
          <RangeControl
            label="Temperature"
            value={settings.temperature}
            min={0}
            max={1}
            step={0.05}
            format={(value) => (value <= 0.05 ? 'repeats exactly' : value <= 0.4 ? 'mostly repeatable' : 'explores')}
            onValueChange={(value) => update({ temperature: value })}
          />
          <p className="text-xs text-muted-foreground">
            At 0 the planner picks the most likely next step every time, so a re-run of a solved design gives the same
            sequence of calls. Raise it only when you want the agent to try different approaches.
          </p>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(event) => update({ enabled: event.target.checked })}
              className="h-4 w-4 rounded border-input bg-card text-primary"
              aria-label="Let agents call the model"
            />
            Let agents call this model
          </label>
        </section>

        <section className="space-y-2 rounded-lg border border-border bg-card p-3" aria-labelledby="models-check">
          <div className="flex items-center gap-2">
            <h3 id="models-check" className="text-xs font-medium text-muted-foreground">
              Prove it works
            </h3>
            <Button
              size="sm"
              className="ml-auto h-7 bg-primary text-xs hover:bg-primary/90"
              onClick={() => { void check() }}
              disabled={busy !== 'none'}
              aria-label="Send one token to this endpoint and report what came back"
            >
              <Plug size={11} className={`mr-1 ${busy === 'test' ? 'animate-pulse' : ''}`} />
              {busy === 'test' ? 'Testing…' : 'Test connection'}
            </Button>
          </div>
          {notice && <p role="status" className="text-xs text-destructive">{notice}</p>}
          {result && (
            <p role="status" className={`text-xs ${result.ok ? 'text-success' : 'text-destructive'}`}>
              {result.detail}
              {result.ok && result.latencyMs > 0 ? ` (${result.latencyMs} ms round trip)` : ''}
            </p>
          )}
          {result?.ok && result.models.length > 0 && (
            <p className="text-xs text-muted-foreground">{result.models.length} model(s) listed by this server.</p>
          )}
        </section>

        <section className="rounded-lg border border-border bg-card p-3" aria-labelledby="models-local-note">
          <h3 id="models-local-note" className="text-xs font-medium text-muted-foreground">
            Without any model
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Off, or unreachable, Folio still runs every deterministic tool: simulate, ERC, place, wire, export, and the
            reflex answers that read the sheet and the measured blackboard. What it gives up is multi-step planning —
            and it says so instead of guessing.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            A copy of the key is{' '}
            {readProviderKey(provider.id, settings.keyPersistence) ? 'present' : 'not present'}
            {' '}in the {KEY_PERSISTENCE_LABELS[settings.keyPersistence]} tier. Changing tiers moves it; Forget removes it
            from all of them.
          </p>
        </section>
      </div>
    </div>
  )
}
