import { describe, expect, it } from 'vitest'
import { runBioRun } from './bioRunDispatch'
import { solveBioRun, type BioRunJob } from './bioRunCore'
import type { BioRunRequest, BioRunResponse } from './bioRunWorker'
import {
  FAST_STRAND_CABLE,
  fitzhughNagumoRest,
  lorentzianFrequencies,
  simulateCable,
  simulateOscillatorPopulation,
  synchronisationCurve,
} from './tissue'
import {
  CLASSIC_HODGKIN_HUXLEY,
  RESTING_STATE,
  detectSpikes,
  meanFiringRateHertz,
  simulateFitzHughNagumo,
  strengthDurationCurve,
} from './excitability'
import {
  auditDetailedBalance,
  conservationDrift,
  conservationLaws,
  michaelisMentenNetwork,
  simulateReactionNetwork,
} from './kinetics'
import { STATE4_MITOCHONDRION, UNCHARGED_START, simulateMitochondrion } from './mitochondrion'
import { analyseCircuit, type GeneticCircuit } from './geneticCircuit'
import { CIRCULATION_PRESETS } from './models'
import { pressureVolumeMetrics, simulateCirculation } from './haemodynamics'

/*
 * Small, cheap runs: these tests are about which thread solved the job and whether
 * the answer survived the trip, not about the biology. The biology itself is covered
 * by tissue.test.ts, which runs the same solvers directly.
 */
const STRAND_WINDOW = { tEnd: 5, dt: 0.1 }
const FREQUENCIES = lorentzianFrequencies(1, 0.1, 8)
const POPULATION_WINDOW = { tEnd: 3, dt: 0.05 }

const NETWORK = michaelisMentenNetwork({
  enzyme: 'E',
  substrate: 'S',
  complex: 'ES',
  product: 'P',
  association: 100,
  dissociation: 10,
  catalyticRate: 50,
})
const NETWORK_INITIAL = [1, 100, 0, 0]
const KINETICS_WINDOW = { tEnd: 0.02, dt: 0.005 }

const CIRCUIT: GeneticCircuit = {
  name: 'Test repressilator',
  species: [
    { id: 'A', maxProduction: 20, degradationPerTime: 1 },
    { id: 'B', maxProduction: 20, degradationPerTime: 1 },
    { id: 'C', maxProduction: 20, degradationPerTime: 1 },
  ],
  edges: [
    { from: 'A', to: 'B', kind: 'repress', threshold: 1, hill: 2 },
    { from: 'B', to: 'C', kind: 'repress', threshold: 1, hill: 2 },
    { from: 'C', to: 'A', kind: 'repress', threshold: 1, hill: 2 },
  ],
}
const CIRCUIT_INITIAL = [0.5, 0.5, 0.5]
const CIRCUIT_WINDOW = { tEnd: 30, dt: 0.5 }

const HEART = CIRCULATION_PRESETS[0]
/** Two beats of the sweep at a coarse reporting grid: enough to prove the mapping, cheap enough for a test. */
const SWEEP_WINDOW = { tEnd: 3, dt: 0.01 }
const SWEEP_LEVELS = [8, 11]

/*
 * `satisfies`, not an annotation: a `Record<string, BioRunJob>` would forget which
 * arm each fixture is on, and the checks below read the arm's own fields.
 */
const jobs = {
  cable: { kind: 'cable', options: { ...FAST_STRAND_CABLE, cells: 12, stimulusLengthMm: 0.5 }, window: STRAND_WINDOW },
  'cable-mesh': {
    kind: 'cable-mesh',
    options: { ...FAST_STRAND_CABLE, cells: 12, stimulusLengthMm: 0.5 },
    meshes: [12, 20],
    window: STRAND_WINDOW,
  },
  population: { kind: 'population', options: { naturalFrequenciesHz: FREQUENCIES, couplingHertz: 0.4 }, window: POPULATION_WINDOW },
  'population-sweep': {
    kind: 'population-sweep',
    sweep: { naturalFrequenciesHz: FREQUENCIES, couplingsHertz: [0.05, 0.4], window: POPULATION_WINDOW },
  },
  kinetics: { kind: 'kinetics', network: NETWORK, initial: NETWORK_INITIAL, window: KINETICS_WINDOW },
  oxphos: { kind: 'oxphos', parameters: STATE4_MITOCHONDRION, initial: UNCHARGED_START, window: { tEnd: 2, dt: 0.1 } },
  'fitzhugh-nagumo': {
    kind: 'fitzhugh-nagumo',
    parameters: { epsilon: 0.08, a: 0.7, b: 0.8 },
    stimulus: 0.5,
    window: { tEnd: 20, dt: 0.1 },
  },
  'strength-duration': {
    kind: 'strength-duration',
    parameters: CLASSIC_HODGKIN_HUXLEY,
    initial: RESTING_STATE,
    pulseWidthsMs: [5],
  },
  'hill-scan': { kind: 'hill-scan', circuit: CIRCUIT, initial: CIRCUIT_INITIAL, window: CIRCUIT_WINDOW, multipliers: [1, 3] },
  'preload-sweep': {
    kind: 'preload-sweep',
    parameters: HEART.parameters,
    initialVolume: HEART.initialVolume,
    window: SWEEP_WINDOW,
    levels: SWEEP_LEVELS,
  },
} satisfies Record<string, BioRunJob>

/** A Worker stand-in that runs the real analysis and answers like the bundled worker. */
class FakeBioWorker {
  /*
   * The two handlers are declared by the shape the dispatch actually reads, not by
   * DOM `MessageEvent`: the seam hands the object over as a `Worker` through one
   * cast, and a real event would demand twenty properties this test never uses.
   */
  onmessage: ((event: { data: BioRunResponse }) => void) | null = null
  onerror: ((event: { message: string }) => void) | null = null
  terminated = false
  requests: BioRunRequest[] = []

  constructor(private readonly mode: 'solve' | 'junk' | 'crash' = 'solve') {}

  postMessage(request: BioRunRequest): void {
    this.requests.push(request)
    if (this.mode === 'junk') {
      this.onmessage?.({ data: { token: request.token } as unknown as BioRunResponse })
      return
    }
    if (this.mode === 'crash') {
      this.onerror?.({ message: 'the worker script blew up' })
      return
    }
    const response: BioRunResponse = (() => {
      try {
        return { token: request.token, ok: true, result: solveBioRun(request.job) }
      } catch (error) {
        return { token: request.token, ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    })()
    this.onmessage?.({ data: response })
  }

  terminate(): void {
    this.terminated = true
  }
}

const fakeWorker = (mode?: FakeBioWorker['mode']) => {
  const box: { worker?: FakeBioWorker } = {}
  return {
    box,
    createWorker: () => {
      box.worker = new FakeBioWorker(mode)
      return box.worker as unknown as Worker
    },
  }
}

describe('biology run dispatch', () => {
  it('produces the same answer on every job kind as the solvers called directly', () => {
    expect(solveBioRun(jobs.cable)).toEqual({ kind: 'cable', result: simulateCable(jobs.cable.options, jobs.cable.window) })

    const population = solveBioRun(jobs.population)
    expect(population).toEqual({
      kind: 'population',
      result: simulateOscillatorPopulation(jobs.population.options, jobs.population.window),
    })

    const sweep = solveBioRun(jobs['population-sweep'])
    expect(sweep).toEqual({ kind: 'population-sweep', curve: synchronisationCurve(jobs['population-sweep'].sweep) })

    const mesh = solveBioRun(jobs['cable-mesh'])
    expect(mesh.kind).toBe('cable-mesh')
    if (mesh.kind !== 'cable-mesh') return
    expect(mesh.study.map((entry) => entry.cells)).toEqual([12, 20])
    expect(mesh.study.map((entry) => entry.velocity)).toEqual(
      jobs['cable-mesh'].meshes.map((cells) => simulateCable({ ...jobs['cable-mesh'].options, cells }, STRAND_WINDOW).velocityMmPerMs),
    )
  })

  it('solves the molecule, organelle and cell runs to the same numbers as the views called directly', () => {
    const samples = simulateReactionNetwork(NETWORK, NETWORK_INITIAL, KINETICS_WINDOW)
    expect(solveBioRun(jobs.kinetics)).toEqual({
      kind: 'kinetics',
      run: {
        samples,
        drift: conservationDrift(NETWORK, samples),
        /*
         * The law is a coefficient vector plus a `value` closure, and a closure
         * cannot cross `postMessage`. The job evaluates it inside, so what comes back
         * is the same two numbers the view used to read off the closure itself.
         */
        laws: conservationLaws(NETWORK).map((law) => ({
          coefficients: law.coefficients,
          start: law.value(NETWORK_INITIAL),
          end: law.value(samples[samples.length - 1].concentrations),
        })),
        audit: auditDetailedBalance(NETWORK),
      },
    })

    expect(solveBioRun(jobs.oxphos)).toEqual({
      kind: 'oxphos',
      result: simulateMitochondrion(STATE4_MITOCHONDRION, UNCHARGED_START, { tEnd: 2, dt: 0.1 }),
    })

    const relaxation = jobs['fitzhugh-nagumo']
    if (relaxation.kind !== 'fitzhugh-nagumo') throw new Error('expected a relaxation job')
    // The rest the view found itself, and the constant stimulus it passed as a
    // closure: the job carries the number and rebuilds the closure inside.
    const rest = fitzhughNagumoRest(relaxation.parameters)
    const direct = simulateFitzHughNagumo(relaxation.parameters, [rest.v, rest.w], () => relaxation.stimulus, relaxation.window)
    const spikes = detectSpikes(
      direct.map((sample) => ({ timeMs: sample.time, potentialMillivolts: sample.voltage })),
      { upCrossMillivolts: 0.5, downCrossMillivolts: 0 },
    )
    expect(solveBioRun(relaxation)).toEqual({
      kind: 'fitzhugh-nagumo',
      run: { samples: direct, rest, spikes, rateHertz: meanFiringRateHertz(spikes) },
    })

    const scan = jobs['hill-scan']
    if (scan.kind !== 'hill-scan') throw new Error('expected a scan job')
    expect(solveBioRun(scan)).toEqual({
      kind: 'hill-scan',
      rows: scan.multipliers.map((multiplier) => {
        const verdict = analyseCircuit(
          { ...scan.circuit, edges: scan.circuit.edges.map((edge) => ({ ...edge, hill: edge.hill * multiplier })) },
          scan.initial,
          scan.window,
        )
        return {
          hill: multiplier,
          oscillates: verdict.oscillation.oscillates,
          period: verdict.oscillation.period,
          margin: verdict.stability.margin,
        }
      }),
    })
  })

  it('beats the preload sweep at each filling pressure the panel asked for', () => {
    /*
     * The sweep is the organ view's button: six whole circulations, and the slope
     * read off the two ends. The view formats its own text from these numbers, so
     * what has to match is the arithmetic the direct call would have done.
     */
    const sweep = jobs['preload-sweep']
    if (sweep.kind !== 'preload-sweep') throw new Error('expected a sweep job')
    const beats = sweep.levels.map((preload) => {
      const withPreload = { ...sweep.parameters, leftAtrialPressure: preload }
      const beat = pressureVolumeMetrics(withPreload, simulateCirculation(withPreload, sweep.initialVolume, sweep.window))
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
    expect(solveBioRun(sweep)).toEqual({
      kind: 'preload-sweep',
      points: beats,
      slopeMicrolitrePerMmHg: ((beats[beats.length - 1].strokeVolume - beats[0].strokeVolume) / (beats[beats.length - 1].preload - beats[0].preload)) * 1000,
    })
    expect(beats[1].strokeVolume).not.toBe(beats[0].strokeVolume)
  })

  it('carries both a job and its answer through structured clone unchanged', () => {
    /*
     * This is the boundary a real worker puts between the view and the solver: a
     * function anywhere in either direction is a `DataCloneError` at runtime, not a
     * TypeScript error, so the only proof that matters is that the clone succeeds.
     */
    for (const job of Object.values(jobs)) {
      expect(() => structuredClone(job)).not.toThrow()
      expect(structuredClone(job)).toEqual(job)
      const answer = solveBioRun(job)
      expect(() => structuredClone(answer)).not.toThrow()
      expect(structuredClone(answer)).toEqual(answer)
    }
  })

  it('keeps the strength–duration threshold search identical through a worker', async () => {
    const protocol = jobs['strength-duration']
    if (protocol.kind !== 'strength-duration') throw new Error('expected a protocol job')
    const direct = strengthDurationCurve(protocol.parameters, protocol.initial, protocol.pulseWidthsMs)
    const worker = fakeWorker()
    const outcome = await runBioRun(protocol, worker).promise
    expect(outcome.status).toBe('done')
    expect(outcome.result).toEqual({ kind: 'strength-duration', curve: direct })
  })

  it('reports a refusal per mesh instead of losing the whole study', () => {
    const study = solveBioRun({
      kind: 'cable-mesh',
      options: { ...FAST_STRAND_CABLE, cells: 12 },
      meshes: [12, 2],
      window: STRAND_WINDOW,
    })
    if (study.kind !== 'cable-mesh') throw new Error('expected a mesh study')
    expect(study.study[0].error).toBeNull()
    expect(study.study[1].velocity).toBeNull()
    expect(study.study[1].error).toMatch(/three compartments/)
  })

  it('keeps the numbers identical through a worker and says which thread ran', async () => {
    const worker = fakeWorker()
    const outcome = await runBioRun(jobs.cable, worker).promise
    expect(outcome.status).toBe('done')
    expect(outcome.accelerator).toBe('worker')
    expect(outcome.result).toEqual(solveBioRun(jobs.cable))
    expect(worker.box.worker?.terminated).toBe(true)
  })

  it('falls back to the main thread when no worker can be built', async () => {
    const outcome = await runBioRun(jobs.cable, { createWorker: () => { throw new Error('no worker host') } }).promise
    expect(outcome.status).toBe('done')
    expect(outcome.accelerator).toBe('main-thread')
    expect(outcome.result).toEqual(solveBioRun(jobs.cable))
  })

  it('turns a solver throw into a failed outcome, on both paths', async () => {
    const refused: BioRunJob = { kind: 'population', options: { naturalFrequenciesHz: [1, 2], couplingHertz: -1 }, window: POPULATION_WINDOW }
    const worker = fakeWorker()
    const onWorker = await runBioRun(refused, worker).promise
    expect(onWorker.status).toBe('failed')
    expect(onWorker.error).toMatch(/Coupling/)

    const inThread = await runBioRun(refused, { prefer: 'main-thread' }).promise
    expect(inThread.status).toBe('failed')
    expect(inThread.error).toMatch(/Coupling/)
  })

  it('fails rather than hanging on a worker that answers junk or crashes', async () => {
    const junk = await runBioRun(jobs.cable, fakeWorker('junk')).promise
    expect(junk.status).toBe('failed')
    expect(junk.error).toMatch(/not a run/)

    const crashed = await runBioRun(jobs.cable, fakeWorker('crash')).promise
    expect(crashed.status).toBe('failed')
    expect(crashed.error).toBe('the worker script blew up')
  })

  it('cancels a run in flight and never reports an answer for it', async () => {
    const silent = {
      createWorker: () =>
        ({
          onmessage: null,
          onerror: null,
          postMessage: () => {},
          terminate: () => {},
        }) as unknown as Worker,
    }
    const handle = runBioRun(jobs.cable, silent)
    handle.cancel()
    await expect(handle.promise).resolves.toMatchObject({ status: 'cancelled', result: null })
  })

  it('reports how long the run cost, so a view can say what a dial move implies', async () => {
    const outcome = await runBioRun(jobs.population, { prefer: 'main-thread' }).promise
    expect(outcome.durationMs).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(outcome.durationMs)).toBe(true)
  })
})
