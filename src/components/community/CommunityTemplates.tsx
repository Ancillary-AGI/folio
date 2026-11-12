/**
 * Community templates — the launcher's answer to "someone already solved it".
 *
 * Shows the CC-licensed templates to open. The dedicated /community page owns
 * search, filtering and the full grid; this section stays compact and links
 * there. Opening never creates a project — the design lands attributed and
 * read-only; it becomes the user's only when they make it theirs.
 */
import { ArrowRight, FolderOpen, Loader2, Send, Upload, Download } from 'lucide-react'
import { Button } from '../ui/button'
import {
  useCommunityTemplates,
  DISCIPLINE_LABEL,
  type UseCommunityTemplatesOptions,
} from './useCommunityTemplates'
import CommunityTemplateDialogs from './CommunityTemplateDialogs'
import { licenseLabel } from '../../lib/community/community'

interface CommunityTemplatesProps extends UseCommunityTemplatesOptions {
  /** Navigates to the dedicated /community page. */
  onBrowseAll?: () => void
}

export default function CommunityTemplates({ onOpenTemplate, onImportFile, onBrowseAll }: CommunityTemplatesProps) {
  const controller = useCommunityTemplates({ onOpenTemplate, onImportFile })
  const { allTemplates, cloudMode, loading, loadError, feedback, openBusy, open, exportTemplate } = controller
  const publish = controller.publish
  const importDialog = controller.importDialog

  const shown = allTemplates

  return (
    <section className="launcher-community" aria-labelledby="community-heading">
      <div className="launcher-community__head">
        <h2 id="community-heading" className="launcher-section-title">
          Start from proven designs
        </h2>
        <p className="launcher-community__sub">
          Open a CC-licensed template and look around — it becomes yours when you
          decide to make it yours, not before.
        </p>
        <div className="launcher-community__actions">
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => importDialog.setOpen(true)} aria-label="Import a template file">
            <Upload className="h-3.5 w-3.5" aria-hidden="true" /> Import file
          </Button>
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={exportTemplate} aria-label="Export the current design as a template file">
            <Download className="h-3.5 w-3.5" aria-hidden="true" /> Export template
          </Button>
          {cloudMode && (
            <Button size="sm" className="gap-1.5" onClick={() => publish.setOpen(true)} aria-label="Publish the current design to the community">
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
        {shown.map((template) => (
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
                  : `${template.authorName} · ${template.clonedCount} opened${template.clonedCount === 1 ? '' : 's'}`}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => void open(template)}
                disabled={openBusy === template.id}
                aria-label={`Open ${template.name}`}
              >
                {openBusy === template.id
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  : <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />}
                Open design
              </Button>
            </div>
          </article>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        {!cloudMode && (
          <p className="launcher-community__note">
            This build runs offline — templates ship with the app and travel as .json files.
          </p>
        )}
        {onBrowseAll && (
          <button
            type="button"
            onClick={onBrowseAll}
            className="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold text-primary transition-colors hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Browse all {allTemplates.length} templates
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      <CommunityTemplateDialogs controller={controller} />
    </section>
  )
}
