/**
 * Watches the always-on agent runner and raises in-app notifications on the
 * transitions a designer cares about: a job reaching a verdict, or one pausing
 * for a human approval. Two honesty rules:
 *
 * - Jobs that were already terminal when the watcher mounts are seeded, not
 *   replayed — opening the app does not re-announce work finished last week.
 * - A transition only emits when the watcher observed the job go *out of*
 *   queued/running. A paused job resumed and paused again fires again, and
 *   should: each pause is a fresh ask.
 */
import { agentJobRunner } from '../agents/agentJobs'
import type { AgentJob, AgentJobStatus } from '../agents/jobQueue'
import { notifyNotification } from './notifications'

const seen = new Map<string, AgentJobStatus>()

function titleOf(job: AgentJob): string {
  const title = job.title.trim() || job.prompt.trim().replace(/\s+/g, ' ').slice(0, 80)
  return title.length > 80 ? `${title.slice(0, 77)}…` : title
}

/** One pass over the current list; cheap, called on every runner persist. */
function diff(jobs: AgentJob[]): void {
  for (const job of jobs) {
    const before = seen.get(job.id)
    seen.set(job.id, job.status)
    if (before === job.status) continue
    const wasLive = before === 'queued' || before === 'running' || before === undefined
    if (!wasLive) continue
    if (job.status === 'completed') {
      const report = job.report?.trim()
      notifyNotification({
        kind: 'agent',
        title: `Agent finished: ${titleOf(job)}`,
        ...(report ? { detail: report.slice(0, 240) } : {}),
      })
    } else if (job.status === 'failed') {
      notifyNotification({
        kind: 'agent',
        title: `Agent failed: ${titleOf(job)}`,
        detail: (job.error ?? job.report ?? 'The job stopped without a stated reason.').trim().slice(0, 240),
      })
    } else if (job.status === 'paused' && job.pendingApproval) {
      notifyNotification({
        kind: 'agent',
        title: `Agent paused for your approval: ${titleOf(job)}`,
        detail: `${job.pendingApproval.tool} needs a human decision before it can run.`,
      })
    }
  }
}

/** Mount once from the shell. Returns the unsubscribe. */
export function watchAgentJobsForNotifications(): () => void {
  seen.clear()
  // Seed silently: what happened before this mount is not news.
  for (const job of agentJobRunner.list()) seen.set(job.id, job.status)
  return agentJobRunner.subscribe(() => diff(agentJobRunner.list()))
}
