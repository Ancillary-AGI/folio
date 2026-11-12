import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import {
  Activity, ArrowRightLeft, Box, Bot, Cable, Camera, CircuitBoard, Code2,
  Construction, Cpu, Dna, FlaskConical,
  Gauge, GitBranch, Grid3X3, HelpCircle, Layers, List, Microscope, Package, PenTool, Plug, Radio, RadioTower, RotateCw,
  ShieldCheck, ShoppingBag, SlidersHorizontal, Terminal, Wrench, Zap,
  type LucideIcon,
} from 'lucide-react'
import SchematicCanvas from '../SchematicCanvas'
import DomainLibraryDock from '../library/DomainLibraryDock'
import PropertiesPanel from '../PropertiesPanel'
import NetInspector, { type NetInspectorModel } from '../NetInspector'
import ToolRail from './ToolRail'
import DesignHealthPanel from './DesignHealthPanel'
import CanvasFloatingHUD from './CanvasFloatingHUD'
import SplitViewportEngine from './SplitViewportEngine'
import HoverHelp from '../ui/HoverHelp'
import { useAppStore, type WorkspaceMode } from '../../stores/useAppStore'
import { useProjectStore } from '../../stores/useProjectStore'
import { useSketchStore } from '../../stores/useSketchStore'
import { useShortcutStore } from '../../stores/useShortcutStore'
import { useDesignHealthStore } from '../../stores/useDesignHealthStore'
import { isEditableTarget, matchesShortcut } from '../../lib/keymap/shortcuts'
import { runSchematicERC } from '../../lib/manufacturing/erc'
import { orderedFindings } from '../../lib/manufacturing/findings'
import { libraryForMode } from '../../lib/library/catalog'
import type { LibraryItem } from '../../lib/library/types'
import {
  WORKSPACE_GROUPS,
  WORKSPACE_MODES,
  groupForMode,
  type WorkspaceGroupId,
} from '../../lib/workspace/modes'

import { SCHEMATIC_UNITS_PER_MM } from '../../lib/schematic/units'
import type { Component } from '../../lib/supabase'
import type { Schematic } from '../../types'

/**
 * Non-default workspace modes load on demand so their heavyweight graphs
 * (three.js, reactflow, recharts) never reach the initial bundle.
 */
const MechanicalDesignPanel = lazy(() => import('../mechanical/MechanicalDesignPanel'))
const StructuresPanel = lazy(() => import('../structures/StructuresPanel'))
const BiologyPanel = lazy(() => import('../biology/BiologyPanel'))
const ControlSystemsPanel = lazy(() => import('../control/ControlSystemsPanel'))
const MachineSimulatorPanel = lazy(() => import('../electronics/MachineSimulatorPanel'))
const PowerGridPanel = lazy(() => import('../electronics/PowerGridPanel'))
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

/** Shared stage skeleton — one pulsing plate, not two competing ones. */
function StageLoading() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4" role="status">
      <div className="flex flex-col items-center gap-3">
        <div className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-primary/30 bg-surface/60"
          style={{ boxShadow: '0 0 20px -4px hsl(var(--primary) / 0.3)' }}>
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" aria-hidden="true" />
        </div>
        <div className="space-y-2 text-center" aria-hidden="true">
          <div className="cad-shimmer h-1.5 w-32 rounded-full" />
          <div className="cad-shimmer h-1.5 w-24 rounded-full mx-auto" />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Loading workspace…</p>
    </div>
  )
}

interface DomainWorkspaceProps {
  libraryComponents: Component[]
  onSave: (data: Record<string, unknown>) => void
  onOpenDemos: () => void
  /** Opens the help centre on this workspace's guide. */
  onOpenHelp: () => void
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
  grid: Cable,
  rf: Radio,
  hdl: Code2,
  icdesign: Cpu,
  fpga: Grid3X3,
  mechanical: Wrench,
  structures: Construction,
  robotics: Bot,
  embedded: Terminal,
  imaging: Camera,
  visual: GitBranch,
  hil: FlaskConical,
  biology: Dna,
  twin: RadioTower,
  agents: Bot,
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
  life: Microscope,
  ops: ShieldCheck,
}

export default function DomainWorkspace({ libraryComponents, onSave, onOpenDemos, onOpenHelp, beforeSimulationRun, onSimulationRun }: DomainWorkspaceProps) {
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
    selectedNet,
    selectNet,
    setSelectedComponents,
    requestComponentFocus,
    armedLibraryItem,
    setArmedLibraryItem,
    splitMode,
    secondaryWorkspace,
    setSplitMode,
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

  /* Below the desktop breakpoint the library is a drawer; open with the sheet
   * in view instead of covering half of it. The header toggle reopens it. */
  useEffect(() => {
    const narrow = window.matchMedia?.('(max-width: 1279px)').matches ?? false
    if (narrow && useAppStore.getState().sidebarOpen) {
      useAppStore.setState({ sidebarOpen: false })
    }
  }, [])

  /*
   * Click-to-place flow: selecting a library row arms it; the next click on the
   * empty surface places it. Esc or a mode switch disarms.
   *
   * The sheet and the board place `Component` objects, so their armed row is
   * kept as the part itself — the canvases already take that prop. Every other
   * domain places a library row, which lives in the store so its panel can read
   * it without prop-drilling through the lazy boundary.
   */
  const [pendingComponent, setPendingComponent] = useState<Component | null>(null)

  /** The dock for this workspace, or `null` when the domain places nothing. */
  const library = useMemo(
    () => libraryForMode(workspaceMode, libraryComponents),
    [workspaceMode, libraryComponents],
  )

  const armLibraryItem = useCallback((item: LibraryItem | null) => {
    if (item && item.kind === 'component') {
      const part = libraryComponents.find((c) => c.id === item.payload.componentId) ?? null
      setArmedLibraryItem(null)
      setPendingComponent((prev) => (prev?.id === part?.id ? null : part))
      return
    }
    setPendingComponent(null)
    setArmedLibraryItem(armedLibraryItem?.id === item?.id ? null : item)
  }, [armedLibraryItem, libraryComponents, setArmedLibraryItem])

  /** What the dock highlights: the armed row, whichever domain owns it. */
  const armedRow = useMemo<LibraryItem | null>(() => {
    if (armedLibraryItem) return armedLibraryItem
    if (!pendingComponent) return null
    return library?.items.find(
      (item) => item.kind === 'component' && item.payload.componentId === pendingComponent.id,
    ) ?? null
  }, [armedLibraryItem, library, pendingComponent])

  // Memoised because panels below derive from it: SchematicToPcbPanel runs a
  // full ERC pass in a memo keyed on this object, so rebuilding the literal on
  // every render (tool switch, status tick) re-ran the whole check for nothing.
  const schematic: Schematic = useMemo(() => ({
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
  }), [components, wires, currentProject?.name])

  /*
   * The rule check runs on the same memoised sheet the converter uses, so every
   * edit that rebuilds the schematic re-checks it once. The result is mirrored
   * into the design-health store because the app status bar reads the count
   * from outside this workspace.
   */
  const health = useMemo(() => runSchematicERC(schematic), [schematic])
  const setDesignHealth = useDesignHealthStore((state) => state.setResult)
  useEffect(() => setDesignHealth(health), [health, setDesignHealth])
  const healthPanelOpen = useDesignHealthStore((state) => state.panelOpen)
  const toggleHealthPanel = useDesignHealthStore((state) => state.togglePanel)
  const hideHealthPanel = useCallback(
    () => useDesignHealthStore.getState().setPanelOpen(false),
    [],
  )

  /* "Browse parts" from the empty sheet opens the dock if it is closed, then
   * lands the caret in the search field — the fastest route to a first part. */
  const focusLibrarySearch = useCallback(() => {
    if (!useAppStore.getState().sidebarOpen) toggleSidebar()
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const input = document.querySelector<HTMLInputElement>('[data-library-search]')
        if (!input) return
        input.focus()
        input.select()
      })
    })
  }, [toggleSidebar])

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
   * F8/Shift+F8 walks the same severity-ordered list the dock shows: the first
   * press starts at the top (or the bottom when stepping back), later presses
   * wrap. The dock opens and switches to Problems so the jumped-to row is
   * visible, and the part is centred rather than merely selected.
   */
  const stepFinding = useCallback((direction: 1 | -1) => {
    const ordered = orderedFindings(health)
    if (ordered.length === 0) return
    const healthStore = useDesignHealthStore.getState()
    if (!healthStore.panelOpen) healthStore.setPanelOpen(true)
    if (healthStore.tab !== 'problems') healthStore.setTab('problems')
    const current = healthStore.activeFindingIndex
    const index =
      current === null
        ? direction === 1 ? 0 : ordered.length - 1
        : (current + direction + ordered.length) % ordered.length
    healthStore.setActiveFindingIndex(index)
    const finding = ordered[index]
    if (!finding.componentId) return
    useAppStore.getState().setSelectedComponents([finding.componentId])
    useAppStore.getState().requestComponentFocus(finding.componentId)
  }, [health])

  /*
   * CAD shortcuts. Registered only while the sheet is the active workspace and
   * never while the user is typing in a field. Keys come from the shared
   * registry so a rebind in the guide changes what this handler does.
   */
  const shortcutOverrides = useShortcutStore((s) => s.overrides)
  useEffect(() => {
    if (workspaceMode !== 'schematic') return
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return
      const matches = (id: string) => matchesShortcut(event, id, shortcutOverrides)
      if (matches('schematic.save')) {
        event.preventDefault()
        saveSnapshot()
      } else if (matches('schematic.undo')) {
        // While sketching, undo steps back through ink before it touches the
        // design; otherwise it walks the project's canvas snapshots.
        event.preventDefault()
        const sketch = useSketchStore.getState()
        if (useAppStore.getState().activeTool === 'sketch' && sketch.strokes.length > 0) sketch.undoStroke()
        else useProjectStore.getState().undo()
      } else if (matches('schematic.redo')) {
        event.preventDefault()
        useProjectStore.getState().redo()
      } else if (matches('schematic.selectTool')) {
        setActiveTool('select')
      } else if (matches('schematic.wireTool')) {
        setActiveTool('wire')
      } else if (matches('schematic.deleteTool')) {
        setActiveTool('delete')
      } else if (matches('schematic.sketchTool')) {
        setActiveTool(useAppStore.getState().activeTool === 'sketch' ? 'select' : 'sketch')
      } else if (matches('schematic.rotate')) {
        // Rotate every selected part 90° clockwise.
        const project = useProjectStore.getState()
        const selectedIds = useAppStore.getState().selectedComponents
        let touched = false
        for (const comp of project.components) {
          if (!selectedIds.includes(comp.id)) continue
          project.updateComponent(comp.id, { rotation: (comp.rotation + 90) % 360 })
          touched = true
        }
        if (touched) project.markDirty()
      } else if (matches('schematic.grid')) {
        updateSettings({ showGrid: !settings.showGrid })
      } else if (matches('schematic.fit')) {
        window.dispatchEvent(new CustomEvent('folio:fit-view'))
      } else if (matches('schematic.tidy')) {
        window.dispatchEvent(new CustomEvent('folio:tidy-schematic'))
      } else if (matches('schematic.problems')) {
        toggleHealthPanel()
      } else if (matches('schematic.nextProblem')) {
        event.preventDefault()
        stepFinding(1)
      } else if (matches('schematic.previousProblem')) {
        event.preventDefault()
        stepFinding(-1)
      } else if (matches('schematic.cancel')) {
        setPendingComponent(null)
        setArmedLibraryItem(null)
        clearSelection()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [workspaceMode, shortcutOverrides, saveSnapshot, clearSelection, setActiveTool, updateSettings, settings.showGrid, setArmedLibraryItem, toggleHealthPanel, stepFinding])

  /*
   * Every other workspace takes the same Escape rule as the sheet: an armed row
   * is disarmed, and only when focus is not inside a field.
   */
  useEffect(() => {
    if (workspaceMode === 'schematic') return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || isEditableTarget(event.target)) return
      setArmedLibraryItem(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [workspaceMode, setArmedLibraryItem])

  const isSchematic = workspaceMode === 'schematic'
  /* Ten domains place things and fifteen do not; the dock appears only where a
   * catalog exists, so the header toggle is never a dead control. */
  const showsLibrary = library !== null

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
          // The row the symbol was dropped from carries the orderable number and
          // the paper its pinout came from; the inspector shows both.
          source: {
            manufacturer: selectedPart.component.manufacturer,
            partNumber: selectedPart.component.part_number,
            // Properties are a free-form string|number|boolean map, so the package
            // only reaches the inspector when this symbol really carries the text.
            package:
              typeof selectedPart.component.default_properties?.package === 'string'
                ? selectedPart.component.default_properties.package
                : undefined,
            datasheetUrl: selectedPart.component.datasheet_url,
          },
        },
        properties: selectedPart.properties,
        x: selectedPart.x,
        y: selectedPart.y,
        rotation: selectedPart.rotation,
        locked: selectedPart.locked,
        visible: selectedPart.visible,
      }
    : null

  /*
   * Pin → net cross-probe. The first wire that touches each pin names where the
   * pin lands; the inspector row sends the designer straight to that net.
   */
  const pinNets = useMemo(() => {
    if (!selectedPart) return undefined
    const map: Record<string, { name: string | null; wireId: string }> = {}
    for (const wire of wires) {
      for (const connection of wire.connectedPins) {
        if (connection.componentId !== selectedPart.id) continue
        if (map[connection.pinId]) continue
        map[connection.pinId] = { name: wire.netName ?? null, wireId: wire.id }
      }
    }
    return map
  }, [selectedPart, wires])

  const selectPinNet = useCallback(
    (pinId: string) => {
      const net = pinNets?.[pinId]
      if (!net) return
      // selectNet clears the part selection, which hands the dock to the net
      // inspector showing the copper this pin sits on.
      selectNet(net.name ? { name: net.name } : { wireId: net.wireId })
    },
    [pinNets, selectNet],
  )

  /*
   * Net inspector payload. A named net can span many wires; an unnamed one is
   * exactly the wire that was clicked, which is also how the rule checker keys
   * anonymous copper (`wire:<id>`).
   */
  const selectedNetWires = useMemo(() => {
    if (!selectedNet) return null
    return 'name' in selectedNet
      ? wires.filter((wire) => wire.netName === selectedNet.name)
      : wires.filter((wire) => wire.id === selectedNet.wireId)
  }, [selectedNet, wires])

  const netModel = useMemo<NetInspectorModel | null>(() => {
    if (!selectedNetWires || selectedNetWires.length === 0) return null
    const seen = new Set<string>()
    const pins: NetInspectorModel['pins'] = []
    let segmentCount = 0
    let length = 0
    for (const wire of selectedNetWires) {
      for (let index = 1; index < wire.points.length; index++) {
        const a = wire.points[index - 1]
        const b = wire.points[index]
        length += Math.hypot(b.x - a.x, b.y - a.y)
        segmentCount++
      }
      for (const connection of wire.connectedPins) {
        const pinKey = `${connection.componentId}:${connection.pinId}`
        if (seen.has(pinKey)) continue
        seen.add(pinKey)
        const placed = components.find((candidate) => candidate.id === connection.componentId)
        const pin = placed?.component.pins.find((candidate) => candidate.id === connection.pinId)
        if (!placed || !pin) continue
        pins.push({
          componentId: placed.id,
          pinId: pin.id,
          reference: placed.reference,
          partName: placed.component.name,
          pinName: pin.name,
          pinType: pin.type,
        })
      }
    }
    // No wire name means no way for the designer to have selected a name, so
    // the key falls back to the identity the ERC uses for that copper.
    const name = selectedNetWires[0].netName ?? null
    return {
      key: name ?? `wire:${selectedNetWires[0].id}`,
      name,
      pins,
      wireIds: selectedNetWires.map((wire) => wire.id),
      segmentCount,
      lengthMm: length / SCHEMATIC_UNITS_PER_MM,
    }
  }, [selectedNetWires, components])

  const netFindings = useMemo(
    () => (netModel ? health.violations.filter((finding) => finding.netId === netModel.key) : []),
    [health, netModel],
  )

  /* Renaming rewrites every wire of the net at once, so the whole net moves as
   * one undoable step and the selection follows the new name. */
  const renameNet = useCallback(
    (next: string): string | null => {
      if (!netModel) return 'Select a net first.'
      const members = new Set(netModel.wireIds)
      const taken = wires.some((wire) => wire.netName === next && !members.has(wire.id))
      if (taken) return `Another net is already named "${next}".`
      const store = useProjectStore.getState()
      store.replaceDesign({
        components: store.components,
        wires: store.wires.map((wire) =>
          members.has(wire.id) ? { ...wire, netName: next } : wire,
        ),
      })
      selectNet({ name: next })
      return null
    },
    [netModel, wires, selectNet],
  )

  /* Secondary viewport for the split engine. Only the two 3D/board surfaces are
   * meaningful seconds today; anything else or a self-pairing collapses to a
   * single canvas rather than mounting a duplicate. */
  const splitPairAllowed = workspaceMode === 'schematic' || workspaceMode === 'pcb' || workspaceMode === 'preview3d'
  const effectiveSecondary = secondaryWorkspace === workspaceMode
    ? (workspaceMode === 'preview3d' ? 'pcb' : 'preview3d')
    : secondaryWorkspace
  const splitSecondary = splitMode !== 'single' && splitPairAllowed ? (
    effectiveSecondary === 'pcb' ? (
      <Suspense fallback={<StageLoading />}>
        <PCBDesignPanel
          onClose={() => setSplitMode('single')}
          onPreview3D={() => setSplitMode('pip-3d', 'preview3d')}
          library={libraryComponents}
          pendingComponent={null}
          onPendingPlaced={() => {}}
        />
      </Suspense>
    ) : (
      <Suspense fallback={<StageLoading />}>
        <Circuit3DViewer onClose={() => setSplitMode('single')} />
      </Suspense>
    )
  ) : undefined

  // The HUD only pays for itself where the sheet/board lives; in 3D the
  // viewport owns its own HUD strip.
  const showHud = workspaceMode === 'schematic' || workspaceMode === 'pcb'

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {/* Workspace families + the modes inside the selected family. The family
          rail is the level above the document; the mode rail is the document
          switcher. They stay two rows so neither becomes a 25-item scroll. */}
      <nav
        className="cad-workspace-nav app-chrome relative flex w-full min-w-0 flex-shrink-0 flex-col overflow-hidden border-b border-border"
        aria-label="Workspace"
        data-tour="workspace-nav"
        style={{ '--family-accent': 'var(--primary)' } as CSSProperties}
      >
        <div className="ws-family-row">
          <div className="ws-family-rail" role="group" aria-label="Workspace families">
            {WORKSPACE_GROUPS.map((group) => {
              const Icon = GROUP_ICONS[group.id]
              const active = group.id === activeGroup
              return (
                <HoverHelp key={group.id} title={group.label} description={group.description} placement="bottom">
                  <button
                    type="button"
                    aria-pressed={active}
                    aria-label={`${group.label} family, ${visibleModes.length} workspaces`}
                    onClick={() => setActiveGroup(group.id)}
                    className={`ws-family ${active ? 'ws-family--active' : ''}`}
                  >
                    <Icon className="ws-family__icon" aria-hidden="true" />
                    <span className="ws-family__label">
                      {group.label}
                      {active && (
                        <span className="ws-family__count" aria-hidden="true">
                          {' '}{visibleModes.length}
                        </span>
                      )}
                    </span>
                  </button>
                </HoverHelp>
              )
            })}
          </div>
          <div className="ws-family-actions">
            <HoverHelp topicId="nav.demos" placement="bottom">
              <button
                type="button"
                onClick={onOpenDemos}
                aria-label="Open the demo gallery"
                aria-haspopup="dialog"
                className="cad-ctl cad-ctl--primary"
              >
                <FlaskConical aria-hidden="true" />
                Demos
              </button>
            </HoverHelp>
            <HoverHelp topicId="nav.guide" placement="bottom">
              <button
                type="button"
                onClick={onOpenHelp}
                aria-label="Open the help centre and workspace guides"
                className="cad-ctl"
              >
                <HelpCircle aria-hidden="true" />
                Guide
              </button>
            </HoverHelp>
          </div>
        </div>
        <div className="ws-mode-rail" role="group" aria-label={`${activeGroup} workspaces`}>
          {visibleModes.map((mode) => {
            const Icon = MODE_ICONS[mode.id]
            const active = workspaceMode === mode.id
            return (
              <HoverHelp key={mode.id} title={mode.label} description={mode.description} placement="bottom">
                <button
                  type="button"
                  className={`ws-mode ${active ? 'ws-mode--active' : ''}`}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => {
                    setPendingComponent(null)
                    setWorkspaceMode(mode.id)
                  }}
                >
                  <Icon className="ws-mode__icon" aria-hidden="true" />
                  {mode.label}
                </button>
              </HoverHelp>
            )
          })}
        </div>
      </nav>
      {/* Workstation row: tool rail | library | sheet | inspector */}
      <div className="relative flex min-h-0 min-w-0 flex-1">
        {isSchematic && <ToolRail onSave={saveSnapshot} />}

        {showsLibrary && sidebarOpen && (
          <div
            className="fixed inset-0 z-20 bg-overlay/40 xl:hidden"
            onClick={toggleSidebar}
            aria-hidden="true"
          />
        )}

        {showsLibrary && sidebarOpen && library && (
          <aside className="cad-dock" aria-label={library.label} data-tour="component-library">
            <DomainLibraryDock
              items={library.items}
              label={library.label}
              placeholder={library.placeholder}
              hint={library.hint}
              armed={armedRow}
              onArm={armLibraryItem}
              onClose={toggleSidebar}
            />
          </aside>
        )}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="workspace-stage relative min-h-0 min-w-0 flex-1" data-tour="workspace-canvas">
            <SplitViewportEngine
            primaryWorkspace={workspaceMode}
            primaryNode={
            <Suspense
            fallback={<StageLoading />}
          >
          {workspaceMode === 'schematic' && (
            <SchematicCanvas
              components={libraryComponents}
              onSave={onSave}
              pendingComponent={pendingComponent}
              onPendingPlaced={() => setPendingComponent(null)}
              onOpenDemos={onOpenDemos}
              onBrowseParts={showsLibrary ? focusLibrarySearch : undefined}
            />
          )}
          {workspaceMode === 'control' && <ControlSystemsPanel onClose={() => setWorkspaceMode('schematic')} />}
          {workspaceMode === 'machines' && <MachineSimulatorPanel onClose={() => setWorkspaceMode('schematic')} />}
          {workspaceMode === 'grid' && <PowerGridPanel onClose={() => setWorkspaceMode('schematic')} />}
          {workspaceMode === 'mechanical' && <MechanicalDesignPanel onClose={() => setWorkspaceMode('schematic')} />}
          {workspaceMode === 'structures' && <StructuresPanel onClose={() => setWorkspaceMode('schematic')} />}
          {workspaceMode === 'biology' && <BiologyPanel onClose={() => setWorkspaceMode('schematic')} />}
          {workspaceMode === 'pcb' && (
            <PCBDesignPanel
              onClose={() => setWorkspaceMode('schematic')}
              onPreview3D={() => setWorkspaceMode('preview3d')}
              library={libraryComponents}
              pendingComponent={pendingComponent}
              onPendingPlaced={() => setPendingComponent(null)}
            />
          )}
          {workspaceMode === 'rf' && <RFDesignPanel onClose={() => setWorkspaceMode('schematic')} />}
          {workspaceMode === 'simulation' && (
            <div className="h-full overflow-auto p-4 lg:p-5">
              {/* Setup reads as one column, not a form stretched across a
                  metre of screen; the stage keeps the width honest. */}
              <div className="mx-auto h-full w-full max-w-5xl">
                <SimulationPanel
                  onClose={() => setWorkspaceMode('schematic')}
                  beforeRun={beforeSimulationRun}
                  onRunComplete={onSimulationRun}
                />
              </div>
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
              onPartAdded={() => setWorkspaceMode('schematic')}
              onClose={() => setWorkspaceMode('schematic')}
            />
          )}
          {workspaceMode === 'plugins' && (
            <PluginMarketplace onClose={() => setWorkspaceMode('schematic')} />
          )}
          </Suspense>
            }
            secondaryNode={splitSecondary}
            />
            {showHud && (
              <CanvasFloatingHUD
                mode={workspaceMode}
                onFitView={workspaceMode === 'schematic' ? () => window.dispatchEvent(new CustomEvent('folio:fit-view')) : undefined}
                onTidyLayout={workspaceMode === 'schematic' ? () => window.dispatchEvent(new CustomEvent('folio:tidy-schematic')) : undefined}
              />
            )}
          </div>

          {isSchematic && healthPanelOpen && (
            <DesignHealthPanel
              result={health}
              components={components}
              wires={wires}
              onClose={hideHealthPanel}
            />
          )}
        </div>

        {isSchematic && inspector && selectedPart && (
          <PropertiesPanel
            component={inspector}
            pinNets={pinNets}
            onSelectPinNet={selectPinNet}
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

        {isSchematic && netModel && !selectedPart && (
          <NetInspector
            key={netModel.key}
            net={netModel}
            findings={netFindings}
            onRename={renameNet}
            onSelectPin={(componentId) => {
              setSelectedComponents([componentId])
              requestComponentFocus(componentId)
            }}
            onClose={() => clearSelection()}
          />
        )}
      </div>
    </div>
  )
}
