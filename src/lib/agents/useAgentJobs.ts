/**
 * React binding for the always-on agent runner.
 *
 * `agentJobRunner` keeps its own snapshot array and only swaps identity when a
 * job actually changes (enqueue, step persist, pause, approval, finish), so
 * `useSyncExternalStore` re-renders the chrome exactly as often as the truth
 * moves — no polling, no tearing.
 */
import { useSyncExternalStore } from 'react'
import type { AgentJob } from './jobQueue'
import { agentJobRunner } from './agentJobs'

export interface AgentJobSummary {
  jobs: AgentJob[]
  /** Jobs actively executing a step right now. */
  running: number
  /** Jobs waiting for a worker slot (FIFO behind the runner). */
  queued: number
  /** Jobs paused on a human approval — the loud ones. */
  awaitingApproval: number
  /** Running + queued. What the chrome shows as "busy". */
  active: number
}

const SERVER_SNAPSHOT: AgentJob[] = []
// Module-scope subscribers: a fresh arrow per render would make React
// unsubscribe/resubscribe on every commit.
const subscribeToAgentJobs = (onStoreChange: () => void) => agentJobRunner.subscribe(onStoreChange)
const getAgentJobsSnapshot = () => agentJobRunner.list()
const getServerAgentJobsSnapshot = () => SERVER_SNAPSHOT

function useJobs(): AgentJob[] {
  return useSyncExternalStore(
    subscribeToAgentJobs,
    getAgentJobsSnapshot,
    getServerAgentJobsSnapshot,
  )
}

export function useAgentJobs(): AgentJobSummary {
  const jobs = useJobs()
  let running = 0
  let queued = 0
  let awaitingApproval = 0
  for (const job of jobs) {
    if (job.status === 'running') running += 1
    else if (job.status === 'queued') queued += 1
    if (job.status === 'paused' && job.pendingApproval) awaitingApproval += 1
  }
  return { jobs, running, queued, awaitingApproval, active: running + queued }
}
