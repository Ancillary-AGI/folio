/**
 * Molecule scale: mass-action reaction networks.
 *
 * The network is integrated, not fitted. Every rate constant on the rail is a
 * multiplier on the preset's own elementary step, so moving one changes the vector
 * field the integrator sees — and the two structural checks underneath (the
 * conserved moieties and the detailed-balance audit) are computed from the same
 * scaled network rather than from the preset it came from. A dial that breaks a
 * conservation law is caught here rather than in a paper.
 *
 * That solve costs 0.3 s at the preset and 0.9 s with the dials pushed to their
 * maxima, so it runs through the biology dispatch on a worker and the panel says so
 * while it is away — the numbers stay on screen until the new ones arrive.
 *
 * Units are µM and seconds throughout, which is what the presets are declared in.
 */
import { useMemo, useState } from 'react'
import { michaelisMentenInitialRate, type ReactionNetwork } from '../../lib/biology/kinetics'
import type { BioRunJob, KineticsRun } from '../../lib/biology/bioRunCore'
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
import { compact } from '../../lib/numberFormat'
import { useSeriesColors } from '../../lib/theme/useSeriesColors'
import type { TraceRow } from '../charts/TraceChart'

type MoleculeModel = Extract<LoadedBioModel, { family: 'kinetics' }>

/**
 * One multiplier per rate constant the network declares.
 *
 * A reaction without a reverse rate gets no reverse dial: an irreversible step has
 * no reverse constant to scale, and offering a slider for it would be an invitation
 * to turn a mechanism into something its author did not write.
 */
function dialSpecs(network: ReactionNetwork): DialSpec[] {
  const specs: DialSpec[] = []
  network.reactions.forEach((reaction, index) => {
    specs.push({
      key: `forward-${index}`,
      label: `${reaction.name ?? `Reaction ${index + 1}`} k+`,
      unit: '×',
      min: 0.1,
      max: 3,
      step: 0.05,
      default: 1,
      help: 'Multiplies the forward rate constant of this elementary step.',
    })
    if (reaction.reverseRate !== undefined) {
      specs.push({
        key: `reverse-${index}`,
        label: `${reaction.name ?? `Reaction ${index + 1}`} k−`,
        unit: '×',
        min: 0.1,
        max: 3,
        step: 0.05,
        default: 1,
        help: 'Multiplies the reverse rate constant, so the step\'s equilibrium constant moves with it.',
      })
    }
  })
  return specs
}

function scaleNetwork(network: ReactionNetwork, values: Readonly<Record<string, number>>): ReactionNetwork {
  return {
    ...network,
    species: [...network.species],
    reactions: network.reactions.map((reaction, index) => ({
      ...reaction,
      reactants: reaction.reactants.map((entry) => ({ ...entry })),
      products: reaction.products.map((entry) => ({ ...entry })),
      forwardRate: reaction.forwardRate * (values[`forward-${index}`] ?? 1),
      reverseRate:
        reaction.reverseRate === undefined
          ? undefined
          : reaction.reverseRate * (values[`reverse-${index}`] ?? 1),
    })),
  }
}

export default function MoleculeView({ loaded, overrides, setOverride, resetOverrides }: BioViewControls & { loaded: MoleculeModel }) {
  const colorOf = useSeriesColors()
  const specs = useMemo(() => dialSpecs(loaded.preset.network), [loaded])
  const values = useMemo(() => {
    const merged: Record<string, number> = {}
    for (const spec of specs) merged[spec.key] = overrides[spec.key] ?? spec.default
    return merged
  }, [overrides, specs])
  const [traceView, setTraceView] = useState<'concentrations' | 'fluxes'>('concentrations')

  const network = useMemo(() => scaleNetwork(loaded.preset.network, values), [loaded, values])

  const job = useMemo<BioRunJob>(
    () => ({ kind: 'kinetics', network, initial: [...loaded.preset.initial], window: loaded.preset.window }),
    [network, loaded],
  )
  const view = useBioRun(job)
  const run: KineticsRun | null = view.result?.kind === 'kinetics' ? view.result.run : null

  if (!run) {
    return (
      <div className="space-y-4">
        <DialGrid label="Rate constants" specs={specs} values={values} onChange={setOverride} onReset={resetOverrides} />
        {view.solving ? (
          <BioSolving label="Integrating the network" accelerator={view.accelerator} lastDurationMs={view.durationMs || null} />
        ) : (
          <BioRefusal
            error={view.error ?? 'The integrator returned no samples.'}
            advice="The network above is what the dial left behind; the integrator refused that network rather than returning a curve for it."
          />
        )}
      </div>
    )
  }

  const last = run.samples[run.samples.length - 1]
  const peakFlux = network.reactions.map((reaction, index) => ({
    name: reaction.name ?? `Reaction ${index + 1}`,
    value: Math.max(...run.samples.map((sample) => Math.abs(sample.fluxes[index]))),
  }))
  const governing = peakFlux.reduce((best, entry) => (entry.value > best.value ? entry : best), peakFlux[0])
  const dominant = network.species.reduce(
    (best, id, index) => (last.concentrations[index] > best.concentration ? { id, concentration: last.concentrations[index] } : best),
    { id: network.species[0], concentration: last.concentrations[0] },
  )

  const cycleChecks =
    run.audit.cycles.length === 0
      ? [
          {
            label: 'Independent cycles',
            value: 'none',
            passed: true,
            note: 'The stoichiometry has no closed loop, so no set of rate constants around one can fail to balance.',
          },
        ]
      : run.audit.cycles.map((cycle, index) => ({
          label: `Cycle ${index + 1} detailed balance`,
          value: cycle.balanced ? 'balanced' : cycle.fixable ? 'unbalanced' : 'irreversible loop',
          passed: cycle.balanced,
          note: cycle.note,
        }))

  const data: TraceRow[] = run.samples.map((sample) => {
    const row: TraceRow = { x: sample.time }
    network.species.forEach((_, index) => {
      row[`c${index}`] = sample.concentrations[index]
    })
    network.reactions.forEach((_, index) => {
      row[`f${index}`] = sample.fluxes[index]
    })
    return row
  })

  /*
   * The Michaelis–Menten formula is read off the *scaled* network: k₁, k₋₁ and kcat
   * are taken from the steps themselves, and the enzyme and substrate from the
   * species the binding step consumes. Move a dial and the approximation moves with
   * it, so the two columns below are always the same mechanism, one integrated and
   * one assumed.
   */
  const closedForm =
    loaded.preset.closedForm === 'michaelis-menten' && network.reactions.length >= 2
      ? (() => {
          const binding = network.reactions[0]
          const catalysis = network.reactions[1]
          const enzyme = binding.reactants[0]?.species
          const substrate = binding.reactants[1]?.species
          if (!enzyme || !substrate) return null
          const enzymeIndex = network.species.indexOf(enzyme)
          const substrateIndex = network.species.indexOf(substrate)
          if (enzymeIndex < 0 || substrateIndex < 0) return null
          const reference = michaelisMentenInitialRate({
            enzyme: loaded.preset.initial[enzymeIndex],
            substrate: loaded.preset.initial[substrateIndex],
            association: binding.forwardRate,
            dissociation: binding.reverseRate ?? 0,
            catalyticRate: catalysis.forwardRate,
          })
          return { reference, simulated: run.samples[0].fluxes[1] }
        })()
      : null

  return (
    <div className="space-y-4">
      <DialGrid label="Rate constants" specs={specs} values={values} onChange={setOverride} onReset={resetOverrides} />

      {view.solving && (
        <BioSolving
          label="Re-solving the network; the numbers below are the previous run"
          accelerator={view.accelerator}
          lastDurationMs={view.durationMs || null}
        />
      )}

      <KpiRow>
        <Kpi
          label="Samples solved"
          value={String(run.samples.length)}
          detail={`${loaded.preset.window.tEnd} s at Δt ${loaded.preset.window.dt} s`}
        />
        <Kpi
          label="Conservation drift"
          value={compact(run.drift)}
          detail={`${run.laws.length} moiety law${run.laws.length === 1 ? '' : 's'} checked over the run`}
          tone={run.drift > 1e-6 ? 'warn' : 'good'}
        />
        <Kpi label={`Largest flux: ${governing.name}`} value={`${compact(governing.value)} µM/s`} detail="Peak magnitude anywhere in the run" />
        <Kpi
          label={`Most abundant at the end: ${dominant.id}`}
          value={`${compact(dominant.concentration)} µM`}
          detail={`${network.species.length} species, ${network.reactions.length} steps`}
        />
      </KpiRow>

      <TraceToggle
        label="Trace view"
        value={traceView}
        onChange={(id) => setTraceView(id as 'concentrations' | 'fluxes')}
        options={[
          { id: 'concentrations', label: 'Concentrations', hint: 'Plot every species against time' },
          { id: 'fluxes', label: 'Fluxes', hint: 'Plot the net rate of every reaction against time' },
        ]}
      />

      <BioTrace
        title={traceView === 'concentrations' ? 'Concentrations' : 'Reaction fluxes'}
        hint={
          traceView === 'concentrations'
            ? 'Every species, every sample: these are the states the integrator produced, not a spline through a few points.'
            : 'Net flux of each elementary step — forward minus reverse — at the same instants.'
        }
        data={data}
        series={
          traceView === 'concentrations'
            ? network.species.map((id, index) => ({ key: `c${index}`, color: colorOf(index), label: id, unit: 'µM' }))
            : network.reactions.map((reaction, index) => ({
                key: `f${index}`,
                color: colorOf(index),
                label: reaction.name ?? `Reaction ${index + 1}`,
                unit: 'µM/s',
              }))
        }
        xLabel="Time (s)"
        xFormatter={(value) => `${value} s`}
        yFormatter={(value) => compact(value)}
        readoutFormatter={(value) => Number(value).toPrecision(6)}
        ariaLabel={traceView === 'concentrations' ? 'Species concentrations over the run' : 'Reaction fluxes over the run'}
      />

      <BioChecks
        title="Structural checks"
        hint="Both come from the scaled network: the conservation laws from its stoichiometry, the cycle audit from its rate constants."
        checks={[
          ...run.laws.map((law, index) => ({
            label: `Conservation law ${index + 1}`,
            value: `${compact(law.start)} → ${compact(law.end)}`,
            passed: Math.abs(law.end - law.start) <= 1e-9 * Math.max(1, Math.abs(law.start)),
            note: `Coefficients ${law.coefficients.map((coefficient) => compact(coefficient)).join(', ')}`,
          })),
          ...cycleChecks,
        ]}
      />

      {closedForm && (
        <BioMetrics
          title="Integrated mechanism against the closed form"
          hint="The formula assumes the complex reaches steady state and that free enzyme is not rate-limiting. The run assumes neither, so the gap between the two columns is the size of those assumptions."
          rows={[
            ['Km', `${compact(closedForm.reference.km)} µM`],
            ['Vmax', `${compact(closedForm.reference.vmax)} µM/s`],
            ['Formula initial rate', `${compact(closedForm.reference.initialRate)} µM/s`],
            ['Simulated initial rate', `${compact(closedForm.simulated)} µM/s`],
            ['Simulated / formula', compact(closedForm.simulated / closedForm.reference.initialRate)],
          ]}
        />
      )}

      <BioNote heading="What this model is">
        <p>{loaded.preset.note}</p>
        <p className="text-foreground">Check against: {loaded.preset.check}</p>
        <p>
          Final amounts: {network.species.map((id, index) => `${id} ${compact(last.concentrations[index])} µM`).join(' · ')}
        </p>
      </BioNote>
    </div>
  )
}
