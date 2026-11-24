/**
 * Admin console — FAQ entries.
 *
 * Owns the question/answer copy the public site shows. Entries are ordered
 * by `position` (ties break on id), and hidden completely by flipping
 * `published` to false. Nothing here claims a backend is connected — when
 * the table does not exist, the panel says so and offers nothing to edit.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ArrowDown, ArrowUp, BookMarked, Plus, Save, Trash2, X } from 'lucide-react'
import { Button } from '../components/ui/button'
import HoverHelp from '../components/ui/HoverHelp'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import type { AdminApi, FaqEntry } from '../lib/admin/adminService'
import { FAQ_SURFACES, type FaqSurface } from '../lib/content/faq'

interface FaqPanelProps {
  api: AdminApi
  onReload: () => void
}

const SURFACE_LABELS: Record<FaqSurface, string> = {
  home: 'Home page',
  pricing: 'Pricing page',
}

const TEMP = { id: '_new', surface: 'home' as FaqSurface, question: '', answer: '', position: 0, published: true, updatedAt: 0 }

export default function FaqPanel({ api, onReload }: FaqPanelProps) {
  const [entries, setEntries] = useState<FaqEntry[]>([])
  const [surface, setSurface] = useState<FaqSurface>('home')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const visible = entries.filter((entry) => entry.surface === surface)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const result = await api.listFaq()
    if (result.error) setError(result.error)
    setEntries(result.entries)
    setLoading(false)
  }, [api])

  useEffect(() => { void load() }, [load])

  const move = useCallback(async (entry: FaqEntry, direction: -1 | 1) => {
    const index = visible.findIndex((candidate) => candidate.id === entry.id)
    const target = visible[index + direction]
    if (!target) return
    /* Swap both rows: saving only one would leave two entries at the same
     * position, and the tie-break would decide the order instead of the click. */
    const first = await api.saveFaq({ ...entry, position: target.position })
    const second = first.ok ? await api.saveFaq({ ...target, position: entry.position }) : first
    if (first.ok && second.ok) await load()
    setMessage(second.ok ? 'Reordered.' : second.error ?? 'Could not reorder.')
  }, [api, visible, load])

  const toggle = useCallback(async (entry: FaqEntry) => {
    const result = await api.saveFaq({ ...entry, published: !entry.published })
    if (result.ok) await load()
    setMessage(result.ok ? (entry.published ? 'Hidden.' : 'Published.') : result.error ?? 'Could not update.')
  }, [api, load])

  const remove = useCallback(async (entry: FaqEntry) => {
    setSaving(true)
    const result = await api.deleteFaq(entry.id)
    if (result.ok) await load()
    setMessage(result.ok ? 'Deleted.' : result.error ?? 'Could not delete.')
    setSaving(false)
  }, [api, load])

  const [draft, setDraft] = useState<FaqEntry | null>(null)
  const [adding, setAdding] = useState(false)

  const submit = useCallback(async (event: FormEvent) => {
    event.preventDefault()
    if (!draft) return
    setSaving(true)
    setMessage('')
    const result = await api.saveFaq({
      id: draft.id === TEMP.id ? undefined : draft.id,
      surface: draft.surface,
      question: draft.question.trim(),
      answer: draft.answer.trim(),
      position: draft.position,
      published: draft.published,
    })
    setSaving(false)
    if (!result.ok) { setMessage(result.error ?? 'Could not save.'); return }
    setDraft(null)
    setAdding(false)
    setMessage('Saved.')
    await load()
    onReload()
  }, [api, draft, load, onReload])

  const startAdd = () => {
    setDraft({
      ...TEMP,
      surface,
      position: visible.length ? Math.max(...visible.map((entry) => entry.position)) + 1 : 0,
    })
    setAdding(true)
    setMessage('')
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-foreground">FAQ entries</h2>
          <p className="text-xs text-muted-foreground">Each list belongs to one public page. First question appears open; visitors toggle the rest.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="FAQ page" className="flex items-center gap-0.5 rounded-md border border-border bg-muted/30 p-0.5">
            {FAQ_SURFACES.map((candidate) => (
              <Button
                key={candidate}
                type="button"
                size="sm"
                variant={surface === candidate ? 'secondary' : 'ghost'}
                aria-pressed={surface === candidate}
                onClick={() => {
                  setSurface(candidate)
                  setDraft(null)
                  setAdding(false)
                  setMessage('')
                }}
              >
                {SURFACE_LABELS[candidate]}
              </Button>
            ))}
          </div>
          <Button size="sm" onClick={startAdd} disabled={adding || saving}>
            <Plus className="h-4 w-4" aria-hidden="true" />Add entry
          </Button>
        </div>
      </div>

      {adding && draft && (
        <form onSubmit={submit} className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">{draft.id === TEMP.id ? 'New entry' : 'Edit entry'}</p>
            <HoverHelp title="Discard draft" description="Discard this draft. The FAQ table is unchanged.">
              <button type="button" onClick={() => { setDraft(null); setAdding(false) }} aria-label="Discard draft" className="cad-ctl cad-ctl--icon">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </HoverHelp>
          </div>
          <div>
            <Label htmlFor="faq-q">Question</Label>
            <Input id="faq-q" value={draft.question} onChange={(event) => setDraft({ ...draft, question: event.target.value })} maxLength={180} required autoFocus />
          </div>
          <div>
            <Label htmlFor="faq-a">Answer</Label>
            <textarea
            id="faq-a"
            value={draft.answer}
            onChange={(event) => setDraft({ ...draft, answer: event.target.value })}
            rows={4}
            required
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          </div>
          <div>
            <Label htmlFor="faq-surface">Shown on</Label>
            <select
              id="faq-surface"
              value={draft.surface}
              onChange={(event) => setDraft({ ...draft, surface: event.target.value as FaqSurface })}
              className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {FAQ_SURFACES.map((candidate) => (
                <option key={candidate} value={candidate}>{SURFACE_LABELS[candidate]}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-3">
            <Label className="flex items-center gap-1.5 text-xs" htmlFor="faq-position">
              Position
              <Input id="faq-position" type="number" className="w-20" value={draft.position} onChange={(event) => setDraft({ ...draft, position: Number(event.target.value) })} />
            </Label>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-foreground">
              <input type="checkbox" checked={draft.published} onChange={() => setDraft({ ...draft, published: !draft.published })} />
              Published
            </label>
          </div>
          <Button type="submit" disabled={saving || !draft.question.trim() || !draft.answer.trim()}>
            <Save className="h-4 w-4" aria-hidden="true" />Save
          </Button>
        </form>
      )}

      {message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}
      {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}

      {loading ? (
        <p className="text-xs text-muted-foreground">Reading the FAQ…</p>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/80 p-6 text-center">
          <BookMarked className="mx-auto h-6 w-6 text-muted-foreground/60" aria-hidden="true" />
          <p className="mt-2 text-sm font-semibold text-foreground">No entries yet</p>
          <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
            {`Write the first entry for the ${SURFACE_LABELS[surface].toLowerCase()}. If this table does not exist yet, add it in Supabase and deploy the operator migration.`}
          </p>
        </div>
      ) : (
        <ol className="divide-y divide-border/70 rounded-xl border border-border/70 bg-card/40">
          {visible.map((entry, index) => (
            <li key={entry.id} className="flex items-start gap-3 p-3">
              <div className="flex flex-col items-center gap-0.5 pt-0.5">
                <HoverHelp title="Move up" description="Show this entry one slot earlier in the list.">
                  <button type="button" onClick={() => move(entry, -1)} aria-label="Move up" className="cad-ctl cad-ctl--icon" disabled={index === 0 || saving}>
                    <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </HoverHelp>
                <HoverHelp title="Move down" description="Show this entry one slot later in the list.">
                  <button type="button" onClick={() => move(entry, 1)} aria-label="Move down" className="cad-ctl cad-ctl--icon" disabled={index === visible.length - 1 || saving}>
                    <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </HoverHelp>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-foreground">{entry.question}</p>
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">{entry.answer}</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <label className="flex cursor-pointer items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
                    <input type="checkbox" checked={entry.published} onChange={() => toggle(entry)} aria-label={entry.published ? 'Unpublish' : 'Publish'} />
                    {entry.published ? 'Published' : 'Hidden'}
                  </label>
                  <span className="tabular-nums text-[10px] text-muted-foreground/70">#{entry.position}</span>
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-1">
                <Button variant="ghost" size="sm" onClick={() => { setDraft(entry); setAdding(true) }} aria-label="Edit entry">
                  Edit
                </Button>
                <HoverHelp title="Delete entry" description="Delete this FAQ entry from the deployment.">
                  <button type="button" onClick={() => remove(entry)} aria-label="Delete entry" className="cad-ctl cad-ctl--icon text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </HoverHelp>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
