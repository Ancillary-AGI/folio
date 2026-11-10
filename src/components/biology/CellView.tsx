/**
 * Cell scale: one excitable membrane, or one regulatory network inside a cell.
 *
 * Four families share this view because a designer moves between them to ask the
 * same question at different cost — how much of the answer comes from ion channels,
 * how much from the topology of excitability, how much from timing alone, and how
 * much from genes reading genes. Each one solves its own equations here: the
 * Hodgkin–Huxley and FitzHugh–Nagumo runs go through the shared adaptive integrator,
 * the integrate-and-fire spike times come out of its closed form, and the gene
 * circuit is relaxed to a steady state and then linearised about it.
 *
 * The protocols (threshold search, cooperativity scan) are buttons, not automatic.
 * Each one is a sweep of full runs — the strength–duration search alone costs 2.7 s
 * of bisection — so neither runs on the main thread: they go through the biology
 * dispatch, which uses a worker when the host has one. The relaxation oscillator
 * does the same for its dial run, because at the stiffest ε the dials allow it
 * integrates for 1.2 s, and a UI that spends that thinking looks broken.
 */
import { useMemo, useState } from 'react'
import { Button } from '../ui/button'
import {
  EXCITABLE_FITZHUGH_NAGUMO,
  detectSpikes,
  meanFiringRateHertz,
  pulseTrain,
  simulateHodgkinHuxley,
  simulateIntegrateAndFire,
  strengthDurationCurve,
  type HodgkinHuxleyParameters,
} from '../../lib/biology/excitability'
import {
  analyseCircuit,
  simulateGeneticCircuit,
  type GeneticCircuit,
  type RegulatoryEdge,
} from '../../lib/biology/geneticCircuit'
import type { BioRunJob, HillScanRow, RelaxationRun } from '../../lib/biology/bioRunCore'
import type { BiologyWindow } from '../../lib/biology/modelSupport'
import { TONIC_LIF, type LoadedBioModel } from '../../lib/biology/models'
import { useBioJob, useBioRun } from './useBioRun'
import {
  BioChecks,
  BioMetrics,
  BioNote,
  BioRefusal,
  BioSolving,
  BioTrace,
  DialGrid,
  Kpi,
  KpiRow,
  TraceToggle,
  type BioViewControls,
  type DialSpec,
} from './BioKit'
import { compact, fixed } from '../../lib/numberFormat'
import { useSeriesColors } from '../../lib/theme/useSeriesColors'
import type { TraceRow } from '../charts/TraceChart'

type CellModel = Extract<LoadedBioModel, { family: 'hodgkin-huxley' | 'fitzhugh-nagumo' | 'integrate-and-fire' | 'gene-circuit' }>

/** The window the conductance run is solved on: 60 ms at 0.05 ms, 1200 samples. */
const HH_WINDOW: BiologyWindow = { tEnd: 60, dt: 0.05 }

/** The relaxation run reports at this cadence; only its length is a dial. */
const RELAXATION_REPORT_DT = 0.05

function useDialValues(specs: readonly DialSpec[], overrides: Readonly<Record<string, number>>) {
  return useMemo(() => {
    const merged: Record<string, number> = {}
    for (const spec of specs) merged[spec.key] = overrides[spec.key] ?? spec.default
    return merged
  }, [overrides, specs])
}

export default function CellView(props: BioViewControls & { loaded: CellModel }) {
  switch (props.loaded.family) {
    case 'hodgkin-huxley':
      return <ConductanceCell {...props} loaded={props.loaded} />
    case 'fitzhugh-nagumo':
      return <RelaxationCell {...props} />
    case 'integrate-and-fire':
      return <PointCell {...props} />
    case 'gene-circuit':
      return <CircuitCell {...props} loaded={props.loaded} />
  }
}

/* ------------------------------------------------------------------ *
 * Hodgkin–Huxley
 * ------------------------------------------------------------------ */

interface ConductanceProps extends BioViewControls {
  loaded: Extract<CellModel, { family: 'hodgkin-huxley' }>
}

/** The widths the strength–duration protocol is asked to search, in ms. */
const PULSE_WIDTHS_MS = [0.2, 0.5, 1, 2, 5, 10]

function ConductanceCell({ loaded, overrides, setOverride, resetOverrides }: ConductanceProps) {
  const colorOf = useSeriesColors()
  const preset = loaded.preset
  const specs = useMemo<DialSpec[]>(
    () => [
      {
        key: 'amplitude',
        label: 'Pulse amplitude',
        unit: 'µA/cm²',
        min: 0,
        max: 40,
        step: 0.5,
        default: 10,
        help: 'Current-clamp height. Below threshold nothing happens but a capacitive bump.',
      },
      { key: 'start', label: 'Pulse starts', unit: 'ms', min: 0, max: 50, step: 0.5, default: 20 },
      { key: 'duration', label: 'Pulse width', unit: 'ms', min: 0.1, max: 10, step: 0.1, default: 1 },
      {
        key: 'gNa',
        label: 'Sodium conductance ḡ',
        unit: 'mS/cm²',
        min: 0,
        max: 300,
        step: 1,
        default: preset.HodgkinHuxley.sodiumConductanceMilliSiemensPerCm2,
        help: 'Zero makes the membrane passive: no upstroke, no all-or-none event, whatever the stimulus.',
      },
      {
        key: 'gK',
        label: 'Potassium conductance ḡ',
        unit: 'mS/cm²',
        min: 0,
        max: 120,
        step: 1,
        default: preset.HodgkinHuxley.potassiumConductanceMilliSiemensPerCm2,
        help: 'The delayed rectifier. Cutting it slows repolarisation and widens the spike.',
      },
      {
        key: 'gL',
        label: 'Leak conductance ḡ',
        unit: 'mS/cm²',
        min: 0.01,
        max: 5,
        step: 0.05,
        default: preset.HodgkinHuxley.leakConductanceMilliSiemensPerCm2,
        help: 'Sets the resting potential toward its own reversal and shortens the membrane time constant.',
      },
    ],
    [preset],
  )
  const values = useDialValues(specs, overrides)
  const [traceView, setTraceView] = useState<'potential' | 'currents' | 'gates'>('potential')
  const [curve, setCurve] = useState<ReturnType<typeof strengthDurationCurve> | { error: string } | null>(null)
  const protocol = useBioJob()

  const parameters: HodgkinHuxleyParameters = useMemo(
    () => ({
      ...preset.HodgkinHuxley,
      sodiumConductanceMilliSiemensPerCm2: values.gNa,
      potassiumConductanceMilliSiemensPerCm2: values.gK,
      leakConductanceMilliSiemensPerCm2: values.gL,
    }),
    [preset, values],
  )

  const stimulus = useMemo(
    () =>
      pulseTrain(
        {
          amplitudeMicroAmpPerCm2: values.amplitude,
          startMs: values.start,
          durationMs: values.duration,
        },
        { repetitions: 1 },
      ),
    [values],
  )

  const run = useMemo(() => {
    try {
      const samples = simulateHodgkinHuxley(parameters, preset.initial, stimulus, HH_WINDOW)
      const spikes = detectSpikes(samples)
      return {
        samples,
        spikes,
        rate: meanFiringRateHertz(spikes, values.start, HH_WINDOW.tEnd),
        error: null as string | null,
      }
    } catch (error) {
      return { samples: [], spikes: [], rate: 0, error: error instanceof Error ? error.message : String(error) }
    }
  }, [parameters, preset, stimulus, values.start])

  if (run.error || run.samples.length === 0) {
    return (
      <div className="space-y-4">
        <DialGrid label="Membrane and stimulus" specs={specs} values={values} onChange={setOverride} onReset={resetOverrides} />
        <BioRefusal
          error={run.error ?? 'The solver returned no samples.'}
          advice="Conductances must be positive, gates must start between 0 and 1, and the pulse has to begin inside the 60 ms window."
        />
      </div>
    )
  }

  const peak = Math.max(...run.samples.map((sample) => sample.potentialMillivolts))
  const rest = run.samples[0].potentialMillivolts
  const data: TraceRow[] = run.samples.map((sample) => ({
    x: sample.timeMs,
    potential: sample.potentialMillivolts,
    sodium: sample.sodiumCurrentMicroAmpPerCm2,
    potassium: sample.potassiumCurrentMicroAmpPerCm2,
    leak: sample.leakCurrentMicroAmpPerCm2,
    stimulus: sample.stimulusMicroAmpPerCm2,
    m: sample.m,
    h: sample.h,
    n: sample.n,
  }))

  return (
    <div className="space-y-4">
      <DialGrid label="Membrane and stimulus" specs={specs} values={values} onChange={setOverride} onReset={resetOverrides} />

      <KpiRow>
        <Kpi
          label="Spikes detected"
          value={String(run.spikes.length)}
          detail={run.spikes.length > 0 ? `first peak at ${fixed(run.spikes[0].peakTimeMs, 2)} ms` : 'the pulse stayed sub-threshold'}
          tone={run.spikes.length === 0 ? 'warn' : 'default'}
        />
        <Kpi label="Mean firing rate" value={`${fixed(run.rate, 2)} Hz`} detail="From the peak times inside the pulse window" />
        <Kpi label="Peak potential" value={`${fixed(peak, 1)} mV`} detail={`started at ${fixed(rest, 1)} mV`} />
        <Kpi
          label="Spike amplitude"
          value={run.spikes.length > 0 ? `${fixed(run.spikes[0].peakMillivolts - (run.spikes[0].followingTroughMillivolts ?? rest), 1)} mV` : '—'}
          detail={run.spikes.length > 0 ? 'peak to the following after-hyperpolarisation trough' : 'nothing to measure'}
        />
      </KpiRow>

      <TraceToggle
        label="Trace view"
        value={traceView}
        onChange={(id) => setTraceView(id as 'potential' | 'currents' | 'gates')}
        options={[
          { id: 'potential', label: 'Potential', hint: 'Membrane voltage and the clamp current that drove it' },
          { id: 'currents', label: 'Ionic currents', hint: 'Sodium, potassium and leak, as the solver resolved them' },
          { id: 'gates', label: 'Gate variables', hint: 'm, h and n — the probabilities behind the conductances' },
        ]}
      />

      <BioTrace
        title={
          traceView === 'potential' ? 'Membrane potential' : traceView === 'currents' ? 'Ionic currents through the membrane' : 'Gating variables'
        }
        hint={
          traceView === 'potential'
            ? 'The stimulus is drawn on the same axis as the voltage, which is a units coincidence worth noting: both are µA/cm², and the potential is mV on the left.'
            : traceView === 'currents'
              ? 'Sodium is inward and negative during the upstroke, potassium outward and positive on the falling limb — the signs are the model\'s own, not a convention applied afterwards.'
              : 'm activates fast, h and n are slow. A spike is these three moving, and their bounds are what stops the sodium conductance from running away.'
        }
        data={data}
        series={
          traceView === 'potential'
            ? [
                { key: 'potential', color: colorOf(0), label: 'V', unit: 'mV' },
                { key: 'stimulus', color: colorOf(4), label: 'Stimulus', unit: 'µA/cm²', dash: '4 3' },
              ]
            : traceView === 'currents'
              ? [
                  { key: 'sodium', color: colorOf(0), label: 'I(Na)', unit: 'µA/cm²' },
                  { key: 'potassium', color: colorOf(1), label: 'I(K)', unit: 'µA/cm²' },
                  { key: 'leak', color: colorOf(2), label: 'I(leak)', unit: 'µA/cm²' },
                ]
              : [
                  { key: 'm', color: colorOf(0), label: 'm', unit: '' },
                  { key: 'h', color: colorOf(1), label: 'h', unit: '' },
                  { key: 'n', color: colorOf(2), label: 'n', unit: '' },
                ]
        }
        xLabel="Time (ms)"
        xFormatter={(value) => `${value} ms`}
        yFormatter={(value) => compact(value)}
        readoutFormatter={(value) => Number(value).toPrecision(6)}
        yDomain={traceView === 'gates' ? [0, 1] : undefined}
        referencesY={traceView === 'potential' && run.spikes.length > 0 ? [{ value: 0, label: '0 mV' }] : undefined}
        ariaLabel={`Hodgkin–Huxley ${traceView} trace`}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={protocol.busy}
          onClick={() => {
            setCurve(null)
            protocol.start({ kind: 'strength-duration', parameters, initial: preset.initial, pulseWidthsMs: [...PULSE_WIDTHS_MS] }, (outcome) => {
              if (outcome.result?.kind === 'strength-duration') setCurve(outcome.result.curve)
              else setCurve({ error: outcome.error ?? 'The threshold search stopped without an answer.' })
            })
          }}
          title={`Search the threshold current at ${PULSE_WIDTHS_MS.length} pulse widths by bisection and read the rheobase and chronaxie off the curve`}
        >
          Run strength–duration protocol
        </Button>
        {protocol.busy ? (
          <span className="text-sm text-muted-foreground">
            {`Bisecting ${PULSE_WIDTHS_MS.length} pulse widths — around ${PULSE_WIDTHS_MS.length} × 20 full membrane runs.`}
          </span>
        ) : (
          curve && (
            <Button type="button" size="sm" variant="ghost" onClick={() => setCurve(null)} title="Discard the measured curve and keep this run on screen">
              Clear
            </Button>
          )
        )}
      </div>

      {curve && 'error' in curve ? (
        <BioRefusal error={curve.error} advice="The search needs a pulse width it can bracket: raise the upper bound or shorten the widest pulse." />
      ) : curve ? (
        <div className="space-y-4">
          <BioTrace
            title="Strength–duration curve"
            hint="Each point is a bisection on this membrane: the smallest amplitude at that width that still evokes a spike. The chronaxie is read off the computed points where the threshold doubles from the rheobase — the classic definition, interpolated rather than assumed from a fitted exponential."
            data={curve.points.map((point) => ({ x: point.pulseWidthMs, threshold: point.thresholdMicroAmpPerCm2 }))}
            series={[{ key: 'threshold', color: colorOf(3), label: 'Threshold', unit: 'µA/cm²' }]}
            xLabel="Pulse width (ms)"
            xFormatter={(value) => `${value} ms`}
            yFormatter={(value) => compact(value)}
            logX
            ariaLabel="Threshold current against pulse width"
          />
          <BioMetrics
            title="Excitability measured on this membrane"
            rows={[
              ['Rheobase', `${compact(curve.rheobaseMicroAmpPerCm2)} µA/cm²`],
              ['Chronaxie', curve.chronaxieMs === null ? 'not crossed in the sweep' : `${fixed(curve.chronaxieMs, 3)} ms`],
              ['Widths searched', curve.points.map((point) => `${point.pulseWidthMs}`).join(', ')],
            ]}
          />
        </div>
      ) : null}

      <BioNote heading="What this model is">
        <p>{preset.note}</p>
        <p>
          Reversal potentials are held at the preset's values ({preset.HodgkinHuxley.sodiumReversalMillivolts} mV sodium,{' '}
          {preset.HodgkinHuxley.potassiumReversalMillivolts} mV potassium, {fixed(preset.HodgkinHuxley.leakReversalMillivolts, 3)} mV
          leak) and capacitance at {preset.HodgkinHuxley.capacitanceUfPerCm2} µF/cm²; the dials move conductances, which is what a
          channel density does.
        </p>
      </BioNote>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * FitzHugh–Nagumo
 * ------------------------------------------------------------------ */

function RelaxationCell({ overrides, setOverride, resetOverrides }: BioViewControls) {
  const colorOf = useSeriesColors()
  const specs = useMemo<DialSpec[]>(
    () => [
      {
        key: 'stimulus',
        label: 'Stimulus I',
        unit: '',
        min: 0,
        max: 1.2,
        step: 0.01,
        default: 0.5,
        help: 'Constant dimensionless current. The rest below is found with it switched off.',
      },
      { key: 'epsilon', label: 'Timescale ratio ε', unit: '', min: 0.01, max: 0.5, step: 0.005, default: EXCITABLE_FITZHUGH_NAGUMO.epsilon, help: 'How much slower the recovery variable is than the voltage.' },
      { key: 'a', label: 'Recovery offset a', unit: '', min: 0.2, max: 1.2, step: 0.01, default: EXCITABLE_FITZHUGH_NAGUMO.a },
      { key: 'b', label: 'Recovery slope b', unit: '', min: 0, max: 1.5, step: 0.01, default: EXCITABLE_FITZHUGH_NAGUMO.b },
      { key: 'tEnd', label: 'Run length', unit: 'a.u.', min: 10, max: 200, step: 5, default: 60 },
    ],
    [],
  )
  const values = useDialValues(specs, overrides)
  const [traceView, setTraceView] = useState<'time' | 'phase'>('time')

  const job = useMemo<BioRunJob>(
    () => ({
      kind: 'fitzhugh-nagumo',
      parameters: { epsilon: values.epsilon, a: values.a, b: values.b },
      stimulus: values.stimulus,
      window: { tEnd: values.tEnd, dt: RELAXATION_REPORT_DT },
    }),
    [values],
  )
  const view = useBioRun(job)
  const run: RelaxationRun | null = view.result?.kind === 'fitzhugh-nagumo' ? view.result.run : null

  if (!run) {
    return (
      <div className="space-y-4">
        <DialGrid label="Relaxation oscillator" specs={specs} values={values} onChange={setOverride} onReset={resetOverrides} />
        {view.solving ? (
          <BioSolving label="Finding the rest and integrating" accelerator={view.accelerator} lastDurationMs={view.durationMs || null} />
        ) : (
          <BioRefusal
            error={view.error ?? 'The solver returned no samples.'}
            advice="A parameter set whose nullclines cross only on the middle branch has no stable rest to start from — it self-oscillates, and the rest finder says so instead of handing back a point that would drift."
          />
        )}
      </div>
    )
  }

  const data: TraceRow[] = run.samples.map((sample) => ({ x: sample.time, v: sample.voltage, w: sample.recovery }))
  const phase: TraceRow[] = run.samples.map((sample) => ({ v: sample.voltage, w: sample.recovery }))

  return (
    <div className="space-y-4">
      <DialGrid label="Relaxation oscillator" specs={specs} values={values} onChange={setOverride} onReset={resetOverrides} />

      {view.solving && (
        <BioSolving
          label="Re-solving the oscillator; the numbers below are the previous run"
          accelerator={view.accelerator}
          lastDurationMs={view.durationMs || null}
        />
      )}

      <KpiRow>
        <Kpi label="Resting point" value={`v ${fixed(run.rest.v, 3)} · w ${fixed(run.rest.w, 3)}`} detail="Found by bisection on the model's own nullclines" />
        <Kpi label="Excursions" value={String(run.spikes.length)} detail="Upward crossings of v = 0.5 with hysteresis back to 0" tone={run.spikes.length === 0 ? 'warn' : 'default'} />
        <Kpi label="Mean frequency" value={`${fixed(run.rateHertz, 4)} /a.u.`} detail="From the measured crossing times, not a fitted period" />
        <Kpi label="Voltage range" value={`${fixed(Math.min(...run.samples.map((s) => s.voltage)), 3)} → ${fixed(Math.max(...run.samples.map((s) => s.voltage)), 3)}`} detail={`${run.samples.length} samples at Δt ${RELAXATION_REPORT_DT}`} />
      </KpiRow>

      <TraceToggle
        label="Trace view"
        value={traceView}
        onChange={(id) => setTraceView(id as 'time' | 'phase')}
        options={[
          { id: 'time', label: 'Against time', hint: 'Voltage and recovery variable along the run' },
          { id: 'phase', label: 'Phase plane', hint: 'The trajectory the run traced in (v, w) — the geometry that makes it excitable' },
        ]}
      />

      {traceView === 'time' ? (
        <BioTrace
          title="Voltage and recovery"
          hint="Variables are dimensionless. The slow loop out and back is the relaxation oscillation; a single excursion that returns to rest is what an excitable cell gives to one suprathreshold kick."
          data={data}
          series={[
            { key: 'v', color: colorOf(0), label: 'v', unit: '' },
            { key: 'w', color: colorOf(1), label: 'w', unit: '' },
          ]}
          xLabel="Time (model units)"
          xFormatter={(value) => String(value)}
          yFormatter={(value) => fixed(value, 3)}
          readoutFormatter={(value) => Number(value).toPrecision(6)}
          ariaLabel="FitzHugh–Nagumo voltage and recovery against time"
        />
      ) : (
        <BioTrace
          title="Phase-plane trajectory"
          hint="Drawn in sample order, so the fast jumps are near-vertical and the slow drift along the cubic is the shallow part. The horizontal axis is v, not time."
          data={phase}
          series={[{ key: 'w', color: colorOf(2), label: 'w', unit: '' }]}
          xKey="v"
          xLabel="v (dimensionless)"
          xFormatter={(value) => fixed(value, 2)}
          yFormatter={(value) => fixed(value, 3)}
          ariaLabel="FitzHugh–Nagumo trajectory in the phase plane"
        />
      )}

      <BioNote heading="What this model is">
        <p>
          {`v̇ = v − v³/3 − w + I and ẇ = ε(v + a − b·w), integrated with the same adaptive stepper the conductance model uses `}
          (checked against `fitzhughNagumoDerivative`, which is the vector field itself).
        </p>
        <p>
          This is a topological twin of Hodgkin–Huxley, not a quantitative one: no ion current and no millivolt appears in it, so
          it is the right model for whether a front will propagate and the wrong one for what a channel does.
        </p>
      </BioNote>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Leaky integrate-and-fire
 * ------------------------------------------------------------------ */

function PointCell({ overrides, setOverride, resetOverrides }: BioViewControls) {
  const colorOf = useSeriesColors()
  const specs = useMemo<DialSpec[]>(
    () => [
      { key: 'tau', label: 'Membrane time constant τ', unit: 'ms', min: 1, max: 60, step: 0.5, default: TONIC_LIF.tauMs },
      {
        key: 'drive',
        label: 'Drive V∞',
        unit: 'mV',
        min: -80,
        max: 0,
        step: 0.5,
        default: TONIC_LIF.driveMillivolts,
        help: 'Where the membrane would sit if it never spiked. Above threshold it fires for ever.',
      },
      {
        key: 'threshold',
        label: 'Threshold',
        unit: 'mV',
        min: -70,
        max: 0,
        step: 0.5,
        default: TONIC_LIF.thresholdMillivolts,
        help: 'Must sit above rest, and reset must not exceed it.',
      },
      { key: 'reset', label: 'Reset', unit: 'mV', min: -90, max: -40, step: 0.5, default: TONIC_LIF.resetMillivolts },
      { key: 'rest', label: 'Rest', unit: 'mV', min: -90, max: -40, step: 0.5, default: TONIC_LIF.restMillivolts },
      {
        key: 'refractory',
        label: 'Refractory hold',
        unit: 'ms',
        min: 0,
        max: 10,
        step: 0.1,
        default: TONIC_LIF.refractoryMs,
        help: 'Absolute: the voltage is pinned at reset for this long after every spike.',
      },
      { key: 'tEnd', label: 'Run length', unit: 'ms', min: 20, max: 500, step: 10, default: 200 },
    ],
    [],
  )
  const values = useDialValues(specs, overrides)

  const run = useMemo(() => {
    try {
      const result = simulateIntegrateAndFire(
        {
          tauMs: values.tau,
          restMillivolts: values.rest,
          thresholdMillivolts: values.threshold,
          resetMillivolts: values.reset,
          driveMillivolts: values.drive,
          refractoryMs: values.refractory,
        },
        { tEnd: values.tEnd, dt: 0.5 },
      )
      const meanInterval = result.intervalsMs.length > 0
        ? result.intervalsMs.reduce((sum, interval) => sum + interval, 0) / result.intervalsMs.length
        : null
      return { result, meanInterval, error: null as string | null }
    } catch (error) {
      return { result: null, meanInterval: null, error: error instanceof Error ? error.message : String(error) }
    }
  }, [values])

  if (!run.result) {
    return (
      <div className="space-y-4">
        <DialGrid label="Point neuron" specs={specs} values={values} onChange={setOverride} onReset={resetOverrides} />
        <BioRefusal error={run.error ?? 'The solver returned nothing.'} advice="Threshold must sit above rest and reset must not exceed threshold; otherwise the cell is firing from its own resting potential." />
      </div>
    )
  }

  const { result } = run
  const data: TraceRow[] = result.samples.map((sample) => ({ x: sample.timeMs, potential: sample.potentialMillivolts }))

  return (
    <div className="space-y-4">
      <DialGrid label="Point neuron" specs={specs} values={values} onChange={setOverride} onReset={resetOverrides} />

      <KpiRow>
        <Kpi label="Spikes" value={String(result.spikeTimesMs.length)} detail={result.spikeTimesMs.length > 0 ? `first at ${fixed(result.spikeTimesMs[0], 3)} ms` : 'the drive never reaches threshold'} tone={result.spikeTimesMs.length === 0 ? 'warn' : 'default'} />
        <Kpi label="Mean interval" value={run.meanInterval === null ? '—' : `${fixed(run.meanInterval, 3)} ms`} detail="From the analytic spike times, not from a sampled trace" />
        <Kpi label="Firing rate" value={run.meanInterval === null ? '0 Hz' : `${fixed(1000 / run.meanInterval, 2)} Hz`} detail="The reciprocal of the measured interval" />
        <Kpi label="Sub-threshold asymptote" value={`${fixed(result.asymptoteMillivolts, 1)} mV`} detail={result.asymptoteMillivolts > values.threshold ? 'above threshold, so the cell is tonically active' : 'below threshold, so it settles'} />
      </KpiRow>

      <BioTrace
        title="Membrane potential"
        hint="Between spikes the exponential update is exact, so the sawtooth is the solution rather than an approximation of it; a spike is reported at its analytic crossing time and the trace is then pinned at reset for the refractory hold."
        data={data}
        series={[{ key: 'potential', color: colorOf(0), label: 'V', unit: 'mV' }]}
        xLabel="Time (ms)"
        xFormatter={(value) => `${value} ms`}
        yFormatter={(value) => fixed(value, 1)}
        readoutFormatter={(value) => Number(value).toPrecision(6)}
        referencesY={[
          { value: values.threshold, label: 'threshold' },
          { value: values.rest, label: 'rest' },
        ]}
        ariaLabel="Integrate-and-fire membrane potential against time"
      />

      <BioNote heading="What this model is">
        <p>
          A point neuron: no spike shape, no sodium channel, and nothing between rest and threshold but an RC charge. It is the
          row to read when the question is timing — how a refractory hold and a membrane constant set a firing rate — and not
          mechanism.
        </p>
        <p>
          The intervals reported above are the model's own: {result.intervalsMs.length === 0 ? 'no second spike, so no interval exists' : `${result.intervalsMs.length} intervals, from ${fixed(Math.min(...result.intervalsMs), 3)} to ${fixed(Math.max(...result.intervalsMs), 3)} ms`}.
        </p>
      </BioNote>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Gene circuit
 * ------------------------------------------------------------------ */

interface CircuitProps extends BioViewControls {
  loaded: Extract<CellModel, { family: 'gene-circuit' }>
}

/** The cooperativity scan: every edge's Hill coefficient multiplied by these. */
const HILL_SWEEP = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5]

/**
 * The design dials, applied.
 *
 * A clamped species is a boundary condition: its own α and δ cannot move the
 * trajectory, because the solver pins it, so dials for those would be decoration.
 * What it does have is the level it is pinned at, and that is exposed as its own
 * multiplier — moving it is a deliberate change of the input, not a side effect of
 * touching a production rate.
 */
function scaleCircuit(circuit: GeneticCircuit, values: Readonly<Record<string, number>>): GeneticCircuit {
  return {
    ...circuit,
    species: circuit.species.map((species, index) =>
      species.fixedAt === undefined
        ? {
            ...species,
            maxProduction: species.maxProduction * (values[`production-${index}`] ?? 1),
            degradationPerTime: species.degradationPerTime * (values[`degradation-${index}`] ?? 1),
          }
        : { ...species, fixedAt: species.fixedAt * (values[`clamp-${index}`] ?? 1) },
    ),
    edges: circuit.edges.map((edge, index) => scaleEdge(edge, values, index)),
  }
}

function scaleEdge(edge: RegulatoryEdge, values: Readonly<Record<string, number>>, index: number): RegulatoryEdge {
  return {
    ...edge,
    threshold: edge.threshold * (values[`threshold-${index}`] ?? 1),
    hill: values[`hill-${index}`] ?? edge.hill,
  }
}

function CircuitCell({ loaded, overrides, setOverride, resetOverrides }: CircuitProps) {
  const colorOf = useSeriesColors()
  const circuit = loaded.preset.circuit
  const specs = useMemo<DialSpec[]>(
    () => [
      ...circuit.species.flatMap((species, index) =>
        species.fixedAt === undefined
          ? [
              {
                key: `production-${index}`,
                label: `${species.label ?? species.id} α`,
                unit: '×',
                min: 0,
                max: 4,
                step: 0.05,
                default: 1,
                help: `Multiplies the maximum production rate (α = ${species.maxProduction}), so it sets both the steady-state level and how hard this gene can push its targets.`,
              },
              {
                key: `degradation-${index}`,
                label: `${species.label ?? species.id} δ`,
                unit: '×',
                min: 0.1,
                max: 3,
                step: 0.05,
                default: 1,
                help: `Multiplies the first-order removal rate (δ = ${species.degradationPerTime}), which sets the integration timescale 1/δ of this species.`,
              },
            ]
          : [
              {
                key: `clamp-${index}`,
                label: `${species.label ?? species.id} clamp`,
                unit: '×',
                min: 0,
                max: 4,
                step: 0.05,
                default: 1,
                help: `This species is an input pin, held at ${species.fixedAt}; its own α and δ cannot move the trajectory, so they are not offered. Multiplier moves the pin, which is a different circuit, not a tuned one.`,
              },
            ],
      ),
      /*
       * Edges are keyed by position, not by their endpoints: a design is allowed
       * two edges between the same pair (an activator and a repressor on one
       * promoter), and a key that collided would silently move the other one.
       */
      ...circuit.edges.map((edge, index) => ({
        key: `threshold-${index}`,
        label: `K of ${edge.from} → ${edge.to}`,
        unit: '×',
        min: 0.1,
        max: 4,
        step: 0.05,
        default: 1,
        help: `Multiplies the half-effect concentration (K = ${edge.threshold}) on the ${edge.kind === 'repress' ? 'repressing' : 'activating'} edge from ${edge.from} to ${edge.to}.`,
      })),
      ...circuit.edges.map((edge, index) => ({
        key: `hill-${index}`,
        label: `n of ${edge.from} → ${edge.to}`,
        unit: '',
        min: 1,
        max: 6,
        step: 0.5,
        default: edge.hill,
        help: `Cooperativity of this edge. Steepness, not strength: it decides how hard the switch snaps, and whether a loop can oscillate at all.`,
      })),
    ],
    [circuit],
  )
  const values = useDialValues(specs, overrides)
  const [scan, setScan] = useState<HillScanRow[] | { error: string } | null>(null)
  const study = useBioJob()

  const scaled = useMemo(() => scaleCircuit(circuit, values), [circuit, values])

  const run = useMemo(() => {
    try {
      const samples = simulateGeneticCircuit(scaled, loaded.preset.initial, loaded.preset.window)
      const analysis = analyseCircuit(scaled, loaded.preset.initial, loaded.preset.window)
      return { samples, analysis, error: null as string | null }
    } catch (error) {
      return { samples: [], analysis: null, error: error instanceof Error ? error.message : String(error) }
    }
  }, [scaled, loaded])

  if (run.error || run.samples.length === 0 || !run.analysis) {
    return (
      <div className="space-y-4">
        <DialGrid label="Circuit design" specs={specs} values={values} onChange={setOverride} onReset={resetOverrides} />
        <BioRefusal error={run.error ?? 'The solver returned no samples.'} advice="Every species needs a positive removal rate and every edge a positive half-effect concentration; a degradation dial at zero leaves nothing to relax to." />
      </div>
    )
  }

  const { analysis, samples } = run
  const speciesNames = scaled.species.map((species) => species.label ?? species.id)
  const data: TraceRow[] = samples.map((sample) => {
    const row: TraceRow = { x: sample.time }
    sample.concentrations.forEach((concentration, index) => {
      row[`c${index}`] = concentration
    })
    return row
  })
  const last = samples[samples.length - 1]
  const cycles = analysis.oscillation

  return (
    <div className="space-y-4">
      <DialGrid label="Circuit design" specs={specs} values={values} onChange={setOverride} onReset={resetOverrides} />

      <KpiRow>
        <Kpi
          label="Steady state"
          value={analysis.steadyState.converged ? 'settled' : 'not settled'}
          detail={`residual ${compact(analysis.steadyState.residual)} against a ${compact(analysis.steadyState.residualScale)} production scale`}
          tone={analysis.steadyState.converged ? 'good' : 'warn'}
        />
        <Kpi
          label="Linear stability"
          value={analysis.stability.kind}
          detail={Number.isFinite(analysis.stability.margin) ? `largest real part ${compact(analysis.stability.margin)}` : 'withheld: the trajectory never reaches a point to linearise about'}
          tone={analysis.stability.kind === 'stable' ? 'good' : 'warn'}
        />
        <Kpi
          label="Behaviour"
          value={
            cycles.oscillates
              ? 'sustained oscillation'
              : cycles.peaks >= 3
                ? `damped spiral (trend ${fixed(cycles.amplitudeTrend, 2)})`
                : cycles.peaks > 0
                  ? 'wobble, no cycle'
                  : 'settles without turning'
          }
          detail={
            cycles.oscillates && cycles.period
              ? `period ${fixed(cycles.period, 3)} · ${cycles.peaks} peaks · amplitude ${compact(cycles.amplitude)}`
              : `${cycles.peaks} turning points after the transient, span ${compact(cycles.amplitude)} at ${fixed(cycles.relativeAmplitude * 100, 1)}% of the level`
          }
        />
        <Kpi label="End concentrations" value={speciesNames.length <= 3 ? speciesNames.map((name, index) => `${name} ${compact(last.concentrations[index])}`).join(' · ') : `${compact(last.concentrations[0])} …`} detail={`${scaled.species.length} species, ${scaled.edges.length} edges`} />
      </KpiRow>

      <BioTrace
        title="Species concentrations"
        hint="The circuit is a Hill switch network with no noise in it, so anything that decays here decays for a structural reason — the report below says which."
        data={data}
        series={scaled.species.map((species, index) => ({
          key: `c${index}`,
          color: colorOf(index),
          label: species.label ?? species.id,
          unit: 'conc.',
        }))}
        xLabel="Time (model units)"
        xFormatter={(value) => String(value)}
        yFormatter={(value) => compact(value)}
        readoutFormatter={(value) => Number(value).toPrecision(6)}
        ariaLabel="Gene circuit species concentrations over the run"
      />

      <BioChecks
        title="Design checks"
        hint="The verdict on stability comes from the analytic Jacobian of the Hill network at the reported steady state. When the run never settles, the spectrum is withheld rather than guessed, because a linearisation about a point the trajectory does not reach says nothing about the design."
        checks={[
          {
            label: 'Every species settles',
            value: analysis.steadyState.converged ? 'yes' : 'no',
            passed: analysis.steadyState.converged,
            note: analysis.steadyState.note,
          },
          {
            label: 'Steady state is stable',
            value: analysis.stability.kind,
            passed: analysis.stability.kind === 'stable',
            note:
              analysis.stability.kind === 'marginal'
                ? 'No verdict: the circuit either oscillates or has not settled inside the window.'
                : `Eigenvalue margin ${compact(analysis.stability.margin)}.`,
          },
          {
            label: 'Cycling after the transient',
            value: cycles.oscillates ? 'yes' : 'no',
            passed: cycles.oscillates,
            note: `Last third of the run spans ${fixed(cycles.amplitudeTrend, 2)}× the third before it; a limit cycle holds at 1, a spiral toward a fixed point falls toward 0.`,
          },
          ...scaled.edges.map((edge) => ({
            label: `Edge ${edge.from} → ${edge.to} (${edge.kind})`,
            value: `K ${compact(edge.threshold)} · n ${edge.hill}`,
            passed: true,
            note: `${scaled.species.find((species) => species.id === edge.to)?.label ?? edge.to}'s promoter is ${edge.kind === 'repress' ? 'shut off as' : 'turned on as'} ${edge.from} passes ${compact(edge.threshold)}.`,
          })),
        ]}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={study.busy}
          onClick={() => {
            setScan(null)
            study.start(
              {
                kind: 'hill-scan',
                circuit: scaled,
                initial: [...loaded.preset.initial],
                window: loaded.preset.window,
                multipliers: [...HILL_SWEEP],
              },
              (outcome) => {
                if (outcome.result?.kind === 'hill-scan') setScan(outcome.result.rows)
                else setScan({ error: outcome.error ?? 'The cooperativity scan stopped without an answer.' })
              },
            )
          }}
          title={`Re-solve the circuit at ${HILL_SWEEP.length} cooperativity settings and report which regimes oscillate`}
        >
          Scan cooperativity
        </Button>
        {study.busy ? (
          <span className="text-sm text-muted-foreground">{`Solving the circuit at each of the ${HILL_SWEEP.length} multipliers.`}</span>
        ) : (
          scan && (
            <Button type="button" size="sm" variant="ghost" onClick={() => setScan(null)} title="Discard the sweep and keep this run on screen">
              Clear
            </Button>
          )
        )}
      </div>

      {scan && 'error' in scan ? (
        <BioRefusal error={scan.error} advice="One of the swept Hill coefficients left the solver with nothing to settle to." />
      ) : scan ? (
        <div className="space-y-4">
          <BioTrace
            title="Cooperativity scan"
            hint="Every edge's Hill coefficient multiplied by the value on the axis, and the full circuit re-solved. The margin is the largest real part of the Jacobian's spectrum at the steady state, so a sweep that crosses zero is where the design stops holding still. A gap in the line is a point where the verdict was withheld — an oscillating circuit has no steady state to linearise about, so it has no margin to plot."
            data={scan.map((point) => ({ x: point.hill, margin: Number.isFinite(point.margin) ? point.margin : null }))}
            series={[{ key: 'margin', color: colorOf(5), label: 'Eigenvalue margin', unit: '' }]}
            xLabel="Hill multiplier"
            xFormatter={(value) => `${value}×`}
            yFormatter={(value) => compact(value)}
            logX
            referencesY={[{ value: 0, label: 'stability boundary' }]}
            ariaLabel="Linear stability margin against Hill coefficient multiplier"
          />
          <BioMetrics
            title="Regime at each multiplier"
            hint="Oscillation is judged on the trace, not on the spectrum: three turning points that still swing in the last third of the window."
            rows={scan.map((point) => [
              `n × ${point.hill}`,
              point.oscillates
                ? `cycles, period ${fixed(point.period, 3)} · margin ${compact(point.margin)}`
                : `no cycle · margin ${compact(point.margin)}`,
            ])}
          />
        </div>
      ) : null}

      <BioNote heading="What this model is">
        <p>{loaded.preset.note}</p>
        <p>
          ODEs with no stochasticity: a deterministic repressilator that spirals in stays in, however long it is run. Gene
          numbers are dimensionless concentrations in the preset's own units, and {speciesNames.length} species × the run
          window is what the integrator actually carries.
        </p>
      </BioNote>
    </div>
  )
}
