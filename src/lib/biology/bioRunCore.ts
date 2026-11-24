/**
 * The unit of work a biology view hands to a worker.
 *
 * None of these runs is a rounding error on a slider move, and the measurements
 * below are why each one is here rather than in a `useMemo` (Node, shipping
 * presets, one solve):
 *
 * - a 40-compartment strand integrates 15,360 steps of 80 states and costs 0.7 s;
 *   the 80-compartment preset costs 4.1 s and the compartments dial's 160-cell
 *   maximum 41 s;
 * - a mass-action network with its conservation laws and cycle audit costs 0.3 s
 *   at the preset and 0.9 s with every rate-constant dial at its maximum;
 * - a respirating mitochondrion costs 0.3 s, and FitzHugh–Nagumo 0.05 s at its
 *   defaults but 1.2 s at the stiffest the dials allow;
 * - the strength–duration protocol is 2.7 s and the cooperativity scan 0.7 s,
 *   because each is a sweep of full runs;
 * - the preload sweep is six beats of the whole circulation and costs 0.2 s at the
 *   preset window, 0.5 s at the longest one the dial offers.
 *
 * So the work goes off the main thread and the view says it is solving. Four runs
 * stay in-thread because they are shorter than the round trip is worth: the
 * Hodgkin–Huxley trace (26–46 ms), the gene-circuit verdict (106–234 ms), the
 * flip-flop scan (17–56 ms) and the respiratory-control ratio (0.36 s).
 *
 * This file holds the one implementation each job has, plus its types. The worker
 * entry and the in-thread fallback both call `solveBioRun`, so the answer on screen
 * is the same answer whichever path produced it — the accelerator moves the work,
 * it never changes the analysis.
 *
 * A job crosses a `postMessage` boundary, so it carries data, never a callback: the
 * constant stimulus that `simulateFitzHughNagumo` takes as a closure is a number
 * here and is rebuilt inside, and the conservation-law `value` functions are
 * evaluated inside for the same reason. Anything the view needs to draw must be
 * plain data on the way back.
 */

import {
  simulateCable,
  simulateOscillatorPopulation,
  synchronisationCurve,
  fitzhughNagumoRest,
  type CableOptions,
  type CableResult,
  type OscillatorResult,
} from './tissue'
import {
  detectSpikes,
  meanFiringRateHertz,
  simulateFitzHughNagumo,
  strengthDurationCurve,
  type DetectedSpike,
  type FitzHughNagumoParameters,
  type FitzHughNagumoSample,
  type HodgkinHuxleyInitialState,
  type HodgkinHuxleyParameters,
} from './excitability'
import {
  auditDetailedBalance,
  conservationDrift,
  conservationLaws,
  simulateReactionNetwork,
  type DetailedBalanceReport,
  type ReactionNetwork,
  type ReactionSample,
} from './kinetics'
import {
  simulateMitochondrion,
  type MitochondrionInitialState,
  type MitochondrionParameters,
  type MitochondrionResult,
} from './mitochondrion'
import { analyseCircuit, type GeneticCircuit } from './geneticCircuit'
import { pressureVolumeMetrics, simulateCirculation, type CirculationParameters } from './haemodynamics'
import type { BiologyWindow } from './modelSupport'

/** The coupling sweep's input, as `synchronisationCurve` takes it. */
export interface PopulationSweepInput {
  naturalFrequenciesHz: number[]
  couplingsHertz: number[]
  window: BiologyWindow
}

/** One mesh of a convergence study, with the speed it measured or the reason it did not. */
export interface CableMeshStudy {
  cells: number
  velocity: number | null
  error: string | null
}

/** One conserved moiety, evaluated at the two ends of the run. */
export interface ConservationLawCheck {
  coefficients: number[]
  start: number
  end: number
}

/** A kinetics run with the two structural checks that belong to it. */
export interface KineticsRun {
  samples: ReactionSample[]
  drift: number
  laws: ConservationLawCheck[]
  audit: DetailedBalanceReport
}

/** A relaxation-oscillator run with the excursions already measured off its trace. */
export interface RelaxationRun {
  samples: FitzHughNagumoSample[]
  rest: { v: number; w: number }
  spikes: DetectedSpike[]
  rateHertz: number
}

/** One cooperativity setting of the scan, with the verdict the analysis gave it. */
export interface HillScanRow {
  hill: number
  oscillates: boolean
  period: number | null
  margin: number
}

/** One filling pressure of the preload sweep, measured off its own beat. */
export interface PreloadStudyPoint {
  preload: number
  strokeVolume: number
  endDiastolicVolume: number
  work: number
  ejectionFraction: number
  forwardVolume: number
  outputMlPerMin: number
}

export type BioRunJob =
  | { kind: 'cable'; options: CableOptions; window: BiologyWindow }
  | { kind: 'cable-mesh'; options: CableOptions; meshes: number[]; window: BiologyWindow }
  | { kind: 'population'; options: { naturalFrequenciesHz: number[]; couplingHertz: number }; window: BiologyWindow }
  | { kind: 'population-sweep'; sweep: PopulationSweepInput }
  | { kind: 'kinetics'; network: ReactionNetwork; initial: number[]; window: BiologyWindow }
  | { kind: 'oxphos'; parameters: MitochondrionParameters; initial: MitochondrionInitialState; window: BiologyWindow }
  | { kind: 'fitzhugh-nagumo'; parameters: FitzHughNagumoParameters; stimulus: number; window: BiologyWindow }
  | { kind: 'strength-duration'; parameters: HodgkinHuxleyParameters; initial: HodgkinHuxleyInitialState; pulseWidthsMs: number[] }
  | { kind: 'hill-scan'; circuit: GeneticCircuit; initial: number[]; window: BiologyWindow; multipliers: number[] }
  | { kind: 'preload-sweep'; parameters: CirculationParameters; initialVolume: number; window: BiologyWindow; levels: number[] }

export type BioRunResult =
  | { kind: 'cable'; result: CableResult }
  | { kind: 'cable-mesh'; study: CableMeshStudy[] }
  | { kind: 'population'; result: OscillatorResult }
  | { kind: 'population-sweep'; curve: ReturnType<typeof synchronisationCurve> }
  | { kind: 'kinetics'; run: KineticsRun }
  | { kind: 'oxphos'; result: MitochondrionResult }
  | { kind: 'fitzhugh-nagumo'; run: RelaxationRun }
  | { kind: 'strength-duration'; curve: ReturnType<typeof strengthDurationCurve> }
  | { kind: 'hill-scan'; rows: HillScanRow[] }
  | { kind: 'preload-sweep'; points: PreloadStudyPoint[]; slopeMicrolitrePerMmHg: number | null }

/**
 * Run a job to completion. Throws what the solver throws; the caller decides
 * whether a refusal is a card on screen or a message back to the main thread.
 */
export function solveBioRun(job: BioRunJob): BioRunResult {
  switch (job.kind) {
    case 'cable':
      return { kind: 'cable', result: simulateCable(job.options, job.window) }
    case 'cable-mesh':
      return {
        kind: 'cable-mesh',
        study: job.meshes.map((cells) => {
          try {
            return { cells, velocity: simulateCable({ ...job.options, cells }, job.window).velocityMmPerMs, error: null }
          } catch (error) {
            return { cells, velocity: null, error: error instanceof Error ? error.message : String(error) }
          }
        }),
      }
    case 'population':
      return { kind: 'population', result: simulateOscillatorPopulation(job.options, job.window) }
    case 'population-sweep':
      return { kind: 'population-sweep', curve: synchronisationCurve(job.sweep) }
    case 'kinetics': {
      const samples = simulateReactionNetwork(job.network, job.initial, job.window)
      const final = samples[samples.length - 1].concentrations
      return {
        kind: 'kinetics',
        run: {
          samples,
          drift: conservationDrift(job.network, samples),
          laws: conservationLaws(job.network).map((law) => ({
            coefficients: law.coefficients,
            start: law.value(job.initial),
            end: law.value(final),
          })),
          audit: auditDetailedBalance(job.network),
        },
      }
    }
    case 'oxphos':
      return { kind: 'oxphos', result: simulateMitochondrion(job.parameters, job.initial, job.window) }
    case 'fitzhugh-nagumo': {
      const rest = fitzhughNagumoRest(job.parameters)
      const samples = simulateFitzHughNagumo(job.parameters, [rest.v, rest.w], () => job.stimulus, job.window)
      const spikes = detectSpikes(
        samples.map((sample) => ({ timeMs: sample.time, potentialMillivolts: sample.voltage })),
        { upCrossMillivolts: 0.5, downCrossMillivolts: 0 },
      )
      return { kind: 'fitzhugh-nagumo', run: { samples, rest, spikes, rateHertz: meanFiringRateHertz(spikes) } }
    }
    case 'strength-duration':
      return { kind: 'strength-duration', curve: strengthDurationCurve(job.parameters, job.initial, job.pulseWidthsMs) }
    case 'hill-scan':
      return {
        kind: 'hill-scan',
        rows: job.multipliers.map((multiplier) => {
          const verdict = analyseCircuit(
            { ...job.circuit, edges: job.circuit.edges.map((edge) => ({ ...edge, hill: edge.hill * multiplier })) },
            job.initial,
            job.window,
          )
          return {
            hill: multiplier,
            oscillates: verdict.oscillation.oscillates,
            period: verdict.oscillation.period,
            margin: verdict.stability.margin,
          }
        }),
      }
    case 'preload-sweep': {
      const points = job.levels.map((preload) => {
        const withPreload = { ...job.parameters, leftAtrialPressure: preload }
        const beat = pressureVolumeMetrics(withPreload, simulateCirculation(withPreload, job.initialVolume, job.window))
        return {
          preload,
          strokeVolume: beat.strokeVolume,
          endDiastolicVolume: beat.endDiastolicVolume,
          work: beat.strokeWork,
          ejectionFraction: beat.ejectionFraction,
          forwardVolume: beat.forwardVolume,
          outputMlPerMin: (beat.forwardVolume / withPreload.beatPeriod) * 60,
        }
      })
      const first = points[0]
      const last = points[points.length - 1]
      return {
        kind: 'preload-sweep',
        points,
        slopeMicrolitrePerMmHg:
          first && last && last.preload !== first.preload
            ? ((last.strokeVolume - first.strokeVolume) / (last.preload - first.preload)) * 1000
            : null,
      }
    }
  }
}
