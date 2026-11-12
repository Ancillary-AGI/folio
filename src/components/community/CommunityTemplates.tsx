/**
 * Community templates — the launcher's answer to "someone already solved it".
 *
 * Three sources, one grid:
 *   · Curated seeds shipped in the box (CC-BY, attribution to the Folio team).
 *   · Templates people published to the Folio cloud (when configured).
 *   · Template files people hand to each other (always available, fully local).
 *
 * Curated forks flow through the same demo loader the gallery uses. Cloud
 * forks fetch the payload and apply it to the current project shell. Imported
 * files do the same, so a fork always lands the same way.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Download, Upload, Send, GitFork, Loader2, FlaskConical, AlertCircle, X,
} from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import DialogShell from '../ui/DialogShell'
import {
  CURATED_TEMPLATES,
  CURATED_DEMO_BY_TEMPLATE_ID,
  licenseLabel,
  fetchCommunityTemplates,
  fetchCommunityFork,
  publishCommunityTemplate,
  serializeTemplateFile,
  parseCommunityTemplate,
  applyTemplateFile,
  type CommunityTemplate,
  type Discipline,
  type CommunityLicense,
} from '../../lib/community/community'
import { isSupabaseConfigured } from '../../lib/supabase'
import { DEMO_SCENARIOS } from '../../lib/demo/demoScenarios'
import { useProjectStore } from '../../stores/useProjectStore'
import { useAppStore } from '../../stores/useAppStore'
import { useLocalProfileStore } from '../../stores/useLocalProfileStore'
import { downloadFile } from '../../lib/exportUtils'

interface CommunityTemplatesProps {
  /** Create/ensure a clean project shell the fork will fill. Returns false if it could not. */
  onPrepareForkProject: () => Promise<boolean>
  /** Opens a curated demo by id; resolves to false if the load was refused. */
  onOpenDemo: (demoId: string) => Promise<void> | void
  /** Called after a successful fork so the launcher can refresh. */
  onForked?: (template: CommunityTemplate) => void
}

const DISCIPLINE_LABEL: Record<Discipline, string> = {
  circuits: 'Circuits',
  control: 'Control',
  mechanical: 'Mechanical',
  robotics: 'Robotics',
  rf: 'RF',
  software: 'Software',
  other: 'Other',
}

const DISCIPLINE_OPTIONS = Object.entries(DISCIPLINE_LABEL) as Array<[Discipline, string]>
const LICENSE_OPTIONS: Array<[CommunityLicense, string]> = [
  ['cc-by-4.0', 'CC-BY-4.0 — fork freely, keep attribution'],
  ['cc0-1.0', 'CC0-1.0 — no rights reserved'],
]

export default function CommunityTemplates({ onPrepareForkProject, onOpenDemo, onForked }: CommunityTemplatesProps) {
  const projectName = useProjectStore((state) => state.currentProject?.name ?? '')
  const localProfile = useLocalProfileStore((state) => state.profile)
  const [templates, setTemplates] = useState<CommunityTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [publishOpen, setPublishOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [forkBusy, setForkBusy] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; message: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const cloudMode = isSupabaseConfigured
  const [publishName, setPublishName] = useState(projectName)
  const [publishDescription, setPublishDescription] = useState('')
  const [publishDiscipline, setPublishDiscipline] = useState<Discipline>('circuits')
  const [publishLicense, setPublishLicense] = useState<CommunityLicense>('cc-by-4.0')
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)

  // Which demo seeds the current fork; command palette / cards fork through it.
  const demoById = useMemo(() => new Map(DEMO_SCENARIOS.map((scenario) => [scenario.id, scenario])), [])

  const refresh = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    const { templates: cloud, error } = await fetchCommunityTemplates()
    setTemplates(cloud)
    setLoadError(error)
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Keep the publish form's default name in step with the open project.
  useEffect(() => {
    setPublishName(projectName)
  }, [projectName])

  const forkCurated = useCallback(async (template: CommunityTemplate) => {
    const demoId = CURATED_DEMO_BY_TEMPLATE_ID[template.id]
    const scenario = demoId ? demoById.get(demoId) : undefined
    if (!scenario) return
    if (!(await onPrepareForkProject())) return
    await onOpenDemo(scenario.id)
    onForked?.(template)
  }, [demoById, onForked, onOpenDemo, onPrepareForkProject])

  const forkCloud = useCallback(async (template: CommunityTemplate) => {
    setForkBusy(template.id)
    setFeedback(null)
    try {
      if (!(await onPrepareForkProject())) return
      const result = await fetchCommunityFork(template.id)
      if (!result.ok || !result.canvasData) {
        setFeedback({ kind: 'error', message: result.error ?? 'This template could not be read.' })
        return
      }
      if (!applyTemplateFile(result.canvasData)) {
        setFeedback({ kind: 'error', message: 'This template is malformed and was not applied.' })
        return
      }
      // Name the fork after the source design — anything else is theft in reverse.
      const state = useProjectStore.getState()
      if (state.currentProject) {
        useProjectStore.setState({
          currentProject: { ...state.currentProject, name: result.canvasData.name },
        })
      }
      useAppStore.getState().setWorkspaceMode(result.canvasData.workspaceMode)
      onForked?.(template)
    } finally {
      setForkBusy(null)
    }
  }, [onForked, onPrepareForkProject])

  const fork = useCallback((template: CommunityTemplate) => {
    if (template.source === 'curated') void forkCurated(template)
    else void forkCloud(template)
  }, [forkCurated, forkCloud])

  const importFile = useCallback(async (file: File) => {
    setFeedback(null)
    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(await file.text())
    } catch {
      setFeedback({ kind: 'error', message: 'Not valid JSON.' })
      return
    }
    let parsed
    try {
      parsed = parseCommunityTemplate(parsedJson)
    } catch (err) {
      setFeedback({ kind: 'error', message: err instanceof Error ? err.message : 'Not a Folio template file.' })
      return
    }
    if (!(await onPrepareForkProject())) return
    if (!applyTemplateFile(parsed)) {
      setFeedback({ kind: 'error', message: 'The design payload could not be applied.' })
      return
    }
    const state = useProjectStore.getState()
    if (state.currentProject) {
      useProjectStore.setState({ currentProject: { ...state.currentProject, name: parsed.name } })
    }
    setFeedback({ kind: 'ok', message: `Imported “${parsed.name}” — it is yours to fork freely.` })
    onForked?.({
      id: `import-${Date.now()}`,
      name: parsed.name,
      description: parsed.description,
      discipline: parsed.discipline,
      license: parsed.license,
      authorName: parsed.authorName,
      source: 'community',
      workspaceMode: parsed.workspaceMode,
      clonedCount: 0,
      createdAt: Date.now(),
    })
  }, [onForked, onPrepareForkProject])

  const submitPublish = useCallback(async () => {
    setPublishError(null)
    setPublishing(true)
    try {
      const result = await publishCommunityTemplate(
        { name: publishName.trim(), description: publishDescription.trim(), discipline: publishDiscipline, license: publishLicense },
        localProfile?.name ?? 'You',
      )
      if (!result.ok) {
        setPublishError(result.error ?? 'Publish refused.')
        return
      }
      setPublishOpen(false)
      setFeedback({ kind: 'ok', message: `Published “${publishName.trim()}” — others can fork it now.` })
      await refresh()
    } finally {
      setPublishing(false)
    }
  }, [localProfile, publishDescription, publishDiscipline, publishLicense, publishName, refresh])

  const communityRows = templates
  const curatedRows = CURATED_TEMPLATES

  return (
    <section className="launcher-community" aria-labelledby="community-heading">
      <div className="launcher-community__head">
        <h2 id="community-heading" className="launcher-section-title">
          Start from proven designs
        </h2>
        <p className="launcher-community__sub">
          CC-licensed templates to fork into your own workspace — no blank page, no
          copying by hand.
        </p>
        <div className="launcher-community__actions">
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setImportOpen(true)} aria-label="Import a template file">
            <Upload className="h-3.5 w-3.5" aria-hidden="true" /> Import file
          </Button>
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => {
            const { filename, text } = serializeTemplateFile()
            downloadFile(text, filename, 'application/json')
          }} aria-label="Export the current design as a template file">
            <Download className="h-3.5 w-3.5" aria-hidden="true" /> Export template
          </Button>
          {cloudMode && (
            <Button size="sm" className="gap-1.5" onClick={() => setPublishOpen(true)} aria-label="Publish the current design to the community">
              <Send className="h-3.5 w-3.5" aria-hidden="true" /> Publish
            </Button>
          )}
        </div>
      </div>

      {(feedback || loadError) && (
        <p role={feedback?.kind === 'error' || loadError ? 'alert' : 'status'} className={`launcher-community__feedback ${(feedback?.kind === 'error' || loadError) ? 'text-destructive' : 'text-success'}`}>
          {feedback?.message ?? loadError}
        </p>
      )}

      <div className="launcher-community__grid" aria-busy={loading}>
        {[...curatedRows, ...communityRows].map((template) => (
          <article key={template.id} className="launcher-community__card">
            <div className="launcher-community__card-head">
              <span className="launcher-community__discipline">{DISCIPLINE_LABEL[template.discipline]}</span>
              <span className="launcher-community__license">{licenseLabel(template.license)}</span>
            </div>
            <h3 className="launcher-community__title">{template.name}</h3>
            <p className="launcher-community__desc">{template.description}</p>
            <div className="launcher-community__foot">
              <span className="launcher-community__meta">
                {template.source === 'curated'
                  ? 'Folio team · ships in the box'
                  : `${template.authorName} · ${template.clonedCount} fork${template.clonedCount === 1 ? '' : 's'}`}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => fork(template)}
                disabled={forkBusy === template.id}
                aria-label={`Fork ${template.name}`}
              >
                {forkBusy === template.id
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  : <GitFork className="h-3.5 w-3.5" aria-hidden="true" />}
                Fork
              </Button>
            </div>
          </article>
        ))}
      </div>

      {!cloudMode && (
        <p className="launcher-community__note">
          This build runs offline — templates ship with the app and travel as .json files.
          Configure the Folio cloud (VITE_SUPABASE_URL) to publish and fork designs hosted
          by the community.
        </p>
      )}

      {publishOpen && (
        <DialogShell onClose={() => setPublishOpen(false)} labelledBy="publish-heading" describedBy="publish-desc" className="max-w-md">
          <div className="flex items-center justify-between border-b border-border p-4">
            <h2 id="publish-heading" className="flex items-center gap-2 text-sm font-semibold">
              <FlaskConical className="h-4 w-4 text-primary" aria-hidden="true" />
              Publish to the community
            </h2>
            <button type="button" className="cad-ctl cad-ctl--icon" onClick={() => setPublishOpen(false)} aria-label="Close">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <div className="space-y-3 p-4">
            <p id="publish-desc" className="text-xs leading-relaxed text-muted-foreground">
              Anyone can fork a published template. The licence you choose travels with
              every fork — there is no relicensing later.
            </p>
            <div>
              <Label htmlFor="publish-name">Name</Label>
              <Input id="publish-name" value={publishName} onChange={(e) => setPublishName(e.target.value)} maxLength={120} />
            </div>
            <div>
              <Label htmlFor="publish-desc">Description</Label>
              <Input id="publish-description" value={publishDescription} onChange={(e) => setPublishDescription(e.target.value)} maxLength={600} placeholder="What does it do, and what did you learn building it?" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="publish-discipline">Discipline</Label>
                <select id="publish-discipline" value={publishDiscipline} onChange={(e) => setPublishDiscipline(e.target.value as Discipline)} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground">
                  {DISCIPLINE_OPTIONS.map(([id, label]) => (
                    <option key={id} value={id}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="publish-license">Licence</Label>
                <select id="publish-license" value={publishLicense} onChange={(e) => setPublishLicense(e.target.value as CommunityLicense)} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground">
                  {LICENSE_OPTIONS.map(([id, label]) => (
                    <option key={id} value={id}>{label}</option>
                  ))}
                </select>
              </div>
            </div>
            {publishError && (
              <p role="alert" className="flex items-start gap-2 text-xs text-destructive">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                {publishError}
              </p>
            )}
            <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
              <Button variant="ghost" size="sm" onClick={() => setPublishOpen(false)}>Cancel</Button>
              <Button size="sm" onClick={() => void submitPublish()} disabled={publishing || !publishName.trim()}>
                {publishing ? 'Publishing…' : 'Publish template'}
              </Button>
            </div>
          </div>
        </DialogShell>
      )}

      {importOpen && (
        <DialogShell onClose={() => setImportOpen(false)} labelledBy="import-heading" describedBy="import-desc" className="max-w-md">
          <div className="flex items-center justify-between border-b border-border p-4">
            <h2 id="import-heading" className="text-sm font-semibold">Import a template file</h2>
            <button type="button" className="cad-ctl cad-ctl--icon" onClick={() => setImportOpen(false)} aria-label="Close">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <div className="space-y-3 p-4">
            <p id="import-desc" className="text-xs leading-relaxed text-muted-foreground">
              A <code>.folio-template.json</code> file from someone whose design you want to
              fork. Only designs are applied — no code runs from this file.
            </p>
            <label className="cad-empty-sheet__action mx-auto block w-fit cursor-pointer">
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Choose the .json file…</span>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) {
                    setImportOpen(false)
                    void importFile(file)
                  }
                }}
              />
            </label>
          </div>
        </DialogShell>
      )}
    </section>
  )
}
