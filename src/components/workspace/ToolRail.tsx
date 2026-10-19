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
import { useAppStore } from '../../stores/useAppStore'
import { useProjectStore } from '../../stores/useProjectStore'
import { buildDemoBoard } from '../../lib/demo/demoBoard'

interface ToolRailProps {
  /** Persists the current design snapshot (same payload as the canvas autosave). */
  onSave: () => void
}

const POINTER_TOOLS = [
  { id: 'select', label: 'Select', key: 'V', icon: MousePointer },
  { id: 'wire', label: 'Wire', key: 'W', icon: Zap },
  { id: 'delete', label: 'Delete', key: 'D', icon: Trash2 },
] as const

const clampZoom = (zoom: number) => Math.min(8, Math.max(0.1, zoom))

interface RailButtonProps {
  title: string
  ariaLabel?: string
  onClick: () => void
  active?: boolean
  ariaPressed?: boolean
  keyHint?: string
  children: ReactNode
}

/** One square rail button; the optional mono keycap advertises its shortcut. */
function RailButton({
  title,
  ariaLabel,
  onClick,
  active,
  ariaPressed,
  keyHint,
  children,
}: RailButtonProps) {
  return (
    <button
      type="button"
      className={`cad-rail-btn ${active ? 'cad-rail-btn-active' : ''}`}
      aria-pressed={ariaPressed}
      title={title}
      aria-label={ariaLabel ?? title}
      onClick={onClick}
    >
      {children}
      {keyHint && <span className="cad-rail-key">{keyHint}</span>}
    </button>
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
      <RailButton title="Undo (Ctrl+Z)" ariaLabel="Undo" onClick={() => useProjectStore.getState().undo()}>
        <span style={{ opacity: canUndo ? 1 : 0.35 }}>
          <Undo2 className="h-4 w-4" />
        </span>
      </RailButton>
      <RailButton title="Redo (Ctrl+Shift+Z)" ariaLabel="Redo" onClick={() => useProjectStore.getState().redo()}>
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
    <div className="cad-rail" role="toolbar" aria-orientation="vertical" aria-label="Editor tools">
      {/* Pointer tools */}
      {POINTER_TOOLS.map((tool) => (
        <RailButton
          key={tool.id}
          title={`${tool.label} tool (${tool.key})`}
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
        title={`Grid (${settings.showGrid ? 'on' : 'off'}) — press G`}
        active={settings.showGrid}
        ariaPressed={settings.showGrid}
        keyHint="G"
        onClick={() => updateSettings({ showGrid: !settings.showGrid })}
      >
        <Grid3X3 className="h-4 w-4" />
      </RailButton>
      <RailButton
        title={`Snap to grid (${settings.snapToGrid ? 'on' : 'off'})`}
        active={settings.snapToGrid}
        ariaPressed={settings.snapToGrid}
        onClick={() => updateSettings({ snapToGrid: !settings.snapToGrid })}
      >
        <Magnet className="h-4 w-4" />
      </RailButton>
      <RailButton
        title={`Rulers (${settings.showRulers ? 'on' : 'off'})`}
        active={settings.showRulers}
        ariaPressed={settings.showRulers}
        onClick={() => updateSettings({ showRulers: !settings.showRulers })}
      >
        <Ruler className="h-4 w-4" />
      </RailButton>

      <span className="cad-rail-sep" aria-hidden="true" />

      {/* View controls */}
      <RailButton title="Zoom in" onClick={() => setZoom(clampZoom(viewport.zoom * 1.2))}>
        <ZoomIn className="h-4 w-4" />
      </RailButton>
      <RailButton title="Zoom out" onClick={() => setZoom(clampZoom(viewport.zoom / 1.2))}>
        <ZoomOut className="h-4 w-4" />
      </RailButton>
      <RailButton
        title="Fit design to view (F)"
        keyHint="F"
        onClick={() => window.dispatchEvent(new CustomEvent('folio:fit-view'))}
      >
        <Maximize2 className="h-4 w-4" />
      </RailButton>

      <span className="cad-rail-sep" aria-hidden="true" />

      <RailButton title="Save (Ctrl+S)" onClick={onSave}>
        <Save className="h-4 w-4" />
      </RailButton>

      {/* Undo/redo operate on the project store's snapshot stack. */}
      <UndoRedoRailButtons />

      {/* One-click proof: load the tested 9-part blinker onto the sheet. */}
      <RailButton
        title="Load demo blinker board (tested: sim + fab)"
        ariaLabel="Load demo blinker board"
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
        title="Open Simulation (run DC, sweep, transient on this sheet)"
        ariaLabel="Open Simulation panel"
        onClick={() => useAppStore.getState().setWorkspaceMode('simulation')}
      >
        <Activity className="h-4 w-4" />
      </RailButton>
    </div>
  )
}