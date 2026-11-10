/**
 * System scale: where a compound goes after it is given.
 *
 * One compartment or two, an absorption site or an infusion line, first-order or
 * capacity-limited elimination — these are the five disposition models the
 * pharmacokinetics solver ships, and the panel draws whichever one the loaded row
 * names. Nothing is a schematic: every curve is integrated (or superposed, where
 * the model is linear and superposition is exact) and every exposure number is
 * measured off that curve, then compared with the closed form that predicts it.
 * Where the two disagree, the disagreement is the numerical error and the panel
 * says so.
 *
 * Units are mg, L and hours throughout. Concentration is mg/L, amount mg, time h,
 * clearance L/h, Vmax mg/h. No weight, no age, no renal function: a compartment is
 * a fitting bucket, not an organ.
 *
 * Honest limits, restated where they bite:
 * - **Linear models, except the saturable one.** Superposition of repeated doses
 *   is exact because `dA/dt = −kA`; the capacity-limited model is integrated with
 *   the infusion as a continuous input because it cannot be superposed.
 * - **One absorption site, first order.** No dissolution, no transit time beyond
 *   the lag, no solubility ceiling, no transporter.
 * - **Extrapolated exposure.** `AUC₀–∞` is a trapezoid over the run plus a tail
 *   extrapolated at the *fitted* terminal slope. A run too short to bend the curve
 *   down makes that tail a guess, which is why the fitted R² sits next to it.
 * - **A two-compartment curve has two slopes.** A log-linear fit of the whole thing
 *   returns a number that is neither, and the R² is where that shows — so both fits
 *   are reported, not just the flattering one.
 * - **The grid bounds the trough.** A peak or trough is read off the reporting grid,
 *   so an instantaneous post-dose maximum is always under-reported by up to one step.
 * - **No metabolite, no protein binding, no PBPK flows.** Time in the body is one
 *   exponential or two; there is no organ to clear anything.
 */
import { useCallback, useMemo, useState } from 'react'
import { Button } from '../ui/button'
import {
  accumulationFactor,
  absorptionConcentration,
  absorptionPeakTime,
  areaUnderCurve,
  averageSteadyStateConcentration,
  concentrationDependentClearance,
  estimateElimination,
  infusionConcentration,
  infusionSteadyState,
  multipleDoseBolusProfile,
  peakAndTrough,
  saturableInfusionProfile,
  saturableInfusionSteadyState,
  simulateInfusion,
  simulateOneCompartmentBolus,
  simulateOralAbsorption,
  simulateTwoCompartmentBolus,
  twoCompartmentConcentration,
  twoCompartmentMacros,
  twoCompartmentMassBalance,
  type ProfileSample,
} from '../../lib/biology/pharmacokinetics'
import {
  type AnyPharmacokineticPreset,
  type BolusDosingPreset,
  type InfusionPreset,
  type LoadedBioModel,
  type OralPreset,
  type SaturablePreset,
  type TwoCompartmentPreset,
} from '../../lib/biology/models'
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

type SystemModel = Extract<LoadedBioModel, { family: 'pharmacokinetics' }>
type CaseProps<P extends AnyPharmacokineticPreset> = BioViewControls & { loaded: SystemModel; preset: P }

export default function SystemView(props: BioViewControls & { loaded: SystemModel }) {
  switch (props.loaded.preset.kind) {
    case 'oral':
      return <OralDose {...props} preset={props.loaded.preset} />
    case 'bolus-repeat':
      return <RepeatedBolus {...props} preset={props.loaded.preset} />
    case 'two-compartment':
      return <TwoCompartments {...props} preset={props.loaded.preset} />
    case 'infusion':
      return <ConstantInfusion {...props} preset={props.loaded.preset} />
    case 'saturable':
      return <CapacityLimitedInfusion {...props} preset={props.loaded.preset} />
  }
}

/* ------------------------------------------------------------------ *
 * Shared plumbing
 * ------------------------------------------------------------------ */

function mergeValues(specs: readonly DialSpec[], overrides: Readonly<Record<string, number>>): Record<string, number> {
  const merged: Record<string, number> = {}
  for (const spec of specs) merged[spec.key] = overrides[spec.key] ?? spec.default
  return merged
}

/** Relative distance between two numbers, guarded against a zero reference. */
function relativeDistance(measured: number, reference: number): number {
  if (!(reference > 0)) return 1
  return Math.abs(measured - reference) / reference
}

/** log₁₀ of a concentration; `null` where the value is not a positive number. */
function logConcentration(value: number | null | undefined): number | null {
  return typeof value === 'number' && value > 0 ? Math.log10(value) : null
}

/** The samples that make up the final `fraction` of a run. */
function tailOf<T>(rows: readonly T[], fraction: number): T[] {
  const start = Math.max(0, Math.floor(rows.length * (1 - fraction)))
  return rows.slice(start)
}

/** Samples inside one dosing interval starting at `from`, so an interval mean is a real interval. */
function intervalSamples(profile: readonly ProfileSample[], from: number, length: number): ProfileSample[] {
  return profile.filter((sample) => sample.time >= from - 1e-9 && sample.time < from + length - 1e-9)
}

/**
 * Trapezoid over the run plus the extrapolated tail.
 *
 * The tail uses the slope fitted to the terminal quarter of the curve rather than
 * the model's own elimination constant: that is what a lab does with a trace, and
 * the only honest thing to do with a flip-flop or two-compartment curve whose
 * terminal slope is not `CL/V`.
 */
function exposureThroughInfinity(profile: readonly ProfileSample[], terminalRate: number): number {
  const last = profile[profile.length - 1]
  if (!last || !(terminalRate > 0)) return areaUnderCurve(profile)
  return areaUnderCurve(profile) + last.concentration / terminalRate
}

interface StudyTable {
  title: string
  hint: string
  rows: readonly (readonly [string, string])[]
  chart?: {
    data: TraceRow[]
    xKey: string
    xLabel: string
    xUnit: string
    series: { key: string; label: string; unit?: string; dash?: string }[]
  }
}

/** A protocol's answer: a table, an explanation, and optionally the curve it came from. */
type Study = StudyTable | { error: string }

function StudyCard({ study }: { study: StudyTable }) {
  const colorOf = useSeriesColors()
  if (!study.chart) {
    return <BioMetrics title={study.title} hint={study.hint} rows={study.rows} />
  }
  return (
    <div className="space-y-4">
      <BioTrace
        title={study.title}
        hint={study.hint}
        data={study.chart.data}
        series={study.chart.series.map((entry, index) => ({
          key: entry.key,
          label: entry.label,
          unit: entry.unit,
          dash: entry.dash,
          color: colorOf(index),
        }))}
        xKey={study.chart.xKey}
        xLabel={study.chart.xLabel}
        xFormatter={(value) => `${compact(value)} ${study.chart?.xUnit ?? ''}`.trim()}
        yFormatter={(value) => compact(value)}
        readoutFormatter={(value) => Number(value).toPrecision(6)}
        ariaLabel={`${study.title} — the curve this protocol measured`}
      />
      <BioMetrics title="Every point of the protocol" rows={study.rows} />
    </div>
  )
}

function StudyBlock({ study }: { study: Study }) {
  return 'error' in study ? (
    <BioRefusal
      error={study.error}
      advice="Each protocol point is a full solve, so a refusal means one parameter set in the sweep is not runnable — not that the sweep itself is broken."
    />
  ) : (
    <StudyCard study={study} />
  )
}

function ProtocolButton({
  label,
  title,
  onRun,
  onClear,
  hasStudy,
}: {
  label: string
  title: string
  onRun: () => void
  onClear: () => void
  hasStudy: boolean
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" variant="outline" onClick={onRun} title={title}>
        {label}
      </Button>
      {hasStudy && (
        <Button type="button" size="sm" variant="ghost" onClick={onClear} title="Discard this protocol and leave the single run on screen">
          Clear
        </Button>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * One compartment, absorbed
 * ------------------------------------------------------------------ */

function OralDose({ loaded, preset, overrides, setOverride, resetOverrides }: CaseProps<OralPreset>) {
  const colorOf = useSeriesColors()
  const p = preset.parameters
  const eliminationRate = p.clearance / p.volume
  const specs = useMemo<DialSpec[]>(
    () => [
      { key: 'dose', label: 'Dose', unit: 'mg', min: 1, max: 500, step: 1, default: p.dose, help: 'What reaches the gut. Only the bioavailable fraction enters the circulation.' },
      { key: 'volume', label: 'Volume of distribution', unit: 'L', min: 5, max: 200, step: 1, default: p.volume, help: 'The bucket the drug dilutes into once systemic. Not a physiological volume.' },
      { key: 'clearance', label: 'Clearance', unit: 'L/h', min: 0.5, max: 50, step: 0.5, default: p.clearance, help: `Elimination capacity: k = CL/V = ${fixed(eliminationRate, 4)} h⁻¹, half-life ${fixed(Math.LN2 / eliminationRate, 2)} h at the preset values.` },
      { key: 'absorptionRate', label: 'Absorption rate ka', unit: 'h⁻¹', min: 0.05, max: 8, step: 0.05, default: p.absorptionRate, help: `Gut to blood, against k = ${fixed(eliminationRate, 4)} h⁻¹. Above it the terminal limb is elimination; below it the limb is absorption and the half-life you read is not clearance's.` },
      { key: 'bioavailability', label: 'Bioavailability F', unit: 'fraction', min: 0, max: 1, step: 0.01, default: p.bioavailability, help: 'Share of the dose that reaches the circulation at all — gut wall and liver before the blood. Zero gives a flat line and no fit.' },
      { key: 'lagTime', label: 'Lag time', unit: 'h', min: 0, max: 4, step: 0.1, default: p.lagTime ?? 0, help: 'Nothing is absorbed before this, so the rise starts here and not at t = 0. The integrator splits the run at the lag rather than smearing it.' },
      { key: 'tEnd', label: 'Run length', unit: 'h', min: Math.ceil(preset.window.tEnd / 2), max: preset.window.tEnd * 3, step: 1, default: preset.window.tEnd, help: `The curve has to bend back down inside the run — about ${fixed(5 * (Math.LN2 / eliminationRate), 1)} h covers five half-lives of elimination at the preset clearance.` },
    ],
    [p, preset.window.tEnd, eliminationRate],
  )
  const values = useMemo(() => mergeValues(specs, overrides), [specs, overrides])
  const [logView, setLogView] = useState(false)
  const [study, setStudy] = useState<Study | null>(null)

  const parameters = useMemo(
    () => ({
      dose: values.dose,
      volume: values.volume,
      clearance: values.clearance,
      absorptionRate: values.absorptionRate,
      bioavailability: values.bioavailability,
      lagTime: values.lagTime,
    }),
    [values],
  )
  const window = useMemo(() => ({ tEnd: values.tEnd, dt: preset.window.dt }), [values.tEnd, preset.window.dt])

  const run = useMemo(() => {
    try {
      const profile = simulateOralAbsorption(parameters, window)
      const closedFormGap = Math.max(
        ...profile.map((sample) => Math.abs(sample.concentration - absorptionConcentration(parameters, sample.time))),
      )
      const scale = Math.max(...profile.map((sample) => sample.concentration), 1e-12)
      const extremes = peakAndTrough(profile)
      const k = parameters.clearance / parameters.volume
      const terminal = estimateElimination(tailOf(profile, 0.25))
      const aucInfinite = exposureThroughInfinity(profile, terminal.eliminationRate)
      const predictedExposure = (parameters.bioavailability * parameters.dose) / parameters.clearance
      return {
        profile,
        extremes,
        terminal,
        aucInfinite,
        predictedExposure,
        k,
        predictedPeakTime: (parameters.lagTime ?? 0) + absorptionPeakTime(parameters),
        relativeError: closedFormGap / scale,
        error: null as string | null,
      }
    } catch (error) {
      return { profile: null, error: error instanceof Error ? error.message : String(error) }
    }
  }, [parameters, window])

  /*
   * The flip-flop scan is six solves across the whole window, so it is asked for
   * with a button rather than run inside the render: dragging the ka dial has to
   * stay smooth.
   */
  const runFlipFlop = useCallback(() => {
    try {
      const k = parameters.clearance / parameters.volume
      const levels = [k / 4, k / 2, k, parameters.absorptionRate, parameters.absorptionRate * 2, parameters.absorptionRate * 4].filter(
        (value, index, all) => value > 0 && all.indexOf(value) === index,
      )
      const points: { rate: number; halfLife: number; peak: number; peakTime: number }[] = []
      for (const rate of levels) {
        const withKa = { ...parameters, absorptionRate: rate }
        const profile = simulateOralAbsorption(withKa, window)
        const fitted = estimateElimination(tailOf(profile, 0.25))
        const peak = peakAndTrough(profile)
        points.push({ rate, halfLife: fitted.halfLife, peak: peak.maximum.concentration, peakTime: peak.maximum.time })
      }
      setStudy({
        title: 'Terminal half-life against absorption rate',
        hint: `The model's own elimination constant is k = ${fixed(k, 4)} h⁻¹, half-life ${fixed(Math.LN2 / k, 2)} h. Where ka falls below k the measured terminal slope follows ka instead: the tail of the curve is the gut emptying, not the body clearing, and a half-life read there makes clearance look far smaller than it is.`,
        rows: points.map((point) => [
          `ka ${fixed(point.rate, 3)} h⁻¹ · ${point.rate < k ? 'slower' : 'faster'} than k`,
          `t½ ${fixed(point.halfLife, 2)} h against ${fixed(Math.LN2 / Math.min(point.rate, k), 2)} h · Cmax ${fixed(point.peak, 3)} mg/L at ${fixed(point.peakTime, 2)} h`,
        ]),
        chart: {
          data: points.map((point) => ({ rate: point.rate, halfLife: point.halfLife, peak: point.peak })),
          xKey: 'rate',
          xLabel: 'Absorption rate',
          xUnit: 'h⁻¹',
          series: [
            { key: 'halfLife', label: 'Measured terminal half-life', unit: 'h' },
            { key: 'peak', label: 'Cmax', unit: 'mg/L', dash: '5 4' },
          ],
        },
      })
    } catch (error) {
      setStudy({ error: error instanceof Error ? error.message : String(error) })
    }
  }, [parameters, window])

  if (run.error || !run.profile) {
    return (
      <div className="space-y-4">
        <DialGrid label="Dose and disposition" specs={specs} values={values} onChange={setOverride} onReset={resetOverrides} />
        <BioRefusal
          error={run.error ?? 'The solver returned nothing.'}
          advice="The lag has to be inside the run, F is a fraction, dose, volume and clearance must be above zero — and a dose that never appears in the blood leaves nothing for the terminal fit to measure."
        />
      </div>
    )
  }

  const { profile, extremes, terminal, aucInfinite, predictedExposure, relativeError, k, predictedPeakTime } = run
  const data: TraceRow[] = profile.map((sample) => ({
    x: sample.time,
    concentration: sample.concentration,
    amount: sample.amount,
    gut: sample.gutAmount,
    closed: absorptionConcentration(parameters, sample.time),
  }))
  const logData: TraceRow[] = data.map((row) => ({
    x: row.x,
    logPlasma: logConcentration(row.concentration),
    logClosed: logConcentration(row.closed),
  }))

  return (
    <div className="space-y-4">
      <DialGrid label="Dose and disposition" specs={specs} values={values} onChange={setOverride} onReset={resetOverrides} />

      <KpiRow>
        <Kpi
          label="Measured Cmax"
          value={`${fixed(extremes.maximum.concentration, 3)} mg/L`}
          detail={`at ${fixed(extremes.maximum.time, 2)} h · the Bateman peak lands at ${fixed(predictedPeakTime, 2)} h`}
        />
        <Kpi
          label="Exposure AUC₀–∞"
          value={`${compact(aucInfinite)} mg·h/L`}
          detail={`Trapezoid plus a tail at the fitted slope · F·D/CL predicts ${compact(predictedExposure)}`}
          tone={relativeDistance(aucInfinite, predictedExposure) < 0.02 ? 'good' : 'warn'}
        />
        <Kpi
          label="Terminal half-life"
          value={`${fixed(terminal.halfLife, 2)} h`}
          detail={`From a log-linear fit of the last quarter · R² ${fixed(terminal.coefficientOfDetermination, 4)}`}
        />
        <Kpi
          label="Integrator against formula"
          value={`${fixed(relativeError * 100, 3)}%`}
          detail="Largest gap between the simulated curve and the closed-form Bateman on the same parameters"
          tone={relativeError < 0.01 ? 'default' : 'warn'}
        />
      </KpiRow>

      <TraceToggle
        label="Trace view"
        value={logView ? 'log' : 'linear'}
        onChange={(id) => setLogView(id === 'log')}
        options={[
          { id: 'linear', label: 'Concentration', hint: 'Linear concentration against time, with the closed form drawn over it and the gut on the right axis' },
          { id: 'log', label: 'Log concentration', hint: 'log₁₀ of the same samples — the limb that is straight on this axis is the terminal one' },
        ]}
      />

      <BioTrace
        title={logView ? 'Disposition on a logarithmic axis' : 'Plasma concentration after a single oral dose'}
        hint={
          logView
            ? `Straight parts are single exponentials. The rising limb is the gut emptying, the falling one is whichever of ka and k is slower — here ka = ${fixed(parameters.absorptionRate, 3)} against k = ${fixed(k, 3)} h⁻¹. Zeroes before the lag plot as gaps rather than a line running down the axis, because log of nothing has no place on this chart.`
            : `The dashed line is the closed-form Bateman curve on the identical parameters, not a fit to the points, so the gap between them is the integrator's error — the percentage on the tile above. The other right-axis curve is the amount still to be absorbed, which is why plasma and gut cross after the peak.`
        }
        data={logView ? logData : data}
        series={
          logView
            ? [
                { key: 'logPlasma', color: colorOf(0), label: 'log₁₀ plasma', unit: 'mg/L' },
                { key: 'logClosed', color: colorOf(2), label: 'log₁₀ formula', unit: 'mg/L', dash: '5 4' },
              ]
            : [
                { key: 'concentration', color: colorOf(0), label: 'Plasma', unit: 'mg/L' },
                { key: 'closed', color: colorOf(2), label: 'Closed form', unit: 'mg/L', dash: '5 4' },
                { key: 'gut', color: colorOf(1), label: 'Still to absorb', unit: 'mg', axis: 'right' },
              ]
        }
        xLabel="Time"
        xFormatter={(value) => `${fixed(value, 1)} h`}
        yFormatter={(value) => compact(value)}
        rightFormatter={(value) => compact(value)}
        readoutFormatter={(value) => Number(value).toPrecision(6)}
        height={340}
        ariaLabel={logView ? 'Logarithmic plasma concentration after one oral dose' : 'Plasma concentration after one oral dose'}
      />

      <BioChecks
        title="Is this curve being read correctly?"
        hint="Three separate statements: that the integration matches the algebra, that the exposure adds up, and that the terminal limb belongs to the process the label claims."
        checks={[
          {
            label: 'Simulation against the closed form',
            value: `worst ${fixed(relativeError * 100, 3)}% of Cmax`,
            passed: relativeError < 0.01,
            note: 'The Bateman solution and the integrator were given the same dose, volume and rate constants. Anything above a percent is the reporting grid or the step planner, not pharmacology.',
          },
          {
            label: 'Exposure against F·Dose/CL',
            value: `${compact(aucInfinite)} against ${compact(predictedExposure)} mg·h/L`,
            passed: relativeDistance(aucInfinite, predictedExposure) < 0.02,
            note: 'For a linear model AUC₀–∞ is dose times F over clearance, whatever the volume or ka are. A shortfall means the run was truncated and the extrapolated tail did not make up the difference; a surplus means the fitted tail slope is too shallow — read the R² on the tile above.',
          },
          {
            label: 'Terminal limb belongs to elimination',
            value: `ka ${fixed(parameters.absorptionRate, 3)} ${parameters.absorptionRate >= terminal.eliminationRate ? '≥' : '<'} fitted ${fixed(terminal.eliminationRate, 3)} h⁻¹`,
            passed: parameters.absorptionRate >= terminal.eliminationRate,
            note: 'When absorption is the slower process the tail reports ka, and the half-life has nothing to do with clearance. That is flip-flop, and the scan below measures it across a range of ka.',
          },
        ]}
      />

      <ProtocolButton
        label="Scan the absorption rate"
        title="Re-solve this dose at absorption constants spanning both sides of the elimination constant, and measure the terminal half-life and Cmax each one produces"
        onRun={runFlipFlop}
        onClear={() => setStudy(null)}
        hasStudy={study !== null}
      />
      {study && <StudyBlock study={study} />}

      <BioNote heading="What this model is">
        <p>{preset.note}</p>
        <p>{loaded.row.description}</p>
      </BioNote>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Repeat bolus, by superposition
 * ------------------------------------------------------------------ */

function RepeatedBolus({ loaded, preset, overrides, setOverride, resetOverrides }: CaseProps<BolusDosingPreset>) {
  const colorOf = useSeriesColors()
  const p = preset.parameters
  const k = p.clearance / p.volume
  const halfLife = Math.LN2 / k
  const specs = useMemo<DialSpec[]>(
    () => [
      { key: 'dose', label: 'Dose per administration', unit: 'mg', min: 5, max: 200, step: 5, default: p.dose, help: 'Every dose is this much, straight into the circulation — there is no absorption site in this model.' },
      { key: 'volume', label: 'Volume of distribution', unit: 'L', min: 5, max: 100, step: 1, default: p.volume, help: `Sets the height of each spike: ${p.dose} mg over ${p.volume} L is ${fixed(p.dose / p.volume, 3)} mg/L the instant it lands.` },
      { key: 'clearance', label: 'Clearance', unit: 'L/h', min: 0.5, max: 30, step: 0.5, default: p.clearance, help: `k = ${fixed(k, 4)} h⁻¹, half-life ${fixed(halfLife, 2)} h. The interval is only short or long measured against this.` },
      { key: 'interval', label: 'Dosing interval', unit: 'h', min: 1, max: 36, step: 1, default: preset.dosingIntervalHours, help: `Accumulation is ${fixed(accumulationFactor(k, preset.dosingIntervalHours), 2)}× at this spacing — the share of the previous dose still on board when the next lands. ${fixed(preset.dosingIntervalHours / halfLife, 2)} half-lives apart.` },
      { key: 'doses', label: 'Number of doses', unit: 'doses', min: 1, max: 12, step: 1, default: preset.doses, help: 'The schedule needs enough of them to show whether the plateau was actually reached inside the window.' },
      { key: 'tEnd', label: 'Run length', unit: 'h', min: preset.window.tEnd, max: preset.window.tEnd * 2, step: 2, default: preset.window.tEnd, help: `The schedule itself spans ${fixed((preset.doses - 1) * preset.dosingIntervalHours, 0)} h; the rest of the window is what the last dose does afterwards. The run is extended if the doses would not fit.` },
    ],
    [p, preset, k, halfLife],
  )
  const values = useMemo(() => mergeValues(specs, overrides), [specs, overrides])
  const [study, setStudy] = useState<Study | null>(null)

  const parameters = useMemo(() => ({ dose: values.dose, volume: values.volume, clearance: values.clearance }), [values])
  const interval = Math.max(1, Math.round(values.interval))
  const doses = Math.max(1, Math.round(values.doses))
  const window = useMemo(
    () => ({ tEnd: Math.max(values.tEnd, (doses - 1) * interval + 2), dt: preset.window.dt }),
    [values.tEnd, doses, interval, preset.window.dt],
  )

  const run = useMemo(() => {
    try {
      const profile = multipleDoseBolusProfile(parameters, { dosingInterval: interval, doses, window })
      const rate = parameters.clearance / parameters.volume
      const extremes = peakAndTrough(profile)
      // The first interval's peak is the highest point before the second dose
      // lands; the last one's is the highest after the final dose. Either one
      // taken over the whole run would compare the wrong pair.
      const firstPeak = Math.max(...profile.filter((sample) => sample.time < interval - 1e-9).map((sample) => sample.concentration))
      const lastDoseTime = (doses - 1) * interval
      const lastInterval = intervalSamples(profile, lastDoseTime, interval)
      const lastPeak = lastInterval.length > 0 ? Math.max(...lastInterval.map((sample) => sample.concentration)) : 0
      const lastTrough = lastInterval.length > 0 ? Math.min(...lastInterval.map((sample) => sample.concentration)) : 0
      const intervalExposure = lastInterval.length > 1 ? areaUnderCurve(lastInterval) : 0
      return {
        profile,
        rate,
        extremes,
        firstPeak,
        lastPeak,
        lastTrough,
        measuredAccumulation: firstPeak > 0 ? lastPeak / firstPeak : null,
        predictedAccumulation: accumulationFactor(rate, interval),
        intervalExposure,
        // A partial final interval (the window can end mid-interval) would divide
        // an incomplete trapezoid by a whole interval, so the mean is only
        // reported when the window holds the interval it measures.
        averageOverLastInterval:
          lastInterval.length > 1 && lastInterval[lastInterval.length - 1].time >= lastDoseTime + interval - window.dt
            ? intervalExposure / interval
            : null,
        predictedAverage: averageSteadyStateConcentration(parameters, interval),
        coversLastInterval: lastInterval.length > 1 && lastInterval[lastInterval.length - 1].time >= lastDoseTime + interval - window.dt,
        error: null as string | null,
      }
    } catch (error) {
      return { profile: null, error: error instanceof Error ? error.message : String(error) }
    }
  }, [parameters, interval, doses, window])

  /*
   * Spacing is the interesting variable, so the study holds the *daily* amount
   * fixed — dose scaled with the interval — and lets the swing move. Four
   * superposed schedules, computed rather than integrated, because this model is
   * linear and superposition is exact here.
   */
  const runIntervalStudy = useCallback(() => {
    try {
      const dailyAmount = (parameters.dose * 24) / interval
      const intervals = [Math.max(1, Math.round(interval / 2)), interval, interval * 2, interval * 4]
      const points: { interval: number; peak: number; trough: number; accumulation: number }[] = []
      for (const spacing of intervals) {
        const doseForSpacing = (dailyAmount * spacing) / 24
        const count = Math.max(1, Math.floor((window.tEnd - 1) / spacing) + 1)
        const profile = multipleDoseBolusProfile(
          { ...parameters, dose: doseForSpacing },
          { dosingInterval: spacing, doses: count, window },
        )
        const lastDoseTime = (count - 1) * spacing
        const last = intervalSamples(profile, lastDoseTime, spacing)
        if (last.length < 2) throw new Error(`The window cannot hold the ${spacing} h interval after ${count} doses.`)
        const firstPeak = Math.max(...profile.filter((sample) => sample.time < spacing - 1e-9).map((sample) => sample.concentration))
        const peak = Math.max(...last.map((sample) => sample.concentration))
        points.push({
          interval: spacing,
          peak,
          trough: Math.min(...last.map((sample) => sample.concentration)),
          accumulation: firstPeak > 0 ? peak / firstPeak : 0,
        })
      }
      setStudy({
        title: 'The same milligrams per day, spaced differently',
        hint: `Each row gives the identical daily amount — ${fixed(dailyAmount, 1)} mg/day — at a different spacing, so average exposure is the same in every row at ${fixed(dailyAmount / (24 * parameters.clearance), 3)} mg/L and only the swing moves. Spacing a quarter as often roughly doubles the peak-to-trough range; the accumulation factor is 1/(1 − e^−kτ) and falls as the interval shortens.`,
        rows: points.map((point) => [
          `every ${point.interval} h · ${fixed((dailyAmount * point.interval) / 24, 1)} mg per dose`,
          `accumulation ${fixed(point.accumulation, 2)}× · peak ${fixed(point.peak, 3)} · trough ${fixed(point.trough, 3)} mg/L · swing ${fixed(point.peak - point.trough, 3)} mg/L`,
        ]),
        chart: {
          data: points.map((point) => ({ interval: point.interval, peak: point.peak, trough: point.trough })),
          xKey: 'interval',
          xLabel: 'Dosing interval',
          xUnit: 'h',
          series: [
            { key: 'peak', label: 'Steady-state peak', unit: 'mg/L' },
            { key: 'trough', label: 'Steady-state trough', unit: 'mg/L', dash: '5 4' },
          ],
        },
      })
    } catch (error) {
      setStudy({ error: error instanceof Error ? error.message : String(error) })
    }
  }, [parameters, interval, window])

  if (run.error || !run.profile) {
    return (
      <div className="space-y-4">
        <DialGrid label="Dose and schedule" specs={specs} values={values} onChange={setOverride} onReset={resetOverrides} />
        <BioRefusal error={run.error ?? 'The solver returned nothing.'} advice="Doses must be a whole number of at least one, and the interval, dose, volume and clearance all have to be above zero." />
      </div>
    )
  }

  const {
    profile,
    extremes,
    measuredAccumulation,
    predictedAccumulation,
    averageOverLastInterval,
    predictedAverage,
    intervalExposure,
    lastTrough,
    coversLastInterval,
    rate,
  } = run
  const data: TraceRow[] = profile.map((sample) => ({ x: sample.time, concentration: sample.concentration, amount: sample.amount }))

  return (
    <div className="space-y-4">
      <DialGrid label="Dose and schedule" specs={specs} values={values} onChange={setOverride} onReset={resetOverrides} />

      <KpiRow>
        <Kpi
          label="Peak / trough over the run"
          value={`${fixed(extremes.maximum.concentration, 2)} / ${fixed(extremes.minimum.concentration, 2)} mg/L`}
          detail={`at ${fixed(extremes.maximum.time, 1)} h and ${fixed(extremes.minimum.time, 1)} h`}
        />
        <Kpi
          label="Accumulation"
          value={measuredAccumulation === null ? '—' : `${fixed(measuredAccumulation, 2)}×`}
          detail={`1/(1 − e^−kτ) predicts ${fixed(predictedAccumulation, 2)}× at k = ${fixed(rate, 4)} h⁻¹`}
          tone={measuredAccumulation !== null && relativeDistance(measuredAccumulation, predictedAccumulation) < 0.05 ? 'good' : 'warn'}
        />
        <Kpi
          label="Average over the last interval"
          value={averageOverLastInterval === null ? 'window is short of one interval' : `${fixed(averageOverLastInterval, 2)} mg/L`}
          detail={`D/(CL·τ) predicts ${fixed(predictedAverage, 2)} mg/L, and does not care about volume`}
        />
        <Kpi
          label="Exposure in the last interval"
          value={`${compact(intervalExposure)} mg·h/L`}
          detail={`Against ${compact(parameters.dose / parameters.clearance)} mg·h/L, which is what one dose gives over all time`}
        />
      </KpiRow>

      <BioTrace
        title="Concentration under the schedule"
        hint={`Every ${interval} h a ${fixed(parameters.dose, 0)} mg dose lands as an instant step and the curve decays between the steps. It is built by superposition rather than integration — exact here because the model is linear, which is what stops being true once elimination saturates. Peaks and troughs are read on the ${window.dt} h reporting grid, so an instantaneous post-dose maximum is under-read by up to one step. The marker is the final dose.`}
        data={data}
        series={[
          { key: 'concentration', color: colorOf(0), label: 'Plasma', unit: 'mg/L' },
          { key: 'amount', color: colorOf(1), label: 'Amount in body', unit: 'mg', axis: 'right', dash: '5 4' },
        ]}
        xLabel="Time"
        xFormatter={(value) => `${fixed(value, 0)} h`}
        yFormatter={(value) => compact(value)}
        rightFormatter={(value) => compact(value)}
        readoutFormatter={(value) => Number(value).toPrecision(6)}
        markerX={(doses - 1) * interval}
        height={340}
        ariaLabel="Plasma concentration under a repeated bolus schedule"
      />

      <BioChecks
        title="Did the schedule reach its plateau?"
        hint="Superposition is exact, so any of these three failing is a statement about the window the run was given, not about the arithmetic."
        checks={[
          {
            label: 'Measured accumulation against 1/(1 − e^−kτ)',
            value: measuredAccumulation === null ? 'no first peak to compare' : `${fixed(measuredAccumulation, 3)} against ${fixed(predictedAccumulation, 3)}`,
            passed: measuredAccumulation !== null && relativeDistance(measuredAccumulation, predictedAccumulation) < 0.05,
            note: 'The last interval\'s peak over the first dose\'s peak, both read off the same curve. It only equals the factor once the trace has stopped climbing, so a shortfall says the dose count or the run length needs raising before this is a steady-state schedule.',
          },
          {
            label: 'Average concentration over the last interval',
            value: averageOverLastInterval === null ? 'not measurable in this window' : `${fixed(averageOverLastInterval, 3)} against ${fixed(predictedAverage, 3)} mg/L`,
            passed: averageOverLastInterval !== null && relativeDistance(averageOverLastInterval, predictedAverage) < 0.02,
            note: coversLastInterval
              ? 'D/(CL·τ) holds at steady state and is independent of volume: the trough and the peak move with volume, their average over a full interval does not.'
              : 'The window ends before a full interval after the last dose, so a trapezoid over it is not an interval exposure and no mean is claimed.',
          },
          {
            label: 'Trough after the last dose',
            value: `${fixed(lastTrough, 3)} mg/L`,
            passed: lastTrough > 1e-9,
            note:
              lastTrough <= 1e-9
                ? `The curve returns to nothing between doses — ${fixed(interval / halfLife, 1)} half-lives of clearance is effectively a clean slate each time, so this schedule does not accumulate.`
                : `Some of every dose is still on board when the next arrives, which is what accumulation is. At ${fixed(interval / halfLife, 2)} half-lives per interval the factor is ${fixed(predictedAccumulation, 2)}×.`,
          },
        ]}
      />

      <ProtocolButton
        label="Compare the dosing intervals"
        title="Re-solve the same daily amount at four spacings and measure the steady-state peak, trough and accumulation each one produces"
        onRun={runIntervalStudy}
        onClear={() => setStudy(null)}
        hasStudy={study !== null}
      />
      {study && <StudyBlock study={study} />}

      <BioNote heading="What this model is">
        <p>{preset.note}</p>
        <p>{loaded.row.description}</p>
      </BioNote>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Two compartments
 * ------------------------------------------------------------------ */

function TwoCompartments({ loaded, preset, overrides, setOverride, resetOverrides }: CaseProps<TwoCompartmentPreset>) {
  const colorOf = useSeriesColors()
  const p = preset.parameters
  const specs = useMemo<DialSpec[]>(
    () => [
      { key: 'dose', label: 'Dose', unit: 'mg', min: 10, max: 500, step: 5, default: p.dose, help: `Into the central bucket only: ${fixed(p.dose / p.volumeCentral, 2)} mg/L the instant it lands.` },
      { key: 'volumeCentral', label: 'Central volume', unit: 'L', min: 2, max: 60, step: 0.5, default: p.volumeCentral, help: 'What the blood equilibrates with at once. Clearance works from here and nowhere else.' },
      { key: 'volumePeripheral', label: 'Peripheral volume', unit: 'L', min: 5, max: 400, step: 5, default: p.volumePeripheral, help: `The deep bucket: ${p.volumePeripheral} L against a central ${p.volumeCentral} L is why the curve keeps falling long after the blood has emptied.` },
      { key: 'distributionClearance', label: 'Distribution clearance', unit: 'L/h', min: 0.5, max: 100, step: 0.5, default: p.distributionClearance, help: `Both ways across the membrane: k₁₂ = ${fixed(p.distributionClearance / p.volumeCentral, 3)} and k₂₁ = ${fixed(p.distributionClearance / p.volumePeripheral, 3)} h⁻¹ at the preset values.` },
      { key: 'clearance', label: 'Clearance', unit: 'L/h', min: 0.5, max: 30, step: 0.5, default: p.clearance, help: 'Elimination from the central compartment alone. Nothing drains the peripheral one directly, which is what makes the terminal limb a redistribution as much as a clearance.' },
      { key: 'tEnd', label: 'Run length', unit: 'h', min: preset.window.tEnd, max: preset.window.tEnd * 2, step: 2, default: preset.window.tEnd, help: 'The terminal limb needs several terminal half-lives to be a limb rather than a bend.' },
    ],
    [p, preset.window.tEnd],
  )
  const values = useMemo(() => mergeValues(specs, overrides), [specs, overrides])
  const [traceView, setTraceView] = useState<'profile' | 'log' | 'mass'>('profile')
  const [study, setStudy] = useState<Study | null>(null)

  const parameters = useMemo(
    () => ({
      dose: values.dose,
      volumeCentral: values.volumeCentral,
      volumePeripheral: values.volumePeripheral,
      clearance: values.clearance,
      distributionClearance: values.distributionClearance,
    }),
    [values],
  )
  const window = useMemo(() => ({ tEnd: values.tEnd, dt: preset.window.dt }), [values.tEnd, preset.window.dt])

  const run = useMemo(() => {
    try {
      const profile = simulateTwoCompartmentBolus(parameters, window)
      const macro = twoCompartmentMacros(parameters)
      const balance = twoCompartmentMassBalance(parameters, profile)
      const wholeFit = estimateElimination(profile, { knownDose: parameters.dose })
      const closedFormGap = Math.max(...profile.map((sample) => Math.abs(sample.concentration - twoCompartmentConcentration(parameters, sample.time))))
      const scale = Math.max(...profile.map((sample) => sample.concentration), 1e-12)
      return { profile, macro, balance, wholeFit, relativeError: closedFormGap / scale, error: null as string | null }
    } catch (error) {
      return { profile: null, error: error instanceof Error ? error.message : String(error) }
    }
  }, [parameters, window])

  const runFitStudy = useCallback(() => {
    if (!run.profile) return
    try {
      const profile = run.profile
      const macro = twoCompartmentMacros(parameters)
      const windows = [
        { label: 'Whole curve', rows: profile },
        { label: 'First 20%', rows: tailOf(profile, 0.2) },
        { label: 'Last 40%', rows: tailOf(profile, 0.4) },
      ]
      const table: (readonly [string, string])[] = []
      for (const entry of windows) {
        try {
          const fit = estimateElimination(entry.rows, { knownDose: parameters.dose })
          table.push([
            entry.label,
            `t½ ${fixed(fit.halfLife, 2)} h · R² ${fixed(fit.coefficientOfDetermination, 4)} · volume ${fit.volume === null ? '—' : fixed(fit.volume, 1)} L`,
          ])
        } catch (fitError) {
          table.push([entry.label, `refused: ${fitError instanceof Error ? fitError.message : String(fitError)}`])
        }
      }
      table.push([
        'The model\'s own phases',
        `β = ${fixed(macro.beta, 4)} h⁻¹ (half-life ${fixed(macro.halfLife, 2)} h) · α = ${fixed(macro.alpha, 4)} h⁻¹ (half-life ${fixed(Math.LN2 / macro.alpha, 2)} h)`,
      ])
      setStudy({
        title: 'One curve, three log-linear fits',
        hint: `The same samples, three windows. The whole curve gives a slope that blends α and β and belongs to neither, and its R² is where that shows. The early window is nearly all α, the late window nearly all β, and only the late one should be used to argue a dosing interval. Intercepts: A = ${fixed(macro.a, 3)} and B = ${fixed(macro.b, 3)} mg/L, so a fit that reports a volume near the central one is really seeing α.`,
        rows: table,
      })
    } catch (error) {
      setStudy({ error: error instanceof Error ? error.message : String(error) })
    }
  }, [parameters, run])

  if (run.error || !run.profile) {
    return (
      <div className="space-y-4">
        <DialGrid label="Two buckets" specs={specs} values={values} onChange={setOverride} onReset={resetOverrides} />
        <BioRefusal error={run.error ?? 'The solver returned nothing.'} advice="Both volumes, both clearances and the dose must be positive, and the fit needs samples with concentration above zero." />
      </div>
    )
  }

  const { profile, macro, balance, wholeFit, relativeError } = run
  const end = profile[profile.length - 1]
  const data: TraceRow[] = profile.map((sample) => ({
    x: sample.time,
    central: sample.concentration,
    closed: twoCompartmentConcentration(parameters, sample.time),
    peripheral: sample.peripheralConcentration,
    centralAmount: sample.amount,
    peripheralAmount: sample.peripheralAmount,
    eliminated: parameters.dose - sample.amount - sample.peripheralAmount,
  }))
  const logData: TraceRow[] = data.map((row) => ({
    x: row.x,
    logCentral: logConcentration(row.central),
    logClosed: logConcentration(row.closed),
  }))

  return (
    <div className="space-y-4">
      <DialGrid label="Two buckets" specs={specs} values={values} onChange={setOverride} onReset={resetOverrides} />

      <KpiRow>
        <Kpi
          label="Terminal half-life"
          value={`${fixed(macro.halfLife, 2)} h`}
          detail={`β = ${fixed(macro.beta, 4)} h⁻¹ · the distribution phase α = ${fixed(macro.alpha, 4)} h⁻¹ lasts ${fixed(Math.LN2 / macro.alpha, 2)} h`}
        />
        <Kpi
          label="Whole-curve log fit"
          value={`t½ ${fixed(wholeFit.halfLife, 2)} h`}
          detail={`R² ${fixed(wholeFit.coefficientOfDetermination, 4)} — the number a naive fit would report`}
          tone={wholeFit.coefficientOfDetermination > 0.995 ? 'default' : 'warn'}
        />
        <Kpi
          label="Dose accounted for"
          value={`${fixed((balance.recovered / balance.dose) * 100, 2)}%`}
          detail={`${fixed(balance.recovered, 2)} mg in the buckets, ${fixed(balance.eliminated, 2)} mg cleared`}
        />
        <Kpi
          label="Peripheral equilibration"
          value={`${fixed(end.peripheralConcentration, 3)} mg/L`}
          detail={`against ${fixed(end.concentration, 3)} mg/L centrally at the end of the run`}
        />
      </KpiRow>

      <TraceToggle
        label="Trace view"
        value={traceView}
        onChange={(id) => setTraceView(id as 'profile' | 'log' | 'mass')}
        options={[
          { id: 'profile', label: 'Both compartments', hint: 'Central and peripheral concentration, with the bi-exponential closed form over them' },
          { id: 'log', label: 'Log central', hint: 'The central curve on a log axis: two straight parts, two slopes' },
          { id: 'mass', label: 'Mass', hint: 'Where every milligram went — central, peripheral and eliminated' },
        ]}
      />

      <BioTrace
        title={traceView === 'profile' ? 'Distribution then elimination' : traceView === 'log' ? 'Central concentration on a log axis' : 'Every milligram, tracked'}
        hint={
          traceView === 'profile'
            ? `The central curve falls fast while the peripheral one climbs: that is distribution, and where they meet is where net transfer stops. The dashed line is the bi-exponential closed form on the same parameters, so the gap between them is integrator error alone.`
            : traceView === 'log'
              ? `Two slopes on one curve: the steep early part is α, the shallow late part is β. A single log-linear fit across both returns a number that is a blend of neither, which is what the fit study measures.`
              : `Nothing is invented here: eliminated is the dose minus what the two buckets hold, so the three curves must sum to the dose exactly. They do, to the numerical error the check below reports.`
        }
        data={traceView === 'log' ? logData : data}
        series={
          traceView === 'profile'
            ? [
                { key: 'central', color: colorOf(0), label: 'Central', unit: 'mg/L' },
                { key: 'peripheral', color: colorOf(1), label: 'Peripheral', unit: 'mg/L' },
                { key: 'closed', color: colorOf(2), label: 'Closed form', unit: 'mg/L', dash: '5 4' },
              ]
            : traceView === 'log'
              ? [
                  { key: 'logCentral', color: colorOf(0), label: 'log₁₀ central', unit: 'mg/L' },
                  { key: 'logClosed', color: colorOf(2), label: 'log₁₀ formula', unit: 'mg/L', dash: '5 4' },
                ]
              : [
                  { key: 'centralAmount', color: colorOf(0), label: 'Central', unit: 'mg' },
                  { key: 'peripheralAmount', color: colorOf(1), label: 'Peripheral', unit: 'mg' },
                  { key: 'eliminated', color: colorOf(3), label: 'Eliminated', unit: 'mg', dash: '5 4' },
                ]
        }
        xLabel="Time"
        xFormatter={(value) => `${fixed(value, 0)} h`}
        yFormatter={(value) => compact(value)}
        readoutFormatter={(value) => Number(value).toPrecision(6)}
        height={340}
        ariaLabel={traceView === 'mass' ? 'Amount of drug in each compartment and eliminated over the run' : 'Two-compartment concentration against time'}
      />

      <BioChecks
        title="Is the run keeping the drug accounted for?"
        hint="A two-compartment model has one bookkeeping identity — central plus peripheral plus eliminated equals the dose — and one numerical claim, that the integration follows the bi-exponential."
        checks={[
          {
            label: 'Mass balance at the end of the run',
            value: `${fixed(balance.recovered + balance.eliminated, 4)} of ${fixed(balance.dose, 1)} mg`,
            passed: Math.abs(balance.recovered + balance.eliminated - balance.dose) < 1e-6 * balance.dose,
            note: 'Recovered is what the two buckets hold; eliminated is the difference the solver defines. The state has no third term, so this identity can only fail through the integrator.',
          },
          {
            label: 'Integration against the closed form',
            value: `worst ${fixed(relativeError * 100, 3)}% of Cmax`,
            passed: relativeError < 0.01,
            note: 'The bi-exponential solution and the integrator share these rate constants. With α this much faster than β, a coarse reporting step undersamples the distribution limb first.',
          },
          {
            label: 'Terminal limb inside the run',
            value: `the window holds ${fixed(window.tEnd / macro.halfLife, 1)} terminal half-lives`,
            passed: window.tEnd / macro.halfLife >= 3,
            note: 'Below about three, the curve has not settled onto β and the reported terminal half-life is a partial bend. The log view shows whether the late part is straight yet.',
          },
        ]}
      />

      <ProtocolButton
        label="Fit the curve three ways"
        title="Run one log-linear regression over the whole curve, one over the early limb and one over the late limb, and put each against the model's own α and β"
        onRun={runFitStudy}
        onClear={() => setStudy(null)}
        hasStudy={study !== null}
      />
      {study && <StudyBlock study={study} />}

      <BioNote heading="What this model is">
        <p>{preset.note}</p>
        <p>{loaded.row.description}</p>
      </BioNote>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Constant infusion
 * ------------------------------------------------------------------ */

function ConstantInfusion({ loaded, preset, overrides, setOverride, resetOverrides }: CaseProps<InfusionPreset>) {
  const colorOf = useSeriesColors()
  const p = preset.parameters
  const steady = p.rate / p.clearance
  const k = p.clearance / p.volume
  const halfLife = Math.LN2 / k
  const specs = useMemo<DialSpec[]>(
    () => [
      { key: 'rate', label: 'Infusion rate', unit: 'mg/h', min: 1, max: 240, step: 1, default: p.rate, help: `What the pump delivers. Alone it sets the plateau: rate over clearance is ${fixed(steady, 2)} mg/L at the preset clearance.` },
      { key: 'clearance', label: 'Clearance', unit: 'L/h', min: 0.5, max: 40, step: 0.5, default: p.clearance, help: 'How fast the body removes it. The plateau moves inversely with this and not at all with volume.' },
      { key: 'volume', label: 'Volume of distribution', unit: 'L', min: 2, max: 120, step: 1, default: p.volume, help: `Sets how long the ramp takes, not where it ends: k = ${fixed(k, 4)} h⁻¹, half-life ${fixed(halfLife, 2)} h.` },
      { key: 'tEnd', label: 'Run length', unit: 'h', min: preset.window.tEnd, max: preset.window.tEnd * 2, step: 2, default: preset.window.tEnd, help: `A plateau is asymptotic — five half-lives buys 97 % of it, so this window of ${fixed(preset.window.tEnd / halfLife, 1)} half-lives reaches ${fixed((1 - Math.exp(-k * preset.window.tEnd)) * 100, 1)} %.` },
    ],
    [p, preset.window.tEnd, steady, k, halfLife],
  )
  const values = useMemo(() => mergeValues(specs, overrides), [specs, overrides])
  const [study, setStudy] = useState<Study | null>(null)

  const parameters = useMemo(() => ({ rate: values.rate, volume: values.volume, clearance: values.clearance }), [values])
  const window = useMemo(() => ({ tEnd: values.tEnd, dt: preset.window.dt }), [values.tEnd, preset.window.dt])

  const run = useMemo(() => {
    try {
      const profile = simulateInfusion(parameters, window)
      const plateau = infusionSteadyState(parameters)
      const rate = parameters.clearance / parameters.volume
      const closedFormGap = Math.max(...profile.map((sample) => Math.abs(sample.concentration - infusionConcentration(parameters, sample.time))))
      const firstNinety = profile.find((sample) => sample.concentration >= 0.9 * plateau)
      return {
        profile,
        plateau,
        rate,
        measuredNinety: firstNinety ? firstNinety.time : null,
        predictedNinety: Math.log(10) / rate,
        finalConcentration: profile[profile.length - 1].concentration,
        relativeError: closedFormGap / Math.max(plateau, 1e-12),
        error: null as string | null,
      }
    } catch (error) {
      return { profile: null, error: error instanceof Error ? error.message : String(error) }
    }
  }, [parameters, window])

  /*
   * A loading dose is the amount already in the body when the pump is switched on:
   * plateau × volume. This model is linear, so the two profiles can be added
   * sample for sample — and the deficit that should vanish is measured, not
   * asserted.
   */
  const runLoadingStudy = useCallback(() => {
    try {
      const plateau = infusionSteadyState(parameters)
      const loadingDose = plateau * parameters.volume
      const infusionProfile = simulateInfusion(parameters, window)
      const bolusProfile = simulateOneCompartmentBolus(
        { dose: loadingDose, volume: parameters.volume, clearance: parameters.clearance },
        window,
      )
      if (infusionProfile.length !== bolusProfile.length) {
        throw new Error('The two runs landed on different reporting grids, so their samples cannot be added.')
      }
      let worstWithout = 0
      let worstWith = 0
      const rows: TraceRow[] = []
      infusionProfile.forEach((sample, index) => {
        const withLoad = sample.concentration + bolusProfile[index].concentration
        worstWithout = Math.max(worstWithout, plateau - sample.concentration)
        worstWith = Math.max(worstWith, Math.abs(plateau - withLoad))
        rows.push({ x: sample.time, without: sample.concentration, with: withLoad, plateau })
      })
      const rate = parameters.clearance / parameters.volume
      setStudy({
        title: `A ${fixed(loadingDose, 1)} mg loading dose against the same infusion`,
        hint: `Both curves come from the same two solves added on the same grid, which is legal only because this model is linear. The ramp's worst deficit below the plateau is ${fixed(worstWithout, 3)} mg/L; with the loading dose it is ${fixed(worstWith, 3)} mg/L, and what remains is the ${window.dt} h grid plus the fact that a dose given all at once washes out faster than one delivered continuously — that difference closes over the ${fixed(halfLifeOf(rate), 2)} h half-life.`,
        rows: [
          ['Target plateau', `${fixed(plateau, 3)} mg/L`],
          ['Loading dose (plateau × volume)', `${fixed(loadingDose, 2)} mg`],
          ['Worst deficit without it', `${fixed(worstWithout, 4)} mg/L`],
          ['Worst deficit with it', `${fixed(worstWith, 4)} mg/L`],
          ['Time to 90 % without it', run.measuredNinety === null ? 'outside the window' : `${fixed(run.measuredNinety, 2)} h`],
        ],
        chart: {
          data: rows,
          xKey: 'x',
          xLabel: 'Time',
          xUnit: 'h',
          series: [
            { key: 'without', label: 'Infusion alone', unit: 'mg/L' },
            { key: 'with', label: 'With a loading dose', unit: 'mg/L' },
            { key: 'plateau', label: 'Plateau', unit: 'mg/L', dash: '5 4' },
          ],
        },
      })
    } catch (error) {
      setStudy({ error: error instanceof Error ? error.message : String(error) })
    }
  }, [parameters, window, run])

  if (run.error || !run.profile) {
    return (
      <div className="space-y-4">
        <DialGrid label="Pump and body" specs={specs} values={values} onChange={setOverride} onReset={resetOverrides} />
        <BioRefusal error={run.error ?? 'The solver returned nothing.'} advice="Rate, volume and clearance all have to be above zero for a plateau to exist." />
      </div>
    )
  }

  const { profile, plateau, measuredNinety, predictedNinety, finalConcentration, relativeError, rate } = run
  const data: TraceRow[] = profile.map((sample) => ({
    x: sample.time,
    concentration: sample.concentration,
    closed: infusionConcentration(parameters, sample.time),
    amount: sample.amount,
  }))

  return (
    <div className="space-y-4">
      <DialGrid label="Pump and body" specs={specs} values={values} onChange={setOverride} onReset={resetOverrides} />

      <KpiRow>
        <Kpi
          label="Plateau"
          value={`${fixed(plateau, 3)} mg/L`}
          detail={`Rate over clearance. The run ends at ${fixed(finalConcentration, 3)} mg/L, ${fixed((finalConcentration / plateau) * 100, 1)}% of it`}
        />
        <Kpi
          label="Time to 90% of plateau"
          value={measuredNinety === null ? 'never in this window' : `${fixed(measuredNinety, 2)} h`}
          detail={`ln 10 / k predicts ${fixed(predictedNinety, 2)} h at k = ${fixed(rate, 4)} h⁻¹`}
        />
        <Kpi
          label="Amount in the body at the end"
          value={`${fixed(profile[profile.length - 1].amount, 1)} mg`}
          detail={`Against ${fixed(plateau * parameters.volume, 1)} mg, which is what the plateau holds`}
        />
        <Kpi
          label="Integrator against formula"
          value={`${fixed(relativeError * 100, 3)}%`}
          detail="Largest gap to (R/CL)(1 − e^−kt) on the same parameters"
          tone={relativeError < 0.01 ? 'default' : 'warn'}
        />
      </KpiRow>

      <BioTrace
        title="Rise to the plateau"
        hint={`The dashed line is the closed form (R/CL)(1 − e^−kt) on the identical parameters, so the two should sit on top of each other. Volume decides how fast the curve approaches the plateau and nothing about where the plateau is: the curve would end at the same height with a different volume, only later.`}
        data={data}
        series={[
          { key: 'concentration', color: colorOf(0), label: 'Plasma', unit: 'mg/L' },
          { key: 'closed', color: colorOf(2), label: 'Closed form', unit: 'mg/L', dash: '5 4' },
          { key: 'amount', color: colorOf(1), label: 'Amount in body', unit: 'mg', axis: 'right' },
        ]}
        xLabel="Time"
        xFormatter={(value) => `${fixed(value, 0)} h`}
        yFormatter={(value) => compact(value)}
        rightFormatter={(value) => compact(value)}
        readoutFormatter={(value) => Number(value).toPrecision(6)}
        referencesY={[{ value: plateau, label: 'rate / clearance' }]}
        height={340}
        ariaLabel="Concentration rising to a plateau under a constant infusion"
      />

      <BioChecks
        title="How close to the plateau is this run?"
        hint="A steady state is an asymptote, so the numbers below say how much of it the window actually reached, in this model's own half-lives."
        checks={[
          {
            label: 'Fraction of plateau reached',
            value: `${fixed((finalConcentration / plateau) * 100, 2)}%`,
            passed: finalConcentration / plateau >= 0.95,
            note: `The window is ${fixed(window.tEnd / halfLife, 1)} terminal half-lives long, i.e. ${fixed(window.tEnd * rate, 2)} e-foldings. Below about five the reported concentration is a point on the ramp and not a steady state.`,
          },
          {
            label: 'Measured against the closed form',
            value: `worst ${fixed(relativeError * 100, 3)}%`,
            passed: relativeError < 0.01,
            note: 'Same parameters, two routes: an analytic exponential against the integrator that has to be trusted for the saturable case, where no such formula exists.',
          },
          {
            label: 'Time to 90% against ln 10 / k',
            value: measuredNinety === null ? 'outside the window' : `${fixed(measuredNinety, 2)} against ${fixed(predictedNinety, 2)} h`,
            passed: measuredNinety !== null && Math.abs(measuredNinety - predictedNinety) <= window.dt * 2,
            note: 'The measured crossing can only land on the reporting grid, so one or two steps of disagreement is the grid and not the model.',
          },
        ]}
      />

      <ProtocolButton
        label="Add a loading dose"
        title="Compute the amount the plateau holds, give it as an instant bolus alongside the infusion, and measure how much of the ramp that removes"
        onRun={runLoadingStudy}
        onClear={() => setStudy(null)}
        hasStudy={study !== null}
      />
      {study && <StudyBlock study={study} />}

      <BioNote heading="What this model is">
        <p>{preset.note}</p>
        <p>{loaded.row.description}</p>
      </BioNote>
    </div>
  )
}

/** Half-life from an elimination rate constant — the same arithmetic the dials quote. */
function halfLifeOf(eliminationRate: number): number {
  return Math.LN2 / eliminationRate
}

/* ------------------------------------------------------------------ *
 * Capacity-limited elimination
 * ------------------------------------------------------------------ */

function CapacityLimitedInfusion({ loaded, preset, overrides, setOverride, resetOverrides }: CaseProps<SaturablePreset>) {
  const colorOf = useSeriesColors()
  const p = preset.parameters
  const specs = useMemo<DialSpec[]>(
    () => [
      { key: 'vmax', label: 'Vmax', unit: 'mg/h', min: 1, max: 200, step: 1, default: p.vmax, help: 'The sink\'s ceiling. An infusion at or above it has no steady state to reach, and no formula will invent one.' },
      { key: 'km', label: 'Km', unit: 'mg/L', min: 0.1, max: 50, step: 0.1, default: p.km, help: `Concentration at half-maximal elimination. Below it the body clears roughly first order, at Vmax/Km = ${fixed(p.vmax / p.km, 2)} L/h.` },
      { key: 'volume', label: 'Volume of distribution', unit: 'L', min: 2, max: 100, step: 1, default: p.volume, help: 'Converts the amount being stored into the concentration the sink actually sees.' },
      { key: 'infusionRate', label: 'Infusion rate', unit: 'mg/h', min: 1, max: Math.max(200, Math.ceil(p.vmax * 1.5)), step: 1, default: preset.infusionRate, help: `Against a Vmax of ${p.vmax} mg/h. Below it a plateau exists; at or above it the amount climbs for the whole run and there is no plateau to report.` },
      { key: 'tEnd', label: 'Run length', unit: 'h', min: preset.window.tEnd, max: preset.window.tEnd * 2, step: 2, default: preset.window.tEnd, help: 'A saturable curve approaches its plateau more slowly near the ceiling than the first-order Vmax/Km clearance suggests.' },
    ],
    [p, preset],
  )
  const values = useMemo(() => mergeValues(specs, overrides), [specs, overrides])
  const [traceView, setTraceView] = useState<'profile' | 'capacity'>('profile')
  const [study, setStudy] = useState<Study | null>(null)

  const parameters = useMemo(() => ({ vmax: values.vmax, km: values.km, volume: values.volume }), [values])
  const rate = values.infusionRate
  const window = useMemo(() => ({ tEnd: values.tEnd, dt: preset.window.dt }), [values.tEnd, preset.window.dt])

  const run = useMemo(() => {
    try {
      const profile = saturableInfusionProfile(parameters, rate, window)
      const plateau = saturableInfusionSteadyState({ vmax: parameters.vmax, km: parameters.km }, rate)
      const last = profile[profile.length - 1]
      const rateOut = (parameters.vmax * last.concentration) / (parameters.km + last.concentration)
      return {
        profile,
        plateau,
        last,
        rateOut,
        climb: last.amount - profile[0].amount,
        offeredAtEnd: concentrationDependentClearance({ vmax: parameters.vmax, km: parameters.km }, last.concentration),
        offeredWhenLow: parameters.vmax / parameters.km,
        error: null as string | null,
      }
    } catch (error) {
      return { profile: null, error: error instanceof Error ? error.message : String(error) }
    }
  }, [parameters, rate, window])

  const runRateStudy = useCallback(() => {
    try {
      const levels = Array.from(new Set([0.4, 0.7, 0.9, 0.98, 1.02, 1.3].map((share) => Math.max(1, Math.round(parameters.vmax * share)))))
      const points: { rate: number; final: number; amount: number; plateau: number | null }[] = []
      for (const level of levels) {
        const profile = saturableInfusionProfile(parameters, level, window)
        points.push({
          rate: level,
          final: profile[profile.length - 1].concentration,
          amount: profile[profile.length - 1].amount,
          plateau: saturableInfusionSteadyState({ vmax: parameters.vmax, km: parameters.km }, level),
        })
      }
      setStudy({
        title: 'Infusion rate against a fixed capacity',
        hint: `Vmax is ${parameters.vmax} mg/h. Below it the analytic plateau Km·R/(Vmax − R) exists and the integration walks to it; at or above it the same formula divides by a non-positive number, returns nothing, and the body stores drug for as long as the pump runs. The curve that keeps climbing is the result, not a failed run.`,
        rows: points.map((point) => [
          `${point.rate} mg/h · ${fixed((point.rate / parameters.vmax) * 100, 0)}% of Vmax`,
          point.plateau === null
            ? `no plateau — the amount climbed ${fixed(point.amount, 1)} mg over the run and is still climbing`
            : `plateau ${fixed(point.plateau, 2)} mg/L · run ended at ${fixed(point.final, 2)} mg/L`,
        ]),
        chart: {
          data: points.map((point) => ({ rate: point.rate, final: point.final, analytic: point.plateau })),
          xKey: 'rate',
          xLabel: 'Infusion rate',
          xUnit: 'mg/h',
          series: [
            { key: 'final', label: 'Concentration at the end of the run', unit: 'mg/L' },
            { key: 'analytic', label: 'Analytic plateau', unit: 'mg/L', dash: '5 4' },
          ],
        },
      })
    } catch (error) {
      setStudy({ error: error instanceof Error ? error.message : String(error) })
    }
  }, [parameters, window])

  if (run.error || !run.profile) {
    return (
      <div className="space-y-4">
        <DialGrid label="A sink with a ceiling" specs={specs} values={values} onChange={setOverride} onReset={resetOverrides} />
        <BioRefusal error={run.error ?? 'The solver returned nothing.'} advice="Vmax, Km, volume and the infusion rate all have to be above zero." />
      </div>
    )
  }

  const { profile, plateau, last, rateOut, climb, offeredAtEnd, offeredWhenLow } = run
  const ceiling = Math.max(last.concentration * 1.5, parameters.km * 4)
  const capacityRows: TraceRow[] = []
  for (let step = 0; step <= 40; step += 1) {
    const concentration = (ceiling * step) / 40
    capacityRows.push({
      concentration,
      offered: concentrationDependentClearance({ vmax: parameters.vmax, km: parameters.km }, concentration),
      elimination: (parameters.vmax * concentration) / (parameters.km + concentration),
    })
  }
  const data: TraceRow[] = profile.map((sample) => ({
    x: sample.time,
    concentration: sample.concentration,
    amount: sample.amount,
    analytic: plateau === null ? null : plateau,
  }))

  return (
    <div className="space-y-4">
      <DialGrid label="A sink with a ceiling" specs={specs} values={values} onChange={setOverride} onReset={resetOverrides} />

      <KpiRow>
        <Kpi
          label="Plateau"
          value={plateau === null ? 'none' : `${fixed(plateau, 2)} mg/L`}
          detail={plateau === null ? `Infusion ${fixed(rate, 0)} mg/h is at or above Vmax ${parameters.vmax} mg/h` : `Km·R/(Vmax − R) · the run ended at ${fixed(last.concentration, 2)} mg/L`}
          tone={plateau === null ? 'warn' : 'default'}
        />
        <Kpi
          label="Amount stored over the run"
          value={`${fixed(climb, 1)} mg`}
          detail={`At the end: inflow ${fixed(rate, 1)} against outflow ${fixed(rateOut, 1)} mg/h`}
          tone={Math.abs(rate - rateOut) / rate < 0.02 ? 'good' : 'warn'}
        />
        <Kpi
          label="Clearance on offer at the end"
          value={`${fixed(offeredAtEnd, 3)} L/h`}
          detail={`Vmax/(Km + C), down from ${fixed(offeredWhenLow, 2)} L/h when the body is empty`}
        />
        <Kpi
          label="Concentration against Km"
          value={`${fixed(last.concentration / parameters.km, 2)} × Km`}
          detail={last.concentration > parameters.km ? 'Above half-saturation: the sink is running near its ceiling' : 'Below half-saturation: close to first-order behaviour'}
          tone={last.concentration > parameters.km ? 'warn' : 'default'}
        />
      </KpiRow>

      <TraceToggle
        label="Trace view"
        value={traceView}
        onChange={(id) => setTraceView(id as 'profile' | 'capacity')}
        options={[
          { id: 'profile', label: 'Against time', hint: 'Concentration and amount stored, with the analytic plateau when one exists' },
          { id: 'capacity', label: 'Capacity', hint: 'How much clearance the sink still offers as concentration rises — the reason the curve bends' },
        ]}
      />

      <BioTrace
        title={traceView === 'profile' ? 'Infusion against a saturable sink' : 'What the sink can still do'}
        hint={
          traceView === 'profile'
            ? plateau === null
              ? `No plateau is drawn because this model has none at ${fixed(rate, 0)} mg/h: elimination cannot exceed ${parameters.vmax} mg/h while the pump delivers more, so the amount climbs at about ${fixed(rate - rateOut, 1)} mg/h at the end of the run and would climb for as long as the infusion ran.`
              : `The dashed line is the analytic plateau Km·R/(Vmax − R). The curve approaches it more slowly than a first-order ramp would as the sink nears capacity, so the ${fixed(offeredWhenLow, 2)} L/h clearance offered by an empty body is down to ${fixed(offeredAtEnd, 2)} L/h here.`
            : `Clearance is not a constant in this model: it is Vmax/(Km + C), starting at Vmax/Km and falling towards zero as the concentration passes Km. The marker is where this run finished. The other curve is the elimination rate itself, which flattens at Vmax = ${parameters.vmax} mg/h — that flat top is the whole reason an infusion below it can plateau and one above it cannot.`
        }
        data={traceView === 'profile' ? data : capacityRows}
        series={
          traceView === 'profile'
            ? [
                { key: 'concentration', color: colorOf(0), label: 'Plasma', unit: 'mg/L' },
                { key: 'analytic', color: colorOf(2), label: 'Analytic plateau', unit: 'mg/L', dash: '5 4' },
                { key: 'amount', color: colorOf(1), label: 'Amount in body', unit: 'mg', axis: 'right' },
              ]
            : [
                { key: 'offered', color: colorOf(0), label: 'Clearance on offer', unit: 'L/h' },
                { key: 'elimination', color: colorOf(2), label: 'Elimination rate', unit: 'mg/h', axis: 'right' },
              ]
        }
        xLabel={traceView === 'profile' ? 'Time' : 'Concentration'}
        xFormatter={(value) => (traceView === 'profile' ? `${fixed(value, 0)} h` : `${fixed(value, 2)} mg/L`)}
        yFormatter={(value) => compact(value)}
        rightFormatter={(value) => compact(value)}
        readoutFormatter={(value) => Number(value).toPrecision(6)}
        markerX={traceView === 'capacity' ? last.concentration : null}
        height={340}
        ariaLabel={traceView === 'capacity' ? 'Clearance on offer and elimination rate against concentration' : 'Concentration and amount under a saturable infusion'}
      />

      <BioChecks
        title={plateau === null ? 'There is no steady state to reach' : 'Did it reach the plateau?'}
        hint={
          plateau === null
            ? 'The refusal to report a plateau is itself the result, and it is the reason this row exists beside the linear ones.'
            : 'Below Vmax the model has an analytic steady state, so the distance to it is a statement about the window as well as the integrator.'
        }
        checks={
          plateau === null
            ? [
                {
                  label: 'Infusion against capacity',
                  value: `${fixed(rate, 0)} of ${fixed(parameters.vmax, 0)} mg/h`,
                  passed: false,
                  note: 'At or above Vmax the sink cannot match the pump at any concentration, because elimination is bounded. The amount therefore rises monotonically for the whole run: this is not an integration failure, it is the model saying the regimen has no ceiling.',
                },
                {
                  label: 'Growth over the run',
                  value: `${fixed(climb, 1)} mg in ${fixed(window.tEnd, 0)} h`,
                  passed: false,
                  note: `At the end the body is gaining roughly ${fixed(rate - rateOut, 1)} mg an hour and will keep gaining as long as the infusion runs, because the concentration only pushes elimination closer to a ceiling it cannot pass.`,
                },
              ]
            : [
                {
                  label: 'Final concentration against the analytic plateau',
                  value: `${fixed(last.concentration, 3)} against ${fixed(plateau, 3)} mg/L`,
                  passed: relativeDistance(last.concentration, plateau) < 0.02,
                  note: 'The approach is exponential only in the linear limit. Near capacity it is slower than Vmax/Km would suggest, which is why a run can look settled at ninety percent and still be climbing.',
                },
                {
                  label: 'In and out balanced at the end',
                  value: `${fixed(rate, 1)} in · ${fixed(rateOut, 1)} out mg/h`,
                  passed: Math.abs(rate - rateOut) / rate < 0.02,
                  note: 'A steady state is defined by this equality, not by a curve that looks flat. A small imbalance over a long run is a lot of stored drug.',
                },
                {
                  label: 'Sink below half capacity',
                  value: `C = ${fixed(last.concentration / parameters.km, 2)} × Km`,
                  passed: last.concentration < parameters.km,
                  note: 'Below Km elimination is close to first order and this model barely differs from a linear one. Above it, doubling the dose more than doubles the exposure — the hazard this row exists to show.',
                },
              ]
        }
      />

      <ProtocolButton
        label="Sweep the infusion rate"
        title="Run this same sink at infusion rates spanning its capacity and report the plateau, or the absence of one, at each"
        onRun={runRateStudy}
        onClear={() => setStudy(null)}
        hasStudy={study !== null}
      />
      {study && <StudyBlock study={study} />}

      <BioNote heading="What this model is">
        <p>{preset.note}</p>
        <p>{loaded.row.description}</p>
      </BioNote>
    </div>
  )
}
