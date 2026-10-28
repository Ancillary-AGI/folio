import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ArrowRight, Command, CornerDownLeft, FlaskConical, Search } from 'lucide-react'
import { DEMO_SCENARIOS, type DemoScenario } from '../../lib/demo/demoScenarios'
import { loadDemoScenario } from '../../lib/demo/loadDemo'
import { WORKSPACE_GROUPS, WORKSPACE_MODES, WORKSPACE_MODE_META } from '../../lib/workspace/modes'
import { useAppStore } from '../../stores/useAppStore'

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  onSave: () => void
  onOpenDemos: () => void
  onOpenLimits: () => void
  onOpenHelp: () => void
  onToggleTheme: () => void
  /** Overrides the default loader so the host can create a project, confirm replacement, etc. */
  onOpenScenario?: (scenario: DemoScenario) => void
}

interface PaletteCommand {
  id: string
  label: string
  hint: string
  kind: 'workspace' | 'demo' | 'action'
  run: () => void
}

/**
 * Keyboard-first navigation over the whole workbench. Modes, demos and a few
 * document actions share one search field; the palette keeps the 25-workspace
 * surface reachable without a tab hunt.
 */
export default function CommandPalette({
  open,
  onClose,
  onSave,
  onOpenDemos,
  onOpenLimits,
  onOpenHelp,
  onToggleTheme,
  onOpenScenario,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const commands = useMemo<PaletteCommand[]>(() => {
    const workspaceCommands = WORKSPACE_MODES.map((mode) => ({
      id: `mode:${mode.id}`,
      label: mode.label,
      hint: WORKSPACE_GROUPS.find((group) => group.id === mode.group)?.label ?? 'Workspace',
      kind: 'workspace' as const,
      run: () => useAppStore.getState().setWorkspaceMode(mode.id),
    }))
    const demoCommands = DEMO_SCENARIOS.map((scenario) => ({
      id: `demo:${scenario.id}`,
      label: scenario.title,
      hint: `Demo · ${WORKSPACE_MODE_META[scenario.mode].label}`,
      kind: 'demo' as const,
      run: () => (onOpenScenario ?? loadDemoScenario)(scenario),
    }))
    const actions: PaletteCommand[] = [
      { id: 'action:help', label: 'Open help and tutorials', hint: 'Action · F1', kind: 'action', run: onOpenHelp },
      { id: 'action:demos', label: 'Open demo gallery', hint: 'Action', kind: 'action', run: onOpenDemos },
      { id: 'action:limits', label: 'Open capabilities and limits', hint: 'Action', kind: 'action', run: onOpenLimits },
      { id: 'action:save', label: 'Save design snapshot', hint: 'Action · Ctrl+S', kind: 'action', run: onSave },
      { id: 'action:theme', label: 'Toggle colour theme', hint: 'Action', kind: 'action', run: onToggleTheme },
    ]
    return [...workspaceCommands, ...demoCommands, ...actions]
  }, [onOpenDemos, onOpenHelp, onOpenLimits, onOpenScenario, onSave, onToggleTheme])

  const filtered = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (terms.length === 0) return commands
    return commands.filter((command) =>
      terms.every((term) => `${command.label} ${command.hint}`.toLowerCase().includes(term)),
    )
  }, [commands, query])

  // Callers pass an inline close handler; reacting to its identity would clear
  // the query and steal focus on every unrelated parent render.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActiveIndex(0)
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  useEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>('[data-active="true"]')
    active?.scrollIntoView?.({ block: 'nearest' })
  }, [activeIndex])

  if (!open) return null

  const run = (command: PaletteCommand | undefined) => {
    if (!command) return
    onClose()
    command.run()
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) => (filtered.length === 0 ? 0 : (index + 1) % filtered.length))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => (filtered.length === 0 ? 0 : (index - 1 + filtered.length) % filtered.length))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      run(filtered[activeIndex])
    }
  }

  return (
    <div className="modal-scrim" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <div
        className="app-panel animate-rise-in flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-results"
            aria-autocomplete="list"
            aria-activedescendant={filtered[activeIndex] ? `command-${filtered[activeIndex].id}` : undefined}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Go to a workspace, open a demo, run an action…"
            className="h-11 w-full min-w-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <span className="cad-kbd flex-shrink-0">ESC</span>
        </div>

        <ul
          id="command-palette-results"
          ref={listRef}
          role="listbox"
          aria-label="Commands"
          className="scrollbar-overlay min-h-0 flex-1 overflow-y-auto py-1"
        >
          {filtered.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-muted-foreground">
              No command matches “{query}”.
            </li>
          )}
          {filtered.map((command, index) => (
            <li key={command.id} id={`command-${command.id}`} role="option" aria-selected={index === activeIndex}>
              <button
                type="button"
                data-active={index === activeIndex}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => run(command)}
                className={`flex w-full items-center gap-3 px-3 py-1.5 text-left transition-colors ${
                  index === activeIndex ? 'bg-accent text-accent-foreground' : 'text-foreground'
                }`}
              >
                <span className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-sm border border-border ${
                  command.kind === 'demo' ? 'text-primary' : 'text-muted-foreground'
                }`}>
                  {command.kind === 'demo'
                    ? <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
                    : command.kind === 'workspace'
                      ? <Command className="h-3.5 w-3.5" aria-hidden="true" />
                      : <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px]">{command.label}</span>
                <span className="flex-shrink-0 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">{command.hint}</span>
              </button>
            </li>
          ))}
        </ul>

        <div className="flex items-center justify-between border-t border-border bg-muted/30 px-3 py-1.5 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1"><span className="cad-kbd">↑</span><span className="cad-kbd">↓</span> navigate</span>
            <span className="flex items-center gap-1"><CornerDownLeft className="h-3 w-3" aria-hidden="true" /> open</span>
          </span>
          <span>{filtered.length} command{filtered.length === 1 ? '' : 's'}</span>
        </div>
      </div>
    </div>
  )
}
