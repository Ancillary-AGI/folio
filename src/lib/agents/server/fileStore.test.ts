import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CLOUD_JOB_SCHEMA, type CloudJobRecord } from './cloudRunner'
import { FileCloudJobStore, parseStoredJob } from './fileStore'

let directory: string
let file: string

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(tmpdir(), 'folio-agent-store-'))
  file = path.join(directory, 'jobs.json')
})

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})

const job = (id: string, overrides: Partial<CloudJobRecord> = {}): CloudJobRecord => ({
  schema: CLOUD_JOB_SCHEMA,
  id,
  clientJobId: `client-${id}`,
  title: `Job ${id}`,
  goal: {
    description: 'Minimise ripple',
    analysis: { type: 'transient', stopTime: 4e-3, stepTime: 1e-5 },
    metric: { waveform: 'V(OUT)', statistic: 'ripple', settled: true },
    direction: 'minimize',
  },
  design: { components: [], wires: [], firmware: '' },
  budget: { maxCalls: 10, maxWallMs: 10_000 },
  approvalMode: 'auto',
  state: 'queued',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  events: [],
  seq: 0,
  attempts: 0,
  ...overrides,
})

describe('FileCloudJobStore', () => {
  it('round-trips jobs, events and owner scoping through a real file', async () => {
    const first = job('a', {
      state: 'succeeded',
      ownerId: 'owner-1',
      result: { achieved: true, reason: 'Goal met.', bestIteration: 3, bestMetric: 0.01 },
      events: [{ seq: 1, at: '2026-01-01T00:00:01.000Z', type: 'result', message: 'Goal met.' }],
      seq: 1,
    })
    const second = job('b')
    const store = new FileCloudJobStore(file)
    await store.load()
    await store.save(first)
    await store.save(second)

    const reloaded = new FileCloudJobStore(file)
    await reloaded.load()
    expect(reloaded.list()).toHaveLength(2)
    expect(reloaded.get('a')).toMatchObject({
      state: 'succeeded',
      ownerId: 'owner-1',
      result: { achieved: true, bestMetric: 0.01 },
      seq: 1,
    })
    expect(reloaded.get('a')?.events).toHaveLength(1)
    expect(reloaded.findByClientJobId('client-b')?.id).toBe('b')
  })

  it('scopes an idempotency lookup by owner', async () => {
    const store = new FileCloudJobStore(file)
    await store.load()
    await store.save(job('owned', { ownerId: 'owner-a' }))
    const reloaded = new FileCloudJobStore(file)
    await reloaded.load()
    expect(reloaded.findByClientJobId('client-owned', 'owner-a')?.id).toBe('owned')
    expect(reloaded.findByClientJobId('client-owned', 'owner-b')).toBeUndefined()
    expect(reloaded.findByClientJobId('client-owned')?.id).toBe('owned')
  })

  it('deletes a job durably', async () => {
    const store = new FileCloudJobStore(file)
    await store.load()
    await store.save(job('a'))
    await store.delete('a')
    const reloaded = new FileCloudJobStore(file)
    await reloaded.load()
    expect(reloaded.list()).toEqual([])
  })

  it('starts clean but preserves an unreadable document for forensics', async () => {
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(file, '{ this is not json', 'utf8')
    const store = new FileCloudJobStore(file)
    await expect(store.load()).resolves.toBeUndefined()
    expect(store.list()).toEqual([])
    const entries = await fs.readdir(directory)
    expect(entries.some((entry) => entry.startsWith('jobs.json.corrupt-'))).toBe(true)
  })

  it('drops one corrupt job without losing valid siblings', async () => {
    const document = {
      schema: CLOUD_JOB_SCHEMA,
      savedAt: '2026-01-01T00:00:00.000Z',
      jobs: [job('good'), { schema: CLOUD_JOB_SCHEMA, id: 7 }, null],
    }
    await fs.writeFile(file, JSON.stringify(document), 'utf8')
    const store = new FileCloudJobStore(file)
    await store.load()
    expect(store.list().map((entry) => entry.id)).toEqual(['good'])
  })

  it('tolerates a missing file as an empty queue', async () => {
    const store = new FileCloudJobStore(path.join(directory, 'nested', 'jobs.json'))
    await store.load()
    expect(store.list()).toEqual([])
  })
})

describe('parseStoredJob', () => {
  it('refuses a record that is not a cloud job', () => {
    expect(parseStoredJob(null)).toBeUndefined()
    expect(parseStoredJob({})).toBeUndefined()
    expect(parseStoredJob({ ...job('x'), schema: 'something-else' })).toBeUndefined()
    expect(parseStoredJob({ ...job('x'), state: 'exploded' })).toBeUndefined()
  })

  it('defaults optional fields and stamps a missing finish time on terminal jobs', () => {
    const parsed = parseStoredJob({
      ...job('x'),
      state: 'succeeded',
      finishedAt: undefined,
      updatedAt: '2026-02-02T00:00:00.000Z',
      attempts: undefined,
      seq: undefined,
    })
    expect(parsed?.finishedAt).toBe('2026-02-02T00:00:00.000Z')
    expect(parsed?.attempts).toBe(0)
    expect(parsed?.seq).toBe(0)
  })

  it('reconciles seq with the highest stored event so cursors stay gapless', () => {
    /* A record whose counter is behind its own log (older files, or a partially
     * written one) used to resume emitting sequence numbers it had already
     * sent, so `events(after=N)` repeated or skipped. */
    const parsed = parseStoredJob({
      ...job('x'),
      seq: 1,
      events: [
        { seq: 4, at: '2026-01-01T00:00:04.000Z', type: 'log', message: 'four' },
        { seq: 9, at: '2026-01-01T00:00:09.000Z', type: 'log', message: 'nine' },
      ],
    })
    expect(parsed?.seq).toBe(9)
  })

  it('propagates a failed write instead of reporting the save as durable', async () => {
    /* `persist()` used to attach `.catch(() => {})` and return that swallowed
     * chain, so `save()` resolved successfully even when the rename threw and
     * the runner believed a terminal state was on disk. */
    const store = new FileCloudJobStore(path.join(directory, 'missing', 'deeper', 'jobs.json'))
    await expect(store.load()).resolves.toBeUndefined()
    // The path is a file, so mkdir cannot create it: the write must reject.
    await fs.writeFile(path.join(directory, 'blocker'), 'not a directory')
    const blocked = new FileCloudJobStore(path.join(directory, 'blocker', 'jobs.json'))
    await expect(blocked.save(job('blocked'))).rejects.toThrow()
  })
})
