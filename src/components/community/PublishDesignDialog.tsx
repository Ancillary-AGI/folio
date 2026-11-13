/**
 * Publish the current design as a public community template.
 *
 * The single place the CAD reaches to share a design with other studios.
 * Cloud: writes a `community_projects` row (author, name, licence, payload).
 * Offline: refuses honestly and points at the file-handoff path.
 */
import { useEffect, useState, type FormEvent } from 'react'
import { FlaskConical, AlertCircle, X } from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import DialogShell from '../ui/DialogShell'
import {
  publishCommunityTemplate,
  type Discipline,
  type CommunityLicense,
} from '../../lib/community/community'
import { useProjectStore } from '../../stores/useProjectStore'
import { useLocalProfileStore } from '../../stores/useLocalProfileStore'
import { isSupabaseConfigured } from '../../lib/supabase'

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
  ['cc-by-4.0', 'CC-BY-4.0 — attribution required'],
  ['cc0-1.0', 'CC0-1.0 — no rights reserved'],
]

interface PublishDesignDialogProps {
  open: boolean
  onClose: () => void
}

export default function PublishDesignDialog({ open, onClose }: PublishDesignDialogProps) {
  const project = useProjectStore((state) => state.currentProject)
  const localProfile = useLocalProfileStore((state) => state.profiles.find(p => p.id === state.activeProfileId) ?? null)
  const [name, setName] = useState(project?.name ?? '')
  const [description, setDescription] = useState('')
  const [discipline, setDiscipline] = useState<Discipline>('circuits')
  const [license, setLicense] = useState<CommunityLicense>('cc-by-4.0')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const cloudMode = isSupabaseConfigured
  const currentName = project?.name ?? 'Design'

  useEffect(() => {
    if (open) {
      setName(project?.name ?? 'Untitled design')
      setDescription('')
      setError(null)
      setOk(null)
    }
  }, [open, project?.name])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    if (!cloudMode) {
      setError('Publishing needs the Folio cloud. Export a .folio-template.json instead and hand it off — import does exactly the same thing, just by file.')
      return
    }
    setBusy(true)
    setError(null)
    setOk(null)
    try {
      const result = await publishCommunityTemplate(
        { name: name.trim(), description: description.trim(), discipline, license },
        localProfile?.name ?? 'You',
      )
      if (result.ok) {
        setOk('Published — others can open it in the community now.')
      } else {
        setError(result.error ?? 'Publish refused.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publish failed.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  if (!cloudMode) {
    return (
      <DialogShell onClose={onClose} labelledBy="publish-map-heading" describedBy="publish-map-desc" className="max-w-md">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h2 id="publish-map-heading" className="flex items-center gap-2 text-sm font-semibold">
            <FlaskConical className="h-4 w-4 text-primary" aria-hidden="true" />
            Publish to the community
          </h2>
          <button type="button" className="cad-ctl cad-ctl--icon" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="space-y-3 p-4">
          <p id="publish-map-desc" className="text-xs leading-relaxed text-muted-foreground">
            {currentName} is not on the cloud, so other studios cannot see it. Export a
            <code>.folio-template.json</code> and hand it over; the recipient imports it on their own
            machine and they own it the moment they open it.
          </p>
          {error && (
            <p role="alert" className="flex items-start gap-2 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
              {error}
            </p>
          )}
          <Button className="w-full" onClick={onClose}>Got it</Button>
        </div>
      </DialogShell>
    )
  }

  return (
    <DialogShell onClose={onClose} labelledBy="publish-heading" describedBy="publish-desc" className="max-w-md">
      <div className="flex items-center justify-between border-b border-border p-4">
        <h2 id="publish-heading" className="flex items-center gap-2 text-sm font-semibold">
          <FlaskConical className="h-4 w-4 text-primary" aria-hidden="true" />
          Publish to the community
        </h2>
        <button type="button" className="cad-ctl cad-ctl--icon" onClick={onClose} aria-label="Close">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <form onSubmit={submit} className="space-y-3 p-4">
        <p id="publish-desc" className="text-xs leading-relaxed text-muted-foreground">
          Anyone in the community will be able to open <strong>{currentName}</strong> and make it theirs.
          The licence you pick travels with every copy.
        </p>
        <div>
          <Label htmlFor="publish-name">Name</Label>
          <Input id="publish-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
        </div>
        <div>
          <Label htmlFor="publish-desc">Description</Label>
          <Input id="publish-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={600} placeholder="What does it do — and what should someone know before opening it?" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="publish-discipline">Discipline</Label>
            <select id="publish-discipline" value={discipline} onChange={(e) => setDiscipline(e.target.value as Discipline)} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground">
              {DISCIPLINE_OPTIONS.map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="publish-license">Licence</Label>
            <select id="publish-license" value={license} onChange={(e) => setLicense(e.target.value as CommunityLicense)} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground">
              {LICENSE_OPTIONS.map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
          </div>
        </div>
        {error && (
          <p role="alert" className="flex items-start gap-2 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}
        {ok && <p role="status" className="text-xs font-semibold text-success">{ok}</p>}
        <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
          <Button variant="ghost" size="sm" type="button" onClick={onClose}>Cancel</Button>
          <Button size="sm" type="submit" disabled={busy || !name.trim() || Boolean(ok)}>
            {busy ? 'Publishing…' : ok ? 'Published' : 'Publish template'}
          </Button>
        </div>
      </form>
    </DialogShell>
  )
}
