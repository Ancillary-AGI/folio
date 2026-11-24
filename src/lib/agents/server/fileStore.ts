/**
 * File-backed store for the always-on runner.
 *
 * One JSON document holds every cloud job. Writes are serialised and land via
 * write-then-rename, so a process killed mid-save leaves the previous complete
 * document rather than a truncated one. This is deliberately small: the
 * repository ships a runner a single host can operate, not a distributed
 * database. A deployment that needs one can implement `CloudJobStore` over it.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  CLOUD_JOB_SCHEMA,
  isTerminalCloudJobState,
  type CloudJobEvent,
  type CloudJobRecord,
  type CloudJobState,
  type CloudJobStore,
} from './cloudRunner'

const STATES: readonly CloudJobState[] = ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'expired']

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const validState = (value: unknown): value is CloudJobState =>
  typeof value === 'string' && (STATES as readonly string[]).includes(value)

const parseEvent = (value: unknown): CloudJobEvent | undefined => {
  if (!isObject(value)) return undefined
  if (typeof value.seq !== 'number' || typeof value.at !== 'string' || typeof value.type !== 'string' || typeof value.message !== 'string') {
    return undefined
  }
  return value as unknown as CloudJobEvent
}

/**
 * Coerce one stored record. A corrupt document must not brick the runner: an
 * unreadable job is dropped, and every valid sibling still loads.
 */
export function parseStoredJob(value: unknown): CloudJobRecord | undefined {
  if (!isObject(value)) return undefined
  if (value.schema !== CLOUD_JOB_SCHEMA) return undefined
  if (typeof value.id !== 'string' || typeof value.clientJobId !== 'string' || typeof value.title !== 'string') return undefined
  if (!validState(value.state)) return undefined
  if (!isObject(value.goal) || typeof value.goal.description !== 'string') return undefined
  if (!isObject(value.design) || !Array.isArray(value.design.components) || !Array.isArray(value.design.wires)) return undefined
  if (!isObject(value.budget)) return undefined
  if (typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string') return undefined
  if (!Array.isArray(value.events)) return undefined
  const events = value.events
    .map(parseEvent)
    .filter((event): event is CloudJobEvent => event !== undefined)
  /* A stored `seq` can be lower than the highest event already in the log —
   * older files predate the counter, and a partially written record can lose
   * it. Reconciling here is what keeps `after` cursors gapless after a
   * restart; trusting the raw field re-emits sequence numbers already sent. */
  let seq = typeof value.seq === 'number' && Number.isFinite(value.seq) ? value.seq : 0
  for (const event of events) if (Number.isFinite(event.seq) && event.seq > seq) seq = event.seq
  const job: CloudJobRecord = {
    schema: CLOUD_JOB_SCHEMA,
    id: value.id,
    clientJobId: value.clientJobId,
    title: value.title,
    goal: value.goal as unknown as CloudJobRecord['goal'],
    design: value.design as unknown as CloudJobRecord['design'],
    budget: value.budget as unknown as CloudJobRecord['budget'],
    approvalMode: value.approvalMode === 'on-write' ? 'on-write' : 'auto',
    state: value.state,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    events,
    seq,
    attempts: typeof value.attempts === 'number' ? value.attempts : 0,
  }
  if (typeof value.projectId === 'string') job.projectId = value.projectId
  if (typeof value.firmware === 'string') job.firmware = value.firmware
  if (typeof value.startedAt === 'string') job.startedAt = value.startedAt
  if (typeof value.finishedAt === 'string') job.finishedAt = value.finishedAt
  if (typeof value.message === 'string') job.message = value.message
  if (typeof value.error === 'string') job.error = value.error
  if (typeof value.ownerId === 'string') job.ownerId = value.ownerId
  if (isObject(value.progress) && typeof value.progress.step === 'number') {
    job.progress = {
      step: value.progress.step,
      ...(typeof value.progress.total === 'number' ? { total: value.progress.total } : {}),
      ...(typeof value.progress.message === 'string' ? { message: value.progress.message } : {}),
    }
  }
  if (isObject(value.result) && typeof value.result.achieved === 'boolean' && typeof value.result.reason === 'string') {
    job.result = value.result as unknown as CloudJobRecord['result']
  }
  // A persisted terminal or queued job is stable; a `running` row is what the
  // runner recovers on boot, so it is left for `recover()` to decide.
  if (isTerminalCloudJobState(job.state) && !job.finishedAt) job.finishedAt = job.updatedAt
  return job
}

export class FileCloudJobStore implements CloudJobStore {
  private readonly jobs = new Map<string, CloudJobRecord>()
  private loading?: Promise<void>
  private writeChain: Promise<void> = Promise.resolve()

  constructor(readonly file: string) {}

  /**
   * Load the document once. The promise itself is the guard: setting a boolean
   * before the read resolves would let a concurrent `save()` run against an
   * empty map that the in-flight read then overwrites.
   */
  load(): Promise<void> {
    this.loading ??= this.read()
    return this.loading
  }

  private async read(): Promise<void> {
    let raw: string
    try {
      raw = await fs.readFile(this.file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      // Keep the unreadable document for forensics; start clean rather than
      // overwrite it in place with an empty queue.
      try {
        await fs.rename(this.file, `${this.file}.corrupt-${Date.now()}`)
      } catch {
        /* best effort */
      }
      return
    }
    const list = Array.isArray(parsed) ? parsed : isObject(parsed) && Array.isArray(parsed.jobs) ? parsed.jobs : []
    for (const entry of list) {
      const job = parseStoredJob(entry)
      if (job) this.jobs.set(job.id, job)
    }
  }

  get(id: string): CloudJobRecord | undefined {
    return this.jobs.get(id)
  }

  findByClientJobId(clientJobId: string, ownerId?: string): CloudJobRecord | undefined {
    for (const job of this.jobs.values()) {
      if (job.clientJobId !== clientJobId) continue
      // A token-backed job belongs to exactly one owner. Shared-key and
      // same-origin callers have no owner id and may replay any key.
      if (ownerId !== undefined && job.ownerId !== ownerId) continue
      return job
    }
    return undefined
  }

  list(): readonly CloudJobRecord[] {
    return [...this.jobs.values()]
  }

  async save(job: CloudJobRecord): Promise<void> {
    this.jobs.set(job.id, job)
    await this.persist()
  }

  async delete(id: string): Promise<void> {
    this.jobs.delete(id)
    await this.persist()
  }

  /** Only for tests and an explicit operator reset. */
  async clear(): Promise<void> {
    this.jobs.clear()
    await this.persist()
  }

  private persist(): Promise<void> {
    const snapshot = JSON.stringify({ schema: CLOUD_JOB_SCHEMA, savedAt: new Date().toISOString(), jobs: [...this.jobs.values()] })
    /* The chain stays alive after a failure (a later save must still be
     * attempted), but the caller of *this* save has to see the failure: a runner
     * that believes a terminal state is durable when the disk write threw would
     * lose the job silently. */
    const write = this.writeChain
      .catch(() => { /* a failed write must not poison the queue */ })
      .then(async () => {
        await fs.mkdir(path.dirname(this.file), { recursive: true })
        const temporary = `${this.file}.${process.pid}.tmp`
        await fs.writeFile(temporary, snapshot, 'utf8')
        await fs.rename(temporary, this.file)
      })
    this.writeChain = write.catch(() => {})
    return write
  }
}
