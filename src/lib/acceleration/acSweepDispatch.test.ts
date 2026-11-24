import { describe, expect, it } from 'vitest'
import { buildCircuitModel } from '../simulation/circuitModel'
import { prepareAcSweep, runAcSweep, solveAcFrequencyPoints, type AcSweepOptions } from '../simulation/solver'
import type { CircuitNetlist } from '../simulation/spiceEngine'
import type { AcSweepBatchRequest, AcSweepWorkerResponse } from './acSweepWorker'
import { defaultAcSweepWorkerCount, runAcSweepAsync } from './acSweepDispatch'
import { chunkIndices } from './chunkIndices'

const lowPass: CircuitNetlist = {
  title: 'rc low-pass',
  components: [
    { type: 'voltage_source', name: 'V1', nodes: ['in', '0'], parameters: { value: 1 } },
    { type: 'resistor', name: 'R1', nodes: ['in', 'out'], parameters: { value: 1000 } },
    { type: 'capacitor', name: 'C1', nodes: ['out', '0'], parameters: { value: 1e-6 } },
  ],
  analyses: [{ type: 'ac' }],
}

const built = buildCircuitModel(lowPass)
if (built.errors.length > 0) throw new Error(built.errors.join(' '))
const model = built.model

const options: AcSweepOptions = {
  temperatureCelsius: 27,
  startFrequency: 10,
  stopFrequency: 1e6,
  pointsPerDecade: 20,
}

const sequential = () => runAcSweep(model, options)

/**
 * A Worker-compatible stand-in that solves the real batch in place. It
 * exercises pool construction, chunking, response validation and ordered
 * assembly without a browser worker host.
 */
class FakeWorker {
  onmessage: ((event: MessageEvent<AcSweepWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  terminated = false
  readonly requests: AcSweepBatchRequest[] = []

  constructor(private readonly mode: 'ok' | 'error' | 'short' | 'reversed' = 'ok') {}

  postMessage(request: AcSweepBatchRequest): void {
    this.requests.push(request)
    const solved = solveAcFrequencyPoints(request.model, request.frequencies, request.bias, request.gmin)
    const response: AcSweepWorkerResponse =
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
    queueMicrotask(() => this.onmessage?.({ data: response } as MessageEvent<AcSweepWorkerResponse>))
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

describe('AC sweep worker pool', () => {
  it('splits point indices into contiguous, complete batches', () => {
    const chunks = chunkIndices(101, 3)
    expect(chunks.map((chunk) => chunk.length)).toEqual([34, 34, 33])
    expect(chunks.flat()).toEqual(Array.from({ length: 101 }, (_, index) => index))
    expect(chunkIndices(2, 8)).toEqual([[0], [1]])
  })

  it('reports a worker count only once splitting is worthwhile', () => {
    expect(defaultAcSweepWorkerCount(8)).toBe(0)
    const full = defaultAcSweepWorkerCount(2000)
    expect(full).toBeGreaterThan(0)
    expect(full).toBeLessThanOrEqual(4)
  })

  it('keeps the worker payload structured-cloneable', () => {
    const prepared = prepareAcSweep(model, options)
    if (!prepared.ok) throw new Error(prepared.outcome.notes.join(' '))
    expect(() =>
      structuredClone({
        model,
        frequencies: prepared.frequencies,
        bias: prepared.bias,
        gmin: options.gmin,
      }),
    ).not.toThrow()
  })

  it('produces the same response as the in-thread sweep', async () => {
    const { created, createWorker } = fakeFactory()
    const pooled = await runAcSweepAsync(model, { ...options, createWorker })
    const direct = sequential()

    expect(pooled.accelerator).toBe('worker')
    expect(pooled.workers).toBeGreaterThan(0)
    expect(created).toHaveLength(pooled.workers)
    expect(created.every((worker) => worker.terminated)).toBe(true)
    expect(pooled.result.iterations).toBe(direct.iterations)
    expect(pooled.result.converged).toBe(direct.converged)
    expect(pooled.result.waveforms).toEqual(direct.waveforms)
    expect(pooled.result.notes.slice(0, direct.notes.length)).toEqual(direct.notes)
    expect(pooled.result.notes.join(' ')).toContain('identical')
  })

  it('solves every frequency exactly once across the pool', async () => {
    const { created, createWorker } = fakeFactory()
    await runAcSweepAsync(model, { ...options, createWorker })
    const assigned = created.flatMap((worker) => worker.requests.flatMap((request) => request.frequencies))
    const expected = prepareAcSweep(model, options)
    if (!expected.ok) throw new Error('the test sweep must prepare')
    expect(assigned).toEqual(expected.frequencies)
    expect(created.every((worker) => worker.requests.length <= 1)).toBe(true)
  })

  it('runs in-thread when asked, with an identical response', async () => {
    const outcome = await runAcSweepAsync(model, { ...options, prefer: 'main-thread' })
    expect(outcome.accelerator).toBe('main-thread')
    expect(outcome.workers).toBe(0)
    expect(outcome.result.waveforms).toEqual(sequential().waveforms)
    expect(outcome.result.notes).toEqual(sequential().notes)
  })

  it('falls back to the in-thread sweep when a worker reports an error', async () => {
    const { created, createWorker } = fakeFactory('error')
    const outcome = await runAcSweepAsync(model, { ...options, createWorker })
    const direct = sequential()

    expect(created.every((worker) => worker.terminated)).toBe(true)
    expect(outcome.accelerator).toBe('main-thread')
    expect(outcome.result.waveforms).toEqual(direct.waveforms)
    expect(outcome.result.notes).toEqual(direct.notes)
  })

  it('rejects a batch that does not cover its frequencies', async () => {
    const { createWorker } = fakeFactory('short')
    const outcome = await runAcSweepAsync(model, { ...options, createWorker })
    expect(outcome.accelerator).toBe('main-thread')
    expect(outcome.result.waveforms).toEqual(sequential().waveforms)
  })

  it('rejects points returned out of order', async () => {
    const { createWorker } = fakeFactory('reversed')
    const outcome = await runAcSweepAsync(model, { ...options, createWorker })
    expect(outcome.accelerator).toBe('main-thread')
    expect(outcome.result.waveforms).toEqual(sequential().waveforms)
  })

  it('refuses an invalid span before any worker starts', async () => {
    const { created, createWorker } = fakeFactory()
    const outcome = await runAcSweepAsync(model, {
      ...options,
      stopFrequency: 1,
      createWorker,
    })
    expect(created).toHaveLength(0)
    expect(outcome.accelerator).toBe('main-thread')
    expect(outcome.result.converged).toBe(false)
    expect(outcome.result.notes.join(' ')).toMatch(/stop frequency at least as large/)
  })
})
