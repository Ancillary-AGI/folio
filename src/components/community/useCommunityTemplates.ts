/**
 * Shared behaviour for community designs.
 *
 * One implementation backs both the launcher's "Start from proven designs"
 * section and the dedicated /community page. Opening a template never creates
 * a project: it hands the template to the caller, which opens it read-only,
 * attributed to its author. The project — and its owner — only appears when
 * the person decides to make the design theirs.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CURATED_TEMPLATES,
  fetchCommunityTemplates,
  publishCommunityTemplate,
  serializeTemplateFile,
  parseCommunityTemplate,
  type CommunityTemplate,
  type CommunityTemplateFile,
  type Discipline,
  type CommunityLicense,
} from '../../lib/community/community'
import { isSupabaseConfigured } from '../../lib/supabase'
import { useProjectStore } from '../../stores/useProjectStore'
import { useActiveProfile } from '../../stores/useLocalProfileStore'
import { downloadFile } from '../../lib/exportUtils'

export interface UseCommunityTemplatesOptions {
  /**
   * Opens a template in the workbench as an attributed, read-only preview.
   * Resolves when the design is on screen; rejects with a readable message
   * when it cannot be (no demo seed, cloud payload refused, offline cloud row).
   */
  onOpenTemplate: (template: CommunityTemplate) => Promise<void> | void
  /** Imports a hand-carried template file as the user's own design. Resolves
   * false (or throws) when the file was refused; a void resolution is treated
   * as success for callers that never report failure. */
  onImportFile: (parsed: CommunityTemplateFile, template: CommunityTemplate) => Promise<boolean | void> | boolean | void
}

export const DISCIPLINE_LABEL: Record<Discipline, string> = {
  circuits: 'Circuits',
  control: 'Control',
  mechanical: 'Mechanical',
  robotics: 'Robotics',
  rf: 'RF',
  software: 'Software',
  other: 'Other',
}

export const DISCIPLINE_OPTIONS = Object.entries(DISCIPLINE_LABEL) as Array<[Discipline, string]>

export const LICENSE_OPTIONS: Array<[CommunityLicense, string]> = [
  ['cc-by-4.0', 'CC-BY-4.0 — open freely, keep attribution'],
  ['cc0-1.0', 'CC0-1.0 — no rights reserved'],
]

export function useCommunityTemplates({ onOpenTemplate, onImportFile }: UseCommunityTemplatesOptions) {
  const projectName = useProjectStore((state) => state.currentProject?.name ?? '')
  const localProfile = useActiveProfile()
  const [templates, setTemplates] = useState<CommunityTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [publishOpen, setPublishOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [openBusy, setOpenBusy] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; message: string } | null>(null)

  const cloudMode = isSupabaseConfigured
  const [publishName, setPublishName] = useState(projectName)
  const [publishDescription, setPublishDescription] = useState('')
  const [publishDiscipline, setPublishDiscipline] = useState<Discipline>('circuits')
  const [publishLicense, setPublishLicense] = useState<CommunityLicense>('cc-by-4.0')
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const { templates: cloud, error } = await fetchCommunityTemplates()
      setTemplates(cloud)
      setLoadError(error)
    } catch (err) {
      // A network throw (offline, DNS, refused) must not wedge the spinner
      // or escape as an unhandled rejection.
      setLoadError(err instanceof Error ? err.message : 'The community gallery could not be reached.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Keep the publish form's default name in step with the open project.
  useEffect(() => {
    setPublishName(projectName)
  }, [projectName])

  const open = useCallback(async (template: CommunityTemplate) => {
    setOpenBusy(template.id)
    setFeedback(null)
    try {
      await onOpenTemplate(template)
    } catch (err) {
      setFeedback({ kind: 'error', message: err instanceof Error ? err.message : 'This design could not be opened.' })
    } finally {
      setOpenBusy(null)
    }
  }, [onOpenTemplate])

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
    try {
      const accepted = await onImportFile(parsed, {
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
      if (accepted === false) {
        // The caller already said why; show the same refusal here.
        setFeedback({ kind: 'error', message: 'That file could not be imported — your design was left untouched.' })
        return
      }
      setFeedback({ kind: 'ok', message: `Imported “${parsed.name}” — it is yours to edit.` })
    } catch (err) {
      setFeedback({ kind: 'error', message: err instanceof Error ? err.message : 'The design could not be imported.' })
    }
  }, [onImportFile])

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
      setFeedback({ kind: 'ok', message: `Published “${publishName.trim()}” — others can open it now.` })
      await refresh()
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : 'The design could not be published.')
    } finally {
      setPublishing(false)
    }
  }, [localProfile, publishDescription, publishDiscipline, publishLicense, publishName, refresh])

  const exportTemplate = useCallback(() => {
    const { filename, text } = serializeTemplateFile()
    downloadFile(text, filename, 'application/json')
  }, [])

  /** Every card the grids show: curated seeds plus fetched cloud templates. */
  const allTemplates = useMemo(() => [...CURATED_TEMPLATES, ...templates], [templates])

  return {
    allTemplates,
    cloudMode,
    templates,
    loading,
    loadError,
    feedback,
    openBusy,
    open,
    importFile,
    exportTemplate,
    publish: {
      open: publishOpen,
      setOpen: setPublishOpen,
      name: publishName,
      setName: setPublishName,
      description: publishDescription,
      setDescription: setPublishDescription,
      discipline: publishDiscipline,
      setDiscipline: setPublishDiscipline,
      license: publishLicense,
      setLicense: setPublishLicense,
      publishing,
      error: publishError,
      submit: submitPublish,
    },
    importDialog: { open: importOpen, setOpen: setImportOpen },
  }
}

export type CommunityTemplatesController = ReturnType<typeof useCommunityTemplates>
