/**
 * One runner per server process.
 *
 * Next.js can evaluate a route module more than once (dev fast refresh,
 * multiple route entry points). The queue must not fork with it, so the runner
 * lives on `globalThis`; every route awaits the same ready promise and the
 * worker starts exactly once.
 */
import path from 'node:path'
import { CloudAgentRunner } from './cloudRunner'
import { FileCloudJobStore } from './fileStore'

const globalForRunner = globalThis as typeof globalThis & {
  __folioAgentRunner?: Promise<CloudAgentRunner>
}

const numericEnv = (name: string, fallback: number): number => {
  const raw = process.env[name]
  if (!raw) return fallback
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

export function runnerDataFile(): string {
  const directory = process.env.FOLIO_AGENT_RUNNER_DATA?.trim() || path.join(process.cwd(), '.folio-agent')
  return path.join(directory, 'jobs.json')
}

export async function getCloudAgentRunner(): Promise<CloudAgentRunner> {
  if (!globalForRunner.__folioAgentRunner) {
    const store = new FileCloudJobStore(runnerDataFile())
    const runner = new CloudAgentRunner({
      store,
      maxConcurrent: numericEnv('FOLIO_AGENT_RUNNER_CONCURRENCY', 1),
      maxWallMs: numericEnv('FOLIO_AGENT_RUNNER_MAX_WALL_MS', 15 * 60_000),
      maxEvents: numericEnv('FOLIO_AGENT_RUNNER_MAX_EVENTS', 2_000),
      onLog: (line) => console.error(`[folio-agent-runner] ${line}`),
    })
    globalForRunner.__folioAgentRunner = runner
      .init()
      .then(() => {
        runner.start()
        return runner
      })
      .catch((error) => {
        // A failed boot must be retryable: a cached rejected promise would turn
        // a transient disk error into a permanently dead endpoint.
        globalForRunner.__folioAgentRunner = undefined
        throw error
      })
  }
  return globalForRunner.__folioAgentRunner
}
