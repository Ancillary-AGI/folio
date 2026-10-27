/**
 * PCB Design Panel
 *
 * Improvements over original:
 *  - Wired to EMC simulation engine (real formula-based model)
 *  - Wired to thermal analysis engine (finite-difference solver)
 *  - Wired to signal integrity analyser
 *  - Enhanced DRC: clearance, width, overlap, unrouted nets
 *  - Real Gerber RS-274X export
 *  - Tabbed UI: Canvas / DRC / EMC / Thermal / Signal Integrity / Advanced / Assembly
 */

import {
  useState, useCallback, useMemo, useEffect, useRef,
  type ChangeEvent, type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  X, Layers, Route, Zap, Grid3X3, Eye, EyeOff, Download, Settings,
  Ruler, RotateCcw, Move, MousePointer, Thermometer, Wifi, AlertTriangle, CheckCircle,
  Cpu, Upload, GitCompare, Box, ZoomIn, ZoomOut, Maximize2,
} from 'lucide-react'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
import type { PlacedComponent, Wire, Point, Net } from '../../types'
import { useProjectStore } from '../../stores/useProjectStore'
import { emcSimulationEngine, type EMCTrace } from '../../lib/emc/emcSimulation'
import { thermalAnalysisEngine, type ThermalNode, type ThermalBoundary } from '../../lib/pcb/thermalAnalysis'
import { acceleratedThermalDispatch } from '../../lib/acceleration/acceleratedSimulation'
import type { ThermalAccelerator } from '../../lib/acceleration/thermalDispatch'
import type { ThermalGridResult, HeatSource } from '../../lib/acceleration/thermalGrid'
import {
  analyzeEyeDiagram,
  analyzeSignalPath,
  optimiseTraceWidth,
  type EyeResult,
  type SiResult,
  type TraceWidthOptimisation,
} from '../../lib/manufacturing/signalIntegrity'
import { exportToGerber, downloadFile } from '../../lib/exportUtils'
import { buildFabPackage } from '../../lib/manufacturing/fabExport'
import { autoroute, buildRouterPads, type RouterPad } from '../../lib/manufacturing/autorouter'
import {
  DEFAULT_DRC_RULES,
  DesignRuleChecker,
  type DRCRuleType,
  type DRCSettings,
} from '../../lib/manufacturing/drc'
import type { PCBDesign } from '../../lib/manufacturing/pcb'
import { buildPcbScene, type PcbScene, type PcbSceneInput } from '../../lib/pcb/pcbScene'
import {
  BOARD_ROUTER_DEFAULTS,
  netsFromWires,
  placeSchematicOnBoard,
  fabCopperFromRoutedTraces,
} from '../../lib/pcb/boardLayout'
import { useDemoRequest } from '../workspace/useDemoRequest'
import { polylineLength } from '../../lib/geometry/distance'
import {
  fourLayerStackup,
  microstripErEff,
  microstripImpedance,
  nearestPlane,
  validateStackup,
  widthForImpedance,
} from '../../lib/manufacturing/stackup'
import { planeLoopInductance, pourResistance, stitchingGrid } from '../../lib/manufacturing/powerIntegrity'
import { dogboneFanout, escapeTracksPerChannel, MICROVIA_FANOUT_RULES } from '../../lib/manufacturing/bgaFanout'
import { interfaceGroup, powerRails, SOC_256, validateBallMap } from '../../lib/electronics/socPackages'
import {
  checkGroup,
  checkPair,
  measureCoupling,
  meanderForSkew,
  USB2_HS,
  type PairViolation,
  type RoutedPair,
  type RoutedTrace,
} from '../../lib/manufacturing/diffPair'
import { parseIbis, type IbisFile } from '../../lib/manufacturing/ibisModel'
import { checkDqsGroup, checkFlyby, DDR3_1600, type DqsViolation } from '../../lib/manufacturing/ddrRouting'
import {
  STD_HDI_RULES,
  validateViaSpan,
  type HdiStackup,
} from '../../lib/manufacturing/hdiRouting'
import DesignCalculatorsPanel from '../electronics/DesignCalculatorsPanel'
import { generateId } from '../../lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface PCBDesignPanelProps {
  onClose: () => void
  onPreview3D?: () => void
  components?: PlacedComponent[]
  wires?: Wire[]
}

interface PCBLayer {
  id: string
  name: string
  type: 'signal' | 'power' | 'ground' | 'silkscreen' | 'soldermask' | 'paste'
  color: string
  visible: boolean
}

interface PCBTrace {
  id: string
  layerId: string
  width: number
  points: Point[]
  netName: string
}

interface PCBVia {
  id: string
  position: Point
  drillDiameter: number
  padDiameter: number
  netName: string
}

interface DRCViolation {
  id: string
  severity: 'error' | 'warning'
  rule: string
  message: string
  location?: Point
}

/** One byte lane's DQ bits matched against their DQS strobe. */
interface DdrLane {
  lane: number
  strobeNet: string
  strobeLengthMm: number
  bits: Array<{ index: number; net: string; lengthMm: number; mismatchMm: number; skewPs: number }>
  violations: DqsViolation[]
  worstMismatchMm: number
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_LAYERS: PCBLayer[] = [
  { id: 'top-cu', name: 'Top Copper', type: 'signal', color: '#cc0000', visible: true },
  { id: 'in1-cu', name: 'Inner 1 (GND)', type: 'ground', color: '#009900', visible: true },
  { id: 'in2-cu', name: 'Inner 2 (PWR)', type: 'power', color: '#0000cc', visible: true },
  { id: 'bot-cu', name: 'Bottom Copper', type: 'signal', color: '#ffaa00', visible: true },
  { id: 'top-silk', name: 'Top Silkscreen', type: 'silkscreen', color: '#ffffff', visible: true },
  { id: 'top-mask', name: 'Top Soldermask', type: 'soldermask', color: '#008800', visible: true },
  { id: 'bot-mask', name: 'Bottom Soldermask', type: 'soldermask', color: '#004400', visible: false },
]

/**
 * This board is routed at 0.1 mm/0.1 mm, tighter than the 0.2 mm house
 * default, so the shared checker is instantiated with explicit overrides.
 * Only one rule table exists: the panel renders exactly what DRC enforces.
 */
const PANEL_DRC_OVERRIDES: Partial<DRCSettings> = {
  minTraceWidth: 0.1,
  minTraceClearance: 0.1,
  minViaDiameter: 0.2,
  minViaDrillDiameter: 0.15,
  minAnnularRing: 0.05,
  checkTraceLength: false,
}

const PANEL_DRC_RULES: DRCSettings = { ...DEFAULT_DRC_RULES, ...PANEL_DRC_OVERRIDES }

const DISPLAYED_RULES = [
  'minTraceWidth',
  'minTraceClearance',
  'minViaDiameter',
  'minViaDrillDiameter',
  'minAnnularRing',
] as const satisfies ReadonlyArray<keyof DRCSettings>

const RULE_LABELS: Record<DRCRuleType, string> = {
  clearance: 'Min clearance',
  width: 'Trace width',
  drill: 'Drill / via size',
  annular_ring: 'Min annular ring',
  courtyard_overlap: 'Courtyard overlap',
  unconnected_net: 'Unrouted net',
  acute_angle: 'Acute angle',
  trace_length: 'Max trace length',
}

/**
 * Thermal boundary conditions are assumptions, stated once so both solvers
 * agree. Natural convection in still air over a bare board is the case being
 * modelled; forced airflow would need a higher coefficient and a different
 * value here.
 */
const THERMAL_AMBIENT_C = 25
const THERMAL_CONVECTION_W_M2K = 10
/** The board is drawn and previewed as 1.6 mm FR-4 with 1 oz copper. */
const THERMAL_COPPER_THICKNESS_MM = 0.035
/** Grid cap on simultaneous sources; parts beyond it are reported, not solved. */
const THERMAL_MAX_SOURCES = 20
/** Bulk properties shared with `thermalAnalysisEngine`'s material table. */
const FR4_CONDUCTIVITY_W_MK = 0.3
const COPPER_CONDUCTIVITY_W_MK = 400

/**
 * In-plane conductivity of a copper-layered laminate, weighted by the thickness
 * each material contributes. Copper planes carry nearly all lateral spread, so a
 * 1.6 mm FR-4 board with two 35 µm layers is ~14 W/(m·K) in plane rather than
 * FR-4's 0.3 — through-thickness spread keeps the FR-4 number.
 */
function effectiveInPlaneConductivityWmk(
  boardThicknessMm: number,
  copperLayerCount: number,
  copperThicknessMm: number,
): number {
  const copperMm = Math.max(0, copperLayerCount) * Math.max(0, copperThicknessMm)
  const fr4Mm = Math.max(0.001, boardThicknessMm - copperMm)
  return (FR4_CONDUCTIVITY_W_MK * fr4Mm + COPPER_CONDUCTIVITY_W_MK * copperMm) / (fr4Mm + copperMm)
}

/** Copper layers in the stackup that a thermal solver can spread heat through. */
function countCopperLayers(layers: readonly { type: string }[]): number {
  return layers.filter(layer => layer.type === 'signal' || layer.type === 'power' || layer.type === 'ground').length
}

/**
 * Trombone legs the panel sizes when a pair misses its skew budget: 1 mm
 * excursion at 2 mm pitch. A starting geometry the engineer edits, not a rule
 * any standard dictates — `meanderForSkew` reports the run and keep-out it eats.
 */
const PAIR_MEANDER_AMPLITUDE_MM = 1
const PAIR_MEANDER_PERIOD_MM = 2

// Declared assumptions for the reference link, not measurements. Only the
// trace length and width come from the routed board; everything else is a
// starting value the panel exposes for editing.
const SI_DEFAULTS = {
  heightMm: 0.2,
  epsilonR: 4.4,
  copperThicknessMm: 0.035,
  driverImpedanceOhm: 22,
  loadImpedanceOhm: 1e6,
  vHigh: 3.3,
  dataRateMbps: 100,
  riseTimeNs: 0.5,
}

// ── Geometry helpers ──────────────────────────────────────────────────────────

const HEAT_STOPS: ReadonlyArray<readonly [number, readonly [number, number, number]]> = [
  [0, [30, 64, 175]],
  [0.25, [14, 165, 233]],
  [0.5, [34, 197, 94]],
  [0.75, [250, 204, 21]],
  [1, [239, 68, 68]],
]

function heatColor(ratio: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, ratio))
  for (let index = 1; index < HEAT_STOPS.length; index += 1) {
    const [end, endColor] = HEAT_STOPS[index]
    if (t <= end) {
      const [start, startColor] = HEAT_STOPS[index - 1]
      const f = (t - start) / (end - start)
      return [
        Math.round(startColor[0] + f * (endColor[0] - startColor[0])),
        Math.round(startColor[1] + f * (endColor[1] - startColor[1])),
        Math.round(startColor[2] + f * (endColor[2] - startColor[2])),
      ]
    }
  }
  return [239, 68, 68]
}

function ThermalHeatmap({ result, ambientC }: { result: ThermalGridResult; ambientC: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = result.cols
    canvas.height = result.rows
    const context = canvas.getContext('2d')
    if (!context) return

    let min = Infinity
    let max = -Infinity
    for (const value of result.temperatureMatrix) {
      if (value < min) min = value
      if (value > max) max = value
    }
    const span = Math.max(max - min, 1e-6)
    const image = context.createImageData(result.cols, result.rows)
    for (let index = 0; index < result.temperatureMatrix.length; index += 1) {
      const [r, g, b] = heatColor((result.temperatureMatrix[index] - min) / span)
      image.data[index * 4] = r
      image.data[index * 4 + 1] = g
      image.data[index * 4 + 2] = b
      image.data[index * 4 + 3] = 255
    }
    context.putImageData(image, 0, 0)
  }, [result])

  return (
    <Card>
      <CardHeader className="pb-2 pt-3 px-3">
        <CardTitle className="flex items-center justify-between text-xs">
          <span>Steady-state heat map</span>
          <span className="font-normal text-muted-foreground">
            {result.cols}×{result.rows} @ {result.gridResolutionMm} mm
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 px-3 pb-3">
        <canvas
          ref={canvasRef}
          className="w-full rounded border border-border"
          style={{ imageRendering: 'pixelated', aspectRatio: `${result.cols} / ${result.rows}` }}
          role="img"
          aria-label={`PCB thermal map, peak ${result.peakTemperatureC.toFixed(1)} degrees Celsius`}
        />
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{ambientC} °C ambient</span>
          <span>{result.peakTemperatureC.toFixed(1)} °C peak</span>
        </div>
        <div className="text-[11px] text-muted-foreground">
          {result.converged
            ? `Converged in ${result.iterations.toLocaleString()} solver iterations: k = 3.5 W/(m·K), h = 15 W/(m²·K), 1.6 mm FR4.`
            : `Not fully converged after ${result.iterations.toLocaleString()} iterations; treat the peak as a lower bound.`}
        </div>
      </CardContent>
    </Card>
  )
}

function EyePlot({ eye, vHigh }: { eye: EyeResult; vHigh: number }) {
  const allPoints = eye.trajectories.flatMap((trajectory) => trajectory.points)
  const peak = Math.max(vHigh, ...allPoints.map((point) => point.volts), 1e-9)
  const floor = Math.min(0, ...allPoints.map((point) => point.volts))
  const span = Math.max(peak - floor, 1e-9)
  const width = 240
  const height = 100
  const pad = 8
  const mapPoints = (points: EyeResult['trajectories'][number]['points']): string =>
    points
      .map((point) => {
        const x = pad + (point.phaseUi / 2) * (width - 2 * pad)
        const y = height - pad - ((point.volts - floor) / span) * (height - 2 * pad)
        return `${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')
  const thresholdY = height - pad - ((eye.thresholdVolts - floor) / span) * (height - 2 * pad)

  return (
    <Card>
      <CardHeader className="pb-2 pt-3 px-3">
        <CardTitle className="flex items-center justify-between text-xs">
          <span>Computed NRZ eye</span>
          <span className="font-normal text-muted-foreground">2 UI window</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 px-3 pb-3">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full rounded border border-border bg-background"
          role="img"
          aria-label={`Computed eye diagram, height ${eye.eyeHeightVolts.toFixed(2)} volts, width ${eye.eyeWidthNs.toFixed(2)} nanoseconds`}
        >
          <line
            x1={pad}
            x2={width - pad}
            y1={thresholdY}
            y2={thresholdY}
            className="text-muted-foreground"
            stroke="currentColor"
            strokeWidth="0.5"
            strokeDasharray="2 2"
            opacity="0.6"
          />
          {eye.trajectories.map((trajectory, index) => (
            <polyline
              key={index}
              points={mapPoints(trajectory.points)}
              fill="none"
              className={trajectory.bit === 1 ? 'text-success' : 'text-destructive'}
              stroke="currentColor"
              strokeWidth="0.7"
              opacity="0.45"
            />
          ))}
        </svg>
        <div className="grid grid-cols-2 gap-1 text-[11px] text-muted-foreground">
          <span>Height {eye.eyeHeightVolts.toFixed(2)} V</span>
          <span>Width {eye.eyeWidthNs.toFixed(2)} ns ({eye.eyeWidthUi.toFixed(2)} UI)</span>
          <span>Worst high {eye.minHighVolts.toFixed(2)} V</span>
          <span>Worst low {eye.maxLowVolts.toFixed(2)} V</span>
        </div>
        <p className="text-[11px] text-muted-foreground">{eye.notes.join(' ')}</p>
      </CardContent>
    </Card>
  )
}

// ── PCB Canvas ────────────────────────────────────────────────────────────────

const SILK_COLOR = '#eef4ec'
const PAD_COLOR = '#d5ac5a'

/** Local pad offsets for a component, independent of its board rotation. */
function localPadOffset(
  component: PcbScene['components'][number],
  pad: PcbScene['components'][number]['pads'][number],
): { x: number; z: number } {
  const dx = pad.position.x - component.position.x
  const dz = pad.position.z - component.position.z
  const angle = (-component.rotationYDeg * Math.PI) / 180
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return { x: dx * cos - dz * sin, z: dx * sin + dz * cos }
}

/**
 * Board view with the same geometry the 3-D viewer consumes: real outline,
 * copper, pads, drills, package bodies and silkscreen. The SVG is fitted to the
 * panel and can be wheel-zoomed or dragged, so dense boards stay inspectable.
 */
/** Manual copper is drawn on the same 0.5 mm grid the router uses. */
const MANUAL_GRID_MM = 0.5
const MANUAL_TRACE_WIDTH_MM = 0.25
const PAD_SNAP_MM = 1.2

function PCBCanvas({
  traces, vias, boardWidth, boardHeight, selectedLayerId, layers, scene,
  activeTool, selectedComponentId, routerPads,
  onSelectComponent, onMoveComponent, onAddTrace, onAddVia,
}: {
  traces: PCBTrace[]
  vias: PCBVia[]
  boardWidth: number
  boardHeight: number
  selectedLayerId: string
  layers: PCBLayer[]
  scene: PcbScene | null
  activeTool: 'select' | 'route' | 'via' | 'move'
  selectedComponentId: string | null
  routerPads: readonly RouterPad[]
  onSelectComponent: (id: string | null) => void
  onMoveComponent: (id: string, position: Point) => void
  onAddTrace: (draft: { points: Point[]; layerId: string; width: number; netName: string }) => void
  onAddVia: (via: { position: Point; netName: string }) => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [draft, setDraft] = useState<{ points: Point[]; netName: string; layerId: string } | null>(null)
  const draftRef = useRef<typeof draft>(null)
  const [hover, setHover] = useState<Point | null>(null)
  const moveRef = useRef<{ id: string; origin: Point; startClient: { clientX: number; clientY: number }; pointerId: number } | null>(null)

  const margin = Math.max(4, Math.min(boardWidth, boardHeight) * 0.08)
  const viewWidth = (boardWidth + margin * 2) / zoom
  const viewHeight = (boardHeight + margin * 2) / zoom
  const centerX = boardWidth / 2 + pan.x
  const centerY = boardHeight / 2 + pan.y
  const viewBox = `${centerX - viewWidth / 2} ${centerY - viewHeight / 2} ${viewWidth} ${viewHeight}`
  const layerColor = (id: string) => layers.find(l => l.id === id)?.color ?? '#c98a3c'
  const selectedLayer = layers.find(l => l.id === selectedLayerId)
  const selectedPart = scene?.components.find(component => component.id === selectedComponentId)

  const resetView = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  const changeZoom = (factor: number) => {
    setZoom((current) => {
      const next = Math.min(8, Math.max(1, current * factor))
      if (next === 1) setPan({ x: 0, y: 0 })
      return next
    })
  }

  const orderedTraces = useMemo(
    () => [...traces].sort((a, b) => (a.layerId === 'bot-cu' ? 0 : 1) - (b.layerId === 'bot-cu' ? 0 : 1)),
    [traces],
  )

  const copperLayer = layers.find(layer => layer.id === selectedLayerId)
  const activeCopperLayerId = copperLayer
    && (copperLayer.type === 'signal' || copperLayer.type === 'power' || copperLayer.type === 'ground')
    ? copperLayer.id
    : 'top-cu'

  /**
   * Pointer → board millimetres. getScreenCTM handles zoom, pan and the
   * meet-fit letterboxing exactly; the rect fallback keeps the gesture
   * testable in jsdom, which does not implement SVG CTMs.
   */
  const toBoardPoint = (event: { clientX: number; clientY: number }): Point | null => {
    const svg = svgRef.current
    if (!svg) return null
    const ctm = typeof svg.getScreenCTM === 'function' ? svg.getScreenCTM() : null
    if (ctm && typeof DOMPoint !== 'undefined') {
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse())
      if (Number.isFinite(point.x) && Number.isFinite(point.y)) return { x: point.x, y: point.y }
    }
    const rect = svg.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    const scale = Math.min(rect.width / viewWidth, rect.height / viewHeight)
    if (!Number.isFinite(scale) || scale <= 0) return null
    return {
      x: (event.clientX - rect.left - (rect.width - viewWidth * scale) / 2) / scale
        + (centerX - viewWidth / 2),
      y: (event.clientY - rect.top - (rect.height - viewHeight * scale) / 2) / scale
        + (centerY - viewHeight / 2),
    }
  }

  const snapToGrid = (point: Point): Point => ({
    x: Math.round(point.x / MANUAL_GRID_MM) * MANUAL_GRID_MM,
    y: Math.round(point.y / MANUAL_GRID_MM) * MANUAL_GRID_MM,
  })

  const padNear = (point: Point): RouterPad | undefined => {
    let nearest: RouterPad | undefined
    let distance = PAD_SNAP_MM
    for (const pad of routerPads) {
      const candidate = Math.hypot(pad.x - point.x, pad.y - point.y)
      if (candidate < distance) {
        nearest = pad
        distance = candidate
      }
    }
    return nearest
  }

  const updateDraft = (next: typeof draft) => {
    draftRef.current = next
    setDraft(next)
  }

  const cancelDraft = () => {
    updateDraft(null)
    setHover(null)
  }

  const finishDraft = () => {
    const current = draftRef.current
    updateDraft(null)
    setHover(null)
    if (!current || current.points.length < 2) return
    onAddTrace({
      points: current.points,
      layerId: current.layerId,
      width: MANUAL_TRACE_WIDTH_MM,
      netName: current.netName,
    })
  }

  // Keyboard keeps the click-click gesture usable without a Finish button.
  const finishRef = useRef(finishDraft)
  finishRef.current = finishDraft
  const cancelRef = useRef(cancelDraft)
  cancelRef.current = cancelDraft
  useEffect(() => {
    if (!draft) return
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        cancelRef.current()
      } else if (event.key === 'Enter') {
        event.preventDefault()
        finishRef.current()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [draft])

  // Switching tools abandons an unfinished trace rather than leaving a
  // half-drawn polyline attached to the canvas.
  useEffect(() => {
    if (activeTool !== 'route' && draftRef.current) {
      draftRef.current = null
      setDraft(null)
      setHover(null)
    }
  }, [activeTool])

  const handleBoardPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 || (activeTool !== 'route' && activeTool !== 'via')) return
    event.stopPropagation()
    const raw = toBoardPoint(event)
    if (!raw) return
    const pad = padNear(raw)
    const point = pad ? { x: pad.x, y: pad.y } : snapToGrid(raw)

    if (activeTool === 'via') {
      onAddVia({ position: point, netName: pad?.netId ?? '' })
      return
    }

    const current = draftRef.current
    if (!current) {
      updateDraft({ points: [point], netName: pad?.netId ?? '', layerId: activeCopperLayerId })
      return
    }
    const last = current.points[current.points.length - 1]
    if (Math.abs(last.x - point.x) < 1e-6 && Math.abs(last.y - point.y) < 1e-6) return
    const closes = current.points.length >= 2
      && Math.abs(current.points[0].x - point.x) < 1e-6
      && Math.abs(current.points[0].y - point.y) < 1e-6
    const next = {
      ...current,
      points: [...current.points, point],
      netName: current.netName || pad?.netId || '',
    }
    updateDraft(next)
    if (closes) finishDraft()
  }

  return (
    <div
      ref={wrapRef}
      className={`relative h-full w-full overflow-hidden rounded bg-canvas ${
        activeTool === 'route' || activeTool === 'via'
          ? 'cursor-crosshair'
          : activeTool === 'move'
            ? 'cursor-grab active:cursor-grabbing'
            : 'cursor-grab active:cursor-grabbing'
      }`}
      onWheel={(event) => {
        event.preventDefault()
        changeZoom(event.deltaY < 0 ? 1.2 : 1 / 1.2)
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        // Route/via own the left button; panning stays on select/move.
        if (activeTool === 'route' || activeTool === 'via') return
        try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* jsdom */ }
        dragRef.current = { startX: event.clientX, startY: event.clientY, panX: pan.x, panY: pan.y }
      }}
      onPointerMove={(event) => {
        if (moveRef.current) {
          const point = toBoardPoint(event)
          // Both endpoints go through the transform as it is *now*: selecting a
          // part adds its readout, which reflows the canvas and moves the
          // letterboxed origin. Mixing an old and a new mapping would make the
          // part jump on the first move.
          const start = toBoardPoint(moveRef.current.startClient)
          if (point && start) {
            onMoveComponent(moveRef.current.id, snapToGrid({
              x: moveRef.current.origin.x + point.x - start.x,
              y: moveRef.current.origin.y + point.y - start.y,
            }))
          }
          return
        }
        if (activeTool === 'route' || activeTool === 'via') {
          const point = toBoardPoint(event)
          if (point) setHover(snapToGrid(point))
        }
        const drag = dragRef.current
        if (!drag || !wrapRef.current) return
        const rect = wrapRef.current.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) return
        setPan({
          x: Math.max(
            -(boardWidth / 2 + margin),
            Math.min(boardWidth / 2 + margin, drag.panX - ((event.clientX - drag.startX) * viewWidth) / rect.width),
          ),
          y: Math.max(
            -(boardHeight / 2 + margin),
            Math.min(boardHeight / 2 + margin, drag.panY - ((event.clientY - drag.startY) * viewHeight) / rect.height),
          ),
        })
      }}
      onPointerUp={() => { dragRef.current = null; moveRef.current = null }}
      onPointerCancel={() => { dragRef.current = null; moveRef.current = null }}
      onPointerLeave={() => setHover(null)}
      onContextMenu={(event) => {
        if (!draftRef.current) return
        event.preventDefault()
        cancelDraft()
      }}
    >
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0"
        role="img"
        aria-label={`PCB layout, ${boardWidth} by ${boardHeight} millimetres, ${traces.length} traces, ${scene?.counts.pads ?? 0} pads, ${activeTool} tool`}
        onPointerDown={handleBoardPointerDown}
        onDoubleClick={() => { if (draftRef.current) finishDraft() }}
      >
        <defs>
          <linearGradient id="pcb-board-fill" x1="0" y1="0" x2="0.7" y2="1">
            <stop offset="0%" stopColor="#116b3f" />
            <stop offset="55%" stopColor="#0c5734" />
            <stop offset="100%" stopColor="#083f26" />
          </linearGradient>
          <clipPath id="pcb-board-clip">
            <rect x={0} y={0} width={boardWidth} height={boardHeight} rx={2.2} />
          </clipPath>
          <filter id="pcb-board-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="1.2" stdDeviation="1.4" floodColor="#000" floodOpacity="0.55" />
          </filter>
        </defs>

        <rect x={centerX - viewWidth / 2} y={centerY - viewHeight / 2} width={viewWidth} height={viewHeight} fill="#080d12" />
        <rect
          x={0}
          y={0}
          width={boardWidth}
          height={boardHeight}
          rx={2.2}
          fill="url(#pcb-board-fill)"
          stroke="#062c1a"
          strokeWidth={0.35}
          filter="url(#pcb-board-shadow)"
        />

        <g clipPath="url(#pcb-board-clip)">
          {/* Copper under mask. A dark halo keeps traces legible on green. */}
          {orderedTraces
            .filter(trace => layers.find(layer => layer.id === trace.layerId)?.visible ?? true)
            .map(trace => {
              const points = trace.points.map(point => `${point.x},${point.y}`).join(' ')
              const isSelected = selectedLayerId === trace.layerId
              return (
                <g key={trace.id} opacity={isSelected ? 1 : 0.72}>
                  <path
                    d={`M ${trace.points.map(point => `${point.x} ${point.y}`).join(' L ')}`}
                    fill="none"
                    stroke="#052b19"
                    strokeWidth={trace.width + 0.16}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity="0.55"
                  />
                  <polyline
                    points={points}
                    fill="none"
                    stroke={isSelected ? '#e7a15a' : layerColor(trace.layerId)}
                    strokeWidth={Math.max(0.08, trace.width)}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </g>
              )
            })}

          {scene?.components.flatMap(component => component.pads.map(pad => {
            const x = pad.position.x + boardWidth / 2
            const y = pad.position.z + boardHeight / 2
            const drill = 'drillMm' in pad ? pad.drillMm : undefined
            return (
              <g key={pad.id} transform={`translate(${x} ${y}) rotate(${component.rotationYDeg})`}>
                {pad.shape === 'circle' ? (
                  <circle r={pad.widthMm / 2} fill={PAD_COLOR} stroke="#8a6a2f" strokeWidth={0.07} />
                ) : (
                  <rect
                    x={-pad.widthMm / 2}
                    y={-pad.depthMm / 2}
                    width={pad.widthMm}
                    height={pad.depthMm}
                    rx={pad.shape === 'oval' ? pad.depthMm / 2 : 0.12}
                    fill={PAD_COLOR}
                    stroke="#8a6a2f"
                    strokeWidth={0.07}
                  />
                )}
                {drill ? <circle r={drill / 2} fill="#0a0c0c" /> : null}
              </g>
            )
          }))}

          {vias.map(via => (
            <g key={via.id}>
              <circle
                cx={via.position.x}
                cy={via.position.y}
                r={via.padDiameter / 2}
                fill={PAD_COLOR}
                stroke="#8a6a2f"
                strokeWidth={0.07}
              />
              <circle cx={via.position.x} cy={via.position.y} r={via.drillDiameter / 2} fill="#0a0c0c" />
            </g>
          ))}

          {/* Package bodies, drawn as the physical part rather than a symbol. */}
          {scene?.components.map(component => {
            const x = component.position.x + boardWidth / 2
            const y = component.position.z + boardHeight / 2
            const width = component.bodyWidthMm
            const depth = component.bodyDepthMm
            const localPads = component.pads.map(pad => localPadOffset(component, pad))
            const padsAlongX = localPads.length === 2
              && Math.abs(localPads[1].x - localPads[0].x) >= Math.abs(localPads[1].z - localPads[0].z)
            const gap = 0.2
            // Cathode band sits at the cathode (pad 2) end of the package,
            // not across the middle of the body.
            const cathodeX = (localPads[1]?.x ?? 0) >= 0 ? width * 0.28 : -width * 0.28
            const cathodeZ = (localPads[1]?.z ?? 0) >= 0 ? depth * 0.28 : -depth * 0.28
            const selectable = activeTool === 'select' || activeTool === 'move'
            const selected = selectedComponentId === component.id
            return (
              <g
                key={component.id}
                data-component-id={component.id}
                data-selected={selected ? 'true' : undefined}
                transform={`translate(${x} ${y}) rotate(${component.rotationYDeg})`}
                style={selectable ? { cursor: activeTool === 'move' ? 'grab' : 'pointer' } : undefined}
                onPointerDown={selectable ? (event) => {
                  event.stopPropagation()
                  onSelectComponent(component.id)
                  if (activeTool !== 'move') return
                  moveRef.current = {
                    id: component.id,
                    origin: { x, y },
                    startClient: { clientX: event.clientX, clientY: event.clientY },
                    pointerId: event.pointerId,
                  }
                  try { wrapRef.current?.setPointerCapture(event.pointerId) } catch { /* jsdom */ }
                } : undefined}
              >
                {component.bodyShape === 'cylinder' ? (
                  <>
                    <circle
                      r={Math.min(width, depth) / 2}
                      fill={component.color}
                      stroke={selected ? '#38bdf8' : '#141414'}
                      strokeWidth={selected ? 0.24 : 0.1}
                    />
                    <circle r={Math.min(width, depth) / 2 - 0.22} fill="none" stroke="#e8e8e8" strokeWidth={0.08} opacity="0.35" />
                  </>
                ) : (
                  <rect
                    x={-width / 2}
                    y={-depth / 2}
                    width={width}
                    height={depth}
                    rx={component.category === 'ic' || component.category === 'connector' ? 0.18 : 0.08}
                    fill={component.color}
                    stroke={selected ? '#38bdf8' : '#0c0e10'}
                    strokeWidth={selected ? 0.24 : 0.1}
                  />
                )}
                {selected ? (
                  <rect
                    x={-width / 2 - 0.55}
                    y={-depth / 2 - 0.55}
                    width={width + 1.1}
                    height={depth + 1.1}
                    rx={0.22}
                    fill="none"
                    stroke="#38bdf8"
                    strokeWidth={0.14}
                    strokeDasharray="0.55 0.3"
                  />
                ) : null}

                {component.category === 'ic' || component.category === 'connector' ? (
                  <>
                    <rect
                      x={-width / 2 - gap}
                      y={-depth / 2 - gap}
                      width={width + gap * 2}
                      height={depth + gap * 2}
                      rx={0.18}
                      fill="none"
                      stroke={SILK_COLOR}
                      strokeWidth={0.12}
                    />
                    <circle cx={-width / 2} cy={-depth / 2} r={0.22} fill={SILK_COLOR} />
                  </>
                ) : localPads.length === 2 && padsAlongX ? (
                  <>
                    <line
                      x1={-width / 2 + 0.3}
                      y1={-depth / 2 - gap}
                      x2={width / 2 - 0.3}
                      y2={-depth / 2 - gap}
                      stroke={SILK_COLOR}
                      strokeWidth={0.12}
                      strokeLinecap="round"
                    />
                    <line
                      x1={-width / 2 + 0.3}
                      y1={depth / 2 + gap}
                      x2={width / 2 - 0.3}
                      y2={depth / 2 + gap}
                      stroke={SILK_COLOR}
                      strokeWidth={0.12}
                      strokeLinecap="round"
                    />
                  </>
                ) : (
                  <rect
                    x={-width / 2 - gap}
                    y={-depth / 2 - gap}
                    width={width + gap * 2}
                    height={depth + gap * 2}
                    rx={0.15}
                    fill="none"
                    stroke={SILK_COLOR}
                    strokeWidth={0.12}
                  />
                )}

                {component.category === 'semiconductor' && localPads.length === 2 ? (
                  padsAlongX ? (
                    <line
                      x1={cathodeX}
                      y1={-depth / 2 - gap}
                      x2={cathodeX}
                      y2={depth / 2 + gap}
                      stroke={SILK_COLOR}
                      strokeWidth={0.16}
                    />
                  ) : (
                    <line
                      x1={-width / 2 - gap}
                      y1={cathodeZ}
                      x2={width / 2 + gap}
                      y2={cathodeZ}
                      stroke={SILK_COLOR}
                      strokeWidth={0.16}
                    />
                  )
                ) : null}
              </g>
            )
          })}

          {scene?.components.map(component => {
            const x = component.position.x + boardWidth / 2
            const y = component.position.z + boardHeight / 2
            const labelRadius = Math.max(component.bodyWidthMm, component.bodyDepthMm) / 2
            const above = y - labelRadius - 0.75
            const labelY = above < margin ? y + labelRadius + 1.15 : above
            return (
              <text
                key={`ref-${component.id}`}
                x={x}
                y={labelY}
                textAnchor="middle"
                fontSize={0.62}
                fontWeight={600}
                fill={SILK_COLOR}
                stroke="#083f26"
                strokeWidth={0.16}
                paintOrder="stroke"
                style={{ letterSpacing: 0.02 }}
              >
                {component.reference}
              </text>
            )
          })}

          <text x={3} y={boardHeight - 3.6} fontSize={1.3} fontWeight={800} fill={SILK_COLOR} style={{ letterSpacing: 0.12 }}>
            FOLIO
          </text>
          <text x={3} y={boardHeight - 2.3} fontSize={0.58} fontWeight={500} fill={SILK_COLOR} opacity={0.85}>
            REV A · {boardWidth} × {boardHeight} mm
          </text>
          <g transform={`translate(${boardWidth - 13} ${boardHeight - 2.6})`} stroke={SILK_COLOR} fill={SILK_COLOR}>
            <line x1={0} y1={0} x2={10} y2={0} strokeWidth={0.16} />
            <line x1={0} y1={-0.45} x2={0} y2={0.45} strokeWidth={0.16} />
            <line x1={10} y1={-0.45} x2={10} y2={0.45} strokeWidth={0.16} />
            <text x={5} y={-0.55} fontSize={0.5} textAnchor="middle" stroke="none">10 mm</text>
          </g>

          {activeTool === 'route' && draft && draft.points.length > 0 ? (
            <g pointerEvents="none">
              <polyline
                points={[...draft.points, ...(hover ? [hover] : [])]
                  .map(point => `${point.x},${point.y}`)
                  .join(' ')}
                fill="none"
                stroke={layerColor(draft.layerId)}
                strokeWidth={MANUAL_TRACE_WIDTH_MM}
                strokeDasharray="0.7 0.35"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={0.9}
              />
              {draft.points.map((point, index) => (
                <circle key={`draft-${index}`} cx={point.x} cy={point.y} r={0.2} fill="#fbbf24" />
              ))}
            </g>
          ) : null}

          {hover && (activeTool === 'route' || activeTool === 'via') ? (
            <g pointerEvents="none">
              <circle
                cx={hover.x}
                cy={hover.y}
                r={activeTool === 'via' ? 0.3 : 0.35}
                fill="none"
                stroke="#fbbf24"
                strokeWidth={0.1}
                strokeDasharray="0.4 0.25"
              />
            </g>
          ) : null}
        </g>

        <rect
          x={0}
          y={0}
          width={boardWidth}
          height={boardHeight}
          rx={2.2}
          fill="none"
          stroke="#0a3b23"
          strokeWidth={0.35}
        />
      </svg>

      <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-overlay/70 px-2 py-1 text-xs text-overlay-foreground">
        {boardWidth} × {boardHeight} mm &nbsp;|&nbsp; Layer: {selectedLayer?.name ?? selectedLayerId} &nbsp;|&nbsp; {zoom.toFixed(1)}×
        {selectedPart ? ` | ${selectedPart.reference} selected` : ''}
      </div>

      {draft ? (
        <div className="absolute bottom-10 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded border border-border bg-overlay/90 px-2 py-1 text-[11px] text-overlay-foreground">
          <span>
            {draft.points.length} pt{draft.points.length === 1 ? '' : 's'} · {draft.netName || 'no net'}
          </span>
          <Button size="sm" variant="outline" className="h-6 text-[11px]" onClick={finishDraft}>
            Finish trace
          </Button>
          <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={cancelDraft}>
            Cancel
          </Button>
        </div>
      ) : null}

      <div className="absolute right-2 top-2 flex gap-1">
        <Button variant="outline" size="icon" className="h-6 w-6" aria-label="Zoom in" title="Zoom in" onClick={() => changeZoom(1.25)}>
          <ZoomIn className="h-3 w-3" />
        </Button>
        <Button variant="outline" size="icon" className="h-6 w-6" aria-label="Zoom out" title="Zoom out" onClick={() => changeZoom(1 / 1.25)}>
          <ZoomOut className="h-3 w-3" />
        </Button>
        <Button variant="outline" size="icon" className="h-6 w-6" aria-label="Fit board" title="Fit board" onClick={resetView}>
          <Maximize2 className="h-3 w-3" />
        </Button>
      </div>

      {scene && scene.warnings.length > 0 ? (
        <div className="pointer-events-none absolute bottom-2 right-2 rounded bg-destructive/85 px-2 py-1 text-[11px] text-destructive-foreground">
          {scene.warnings.length} placement warning{scene.warnings.length === 1 ? '' : 's'}
        </div>
      ) : null}
    </div>
  )
}

/** Convert a stored routed layout into the panel's mutable trace model. */
function panelTracesFromLayout(layout: PcbSceneInput | null): PCBTrace[] {
  if (!layout) return []
  return layout.traces.map(trace => ({
    id: trace.id,
    layerId: trace.layerId,
    width: trace.widthMm,
    points: trace.points.map(point => ({ ...point })),
    netName: trace.net,
  }))
}

function panelViasFromLayout(layout: PcbSceneInput | null): PCBVia[] {
  if (!layout) return []
  return layout.vias.map(via => ({
    id: via.id,
    position: { x: via.x, y: via.y },
    drillDiameter: via.drillDiameterMm,
    padDiameter: via.padDiameterMm,
    netName: via.net ?? '',
  }))
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export default function PCBDesignPanel({ onClose, onPreview3D, components: propComponents, wires: propWires }: PCBDesignPanelProps) {
  // Live canvas data from the store — but explicit props (tests, embedding)
  // win when provided, so the panel works both mounted in the workspace
  // (onClose only) and standalone with supplied data.
  const storeComponents = useProjectStore((s) => s.components)
  const storeWires = useProjectStore((s) => s.wires)
  const setPcbLayout = useProjectStore((s) => s.setPcbLayout)
  const storePcbLayout = useProjectStore((s) => s.pcbLayout)
  // A routed layout that already exists (demo, reopened session) is authoritative:
  // seed local state from it so the panel never silently re-routes over it.
  const initialLayoutRef = useRef<PcbSceneInput | null>(useProjectStore.getState().pcbLayout)
  const lastPublishedLayout = useRef<PcbSceneInput | null>(initialLayoutRef.current)
  const adoptingLayoutRef = useRef(false)
  const autoLayout = useMemo<{ components: PlacedComponent[]; size: { width: number; height: number } }>(
    () => {
      if (propComponents !== undefined) {
        // Explicit props describe an already-placed board; the caller owns
        // the outline, so never resize or rebase them.
        return { components: propComponents, size: { width: 100, height: 80 } }
      }
      return placeSchematicOnBoard(storeComponents)
    },
    [propComponents, storeComponents],
  )
  /**
   * A stored routed layout owns part placement. The schematic projection above
   * is only a starting guess; if the 2-D canvas kept using it while drawing the
   * layout's copper, parts and traces would describe two different boards.
   */
  // Only a layout this panel did not publish is an external placement source.
  // Reading our own publication back would rebuild the scene on every commit
  // and loop through the store forever.
  const externalLayout = storePcbLayout && storePcbLayout !== lastPublishedLayout.current
    ? storePcbLayout
    : null
  const placementSource = propComponents === undefined
    ? externalLayout ?? initialLayoutRef.current
    : null
  const layoutPlacement = useMemo(() => {
    const map = new Map<string, { x: number; y: number; rotationDeg?: number }>()
    for (const placed of placementSource?.components ?? []) {
      const entry = { x: placed.x, y: placed.y, rotationDeg: placed.rotationDeg }
      map.set(placed.id, entry)
      if (placed.reference) map.set(`ref:${placed.reference}`, entry)
    }
    return map
  }, [placementSource])
  const [placementOverrides, setPlacementOverrides] = useState<Record<string, { x: number; y: number }>>({})
  const [staleRouting, setStaleRouting] = useState(false)
  const components = useMemo(
    () => autoLayout.components.map((component) => {
      const placed = layoutPlacement.get(component.id)
        ?? layoutPlacement.get(`ref:${component.reference}`)
      const override = placementOverrides[component.id]
      if (!placed && !override) return component
      return {
        ...component,
        position: override ?? (placed ? { x: placed.x, y: placed.y } : component.position),
        rotation: placed?.rotationDeg ?? component.rotation,
      }
    }),
    [autoLayout, layoutPlacement, placementOverrides],
  )
  const wires: Wire[] = useMemo(
    () => {
      if (propWires !== undefined) return propWires
      return storeWires.map((w) => ({
        id: w.id,
        schematic_id: 'active',
        points: w.points.map((p) => ({ x: p.x / 10, y: p.y / 10 })),
        net_name: w.netName,
        style: w.style ? { width: w.style.width, color: w.style.color } : undefined,
        connectedPins: w.connectedPins,
        created_at: '',
        updated_at: '',
      }))
    },
    [propWires, storeWires],
  )
  // Wires sharing a net name are one electrical net: route and snap as a whole.
  const schematicNets = useMemo<Net[]>(() => netsFromWires(wires), [wires])
  /** Copper lands with their nets — the snap targets for manual routing. */
  const routerPads = useMemo(
    () => buildRouterPads(components, schematicNets),
    [components, schematicNets],
  )
  const [layers, setLayers] = useState<PCBLayer[]>(DEFAULT_LAYERS)
  const [selectedLayerId, setSelectedLayerId] = useState('top-cu')
  const [activeTool, setActiveTool] = useState<'select' | 'route' | 'via' | 'move'>('select')
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null)
  const [traces, setTraces] = useState<PCBTrace[]>(() => panelTracesFromLayout(initialLayoutRef.current))
  const [vias, setVias] = useState<PCBVia[]>(() => panelViasFromLayout(initialLayoutRef.current))
  const [boardWidth, setBoardWidth] = useState(initialLayoutRef.current?.widthMm ?? autoLayout.size.width)
  const [boardHeight, setBoardHeight] = useState(initialLayoutRef.current?.heightMm ?? autoLayout.size.height)
  const [drcViolations, setDrcViolations] = useState<DRCViolation[]>([])
  const [drcRan, setDrcRan] = useState(false)

  // Analysis results
  const [emcResult, setEmcResult] = useState<ReturnType<typeof emcSimulationEngine.simulate> | null>(null)
  const [emcError, setEmcError] = useState<string | null>(null)
  // EMC inputs are assumptions, not measurements: the panel asks for them
  // rather than inventing a current and clock for every trace.
  const [emcCurrentA, setEmcCurrentA] = useState(0.1)
  const [emcFrequencyHz, setEmcFrequencyHz] = useState(1e7)
  const [emcReturnSpacingMm, setEmcReturnSpacingMm] = useState(0.2)
  const [emcCableLengthMm, setEmcCableLengthMm] = useState(0)
  const [thermalResult, setThermalResult] = useState<Awaited<ReturnType<typeof thermalAnalysisEngine.analyzeThermal>> | null>(null)
  const [thermalMap, setThermalMap] = useState<ThermalGridResult | null>(null)
  const [thermalMapError, setThermalMapError] = useState<string | null>(null)
  /** Which parts the thermal solve could actually source loss data for. */
  const [thermalPowerNotice, setThermalPowerNotice] = useState<string | null>(null)
  const [thermalAccelerator, setThermalAccelerator] = useState<{ path: ThermalAccelerator; durationMs: number } | null>(null)
  const [siResult, setSiResult] = useState<SiResult | null>(null)
  const [siEye, setSiEye] = useState<EyeResult | null>(null)
  const [siWidthSuggestion, setSiWidthSuggestion] = useState<TraceWidthOptimisation | null>(null)
  const [siError, setSiError] = useState<string | null>(null)
  const [siBasis, setSiBasis] = useState<{ traceId: string; netName: string; lengthMm: number; widthMm: number } | null>(null)
  // SI assumptions are user-declared, like the EMC inputs: the board supplies
  // trace geometry, but stackup, driver and receiver are not derivable from it.
  const [siHeightMm, setSiHeightMm] = useState(SI_DEFAULTS.heightMm)
  const [siEpsilonR, setSiEpsilonR] = useState(SI_DEFAULTS.epsilonR)
  const [siCopperThicknessMm, setSiCopperThicknessMm] = useState(SI_DEFAULTS.copperThicknessMm)
  const [siDriverOhm, setSiDriverOhm] = useState(SI_DEFAULTS.driverImpedanceOhm)
  const [siLoadOhm, setSiLoadOhm] = useState(SI_DEFAULTS.loadImpedanceOhm)
  const [siVHigh, setSiVHigh] = useState(SI_DEFAULTS.vHigh)
  const [siDataRateMbps, setSiDataRateMbps] = useState(SI_DEFAULTS.dataRateMbps)
  const [siRiseTimeNs, setSiRiseTimeNs] = useState(SI_DEFAULTS.riseTimeNs)
  const [analysisRunning, setAnalysisRunning] = useState(false)
  const [activeTab, setActiveTab] = useState('canvas')
  const [ibisFile, setIbisFile] = useState<IbisFile | null>(null)
  const [ibisError, setIbisError] = useState<string | null>(null)
  /**
   * Group-match window for differential pairs, mm of mean-length spread. A
   * starting value to edit, not a standard's number: USB-2 does not publish one,
   * and the panel labels whatever is used.
   */
  const [pairGroupWindowMm, setPairGroupWindowMm] = useState(0.25)

  // ── Advanced: stackup, power integrity, BGA, diff pairs, IBIS ───────────────

  const stackupAnalysis = useMemo(() => {
    const layers = fourLayerStackup()
    const validation = validateStackup(layers)
    const reference = nearestPlane(layers, 0)
    const z0 = reference
      ? microstripImpedance(0.2, reference.distance, 0.035, reference.er)
      : Number.NaN
    const widthFor50 = reference
      ? widthForImpedance(50, {
        height: reference.distance,
        thickness: 0.035,
        er: reference.er,
        mode: 'microstrip',
      })
      : undefined
    return { layers, ...validation, reference, z0, widthFor50 }
  }, [])

  const powerIntegrity = useMemo(() => ({
    loopInductanceNh: planeLoopInductance(boardWidth, boardHeight, 0.2),
    pourResistanceMohm: pourResistance(boardWidth, boardHeight, 1),
    stitchingVias: stitchingGrid(boardWidth, boardHeight, 10, 1).length,
  }), [boardWidth, boardHeight])

  const bgaAnalysis = useMemo(() => {
    validateBallMap(SOC_256)
    const balls = SOC_256.balls.map((ball) => ({ ...ball, isPower: ball.kind === 'power' }))
    return {
      fanout: dogboneFanout(balls, SOC_256, MICROVIA_FANOUT_RULES),
      rails: Array.from(powerRails(SOC_256), ([rail, railBalls]) => ({ rail, count: railBalls.length })),
      ddrGroups: ['DDR_DQ0', 'DDR_DQ1', 'DDR_DQ2', 'DDR_DQ3'].map((group) => ({
        group,
        count: interfaceGroup(SOC_256, group).length,
      })),
      escapeTracks: escapeTracksPerChannel(SOC_256.pitch, MICROVIA_FANOUT_RULES.minDiameter, 0.1, 0.1),
    }
  }, [])

  /** Total routed copper per net — the length every matching check consumes. */
  const netLengths = useMemo(() => {
    const lengths = new Map<string, number>()
    for (const trace of traces) {
      if (!trace.netName) continue
      lengths.set(trace.netName, (lengths.get(trace.netName) ?? 0) + polylineLength(trace.points))
    }
    return lengths
  }, [traces])

  /**
   * Differential pairs, measured off the routed copper instead of asserted.
   *
   * Two nets whose names share a stem with a _P/_N or +/- suffix are a pair.
   * Their closest edge-to-edge approach and the length that stays parallel come
   * from `measureCoupling`; a section counts as coupled while the gap is within
   * one trace width, which is reported with the number so the reader can see
   * the yardstick. Skew in picoseconds needs a dielectric, so it uses the
   * effective permittivity of this pair's width over the stackup's own reference
   * plane — with no reference plane declared, the pair reports millimetres only
   * and the rule check says it was not run rather than passing on a guess.
   */
  const diffPairs = useMemo(() => {
    const byStem = new Map<string, { netP?: string; netN?: string }>()
    for (const name of netLengths.keys()) {
      const match = name.match(/^(.*?)(?:_P|_N|\+|-)$/i)
      if (!match || match[1].length === 0) continue
      const entry = byStem.get(match[1]) ?? {}
      if (/_P$/i.test(name) || name.endsWith('+')) entry.netP = name
      else entry.netN = name
      byStem.set(match[1], entry)
    }
    const shapes = new Map<string, RoutedTrace[]>()
    for (const trace of traces) {
      if (!trace.netName || trace.points.length < 2) continue
      const list = shapes.get(trace.netName) ?? []
      list.push({ points: trace.points, widthMm: trace.width })
      shapes.set(trace.netName, list)
    }
    const reference = stackupAnalysis.reference

    const built = Array.from(byStem, ([stem, entry]) => {
      if (!entry.netP || !entry.netN) return null
      const lengthP = netLengths.get(entry.netP) ?? 0
      const lengthN = netLengths.get(entry.netN) ?? 0
      const tracesP = shapes.get(entry.netP) ?? []
      const tracesN = shapes.get(entry.netN) ?? []
      const widths = [...tracesP, ...tracesN].map((trace) => trace.widthMm)
      const width = widths.length > 0
        ? widths.reduce((sum, value) => sum + value, 0) / widths.length
        : 0
      const erEff = reference && width > 0
        ? microstripErEff(width, reference.distance, reference.er)
        : null
      const coupling = tracesP.length > 0 && tracesN.length > 0
        ? measureCoupling(tracesP, tracesN, width)
        : null
      const routed: RoutedPair | null = coupling && erEff
        ? {
          name: stem,
          netP: entry.netP,
          netN: entry.netN,
          targetZ: USB2_HS.targetZ,
          skewBudgetPs: USB2_HS.skewBudgetPs,
          lengthP,
          lengthN,
          gap: coupling.minGapMm,
          coupledLength: coupling.coupledLengthMm,
          erEff,
        }
        : null
      return {
        stem,
        netP: entry.netP,
        netN: entry.netN,
        lengthP,
        lengthN,
        skewMm: Math.abs(lengthP - lengthN),
        width,
        erEff,
        coupling,
        routed,
        checked: routed ? checkPair(routed) : null,
        meander: meanderForSkew(
          Math.abs(lengthP - lengthN),
          PAIR_MEANDER_AMPLITUDE_MM,
          PAIR_MEANDER_PERIOD_MM,
        ),
      }
    }).filter((pair): pair is NonNullable<typeof pair> => pair !== null)

    // Group match only means anything between pairs that were actually checked.
    const checkedPairs = built.map((pair) => pair.routed).filter((pair): pair is RoutedPair => pair !== null)
    const groupViolations = checkedPairs.length > 1 ? checkGroup(checkedPairs, pairGroupWindowMm) : []
    const violationsByPair = new Map<string, PairViolation[]>()
    for (const violation of groupViolations) {
      const list = violationsByPair.get(violation.pair) ?? []
      list.push(violation)
      violationsByPair.set(violation.pair, list)
    }
    return {
      pairs: built.map((pair) => ({
        ...pair,
        violations: [...(pair.checked?.violations ?? []), ...(violationsByPair.get(pair.stem) ?? [])],
      })),
      groupChecked: checkedPairs.length,
      groupWindowMm: pairGroupWindowMm,
    }
  }, [netLengths, traces, stackupAnalysis, pairGroupWindowMm])

  /**
   * DDR checks over the routed copper. Byte lanes follow the x8 mapping
   * (DQ0–7 ↔ DQS0, DQ8–15 ↔ DQS1 …); nets that do not match that naming are
   * not guessed at. Only lengths that exist on the board are reported.
   */
  const ddrRouting = useMemo(() => {
    const entries = Array.from(netLengths.entries())
    const strobes = new Map<number, { net: string; lengthMm: number }>()
    for (const [name, lengthMm] of entries) {
      const match = /(?:^|[^a-z0-9])dqs_?(\d+)/i.exec(name)
      if (!match) continue
      const lane = Number(match[1])
      if (!strobes.has(lane)) strobes.set(lane, { net: name, lengthMm })
    }
    const lanes: DdrLane[] = []
    for (const [lane, strobe] of Array.from(strobes).sort((a, b) => a[0] - b[0])) {
      const bits = entries
        .map(([net, lengthMm]) => {
          const match = /(?:^|[^a-z0-9])dq_?(\d+)/i.exec(net)
          return match ? { index: Number(match[1]), net, lengthMm } : null
        })
        .filter((bit): bit is { index: number; net: string; lengthMm: number } =>
          bit !== null && Math.floor(bit.index / 8) === lane)
        .sort((a, b) => a.index - b.index)
      if (bits.length === 0) continue
      const check = checkDqsGroup({
        name: `DQS${lane}`,
        strobeLength: strobe.lengthMm,
        dqLengths: bits.map((bit) => bit.lengthMm),
        windowMm: DDR3_1600.dqWindowMm,
      })
      lanes.push({
        lane,
        strobeNet: strobe.net,
        strobeLengthMm: strobe.lengthMm,
        bits: bits.map((bit, index) => ({
          ...bit,
          mismatchMm: bit.lengthMm - strobe.lengthMm,
          skewPs: check.skewPs[index],
        })),
        violations: check.violations,
        worstMismatchMm: Math.max(...bits.map((bit) => Math.abs(bit.lengthMm - strobe.lengthMm))),
      })
    }

    const clock = entries.find(([name]) => /(?:^|[^a-z0-9])clk/i.test(name))
    const addresses = entries.filter(([name]) => /(?:^|[^a-z0-9])a(?:ddr)?_?\d+/i.test(name))
    const flyby = clock && addresses.length > 0
      ? {
          clockNet: clock[0],
          clockLengthMm: clock[1],
          addresses: addresses.map(([net, lengthMm]) => ({ net, lengthMm })),
          violations: checkFlyby({
            clockLength: clock[1],
            addrLengths: addresses.map(([, lengthMm]) => lengthMm),
            windowMm: DDR3_1600.flybyWindowMm,
          }),
        }
      : null

    return { lanes, flyby }
  }, [netLengths])

  // ── Advanced: HDI microvia span discipline ──────────────────────────────────

  const hdiStackup = useMemo<HdiStackup>(
    () => ({
      layers: layers
        .filter((layer) => layer.type === 'signal' || layer.type === 'power' || layer.type === 'ground')
        .map((layer) => ({
          id: layer.id,
          kind: layer.type === 'signal' ? 'signal' as const : 'plane' as const,
          thicknessMm: 0.035,
        })),
      microviaDrillMm: STD_HDI_RULES.microviaDrillMm,
      microviaPadMm: STD_HDI_RULES.microviaPadMm,
      microviaSpan: STD_HDI_RULES.microviaSpan,
    }),
    [layers],
  )
  const [hdiFrom, setHdiFrom] = useState('top-cu')
  const [hdiTo, setHdiTo] = useState('in1-cu')
  const [hdiVerdict, setHdiVerdict] = useState<{ ok: boolean; message: string } | null>(null)

  const handleValidateHdiSpan = useCallback(() => {
    try {
      validateViaSpan(hdiStackup, hdiFrom, hdiTo)
      setHdiVerdict({
        ok: true,
        message: `${hdiFrom} → ${hdiTo} is a legal microvia span (≤ ${hdiStackup.microviaSpan} layer step).`,
      })
    } catch (error) {
      setHdiVerdict({ ok: false, message: error instanceof Error ? error.message : String(error) })
    }
  }, [hdiStackup, hdiFrom, hdiTo])

  const handleIbisFile = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const text = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result ?? ''))
        reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`))
        reader.readAsText(file)
      })
      setIbisFile(parseIbis(text))
      setIbisError(null)
    } catch (error) {
      setIbisFile(null)
      setIbisError(error instanceof Error ? error.message : String(error))
    }
  }, [])

  // ── Auto-route from schematic wires (real A* router) ────────────────────────

  const handleAutoRoute = useCallback(() => {
    const result = autoroute(routerPads, {
      boardWidthMm: boardWidth,
      boardHeightMm: boardHeight,
      layers: ['F.Cu', 'B.Cu'],
      ...BOARD_ROUTER_DEFAULTS,
    })

    const newTraces: PCBTrace[] = result.traces.map((t, i) => ({
      id: `trace_${i}`,
      layerId: t.layerId === 'B.Cu' ? 'bot-cu' : 'top-cu',
      width: t.widthMm,
      points: t.points,
      netName: t.netId,
    }))

    setTraces(newTraces)
    setVias(result.vias.map((v, i) => ({
      id: `via_${i}`,
      position: { x: v.x, y: v.y },
      drillDiameter: v.drillMm,
      padDiameter: v.padMm,
      netName: v.netId,
    })))

    // Copper changed, so every trace-derived result belongs to the old board.
    setEmcResult(null)
    setEmcError(null)
    setSiResult(null)
    setSiEye(null)
    setSiWidthSuggestion(null)
    setSiBasis(null)
    setSiError(null)
    setDrcViolations(result.unrouted.map(netId => ({
      id: `unrouted_${netId}`,
      severity: 'warning' as const,
      rule: 'Unrouted net',
      message: `Net "${netId}" could not be routed (${result.stats.routedNets}/${result.stats.totalNets} routed)`,
    })))
    setDrcRan(result.unrouted.length > 0)
    setStaleRouting(false)
  }, [routerPads, boardWidth, boardHeight])

  useDemoRequest('pcb-autoroute', handleAutoRoute)

  /** Any copper or placement edit invalidates the last analysis verdicts. */
  const invalidateChecks = useCallback(() => {
    setDrcViolations([])
    setDrcRan(false)
    setEmcResult(null)
    setEmcError(null)
    setSiResult(null)
    setSiEye(null)
    setSiWidthSuggestion(null)
    setSiBasis(null)
    setSiError(null)
    setThermalResult(null)
    setThermalMap(null)
    setThermalAccelerator(null)
    setThermalPowerNotice(null)
  }, [])

  const handleAddTrace = useCallback((draft: {
    points: Point[]
    layerId: string
    width: number
    netName: string
  }) => {
    setTraces(previous => [...previous, { id: generateId('trace'), ...draft }])
    invalidateChecks()
  }, [invalidateChecks])

  const handleAddVia = useCallback((via: { position: Point; netName: string }) => {
    setVias(previous => [...previous, {
      id: generateId('via'),
      position: via.position,
      drillDiameter: 0.3,
      padDiameter: 0.6,
      netName: via.netName,
    }])
    invalidateChecks()
  }, [invalidateChecks])

  const handleMoveComponent = useCallback((id: string, position: Point) => {
    setPlacementOverrides(previous => ({ ...previous, [id]: position }))
    // Existing copper was routed to the old pad positions. Keep it visible for
    // comparison but never let the panel imply it still matches the board.
    setStaleRouting(true)
    invalidateChecks()
  }, [invalidateChecks])

  // ── DRC ───────────────────────────────────────────────────────────────────────

  /**
   * Adapter from the panel's drawing model to the shared PCB data model.
   * Components/pads are deliberately omitted: schematic placement is a
   * different coordinate space, and inventing board pads here would produce
   * courtyards and clearances that do not exist on the board.
   */
  const boardDesign = useMemo<PCBDesign>(() => {
    const copperLayerIds = layers
      .filter(layer => layer.type === 'signal' || layer.type === 'power' || layer.type === 'ground')
      .map(layer => layer.id)
    const netNames = new Set<string>()
    for (const wire of wires) if (wire.netName) netNames.add(wire.netName)
    for (const trace of traces) if (trace.netName) netNames.add(trace.netName)
    for (const via of vias) if (via.netName) netNames.add(via.netName)

    return {
      id: 'panel-design',
      name: 'PCB Design',
      dimensions: { width: boardWidth, height: boardHeight, thickness: 1.6 },
      layers: layers.map(layer => ({
        id: layer.id,
        name: layer.name,
        type: layer.type === 'silkscreen'
          ? 'silk_screen'
          : layer.type === 'soldermask' || layer.type === 'paste'
            ? 'solder_mask'
            : 'copper',
        thickness: 0.035,
        material: 'copper',
      })),
      traces: traces.map(trace => ({
        id: trace.id,
        netId: trace.netName,
        layerId: trace.layerId,
        width: trace.width,
        points: trace.points,
        clearance: PANEL_DRC_RULES.minTraceClearance,
      })),
      vias: vias.map(via => ({
        id: via.id,
        position: via.position,
        diameter: via.padDiameter,
        drillDiameter: via.drillDiameter,
        layers: copperLayerIds,
        netId: via.netName,
      })),
      pads: [],
      components: [],
      nets: Array.from(netNames).map(name => ({
        id: name,
        name,
        connectedPins: [],
        wires: [],
      })),
      designRules: {
        minTraceWidth: PANEL_DRC_RULES.minTraceWidth,
        minTraceSpacing: PANEL_DRC_RULES.minTraceClearance,
        minViaDiameter: PANEL_DRC_RULES.minViaDiameter,
        minViaDrillDiameter: PANEL_DRC_RULES.minViaDrillDiameter,
        minPadDiameter: PANEL_DRC_RULES.minPadDiameter,
        minHoleDiameter: PANEL_DRC_RULES.minHoleDiameter,
        copperThickness: 0.035,
        solderMaskClearance: 0.1,
        silkScreenClearance: 0.15,
      },
    }
  }, [traces, vias, wires, layers, boardWidth, boardHeight])

  /** Stackup figures the thermal solvers are given, derived from `layers`. */
  const thermalStackup = useMemo(() => {
    const copperLayers = countCopperLayers(layers)
    return {
      copperLayers,
      inPlaneConductivityWmk: effectiveInPlaneConductivityWmk(1.6, copperLayers, THERMAL_COPPER_THICKNESS_MM),
    }
  }, [layers])

  /**
   * The 3D viewer previews this exact object: outline, copper layers, routed
   * traces, vias and footprint bodies. Components are placed with the same
   * coordinates the autorouter used, so the preview cannot show a part where
   * the router did not put it.
   */
  const pcbSceneLayout = useMemo<PcbSceneInput>(() => ({
    widthMm: boardWidth,
    heightMm: boardHeight,
    thicknessMm: 1.6,
    copperThicknessMm: 0.035,
    layers: layers.map(layer => ({
      id: layer.id,
      name: layer.name,
      kind: layer.type === 'silkscreen'
        ? 'silk' as const
        : layer.type === 'soldermask' || layer.type === 'paste'
          ? 'mask' as const
          : 'copper' as const,
      color: layer.color,
      visible: layer.visible,
      side: layer.id.startsWith('bot') ? 'bottom' as const : 'top' as const,
      thicknessMm: layer.type === 'silkscreen'
        ? 0.01
        : layer.type === 'soldermask' || layer.type === 'paste'
          ? 0.025
          : 0.035,
    })),
    traces: traces.map(trace => ({
      id: trace.id,
      net: trace.netName,
      layerId: trace.layerId,
      widthMm: trace.width,
      points: trace.points,
    })),
    vias: vias.map(via => ({
      id: via.id,
      net: via.netName,
      x: via.position.x,
      y: via.position.y,
      padDiameterMm: via.padDiameter,
      drillDiameterMm: via.drillDiameter,
    })),
    components: components
      // Ground symbols annotate a net and have no package; they are not bodies.
      .filter(component => component.component.name !== 'Ground')
      .map(component => ({
        id: component.id,
        reference: component.reference,
        footprint: String(component.properties.footprint ?? component.component.name),
        category: typeof component.component.category === 'string' ? component.component.category : undefined,
        x: component.position.x,
        y: component.position.y,
        rotationDeg: component.rotation,
        side: 'top' as const,
      })),
  }), [traces, vias, components, layers, boardWidth, boardHeight])

  const pcbScene = useMemo<PcbScene | null>(() => {
    try {
      return buildPcbScene(pcbSceneLayout)
    } catch {
      return null
    }
  }, [pcbSceneLayout])

  // Adopt a layout that arrived from outside this panel (demo load, session
  // restore, another workspace). The publish guard below prevents the same
  // commit's stale local layout from immediately overwriting it.
  useEffect(() => {
    if (!storePcbLayout || storePcbLayout === lastPublishedLayout.current) return
    lastPublishedLayout.current = storePcbLayout
    // New work starts from this board's placement, not from the previous one.
    initialLayoutRef.current = storePcbLayout
    adoptingLayoutRef.current = true
    setBoardWidth(storePcbLayout.widthMm)
    setBoardHeight(storePcbLayout.heightMm)
    setTraces(panelTracesFromLayout(storePcbLayout))
    setVias(panelViasFromLayout(storePcbLayout))
    setPlacementOverrides({})
    setStaleRouting(false)
    setSelectedComponentId(null)
    setDrcViolations([])
    setDrcRan(false)
    setEmcResult(null)
    setEmcError(null)
    setSiResult(null)
    setSiEye(null)
    setSiWidthSuggestion(null)
    setSiBasis(null)
    setSiError(null)
    setThermalResult(null)
    setThermalMap(null)
    setThermalMapError(null)
    setThermalPowerNotice(null)
  }, [storePcbLayout])

  useEffect(() => {
    if (adoptingLayoutRef.current) {
      adoptingLayoutRef.current = false
      return
    }
    lastPublishedLayout.current = pcbSceneLayout
    setPcbLayout(pcbSceneLayout)
  }, [pcbSceneLayout, setPcbLayout])

  const handleDRC = useCallback(() => {
    const result = new DesignRuleChecker(boardDesign, PANEL_DRC_OVERRIDES).runDRC()
    setDrcViolations(result.violations.map((violation, index): DRCViolation => ({
      id: `${violation.type}_${violation.elementId}_${index}`,
      severity: violation.severity,
      rule: RULE_LABELS[violation.type],
      message: violation.type === 'unconnected_net'
        ? `Net "${violation.elementId}" has no copper trace`
        : violation.message,
      location: violation.location,
    })))
    setDrcRan(true)
    setActiveTab('drc')
  }, [boardDesign])

  // ── EMC analysis ──────────────────────────────────────────────────────────────

  const handleEMC = useCallback(() => {
    setAnalysisRunning(true)
    setEmcError(null)
    try {
      if (traces.length === 0) {
        throw new Error('Route at least one trace (Auto-Route from Schematic) before running EMC analysis.')
      }
      const emcTraces: EMCTrace[] = traces.map(t => {
        const length = polylineLength(t.points)
        return {
          id: t.id,
          lengthMm: length,
          currentA: emcCurrentA,
          frequencyHz: emcFrequencyHz,
          // Microstrip loop area is trace length × height above the return plane.
          loopAreaMm2: length * emcReturnSpacingMm,
          commonModeCurrentA: emcCableLengthMm > 0 ? emcCurrentA * 0.01 : 0,
          cableLengthMm: emcCableLengthMm,
        }
      })
      setEmcResult(emcSimulationEngine.simulate(emcTraces, 'CISPR32'))
    } catch (error) {
      setEmcResult(null)
      setEmcError(error instanceof Error ? error.message : String(error))
    } finally {
      setAnalysisRunning(false)
      setActiveTab('emc')
    }
  }, [traces, emcCurrentA, emcFrequencyHz, emcReturnSpacingMm, emcCableLengthMm])

  // ── Thermal analysis ─────────────────────────────────────────────────────────

  const handleThermal = useCallback(async () => {
    setAnalysisRunning(true)
    setThermalMapError(null)
    setThermalPowerNotice(null)

    /*
     * Dissipation has to come from the part. The schematic `power` property is
     * the only loss figure this app holds, and a hot-spot map built on invented
     * watts would put a peak wherever the reader happened to look. Parts that
     * declare nothing are excluded and counted, not defaulted.
     */
    const declared = components.reduce<Array<{ part: PlacedComponent; watts: number }>>((acc, part) => {
      const watts = Number(part.properties?.power)
      if (Number.isFinite(watts) && watts > 0) acc.push({ part, watts })
      return acc
    }, [])
    const withoutLoss = components.length - declared.length
    const sources = declared.slice(0, THERMAL_MAX_SOURCES)
    const capped = declared.length - sources.length

    if (sources.length === 0) {
      setThermalResult(null)
      setThermalMap(null)
      setThermalAccelerator(null)
      setThermalPowerNotice(components.length === 0
        ? 'The sheet has no components, so nothing here dissipates power.'
        : `None of the ${components.length} part(s) declares a dissipation. Set a numeric "power" property in watts on the parts that matter, then run this again.`)
      setAnalysisRunning(false)
      setActiveTab('thermal')
      return
    }

    const totalWatts = sources.reduce((sum, entry) => sum + entry.watts, 0)
    const nodes: ThermalNode[] = sources.map(({ part: source, watts }) => ({
      // Part id, not reference: the id stays unique when two parts share a label.
      id: source.id,
      // Board coordinates are millimetres; the lumped solver works in metres.
      position: { x: source.position.x / 1000, y: source.position.y / 1000, z: 0 },
      temperature: THERMAL_AMBIENT_C,
      powerDissipation: watts,
      material: 'FR4',
    }))

    const boundaries: ThermalBoundary[] = [{
      type: 'convection',
      temperature: THERMAL_AMBIENT_C,
      heatTransferCoefficient: THERMAL_CONVECTION_W_M2K,
      // The board's own top face, not a guessed area.
      area: (boardWidth * boardHeight) / 1e6,
    }]

    setThermalPowerNotice([
      `${sources.length} of ${declared.length} part(s) with declared loss solved (${totalWatts.toFixed(3)} W total)`,
      withoutLoss > 0 ? `${withoutLoss} part(s) carry no loss data and are not in the model` : null,
      capped > 0 ? `${capped} further part(s) exceed the ${THERMAL_MAX_SOURCES}-source grid cap and were left out` : null,
    ].filter(Boolean).join(' · ') + '.')

    try {
      const result = await thermalAnalysisEngine.analyzeThermal(nodes, boundaries, {
        ambientTemperature: THERMAL_AMBIENT_C,
        convectionCoefficient: THERMAL_CONVECTION_W_M2K,
        boardMaterial: 'FR4',
        copperThickness: THERMAL_COPPER_THICKNESS_MM,
        layerCount: thermalStackup.copperLayers,
        simulationTime: 300,
        timeStep: 1,
      })
      setThermalResult(result)

      /*
       * Placement heat map. The schematic sheet and the PCB are different
       * coordinate spaces, so the sources are normalised to the board outline
       * instead of being treated as millimetres. A 6 mm square per part is a
       * deliberate conservative spread for a package-mounted dissipator.
       */
      const xs = sources.map(({ part }) => part.position.x)
      const ys = sources.map(({ part }) => part.position.y)
      const minX = Math.min(...xs)
      const maxX = Math.max(...xs)
      const minY = Math.min(...ys)
      const maxY = Math.max(...ys)
      const margin = 8
      const heatSources: HeatSource[] = sources.map(({ part, watts }) => {
        // A row or column of parts at one sheet coordinate has no extent to
        // normalise against on that axis, so it maps to the board centre rather
        // than to an invented spread.
        const x = maxX > minX
          ? margin + ((part.position.x - minX) / (maxX - minX)) * (boardWidth - margin * 2)
          : boardWidth / 2
        const y = maxY > minY
          ? margin + ((part.position.y - minY) / (maxY - minY)) * (boardHeight - margin * 2)
          : boardHeight / 2
        return {
          id: part.reference || part.id,
          xMm: x,
          yMm: y,
          widthMm: 6,
          heightMm: 6,
          powerWatts: watts,
        }
      })

      const map = await acceleratedThermalDispatch(
        {
          boardWidthMm: boardWidth,
          boardHeightMm: boardHeight,
          boardThicknessMm: 1.6,
          gridResolutionMm: 1,
          effectiveConductivityWmk: thermalStackup.inPlaneConductivityWmk,
          convectionCoeffWperM2K: THERMAL_CONVECTION_W_M2K,
          ambientTempC: THERMAL_AMBIENT_C,
          heatSources,
        },
        { maxIterations: 6000 },
      )
      setThermalMap(map.result)
      setThermalAccelerator({ path: map.accelerator, durationMs: map.durationMs })
    } catch (error) {
      setThermalMap(null)
      setThermalAccelerator(null)
      setThermalMapError(error instanceof Error ? error.message : String(error))
    } finally {
      setAnalysisRunning(false)
      setActiveTab('thermal')
    }
  }, [components, thermalStackup, boardWidth, boardHeight])

  // ── Signal integrity ──────────────────────────────────────────────────────────

  const handleSignalIntegrity = useCallback(() => {
    setAnalysisRunning(true)
    const refTrace = traces[0]
    if (!refTrace) {
      setSiResult(null)
      setSiEye(null)
      setSiWidthSuggestion(null)
      setSiBasis(null)
      setSiError('Route at least one trace before running signal integrity — the analysis needs a real trace length and width.')
      setAnalysisRunning(false)
      setActiveTab('si')
      return
    }
    setSiError(null)
    const lengthMm = polylineLength(refTrace.points)
    const path = {
      geometry: {
        kind: 'microstrip' as const,
        widthMm: refTrace.width,
        heightMm: siHeightMm,
        epsilonR: siEpsilonR,
        copperThicknessMm: siCopperThicknessMm,
      },
      lengthMm,
      driverImpedanceOhm: siDriverOhm,
      loadImpedanceOhm: siLoadOhm,
      vHigh: siVHigh,
    }
    const result = analyzeSignalPath(path)
    setSiResult(result)
    setSiEye(result.success
      ? analyzeEyeDiagram(path, { dataRateMbps: siDataRateMbps, riseTimeNs: siRiseTimeNs })
      : null)
    setSiWidthSuggestion(result.success ? optimiseTraceWidth(path, 50) : null)
    setSiBasis({ traceId: refTrace.id, netName: refTrace.netName, lengthMm, widthMm: refTrace.width })
    setAnalysisRunning(false)
    setActiveTab('si')
  }, [
    traces, siHeightMm, siEpsilonR, siCopperThicknessMm, siDriverOhm, siLoadOhm, siVHigh,
    siDataRateMbps, siRiseTimeNs,
  ])

  // ── Gerber export ─────────────────────────────────────────────────────────────

  const handleExportGerber = useCallback(() => {
    const gerber = exportToGerber(components, wires)
    downloadFile(gerber, `pcb_top_copper_${Date.now()}.gbr`, 'text/plain')
  }, [components, wires])

  const [fabVerdict, setFabVerdict] = useState<string | null>(null)

  const handleExportFab = useCallback(() => {
    // The package must describe the copper on screen, not the schematic
    // ratlines: routed traces are the real two-layer geometry the fab prints,
    // so each segment keeps the face it was drawn or routed on.
    const pkg = buildFabPackage(components, fabCopperFromRoutedTraces(traces), {
      projectName: 'folio-pcb',
      boardWidth,
      boardHeight,
      vias: vias.map((via) => ({
        x: via.position.x,
        y: via.position.y,
        drillDiameter: via.drillDiameter,
        padDiameter: via.padDiameter,
        netName: via.netName,
      })),
    })
    if (!pkg.shippable) {
      setFabVerdict(`${pkg.violations.length} fab violation(s): ${pkg.violations[0]?.message ?? 'blocked'}`)
      return
    }
    setFabVerdict(`Fab package: ${pkg.files.size} files, ${pkg.centroid.length} placements — shippable.`)
    for (const [name, content] of pkg.files) downloadFile(content, name, 'text/plain')
  }, [components, traces, vias, boardWidth, boardHeight])

  // ── Layer toggle ──────────────────────────────────────────────────────────────

  const toggleLayerVisibility = useCallback((layerId: string) => {
    setLayers(prev => prev.map(l => l.id === layerId ? { ...l, visible: !l.visible } : l))
  }, [])

  // ── DRC summary ───────────────────────────────────────────────────────────────
  const drcErrors = useMemo(() => drcViolations.filter(v => v.severity === 'error').length, [drcViolations])
  const drcWarnings = useMemo(() => drcViolations.filter(v => v.severity === 'warning').length, [drcViolations])

  /**
   * What the last DRC run was actually given. The adapter only hands the checker
   * copper, so every pad and courtyard rule runs against an empty list. Naming
   * the geometry in scope keeps a clean verdict meaning "no copper rule broken"
   * instead of implying a board that is ready to fab.
   */
  const drcScope = useMemo(() => {
    const traceCount = boardDesign.traces.length
    const viaCount = boardDesign.vias.length
    const skipped: string[] = []
    if (boardDesign.pads.length === 0) {
      skipped.push('pad size, drill and annular ring, and pad-to-trace, pad-to-pad and pad-to-via clearance')
      skipped.push('net continuity beyond copper presence, since the split-island test needs two or more pads on a net')
    }
    if (boardDesign.components.length === 0) skipped.push('courtyard overlap between footprints')
    return {
      checked: `${traceCount} trace${traceCount === 1 ? '' : 's'} and ${viaCount} via${viaCount === 1 ? '' : 'es'}`,
      skipped,
    }
  }, [boardDesign])

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background">
      <div className="flex h-full w-full flex-col overflow-hidden bg-card">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card/80">
          <h3 className="font-semibold">PCB Design</h3>
          <div className="flex items-center gap-2">
            {drcRan && (
              <div className="flex items-center gap-1 text-xs">
                {drcErrors > 0 && <Badge variant="destructive">{drcErrors} error{drcErrors !== 1 ? 's' : ''}</Badge>}
                {drcWarnings > 0 && <Badge variant="secondary">{drcWarnings} warning{drcWarnings !== 1 ? 's' : ''}</Badge>}
                {drcErrors === 0 && drcWarnings === 0 && (
                  <Badge
                    className="bg-success text-success-foreground"
                    title={`Copper-only scope: ${drcScope.checked}. Not checked: ${drcScope.skipped.join('; ')}.`}
                  >
                    DRC clean on {drcScope.checked}
                  </Badge>
                )}
              </div>
            )}
            {onPreview3D && (
              <Button variant="outline" size="sm" className="gap-1" onClick={onPreview3D}>
                <Box className="w-4 h-4" />
                Preview 3D
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close PCB panel"><X className="w-4 h-4" /></Button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="flex min-h-0 flex-1">
          {/* Left: Tool palette */}
          <div className="flex flex-col gap-2 p-2 border-r border-border bg-card/50">
            {[
              { tool: 'select' as const, icon: MousePointer },
              { tool: 'route' as const, icon: Route },
              { tool: 'via' as const, icon: Zap },
              { tool: 'move' as const, icon: Move },
            ].map(({ tool, icon: Icon }) => (
              <Button key={tool} variant={activeTool === tool ? 'default' : 'outline'} size="icon" className="h-8 w-8" onClick={() => setActiveTool(tool)} title={tool} aria-label={tool}>
                <Icon className="w-3.5 h-3.5" />
              </Button>
            ))}
          </div>

          {/* Centre: Canvas + tabs */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 min-h-0">
              <TabsList className="mx-2 mt-2 grid grid-cols-7 text-xs h-7">
                <TabsTrigger value="canvas" className="text-xs">Canvas</TabsTrigger>
                <TabsTrigger value="drc" className="text-xs">DRC</TabsTrigger>
                <TabsTrigger value="emc" className="text-xs">EMC</TabsTrigger>
                <TabsTrigger value="thermal" className="text-xs">Thermal</TabsTrigger>
                <TabsTrigger value="si" className="text-xs">Signal</TabsTrigger>
                <TabsTrigger value="advanced" className="text-xs">Advanced</TabsTrigger>
                <TabsTrigger value="assembly" className="text-xs">Assembly</TabsTrigger>
              </TabsList>

              <TabsContent value="canvas" className="flex-1 p-2 min-h-0 flex flex-col gap-2">
                <div className="flex flex-wrap items-end gap-3 px-1">
                  <div>
                    <label htmlFor="board-width" className="text-xs font-medium mb-1 block">Board width (mm)</label>
                    <input
                      id="board-width"
                      type="number"
                      min="10"
                      max="500"
                      step="1"
                      value={boardWidth}
                      onChange={(event) => {
                        const next = Number(event.target.value)
                        if (Number.isFinite(next) && next >= 10 && next <= 500) setBoardWidth(next)
                      }}
                      className="w-24 rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground"
                    />
                  </div>
                  <div>
                    <label htmlFor="board-height" className="text-xs font-medium mb-1 block">Board height (mm)</label>
                    <input
                      id="board-height"
                      type="number"
                      min="10"
                      max="500"
                      step="1"
                      value={boardHeight}
                      onChange={(event) => {
                        const next = Number(event.target.value)
                        if (Number.isFinite(next) && next >= 10 && next <= 500) setBoardHeight(next)
                      }}
                      className="w-24 rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground pb-1">
                    Outline {boardWidth} × {boardHeight} mm · 1.6 mm FR-4 · 1 oz copper
                  </p>
                </div>
                <p className="px-1 text-xs text-muted-foreground">
                  {activeTool === 'select' && 'Click a part to select it. Drag empty board to pan; wheel to zoom.'}
                  {activeTool === 'move' && 'Drag a part to reposition it on the 0.5 mm grid. Copper is not re-routed automatically.'}
                  {activeTool === 'route' && 'Click to lay copper on the selected layer. Snaps to pads and the 0.5 mm grid. Double-click, Enter or Finish ends the trace; right-click cancels.'}
                  {activeTool === 'via' && 'Click to drop a 0.6 mm via with a 0.3 mm drill.'}
                </p>
                {staleRouting ? (
                  <div role="status" className="mx-1 flex items-start gap-2 rounded border border-warning/40 bg-warning/10 px-2 py-1 text-xs text-warning">
                    <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" />
                    Parts moved after routing — existing copper no longer matches every pad. Re-route before running DRC or exporting.
                  </div>
                ) : null}
                <div className="flex-1 min-h-0">
                  <PCBCanvas
                    traces={traces}
                    vias={vias}
                    boardWidth={boardWidth}
                    boardHeight={boardHeight}
                    selectedLayerId={selectedLayerId}
                    layers={layers}
                    scene={pcbScene}
                    activeTool={activeTool}
                    selectedComponentId={selectedComponentId}
                    routerPads={routerPads}
                    onSelectComponent={setSelectedComponentId}
                    onMoveComponent={handleMoveComponent}
                    onAddTrace={handleAddTrace}
                    onAddVia={handleAddVia}
                  />
                </div>
              </TabsContent>

              <TabsContent value="drc" className="flex-1 overflow-y-auto p-3 space-y-2">
                <div className="text-sm font-medium">Design Rule Check — {drcViolations.length} issue{drcViolations.length !== 1 ? 's' : ''}</div>
                {!drcRan && <p className="text-muted-foreground text-sm">Click "Run DRC" to check your design.</p>}
                <div className="space-y-1 rounded border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
                  <p>
                    Checked: {drcScope.checked} — trace width and same-layer clearance, via size, annular ring,
                    via-to-trace clearance, acute corners, and whether each net has any copper at all.
                    Trace-length rules are off for this board.
                  </p>
                  {drcScope.skipped.length > 0 && (
                    <p>Not checked: {drcScope.skipped.join('; ')}. The board model carries schematic placement, not footprints.</p>
                  )}
                </div>
                {drcViolations.map(v => (
                  <div key={v.id} className={`flex items-start gap-2 p-2 rounded text-xs border ${v.severity === 'error' ? 'bg-destructive/10 border-destructive/40 text-destructive' : 'bg-warning/10 border-warning/40 text-warning'}`}>
                    <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                    <div><span className="font-medium">[{v.rule}]</span> {v.message}</div>
                  </div>
                ))}
                {drcRan && drcViolations.length === 0 && (
                  <div className="flex items-center gap-2 p-2 rounded text-xs bg-success/10 border border-success/40 text-success">
                    <CheckCircle className="w-3 h-3" /> No copper rule broken in the scope above.
                  </div>
                )}
              </TabsContent>

              <TabsContent value="emc" className="flex-1 overflow-y-auto p-3 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label htmlFor="emc-current" className="text-xs font-medium mb-1 block">Trace current (A)</label>
                    <input
                      id="emc-current"
                      type="number"
                      min="0"
                      step="0.01"
                      value={emcCurrentA}
                      onChange={(event) => setEmcCurrentA(Number(event.target.value))}
                      className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground"
                    />
                  </div>
                  <div>
                    <label htmlFor="emc-frequency" className="text-xs font-medium mb-1 block">Highest frequency (Hz)</label>
                    <input
                      id="emc-frequency"
                      type="number"
                      min="0"
                      step="1000000"
                      value={emcFrequencyHz}
                      onChange={(event) => setEmcFrequencyHz(Number(event.target.value))}
                      className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground"
                    />
                  </div>
                  <div>
                    <label htmlFor="emc-spacing" className="text-xs font-medium mb-1 block">Return-path spacing (mm)</label>
                    <input
                      id="emc-spacing"
                      type="number"
                      min="0"
                      step="0.05"
                      value={emcReturnSpacingMm}
                      onChange={(event) => setEmcReturnSpacingMm(Number(event.target.value))}
                      className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground"
                    />
                  </div>
                  <div>
                    <label htmlFor="emc-cable" className="text-xs font-medium mb-1 block">Attached cable (mm)</label>
                    <input
                      id="emc-cable"
                      type="number"
                      min="0"
                      step="10"
                      value={emcCableLengthMm}
                      onChange={(event) => setEmcCableLengthMm(Number(event.target.value))}
                      className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground"
                    />
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Closed-form dipole estimate at 3 m from your declared current, frequency, loop and cable.
                  Not a chamber measurement or a full-wave simulation.
                </p>
                {emcError && (
                  <p role="alert" className="text-xs text-destructive">{emcError}</p>
                )}
                {emcResult ? (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { label: 'Radiated Emission', value: `${emcResult.radiatedDBuVPerM} dBµV/m`, ok: emcResult.compliant },
                        {
                          label: 'Conducted Emission',
                          value: emcResult.basis.worstCommonModeCurrentA > 0
                            ? `${emcResult.conductedDBuV} dBµV`
                            : 'No cable modelled',
                          ok: true,
                        },
                        { label: 'Radiated limit / margin', value: `${emcResult.limitDBuV} / ${emcResult.marginDb} dB`, ok: emcResult.marginDb >= 6 },
                      ].map(m => (
                        <Card key={m.label}>
                          <CardContent className="p-3">
                            <div className={`text-lg font-bold ${m.ok ? 'text-success' : 'text-destructive'}`}>{m.value}</div>
                            <div className="text-xs text-muted-foreground">{m.label}</div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                    <div className={`p-2 rounded text-xs font-medium ${emcResult.compliant ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}`}>
                      {emcResult.compliant
                        ? 'Estimated below the CISPR 32 Class B radiated limit'
                        : 'Estimated above the CISPR 32 Class B radiated limit'}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Basis: {emcResult.basis.traceCount} trace(s), {(emcResult.basis.worstFrequencyHz / 1e6).toFixed(2)} MHz,
                      {' '}{emcResult.basis.worstCurrentA} A signal current.
                    </p>
                    {emcResult.recommendations.map((r, i) => (
                      <div key={i} className="text-xs text-warning flex gap-1"><span>→</span>{r}</div>
                    ))}
                  </>
                ) : !emcError && (
                  <p className="text-muted-foreground text-sm">Click "Run EMC" to analyse electromagnetic compliance.</p>
                )}
              </TabsContent>

              <TabsContent value="thermal" className="flex-1 overflow-y-auto p-3 space-y-3">
                {thermalPowerNotice && (
                  <div className="rounded border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
                    {thermalPowerNotice}
                  </div>
                )}
                {thermalResult ? (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <Card><CardContent className="p-3">
                        <div className="text-lg font-bold text-warning">{thermalResult.maxTemperature.toFixed(1)} °C</div>
                        <div className="text-xs text-muted-foreground">Max temperature</div>
                      </CardContent></Card>
                      <Card><CardContent className="p-3">
                        <div className="text-lg font-bold text-info">{thermalResult.hotspots.length}</div>
                        <div className="text-xs text-muted-foreground">Hotspots</div>
                      </CardContent></Card>
                    </div>
                    <div className={`text-xs ${thermalResult.converged ? 'text-success' : 'text-warning'}`}>
                      {thermalResult.converged
                        ? `Settled after ${(thermalResult.timeToSteadyState ?? thermalResult.simulatedTime).toFixed(0)} s of simulated time.`
                        : `Still transient after ${thermalResult.simulatedTime.toFixed(0)} s — increase simulation time or cooling.`}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Model: {THERMAL_AMBIENT_C} °C ambient, {THERMAL_CONVECTION_W_M2K} W/m²·K natural convection over{' '}
                      {boardWidth} × {boardHeight} mm of 1.6 mm FR-4 with {thermalStackup.copperLayers} copper layer(s).
                      The parts link through FR-4 in the lumped solve; the heat map spreads laterally through an
                      in-plane laminate conductivity of {thermalStackup.inPlaneConductivityWmk.toFixed(1)} W/m·K derived
                      from {(THERMAL_COPPER_THICKNESS_MM * 1000).toFixed(0)} µm copper per layer. Heat-map positions come
                      from normalised sheet placement, so they show relative hot spots, not footprint coordinates.
                    </p>
                    {thermalAccelerator && (
                      <div className="text-xs text-muted-foreground">
                        Grid solved on {thermalAccelerator.path} in {thermalAccelerator.durationMs.toFixed(0)} ms.
                      </div>
                    )}
                    {thermalMap && <ThermalHeatmap result={thermalMap} ambientC={THERMAL_AMBIENT_C} />}
                    {thermalMapError && (
                      <div className="rounded border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
                        Heat map unavailable: {thermalMapError}
                      </div>
                    )}
                    {thermalResult.hotspots.map(h => (
                      <div key={h.nodeId} className={`text-xs p-2 rounded border ${h.severity === 'critical' ? 'bg-destructive/10 border-destructive text-destructive' : h.severity === 'high' ? 'bg-warning/10 border-warning text-warning' : 'bg-warning/10 border-warning text-warning'}`}>
                        <Thermometer className="w-3 h-3 inline mr-1" />
                        {h.nodeId}: {h.temperature.toFixed(1)} °C — {h.severity}
                      </div>
                    ))}
                    {thermalResult.recommendations.map((r, i) => (
                      <div key={i} className="text-xs text-muted-foreground flex gap-1"><span>→</span>{r}</div>
                    ))}
                  </>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    {thermalPowerNotice
                      ? 'No result: thermal analysis needs a declared dissipation per part, and the panel does not invent one.'
                      : 'Click "Run Thermal" to simulate heat distribution.'}
                  </p>
                )}
              </TabsContent>

              <TabsContent value="si" className="flex-1 overflow-y-auto p-3 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label htmlFor="si-height" className="text-xs font-medium mb-1 block">Dielectric height (mm)</label>
                    <input
                      id="si-height"
                      type="number"
                      min="0"
                      step="0.01"
                      value={siHeightMm}
                      onChange={(event) => setSiHeightMm(Number(event.target.value))}
                      className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground"
                    />
                  </div>
                  <div>
                    <label htmlFor="si-er" className="text-xs font-medium mb-1 block">Dielectric constant εr</label>
                    <input
                      id="si-er"
                      type="number"
                      min="0"
                      step="0.1"
                      value={siEpsilonR}
                      onChange={(event) => setSiEpsilonR(Number(event.target.value))}
                      className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground"
                    />
                  </div>
                  <div>
                    <label htmlFor="si-copper" className="text-xs font-medium mb-1 block">Copper thickness (mm)</label>
                    <input
                      id="si-copper"
                      type="number"
                      min="0"
                      step="0.005"
                      value={siCopperThicknessMm}
                      onChange={(event) => setSiCopperThicknessMm(Number(event.target.value))}
                      className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground"
                    />
                  </div>
                  <div>
                    <label htmlFor="si-driver" className="text-xs font-medium mb-1 block">Driver impedance (Ω)</label>
                    <input
                      id="si-driver"
                      type="number"
                      min="0"
                      step="1"
                      value={siDriverOhm}
                      onChange={(event) => setSiDriverOhm(Number(event.target.value))}
                      className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground"
                    />
                  </div>
                  <div>
                    <label htmlFor="si-load" className="text-xs font-medium mb-1 block">Load impedance (Ω)</label>
                    <input
                      id="si-load"
                      type="number"
                      min="0"
                      step="1000"
                      value={siLoadOhm}
                      onChange={(event) => setSiLoadOhm(Number(event.target.value))}
                      className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground"
                    />
                  </div>
                  <div>
                    <label htmlFor="si-vhigh" className="text-xs font-medium mb-1 block">Logic-high level (V)</label>
                    <input
                      id="si-vhigh"
                      type="number"
                      min="0"
                      step="0.1"
                      value={siVHigh}
                      onChange={(event) => setSiVHigh(Number(event.target.value))}
                      className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground"
                    />
                  </div>
                  <div>
                    <label htmlFor="si-datarate" className="text-xs font-medium mb-1 block">Data rate (Mbps)</label>
                    <input
                      id="si-datarate"
                      type="number"
                      min="0"
                      step="10"
                      value={siDataRateMbps}
                      onChange={(event) => setSiDataRateMbps(Number(event.target.value))}
                      className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground"
                    />
                  </div>
                  <div>
                    <label htmlFor="si-risetime" className="text-xs font-medium mb-1 block">Edge 10–90% (ns)</label>
                    <input
                      id="si-risetime"
                      type="number"
                      min="0"
                      step="0.05"
                      value={siRiseTimeNs}
                      onChange={(event) => setSiRiseTimeNs(Number(event.target.value))}
                      className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground"
                    />
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Trace length and width come from the first routed trace. Stackup, driver, receiver, data-rate and
                  edge values are declared assumptions. The result is a closed-form microstrip reflection lattice plus
                  a PRBS-7 eye computed from the same lattice — one line, no crosstalk, jitter, IBIS transient, or field
                  solve.
                </p>
                {siError && <p role="alert" className="text-xs text-destructive">{siError}</p>}
                {siResult ? (
                  siResult.success ? (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        {[
                          { label: 'Z₀', value: `${siResult.z0Ohm.toFixed(1)} Ω`, ok: Math.abs(siResult.z0Ohm - 50) < 5 },
                          { label: 'Prop. Delay', value: `${siResult.delayNs.toFixed(2)} ns`, ok: true },
                          { label: 'Overshoot', value: `${siResult.overshootVolts.toFixed(2)} V`, ok: siResult.overshootVolts < siVHigh * 0.2 },
                          { label: 'Γ load', value: siResult.gammaLoad.toFixed(2), ok: Math.abs(siResult.gammaLoad) < 0.2 },
                        ].map(m => (
                          <Card key={m.label}><CardContent className="p-3">
                            <div className={`text-lg font-bold ${m.ok ? 'text-success' : 'text-warning'}`}>{m.value}</div>
                            <div className="text-xs text-muted-foreground">{m.label}</div>
                          </CardContent></Card>
                        ))}
                      </div>
                      {siBasis && (
                        <p className="text-[11px] text-muted-foreground">
                          Trace {siBasis.traceId}{siBasis.netName ? ` (${siBasis.netName})` : ''}: {siBasis.lengthMm.toFixed(2)} mm
                          {' '}× {siBasis.widthMm.toFixed(3)} mm over {siHeightMm} mm dielectric (εr {siEpsilonR}).
                        </p>
                      )}
                      <div className="text-xs text-muted-foreground">
                        Settles at {siResult.settledVolts.toFixed(2)} V, peaks at {siResult.peakVolts.toFixed(2)} V
                        (driver {siDriverOhm} Ω → line {siResult.z0Ohm.toFixed(0)} Ω → load {siLoadOhm.toExponential(0)} Ω).
                      </div>
                      {siWidthSuggestion && (
                        <div className={`text-xs ${siWidthSuggestion.achieved ? 'text-muted-foreground' : 'text-warning'}`}>
                          {siWidthSuggestion.note}
                        </div>
                      )}
                      {siEye && (
                        siEye.success ? (
                          <EyePlot eye={siEye} vHigh={siVHigh} />
                        ) : (
                          <p className="text-xs text-warning">
                            Eye diagram unavailable: {siEye.error}
                          </p>
                        )
                      )}
                    </>
                  ) : (
                    <p className="text-warning text-sm">Signal integrity could not be computed: {siResult.error}</p>
                  )
                ) : !siError && (
                  <p className="text-muted-foreground text-sm">Click "Run SI" to analyse signal integrity on traces.</p>
                )}
              </TabsContent>

              <TabsContent value="advanced" className="flex-1 overflow-y-auto p-3 space-y-3">
                <Card>
                  <CardHeader className="pb-2 pt-3 px-3">
                    <CardTitle className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1"><Layers className="w-3 h-3" /> Stackup &amp; controlled impedance</span>
                      <span className="font-normal text-muted-foreground">{stackupAnalysis.stackup.totalThickness.toFixed(2)} mm</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1 px-3 pb-3 text-xs">
                    {stackupAnalysis.layers.map((layer, index) => (
                      <div key={`${layer.name}-${index}`} className="flex justify-between">
                        <span className="capitalize">{layer.name} <span className="text-muted-foreground">{layer.kind}</span></span>
                        <span className="text-muted-foreground">
                          {layer.kind === 'dielectric'
                            ? `${layer.thickness} mm · εr ${layer.er}`
                            : `${layer.thickness ?? 1} oz${layer.net ? ` · ${layer.net}` : ''}`}
                        </span>
                      </div>
                    ))}
                    <div className={`pt-1 ${stackupAnalysis.violations.length === 0 ? 'text-success' : 'text-destructive'}`}>
                      {stackupAnalysis.violations.length === 0
                        ? 'Symmetric stackup, thickness within 0.2–4 mm.'
                        : stackupAnalysis.violations.map((violation) => violation.message).join(' ')}
                    </div>
                    {stackupAnalysis.reference && (
                      <div className="border-t border-border pt-1 text-muted-foreground">
                        Top 0.2 mm microstrip over {stackupAnalysis.layers[stackupAnalysis.reference.planeIndex].name}
                        {' '}at {stackupAnalysis.reference.distance} mm: {stackupAnalysis.z0.toFixed(1)} Ω.
                        {stackupAnalysis.widthFor50 !== undefined
                          ? ` ${stackupAnalysis.widthFor50.toFixed(3)} mm gives 50 Ω.`
                          : ' 50 Ω unreachable with this dielectric.'}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2 pt-3 px-3">
                    <CardTitle className="flex items-center gap-1 text-xs"><Zap className="w-3 h-3" /> Power integrity — {boardWidth} × {boardHeight} mm</CardTitle>
                  </CardHeader>
                  <CardContent className="grid grid-cols-3 gap-2 px-3 pb-3">
                    {[
                      { label: 'Plane pair loop L', value: `${powerIntegrity.loopInductanceNh.toFixed(3)} nH` },
                      { label: '1 oz pour R', value: `${powerIntegrity.pourResistanceMohm.toFixed(2)} mΩ` },
                      { label: 'Stitching vias', value: `${powerIntegrity.stitchingVias} @ 10 mm` },
                    ].map((metric) => (
                      <div key={metric.label} className="rounded border border-border p-2">
                        <div className="text-sm font-semibold">{metric.value}</div>
                        <div className="text-[11px] text-muted-foreground">{metric.label}</div>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2 pt-3 px-3">
                    <CardTitle className="flex items-center gap-1 text-xs"><Cpu className="w-3 h-3" /> {SOC_256.partNumber} — {SOC_256.rows}×{SOC_256.cols} @ {SOC_256.pitch} mm</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1 px-3 pb-3 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Ball map</span>
                      <span>{SOC_256.balls.length} balls, {SOC_256.padDiameter} mm pads</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Power rails</span>
                      <span>{bgaAnalysis.rails.map((rail) => `${rail.rail} ×${rail.count}`).join(', ')}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Dog-bone fanout</span>
                      <span>{bgaAnalysis.fanout.vias.length} vias, planes: {bgaAnalysis.fanout.planeNets.join(' / ')}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">DDR byte lanes</span>
                      <span>{bgaAnalysis.ddrGroups.map((group) => `${group.group} ×${group.count}`).join(', ')}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Escape capacity</span>
                      <span>{bgaAnalysis.escapeTracks} track(s)/channel, 0.1/0.1 mm</span>
                    </div>
                    {bgaAnalysis.fanout.violations.length > 0 && (
                      <div className="text-destructive">{bgaAnalysis.fanout.violations.join(' ')}</div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2 pt-3 px-3">
                    <CardTitle className="flex items-center gap-1 text-xs">
                      <Zap className="w-3 h-3" /> DDR routing — DQ ±{DDR3_1600.dqWindowMm} mm · ADDR ±{DDR3_1600.flybyWindowMm} mm
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 px-3 pb-3 text-xs">
                    {ddrRouting.lanes.length === 0 && !ddrRouting.flyby ? (
                      <p className="text-muted-foreground">
                        No DDR nets on the routed copper. Strobe nets named DQS0… and data nets DQ0… are
                        checked automatically; CLOCK/ADDR nets feed the fly-by check.
                      </p>
                    ) : (
                      <>
                        {ddrRouting.lanes.map((lane) => (
                          <div key={lane.lane} className="rounded border border-border p-2 space-y-1">
                            <div className="flex justify-between font-medium">
                              <span>{lane.strobeNet} (lane {lane.lane})</span>
                              <span className={lane.violations.length > 0 ? 'text-destructive' : 'text-success'}>
                                {lane.violations.length > 0
                                  ? `${lane.violations.length} outside window`
                                  : 'in window'}
                              </span>
                            </div>
                            <div className="text-muted-foreground">
                              {lane.bits.length} DQ bit{lane.bits.length === 1 ? '' : 's'} · strobe{' '}
                              {lane.strobeLengthMm.toFixed(2)} mm · worst {lane.worstMismatchMm.toFixed(3)} mm
                              {' '}({(lane.worstMismatchMm * 6).toFixed(1)} ps)
                            </div>
                            {lane.violations.map((violation) => (
                              <div key={violation.bit} className="text-warning">{violation.message}</div>
                            ))}
                          </div>
                        ))}
                        {ddrRouting.flyby && (
                          <div className="rounded border border-border p-2 space-y-1">
                            <div className="flex justify-between font-medium">
                              <span>Fly-by · {ddrRouting.flyby.clockNet}</span>
                              <span className={ddrRouting.flyby.violations.length > 0 ? 'text-destructive' : 'text-success'}>
                                {ddrRouting.flyby.violations.length > 0
                                  ? `${ddrRouting.flyby.violations.length} ADDR outside window`
                                  : 'ADDR in window'}
                              </span>
                            </div>
                            <div className="text-muted-foreground">
                              Clock {ddrRouting.flyby.clockLengthMm.toFixed(2)} mm ·{' '}
                              {ddrRouting.flyby.addresses.length} address net
                              {ddrRouting.flyby.addresses.length === 1 ? '' : 's'}
                            </div>
                            {ddrRouting.flyby.violations.map((message) => (
                              <div key={message} className="text-warning">{message}</div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                    <p className="text-[11px] text-muted-foreground">
                      Lengths are the routed copper totals. Byte lanes follow the x8 naming
                      (DQ0–7 ↔ DQS0, DQ8–15 ↔ DQS1); nets outside that convention are not guessed.
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2 pt-3 px-3">
                    <CardTitle className="flex items-center gap-1 text-xs">
                      <Layers className="w-3 h-3" /> HDI microvia discipline
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 px-3 pb-3 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Laser drill / pad</span>
                      <span>Ø{hdiStackup.microviaDrillMm} / Ø{hdiStackup.microviaPadMm} mm</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Min annular ring</span>
                      <span>{STD_HDI_RULES.minAnnularRingMm} mm</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-[11px] text-muted-foreground">
                        From layer
                        <select
                          aria-label="Microvia start layer"
                          value={hdiFrom}
                          onChange={(event) => setHdiFrom(event.target.value)}
                          className="mt-0.5 w-full rounded border border-input bg-background px-1.5 py-1 text-xs text-foreground"
                        >
                          {hdiStackup.layers.map((layer) => (
                            <option key={layer.id} value={layer.id}>{layer.id}</option>
                          ))}
                        </select>
                      </label>
                      <label className="text-[11px] text-muted-foreground">
                        To layer
                        <select
                          aria-label="Microvia end layer"
                          value={hdiTo}
                          onChange={(event) => setHdiTo(event.target.value)}
                          className="mt-0.5 w-full rounded border border-input bg-background px-1.5 py-1 text-xs text-foreground"
                        >
                          {hdiStackup.layers.map((layer) => (
                            <option key={layer.id} value={layer.id}>{layer.id}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleValidateHdiSpan}>
                      Validate via span
                    </Button>
                    {hdiVerdict && (
                      <p
                        role="status"
                        className={hdiVerdict.ok ? 'text-success' : 'text-destructive'}
                      >
                        {hdiVerdict.message}
                      </p>
                    )}
                    <p className="text-[11px] text-muted-foreground">
                      A laser microvia may step one copper layer in this model; deeper transitions
                      need a buried or plated-through via. Span rule: ≤ {hdiStackup.microviaSpan} layer step.
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2 pt-3 px-3">
                    <CardTitle className="flex items-center gap-1 text-xs">
                      <GitCompare className="w-3 h-3" /> Differential pairs — measured off the copper
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 px-3 pb-3 text-xs">
                    <div className="flex items-end gap-2">
                      <div className="w-32">
                        <label htmlFor="pair-group-window" className="text-[11px] font-medium mb-1 block">
                          Group window (mm)
                        </label>
                        <input
                          id="pair-group-window"
                          type="number"
                          min="0"
                          step="0.05"
                          value={pairGroupWindowMm}
                          onChange={(event) => setPairGroupWindowMm(Number(event.target.value))}
                          className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground"
                        />
                      </div>
                      <p className="text-[11px] text-muted-foreground flex-1">
                        Budget: {USB2_HS.skewBudgetPs} ps intra-pair, {diffPairs.groupWindowMm} mm group spread over{' '}
                        {diffPairs.groupChecked} checked pair(s).
                      </p>
                    </div>
                    {diffPairs.pairs.length === 0 ? (
                      <p className="text-muted-foreground">
                        No routed pairs yet. Net names ending in _P/_N or +/- appear here after auto-routing.
                      </p>
                    ) : diffPairs.pairs.map((pair) => (
                      <div key={pair.stem} className="rounded border border-border p-2 space-y-1">
                        <div className="flex justify-between font-medium">
                          <span>{pair.netP} / {pair.netN}</span>
                          {pair.checked ? (
                            <span
                              className={pair.violations.length === 0 ? 'text-success' : 'text-destructive'}
                              title={pair.erEff !== null
                                ? `ε_eff ${pair.erEff.toFixed(3)} from ${pair.width.toFixed(3)} mm over the stackup reference`
                                : 'no reference plane declared'}
                            >
                              {pair.checked.skewPs.toFixed(1)} ps
                            </span>
                          ) : (
                            <span className="text-warning" title="Skew in ps needs the dielectric and the coupled geometry; this pair has neither yet">
                              not checked
                            </span>
                          )}
                        </div>
                        <div className="text-muted-foreground">
                          P {pair.lengthP.toFixed(2)} mm · N {pair.lengthN.toFixed(2)} mm ·{' '}
                          {pair.skewMm.toFixed(2)} mm mismatch
                        </div>
                        <div className="text-muted-foreground">
                          {pair.coupling
                            ? <>Gap {pair.coupling.minGapMm.toFixed(3)} mm · parallel{' '}
                              {(100 * pair.coupling.parallelRatio).toFixed(0)} % of the longer leg
                              {' '}(coupled while ≤ one trace width, {pair.width.toFixed(3)} mm)</>
                            : 'No measurable copper on both nets yet — gap and coupling not assessed.'}
                        </div>
                        {pair.violations.map((violation) => (
                          <div key={violation.rule + violation.message} className="text-destructive">
                            {violation.message}
                          </div>
                        ))}
                        {pair.skewMm > 0 && (
                          <div className="text-warning">
                            {pair.meander.total.toFixed(2)} mm of meander
                            ({pair.meander.lobes} lobe{pair.meander.lobes === 1 ? '' : 's'} ×{' '}
                            {pair.meander.amplitude} mm over {pair.meander.runMm.toFixed(2)} mm of run,{' '}
                            {pair.meander.keepoutMm} mm keep-out) on the shorter leg.
                          </div>
                        )}
                      </div>
                    ))}
                    <p className="text-[11px] text-muted-foreground">
                      Skew converts to time through the effective permittivity of each pair&apos;s own trace width
                      over the declared reference plane; impedance targets are not solved from the routed geometry.
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2 pt-3 px-3">
                    <CardTitle className="text-xs">IBIS buffer models</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 px-3 pb-3 text-xs">
                    <label className="flex h-7 w-full cursor-pointer items-center justify-center gap-1 rounded-md border border-input bg-background hover:bg-accent">
                      <Upload className="w-3 h-3" /> Load .ibs file
                      <input type="file" accept=".ibs,.txt" className="hidden" onChange={handleIbisFile} aria-label="Import IBIS file" />
                    </label>
                    {ibisError && <div className="text-destructive">{ibisError}</div>}
                    {ibisFile && (
                      <div className="space-y-1">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Version</span>
                          <span>{ibisFile.version}{ibisFile.fileName ? ` · ${ibisFile.fileName}` : ''}</span>
                        </div>
                        {ibisFile.components.map((component) => (
                          <div key={component.name} className="flex justify-between">
                            <span className="text-muted-foreground">{component.name}</span>
                            <span>{component.pins.length} pins</span>
                          </div>
                        ))}
                        {ibisFile.models.map((model) => (
                          <div key={model.name} className="rounded border border-border p-1.5">
                            <div className="flex justify-between font-medium">
                              <span>{model.name}</span>
                              <span>{model.modelType}</span>
                            </div>
                            <div className="text-muted-foreground">
                              C_comp {(model.cComp.typical * 1e12).toFixed(2)} pF · I-V
                              {' '}PU {model.pullup.length} / PD {model.pulldown.length}
                              {' '}/ GND {model.gndClamp.length} / PWR {model.powerClamp.length}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="assembly" className="flex-1 overflow-y-auto p-3">
                <DesignCalculatorsPanel />
              </TabsContent>
            </Tabs>
          </div>
          </div>

          {/* Right: Control panel */}
          <div className="flex max-h-[45%] w-full flex-shrink-0 flex-col overflow-y-auto border-t border-border bg-card lg:max-h-none lg:w-72 lg:border-l lg:border-t-0">
            <div className="p-3 space-y-3">

              {/* Layer stack */}
              <Card>
                <CardHeader className="pb-2 pt-3 px-3">
                  <CardTitle className="text-xs flex items-center gap-1"><Layers className="w-3 h-3" /> Layer Stack</CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-3 space-y-1">
                  {layers.map(layer => (
                    <div
                      key={layer.id}
                      className={`flex items-center justify-between p-1.5 rounded cursor-pointer text-xs transition-colors ${selectedLayerId === layer.id ? 'bg-primary/15 border border-primary/30' : 'hover:bg-accent'}`}
                      onClick={() => setSelectedLayerId(layer.id)}
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: layer.color }} />
                        <span>{layer.name}</span>
                      </div>
                      <Button variant="ghost" size="icon" className="h-5 w-5" onClick={e => { e.stopPropagation(); toggleLayerVisibility(layer.id) }} aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}>
                        {layer.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3 opacity-40" />}
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* Routing */}
              <Card>
                <CardHeader className="pb-2 pt-3 px-3">
                  <CardTitle className="text-xs flex items-center gap-1"><Route className="w-3 h-3" /> Routing</CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-3 space-y-2">
                  <Button className="w-full h-7 text-xs" onClick={handleAutoRoute}>
                    <RotateCcw className="w-3 h-3 mr-1" /> Auto-Route from Schematic
                  </Button>
                  <div className="text-xs text-muted-foreground">Traces: {traces.length} | Vias: {vias.length}</div>
                </CardContent>
              </Card>

              {/* Analysis */}
              <Card>
                <CardHeader className="pb-2 pt-3 px-3">
                  <CardTitle className="text-xs flex items-center gap-1"><Grid3X3 className="w-3 h-3" /> Analysis</CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-3 space-y-2">
                  <Button className="w-full h-7 text-xs" variant="outline" onClick={handleDRC}>
                    <Ruler className="w-3 h-3 mr-1" /> Run DRC
                  </Button>
                  <Button className="w-full h-7 text-xs" variant="outline" onClick={handleEMC} disabled={analysisRunning}>
                    <Wifi className="w-3 h-3 mr-1" /> Run EMC
                  </Button>
                  <Button className="w-full h-7 text-xs" variant="outline" onClick={handleThermal} disabled={analysisRunning}>
                    <Thermometer className="w-3 h-3 mr-1" /> Run Thermal
                  </Button>
                  <Button className="w-full h-7 text-xs" variant="outline" onClick={handleSignalIntegrity} disabled={analysisRunning}>
                    <Zap className="w-3 h-3 mr-1" /> Run Signal Integrity
                  </Button>
                </CardContent>
              </Card>

              {/* Export */}
              <Card>
                <CardHeader className="pb-2 pt-3 px-3">
                  <CardTitle className="text-xs flex items-center gap-1"><Download className="w-3 h-3" /> Export</CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-3 space-y-2">
                  <Button className="w-full h-7 text-xs" variant="outline" onClick={handleExportGerber}>
                    <Download className="w-3 h-3 mr-1" /> Gerber (RS-274X)
                  </Button>
                  <Button className="w-full h-7 text-xs" variant="default" onClick={handleExportFab}>
                    <Download className="w-3 h-3 mr-1" /> Fab package (Gerber + drill + PnP)
                  </Button>
                  {fabVerdict ? <p className="text-[11px] leading-snug text-muted-foreground">{fabVerdict}</p> : null}
                  <Button className="w-full h-7 text-xs" variant="outline" onClick={() => {
                    const data = JSON.stringify({ traces, vias, layers, boardWidth, boardHeight }, null, 2)
                    downloadFile(data, `pcb_${Date.now()}.json`, 'application/json')
                  }}>
                    <Settings className="w-3 h-3 mr-1" /> PCB JSON
                  </Button>
                </CardContent>
              </Card>

              {/* Design rules summary */}
              <Card>
                <CardHeader className="pb-2 pt-3 px-3">
                  <CardTitle className="text-xs">Design Rules</CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-3 space-y-1">
                  {DISPLAYED_RULES.map(key => (
                    <div key={key} className="flex justify-between text-xs text-muted-foreground">
                      <span>{key.replace(/([A-Z])/g, ' $1').toLowerCase()}</span>
                      <span>{PANEL_DRC_RULES[key]} mm</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
