import {
  MousePointer,
  Trash2,
  Grid3X3,
  Magnet,
  Ruler,
  Undo2,
  Redo2,
  Zap,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Save,
  CircuitBoard,
  Activity,
} from 'lucide-react'
import type { ReactNode } from 'react'
import HoverHelp from '../ui/HoverHelp'
import { useAppStore } from '../../stores/useAppStore'
import { useProjectStore } from '../../stores/useProjectStore'
import type { HelpTopicId } from '../../lib/help/helpTopics'
import { buildDemoBoard } from '../../lib/demo/demoBoard'

interface ToolRailProps {
  /** Persists the current design snapshot (same payload as the canvas autosave). */
  onSave: () => void
}

const POINTER_TOOLS = [
  { id: 'select', topicId: 'rail.select', label: 'Select', key: 'V', icon: MousePointer },
  { id: 'wire', topicId: 'rail.wire', label: 'Wire', key: 'W', icon: Zap },
  { id: 'delete', topicId: 'rail.delete', label: 'Delete', key: 'D', icon: Trash2 },
] as const satisfies ReadonlyArray<{
  id: 'select' | 'wire' | 'delete'
  topicId: HelpTopicId
  label: string
  key: string
  icon: typeof MousePointer
}>

const clampZoom = (zoom: number) => Math.min(8, Math.max(0.1, zoom))

interface RailButtonProps {
  /** Help topic id; its title, description and keys feed the hover guide. */
  topicId: HelpTopicId
  ariaLabel: string
  onClick: () => void
  active?: boolean
  ariaPressed?: boolean
  keyHint?: string
  children: ReactNode
}

/** One square rail button; the optional mono keycap advertises its shortcut. */
function RailButton({
  topicId,
  ariaLabel,
  onClick,
  active,
  ariaPressed,
  keyHint,
  children,
}: RailButtonProps) {
  return (
    <HoverHelp topicId={topicId} placement="right">
      <button
        type="button"
        className={`cad-rail-btn ${active ? 'cad-rail-btn-active' : ''}`}
        aria-pressed={ariaPressed}
        aria-label={ariaLabel}
        onClick={onClick}
      >
        {children}
        {keyHint && <span className="cad-rail-key">{keyHint}</span>}
      </button>
    </HoverHelp>
  )
}

/** Undo/redo buttons that re-render as the snapshot stacks change. */
function UndoRedoRailButtons() {
  // Subscribe to canvas arrays so the buttons re-render on every edit;
  // canUndo/canRedo read the stacks owned beside the store creator.
  useProjectStore((s) => s.components)
  useProjectStore((s) => s.wires)
  const canUndo = useProjectStore.getState().canUndo()
  const canRedo = useProjectStore.getState().canRedo()
  return (
    <>
      <RailButton topicId="rail.undo" ariaLabel="Undo" onClick={() => useProjectStore.getState().undo()}>
        <span style={{ opacity: canUndo ? 1 : 0.35 }}>
          <Undo2 className="h-4 w-4" />
        </span>
      </RailButton>
      <RailButton topicId="rail.redo" ariaLabel="Redo" onClick={() => useProjectStore.getState().redo()}>
        <span style={{ opacity: canRedo ? 1 : 0.35 }}>
          <Redo2 className="h-4 w-4" />
        </span>
      </RailButton>
    </>
  )
}

/**
 * Vertical tool rail pinned to the left edge of the sheet: pointer tools with
 * keyboard shortcuts, display toggles, and view controls.
 */
export default function ToolRail({ onSave }: ToolRailProps) {
  const { activeTool, setActiveTool, settings, updateSettings, viewport, setZoom } = useAppStore()

  return (
    <div className="cad-rail" role="toolbar" aria-orientation="vertical" aria-label="Editor tools" data-tour="tool-rail">
      {/* Pointer tools */}
      {POINTER_TOOLS.map((tool) => (
        <RailButton
          key={tool.id}
          topicId={tool.topicId}
          ariaLabel={`${tool.label} tool`}
          keyHint={tool.key}
          active={activeTool === tool.id}
          ariaPressed={activeTool === tool.id}
          onClick={() => setActiveTool(tool.id)}
        >
          <tool.icon className="h-4 w-4" />
        </RailButton>
      ))}

      <span className="cad-rail-sep" aria-hidden="true" />

      {/* Sheet display toggles */}
      <RailButton
        topicId="rail.grid"
        ariaLabel={`Toggle grid (${settings.showGrid ? 'on' : 'off'})`}
        active={settings.showGrid}
        ariaPressed={settings.showGrid}
        keyHint="G"
        onClick={() => updateSettings({ showGrid: !settings.showGrid })}
      >
        <Grid3X3 className="h-4 w-4" />
      </RailButton>
      <RailButton
        topicId="rail.snap"
        ariaLabel={`Toggle snap to grid (${settings.snapToGrid ? 'on' : 'off'})`}
        active={settings.snapToGrid}
        ariaPressed={settings.snapToGrid}
        onClick={() => updateSettings({ snapToGrid: !settings.snapToGrid })}
      >
        <Magnet className="h-4 w-4" />
      </RailButton>
      <RailButton
        topicId="rail.rulers"
        ariaLabel={`Toggle rulers (${settings.showRulers ? 'on' : 'off'})`}
        active={settings.showRulers}
        ariaPressed={settings.showRulers}
        onClick={() => updateSettings({ showRulers: !settings.showRulers })}
      >
        <Ruler className="h-4 w-4" />
      </RailButton>

      <span className="cad-rail-sep" aria-hidden="true" />

      {/* View controls */}
      <RailButton topicId="rail.zoom-in" ariaLabel="Zoom in" onClick={() => setZoom(clampZoom(viewport.zoom * 1.2))}>
        <ZoomIn className="h-4 w-4" />
      </RailButton>
      <RailButton topicId="rail.zoom-out" ariaLabel="Zoom out" onClick={() => setZoom(clampZoom(viewport.zoom / 1.2))}>
        <ZoomOut className="h-4 w-4" />
      </RailButton>
      <RailButton
        topicId="rail.fit"
        ariaLabel="Fit design to view"
        keyHint="F"
        onClick={() => window.dispatchEvent(new CustomEvent('folio:fit-view'))}
      >
        <Maximize2 className="h-4 w-4" />
      </RailButton>

      <span className="cad-rail-sep" aria-hidden="true" />

      <RailButton topicId="rail.save" ariaLabel="Save design" onClick={onSave}>
        <Save className="h-4 w-4" />
      </RailButton>

      {/* Undo/redo operate on the project store's snapshot stack. */}
      <UndoRedoRailButtons />

      {/* One-click proof: load the tested 6-part rectifier onto the sheet. */}
      <RailButton
        topicId="rail.demo"
        ariaLabel="Load demo rectifier board"
        onClick={() => {
          const board = buildDemoBoard();
          // Same reset as the divider loader: clear selection/live state so the
          // proof lands on a clean sheet instead of stacking on old content.
          useAppStore.getState().clearSelection();
          useProjectStore.setState({ components: board.components, wires: board.wires, isDirty: true, liveFrame: null });
          window.dispatchEvent(new CustomEvent('folio:fit-view'));
        }}
      >
        <CircuitBoard className="h-4 w-4" />
      </RailButton>
      {/* Simulation lives one tab to the right of the sheet — jump straight there. */}
      <RailButton
        topicId="rail.simulation"
        ariaLabel="Open Simulation workspace"
        onClick={() => useAppStore.getState().setWorkspaceMode('simulation')}
      >
        <Activity className="h-4 w-4" />
      </RailButton>
    </div>
  )
}