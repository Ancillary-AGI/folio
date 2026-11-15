import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ArrowRight, Cable, Command, CornerDownLeft, Cpu, FlaskConical, type LucideIcon } from 'lucide-react'
import { DEMO_SCENARIOS, type DemoScenario } from '../../lib/demo/demoScenarios'
import { loadDemoScenario } from '../../lib/demo/loadDemo'
import { WORKSPACE_GROUPS, WORKSPACE_MODES, WORKSPACE_MODE_META } from '../../lib/workspace/modes'
import { useAppStore } from '../../stores/useAppStore'
import { useProjectStore } from '../../stores/useProjectStore'
import { useShortcutStore } from '../../stores/useShortcutStore'
import { describeShortcut } from '../../lib/keymap/shortcuts'

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  onSave: () => void
  onOpenDemos: () => void
  onOpenLimits: () => void
  onOpenHelp: () => void
  /** Opens the guide on its editable shortcut sheet. */
  onOpenShortcuts: () => void
  /** The settings page, the same surface `Ctrl+,` opens. */
  onOpenSettings: () => void
  onToggleTheme: () => void
  /** The design-health dock under the sheet: findings and part outline. */
  onToggleDesignHealth: () => void
  /** Overrides the default loader so the host can create a project, confirm replacement, etc. */
  onOpenScenario?: (scenario: DemoScenario) => void
}

type CommandKind = 'component' | 'net' | 'workspace' | 'demo' | 'action'

interface PaletteCommand {
  id: string
  label: string
  hint: string
  kind: CommandKind
  /** Orderable numbers and manufacturers match without widening the row. */
  keywords?: string
  run: () => void
}

const SECTION_LABEL: Readonly<Record<CommandKind, string>> = {
  component: 'Parts',
  net: 'Nets',
  workspace: 'Workspaces',
  demo: 'Demos',
  action: 'Actions',
}

const isDesignObject = (kind: CommandKind) => kind === 'component' || kind === 'net'

const KIND_ICON: Readonly<Record<CommandKind, LucideIcon>> = {
  component: Cpu,
  net: Cable,
  workspace: Command,
  demo: FlaskConical,
  action: ArrowRight,
}

/* A part or net lives on the sheet, so jumping first makes sure the sheet is
 * the open workspace; the focus request is consumed when its stage is ready. */
function openOnSheet(ids: string[]) {
  useAppStore.getState().setWorkspaceMode('schematic')
  useAppStore.getState().setSelectedComponents(ids)
  if (ids[0]) useAppStore.getState().requestComponentFocus(ids[0])
}

/* A net jump selects the wire run itself: the sheet highlight is the cursor,
 * and framing waits for a measured stage just like a part jump. */
function openNetOnSheet(name: string) {
  const app = useAppStore.getState()
  app.setWorkspaceMode('schematic')
  app.selectNet({ name })
  app.requestNetFocus(name)
}

/**
 * Keyboard-first navigation over the whole workbench. Parts and nets from the
 * live document, the workspace registry, demos and document actions share one
 * search field: `Ctrl+K`, type a refdes or a net name, and the palette is a
 * "go to" that also works when the sheet is not the open workspace.
 */
export default function CommandPalette({
  open,
  onClose,
  onSave,
  onOpenDemos,
  onOpenLimits,
  onOpenHelp,
  onOpenShortcuts,
  onOpenSettings,
  onToggleTheme,
  onOpenScenario,
  onToggleDesignHealth,
}: CommandPaletteProps) {
  const shortcutOverrides = useShortcutStore((state) => state.overrides)
  const projectComponents = useProjectStore((state) => state.components)
  const projectWires = useProjectStore((state) => state.wires)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const designObjects = useMemo<PaletteCommand[]>(() => {
    const parts = [...projectComponents]
      .sort((a, b) => a.reference.localeCompare(b.reference, undefined, { numeric: true }))
      .map((component) => {
        const category = component.component.category
        const value = component.properties.value
        const detail = [category, value]
          .filter((part) => part !== undefined && part !== '')
          .join(' · ')
        return {
          id: `part:${component.id}`,
          label: `${component.reference} · ${component.component.name}`,
          hint: detail ? `Part · ${detail}` : 'Part',
          kind: 'component' as const,
          keywords: [component.component.part_number, component.component.manufacturer]
            .filter(Boolean)
            .join(' '),
          run: () => openOnSheet([component.id]),
        }
      })

    // One row per net name, not per wire segment: a net is the thing an engineer
    // searches for, and it can span several wires and pins.
    const nets = new Map<string, { pins: Set<string> }>()
    for (const wire of projectWires) {
      if (!wire.netName) continue
      const entry = nets.get(wire.netName) ?? { pins: new Set<string>() }
      for (const pin of wire.connectedPins) {
        entry.pins.add(`${pin.componentId}:${pin.pinId}`)
      }
      nets.set(wire.netName, entry)
    }
    const netCommands = [...nets.entries()]
      .filter(([, entry]) => entry.pins.size > 0)
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      .map(([name, entry]) => {
        const pinCount = entry.pins.size
        return {
          id: `net:${name}`,
          label: name,
          hint: `Net · ${pinCount} pin${pinCount === 1 ? '' : 's'}`,
          kind: 'net' as const,
          run: () => openNetOnSheet(name),
        }
      })

    return [...parts, ...netCommands]
  }, [projectComponents, projectWires])

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
      { id: 'action:help', label: 'Open help and tutorials', hint: `Action · ${describeShortcut('help.open', shortcutOverrides)}`, kind: 'action', run: onOpenHelp },
      { id: 'action:shortcuts', label: 'Keyboard shortcuts: view and rebind', hint: 'Action', kind: 'action', run: onOpenShortcuts },
      { id: 'action:settings', label: 'Open settings', hint: `Action · ${describeShortcut('settings.open', shortcutOverrides)}`, kind: 'action', run: onOpenSettings },
      { id: 'action:demos', label: 'Open demo gallery', hint: 'Action', kind: 'action', run: onOpenDemos },
      { id: 'action:limits', label: 'Open capabilities and limits', hint: 'Action', kind: 'action', run: onOpenLimits },
      { id: 'action:save', label: 'Save design snapshot', hint: `Action · ${describeShortcut('schematic.save', shortcutOverrides)}`, kind: 'action', run: onSave },
      { id: 'action:health', label: 'Design health: show or hide findings', hint: `Action · ${describeShortcut('schematic.problems', shortcutOverrides)}`, kind: 'action', run: onToggleDesignHealth },
      { id: 'action:theme', label: 'Toggle colour theme', hint: 'Action', kind: 'action', run: onToggleTheme },
      { id: 'action:assistant', label: 'Scribe: open the sheet-true assistant', hint: 'Action · Scribe', kind: 'action', run: () => useAppStore.getState().toggleAiChat() },
      { id: 'action:split-dual', label: 'Split View: side-by-side dual canvas (Sch + PCB)', hint: 'Action · Dual Viewports', kind: 'action', run: () => { useAppStore.getState().setWorkspaceMode('schematic'); useAppStore.getState().setSplitMode('split-h', 'pcb') } },
      { id: 'action:split-3d', label: 'Split View: PCB 2D + 3D photorealistic view', hint: 'Action · Dual Viewports', kind: 'action', run: () => { useAppStore.getState().setWorkspaceMode('pcb'); useAppStore.getState().setSplitMode('split-h', 'preview3d') } },
      { id: 'action:pip-3d', label: '3D Preview: picture-in-picture floating viewport', hint: 'Action · 3D PiP', kind: 'action', run: () => { const mode = useAppStore.getState().workspaceMode; if (mode !== 'schematic' && mode !== 'pcb' && mode !== 'preview3d') useAppStore.getState().setWorkspaceMode('pcb'); useAppStore.getState().setSplitMode('pip-3d', 'preview3d') } },
      { id: 'action:split-single', label: 'View: reset to single full viewport', hint: 'Action · Single Viewport', kind: 'action', run: () => useAppStore.getState().setSplitMode('single') },
      { id: 'action:fit', label: 'Zoom to fit design contents', hint: 'Action · Fit View', kind: 'action', run: () => window.dispatchEvent(new CustomEvent('folio:fit-view')) },
    ]
    return [...designObjects, ...workspaceCommands, ...demoCommands, ...actions]
  }, [designObjects, onOpenDemos, onOpenHelp, onOpenSettings, onOpenShortcuts, onOpenLimits, onOpenScenario, onSave, onToggleDesignHealth, onToggleTheme, shortcutOverrides])

  const filtered = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    // An empty field stays a command menu. Design objects appear once there is
    // something to search for, so a large sheet never turns the palette into a
    // dump of refdes rows before the engineer has typed a key.
    if (terms.length === 0) return commands.filter((command) => !isDesignObject(command.kind))
    const matched = commands.filter((command) =>
      terms.every((term) =>
        `${command.label} ${command.hint} ${command.keywords ?? ''}`.toLowerCase().includes(term),
      ),
    )
    /* Objects and label-prefix hits rank above prose matches; `sort` is stable,
     * so equal ranks keep parts-before-nets and registry order. */
    const first = terms[0]
    const rank = (command: PaletteCommand) => {
      const object = isDesignObject(command.kind)
      const prefix = command.label.toLowerCase().startsWith(first)
      if (object && prefix) return 0
      if (object) return 1
      return prefix ? 2 : 3
    }
    return matched.sort((a, b) => rank(a) - rank(b))
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
        {/* The search line is a field, not a strip of the dialog: insetting it
            gives the focus ring something to sit on. Painted straight onto the
            full-bleed header row, the halo would bloom over the dialog's own
            rounded border and read as a second window. */}
        <div className="border-b border-border p-2">
          <div className="cad-search flex h-11 items-center gap-2.5 rounded-xl border border-input bg-background px-3">
            <span className="agent-orb" aria-hidden="true" />
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls="command-palette-results"
              aria-autocomplete="list"
              aria-activedescendant={filtered[activeIndex] ? `command-${activeIndex}` : undefined}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Go to a part, net, workspace, or action…"
              className="h-full w-full min-w-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
            <span className="cad-kbd flex-shrink-0">ESC</span>
          </div>
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
          {filtered.map((command, index) => {
            const sectionStart = index === 0 || filtered[index - 1].kind !== command.kind
            const Icon = KIND_ICON[command.kind]
            return (
              <Fragment key={command.id}>
                {sectionStart && (
                  <li
                    role="presentation"
                    className="px-4 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                  >
                    {SECTION_LABEL[command.kind]}
                  </li>
                )}
                <li id={`command-${index}`} role="option" aria-selected={index === activeIndex}>
                  <button
                    type="button"
                    data-active={index === activeIndex}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => run(command)}
                    className={`mx-1.5 flex w-[calc(100%-0.75rem)] items-center gap-3 rounded-lg px-2.5 py-1.5 text-left transition-colors ${
                      index === activeIndex ? 'bg-accent text-accent-foreground' : 'text-foreground'
                    }`}
                  >
                    <span className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md border transition-colors ${
                      index === activeIndex
                        ? 'border-primary/40 bg-primary/15 text-primary'
                        : command.kind === 'demo' || isDesignObject(command.kind)
                          ? 'border-border text-primary'
                          : 'border-border text-muted-foreground'
                    }`}>
                      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px]">{command.label}</span>
                    <span className="flex-shrink-0 text-[11px] text-muted-foreground">{command.hint}</span>
                  </button>
                </li>
              </Fragment>
            )
          })}
        </ul>

        <div className="flex items-center justify-between border-t border-border bg-muted/30 px-3 py-1.5 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1"><span className="cad-kbd">↑</span><span className="cad-kbd">↓</span> navigate</span>
            <span className="flex items-center gap-1"><CornerDownLeft className="h-3 w-3" aria-hidden="true" /> open</span>
          </span>
          <span>{filtered.length} result{filtered.length === 1 ? '' : 's'}</span>
        </div>
      </div>
    </div>
  )
}
