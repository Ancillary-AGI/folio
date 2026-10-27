import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, ArrowRightLeft, Box, Bot, Camera, ChevronLeft, ChevronRight, CircuitBoard, Code2, Cpu, FlaskConical,
  Gauge, GitBranch, Grid3X3, Layers, List, Package, PenTool, Plug, Radio, RadioTower, RotateCw,
  ShieldCheck, ShoppingBag, SlidersHorizontal, Sparkles, Terminal, Wrench, Zap,
  type LucideIcon,
} from 'lucide-react'
import SchematicCanvas from '../SchematicCanvas'
import ComponentLibrary from '../ComponentLibrary'
import PropertiesPanel from '../PropertiesPanel'
import ToolRail from './ToolRail'
import { useAppStore, type WorkspaceMode } from '../../stores/useAppStore'
import { useProjectStore } from '../../stores/useProjectStore'
import {
  WORKSPACE_GROUPS,
  WORKSPACE_MODES,
  groupForMode,
  type WorkspaceGroupId,
} from '../../lib/workspace/modes'
import type { Component } from '../../lib/supabase'
import type { Schematic } from '../../types'

/**
 * Non-default workspace modes load on demand so their heavyweight graphs
 * (three.js, reactflow, recharts) never reach the initial bundle.
 */
const MechanicalDesignPanel = lazy(() => import('../mechanical/MechanicalDesignPanel'))
const ControlSystemsPanel = lazy(() => import('../control/ControlSystemsPanel'))
const MachineSimulatorPanel = lazy(() => import('../electronics/MachineSimulatorPanel'))
const PCBDesignPanel = lazy(() => import('../pcb/PCBDesignPanel'))
const RFDesignPanel = lazy(() => import('../rf/RFDesignPanel'))
const SchematicToPcbPanel = lazy(() =>
  import('../schematicToPcb/SchematicToPcbPanel').then((m) => ({ default: m.SchematicToPcbPanel })),
)
const Circuit3DViewer = lazy(() => import('../3d/Circuit3DViewer'))
const AdvancedRoboticsPanel = lazy(() =>
  import('../robotics/AdvancedRoboticsPanel').then((m) => ({ default: m.AdvancedRoboticsPanel })),
)
const BoardProgrammingPanel = lazy(() => import('../programming/BoardProgrammingPanel'))
const PiImagingPanel = lazy(() => import('../programming/PiImagingPanel'))
const VisualProgrammingEditor = lazy(() => import('../visual-programming/VisualProgrammingEditor'))
const FPGADesignPanel = lazy(() => import('../fpga/FPGADesignPanel'))
const HILTestingPanel = lazy(() => import('../hil/HILTestingPanel'))
const DigitalTwinFleetPanel = lazy(() => import('../digitalTwin/DigitalTwinFleetPanel'))
const SIEMDashboard = lazy(() => import('../siem/SIEMDashboard'))
const MarketplacePanel = lazy(() => import('../marketplace/MarketplacePanel'))
const SystemDashboard = lazy(() => import('../SystemDashboard'))
const BOMPanel = lazy(() => import('../bom/BOMPanel'))
const SimulationPanel = lazy(() => import('../simulation/SimulationPanel'))
// New e-CAD panels
const HDLEditor = lazy(() => import('../ecad/HDLEditor'))
const ICDesignPanel = lazy(() => import('../ecad/ICDesignPanel'))
const AgentPanel = lazy(() => import('../ecad/AgentPanel'))
const DatasheetImporter = lazy(() => import('../ecad/DatasheetImporter'))
const PluginMarketplace = lazy(() => import('../ecad/PluginMarketplace'))

interface DomainWorkspaceProps {
  libraryComponents: Component[]
  onSave: (data: Record<string, unknown>) => void
  onOpenDemos: () => void
  beforeSimulationRun?: () => string | null
  onSimulationRun?: () => void
}

const MODE_ICONS: Readonly<Record<WorkspaceMode, LucideIcon>> = {
  schematic: PenTool,
  simulation: Activity,
  convert: ArrowRightLeft,
  pcb: CircuitBoard,
  preview3d: Box,
  bom: List,
  control: SlidersHorizontal,
  machines: RotateCw,
  rf: Radio,
  hdl: Code2,
  icdesign: Cpu,
  fpga: Grid3X3,
  mechanical: Wrench,
  robotics: Bot,
  embedded: Terminal,
  imaging: Camera,
  visual: GitBranch,
  hil: FlaskConical,
  twin: RadioTower,
  agents: Sparkles,
  components: Package,
  plugins: Plug,
  dashboard: Gauge,
  siem: ShieldCheck,
  marketplace: ShoppingBag,
}

const GROUP_ICONS: Readonly<Record<WorkspaceGroupId, LucideIcon>> = {
  design: Layers,
  electrical: Zap,
  mechanical: Wrench,
  ops: ShieldCheck,
}

export default function DomainWorkspace({ libraryComponents, onSave, onOpenDemos, beforeSimulationRun, onSimulationRun }: DomainWorkspaceProps) {
  const {
    workspaceMode,
    setWorkspaceMode,
    setActiveTool,
    settings,
    updateSettings,
    sidebarOpen,
    toggleSidebar,
    selectedComponents,
    clearSelection,
  } = useAppStore()
  const { components, wires, currentProject, updateComponent } = useProjectStore()

  /*
   * Four workspace families keep 25 domains navigable without a 25-tab ribbon.
   * The family follows the active mode; clicking another family browses it
   * without leaving the current document.
   */
  const [activeGroup, setActiveGroup] = useState<WorkspaceGroupId>(() => groupForMode(workspaceMode))
  useEffect(() => setActiveGroup(groupForMode(workspaceMode)), [workspaceMode])
  const visibleModes = useMemo(
    () => WORKSPACE_MODES.filter((mode) => mode.group === activeGroup),
    [activeGroup],
  )

  /* Keep the active tab visible when a mode is opened from the demo gallery,
   * the command palette, or a deep link on a narrow screen. */
  const modeRowRef = useRef<HTMLDivElement>(null)
  const [modeScroll, setModeScroll] = useState({ left: false, right: false })

  useEffect(() => {
    const active = modeRowRef.current?.querySelector<HTMLElement>('[aria-current="page"]')
    active?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [workspaceMode, activeGroup])

  /* A hidden scrollbar leaves no cue that more domains exist, so the rail
   * exposes directional buttons only while there is content in that direction. */
  useEffect(() => {
    const row = modeRowRef.current
    if (!row) return
    const update = () =>
      setModeScroll({
        left: row.scrollLeft > 8,
        right: row.scrollLeft + row.clientWidth < row.scrollWidth - 8,
      })
    update()
    row.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    observer?.observe(row)
    return () => {
      row.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      observer?.disconnect()
    }
  }, [activeGroup, visibleModes.length])

  const scrollModes = (direction: -1 | 1) => {
    const row = modeRowRef.current
    if (!row) return
    row.scrollBy?.({ left: direction * Math.max(120, row.clientWidth * 0.6), behavior: 'smooth' })
  }

  /* Below the desktop breakpoint the library is a drawer; open with the sheet
   * in view instead of covering half of it. The header toggle reopens it. */
  useEffect(() => {
    const narrow = window.matchMedia?.('(max-width: 1279px)').matches ?? false
    if (narrow && useAppStore.getState().sidebarOpen) {
      useAppStore.setState({ sidebarOpen: false })
    }
  }, [])

  /**
   * Click-to-place flow: selecting a library part arms it; the next click on
   * the empty sheet drops it (snapped). Esc or a mode switch disarms.
   */
  const [pendingComponent, setPendingComponent] = useState<Component | null>(null)

  const schematic: Schematic = {
    id: 'active-schematic',
    name: currentProject?.name ?? 'Untitled',
    components: components.map((c) => ({
      id: c.id,
      componentId: c.componentId,
      component: c.component as unknown as Schematic['components'][number]['component'],
      position: { x: c.x, y: c.y },
      rotation: c.rotation,
      scale: 1,
      reference: c.reference,
      properties: c.properties,
      locked: c.locked,
      visible: c.visible,
      selected: false,
    })),
    wires: wires.map((w) => ({
      id: w.id,
      points: w.points,
      netName: w.netName,
      connectedPins: w.connectedPins,
      style: w.style,
    })),
    nets: [],
    metadata: {
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      version: '1.0.0',
    },
    settings: {
      gridSize: 10,
      snapToGrid: true,
      showGrid: true,
      showPinNumbers: true,
      showPinNames: true,
      showNetNames: true,
    },
  }

  /** Persist the current snapshot — same payload shape as the canvas autosave. */
  const saveSnapshot = useCallback(() => {
    onSave({
      components: useProjectStore.getState().components,
      wires: useProjectStore.getState().wires,
      viewport: useAppStore.getState().viewport,
      timestamp: Date.now(),
    })
  }, [onSave])

  /*
   * CAD shortcuts. Registered only while the sheet is the active workspace and
   * never while the user is typing in a field.
   */
  useEffect(() => {
    if (workspaceMode !== 'schematic') return
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }
      if (event.metaKey || event.ctrlKey) {
        if (event.key.toLowerCase() === 's') {
          event.preventDefault()
          saveSnapshot()
        } else if (event.key.toLowerCase() === 'z' && !event.shiftKey) {
          // Undo lives in the project store (canvas snapshots).
          event.preventDefault()
          useProjectStore.getState().undo()
        } else if (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y') {
          event.preventDefault()
          useProjectStore.getState().redo()
        }
        return
      }
      if (event.altKey) return
      switch (event.key.toLowerCase()) {
        case 'escape':
          setPendingComponent(null)
          clearSelection()
          break
        case 'v':
          setActiveTool('select')
          break
        case 'w':
          setActiveTool('wire')
          break
        case 'd':
          setActiveTool('delete')
          break
        case 'r': {
          // Rotate every selected part 90° clockwise, like KiCad.
          const project = useProjectStore.getState()
          const selectedIds = useAppStore.getState().selectedComponents
          let touched = false
          for (const comp of project.components) {
            if (!selectedIds.includes(comp.id)) continue
            project.updateComponent(comp.id, { rotation: (comp.rotation + 90) % 360 })
            touched = true
          }
          if (touched) project.markDirty()
          break
        }
        case 'g':
          updateSettings({ showGrid: !settings.showGrid })
          break
        case 'f':
          window.dispatchEvent(new CustomEvent('folio:fit-view'))
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [workspaceMode, saveSnapshot, clearSelection, setActiveTool, updateSettings, settings.showGrid])

  const isSchematic = workspaceMode === 'schematic'

  /* Inspector payload: exactly one selected part shows the properties dock. */
  const selectedPart =
    selectedComponents.length === 1
      ? components.find((c) => c.id === selectedComponents[0]) ?? null
      : null
  const inspector = selectedPart
    ? {
        id: selectedPart.id,
        reference: selectedPart.reference,
        component: {
          name: selectedPart.component.name,
          category: selectedPart.component.category,
          pins: selectedPart.component.pins,
        },
        properties: selectedPart.properties,
        x: selectedPart.x,
        y: selectedPart.y,
        rotation: selectedPart.rotation,
        locked: selectedPart.locked,
        visible: selectedPart.visible,
      }
    : null

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {/* Workspace families + the modes inside the selected family */}
      <nav className="app-chrome flex w-full min-w-0 flex-shrink-0 flex-col overflow-hidden border-b border-border" aria-label="Workspace" data-tour="workspace-nav">
        <div className="flex min-w-0 items-stretch gap-1 px-2 pt-1">
          <div className="scrollbar-none flex min-w-0 flex-1 items-stretch gap-1 overflow-x-auto" role="group" aria-label="Workspace families">
            {WORKSPACE_GROUPS.map((group) => {
              const Icon = GROUP_ICONS[group.id]
              const active = group.id === activeGroup
              return (
                <button
                  key={group.id}
                  type="button"
                  aria-pressed={active}
                  title={group.description}
                  onClick={() => setActiveGroup(group.id)}
                  className={`flex h-7 flex-shrink-0 items-center gap-1.5 rounded-t-sm border-b-2 px-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] transition-colors ${
                    active
                      ? 'border-b-primary bg-background text-foreground'
                      : 'border-b-transparent text-muted-foreground hover:bg-accent hover:text-foreground'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  {group.label}
                  {active && <span className="cad-readout text-[9px] text-muted-foreground">{visibleModes.length}</span>}
                </button>
              )
            })}
          </div>
          <button
            type="button"
            onClick={onOpenDemos}
            className="flex h-7 flex-shrink-0 items-center gap-1.5 rounded-sm border border-primary/40 bg-primary/10 px-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-primary transition-colors hover:bg-primary/20"
            title="Open the demo gallery (one tested scenario per workspace)"
          >
            <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
            Demos
          </button>
        </div>
        <div className="relative min-w-0">
          <div ref={modeRowRef} className="scrollbar-none flex min-w-0 items-stretch overflow-x-auto" role="group" aria-label={`${activeGroup} workspaces`}>
            {visibleModes.map((mode) => {
              const Icon = MODE_ICONS[mode.id]
              const active = workspaceMode === mode.id
              return (
                <button
                  key={mode.id}
                  type="button"
                  title={mode.description}
                  className={`cad-tab gap-1.5 ${active ? 'cad-tab-active' : ''}`}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => {
                    setPendingComponent(null)
                    setWorkspaceMode(mode.id)
                  }}
                >
                  <Icon className="h-3 w-3" aria-hidden="true" />
                  {mode.label}
                </button>
              )
            })}
          </div>
          {/* Overflow affordance: the tab rail scrolls without a visible bar. */}
          {modeScroll.right && (
            <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-surface to-transparent" aria-hidden="true" />
          )}
          {modeScroll.left && (
            <button
              type="button"
              onClick={() => scrollModes(-1)}
              aria-label="Scroll workspaces left"
              className="absolute inset-y-0 left-0 z-10 flex w-6 items-center justify-center border-r border-border bg-surface/95 text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          {modeScroll.right && (
            <button
              type="button"
              onClick={() => scrollModes(1)}
              aria-label="Scroll workspaces right"
              className="absolute inset-y-0 right-0 z-10 flex w-6 items-center justify-center border-l border-border bg-surface/95 text-muted-foreground hover:text-foreground"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </nav>
      {/* Workstation row: tool rail | library | sheet | inspector */}
      <div className="relative flex min-h-0 min-w-0 flex-1">
        {isSchematic && <ToolRail onSave={saveSnapshot} />}

        {isSchematic && sidebarOpen && (
          <div
            className="fixed inset-0 z-20 bg-overlay/40 xl:hidden"
            onClick={toggleSidebar}
            aria-hidden="true"
          />
        )}

        {isSchematic && sidebarOpen && (
          <aside className="cad-dock" aria-label="Component library" data-tour="component-library">
            <ComponentLibrary
              components={libraryComponents}
              selectedComponent={pendingComponent}
              onSelectComponent={(component) =>
                setPendingComponent((prev) => (prev?.id === component.id ? null : component))
              }
              onClose={toggleSidebar}
            />
          </aside>
        )}

        <div className="relative min-h-0 min-w-0 flex-1" data-tour="workspace-canvas">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground" role="status">
                Loading workspace…
              </div>
            }
          >
          {workspaceMode === 'schematic' && (
            <SchematicCanvas
              components={libraryComponents}
              onSave={onSave}
              pendingComponent={pendingComponent}
              onPendingPlaced={() => setPendingComponent(null)}
            />
          )}
          {workspaceMode === 'control' && <ControlSystemsPanel onClose={() => setWorkspaceMode('schematic')} />}
          {workspaceMode === 'machines' && <MachineSimulatorPanel onClose={() => setWorkspaceMode('schematic')} />}
          {workspaceMode === 'mechanical' && <MechanicalDesignPanel onClose={() => setWorkspaceMode('schematic')} />}
          {workspaceMode === 'pcb' && <PCBDesignPanel onClose={() => setWorkspaceMode('schematic')} onPreview3D={() => setWorkspaceMode('preview3d')} />}
          {workspaceMode === 'rf' && <RFDesignPanel onClose={() => setWorkspaceMode('schematic')} />}
          {workspaceMode === 'simulation' && (
            <div className="h-full overflow-auto p-4">
              <SimulationPanel
                onClose={() => setWorkspaceMode('schematic')}
                beforeRun={beforeSimulationRun}
                onRunComplete={onSimulationRun}
              />
            </div>
          )}
          {workspaceMode === 'convert' && (
            <div className="h-full overflow-auto p-4">
              <SchematicToPcbPanel schematic={schematic} />
            </div>
          )}
          {workspaceMode === 'preview3d' && <Circuit3DViewer onClose={() => setWorkspaceMode('schematic')} />}
          {workspaceMode === 'robotics' && <AdvancedRoboticsPanel onClose={() => setWorkspaceMode('schematic')} />}
          {workspaceMode === 'embedded' && <BoardProgrammingPanel onClose={() => setWorkspaceMode('schematic')} />}
          {workspaceMode === 'imaging' && <PiImagingPanel onClose={() => setWorkspaceMode('schematic')} />}
          {workspaceMode === 'visual' && <VisualProgrammingEditor onClose={() => setWorkspaceMode('schematic')} />}
          {workspaceMode === 'fpga' && <FPGADesignPanel />}
          {workspaceMode === 'hil' && <HILTestingPanel />}
          {workspaceMode === 'twin' && <DigitalTwinFleetPanel />}
          {workspaceMode === 'siem' && <SIEMDashboard />}
          {workspaceMode === 'marketplace' && <MarketplacePanel />}
          {workspaceMode === 'dashboard' && <SystemDashboard />}
          {workspaceMode === 'bom' && <BOMPanel />}
          {/* New e-CAD panels */}
          {workspaceMode === 'hdl' && (
            <HDLEditor onClose={() => setWorkspaceMode('schematic')} />
          )}
          {workspaceMode === 'icdesign' && (
            <ICDesignPanel onClose={() => setWorkspaceMode('schematic')} />
          )}
          {workspaceMode === 'agents' && (
            <AgentPanel onClose={() => setWorkspaceMode('schematic')} />
          )}
          {workspaceMode === 'components' && (
            <DatasheetImporter
              onPartAdded={(part) => {
                console.info('Custom part added:', part.name)
                setWorkspaceMode('schematic')
              }}
              onClose={() => setWorkspaceMode('schematic')}
            />
          )}
          {workspaceMode === 'plugins' && (
            <PluginMarketplace onClose={() => setWorkspaceMode('schematic')} />
          )}
          </Suspense>
        </div>

        {isSchematic && inspector && selectedPart && (
          <PropertiesPanel
            component={inspector}
            onUpdate={(id, patch) => {
              // The inspector patches both instance fields (x/y/rotation/lock)
              // and the editable attribute map — route each to its own slot.
              const { x, y, rotation, locked, visible, ...properties } = patch
              updateComponent(id, {
                properties,
                ...(typeof x === 'number' ? { x } : {}),
                ...(typeof y === 'number' ? { y } : {}),
                ...(typeof rotation === 'number' ? { rotation } : {}),
                ...(typeof locked === 'boolean' ? { locked } : {}),
                ...(typeof visible === 'boolean' ? { visible } : {}),
              })
            }}
            onClose={() => clearSelection()}
          />
        )}
      </div>
    </div>
  )
}
