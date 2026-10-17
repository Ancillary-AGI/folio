import { useState, useEffect, useMemo } from 'react'
import { Play, Download, Zap, BarChart3, X, AlertCircle, Info } from 'lucide-react'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { spiceEngine, SimulationParameters, SimulationResult } from '../../lib/simulation/spiceEngine'
import { buildCircuitNetlist } from '../../lib/simulation/netlistBuilder'
import { playbackDuration, playbackFrame } from '../../lib/simulation/playback'
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
  transient: 'Integrates capacitors and inductors with backward-Euler companion models — unconditionally stable, and it will not ring on an ideal step.',
  ac: 'Sweeps the complex small-signal network, linearising diodes at the DC operating point so the response belongs to the bias you designed.',
  noise: 'Output-referred thermal and shot noise via the adjoint (transposed) network method, with an integrated RMS figure.',
  montecarlo: 'Re-solves the bias with R/C/L perturbed inside a tolerance band, reporting the mean and the ±3σ envelope. Seeded, so a sweep is reproducible.',
}

/** Component types whose value a DC sweep can step, by normalised symbol name. */
const SWEEPABLE_TYPES = new Set(['voltage_source', 'current_source', 'resistor'])

/** A ready-to-run digital deck so the timing card is useful on first open. */
const DIGITAL_EXAMPLE = [
  '# 2-bit ripple counter: CLOCK drives two T flip-flops, Q0 toggles every rising edge.',
  'CLOCK c0 out=CLK period=20',
  'FF q0 T clock=CLK q=Q0 qbar=Q0B T=one delay=3',
  'FF q1 T clock=Q0 q=Q1 qbar=Q1B T=one delay=3',
  'SET one 1',
  'RUN until=120',
].join('\n')


export default function SimulationPanel({ onClose }: SimulationPanelProps) {
  const [isSimulating, setIsSimulating] = useState(false)
  const [simulationResults, setSimulationResults] = useState<SimulationResult | null>(null)
  const [selectedAnalysis, setSelectedAnalysis] = useState<AnalysisType>('dc')
  const [error, setError] = useState<string | null>(null)
  const [parameters, setParameters] = useState<SimulationParameters>({ type: 'dc' })
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
    setIsSimulating(true)
    setError(null)

    try {
      const netlist = buildCircuitNetlist('Circuit Simulation', components, wires, parameters)
      const result = await spiceEngine.simulate(netlist)
      setSimulationResults(result)
      setSelectedWaveforms(result.waveforms.length > 0 ? [result.waveforms[0].name] : [])
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
      const netlist = buildCircuitNetlist('Bench correlation', components, wires, { type: 'dc' })
      const { model, errors } = buildCircuitModel(netlist)
      if (errors.length > 0) throw new Error(errors.join(' '))
      const { bands } = toleranceEnvelope(model, (perturbed) => runOperatingPoint(perturbed, { temperatureCelsius: 27 }).outcome, { iterations: 60, tolerance: 0.05 })
      const verdict = correlateBench(bands, samples)
      setBenchVerdict(verdict.summary)
    } catch (thrown) {
      setBenchVerdict(`Bench correlation failed: ${describeError(thrown)}`)
    }
  }

  const [digitalDeck, setDigitalDeck] = useState<string>(DIGITAL_EXAMPLE)
  const [digitalOutput, setDigitalOutput] = useState<{ lines: string[]; values: Array<[string, string]>; error: string | null } | null>(null)

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
            disabled={isSimulating || components.length === 0}
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
