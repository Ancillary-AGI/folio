/**
 * Organelle scale: a respirating mitochondrion.
 *
 * The state is a charged membrane and an adenylate pool, and the run is the
 * balance between three proton fluxes — transport pushing out, synthase and leak
 * bringing protons back. The dials are the four levers an experiment actually has:
 * oxygen, the ATPase load, an uncoupler and an inhibitor, applied to the preset's
 * own parameter set by `withPerturbation` and `withLoad`, which are multipliers
 * rather than absolute values so one dial cannot silently move another parameter.
 *
 * nmol/(s·mg) is per milligram of protein, the way these rates are measured; mM is
 * the matrix lump. The metrics are averaged over the last quarter of the run and
 * the panel reports whether that window had actually settled.
 *
 * Charging that membrane costs 0.3 s of integration per dial move, so the solve
 * goes through the biology dispatch rather than the render path: the worker does the
 * arithmetic and the previous run stays on screen until the new one answers. The
 * respiratory-control button is a pair of runs and stays synchronous — measured at
 * 0.36 s, it is not yet worth a job of its own.
 */
import { useMemo, useState } from 'react'
import { Button } from '../ui/button'
import {
  STATE4_MITOCHONDRION,
  atpGibbsEnergyJoulesPerMol,
  equilibriumForceMillivolts,
  respiratoryControlRatio,
  synthesisThresholdMillivolts,
  withLoad,
  withPerturbation,
} from '../../lib/biology/mitochondrion'
import type { MitochondrionResult } from '../../lib/biology/mitochondrion'
import type { BioRunJob } from '../../lib/biology/bioRunCore'
import type { LoadedBioModel } from '../../lib/biology/models'
import { useBioRun } from './useBioRun'
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

type OrganelleModel = Extract<LoadedBioModel, { family: 'oxphos' }>

function dialSpecs(loaded: OrganelleModel): DialSpec[] {
  const parameters = loaded.preset.parameters
  const initial = loaded.preset.initial
  return [
    {
      key: 'oxygen',
      label: 'Oxygen',
      unit: 'µM',
      min: 0,
      max: Math.max(60, Math.ceil(parameters.oxygenMicromolar * 2)),
      step: 0.5,
      default: parameters.oxygenMicromolar,
      help: `Substrate available to the chain, against a Km of ${parameters.oxygenKmMicromolar} µM.`,
    },
    {
      key: 'demand',
      label: 'ATP demand',
      unit: 'nmol/(s·mg)',
      min: 0,
      max: Math.max(4, parameters.atpDemandNanoMolPerSecondPerMilligram * 3),
      step: 0.05,
      default: parameters.atpDemandNanoMolPerSecondPerMilligram,
      help: 'The ATPase on the pool. Zero is state 4; a load on it is state 3.',
    },
    {
      key: 'leak',
      label: 'Proton leak',
      unit: '×',
      min: 0,
      max: 50,
      step: 0.5,
      default: 1,
      help: 'Multiplies the leak conductance — an uncoupler like FCCP, with the chain unchanged.',
    },
    {
      key: 'transport',
      label: 'Transport capacity',
      unit: '×',
      min: 0,
      max: 2,
      step: 0.05,
      default: 1,
      help: 'Multiplies the maximum electron-transport flux — an inhibitor of the chain itself.',
    },
    {
      key: 'startForce',
      label: 'Force at t = 0',
      unit: 'mV',
      min: 0,
      max: 250,
      step: 1,
      default: initial.protonMotiveForceMillivolts,
      help: 'Where the membrane starts. Zero is an uncharged mitochondrion at the moment it is dropped in.',
    },
    {
      key: 'startAdp',
      label: 'ADP at t = 0',
      unit: 'mM',
      min: 0,
      max: parameters.adenylatePoolMillimolar,
      step: 0.01,
      default: initial.adpMillimolar,
      help: `Of a ${parameters.adenylatePoolMillimolar} mM adenylate pool, conserved: ATP is whatever is left.`,
    },
  ]
}

export default function OrganelleView({ loaded, overrides, setOverride, resetOverrides }: BioViewControls & { loaded: OrganelleModel }) {
  const colorOf = useSeriesColors()
  const specs = useMemo(() => dialSpecs(loaded), [loaded])
  const values = useMemo(() => {
    const merged: Record<string, number> = {}
    for (const spec of specs) merged[spec.key] = overrides[spec.key] ?? spec.default
    return merged
  }, [overrides, specs])

  const [traceView, setTraceView] = useState<'force' | 'fluxes'>('force')
  const [control, setControl] = useState<{ ratio: number; state4: number; state3: number } | { error: string } | null>(null)

  const parameters = useMemo(
    () =>
      withLoad(
        withPerturbation(loaded.preset.parameters, {
          oxygenMicromolar: values.oxygen,
          leakMultiplier: values.leak,
          transportMultiplier: values.transport,
        }),
        values.demand,
      ),
    [loaded, values],
  )
  const initial = useMemo(
    () => ({ protonMotiveForceMillivolts: values.startForce, adpMillimolar: values.startAdp }),
    [values],
  )

  const job = useMemo<BioRunJob>(
    () => ({ kind: 'oxphos', parameters, initial, window: loaded.preset.window }),
    [parameters, initial, loaded],
  )
  const view = useBioRun(job)
  const result: MitochondrionResult | null = view.result?.kind === 'oxphos' ? view.result.result : null

  if (!result) {
    return (
      <div className="space-y-4">
        <DialGrid label="Matrix and load" specs={specs} values={values} onChange={setOverride} onReset={resetOverrides} />
        {view.solving ? (
          <BioSolving label="Charging the membrane" accelerator={view.accelerator} lastDurationMs={view.durationMs || null} />
        ) : (
          <BioRefusal
            error={view.error ?? 'The solver returned nothing.'}
            advice="ADP must fit inside the adenylate pool, oxygen cannot be negative, and the membrane has to start somewhere the model can integrate from."
          />
        )}
      </div>
    )
  }

  const { samples, metrics } = result
  const last = samples[samples.length - 1]
  const data: TraceRow[] = samples.map((sample) => ({
    x: sample.timeSecond,
    force: sample.protonMotiveForceMillivolts,
    membrane: sample.membranePotentialMillivolts,
    ph: sample.phGradient,
    adp: sample.adpMillimolar,
    atp: sample.atpMillimolar,
    transport: sample.transportFlux,
    synthase: sample.synthaseFlux,
    leak: sample.leakFlux,
    oxygen: sample.oxygenConsumption,
  }))

  return (
    <div className="space-y-4">
      <DialGrid label="Matrix and load" specs={specs} values={values} onChange={setOverride} onReset={resetOverrides} />

      {view.solving && (
        <BioSolving
          label="Re-solving the organelle; the numbers below are the previous run"
          accelerator={view.accelerator}
          lastDurationMs={view.durationMs || null}
        />
      )}

      <KpiRow>
        <Kpi
          label="Steady proton-motive force"
          value={`${fixed(metrics.steadyForceMillivolts, 1)} mV`}
          detail={`Ceiling ${fixed(metrics.equilibriumForceMillivolts, 1)} mV · ATP costs ${fixed(metrics.atpThresholdMillivolts, 1)} mV`}
          tone={metrics.settled ? 'default' : 'warn'}
        />
        <Kpi
          label="Oxygen uptake"
          value={`${compact(metrics.steadyOxygenConsumption)} nmol/(s·mg)`}
          detail={`ATP output ${compact(metrics.steadyATPProduction)} nmol/(s·mg)`}
        />
        <Kpi
          label="Coupling efficiency"
          value={`${fixed(metrics.couplingEfficiency * 100, 1)}%`}
          detail="Share of pumped protons returning through synthase rather than leak"
          tone={metrics.couplingEfficiency < 0.1 ? 'warn' : 'default'}
        />
        <Kpi
          label="Force range over the run"
          value={`${fixed(metrics.forceRange.min, 0)} → ${fixed(metrics.forceRange.max, 0)} mV`}
          detail={metrics.settled ? 'Last quarter settled' : 'Last quarter still moving — read the curve, not the number'}
          tone={metrics.settled ? 'good' : 'warn'}
        />
      </KpiRow>

      <TraceToggle
        label="Trace view"
        value={traceView}
        onChange={(id) => setTraceView(id as 'force' | 'fluxes')}
        options={[
          { id: 'force', label: 'Force & pool', hint: 'Proton-motive force against the adenylate pool it drives' },
          { id: 'fluxes', label: 'Proton fluxes', hint: 'Transport out, synthase and leak back — the three-term balance' },
        ]}
      />

      <BioTrace
        title={traceView === 'force' ? 'Proton-motive force and adenylate pool' : 'Proton fluxes'}
        hint={
          traceView === 'force'
            ? 'The force is the left axis in millivolts; ADP and ATP are the right axis in mM of the lump. A force that falls below the ATP threshold stops synthesis, and the pool pays instead.'
            : 'Transport pushes protons out; synthase and leak let them back. At steady state the three balance — which is why the oxygen curve flattens where the force does.'
        }
        data={data}
        series={
          traceView === 'force'
            ? [
                { key: 'force', color: colorOf(0), label: 'PMF', unit: 'mV' },
                { key: 'membrane', color: colorOf(1), label: 'ΔΨ', unit: 'mV', dash: '4 3' },
                { key: 'adp', color: colorOf(2), label: 'ADP', unit: 'mM', axis: 'right' },
                { key: 'atp', color: colorOf(3), label: 'ATP', unit: 'mM', axis: 'right' },
              ]
            : [
                { key: 'transport', color: colorOf(0), label: 'Transport', unit: 'nmol/(s·mg)' },
                { key: 'synthase', color: colorOf(1), label: 'Synthase', unit: 'nmol H⁺/(s·mg)' },
                { key: 'leak', color: colorOf(2), label: 'Leak', unit: 'nmol H⁺/(s·mg)' },
                { key: 'oxygen', color: colorOf(3), label: 'O₂', unit: 'nmol/(s·mg)', dash: '4 3' },
              ]
        }
        xLabel="Time (s)"
        xFormatter={(value) => `${value} s`}
        yFormatter={(value) => compact(value)}
        rightFormatter={(value) => compact(value)}
        readoutFormatter={(value) => Number(value).toPrecision(6)}
        ariaLabel={traceView === 'force' ? 'Proton-motive force and adenylate pool over the run' : 'Proton fluxes over the run'}
      />

      <BioMetrics
        title="Thermodynamics at the reported point"
        hint="The threshold and the free energy are evaluated at the run's final adenylate masses, so they move with the pool rather than being quoted from a textbook table."
        rows={[
          ['Redox ceiling', `${fixed(equilibriumForceMillivolts(parameters), 1)} mV`],
          ['ATP synthesis threshold', `${fixed(synthesisThresholdMillivolts(parameters, last.adpMillimolar), 1)} mV`],
          ['ΔG of ATP synthesis', `${compact(atpGibbsEnergyJoulesPerMol(parameters, last.adpMillimolar))} J/mol`],
          ['Protons per ATP', String(parameters.protonsPerATP)],
          ['Membrane share of the force', `${fixed(parameters.membranePotentialFraction * 100, 0)}%`],
          ['ATP remaining', `${fixed(last.atpMillimolar, 3)} of ${parameters.adenylatePoolMillimolar} mM`],
        ]}
      />

      <BioChecks
        title="Respiratory control"
        hint="Measured, not set: the ratio is the stimulated oxygen uptake divided by the resting one, both from their own runs of the same 100 s window against the state-4 parameter set."
        checks={[
          ...(control && 'error' in control
            ? [{ label: 'State 4 / state 3 pair', value: 'refused', passed: false, note: control.error }]
            : control
              ? [
                  {
                    label: 'Control ratio',
                    value: `${fixed(control.ratio, 2)}`,
                    passed: control.ratio > 1.2,
                    note: `State 4 ${compact(control.state4)} → state 3 ${compact(control.state3)} nmol O₂/(s·mg). Below about 1.2 the ADP you asked for is not buying extra oxygen: the chain is already running as fast as the load can drive it, or the leak is taking the proton current the synthase would have.`,
                  },
                ]
            : []),
          {
            label: 'Settled by the end of the window',
            value: metrics.settled ? 'yes' : 'no',
            passed: metrics.settled,
            note: metrics.settled
              ? 'The last quarter of the run matches the quarter before it, so the averaged metrics describe a steady state.'
              : 'The last quarter is still moving relative to the one before it: the metrics are an average of a trajectory, not a steady state.',
          },
        ]}
      />

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            try {
              const measured = respiratoryControlRatio(
                STATE4_MITOCHONDRION,
                withLoad(STATE4_MITOCHONDRION, values.demand),
                initial,
                loaded.preset.window,
              )
              setControl({ ratio: measured.controlRatio, state4: measured.state4Oxygen, state3: measured.state3Oxygen })
            } catch (error) {
              setControl({ error: error instanceof Error ? error.message : String(error) })
            }
          }}
          title="Run the organelle with no ATP demand and then with the demand you set, and measure the ratio of the two oxygen uptake rates"
        >
          Measure respiratory control ratio
        </Button>
        {control && (
          <Button type="button" size="sm" variant="ghost" onClick={() => setControl(null)} title="Discard the measured pair and leave this run on screen">
            Clear
          </Button>
        )}
      </div>

      <BioNote heading="What this model is">
        <p>{loaded.preset.note}</p>
        <p>
          The oxygen, demand, leak and transport dials are applied to this preset on top of whatever the preset already
          perturbs, so the uncoupled and hypoxic rows start from their own multipliers rather than from the resting lump.
        </p>
      </BioNote>
    </div>
  )
}
