import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, CheckCircle2, FlaskConical, GraduationCap, Search, X } from 'lucide-react'
import { Button } from '../ui/button'
import { DEMO_SCENARIOS, type DemoScenario } from '../../lib/demo/demoScenarios'
import { loadDemoScenario } from '../../lib/demo/loadDemo'
import { TUTORIALS, type Tutorial } from '../../lib/tutorials/tutorials'
import { WORKSPACE_GROUPS, WORKSPACE_MODE_META, type WorkspaceGroupId } from '../../lib/workspace/modes'

interface DemoGalleryProps {
  open: boolean
  onClose: () => void
  /** Overrides the default loader so the host can create a project, confirm replacement, etc. */
  onOpenScenario?: (scenario: DemoScenario) => void
  /** Starts the guided walkthrough built on this demo, when one exists. */
  onStartTutorial?: (tutorial: Tutorial) => void
}

type Filter = 'all' | WorkspaceGroupId

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All demos' },
  ...WORKSPACE_GROUPS.map((group) => ({ id: group.id as Filter, label: group.label })),
]

function matches(scenario: DemoScenario, query: string): boolean {
  if (!query) return true
  const haystack = [
    scenario.title,
    scenario.summary,
    scenario.mode,
    WORKSPACE_MODE_META[scenario.mode].label,
    ...scenario.proves,
  ]
    .join(' ')
    .toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term))
}

/**
 * Curated, one-click access to a tested scenario in every workspace. The
 * gallery is the discovery surface; `loadDemoScenario` does the state work so
 * the same scenarios are also reachable from the command palette.
 */
export default function DemoGallery({ open, onClose, onOpenScenario, onStartTutorial }: DemoGalleryProps) {
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  /* A tutorial is a demo plus a route through it; linking them here means the
   * discovery surface and the guided surface cannot name different boards. */
  const guidedByDemo = useMemo(
    () => new Map(TUTORIALS.map((tutorial) => [tutorial.demoId, tutorial])),
    [],
  )

  useEffect(() => {
    if (!open) return
    setQuery('')
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
    () =>
      DEMO_SCENARIOS.filter(
        (scenario) => (filter === 'all' || scenario.group === filter) && matches(scenario, query),
      ),
    [filter, query],
  )

  if (!open) return null

  const openDemo = (scenario: DemoScenario) => {
    ;(onOpenScenario ?? loadDemoScenario)(scenario)
    onClose()
  }

  return (
    <div className="modal-scrim" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <div
        className="app-panel cad-panel-shell animate-rise-in max-w-5xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="demo-gallery-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="app-panel-header flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/15 text-primary">
              <FlaskConical className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <h2 id="demo-gallery-title" className="text-sm font-semibold">Demo gallery</h2>
              <p className="text-xs text-muted-foreground">
                Tested scenarios for every workspace — load one, tweak it and inspect the results.
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" aria-label="Close demo gallery" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1" role="group" aria-label="Demo categories">
            {FILTERS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                aria-pressed={filter === entry.id}
                onClick={() => setFilter(entry.id)}
                className={`h-7 rounded-sm border px-2.5 text-[11px] font-medium transition-colors ${
                  filter === entry.id
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <label className="flex h-8 w-full max-w-xs items-center gap-2 rounded-md border border-border bg-background px-2 sm:w-64">
            <Search className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">Search demos</span>
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search demos, tools or analysis types…"
              className="h-full w-full min-w-0 bg-transparent text-[11px] text-foreground outline-none placeholder:text-muted-foreground"
            />
          </label>
        </div>

        <div className="scrollbar-overlay min-h-0 flex-1 overflow-y-auto p-4">
          {visible.length === 0 ? (
            <div className="flex h-full min-h-48 flex-col items-center justify-center gap-2 text-center">
              <Search className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm font-medium">No demo matches “{query}”</p>
              <p className="text-xs text-muted-foreground">Try a domain such as PCB, RF, control or firmware.</p>
            </div>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Demo scenarios">
              {visible.map((scenario) => {
                const meta = WORKSPACE_MODE_META[scenario.mode]
                const tutorial = guidedByDemo.get(scenario.id)
                return (
                  <li key={scenario.id} className="flex">
                    <article className="flex min-w-0 flex-1 flex-col rounded-lg border border-border bg-card p-3 transition-colors hover:border-primary/50">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                          {meta.label}
                        </span>
                        {tutorial ? (
                          <span className="flex items-center gap-1 rounded-sm bg-primary/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-primary">
                            <GraduationCap className="h-3 w-3" aria-hidden="true" />
                            Guided
                          </span>
                        ) : (
                          <span className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                            {WORKSPACE_GROUPS.find((group) => group.id === scenario.group)?.label}
                          </span>
                        )}
                      </div>
                      <h3 className="text-[13px] font-semibold leading-snug text-foreground">{scenario.title}</h3>
                      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{scenario.summary}</p>
                      <ul className="mt-2 flex-1 space-y-1">
                        {scenario.proves.map((item) => (
                          <li key={item} className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
                            <CheckCircle2 className="mt-0.5 h-3 w-3 flex-shrink-0 text-success" aria-hidden="true" />
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                      <div className="mt-3 flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 min-w-0 flex-1 justify-between text-[11px]"
                          onClick={() => openDemo(scenario)}
                        >
                          Open demo
                          <ArrowRight className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
                        </Button>
                        {tutorial && onStartTutorial && (
                          <Button
                            size="sm"
                            className="h-7 flex-shrink-0 gap-1 text-[11px]"
                            onClick={() => {
                              onStartTutorial(tutorial)
                              onClose()
                            }}
                            aria-label={`Start the guided tutorial: ${tutorial.title}`}
                          >
                            <GraduationCap className="h-3 w-3" aria-hidden="true" />
                            Guided
                          </Button>
                        )}
                      </div>
                    </article>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <footer className="flex flex-shrink-0 items-center justify-between gap-3 border-t border-border bg-muted/30 px-4 py-2 text-[10px] text-muted-foreground">
          <span>{visible.length} of {DEMO_SCENARIOS.length} demos · every workspace is covered</span>
          <span className="font-mono uppercase tracking-[0.08em]">Esc to close</span>
        </footer>
      </div>
    </div>
  )
}
