/**
 * Autopilot workbench — a bounded, observable design loop.
 *
 * The agent edits the live schematic, simulates every candidate, reads margins,
 * and keeps the best measured design. This panel exposes the goal, the knobs,
 * the constraints, and the per-iteration evidence (schematic + waveform SVG)
 * so an engineer can audit *why* a result was chosen rather than trusting a
 * black box. It also states plainly that a bounded grid search is not a proof
 * of a global optimum, and that always-on runs need a cloud runner.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  Box,
  CheckCircle2,
  CircuitBoard,
  Cloud,
  CloudOff,
  Gauge,
  Loader2,
  Play,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Square,
  Trash2,
  Wrench,
} from 'lucide-react'
import { Button } from '../../ui/button'
import { Input } from '../../ui/input'
import { useProjectStore } from '../../../stores/useProjectStore'
import { captureDesignSnapshot, schematicToSvg } from '../../../lib/agents/designSnapshot'
import { capturePcbSnapshot, pcbToSvg } from '../../../lib/agents/pcbSnapshot'
import { captureMechanicalSnapshot, mechanicalToSvg } from '../../../lib/agents/mechanicalSnapshot'
import { createStoreCadRuntime } from '../../../lib/agents/cadRuntime'
import {
  runAutopilot,
  type AutopilotConstraints,
  type AutopilotGoal,
  type AutopilotIteration,
  type AutopilotResult,
} from '../../../lib/agents/autopilot'
import { parseSpiceValue } from '../../../lib/simulation/devices'
import type { SimulationParameters } from '../../../lib/simulation/spiceEngine'
import type { Statistic } from '../../../lib/simulation/waveformStats'
import {
  agentSessionStore,
  createAgentSession,
  finishAgentSession,
  recordAutopilotIteration,
  recordAgentSessionEvent,
  type AgentSession,
} from '../../../lib/agents/agentSession'
import {
  cloudAgentConfigFromEnv,
  cloudAgentTransportFromEnv,
  createAgentJobRequest,
  type CloudAgentTransport,
} from '../../../lib/agents/cloudAgentTransport'
import { useDemoRequest } from '../../workspace/useDemoRequest'

const STATISTICS: ReadonlyArray<{ value: Statistic; label: string }> = [
  { value: 'ripple', label: 'Ripple (p-p, settled)' },
  { value: 'rms', label: 'RMS' },
  { value: 'peak', label: 'Peak (max)' },
  { value: 'minimum', label: 'Minimum' },
  { value: 'mean', label: 'Mean' },
  { value: 'final', label: 'Final value' },
  { value: 'start', label: 'Start value' },
]

const numberFrom = (value: string): number | undefined => {
  if (!value.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

const formatValue = (value: number | undefined, unit?: string): string => {
  if (value === undefined || !Number.isFinite(value)) return '—'
  const magnitude = Math.abs(value)
  const text = magnitude !== 0 && (magnitude >= 1e6 || magnitude < 1e-3)
    ? value.toExponential(3)
    : String(Number(value.toPrecision(5)))
  return unit ? `${text} ${unit}` : text
}

interface KnobRow {
  key: string
  reference: string
  property: string
  from: string
  to: string
  scale: 'linear' | 'log'
}

const newKnob = (index: number): KnobRow => ({
  key: `knob-${Date.now()}-${index}`,
  reference: '',
  property: 'value',
  from: '',
  to: '',
  scale: 'log',
})

type AnalysisKind = 'transient' | 'dc' | 'ac'

interface AutopilotForm {
  description: string
  metricKind: 'waveform' | 'margin'
  waveform: string
  statistic: Statistic
  settled: boolean
  target: string
  tolerance: string
  direction: 'minimize' | 'maximize'
  analysis: AnalysisKind
  analysisParams: { stopMs: string; stepUs: string; startHz: string; stopHz: string }
  knobs: KnobRow[]
  constraints: AutopilotConstraints
}

function analysisFor(kind: AnalysisKind, params: {
  stopMs: string
  stepUs: string
  startHz: string
  stopHz: string
}): SimulationParameters {
  if (kind === 'dc') return { type: 'dc' }
  if (kind === 'ac') {
    return {
      type: 'ac',
      startFreq: numberFrom(params.startHz) ?? 10,
      stopFreq: numberFrom(params.stopHz) ?? 1e6,
      pointsPerDecade: 20,
    }
  }
  return {
    type: 'transient',
    stopTime: (numberFrom(params.stopMs) ?? 20) / 1000,
    stepTime: (numberFrom(params.stepUs) ?? 20) / 1e6,
  }
}

function metricLabel(goal: AutopilotGoal): string {
  if (goal.metric.kind === 'margin') return 'Worst rating utilisation'
  const settled = goal.metric.settled ? 'settled ' : ''
  return `${goal.metric.waveform} ${settled}${goal.metric.statistic}`
}

function goalFromForm(form: AutopilotForm): AutopilotGoal {
  const knobs = form.knobs
    .filter((knob) => knob.reference.trim() !== '')
    .map((knob) => {
      const from = numberFrom(knob.from)
      const to = numberFrom(knob.to)
      if (from === undefined || to === undefined) {
        throw new Error(`${knob.reference}.${knob.property} needs numeric from/to values.`)
      }
      return {
        reference: knob.reference.trim(),
        property: knob.property.trim() || 'value',
        from,
        to,
        scale: knob.scale,
      }
    })
  if (knobs.length === 0) throw new Error('Add at least one knob (a part reference and its numeric range) to tune.')

  const metric = form.metricKind === 'margin'
    ? { kind: 'margin' as const }
    : {
        kind: 'waveform' as const,
        waveform: form.waveform.trim(),
        statistic: form.statistic,
        settled: form.settled,
      }
  if (form.metricKind === 'waveform' && !form.waveform.trim()) {
    throw new Error('Name the waveform to measure, for example V(OUT).')
  }

  const targetValue = numberFrom(form.target)
  const tolerance = numberFrom(form.tolerance)
  if (targetValue !== undefined && (tolerance === undefined || tolerance <= 0)) {
    throw new Error('A target needs a positive tolerance, or leave both blank to minimise/maximise.')
  }

  const goal: AutopilotGoal = {
    description: form.description.trim()
      || (form.metricKind === 'margin' ? 'Minimise worst rating utilisation' : `Minimise ${form.waveform} ${form.statistic}`),
    analysis: analysisFor(form.analysis, form.analysisParams),
    metric,
    direction: form.direction,
    knobs,
    constraints: form.constraints,
  }
  if (targetValue !== undefined && tolerance !== undefined) {
    goal.target = { value: targetValue, tolerance }
  }
  return goal
}

const statusClass = (iteration: AutopilotIteration): string => {
  if (iteration.error) return 'text-destructive'
  if (iteration.goalMet) return 'text-success'
  return 'text-muted-foreground'
}

const SVG_PREVIEW = 'block w-full h-auto rounded-md border border-border bg-card'

const DEMO_SEARCH = { samplesPerKnob: 3, maxIterations: 6 }

const DEMO_FORM: AutopilotForm = {
  description: 'Minimise rectifier output ripple',
  metricKind: 'waveform',
  waveform: 'V(OUT)',
  statistic: 'ripple',
  settled: true,
  target: '',
  tolerance: '',
  direction: 'minimize',
  analysis: 'transient',
  analysisParams: { stopMs: '20', stepUs: '20', startHz: '10', stopHz: '1000000' },
  knobs: [{ key: 'demo-c1', reference: 'C1', property: 'value', from: '1e-6', to: '470e-6', scale: 'log' }],
  constraints: { requireErcPass: true, requireAllRated: false, maxWorstUtilization: 0.8, ambientCelsius: 25 },
}

interface AutopilotWorkbenchProps {
  onSessionSaved?: (session: AgentSession) => void
  onActivate?: () => void
}

export default function AutopilotWorkbench({ onSessionSaved, onActivate }: AutopilotWorkbenchProps) {
  const components = useProjectStore((state) => state.components)
  const wires = useProjectStore((state) => state.wires)
  const pcbLayout = useProjectStore((state) => state.pcbLayout)
  const mechanicalParts = useProjectStore((state) => state.mechanicalParts)

  const [description, setDescription] = useState('Minimise output ripple')
  const [metricKind, setMetricKind] = useState<'waveform' | 'margin'>('waveform')
  const [waveform, setWaveform] = useState('V(OUT)')
  const [statistic, setStatistic] = useState<Statistic>('ripple')
  const [settled, setSettled] = useState(true)
  const [target, setTarget] = useState('')
  const [tolerance, setTolerance] = useState('')
  const [direction, setDirection] = useState<'minimize' | 'maximize'>('minimize')
  const [analysis, setAnalysis] = useState<AnalysisKind>('transient')
  const [analysisParams, setAnalysisParams] = useState({
    stopMs: '20',
    stepUs: '20',
    startHz: '10',
    stopHz: '1000000',
  })
  const [knobs, setKnobs] = useState<KnobRow[]>([newKnob(0)])
  const [constraints, setConstraints] = useState<AutopilotConstraints>({
    requireErcPass: true,
    requireAllRated: false,
    maxWorstUtilization: 0.8,
    ambientCelsius: 25,
  })
  const [samplesPerKnob, setSamplesPerKnob] = useState('5')
  const [maxIterations, setMaxIterations] = useState('60')

  const [running, setRunning] = useState(false)
  const [iterations, setIterations] = useState<AutopilotIteration[]>([])
  const [selectedIteration, setSelectedIteration] = useState<number | null>(null)
  const [result, setResult] = useState<AutopilotResult | null>(null)
  const [session, setSession] = useState<AgentSession | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [cloudJob, setCloudJob] = useState<{ id: string; state: string; message?: string } | null>(null)
  const [cloudBusy, setCloudBusy] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)
  const cloud = useMemo(() => cloudAgentConfigFromEnv(), [])
  const transport = useMemo<CloudAgentTransport>(() => cloudAgentTransportFromEnv(), [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
    }
  }, [])

  const currentSchematic = useMemo(() => {
    try {
      return schematicToSvg(captureDesignSnapshot(components, wires))
    } catch {
      return undefined
    }
  }, [components, wires])

  // Same observation the agent gets from `eda.observe`, so the preview and the
  // snapshot can never disagree about which copper is on the board.
  const currentBoard = useMemo(() => {
    if (!pcbLayout) return undefined
    try {
      return {
        svg: pcbToSvg(pcbLayout, { width: 720 }),
        stats: capturePcbSnapshot(pcbLayout).stats,
      }
    } catch {
      return undefined
    }
  }, [pcbLayout])

  // The same snapshot `mech.observe` returns: the drawing here and the one an
  // agent reasons about are generated from one assembly.
  const currentAssembly = useMemo(() => {
    try {
      const snapshot = captureMechanicalSnapshot(mechanicalParts)
      return {
        svg: mechanicalToSvg(mechanicalParts, { width: 720 }),
        summary: snapshot.summary,
        warnings: snapshot.warnings.length,
      }
    } catch {
      return undefined
    }
  }, [mechanicalParts])

  const selected = useMemo(
    () => (selectedIteration === null ? undefined : iterations.find((item) => item.iteration === selectedIteration)),
    [iterations, selectedIteration],
  )

  const updateKnob = (key: string, patch: Partial<KnobRow>): void => {
    setKnobs((current) => current.map((knob) => (knob.key === key ? { ...knob, ...patch } : knob)))
  }

  const suggestKnob = (): void => {
    const numericValue = (component: typeof components[number]): number | undefined => {
      try {
        const parsed = parseSpiceValue(component.properties.value, `${component.reference}.value`)
        return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
      } catch {
        return undefined
      }
    }
    const usable = components.filter((component) => numericValue(component) !== undefined)
    if (usable.length === 0) {
      setNotice('No part on the sheet has a numeric value to sweep. Add a resistor or capacitor first.')
      return
    }
    // Ripple is dominated by the filter capacitor; suggesting a series
    // resistor would let the search "win" by starving the load instead of
    // filtering it. Other objectives fall back to the first numeric part.
    const wantsFilter = statistic === 'ripple' || /ripple/i.test(description)
    const candidate = (wantsFilter ? usable.find((component) => /^C/i.test(component.reference)) : undefined)
      ?? usable[0]
    const parsed = numericValue(candidate)
    if (parsed === undefined) return
    const from = parsed / 10
    const to = parsed * 10
    setKnobs((current) => {
      const empty = current.find((knob) => knob.reference.trim() === '')
      const row: KnobRow = {
        key: empty?.key ?? `knob-suggest-${Date.now()}`,
        reference: candidate.reference,
        property: 'value',
        from: String(Number(from.toPrecision(4))),
        to: String(Number(to.toPrecision(4))),
        scale: 'log',
      }
      return empty ? current.map((knob) => (knob.key === empty.key ? row : knob)) : [...current, row]
    })
    setNotice(`Suggested ${candidate.reference}.value from ${formatValue(from)} to ${formatValue(to)}.`)
  }

  const runWithForm = async (
    form: AutopilotForm,
    search: { samplesPerKnob: number; maxIterations: number },
  ): Promise<void> => {
    setError(null)
    setNotice(null)
    setResult(null)
    setSession(null)
    setIterations([])
    setSelectedIteration(null)
    setRunning(true)
    const controller = new AbortController()
    abortRef.current = controller

    let goal: AutopilotGoal
    try {
      goal = goalFromForm(form)
    } catch (buildError) {
      setError(buildError instanceof Error ? buildError.message : String(buildError))
      setRunning(false)
      abortRef.current = null
      return
    }

    const budget = {
      maxCalls: Math.max(20, search.maxIterations * 4),
      maxWallMs: 120_000,
    }
    let liveSession = createAgentSession({
      title: form.description.trim() || 'Autopilot run',
      goal: form.description.trim(),
      budget,
    })
    liveSession = recordAgentSessionEvent(liveSession, {
      kind: 'goal',
      message: `${goal.analysis.type} · ${metricLabel(goal)} · ${goal.knobs?.length ?? 0} knob(s)`,
    }, Date.now())

    try {
      const outcome = await runAutopilot({
        runtime: createStoreCadRuntime(),
        goal,
        samplesPerKnob: Math.max(2, search.samplesPerKnob),
        maxIterations: Math.max(1, search.maxIterations),
        signal: controller.signal,
        onEvent: (iteration) => {
          setIterations((current) => [...current, iteration])
          setSelectedIteration(iteration.iteration)
          liveSession = recordAutopilotIteration(liveSession, iteration)
        },
      })
      setResult(outcome)
      liveSession = finishAgentSession(liveSession, {
        status: outcome.achieved ? 'completed' : 'stopped',
        summary: outcome.reason,
        ...(outcome.fingerprint !== undefined ? { finalFingerprint: outcome.fingerprint } : {}),
      })
      setSession(liveSession)
      const saved = agentSessionStore.save(liveSession)
      if (!saved.ok) setNotice(saved.error ?? 'The session could not be persisted.')
      onSessionSaved?.(liveSession)
    } catch (runError) {
      const message = runError instanceof Error ? runError.message : String(runError)
      setError(message)
      liveSession = finishAgentSession(liveSession, { status: 'failed', summary: message })
      setSession(liveSession)
      const saved = agentSessionStore.save(liveSession)
      if (!saved.ok) setNotice(saved.error ?? 'The session could not be persisted.')
      onSessionSaved?.(liveSession)
    } finally {
      setRunning(false)
      abortRef.current = null
    }
  }

  const start = (): void => {
    void runWithForm(
      {
        description,
        metricKind,
        waveform,
        statistic,
        settled,
        target,
        tolerance,
        direction,
        analysis,
        analysisParams,
        knobs,
        constraints,
      },
      {
        samplesPerKnob: Math.max(2, Math.round(numberFrom(samplesPerKnob) ?? 5)),
        maxIterations: Math.max(1, Math.round(numberFrom(maxIterations) ?? 60)),
      },
    )
  }

  const runDemo = (): void => {
    onActivate?.()
    setDescription(DEMO_FORM.description)
    setMetricKind(DEMO_FORM.metricKind)
    setWaveform(DEMO_FORM.waveform)
    setStatistic(DEMO_FORM.statistic)
    setSettled(DEMO_FORM.settled)
    setTarget(DEMO_FORM.target)
    setTolerance(DEMO_FORM.tolerance)
    setDirection(DEMO_FORM.direction)
    setAnalysis(DEMO_FORM.analysis)
    setAnalysisParams(DEMO_FORM.analysisParams)
    setKnobs(DEMO_FORM.knobs)
    setConstraints(DEMO_FORM.constraints)
    setSamplesPerKnob(String(DEMO_SEARCH.samplesPerKnob))
    setMaxIterations(String(DEMO_SEARCH.maxIterations))
    // Defer past the StrictMode effect replay: its simulated unmount aborts a
    // run started synchronously, which would leave the demo stuck on "Running".
    window.setTimeout(() => {
      if (!mountedRef.current) return
      void runWithForm(DEMO_FORM, DEMO_SEARCH)
    }, 0)
  }

  useDemoRequest('agents-autopilot', runDemo)

  const stop = (): void => {
    abortRef.current?.abort()
    setNotice('Stopping after the current candidate…')
  }

  const restoreBest = (): void => {
    if (!result?.best) return
    useProjectStore.getState().replaceDesign(result.best.design)
    setNotice(`Restored iteration #${result.best.iteration}; the sheet now shows the winning values.`)
  }

  const queueCloud = async (): Promise<void> => {
    setCloudBusy(true)
    setError(null)
    try {
      const goal = goalFromForm({
        description,
        metricKind,
        waveform,
        statistic,
        settled,
        target,
        tolerance,
        direction,
        analysis,
        analysisParams,
        knobs,
        constraints,
      })
      const sessionId = session?.id ?? createAgentSession({ title: description || 'Cloud job' }).id
      const design = { components, wires, firmware: useProjectStore.getState().firmwareCode ?? '' }
      const job = createAgentJobRequest({
        sessionId,
        title: description.trim() || 'Autopilot run',
        goal,
        design,
        budget: { maxCalls: Math.max(20, (numberFrom(maxIterations) ?? 60) * 4), maxWallMs: 120_000 },
        approvalMode: 'auto',
      })
      const submitted = await transport.submit(job)
      setCloudJob({ id: submitted.jobId, state: submitted.state })
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError))
    } finally {
      setCloudBusy(false)
    }
  }

  const refreshCloud = async (): Promise<void> => {
    if (!cloudJob) return
    setCloudBusy(true)
    try {
      const status = await transport.status(cloudJob.id)
      setCloudJob({ id: status.id, state: status.state, ...(status.message ? { message: status.message } : {}) })
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : String(statusError))
    } finally {
      setCloudBusy(false)
    }
  }

  const knobHint = 'A knob is a part property the search may change within the given numeric range. Values are SI units.'

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3">
      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {notice && !error && (
        <div className="rounded-md border border-border bg-card p-2 text-xs text-muted-foreground" aria-live="polite">
          {notice}
        </div>
      )}

      <div className="grid gap-3 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="space-y-3">
          <section className="rounded-lg border border-border bg-card p-3" aria-labelledby="goal-heading">
            <h3 id="goal-heading" className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Gauge size={13} /> Goal
            </h3>
            <label className="block text-xs text-muted-foreground" htmlFor="agent-goal">
              What should improve?
            </label>
            <Input
              id="agent-goal"
              className="mt-1 h-8 bg-background text-xs"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Minimise output ripple at 5 V"
            />

            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="block text-xs text-muted-foreground">
                Measure
                <select
                  aria-label="Measure"
                  className="mt-1 h-8 w-full rounded-md border border-border bg-background px-1 text-xs text-foreground"
                  value={metricKind}
                  onChange={(event) => setMetricKind(event.target.value as 'waveform' | 'margin')}
                >
                  <option value="waveform">Waveform statistic</option>
                  <option value="margin">Worst rating utilisation</option>
                </select>
              </label>
              <label className="block text-xs text-muted-foreground">
                Direction
                <select
                  aria-label="Optimisation direction"
                  className="mt-1 h-8 w-full rounded-md border border-border bg-background px-1 text-xs text-foreground"
                  value={direction}
                  onChange={(event) => setDirection(event.target.value as 'minimize' | 'maximize')}
                >
                  <option value="minimize">Minimise</option>
                  <option value="maximize">Maximise</option>
                </select>
              </label>
            </div>

            {metricKind === 'waveform' ? (
              <>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <label className="block text-xs text-muted-foreground">
                    Waveform
                    <Input
                      className="mt-1 h-8 bg-background text-xs"
                      value={waveform}
                      onChange={(event) => setWaveform(event.target.value)}
                      placeholder="V(OUT)"
                      spellCheck={false}
                    />
                  </label>
                  <label className="block text-xs text-muted-foreground">
                    Statistic
                    <select
                      aria-label="Statistic"
                      className="mt-1 h-8 w-full rounded-md border border-border bg-background px-1 text-xs text-foreground"
                      value={statistic}
                      onChange={(event) => setStatistic(event.target.value as Statistic)}
                    >
                      {STATISTICS.map((entry) => (
                        <option key={entry.value} value={entry.value}>
                          {entry.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {statistic === 'ripple' && (
                  <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={settled}
                      onChange={(event) => setSettled(event.target.checked)}
                      className="h-3.5 w-3.5 accent-primary"
                    />
                    Measure the settled tail (ignore start-up transient)
                  </label>
                )}
              </>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                Scores the highest declared-limit utilisation across every rated part. Add ambient/θJA below for thermal checks.
              </p>
            )}

            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="block text-xs text-muted-foreground">
                Target (optional)
                <Input
                  className="mt-1 h-8 bg-background text-xs"
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                  placeholder="0.02"
                  inputMode="decimal"
                />
              </label>
              <label className="block text-xs text-muted-foreground">
                ± Tolerance
                <Input
                  className="mt-1 h-8 bg-background text-xs"
                  value={tolerance}
                  onChange={(event) => setTolerance(event.target.value)}
                  placeholder="0.005"
                  inputMode="decimal"
                />
              </label>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="block text-xs text-muted-foreground">
                Analysis
                <select
                  aria-label="Analysis"
                  className="mt-1 h-8 w-full rounded-md border border-border bg-background px-1 text-xs text-foreground"
                  value={analysis}
                  onChange={(event) => setAnalysis(event.target.value as AnalysisKind)}
                >
                  <option value="transient">Transient</option>
                  <option value="dc">DC operating point</option>
                  <option value="ac">AC sweep</option>
                </select>
              </label>
              {analysis === 'transient' && (
                <div className="grid grid-cols-2 gap-1">
                  <label className="block text-xs text-muted-foreground">
                    Stop (ms)
                    <Input
                      className="mt-1 h-8 bg-background text-xs"
                      value={analysisParams.stopMs}
                      onChange={(event) => setAnalysisParams({ ...analysisParams, stopMs: event.target.value })}
                      inputMode="decimal"
                    />
                  </label>
                  <label className="block text-xs text-muted-foreground">
                    Step (µs)
                    <Input
                      className="mt-1 h-8 bg-background text-xs"
                      value={analysisParams.stepUs}
                      onChange={(event) => setAnalysisParams({ ...analysisParams, stepUs: event.target.value })}
                      inputMode="decimal"
                    />
                  </label>
                </div>
              )}
              {analysis === 'ac' && (
                <div className="grid grid-cols-2 gap-1">
                  <label className="block text-xs text-muted-foreground">
                    Start (Hz)
                    <Input
                      className="mt-1 h-8 bg-background text-xs"
                      value={analysisParams.startHz}
                      onChange={(event) => setAnalysisParams({ ...analysisParams, startHz: event.target.value })}
                      inputMode="decimal"
                    />
                  </label>
                  <label className="block text-xs text-muted-foreground">
                    Stop (Hz)
                    <Input
                      className="mt-1 h-8 bg-background text-xs"
                      value={analysisParams.stopHz}
                      onChange={(event) => setAnalysisParams({ ...analysisParams, stopHz: event.target.value })}
                      inputMode="decimal"
                    />
                  </label>
                </div>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-3" aria-labelledby="knobs-heading">
            <div className="mb-2 flex items-center justify-between">
              <h3 id="knobs-heading" className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <SlidersHorizontal size={13} /> Knobs
              </h3>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={suggestKnob} title={knobHint}>
                  Suggest from sheet
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs"
                  onClick={() => setKnobs((current) => [...current, newKnob(current.length)])}
                  aria-label="Add knob"
                >
                  <Plus size={12} className="mr-1" />Add
                </Button>
              </div>
            </div>
            <p className="mb-2 text-xs text-muted-foreground">{knobHint}</p>
            <div className="space-y-2">
              {knobs.map((knob, index) => (
                <div key={knob.key} className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto] items-end gap-1.5">
                  <label className="block text-xs text-muted-foreground">
                    Part
                    <Input
                      aria-label={`Knob ${index + 1} part`}
                      className="mt-1 h-7 bg-background font-mono text-xs"
                      value={knob.reference}
                      onChange={(event) => updateKnob(knob.key, { reference: event.target.value })}
                      placeholder="C1"
                    />
                  </label>
                  <label className="block text-xs text-muted-foreground">
                    Property
                    <Input
                      aria-label={`Knob ${index + 1} property`}
                      className="mt-1 h-7 bg-background font-mono text-xs"
                      value={knob.property}
                      onChange={(event) => updateKnob(knob.key, { property: event.target.value })}
                      placeholder="value"
                    />
                  </label>
                  <label className="block text-xs text-muted-foreground">
                    From
                    <Input
                      aria-label={`Knob ${index + 1} from`}
                      className="mt-1 h-7 bg-background font-mono text-xs"
                      value={knob.from}
                      onChange={(event) => updateKnob(knob.key, { from: event.target.value })}
                      placeholder="2e-6"
                    />
                  </label>
                  <label className="block text-xs text-muted-foreground">
                    To
                    <Input
                      aria-label={`Knob ${index + 1} to`}
                      className="mt-1 h-7 bg-background font-mono text-xs"
                      value={knob.to}
                      onChange={(event) => updateKnob(knob.key, { to: event.target.value })}
                      placeholder="470e-6"
                    />
                  </label>
                  <label className="block text-xs text-muted-foreground">
                    Scale
                    <select
                      aria-label={`Knob ${index + 1} scale`}
                      className="mt-1 h-7 rounded-md border border-border bg-background px-1 text-xs text-foreground"
                      value={knob.scale}
                      onChange={(event) => updateKnob(knob.key, { scale: event.target.value as 'linear' | 'log' })}
                    >
                      <option value="log">log</option>
                      <option value="linear">lin</option>
                    </select>
                  </label>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-1.5 text-muted-foreground hover:text-destructive"
                    aria-label={`Remove knob ${index + 1}`}
                    disabled={knobs.length === 1}
                    onClick={() => setKnobs((current) => current.filter((candidate) => candidate.key !== knob.key))}
                  >
                    <Trash2 size={12} />
                  </Button>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-3" aria-labelledby="guardrails-heading">
            <h3 id="guardrails-heading" className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <CheckCircle2 size={13} /> Guardrails
            </h3>
            <div className="space-y-1.5 text-xs text-muted-foreground">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={constraints.requireErcPass ?? false}
                  onChange={(event) => setConstraints({ ...constraints, requireErcPass: event.target.checked })}
                  className="h-3.5 w-3.5 accent-primary"
                />
                Require ERC to pass on every candidate
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={constraints.requireAllRated ?? false}
                  onChange={(event) => setConstraints({ ...constraints, requireAllRated: event.target.checked })}
                  className="h-3.5 w-3.5 accent-primary"
                />
                Reject candidates with undeclared ratings
              </label>
              <div className="grid grid-cols-3 gap-2 pt-1">
                <label className="block">
                  Max utilisation (%)
                  <Input
                    className="mt-1 h-7 bg-background text-xs"
                    value={String(Math.round((constraints.maxWorstUtilization ?? 0.8) * 100))}
                    onChange={(event) => {
                      const percent = numberFrom(event.target.value)
                      setConstraints({
                        ...constraints,
                        maxWorstUtilization: percent === undefined ? undefined : percent / 100,
                      })
                    }}
                    inputMode="decimal"
                  />
                </label>
                <label className="block">
                  Ambient (°C)
                  <Input
                    className="mt-1 h-7 bg-background text-xs"
                    value={String(constraints.ambientCelsius ?? 25)}
                    onChange={(event) => setConstraints({
                      ...constraints,
                      ambientCelsius: numberFrom(event.target.value) ?? 25,
                    })}
                    inputMode="decimal"
                  />
                </label>
                <label className="block">
                  θJA override
                  <Input
                    className="mt-1 h-7 bg-background text-xs"
                    value={constraints.thetaJa === undefined ? '' : String(constraints.thetaJa)}
                    onChange={(event) => setConstraints({
                      ...constraints,
                      thetaJa: numberFrom(event.target.value),
                    })}
                    placeholder="package default"
                    inputMode="decimal"
                  />
                </label>
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-3" aria-labelledby="budget-heading">
            <h3 id="budget-heading" className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Search budget
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs text-muted-foreground">
                Samples per knob
                <Input
                  className="mt-1 h-8 bg-background text-xs"
                  value={samplesPerKnob}
                  onChange={(event) => setSamplesPerKnob(event.target.value)}
                  inputMode="numeric"
                />
              </label>
              <label className="block text-xs text-muted-foreground">
                Max candidates
                <Input
                  className="mt-1 h-8 bg-background text-xs"
                  value={maxIterations}
                  onChange={(event) => setMaxIterations(event.target.value)}
                  inputMode="numeric"
                />
              </label>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                className="h-8 bg-primary text-xs hover:bg-primary/90"
                onClick={() => { void start() }}
                disabled={running}
                aria-label="Run autopilot"
              >
                {running ? <Loader2 size={13} className="mr-1 animate-spin" /> : <Play size={13} className="mr-1" />}
                {running ? 'Running' : 'Run autopilot'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 border border-border text-xs"
                onClick={stop}
                disabled={!running}
                aria-label="Stop autopilot"
              >
                <Square size={12} className="mr-1" />Stop
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 border border-border text-xs"
                onClick={restoreBest}
                disabled={!result?.best || running}
                aria-label="Restore best iteration"
              >
                <RotateCcw size={12} className="mr-1" />Restore best
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Bounded grid + local refinement. The result is the best point this search measured, not a proof of a
              global optimum. Every candidate is simulated on the live sheet.
            </p>
          </section>

          <section className="rounded-lg border border-border bg-card p-3" aria-labelledby="cloud-heading">
            <h3 id="cloud-heading" className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {cloud.configured ? <Cloud size={13} /> : <CloudOff size={13} />} Always-on runner
            </h3>
            {cloud.configured ? (
              <div className="space-y-1.5 text-xs text-muted-foreground">
                <p>Cloud runner configured at {cloud.baseUrl}. Jobs keep running after this tab closes.</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 border border-border text-xs"
                    onClick={() => { void queueCloud() }}
                    disabled={cloudBusy}
                    aria-label="Queue this goal for an always-on run"
                  >
                    {cloudBusy ? <Loader2 size={12} className="mr-1 animate-spin" /> : <Cloud size={12} className="mr-1" />}
                    Queue job
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 border border-border text-xs"
                    onClick={() => { void refreshCloud() }}
                    disabled={!cloudJob || cloudBusy}
                    aria-label="Refresh cloud job status"
                  >
                    Refresh status
                  </Button>
                </div>
                {cloudJob && (
                  <p className="font-mono text-xs">
                    {cloudJob.id} · {cloudJob.state}{cloudJob.message ? ` · ${cloudJob.message}` : ''}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {cloud.reason} The local runner in this tab is fully functional but stops when the tab closes.
                See <span className="font-mono">docs/AGENT_CLOUD.md</span> for the deployment contract.
              </p>
            )}
          </section>
        </div>

        <div className="space-y-3">
          <section className="rounded-lg border border-border bg-card p-2" aria-labelledby="preview-heading">
            <div className="mb-1 flex items-center justify-between px-1">
              <h3 id="preview-heading" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {selected ? `Iteration #${selected.iteration} schematic` : 'Current sheet'}
              </h3>
              {selected && (
                <span className={`text-xs ${statusClass(selected)}`}>
                  {selected.phase} · {formatValue(selected.metric, selected.metricUnit)}
                </span>
              )}
            </div>
            {selected?.schematicSvg ? (
              <img
                src={`data:image/svg+xml;utf8,${encodeURIComponent(selected.schematicSvg)}`}
                alt={`Schematic after iteration ${selected.iteration}`}
                className={SVG_PREVIEW}
              />
            ) : currentSchematic ? (
              <img
                src={`data:image/svg+xml;utf8,${encodeURIComponent(currentSchematic)}`}
                alt="Current schematic"
                className={SVG_PREVIEW}
              />
            ) : (
              <p className="p-3 text-xs text-muted-foreground">Draw or place parts to see the sheet here.</p>
            )}
          </section>

          <section className="rounded-lg border border-border bg-card p-2" aria-labelledby="waveform-heading">
            <div className="mb-1 flex items-center justify-between px-1">
              <h3 id="waveform-heading" className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Activity size={13} /> Waveforms
              </h3>
              {selected?.goalMet && (
                <span className="text-xs text-success">
                  {metricKind === 'margin' || target.trim() !== '' ? 'goal met' : 'improved'}
                </span>
              )}
            </div>
            {selected?.waveformSvg ? (
              <img
                src={`data:image/svg+xml;utf8,${encodeURIComponent(selected.waveformSvg)}`}
                alt={`Waveforms from iteration ${selected.iteration}`}
                className={SVG_PREVIEW}
              />
            ) : (
              <p className="p-3 text-xs text-muted-foreground">
                Run the autopilot to see the measured waveform for each candidate.
              </p>
            )}
          </section>

          <section className="rounded-lg border border-border bg-card p-2" aria-labelledby="board-heading">
            <div className="mb-1 flex items-center justify-between gap-2 px-1">
              <h3 id="board-heading" className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <CircuitBoard size={13} /> Routed board
              </h3>
              {currentBoard && (
                <span className="truncate text-xs text-muted-foreground">
                  {currentBoard.stats.components} parts · {currentBoard.stats.traces} traces ·{' '}
                  {formatValue(currentBoard.stats.traceLengthMm, 'mm')} copper
                </span>
              )}
            </div>
            {currentBoard ? (
              <img
                src={`data:image/svg+xml;utf8,${encodeURIComponent(currentBoard.svg)}`}
                alt="Routed board top view"
                className={SVG_PREVIEW}
              />
            ) : (
              <p className="p-3 text-xs text-muted-foreground">
                No routed board yet. Run the route tool (<span className="font-mono">eda.route</span>) to place and
                route the sheet; the copper appears here, in the PCB editor, and in the 3-D preview.
              </p>
            )}
          </section>

          <section className="rounded-lg border border-border bg-card p-2" aria-labelledby="assembly-heading">
            <div className="mb-1 flex items-center justify-between gap-2 px-1">
              <h3 id="assembly-heading" className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Box size={13} /> Mechanical assembly
              </h3>
              {currentAssembly && currentAssembly.summary.partCount > 0 && (
                <span className="truncate text-xs text-muted-foreground">
                  {currentAssembly.summary.partCount} parts · {formatValue(currentAssembly.summary.totalMassKg, 'kg')} ·{' '}
                  {formatValue(currentAssembly.summary.highestStressMPa, 'MPa')} peak
                  {currentAssembly.warnings > 0 ? ` · ${currentAssembly.warnings} warning(s)` : ''}
                </span>
              )}
            </div>
            {currentAssembly ? (
              <img
                src={`data:image/svg+xml;utf8,${encodeURIComponent(currentAssembly.svg)}`}
                alt="Mechanical assembly front elevation"
                className={SVG_PREVIEW}
              />
            ) : (
              <p className="p-3 text-xs text-muted-foreground">The assembly could not be drawn.</p>
            )}
            {currentAssembly && currentAssembly.summary.partCount === 0 && (
              <p className="px-3 pb-2 text-xs text-muted-foreground">
                No parts yet. Add one with <span className="font-mono">mech.addPart</span>; supports, loads, and analysis
                are editable through the same tool surface.
              </p>
            )}
          </section>

          {selected?.assessment && (
            <section className="rounded-lg border border-border bg-card p-3" aria-labelledby="margins-heading">
              <h3 id="margins-heading" className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Ratings at iteration #{selected.iteration}
              </h3>
              <p className="text-xs text-foreground">{selected.assessment.headline}</p>
              <div className="mt-1 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                <span>{selected.assessment.status.fail} fail</span>
                <span>{selected.assessment.status.warn} warn</span>
                <span>{selected.assessment.status.ok} ok</span>
              </div>
              {selected.assessment.items.slice(0, 4).map((item) => (
                <div key={item.id} className="mt-1 flex items-center justify-between gap-2 text-xs">
                  <span className="font-mono">{item.reference}.{item.quantity}</span>
                  <span className={item.status === 'fail' ? 'text-destructive' : item.status === 'warn' ? 'text-warning' : 'text-muted-foreground'}>
                    {(item.utilization * 100).toFixed(0)} % of {formatValue(item.limit, item.unit)}
                  </span>
                </div>
              ))}
            </section>
          )}

          <section className="rounded-lg border border-border bg-card p-3" aria-labelledby="timeline-heading">
            <div className="mb-1 flex items-center justify-between">
              <h3 id="timeline-heading" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Iterations
              </h3>
              <span className="text-xs text-muted-foreground">{iterations.length} measured</span>
            </div>
            {result && (
              <p className={`mb-2 text-xs ${result.achieved ? 'text-success' : 'text-warning'}`}>{result.reason}</p>
            )}
            {iterations.length === 0 ? (
              <p className="text-xs text-muted-foreground">No run yet. Configure a goal and knobs, then start.</p>
            ) : (
              <ol className="max-h-72 space-y-1 overflow-y-auto pr-1">
                {iterations.map((iteration) => (
                  <li key={`${iteration.iteration}-${iteration.phase}`}>
                    <button
                      type="button"
                      onClick={() => setSelectedIteration(iteration.iteration)}
                      aria-pressed={selectedIteration === iteration.iteration}
                      aria-label={`Show iteration ${iteration.iteration}`}
                      className={`w-full rounded-md border px-2 py-1.5 text-left text-xs transition-colors ${
                        selectedIteration === iteration.iteration
                          ? 'border-primary/60 bg-primary/10'
                          : 'border-border bg-background hover:bg-muted/60'
                      }`}
                    >
                      <span className="flex items-center gap-1.5">
                        <span className="font-mono text-muted-foreground">#{iteration.iteration}</span>
                        <span className="text-muted-foreground">{iteration.phase}</span>
                        {iteration.best && <span className="rounded bg-success/15 px-1 text-success">best</span>}
                        {iteration.goalMet && !iteration.error && <CheckCircle2 size={11} className="text-success" />}
                        {iteration.error && <AlertTriangle size={11} className="text-destructive" />}
                        <span className={`ml-auto ${statusClass(iteration)}`}>
                          {formatValue(iteration.metric, iteration.metricUnit)}
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate text-muted-foreground">
                        {iteration.error ?? iteration.message}
                      </span>
                      {iteration.constraintFailures.length > 0 && (
                        <span className="mt-0.5 block truncate text-warning">
                          {iteration.constraintFailures.length} constraint failure(s)
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {session && (
            <p className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
              <Wrench size={11} />
              Session {session.id} · {session.iterationCount} iteration(s) · saved locally
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
