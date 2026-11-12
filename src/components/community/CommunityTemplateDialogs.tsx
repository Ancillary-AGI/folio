/**
 * Publish and import dialogs for community templates.
 *
 * Shared by the launcher section and the /community page so both surfaces
 * behave identically — one publish form, one import path.
 */
import { useRef } from 'react'
import { Upload, FlaskConical, AlertCircle, X } from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import DialogShell from '../ui/DialogShell'
import {
  DISCIPLINE_OPTIONS,
  LICENSE_OPTIONS,
  type CommunityTemplatesController,
} from './useCommunityTemplates'
import type { Discipline, CommunityLicense } from '../../lib/community/community'

interface CommunityTemplateDialogsProps {
  controller: CommunityTemplatesController
}

export default function CommunityTemplateDialogs({ controller }: CommunityTemplateDialogsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { publish, importDialog, importFile } = controller

  return (
    <>
      {publish.open && (
        <DialogShell onClose={() => publish.setOpen(false)} labelledBy="publish-heading" describedBy="publish-desc" className="max-w-md">
          <div className="flex items-center justify-between border-b border-border p-4">
            <h2 id="publish-heading" className="flex items-center gap-2 text-sm font-semibold">
              <FlaskConical className="h-4 w-4 text-primary" aria-hidden="true" />
              Publish to the community
            </h2>
            <button type="button" className="cad-ctl cad-ctl--icon" onClick={() => publish.setOpen(false)} aria-label="Close">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <div className="space-y-3 p-4">
            <p id="publish-desc" className="text-xs leading-relaxed text-muted-foreground">
              Anyone can open a published template. The licence you choose travels with
              every copy — there is no relicensing later.
            </p>
            <div>
              <Label htmlFor="publish-name">Name</Label>
              <Input id="publish-name" value={publish.name} onChange={(e) => publish.setName(e.target.value)} maxLength={120} />
            </div>
            <div>
              <Label htmlFor="publish-desc">Description</Label>
              <Input id="publish-description" value={publish.description} onChange={(e) => publish.setDescription(e.target.value)} maxLength={600} placeholder="What does it do, and what did you learn building it?" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="publish-discipline">Discipline</Label>
                <select id="publish-discipline" value={publish.discipline} onChange={(e) => publish.setDiscipline(e.target.value as Discipline)} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground">
                  {DISCIPLINE_OPTIONS.map(([id, label]) => (
                    <option key={id} value={id}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="publish-license">Licence</Label>
                <select id="publish-license" value={publish.license} onChange={(e) => publish.setLicense(e.target.value as CommunityLicense)} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground">
                  {LICENSE_OPTIONS.map(([id, label]) => (
                    <option key={id} value={id}>{label}</option>
                  ))}
                </select>
              </div>
            </div>
            {publish.error && (
              <p role="alert" className="flex items-start gap-2 text-xs text-destructive">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                {publish.error}
              </p>
            )}
            <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
              <Button variant="ghost" size="sm" onClick={() => publish.setOpen(false)}>Cancel</Button>
              <Button size="sm" onClick={() => void publish.submit()} disabled={publish.publishing || !publish.name.trim()}>
                {publish.publishing ? 'Publishing…' : 'Publish template'}
              </Button>
            </div>
          </div>
        </DialogShell>
      )}

      {importDialog.open && (
        <DialogShell onClose={() => importDialog.setOpen(false)} labelledBy="import-heading" describedBy="import-desc" className="max-w-md">
          <div className="flex items-center justify-between border-b border-border p-4">
            <h2 id="import-heading" className="text-sm font-semibold">Import a template file</h2>
            <button type="button" className="cad-ctl cad-ctl--icon" onClick={() => importDialog.setOpen(false)} aria-label="Close">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <div className="space-y-3 p-4">
            <p id="import-desc" className="text-xs leading-relaxed text-muted-foreground">
              A <code>.folio-template.json</code> file from someone whose design you want to
              use. Only designs are applied — no code runs from this file.
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
                    importDialog.setOpen(false)
                    void importFile(file)
                  }
                }}
              />
            </label>
          </div>
        </DialogShell>
      )}
    </>
  )
}
