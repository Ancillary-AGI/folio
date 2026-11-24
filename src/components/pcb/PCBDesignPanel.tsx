import HoverHelp from '../ui/HoverHelp'
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
  Ruler, RotateCcw, Move, MousePointer, Thermometer, Wifi, AlertTriangle, CheckCircle, Package,
  Cpu, Upload, GitCompare, Box, ZoomIn, ZoomOut, Maximize2,
  RotateCw, FlipVertical, Undo2, Redo2, Waypoints, BoxSelect, Frame,
} from 'lucide-react'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
import type { PlacedComponent, Wire, Point, Net } from '../../types'
import { useProjectStore } from '../../stores/useProjectStore'
import { useAppStore } from '../../stores/useAppStore'
import { useCursorTelemetry } from '../../stores/useCursorTelemetry'
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
import { exportToGerber, downloadFile, downloadBlob } from '../../lib/exportUtils'
import { createTextZipBytes } from '../../lib/manufacturing/zipStore'
import { buildFabPackage, fabLayerFromId, type FabPlane } from '../../lib/manufacturing/fabExport'
import { autoroute, buildRouterPads, type RouterKeepout, type RouterPad } from '../../lib/manufacturing/autorouter'
import {
  DEFAULT_DRC_RULES,
  DesignRuleChecker,
  type DRCRuleType,
  type DRCSettings,
} from '../../lib/manufacturing/drc'
import type { PCBDesign, PCBKeepout, PCBPad } from '../../lib/manufacturing/pcb'
import { buildPcbScene, type PcbScene, type PcbSceneInput } from '../../lib/pcb/pcbScene'
import { autoPlace, placePart } from '../../lib/schematic/placePart'
import type { Component } from '../../lib/supabase'
import {
  boardRouterRules,
  netsFromWires,
  placeSchematicOnBoard,
  fabCopperFromRoutedTraces,
} from '../../lib/pcb/boardLayout'
import {
  keepoutAt,
  nearestLand,
  ratsnest,
  rectFromCorners,
  rotateStep,
  snapToGrid as snapBoardPoint,
  traceAt,
  viaAt,
  type PlacementEdit,
  type RatsnestWire,
} from '../../lib/pcb/boardEdit'
import { useBoardEdits } from './useBoardEdits'
import { isEditableTarget, matchesShortcut } from '../../lib/keymap/shortcuts'
import { useShortcutStore } from '../../stores/useShortcutStore'
import { useDemoRequest } from '../workspace/useDemoRequest'
import { polylineLength } from '../../lib/geometry/distance'
import {
  DEFAULT_NET_CLASSES,
  netClassRules,
  resolveNetClass,
  type NetClass,
} from '../../lib/pcb/netClasses'
import {
  fourLayerStackup,
  microstripErEff,
  microstripImpedance,
  nearestPlane,
  ozToMm,
  validateStackup,
  widthForImpedance,
  type StackupLayer,
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
import SourcingPanel from './SourcingPanel'
import { placeableFromPlaced, previewPlacement, type PlacementPlan } from '../../lib/pcb/placement'
import { generateId } from '../../lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface PCBDesignPanelProps {
  onClose: () => void
  onPreview3D?: () => void
  components?: PlacedComponent[]
  wires?: Wire[]
  /**
   * The parts palette. With it, a library part can be dropped on the board;
   * without it the canvas has no way to resolve a drag payload and refuses
   * drops rather than guessing.
   */
  library?: Component[]
  /**
   * A library part armed by a click. The next click on bare board places it,
   * mirroring the sheet's click-to-place flow; the owner clears it afterwards.
   */
  pendingComponent?: Component | null
  onPendingPlaced?: () => void
}

interface PCBLayer {
  id: string
  name: string
  type: 'signal' | 'power' | 'ground' | 'silkscreen' | 'soldermask' | 'paste'
  color: string
  visible: boolean
  /** Net poured as a solid plane on this inner film; unset means routed copper. */
  net?: string
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
  /**
   * What to do about it, in one sentence, from the same `remedyFor` mapping the
   * agent reads. A violation that names the problem without the fix leaves the
   * reader to infer it from the rule.
   */
  remedy?: string
}

/**
 * One piece of copper picked on the board.
 *
 * Tracks and vias are addressable but not parts: a part belongs to the
 * schematic netlist, while this copper is what the designer (or the router)
 * just drew, so it is the thing a Delete key should act on.
 */
type CopperSelection =
  | { kind: 'trace'; id: string }
  | { kind: 'via'; id: string }
  | { kind: 'keepout'; id: string }

type BoardToolId = 'select' | 'route' | 'via' | 'move' | 'keepout' | 'measure' | 'outline'

interface BoardTool {
  id: BoardToolId
  icon: typeof MousePointer
  label: string
  help: string
  /** What the tool does with the next gesture, shown beside the rail. */
  hint: string
}

/**
 * The tool rail is grouped by intent rather than a flat list: a designer looks
 * for "route" or "measure", not for the sixth icon in a column. Labels stay
 * visible because an icon-only rail is only legible once it is memorised.
 */
const BOARD_TOOL_GROUPS: ReadonlyArray<{
  title: string
  tone: string
  tools: ReadonlyArray<BoardTool>
}> = [
  {
    title: 'Inspect',
    tone: 'text-info',
    tools: [
      {
        id: 'select', icon: MousePointer, label: 'Select',
        help: 'Pick a part or a length of copper (select)',
        hint: 'Click a part, track, via or keep-out to inspect it. Drag on empty board for a marquee; Shift adds to the selection.',
      },
      {
        id: 'move', icon: Move, label: 'Move part',
        help: 'Drag a part to a new position (move)',
        hint: 'Drag a part to move it. Copper already laid along its old position is flagged stale until the router runs again.',
      },
    ],
  },
  {
    title: 'Route',
    tone: 'text-primary',
    tools: [
      {
        id: 'route', icon: Route, label: 'Route',
        help: 'Draw a track on the active layer (route)',
        hint: 'Click a land to start, click each bend, then double-click or press Esc to finish. Angle snaps keep the track legal.',
      },
      {
        id: 'via', icon: Zap, label: 'Place via',
        help: 'Drop a via to change layers (via)',
        hint: 'Click a pad or track to drop a via that carries that net through the stack to the other routed film.',
      },
    ],
  },
  {
    title: 'Layout',
    tone: 'text-warning',
    tools: [
      {
        id: 'keepout', icon: BoxSelect, label: 'Keep-out',
        help: 'Drag a copper-free keep-out region; hold Alt to restrict it to the active layer',
        hint: 'Drag a copper-free rectangle. Alt restricts it to the active layer; DRC and the autorouter read the same region.',
      },
      {
        id: 'measure', icon: Ruler, label: 'Measure',
        help: 'Click two points to measure distance and Δx/Δy between them',
        hint: 'Click two points to read straight-line distance and Δx / Δy. Endpoints snap to a land first, then the grid.',
      },
      {
        id: 'outline', icon: Frame, label: 'Board outline',
        help: 'Drag the right, bottom or corner handle to resize the rectangular outline',
        hint: 'Drag the right, bottom or corner handle. The origin is pinned and the outline stays rectangular.',
      },
    ],
  },
]

const BOARD_TOOLS = BOARD_TOOL_GROUPS.flatMap((group) => group.tools)

/** A DRC finding the canvas can point at. */
interface DrcMarker {
  id: string
  severity: 'error' | 'warning'
  x: number
  y: number
  message: string
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
  // This panel knows its rectangular origin, so it can hold copper to the edge.
  checkBoardOutline: true,
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
  keepout: 'Keep-out',
  outline: 'Board outline',
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
/**
 * Manual copper default. A hand-drawn track snaps coarser than the router works:
 * the router's cell is derived from the clearance rules (`routerGridMm`), while a
 * designer's mouse wants a pitch a finger can hit, and the selector below offers
 * the finer ones.
 */
const MANUAL_GRID_MM = 0.5
const MANUAL_TRACE_WIDTH_MM = 0.25
const PAD_SNAP_MM = 1.2
/** How far from a track centre or a via ring a click still counts as a grab. */
const COPPER_GRAB_MM = 0.3
/** Grid choices the snap selector offers, in millimetres. */
const SNAP_GRID_OPTIONS = [0.1, 0.25, 0.5, 1.0] as const

/** A keep-out narrower than this is a mis-click, not a clearance region. */
const MIN_KEEPOUT_MM = 0.5
/** The outline is a rectangle the width/height inputs also clamp to. */
const MIN_BOARD_MM = 10
const MAX_BOARD_MM = 500

interface BoardBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/**
 * A footprint body as an axis-aligned box in board millimetres. A turned part is
 * measured by the rectangle it sweeps rather than its unrotated body, so a
 * marquee catches the part the designer sees instead of a narrower ghost of it.
 */
function bodyBounds(
  component: { position: { x: number; z: number }; bodyWidthMm: number; bodyDepthMm: number; rotationYDeg: number },
  boardWidth: number,
  boardHeight: number,
): BoardBox {
  const cx = component.position.x + boardWidth / 2
  const cy = component.position.z + boardHeight / 2
  const angle = (component.rotationYDeg * Math.PI) / 180
  const cos = Math.abs(Math.cos(angle))
  const sin = Math.abs(Math.sin(angle))
  const halfX = (component.bodyWidthMm * cos + component.bodyDepthMm * sin) / 2
  const halfY = (component.bodyWidthMm * sin + component.bodyDepthMm * cos) / 2
  return { minX: cx - halfX, minY: cy - halfY, maxX: cx + halfX, maxY: cy + halfY }
}

/** Touching counts as inside: a marquee drawn flush with a body still picks it. */
function boxesOverlap(a: BoardBox, b: BoardBox): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY
}

function PCBCanvas({
  traces, vias, keepouts, boardWidth, boardHeight, selectedLayerId, layers, scene,
  activeTool, selectedComponentIds, selectedCopper, routerPads, focusedNetNames,
  snapGridMm, ratsnestWires, drcMarkers, traceWidthForNet,
  onSelectComponents, onMoveComponents, onAddTrace, onAddVia, onAddKeepout, onSelectCopper,
  onEndGesture, onResizeBoard, onDropPart, onPlaceArmed,
}: {
  traces: PCBTrace[]
  vias: PCBVia[]
  keepouts: readonly PCBKeepout[]
  boardWidth: number
  boardHeight: number
  selectedLayerId: string
  layers: PCBLayer[]
  scene: PcbScene | null
  activeTool: 'select' | 'route' | 'via' | 'move' | 'keepout' | 'measure' | 'outline'
  selectedComponentIds: readonly string[]
  selectedCopper: CopperSelection | null
  routerPads: readonly RouterPad[]
  focusedNetNames: ReadonlySet<string> | null
  snapGridMm: number
  ratsnestWires: readonly RatsnestWire[]
  drcMarkers: readonly DrcMarker[]
  /** Copper width a net's class asks for; the default when it names no class. */
  traceWidthForNet: (netName: string) => number
  onSelectComponents: (ids: string[]) => void
  onMoveComponents: (moves: Array<{ id: string; position: Point }>, gestureKey: string) => void
  onAddTrace: (draft: { points: Point[]; layerId: string; width: number; netName: string }) => void
  onAddVia: (via: { position: Point; netName: string }) => void
  onAddKeepout: (keepout: Omit<PCBKeepout, 'id'>) => void
  onSelectCopper: (selection: CopperSelection | null) => void
  onEndGesture: () => void
  /** Apply a live outline drag; the panel owns the clamped board size. */
  onResizeBoard: (width: number, height: number) => void
  /** A library part dropped on the board. The panel resolves the payload id. */
  onDropPart?: (componentId: string, at: Point) => void
  /** Place the armed library part at this point, then disarm. */
  onPlaceArmed?: (at: Point) => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  /** Two-finger pinch zoom state for the board canvas; desktop uses the wheel. */
  const pinchRef = useRef<{ dist: number; anchor: Point } | null>(null)
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [draft, setDraft] = useState<{ points: Point[]; netName: string; layerId: string } | null>(null)
  const draftRef = useRef<typeof draft>(null)
  const [hover, setHover] = useState<Point | null>(null)
  const moveRef = useRef<{
    ids: string[]
    /** The part under the pointer; the whole group takes its snap. */
    primaryId: string
    origins: Array<{ id: string; origin: Point }>
    startClient: { clientX: number; clientY: number }
    pointerId: number
  } | null>(null)
  /** Rubber-band on the bare board, in board millimetres. */
  const [marquee, setMarquee] = useState<{ start: Point; end: Point } | null>(null)
  const marqueeRef = useRef<{
    start: Point
    end: Point
    startClient: { clientX: number; clientY: number }
    additive: boolean
    moved: boolean
  } | null>(null)

  /** Rectangle being dragged with the keep-out tool, in board millimetres. */
  const [keepoutDraft, setKeepoutDraft] = useState<{ start: Point; end: Point; layers: string[] } | null>(null)
  const keepoutRef = useRef<typeof keepoutDraft>(null)
  /** A ruler's fixed start; `to` is null until the second click lands. */
  const [measureFrom, setMeasureFrom] = useState<Point | null>(null)
  const [measureTo, setMeasureTo] = useState<Point | null>(null)
  const [measureHover, setMeasureHover] = useState<Point | null>(null)
  /** Which outline handle the pointer is dragging, if any. */
  const outlineRef = useRef<'right' | 'bottom' | 'corner' | null>(null)

  /*
   * The cursor readout is written straight into the DOM. A dense board draws
   * thousands of copper paths, and re-rendering that SVG on every pointer move
   * to refresh eight characters is how a canvas starts to lag.
   */
  const cursorRef = useRef<HTMLSpanElement>(null)
  const showCursor = (point: Point | null): void => {
    if (cursorRef.current) {
      cursorRef.current.textContent = point
        ? `x ${point.x.toFixed(2)}  y ${point.y.toFixed(2)} mm`
        : ''
    }
    /* Mirror the position into the telemetry store the HUD reads. Unit is the
     * board's own unit (mm); a subscriber count of one keeps the write cheap. */
    useCursorTelemetry.getState().setPosition(point?.x ?? 0, point?.y ?? 0)
  }

  const margin = Math.max(4, Math.min(boardWidth, boardHeight) * 0.08)
  const viewWidth = (boardWidth + margin * 2) / zoom
  const viewHeight = (boardHeight + margin * 2) / zoom
  const centerX = boardWidth / 2 + pan.x
  const centerY = boardHeight / 2 + pan.y
  const viewBox = `${centerX - viewWidth / 2} ${centerY - viewHeight / 2} ${viewWidth} ${viewHeight}`
  const layerColor = (id: string) => layers.find(l => l.id === id)?.color ?? '#c98a3c'
  const selectedLayer = layers.find(l => l.id === selectedLayerId)
  const selectedPart = selectedComponentIds.length === 1
    ? scene?.components.find(component => component.id === selectedComponentIds[0])
    : undefined

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

  /*
   * Two-finger pinch on the board, anchored to the point under the fingers'
   * midpoint. The SVG is a viewBox, so a pinch is a viewBox change: the
   * anchored board point must stay at the same client fraction it started
   * at, or the board slides out from under the fingers mid-gesture.
   */
  const pinchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 2) {
      pinchRef.current = null
      return
    }
    const t0 = event.touches[0]
    const t1 = event.touches[1]
    const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY)
    const midClient = { x: (t0.clientX + t1.clientX) / 2, y: (t0.clientY + t1.clientY) / 2 }
    const anchor = toBoardPoint({ clientX: midClient.x, clientY: midClient.y }) ?? { x: centerX, y: centerY }
    pinchRef.current = { dist, anchor }
  }

  const pinchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 2) {
      pinchRef.current = null
      return
    }
    const prev = pinchRef.current
    const rect = svgRef.current?.getBoundingClientRect()
    if (!prev || !rect || rect.width <= 0 || rect.height <= 0) return
    const t0 = event.touches[0]
    const t1 = event.touches[1]
    const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY)
    if (!Number.isFinite(dist) || dist <= 0) return
    // One gesture, one zoom step per move event, clamped like the schematic's.
    const factor = Math.max(0.9, Math.min(1.1, dist / prev.dist))
    const next = Math.max(1, Math.min(8, zoom * factor))
    const midX = (t0.clientX + t1.clientX) / 2
    const midY = (t0.clientY + t1.clientY) / 2
    const fx = (midX - rect.left) / rect.width
    const fy = (midY - rect.top) / rect.height
    const viewWidthNext = (boardWidth + margin * 2) / next
    const viewHeightNext = (boardHeight + margin * 2) / next
    const centerXNext = prev.anchor.x - (fx - 0.5) * viewWidthNext
    const centerYNext = prev.anchor.y - (fy - 0.5) * viewHeightNext
    setZoom(next)
    setPan({ x: centerXNext - boardWidth / 2, y: centerYNext - boardHeight / 2 })
    pinchRef.current = { dist, anchor: prev.anchor }
  }

  const pinchEnd = () => {
    pinchRef.current = null
  }

  const orderedTraces = useMemo(
    () => [...traces].sort((a, b) => (a.layerId === 'bot-cu' ? 0 : 1) - (b.layerId === 'bot-cu' ? 0 : 1)),
    [traces],
  )

  /*
   * Focus only recedes copper when the selected part's nets actually have some
   * on the board. Dimming every trace with nothing lit would read as a
   * rendering fault rather than the answer "these nets are not routed yet".
   */
  const litNetNames = useMemo<ReadonlySet<string> | null>(() => {
    if (!focusedNetNames) return null
    const routed = new Set(traces.map(trace => trace.netName))
    for (const via of vias) if (via.netName) routed.add(via.netName)
    const lit = [...focusedNetNames].filter(name => routed.has(name))
    return lit.length > 0 ? new Set(lit) : null
  }, [focusedNetNames, traces, vias])

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
    const x = (event.clientX - rect.left - (rect.width - viewWidth * scale) / 2) / scale
      + (centerX - viewWidth / 2)
    const y = (event.clientY - rect.top - (rect.height - viewHeight * scale) / 2) / scale
      + (centerY - viewHeight / 2)
    // A synthetically dispatched event can arrive without coordinates; never
    // let that place a part at NaN.
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
  }

  /*
   * The board grid is an aid, not a rule: with the app-wide "snap to grid"
   * switched off the cursor lands where it was pointed. Read at call time so a
   * change in Settings takes effect on the next click, not on the next reload.
   */
  const snapToGrid = (point: Point): Point =>
    useAppStore.getState().settings.snapToGrid ? snapBoardPoint(point, snapGridMm) : point

  /** A point just off the outline lands on the edge instead of in the void. */
  const onBoard = (point: Point): Point => snapToGrid({
    x: Math.min(Math.max(point.x, 0), boardWidth),
    y: Math.min(Math.max(point.y, 0), boardHeight),
  })

  /**
   * The land a click is aiming at. A pad on the far face is only a target when
   * it is plated through — otherwise a surface trace drawn onto it would be a
   * short, not a connection.
   */
  const padNear = (point: Point): RouterPad | null =>
    nearestLand(routerPads, point, PAD_SNAP_MM, activeCopperLayerId)

  /** Measure endpoints snap to a land, then to the grid — the same order a track takes. */
  const measurePoint = (point: Point): Point => {
    const pad = padNear(point)
    return pad ? { x: pad.x, y: pad.y } : snapToGrid(point)
  }

  const finishKeepout = () => {
    const zone = keepoutRef.current
    keepoutRef.current = null
    setKeepoutDraft(null)
    if (!zone) return
    const rect = rectFromCorners(zone.start, zone.end)
    // A click or a stray twitch is not a clearance region; the drag has to
    // describe one the router can actually respect.
    if (rect.width < MIN_KEEPOUT_MM || rect.height < MIN_KEEPOUT_MM) return
    onAddKeepout({ ...rect, layers: zone.layers })
  }

  const cancelZoneGestures = () => {
    keepoutRef.current = null
    setKeepoutDraft(null)
    outlineRef.current = null
    setMeasureFrom(null)
    setMeasureTo(null)
    setMeasureHover(null)
  }

  /** Select and move both marquee; every other tool owns the left button. */
  const takesBoardGestures = activeTool === 'select' || activeTool === 'move'

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
      width: traceWidthForNet(current.netName),
      netName: current.netName,
    })
  }

  // Keyboard keeps the click-click gesture usable without a Finish button.
  // Resolved through the shortcut registry, so a rebind of cancel/finish lands
  // here rather than being silently ignored by the board.
  const shortcutOverrides = useShortcutStore((state) => state.overrides)
  const finishRef = useRef(finishDraft)
  finishRef.current = finishDraft
  const cancelRef = useRef(cancelDraft)
  cancelRef.current = cancelDraft
  useEffect(() => {
    if (!draft) return
    const handler = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return
      if (matchesShortcut(event, 'pcb.cancel', shortcutOverrides)) {
        event.preventDefault()
        cancelRef.current()
      } else if (matchesShortcut(event, 'pcb.finish', shortcutOverrides)) {
        event.preventDefault()
        finishRef.current()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [draft, shortcutOverrides])

  // Escape cancels a ruler or a keep-out drag the same way it cancels a trace.
  useEffect(() => {
    if (!measureFrom && !keepoutDraft) return
    const handler = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return
      if (matchesShortcut(event, 'pcb.cancel', shortcutOverrides)) {
        event.preventDefault()
        keepoutRef.current = null
        setKeepoutDraft(null)
        setMeasureFrom(null)
        setMeasureTo(null)
        setMeasureHover(null)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [measureFrom, keepoutDraft, shortcutOverrides])

  // Switching tools abandons an unfinished trace rather than leaving a
  // half-drawn polyline attached to the canvas.
  useEffect(() => {
    if (activeTool !== 'route' && draftRef.current) {
      draftRef.current = null
      setDraft(null)
      setHover(null)
    }
    if (activeTool !== 'keepout') {
      keepoutRef.current = null
      setKeepoutDraft(null)
    }
    if (activeTool !== 'measure') {
      setMeasureFrom(null)
      setMeasureTo(null)
      setMeasureHover(null)
    }
    if (activeTool !== 'outline') outlineRef.current = null
  }, [activeTool])

  const handleBoardPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return
    const raw = toBoardPoint(event)
    if (!raw) return

    // An armed library part owns the next click. Tools that draw or measure on
    // the board keep their own gesture rather than silently dropping a part
    // where copper, a keep-out or a ruler was intended.
    if (onPlaceArmed && takesBoardGestures) {
      event.stopPropagation()
      onPlaceArmed(onBoard(raw))
      return
    }

    if (activeTool === 'keepout') {
      event.stopPropagation()
      const start = snapToGrid(raw)
      const next = { start, end: start, layers: event.altKey ? [activeCopperLayerId] : [] }
      keepoutRef.current = next
      setKeepoutDraft(next)
      try { wrapRef.current?.setPointerCapture(event.pointerId) } catch { /* jsdom */ }
      return
    }

    if (activeTool === 'measure') {
      event.stopPropagation()
      const point = measurePoint(raw)
      // A finished ruler stays on screen; the next click starts a new one.
      if (measureFrom === null || measureTo !== null) {
        setMeasureFrom(point)
        setMeasureTo(null)
      } else {
        setMeasureTo(point)
        setMeasureHover(null)
      }
      return
    }

    if (activeTool === 'outline') {
      // Only the right, bottom and corner handles resize: the origin is fixed,
      // which keeps every part's coordinates valid across the change.
      const reach = Math.max(1, viewWidth * 0.035)
      const handles = [
        { handle: 'right' as const, x: boardWidth, y: boardHeight / 2 },
        { handle: 'bottom' as const, x: boardWidth / 2, y: boardHeight },
        { handle: 'corner' as const, x: boardWidth, y: boardHeight },
      ]
      const hit = handles.find(handle => Math.hypot(raw.x - handle.x, raw.y - handle.y) <= reach)
      if (!hit) return
      event.stopPropagation()
      outlineRef.current = hit.handle
      try { wrapRef.current?.setPointerCapture(event.pointerId) } catch { /* jsdom */ }
      return
    }

    // Selection is the only other gesture that reaches the board itself.
    if (takesBoardGestures) {
      const via = viaAt(vias, raw, COPPER_GRAB_MM)
      if (via) {
        event.stopPropagation()
        onSelectCopper({ kind: 'via', id: via.id })
        return
      }
      const track = traceAt(traces, raw, COPPER_GRAB_MM)
      if (track) {
        event.stopPropagation()
        onSelectCopper({ kind: 'trace', id: track.id })
        return
      }
      const zone = keepoutAt(keepouts, raw)
      if (zone) {
        event.stopPropagation()
        onSelectCopper({ kind: 'keepout', id: zone.id })
        return
      }
      // Bare board: the wrapper owns this press as a marquee candidate. A
      // press that does not move clears the selection when it is released;
      // deselecting on pointer-down would empty the group a marquee is about
      // to extend (Shift-drag) before the band is even drawn.
      return
    }

    event.stopPropagation()
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

  /**
   * Settles the left-press the wrapper started: a band selects the footprints
   * it touches, a press that never moved clears the selection. Shift extends
   * the current selection in both cases, as on the schematic sheet.
   */
  const finishMarquee = () => {
    const band = marqueeRef.current
    marqueeRef.current = null
    setMarquee(null)
    if (!band) return
    if (!band.moved) {
      if (!band.additive) {
        onSelectComponents([])
        onSelectCopper(null)
      }
      return
    }
    if (!scene) return
    const rect: BoardBox = {
      minX: Math.min(band.start.x, band.end.x),
      minY: Math.min(band.start.y, band.end.y),
      maxX: Math.max(band.start.x, band.end.x),
      maxY: Math.max(band.start.y, band.end.y),
    }
    const hits = scene.components
      .filter(component => boxesOverlap(bodyBounds(component, boardWidth, boardHeight), rect))
      .map(component => component.id)
    onSelectComponents(band.additive
      ? Array.from(new Set([...selectedComponentIds, ...hits]))
      : hits)
    // Copper is a separate, single-object pick; a part band replaces it.
    onSelectCopper(null)
  }

  const measureEnd = measureTo ?? measureHover
  const rulerMm = measureFrom && measureEnd
    ? Math.hypot(measureEnd.x - measureFrom.x, measureEnd.y - measureFrom.y)
    : 0
  // Handles keep a near-constant screen size as the view zooms.
  const handleR = Math.max(0.5, Math.min(2.4, viewWidth * 0.012))

  return (
    <div
      ref={wrapRef}
      className={`relative h-full w-full overflow-hidden rounded bg-canvas ${
        // Drawing tools aim; select and move both grab a part, which sets its
        // own grab cursor, so the bare board shows the plain arrow.
        !takesBoardGestures ? 'cursor-crosshair' : 'cursor-default'
      }`}
      onWheel={(event) => {
        // ctrl/meta+wheel is the explicit zoom gesture; a plain wheel is the
        // page's — the board must not eat it, or the panel stops scrolling.
        if (!event.ctrlKey && !event.metaKey) return
        event.preventDefault()
        changeZoom(event.deltaY < 0 ? 1.2 : 1 / 1.2)
      }}
      onTouchStart={pinchStart}
      onTouchMove={pinchMove}
      onTouchEnd={pinchEnd}
      onTouchCancel={pinchEnd}
      /* The browser must not treat the pinch as a page zoom — the board owns
         the gesture, and the anchor maths above keeps the board under the
         fingers. */
      style={{ touchAction: 'none' }}
      onPointerDown={(event) => {
        if (event.button === 1) {
          // Middle-drag pans in every tool, the convention a designer expects
          // when the left button selects, marquees or routes.
          event.preventDefault()
          try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* jsdom */ }
          dragRef.current = { startX: event.clientX, startY: event.clientY, panX: pan.x, panY: pan.y }
          return
        }
        // Drawing tools own the left button, and parts and copper stop their
        // own presses, so anything left is bare board.
        if (!takesBoardGestures) return
        if (event.button !== 0) return
        // Overlay controls (zoom, finish trace) sit inside this wrapper; their
        // presses must not start a band that then clears the selection.
        if (!svgRef.current?.contains(event.target as Node)) return
        const start = toBoardPoint(event)
        if (!start) return
        try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* jsdom */ }
        // A press that does not move clears the selection on release; the band
        // appears only once the pointer has travelled far enough to be a drag.
        marqueeRef.current = {
          start,
          end: start,
          startClient: { clientX: event.clientX, clientY: event.clientY },
          additive: event.shiftKey,
          moved: false,
        }
      }}
      onPointerMove={(event) => {
        const cursor = toBoardPoint(event)
        showCursor(cursor)
        const zone = keepoutRef.current
        if (zone && cursor) {
          const snapped = snapToGrid(cursor)
          if (snapped.x !== zone.end.x || snapped.y !== zone.end.y) {
            zone.end = snapped
            setKeepoutDraft({ ...zone })
          }
        }
        if (activeTool === 'measure' && measureFrom && measureTo === null && cursor) {
          setMeasureHover(measurePoint(cursor))
        }
        if (outlineRef.current && cursor) {
          const snapped = snapToGrid(cursor)
          const width = Math.min(MAX_BOARD_MM, Math.max(
            MIN_BOARD_MM,
            outlineRef.current === 'bottom' ? boardWidth : snapped.x,
          ))
          const height = Math.min(MAX_BOARD_MM, Math.max(
            MIN_BOARD_MM,
            outlineRef.current === 'right' ? boardHeight : snapped.y,
          ))
          if (width !== boardWidth || height !== boardHeight) onResizeBoard(width, height)
        }
        const band = marqueeRef.current
        if (band) {
          if (!band.moved
            && (Math.abs(event.clientX - band.startClient.clientX) > 3
              || Math.abs(event.clientY - band.startClient.clientY) > 3)) {
            band.moved = true
          }
          if (band.moved && cursor) {
            band.end = cursor
            setMarquee({ start: band.start, end: cursor })
          }
        }
        if (moveRef.current) {
          // Both endpoints go through the transform as it is *now*: selecting a
          // part adds its readout, which reflows the canvas and moves the
          // letterboxed origin. Mixing an old and a new mapping would make the
          // part jump on the first move.
          const start = toBoardPoint(moveRef.current.startClient)
          if (cursor && start) {
            const dx = cursor.x - start.x
            const dy = cursor.y - start.y
            // The grabbed part lands on the grid and the rest of the group
            // keeps its exact spacing; snapping each part separately would
            // shift neighbours relative to it.
            const primary = moveRef.current.origins.find(entry => entry.id === moveRef.current?.primaryId)
            const snapped = primary
              ? snapToGrid({ x: primary.origin.x + dx, y: primary.origin.y + dy })
              : null
            const stepX = primary && snapped ? snapped.x - primary.origin.x : dx
            const stepY = primary && snapped ? snapped.y - primary.origin.y : dy
            onMoveComponents(
              moveRef.current.origins.map(({ id, origin }) => ({
                id,
                position: { x: origin.x + stepX, y: origin.y + stepY },
              })),
              `move:${moveRef.current.ids.join(',')}`,
            )
          }
          return
        }
        if (activeTool === 'route' || activeTool === 'via') {
          if (cursor) setHover(snapToGrid(cursor))
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
      onPointerUp={() => {
        dragRef.current = null
        moveRef.current = null
        outlineRef.current = null
        finishKeepout()
        finishMarquee()
        onEndGesture()
      }}
      onPointerCancel={() => {
        dragRef.current = null
        moveRef.current = null
        marqueeRef.current = null
        setMarquee(null)
        outlineRef.current = null
        keepoutRef.current = null
        setKeepoutDraft(null)
        onEndGesture()
      }}
      onPointerLeave={() => { setHover(null); showCursor(null) }}
      onDragOver={(event) => {
        // Only a library drag carries this type; anything else is refused by
        // never cancelling the default.
        if (!onDropPart || !event.dataTransfer.types.includes('componentId')) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }}
      onDrop={(event) => {
        if (!onDropPart) return
        const componentId = event.dataTransfer.getData('componentId')
        if (!componentId) return
        event.preventDefault()
        const point = toBoardPoint(event)
        if (!point) return
        onDropPart(componentId, onBoard(point))
      }}
      onContextMenu={(event) => {
        if (!draftRef.current && !keepoutRef.current && measureFrom === null) return
        event.preventDefault()
        cancelDraft()
        cancelZoneGestures()
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
        aria-label={`PCB layout, ${boardWidth} by ${boardHeight} millimetres, ${traces.length} traces, ${scene?.counts.pads ?? 0} pads, ${keepouts.length} keep-outs, ${activeTool} tool`}
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
          <pattern id="pcb-keepout-hatch" patternUnits="userSpaceOnUse" width="1.1" height="1.1" patternTransform="rotate(45)">
            <rect width="1.1" height="1.1" fill="#f59e0b" fillOpacity="0.1" />
            <line x1="0" y1="0" x2="0" y2="1.1" stroke="#f59e0b" strokeWidth="0.16" strokeOpacity="0.8" />
          </pattern>
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
              const picked = selectedCopper?.kind === 'trace' && selectedCopper.id === trace.id
              const onFocusedNet = litNetNames?.has(trace.netName) ?? false
              const receded = litNetNames !== null && !onFocusedNet
              return (
                <g
                  key={trace.id}
                  data-trace-id={trace.id}
                  data-trace-net={trace.netName}
                  data-focused={onFocusedNet ? 'true' : undefined}
                  data-receded={receded ? 'true' : undefined}
                  data-picked={picked ? 'true' : undefined}
                  opacity={receded ? 0.22 : isSelected ? 1 : 0.72}
                >
                  <path
                    d={`M ${trace.points.map(point => `${point.x} ${point.y}`).join(' L ')}`}
                    fill="none"
                    stroke={picked ? '#fde047' : '#052b19'}
                    strokeWidth={picked ? trace.width + 0.34 : trace.width + 0.16}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={picked ? 0.9 : 0.55}
                  />
                  <polyline
                    points={points}
                    fill="none"
                    stroke={onFocusedNet ? '#38bdf8' : isSelected ? '#e7a15a' : layerColor(trace.layerId)}
                    strokeWidth={Math.max(0.08, trace.width + (onFocusedNet ? 0.06 : 0))}
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

          {vias.map(via => {
            const onFocusedNet = litNetNames?.has(via.netName) ?? false
            const receded = litNetNames !== null && !onFocusedNet
            const picked = selectedCopper?.kind === 'via' && selectedCopper.id === via.id
            return (
              <g
                key={via.id}
                data-via-id={via.id}
                data-via-net={via.netName}
                data-focused={onFocusedNet ? 'true' : undefined}
                data-receded={receded ? 'true' : undefined}
                data-picked={picked ? 'true' : undefined}
                opacity={receded ? 0.25 : 1}
              >
                {picked ? (
                  <circle
                    cx={via.position.x}
                    cy={via.position.y}
                    r={via.padDiameter / 2 + 0.25}
                    fill="none"
                    stroke="#fde047"
                    strokeWidth={0.18}
                  />
                ) : null}
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
            )
          })}

          {/*
           * Keep-outs: copper-free windows the designer drew. The DRC and the
           * router read the same rectangle, so the hatch is the constraint, not
           * a decoration laid over it.
           */}
          {keepouts.map(zone => {
            const picked = selectedCopper?.kind === 'keepout' && selectedCopper.id === zone.id
            const onActiveLayer = zone.layers.length === 0 || zone.layers.includes(selectedLayerId)
            return (
              <g
                key={zone.id}
                data-keepout-id={zone.id}
                data-keepout-layers={zone.layers.join(',') || 'all'}
                opacity={onActiveLayer ? 1 : 0.45}
              >
                <rect
                  x={zone.x}
                  y={zone.y}
                  width={zone.width}
                  height={zone.height}
                  fill="url(#pcb-keepout-hatch)"
                  stroke={picked ? '#fde047' : '#f59e0b'}
                  strokeWidth={picked ? 0.28 : 0.14}
                  strokeDasharray={picked ? undefined : '0.8 0.45'}
                />
                {zone.width > 9 && zone.height > 3 ? (
                  <text x={zone.x + 0.55} y={zone.y + 1.5} fontSize={0.72} fontWeight={700} fill="#fbbf24" pointerEvents="none" style={{ letterSpacing: 0.06 }}>
                    KEEP-OUT
                  </text>
                ) : null}
              </g>
            )
          })}

          {keepoutDraft ? (() => {
            const rect = rectFromCorners(keepoutDraft.start, keepoutDraft.end)
            return (
              <g data-testid="pcb-keepout-draft" pointerEvents="none">
                <rect
                  x={rect.x}
                  y={rect.y}
                  width={rect.width}
                  height={rect.height}
                  fill="url(#pcb-keepout-hatch)"
                  stroke="#fde047"
                  strokeWidth={0.18}
                  strokeDasharray="0.7 0.35"
                />
                <text
                  x={rect.x + 0.4}
                  y={rect.y - 0.6}
                  fontSize={0.75}
                  fontWeight={600}
                  fill="#fde047"
                  stroke="#083f26"
                  strokeWidth={0.14}
                  paintOrder="stroke"
                >
                  {rect.width.toFixed(2)} × {rect.height.toFixed(2)} mm · {keepoutDraft.layers.length === 0 ? 'all copper' : selectedLayer?.name ?? keepoutDraft.layers[0]}
                </text>
              </g>
            )
          })() : null}

          {/*
           * Flylines: lands a net has not joined with copper yet. Drawn under the
           * package bodies so they read as a suggestion, not as a track, and
           * recomputed on every edit — moving a part is precisely when they come
           * back, because the old tracks no longer reach the new pads.
           */}
          {ratsnestWires.length > 0 ? (
            <g data-testid="pcb-ratsnest" aria-hidden="true">
              {ratsnestWires.map((wire, index) => (
                <line
                  key={`rat-${wire.netName}-${index}`}
                  x1={wire.from.x}
                  y1={wire.from.y}
                  x2={wire.to.x}
                  y2={wire.to.y}
                  stroke="#f8fafc"
                  strokeWidth={0.09}
                  strokeDasharray="0.7 0.5"
                  opacity={0.5}
                />
              ))}
            </g>
          ) : null}

          {/* DRC findings pinned to the board, in the colour of their severity. */}
          {drcMarkers.length > 0 ? (
            <g data-testid="pcb-drc-markers">
              {drcMarkers.map(marker => (
                <circle
                  key={marker.id}
                  data-drc-marker={marker.id}
                  cx={marker.x}
                  cy={marker.y}
                  r={0.85}
                  fill="none"
                  stroke={marker.severity === 'error' ? '#ef4444' : '#fbbf24'}
                  strokeWidth={0.22}
                />
              ))}
            </g>
          ) : null}

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
            /* A package needs its pin-1 mark when the body has an orientation a
             * two-terminal part does not: more than two pads, or a keyed housing.
             * Keyed off the pad count, not the category, so an op-amp dropped from
             * the library is marked the same as a logic IC. */
            const multiLead = component.category === 'connector' || localPads.length > 2
            // Cathode band sits at the cathode (pad 2) end of the package,
            // not across the middle of the body.
            const cathodeX = (localPads[1]?.x ?? 0) >= 0 ? width * 0.28 : -width * 0.28
            const cathodeZ = (localPads[1]?.z ?? 0) >= 0 ? depth * 0.28 : -depth * 0.28
            const selectable = activeTool === 'select' || activeTool === 'move'
            const selected = selectedComponentIds.includes(component.id)
            // A part on the far face is shown as a ghost, the way a professional
            // editor draws bottom-side bodies over the top view.
            const onBottom = component.side === 'bottom'
            return (
              <g
                key={component.id}
                data-component-id={component.id}
                data-selected={selected ? 'true' : undefined}
                data-side={component.side}
                opacity={onBottom && !selected ? 0.5 : undefined}
                transform={`translate(${x} ${y}) rotate(${component.rotationYDeg})`}
                style={selectable ? { cursor: 'grab' } : undefined}
                onPointerDown={selectable ? (event) => {
                  event.stopPropagation()
                  const additive = event.shiftKey
                  const already = selectedComponentIds.includes(component.id)
                  // Shift toggles membership; a plain press on an already
                  // selected member keeps the group so a multi-part drag starts
                  // from whichever part was grabbed.
                  const nextIds = additive
                    ? (already
                      ? selectedComponentIds.filter(id => id !== component.id)
                      : [...selectedComponentIds, component.id])
                    : (already ? [...selectedComponentIds] : [component.id])
                  onSelectComponents(nextIds)
                  onSelectCopper(null)
                  // A shift that removed the part leaves nothing to drag.
                  if (!nextIds.includes(component.id)) return
                  // Select and Move both drag. A press that does not move is a
                  // selection; the same press that does is the gesture every
                  // board editor makes from one mode, not two. Every selected
                  // part moves together, in one undo step.
                  const wanted = new Set(nextIds)
                  const origins = (scene?.components ?? [])
                    .filter(other => wanted.has(other.id))
                    .map(other => ({
                      id: other.id,
                      origin: { x: other.position.x + boardWidth / 2, y: other.position.z + boardHeight / 2 },
                    }))
                  moveRef.current = {
                    ids: nextIds,
                    primaryId: component.id,
                    origins,
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
                    rx={multiLead ? 0.18 : 0.08}
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

                {multiLead ? (
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

          {measureFrom ? (
            <g data-testid="pcb-measure" pointerEvents="none">
              <circle cx={measureFrom.x} cy={measureFrom.y} r={0.16} fill="#38bdf8" stroke="#0f172a" strokeWidth={0.06} />
              {measureEnd ? (
                <>
                  <line
                    x1={measureFrom.x}
                    y1={measureFrom.y}
                    x2={measureEnd.x}
                    y2={measureEnd.y}
                    stroke="#0f172a"
                    strokeWidth={0.3}
                  />
                  <line
                    x1={measureFrom.x}
                    y1={measureFrom.y}
                    x2={measureEnd.x}
                    y2={measureEnd.y}
                    stroke="#38bdf8"
                    strokeWidth={0.13}
                    strokeDasharray="0.6 0.3"
                  />
                  <circle cx={measureEnd.x} cy={measureEnd.y} r={0.16} fill="#38bdf8" stroke="#0f172a" strokeWidth={0.06} />
                  <text
                    x={(measureFrom.x + measureEnd.x) / 2}
                    y={(measureFrom.y + measureEnd.y) / 2 - 0.6}
                    textAnchor="middle"
                    fontSize={0.9}
                    fontWeight={700}
                    fill="#e0f2fe"
                    stroke="#0f172a"
                    strokeWidth={0.2}
                    paintOrder="stroke"
                  >
                    {rulerMm.toFixed(2)} mm
                  </text>
                  <text
                    x={(measureFrom.x + measureEnd.x) / 2}
                    y={(measureFrom.y + measureEnd.y) / 2 + 0.65}
                    textAnchor="middle"
                    fontSize={0.62}
                    fill="#bae6fd"
                    stroke="#0f172a"
                    strokeWidth={0.16}
                    paintOrder="stroke"
                  >
                    Δx {(measureEnd.x - measureFrom.x).toFixed(2)} · Δy {(measureEnd.y - measureFrom.y).toFixed(2)} mm
                  </text>
                </>
              ) : null}
            </g>
          ) : null}

          {activeTool === 'route' && draft && draft.points.length > 0 ? (
            <g pointerEvents="none">
              <polyline
                points={[...draft.points, ...(hover ? [hover] : [])]
                  .map(point => `${point.x},${point.y}`)
                  .join(' ')}
                fill="none"
                stroke={layerColor(draft.layerId)}
                strokeWidth={traceWidthForNet(draft.netName)}
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

          {/* Rubber band: parts whose body it touches join the selection. */}
          {marquee ? (
            <rect
              data-testid="pcb-marquee"
              x={Math.min(marquee.start.x, marquee.end.x)}
              y={Math.min(marquee.start.y, marquee.end.y)}
              width={Math.abs(marquee.end.x - marquee.start.x)}
              height={Math.abs(marquee.end.y - marquee.start.y)}
              fill="#38bdf8"
              fillOpacity={0.12}
              stroke="#38bdf8"
              strokeWidth={0.12}
              strokeDasharray="0.5 0.3"
              pointerEvents="none"
            />
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

        {/*
         * Outline tool: the origin stays fixed and three handles resize the
         * rectangle. Every part, trace and keep-out coordinate stays valid
         * across the change because nothing is rebased.
         */}
        {activeTool === 'outline' ? (
          <g data-testid="pcb-outline-handles">
            <rect
              x={0}
              y={0}
              width={boardWidth}
              height={boardHeight}
              rx={2.2}
              fill="none"
              stroke="#38bdf8"
              strokeWidth={0.16}
              strokeDasharray="0.9 0.45"
              pointerEvents="none"
            />
            {[
              { id: 'right', x: boardWidth, y: boardHeight / 2 },
              { id: 'bottom', x: boardWidth / 2, y: boardHeight },
              { id: 'corner', x: boardWidth, y: boardHeight },
            ].map(handle => (
              <g key={handle.id} data-outline-handle={handle.id}>
                <circle cx={handle.x} cy={handle.y} r={handleR * 1.7} fill="#38bdf8" fillOpacity={0.18} />
                <rect
                  x={handle.x - handleR}
                  y={handle.y - handleR}
                  width={handleR * 2}
                  height={handleR * 2}
                  rx={handleR * 0.35}
                  fill="#0f172a"
                  stroke="#38bdf8"
                  strokeWidth={handleR * 0.28}
                />
              </g>
            ))}
            <text
              x={boardWidth / 2}
              y={boardHeight + handleR * 3.2}
              textAnchor="middle"
              fontSize={handleR * 2.4}
              fill="#7dd3fc"
              stroke="#0f172a"
              strokeWidth={handleR * 0.5}
              paintOrder="stroke"
            >
              Drag a handle · {boardWidth.toFixed(1)} × {boardHeight.toFixed(1)} mm
            </text>
          </g>
        ) : null}
      </svg>

      <div className="pointer-events-none absolute bottom-2 left-2 rounded-lg bg-overlay/75 px-2.5 py-1 text-xs text-overlay-foreground shadow-lg backdrop-blur-md">
        {boardWidth} × {boardHeight} mm &nbsp;|&nbsp; Layer: {selectedLayer?.name ?? selectedLayerId} &nbsp;|&nbsp; {zoom.toFixed(1)}×
        &nbsp;|&nbsp; <span ref={cursorRef} data-testid="pcb-cursor-readout" />
        {snapGridMm} mm grid
        {selectedComponentIds.length > 1
          ? ` | ${selectedComponentIds.length} parts selected`
          : selectedPart ? ` | ${selectedPart.reference} selected` : ''}
        {selectedCopper
          ? ` | ${selectedCopper.kind === 'trace' ? 'track' : selectedCopper.kind === 'via' ? 'via' : 'keep-out'} picked — press Delete to remove`
          : ''}
        {measureFrom && measureEnd
          ? ` | ${rulerMm.toFixed(2)} mm (Δx ${(measureEnd.x - measureFrom.x).toFixed(2)}, Δy ${(measureEnd.y - measureFrom.y).toFixed(2)})`
          : ''}
      </div>

      {draft ? (
        <div className="absolute bottom-10 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-border/60 bg-overlay/85 px-2 py-1 text-[11px] text-overlay-foreground shadow-lg backdrop-blur-md">
          <span className="pl-1.5">
            {draft.points.length} pt{draft.points.length === 1 ? '' : 's'} · {draft.netName || 'no net'}
          </span>
          <button type="button" className="cad-ctl" onClick={finishDraft}>Finish trace</button>
          <button type="button" className="cad-ctl" onClick={cancelDraft}>Cancel</button>
        </div>
      ) : null}

      <div className="absolute right-2 top-2 flex items-center gap-1 rounded-lg border border-border/60 bg-surface/90 p-1 shadow-lg backdrop-blur-md">
        <HoverHelp title="Zoom in" description="Zoom in">
<Button type="button" className="cad-ctl cad-ctl--icon" aria-label="Zoom in" onClick={() => changeZoom(1.25)}>
          <ZoomIn />
        </Button>
</HoverHelp>
        <HoverHelp title="Zoom out" description="Zoom out">
<Button type="button" className="cad-ctl cad-ctl--icon" aria-label="Zoom out" onClick={() => changeZoom(1 / 1.25)}>
          <ZoomOut />
        </Button>
</HoverHelp>
        <HoverHelp title="Fit board" description="Fit board">
<Button type="button" className="cad-ctl cad-ctl--icon" aria-label="Fit board" onClick={resetView}>
          <Maximize2 />
        </Button>
</HoverHelp>
      </div>

      {scene && scene.warnings.length > 0 ? (
        <div className="cad-chip cad-chip--alert pointer-events-none absolute bottom-2 right-2 border-destructive/60 bg-destructive/90 text-destructive-foreground">
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

/**
 * A layout that arrives from elsewhere owns its parts outright, so its rotation
 * and face become this panel's placement record. Carrying the face across is
 * what stops a bottom-mounted part from being republished onto the top side the
 * moment the panel re-publishes the board.
 */
function panelPlacementsFromLayout(layout: PcbSceneInput | null): Record<string, PlacementEdit> {
  if (!layout) return {}
  const edits: Record<string, PlacementEdit> = {}
  for (const component of layout.components) {
    edits[component.id] = {
      x: component.x,
      y: component.y,
      rotationDeg: component.rotationDeg ?? 0,
      side: component.side ?? 'top',
    }
  }
  return edits
}

const ROUTER_LAYER_BY_PANEL: Record<string, string> = { 'top-cu': 'F.Cu', 'bot-cu': 'B.Cu' }

/**
 * Project drawn keep-outs onto the router's two faces. A keep-out that names
 * only inner planes maps to an empty layer list: it must not wall off traces on
 * a face it does not protect, but the drill still crosses it, so the router
 * bars the via barrel anyway.
 */
function routerKeepoutsFromPanel(keepouts: readonly PCBKeepout[]): RouterKeepout[] {
  return keepouts.map(keepout => ({
    xMm: keepout.x,
    yMm: keepout.y,
    widthMm: keepout.width,
    heightMm: keepout.height,
    layers: keepout.layers.length === 0
      ? undefined
      : keepout.layers.flatMap(layer => ROUTER_LAYER_BY_PANEL[layer] ?? []),
  }))
}

/** Convert a layout's drawn keep-outs into the panel's editable model. */
function panelKeepoutsFromLayout(layout: PcbSceneInput | null): PCBKeepout[] {
  if (!layout) return []
  return (layout.keepouts ?? []).map(keepout => ({
    id: keepout.id,
    x: keepout.x,
    y: keepout.y,
    width: keepout.widthMm,
    height: keepout.depthMm,
    layers: [...keepout.layers],
  }))
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export default function PCBDesignPanel({ onClose, onPreview3D, components: propComponents, wires: propWires, library, pendingComponent, onPendingPlaced }: PCBDesignPanelProps) {
  // Live canvas data from the store — but explicit props (tests, embedding)
  // win when provided, so the panel works both mounted in the workspace
  // (onClose only) and standalone with supplied data.
  const storeComponents = useProjectStore((s) => s.components)
  const storeWires = useProjectStore((s) => s.wires)
  const setPcbLayout = useProjectStore((s) => s.setPcbLayout)
  const addStoreComponent = useProjectStore((s) => s.addComponent)
  const storePcbLayout = useProjectStore((s) => s.pcbLayout)
  const schematicSelection = useAppStore((s) => s.selectedComponents)
  const setSchematicSelection = useAppStore((s) => s.setSelectedComponents)
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
  /*
   * Everything the designer can change on this board — copper and placement
   * alike — lives in one undoable record. Keeping them in separate `useState`
   * hooks is how an undo leaves the tracks pointing at pads that have moved.
   */
  const editor = useBoardEdits(() => ({
    traces: panelTracesFromLayout(initialLayoutRef.current),
    vias: panelViasFromLayout(initialLayoutRef.current),
    placements: panelPlacementsFromLayout(initialLayoutRef.current),
    keepouts: panelKeepoutsFromLayout(initialLayoutRef.current),
  }))
  const {
    placements,
    keepouts,
    apply: applyBoardEdits,
    seal: sealBoardEdits,
    adopt: adoptBoardEdits,
    undo: undoBoardEdits,
    redo: redoBoardEdits,
  } = editor
  const [staleRouting, setStaleRouting] = useState(false)
  const [snapGridMm, setSnapGridMm] = useState(MANUAL_GRID_MM)
  const [showRatsnest, setShowRatsnest] = useState(true)
  const [selectedCopper, setSelectedCopper] = useState<CopperSelection | null>(null)
  const components = useMemo(
    () => autoLayout.components.map((component) => {
      const placed = layoutPlacement.get(component.id)
        ?? layoutPlacement.get(`ref:${component.reference}`)
      const override = placements[component.id]
      if (!placed && !override) return component
      return {
        ...component,
        position: override ?? (placed ? { x: placed.x, y: placed.y } : component.position),
        // A designer's rotation outranks the projection it was placed from; the
        // router, DRC and 3-D view all read lands through this rotation, so an
        // turned part moves its copper with it instead of leaving it behind.
        rotation: override?.rotationDeg ?? placed?.rotationDeg ?? component.rotation,
      }
    }),
    [autoLayout, layoutPlacement, placements],
  )
  const wires: Wire[] = useMemo(
    () => {
      if (propWires !== undefined) return propWires
      // The sheet draws on a 10-unit-per-millimetre grid; the board works in
      // millimetres. `netName` must survive this projection: the router, DRC,
      // Gerber export and net focus all group copper by it, so a renamed field
      // would silently split one net into anonymous pieces.
      return storeWires.map((w) => ({
        id: w.id,
        points: w.points.map((p) => ({ x: p.x / 10, y: p.y / 10 })),
        netName: w.netName,
        style: w.style ? { width: w.style.width, color: w.style.color } : undefined,
        connectedPins: w.connectedPins,
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
  /**
   * The physical laminate the impedance, skew, thermal and fab figures are
   * computed from. It starts as the standard symmetric four-layer 1.6 mm
   * stackup and every layer is editable; the copper films drawn on the canvas
   * stay the same four, so an edit changes the physics, not the film list.
   */
  const [stackupLayers, setStackupLayers] = useState<StackupLayer[]>(() => fourLayerStackup())
  const [netClasses, setNetClasses] = useState<NetClass[]>(DEFAULT_NET_CLASSES)
  /** Explicit net-to-class pins; patterns resolve every other net. */
  const [netAssignments, setNetAssignments] = useState<Record<string, string>>({})
  /* The active-layer selection lives in the app store so the floating HUD's
   * quick switch and this panel stay one truth; the board's DEFAULT_LAYERS id
   * space is the contract between them. */
  const selectedLayerId = useAppStore((state) => state.activePcbLayer)
  const setSelectedLayerId = useCallback((next: string | ((prev: string) => string)) => {
    const current = useAppStore.getState().activePcbLayer
    useAppStore.getState().setActivePcbLayer(typeof next === 'function' ? next(current) : next)
  }, [])
  const [activeTool, setActiveTool] = useState<BoardToolId>('select')
  const activeToolMeta = BOARD_TOOLS.find((tool) => tool.id === activeTool) ?? BOARD_TOOLS[0]
  const [selectedComponentIds, setSelectedComponentIds] = useState<string[]>(() => [...schematicSelection])
  /*
   * The sheet and the board share one selection. Picking parts in either view
   * writes useAppStore, and the other view adopts it during render — keyed on
   * the array identity the store only changes when the selection really moved,
   * so the first paint already shows the parts instead of blinking unselected.
   */
  const [adoptedSelection, setAdoptedSelection] = useState(schematicSelection)
  if (schematicSelection !== adoptedSelection) {
    setAdoptedSelection(schematicSelection)
    setSelectedComponentIds([...schematicSelection])
  }
  const selectComponents = useCallback((ids: string[]) => {
    setSelectedComponentIds(ids)
    setSchematicSelection(ids)
  }, [setSchematicSelection])
  /** Single-part picks (a dropped part, a library placement) go through the same path. */
  const selectComponent = useCallback((id: string | null) => {
    selectComponents(id ? [id] : [])
  }, [selectComponents])
  /*
   * Selecting parts answers "what do they connect to?": their nets stay lit and
   * the rest of the copper recedes. Null (no part, or no net) keeps the board
   * at full contrast.
   */
  const focusedNetNames = useMemo<ReadonlySet<string> | null>(() => {
    if (selectedComponentIds.length === 0) return null
    const owners = new Set(selectedComponentIds)
    const names = new Set<string>()
    for (const net of schematicNets) {
      if (net.connectedPins.some((pin) => owners.has(pin.componentId))) names.add(net.name)
    }
    return names.size > 0 ? names : null
  }, [selectedComponentIds, schematicNets])
  const traces = editor.traces
  const vias = editor.vias
  /** Every net the sheet or the copper names, in one alphabetical list. */
  const allNetNames = useMemo(() => {
    const names = new Set<string>()
    for (const net of schematicNets) if (net.name) names.add(net.name)
    for (const trace of traces) if (trace.netName) names.add(trace.netName)
    for (const via of vias) if (via.netName) names.add(via.netName)
    return [...names].sort((a, b) => a.localeCompare(b))
  }, [schematicNets, traces, vias])
  const classRules = useMemo(
    () => netClassRules(allNetNames, netClasses, netAssignments),
    [allNetNames, netClasses, netAssignments],
  )
  /*
   * Copper belongs to a net, and a net is only real on this board while some
   * land carries it. Tracks and vias left behind after their parts go are
   * floating copper that DRC cannot judge, so name them. Copper is measured
   * against the lands the board actually has: a layout that arrived without a
   * sheet — a demo board or a reopened session — offers no land model, so its
   * net names prove nothing and stay unjudged.
   */
  const netsWithLands = useMemo(() => {
    const names = new Set<string>()
    for (const pad of routerPads) {
      if (pad.netId) names.add(pad.netId)
    }
    return names
  }, [routerPads])
  /** True for named copper whose net has no land left on this board. */
  const isOrphanCopper = useCallback(
    (netName: string) => netsWithLands.size > 0 && netName !== '' && !netsWithLands.has(netName),
    [netsWithLands],
  )
  const orphanCopper = useMemo(() => {
    let traceCount = 0
    let viaCount = 0
    for (const trace of traces) {
      if (isOrphanCopper(trace.netName)) traceCount += 1
    }
    for (const via of vias) {
      if (isOrphanCopper(via.netName)) viaCount += 1
    }
    return { traceCount, viaCount }
  }, [traces, vias, isOrphanCopper])

  /** Width a manual route commits for this net; untouched copper keeps its own. */
  const traceWidthForNet = useCallback(
    (netName: string) => (netName ? (classRules.widths[netName] ?? MANUAL_TRACE_WIDTH_MM) : MANUAL_TRACE_WIDTH_MM),
    [classRules],
  )
  /** The panel's DRC reads the same net classes the router and canvas do. */
  const drcOverrides = useMemo<Partial<DRCSettings>>(() => ({
    ...PANEL_DRC_OVERRIDES,
    netTraceWidth: classRules.widths,
    netClearance: classRules.clearances,
  }), [classRules])
  const [boardWidth, setBoardWidth] = useState(initialLayoutRef.current?.widthMm ?? autoLayout.size.width)
  const [boardHeight, setBoardHeight] = useState(initialLayoutRef.current?.heightMm ?? autoLayout.size.height)
  const [drcViolations, setDrcViolations] = useState<DRCViolation[]>([])
  const [placementPlan, setPlacementPlan] = useState<PlacementPlan | null>(null)
  const [placementMessage, setPlacementMessage] = useState<string | null>(null)
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
    const layers = stackupLayers
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
    const copper = layers.filter((layer) => layer.kind !== 'dielectric')
    const copperOz = copper.length > 0
      ? copper.reduce((sum, layer) => sum + (layer.thickness ?? 1), 0) / copper.length
      : 1
    return { layers, ...validation, reference, z0, widthFor50, copperOz }
  }, [stackupLayers])

  /** Physical board thickness the 3D preview, thermal solver and DRC consume. */
  const boardThicknessMm = Number.isFinite(stackupAnalysis.stackup.totalThickness)
    ? stackupAnalysis.stackup.totalThickness
    : 1.6
  const copperThicknessMm = useMemo(() => {
    const copper = stackupLayers.filter((layer) => layer.kind !== 'dielectric')
    if (copper.length === 0) return THERMAL_COPPER_THICKNESS_MM
    return copper.reduce((sum, layer) => sum + ozToMm(layer.thickness ?? 1), 0) / copper.length
  }, [stackupLayers])

  const powerIntegrity = useMemo(() => ({
    loopInductanceNh: planeLoopInductance(boardWidth, boardHeight, stackupAnalysis.reference?.distance ?? 0.2),
    pourResistanceMohm: pourResistance(boardWidth, boardHeight, stackupAnalysis.copperOz),
    stitchingVias: stitchingGrid(boardWidth, boardHeight, 10, 1).length,
  }), [boardWidth, boardHeight, stackupAnalysis])

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
    /*
     * A net class may ask for wider copper than the house width. The grid has
     * to reserve that width so a wide net is not routed into a gap it cannot
     * legally occupy, while each net still prints its own class width.
     */
    const widestTrace = Math.max(
      boardRouterRules().minTraceWidthMm,
      ...allNetNames.map((name) => traceWidthForNet(name)),
    )
    const result = autoroute(routerPads, {
      boardWidthMm: boardWidth,
      boardHeightMm: boardHeight,
      layers: ['F.Cu', 'B.Cu'],
      keepouts: routerKeepoutsFromPanel(keepouts),
      ...boardRouterRules({
        minTraceWidthMm: widestTrace,
        traceWidthForNet,
      }),
    })

    const newTraces: PCBTrace[] = result.traces.map((t, i) => ({
      id: `trace_${i}`,
      layerId: t.layerId === 'B.Cu' ? 'bot-cu' : 'top-cu',
      width: t.widthMm,
      points: t.points,
      netName: t.netId,
    }))

    // The router redraws the whole copper load, so the parts it was aimed at
    // are no longer "moved since routing".
    applyBoardEdits(current => ({
      ...current,
      traces: newTraces,
      vias: result.vias.map((v, i) => ({
        id: `via_${i}`,
        position: { x: v.x, y: v.y },
        drillDiameter: v.drillMm,
        padDiameter: v.padMm,
        netName: v.netId,
      })),
    }))
    setSelectedCopper(null)

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
  }, [routerPads, boardWidth, boardHeight, keepouts, applyBoardEdits, allNetNames, traceWidthForNet])

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
    applyBoardEdits(current => ({
      ...current,
      traces: [...current.traces, { id: generateId('trace'), ...draft }],
    }))
    invalidateChecks()
  }, [applyBoardEdits, invalidateChecks])

  const handleAddVia = useCallback((via: { position: Point; netName: string }) => {
    applyBoardEdits(current => ({
      ...current,
      vias: [...current.vias, {
        id: generateId('via'),
        position: via.position,
        drillDiameter: 0.3,
        padDiameter: 0.6,
        netName: via.netName,
      }],
    }))
    invalidateChecks()
  }, [applyBoardEdits, invalidateChecks])

  /**
   * Outline drags arrive on every pointer move. The canvas has already snapped
   * and clamped the size, so this only commits it; the copper diagnostics refer
   * to the old outline and are cleared.
   */
  const resizeBoard = useCallback((width: number, height: number) => {
    setBoardWidth(width)
    setBoardHeight(height)
    invalidateChecks()
  }, [invalidateChecks])

  const handleAddKeepout = useCallback((keepout: Omit<PCBKeepout, 'id'>) => {
    const id = generateId('keepout')
    applyBoardEdits(current => ({
      ...current,
      keepouts: [...current.keepouts, { id, ...keepout }],
    }))
    // Pick what was just drawn so Delete removes it without a second click.
    setSelectedCopper({ kind: 'keepout', id })
    invalidateChecks()
  }, [applyBoardEdits, invalidateChecks])

  /**
   * Rip up every piece of copper routed for one net. This is the manual
   * counterpart to the router's own rip-up: the design keeps the net in the
   * ratsnest and the designer re-routes it, with undo restoring the copper in
   * one step. A keep-out is a board constraint, never part of a net, so it is
   * left alone.
   */
  const ripUpNet = useCallback((netName: string) => {
    if (!netName) return
    applyBoardEdits((current) => ({
      ...current,
      traces: current.traces.filter((trace) => trace.netName !== netName),
      vias: current.vias.filter((via) => via.netName !== netName),
    }))
    setSelectedCopper(null)
    invalidateChecks()
  }, [applyBoardEdits, invalidateChecks])

  /** Remove every track and via whose net has no land left on the board. */
  const ripUpOrphanCopper = useCallback(() => {
    applyBoardEdits((current) => ({
      ...current,
      traces: current.traces.filter((trace) => !isOrphanCopper(trace.netName)),
      vias: current.vias.filter((via) => !isOrphanCopper(via.netName)),
    }))
    setSelectedCopper(null)
    invalidateChecks()
  }, [applyBoardEdits, invalidateChecks, isOrphanCopper])

  const updateNetClass = useCallback((
    classId: string,
    patch: Partial<Pick<NetClass, 'traceWidthMm' | 'clearanceMm' | 'patterns'>>,
  ) => {
    setNetClasses((previous) => previous.map((entry) => (
      entry.id === classId ? { ...entry, ...patch } : entry
    )))
  }, [])

  const assignNetToClass = useCallback((netName: string, classId: string) => {
    setNetAssignments((previous) => {
      if (classId === '') {
        if (!(netName in previous)) return previous
        const next = { ...previous }
        delete next[netName]
        return next
      }
      return { ...previous, [netName]: classId }
    })
  }, [])

  const updateStackupLayer = useCallback((
    index: number,
    patch: Partial<Pick<StackupLayer, 'thickness' | 'er'>>,
  ) => {
    setStackupLayers((previous) => previous.map((layer, layerIndex) => (
      layerIndex === index ? { ...layer, ...patch } : layer
    )))
  }, [])

  /**
   * Moves a whole gesture's parts in one snapshot. A drag fires on every
   * pointer move, so the canvas passes one key for the gesture: without it,
   * sliding a part across the board would bury forty snapshots and undo would
   * creep back one pointer event at a time. `seal` on release ends the step.
   */
  const moveComponents = useCallback((moves: Array<{ id: string; position: Point }>, coalesceKey: string) => {
    if (moves.length === 0) return
    const known = new Map(components.map(component => [component.id, component]))
    applyBoardEdits((edit) => {
      const next = { ...edit.placements }
      for (const { id, position } of moves) {
        const component = known.get(id)
        if (!component) continue
        const previous = next[id]
        next[id] = {
          x: position.x,
          y: position.y,
          rotationDeg: previous?.rotationDeg ?? component.rotation,
          side: previous?.side ?? 'top',
        }
      }
      return { ...edit, placements: next }
    }, coalesceKey)
    // Copper was routed to the old lands. Keep it visible for comparison but
    // never let the panel imply it still matches the board.
    setStaleRouting(true)
    invalidateChecks()
  }, [applyBoardEdits, components, invalidateChecks])

  /**
   * One placement patch applied to every selected part as a single undo step —
   * turning a group must not turn each member at a slightly different moment.
   */
  const editSelectedPlacements = useCallback((patchFor: (component: PlacedComponent) => Partial<PlacementEdit>) => {
    if (selectedComponentIds.length === 0) return
    const chosen = new Set(selectedComponentIds)
    const known = new Map(components.map(component => [component.id, component]))
    applyBoardEdits((edit) => {
      const next = { ...edit.placements }
      for (const id of chosen) {
        const component = known.get(id)
        if (!component) continue
        const patch = patchFor(component)
        const previous = next[id]
        next[id] = {
          x: patch.x ?? previous?.x ?? component.position.x,
          y: patch.y ?? previous?.y ?? component.position.y,
          rotationDeg: patch.rotationDeg ?? previous?.rotationDeg ?? component.rotation,
          side: patch.side ?? previous?.side ?? 'top',
        }
      }
      return { ...edit, placements: next }
    })
    setStaleRouting(true)
    invalidateChecks()
  }, [applyBoardEdits, components, selectedComponentIds, invalidateChecks])

  /**
   * A library part dropped on the board. The board is laid out from the sheet,
   * so the part has to exist there first: the drop adds it to the design and
   * records where it landed here, in one gesture that leaves both documents
   * consistent. Each document keeps its own undo, as linked schematic and board
   * documents do — Ctrl+Z here takes back this placement, the sheet's undo
   * removes the part. A new part has no copper yet, so the existing routing is
   * not stale; only the cached checks are.
   */
  const dropLibraryPart = useCallback((componentId: string, at: Point) => {
    const part = library?.find((entry) => entry.id === componentId)
    if (!part) return
    const design = useProjectStore.getState().components
    const placed = placePart(part, design, autoPlace(design, part))
    addStoreComponent(placed)
    applyBoardEdits((edit) => ({
      ...edit,
      placements: {
        ...edit.placements,
        [placed.id]: { x: at.x, y: at.y, rotationDeg: 0, side: 'top' },
      },
    }))
    invalidateChecks()
    selectComponent(placed.id)
  }, [library, addStoreComponent, applyBoardEdits, invalidateChecks, selectComponent])

  /**
   * Click-to-place: the armed part lands where the board was clicked. It goes
   * through the same path as a drop, so both gestures create an identical
   * sheet part plus board placement and undo cleanly per document.
   */
  const placeArmedPart = useCallback((at: Point) => {
    if (!pendingComponent?.id) return
    dropLibraryPart(pendingComponent.id, at)
    onPendingPlaced?.()
  }, [pendingComponent, dropLibraryPart, onPendingPlaced])

  // Escape disarms the palette here too, so a part armed by mistake does not
  // ambush the next click on the board.
  useEffect(() => {
    if (!pendingComponent) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isEditableTarget(event.target)) onPendingPlaced?.()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pendingComponent, onPendingPlaced])

  const rotateSelected = useCallback((stepDeg: number) => {
    editSelectedPlacements(component => ({
      rotationDeg: rotateStep(component.rotation, stepDeg),
    }))
  }, [editSelectedPlacements])

  const flipSelected = useCallback(() => {
    editSelectedPlacements(component => ({
      side: placements[component.id]?.side === 'bottom' ? 'top' : 'bottom',
    }))
  }, [editSelectedPlacements, placements])

  const deleteSelectedCopper = useCallback(() => {
    if (!selectedCopper) return
    const { kind, id } = selectedCopper
    applyBoardEdits((current) => {
      if (kind === 'trace') return { ...current, traces: current.traces.filter(trace => trace.id !== id) }
      if (kind === 'via') return { ...current, vias: current.vias.filter(via => via.id !== id) }
      return { ...current, keepouts: current.keepouts.filter(keepout => keepout.id !== id) }
    })
    setSelectedCopper(null)
    invalidateChecks()
  }, [applyBoardEdits, invalidateChecks, selectedCopper])

  /**
   * Flylines for the lands the copper does not join yet.
   *
   * This is computed from the board as it is now, so it answers "what still
   * needs routing" after every edit — and after a part move, which is exactly
   * when the old tracks stopped meaning anything.
   */
  const ratsnestWires = useMemo<RatsnestWire[]>(
    () => showRatsnest ? ratsnest(routerPads, traces, vias) : [],
    [routerPads, traces, vias, showRatsnest],
  )

  // ── DRC ───────────────────────────────────────────────────────────────────────

  const copperLayerIds = useMemo(
    () => layers
      .filter(layer => layer.type === 'signal' || layer.type === 'power' || layer.type === 'ground')
      .map(layer => layer.id),
    [layers],
  )

  /**
   * The board's lands, as copper a checker can measure.
   *
   * These are the same geometries the autorouter reserved clearance around — the
   * footprint's own size, shape and rotation, translated into the panel's layer
   * naming — so a track run through a neighbour's fan-out is a violation here
   * exactly as it is on the fab's DRC tape.
   */
  const designPads = useMemo<PCBPad[]>(
    () => routerPads.map(pad => {
      const widthMm = pad.padWidthMm ?? pad.padDiameterMm ?? 1.6
      const heightMm = pad.padHeightMm ?? pad.padDiameterMm ?? 1.6
      const face = placements[pad.componentId]?.side === 'bottom' || pad.layer === 'B.Cu' ? 'bot-cu' : 'top-cu'
      return {
        id: `${pad.componentId}.${pad.pinId}`,
        componentId: pad.componentId,
        pinId: pad.pinId,
        position: { x: pad.x, y: pad.y },
        shape: pad.padShape ?? 'circle',
        size: { width: widthMm, height: heightMm },
        rotationDeg: pad.padRotationDeg,
        drillDiameter: pad.padDrillMm,
        // A drilled land is plated through the stackup, so it owns copper on every
        // film; a surface land owns only the face it was placed on.
        layers: (pad.padDrillMm ?? 0) > 0 ? copperLayerIds : [face],
        netId: pad.netId,
      }
    }),
    [routerPads, placements, copperLayerIds],
  )

  /**
   * Adapter from the panel's drawing model to the shared PCB data model.
   *
   * Components are deliberately omitted: the schematic sheet places parts in its
   * own coordinate space, and inventing courtyards there would report overlaps
   * the board does not have. The lands above are not invented — they are the
   * footprints the board is drawn and routed from.
   */
  const boardDesign = useMemo<PCBDesign>(() => {
    const netNames = new Set<string>()
    for (const wire of wires) if (wire.netName) netNames.add(wire.netName)
    for (const trace of traces) if (trace.netName) netNames.add(trace.netName)
    for (const via of vias) if (via.netName) netNames.add(via.netName)

    return {
      id: 'panel-design',
      name: 'PCB Design',
      dimensions: { width: boardWidth, height: boardHeight, thickness: boardThicknessMm },
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
        clearance: classRules.clearances[trace.netName] ?? PANEL_DRC_RULES.minTraceClearance,
      })),
      vias: vias.map(via => ({
        id: via.id,
        position: via.position,
        diameter: via.padDiameter,
        drillDiameter: via.drillDiameter,
        layers: copperLayerIds,
        netId: via.netName,
      })),
      pads: designPads,
      components: [],
      keepouts: keepouts.map(keepout => ({
        id: keepout.id,
        x: keepout.x,
        y: keepout.y,
        width: keepout.width,
        height: keepout.height,
        layers: [...keepout.layers],
      })),
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
        copperThickness: copperThicknessMm,
        solderMaskClearance: 0.1,
        silkScreenClearance: 0.15,
      },
    }
  }, [traces, vias, wires, layers, boardWidth, boardHeight, boardThicknessMm, copperThicknessMm, classRules, designPads, copperLayerIds, keepouts])

  /** Stackup figures the thermal solvers are given, derived from the laminate. */
  const thermalStackup = useMemo(() => {
    const copperLayers = countCopperLayers(layers)
    return {
      copperLayers,
      inPlaneConductivityWmk: effectiveInPlaneConductivityWmk(
        boardThicknessMm,
        copperLayers,
        copperThicknessMm,
      ),
    }
  }, [layers, boardThicknessMm, copperThicknessMm])

  /**
   * The 3D viewer previews this exact object: outline, copper layers, routed
   * traces, vias and footprint bodies. Components are placed with the same
   * coordinates the autorouter used, so the preview cannot show a part where
   * the router did not put it.
   */
  const pcbSceneLayout = useMemo<PcbSceneInput>(() => ({
    widthMm: boardWidth,
    heightMm: boardHeight,
    thicknessMm: boardThicknessMm,
    copperThicknessMm,
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
      net: layer.net,
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
    keepouts: keepouts.map(keepout => ({
      id: keepout.id,
      x: keepout.x,
      y: keepout.y,
      widthMm: keepout.width,
      depthMm: keepout.height,
      layers: [...keepout.layers],
    })),
    components: components
      // Ground symbols annotate a net and have no package; they are not bodies.
      .filter(component => component.component.name !== 'Ground')
      .map(component => ({
        id: component.id,
        reference: component.reference,
        footprint: String(component.properties.footprint ?? component.component.name),
        category: typeof component.component.category === 'string' ? component.component.category : undefined,
        pinCount: component.component.pins.length,
        x: component.position.x,
        y: component.position.y,
        rotationDeg: component.rotation,
        side: placements[component.id]?.side ?? 'top',
      })),
  }), [traces, vias, components, layers, placements, keepouts, boardWidth, boardHeight, boardThicknessMm, copperThicknessMm])

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
    setStaleRouting(false)
    adoptBoardEdits({
      traces: panelTracesFromLayout(storePcbLayout),
      vias: panelViasFromLayout(storePcbLayout),
      placements: panelPlacementsFromLayout(storePcbLayout),
      keepouts: panelKeepoutsFromLayout(storePcbLayout),
    })
    setSelectedCopper(null)
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
  }, [storePcbLayout, adoptBoardEdits])

  useEffect(() => {
    if (adoptingLayoutRef.current) {
      adoptingLayoutRef.current = false
      return
    }
    lastPublishedLayout.current = pcbSceneLayout
    setPcbLayout(pcbSceneLayout)
  }, [pcbSceneLayout, setPcbLayout])

  const handleDRC = useCallback(() => {
    const result = new DesignRuleChecker(boardDesign, drcOverrides).runDRC()
    setDrcViolations(result.violations.map((violation, index): DRCViolation => ({
      id: `${violation.type}_${violation.elementId}_${index}`,
      severity: violation.severity,
      rule: RULE_LABELS[violation.type],
      message: violation.type === 'unconnected_net'
        ? `Net "${violation.elementId}" has no copper trace`
        : violation.message,
      location: violation.location,
      // The same remedy mapping the agent gets, so the panel and the tool agree
      // on what would fix it.
      remedy: result.remedies[index]?.remedy.instruction,
    })))
    setDrcRan(true)
    setActiveTab('drc')
  }, [boardDesign, drcOverrides])

  /**
   * Plan a whole-board re-place without touching anything. Parts that already
   * fit are left where they are, so a tidy layout is not rearranged — the plan
   * only moves what actually collides with something.
   */
  const handlePreviewPlacement = useCallback(() => {
    try {
      const preview = previewPlacement({
        components: components.map(placeableFromPlaced),
        layout: pcbSceneLayout,
      })
      setPlacementPlan(preview.plan)
      setPlacementMessage(
        preview.impact.safe
          ? null
          : 'This plan is not safe to apply; see the warnings above.',
      )
    } catch (cause) {
      setPlacementPlan(null)
      setPlacementMessage(cause instanceof Error ? cause.message : String(cause))
    }
  }, [components, pcbSceneLayout])

  /**
   * Apply the previewed plan as a single edit. `moveComponents` already folds a
   * batch of moves into one snapshot, so cad.undo — and the panel's own undo —
   * puts every part back in one step rather than one at a time.
   */
  const handleApplyPlacement = useCallback(() => {
    if (!placementPlan || placementPlan.moves.length === 0) return
    moveComponents(
      placementPlan.moves.map((move) => ({
        id: move.componentId,
        position: { x: move.to.x, y: move.to.y },
      })),
      'placement-plan',
    )
    setPlacementPlan(null)
    setPlacementMessage('Placement applied. One undo step puts the parts back.')
  }, [moveComponents, placementPlan])

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
        copperThickness: copperThicknessMm,
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
          boardThicknessMm,
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
  }, [components, thermalStackup, boardWidth, boardHeight, boardThicknessMm, copperThicknessMm])

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
    // ratlines: routed traces are the real geometry the fab prints, so each
    // segment keeps the layer it was drawn or routed on.
    const copperFilms = countCopperLayers(layers)
    // An inner film carrying a named net is poured as a solid plane; every
    // other film ships the routed copper the canvas shows.
    const planes: FabPlane[] = []
    for (const layer of layers) {
      const film = fabLayerFromId(layer.id)
      if (film.layer !== 'inner' || film.innerIndex === undefined || !layer.net) continue
      planes.push({ film: `inner-${film.innerIndex}`, netName: layer.net })
    }
    const pkg = buildFabPackage(components, fabCopperFromRoutedTraces(traces), {
      projectName: 'folio-pcb',
      boardWidth,
      boardHeight,
      innerLayerCount: Math.max(0, copperFilms - 2),
      nets: schematicNets,
      planes,
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
    const pourReport = pkg.planes.length
      ? `, ${pkg.planes.map((pour) => `${pour.netName} pour on ${pour.film}`).join(' + ')}`
      : ''
    setFabVerdict(`Fab package: ${pkg.files.size} files on ${copperFilms} copper films${pourReport}, ${pkg.centroid.length} placements — folio-fab-package.zip, shippable.`)
    const archive = createTextZipBytes(pkg.files)
    downloadBlob(new Blob([archive.buffer as ArrayBuffer], { type: 'application/zip' }), 'folio-fab-package.zip')
  }, [components, traces, vias, boardWidth, boardHeight, layers, schematicNets])

  // ── Layer toggle ──────────────────────────────────────────────────────────────

  const toggleLayerVisibility = useCallback((layerId: string) => {
    setLayers(prev => prev.map(l => l.id === layerId ? { ...l, visible: !l.visible } : l))
  }, [])

  /** Declare the net an inner film is poured as; empty clears the pour. */
  const setLayerPlaneNet = useCallback((layerId: string, net: string) => {
    const trimmed = net.trim()
    setLayers(prev => prev.map(l => l.id === layerId ? { ...l, net: trimmed || undefined } : l))
  }, [])

  // ── DRC summary ───────────────────────────────────────────────────────────────
  const drcErrors = useMemo(() => drcViolations.filter(v => v.severity === 'error').length, [drcViolations])
  const drcWarnings = useMemo(() => drcViolations.filter(v => v.severity === 'warning').length, [drcViolations])
  /**
   * Findings the canvas can point at. A violation with no location — an unrouted
   * net, a length rule — stays in the list, because pinning it to a coordinate
   * the checker never produced would be inventing geometry.
   */
  const drcMarkers = useMemo<DrcMarker[]>(
    () => drcViolations
      .filter(violation => violation.location)
      .map(violation => ({
        id: violation.id,
        severity: violation.severity,
        x: violation.location?.x ?? 0,
        y: violation.location?.y ?? 0,
        message: violation.message,
      })),
    [drcViolations],
  )

  /**
   * What the last DRC run was actually given. A clean verdict has to name the
   * geometry it measured, so it cannot imply a board is ready to fab while a whole
   * rule family ran against an empty list.
   */
  const drcScope = useMemo(() => {
    const traceCount = boardDesign.traces.length
    const viaCount = boardDesign.vias.length
    const padCount = boardDesign.pads.length
    const skipped: string[] = []
    if (padCount === 0) {
      skipped.push('pad size, drill and annular ring, and pad-to-trace, pad-to-pad and pad-to-via clearance — no part is placed, so there is no land to measure')
      skipped.push('net continuity beyond copper presence, since the split-island test needs two or more pads on a net')
    }
    if (boardDesign.components.length === 0) {
      skipped.push('courtyard overlap between footprints — the board places its lands, not package outlines')
    }
    const lands = `${padCount} land${padCount === 1 ? '' : 's'}`
    const keepoutCount = boardDesign.keepouts?.length ?? 0
    return {
      checked: `${traceCount} trace${traceCount === 1 ? '' : 's'}, ${viaCount} via${viaCount === 1 ? '' : 's'}, ${lands} and ${keepoutCount} keep-out${keepoutCount === 1 ? '' : 's'}`,
      skipped,
    }
  }, [boardDesign])

  // ── Keyboard ──────────────────────────────────────────────────────────────────

  /*
   * Rotate, flip, delete and undo are the four edits a board designer reaches
   * for constantly, and every one of them was previously mouse-only. The refs
   * keep the listener registered once — re-attaching it per selection change is
   * what made the schematic's older handler stale.
   */
  const shortcutOverrides = useShortcutStore((state) => state.overrides)
  const keyboardRef = useRef({
    rotateSelected, flipSelected, deleteSelectedCopper,
    undoBoardEdits, redoBoardEdits, selectedCopper,
  })
  keyboardRef.current = {
    rotateSelected, flipSelected, deleteSelectedCopper,
    undoBoardEdits, redoBoardEdits, selectedCopper,
  }
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return
      const bound = (id: string) => matchesShortcut(event, id, shortcutOverrides)
      if (bound('pcb.rotate')) {
        event.preventDefault()
        keyboardRef.current.rotateSelected(90)
      } else if (bound('pcb.rotateReverse')) {
        event.preventDefault()
        keyboardRef.current.rotateSelected(-90)
      } else if (bound('pcb.flip')) {
        event.preventDefault()
        keyboardRef.current.flipSelected()
      } else if (bound('pcb.undo')) {
        event.preventDefault()
        keyboardRef.current.undoBoardEdits()
      } else if (bound('pcb.redo')) {
        event.preventDefault()
        keyboardRef.current.redoBoardEdits()
      } else if (bound('pcb.deleteSelection') && keyboardRef.current.selectedCopper) {
        // Only when copper is picked: with a part selected, Delete must not
        // quietly strip a track the designer never aimed at.
        event.preventDefault()
        keyboardRef.current.deleteSelectedCopper()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [shortcutOverrides])

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto bg-background">
      <div className="flex min-h-full w-full flex-col bg-card">

        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-border bg-card/80 px-4 py-2">
          <h3 className="shrink-0 font-semibold">PCB Design</h3>
          {/* Below `lg` the palette sheds its labels, and a label-less rail can
              only be read by hovering — which touch and keyboard users cannot
              do. The active tool's gesture moves up here so the next click is
              always stated in the open. `truncate` keeps the header one line
              tall whatever the hint says. */}
          <p className="min-w-0 flex-1 truncate text-center text-[11px] text-muted-foreground lg:hidden">
            {activeToolMeta.hint}
          </p>
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
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 gap-1"
                onClick={onPreview3D}
                aria-label="Preview the board in 3D"
              >
                <Box className="w-4 h-4" />
                <span className="hidden sm:inline">Preview 3D</span>
              </Button>
            )}
            <HoverHelp title="Leave the board editor; closing writes nothing to the design." description="Leave the board editor; closing writes nothing to the design.">
<Button variant="ghost" size="icon" onClick={onClose} aria-label="Close PCB panel"><X className="w-4 h-4" /></Button>
</HoverHelp>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="flex min-h-0 flex-1">
          {/* Left: Tool palette. Labelled and grouped so each tool is findable
              by intent; the hint under the rail states what the next gesture does.
              Below `lg` the palette narrows to a 48px icon rail instead of
              stretching across the top of the board: twelve controls in a row
              cost the canvas its height, which it needs far more than the 96px
              of width the rail gives back.
              Each tool keeps its name as `aria-label` and tooltip, and the
              active tool's hint moves to the header, so nothing is readable
              only by hovering. The rail scrolls without a visible bar: an 11px
              scrollbar would take that width off the content box, squeeze every
              32px button to the 24px floor and shift each icon off the rail's
              centre line — measured here, not guessed. */}
          <aside
            aria-label="Board tools"
            className="flex w-12 shrink-0 flex-col gap-3 overflow-y-auto scrollbar-none border-r border-border bg-card/50 p-2 lg:w-36"
          >
            {BOARD_TOOL_GROUPS.map((group) => (
              <div key={group.title} role="group" aria-label={group.title}>
                <p className={`mb-1 hidden px-1 text-[11px] font-semiboldr lg:block ${group.tone}`}>
                  {group.title}
                </p>
                <div className="flex flex-col gap-1">
                  {group.tools.map((tool) => {
                    const Icon = tool.icon
                    const active = activeTool === tool.id
                    return (
                      <Button
                        key={tool.id}
                        variant={active ? 'default' : 'outline'}
                        size="sm"
                        className="h-8 w-full justify-center px-0 text-xs lg:justify-start lg:gap-2 lg:px-2"
                        onClick={() => setActiveTool(tool.id)}
                        title={tool.help}
                        aria-label={tool.label}
                        aria-pressed={active}
                      >
                        <Icon className={`h-3.5 w-3.5 shrink-0 ${active ? '' : group.tone}`} />
                        <span className="hidden truncate lg:inline">{tool.label}</span>
                      </Button>
                    )
                  })}
                </div>
              </div>
            ))}

            {/* Edit commands. Rotate and flip act on the selected part; undo and
                redo act on the whole board, copper included. One column on the
                icon rail: three abreast at 40px of content would put each target
                under the 24px floor. */}
            <div role="group" aria-label="Part edits">
              <p className="mb-1 hidden px-1 text-[11px] font-semiboldr text-muted-foreground lg:block">
                Part
              </p>
              <div className="grid grid-cols-1 gap-1 lg:grid-cols-3">
                <HoverHelp title="Rotate left" description="Rotate the selected part 90° counter-clockwise." keys={['Shift', 'R']}>
                  <Button
                    variant="outline" size="icon" className="h-8 w-full"
                    disabled={selectedComponentIds.length === 0}
                    onClick={() => rotateSelected(-90)}
                    aria-label="Rotate left"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </Button>
                </HoverHelp>
                <HoverHelp title="Rotate right" description="Rotate the selected part 90° clockwise." keys={['R']}>
                  <Button
                    variant="outline" size="icon" className="h-8 w-full"
                    disabled={selectedComponentIds.length === 0}
                    onClick={() => rotateSelected(90)}
                    aria-label="Rotate right"
                  >
                  <RotateCw className="w-3.5 h-3.5" />
                  </Button>
                </HoverHelp>
                <HoverHelp title="Move the selected part to the other face of the board — F" description="Move the selected part to the other face of the board — F">
<Button variant="outline" size="icon" className="h-8 w-full"
                  disabled={selectedComponentIds.length === 0}
                  onClick={flipSelected} aria-label="Flip to other side">
                  <FlipVertical className="w-3.5 h-3.5" />
                </Button>
</HoverHelp>
              </div>
            </div>

            <div role="group" aria-label="History">
              <p className="mb-1 hidden px-1 text-[11px] font-semiboldr text-muted-foreground lg:block">
                History
              </p>
              <div className="grid grid-cols-1 gap-1 lg:grid-cols-2">
                <HoverHelp title="Undo the last board edit — Ctrl+Z" description="Undo the last board edit — Ctrl+Z">
<Button variant="outline" size="icon" className="h-8 w-full"
                  disabled={!editor.canUndo}
                  onClick={undoBoardEdits} aria-label="Undo">
                  <Undo2 className="w-3.5 h-3.5" />
                </Button>
</HoverHelp>
                <HoverHelp title="Redo the last undone edit — Ctrl+Shift+Z" description="Redo the last undone edit — Ctrl+Shift+Z">
<Button variant="outline" size="icon" className="h-8 w-full"
                  disabled={!editor.canRedo}
                  onClick={redoBoardEdits} aria-label="Redo">
                  <Redo2 className="w-3.5 h-3.5" />
                </Button>
</HoverHelp>
              </div>
            </div>

            <div className="mt-auto hidden rounded-md border border-border bg-muted/40 p-2 lg:block">
              <p className="text-[11px] font-semiboldr text-muted-foreground">
                Active tool
              </p>
              <p className="mt-0.5 text-xs font-semibold text-foreground">{activeToolMeta.label}</p>
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{activeToolMeta.hint}</p>
            </div>
          </aside>

          {/* Centre: Canvas + tabs */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 min-h-0">
              {/* The seven analysis tabs take the width they are given and spill
                  onto a second line on a narrow sheet. Scrolling them sideways was
                  worse: a hidden rail leaves no cue that an analysis exists, and
                  the strip is wide enough on any normal window that the scroll
                  never appeared anyway. `justify-start` still matters — a centred
                  flex row overflows at the *left*, which no scrollbar can reach. */}
              <TabsList className="mx-2 mt-2 flex h-auto w-auto flex-wrap items-center justify-start gap-1 text-xs">
                <TabsTrigger value="canvas" className="h-7 shrink-0 px-3 text-xs">Canvas</TabsTrigger>
                <TabsTrigger value="drc" className="h-7 shrink-0 px-3 text-xs">DRC</TabsTrigger>
                <TabsTrigger value="emc" className="h-7 shrink-0 px-3 text-xs">EMC</TabsTrigger>
                <TabsTrigger value="thermal" className="h-7 shrink-0 px-3 text-xs">Thermal</TabsTrigger>
                <TabsTrigger value="si" className="h-7 shrink-0 px-3 text-xs">Signal</TabsTrigger>
                <TabsTrigger value="advanced" className="h-7 shrink-0 px-3 text-xs">Advanced</TabsTrigger>
                <TabsTrigger value="assembly" className="h-7 shrink-0 px-3 text-xs">Assembly</TabsTrigger>
              </TabsList>

              {/* The board keeps a real floor (180px) and the tab pane scrolls
                  instead of yielding: at a short window the size and snap rows
                  above left the drawing 0px tall — measured, not hypothetical —
                  which is the one failure a CAD canvas must never have. On a
                  normal window nothing scrolls and the board still takes all the
                  slack. */}
              <TabsContent value="canvas" className="flex-1 min-h-[180px] overflow-y-auto scrollbar-thin p-2 flex flex-col gap-2">
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
                    Outline {boardWidth} × {boardHeight} mm · {boardThicknessMm.toFixed(2)} mm FR-4 · {stackupAnalysis.copperOz.toFixed(1)} oz copper
                  </p>
                </div>

                {/* Canvas drawing controls: the grid clicks snap to, and whether
                    the un-routed flylines are shown. */}
                <div className="flex flex-wrap items-center gap-3 px-1">
                  <div role="group" aria-label="Snap grid size" className="flex items-center gap-1">
                    <span className="text-xs font-medium text-muted-foreground">Snap</span>
                    {SNAP_GRID_OPTIONS.map((size) => (
                      <Button
                        key={size}
                        variant={snapGridMm === size ? 'default' : 'outline'}
                        size="sm"
                        className="h-6 px-2 text-[11px] tabular-nums"
                        aria-pressed={snapGridMm === size}
                        title={`Place copper on a ${size} mm grid`}
                        onClick={() => setSnapGridMm(size)}
                      >
                        {size}
                      </Button>
                    ))}
                    <span className="text-[11px] text-muted-foreground">mm</span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={showRatsnest}
                    onClick={() => setShowRatsnest((current) => !current)}
                    title="Show a flyline for every pair of lands the copper does not join yet"
                    className={`flex h-6 items-center gap-2 rounded-md border px-2 text-[11px] font-medium transition-colors ${
                      showRatsnest
                        ? 'border-primary/50 bg-primary/10 text-primary'
                        : 'border-border bg-background text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`h-2.5 w-2.5 rounded-full ${showRatsnest ? 'bg-primary' : 'bg-muted-foreground/50'}`}
                    />
                    Ratsnest
                    <span className="tabular-nums text-muted-foreground">
                      {ratsnestWires.length}
                    </span>
                  </button>
                </div>
                {/* Tool hint. Hidden on short windows: it scrolls away with the
                    pane at 800×527 and is the difference between the board
                    rendering and being clipped to zero height. */}
                <p className="hidden px-1 text-[11px] leading-snug text-muted-foreground xl:block">
                  {activeTool === 'select' && (pendingComponent
                    ? `${pendingComponent.name} is armed: click the board to place it on the snap grid, or press Escape to cancel.`
                    : 'Click a part to select it, Shift-click to add another, or click a track or via to pick it up. Drag a part (or a whole selected group) to move it; drop a part from the Library to add it to the design at that spot. Drag the empty board to marquee-select parts, Shift-drag to add to the selection, middle-drag to pan; wheel to zoom. R rotates, Shift+R rotates back, F flips to the other face, Delete removes picked copper, Ctrl+Z undoes the board edit.')}
                  {activeTool === 'move' && 'Drag a part — or every selected part together — to reposition it on the snap grid; one drag is one undo. Copper is not re-routed automatically; the flylines show what no longer connects.'}
                  {activeTool === 'route' && `Click to lay copper on the active layer. Snaps to lands and the ${snapGridMm} mm grid. Double-click, Enter or Finish ends the track; right-click or Escape cancels.`}
                  {activeTool === 'via' && 'Click to drop a 0.6 mm via with a 0.3 mm drill. It joins the same net on every layer it touches.'}
                  {activeTool === 'keepout' && `Drag a rectangle to bar copper from it. It applies to all copper layers; hold Alt to restrict it to the active layer. The router and DRC both enforce it. Click a keep-out to pick it and press Delete to remove it.`}
                  {activeTool === 'measure' && 'Click one point, then another: the ruler shows the straight-line distance and the Δx/Δy components. Endpoints snap to lands and the grid. Right-click or Escape clears it.'}
                  {activeTool === 'outline' && 'Drag the right, bottom or corner handle to resize the rectangular outline (10–500 mm). The origin stays fixed; parts, copper and keep-outs keep their coordinates.'}
                </p>
                {staleRouting ? (
                  <div role="status" className="mx-1 flex items-start gap-2 rounded border border-warning/40 bg-warning/10 px-2 py-1 text-xs text-warning">
                    <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" />
                    Parts moved after routing — existing copper no longer matches every pad. Re-route before running DRC or exporting.
                  </div>
                ) : null}
                {orphanCopper.traceCount + orphanCopper.viaCount > 0 ? (
                  <div role="status" className="mx-1 flex items-start gap-2 rounded border border-warning/40 bg-warning/10 px-2 py-1 text-xs text-warning">
                    <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" />
                    <span className="flex-1">
                      {orphanCopper.traceCount} track(s) and {orphanCopper.viaCount} via(s) name a net
                      that no land on this board carries — their parts left, the copper stayed.
                      DRC cannot judge copper that connects nothing.
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={ripUpOrphanCopper}
                      aria-label="Rip up orphan copper"
                      className="h-6 flex-shrink-0 px-2 text-[11px]"
                    >
                      Rip up
                    </Button>
                  </div>
                ) : null}
                <div className="min-h-[180px] flex-1">
                  <PCBCanvas
                    traces={traces}
                    vias={vias}
                    keepouts={keepouts}
                    boardWidth={boardWidth}
                    boardHeight={boardHeight}
                    selectedLayerId={selectedLayerId}
                    layers={layers}
                    scene={pcbScene}
                    activeTool={activeTool}
                    selectedComponentIds={selectedComponentIds}
                    selectedCopper={selectedCopper}
                    routerPads={routerPads}
                    focusedNetNames={focusedNetNames}
                    snapGridMm={snapGridMm}
                    traceWidthForNet={traceWidthForNet}
                    ratsnestWires={ratsnestWires}
                    drcMarkers={drcMarkers}
                    onSelectComponents={selectComponents}
                    onMoveComponents={moveComponents}
                    onAddTrace={handleAddTrace}
                    onAddVia={handleAddVia}
                    onAddKeepout={handleAddKeepout}
                    onSelectCopper={setSelectedCopper}
                    onEndGesture={sealBoardEdits}
                    onResizeBoard={resizeBoard}
                    onDropPart={library ? dropLibraryPart : undefined}
                    onPlaceArmed={pendingComponent ? placeArmedPart : undefined}
                  />
                </div>
              </TabsContent>

              <TabsContent value="drc" className="flex-1 overflow-y-auto p-3 space-y-2">
                <div className="text-sm font-medium">Design Rule Check — {drcViolations.length} issue{drcViolations.length !== 1 ? 's' : ''}</div>
                {!drcRan && <p className="text-muted-foreground text-sm">Click "Run DRC" to check your design.</p>}
                <div className="space-y-1 rounded border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
                  <p>
                    Checked: {drcScope.checked} — trace width and same-layer clearance, land size,
                    drill and annular ring, land-to-land, land-to-trace and land-to-via clearance,
                    via size and via-to-trace clearance, acute corners, copper inside any keep-out,
                    and whether copper crosses the rectangular board outline. Trace-length rules are
                    off for this board.
                  </p>
                  {drcScope.skipped.length > 0 && (
                    <p>Not checked: {drcScope.skipped.join('; ')}.</p>
                  )}
                </div>
                {drcViolations.map(v => (
                  <div key={v.id} className={`flex items-start gap-2 p-2 rounded text-xs border ${v.severity === 'error' ? 'bg-destructive/10 border-destructive/40 text-destructive' : 'bg-warning/10 border-warning/40 text-warning'}`}>
                    <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                    <div>
                      <div><span className="font-medium">[{v.rule}]</span> {v.message}</div>
                      {v.remedy && (
                        <p className="mt-1 opacity-90">
                          <span className="font-medium">Fix:</span> {v.remedy}
                        </p>
                      )}
                    </div>
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
                      {boardWidth} × {boardHeight} mm of {boardThicknessMm.toFixed(2)} mm FR-4 with {thermalStackup.copperLayers} copper layer(s).
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
                      <div key={`${layer.name}-${index}`} className="flex items-center justify-between gap-2">
                        <span className="min-w-0 flex-1 truncate capitalize">
                          {layer.name} <span className="text-muted-foreground">{layer.kind}</span>
                        </span>
                        {layer.kind === 'dielectric' ? (
                          <div className="flex shrink-0 items-center gap-1">
                            <input
                              aria-label={`${layer.name} ${index + 1} dielectric thickness in millimetres`}
                              type="number"
                              min={0.05}
                              step={0.01}
                              value={layer.thickness ?? 0}
                              onFocus={(event) => event.target.select()}
                              onChange={(event) => {
                                const value = Number(event.target.value)
                                if (Number.isFinite(value) && value > 0) updateStackupLayer(index, { thickness: value })
                              }}
                              className="w-14 rounded border border-input bg-background px-1 py-0.5 text-[11px]"
                            />
                            <span className="text-[10px] text-muted-foreground">mm</span>
                            <input
                              aria-label={`${layer.name} ${index + 1} dielectric constant`}
                              type="number"
                              min={1}
                              step={0.1}
                              value={layer.er ?? 4.4}
                              onFocus={(event) => event.target.select()}
                              onChange={(event) => {
                                const value = Number(event.target.value)
                                if (Number.isFinite(value) && value >= 1) updateStackupLayer(index, { er: value })
                              }}
                              className="w-14 rounded border border-input bg-background px-1 py-0.5 text-[11px]"
                            />
                            <span className="text-[10px] text-muted-foreground">εr</span>
                          </div>
                        ) : (
                          <div className="flex shrink-0 items-center gap-1">
                            <input
                              aria-label={`${layer.name} copper weight in ounces`}
                              type="number"
                              min={0.25}
                              step={0.25}
                              value={layer.thickness ?? 1}
                              onFocus={(event) => event.target.select()}
                              onChange={(event) => {
                                const value = Number(event.target.value)
                                if (Number.isFinite(value) && value > 0) updateStackupLayer(index, { thickness: value })
                              }}
                              className="w-14 rounded border border-input bg-background px-1 py-0.5 text-[11px]"
                            />
                            <span className="text-[10px] text-muted-foreground">oz</span>
                            {layer.net ? <span className="text-[10px] text-muted-foreground">· {layer.net}</span> : null}
                          </div>
                        )}
                      </div>
                    ))}
                    <div className="flex justify-end pt-1">
                      <Button
                        variant="ghost"
                        className="h-6 px-2 text-[11px] font-normal text-muted-foreground"
                        onClick={() => setStackupLayers(fourLayerStackup())}
                      >
                        Standard 4-layer
                      </Button>
                    </div>
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

              <TabsContent value="assembly" className="flex-1 overflow-y-auto p-3 space-y-4">
                <SourcingPanel components={components} />
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
                  {layers.map(layer => {
                    const film = fabLayerFromId(layer.id)
                    const innerFilm = film.layer === 'inner' ? film.innerIndex : undefined
                    return (
                      <div key={layer.id} className="space-y-1">
                        <div
                          className={`flex items-center justify-between p-1.5 rounded cursor-pointer text-xs transition-colors ${selectedLayerId === layer.id ? 'bg-primary/15 border border-primary/30' : 'hover:bg-accent'}`}
                          onClick={() => setSelectedLayerId(layer.id)}
                        >
                          <div className="flex items-center gap-2">
                            <div className="cad-swatch w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: layer.color }} />
                            <span>{layer.name}</span>
                          </div>
                          <HoverHelp title={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`} description="Show or hide this layer in the board view.">
                            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={e => { e.stopPropagation(); toggleLayerVisibility(layer.id) }} aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}>
                              {layer.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3 opacity-40" />}
                            </Button>
                          </HoverHelp>
                        </div>
                        {innerFilm !== undefined ? (
                          <div className="flex items-center gap-1.5 pl-1.5">
                            <label htmlFor={`plane-net-${layer.id}`} className="text-[11px] text-muted-foreground">Pour</label>
                            <select
                              id={`plane-net-${layer.id}`}
                              className="min-w-0 flex-1 rounded border border-input bg-background px-1.5 py-0.5 text-[11px]"
                              value={layer.net ?? ''}
                              onClick={e => e.stopPropagation()}
                              onChange={e => setLayerPlaneNet(layer.id, e.target.value)}
                            >
                              <option value="">routed copper</option>
                              {schematicNets.map(net => (
                                <option key={net.id} value={net.name}>{net.name}</option>
                              ))}
                              {layer.net && !schematicNets.some(net => net.name === layer.net) ? (
                                <option value={layer.net}>{layer.net} (no barrel)</option>
                              ) : null}
                            </select>
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </CardContent>
              </Card>

              {/* Routing */}
              <Card>
                <CardHeader className="pb-2 pt-3 px-3">
                  <CardTitle className="text-xs flex items-center gap-1"><Route className="w-3 h-3" /> Routing</CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-3 space-y-2">
                  <Button className="w-full h-7 text-xs" onClick={handleAutoRoute}>
                    <Waypoints className="w-3 h-3 mr-1" /> Auto-Route from Schematic
                  </Button>
                  <div className="text-xs text-muted-foreground">Traces: {traces.length} | Vias: {vias.length}</div>
                </CardContent>
              </Card>

              {/* Placement: preview first, apply second, one undo step. */}
              <Card>
                <CardHeader className="pb-2 pt-3 px-3">
                  <CardTitle className="text-xs flex items-center gap-1"><Package className="w-3 h-3" /> Placement</CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-3 space-y-2">
                  <Button
                    className="w-full h-7 text-xs"
                    onClick={handlePreviewPlacement}
                    disabled={components.length === 0}
                  >
                    <Package className="w-3 h-3 mr-1" /> Preview re-place
                  </Button>

                  {placementMessage && (
                    <p className="text-[11px] text-warning">{placementMessage}</p>
                  )}

                  {placementPlan && (
                    <div className="space-y-1.5 rounded border border-border bg-muted/30 p-2 text-xs">
                      <p className="font-medium text-foreground">
                        {placementPlan.moves.length === 0
                          ? 'Every part already fits'
                          : `${placementPlan.moves.length} part(s) would move`}
                      </p>
                      {placementPlan.moves.length > 0 && (
                        <p className="text-muted-foreground">
                          {`Total travel ${placementPlan.totalDistanceMm.toFixed(1)} mm. `
                            + 'Parts that already fit are left alone.'}
                        </p>
                      )}
                      {placementPlan.unplaced.length > 0 && (
                        <p className="text-warning">
                          {`${placementPlan.unplaced.length} part(s) have no free space and would stay put.`}
                        </p>
                      )}
                      {placementPlan.moves.length > 0 && (
                        <div className="flex items-center gap-1.5 pt-0.5">
                          <Button
                            size="sm"
                            className="h-6 text-[11px]"
                            onClick={handleApplyPlacement}
                            disabled={placementPlan.unplaced.length > 0}
                          >
                            Apply
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 text-[11px]"
                            onClick={() => setPlacementPlan(null)}
                          >
                            Discard
                          </Button>
                        </div>
                      )}
                      {placementPlan.moves.length === 0 && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-[11px]"
                          onClick={() => setPlacementPlan(null)}
                        >
                          Discard
                        </Button>
                      )}
                      {placementPlan.unplaced.length > 0 && (
                        <p className="text-[11px] text-muted-foreground">
                          Apply is disabled because a part would be left without a home.
                        </p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Net classes: one rule set for routing, manual copper and DRC. */}
              <Card>
                <CardHeader className="pb-2 pt-3 px-3">
                  <CardTitle className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1"><BoxSelect className="w-3 h-3" /> Net classes</span>
                    <Button
                      variant="ghost"
                      className="h-5 px-1.5 text-[10px] font-normal text-muted-foreground"
                      onClick={() => { setNetClasses(DEFAULT_NET_CLASSES); setNetAssignments({}) }}
                    >
                      Reset
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 px-3 pb-3">
                  {netClasses.map((entry) => {
                    const members = allNetNames.filter((name) => resolveNetClass(name, netClasses, netAssignments)?.id === entry.id).length
                    return (
                      <div key={entry.id} className="space-y-1 rounded border border-border p-1.5">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-medium">{entry.name}</span>
                          <span className="text-muted-foreground">{members} net{members === 1 ? '' : 's'}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <label htmlFor={`class-width-${entry.id}`} className="text-[11px] text-muted-foreground">Width</label>
                          <input
                            id={`class-width-${entry.id}`}
                            aria-label={`${entry.name} trace width in millimetres`}
                            type="number"
                            min={0.05}
                            step={0.01}
                            value={entry.traceWidthMm}
                            onFocus={(event) => event.target.select()}
                            onChange={(event) => {
                              const value = Number(event.target.value)
                              if (Number.isFinite(value) && value > 0) updateNetClass(entry.id, { traceWidthMm: value })
                            }}
                            className="w-16 rounded border border-input bg-background px-1.5 py-0.5 text-[11px]"
                          />
                          <label htmlFor={`class-clearance-${entry.id}`} className="text-[11px] text-muted-foreground">Clear</label>
                          <input
                            id={`class-clearance-${entry.id}`}
                            aria-label={`${entry.name} clearance in millimetres`}
                            type="number"
                            min={0.05}
                            step={0.01}
                            value={entry.clearanceMm}
                            onFocus={(event) => event.target.select()}
                            onChange={(event) => {
                              const value = Number(event.target.value)
                              if (Number.isFinite(value) && value > 0) updateNetClass(entry.id, { clearanceMm: value })
                            }}
                            className="w-16 rounded border border-input bg-background px-1.5 py-0.5 text-[11px]"
                          />
                          <span className="text-[10px] text-muted-foreground">mm</span>
                        </div>
                        <input
                          aria-label={`${entry.name} net patterns`}
                          value={entry.patterns.join(', ')}
                          placeholder="net patterns, comma separated"
                          onFocus={(event) => event.target.select()}
                          onChange={(event) => updateNetClass(entry.id, {
                            patterns: event.target.value.split(',').map((pattern) => pattern.trim()).filter(Boolean),
                          })}
                          className="w-full rounded border border-input bg-background px-1.5 py-0.5 text-[10px]"
                        />
                      </div>
                    )
                  })}
                  <details className="rounded border border-border px-1.5 py-1">
                    <summary className="cursor-pointer text-[11px] text-muted-foreground">
                      Nets ({allNetNames.length}) — assign class or rip up
                    </summary>
                    <div className="mt-1 max-h-56 space-y-1 overflow-y-auto pr-1">
                      {allNetNames.length === 0 ? (
                        <p className="py-1 text-[11px] text-muted-foreground">No nets yet: place or load a circuit first.</p>
                      ) : allNetNames.map((name) => {
                        const effective = resolveNetClass(name, netClasses, netAssignments)
                        const routedMm = netLengths.get(name) ?? 0
                        const hasCopper = traces.some((trace) => trace.netName === name)
                          || vias.some((via) => via.netName === name)
                        return (
                          <div key={name} className="flex items-center gap-1 text-[11px]">
                            <span className="min-w-0 flex-1 truncate" title={name}>{name}</span>
                            <span className="w-12 shrink-0 text-right text-muted-foreground">{routedMm > 0 ? `${routedMm.toFixed(1)} mm` : '—'}</span>
                            <select
                              aria-label={`Class for ${name}`}
                              value={netAssignments[name] ?? ''}
                              onChange={(event) => assignNetToClass(name, event.target.value)}
                              className="w-24 shrink-0 rounded border border-input bg-background px-1 py-0.5 text-[10px]"
                            >
                              <option value="">Auto — {effective?.name ?? 'none'}</option>
                              {netClasses.map((entry) => (
                                <option key={entry.id} value={entry.id}>{entry.name}</option>
                              ))}
                            </select>
                            <HoverHelp title={hasCopper ? `Rip up every track and via on ${name}` : `${name} has no routed copper`} description={hasCopper ? `Rip up every track and via on ${name}.` : `${name} has no routed copper to rip up.`}>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-5 w-5 shrink-0"
                                disabled={!hasCopper}
                                onClick={() => ripUpNet(name)}
                                aria-label={`Rip up ${name}`}
                              >
                                <X className="w-3 h-3" />
                              </Button>
                            </HoverHelp>
                          </div>
                        )
                      })}
                    </div>
                  </details>
                  <p className="text-[10px] leading-snug text-muted-foreground">
                    Width applies to new manual routes and auto-routed copper. Clearance is enforced by DRC
                    on top of the board minimum; a class can tighten a rule, never loosen it.
                  </p>
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
