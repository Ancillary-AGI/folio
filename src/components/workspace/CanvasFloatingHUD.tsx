import HoverHelp from '../ui/HoverHelp'
import ScribeIcon from './ScribeIcon'
/**
 * Canvas Floating HUD
 *
 * A glassmorphic telemetry capsule docked over the sheet: live cursor position
 * (click to cycle mm/mil/in), grid snapping, zoom and framing, the active
 * copper layer, a DRC pulse and the split-viewport verbs — the instrument
 * strip a modern EDA shell is expected to carry.
 */
import {
  CheckCircle2,
  Compass,
  Grid,
  Layers,
  Maximize2,
  RotateCcw,
  Split,
  ZoomIn,
  ZoomOut,
  AlertTriangle,
} from 'lucide-react'
import { useAppStore, type WorkspaceMode } from '../../stores/useAppStore'
import { useDesignHealthStore } from '../../stores/useDesignHealthStore'
import { useCursorTelemetry, formatTelemetry } from '../../stores/useCursorTelemetry'

interface CanvasFloatingHUDProps {
  mode: WorkspaceMode
  onFitView?: () => void
  onTidyLayout?: () => void
}

const GRID_PRESETS = [0.1, 0.25, 0.5, 1.0, 2.54]

/* Same id space as the board panel's DEFAULT_LAYERS — one truth, one accent. */
const PCB_LAYERS = [
  { id: 'top-cu', label: 'Top Cu' },
  { id: 'in1-cu', label: 'In1 · GND' },
  { id: 'in2-cu', label: 'In2 · PWR' },
  { id: 'bot-cu', label: 'Bot Cu' },
  { id: 'top-silk', label: 'Silkscreen' },
  { id: 'top-mask', label: 'Soldermask' },
]

export default function CanvasFloatingHUD({ mode, onFitView, onTidyLayout }: CanvasFloatingHUDProps) {
  const viewport = useAppStore((state) => state.viewport)
  const setZoom = useAppStore((state) => state.setZoom)
  const settings = useAppStore((state) => state.settings)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const splitMode = useAppStore((state) => state.splitMode)
  const setSplitMode = useAppStore((state) => state.setSplitMode)
  const activePcbLayer = useAppStore((state) => state.activePcbLayer)
  const setActivePcbLayer = useAppStore((state) => state.setActivePcbLayer)
  const toggleAiChat = useAppStore((state) => state.toggleAiChat)
  const aiChatOpen = useAppStore((state) => state.aiChatOpen)

  const cursorX = useCursorTelemetry((state) => state.x)
  const cursorY = useCursorTelemetry((state) => state.y)
  const cursorUnit = useCursorTelemetry((state) => state.unit)
  const cycleUnit = useCursorTelemetry((state) => state.cycleUnit)

  const healthResult = useDesignHealthStore((state) => state.result)
  const toggleHealthPanel = useDesignHealthStore((state) => state.togglePanel)

  const isSchematicOrPcb = mode === 'schematic' || mode === 'pcb'
  // Only the sheet and the board publish cursor telemetry today.
  const hasCursorSource = isSchematicOrPcb

  const formatValue = (val: number) => formatTelemetry(val, cursorUnit).value

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
        {hasCursorSource && (
        <button
          type="button"
          onClick={cycleUnit}
          title={`Click to cycle units (${cursorUnit})`}
          aria-label={`Coordinates: X ${formatValue(cursorX)} ${cursorUnit}, Y ${formatValue(cursorY)} ${cursorUnit}. Unit: ${cursorUnit}`}
          className="flex flex-shrink-0 items-center gap-2 whitespace-nowrap px-2.5 py-1 text-[11px] font-mono tracking-tight text-foreground/90 transition-colors hover:text-primary"
        >
          <Compass className="h-3.5 w-3.5 text-primary/80" aria-hidden="true" />
          <span>
            X: <strong className="font-semibold text-foreground">{formatValue(cursorX)}</strong>
          </span>
          <span className="text-muted-foreground/60">•</span>
          <span>
            Y: <strong className="font-semibold text-foreground">{formatValue(cursorY)}</strong>
          </span>
          <span className="ml-1 rounded bg-muted/60 px-1 py-0.5 text-[9px] font-sans uppercase text-muted-foreground">
            {cursorUnit}
          </span>
        </button>
        )}

        {/* Grid & Snapping — snap is shared with the board editor (hidden in 3D, which has no snap) */}
        {isSchematicOrPcb && (
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

          {mode === 'schematic' && (
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
          )}
        </div>
        )}

        {/* Zoom & Framing — the sheet's viewport only */}
        {mode === 'schematic' && (
        <div className="flex items-center gap-1 px-2.5">
          <HoverHelp title="Zoom out" description="Zoom out — step the sheet view back by one level.">
            <button
              type="button"
              onClick={() => setZoom((viewport?.zoom ?? 1) - 0.15)}
              aria-label="Zoom out"
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            >
            <ZoomOut className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </HoverHelp>

          <span
            className="w-11 text-center font-mono text-[11px] font-semibold text-foreground/90"
            aria-label="Current zoom scale"
            role="status"
          >
            {zoomPercent}%
          </span>

          <HoverHelp title="Zoom in" description="Zoom in — step the sheet view forward by one level.">
            <button
              type="button"
              onClick={() => setZoom((viewport?.zoom ?? 1) + 0.15)}
              aria-label="Zoom in"
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            >
              <ZoomIn className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </HoverHelp>

          {onFitView && (
            <HoverHelp title="Zoom to fit contents (Z)" description="Zoom to fit contents (Z)">
<button type="button"
              onClick={onFitView}
              aria-label="Zoom to fit contents" className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground">
              <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
</HoverHelp>
          )}

          {onTidyLayout && (
            <HoverHelp title="Auto-tidy schematic layout" description="Auto-tidy schematic layout">
<button type="button"
              onClick={onTidyLayout}
              aria-label="Auto-tidy layout" className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground">
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
</HoverHelp>
          )}
        </div>
        )}

        {/* PCB Active Layer Quick Switcher — feeds the board panel's selection */}
        {mode === 'pcb' && (
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

        {/* Live ERC / Design Health Indicator — the sheet is the thing checked */}
        {mode === 'schematic' && (
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
        )}

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

        {/* Scribe — the mounted assistant, same as the header button */}
        <div className="px-2">
          <HoverHelp title="Open Scribe" description="Open Scribe, the sheet-true assistant">
<button type="button"
            onClick={toggleAiChat}
            aria-label="Toggle Scribe" aria-pressed={aiChatOpen}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold transition-all ${
              aiChatOpen
                ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/30'
                : 'bg-primary/15 text-primary hover:bg-primary/25 hover:shadow-md'
            }`}>
            <ScribeIcon className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Scribe</span>
          </button>
</HoverHelp>
        </div>
      </div>
    </div>
  )
}
