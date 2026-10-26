/**
 * Mechanical sizing workbench.
 *
 * The circuit autopilot tunes values on a schematic; this panel sizes a part in
 * the live assembly. Every candidate is written to the same project store the
 * 3-D viewport and the mechanical workspace read, so the front-elevation
 * drawing on the right is the assembly that was actually measured. The panel
 * states its search budget and that a bounded grid is not a global optimum.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Box,
  CheckCircle2,
  Gauge,
  Layers,
  Loader2,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Square,
} from 'lucide-react'
import { Button } from '../../ui/button'
import { Input } from '../../ui/input'
import { useProjectStore } from '../../../stores/useProjectStore'
import { captureMechanicalSnapshot, mechanicalToSvg } from '../../../lib/agents/mechanicalSnapshot'
import {
  runMechanicalAutopilot,
  type MechanicalAutopilotGoal,
  type MechanicalAutopilotIteration,
  type MechanicalAutopilotResult,
  type MechanicalDimension,
  type MechanicalMetric,
  type MechanicalSizingConstraints,
} from '../../../lib/agents/mechanicalAutopilot'
import { createDefaultMechanicalParts, type MechanicalPart } from '../../../lib/mechanical/partModel'
import { MATERIALS } from '../../../lib/mechanical/materials'
import {
  agentSessionStore,
  createAgentSession,
  finishAgentSession,
  recordAgentSessionEvent,
  type AgentSession,
} from '../../../lib/agents/agentSession'
import { useDemoRequest } from '../../workspace/useDemoRequest'

interface MechanicalSizingPanelProps {
  onSessionSaved?: (session: AgentSession) => void
  /** Called when a demo asks this hidden panel to become the visible tab. */
  onActivate?: () => void
}

const METRICS: ReadonlyArray<{ value: MechanicalMetric; label: string; direction: 'minimize' | 'maximize' }> = [
  { value: 'mass', label: 'Part mass', direction: 'minimize' },
  { value: 'safetyFactor', label: 'Safety factor', direction: 'maximize' },
  { value: 'deflection', label: 'Tip deflection', direction: 'minimize' },
  { value: 'stress', label: 'Peak stress', direction: 'minimize' },
  { value: 'frequency', label: 'First natural frequency', direction: 'maximize' },
  { value: 'buckling', label: 'Buckling load', direction: 'maximize' },
]

const DIMENSIONS: ReadonlyArray<{ value: MechanicalDimension; label: string }> = [
  { value: 'length', label: 'Length' },
  { value: 'width', label: 'Width' },
  { value: 'height', label: 'Height' },
]

type DimensionRow = { enabled: boolean; from: string; to: string }
type DimensionRows = Record<MechanicalDimension, DimensionRow>

const numberFrom = (value: string): number | undefined => {
  if (!value.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

const mm = (metres: number): string => String(Number((metres * 1000).toPrecision(6)))

const formatValue = (value: number | undefined, unit?: string): string => {
  if (value === undefined || !Number.isFinite(value)) return '—'
  const magnitude = Math.abs(value)
  const text = magnitude !== 0 && (magnitude >= 1e6 || magnitude < 1e-3)
    ? value.toExponential(3)
    : String(Number(value.toPrecision(5)))
  return unit ? `${text} ${unit}` : text
}

function rowsFor(part: MechanicalPart): DimensionRows {
  const row = (dimension: MechanicalDimension): DimensionRow => ({
    enabled: dimension !== 'length',
    from: mm(part.dimensions[dimension] * 0.5),
    to: mm(part.dimensions[dimension] * 1.5),
  })
  return { length: row('length'), width: row('width'), height: row('height') }
}

const describeValues = (values: Record<string, number | string>): string =>
  DIMENSIONS.filter((entry) => typeof values[entry.value] === 'number')
    .map((entry) => `${entry.label.toLowerCase()} ${formatValue((values[entry.value] as number) * 1000, 'mm')}`)
    .concat(`material ${String(values.material)}`)
    .join(' · ')

const statusClass = (iteration: MechanicalAutopilotIteration): string => {
  if (iteration.error) return 'text-destructive'
  if (iteration.goalMet) return 'text-success'
  return 'text-muted-foreground'
}

const SVG_PREVIEW = 'block w-full h-auto rounded-md border border-border bg-card'

const DEMO_SEARCH = { samplesPerKnob: 4, maxIterations: 30 }

const DEMO_GOAL: MechanicalAutopilotGoal = {
  part: 'beam-1',
  metric: 'mass',
  direction: 'minimize',
  knobs: [
    { dimension: 'width', from: 0.05, to: 0.15, scale: 'linear' },
    { dimension: 'height', from: 0.05, to: 0.15, scale: 'linear' },
  ],
  materials: ['aluminum'],
  constraints: { minSafetyFactor: 2, maxDeflectionMm: 10 },
}

export default function MechanicalSizingPanel({ onSessionSaved, onActivate }: MechanicalSizingPanelProps) {
  const parts = useProjectStore((state) => state.mechanicalParts)
  const setParts = useProjectStore((state) => state.setMechanicalParts)

  const [partId, setPartId] = useState('beam-1')
  const [metric, setMetric] = useState<MechanicalMetric>('mass')
  const [direction, setDirection] = useState<'minimize' | 'maximize'>('minimize')
  const [target, setTarget] = useState('')
  const [tolerance, setTolerance] = useState('')
  const [dims, setDims] = useState<DimensionRows>(() => {
    const beam = useProjectStore.getState().mechanicalParts.find((part) => part.id === 'beam-1')
    return beam ? rowsFor(beam) : rowsFor(createDefaultMechanicalParts()[0])
  })
  const [materials, setMaterials] = useState<string[]>(() => {
    const beam = useProjectStore.getState().mechanicalParts.find((part) => part.id === 'beam-1')
    return [beam?.materialKey ?? 'aluminum']
  })
  const [minSafetyFactor, setMinSafetyFactor] = useState('2')
  const [maxDeflectionMm, setMaxDeflectionMm] = useState('10')
  const [maxStressMPa, setMaxStressMPa] = useState('')
  const [minFrequencyHz, setMinFrequencyHz] = useState('')
  const [minBucklingLoadN, setMinBucklingLoadN] = useState('')
  const [maxMassKg, setMaxMassKg] = useState('')
  const [samplesPerKnob, setSamplesPerKnob] = useState('5')
  const [maxIterations, setMaxIterations] = useState('60')

  const [running, setRunning] = useState(false)
  const [iterations, setIterations] = useState<MechanicalAutopilotIteration[]>([])
  const [selectedIteration, setSelectedIteration] = useState<number | null>(null)
  const [result, setResult] = useState<MechanicalAutopilotResult | null>(null)
  const [session, setSession] = useState<AgentSession | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
    }
  }, [])

  // Keep a valid target when the assembly is replaced from another workspace.
  useEffect(() => {
    if (parts.length === 0) return
    if (parts.some((part) => part.id === partId)) return
    const next = parts[0]
    setPartId(next.id)
    setDims(rowsFor(next))
    setMaterials([next.materialKey])
  }, [parts, partId])

  const selectedPart = parts.find((part) => part.id === partId)

  const currentAssembly = useMemo(() => {
    try {
      const snapshot = captureMechanicalSnapshot(parts)
      return {
        svg: mechanicalToSvg(parts, { width: 720 }),
        summary: snapshot.summary,
        warnings: snapshot.warnings.length,
      }
    } catch {
      return undefined
    }
  }, [parts])

  const selected = useMemo(
    () => (selectedIteration === null ? undefined : iterations.find((item) => item.iteration === selectedIteration)),
    [iterations, selectedIteration],
  )

  const choosePart = (nextId: string): void => {
    const next = parts.find((part) => part.id === nextId)
    setPartId(nextId)
    if (!next) return
    setDims(rowsFor(next))
    setMaterials([next.materialKey])
  }

  const updateDimension = (dimension: MechanicalDimension, patch: Partial<DimensionRow>): void => {
    setDims((current) => ({ ...current, [dimension]: { ...current[dimension], ...patch } }))
  }

  const toggleMaterial = (key: string): void => {
    setMaterials((current) =>
      current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key],
    )
  }

  const chooseMetric = (next: MechanicalMetric): void => {
    setMetric(next)
    const entry = METRICS.find((candidate) => candidate.value === next)
    if (entry) setDirection(entry.direction)
  }

  const buildGoal = (): MechanicalAutopilotGoal => {
    if (!selectedPart) throw new Error('Add or select a mechanical part before sizing.')
    const knobs = DIMENSIONS.filter((entry) => dims[entry.value].enabled).map((entry) => {
      const from = numberFrom(dims[entry.value].from)
      const to = numberFrom(dims[entry.value].to)
      if (from === undefined || to === undefined) {
        throw new Error(`${entry.label} needs numeric from/to bounds in millimetres.`)
      }
      return { dimension: entry.value, from: from / 1000, to: to / 1000, scale: 'linear' as const }
    })
    if (knobs.length === 0) throw new Error('Enable at least one dimension to vary.')
    if (materials.length === 0) throw new Error('Choose at least one material to consider.')

    const targetValue = numberFrom(target)
    const targetTolerance = numberFrom(tolerance)
    if ((targetValue === undefined) !== (targetTolerance === undefined)) {
      throw new Error('A target needs both a value and a positive tolerance, or leave both blank.')
    }
    if (targetValue !== undefined && (targetTolerance === undefined || targetTolerance <= 0)) {
      throw new Error('A target needs a positive tolerance.')
    }

    const constraints: MechanicalSizingConstraints = {}
    if (numberFrom(minSafetyFactor) !== undefined) constraints.minSafetyFactor = numberFrom(minSafetyFactor)
    if (numberFrom(maxDeflectionMm) !== undefined) constraints.maxDeflectionMm = numberFrom(maxDeflectionMm)
    if (numberFrom(maxStressMPa) !== undefined) constraints.maxStressMPa = numberFrom(maxStressMPa)
    if (numberFrom(minFrequencyHz) !== undefined) constraints.minFrequencyHz = numberFrom(minFrequencyHz)
    if (numberFrom(minBucklingLoadN) !== undefined) constraints.minBucklingLoadN = numberFrom(minBucklingLoadN)
    if (numberFrom(maxMassKg) !== undefined) constraints.maxMassKg = numberFrom(maxMassKg)

    const goal: MechanicalAutopilotGoal = {
      part: selectedPart.id,
      metric,
      direction,
      knobs,
      materials,
      constraints,
      description: `${direction === 'minimize' ? 'Minimise' : 'Maximise'} ${METRICS.find((entry) => entry.value === metric)?.label.toLowerCase() ?? metric} on ${selectedPart.name}`,
    }
    if (targetValue !== undefined && targetTolerance !== undefined) {
      goal.target = { value: targetValue, tolerance: targetTolerance }
    }
    return goal
  }

  const runWithGoal = async (
    goal: MechanicalAutopilotGoal,
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

    const budget = { maxCalls: Math.max(20, search.maxIterations * 2), maxWallMs: 120_000 }
    let liveSession = createAgentSession({
      title: goal.description ?? 'Mechanical sizing run',
      goal: goal.description,
      budget,
    })
    liveSession = recordAgentSessionEvent(liveSession, {
      kind: 'goal',
      message:
        `${goal.part} · ${goal.metric ?? 'mass'} · ${goal.knobs?.length ?? 0} dimension knob(s) · ` +
        `${goal.materials?.length ?? 1} material(s)`,
    }, Date.now())

    try {
      const outcome = await runMechanicalAutopilot({
        runtime: {
          read: () => useProjectStore.getState().mechanicalParts,
          write: (next) => useProjectStore.getState().setMechanicalParts(next),
        },
        goal,
        samplesPerKnob: Math.max(2, search.samplesPerKnob),
        maxIterations: Math.max(2, search.maxIterations),
        signal: controller.signal,
        onEvent: (iteration) => {
          if (!mountedRef.current) return
          setIterations((current) => [...current, iteration])
          setSelectedIteration(iteration.iteration)
          liveSession = recordAgentSessionEvent(liveSession, {
            kind: 'iteration',
            message: iteration.message,
            iteration: iteration.iteration,
            phase: iteration.phase,
            ...(iteration.metric !== undefined ? { metric: iteration.metric } : {}),
            metricLabel: iteration.metricLabel,
            ...(iteration.metricUnit !== undefined ? { metricUnit: iteration.metricUnit } : {}),
            ...(iteration.score !== undefined ? { score: iteration.score } : {}),
            goalMet: iteration.goalMet,
          }, Date.now())
        },
      })
      setResult(outcome)
      liveSession = finishAgentSession(liveSession, {
        status: outcome.achieved ? 'completed' : 'stopped',
        summary: outcome.reason,
      })
      setSession(liveSession)
      const saved = agentSessionStore.save(liveSession)
      if (!saved.ok) setNotice(saved.error ?? 'The session could not be persisted.')
      onSessionSaved?.(liveSession)
    } catch (runError) {
      const message = runError instanceof Error ? runError.message : String(runError)
      if (mountedRef.current) setError(message)
      liveSession = finishAgentSession(liveSession, { status: 'failed', summary: message })
      if (mountedRef.current) setSession(liveSession)
      const saved = agentSessionStore.save(liveSession)
      if (!saved.ok && mountedRef.current) setNotice(saved.error ?? 'The session could not be persisted.')
      onSessionSaved?.(liveSession)
    } finally {
      if (mountedRef.current) {
        setRunning(false)
        abortRef.current = null
      }
    }
  }

  const start = (): void => {
    let goal: MechanicalAutopilotGoal
    try {
      goal = buildGoal()
    } catch (buildError) {
      setError(buildError instanceof Error ? buildError.message : String(buildError))
      return
    }
    void runWithGoal(goal, {
      samplesPerKnob: Math.max(2, Math.round(numberFrom(samplesPerKnob) ?? 5)),
      maxIterations: Math.max(2, Math.round(numberFrom(maxIterations) ?? 60)),
    })
  }

  const runDemo = (): void => {
    onActivate?.()
    setParts(createDefaultMechanicalParts())
    setPartId('beam-1')
    const beam = createDefaultMechanicalParts().find((part) => part.id === 'beam-1')
    if (beam) setDims(rowsFor(beam))
    setMaterials(['aluminum'])
    setMetric('mass')
    setDirection('minimize')
    setMinSafetyFactor('2')
    setMaxDeflectionMm('10')
    setMaxStressMPa('')
    setMinFrequencyHz('')
    setMinBucklingLoadN('')
    setMaxMassKg('')
    setTarget('')
    setTolerance('')
    setSamplesPerKnob(String(DEMO_SEARCH.samplesPerKnob))
    setMaxIterations(String(DEMO_SEARCH.maxIterations))
    // Defer past the StrictMode effect replay so the unmount abort does not
    // cancel a run that never painted.
    window.setTimeout(() => {
      if (!mountedRef.current) return
      void runWithGoal(DEMO_GOAL, DEMO_SEARCH)
    }, 0)
  }

  useDemoRequest('agents-mechanical-autopilot', runDemo)

  const stop = (): void => {
    abortRef.current?.abort()
    setNotice('Stopping after the current candidate…')
  }

  const restoreBest = (): void => {
    if (!result?.best) return
    const winning = result.best.part
    setParts((current) => current.map((part) => (part.id === winning.id ? winning : part)))
    setNotice(`Restored the best section (#${result.best.iteration}): ${describeValues(result.best.values)}.`)
  }

  const loadDefaults = (): void => {
    const next = createDefaultMechanicalParts()
    setParts(next)
    setPartId(next[0].id)
    setDims(rowsFor(next[0]))
    setMaterials([next[0].materialKey])
    setNotice('Loaded the default beam and support plate.')
  }

  const sizeHint = 'Dimensions are millimetres in the form; the solver receives metres.'
  const previewSvg = selected?.assemblySvg ?? currentAssembly?.svg

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
          <section className="rounded-lg border border-border bg-card p-3" aria-labelledby="mech-target-heading">
            <div className="mb-2 flex items-center justify-between">
              <h3 id="mech-target-heading" className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Box size={13} /> Target part
              </h3>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={loadDefaults}>
                Load default assembly
              </Button>
            </div>
            {parts.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                The assembly is empty. Load the default parts or add one with <span className="font-mono">mech.addPart</span>.
              </p>
            ) : (
              <>
                <label className="block text-xs text-muted-foreground" htmlFor="mech-sizing-part">
                  Which part should the search size?
                </label>
                <select
                  id="mech-sizing-part"
                  aria-label="Sizing part"
                  className="mt-1 h-8 w-full rounded-md border border-border bg-background px-1 text-xs text-foreground"
                  value={partId}
                  onChange={(event) => choosePart(event.target.value)}
                >
                  {parts.map((part) => (
                    <option key={part.id} value={part.id}>
                      {part.name} ({part.id})
                    </option>
                  ))}
                </select>
                {selectedPart && (
                  <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>Section</span>
                    <span className="font-mono text-foreground">
                      {mm(selectedPart.dimensions.length)} × {mm(selectedPart.dimensions.width)} ×{' '}
                      {mm(selectedPart.dimensions.height)} mm
                    </span>
                    <span>Material</span>
                    <span className="font-mono text-foreground">{selectedPart.material.name}</span>
                    <span>Part mass</span>
                    <span className="font-mono text-foreground">{formatValue(selectedPart.properties.mass, 'kg')}</span>
                    <span>Assembly</span>
                    <span className="font-mono text-foreground">
                      {parts.length} parts · {formatValue(currentAssembly?.summary.totalMassKg, 'kg')}
                    </span>
                  </div>
                )}
              </>
            )}
          </section>

          <section className="rounded-lg border border-border bg-card p-3" aria-labelledby="mech-objective-heading">
            <h3 id="mech-objective-heading" className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Gauge size={13} /> Objective and limits
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs text-muted-foreground">
                Metric
                <select
                  aria-label="Sizing metric"
                  className="mt-1 h-8 w-full rounded-md border border-border bg-background px-1 text-xs text-foreground"
                  value={metric}
                  onChange={(event) => chooseMetric(event.target.value as MechanicalMetric)}
                >
                  {METRICS.map((entry) => (
                    <option key={entry.value} value={entry.value}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs text-muted-foreground">
                Direction
                <select
                  aria-label="Sizing direction"
                  className="mt-1 h-8 w-full rounded-md border border-border bg-background px-1 text-xs text-foreground"
                  value={direction}
                  onChange={(event) => setDirection(event.target.value as 'minimize' | 'maximize')}
                >
                  <option value="minimize">Minimise</option>
                  <option value="maximize">Maximise</option>
                </select>
              </label>
              <label className="block text-xs text-muted-foreground">
                Target value (optional)
                <Input
                  aria-label="Sizing target value"
                  className="mt-1 h-8 bg-background text-xs"
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                  placeholder="e.g. 6"
                  inputMode="decimal"
                />
              </label>
              <label className="block text-xs text-muted-foreground">
                Sizing tolerance
                <Input
                  aria-label="Sizing target tolerance"
                  className="mt-1 h-8 bg-background text-xs"
                  value={tolerance}
                  onChange={(event) => setTolerance(event.target.value)}
                  placeholder="e.g. 0.4"
                  inputMode="decimal"
                />
              </label>
            </div>

            <div className="mt-2 grid grid-cols-3 gap-2">
              <label className="block text-xs text-muted-foreground">
                Min safety factor
                <Input
                  aria-label="Minimum safety factor"
                  className="mt-1 h-7 bg-background text-xs"
                  value={minSafetyFactor}
                  onChange={(event) => setMinSafetyFactor(event.target.value)}
                  inputMode="decimal"
                />
              </label>
              <label className="block text-xs text-muted-foreground">
                Max deflection (mm)
                <Input
                  aria-label="Maximum deflection"
                  className="mt-1 h-7 bg-background text-xs"
                  value={maxDeflectionMm}
                  onChange={(event) => setMaxDeflectionMm(event.target.value)}
                  inputMode="decimal"
                />
              </label>
              <label className="block text-xs text-muted-foreground">
                Max stress (MPa)
                <Input
                  aria-label="Maximum stress"
                  className="mt-1 h-7 bg-background text-xs"
                  value={maxStressMPa}
                  onChange={(event) => setMaxStressMPa(event.target.value)}
                  placeholder="any"
                  inputMode="decimal"
                />
              </label>
              <label className="block text-xs text-muted-foreground">
                Min first mode (Hz)
                <Input
                  aria-label="Minimum first mode"
                  className="mt-1 h-7 bg-background text-xs"
                  value={minFrequencyHz}
                  onChange={(event) => setMinFrequencyHz(event.target.value)}
                  placeholder="any"
                  inputMode="decimal"
                />
              </label>
              <label className="block text-xs text-muted-foreground">
                Min buckling (N)
                <Input
                  aria-label="Minimum buckling load"
                  className="mt-1 h-7 bg-background text-xs"
                  value={minBucklingLoadN}
                  onChange={(event) => setMinBucklingLoadN(event.target.value)}
                  placeholder="any"
                  inputMode="decimal"
                />
              </label>
              <label className="block text-xs text-muted-foreground">
                Max part mass (kg)
                <Input
                  aria-label="Maximum part mass"
                  className="mt-1 h-7 bg-background text-xs"
                  value={maxMassKg}
                  onChange={(event) => setMaxMassKg(event.target.value)}
                  placeholder="any"
                  inputMode="decimal"
                />
              </label>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Constraints are checked against the closed-form beam analysis for every candidate. A candidate that
              breaks a limit is measured and rejected, never silently accepted.
            </p>
          </section>

          <section className="rounded-lg border border-border bg-card p-3" aria-labelledby="mech-variables-heading">
            <h3 id="mech-variables-heading" className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <SlidersHorizontal size={13} /> Variables
            </h3>
            <p className="mb-2 text-xs text-muted-foreground">{sizeHint}</p>
            <div className="space-y-1.5">
              {DIMENSIONS.map((entry) => {
                const row = dims[entry.value]
                const current = selectedPart?.dimensions[entry.value]
                return (
                  <div key={entry.value} className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] items-end gap-2">
                    <label className="flex items-center gap-1.5 pb-1.5 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={row.enabled}
                        onChange={(event) => updateDimension(entry.value, { enabled: event.target.checked })}
                        aria-label={`Vary ${entry.label.toLowerCase()}`}
                        className="h-3.5 w-3.5 accent-primary"
                      />
                      {entry.label}
                      {current !== undefined && (
                        <span className="font-mono text-[10px]">({mm(current)} mm)</span>
                      )}
                    </label>
                    <label className="block text-xs text-muted-foreground">
                      From (mm)
                      <Input
                        aria-label={`${entry.label} from`}
                        className="mt-1 h-7 bg-background font-mono text-xs"
                        value={row.from}
                        onChange={(event) => updateDimension(entry.value, { from: event.target.value })}
                        disabled={!row.enabled}
                        inputMode="decimal"
                      />
                    </label>
                    <label className="block text-xs text-muted-foreground">
                      To (mm)
                      <Input
                        aria-label={`${entry.label} to`}
                        className="mt-1 h-7 bg-background font-mono text-xs"
                        value={row.to}
                        onChange={(event) => updateDimension(entry.value, { to: event.target.value })}
                        disabled={!row.enabled}
                        inputMode="decimal"
                      />
                    </label>
                  </div>
                )
              })}
            </div>

            <div className="mt-3">
              <p className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Layers size={11} /> Materials
              </p>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                {Object.entries(MATERIALS).map(([key, material]) => (
                  <label key={key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={materials.includes(key)}
                      onChange={() => toggleMaterial(key)}
                      aria-label={`Consider ${material.name}`}
                      className="h-3.5 w-3.5 accent-primary"
                    />
                    <span className="truncate">{material.name}</span>
                  </label>
                ))}
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-3" aria-labelledby="mech-budget-heading">
            <h3 id="mech-budget-heading" className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Search budget
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs text-muted-foreground">
                Dimension samples
                <Input
                  aria-label="Dimension samples"
                  className="mt-1 h-8 bg-background text-xs"
                  value={samplesPerKnob}
                  onChange={(event) => setSamplesPerKnob(event.target.value)}
                  inputMode="numeric"
                />
              </label>
              <label className="block text-xs text-muted-foreground">
                Candidate budget
                <Input
                  aria-label="Candidate budget"
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
                onClick={start}
                disabled={running || !selectedPart}
                aria-label="Run sizing search"
              >
                {running ? <Loader2 size={13} className="mr-1 animate-spin" /> : <Play size={13} className="mr-1" />}
                {running ? 'Sizing' : 'Run sizing search'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 border border-border text-xs"
                onClick={stop}
                disabled={!running}
                aria-label="Stop sizing search"
              >
                <Square size={12} className="mr-1" />Stop
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 border border-border text-xs"
                onClick={restoreBest}
                disabled={!result?.best || running}
                aria-label="Restore best section"
              >
                <RotateCcw size={12} className="mr-1" />Restore best
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Bounded deterministic grid + local refinement. The winner is the best point this budget measured, not a
              proof of a global optimum. Every candidate is written to the live assembly and redrawn.
            </p>
          </section>
        </div>

        <div className="space-y-3">
          <section className="rounded-lg border border-border bg-card p-2" aria-labelledby="mech-drawing-heading">
            <div className="mb-1 flex items-center justify-between gap-2 px-1">
              <h3 id="mech-drawing-heading" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {selected ? `Assembly after iteration #${selected.iteration}` : 'Current assembly'}
              </h3>
              {selected && (
                <span className={`text-xs ${statusClass(selected)}`}>
                  {selected.phase} · {formatValue(selected.metric, selected.metricUnit)}
                </span>
              )}
            </div>
            {previewSvg ? (
              <img
                src={`data:image/svg+xml;utf8,${encodeURIComponent(previewSvg)}`}
                alt={selected ? `Assembly after iteration ${selected.iteration}` : 'Current mechanical assembly'}
                className={SVG_PREVIEW}
              />
            ) : (
              <p className="p-3 text-xs text-muted-foreground">The assembly could not be drawn.</p>
            )}
            {currentAssembly && currentAssembly.warnings > 0 && (
              <p className="px-3 py-1 text-xs text-warning">
                {currentAssembly.warnings} assembly warning(s); unsupported parts are reported but not silently
                approximated.
              </p>
            )}
          </section>

          {selected?.analysis && (
            <section className="rounded-lg border border-border bg-card p-3" aria-labelledby="mech-measure-heading">
              <h3 id="mech-measure-heading" className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Measured at iteration #{selected.iteration}
              </h3>
              <p className="text-xs text-foreground">
                {selected.metricLabel} = {formatValue(selected.metric, selected.metricUnit)}
                {selected.partMassKg !== undefined && ` · part ${formatValue(selected.partMassKg, 'kg')}`}
                {selected.assemblyMassKg !== undefined && ` · assembly ${formatValue(selected.assemblyMassKg, 'kg')}`}
              </p>
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>Peak stress</span>
                <span className="font-mono text-foreground">{formatValue(selected.analysis.stressMPa, 'MPa')}</span>
                <span>Tip deflection</span>
                <span className="font-mono text-foreground">{formatValue(selected.analysis.deflectionMm, 'mm')}</span>
                <span>Safety factor</span>
                <span className={selected.analysis.yields ? 'font-mono text-destructive' : 'font-mono text-foreground'}>
                  {formatValue(selected.analysis.safetyFactor ?? undefined)}
                  {selected.analysis.yields ? ' · yields' : ''}
                </span>
                <span>First mode</span>
                <span className="font-mono text-foreground">
                  {formatValue(selected.analysis.naturalFrequenciesHz[0], 'Hz')}
                </span>
                <span>Buckling load</span>
                <span className="font-mono text-foreground">{formatValue(selected.analysis.bucklingLoadN, 'N')}</span>
              </div>
              <p className="mt-2 font-mono text-xs text-muted-foreground">{describeValues(selected.values)}</p>
              {selected.constraintFailures.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-warning">
                  {selected.constraintFailures.map((failure) => (
                    <li key={failure}>{failure}</li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section className="rounded-lg border border-border bg-card p-3" aria-labelledby="mech-timeline-heading">
            <div className="mb-1 flex items-center justify-between">
              <h3 id="mech-timeline-heading" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Iterations
              </h3>
              <span className="text-xs text-muted-foreground">{iterations.length} measured</span>
            </div>
            {result && (
              <p className={`mb-2 text-xs ${result.achieved ? 'text-success' : 'text-warning'}`}>{result.reason}</p>
            )}
            {iterations.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No run yet. Pick a part, set limits, then run the sizing search.
              </p>
            ) : (
              <ol className="max-h-72 space-y-1 overflow-y-auto pr-1">
                {iterations.map((iteration) => (
                  <li key={`${iteration.iteration}-${iteration.phase}`}>
                    <button
                      type="button"
                      onClick={() => setSelectedIteration(iteration.iteration)}
                      aria-pressed={selectedIteration === iteration.iteration}
                      aria-label={`Show sizing iteration ${iteration.iteration}`}
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
                      <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">
                        {describeValues(iteration.values)}
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
            {session && (
              <p className="mt-2 text-xs text-muted-foreground">
                Session {session.id} · {session.iterationCount} iteration(s) · saved locally
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
