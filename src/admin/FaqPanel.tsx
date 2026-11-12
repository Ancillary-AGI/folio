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
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import type { AdminApi, FaqEntry } from '../lib/admin/adminService'

interface FaqPanelProps {
  api: AdminApi
  onReload: () => void
}

const TEMP = { id: '_new', question: '', answer: '', position: 0, published: true, updatedAt: 0 }

export default function FaqPanel({ api, onReload }: FaqPanelProps) {
  const [entries, setEntries] = useState<FaqEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

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
    const index = entries.findIndex((candidate) => candidate.id === entry.id)
    const target = entries[index + direction]
    if (!target) return
    const result = await api.saveFaq({ id: entry.id, question: entry.question, answer: entry.answer, position: target.position, published: entry.published })
    if (result.ok) await load()
    setMessage(result.ok ? 'Reordered.' : result.error ?? 'Could not reorder.')
  }, [api, entries, load])

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
    setDraft({ id: TEMP.id, question: '', answer: '', position: entries.length ? Math.max(...entries.map((entry) => entry.position)) + 1 : 0, published: true, updatedAt: 0 })
    setAdding(true)
    setMessage('')
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-foreground">FAQ entries</h2>
          <p className="text-xs text-muted-foreground">First &quot;question&quot; appears open on the site; visitors can toggle the rest.</p>
        </div>
        <Button size="sm" onClick={startAdd} disabled={adding || saving}>
          <Plus className="h-4 w-4" aria-hidden="true" />Add entry
        </Button>
      </div>

      {adding && draft && (
        <form onSubmit={submit} className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">{draft.id === TEMP.id ? 'New entry' : 'Edit entry'}</p>
            <button type="button" onClick={() => { setDraft(null); setAdding(false) }} aria-label="Discard draft" className="cad-ctl cad-ctl--icon">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
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
      ) : entries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/80 p-6 text-center">
          <BookMarked className="mx-auto h-6 w-6 text-muted-foreground/60" aria-hidden="true" />
          <p className="mt-2 text-sm font-semibold text-foreground">No entries yet</p>
          <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">Write the first FAQ entry. If this table does not exist yet, add it in Supabase and deploy the operator migration.</p>
        </div>
      ) : (
        <ol className="divide-y divide-border/70 rounded-xl border border-border/70 bg-card/40">
          {entries.map((entry, index) => (
            <li key={entry.id} className="flex items-start gap-3 p-3">
              <div className="flex flex-col items-center gap-0.5 pt-0.5">
                <button type="button" onClick={() => move(entry, -1)} aria-label="Move up" className="cad-ctl cad-ctl--icon" disabled={index === 0 || saving}>
                  <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button type="button" onClick={() => move(entry, 1)} aria-label="Move down" className="cad-ctl cad-ctl--icon" disabled={index === entries.length - 1 || saving}>
                  <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
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
                <button type="button" onClick={() => remove(entry)} aria-label="Delete entry" className="cad-ctl cad-ctl--icon text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
