import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, Cloud, FileCheck2, Search, ShieldAlert, X } from 'lucide-react'
import { Button } from '../ui/button'
import { WORKSPACE_MODE_META } from '../../lib/workspace/modes'
import type { WorkspaceMode } from '../../stores/useAppStore'
import {
  CAPABILITY_FAMILIES,
  CAPABILITY_FILTERS,
  CAPABILITY_RECORDS,
  filterCapabilities,
  type CapabilityFilter,
  type CapabilityRecord,
} from '../../lib/workspace/limitsRegistry'

interface LimitsDialogProps {
  open: boolean
  onClose: () => void
  /** Workspace whose modes should be highlightable; the filter is opt-in. */
  currentMode?: WorkspaceMode | null
}

const COUNT_BY_FILTER: Readonly<Record<CapabilityFilter, number>> = {
  all: CAPABILITY_RECORDS.length,
  ...Object.fromEntries(
    CAPABILITY_FAMILIES.map((family) => [
      family.id,
      CAPABILITY_RECORDS.filter((record) => record.family === family.id).length,
    ]),
  ) as Record<Exclude<CapabilityFilter, 'all'>, number>,
}

/**
 * The honest-limits panel: what every family of results actually computes, the
 * method behind it, the tests that pin it, and what the models refuse to cover.
 *
 * It renders `limitsRegistry.ts` rather than restating it, so the in-app claim
 * and the registry cannot drift apart. Rows are accordions: the titles stay
 * scannable, and a search auto-opens the matches because a person hunting for a
 * phrase needs the sentence around it, not another click.
 */
export default function LimitsDialog({ open, onClose, currentMode = null }: LimitsDialogProps) {
  const [filter, setFilter] = useState<CapabilityFilter>('all')
  const [query, setQuery] = useState('')
  const [modeOnly, setModeOnly] = useState(false)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setFilter('all')
    setModeOnly(false)
    const frame = requestAnimationFrame(() => searchRef.current?.focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose])

  const visible = useMemo(
    () => filterCapabilities(filter, query, modeOnly && currentMode ? currentMode : null),
    [filter, query, modeOnly, currentMode],
  )

  /* Grouping by family keeps one visual language per discipline, and the group
     headers double as the scroll targets when the list is long. */
  const grouped = useMemo(() => {
    return CAPABILITY_FAMILIES.map((family) => ({
      family,
      records: visible.filter((record) => record.family === family.id),
    })).filter((entry) => entry.records.length > 0)
  }, [visible])

  if (!open) return null

  const isOpen = (record: CapabilityRecord) => (query.trim() ? true : expanded.has(record.id))

  const toggle = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="modal-scrim" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <div
        className="app-panel cad-panel-shell animate-rise-in max-w-5xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="limits-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="app-panel-header flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-warning/15 text-warning">
              <ShieldAlert className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <h2 id="limits-title" className="text-sm font-semibold">Capabilities and limits</h2>
              <p className="text-xs text-muted-foreground">
                What each analysis actually computes, the method behind it, the tests that pin it — and what it refuses to model.
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" aria-label="Close capabilities and limits" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1" role="group" aria-label="Capability families">
            {CAPABILITY_FILTERS.map((entry) => (
              <button
                key={entry}
                type="button"
                aria-pressed={filter === entry}
                onClick={() => setFilter(entry)}
                className={`h-7 rounded-sm border px-2.5 text-[11px] font-medium transition-colors ${
                  filter === entry
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                {entry === 'all' ? 'All' : CAPABILITY_FAMILIES.find((family) => family.id === entry)?.label}
                <span className="ml-1.5 tabular-nums opacity-70">{COUNT_BY_FILTER[entry]}</span>
              </button>
            ))}
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-background px-2 sm:w-64 sm:flex-none">
              <Search className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="sr-only">Search capabilities</span>
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search methods, models, limits…"
                className="h-full w-full min-w-0 bg-transparent text-[11px] text-foreground outline-none placeholder:text-muted-foreground"
              />
            </label>
            {currentMode && (
              <label className="flex h-8 flex-shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-[11px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={modeOnly}
                  onChange={(event) => setModeOnly(event.target.checked)}
                  className="h-3 w-3 accent-primary"
                />
                {WORKSPACE_MODE_META[currentMode].label} only
              </label>
            )}
          </div>
        </div>

        <div className="scrollbar-overlay min-h-0 flex-1 overflow-y-auto p-4">
          {grouped.length === 0 ? (
            <div className="flex h-full min-h-48 flex-col items-center justify-center gap-2 text-center">
              <Search className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm font-medium">No capability matches “{query}”</p>
              <p className="text-xs text-muted-foreground">
                Limits are recorded per analysis. Try a solver name such as MNA, IK, DRC or relay.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              {grouped.map(({ family, records }) => (
                <section key={family.id} aria-labelledby={`limits-group-${family.id}`}>
                  <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
                    <h3 id={`limits-group-${family.id}`} className="text-[11px] font-semibold uppercase tracking-[0.08em] text-primary">
                      {family.label}
                    </h3>
                    <p className="text-[11px] text-muted-foreground">{family.description}</p>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {records.map((record) => {
                      const rowOpen = isOpen(record)
                      return (
                        <article
                          key={record.id}
                          className="rounded-md border border-border bg-background/50"
                          aria-labelledby={`limits-${record.id}-title`}
                        >
                          <button
                            type="button"
                            aria-expanded={rowOpen}
                            aria-controls={`limits-${record.id}-body`}
                            onClick={() => toggle(record.id)}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-accent/60"
                          >
                            <ChevronRight
                              className={`h-3.5 w-3.5 flex-shrink-0 text-muted-foreground transition-transform ${rowOpen ? 'rotate-90' : ''}`}
                              aria-hidden="true"
                            />
                            <span id={`limits-${record.id}-title`} className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground">
                              {record.title}
                            </span>
                            {record.cloudOnly && (
                              <span className="flex flex-shrink-0 items-center gap-1 rounded-sm border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground" title="Needs a cloud credential to do more than check its contract locally">
                                <Cloud className="h-3 w-3" aria-hidden="true" /> cloud
                              </span>
                            )}
                            <span className="hidden flex-shrink-0 gap-1 sm:flex">
                              {record.modes.slice(0, 3).map((mode) => (
                                <span key={mode} className="cad-kbd">{WORKSPACE_MODE_META[mode].label}</span>
                              ))}
                              {record.modes.length > 3 && (
                                <span className="cad-kbd" title={record.modes.slice(3).map((mode) => WORKSPACE_MODE_META[mode].label).join(', ')}>
                                  +{record.modes.length - 3}
                                </span>
                              )}
                            </span>
                          </button>
                          {rowOpen && (
                            <div id={`limits-${record.id}-body`} className="flex flex-col gap-3 px-3 pb-3 pt-1">
                              <dl className="flex flex-col gap-2">
                                <div>
                                  <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-success">Computes</dt>
                                  <dd className="text-[11.5px] leading-relaxed text-foreground">{record.computes}</dd>
                                </div>
                                <div>
                                  <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Method</dt>
                                  <dd className="text-[11.5px] leading-relaxed text-muted-foreground">{record.method}</dd>
                                </div>
                              </dl>
                              <div className="rounded-md border border-warning/40 bg-warning/10 px-2.5 py-2">
                                <h4 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-warning">Not covered</h4>
                                <ul className="mt-1 flex flex-col gap-1">
                                  {record.notCovered.map((line) => (
                                    <li key={line} className="flex gap-1.5 text-[11.5px] leading-relaxed text-foreground">
                                      <span aria-hidden="true" className="text-warning">—</span>
                                      <span>{line}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                              <div>
                                <h4 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                                  <FileCheck2 className="h-3 w-3" aria-hidden="true" />
                                  Pinned by {record.validatedBy.length} test file{record.validatedBy.length === 1 ? '' : 's'}
                                </h4>
                                <ul className="mt-1 flex flex-wrap gap-1">
                                  {record.validatedBy.map((path) => (
                                    <li key={path} className="rounded-sm border border-border bg-surface px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                                      {path.replace('src/', '')}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            </div>
                          )}
                        </article>
                      )
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>

        <div className="cad-footer-row flex-shrink-0 text-[11px] text-muted-foreground">
          <span>
            {visible.length} of {CAPABILITY_RECORDS.length} records shown
            {query.trim() ? ' — matches are expanded' : ' — open a row for the method and the limits'}
          </span>
          <span className="flex items-center gap-2">
            <span className="hidden sm:inline">Nothing here is a sign-off: validate against measured hardware before you fabricate.</span>
            <span className="cad-kbd">ESC</span>
          </span>
        </div>
      </div>
    </div>
  )
}
