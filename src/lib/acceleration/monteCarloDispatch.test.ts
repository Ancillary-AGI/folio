import { describe, expect, it } from 'vitest'
import { buildCircuitModel } from '../simulation/circuitModel'
import { runCircuitAnalysis } from '../simulation/analysisRunner'
import { runMonteCarlo, type MonteCarloResult } from '../simulation/monteCarlo'
import type { CircuitNetlist } from '../simulation/spiceEngine'
import { executeMonteCarloBatch, type MonteCarloBatchRequest } from './monteCarloBatch'
import type { MonteCarloWorkerResponse } from './monteCarloWorker'
import {
  chunkMonteCarloRuns,
  defaultMonteCarloWorkerCount,
  runMonteCarloAsync,
} from './monteCarloDispatch'

const divider: CircuitNetlist = {
  title: 'divider',
  components: [
    { type: 'voltage_source', name: 'V1', nodes: ['in', '0'], parameters: { value: 10 } },
    { type: 'resistor', name: 'R1', nodes: ['in', 'out'], parameters: { value: 1000 } },
    { type: 'resistor', name: 'R2', nodes: ['out', '0'], parameters: { value: 1000 } },
  ],
  analyses: [{ type: 'dc' }],
}

const built = buildCircuitModel(divider)
if (built.errors.length > 0) throw new Error(built.errors.join(' '))
const model = built.model
const analysis = { type: 'dc' as const }
const run = (perturbed: typeof model) => runCircuitAnalysis(perturbed, analysis)
const options = { iterations: 40, tolerance: 0.05, seed: 7 }

const sequential = (): MonteCarloResult => runMonteCarlo(model, run, options)

/**
 * A Worker-compatible stand-in that runs the real batch executor in place.
 * It exercises pool construction, chunking, response validation and ordered
 * merging without needing a browser worker host.
 */
class FakeWorker {
  onmessage: ((event: MessageEvent<MonteCarloWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  terminated = false
  readonly requests: MonteCarloBatchRequest[] = []

  constructor(private readonly mode: 'ok' | 'error' | 'short' = 'ok') {}

  postMessage(request: MonteCarloBatchRequest): void {
    this.requests.push(request)
    const samples = executeMonteCarloBatch(request)
    const response: MonteCarloWorkerResponse =
      this.mode === 'error'
        ? { ok: false, error: 'worker exploded' }
        : { ok: true, samples: this.mode === 'short' ? samples.slice(0, 1) : samples }
    queueMicrotask(() => this.onmessage?.({ data: response } as MessageEvent<MonteCarloWorkerResponse>))
  }

  terminate(): void {
    this.terminated = true
  }
}

function fakeFactory(mode: 'ok' | 'error' | 'short' = 'ok') {
  const created: FakeWorker[] = []
  return {
    created,
    createWorker: (): Worker => {
      const worker = new FakeWorker(mode)
      created.push(worker)
      return worker as unknown as Worker
    },
  }
}

describe('Monte Carlo worker pool', () => {
  it('splits run indices into contiguous, complete batches', () => {
    const chunks = chunkMonteCarloRuns(40, 3)
    expect(chunks.map((chunk) => chunk.length)).toEqual([14, 13, 13])
    expect(chunks.flat()).toEqual(Array.from({ length: 40 }, (_, index) => index))
    expect(chunkMonteCarloRuns(2, 8)).toEqual([[0], [1]])
    expect(chunkMonteCarloRuns(5, 1)).toEqual([[0, 1, 2, 3, 4]])
  })

  it('reports a worker count only once splitting is worthwhile', () => {
    expect(defaultMonteCarloWorkerCount(8)).toBe(0)
    const full = defaultMonteCarloWorkerCount(500)
    expect(full).toBeGreaterThan(0)
    expect(full).toBeLessThanOrEqual(4)
  })

  it('keeps the worker payload structured-cloneable', () => {
    expect(() => structuredClone(model)).not.toThrow()
  })

  it('accumulates pooled samples into the same statistics as the in-thread sweep', async () => {
    const { created, createWorker } = fakeFactory()
    const pooled = await runMonteCarloAsync(model, analysis, run, { ...options, createWorker })
    const direct = sequential()

    expect(pooled.accelerator).toBe('worker')
    expect(pooled.workers).toBeGreaterThan(0)
    expect(created).toHaveLength(pooled.workers)
    expect(created.every((worker) => worker.terminated)).toBe(true)
    expect(pooled.result.iterations).toBe(direct.iterations)
    expect(pooled.result.converged).toBe(direct.converged)
    expect(pooled.result.waveforms).toEqual(direct.waveforms)
    expect(pooled.result.notes.join(' ')).toContain('identical')
  })

  it('assigns every run exactly once across the pool', async () => {
    const { created, createWorker } = fakeFactory()
    await runMonteCarloAsync(model, analysis, run, { ...options, createWorker })
    const assigned = created.flatMap((worker) =>
      worker.requests.flatMap((request) => request.runIndices),
    )
    expect(assigned.sort((a, b) => a - b)).toEqual(Array.from({ length: 40 }, (_, index) => index))
    expect(created.every((worker) => worker.requests.length <= 1)).toBe(true)
  })

  it('runs in-thread when asked, with an identical result', async () => {
    const outcome = await runMonteCarloAsync(model, analysis, run, { ...options, prefer: 'main-thread' })
    expect(outcome.accelerator).toBe('main-thread')
    expect(outcome.workers).toBe(0)
    expect(outcome.result.waveforms).toEqual(sequential().waveforms)
  })

  it('falls back to the in-thread sweep when a worker reports an error', async () => {
    const { created, createWorker } = fakeFactory('error')
    const outcome = await runMonteCarloAsync(model, analysis, run, { ...options, createWorker })
    const direct = sequential()

    expect(created.every((worker) => worker.terminated)).toBe(true)
    expect(outcome.accelerator).toBe('main-thread')
    expect(outcome.result.iterations).toBe(direct.iterations)
    expect(outcome.result.waveforms).toEqual(direct.waveforms)
  })

  it('rejects a worker response that does not cover its assigned runs', async () => {
    const { createWorker } = fakeFactory('short')
    const outcome = await runMonteCarloAsync(model, analysis, run, { ...options, createWorker })
    expect(outcome.accelerator).toBe('main-thread')
    expect(outcome.result.iterations).toBe(sequential().iterations)
  })

  it('rejects invalid options before any path runs', async () => {
    const { created, createWorker } = fakeFactory()
    const outcome = await runMonteCarloAsync(model, analysis, run, {
      ...options,
      tolerance: 1.5,
      createWorker,
    })
    expect(created).toHaveLength(0)
    expect(outcome.result.converged).toBe(false)
    expect(outcome.result.iterations).toBe(0)
    expect(outcome.result.notes.join(' ')).toMatch(/tolerance must be finite/)
  })
})
