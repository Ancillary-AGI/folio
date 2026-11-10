/**
 * Futuristic Canvas Floating HUD
 *
 * Glassmorphic floating control dock providing real-time telemetry, precision
 * coordinates, grid snapping controls, active layer switcher, DRC health indicator,
 * and layout split controls (matching and exceeding modern tools like Flux.ai).
 */
import { useCallback } from 'react'
import {
  CheckCircle2,
  Compass,
  Grid,
  Layers,
  Maximize2,
  RotateCcw,
  Sparkles,
  Split,
  ZoomIn,
  ZoomOut,
  AlertTriangle,
} from 'lucide-react'
import { useAppStore, type WorkspaceMode } from '../../stores/useAppStore'
import { useDesignHealthStore } from '../../stores/useDesignHealthStore'

interface CanvasFloatingHUDProps {
  mode: WorkspaceMode
  onFitView?: () => void
  onTidyLayout?: () => void
}

const GRID_PRESETS = [0.1, 0.25, 0.5, 1.0, 2.54]

const PCB_LAYERS = [
  { id: 'top', label: 'F.Cu (Top)', color: 'bg-red-500' },
  { id: 'in1', label: 'In1.Cu (GND)', color: 'bg-amber-500' },
  { id: 'in2', label: 'In2.Cu (PWR)', color: 'bg-emerald-500' },
  { id: 'bottom', label: 'B.Cu (Bottom)', color: 'bg-blue-500' },
  { id: 'silk', label: 'F.Silk', color: 'bg-white' },
  { id: 'mask', label: 'F.Mask', color: 'bg-purple-500' },
]

export default function CanvasFloatingHUD({ mode, onFitView, onTidyLayout }: CanvasFloatingHUDProps) {
  const {
    viewport,
    setZoom,
    settings,
    updateSettings,
    splitMode,
    setSplitMode,
    cursorCoords,
    setCursorCoords,
    activePcbLayer,
    setActivePcbLayer,
    toggleCopilotFlyout,
    copilotFlyoutOpen,
  } = useAppStore()

  const healthResult = useDesignHealthStore((state) => state.result)
  const toggleHealthPanel = useDesignHealthStore((state) => state.togglePanel)

  const isPcbOr3D = mode === 'pcb' || mode === 'preview3d'
  const isSchematicOrPcb = mode === 'schematic' || mode === 'pcb'

  const cycleCoordUnit = useCallback(() => {
    const nextUnit = cursorCoords.unit === 'mm' ? 'mil' : cursorCoords.unit === 'mil' ? 'in' : 'mm'
    setCursorCoords({ unit: nextUnit })
  }, [cursorCoords.unit, setCursorCoords])

  const formatCoord = (val: number) => {
    if (cursorCoords.unit === 'mil') return `${(val * 39.3701).toFixed(1)} mil`
    if (cursorCoords.unit === 'in') return `${(val * 0.0393701).toFixed(3)} in`
    return `${val.toFixed(2)} mm`
  }

  const zoomPercent = Math.round((viewport?.zoom ?? 1) * 100)
  const violationCount = healthResult?.violations?.length ?? 0
  const hasErrors = violationCount > 0

  return (
    <div
      className="pointer-events-none absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2"
      role="region"
      aria-label="Canvas telemetry and viewport controls"
    >
      <div className="cad-glass-panel pointer-events-auto flex items-center divide-x divide-border/60 rounded-full px-2.5 py-1.5 shadow-2xl backdrop-blur-xl">
        {/* Precision Cursor Telemetry */}
        <button
          type="button"
          onClick={cycleCoordUnit}
          title={`Click to cycle units (${cursorCoords.unit})`}
          aria-label={`Coordinates: X ${formatCoord(cursorCoords.x)}, Y ${formatCoord(cursorCoords.y)}. Unit: ${cursorCoords.unit}`}
          className="flex items-center gap-2 px-2.5 py-1 text-[11px] font-mono tracking-tight text-foreground/90 transition-colors hover:text-primary"
        >
          <Compass className="h-3.5 w-3.5 text-primary/80" aria-hidden="true" />
          <span>
            X: <strong className="font-semibold text-foreground">{formatCoord(cursorCoords.x)}</strong>
          </span>
          <span className="text-muted-foreground/60">•</span>
          <span>
            Y: <strong className="font-semibold text-foreground">{formatCoord(cursorCoords.y)}</strong>
          </span>
          <span className="ml-1 rounded bg-muted/60 px-1 py-0.2 text-[9px] font-sans uppercase text-muted-foreground">
            {cursorCoords.unit}
          </span>
        </button>

        {/* Grid & Snapping Controller */}
        <div className="flex items-center gap-1.5 px-2.5">
          <button
            type="button"
            onClick={() => updateSettings({ snapToGrid: !settings.snapToGrid })}
            title={settings.snapToGrid ? 'Snap to grid: Enabled' : 'Snap to grid: Disabled'}
            aria-label="Toggle snap to grid"
            aria-pressed={settings.snapToGrid}
            className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium transition-colors ${
              settings.snapToGrid
                ? 'bg-primary/15 text-primary'
                : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'
            }`}
          >
            <Grid className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Snap</span>
          </button>

          <select
            aria-label="Grid size preset"
            title="Grid resolution"
            value={settings.gridSize}
            onChange={(e) => updateSettings({ gridSize: Number(e.target.value) })}
            className="cursor-pointer rounded border border-border/70 bg-transparent px-1.5 py-0.5 text-[10px] font-mono font-medium text-foreground outline-none transition-colors hover:border-primary focus:border-ring"
          >
            {GRID_PRESETS.map((preset) => (
              <option key={preset} value={preset} className="bg-card text-foreground">
                {preset} mm
              </option>
            ))}
          </select>
        </div>

        {/* Zoom & Framing Controls */}
        <div className="flex items-center gap-1 px-2.5">
          <button
            type="button"
            onClick={() => setZoom(Math.max(0.2, (viewport?.zoom ?? 1) - 0.15))}
            aria-label="Zoom out"
            title="Zoom out"
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            <ZoomOut className="h-3.5 w-3.5" aria-hidden="true" />
          </button>

          <span
            className="w-11 text-center font-mono text-[11px] font-semibold text-foreground/90"
            title="Current zoom scale"
          >
            {zoomPercent}%
          </span>

          <button
            type="button"
            onClick={() => setZoom(Math.min(4, (viewport?.zoom ?? 1) + 0.15))}
            aria-label="Zoom in"
            title="Zoom in"
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            <ZoomIn className="h-3.5 w-3.5" aria-hidden="true" />
          </button>

          {onFitView && (
            <button
              type="button"
              onClick={onFitView}
              aria-label="Zoom to fit contents"
              title="Zoom to fit contents (Z)"
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            >
              <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}

          {onTidyLayout && (
            <button
              type="button"
              onClick={onTidyLayout}
              aria-label="Auto-tidy layout"
              title="Auto-tidy schematic layout"
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* PCB Active Layer Quick Switcher (when PCB or 3D) */}
        {isPcbOr3D && (
          <div className="flex items-center gap-1 px-2.5">
            <Layers className="h-3.5 w-3.5 text-primary/70" aria-hidden="true" />
            <select
              aria-label="Active PCB copper layer"
              title="Active routing layer"
              value={activePcbLayer}
              onChange={(e) => setActivePcbLayer(e.target.value)}
              className="cursor-pointer rounded border border-border/70 bg-transparent px-1.5 py-0.5 text-[10px] font-medium text-foreground outline-none hover:border-primary focus:border-ring"
            >
              {PCB_LAYERS.map((layer) => (
                <option key={layer.id} value={layer.id} className="bg-card text-foreground">
                  {layer.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Live DRC / Design Health Indicator */}
        <button
          type="button"
          onClick={toggleHealthPanel}
          title={hasErrors ? `${violationCount} DRC findings detected` : 'All DRC checks passed (Clean)'}
          aria-label={`Design health: ${hasErrors ? `${violationCount} issues` : 'Passed'}`}
          className={`flex items-center gap-1.5 px-3 py-1 text-[11px] font-medium transition-colors ${
            hasErrors
              ? 'text-warning hover:text-warning/80'
              : 'text-success hover:text-success/80'
          }`}
        >
          {hasErrors ? (
            <AlertTriangle className="h-3.5 w-3.5 text-warning animate-pulse" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden="true" />
          )}
          <span>{hasErrors ? `${violationCount} DRC` : 'DRC Pass'}</span>
        </button>

        {/* Multi-Domain Viewport Split Engine (Single / Dual Split / 3D PiP) */}
        {isSchematicOrPcb && (
          <div className="flex items-center gap-1 px-2.5">
            <button
              type="button"
              onClick={() => {
                if (splitMode === 'single') {
                  setSplitMode('split-h', mode === 'schematic' ? 'pcb' : 'preview3d')
                } else if (splitMode === 'split-h') {
                  setSplitMode('pip-3d', 'preview3d')
                } else {
                  setSplitMode('single')
                }
              }}
              title={
                splitMode === 'single'
                  ? 'Switch to Side-by-Side Dual View'
                  : splitMode === 'split-h'
                    ? 'Switch to Picture-in-Picture 3D Preview'
                    : 'Return to Single View'
              }
              aria-label={`Viewport layout: ${splitMode}`}
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-all ${
                splitMode !== 'single'
                  ? 'bg-primary/20 text-primary shadow-sm'
                  : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'
              }`}
            >
              <Split className="h-3.5 w-3.5" aria-hidden="true" />
              <span>
                {splitMode === 'single'
                  ? 'Split'
                  : splitMode === 'split-h'
                    ? 'Split (2x)'
                    : '3D PiP'}
              </span>
            </button>
          </div>
        )}

        {/* Agent-Native Copilot Flyout Launcher */}
        <div className="px-2">
          <button
            type="button"
            onClick={toggleCopilotFlyout}
            aria-label="Toggle Agent Copilot"
            title="Open Context-Aware Agent Copilot"
            aria-pressed={copilotFlyoutOpen}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold transition-all ${
              copilotFlyoutOpen
                ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/30'
                : 'bg-primary/15 text-primary hover:bg-primary/25 hover:shadow-md'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5 animate-spin-slow" aria-hidden="true" />
            <span>Copilot</span>
          </button>
        </div>
      </div>
    </div>
  )
}
