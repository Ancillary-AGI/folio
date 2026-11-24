import { describe, expect, it } from 'vitest'
import { buildCircuitModel } from '../simulation/circuitModel'
import {
  prepareNoiseAnalysis,
  runNoiseAnalysis,
  solveNoiseFrequencyPoints,
  type NoiseOptions,
} from '../simulation/noise'
import type { CircuitNetlist } from '../simulation/spiceEngine'
import type { NoiseSweepBatchRequest, NoiseSweepWorkerResponse } from './noiseSweepWorker'
import { defaultNoiseWorkerCount, runNoiseSweepAsync } from './noiseSweepDispatch'
import { chunkIndices } from './chunkIndices'

const divider: CircuitNetlist = {
  title: 'noisy divider',
  components: [
    { type: 'voltage_source', name: 'V1', nodes: ['in', '0'], parameters: { value: 5 } },
    { type: 'resistor', name: 'R1', nodes: ['in', 'out'], parameters: { value: 1000 } },
    { type: 'resistor', name: 'R2', nodes: ['out', '0'], parameters: { value: 1000 } },
  ],
  analyses: [{ type: 'noise' }],
}

const built = buildCircuitModel(divider)
if (built.errors.length > 0) throw new Error(built.errors.join(' '))
const model = built.model

const options: NoiseOptions = {
  temperatureCelsius: 27,
  startFrequency: 10,
  stopFrequency: 1e6,
  pointsPerDecade: 10,
  outputNode: 'out',
}

const sequential = () => runNoiseAnalysis(model, options)

/**
 * A Worker-compatible stand-in that solves the real batch in place. It
 * exercises pool construction, chunking, response validation and ordered
 * assembly without a browser worker host.
 */
class FakeWorker {
  onmessage: ((event: MessageEvent<NoiseSweepWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  terminated = false
  readonly requests: NoiseSweepBatchRequest[] = []

  constructor(private readonly mode: 'ok' | 'error' | 'short' | 'reversed' = 'ok') {}

  postMessage(request: NoiseSweepBatchRequest): void {
    this.requests.push(request)
    const solved = solveNoiseFrequencyPoints(
      request.model,
      request.frequencies,
      request.bias,
      request.outputIndex,
      request.gmin,
    )
    const response: NoiseSweepWorkerResponse =
      this.mode === 'error'
        ? { ok: false, error: 'worker exploded' }
        : {
            ok: true,
            points:
              this.mode === 'short'
                ? solved.slice(0, 1)
                : this.mode === 'reversed'
                  ? [...solved].reverse()
                  : solved,
          }
    queueMicrotask(() => this.onmessage?.({ data: response } as MessageEvent<NoiseSweepWorkerResponse>))
  }

  terminate(): void {
    this.terminated = true
  }
}

function fakeFactory(mode: 'ok' | 'error' | 'short' | 'reversed' = 'ok') {
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

describe('noise sweep worker pool', () => {
  it('splits point indices into contiguous, complete batches', () => {
    const chunks = chunkIndices(51, 3)
    expect(chunks.map((chunk) => chunk.length)).toEqual([17, 17, 17])
    expect(chunks.flat()).toEqual(Array.from({ length: 51 }, (_, index) => index))
  })

  it('reports a worker count only once splitting is worthwhile', () => {
    expect(defaultNoiseWorkerCount(8)).toBe(0)
    const full = defaultNoiseWorkerCount(2000)
    expect(full).toBeGreaterThan(0)
    expect(full).toBeLessThanOrEqual(4)
  })

  it('keeps the worker payload structured-cloneable', () => {
    const prepared = prepareNoiseAnalysis(model, options)
    if (!prepared.ok) throw new Error(prepared.result.notes.join(' '))
    expect(() =>
      structuredClone({
        model,
        frequencies: prepared.plan.frequencies,
        bias: prepared.plan.bias,
        outputIndex: prepared.plan.outputIndex,
        gmin: options.gmin,
      }),
    ).not.toThrow()
  })

  it('produces the same spectrum as the in-thread sweep', async () => {
    const { created, createWorker } = fakeFactory()
    const pooled = await runNoiseSweepAsync(model, { ...options, createWorker })
    const direct = sequential()

    expect(pooled.accelerator).toBe('worker')
    expect(pooled.workers).toBeGreaterThan(0)
    expect(created).toHaveLength(pooled.workers)
    expect(created.every((worker) => worker.terminated)).toBe(true)
    expect(pooled.result.iterations).toBe(direct.iterations)
    expect(pooled.result.converged).toBe(direct.converged)
    expect(pooled.result.waveforms).toEqual(direct.waveforms)
    expect(pooled.result.contributions).toEqual(direct.contributions)
    expect(pooled.result.integratedThermalAndDiodeNoise).toBe(direct.integratedThermalAndDiodeNoise)
    expect(pooled.result.excludedSources).toEqual(direct.excludedSources)
    expect(pooled.result.notes.slice(0, direct.notes.length)).toEqual(direct.notes)
    expect(pooled.result.notes.join(' ')).toContain('identical')
  })

  it('solves every frequency exactly once across the pool', async () => {
    const { created, createWorker } = fakeFactory()
    await runNoiseSweepAsync(model, { ...options, createWorker })
    const assigned = created.flatMap((worker) => worker.requests.flatMap((request) => request.frequencies))
    const expected = prepareNoiseAnalysis(model, options)
    if (!expected.ok) throw new Error('the test sweep must prepare')
    expect(assigned).toEqual(expected.plan.frequencies)
    expect(created.every((worker) => worker.requests.length <= 1)).toBe(true)
  })

  it('runs in-thread when asked, with an identical spectrum', async () => {
    const outcome = await runNoiseSweepAsync(model, { ...options, prefer: 'main-thread' })
    expect(outcome.accelerator).toBe('main-thread')
    expect(outcome.workers).toBe(0)
    expect(outcome.result.waveforms).toEqual(sequential().waveforms)
    expect(outcome.result.notes).toEqual(sequential().notes)
  })

  it('falls back to the in-thread sweep when a worker reports an error', async () => {
    const { created, createWorker } = fakeFactory('error')
    const outcome = await runNoiseSweepAsync(model, { ...options, createWorker })
    const direct = sequential()

    expect(created.every((worker) => worker.terminated)).toBe(true)
    expect(outcome.accelerator).toBe('main-thread')
    expect(outcome.result.waveforms).toEqual(direct.waveforms)
    expect(outcome.result.notes).toEqual(direct.notes)
  })

  it('rejects a batch that does not cover its frequencies', async () => {
    const { createWorker } = fakeFactory('short')
    const outcome = await runNoiseSweepAsync(model, { ...options, createWorker })
    expect(outcome.accelerator).toBe('main-thread')
    expect(outcome.result.waveforms).toEqual(sequential().waveforms)
  })

  it('rejects points returned out of order', async () => {
    const { createWorker } = fakeFactory('reversed')
    const outcome = await runNoiseSweepAsync(model, { ...options, createWorker })
    expect(outcome.accelerator).toBe('main-thread')
    expect(outcome.result.waveforms).toEqual(sequential().waveforms)
  })

  it('refuses an invalid span before any worker starts', async () => {
    const { created, createWorker } = fakeFactory()
    const outcome = await runNoiseSweepAsync(model, {
      ...options,
      stopFrequency: 5,
      createWorker,
    })
    expect(created).toHaveLength(0)
    expect(outcome.accelerator).toBe('main-thread')
    expect(outcome.result.converged).toBe(false)
    expect(outcome.result.notes.join(' ')).toMatch(/start frequency < stop/)
  })
})
