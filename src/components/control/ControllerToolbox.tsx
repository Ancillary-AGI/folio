/**
 * Numerical design toolbox for the control workspace.
 *
 * This is the engineer-facing surface of `src/lib/control/autoTune`: rules of
 * thumb on an identified model, relay auto-tuning, heuristic search over the real
 * closed-loop simulation, and surrogate-assisted search, plus a sampled-loop check
 * against an actuator limit.
 *
 * It is deliberately NOT the agent workbench. An agent designs without a human in
 * the loop; everything here is started, bounded and audited by the person reading
 * it. Nothing runs on its own: a route executes when its button is pressed, uses
 * the budget that was typed in, and reports the cost it optimised, the evaluations
 * it spent, why it stopped, and the limits of the method it used.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, AlertCircle, Play, Wand2, Check } from 'lucide-react'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Input } from '../ui/input'
import TraceChart, { type TraceRow, type TraceSeries } from '../charts/TraceChart'
import { chartSeriesColors } from '../../lib/theme/tokens'
import { useTheme } from '../../lib/theme/useTheme'
import { describeError } from '../../lib/utils'
import { fitFopdt, type FopdtModel } from '../../lib/ml/systemIdentification'
import type { Bounds } from '../../lib/ml/optimizers'
import {
  gainsFromFopdt,
  loopEvaluation,
  simulateDiscreteLoop,
  suggestGainBounds,
  tuneBySearch,
  tuneBySurrogate,
  autoTuneByRelay,
  INFEASIBLE_COST,
  type ControllerStructure,
  type LoopEvaluation,
  type RelayAutoTuneResult,
  type RuleBasedTuning,
  type SearchMethod,
  type SearchTuningOptions,
  type SurrogateTuningResult,
  type SampledLoopVerification,
  type TunedLoop,
  type TuningRule,
} from '../../lib/control/autoTune'
import { DEFAULT_DERIVATIVE_FILTER_SECONDS, pidTransferFunction, type PidGains } from '../../lib/control/pid'
import {
  simulateStep,
  tfPoles,
  type MarginOptions,
  type TransferFunction,
} from '../../lib/control/transferFunction'

type ToolboxRoute = 'rules' | 'relay' | 'search' | 'surrogate' | 'verify'

const ROUTES: Array<{ id: ToolboxRoute; label: string; blurb: string }> = [
  { id: 'rules', label: 'Rules of thumb', blurb: 'Identify a first-order-plus-delay model from a simulated step test, then apply Ziegler–Nichols or SIMC λ-tuning.' },
  { id: 'relay', label: 'Relay auto-tune', blurb: 'Close the loop with a hysteretic relay, measure the limit cycle and read the critical gain and period from it.' },
  { id: 'search', label: 'Heuristic search', blurb: 'Differential evolution, Nelder–Mead or simulated annealing minimising the real closed-loop cost of every candidate.' },
  { id: 'surrogate', label: 'Surrogate (GP)', blurb: 'A Gaussian process proposes the next gains to simulate, so a small simulation budget goes where it pays.' },
  { id: 'verify', label: 'Sampled loop check', blurb: 'Run the discrete PID with a filtered derivative and an actuator limit — saturation and windup are not in the linear model.' },
]

interface ToolboxRun {
  route: ToolboxRoute
  gains: PidGains
  evaluation: LoopEvaluation | null
  notes: string[]
  summary: Array<{ label: string; value: string; hint?: string }>
  relay?: RelayAutoTuneResult
  tuning?: RuleBasedTuning
  model?: FopdtModel
  tuned?: TunedLoop
  surrogate?: SurrogateTuningResult
  verification?: SampledLoopVerification
}

const numberOr = (value: string, fallback: number): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/**
 * A string a `type="number"` input accepts — `formatNumber` is for reading, and
 * its `∞`/exponential forms are not always valid input values.
 */
const toInputText = (value: number): string => String(Number(value.toPrecision(6)))

function formatNumber(value: number, digits = 4): string {
  if (Number.isNaN(value)) return '—'
  if (!Number.isFinite(value)) return value > 0 ? '∞' : '−∞'
  if (value !== 0 && (Math.abs(value) >= 1e5 || Math.abs(value) < 1e-3)) return value.toExponential(2)
  return value.toFixed(digits)
}

function traceRows(trace: LoopEvaluation['trace']): TraceRow[] {
  return trace.map((sample) => ({
    time: sample.time,
    output: Number.isFinite(sample.output) ? sample.output : null,
    reference: sample.reference,
  }))
}

interface ControllerToolboxProps {
  /** Null while the plant entry is invalid; the toolbox then stays shut. */
  plant: TransferFunction | null
  plantText: string
  currentGains: PidGains
  horizon: { tEndSeconds: number; dtSeconds: number }
  marginScan: MarginOptions
  onApplyGains: (gains: PidGains) => void
}

export default function ControllerToolbox({
  plant,
  plantText,
  currentGains,
  horizon,
  marginScan,
  onApplyGains,
}: ControllerToolboxProps) {
  const [route, setRoute] = useState<ToolboxRoute>('relay')
  const [structure, setStructure] = useState<ControllerStructure>('PID')
  const [rule, setRule] = useState<TuningRule>('ziegler-nichols')
  const [lambdaText, setLambdaText] = useState('0.1')
  const [method, setMethod] = useState<SearchMethod>('differential-evolution')
  const [seedText, setSeedText] = useState('7')
  const [budgetText, setBudgetText] = useState('150')
  const [kpLowText, setKpLowText] = useState('0.05')
  const [kpHighText, setKpHighText] = useState('50')
  const [kiLowText, setKiLowText] = useState('0')
  const [kiHighText, setKiHighText] = useState('50')
  const [kdLowText, setKdLowText] = useState('0')
  const [kdHighText, setKdHighText] = useState('5')
  const [overshootText, setOvershootText] = useState('10')
  const [phaseMarginText, setPhaseMarginText] = useState('30')
  const [gainMarginText, setGainMarginText] = useState('6')
  const [relayAmplitudeText, setRelayAmplitudeText] = useState('1')
  const [relayHysteresisText, setRelayHysteresisText] = useState('0.02')
  const [relaySecondsText, setRelaySecondsText] = useState('60')
  const [actuatorLowText, setActuatorLowText] = useState('-1')
  const [actuatorHighText, setActuatorHighText] = useState('1')
  const [run, setRun] = useState<ToolboxRun | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const timer = useRef<number | null>(null)

  const { theme } = useTheme()
  const colors = useMemo(() => chartSeriesColors(theme), [theme])

  const bounds = useMemo<Bounds[]>(() => {
    const kp = { low: numberOr(kpLowText, 0), high: numberOr(kpHighText, 1) }
    const ki = { low: numberOr(kiLowText, 0), high: numberOr(kiHighText, 1) }
    const kd = { low: numberOr(kdLowText, 0), high: numberOr(kdHighText, 1) }
    return structure === 'P' ? [kp] : structure === 'PI' ? [kp, ki] : [kp, ki, kd]
  }, [structure, kpLowText, kpHighText, kiLowText, kiHighText, kdLowText, kdHighText])

  const targets = useMemo(() => ({
    maxOvershootPct: numberOr(overshootText, 10),
    minPhaseMarginDeg: numberOr(phaseMarginText, 30),
    minGainMarginDb: numberOr(gainMarginText, 6),
  }), [overshootText, phaseMarginText, gainMarginText])

  const freeGainCount = structure === 'P' ? 1 : structure === 'PI' ? 2 : 3

  // A route can outlive the panel that started it (closing the workspace while a
  // search runs); the deferred step then has nowhere to report to.
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
  }, [])

  function execute(action: () => ToolboxRun): void {
    setError(null)
    setPending(true)
    // The routes simulate tens of thousands of samples; yield one frame so the
    // button shows it is working instead of looking dead while it runs.
    timer.current = window.setTimeout(() => {
      try {
        setRun(action())
      } catch (failure) {
        setRun(null)
        setError(describeError(failure))
      } finally {
        setPending(false)
      }
    }, 0)
  }

  /**
   * The loop every route judges: the plant typed above, the panel's horizon and
   * Bode scan, and the panel's derivative filter — so a tuned gain is scored
   * under the same controller form the workspace renders.
   */
  function spec(): { plant: TransferFunction; tEndSeconds: number; dtSeconds: number; derivativeFilterSeconds: number; marginScan: MarginOptions } {
    if (!plant) throw new Error('The plant coefficients above are not a usable transfer function.')
    return {
      plant,
      tEndSeconds: horizon.tEndSeconds,
      dtSeconds: horizon.dtSeconds,
      derivativeFilterSeconds: currentGains.derivativeFilterSeconds ?? DEFAULT_DERIVATIVE_FILTER_SECONDS,
      marginScan,
    }
  }

  function runRules(): ToolboxRun {
    if (!plant) throw new Error('Enter the plant coefficients before identifying a model.')
    const poles = tfPoles(plant)
    const slowest = poles.length > 0 ? Math.max(...poles.map((pole) => pole.re)) : Number.NaN
    if (poles.length === 0) throw new Error('The plant is a static gain: there is no dynamics to tune against.')
    if (!(slowest < -1e-12)) {
      throw new Error(
        `Rules of thumb need a stable, self-regulating plant. This one has a pole at ${formatNumber(slowest, 3)} s⁻¹, so its step response never plateaus and no gain/time-constant pair can be read off it. Use relay auto-tune or heuristic search instead.`,
      )
    }
    const tEnd = Math.min(5000, Math.max(5, 20 / -slowest))
    const samples = simulateStep(plant, { tEndSeconds: tEnd, dtSeconds: tEnd / 6000 })
    // The step test is simulated from rest, so the baseline is known exactly
    // rather than averaged from a leading window that has already moved.
    const model = fitFopdt(
      samples.map((sample) => sample.timeSeconds),
      samples.map((sample) => sample.output),
      { stepSize: 1, fromValue: 0 },
    )
    const tuning = gainsFromFopdt(model, {
      rule,
      structure,
      lambdaSeconds: numberOr(lambdaText, model.deadTime),
    })
    const evaluation = loopEvaluation(tuning.gains, spec(), targets)
    return {
      route: 'rules',
      gains: tuning.gains,
      evaluation,
      tuning,
      model,
      notes: [...model.validityNotes, ...tuning.notes, ...evaluation.notes],
      summary: [
        { label: 'Identified K', value: formatNumber(model.gain, 4), hint: 'output units per input unit, from the 20τ step test' },
        { label: 'Identified τ', value: `${formatNumber(model.timeConstant, 4)} s` },
        { label: 'Apparent dead time L', value: `${formatNumber(model.deadTime, 4)} s`, hint: rule === 'ziegler-nichols' ? 'Ziegler–Nichols divides by L — a clamped zero is fatal' : 'SIMC uses λ + L as the response time' },
        { label: 'Rule', value: rule === 'simc' ? 'SIMC λ-tuning' : 'Ziegler–Nichols open-loop' },
      ],
    }
  }

  function runRelay(): ToolboxRun {
    if (!plant) throw new Error('Enter the plant coefficients before running a relay test.')
    const amplitude = numberOr(relayAmplitudeText, 1)
    const hysteresis = numberOr(relayHysteresisText, 0)
    const seconds = numberOr(relaySecondsText, 60)
    const dt = Math.min(horizon.dtSeconds, seconds / 2000)
    const tuned = autoTuneByRelay(plant, {
      relayAmplitude: amplitude,
      hysteresis,
      dtSeconds: dt,
      tEndSeconds: seconds,
      structure,
    })
    const evaluation = loopEvaluation(tuned.tuning.gains, spec(), targets)
    return {
      route: 'relay',
      gains: tuned.tuning.gains,
      evaluation,
      relay: tuned.relay,
      tuning: tuned.tuning,
      notes: [...tuned.tuning.notes, ...evaluation.notes],
      summary: [
        { label: 'Critical gain Ku', value: formatNumber(tuned.relay.ultimateGain, 4), hint: '4d/(π·√(a² − h²)) from the measured cycle' },
        { label: 'Ultimate period Tu', value: `${formatNumber(tuned.relay.periodSeconds, 4)} s`, hint: `${formatNumber(tuned.relay.switches, 0)} relay switches over ${formatNumber(seconds, 0)} s` },
        { label: 'Cycle amplitude a', value: formatNumber(tuned.relay.amplitude, 5), hint: `spread ${(100 * tuned.relay.amplitudeSpreadFraction).toFixed(2)} % in amplitude, ${(100 * tuned.relay.periodSpreadFraction).toFixed(2)} % in period` },
        { label: 'Oscillation frequency', value: `${formatNumber(tuned.relay.ultimateFrequency, 4)} rad/s`, hint: hysteresis > 0 ? 'the plant phase there is −180° plus the relay lag, so Ku is the critical gain at that shifted crossing' : 'where the plant phase reaches −180°' },
      ],
    }
  }

  function runSearch(): ToolboxRun {
    const options: SearchTuningOptions = {
      structure,
      bounds,
      maxEvaluations: Math.max(1, Math.round(numberOr(budgetText, 150))),
      method,
      seed: Math.round(numberOr(seedText, 7)),
      targets,
    }
    const tuned = tuneBySearch(spec(), options)
    return {
      route: 'search',
      gains: tuned.gains,
      evaluation: tuned.evaluation,
      tuned,
      notes: [...tuned.notes, ...tuned.evaluation.notes],
      summary: [
        { label: 'Method', value: tuned.method },
        { label: 'Simulations', value: `${tuned.evaluations} of ${Math.round(numberOr(budgetText, 150))}`, hint: 'each candidate costs one closed-loop run of the plant model' },
        { label: 'Termination', value: tuned.termination, hint: tuned.termination === 'budget' ? 'the cap ran out: these are the best gains found, not the optimum' : 'the search stopped on its own convergence test' },
        { label: 'Cost', value: formatNumber(tuned.evaluation.cost, 5), hint: 'weighted error, overshoot, settling, stability and margin terms' },
      ],
    }
  }

  function runSurrogate(): ToolboxRun {
    const tuned = tuneBySurrogate(spec(), {
      structure,
      bounds,
      maxSimulations: Math.max(8, Math.round(numberOr(budgetText, 24))),
      seed: Math.round(numberOr(seedText, 7)),
      targets,
    })
    return {
      route: 'surrogate',
      gains: tuned.gains,
      evaluation: tuned.evaluation,
      surrogate: tuned,
      notes: [...tuned.notes, ...tuned.evaluation.notes],
      summary: [
        { label: 'Simulations', value: `${tuned.simulations} of ${Math.max(8, Math.round(numberOr(budgetText, 24)))}`, hint: `${tuned.roundsUsed} chosen by the Gaussian process; the winner is re-simulated once more for the numbers below` },
        { label: 'Termination', value: tuned.termination },
        { label: 'Best cost', value: formatNumber(tuned.evaluation.cost, 5) },
        { label: 'Designs probed', value: `${tuned.samples.length}`, hint: 'every point listed in the audit trail was actually simulated' },
      ],
    }
  }

  function runVerify(): ToolboxRun {
    if (!plant) throw new Error('Enter the plant coefficients before checking the sampled loop.')
    const verification = simulateDiscreteLoop(
      plant,
      currentGains,
      {
        dtSeconds: horizon.dtSeconds,
        tEndSeconds: horizon.tEndSeconds,
        setpoint: 1,
        limits: { minOutput: numberOr(actuatorLowText, -1), maxOutput: numberOr(actuatorHighText, 1) },
      },
    )
    return {
      route: 'verify',
      gains: currentGains,
      evaluation: null,
      verification,
      notes: verification.notes,
      summary: [
        { label: 'Saturated samples', value: `${verification.saturatedSamples} of ${verification.samples.length}`, hint: 'non-zero means the linear tuning was not the whole story' },
        { label: 'Overshoot', value: `${formatNumber(verification.metrics.overshootPct, 2)} %` },
        { label: 'Settling', value: `${formatNumber(verification.metrics.settlingTimeSeconds, 3)} s` },
        { label: 'Final error', value: formatNumber(Math.abs(verification.samples[verification.samples.length - 1]?.error ?? Number.NaN), 4), hint: 'a nonzero value with ki = 0 is the missing integrator, not a solver error' },
      ],
    }
  }

  function start(): void {
    if (route === 'rules') execute(runRules)
    else if (route === 'relay') execute(runRelay)
    else if (route === 'search') execute(runSearch)
    else if (route === 'surrogate') execute(runSurrogate)
    else execute(runVerify)
  }

  function seedBoundsFromRule(): void {
    if (!plant) {
      setError('Enter the plant coefficients before suggesting a search box.')
      return
    }
    try {
      const poles = tfPoles(plant)
      const slowest = poles.length > 0 ? Math.max(...poles.map((pole) => pole.re)) : Number.NaN
      if (!(slowest < -1e-12)) throw new Error('A self-regulating, stable plant is needed to identify the model the box is built from.')
      const tEnd = Math.min(5000, Math.max(5, 20 / -slowest))
      const samples = simulateStep(plant, { tEndSeconds: tEnd, dtSeconds: tEnd / 6000 })
      const model = fitFopdt(
        samples.map((sample) => sample.timeSeconds),
        samples.map((sample) => sample.output),
        { stepSize: 1, fromValue: 0 },
      )
      const suggested = suggestGainBounds(model, structure)
      setError(null)
      setKpLowText(toInputText(suggested[0].low))
      setKpHighText(toInputText(suggested[0].high))
      if (suggested[1]) {
        setKiLowText(toInputText(suggested[1].low))
        setKiHighText(toInputText(suggested[1].high))
      }
      if (suggested[2]) {
        setKdLowText(toInputText(suggested[2].low))
        setKdHighText(toInputText(suggested[2].high))
      }
    } catch (failure) {
      setError(describeError(failure))
    }
  }

  const routeInfo = ROUTES.find((entry) => entry.id === route) ?? ROUTES[0]
  const chartSeries: TraceSeries[] = [
    { key: 'output', label: 'Output', color: colors[0] },
    { key: 'reference', label: 'Reference', color: colors[2], dash: '4 3' },
  ]

  const traceData = run?.evaluation ? thinRows(traceRows(run.evaluation.trace)) : []
  const relayData = run?.relay
    ? thinRows(run.relay.samples.map((sample) => ({ time: sample.time, output: sample.output, control: sample.control })))
    : []
  const verifyData = run?.verification
    ? thinRows(run.verification.samples.map((sample) => ({
      time: sample.time,
      output: sample.output,
      reference: sample.error + sample.output,
      control: sample.control,
    })))
    : []
  const historyData = run?.tuned
    ? run.tuned.history.map((cost, index) => ({ iteration: index + 1, cost }))
    : run?.surrogate
      ? run.surrogate.history.map((cost, index) => ({ iteration: index + 1, cost }))
      : []

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Numerical design toolbox</CardTitle>
          </div>
          <span className="text-xs text-muted-foreground">
            Heuristics and machine learning, started and bounded by you — not the autonomous agent.
          </span>
        </div>
        <div className="text-xs text-muted-foreground">
          Plant under test: {plant ? <span className="font-mono text-foreground">P(s) = {plantText}</span> : <span className="text-destructive">the coefficients above are not usable</span>}
          <span className="font-mono">(descending powers of s)</span>
          {' · '}horizon {formatNumber(horizon.tEndSeconds, 3)} s at {formatNumber(horizon.dtSeconds, 4)} s
          {' · '}margin scan {formatNumber(marginScan.fMinHz, 3)}…{formatNumber(marginScan.fMaxHz, 3)} Hz
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-1">
          {ROUTES.map((entry) => (
            <Button
              key={entry.id}
              type="button"
              size="sm"
              variant={route === entry.id ? 'default' : 'outline'}
              aria-pressed={route === entry.id}
              onClick={() => { setRoute(entry.id); setRun(null); setError(null) }}
            >
              {entry.label}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{routeInfo.blurb}</p>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Controller structure</span>
            <select
              className="w-full px-2 py-1 text-xs border border-input rounded"
              value={structure}
              onChange={(event) => setStructure(event.target.value as ControllerStructure)}
              aria-label="Controller structure"
            >
              <option value="P">P — proportional only</option>
              <option value="PI">PI — proportional + integral</option>
              <option value="PID">PID — proportional + integral + filtered derivative</option>
            </select>
            <span className="text-xs text-muted-foreground">{freeGainCount} free gain{freeGainCount > 1 ? 's' : ''} tuned; the rest held at zero.</span>
          </label>

          {(route === 'rules') && (
            <>
              <label className="block space-y-1 text-sm">
                <span className="font-medium">Rule</span>
                <select
                  className="w-full px-2 py-1 text-xs border border-input rounded"
                  value={rule}
                  onChange={(event) => setRule(event.target.value as TuningRule)}
                  aria-label="Tuning rule"
                >
                  <option value="ziegler-nichols">Ziegler–Nichols open-loop</option>
                  <option value="simc">SIMC λ-tuning</option>
                </select>
              </label>
              <label className="block space-y-1 text-sm">
                <span className="font-medium">SIMC λ (s)</span>
                <Input type="number" step="0.01" min="0" value={lambdaText} onChange={(event) => setLambdaText(event.target.value)} aria-label="SIMC closed-loop time constant" />
                <span className="text-xs text-muted-foreground">Ignored by Ziegler–Nichols. λ = L is aggressive, λ ≥ 3L conservative.</span>
              </label>
            </>
          )}

          {(route === 'relay') && (
            <>
              <label className="block space-y-1 text-sm">
                <span className="font-medium">Relay amplitude d</span>
                <Input type="number" step="0.1" value={relayAmplitudeText} onChange={(event) => setRelayAmplitudeText(event.target.value)} aria-label="Relay amplitude" />
              </label>
              <label className="block space-y-1 text-sm">
                <span className="font-medium">Relay hysteresis h</span>
                <Input type="number" step="0.01" min="0" value={relayHysteresisText} onChange={(event) => setRelayHysteresisText(event.target.value)} aria-label="Relay hysteresis" />
                <span className="text-xs text-muted-foreground">h adds −arcsin(h/a) of phase; keep it below ~10 % of the cycle.</span>
              </label>
              <label className="block space-y-1 text-sm">
                <span className="font-medium">Test length (s)</span>
                <Input type="number" step="5" min="1" value={relaySecondsText} onChange={(event) => setRelaySecondsText(event.target.value)} aria-label="Relay test length" />
                <span className="text-xs text-muted-foreground">The envelope needs ~8 cycles to settle; the run reports the spread it measured.</span>
              </label>
            </>
          )}

          {(route === 'search' || route === 'surrogate') && (
            <>
              {route === 'search' && (
                <label className="block space-y-1 text-sm">
                  <span className="font-medium">Search method</span>
                  <select
                    className="w-full px-2 py-1 text-xs border border-input rounded"
                    value={method}
                    onChange={(event) => setMethod(event.target.value as SearchMethod)}
                    aria-label="Search method"
                  >
                    <option value="differential-evolution">Differential evolution (global)</option>
                    <option value="nelder-mead">Nelder–Mead (local, from the box corner)</option>
                    <option value="simulated-annealing">Simulated annealing (local, stochastic)</option>
                  </select>
                </label>
              )}
              <label className="block space-y-1 text-sm">
                <span className="font-medium">{route === 'surrogate' ? 'Simulation budget' : 'Evaluation budget'}</span>
                <Input type="number" step="10" min="1" value={budgetText} onChange={(event) => setBudgetText(event.target.value)} aria-label="Evaluation budget" />
                <span className="text-xs text-muted-foreground">Hard cap on closed-loop runs. Surrogate fitting itself is free.</span>
              </label>
              <label className="block space-y-1 text-sm">
                <span className="font-medium">Seed</span>
                <Input type="number" step="1" value={seedText} onChange={(event) => setSeedText(event.target.value)} aria-label="Random seed" />
                <span className="text-xs text-muted-foreground">Same seed, same plant, same bounds → same gains. Reproducible by construction.</span>
              </label>
            </>
          )}

          {route === 'verify' && (
            <>
              <label className="block space-y-1 text-sm">
                <span className="font-medium">Actuator minimum</span>
                <Input type="number" step="0.1" value={actuatorLowText} onChange={(event) => setActuatorLowText(event.target.value)} aria-label="Actuator minimum output" />
              </label>
              <label className="block space-y-1 text-sm">
                <span className="font-medium">Actuator maximum</span>
                <Input type="number" step="0.1" value={actuatorHighText} onChange={(event) => setActuatorHighText(event.target.value)} aria-label="Actuator maximum output" />
                <span className="text-xs text-muted-foreground">Checks the gains above ({formatNumber(currentGains.kp, 3)}, {formatNumber(currentGains.ki, 3)}, {formatNumber(currentGains.kd, 3)}) as a sampled loop.</span>
              </label>
            </>
          )}

          <div className="space-y-1 text-sm">
            <span className="font-medium">Performance targets</span>
            <div className="grid grid-cols-3 gap-2">
              <Input type="number" step="1" min="0.1" value={overshootText} onChange={(event) => setOvershootText(event.target.value)} aria-label="Maximum overshoot percent" />
              <Input type="number" step="1" min="0" value={phaseMarginText} onChange={(event) => setPhaseMarginText(event.target.value)} aria-label="Minimum phase margin degrees" />
              <Input type="number" step="0.5" min="0" value={gainMarginText} onChange={(event) => setGainMarginText(event.target.value)} aria-label="Minimum gain margin decibels" />
            </div>
            <span className="text-xs text-muted-foreground">Max overshoot %, min phase °, min gain dB. Overshoot and margin breaches cost quadratically.</span>
          </div>
        </div>

        {(route === 'search' || route === 'surrogate') && (
          <div className="grid gap-3 md:grid-cols-3">
            <GainBoundPair label="Kp" low={kpLowText} high={kpHighText} onLow={setKpLowText} onHigh={setKpHighText} />
            <GainBoundPair label="Ki" low={kiLowText} high={kiHighText} onLow={setKiLowText} onHigh={setKiHighText} disabled={structure === 'P'} />
            <GainBoundPair label="Kd" low={kdLowText} high={kdHighText} onLow={setKdLowText} onHigh={setKdHighText} disabled={structure !== 'PID'} />
            <div className="md:col-span-3">
              <Button type="button" size="sm" variant="outline" onClick={seedBoundsFromRule}>
                Use Ziegler–Nichols box
              </Button>
              <span className="ml-2 text-xs text-muted-foreground">
                ±one decade around the rule-of-thumb gains for this plant — defensible bounds beat 0…100.
              </span>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={start} disabled={pending || plant === null}>
            {pending ? <Activity className="h-4 w-4 animate-pulse" /> : <Play className="h-4 w-4" />}
            <span className="ml-2">{pending ? 'Simulating…' : `Run ${routeInfo.label.toLowerCase()}`}</span>
          </Button>
          {run && route !== 'verify' && (
            <Button type="button" variant="outline" onClick={() => onApplyGains(run.gains)}>
              <Check className="h-4 w-4" />
              <span className="ml-2">Apply to the loop above</span>
            </Button>
          )}
          {plant === null && (
            <span className="text-xs text-destructive">Fix the plant coefficients to use the toolbox.</span>
          )}
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {run && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {run.summary.map((item) => (
                <div key={item.label} className="rounded-md border border-border bg-muted/30 p-3">
                  <div className="text-xs text-muted-foreground">{item.label}</div>
                  <div className="text-lg font-semibold">{item.value}</div>
                  {item.hint && <div className="mt-1 text-[11px] leading-snug text-muted-foreground">{item.hint}</div>}
                </div>
              ))}
            </div>

            <div className="rounded-md border border-border p-3">
              <div className="mb-2 text-xs font-medium text-muted-foreground">Controller produced</div>
              <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
                <span>Kp {formatNumber(run.gains.kp, 5)}</span>
                <span>Ki {formatNumber(run.gains.ki, 5)}</span>
                <span>Kd {formatNumber(run.gains.kd, 5)}</span>
                <span>C(s) = {formatController(run.gains)}</span>
              </div>
              {run.tuning && (
                <div className="mt-2 grid grid-cols-2 gap-x-4 text-xs text-muted-foreground md:grid-cols-4">
                  {Object.entries(run.tuning.detail).map(([key, value]) => (
                    <span key={key}>{key}: {formatNumber(value, 4)}</span>
                  ))}
                </div>
              )}
            </div>

            {run.evaluation && (
              <div className="rounded-md border border-border p-3 space-y-2">
                <div className="text-xs font-medium text-muted-foreground">Cost breakdown — every term the tuner saw</div>
                <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-6">
                  <Cost label="error" value={run.evaluation.breakdown.error} />
                  <Cost label="overshoot" value={run.evaluation.breakdown.overshoot} />
                  <Cost label="settling" value={run.evaluation.breakdown.settling} />
                  <Cost label="stability" value={run.evaluation.breakdown.stability} />
                  <Cost label="margin" value={run.evaluation.breakdown.margin} />
                  <Cost label="total" value={run.evaluation.cost} strong />
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground md:grid-cols-3">
                  <span>Overshoot {formatNumber(run.evaluation.metrics.overshootPct, 2)} %</span>
                  <span>Settle {formatNumber(run.evaluation.metrics.settlingTimeSeconds, 3)} s</span>
                  <span>Rise {formatNumber(run.evaluation.metrics.riseTimeSeconds, 3)} s</span>
                  <span>Steady-state error {formatNumber(run.evaluation.steadyStateError, 5)}</span>
                  <span>
                    Phase margin {run.evaluation.margins ? `${formatNumber(run.evaluation.margins.phaseMarginDeg, 1)}°` : 'not scanned'}
                    {' / '}gain margin {run.evaluation.margins ? `${formatNumber(run.evaluation.margins.gainMarginDb, 1)} dB` : '—'}
                  </span>
                  <span>
                    Closed-loop poles:{' '}
                    {run.evaluation.spectralAbscissa < 0 ? 'all left half-plane' : 'at least one right half-plane'}
                    {' '}· abscissa {formatNumber(run.evaluation.spectralAbscissa, 4)} s⁻¹
                  </span>
                </div>
              </div>
            )}

            {traceData.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">Closed-loop step response of the tuned gains</div>
                <TraceChart
                  data={traceData}
                  series={chartSeries}
                  xKey="time"
                  xLabel="Time"
                  xFormatter={(value) => `${formatNumber(value, 4)} s`}
                  yFormatter={(value) => formatNumber(value, 3)}
                  readoutFormatter={(value) => formatNumber(value, 6)}
                  height={240}
                  ariaLabel="Tuned closed-loop step response"
                />
              </div>
            )}

            {relayData.length > 0 && run.relay && (
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">Relay test record — the limit cycle Ku was read from</div>
                <TraceChart
                  data={relayData}
                  series={[
                    { key: 'output', label: 'Plant output', color: colors[0] },
                    { key: 'control', label: 'Relay output', color: colors[3], dash: '4 3', axis: 'right' },
                  ]}
                  xKey="time"
                  xLabel="Time"
                  xFormatter={(value) => `${formatNumber(value, 3)} s`}
                  yFormatter={(value) => formatNumber(value, 3)}
                  readoutFormatter={(value) => formatNumber(value, 6)}
                  height={240}
                  ariaLabel="Relay limit-cycle record"
                />
              </div>
            )}

            {verifyData.length > 0 && run.verification && (
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">Sampled loop with the actuator limit</div>
                <TraceChart
                  data={verifyData}
                  series={[
                    { key: 'output', label: 'Output', color: colors[0] },
                    { key: 'reference', label: 'Reference', color: colors[2], dash: '4 3' },
                    { key: 'control', label: 'Actuator', color: colors[3], axis: 'right' },
                  ]}
                  xKey="time"
                  xLabel="Time"
                  xFormatter={(value) => `${formatNumber(value, 4)} s`}
                  yFormatter={(value) => formatNumber(value, 3)}
                  readoutFormatter={(value) => formatNumber(value, 6)}
                  height={240}
                  ariaLabel="Sampled loop with actuator saturation"
                />
              </div>
            )}

            {historyData.length > 1 && (
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">Best cost found so far, per iteration</div>
                <TraceChart
                  data={historyData}
                  series={[{ key: 'cost', label: 'Cost', color: colors[1] }]}
                  xKey="iteration"
                  xLabel="Iteration"
                  xFormatter={(value) => `${Math.round(value)}`}
                  yFormatter={(value) => formatNumber(value, 4)}
                  readoutFormatter={(value) => formatNumber(value, 8)}
                  height={200}
                  ariaLabel="Convergence history"
                />
              </div>
            )}

            {run.surrogate && run.surrogate.samples.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">
                  Audit trail: all {run.surrogate.samples.length} simulated designs
                </summary>
                <ul className="mt-2 max-h-40 space-y-1 overflow-auto font-mono">
                  {run.surrogate.samples.map((sample, index) => (
                    <li key={`design-${index}`}>
                      #{index + 1} kp {formatNumber(sample.parameters[0], 5)} ki {formatNumber(sample.parameters[1] ?? 0, 5)} kd {formatNumber(sample.parameters[2] ?? 0, 5)} → cost {formatNumber(sample.cost, 6)}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {run.notes.length > 0 && (
              <ul className="space-y-1 text-xs text-muted-foreground">
                {run.notes.map((note, index) => (
                  <li key={`note-${index}`} className="flex gap-2">
                    <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-muted-foreground" />
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          What these routes do not do: the linear routes judge the continuous-time loop, so actuator
          limits only bind in the sampled check; rules of thumb assume a self-regulating
          first-order-plus-delay response and Ziegler–Nichols is documented to give roughly 40 % overshoot
          by design; the relay result is a describing-function average, not an exact −180° crossing; search
          returns the best point inside the bounds under the budget — a <em>budget</em> stop means the cap
          ran out, not that the optimum was found; a candidate whose simulation diverges costs{' '}
          {formatNumber(INFEASIBLE_COST, 0)} and is reported with undefined metrics rather than a number.
          Margins are the <em>worst</em> crossing found in the scan, and a loop with two integrators starts
          on −180°, so a negative gain margin can sit alongside a stable closed loop — the spectral
          abscissa of the tuned loop is the authoritative check.
          Nothing here creates a design by itself, and none of it is connected to the agent workbench.
        </p>
      </CardContent>
    </Card>
  )
}

function Cost({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={strong ? 'font-semibold' : ''}>
      <span className="text-muted-foreground">{label} </span>
      {value >= INFEASIBLE_COST ? 'infeasible' : formatNumber(value, 4)}
    </div>
  )
}

function GainBoundPair({
  label,
  low,
  high,
  onLow,
  onHigh,
  disabled = false,
}: {
  label: string
  low: string
  high: string
  onLow: (value: string) => void
  onHigh: (value: string) => void
  disabled?: boolean
}) {
  return (
    <label className={`block space-y-1 text-sm ${disabled ? 'opacity-40' : ''}`}>
      <span className="font-medium">{label} bounds{disabled ? ' (held at zero)' : ''}</span>
      <div className="grid grid-cols-2 gap-2">
        <Input type="number" step="0.1" value={low} disabled={disabled} onChange={(event) => onLow(event.target.value)} aria-label={`${label} lower bound`} />
        <Input type="number" step="0.1" value={high} disabled={disabled} onChange={(event) => onHigh(event.target.value)} aria-label={`${label} upper bound`} />
      </div>
    </label>
  )
}

function thinRows(rows: TraceRow[], limit = 900): TraceRow[] {
  if (rows.length <= limit) return rows
  const stride = Math.ceil(rows.length / limit)
  const out = rows.filter((_, index) => index % stride === 0)
  const last = rows[rows.length - 1]
  if (out[out.length - 1] !== last) out.push(last)
  return out
}

/** The assembled controller as a ratio of polynomials, so the form is checkable. */
function formatController(gains: PidGains): string {
  const tf = pidTransferFunction(gains)
  return `${polynomialText(tf.numerator)} / ${polynomialText(tf.denominator)}`
}

function polynomialText(coefficients: readonly number[]): string {
  const degree = coefficients.length - 1
  const terms: string[] = []
  coefficients.forEach((value, index) => {
    if (Math.abs(value) < 1e-12) return
    const power = degree - index
    const magnitude = formatNumber(Math.abs(value), 3)
    const term = power === 0 ? magnitude : power === 1 ? `${magnitude}·s` : `${magnitude}·s^${power}`
    terms.push(terms.length === 0 ? (value < 0 ? `−${term}` : term) : `${value < 0 ? '−' : '+'} ${term}`)
  })
  return terms.length > 0 ? terms.join(' ') : '0'
}
