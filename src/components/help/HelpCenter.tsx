import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Clock,
  FlaskConical,
  GraduationCap,
  Keyboard,
  LayoutGrid,
  MousePointerClick,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react'
import { Button } from '../ui/button'
import { DEMO_SCENARIOS } from '../../lib/demo/demoScenarios'
import { HELP_TOPICS_BY_GROUP, SHORTCUTS } from '../../lib/help/helpTopics'
import { TUTORIALS, describeTutorialProgress, readTutorialProgress, type Tutorial } from '../../lib/tutorials/tutorials'
import { WORKSPACE_GROUPS, WORKSPACE_MODES, WORKSPACE_MODE_META } from '../../lib/workspace/modes'
import { CAPABILITY_RECORDS } from '../../lib/workspace/limitsRegistry'
import type { WorkspaceMode } from '../../stores/useAppStore'

export type HelpTab = 'tutorials' | 'workspaces' | 'controls' | 'shortcuts'

interface HelpCenterProps {
  open: boolean
  onClose: () => void
  /** Workspace the engineer is looking at; highlighted in the guide list. */
  currentMode: WorkspaceMode
  initialTab?: HelpTab
  onOpenWorkspace: (mode: WorkspaceMode) => void
  onStartTutorial: (tutorial: Tutorial) => void
  onOpenDemos: () => void
  onOpenLimits: () => void
}

const TABS: ReadonlyArray<{ id: HelpTab; label: string; icon: typeof BookOpen }> = [
  { id: 'tutorials', label: 'Tutorials', icon: GraduationCap },
  { id: 'workspaces', label: 'Workspace guides', icon: LayoutGrid },
  { id: 'controls', label: 'Control reference', icon: MousePointerClick },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
]

function matches(terms: string[], haystack: string): boolean {
  if (terms.length === 0) return true
  const value = haystack.toLowerCase()
  return terms.every((term) => value.includes(term))
}

function termsFor(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean)
}

function capabilityCount(mode: WorkspaceMode): number {
  return CAPABILITY_RECORDS.filter((record) => record.modes.includes(mode)).length
}

function demoCount(mode: WorkspaceMode): number {
  return DEMO_SCENARIOS.filter((scenario) => scenario.mode === mode).length
}

function Keycaps({ keys }: { keys: readonly string[] }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      {keys.map((key, index) => (
        <kbd key={`${key}-${index}`} className="cad-kbd">{key}</kbd>
      ))}
    </span>
  )
}

/**
 * Help, tutorials and the control reference in one searchable surface.
 *
 * It is a guide, not a grader: the copy says what a control does and what a
 * tutorial step should make visible, and points at the capability records for
 * what each result does not prove.
 */
export default function HelpCenter({
  open,
  onClose,
  currentMode,
  initialTab = 'tutorials',
  onOpenWorkspace,
  onStartTutorial,
  onOpenDemos,
  onOpenLimits,
}: HelpCenterProps) {
  const [tab, setTab] = useState<HelpTab>(initialTab)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setTab(initialTab)
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
  }, [open, initialTab, onClose])

  const terms = termsFor(query)

  const tutorials = useMemo(
    () =>
      TUTORIALS.filter((tutorial) =>
        matches(
          terms,
          [
            tutorial.title,
            tutorial.summary,
            ...tutorial.modes.map((mode) => WORKSPACE_MODE_META[mode].label),
          ].join(' '),
        ),
      ),
    [terms],
  )

  const workspaces = useMemo(
    () =>
      WORKSPACE_MODES.filter((mode) =>
        matches(terms, `${mode.label} ${WORKSPACE_GROUPS.find((group) => group.id === mode.group)?.label ?? ''} ${mode.description}`),
      ),
    [terms],
  )

  const controls = useMemo(
    () =>
      (['rail', 'header', 'nav'] as const).map((group) => ({
        group,
        topics: HELP_TOPICS_BY_GROUP[group].filter((topic) => matches(terms, `${topic.title} ${topic.description}`)),
      })).filter((section) => section.topics.length > 0),
    [terms],
  )

  const shortcuts = useMemo(
    () => SHORTCUTS.filter((row) => matches(terms, `${row.action} ${row.where} ${row.keys.join(' ')}`)),
    [terms],
  )

  if (!open) return null

  const placeholder =
    tab === 'tutorials'
      ? 'Search tutorials by domain or task…'
      : tab === 'workspaces'
        ? 'Search workspaces by name or what they compute…'
        : tab === 'controls'
          ? 'Search controls by name or action…'
          : 'Search shortcuts by action or workspace…'

  return (
    <div
      className="modal-scrim"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="app-panel cad-panel-shell animate-rise-in max-w-5xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-center-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="app-panel-header flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/15 text-primary">
              <BookOpen className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <h2 id="help-center-title" className="text-sm font-semibold">Help and tutorials</h2>
              <p className="text-xs text-muted-foreground">
                Learn the workbench the way it is used: load a tested design, change it, read the result.
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" aria-label="Close help" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1" role="tablist" aria-label="Help sections">
            {TABS.map((entry) => {
              const Icon = entry.icon
              const active = tab === entry.id
              return (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    setTab(entry.id)
                    setQuery('')
                    searchRef.current?.focus()
                  }}
                  className={`flex h-7 items-center gap-1.5 rounded-sm border px-2.5 text-[11px] font-medium transition-colors ${
                    active
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  {entry.label}
                </button>
              )
            })}
          </div>
          <label className="flex h-8 w-full max-w-xs items-center gap-2 rounded-md border border-border bg-background px-2 sm:w-64">
            <Search className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">Search help</span>
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={placeholder}
              className="h-full w-full min-w-0 bg-transparent text-[11px] text-foreground outline-none placeholder:text-muted-foreground"
            />
          </label>
        </div>

        <div className="scrollbar-overlay min-h-0 flex-1 overflow-y-auto p-4">
          {tab === 'tutorials' && (
            <div className="space-y-3">
              <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                Each tutorial loads a tested demo, then walks the workspaces in order. Steps are self-checked:
                the app does not watch your screen or grade the result, and finishing a tutorial is not proof that a design is correct.
              </p>
              {tutorials.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No tutorial matches “{query}”.</p>
              ) : (
                <ul className="grid gap-3 sm:grid-cols-2" aria-label="Tutorials">
                  {tutorials.map((tutorial) => {
                    const progress = readTutorialProgress(tutorial.id)
                    const resumed = Boolean(progress && !progress.completed && progress.step > 0)
                    return (
                      <li key={tutorial.id} className="flex">
                        <article className="flex min-w-0 flex-1 flex-col rounded-lg border border-border bg-card p-3 transition-colors hover:border-primary/50">
                          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                            <span className="flex items-center gap-1 text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                              <Clock className="h-3 w-3" aria-hidden="true" />
                              {tutorial.minutes} min
                            </span>
                            <span className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                              {tutorial.steps.length} steps
                            </span>
                            {progress && (progress.completed || progress.step > 0) && (
                              <span className={`flex items-center gap-1 text-[9px] uppercase tracking-[0.1em] ${progress.completed ? 'text-success' : 'text-primary'}`}>
                                {progress.completed && <CheckCircle2 className="h-3 w-3" aria-hidden="true" />}
                                {describeTutorialProgress(tutorial, progress)}
                              </span>
                            )}
                          </div>
                          <h3 className="text-[13px] font-semibold leading-snug text-foreground">{tutorial.title}</h3>
                          <p className="mt-1 flex-1 text-[11px] leading-relaxed text-muted-foreground">{tutorial.summary}</p>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {tutorial.modes.map((mode) => (
                              <span key={mode} className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-muted-foreground">
                                {WORKSPACE_MODE_META[mode].label}
                              </span>
                            ))}
                          </div>
                          <Button
                            size="sm"
                            variant={progress?.completed ? 'outline' : 'default'}
                            className="mt-2 h-7 w-full justify-between text-[11px]"
                            onClick={() => onStartTutorial(tutorial)}
                          >
                            {progress?.completed ? 'Run again' : resumed ? 'Resume tutorial' : 'Start tutorial'}
                            <ArrowRight className="h-3 w-3" aria-hidden="true" />
                          </Button>
                        </article>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )}

          {tab === 'workspaces' && (
            <div className="space-y-4">
              <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                Every result names its method and its limits. The count beside each workspace is the number of
                capability records that speak for it; open Capabilities and limits to read them.
              </p>
              {WORKSPACE_GROUPS.map((group) => {
                const modes = workspaces.filter((mode) => mode.group === group.id)
                if (modes.length === 0) return null
                return (
                  <section key={group.id} aria-label={group.label}>
                    <h3 className="mb-2 flex items-baseline gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      {group.label}
                      <span className="font-normal normal-case tracking-normal text-muted-foreground/80">{group.description}</span>
                    </h3>
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {modes.map((mode) => {
                        const isCurrent = mode.id === currentMode
                        const demos = demoCount(mode.id)
                        return (
                          <li
                            key={mode.id}
                            className={`flex items-start gap-3 rounded-md border p-2.5 ${isCurrent ? 'border-primary/60 bg-primary/5' : 'border-border bg-card'}`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <p className="text-[12px] font-semibold text-foreground">{mode.label}</p>
                                {isCurrent && (
                                  <span className="rounded-sm bg-primary/15 px-1 py-0.5 text-[8px] font-semibold uppercase tracking-[0.08em] text-primary">
                                    Current
                                  </span>
                                )}
                              </div>
                              <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">{mode.description}</p>
                              <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.08em] text-muted-foreground">
                                {capabilityCount(mode.id)} capability record{capabilityCount(mode.id) === 1 ? '' : 's'}
                                {demos > 0 ? ` · ${demos} demo${demos === 1 ? '' : 's'}` : ''}
                              </p>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 flex-shrink-0 text-[10px]"
                              onClick={() => onOpenWorkspace(mode.id)}
                            >
                              Open
                            </Button>
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                )
              })}
              {workspaces.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">No workspace matches “{query}”.</p>
              )}
            </div>
          )}

          {tab === 'controls' && (
            <div className="space-y-4">
              <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                Rest on any control for the same guide. These entries describe what each control does on screen;
                they are not claims about the validity of a result.
              </p>
              {controls.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">No control matches “{query}”.</p>
              )}
              {controls.map((section) => (
                <section key={section.group} aria-label={`${section.group} controls`}>
                  <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {section.group === 'rail' ? 'Editor rail' : section.group === 'header' ? 'Application header' : 'Workspace navigation'}
                  </h3>
                  <ul className="divide-y divide-border rounded-md border border-border bg-card">
                    {section.topics.map((topic) => (
                      <li key={topic.id} className="flex items-start justify-between gap-3 px-3 py-2">
                        <div className="min-w-0">
                          <p className="text-[12px] font-medium text-foreground">{topic.title}</p>
                          <p className="text-[10px] leading-relaxed text-muted-foreground">{topic.description}</p>
                        </div>
                        {topic.keys && <Keycaps keys={topic.keys} />}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}

          {tab === 'shortcuts' && (
            <div className="space-y-3">
              <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                Only bindings the shell implements are listed. A shortcut that is not here does not exist.
              </p>
              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr className="border-b border-border text-left text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                    <th scope="col" className="py-1.5 pr-3 font-semibold">Keys</th>
                    <th scope="col" className="py-1.5 pr-3 font-semibold">Action</th>
                    <th scope="col" className="py-1.5 font-semibold">Where</th>
                  </tr>
                </thead>
                <tbody>
                  {shortcuts.map((row) => (
                    <tr key={`${row.keys.join('+')}-${row.action}`} className="border-b border-border last:border-0">
                      <td className="py-1.5 pr-3"><Keycaps keys={row.keys} /></td>
                      <td className="py-1.5 pr-3 text-foreground">{row.action}</td>
                      <td className="py-1.5 text-muted-foreground">{row.where}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {shortcuts.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">No shortcut matches “{query}”.</p>
              )}
            </div>
          )}
        </div>

        <footer className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/30 px-4 py-2 text-[10px] text-muted-foreground">
          <div className="flex flex-wrap items-center gap-2">
            <span>{TUTORIALS.length} tutorials · {WORKSPACE_MODES.length} workspaces · {CAPABILITY_RECORDS.length} capability records</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={onOpenDemos}>
              <FlaskConical className="mr-1 h-3 w-3" aria-hidden="true" />
              Demo gallery
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={onOpenLimits}>
              <ShieldCheck className="mr-1 h-3 w-3" aria-hidden="true" />
              Capabilities and limits
            </Button>
            <span className="ml-1"><kbd className="cad-kbd">Esc</kbd></span>
          </div>
        </footer>
      </div>
    </div>
  )
}
