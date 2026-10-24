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

import { useState, useCallback, useMemo, useEffect, useRef, type ChangeEvent } from 'react'
import {
  X, Layers, Route, Zap, Grid3X3, Eye, EyeOff, Download, Settings,
  Ruler, RotateCcw, Move, MousePointer, Thermometer, Wifi, AlertTriangle, CheckCircle,
  Cpu, Upload, GitCompare, Box,
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
import { autoroute, buildRouterPads } from '../../lib/manufacturing/autorouter'
import {
  DEFAULT_DRC_RULES,
  DesignRuleChecker,
  type DRCRuleType,
  type DRCSettings,
} from '../../lib/manufacturing/drc'
import type { PCBDesign } from '../../lib/manufacturing/pcb'
import type { PcbSceneInput } from '../../lib/pcb/pcbScene'
import { useDemoRequest } from '../workspace/useDemoRequest'
import { polylineLength } from '../../lib/geometry/distance'
import {
  fourLayerStackup,
  microstripImpedance,
  nearestPlane,
  pairSkewPs,
  validateStackup,
  widthForImpedance,
} from '../../lib/manufacturing/stackup'
import { planeLoopInductance, pourResistance, stitchingGrid } from '../../lib/manufacturing/powerIntegrity'
import { dogboneFanout, escapeTracksPerChannel, MICROVIA_FANOUT_RULES } from '../../lib/manufacturing/bgaFanout'
import { interfaceGroup, powerRails, SOC_256, validateBallMap } from '../../lib/electronics/socPackages'
import { meanderForSkew, USB2_HS } from '../../lib/manufacturing/diffPair'
import { parseIbis, type IbisFile } from '../../lib/manufacturing/ibisModel'
import { checkDqsGroup, checkFlyby, DDR3_1600, type DqsViolation } from '../../lib/manufacturing/ddrRouting'
import {
  STD_HDI_RULES,
  validateViaSpan,
  type HdiStackup,
} from '../../lib/manufacturing/hdiRouting'
import DesignCalculatorsPanel from '../electronics/DesignCalculatorsPanel'

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

function PCBCanvas({
  traces, vias, boardWidth, boardHeight, selectedLayerId, layers,
}: {
  traces: PCBTrace[]
  vias: PCBVia[]
  boardWidth: number
  boardHeight: number
  selectedLayerId: string
  layers: PCBLayer[]
}) {
  const layerColor = (id: string) => layers.find(l => l.id === id)?.color ?? '#00ff00'

  return (
    <div className="relative h-full w-full overflow-hidden rounded bg-canvas">
      <svg width="100%" height="100%" viewBox={`0 0 ${boardWidth} ${boardHeight}`} className="absolute inset-0">
        {/* Board edge */}
        <rect x={0} y={0} width={boardWidth} height={boardHeight} fill="#2d5a27" stroke="#1a4a1a" strokeWidth="1" />
        {/* Grid */}
        <defs>
          <pattern id="pcb-grid" width="5" height="5" patternUnits="userSpaceOnUse">
            <path d="M5 0L0 0 0 5" fill="none" stroke="#3a5a3a" strokeWidth="0.3" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#pcb-grid)" />

        {/* Traces (visible layers only) */}
        {traces
          .filter(t => layers.find(l => l.id === t.layerId)?.visible)
          .map(trace => (
            <polyline
              key={trace.id}
              points={trace.points.map(p => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke={selectedLayerId === trace.layerId ? '#ffffff' : layerColor(trace.layerId)}
              strokeWidth={trace.width}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={selectedLayerId === trace.layerId ? 1 : 0.6}
            />
          ))}

        {/* Vias */}
        {vias.map(via => (
          <g key={via.id}>
            <circle cx={via.position.x} cy={via.position.y} r={via.padDiameter / 2} fill="#ffd700" stroke="#cc9900" strokeWidth="0.2" />
            <circle cx={via.position.x} cy={via.position.y} r={via.drillDiameter / 2} fill="#111" />
          </g>
        ))}
      </svg>

      <div className="absolute bottom-2 left-2 bg-overlay/70 text-overlay-foreground text-xs px-2 py-1 rounded">
        {boardWidth} × {boardHeight} mm &nbsp;|&nbsp; Layer: {layers.find(l => l.id === selectedLayerId)?.name ?? selectedLayerId}
      </div>
    </div>
  )
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export default function PCBDesignPanel({ onClose, onPreview3D, components: propComponents, wires: propWires }: PCBDesignPanelProps) {
  // Live canvas data from the store — but explicit props (tests, embedding)
  // win when provided, so the panel works both mounted in the workspace
  // (onClose only) and standalone with supplied data.
  const storeComponents = useProjectStore((s) => s.components)
  const storeWires = useProjectStore((s) => s.wires)
  const setPcbLayout = useProjectStore((s) => s.setPcbLayout)
  const components = useMemo<PlacedComponent[]>(
    () => {
      if (propComponents !== undefined) return propComponents
      return storeComponents.map((c) => ({
        id: c.id,
        componentId: c.componentId,
        component: {
          id: c.component.id ?? c.componentId,
          name: c.component.name,
          category: typeof c.component.category === 'string' ? c.component.category : 'passive',
          symbol: c.component.symbol_data,
          pins: c.component.pins,
          properties: c.properties,
        },
        position: { x: c.x / 10, y: c.y / 10 },
        rotation: c.rotation,
        // Symbol geometry is drawn at 10 schematic units per millimetre; the
        // placement was already converted, so the pin offsets must follow.
        scale: 0.1,
        reference: c.reference,
        properties: c.properties,
      }))
    },
    [propComponents, storeComponents],
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
  const [layers, setLayers] = useState<PCBLayer[]>(DEFAULT_LAYERS)
  const [selectedLayerId, setSelectedLayerId] = useState('top-cu')
  const [activeTool, setActiveTool] = useState<'select' | 'route' | 'via' | 'move'>('select')
  const [traces, setTraces] = useState<PCBTrace[]>([])
  const [vias, setVias] = useState<PCBVia[]>([])
  const [boardWidth, setBoardWidth] = useState(100)
  const [boardHeight, setBoardHeight] = useState(80)
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

  const diffPairs = useMemo(() => {
    const lengths = netLengths
    const byStem = new Map<string, { netP?: string; netN?: string }>()
    for (const name of lengths.keys()) {
      const match = name.match(/^(.*?)(?:_P|_N|\+|-)$/i)
      if (!match || match[1].length === 0) continue
      const entry = byStem.get(match[1]) ?? {}
      if (/_P$/i.test(name) || name.endsWith('+')) entry.netP = name
      else entry.netN = name
      byStem.set(match[1], entry)
    }
    return Array.from(byStem, ([stem, entry]) => {
      if (!entry.netP || !entry.netN) return null
      const lengthP = lengths.get(entry.netP) ?? 0
      const lengthN = lengths.get(entry.netN) ?? 0
      const skewPs = pairSkewPs(lengthP, lengthN)
      const skewMm = Math.abs(lengthP - lengthN)
      return {
        stem,
        netP: entry.netP,
        netN: entry.netN,
        lengthP,
        lengthN,
        skewPs,
        withinBudget: Math.abs(skewPs) <= USB2_HS.skewBudgetPs,
        meander: meanderForSkew(skewMm, 1, 2),
      }
    }).filter((pair) => pair !== null)
  }, [netLengths])

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
    // Wires sharing a net name are one electrical net: always route a net as
    // a whole, otherwise a second wire's pads would be routed in isolation.
    const netsById = new Map<string, Net>()
    wires.forEach((w, i) => {
      const id = w.netName || `NET${i}`
      const net = netsById.get(id) ?? { id, name: id, connectedPins: [], wires: [] }
      net.connectedPins.push(...(w.connectedPins ?? []))
      net.wires.push(w.id)
      netsById.set(id, net)
    })
    const nets = Array.from(netsById.values())

    const pads = buildRouterPads(components, nets)

    const result = autoroute(pads, {
      boardWidthMm: boardWidth,
      boardHeightMm: boardHeight,
      layers: ['F.Cu', 'B.Cu'],
      gridMm: 0.5,
      minTraceWidthMm: 0.2,
      minSpacingMm: 0.2,
      viaDrillMm: 0.3,
      viaPadMm: 0.6,
      viaPenalty: 8,
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
  }, [wires, components, boardWidth, boardHeight])

  useDemoRequest('pcb-autoroute', handleAutoRoute)

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

  useEffect(() => {
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
    const nodes: ThermalNode[] = components.slice(0, 20).map((c, i) => ({
      id: c.id,
      position: { x: (c.position?.x ?? i * 10) / 1000, y: (c.position?.y ?? i * 10) / 1000, z: 0 },
      temperature: 25,
      powerDissipation: Number(c.properties?.power ?? 0.1),
      material: 'FR4',
    }))
    if (nodes.length === 0) nodes.push({ id: 'pcb', position: { x: 0, y: 0, z: 0 }, temperature: 25, powerDissipation: 0.5, material: 'FR4' })

    const boundaries: ThermalBoundary[] = [{ type: 'convection', temperature: 25, heatTransferCoefficient: 10, area: 0.01 }]
    try {
      const result = await thermalAnalysisEngine.analyzeThermal(nodes, boundaries, {
        ambientTemperature: 25, convectionCoefficient: 10, boardMaterial: 'FR4',
        copperThickness: 0.035, layerCount: 4, simulationTime: 300, timeStep: 1,
      })
      setThermalResult(result)

      /*
       * Placement heat map. The schematic sheet and the PCB are different
       * coordinate spaces, so the sources are normalised to the board outline
       * instead of being treated as millimetres. A 6 mm square per part is a
       * deliberate conservative spread for a package-mounted dissipator.
       */
      const placed = components.filter((component) => component.position)
      const xs = placed.map((component) => component.position.x)
      const ys = placed.map((component) => component.position.y)
      const minX = xs.length > 0 ? Math.min(...xs) : 0
      const maxX = xs.length > 0 ? Math.max(...xs) : 1
      const minY = ys.length > 0 ? Math.min(...ys) : 0
      const maxY = ys.length > 0 ? Math.max(...ys) : 1
      const margin = 8
      const sources: HeatSource[] = (placed.length > 0 ? placed : [null]).slice(0, 20).map((component, index) => {
        const position = component?.position
        const x = position && maxX > minX
          ? margin + ((position.x - minX) / (maxX - minX)) * (boardWidth - margin * 2)
          : boardWidth / 2 + (index % 3 - 1) * 12
        const y = position && maxY > minY
          ? margin + ((position.y - minY) / (maxY - minY)) * (boardHeight - margin * 2)
          : boardHeight / 2 + (Math.floor(index / 3) - 1) * 12
        const declared = Number(component?.properties?.power ?? 0.1)
        const watts = Number.isFinite(declared) ? Math.min(10, Math.max(0.01, declared)) : 0.1
        return {
          id: component?.reference ?? `U${index + 1}`,
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
          effectiveConductivityWmk: 3.5,
          convectionCoeffWperM2K: 15,
          ambientTempC: 25,
          heatSources: sources,
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
  }, [components, boardWidth, boardHeight])

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
    const pkg = buildFabPackage(components, wires, { projectName: 'folio-pcb' })
    if (!pkg.shippable) {
      setFabVerdict(`${pkg.violations.length} fab violation(s): ${pkg.violations[0]?.message ?? 'blocked'}`)
      return
    }
    setFabVerdict(`Fab package: ${pkg.files.size} files, ${pkg.centroid.length} placements — shippable.`)
    for (const [name, content] of pkg.files) downloadFile(content, name, 'text/plain')
  }, [components, wires])

  // ── Layer toggle ──────────────────────────────────────────────────────────────

  const toggleLayerVisibility = useCallback((layerId: string) => {
    setLayers(prev => prev.map(l => l.id === layerId ? { ...l, visible: !l.visible } : l))
  }, [])

  // ── DRC summary ───────────────────────────────────────────────────────────────
  const drcErrors = useMemo(() => drcViolations.filter(v => v.severity === 'error').length, [drcViolations])
  const drcWarnings = useMemo(() => drcViolations.filter(v => v.severity === 'warning').length, [drcViolations])

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
                {drcErrors === 0 && drcWarnings === 0 && <Badge className="bg-success text-success-foreground">DRC passed ✓</Badge>}
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
                <div className="flex-1 min-h-0">
                  <PCBCanvas traces={traces} vias={vias} boardWidth={boardWidth} boardHeight={boardHeight} selectedLayerId={selectedLayerId} layers={layers} />
                </div>
              </TabsContent>

              <TabsContent value="drc" className="flex-1 overflow-y-auto p-3 space-y-2">
                <div className="text-sm font-medium">Design Rule Check — {drcViolations.length} issue{drcViolations.length !== 1 ? 's' : ''}</div>
                {!drcRan && <p className="text-muted-foreground text-sm">Click "Run DRC" to check your design.</p>}
                {drcViolations.map(v => (
                  <div key={v.id} className={`flex items-start gap-2 p-2 rounded text-xs border ${v.severity === 'error' ? 'bg-destructive/10 border-destructive/40 text-destructive' : 'bg-warning/10 border-warning/40 text-warning'}`}>
                    <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                    <div><span className="font-medium">[{v.rule}]</span> {v.message}</div>
                  </div>
                ))}
                {drcRan && drcViolations.length === 0 && (
                  <div className="flex items-center gap-2 p-2 rounded text-xs bg-success/10 border border-success/40 text-success">
                    <CheckCircle className="w-3 h-3" /> All design rules pass.
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
                    {thermalAccelerator && (
                      <div className="text-xs text-muted-foreground">
                        Grid solved on {thermalAccelerator.path} in {thermalAccelerator.durationMs.toFixed(0)} ms.
                      </div>
                    )}
                    {thermalMap && <ThermalHeatmap result={thermalMap} ambientC={25} />}
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
                  <p className="text-muted-foreground text-sm">Click "Run Thermal" to simulate heat distribution.</p>
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
                      <GitCompare className="w-3 h-3" /> Differential pairs — {USB2_HS.skewBudgetPs} ps budget
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 px-3 pb-3 text-xs">
                    {diffPairs.length === 0 ? (
                      <p className="text-muted-foreground">
                        No routed pairs yet. Net names ending in _P/_N or +/- appear here after auto-routing.
                      </p>
                    ) : diffPairs.map((pair) => (
                      <div key={pair.stem} className="rounded border border-border p-2 space-y-1">
                        <div className="flex justify-between font-medium">
                          <span>{pair.netP} / {pair.netN}</span>
                          <span className={pair.withinBudget ? 'text-success' : 'text-destructive'}>
                            {pair.skewPs.toFixed(1)} ps
                          </span>
                        </div>
                        <div className="text-muted-foreground">
                          P {pair.lengthP.toFixed(2)} mm · N {pair.lengthN.toFixed(2)} mm
                        </div>
                        {!pair.withinBudget && (
                          <div className="text-warning">
                            Add {pair.meander.total.toFixed(2)} mm of meander ({pair.meander.lobes} lobe
                            {pair.meander.lobes === 1 ? '' : 's'}) to the shorter leg.
                          </div>
                        )}
                      </div>
                    ))}
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
