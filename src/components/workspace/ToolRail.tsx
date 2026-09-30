import {
  MousePointer,
  Trash2,
  Grid3X3,
  Magnet,
  Ruler,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Save,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useAppStore } from '../../stores/useAppStore'

interface ToolRailProps {
  /** Persists the current design snapshot (same payload as the canvas autosave). */
  onSave: () => void
}

const POINTER_TOOLS = [
  { id: 'select', label: 'Select', key: 'V', icon: MousePointer },
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
    </div>
  )
}