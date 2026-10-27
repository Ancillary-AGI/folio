import { useState, useEffect, useMemo, useRef, type ChangeEvent } from 'react'
import { Play, Download, Zap, BarChart3, X, AlertCircle, Info } from 'lucide-react'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import TraceChart, { type TraceRow, type TraceSeries } from '../charts/TraceChart'
import {
  spiceEngine,
  type CircuitNetlist,
  type SimulationParameters,
  type SimulationResult,
} from '../../lib/simulation/spiceEngine'
import { buildCircuitNetlist } from '../../lib/simulation/netlistBuilder'
import { buildMultiSheetNetlist, type SchematicSheet } from '../../lib/simulation/multiSheet'
import {
  circuitToInterchange,
  interchangeStats,
  interchangeToSheet,
  parseInterchangeText,
  type InterchangeNetlist,
} from '../../lib/simulation/netlistInterchange'
import { emitKicadNetlist } from '../../lib/manufacturing/kicadNetlist'
import { serializeEagleSchematic } from '../../lib/manufacturing/eagleSchematic'
import { downloadFile } from '../../lib/exportUtils'
import { parseSpiceModelLibrary, type SpiceModelCard } from '../../lib/simulation/modelLibrary'
import type { AnalogToDigitalProbe, DigitalToAnalogDrive } from '../../lib/simulation/mixedSignal'
import { playbackDuration, playbackFrame } from '../../lib/simulation/playback'
import { measureWaveform, waveformsToCsv } from '../../lib/simulation/scopeAnalysis'
import { useProjectStore } from '../../stores/useProjectStore'
import type { CanvasComponent, CanvasWire } from '../../stores/useProjectStore'
import { captureDesignSnapshot, stableStringify } from '../../lib/agents/designSnapshot'
import { assessDesignMargins, type MarginItem, type MarginStatus } from '../../lib/electronics/designMargins'
import { useTheme } from '../../lib/theme/useTheme'
import { chartSeriesColors } from '../../lib/theme/tokens'
import { describeError } from '../../lib/utils'
import { formatEngineering, formatEngineeringPrecise } from '../../lib/simulation/formatEngineering'
import { useDemoRequest } from '../workspace/useDemoRequest'

interface SimulationPanelProps {
  onClose: () => void
  /** Returns a blocking reason when policy forbids another solver run. */
  beforeRun?: () => string | null
  /** Called after a run was solved and persisted, even if its tab was superseded. */
  onRunComplete?: () => void
}

/** Analyses the solver actually implements, in menu order. */
const ANALYSIS_TYPES = ['dc', 'dc-sweep', 'transient', 'ac', 'noise', 'montecarlo'] as const
type AnalysisType = (typeof ANALYSIS_TYPES)[number]

const ANALYSIS_LABELS: Record<AnalysisType, string> = {
  dc: 'DC operating point',
  'dc-sweep': 'DC sweep',
  transient: 'Transient',
  ac: 'AC sweep',
  noise: 'Noise',
  montecarlo: 'Monte Carlo',
}

const ANALYSIS_SUMMARY: Record<AnalysisType, string> = {
  dc: 'Solves the bias point by modified nodal analysis. Capacitors are open, inductors are shorts, and diodes are linearised by Newton iteration.',
  'dc-sweep': 'Steps one source, resistor or the temperature and re-solves the bias at every value — a characteristic curve rather than a single number. Each point is a full Newton solve warm-started from the last, so a knee is traced, not interpolated.',
  transient: 'Integrates capacitors and inductors with companion models. Backward Euler is unconditionally stable and will not ring on an ideal step; trapezoidal is second-order and preserves LC oscillation; Gear/BDF2 is second-order, A-stable and damps high-frequency numerical ringing.',
  ac: 'Sweeps the complex small-signal network, linearising diodes at the DC operating point so the response belongs to the bias you designed.',
  noise: 'Output-referred noise summed over the mechanisms the device models actually define: resistor thermal (Johnson–Nyquist) and diode shot, computed with the adjoint (transposed) network method. It is a partial figure whenever the netlist holds a BJT, MOSFET, JFET, switch or op-amp — those have no noise model here, and the run lists them as unmodelled sources instead of including them.',
  montecarlo: 'Re-solves the bias with R/C/L perturbed inside a tolerance band, reporting the mean and the ±3σ envelope. Seeded, so a sweep is reproducible.',
}

/** Component types whose value a DC sweep can step, by normalised symbol name. */
const SWEEPABLE_TYPES = new Set(['voltage_source', 'current_source', 'resistor'])

const MARGIN_STATUS_LABEL: Record<MarginStatus, string> = {
  ok: 'inside limit',
  warn: 'near limit',
  fail: 'over limit',
}

const MARGIN_STATUS_CLASS: Record<MarginStatus, string> = {
  ok: 'text-success',
  warn: 'text-warning',
  fail: 'text-destructive',
}

const MARGIN_BAR_CLASS: Record<MarginStatus, string> = {
  ok: 'bg-success',
  warn: 'bg-warning',
  fail: 'bg-destructive',
}

/** Engineering-friendly watts: mW below 1 W, kW above 1 kW. */
function formatWatts(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const magnitude = Math.abs(value)
  if (magnitude >= 1000) return `${(value / 1000).toPrecision(3)} kW`
  if (magnitude > 0 && magnitude < 1) return `${(value * 1000).toPrecision(3)} mW`
  return `${value.toPrecision(3)} W`
}

function formatMarginValue(item: MarginItem): string {
  if (item.quantity === 'power') return formatWatts(item.value)
  return `${item.value.toPrecision(3)} ${item.unit}`
}

function formatMarginLimit(item: MarginItem): string {
  if (item.quantity === 'power') return formatWatts(item.limit)
  return `${item.limit.toPrecision(3)} ${item.unit}`
}

/**
 * Default scope probes: input-like nets first, then output-like, then the
 * rest — so a transient opens on SRC vs OUT, not on the first
 * alphabetical node. MATLAB-style: the stimulus and the answer, labelled.
 */
function pickDefaultWaveforms(names: string[]): string[] {
  if (names.length === 0) return []
  const score = (name: string): number => {
    const upper = name.toUpperCase()
    if (/GPIO|IN\b|INPUT|VIN|CLOCK|CLK|SOURCE|DRIVE/.test(upper)) return 0
    if (/OUT\b|OUTPUT|LED|LOAD|SINK|DRAIN|COLLECT/.test(upper)) return 1
    if (/VCC|VDD|VSS|GND|^V\(0\)/.test(upper)) return 3
    return 2
  }
  const voltages = names.filter((name) => !/^I\(/.test(name))
  const pool = voltages.length > 0 ? voltages : names
  const ranked = [...pool].sort((a, b) => score(a) - score(b) || (a < b ? -1 : 1))
  return ranked.slice(0, 2)
}

/**
 * Electrical identity of a sheet: values, model/type and pin-to-net wiring.
 * Symbol positions are deliberately excluded — moving a part around the canvas
 * does not invalidate a solved result, changing its value does.
 */
function electricalSignature(parts: readonly CanvasComponent[], connections: readonly CanvasWire[]): string {
  return stableStringify({
    parts: [...parts]
      .map((part) => ({
        id: part.id,
        reference: part.reference,
        symbol: part.component.name,
        properties: part.properties,
      }))
      .sort((a, b) => a.reference.localeCompare(b.reference) || a.id.localeCompare(b.id)),
    wires: [...connections]
      .map((wire) => ({
        net: wire.netName ?? '',
        pins: [...wire.connectedPins].map((pin) => `${pin.componentId}:${pin.pinId}`).sort(),
      }))
      .sort((a, b) => a.net.localeCompare(b.net) || a.pins.join(',').localeCompare(b.pins.join(','))),
  })
}

/** A ready-to-run digital deck so the timing card is useful on first open. */
const DIGITAL_EXAMPLE = [
  '# 2-bit ripple counter: CLOCK drives two T flip-flops, Q0 toggles every rising edge.',
  '# A T flip-flop cannot toggle out of X, so the state bits are initialized.',
  'CLOCK c0 out=CLK period=20',
  'FF q0 T clock=CLK q=Q0 qbar=Q0B T=one delay=3',
  'FF q1 T clock=Q0 q=Q1 qbar=Q1B T=one delay=3',
  'SET one 1',
  'SET Q0 0',
  'SET Q1 0',
  'RUN until=120',
].join('\n')

interface ImportedSheet {
  name: string
  format: 'kicad' | 'eagle'
  netlist: InterchangeNetlist
}

/** FileReader rather than `File.text()` — jsdom does not implement the latter. */
function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'))
    reader.readAsText(file)
  })
}

export default function SimulationPanel({ onClose, beforeRun, onRunComplete }: SimulationPanelProps) {
  const [isSimulating, setIsSimulating] = useState(false)
  const [simulationResults, setSimulationResults] = useState<SimulationResult | null>(null)
  // Margins must describe the design that was actually solved. The drawn sheet
  // is captured at run time because it can be edited while the solver is busy.
  const [marginDesign, setMarginDesign] = useState<{
    components: CanvasComponent[]
    wires: CanvasWire[]
  } | null>(null)
  const [selectedAnalysis, setSelectedAnalysis] = useState<AnalysisType>('transient')
  const [error, setError] = useState<string | null>(null)
  // Transient opens on a 20 ms window of the demo's 1 kHz source: 20 cycles
  // at a 20 µs step resolves the waveform (Nyquist) inside the 2000-point
  // budget. A 1 ms step would sample every zero crossing and alias to a flat
  // line — the solver warns about that, but the default should not need it.
  const [parameters, setParameters] = useState<SimulationParameters>({ type: 'transient', stopTime: 20e-3, stepTime: 20e-6 })
  const [selectedWaveforms, setSelectedWaveforms] = useState<string[]>([])
  // Live playback: playhead time + clock. The frame is derived (never
  // stored), so 2D/3D views always agree on the circuit's state.
  const [playing, setPlaying] = useState(false)
  const [playhead, setPlayhead] = useState<number | null>(null)
  const playDuration = useMemo(
    () => playbackDuration(simulationResults?.waveforms ?? []),
    [simulationResults],
  )
  const liveFrame = useMemo(
    () => (playhead === null ? null : playbackFrame(simulationResults?.waveforms ?? [], playhead)),
    [simulationResults, playhead],
  )

  // Publish the live frame to the project store so the 2D sheet and the 3D
  // viewer animate from the same clock without prop-drilling.
  useEffect(() => {
    useProjectStore.getState().setLiveFrame(liveFrame)
  }, [liveFrame])

  // Closing the panel mid-playback must not leave the sheet glowing at the
  // last frame from a simulation that is no longer open.
  useEffect(() => () => useProjectStore.getState().setLiveFrame(null), [])

  useEffect(() => {
    if (!playing || playDuration <= 0) return
    let frame = 0
    const start = performance.now()
    if (playhead === null || playhead >= playDuration) setPlayhead(0)
    const tick = (now: number) => {
      const elapsed = (now - start) / 1000
      // Play the run in ~4 s wall time regardless of simulated span.
      const t = elapsed * (playDuration / 4)
      if (t >= playDuration) {
        setPlayhead(playDuration)
        setPlaying(false)
        return
      }
      setPlayhead(t)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, playDuration])

  const { components, wires, addSimulationRun } = useProjectStore()
  const { theme } = useTheme()
  const seriesColors = useMemo(() => chartSeriesColors(theme), [theme])

  /*
   * SPICE `.model` cards typed or pasted by the user. Parsing is pure and
   * cheap, so it runs on every keystroke and reports problems before a run.
   * A malformed card blocks simulation: silently falling back to the stock
   * model would simulate a different transistor than the deck describes.
   */
  const [modelDeck, setModelDeck] = useState('')
  const modelLibrary = useMemo(
    () => (modelDeck.trim() ? parseSpiceModelLibrary(modelDeck) : null),
    [modelDeck],
  )
  const modelCards = useMemo<Record<string, SpiceModelCard>>(
    () => (modelLibrary ? Object.fromEntries(modelLibrary.models) : {}),
    [modelLibrary],
  )
  const attachModelCards = (netlist: CircuitNetlist): CircuitNetlist =>
    Object.keys(modelCards).length > 0 ? { ...netlist, models: modelCards } : netlist

  /**
   * Reference designators on the schematic whose value a sweep can step.
   *
   * Derived from the drawn parts rather than typed in, so the picker cannot name
   * a component that is not on the sheet — the same normalisation the netlist
   * builder applies decides what is sweepable.
   */
  const sweepTargets = useMemo(
    () =>
      components
        .filter((placed) =>
          SWEEPABLE_TYPES.has(placed.component.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')),
        )
        .map((placed) => placed.reference)
        .filter((reference, index, all) => all.indexOf(reference) === index),
    [components],
  )

  /*
   * A result belongs to the analysis that produced it. Without this token an
   * AC sweep that finishes after the user switched to Transient would render
   * under the Transient tab with the wrong axes and controls.
   */
  const runTokenRef = useRef(0)
  // `null` until the first commit settles. StrictMode replays mount effects,
  // and treating that replay as a tab change would invalidate the run a demo
  // request just started — leaving the panel busy forever with no result.
  const analysisRef = useRef<AnalysisType | null>(null)

  useEffect(() => {
    const previousAnalysis = analysisRef.current
    analysisRef.current = selectedAnalysis
    setParameters((previous) => {
      const next: SimulationParameters = { ...previous, type: selectedAnalysis }
      // The picker shows Temperature when nothing is chosen; make that the
      // actual parameter too, or the engine receives no sweep target and
      // rejects a run the form appeared ready to perform.
      if (selectedAnalysis === 'dc-sweep' && !next.sweepSource) next.sweepSource = 'TEMP'
      return next
    })
    if (previousAnalysis === null || previousAnalysis === selectedAnalysis) return
    // Anything already running belongs to the previous tab. Its result must
    // not surface here; it is still persisted in the run history when it ends.
    runTokenRef.current += 1
    setSimulationResults((previous) =>
      previous && previous.analysis !== selectedAnalysis ? null : previous,
    )
    setSelectedWaveforms([])
    setMarginDesign(null)
    setError(null)
  }, [selectedAnalysis])

  const handleRunSimulation = async () => {
    if (modelLibrary && modelLibrary.errors.length > 0) {
      setError(`Fix the model-card errors first: ${modelLibrary.errors.join(' ')}`)
      return
    }
    const blocked = beforeRun?.()
    if (blocked) {
      setError(blocked)
      return
    }
    const runToken = ++runTokenRef.current
    const runAnalysis = selectedAnalysis
    const runParameters = parameters
    setIsSimulating(true)
    setError(null)

    try {
      const solvedDesign = { components, wires }
      const netlist = attachModelCards(buildCircuitNetlist('Circuit Simulation', components, wires, runParameters))
      const result = await spiceEngine.simulate(netlist)
      // Persist the run into the design so it survives save/load and VCS
      // commits. A solve that finishes after a tab switch still happened, so it
      // belongs in the history even though it must not surface on the new tab.
      addSimulationRun({
        name: `${ANALYSIS_LABELS[runAnalysis]} — ${new Date().toLocaleString()}`,
        type: runAnalysis,
        parameters: runParameters as unknown as Record<string, unknown>,
        results: result as unknown as Record<string, unknown>,
        status: 'completed',
      })
      onRunComplete?.()
      if (runToken !== runTokenRef.current) return
      setMarginDesign(solvedDesign)
      setSimulationResults(result)
      setSelectedWaveforms(pickDefaultWaveforms(result.waveforms.map((w) => w.name)))
    } catch (thrown) {
      if (runToken !== runTokenRef.current) return
      // Building the netlist can fail (conflicting net names). Report it here
      // rather than in an `alert`, so it stays attached to the panel.
      setError(describeError(thrown))
      setMarginDesign(null)
      setSimulationResults(null)
    } finally {
      // A superseded run must not clear the busy flag of the run that replaced it.
      if (runToken === runTokenRef.current) setIsSimulating(false)
    }
  }

  useDemoRequest('rectifier-transient', () => { void handleRunSimulation() })

  const [benchInput, setBenchInput] = useState<string>('')
  const [benchVerdict, setBenchVerdict] = useState<string | null>(null)

  const handleCorrelateBench = async () => {
    try {
      if (modelLibrary && modelLibrary.errors.length > 0) {
        throw new Error(`Fix the model-card errors first: ${modelLibrary.errors.join(' ')}`)
      }
      const { correlateBench, toleranceEnvelope } = await import('../../lib/simulation/benchCorrelation')
      const { buildCircuitModel } = await import('../../lib/simulation/circuitModel')
      const { runOperatingPoint } = await import('../../lib/simulation/solver')
      const samples = benchInput
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => {
          const [signal, x, value] = line.split(',').map((part) => part.trim())
          if (!signal || x === undefined || value === undefined) throw new Error(`Bad bench line: ${line} (want SIGNAL,x,value)`)
          return { signal, x: Number(x), value: Number(value) }
        })
      const netlist = attachModelCards(
        buildCircuitNetlist('Bench correlation', components, wires, { type: 'dc' }),
      )
      const { model, errors } = buildCircuitModel(netlist)
      if (errors.length > 0) throw new Error(errors.join(' '))
      const { bands, gridMismatch } = toleranceEnvelope(model, (perturbed) => runOperatingPoint(perturbed, { temperatureCelsius: 27 }).outcome, { iterations: 60, tolerance: 0.05 })
      const verdict = correlateBench(bands, samples)
      setBenchVerdict(
        gridMismatch.length > 0
          ? `${verdict.summary} No envelope for ${gridMismatch.join(', ')}: the sweep's ±3σ traces were not on the mean's grid.`
          : verdict.summary,
      )
    } catch (thrown) {
      setBenchVerdict(`Bench correlation failed: ${describeError(thrown)}`)
    }
  }

  const [importedSheets, setImportedSheets] = useState<ImportedSheet[]>([])
  const [interchangeError, setInterchangeError] = useState<string | null>(null)
  const [stitchVerdict, setStitchVerdict] = useState<string | null>(null)
  const [includeDrawnSheet, setIncludeDrawnSheet] = useState(true)
  const [stitching, setStitching] = useState(false)

  const handleExportInterchange = (format: 'kicad' | 'eagle') => {
    setInterchangeError(null)
    try {
      const netlist = buildCircuitNetlist('Folio design', components, wires, { type: 'dc' })
      if (netlist.components.length === 0) {
        throw new Error('Place at least one component before exporting a netlist.')
      }
      const interchange = circuitToInterchange(netlist)
      if (format === 'kicad') {
        downloadFile(emitKicadNetlist(netlist), 'folio_netlist.net', 'text/plain')
      } else {
        downloadFile(serializeEagleSchematic(interchange), 'folio_schematic.sch', 'text/plain')
      }
    } catch (thrown) {
      setInterchangeError(describeError(thrown))
    }
  }

  const handleImportNetlist = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setInterchangeError(null)
    setStitchVerdict(null)
    try {
      const parsed = parseInterchangeText(await readFileText(file))
      const base = file.name.replace(/\.[^.]+$/, '').trim() || `Imported sheet ${importedSheets.length + 1}`
      // Validate now so a broken netlist is reported at import, not at solve time.
      interchangeToSheet(base, parsed.netlist)
      setImportedSheets((previous) => [
        ...previous,
        { name: base, format: parsed.format, netlist: parsed.netlist },
      ])
    } catch (thrown) {
      setInterchangeError(describeError(thrown))
    }
  }

  const handleStitchSheets = async () => {
    setInterchangeError(null)
    setStitchVerdict(null)
    setStitching(true)
    // A stitched solve supersedes any running single-sheet solve, and must not
    // land under a different analysis tab if the user switches mid-solve.
    const runToken = ++runTokenRef.current
    try {
      const sheets: SchematicSheet[] = importedSheets.map((entry) =>
        interchangeToSheet(entry.name, entry.netlist),
      )
      if (includeDrawnSheet && components.length > 0) {
        sheets.push({ name: 'Drawn sheet', components, wires })
      }
      if (sheets.length === 0) {
        throw new Error('Import a netlist or draw a circuit before stitching sheets.')
      }
      const netlist = buildMultiSheetNetlist('Multi-sheet circuit', sheets, parameters)
      const result = await spiceEngine.simulate(netlist)
      if (runToken !== runTokenRef.current) return
      if (!result.success) {
        throw new Error(result.error ?? 'The stitched netlist did not solve.')
      }
      // The stitched deck spans imported sheets whose parts are not on the
      // canvas, so rating margins are unavailable for this result.
      setMarginDesign(null)
      setSimulationResults(result)
      setSelectedWaveforms(pickDefaultWaveforms(result.waveforms.map((w) => w.name)))
      const iterations = result.convergenceInfo?.iterations
      setStitchVerdict(
        `${sheets.length} sheet${sheets.length === 1 ? '' : 's'} stitched into ${
          netlist.components.length
        } device${netlist.components.length === 1 ? '' : 's'}${
          iterations === undefined ? '' : ` · ${iterations} iterations`
        }`,
      )
    } catch (thrown) {
      if (runToken !== runTokenRef.current) return
      setInterchangeError(describeError(thrown))
    } finally {
      // A superseded stitch must not clear the busy flag of the newer one.
      if (runToken === runTokenRef.current) setStitching(false)
    }
  }

  const [digitalDeck, setDigitalDeck] = useState<string>(DIGITAL_EXAMPLE)
  const [digitalOutput, setDigitalOutput] = useState<{ lines: string[]; values: Array<[string, string]>; error: string | null } | null>(null)
  const [mixedCoupling, setMixedCoupling] = useState<string>('CLK=CLK_IN')
  const [mixedTimeScale, setMixedTimeScale] = useState<number>(1e-3)
  const [mixedVdd, setMixedVdd] = useState<number>(5)
  const [mixedBusy, setMixedBusy] = useState(false)
  const [mixedOutput, setMixedOutput] = useState<{ error: string | null; lines: string[] } | null>(null)

  const handleRunDigital = () => {
    setDigitalOutput(null)
    try {
      // Parser and engine are loaded on demand: the analog path never pays for them.
      import('../../lib/simulation/digitalNetlistParser')
        .then(({ parseDigitalNetlist }) => import('../../lib/simulation/digitalLogic').then((digital) => ({ parseDigitalNetlist, digital })))
        .then(({ parseDigitalNetlist, digital }) => {
          const { netlist, until } = parseDigitalNetlist(digitalDeck)
          const result = digital.simulateDigital(netlist, until)
          if (!result.success) {
            setDigitalOutput({ lines: [], values: [], error: result.error ?? 'digital simulation failed' })
            return
          }
          // Render one line per node: a compact step timeline of its transitions.
          const lines = result.nodeValues
            .filter((node) => (result.transitions[node]?.length ?? 0) > 1)
            .map((node) => {
              const steps = result.transitions[node]
                .slice(1)
                .map((transition) => `${transition.value}@${transition.time}`)
                .join(' ')
              return `${node}: ${steps}`
            })
          const values = result.nodeValues.map((node) => [node, String(result.finalValues[node])] as [string, string])
          setDigitalOutput({ lines, values, error: null })
        })
        .catch((thrown) => setDigitalOutput({ lines: [], values: [], error: describeError(thrown) }))
    } catch (thrown) {
      setDigitalOutput({ lines: [], values: [], error: describeError(thrown) })
    }
  }

  const handleRunMixedSignal = async () => {
    setMixedOutput(null)
    setMixedBusy(true)
    try {
      if (modelLibrary && modelLibrary.errors.length > 0) {
        throw new Error(`Fix the model-card errors first: ${modelLibrary.errors.join(' ')}`)
      }
      // The digital parser/engine and the co-simulation bridge load on demand;
      // the analog-only path does not pay for either.
      const [{ parseDigitalNetlist }, { simulateMixedSignal }] = await Promise.all([
        import('../../lib/simulation/digitalNetlistParser'),
        import('../../lib/simulation/mixedSignal'),
      ])
      const drives: DigitalToAnalogDrive[] = []
      const probes: AnalogToDigitalProbe[] = []
      for (const raw of mixedCoupling.split(/\r?\n/)) {
        const line = raw.trim()
        if (!line || line.startsWith('#')) continue
        const drive = /^([^=<>]+)=([^=<>]+)$/.exec(line)
        if (drive) {
          drives.push({ digitalNode: drive[1].trim(), analogNet: drive[2].trim(), vdd: mixedVdd })
          continue
        }
        const probe = /^([^=<>]+)>([^=<>]+)$/.exec(line)
        if (probe) {
          probes.push({ analogNet: probe[1].trim(), digitalNode: probe[2].trim() })
          continue
        }
        throw new Error(`Bad coupling "${line}" — use digitalNet=analogNet or analogNet>digitalNet.`)
      }
      if (drives.length === 0 && probes.length === 0) {
        throw new Error('Add at least one coupling: digitalNet=analogNet or analogNet>digitalNet.')
      }

      const { netlist: digital, until } = parseDigitalNetlist(digitalDeck)
      const stopTime = until * mixedTimeScale
      const stepTime =
        parameters.stepTime && parameters.stepTime > 0 ? parameters.stepTime : stopTime / 200
      const analog = attachModelCards(
        buildCircuitNetlist('Mixed-signal co-simulation', components, wires, {
          type: 'transient',
          stopTime,
          stepTime,
        }),
      )
      const result = await simulateMixedSignal({
        digital,
        analog,
        drives,
        probes,
        stopTime,
        stepTime,
        timeScale: mixedTimeScale,
      })
      if (!result.success) {
        setMixedOutput({ error: result.error ?? 'The mixed-signal run could not be completed.', lines: result.notes })
        return
      }
      const finalProbe = new Map<string, string>()
      for (const sample of result.probeTimeline) finalProbe.set(sample.digitalNode, String(sample.value))
      setMixedOutput({
        error: null,
        lines: [
          `${result.analog.waveforms.length} analog waveform(s) over ${(stopTime * 1e3).toFixed(3)} ms.`,
          ...[...finalProbe].map(([node, value]) => `${node}=${value}`),
          ...result.notes,
        ],
      })
    } catch (thrown) {
      setMixedOutput({ error: describeError(thrown), lines: [] })
    } finally {
      setMixedBusy(false)
    }
  }

  const handleParameterChange = (key: keyof SimulationParameters, value: string | number | boolean) => {
    setParameters((previous) => ({ ...previous, [key]: value }))
  }
  
  const handleExportResults = () => {
    if (!simulationResults) return
    
    const data = {
      timestamp: new Date().toISOString(),
      parameters,
      results: simulationResults
    }
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `simulation_results_${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }
  
  const waveformData = useMemo<TraceRow[]>(() => {
    if (!simulationResults?.waveforms) return []

    const selectedWaveformData = simulationResults.waveforms.filter(wf =>
      selectedWaveforms.includes(wf.name)
    )

    if (selectedWaveformData.length === 0) return []

    // Combine all selected waveforms into a single dataset
    const maxLength = Math.max(...selectedWaveformData.map(wf => wf.data.length))

    return Array.from({ length: maxLength }, (_, i) => {
      const point: TraceRow = {}

      selectedWaveformData.forEach(waveform => {
        if (i < waveform.data.length) {
          if (point.x === undefined) point.x = waveform.data[i].x
          point[waveform.name] = waveform.data[i].y
        }
      })

      return point
    })
  }, [simulationResults, selectedWaveforms])
  
  // Magnitude and phase share a chart only if they get separate axes; otherwise
  // a ±90° phase curve flattens a millivolt Bode magnitude onto the zero line.
  const selectedWaveformUnits = selectedWaveforms
    .map((name) => simulationResults?.waveforms.find((waveform) => waveform.name === name)?.unit)
    .filter((unit): unit is string => unit !== undefined)
  const hasMagnitudeSeries = selectedWaveformUnits.some((unit) => unit !== 'deg')
  const hasPhaseSeries = selectedWaveformUnits.some((unit) => unit === 'deg')
  const logFrequencyAxis = selectedAnalysis === 'ac' || selectedAnalysis === 'noise'

  const traceSeries = useMemo<TraceSeries[]>(
    () => selectedWaveforms.map((name, index) => {
      const waveform = simulationResults?.waveforms.find((candidate) => candidate.name === name)
      return {
        key: name,
        color: seriesColors[index % seriesColors.length],
        unit: waveform?.unit,
        axis: hasMagnitudeSeries && hasPhaseSeries && waveform?.unit === 'deg' ? 'right' : 'left',
      }
    }),
    [selectedWaveforms, simulationResults, hasMagnitudeSeries, hasPhaseSeries, seriesColors],
  )

  // The x axis means something different per analysis: seconds, hertz, or the
  // swept component value. Label and format it as what it actually is.
  const traceXLabel = logFrequencyAxis
    ? 'Frequency'
    : selectedAnalysis === 'dc-sweep'
      ? parameters.sweepSource ?? 'Sweep'
      : 'Time'
  const traceXFormatter = (value: number) => {
    if (logFrequencyAxis) return `${formatEngineering(value)}Hz`
    if (selectedAnalysis === 'dc-sweep') return value.toPrecision(4)
    return `${formatEngineering(value)}s`
  }

  // A tolerance sweep is a distribution of DC biases, not a waveform: one point
  // per signal, so a line chart would draw nothing. Tabulate mean and spread.
  const monteCarloRows = (() => {
    if (selectedAnalysis !== 'montecarlo' || !simulationResults) return []
    const byName = new Map(simulationResults.waveforms.map((waveform) => [waveform.name, waveform]))
    return simulationResults.waveforms
      .filter((waveform) => waveform.name.endsWith(' mean'))
      .map((meanWaveform) => {
        const base = meanWaveform.name.slice(0, -' mean'.length)
        const mean = meanWaveform.data[0]?.y
        const plus = byName.get(`${base} mean +3σ`)?.data[0]?.y
        const minus = byName.get(`${base} mean −3σ`)?.data[0]?.y
        const spread = plus !== undefined && minus !== undefined ? (plus - minus) / 2 : undefined
        // A relative spread is meaningless when the mean is itself numerical
        // noise around zero: report the absolute envelope, not "±1060 %".
        const percent =
          mean !== undefined &&
          spread !== undefined &&
          Math.abs(mean) > spread
            ? (spread / Math.abs(mean)) * 100
            : undefined
        return { name: base, unit: meanWaveform.unit, mean, spread, percent }
      })
  })()

  // A bias-only Monte Carlo on an AC-driven circuit reports numerical noise
  // (yoctovolts), which is correct but tells the user nothing about their
  // design. Say so next to the table instead of leaving a row of zeros.
  const monteCarloCarriesBias = monteCarloRows.some(
    (row) => row.mean !== undefined && Math.abs(row.mean) > 1e-12,
  )

  // ── Scope measurements + power + CSV export ──────────────────────────────
  const scopeMeasurements = useMemo(() => {
    if (!simulationResults?.waveforms) return []
    try {
      return simulationResults.waveforms
        .filter((w) => selectedWaveforms.includes(w.name))
        .map((w) => ({ name: w.name, unit: w.unit, measurement: measureWaveform(w) }))
    } catch {
      return []
    }
  }, [simulationResults, selectedWaveforms])

  /**
   * Rating margins, junction-temperature estimates and the power budget for the
   * exact design that was solved. `assessDesignMargins` reports "not rated"
   * rather than guessing, and labels thermal numbers as first-order estimates.
   */
  const designMargins = useMemo(() => {
    if (!simulationResults || !marginDesign) return null
    try {
      const snapshot = captureDesignSnapshot(marginDesign.components, marginDesign.wires)
      return assessDesignMargins(snapshot, simulationResults)
    } catch {
      return null
    }
  }, [simulationResults, marginDesign])

  /** Warn instead of pretending an old solve describes a sheet that changed. */
  const solvedSignature = useMemo(
    () => (marginDesign ? electricalSignature(marginDesign.components, marginDesign.wires) : null),
    [marginDesign],
  )
  const currentSignature = useMemo(
    () => electricalSignature(components, wires),
    [components, wires],
  )
  const designChangedSinceRun = Boolean(
    simulationResults && marginDesign && solvedSignature !== null && solvedSignature !== currentSignature,
  )

  const handleExportCsv = () => {
    if (!simulationResults?.waveforms) return
    try {
      const csv = waveformsToCsv(
        simulationResults.waveforms.filter((w) => selectedWaveforms.includes(w.name)),
      )
      const blob = new Blob([csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `waveforms_${Date.now()}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (thrown) {
      setError(describeError(thrown))
    }
  }
  
  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-success" />
          Circuit Simulation
        </CardTitle>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close simulation panel">
          <X className="w-4 h-4" />
        </Button>
      </CardHeader>
      
      <CardContent className="flex-1 flex flex-col space-y-4 overflow-y-auto scrollbar-thin">
        {/* Analysis Type Selection */}
        <div>
          <span className="text-sm font-medium mb-2 block">Analysis type</span>
          <div className="flex flex-wrap gap-2">
            {ANALYSIS_TYPES.map((type) => (
              <Button
                key={type}
                variant={selectedAnalysis === type ? 'default' : 'outline'}
                size="sm"
                disabled={isSimulating}
                onClick={() => setSelectedAnalysis(type)}
              >
                {ANALYSIS_LABELS[type]}
              </Button>
            ))}
          </div>
          <p className="mt-2 flex gap-2 text-xs leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {ANALYSIS_SUMMARY[selectedAnalysis]}
          </p>
        </div>

        {/* Parameters */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="sim-temperature" className="text-sm font-medium mb-1 block">
              Temperature (°C)
            </label>
            <input
              id="sim-temperature"
              type="number"
              value={parameters.temperature ?? 27}
              onChange={(event) => handleParameterChange('temperature', Number(event.target.value))}
              className="w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground"
            />
          </div>

          {selectedAnalysis === 'transient' && (
            <>
              <div>
                <label htmlFor="sim-stop" className="text-sm font-medium mb-1 block">
                  Stop time (s)
                </label>
                <input
                  id="sim-stop"
                  type="number"
                  value={parameters.stopTime ?? 1e-3}
                  onChange={(event) => handleParameterChange('stopTime', Number(event.target.value))}
                  className="w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground"
                  step="0.000001"
                  min="0"
                />
              </div>
              <div>
                <label htmlFor="sim-step" className="text-sm font-medium mb-1 block">
                  Max step (s)
                </label>
                <input
                  id="sim-step"
                  type="number"
                  value={parameters.stepTime ?? 1e-6}
                  onChange={(event) => handleParameterChange('stepTime', Number(event.target.value))}
                  className="w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground"
                  step="0.0000001"
                  min="0"
                />
              </div>
              <div className="col-span-2">
                <label htmlFor="sim-integration" className="text-sm font-medium mb-1 block">
                  Integration rule
                </label>
                <select
                  id="sim-integration"
                  value={parameters.integrationMethod ?? 'backward-euler'}
                  onChange={(event) =>
                    handleParameterChange(
                      'integrationMethod',
                      event.target.value as 'backward-euler' | 'trapezoidal' | 'bdf2',
                    )
                  }
                  className="w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground"
                >
                  <option value="backward-euler">Backward Euler — stable, no numerical ringing</option>
                  <option value="trapezoidal">Trapezoidal — second-order, preserves LC ringing</option>
                  <option value="bdf2">Gear/BDF2 — second-order, damps stiff ringing</option>
                </select>
                <p className="mt-1 text-xs text-muted-foreground">
                  Startup and every step-size change use backward Euler: one step for trapezoidal,
                  two for BDF2. Trapezoidal best preserves lossless ringing, BDF2 damps numerical
                  ringing on stiff edges, and backward Euler is the safest default.
                </p>
              </div>
              <label className="col-span-2 flex items-center justify-between gap-3 rounded-md border border-border p-2">
                <span className="text-sm text-card-foreground">
                  Start from zero stored energy
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    Off: begin at the DC operating point (SPICE default). On: watch capacitors charge.
                  </span>
                </span>
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[hsl(var(--primary))]"
                  checked={parameters.useInitialConditions ?? false}
                  onChange={(event) => handleParameterChange('useInitialConditions', event.target.checked)}
                />
              </label>
            </>
          )}
          {selectedAnalysis === 'dc-sweep' && (
            <>
              <div className="col-span-2">
                <label htmlFor="sim-sweep-target" className="text-sm font-medium mb-1 block">
                  Sweep
                </label>
                <select
                  id="sim-sweep-target"
                  value={parameters.sweepSource ?? 'TEMP'}
                  onChange={(event) => handleParameterChange('sweepSource', event.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground"
                >
                  {/*
                   * Only the symbols the solver can actually re-value are
                   * offered: a picker that lists a capacitor would be offering a
                   * sweep that cannot run.
                   */}
                  <option value="TEMP">Temperature (°C)</option>
                  {sweepTargets.map((candidate) => (
                    <option key={candidate} value={candidate}>
                      {candidate}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="sim-sweep-start" className="text-sm font-medium mb-1 block">
                  Start
                </label>
                <input
                  id="sim-sweep-start"
                  type="number"
                  value={parameters.sweepStart ?? 0}
                  onChange={(event) => handleParameterChange('sweepStart', Number(event.target.value))}
                  className="w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground"
                />
              </div>
              <div>
                <label htmlFor="sim-sweep-stop" className="text-sm font-medium mb-1 block">
                  Stop
                </label>
                <input
                  id="sim-sweep-stop"
                  type="number"
                  value={parameters.sweepStop ?? 5}
                  onChange={(event) => handleParameterChange('sweepStop', Number(event.target.value))}
                  className="w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground"
                />
              </div>
              <div>
                <label htmlFor="sim-sweep-step" className="text-sm font-medium mb-1 block">
                  Step
                </label>
                <input
                  id="sim-sweep-step"
                  type="number"
                  value={parameters.sweepStep ?? 0.1}
                  onChange={(event) => handleParameterChange('sweepStep', Number(event.target.value))}
                  className="w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground"
                />
              </div>
            </>
          )}
        </div>

        {/* Frequency-domain and tolerance controls */}
        {(selectedAnalysis === 'ac' || selectedAnalysis === 'noise' || selectedAnalysis === 'montecarlo') && (
          <div className="grid grid-cols-2 gap-3">
            {(selectedAnalysis === 'ac' || selectedAnalysis === 'noise') && (
              <>
                <div>
                  <label htmlFor="sim-fstart" className="text-sm font-medium mb-1 block">
                    Start frequency (Hz)
                  </label>
                  <input
                    id="sim-fstart"
                    type="number"
                    value={parameters.startFreq ?? 10}
                    onChange={(event) => handleParameterChange('startFreq', Number(event.target.value))}
                    className="w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground"
                    min="0"
                  />
                </div>
                <div>
                  <label htmlFor="sim-fstop" className="text-sm font-medium mb-1 block">
                    Stop frequency (Hz)
                  </label>
                  <input
                    id="sim-fstop"
                    type="number"
                    value={parameters.stopFreq ?? 1e6}
                    onChange={(event) => handleParameterChange('stopFreq', Number(event.target.value))}
                    className="w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground"
                    min="0"
                  />
                </div>
                <div>
                  <label htmlFor="sim-ppd" className="text-sm font-medium mb-1 block">
                    Points per decade
                  </label>
                  <input
                    id="sim-ppd"
                    type="number"
                    value={parameters.pointsPerDecade ?? (selectedAnalysis === 'noise' ? 10 : 20)}
                    onChange={(event) => handleParameterChange('pointsPerDecade', Number(event.target.value))}
                    className="w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground"
                    min="2"
                    max="200"
                  />
                </div>
              </>
            )}

            {selectedAnalysis === 'noise' && (
              <div>
                <label htmlFor="sim-out" className="text-sm font-medium mb-1 block">
                  Output net
                </label>
                <input
                  id="sim-out"
                  type="text"
                  value={parameters.outputNode ?? ''}
                  placeholder="Auto-detect a net named OUT"
                  onChange={(event) => handleParameterChange('outputNode', event.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground"
                />
              </div>
            )}

            {selectedAnalysis === 'montecarlo' && (
              <>
                <div>
                  <label htmlFor="sim-runs" className="text-sm font-medium mb-1 block">
                    Runs
                  </label>
                  <input
                    id="sim-runs"
                    type="number"
                    value={parameters.iterations ?? 100}
                    onChange={(event) => handleParameterChange('iterations', Number(event.target.value))}
                    className="w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground"
                    min="1"
                    max="500"
                  />
                </div>
                <div>
                  <label htmlFor="sim-tol" className="text-sm font-medium mb-1 block">
                    Tolerance (%)
                  </label>
                  <input
                    id="sim-tol"
                    type="number"
                    value={Number(((parameters.tolerance ?? 0.05) * 100).toFixed(2))}
                    onChange={(event) =>
                      handleParameterChange('tolerance', Math.max(0, Number(event.target.value)) / 100)
                    }
                    className="w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground"
                    min="0"
                    step="0.1"
                  />
                </div>
                <div className="col-span-2">
                  <label htmlFor="sim-seed" className="text-sm font-medium mb-1 block">
                    Random seed
                  </label>
                  <input
                    id="sim-seed"
                    type="number"
                    value={parameters.seed ?? 20260101}
                    onChange={(event) => handleParameterChange('seed', Number(event.target.value))}
                    className="w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    The same seed reproduces the same sweep exactly.
                  </p>
                </div>
              </>
            )}
          </div>
        )}
        {components.length === 0 && (
          <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
            Place at least one component on the schematic before simulating.
          </p>
        )}

        {error && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}

        {/* Control Buttons */}
        <div className="flex gap-2">
          <Button
            onClick={handleRunSimulation}
            disabled={isSimulating || components.length === 0 || (modelLibrary?.errors.length ?? 0) > 0}
            className="flex items-center gap-2"
          >
            {isSimulating ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                Solving…
              </>
            ) : (
              <>
                <Play className="h-4 w-4" />
                Run simulation
              </>
            )}
          </Button>

          {simulationResults && (
            <Button onClick={handleExportResults} variant="outline" className="flex items-center gap-2">
              <Download className="h-4 w-4" />
              Export results
            </Button>
          )}
        </div>
        {/* SPICE device models: a supported .model subset that overrides stock cards. */}
        <div className="rounded-md border border-border bg-muted/50 p-3">
          <h4 className="mb-1 text-xs font-medium text-card-foreground">Device model cards</h4>
          <p className="mb-2 text-xs leading-relaxed text-muted-foreground">
            Paste SPICE <span className="font-mono">.model</span> cards (NPN, PNP, NMOS, PMOS, NJF, PJF, D).
            A transistor or diode uses the card named by its Model/Part/Type property; a value typed on
            the symbol still wins over the card. Unsupported parameters are reported, never guessed.
          </p>
          <textarea
            aria-label="SPICE model cards"
            value={modelDeck}
            onChange={(event) => setModelDeck(event.target.value)}
            spellCheck={false}
            placeholder={'.model 2N3904 NPN (IS=1E-14 BF=300 VAF=100)'}
            className="h-24 w-full rounded-md border border-input bg-background px-2 py-1 font-mono text-xs"
          />
          {modelLibrary ? (
            <div className="mt-2 space-y-1 text-xs leading-relaxed">
              {modelLibrary.models.size > 0 ? (
                <p className="text-muted-foreground">
                  Loaded:{' '}
                  {[...modelLibrary.models.values()]
                    .map((card) => `${card.name} (${card.type})`)
                    .join(', ')}
                </p>
              ) : null}
              {modelLibrary.errors.map((message) => (
                <p key={message} role="alert" className="text-destructive">
                  {message}
                </p>
              ))}
              {modelLibrary.unsupported.map((entry) => (
                <p key={entry} className="text-warning">
                  Not imported: {entry} — use a .model card, not a subcircuit or include file.
                </p>
              ))}
            </div>
          ) : null}
        </div>

        {/* Interchange: KiCad s-expression / EAGLE XML, and multi-sheet stitching. */}
        <div className="rounded-md border border-border bg-muted/50 p-3">
          <h4 className="mb-1 text-xs font-medium text-card-foreground">Netlist interchange &amp; multi-sheet</h4>
          <p className="mb-2 text-xs leading-relaxed text-muted-foreground">
            Export the drawn sheet for layout in KiCad or EAGLE, or import two-terminal R/C/L/D/V/I
            netlists and stitch them with this sheet through shared global labels (GND, VCC, OUT…).
            Imported pins are wired from the netlist itself, never guessed from geometry.
          </p>
          <div className="mb-2 flex flex-wrap gap-2">
            <Button
              onClick={() => handleExportInterchange('kicad')}
              disabled={components.length === 0}
              variant="outline"
              size="sm"
            >
              Export KiCad netlist
            </Button>
            <Button
              onClick={() => handleExportInterchange('eagle')}
              disabled={components.length === 0}
              variant="outline"
              size="sm"
            >
              Export EAGLE schematic
            </Button>
          </div>
          <label htmlFor="interchange-import" className="mb-1 block text-xs text-muted-foreground">
            Import KiCad (.net) or EAGLE (.sch) netlist
          </label>
          <input
            id="interchange-import"
            type="file"
            accept=".net,.cir,.sch,.xml"
            onChange={handleImportNetlist}
            className="block w-full text-xs text-muted-foreground file:mr-2 file:rounded file:border file:border-border file:bg-background file:px-2 file:py-1 file:text-xs file:text-foreground"
          />
          {importedSheets.length > 0 && (
            <ul className="mt-2 space-y-1">
              {importedSheets.map((entry, index) => {
                const stats = interchangeStats(entry.netlist)
                return (
                  <li
                    key={`${entry.name}-${index}`}
                    className="flex items-center justify-between gap-2 text-xs text-muted-foreground"
                  >
                    <span>
                      {entry.name} — {stats.components} part{stats.components === 1 ? '' : 's'} ·{' '}
                      {stats.nets} net{stats.nets === 1 ? '' : 's'} ({entry.format.toUpperCase()})
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove imported sheet ${entry.name}`}
                      onClick={() =>
                        setImportedSheets((previous) => previous.filter((_, at) => at !== index))
                      }
                    >
                      Remove
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
          <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={includeDrawnSheet}
              onChange={(event) => setIncludeDrawnSheet(event.target.checked)}
              className="h-3.5 w-3.5"
            />
            Include the drawn sheet
          </label>
          <Button
            onClick={handleStitchSheets}
            disabled={
              stitching ||
              (importedSheets.length === 0 && (!includeDrawnSheet || components.length === 0))
            }
            variant="outline"
            size="sm"
            className="mt-2"
          >
            {stitching ? 'Stitching…' : 'Stitch sheets and solve'}
          </Button>
          {stitchVerdict ? (
            <p role="status" className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {stitchVerdict}
            </p>
          ) : null}
          {interchangeError ? (
            <p role="alert" className="mt-2 text-xs leading-relaxed text-destructive">
              {interchangeError}
            </p>
          ) : null}
        </div>

        {/* Bench correlation (Giant 4): paste SIGNAL,x,value lines, verdict vs the tolerance envelope. */}
        <div className="rounded-md border border-border bg-muted/50 p-3">
          <h4 className="mb-1 text-xs font-medium text-card-foreground">Bench correlation</h4>
          <textarea
            aria-label="Bench samples (SIGNAL,x,value per line)"
            value={benchInput}
            onChange={(event) => setBenchInput(event.target.value)}
            placeholder={'V(OUT),0,2.5'}
            className="mb-2 h-16 w-full rounded-md border border-input bg-background px-2 py-1 font-mono text-xs"
          />
          <Button onClick={handleCorrelateBench} variant="outline" size="sm">
            Correlate bench samples
          </Button>
          {benchVerdict ? <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{benchVerdict}</p> : null}
        </div>

        {/* Digital timing: a discrete-event netlist (gates/FFs/clocks) with a step timeline. */}
        <div className="rounded-md border border-border bg-muted/50 p-3">
          <h4 className="mb-1 text-xs font-medium text-card-foreground">Digital timing</h4>
          <p className="mb-2 text-xs leading-relaxed text-muted-foreground">
            Four-state (0/1/X/Z) event-driven logic. Syntax:{' '}
            <span className="font-mono">GATE id TYPE out=n in=a[,b] [delay=d]</span>,{' '}
            <span className="font-mono">FF id D|T|JK|SR clock=n q=n qbar=n [D=n|T=n] [delay=d]</span>,{' '}
            <span className="font-mono">CLOCK id out=n period=p</span>, <span className="font-mono">SET n 0|1|X|Z</span>, <span className="font-mono">RUN until=t</span>.
          </p>
          <textarea
            aria-label="Digital netlist"
            value={digitalDeck}
            onChange={(event) => setDigitalDeck(event.target.value)}
            spellCheck={false}
            className="mb-2 h-28 w-full rounded-md border border-input bg-background px-2 py-1 font-mono text-xs"
          />
          <Button onClick={handleRunDigital} variant="outline" size="sm">
            Run digital timing
          </Button>
          {digitalOutput ? (
            digitalOutput.error ? (
              <p role="alert" className="mt-2 text-xs leading-relaxed text-destructive">{digitalOutput.error}</p>
            ) : (
              <div className="mt-2 space-y-2">
                <pre className="overflow-x-auto rounded border border-border bg-background px-2 py-1 font-mono text-xs text-foreground">
                  {digitalOutput.lines.length > 0 ? digitalOutput.lines.join('\n') : '(no switching nodes)'}
                </pre>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {digitalOutput.values.map(([node, value]) => (
                    <span key={node} className="font-mono text-xs text-muted-foreground">
                      {node}=<span className="text-foreground">{value}</span>
                    </span>
                  ))}
                </div>
              </div>
            )
          ) : null}

          {/* Mixed-signal: the digital deck's edges become PWL sources on analog nets. */}
          <div className="mt-3 border-t border-border pt-3">
            <h4 className="mb-1 text-xs font-medium text-card-foreground">Mixed-signal coupling</h4>
            <p className="mb-2 text-xs leading-relaxed text-muted-foreground">
              Drive an analog net from a digital node with{' '}
              <span className="font-mono">digitalNet=analogNet</span>, or threshold an analog net back
              into logic with <span className="font-mono">analogNet&gt;digitalNet</span>. One coupling per line.
            </p>
            <textarea
              aria-label="Mixed-signal couplings"
              value={mixedCoupling}
              onChange={(event) => setMixedCoupling(event.target.value)}
              spellCheck={false}
              className="mb-2 h-16 w-full rounded-md border border-input bg-background px-2 py-1 font-mono text-xs"
            />
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs text-muted-foreground">
                Seconds per digital tick
                <input
                  aria-label="Seconds per digital tick"
                  type="number"
                  step="any"
                  min="0"
                  value={mixedTimeScale}
                  onChange={(event) => setMixedTimeScale(Number(event.target.value))}
                  className="mt-1 block w-32 rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground"
                />
              </label>
              <label className="text-xs text-muted-foreground">
                Logic supply (V)
                <input
                  aria-label="Mixed-signal logic supply (V)"
                  type="number"
                  step="any"
                  value={mixedVdd}
                  onChange={(event) => setMixedVdd(Number(event.target.value))}
                  className="mt-1 block w-24 rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground"
                />
              </label>
              <Button onClick={handleRunMixedSignal} disabled={mixedBusy} variant="outline" size="sm">
                {mixedBusy ? 'Running…' : 'Run mixed-signal'}
              </Button>
            </div>
            {mixedOutput ? (
              mixedOutput.error ? (
                <p role="alert" className="mt-2 text-xs leading-relaxed text-destructive">{mixedOutput.error}</p>
              ) : (
                <div className="mt-2 space-y-1">
                  <pre className="overflow-x-auto rounded border border-border bg-background px-2 py-1 font-mono text-xs text-foreground">
                    {mixedOutput.lines.join('\n')}
                  </pre>
                </div>
              )
            ) : null}
          </div>
        </div>

        {/* Solver diagnostics: floating nets, non-convergence, step widening. */}
        {simulationResults?.notes && simulationResults.notes.length > 0 && (
          <div className="rounded-md border border-border bg-muted/50 p-3">
            <h4 className="mb-1 flex items-center gap-2 text-xs font-medium text-card-foreground">
              <Info className="h-3.5 w-3.5" aria-hidden="true" />
              Solver diagnostics
            </h4>
            <ul className="space-y-1">
              {simulationResults.notes.map((note) => (
                <li key={note} className="text-xs leading-relaxed text-muted-foreground">
                  {note}
                </li>
              ))}
            </ul>
          </div>
        )}

        {simulationResults && !simulationResults.success && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {simulationResults.error ?? 'The simulation could not be completed.'}
          </p>
        )}

        {/* Results */}
        {simulationResults && (
          <div className="flex-1 flex flex-col space-y-4">
            {designChangedSinceRun && (
              <p
                role="status"
                className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning"
              >
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                The sheet changed after this analysis ran. The plots and margins below
                describe the design that was solved; run the analysis again to measure
                the current sheet.
              </p>
            )}

            {simulationResults.success ? (
              <>
                {/* Operating Point */}
                {simulationResults.operatingPoint && (
                  <div>
                    <h4 className="text-sm font-medium mb-2">Operating Point</h4>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      {Object.entries(simulationResults.operatingPoint).map(([node, value]) => (
                        <div key={node} className="bg-muted p-2 rounded">
                          <div className="font-medium">{node}</div>
                          <div className="font-mono text-muted-foreground">{formatEngineering(value)} V</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Monte Carlo: a distribution of DC biases, one number per signal. */}
                {selectedAnalysis === 'montecarlo' && monteCarloRows.length > 0 && (
                  <div>
                    <h4 className="mb-2 text-sm font-medium">Tolerance envelope</h4>
                    <div className="overflow-x-auto rounded-md border border-border">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-muted/60 text-muted-foreground">
                          <tr>
                            <th scope="col" className="px-2 py-1.5 font-medium">Signal</th>
                            <th scope="col" className="px-2 py-1.5 font-medium">Mean</th>
                            <th scope="col" className="px-2 py-1.5 font-medium">±3σ</th>
                            <th scope="col" className="px-2 py-1.5 font-medium">Spread</th>
                          </tr>
                        </thead>
                        <tbody>
                          {monteCarloRows.map((row) => (
                            <tr key={row.name} className="border-t border-border/60">
                              <td className="px-2 py-1.5 font-medium">{row.name}</td>
                              <td className="px-2 py-1.5 font-mono">
                                {row.mean === undefined ? '—' : `${formatEngineering(row.mean)} ${row.unit}`}
                              </td>
                              <td className="px-2 py-1.5 font-mono">
                                {row.spread === undefined ? '—' : `±${formatEngineering(row.spread)} ${row.unit}`}
                              </td>
                              <td className="px-2 py-1.5 font-mono text-muted-foreground">
                                {row.percent === undefined ? '—' : `±${row.percent.toPrecision(3)} %`}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {!monteCarloCarriesBias && (
                      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                        Every DC node reads zero: this circuit is driven by a time-varying
                        source, and a bias-only Monte Carlo has no operating point to vary.
                        Add a DC source, or inspect a transient, to see a meaningful tolerance
                        envelope.
                      </p>
                    )}
                  </div>
                )}
                
                {/* Waveform Selection */}
                {selectedAnalysis !== 'montecarlo' && simulationResults.waveforms.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium mb-2">Waveforms</h4>
                    <div className="flex flex-wrap gap-2">
                      {simulationResults.waveforms.map(waveform => (
                        <label key={waveform.name} className="flex items-center gap-1 text-xs">
                          <input
                            type="checkbox"
                            checked={selectedWaveforms.includes(waveform.name)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedWaveforms(prev => [...prev, waveform.name])
                              } else {
                                setSelectedWaveforms(prev => prev.filter(name => name !== waveform.name))
                              }
                            }}
                            className="w-3 h-3"
                          />
                          <span>{waveform.name}</span>
                          <span className="text-muted-foreground">({waveform.unit})</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                
                {/* Waveform Plot */}
                {selectedAnalysis !== 'montecarlo' && selectedWaveforms.length > 0 && (
                  <div className="flex-1 min-h-0">
                    <h4 className="text-sm font-medium mb-2">Waveform Plot</h4>
                    <TraceChart
                      data={waveformData}
                      series={traceSeries}
                      logX={logFrequencyAxis}
                      height={280}
                      xLabel={traceXLabel}
                      xFormatter={traceXFormatter}
                      yFormatter={formatEngineering}
                      readoutFormatter={formatEngineeringPrecise}
                      rightFormatter={(value) => `${value.toFixed(0)}°`}
                      markerX={selectedAnalysis === 'transient' ? playhead : null}
                      ariaLabel="Circuit response"
                    />
                    {selectedAnalysis === 'transient' && simulationResults.waveforms.length > 0 && (
                      <div className="mt-2 flex items-center gap-2">
                        <Button
                          size="sm"
                          variant={playing ? 'destructive' : 'default'}
                          onClick={() => setPlaying((p) => !p)}
                          aria-label={playing ? 'Pause live playback' : 'Play live circuit'}
                        >
                          {playing ? 'Pause' : '▶ Run live'}
                        </Button>
                        <input
                          type="range"
                          min={0}
                          max={1000}
                          value={playhead === null ? 0 : Math.round((playhead / playDuration) * 1000)}
                          onChange={(e) => {
                            setPlaying(false)
                            setPlayhead((Number(e.target.value) / 1000) * playDuration)
                          }}
                          aria-label="Playback time"
                          className="flex-1"
                        />
                        <span className="font-mono text-xs text-muted-foreground">
                          {playhead === null ? '—' : `${playhead.toExponential(2)} s`}
                        </span>
                      </div>
                    )}
                  </div>
                )}
                
                {/* Scope measurements: min/max/pp/RMS/frequency/duty per trace. */}
                {scopeMeasurements.length > 0 && selectedAnalysis !== 'montecarlo' && (
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <h4 className="text-sm font-medium">Scope measurements</h4>
                      <Button size="sm" variant="outline" onClick={handleExportCsv}>Export CSV</Button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {scopeMeasurements.map(({ name, unit, measurement }) => (
                        <div key={name} className="rounded bg-muted p-2">
                          <div className="font-medium">{name} <span className="text-muted-foreground">({unit})</span></div>
                          <div className="mt-1 font-mono leading-relaxed text-muted-foreground">
                            pk-pk {formatEngineering(measurement.peakToPeak)} · RMS {formatEngineering(measurement.rms)} · mean {formatEngineering(measurement.mean)}
                            {measurement.frequencyHz !== null && (
                              <> · f {measurement.frequencyHz >= 1000 ? `${(measurement.frequencyHz / 1000).toFixed(2)} kHz` : `${measurement.frequencyHz.toFixed(1)} Hz`}</>
                            )}
                            {measurement.dutyCycle !== null && (
                              <> · duty {(measurement.dutyCycle * 100).toFixed(1)}%</>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Ratings, heating and the power budget: measured against
                    declared limits, with unrated parts called out explicitly. */}
                <div>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <h4 className="text-sm font-medium">Ratings, heating &amp; power</h4>
                    {designMargins && (
                      <span className="text-xs text-muted-foreground">
                        {designMargins.items.length === 0
                          ? 'No rated part measured'
                          : (() => {
                              const failures = designMargins.items.filter((item) => item.status === 'fail').length
                              const warnings = designMargins.items.filter((item) => item.status === 'warn').length
                              if (failures > 0) return `${failures} over limit`
                              if (warnings > 0) return `${warnings} near limit`
                              return `All ${designMargins.items.length} checks inside limits`
                            })()}
                      </span>
                    )}
                  </div>

                  {designMargins ? (
                    <div className="space-y-2 text-xs">
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <div className="rounded bg-muted p-2">
                          <div className="text-muted-foreground">Limiting factor</div>
                          <div className="mt-1 font-mono leading-relaxed">
                            {designMargins.limitingFactor ?? 'No comparable rating declared'}
                          </div>
                        </div>
                        <div className="rounded bg-muted p-2">
                          <div className="text-muted-foreground">Hottest part (estimate)</div>
                          <div className="mt-1 font-mono leading-relaxed">
                            {designMargins.hottest
                              ? `${designMargins.hottest.reference}: ${designMargins.hottest.thermal.junctionC.toFixed(1)} °C (+${designMargins.hottest.thermal.riseC.toFixed(1)} K)`
                              : 'No part had both power and θJA'}
                            {designMargins.hottest && (
                              <span className="text-muted-foreground">
                                {' '}· θJA {designMargins.hottest.thermal.thetaJa} K/W
                                {designMargins.hottest.thermal.estimated ? ' typical package' : ' declared'}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="rounded bg-muted p-2 sm:col-span-2">
                          <div className="text-muted-foreground">
                            Power budget · {designMargins.power.basis}
                          </div>
                          <div className="mt-1 font-mono leading-relaxed">
                            supplied {designMargins.power.suppliedW === undefined ? 'not solved' : formatWatts(designMargins.power.suppliedW)}
                            {' · '}dissipated {designMargins.power.dissipatedW === undefined ? 'not solved' : formatWatts(designMargins.power.dissipatedW)}
                            {' · '}{designMargins.power.sourceCount} source{designMargins.power.sourceCount === 1 ? '' : 's'}
                          </div>
                        </div>
                      </div>

                      {designMargins.items.length > 0 && (
                        <ul className="space-y-1.5">
                          {designMargins.items.map((item) => (
                            <li key={item.id} className="rounded border border-border p-2">
                              <div className="flex items-start justify-between gap-2">
                                <div className="font-medium">
                                  {item.reference}{' '}
                                  <span className="text-muted-foreground">
                                    {item.quantity === 'junction-temperature' ? 'Tj' : item.quantity}
                                  </span>
                                </div>
                                <div className={`text-right font-mono ${MARGIN_STATUS_CLASS[item.status]}`}>
                                  {formatMarginValue(item)} / {formatMarginLimit(item)}
                                  <span className="block text-muted-foreground">
                                    {(item.utilization * 100).toFixed(1)} % · {MARGIN_STATUS_LABEL[item.status]}
                                  </span>
                                </div>
                              </div>
                              <div className="mt-1 h-1.5 overflow-hidden rounded bg-border" aria-hidden="true">
                                <div
                                  className={`h-full ${MARGIN_BAR_CLASS[item.status]}`}
                                  style={{ width: `${Math.min(100, Math.max(0, item.utilization * 100))}%` }}
                                />
                              </div>
                              <div className="mt-1 leading-relaxed text-muted-foreground">{item.basis}</div>
                              {item.thermal && (
                                <div className="mt-0.5 leading-relaxed text-muted-foreground">
                                  Tj {item.thermal.junctionC.toFixed(1)} °C at {item.thermal.ambientC.toFixed(1)} °C ambient
                                  {item.thermal.limitC !== undefined ? `, limit ${item.thermal.limitC.toFixed(0)} °C` : ''}
                                </div>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}

                      {designMargins.coverage.unrated.length > 0 && (
                        <div className="rounded border border-border p-2">
                          <div className="font-medium">
                            Not rated ({designMargins.coverage.unrated.length})
                          </div>
                          <ul className="mt-1 space-y-0.5 leading-relaxed text-muted-foreground">
                            {designMargins.coverage.unrated.map((entry) => (
                              <li key={entry.reference}>
                                <span className="font-mono">{entry.reference}</span> — {entry.reason}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {designMargins.notes.map((note) => (
                        <p key={note} className="text-warning">
                          {note}
                        </p>
                      ))}

                      <details className="rounded border border-border p-2">
                        <summary className="cursor-pointer text-muted-foreground">
                          How these numbers were obtained
                        </summary>
                        <ul className="mt-1 space-y-0.5 leading-relaxed text-muted-foreground">
                          {designMargins.assumptions.map((assumption) => (
                            <li key={assumption}>{assumption}</li>
                          ))}
                        </ul>
                      </details>
                    </div>
                  ) : (
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      This result came from a stitched or imported deck, so its parts cannot be
                      matched to the ratings declared on the drawn sheet. Run the drawn sheet to
                      measure margins.
                    </p>
                  )}
                </div>

                {/* Convergence Info */}
                {simulationResults.convergenceInfo && (
                  <div className="text-xs text-muted-foreground">
                    Convergence: {simulationResults.convergenceInfo.converged ? 'Success' : 'Failed'} 
                    ({simulationResults.convergenceInfo.iterations} iterations)
                  </div>
                )}
              </>
            ) : (
              <div className="text-destructive text-sm">
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="w-4 h-4" />
                  Simulation Error
                </div>
                <div className="bg-destructive/10 p-3 rounded">
                  {simulationResults.error}
                </div>
              </div>
            )}
          </div>
        )}
        
        {/* Empty State */}
        {!simulationResults && !isSimulating && (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <BarChart3 className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p className="text-sm">Configure parameters and run simulation</p>
              <p className="text-xs mt-1">
                {components.length === 0 ? 'Add components to your circuit first' : `${components.length} components ready`}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
