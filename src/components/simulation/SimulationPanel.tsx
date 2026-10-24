import { useState, useEffect, useMemo, type ChangeEvent } from 'react'
import { Play, Download, Zap, BarChart3, X, AlertCircle, Info } from 'lucide-react'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
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
import { useTheme } from '../../lib/theme/useTheme'
import { chartSeriesColors } from '../../lib/theme/tokens'
import { describeError } from '../../lib/utils'

interface SimulationPanelProps {
  onClose: () => void
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
  noise: 'Output-referred thermal and shot noise via the adjoint (transposed) network method, with an integrated RMS figure.',
  montecarlo: 'Re-solves the bias with R/C/L perturbed inside a tolerance band, reporting the mean and the ±3σ envelope. Seeded, so a sweep is reproducible.',
}

/** Component types whose value a DC sweep can step, by normalised symbol name. */
const SWEEPABLE_TYPES = new Set(['voltage_source', 'current_source', 'resistor'])

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

/** A ready-to-run digital deck so the timing card is useful on first open. */
const DIGITAL_EXAMPLE = [
  '# 2-bit ripple counter: CLOCK drives two T flip-flops, Q0 toggles every rising edge.',
  'CLOCK c0 out=CLK period=20',
  'FF q0 T clock=CLK q=Q0 qbar=Q0B T=one delay=3',
  'FF q1 T clock=Q0 q=Q1 qbar=Q1B T=one delay=3',
  'SET one 1',
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

export default function SimulationPanel({ onClose }: SimulationPanelProps) {
  const [isSimulating, setIsSimulating] = useState(false)
  const [simulationResults, setSimulationResults] = useState<SimulationResult | null>(null)
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

  useEffect(() => {
    setParameters((previous) => ({ ...previous, type: selectedAnalysis }))
  }, [selectedAnalysis])

  const handleRunSimulation = async () => {
    if (modelLibrary && modelLibrary.errors.length > 0) {
      setError(`Fix the model-card errors first: ${modelLibrary.errors.join(' ')}`)
      return
    }
    setIsSimulating(true)
    setError(null)

    try {
      const netlist = attachModelCards(buildCircuitNetlist('Circuit Simulation', components, wires, parameters))
      const result = await spiceEngine.simulate(netlist)
      setSimulationResults(result)
      setSelectedWaveforms(pickDefaultWaveforms(result.waveforms.map((w) => w.name)))
      // Persist the run into the design so it survives save/load and VCS commits.
      addSimulationRun({
        name: `${ANALYSIS_LABELS[selectedAnalysis]} — ${new Date().toLocaleString()}`,
        type: selectedAnalysis,
        parameters: parameters as unknown as Record<string, unknown>,
        results: result as unknown as Record<string, unknown>,
        status: 'completed',
      })
    } catch (thrown) {
      // Building the netlist can fail (conflicting net names). Report it here
      // rather than in an `alert`, so it stays attached to the panel.
      setError(describeError(thrown))
      setSimulationResults(null)
    } finally {
      setIsSimulating(false)
    }
  }

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
      const { bands } = toleranceEnvelope(model, (perturbed) => runOperatingPoint(perturbed, { temperatureCelsius: 27 }).outcome, { iterations: 60, tolerance: 0.05 })
      const verdict = correlateBench(bands, samples)
      setBenchVerdict(verdict.summary)
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
      if (!result.success) {
        throw new Error(result.error ?? 'The stitched netlist did not solve.')
      }
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
      setInterchangeError(describeError(thrown))
    } finally {
      setStitching(false)
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
  
  const getWaveformData = () => {
    if (!simulationResults?.waveforms) return []
    
    const selectedWaveformData = simulationResults.waveforms.filter(wf =>
      selectedWaveforms.includes(wf.name)
    )
    
    if (selectedWaveformData.length === 0) return []
    
    // Combine all selected waveforms into a single dataset
    const maxLength = Math.max(...selectedWaveformData.map(wf => wf.data.length))
    
    return Array.from({ length: maxLength }, (_, i) => {
      const point: Record<string, number> = {}
      
      selectedWaveformData.forEach(waveform => {
        if (i < waveform.data.length) {
          if (!point.x) point.x = waveform.data[i].x
          point[waveform.name] = waveform.data[i].y
        }
      })
      
      return point
    })
  }
  
  const getWaveformColors = () => {
    return selectedWaveforms.reduce<Record<string, string>>((acc, name, index) => {
      acc[name] = seriesColors[index % seriesColors.length]
      return acc
    }, {})
  }

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
                          <div className="text-muted-foreground">{value.toFixed(6)} V</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                {/* Waveform Selection */}
                {simulationResults.waveforms.length > 0 && (
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
                {selectedWaveforms.length > 0 && (
                  <div className="flex-1 min-h-0">
                    <h4 className="text-sm font-medium mb-2">Waveform Plot</h4>
                    <div className="h-64 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={getWaveformData()}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis
                            dataKey="x"
                            type="number"
                            scale="linear"
                            domain={['dataMin', 'dataMax']}
                            tickFormatter={(value) => {
                              if (selectedAnalysis === 'ac') {
                                return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value.toFixed(0)
                              }
                              // A sweep's x axis is a component value, not a time:
                              // scientific notation on "2 volts" reads as noise.
                              if (selectedAnalysis === 'dc-sweep') return value.toPrecision(4)
                              return value.toExponential(2)
                            }}
                          />
                          <YAxis
                            tickFormatter={(value) => value.toFixed(2)}
                          />
                          <Tooltip
                            formatter={(value: number, name: string) => [
                              typeof value === 'number' ? value.toFixed(4) : value,
                              name
                            ]}
                            labelFormatter={(value: number) => {
                              if (selectedAnalysis === 'ac') {
                                return `Frequency: ${value >= 1000 ? `${(value / 1000).toFixed(1)}kHz` : `${value}Hz`}`
                              }
                              if (selectedAnalysis === 'dc-sweep') {
                                return `${parameters.sweepSource ?? 'TEMP'} = ${value}`
                              }
                              return `Time: ${value}s`
                            }}
                          />
                          <Legend />
                          {selectedWaveforms.map(name => (
                            <Line
                              key={name}
                              type="monotone"
                              dataKey={name}
                              stroke={getWaveformColors()[name]}
                              strokeWidth={2}
                              dot={false}
                            />
                          ))}
                          {playhead !== null && selectedAnalysis === 'transient' && (
                            <Line
                              type="monotone"
                              dataKey={() => playhead}
                              stroke="#888"
                              strokeDasharray="4 4"
                              dot={false}
                              isAnimationActive={false}
                            />
                          )}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
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
                {scopeMeasurements.length > 0 && (
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
                            pk-pk {measurement.peakToPeak.toPrecision(4)} · RMS {measurement.rms.toPrecision(4)} · mean {measurement.mean.toPrecision(4)}
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
