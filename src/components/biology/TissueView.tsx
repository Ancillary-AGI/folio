/**
 * Tissue scale: a front that travels, and a population that agrees.
 *
 * Two families because the tissue scale asks two different questions of the same
 * machinery. The cable asks whether excitation propagates at all: a line of
 * FitzHugh–Nagumo compartments coupled by axial diffusion, where the answer is the
 * least-squares slope of the activation times the run produced, not a formula. The
 * population asks when many oscillators lock: a Kuramoto spread coupled all-to-all,
 * which collapses onto the mean field exactly, so the order parameter is a measured
 * number rather than an ansatz.
 *
 * Both are honest about their units. `v` in the cable is dimensionless —
 * FitzHugh–Nagumo has no millivolt — so a conduction velocity here is in these
 * units and cannot be read as a clinical one without a calibration this model does
 * not have.
 *
 * The mesh study and the coupling sweep are buttons, because each is a set of full
 * runs. Neither the runs you asked for nor the run the dials imply happens on the
 * main thread: at this scale a solve costs seconds, and a UI that spends them
 * thinking looks broken. Every run goes through the biology dispatch, which puts it
 * on a worker when the host has one and says so on screen when it does not.
 */
import { useMemo, useState } from 'react'
import { Button } from '../ui/button'
import { EXCITABLE_FITZHUGH_NAGUMO } from '../../lib/biology/excitability'
import {
  activationWaveSpeed,
  synchronisationCurve,
  type CableOptions,
  type CableResult,
  type OscillatorResult,
} from '../../lib/biology/tissue'
import type { BioRunJob, CableMeshStudy, PopulationSweepInput } from '../../lib/biology/bioRunCore'
import type { BiologyWindow } from '../../lib/biology/modelSupport'
import type { LoadedBioModel } from '../../lib/biology/models'
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

type TissueModel = Extract<LoadedBioModel, { family: 'cable' | 'oscillators' }>

export default function TissueView(props: BioViewControls & { loaded: TissueModel }) {
  switch (props.loaded.family) {
    case 'cable':
      return <CableTissue {...props} loaded={props.loaded} />
    case 'oscillators':
      return <PopulationTissue {...props} loaded={props.loaded} />
  }
}

/* ------------------------------------------------------------------ *
 * One-dimensional cable
 * ------------------------------------------------------------------ */

interface CableProps extends BioViewControls {
  loaded: Extract<TissueModel, { family: 'cable' }>
}

/**
 * Meshes for the convergence study.
 *
 * Doubling an 80-cell strand means 160 compartments whose internal step goes as
 * Δx², which is minutes of integration for a number the 40-cell run already
 * bounds. So the sweep is capped: a strand finer than this is only ever coarsened
 * and held, and the card says which meshes actually ran.
 */
function convergenceMeshes(cells: number): number[] {
  const half = Math.max(10, Math.round(cells / 2))
  const double = Math.round(cells * 2)
  if (cells >= 80) return [half, cells]
  return double <= 160 ? [half, cells, double] : [half, cells]
}

function CableTissue({ loaded, overrides, setOverride, resetOverrides }: CableProps) {
  const colorOf = useSeriesColors()
  const preset = loaded.preset
  const baseKinetics = preset.cable.kinetics ?? EXCITABLE_FITZHUGH_NAGUMO

  const specs = useMemo<DialSpec[]>(
    () => [
      {
        key: 'diffusivity',
        label: 'Axial coupling D',
        unit: '×',
        min: 0.1,
        max: 3,
        step: 0.05,
        default: 1,
        help: `Multiplies the strand's diffusivity (D = ${preset.cable.diffusivityMm2PerMs} mm²/ms). Front width and speed both track √D.`,
      },
      {
        key: 'epsilon',
        label: 'Kinetic timescale ε',
        unit: '',
        min: 0.01,
        max: 0.5,
        step: 0.005,
        default: baseKinetics.epsilon,
        help: 'How much slower the recovery variable is than the voltage. Speed goes as √(D·ε), so this moves the front too.',
      },
      {
        key: 'amplitude',
        label: 'Stimulus density',
        unit: '×',
        min: 0,
        max: 4,
        step: 0.1,
        default: 1,
        help: `Multiplies the injected current per unit length (now ${preset.cable.stimulusAmplitude}). Below about half this strand launches nothing.`,
      },
      {
        key: 'stimulusLength',
        label: 'Electrode length',
        unit: 'mm',
        min: 0.05,
        max: Math.min(2, preset.cable.lengthMm / 2),
        step: 0.05,
        default: preset.cable.stimulusLengthMm,
        help: 'Physical length from the near end, so refining the mesh does not change the charge delivered.',
      },
      {
        key: 'duration',
        label: 'Pulse width',
        unit: 'ms',
        min: 0.5,
        max: 10,
        step: 0.5,
        default: preset.cable.stimulusDurationMs,
      },
      {
        key: 'cells',
        label: 'Compartments',
        unit: '',
        min: 10,
        max: 160,
        step: 10,
        default: preset.cable.cells,
        help: `Mesh density over ${preset.cable.lengthMm} mm. A velocity that moves when this does is a numerical artefact, not tissue.`,
      },
    ],
    [preset, baseKinetics.epsilon],
  )
  const values = useMemo(() => {
    const merged: Record<string, number> = {}
    for (const spec of specs) merged[spec.key] = overrides[spec.key] ?? spec.default
    return merged
  }, [overrides, specs])

  const [traceView, setTraceView] = useState<'activation' | 'cells'>('activation')
  const [mesh, setMesh] = useState<CableMeshStudy[] | { error: string } | null>(null)

  const options: CableOptions = useMemo(
    () => ({
      lengthMm: preset.cable.lengthMm,
      cells: Math.round(values.cells),
      diffusivityMm2PerMs: preset.cable.diffusivityMm2PerMs * values.diffusivity,
      kinetics: { ...baseKinetics, epsilon: values.epsilon },
      stimulusAmplitude: preset.cable.stimulusAmplitude * values.amplitude,
      stimulusLengthMm: values.stimulusLength,
      stimulusDurationMs: values.duration,
      activationThreshold: preset.cable.activationThreshold,
    }),
    [baseKinetics, preset, values],
  )

  const job = useMemo<BioRunJob>(() => ({ kind: 'cable', options, window: preset.window }), [options, preset])
  const run = useBioRun(job)
  const study = useBioJob()
  const result: CableResult | null = run.result?.kind === 'cable' ? run.result.result : null

  if (!result) {
    return (
      <div className="space-y-4">
        <DialGrid label="Strand and stimulus" specs={specs} values={values} onChange={setOverride} onReset={resetOverrides} />
        {run.solving ? (
          <BioSolving label="Integrating the strand" accelerator={run.accelerator} lastDurationMs={run.durationMs || null} />
        ) : (
          <BioRefusal
            error={run.error ?? 'The cable solver returned nothing.'}
            advice="At least three compartments are needed, and ε, a and b must leave a stable resting point — a kinetics set that oscillates everywhere cannot conduct, it only beats."
          />
        )}
      </div>
    )
  }

  const dx = result.compartmentSizeMm
  const conducted = result.activations.filter((activation) => activation.cellIndex >= result.stimulatedCells)
  /*
   * Two fits over the same activations, deliberately side by side. The solver's own
   * speed uses only the compartments beyond the electrode; this one uses every cell
   * that crossed, including the ones the stimulus charged directly. The gap between
   * them is why the fit region is a decision rather than a detail.
   */
  const wholeStrandSpeed = (() => {
    try {
      return activationWaveSpeed(result.activations)
    } catch {
      return null
    }
  })()
  // Five probes spread evenly along the strand, duplicates folded away: the number
  // of compartments is small and this is five arithmetic ops, so it is not worth a
  // memo — and a hook here would sit behind the guard above and run conditionally.
  const probeCount = result.traces[0]?.voltages.length ?? 0
  const probeIndices =
    probeCount === 0
      ? []
      : [...new Set(Array.from({ length: 5 }, (_unused, i) => Math.round((i * (probeCount - 1)) / 4)))]

  const activationData: TraceRow[] = result.activations.map((activation) => ({
    x: activation.positionMm,
    time: activation.activationTimeMs,
    peak: activation.peakVoltage,
  }))
  const cellData: TraceRow[] = result.traces.map((trace) => {
    const row: TraceRow = { x: trace.timeMs }
    probeIndices.forEach((cell, slot) => {
      row[`v${slot}`] = trace.voltages[cell] ?? null
    })
    return row
  })

  return (
    <div className="space-y-4">
      <DialGrid label="Strand and stimulus" specs={specs} values={values} onChange={setOverride} onReset={resetOverrides} />

      {run.solving && (
        <BioSolving
          label="Re-solving the strand; the numbers below are the previous run"
          accelerator={run.accelerator}
          lastDurationMs={run.durationMs || null}
        />
      )}

      <KpiRow>
        <Kpi
          label="Conduction velocity"
          value={result.velocityMmPerMs === null ? 'no wave to time' : `${fixed(result.velocityMmPerMs, 4)} mm/ms`}
          detail={result.velocityMmPerMs === null ? 'fewer than three compartments beyond the electrode fired' : 'least-squares slope of the activation times beyond the stimulus'}
          tone={result.velocityMmPerMs === null ? 'warn' : 'default'}
        />
        <Kpi
          label="Compartments activated"
          value={`${result.activatedCells} of ${Math.round(values.cells)}`}
          detail={`${result.stimulatedCells} were under the electrode, ${conducted.length} conducted`}
        />
        <Kpi
          label="Front reached"
          value={result.blockedAfterMm === null ? `${fixed(preset.cable.lengthMm, 2)} mm (whole strand)` : `${fixed(result.blockedAfterMm, 3)} mm`}
          detail={result.blockedAfterMm === null ? 'the wave crossed and stopped at the sealed end' : 'the front died here'}
          tone={result.blockedAfterMm === null ? 'default' : 'warn'}
        />
        <Kpi label="Compartment size" value={`${fixed(dx, 4)} mm`} detail={`Δx²/2D is the diffusion time constant this run steps on`} />
      </KpiRow>

      <TraceToggle
        label="Trace view"
        value={traceView}
        onChange={(id) => setTraceView(id as 'activation' | 'cells')}
        options={[
          { id: 'activation', label: 'Activation map', hint: 'When and how hard each compartment fired — the data the velocity is fitted through' },
          { id: 'cells', label: 'Cell traces', hint: 'Voltage against time at five compartments spread along the strand' },
        ]}
      />

      {traceView === 'activation' ? (
        <BioTrace
          title="Activation time and spike height along the strand"
          hint="Left axis is the first upward crossing of the activation threshold; right axis is the highest voltage that compartment reaches in the whole run, read in a second pass because the peak comes after the crossing. A gap in the line is a compartment that never fired."
          data={activationData}
          series={[
            { key: 'time', color: colorOf(0), label: 'Activation time', unit: 'ms' },
            { key: 'peak', color: colorOf(1), label: 'Peak voltage', unit: 'a.u.', axis: 'right' },
          ]}
          xLabel="Position (mm)"
          xFormatter={(value) => `${value} mm`}
          yFormatter={(value) => fixed(value, 1)}
          rightFormatter={(value) => fixed(value, 2)}
          readoutFormatter={(value) => Number(value).toPrecision(6)}
          ariaLabel="Activation time and peak voltage against position along the strand"
        />
      ) : (
        <BioTrace
          title="Voltage at five compartments"
          hint="The same run viewed in time: each curve is one compartment, spread evenly from the stimulated end to the sealed far end. Voltage is dimensionless — the upstroke height is not an action-potential amplitude."
          data={cellData}
          series={probeIndices.map((cell, slot) => ({
            key: `v${slot}`,
            color: colorOf(slot),
            label: `${fixed(cell * dx, 2)} mm`,
            unit: 'a.u.',
          }))}
          xLabel="Time (ms)"
          xFormatter={(value) => `${value} ms`}
          yFormatter={(value) => fixed(value, 2)}
          readoutFormatter={(value) => Number(value).toPrecision(6)}
          ariaLabel="Voltage traces of five compartments against time"
        />
      )}

      <BioChecks
        title="Propagation checks"
        hint="Nothing here is assumed: activation is a measured upward crossing, and the velocity is a fit through the compartments the front reached."
        checks={[
          {
            label: 'A wave launched',
            value: conducted.length >= 3 ? `${conducted.length} conducted` : 'nothing beyond the electrode',
            passed: conducted.length >= 3,
            note: `The stimulus is ${fixed(preset.cable.stimulusAmplitude * values.amplitude, 2)} per unit length over ${fixed(values.stimulusLength, 2)} mm; below the launch point the axial load of the resting strand drains it and there is no front.`,
          },
          {
            label: 'Crossed the whole strand',
            value: result.blockedAfterMm === null ? 'yes' : `stopped at ${fixed(result.blockedAfterMm, 3)} mm`,
            passed: result.blockedAfterMm === null,
            note: 'Both ends are sealed, so a wave that arrives stops there instead of re-entering; re-entrant circuits cannot occur in this model.',
          },
          {
            label: 'Fit region',
            value: result.velocityMmPerMs === null || wholeStrandSpeed === null ? 'one fit only' : `${fixed(result.velocityMmPerMs, 4)} vs ${fixed(wholeStrandSpeed, 4)} mm/ms`,
            passed: result.velocityMmPerMs !== null,
            note:
              result.velocityMmPerMs === null || wholeStrandSpeed === null
                ? 'The beyond-electrode fit and the whole-strand fit need three activated compartments to compare.'
                : `The reported speed excludes the compartments under the electrode, which cross when it charges them: including them reads ${fixed(((wholeStrandSpeed - result.velocityMmPerMs) / result.velocityMmPerMs) * 100, 1)} % different.`,
          },
        ]}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={study.busy}
          onClick={() => {
            const meshes = convergenceMeshes(Math.round(values.cells))
            setMesh(null)
            study.start({ kind: 'cable-mesh', options, meshes, window: preset.window }, (outcome) => {
              if (outcome.result?.kind === 'cable-mesh') setMesh(outcome.result.study)
              else setMesh({ error: outcome.error ?? 'The mesh study stopped without an answer.' })
            })
          }}
          title={`Re-run this exact stimulus on ${convergenceMeshes(Math.round(values.cells)).join('-')} compartments and compare the measured speeds`}
        >
          Run mesh convergence
        </Button>
        {study.busy ? (
          <span className="text-sm text-muted-foreground">
            {`Integrating ${convergenceMeshes(Math.round(values.cells)).length} meshes, one worker per mesh.`}
          </span>
        ) : (
          mesh && (
            <Button type="button" size="sm" variant="ghost" onClick={() => setMesh(null)} title="Discard the study and keep this run on screen">
              Clear
            </Button>
          )
        )}
      </div>

      {mesh && 'error' in mesh ? (
        <BioRefusal error={mesh.error} advice="The coarsest mesh needs three compartments and a stable resting state to start from." />
      ) : mesh ? (
        <BioMetrics
          title="Mesh convergence"
          hint="Same length, same stimulus density, same diffusivity — only the compartment count moves. A velocity that is a property of the cable is flat across these; one that moves with Δx is a property of the mesh."
          rows={mesh.map((entry) => [
            `${entry.cells} compartments · Δx ${fixed(preset.cable.lengthMm / entry.cells, 4)} mm`,
            entry.error ?? (entry.velocity === null ? 'fewer than three cells conducted' : `${fixed(entry.velocity, 4)} mm/ms`),
          ])}
        />
      ) : null}

      <BioNote heading="What this model is">
        <p>{preset.note}</p>
        <p>
          A line, not a sheet: there is no transverse coupling, no anisotropy and no wavebreak here, so scroll waves and
          re-entry are outside what it can say. The front is a FitzHugh–Nagumo excursion, so {compact(Math.sqrt(options.diffusivityMm2PerMs * values.epsilon))} is
          the √(D·ε) scale the speed tracks — in these units, and only here.
        </p>
      </BioNote>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Coupled oscillator population
 * ------------------------------------------------------------------ */

interface PopulationProps extends BioViewControls {
  loaded: Extract<TissueModel, { family: 'oscillators' }>
}

/** 40 s at 20 ms: long enough for a population near its threshold to settle. */
const POPULATION_WINDOW: BiologyWindow = { tEnd: 40, dt: 0.02 }

function PopulationTissue({ loaded, overrides, setOverride, resetOverrides }: PopulationProps) {
  const colorOf = useSeriesColors()
  const population = loaded.population
  const specs = useMemo<DialSpec[]>(
    () => [
      {
        key: 'coupling',
        label: 'Coupling K',
        unit: 'Hz',
        min: 0,
        max: 1.2,
        step: 0.01,
        default: population.couplingHertz,
        help: 'All-to-all phase pull. Mean-field theory puts the onset of locking at K = 2γ for a Lorentzian spread of half-width γ.',
      },
      {
        key: 'spread',
        label: 'Frequency spread γ',
        unit: '×',
        min: 0.2,
        max: 3,
        step: 0.05,
        default: 1,
        help: 'Multiplies every oscillator’s detuning from the median, which is what the threshold is measured against.',
      },
      { key: 'tEnd', label: 'Run length', unit: 's', min: 10, max: 120, step: 5, default: POPULATION_WINDOW.tEnd },
    ],
    [population],
  )
  const values = useMemo(() => {
    const merged: Record<string, number> = {}
    for (const spec of specs) merged[spec.key] = overrides[spec.key] ?? spec.default
    return merged
  }, [overrides, specs])

  const [traceView, setTraceView] = useState<'order' | 'phases'>('order')
  const [curve, setCurve] = useState<ReturnType<typeof synchronisationCurve> | { error: string } | null>(null)

  const frequencies = useMemo(() => {
    const center = population.naturalFrequenciesHz.reduce((sum, f) => sum + f, 0) / population.naturalFrequenciesHz.length
    return population.naturalFrequenciesHz.map((f) => center + (f - center) * values.spread)
  }, [population, values.spread])

  const window: BiologyWindow = useMemo(() => ({ tEnd: values.tEnd, dt: POPULATION_WINDOW.dt }), [values.tEnd])

  const job = useMemo<BioRunJob>(
    () => ({ kind: 'population', options: { naturalFrequenciesHz: frequencies, couplingHertz: values.coupling }, window }),
    [frequencies, values.coupling, window],
  )
  const run = useBioRun(job)
  const study = useBioJob()
  const result: OscillatorResult | null = run.result?.kind === 'population' ? run.result.result : null

  if (!result) {
    return (
      <div className="space-y-4">
        <DialGrid label="Population and coupling" specs={specs} values={values} onChange={setOverride} onReset={resetOverrides} />
        {run.solving ? (
          <BioSolving label="Integrating the population" accelerator={run.accelerator} lastDurationMs={run.durationMs || null} />
        ) : (
          <BioRefusal
            error={run.error ?? 'The population solver returned nothing.'}
            advice="Two oscillators minimum, finite frequencies, and a coupling at or above zero."
          />
        )}
      </div>
    )
  }
  const probeSlots = (() => {
    const count = result.naturalFrequenciesHz.length
    const picks: number[] = []
    for (let i = 0; i < 6; i += 1) picks.push(Math.round((i * (count - 1)) / 5))
    return [...new Set(picks)]
  })()
  const orderData: TraceRow[] = result.samples.map((sample) => ({
    x: sample.timeSecond,
    order: sample.orderParameter,
    meanPhase: sample.meanPhaseRadians,
  }))
  const phaseData: TraceRow[] = result.samples.map((sample) => {
    const row: TraceRow = { x: sample.timeSecond }
    probeSlots.forEach((slot, index) => {
      row[`p${index}`] = sample.phasesRadians[slot] ?? null
    })
    return row
  })

  return (
    <div className="space-y-4">
      <DialGrid label="Population and coupling" specs={specs} values={values} onChange={setOverride} onReset={resetOverrides} />

      {run.solving && (
        <BioSolving
          label="Re-integrating the population; the numbers below are the previous run"
          accelerator={run.accelerator}
          lastDurationMs={run.durationMs || null}
        />
      )}

      <KpiRow>
        <Kpi
          label="Order parameter R"
          value={fixed(result.steadyStateOrder, 4)}
          detail="Mean over the last third of the run; 0 is incoherent, 1 is fully locked"
          tone={result.steadyStateOrder > 0.7 ? 'good' : result.steadyStateOrder < 0.3 ? 'warn' : 'default'}
        />
        <Kpi
          label="Coupling K"
          value={`${fixed(values.coupling, 3)} Hz`}
          detail={`predicted onset 2γ = ${fixed(result.predictedCriticalCouplingHz, 3)} Hz for the spread actually integrated`}
          tone={values.coupling > result.predictedCriticalCouplingHz ? 'good' : 'warn'}
        />
        <Kpi
          label="Oscillators unlocked"
          value={`${result.unlockedFrequenciesHz.length} of ${result.naturalFrequenciesHz.length}`}
          detail="More than a quarter-turn from the mean phase at the end"
          tone={result.unlockedFrequenciesHz.length === 0 ? 'good' : 'default'}
        />
        <Kpi label="Population" value={`${result.naturalFrequenciesHz.length} clocks`} detail={`${result.samples.length} samples over ${fixed(values.tEnd, 0)} s`} />
      </KpiRow>

      <TraceToggle
        label="Trace view"
        value={traceView}
        onChange={(id) => setTraceView(id as 'order' | 'phases')}
        options={[
          { id: 'order', label: 'Order parameter', hint: 'R against time, with the mean phase on the right axis' },
          { id: 'phases', label: 'Individual phases', hint: 'Six of the clocks, wrapped — locking shows as the curves collapsing onto one slope' },
        ]}
      />

      {traceView === 'order' ? (
        <BioTrace
          title="Synchronisation of the population"
          hint="R is |Σ e^{iθ}|/N computed at every sample, so a rise is the clocks arriving at an agreement, not a fit to one. A run that starts at equal spacing on identical frequencies sits at R = 0 until round-off breaks the symmetry — detuning is what starts the pull here."
          data={orderData}
          series={[
            { key: 'order', color: colorOf(0), label: 'R', unit: '' },
            { key: 'meanPhase', color: colorOf(3), label: 'Mean phase', unit: 'rad', axis: 'right', dash: '4 3' },
          ]}
          xLabel="Time (s)"
          xFormatter={(value) => `${value} s`}
          yFormatter={(value) => fixed(value, 3)}
          rightFormatter={(value) => fixed(value, 2)}
          readoutFormatter={(value) => Number(value).toPrecision(6)}
          yDomain={[0, 1]}
          referencesY={[{ value: result.predictedCriticalCouplingHz > values.coupling ? 0.5 : 0.5, label: 'R = 0.5' }]}
          ariaLabel="Order parameter and mean phase against time"
        />
      ) : (
        <BioTrace
          title="Phase of six oscillators"
          hint="Wrapped in radians, so a locked cell is a sawtooth running at the population's shared rate and an unlocked one is a sawtooth at its own. Frequencies are the sampled Lorentzian spread, detuned across the whole range."
          data={phaseData}
          series={probeSlots.map((slot, index) => ({
            key: `p${index}`,
            color: colorOf(index),
            label: `${fixed(result.naturalFrequenciesHz[slot], 2)} Hz`,
            unit: 'rad',
          }))}
          xLabel="Time (s)"
          xFormatter={(value) => `${value} s`}
          yFormatter={(value) => fixed(value, 2)}
          readoutFormatter={(value) => Number(value).toPrecision(6)}
          ariaLabel="Phases of six oscillators against time"
        />
      )}

      <BioChecks
        title="Locking checks"
        hint="The measured onset is not the R = 0.5 crossing: just above a mean-field threshold R grows as √(K − Kc), so any level well above zero is crossed noticeably later. The sweep below reports the crossing and this row reports the theory."
        checks={[
          {
            label: 'Coupling above the predicted onset',
            value: values.coupling > result.predictedCriticalCouplingHz ? 'yes' : 'no',
            passed: values.coupling > result.predictedCriticalCouplingHz,
            note: `K = ${fixed(values.coupling, 3)} Hz against 2γ = ${fixed(result.predictedCriticalCouplingHz, 3)} Hz, γ read off the frequencies actually integrated.`,
          },
          {
            label: 'Population locked',
            value: result.steadyStateOrder > 0.7 ? 'locked' : result.steadyStateOrder > 0.3 ? 'partially' : 'incoherent',
            passed: result.steadyStateOrder > 0.7,
            note: `R settles at ${fixed(result.steadyStateOrder, 4)} with ${result.unlockedFrequenciesHz.length} clocks more than a quarter-turn off.`,
          },
          {
            label: 'Spread is Lorentzian, quantile-sampled',
            value: `${result.naturalFrequenciesHz.length} oscillators`,
            passed: true,
            note: 'Evenly spaced quantiles rather than a random draw, so the measured and predicted thresholds differ by physics and not by sampling.',
          },
        ]}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={study.busy}
          onClick={() => {
            const edge = result.predictedCriticalCouplingHz
            const couplingsHertz: number[] = []
            const top = Math.max(1.2, edge * 3)
            for (let k = 0; k <= 12; k += 1) couplingsHertz.push(Number(((top * k) / 12).toFixed(4)))
            const sweep: PopulationSweepInput = { naturalFrequenciesHz: frequencies, couplingsHertz, window }
            setCurve(null)
            study.start({ kind: 'population-sweep', sweep }, (outcome) => {
              if (outcome.result?.kind === 'population-sweep') setCurve(outcome.result.curve)
              else setCurve({ error: outcome.error ?? 'The coupling sweep stopped without an answer.' })
            })
          }}
          title="Integrate this population at thirteen couplings from zero to above the predicted onset and plot where R leaves the uncoupled baseline"
        >
          Sweep coupling
        </Button>
        {study.busy ? (
          <span className="text-sm text-muted-foreground">Integrating thirteen couplings, one after another.</span>
        ) : (
          curve && (
            <Button type="button" size="sm" variant="ghost" onClick={() => setCurve(null)} title="Discard the sweep and keep this run on screen">
              Clear
            </Button>
          )
        )}
      </div>

      {curve && 'error' in curve ? (
        <BioRefusal error={curve.error} advice="Every point of the sweep is a full integration of the population; a refusal means one of the couplings left the solver with nothing to settle to." />
      ) : curve ? (
        <div className="space-y-4">
          <BioTrace
            title="Synchronisation curve"
            hint="Each point is a fresh integration from the same initial phases at that coupling, reported as the order parameter averaged over the last third. The vertical step is the sweep spacing, so the crossing is bracketed rather than resolved."
            data={curve.points.map((point) => ({ x: point.couplingHertz, order: point.orderParameter }))}
            series={[{ key: 'order', color: colorOf(1), label: 'R at steady state', unit: '' }]}
            xLabel="Coupling K (Hz)"
            xFormatter={(value) => `${value} Hz`}
            yFormatter={(value) => fixed(value, 3)}
            readoutFormatter={(value) => Number(value).toPrecision(6)}
            yDomain={[0, 1]}
            referencesY={[{ value: 0.5, label: 'lock level' }]}
            ariaLabel="Steady-state order parameter against coupling strength"
          />
          <BioMetrics
            title="Onset, measured and predicted"
            rows={[
              ['Predicted onset 2γ', `${compact(result.predictedCriticalCouplingHz)} Hz`],
              [
                'Coupling where R reaches 0.5',
                curve.couplingAtLockLevelHertz === null
                  ? 'never crossed in this sweep'
                  : `${compact(curve.couplingAtLockLevelHertz)} Hz`,
              ],
              ['Sweep spacing', curve.sweepSpacingHertz === null ? '—' : `${compact(curve.sweepSpacingHertz)} Hz`],
              ['Points', curve.points.map((point) => fixed(point.couplingHertz, 2)).join(', ')],
            ]}
            hint="The 0.5 crossing sits above 2γ by design. R grows as √(K − 2γ) just past the onset, so asking where it reaches half says something about the level asked, and asking where it leaves zero says something about the population."
          />
        </div>
      ) : null}

      <BioNote heading="What this model is">
        <p>{loaded.row.description}</p>
        <p>
          Phase-reduced: coupling is weak-coupling Kuramoto and each oscillator's waveform is discarded, so this describes
          locking and desync, not spike-timing precision or pacemaker suppression. All-to-all coupling collapses onto the mean
          field exactly, which is why {result.naturalFrequenciesHz.length} clocks cost the same per step as two.
        </p>
      </BioNote>
    </div>
  )
}
