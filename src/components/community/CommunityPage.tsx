/**
 * /community — the community projects page.
 *
 * The dedicated surface for everything people built and gave away, modelled
 * on the featured-projects pattern of tools like Flux. Curated seeds and
 * cloud-hosted templates live side by side; search and discipline filters
 * narrow the grid. Opening a design never creates a project: it opens
 * read-only, attributed — it becomes the visitor's when they make it theirs.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft, Download, Upload, Send, FolderOpen, Loader2, Search, SearchX, Sparkles, LogIn,
} from 'lucide-react'
import { Button } from '../ui/button'
import FolioLogo from '../brand/FolioLogo'
import { AuroraField } from '../brand/AuroraField'
import {
  useCommunityTemplates,
  DISCIPLINE_LABEL,
  type UseCommunityTemplatesOptions,
} from './useCommunityTemplates'
import CommunityTemplateDialogs from './CommunityTemplateDialogs'
import { licenseLabel, type Discipline, type CommunityTemplate } from '../../lib/community/community'

interface CommunityPageProps extends UseCommunityTemplatesOptions {
  /** Returns to the project list. Required when signed in; guests have nowhere to go back to. */
  onBack?: () => void
  /** False for signed-out visitors: publish is account-gated, and editing signs them in. */
  signedIn?: boolean
  /** Called when a visitor asks to join mid-browse. Required when signedIn is false. */
  onSignInRequest?: () => void
}

type SortKey = 'featured' | 'copies' | 'newest' | 'name'

const SORT_LABEL: Record<SortKey, string> = {
  featured: 'Featured',
  copies: 'Most copied',
  newest: 'Newest',
  name: 'Name A–Z',
}

const DISCIPLINE_FILTER = Object.entries(DISCIPLINE_LABEL) as Array<[Discipline, string]>

function matchesQuery(template: CommunityTemplate, query: string): boolean {
  const haystack = [
    template.name,
    template.description,
    template.authorName,
    DISCIPLINE_LABEL[template.discipline],
  ].join(' ').toLowerCase()
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((token) => haystack.includes(token))
}

export default function CommunityPage({ onBack, onOpenTemplate, onImportFile, signedIn = true, onSignInRequest }: CommunityPageProps) {
  const controller = useCommunityTemplates({ onOpenTemplate, onImportFile })
  const { allTemplates, cloudMode, loading, loadError, feedback, openBusy, open, exportTemplate } = controller
  const publish = controller.publish
  const importDialog = controller.importDialog

  const [query, setQuery] = useState('')
  const [discipline, setDiscipline] = useState<Discipline | 'all'>('all')
  const [sort, setSort] = useState<SortKey>('featured')

  // Escape returns to the project list — the one key a full-screen page owes.
  useEffect(() => {
    if (!onBack) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !publish.open && !importDialog.open) onBack()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onBack, publish.open, importDialog.open])

  const disciplineCounts = useMemo(() => {
    const counts = new Map<Discipline, number>()
    for (const template of allTemplates) {
      counts.set(template.discipline, (counts.get(template.discipline) ?? 0) + 1)
    }
    return counts
  }, [allTemplates])

  const totalCopies = useMemo(
    () => allTemplates.reduce((sum, template) => sum + template.clonedCount, 0),
    [allTemplates],
  )

  const visible = useMemo(() => {
    const tokens = query.trim()
    const filtered = allTemplates.filter((template) => {
      if (discipline !== 'all' && template.discipline !== discipline) return false
      if (tokens && !matchesQuery(template, tokens)) return false
      return true
    })
    return [...filtered].sort((a, b) => {
      if (sort === 'copies') return b.clonedCount - a.clonedCount
      if (sort === 'newest') return (b.createdAt ?? 0) - (a.createdAt ?? 0)
      if (sort === 'name') return a.name.localeCompare(b.name)
      // Featured: curated seeds first, then by adoption count.
      if (a.source !== b.source) return a.source === 'curated' ? -1 : 1
      return b.clonedCount - a.clonedCount
    })
  }, [allTemplates, discipline, query, sort])

  const clearFilters = () => {
    setQuery('')
    setDiscipline('all')
  }

  return (
    <div className="launcher-shell flex min-h-screen flex-col bg-background">
      <AuroraField />

      {/* Chrome: brand left, the one way back (or join) right. */}
      <header className="app-chrome app-chrome-divider relative z-10 flex-shrink-0">
        <div className="flex w-full items-center justify-between gap-3 px-4 py-3 sm:px-5">
          <FolioLogo
            markClassName="h-8 w-8 flex-shrink-0 text-primary"
            wordmarkClassName="h-[15px] w-auto text-surface-foreground"
            showTagline
          />
          <div className="flex items-center gap-2">
            {!signedIn && onSignInRequest && (
              <Button size="sm" onClick={onSignInRequest} className="gap-1.5" aria-label="Sign in to make designs yours">
                <LogIn className="h-4 w-4" aria-hidden="true" />
                Sign in
              </Button>
            )}
            {signedIn && onBack && (
              <Button variant="outline" size="sm" onClick={onBack} className="gap-2" aria-label="Back to projects">
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Back to projects
              </Button>
            )}
          </div>
        </div>
      </header>

      {!signedIn && (
        <div role="status" className="relative z-10 w-full border-b border-primary/20 bg-primary/5 px-4 py-2 text-center text-[11px] font-medium text-muted-foreground">
          You're browsing — open any design to look inside it. Make it yours to edit, and your sign-in opens the way.
        </div>
      )}

      <main className="relative z-10 mx-auto w-full max-w-6xl flex-1 px-4 pb-16 sm:px-6">
        {/* Hero — what this page is, for the person who just landed here. */}
        <div className="pt-8 sm:pt-12">
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-primary">Community</p>
          <h1 className="mt-2 max-w-2xl text-3xl font-extrabold leading-[1.1] tracking-[-0.03em] text-foreground sm:text-4xl">
            Proven designs, one open away.
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Open-licensed templates from the Folio team and the community. Open one inside your
            workspace — it becomes yours when you decide to make it yours. The licence and the
            attribution travel with every copy.
          </p>
          <dl className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
            <div className="flex items-baseline gap-1.5">
              <dt className="sr-only">Templates</dt>
              <dd className="text-base font-bold text-foreground">{allTemplates.length}</dd>
              <dd>templates</dd>
            </div>
            <div className="flex items-baseline gap-1.5">
              <dt className="sr-only">Disciplines covered</dt>
              <dd className="text-base font-bold text-foreground">{disciplineCounts.size}</dd>
              <dd>disciplines</dd>
            </div>
            <div className="flex items-baseline gap-1.5">
              <dt className="sr-only">Recorded adoptions</dt>
              <dd className="text-base font-bold text-foreground">{totalCopies}</dd>
              <dd>recorded adoptions</dd>
            </div>
            <div className="flex items-baseline gap-1.5">
              <dt className="sr-only">Licences</dt>
              <dd className="text-base font-bold text-foreground">CC-BY / CC0</dd>
              <dd>licensed</dd>
            </div>
          </dl>
        </div>

        {/* Toolbar — search, discipline, sort, and the sharing actions. Sticky
            so it follows the page instead of scrolling away from the grid. */}
        <div className="sticky top-0 z-10 -mx-4 mt-6 border-b border-border/70 bg-background/85 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative min-w-0 flex-1 sm:min-w-56">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <span className="sr-only">Search community templates</span>
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search designs, authors, disciplines…"
                aria-label="Search community templates"
                className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as SortKey)}
              aria-label="Sort templates"
              className="h-9 rounded-md border border-input bg-background px-2 text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {(Object.keys(SORT_LABEL) as SortKey[]).map((key) => (
                <option key={key} value={key}>{SORT_LABEL[key]}</option>
              ))}
            </select>
            <div className="flex items-center gap-1.5">
            {signedIn && (
              <>
                <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => importDialog.setOpen(true)} aria-label="Import a template file">
                  <Upload className="h-3.5 w-3.5" aria-hidden="true" /> Import
                </Button>
                <Button variant="ghost" size="sm" className="gap-1.5" onClick={exportTemplate} aria-label="Export the current design as a template file">
                  <Download className="h-3.5 w-3.5" aria-hidden="true" /> Export
                </Button>
              </>
            )}
              {cloudMode && signedIn && (
                <Button size="sm" className="gap-1.5" onClick={() => publish.setOpen(true)} aria-label="Publish the current design to the community">
                  <Send className="h-3.5 w-3.5" aria-hidden="true" /> Publish
                </Button>
              )}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Filter by discipline">
            <button
              type="button"
              onClick={() => setDiscipline('all')}
              aria-pressed={discipline === 'all'}
              className={`h-7 rounded-full border px-3 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${discipline === 'all' ? 'border-primary/60 bg-primary/15 text-primary' : 'border-border/70 bg-card/40 text-muted-foreground hover:text-foreground'}`}
            >
              All ({allTemplates.length})
            </button>
            {DISCIPLINE_FILTER.map(([id, label]) => {
              const count = disciplineCounts.get(id) ?? 0
              if (count === 0) return null
              const active = discipline === id
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setDiscipline(active ? 'all' : id)}
                  aria-pressed={active}
                  className={`h-7 rounded-full border px-3 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? 'border-primary/60 bg-primary/15 text-primary' : 'border-border/70 bg-card/40 text-muted-foreground hover:text-foreground'}`}
                >
                  {label} ({count})
                </button>
              )
            })}
          </div>
        </div>

        {(feedback || loadError) && (
          <p role={feedback?.kind === 'error' || loadError ? 'alert' : 'status'} className={`mt-4 text-xs ${(feedback?.kind === 'error' || loadError) ? 'text-destructive' : 'text-success'}`}>
            {feedback?.message ?? loadError}
          </p>
        )}

        {/* The grid. */}
        {visible.length > 0 ? (
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy={loading}>
            {visible.map((template) => (
              <article key={template.id} className="flex flex-col rounded-xl border border-border/70 bg-card/60 p-4 transition-colors hover:border-primary/40">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full border border-border/70 bg-background/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{DISCIPLINE_LABEL[template.discipline]}</span>
                    <span className="text-[10px] font-medium text-muted-foreground/80">{licenseLabel(template.license)}</span>
                  </div>
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/60">
                    {template.source === 'curated' ? 'Folio' : 'Community'}
                  </span>
                </div>
                <h2 className="mt-2.5 text-sm font-bold leading-snug text-foreground">{template.name}</h2>
                <p className="mt-1 line-clamp-3 flex-1 text-xs leading-relaxed text-muted-foreground">{template.description}</p>
                <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/60 pt-3">
                  <span className="min-w-0 truncate text-[10px] text-muted-foreground/80">
                    {template.source === 'curated'
                      ? 'Folio team · ships in the box'
                      : `${template.authorName} · ${template.clonedCount} opened${template.clonedCount === 1 ? '' : 's'}`}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-shrink-0 gap-1.5"
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
        ) : (
          <div className="mt-16 flex flex-col items-center gap-3 text-center">
            <SearchX className="h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
            <p className="text-sm font-semibold text-foreground">Nothing matches{query.trim() ? ` “${query.trim()}”` : ' this filter'}.</p>
            <p className="max-w-xs text-xs text-muted-foreground">Try a different word, or clear the search and discipline filter.</p>
            <Button variant="outline" size="sm" onClick={clearFilters}>Clear search and filters</Button>
          </div>
        )}

        {/* Footer — the call to contribute, honest about what exists. */}
        <div className="mt-10 rounded-xl border border-primary/25 bg-primary/5 p-5 sm:flex sm:items-center sm:justify-between sm:gap-6">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" aria-hidden="true" />
            <div>
              <h2 className="text-sm font-bold text-foreground">Built something worth copying?</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {cloudMode
                  ? 'Publish your current design to the community — others open it, the licence travels, and the adoption count is real.'
                  : 'This build runs offline: export your design as a .json template and hand it to someone — it opens exactly like a published one.'}
              </p>
            </div>
          </div>
          {cloudMode && signedIn && (
            <Button className="mt-3 flex-shrink-0 gap-1.5 sm:mt-0" onClick={() => publish.setOpen(true)}>
              <Send className="h-4 w-4" aria-hidden="true" /> Publish your design
            </Button>
          )}
        </div>

        {!cloudMode && (
          <p className="mt-4 text-center text-[10px] leading-relaxed text-muted-foreground/70">
            Offline build — every template here ships in the box or arrives as a .json file.
            Configure the Folio cloud (VITE_SUPABASE_URL) for community-hosted publishing.
          </p>
        )}
      </main>

      <CommunityTemplateDialogs controller={controller} />
    </div>
  )
}
