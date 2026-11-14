import HoverHelp from '../ui/HoverHelp'
/**
 * Organ scale: a beating left heart against its arteries, and a capillary bed.
 *
 * Two models live here because the organ scale ships two solvers with different
 * time domains. The circulation is a lumped ventricle — an elastance that rises
 * and falls on the beat — driving a Windkessel through two one-way valves; the
 * run is a pressure waveform and a pressure–volume loop, and every number on the
 * tiles comes off the closed curve the integrator traced. The capillary bed has
 * no clock at all: it is Starling's force balance evaluated at the arteriolar and
 * venular ends of one capillary.
 *
 * Units are mmHg, mL and seconds. `1 mmHg·mL = 0.133 mJ`, so the loop area is
 * shown in both — the plane the drawing uses and the one a joule-meter would.
 *
 * What this model cannot say, and the panel says it out loud:
 * - One chamber, one circuit. There is no right heart, no pulmonary bed, no
 *   coronary flow, so nothing here can describe failure that starts on the other
 *   side of the septum.
 * - Valves are resistors with a leak multiplier, not leaflets. Regurgitation is
 *   `reverseLeakFactor` taken down from 10⁴, which is a conductance, not an
 *   orifice area; no stenosis, no valve opening time.
 * - The arterial load is one resistor and one capacitor. Pulsatile impedance
 *   beyond the Windkessel's own pole, wave reflection and the aorta's taper are
 *   absent, so a pulse-pressure claim is a claim about this RC circuit.
 * - Preload is a fixed left-atrial pressure. Real filling is a suction wave and a
 *   compliant atrium, so the Frank–Starling sweep below is the model's own
 *   preload reserve, not a measurement of a person's.
 * - Elastance is prescribed in time and blind to calcium, so beat-to-beat
 *   inotropy, arrhythmia and the force–frequency relation cannot appear.
 *
 * Threading, measured rather than assumed: the beat on screen integrates in-thread
 * (a 294 ms task at the preset window, 712 ms at the longest one the dial offers,
 * chart included), while the preload sweep — six whole runs, 0.2 s at the preset
 * and 0.5 s at the longest — is a worker job, so the tab keeps answering while the
 * heart beats six times.
 */
import { useCallback, useMemo, useState } from 'react'
import { Button } from '../ui/button'
import {
  arterialPressureBalance,
  capillarySegmentExchange,
  pressureVolumeMetrics,
  simulateCirculation,
  starlingFiltration,
  type BeatMetrics,
  type CirculationParameters,
  type CirculationSample,
  type StarlingForces,
} from '../../lib/biology/haemodynamics'
import { RESTING_CAPILLARY, type LoadedBioModel } from '../../lib/biology/models'
import {
  BioChecks,
  BioMetrics,
  BioNote,
  BioRefusal,
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
import { useBioJob } from './useBioRun'

type OrganModel = Extract<LoadedBioModel, { family: 'circulation' | 'starling' }>

export default function OrganView(props: BioViewControls & { loaded: OrganModel }) {
  switch (props.loaded.family) {
    case 'circulation':
      return <Ventricle {...props} loaded={props.loaded} />
    case 'starling':
      return <CapillaryBed {...props} loaded={props.loaded} />
  }
}

/* ------------------------------------------------------------------ *
 * The beating heart
 * ------------------------------------------------------------------ */

type CirculationModel = Extract<LoadedBioModel, { family: 'circulation' }>

/** Millimetre-of-mercury work, in the joules a physics bench would quote. */
const MMHG_ML_TO_MJ = 0.133

function circulationDials(loaded: CirculationModel): DialSpec[] {
  const p = loaded.preset.parameters
  return [
    {
      key: 'resistance',
      label: 'Peripheral resistance',
      unit: 'mmHg·s/mL',
      min: 0.2,
      max: 4,
      step: 0.05,
      default: p.resistance,
      help: `The arterioles. With compliance ${p.compliance} mL/mmHg this sets the decay time constant at ${fixed(p.resistance * p.compliance, 3)} s.`,
    },
    {
      key: 'compliance',
      label: 'Arterial compliance',
      unit: 'mL/mmHg',
      min: 0.2,
      max: 4,
      step: 0.05,
      default: p.compliance,
      help: 'How much volume the artery stores per mmHg. Stiffness is this dial going down, not a new parameter.',
    },
    {
      key: 'elastanceMax',
      label: 'Peak elastance',
      unit: 'mmHg/mL',
      min: 0.4,
      max: 8,
      step: 0.1,
      default: p.elastanceMax,
      help: `Contractility. End-diastolic elastance stays at ${p.elastanceMin} mmHg/mL, so only the systolic corner of the loop moves.`,
    },
    {
      key: 'leftAtrialPressure',
      label: 'Left atrial pressure',
      unit: 'mmHg',
      min: 2,
      max: 24,
      step: 0.5,
      default: p.leftAtrialPressure,
      help: 'This model\'s preload: the filling pressure the mitral valve is driven by.',
    },
    {
      key: 'beatPeriod',
      label: 'Beat period',
      unit: 's',
      min: 0.3,
      max: 2,
      step: 0.01,
      default: p.beatPeriod,
      help: `The other half of the heart-rate dial: ${fixed(60 / p.beatPeriod, 0)} bpm at the preset value.`,
    },
    {
      key: 'systoleFraction',
      label: 'Systole fraction',
      unit: 'of the beat',
      min: 0.1,
      max: 0.6,
      step: 0.01,
      default: p.systoleFraction,
      help: 'Share of the cycle the elastance pulse occupies. Diastole — the filling time — is the remainder.',
    },
    {
      key: 'leakDecades',
      label: 'Valve leak factor',
      unit: 'log₁₀ × forward R',
      min: 0,
      max: 4,
      step: 0.05,
      default: Math.log10(p.reverseLeakFactor ?? 1e4),
      help: 'A closed valve resists the reverse gradient 10^this times more than an open one resists the forward one. 4 is as competent as this model gets; the leaky preset sits at 1.3.',
    },
    {
      key: 'initialVolume',
      label: 'Volume at t = 0',
      unit: 'mL',
      min: 20,
      max: 240,
      step: 1,
      default: loaded.preset.initialVolume,
      help: 'Where the chamber starts. The first beat is a transient, which is why the metrics are read off the last whole cycle.',
    },
    {
      key: 'tEnd',
      label: 'Run length',
      unit: 's',
      min: loaded.preset.window.tEnd,
      max: loaded.preset.window.tEnd * 4,
      step: 1,
      default: loaded.preset.window.tEnd,
      help: `At ${fixed(p.beatPeriod, 2)} s per beat this is ${fixed(loaded.preset.window.tEnd / p.beatPeriod, 1)} beats. Longer runs settle further before the measured cycle.`,
    },
  ]
}

/**
 * The measured cycle, in the order it was traced, with the two elastance lines
 * evaluated at the volumes the loop actually visited.
 *
 * `P = E·(V − V₀)` is the model's own algebra, so the systolic line is
 * `elastanceMax` and the diastolic line `elastanceMin` on the same unstressed
 * volume: they bracket the loop by construction rather than being fitted to it.
 * The ventricle never develops negative pressure, so both lines are floored at
 * zero exactly as the solver floors the pressure.
 */
function loopRows(
  profile: readonly CirculationSample[],
  metrics: BeatMetrics,
  parameters: CirculationParameters,
): TraceRow[] {
  const cycle = profile.filter((sample) => sample.time >= metrics.fromTime - 1e-9 && sample.time <= metrics.toTime + 1e-9)
  const stressed = (volume: number) => Math.max(volume - parameters.unstressedVolume, 0)
  return cycle.map((sample) => ({
    volume: sample.leftVentricularVolume,
    ventricular: sample.leftVentricularPressure,
    espvr: parameters.elastanceMax * stressed(sample.leftVentricularVolume),
    edpvr: parameters.elastanceMin * stressed(sample.leftVentricularVolume),
  }))
}

interface PreloadStudy {
  rows: TraceRow[]
  table: { label: string; value: string }[]
  hint: string
}

function Ventricle({ loaded, overrides, setOverride, resetOverrides }: BioViewControls & { loaded: CirculationModel }) {
  const colorOf = useSeriesColors()
  const specs = useMemo(() => circulationDials(loaded), [loaded])
  const values = useMemo(() => {
    const merged: Record<string, number> = {}
    for (const spec of specs) merged[spec.key] = overrides[spec.key] ?? spec.default
    return merged
  }, [overrides, specs])

  const [traceView, setTraceView] = useState<'loop' | 'pressure' | 'flow'>('loop')
  const [study, setStudy] = useState<PreloadStudy | { error: string } | null>(null)

  const parameters = useMemo<CirculationParameters>(
    () => ({
      ...loaded.preset.parameters,
      resistance: values.resistance,
      compliance: values.compliance,
      elastanceMax: values.elastanceMax,
      leftAtrialPressure: values.leftAtrialPressure,
      beatPeriod: values.beatPeriod,
      systoleFraction: values.systoleFraction,
      reverseLeakFactor: 10 ** values.leakDecades,
    }),
    [loaded, values],
  )
  const window = useMemo(() => ({ tEnd: values.tEnd, dt: loaded.preset.window.dt }), [values.tEnd, loaded])

  const run = useMemo(() => {
    try {
      const profile = simulateCirculation(parameters, values.initialVolume, window)
      const metrics = pressureVolumeMetrics(parameters, profile)
      // The beat before the measured one comes off the same integration, so
      // "has this settled?" costs nothing. It costs a refusal when the run is
      // shorter than two cycles, which is a window problem, not a physics one —
      // so the comparison is dropped and said so rather than failing the beat.
      let previous: BeatMetrics | null = null
      try {
        previous = pressureVolumeMetrics(parameters, profile, {
          fromTime: metrics.fromTime - parameters.beatPeriod,
          toTime: metrics.fromTime,
        })
      } catch {
        previous = null
      }
      return { profile, metrics, previous, error: null as string | null }
    } catch (error) {
      return { profile: null, metrics: null, previous: null, error: error instanceof Error ? error.message : String(error) }
    }
  }, [parameters, values.initialVolume, window])

  /*
   * The preload sweep is six integrations of the whole run — 0.2 s at the preset
   * window, 0.5 s at the longest one the dial offers — so it is a worker job asked
   * for by button, not a loop inside the render: dragging the atrial-pressure dial
   * has to stay smooth and the tab has to stay responsive while the sweep runs.
   */
  const { busy: isSweeping, start: startSweep } = useBioJob()
  const runPreloadStudy = useCallback(() => {
    const base = parameters.leftAtrialPressure
    const levels = [base - 6, base - 3, base, base + 3, base + 6, base + 9].filter((level) => level > 0)
    setStudy(null)
    startSweep({ kind: 'preload-sweep', parameters, initialVolume: values.initialVolume, window, levels }, (outcome) => {
      const measured = outcome.result?.kind === 'preload-sweep' ? outcome.result : null
      if (!measured) {
        setStudy({ error: outcome.error ?? 'The sweep stopped without an answer.' })
        return
      }
      setStudy({
        rows: measured.points.map((point) => ({ ...point })),
        table: measured.points.map((point) => ({
          label: `${fixed(point.preload, 1)} mmHg`,
          value: `EDV ${fixed(point.endDiastolicVolume, 1)} · SV ${fixed(point.strokeVolume, 1)} mL · EF ${fixed(
            point.ejectionFraction * 100,
            1,
          )}% · output ${fixed(point.outputMlPerMin, 0)} mL/min`,
        })),
        hint:
          measured.slopeMicrolitrePerMmHg === null
            ? 'Sweep a range wide enough to read a slope.'
            : `Stroke volume moves ${fixed(measured.slopeMicrolitrePerMmHg, 1)} µL per mmHg of filling pressure across the swept range. No Frank–Starling law is in this model: the slope is there because the chamber is an elastance acting on a volume, so a fuller ventricle opens the aortic valve against a bigger pressure difference and ejects further before the load stops it.`,
      })
    })
  }, [parameters, values.initialVolume, window, startSweep])

  if (run.error || !run.profile || !run.metrics) {
    return (
      <div className="space-y-4">
        <DialGrid label="Heart and arterial load" specs={specs} values={values} onChange={setOverride} onReset={resetOverrides} />
        <BioRefusal
          error={run.error ?? 'The solver returned nothing.'}
          advice="Peak elastance must exceed end-diastolic elastance, the leak factor must be at least 1, systole must be a fraction of the beat, and the run has to be long enough to hold one whole cycle."
        />
      </div>
    )
  }

  const { profile, metrics, previous } = run
  const balance = arterialPressureBalance(parameters, metrics)
  const netOutput = metrics.forwardVolume / parameters.beatPeriod
  const balanceNet = {
    predicted: netOutput * parameters.resistance + (parameters.venousPressure ?? 0),
    measured: metrics.meanArterialPressure,
  }
  const loop = loopRows(profile, metrics, parameters)
  const pressureData: TraceRow[] = profile.map((sample) => ({
    x: sample.time,
    ventricular: sample.leftVentricularPressure,
    root: sample.aorticRootPressure,
    arterial: sample.arterialPressure,
    atrial: parameters.leftAtrialPressure,
  }))
  const flowData: TraceRow[] = profile.map((sample) => ({
    x: sample.time,
    aortic: sample.aorticFlow,
    mitral: sample.mitralFlow,
    volume: sample.leftVentricularVolume,
  }))
  const regurgitant = metrics.regurgitantVolume > 0.01

  return (
    <div className="space-y-4">
      <DialGrid label="Heart and arterial load" specs={specs} values={values} onChange={setOverride} onReset={resetOverrides} />

      <KpiRow>
        <Kpi
          label="Stroke volume"
          value={`${fixed(metrics.strokeVolume, 1)} mL`}
          detail={`${fixed(metrics.endDiastolicVolume, 1)} → ${fixed(metrics.endSystolicVolume, 1)} mL, measured on the last cycle`}
        />
        <Kpi
          label="Ejection fraction"
          value={`${fixed(metrics.ejectionFraction * 100, 1)}%`}
          detail={
            regurgitant
              ? `Only ${fixed(metrics.forwardVolume, 1)} mL leaves the body: ${fixed(metrics.regurgitantVolume, 1)} mL came back through the valve`
              : `${fixed(netOutput * 60, 0)} mL/min actually reaches the artery`
          }
          tone={regurgitant ? 'warn' : 'default'}
        />
        <Kpi
          label="Arterial pressure"
          value={`${fixed(metrics.meanArterialPressure, 0)} mean`}
          detail={`${fixed(metrics.minimumArterialPressure, 0)}–${fixed(metrics.peakArterialPressure, 0)} mmHg · pulse ${fixed(metrics.pulsePressure, 1)} mmHg`}
        />
        <Kpi
          label="Stroke work"
          value={`${fixed(metrics.strokeWork * MMHG_ML_TO_MJ, 2)} mJ`}
          detail={`Loop area ${compact(metrics.strokeWork)} mmHg·mL · peak dP/dt ${compact(metrics.peakDpDt)} mmHg/s`}
          tone={metrics.strokeWork > 0 ? 'default' : 'warn'}
        />
      </KpiRow>

      <TraceToggle
        label="Trace view"
        value={traceView}
        onChange={(id) => setTraceView(id as 'loop' | 'pressure' | 'flow')}
        options={[
          { id: 'loop', label: 'Pressure–volume loop', hint: 'The measured cycle traced in the (V, P) plane, wedged between its own elastance lines' },
          { id: 'pressure', label: 'Pressures', hint: 'Ventricular, aortic-root and distential arterial pressure against time' },
          { id: 'flow', label: 'Valve flows', hint: 'Mitral and aortic flow, with ventricular volume on the right axis' },
        ]}
      />

      {traceView === 'loop' ? (
        <BioTrace
          title="Left ventricular pressure–volume loop"
          hint="One cycle, drawn in the order the integrator produced it, so the area enclosed is the work reported above. The dashed lines are not a fit: they are Emax·(V−V₀) and Emin·(V−V₀) read at the volumes this loop visited, which is why the loop touches both and does not cross either. A cursor here is ambiguous by construction — the same volume occurs on the filling and the ejection limb — so it reports the first sample at that volume."
          data={loop}
          series={[
            { key: 'ventricular', color: colorOf(0), label: 'Ventricular pressure', unit: 'mmHg' },
            { key: 'espvr', color: colorOf(2), label: 'End-systolic elastance', unit: 'mmHg/mL', dash: '5 4' },
            { key: 'edpvr', color: colorOf(3), label: 'End-diastolic elastance', unit: 'mmHg/mL', dash: '5 4' },
          ]}
          xKey="volume"
          xLabel="Volume"
          xFormatter={(value) => `${fixed(value, 0)} mL`}
          yFormatter={(value) => compact(value)}
          readoutFormatter={(value) => Number(value).toPrecision(6)}
          curve="linear"
          height={360}
          ariaLabel="Left ventricular pressure against volume over one beat"
        />
      ) : (
        <BioTrace
          title={traceView === 'pressure' ? 'Pressure through the beat' : 'Flow through the two valves'}
          hint={
            traceView === 'pressure'
              ? `The ventricle is an elastance, so its pressure is E(t)·(V−V₀) and the upstroke is as fast as the valves and the load allow. The root trace sits above the distential one by Zc·Q — that step is the whole reason aortic-root pressure reads higher during ejection. Atrial pressure is flat because this model has no atrial contraction.`
              : `Forward is up. The mitral and aortic flows should never be positive together: whichever valve is open owns the chamber, and overlap is the leak factor letting the closed one conduct. Negative aortic flow is regurgitation returning in the same beat.`
          }
          data={traceView === 'pressure' ? pressureData : flowData}
          series={
            traceView === 'pressure'
              ? [
                  { key: 'ventricular', color: colorOf(0), label: 'Left ventricle', unit: 'mmHg' },
                  { key: 'root', color: colorOf(1), label: 'Aortic root', unit: 'mmHg' },
                  { key: 'arterial', color: colorOf(2), label: 'Distential arterial', unit: 'mmHg' },
                  { key: 'atrial', color: colorOf(3), label: 'Left atrium', unit: 'mmHg', dash: '5 4' },
                ]
              : [
                  { key: 'aortic', color: colorOf(0), label: 'Aortic flow', unit: 'mL/s' },
                  { key: 'mitral', color: colorOf(1), label: 'Mitral flow', unit: 'mL/s' },
                  { key: 'volume', color: colorOf(2), label: 'Volume', unit: 'mL', axis: 'right', dash: '5 4' },
                ]
          }
          xLabel="Time"
          xFormatter={(value) => `${fixed(value, 2)} s`}
          yFormatter={(value) => compact(value)}
          rightFormatter={(value) => compact(value)}
          readoutFormatter={(value) => Number(value).toPrecision(6)}
          height={360}
          ariaLabel={traceView === 'pressure' ? 'Chamber and arterial pressures over the run' : 'Valve flows and ventricular volume over the run'}
        />
      )}

      <BioMetrics
        title="The cycle that was measured"
        hint={`Metrics are read between ${fixed(metrics.fromTime, 2)} s and ${fixed(metrics.toTime, 2)} s, so the unsettled first beats are excluded rather than averaged in. Peak dP/dt and the loop area are finite differences and trapezoids on that grid: they rise with a finer reporting step.`}
        rows={[
          ['Beat period / rate', `${fixed(parameters.beatPeriod, 3)} s · ${fixed(metrics.heartRateBpm, 1)} bpm`],
          ['End-diastolic volume', `${fixed(metrics.endDiastolicVolume, 2)} mL`],
          ['End-systolic volume', `${fixed(metrics.endSystolicVolume, 2)} mL`],
          ['Stroke volume', `${fixed(metrics.strokeVolume, 2)} mL`],
          ['Gross ventricular output', `${fixed(metrics.cardiacOutputMlPerS * 60, 0)} mL/min`],
          ['Forward output (∫Q_ao dt)', `${fixed(netOutput * 60, 0)} mL/min`],
          ['Regurgitant volume per beat', `${fixed(metrics.regurgitantVolume, 3)} mL`],
          ['Peak ventricular pressure', `${fixed(metrics.peakVentricularPressure, 1)} mmHg`],
          ['Peak aortic flow', `${fixed(metrics.peakAorticFlow, 2)} mL/s`],
          ['Peak reverse flow', `${fixed(metrics.peakReverseFlow, 3)} mL/s`],
          ['Arterial decay time RC', `${fixed(parameters.resistance * parameters.compliance, 3)} s`],
        ]}
      />

      <BioChecks
        title="Does this run describe a settled beat?"
        hint="Three independent statements about the same integration: that the loop closes, that consecutive cycles agree, and that the artery holds the pressure the flow should buy it."
        checks={[
          {
            label: 'Loop closes',
            value: `${compact(metrics.cycleVolumeDrift)} mL net over the cycle`,
            passed: Math.abs(metrics.cycleVolumeDrift) < Math.max(0.5, metrics.strokeVolume * 0.02),
            note: 'Volume at the end of the measured cycle minus its start. Anything larger than a couple percent of the stroke volume means the chamber is still filling up or emptying out across beats, and the reported stroke volume belongs to a transient.',
          },
          {
            label: 'Cycle to cycle',
            value: previous
              ? `ΔEDV ${fixed(metrics.endDiastolicVolume - previous.endDiastolicVolume, 2)} mL · ΔSV ${fixed(metrics.strokeVolume - previous.strokeVolume, 2)} mL`
              : 'no previous cycle in the window',
            passed: previous
              ? Math.abs(metrics.strokeVolume - previous.strokeVolume) < Math.max(0.5, metrics.strokeVolume * 0.02)
              : false,
            note: 'The beat before the measured one, from the same run. A large difference says the run length dial needs raising before this beat means anything.',
          },
          {
            label: 'Arterial pressure balance',
            value: `mean ${fixed(balance.measured, 1)} against ${fixed(balance.predicted, 1)} mmHg from gross output`,
            passed: balance.relativeResidual < 0.02,
            note: `MAP should be output × resistance plus the downstream pressure. With the regurgitant volume taken out of the output the prediction is ${fixed(balanceNet.predicted, 1)} mmHg against the ${fixed(balanceNet.measured, 1)} measured, which is the version a leaky valve has to satisfy. A residual here is the reporting grid and the Windkessel's own curvature, not a second solver.`,
          },
        ]}
      />

      <div className="flex flex-wrap items-center gap-2">
        <HoverHelp title="Re-beat this heart at six filling pressures, three mmHg apart around the dial you set, and measure the stroke volume each one produces" description="Re-beat this heart at six filling pressures, three mmHg apart around the dial you set, and measure the stroke volume each one produces">
<Button type="button"
          size="sm"
          variant="outline"
          disabled={isSweeping}
          onClick={runPreloadStudy}>
          Sweep the filling pressure
        </Button>
</HoverHelp>
        {isSweeping ? (
          <span className="text-sm text-muted-foreground">
            Beating this heart at six filling pressures — one whole run each.
          </span>
        ) : (
          study && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setStudy(null)}
              title="Discard the sweep and leave the single beat on screen"
            >
              Clear
            </Button>
          )
        )}
      </div>

      {study && 'error' in study ? (
        <BioRefusal error={study.error} advice="A sweep point is a full run: if one refuses, it is the parameters at that filling pressure, not the sweep." />
      ) : study ? (
        <div className="space-y-4">
          <BioTrace
            title="Stroke volume against filling pressure"
            hint={study.hint}
            data={study.rows}
            series={[
              { key: 'strokeVolume', color: colorOf(0), label: 'Stroke volume', unit: 'mL' },
              { key: 'endDiastolicVolume', color: colorOf(1), label: 'End-diastolic volume', unit: 'mL', dash: '5 4' },
              { key: 'work', color: colorOf(2), label: 'Stroke work', unit: 'mmHg·mL', axis: 'right' },
            ]}
            xKey="preload"
            xLabel="Left atrial pressure"
            xFormatter={(value) => `${fixed(value, 1)} mmHg`}
            yFormatter={(value) => compact(value)}
            rightFormatter={(value) => compact(value)}
            readoutFormatter={(value) => Number(value).toPrecision(6)}
            ariaLabel="Measured stroke volume and end-diastolic volume against left atrial pressure"
          />
          <BioMetrics
            title="Every beat of the sweep"
            hint="One integration per row, each measured on its own last cycle. The curve this produces is the model's preload reserve — it exists because the chamber is an elastance against a volume, not because a starling mechanism was coded in."
            rows={study.table.map((row) => [row.label, row.value] as readonly [string, string])}
          />
        </div>
      ) : null}

      <BioNote heading="What this model is">
        <p>{loaded.preset.note}</p>
        <p>
          One chamber, one circuit, two resistive valves and an RC load: a lumped hydraulic analogue. It has no right
          heart, no pulmonary bed, no valve leaflets and no calcium, so it can say what a change in resistance,
          compliance, contractility, rate or filling pressure does to the beat it models — and nothing about which side
          of a person failed.
        </p>
      </BioNote>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * The capillary bed
 * ------------------------------------------------------------------ */

type StarlingModel = Extract<LoadedBioModel, { family: 'starling' }>

function capillaryDials(): DialSpec[] {
  const arterial = RESTING_CAPILLARY.arterialEnd
  const venular = RESTING_CAPILLARY.venularEnd
  return [
    {
      key: 'arterialPressure',
      label: 'Capillary pressure, arteriolar end',
      unit: 'mmHg',
      min: 0,
      max: 80,
      step: 0.5,
      default: arterial.capillaryPressure,
      help: 'The hydrostatic pressure pushing fluid out at the entrance of the bed.',
    },
    {
      key: 'venularPressure',
      label: 'Capillary pressure, venular end',
      unit: 'mmHg',
      min: 0,
      max: 60,
      step: 0.5,
      default: venular.capillaryPressure,
      help: 'The same tube, further along, after the pressure has fallen through it.',
    },
    {
      key: 'interstitialPressure',
      label: 'Interstitial pressure',
      unit: 'mmHg',
      min: -10,
      max: 20,
      step: 0.5,
      default: arterial.interstitialPressure,
      help: 'Outside the wall. Negative values suck; raised interstitial pressure is oedema pushing back and the reason filtration slows as swelling grows.',
    },
    {
      key: 'plasmaOncotic',
      label: 'Plasma oncotic pressure',
      unit: 'mmHg',
      min: 0,
      max: 45,
      step: 0.5,
      default: arterial.plasmaOncoticPressure,
      help: 'What the plasma proteins hold on to. Set by albumin, so this is the dial liver failure and nephrotic syndrome move.',
    },
    {
      key: 'interstitialOncotic',
      label: 'Interstitial oncotic pressure',
      unit: 'mmHg',
      min: 0,
      max: 25,
      step: 0.5,
      default: arterial.interstitialOncoticPressure,
      help: 'The protein that escaped, pulling the other way.',
    },
    {
      key: 'reflection',
      label: 'Reflection coefficient',
      unit: 'σ',
      min: 0,
      max: 1,
      step: 0.01,
      default: arterial.reflectionCoefficient,
      help: 'How completely the wall holds protein back: 1 is protein-tight, 0 lets plasma and interstitium pull equally, so only hydrostatics remain.',
    },
    {
      key: 'conductance',
      label: 'Filtration coefficient × area',
      unit: 'mL/(s·mmHg)',
      min: 0.01,
      max: 5,
      step: 0.01,
      default: RESTING_CAPILLARY.filtrationCoefficientArea,
      help: 'How much water the wall moves per mmHg of net pressure, for the whole bed. It scales the flows and cannot change their sign.',
    },
  ]
}

function CapillaryBed({ loaded, overrides, setOverride, resetOverrides }: BioViewControls & { loaded: StarlingModel }) {
  const colorOf = useSeriesColors()
  const specs = useMemo(capillaryDials, [])
  const values = useMemo(() => {
    const merged: Record<string, number> = {}
    for (const spec of specs) merged[spec.key] = overrides[spec.key] ?? spec.default
    return merged
  }, [overrides, specs])

  const ends = useMemo(
    () => ({
      arterial: {
        capillaryPressure: values.arterialPressure,
        interstitialPressure: values.interstitialPressure,
        plasmaOncoticPressure: values.plasmaOncotic,
        interstitialOncoticPressure: values.interstitialOncotic,
        reflectionCoefficient: values.reflection,
      } satisfies StarlingForces,
      venular: {
        capillaryPressure: values.venularPressure,
        interstitialPressure: values.interstitialPressure,
        plasmaOncoticPressure: values.plasmaOncotic,
        interstitialOncoticPressure: values.interstitialOncotic,
        reflectionCoefficient: values.reflection,
      } satisfies StarlingForces,
      conductance: values.conductance,
    }),
    [values],
  )

  const bed = useMemo(() => {
    try {
      return { result: capillarySegmentExchange(ends.arterial, ends.venular, ends.conductance), error: null as string | null }
    } catch (error) {
      return { result: null, error: error instanceof Error ? error.message : String(error) }
    }
  }, [ends])

  // The pressure sweep is the same algebraic solver evaluated across a range, so
  // the null point on the curve is the null point the report states.
  const sweep = useMemo(() => {
    const rows: TraceRow[] = []
    for (let pressure = 0; pressure <= 80; pressure += 1) {
      const report = starlingFiltration({ ...ends.arterial, capillaryPressure: pressure }, ends.conductance)
      rows.push({ pressure, net: report.netFiltrationPressure, flow: report.flowPerUnitConductance })
    }
    return rows
  }, [ends])

  if (bed.error || !bed.result) {
    return (
      <div className="space-y-4">
        <DialGrid label="Forces across the wall" specs={specs} values={values} onChange={setOverride} onReset={resetOverrides} />
        <BioRefusal
          error={bed.error ?? 'The solver returned nothing.'}
          advice="Pressures cannot be negative, σ has to lie between 0 and 1, and the filtration coefficient must be above zero — a wall that conducts nothing has no flow to report."
        />
      </div>
    )
  }

  const { arteriolar, venular, netFiltration, reabsorbed } = bed.result
  const nullPressure =
    ends.arterial.interstitialPressure + ends.arterial.reflectionCoefficient * (ends.arterial.plasmaOncoticPressure - ends.arterial.interstitialOncoticPressure)

  return (
    <div className="space-y-4">
      <DialGrid label="Forces across the wall" specs={specs} values={values} onChange={setOverride} onReset={resetOverrides} />

      <KpiRow>
        <Kpi
          label="Net filtration pressure, arteriolar end"
          value={`${fixed(arteriolar.netFiltrationPressure, 2)} mmHg`}
          detail={`Hydrostatic ${fixed(arteriolar.hydrostaticDifference, 2)} less oncotic ${fixed(arteriolar.oncoticDifference, 2)} mmHg`}
          tone={arteriolar.netFiltrationPressure >= 0 ? 'default' : 'warn'}
        />
        <Kpi
          label="Net filtration pressure, venular end"
          value={`${fixed(venular.netFiltrationPressure, 2)} mmHg`}
          detail={`Flow ${compact(venular.flowPerUnitConductance)} mL/s at LpS = ${trimNumber(ends.conductance)}`}
          tone={venular.netFiltrationPressure >= 0 ? 'warn' : 'default'}
        />
        <Kpi
          label="Filtration the lymphatics must carry"
          value={`${compact(netFiltration)} mL/s`}
          detail="The whole bed summed with its sign, so a positive number is fluid the interstitium keeps"
          tone={netFiltration > 0.5 ? 'warn' : 'default'}
        />
        <Kpi
          label="Reabsorbed at the venular end"
          value={`${compact(-reabsorbed)} mL/s`}
          detail={reabsorbed < -1e-9 ? 'Only the part of the bed with a negative net pressure takes fluid back' : 'Nothing is taken back: every segment has a positive net pressure'}
          tone={reabsorbed < -1e-9 ? 'default' : 'warn'}
        />
      </KpiRow>

      <BioTrace
        title="Net filtration pressure along the capillary"
        hint={`A straight line, because the wall's balance is linear in capillary pressure: it crosses zero at ${fixed(nullPressure, 1)} mmHg, which is Pi + σ(πc − πi) for the forces you set. The two ends of the bed are marked where their own pressures sit; sweep a range wide enough and both markers leave the plot. Moving σ or the oncotic pressures slides the crossing, and moving the arteriolar pressure moves the marker along the line instead.`}
        data={sweep}
        series={[
          { key: 'net', color: colorOf(0), label: 'Net filtration pressure', unit: 'mmHg' },
          { key: 'flow', color: colorOf(1), label: 'Flow', unit: 'mL/s', axis: 'right', dash: '5 4' },
        ]}
        xKey="pressure"
        xLabel="Capillary pressure"
        xFormatter={(value) => `${fixed(value, 0)} mmHg`}
        yFormatter={(value) => compact(value)}
        rightFormatter={(value) => compact(value)}
        readoutFormatter={(value) => Number(value).toPrecision(6)}
        referencesY={[{ value: 0, label: 'no net movement' }]}
        markerX={nullPressure}
        ariaLabel="Net filtration pressure against capillary pressure, with the arteriolar and venular ends marked"
      />

      <BioMetrics
        title="Both ends, term by term"
        hint="Every row is the same force balance evaluated twice, at each end of one capillary. Nothing here is a rate of flow through a real vessel: the bed has no length, no resistance and no transit time."
        rows={[
          ['Arteriolar: hydrostatic difference', `${fixed(arteriolar.hydrostaticDifference, 2)} mmHg`],
          ['Arteriolar: oncotic difference', `${fixed(arteriolar.oncoticDifference, 2)} mmHg`],
          ['Arteriolar: flow at this LpS', `${compact(arteriolar.flowPerUnitConductance)} mL/s`],
          ['Venular: hydrostatic difference', `${fixed(venular.hydrostaticDifference, 2)} mmHg`],
          ['Venular: oncotic difference', `${fixed(venular.oncoticDifference, 2)} mmHg`],
          ['Venular: flow at this LpS', `${compact(venular.flowPerUnitConductance)} mL/s`],
          ['Null capillary pressure', `${fixed(nullPressure, 2)} mmHg`],
          ['Net for the whole bed', `${compact(netFiltration)} mL/s`],
        ]}
      />

      <BioChecks
        title="What the balance leaves behind"
        hint="The textbook story is filtration at one end and reabsorption at the other. This model reports what its own numbers say, and the two do not always agree."
        checks={[
          {
            label: 'Both ends filtered out of the vessel',
            value: venular.netFiltrationPressure > 0 ? 'yes' : 'no',
            passed: venular.netFiltrationPressure < 0,
            note:
              venular.netFiltrationPressure > 0
                ? `At venular capillary pressure ${fixed(ends.venular.capillaryPressure, 1)} mmHg the balance still favours leaving, so this bed returns nothing by that route: all of ${compact(netFiltration)} mL/s is a lymphatic debt. Raising the interstitial oncotic pressure or lowering the venular pressure is what turns reabsorption on.`
                : 'The venular end takes fluid back, as the classic account says it should.',
          },
          {
            label: 'Wall holds the protein',
            value: `σ = ${fixed(ends.arterial.reflectionCoefficient, 2)}`,
            passed: ends.arterial.reflectionCoefficient >= 0.7,
            note: 'Below about 0.7 the oncotic term stops being a useful brake: inflamed or burn-injured capillaries leak protein, the interstitium loses its osmotic gradient and the filtration that follows is not the one the forces above describe.',
          },
          {
            label: 'Interstitial pressure is not opposing filtration',
            value: `${fixed(ends.arterial.interstitialPressure, 1)} mmHg`,
            passed: ends.arterial.interstitialPressure <= 2,
            note: 'Swollen tissue raises this term, which pushes back on every mmHg of capillary pressure and slows filtration. It is the bed\'s own feedback against oedema, and it is the one dial here that represents it.',
          },
        ]}
      />

      <BioNote heading="What this model is">
        <p>{loaded.row.description}</p>
        <p>
          Two points on one capillary, no time domain, no flow through the tube and no lymphatic in it. The net the two
          ends leave behind is reported because this balance cannot dispose of it: real beds drain through lymphatics,
          and a bed whose net is positive is a bed that is swelling.
        </p>
      </BioNote>
    </div>
  )
}

function trimNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}
