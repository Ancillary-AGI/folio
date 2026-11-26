/**
 * Admin console — legal and company pages.
 *
 * Owns the copy the public site serves at /about, /terms, /privacy and
 * /security. Pages are keyed by slug, so the set of pages is fixed; an
 * operator edits what each one says, not which routes exist.
 *
 * Each section body is edited as rich text in a contentEditable surface with a
 * formatting toolbar. The editor's DOM is read at save time and stored as a
 * structured block document, never as HTML, so the public renderer can build
 * semantic elements without trusting operator markup or shipping a sanitizer
 * on the reading path.
 *
 * Nothing here claims a backend is connected: when the table is missing, the
 * panel says so and offers nothing to edit.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { ExternalLink, FileText, Plus, Save, X } from 'lucide-react'
import { Button } from '../components/ui/button'
import HoverHelp from '../components/ui/HoverHelp'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import type { AdminApi, LegalPageEntry } from '../lib/admin/adminService'
import { LEGAL_PAGE_SLUGS, type LegalPageSection, type LegalPageSlug } from '../lib/legal/legalPages'
import { richTextHasText, type RichTextBlock } from '../lib/legal/richText'
import RichTextEditor, { type RichTextEditorHandle } from './RichTextEditor'

interface LegalPanelProps {
  api: AdminApi
  onReload: () => void
}

interface SectionDraft {
  heading: string
  body: RichTextBlock[]
}

/** A page being edited: the stored fields, with sections in their edit form. */
type PageDraft = Omit<LegalPageEntry, 'sections'> & { sections: SectionDraft[] }

const toDraft = (entry: LegalPageEntry): PageDraft => ({
  slug: entry.slug,
  title: entry.title,
  eyebrow: entry.eyebrow,
  heading: entry.heading,
  lede: entry.lede,
  updatedAt: entry.updatedAt,
  sections: entry.sections.map((section) => ({ heading: section.heading, body: section.body })),
})

const routeOf = (slug: LegalPageSlug): string => `/${slug}`

export default function LegalPanel({ api, onReload }: LegalPanelProps) {
  const [pages, setPages] = useState<LegalPageEntry[]>([])
  const [draft, setDraft] = useState<PageDraft | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const editorRefs = useRef<Array<RichTextEditorHandle | null>>([])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const result = await api.listLegalPages()
    if (result.error) setError(result.error)
    setPages(result.entries)
    setLoading(false)
  }, [api])

  useEffect(() => { void load() }, [load])

  /** Read every mounted editor, preserving the draft's section order and gaps. */
  const readDraftSections = useCallback((): SectionDraft[] => {
    if (!draft) return []
    return draft.sections.map((section, index) => ({
      heading: section.heading,
      body: editorRefs.current[index]?.read() ?? section.body,
    }))
  }, [draft])

  /** The sections that will be stored: a heading and visible text are required. */
  const capturedSections = useCallback((): LegalPageSection[] => readDraftSections()
    .map((section) => ({ heading: section.heading.trim(), body: section.body }))
    .filter((section) => section.heading.length > 0 && richTextHasText(section.body)),
  [readDraftSections])

  const submit = useCallback(async (event: FormEvent) => {
    event.preventDefault()
    if (!draft) return
    const sections = capturedSections()
    if (sections.length === 0) {
      setMessage('Add at least one section with a heading and some text.')
      return
    }
    setSaving(true)
    setMessage('')
    const result = await api.saveLegalPage({
      slug: draft.slug,
      title: draft.title,
      eyebrow: draft.eyebrow,
      heading: draft.heading,
      lede: draft.lede,
      sections,
    })
    setSaving(false)
    if (!result.ok) { setMessage(result.error ?? 'Could not save.'); return }
    if (result.warning) { setMessage(result.warning) }
    else { setMessage('Saved.') }
    setDraft(null)
    await load()
    onReload()
  }, [api, capturedSections, draft, load, onReload])

  const editSection = (index: number, patch: Partial<Pick<SectionDraft, 'heading'>>) => {
    setDraft((current) => current
      ? {
        ...current,
        sections: current.sections.map((section, at) => (at === index ? { ...section, ...patch } : section)),
      }
      : current)
  }

  const moveSection = (index: number, direction: -1 | 1) => {
    if (!draft) return
    const target = index + direction
    if (target < 0 || target >= draft.sections.length) return
    const sections = readDraftSections()
    const [moved] = sections.splice(index, 1)
    sections.splice(target, 0, moved)
    setDraft({ ...draft, sections })
  }

  const removeSection = (index: number) => {
    if (!draft) return
    const sections = readDraftSections().filter((_, at) => at !== index)
    setDraft({ ...draft, sections })
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Reading the pages…</p>
  }

  if (error && pages.length === 0) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4">
        <p className="text-sm text-foreground">The legal pages could not be read: {error}</p>
      </div>
    )
  }

  if (draft) {
    return (
      <form onSubmit={submit} className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              {draft.title || 'Untitled page'}
            </h2>
            <p className="text-xs text-muted-foreground">
              {`Served at ${routeOf(draft.slug)}. Saving changes the public page immediately; there is no separate publish step.`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              href={routeOf(draft.slug)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              View page
            </a>
            <HoverHelp title="Discard draft" description="Discard this draft. The stored page is unchanged.">
              <button
                type="button"
                onClick={() => setDraft(null)}
                aria-label="Discard draft"
                className="cad-ctl cad-ctl--icon"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </HoverHelp>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="legal-title">Browser title</Label>
            <Input
              id="legal-title"
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              maxLength={120}
              required
            />
          </div>
          <div>
            <Label htmlFor="legal-eyebrow">Eyebrow</Label>
            <Input
              id="legal-eyebrow"
              value={draft.eyebrow}
              onChange={(event) => setDraft({ ...draft, eyebrow: event.target.value })}
              maxLength={120}
            />
          </div>
        </div>

        <div>
          <Label htmlFor="legal-heading">Heading</Label>
          <textarea
            id="legal-heading"
            value={draft.heading}
            onChange={(event) => setDraft({ ...draft, heading: event.target.value })}
            rows={2}
            required
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            A line break here is kept on the page.
          </p>
        </div>

        <div>
          <Label htmlFor="legal-lede">Introduction</Label>
          <textarea
            id="legal-lede"
            value={draft.lede}
            onChange={(event) => setDraft({ ...draft, lede: event.target.value })}
            rows={3}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Sections
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setDraft({
                ...draft,
                sections: [
                  ...readDraftSections(),
                  { heading: '', body: [] },
                ],
              })}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add section
            </Button>
          </div>

          {draft.sections.map((section, index) => (
            <div key={index} className="space-y-2 rounded-xl border border-border p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {`Section ${index + 1}`}
                </p>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => moveSection(index, -1)}
                    disabled={index === 0}
                    aria-label={`Move section ${index + 1} up`}
                  >
                    Up
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => moveSection(index, 1)}
                    disabled={index === draft.sections.length - 1}
                    aria-label={`Move section ${index + 1} down`}
                  >
                    Down
                  </Button>
                  <HoverHelp title="Remove section" description="Remove this section from the page.">
                    <button
                      type="button"
                      onClick={() => removeSection(index)}
                      aria-label={`Remove section ${index + 1}`}
                      className="cad-ctl cad-ctl--icon"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </HoverHelp>
                </div>
              </div>

              <div>
                <Label htmlFor={`legal-section-${index}`}>Section heading</Label>
                <Input
                  id={`legal-section-${index}`}
                  value={section.heading}
                  onChange={(event) => editSection(index, { heading: event.target.value })}
                  maxLength={160}
                />
              </div>

              <RichTextEditor
                id={`legal-body-${index}`}
                label={`Section ${index + 1} body`}
                value={section.body}
                disabled={saving}
                hint="Use the toolbar for headings, lists, quotes, bold and links. Links must be http(s) or mailto."
                ref={(handle) => { editorRefs.current[index] = handle }}
              />
            </div>
          ))}
        </div>

        {message && <p className="text-xs text-muted-foreground">{message}</p>}

        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" disabled={saving}>
            <Save className="h-4 w-4" aria-hidden="true" />{saving ? 'Saving…' : 'Save page'}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(null)} disabled={saving}>
            Cancel
          </Button>
        </div>
      </form>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-foreground">Legal and company pages</h2>
        <p className="text-xs text-muted-foreground">
          The public pages. Editing one changes what the site serves; the slug is the route.
          Each section body is rich text.
        </p>
      </div>

      {message && <p className="text-xs text-muted-foreground">{message}</p>}

      <ul className="space-y-2">
        {LEGAL_PAGE_SLUGS.map((slug) => {
          const entry = pages.find((page) => page.slug === slug)
          return (
            <li key={slug} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3">
              <div className="flex min-w-0 items-center gap-2">
                <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{entry?.title || slug}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {entry
                      ? `${routeOf(slug)} · ${entry.sections.length} section${entry.sections.length === 1 ? '' : 's'}`
                      : `${routeOf(slug)} · not stored; the page will say it is unconfigured`}
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setMessage('')
                  setDraft(entry ? toDraft(entry) : {
                    slug,
                    title: slug,
                    eyebrow: slug,
                    heading: '',
                    lede: '',
                    sections: [{ heading: '', body: [] }],
                    updatedAt: 0,
                  })
                }}
                disabled={saving}
              >
                Edit
              </Button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
