/**
 * The always-on agent runner's pulse, in the header.
 *
 * Renders nothing while idle: an idle badge is noise. When jobs are queued or
 * running — or one is paused waiting on a human approval — this is the one
 * place in the chrome that says so, and the one click that takes you to the
 * queue.
 */
import { useAgentJobs } from '../../lib/agents/useAgentJobs'

interface AgentStatusPillProps {
  onOpenAgents: () => void
}

export default function AgentStatusPill({ onOpenAgents }: AgentStatusPillProps) {
  const { active, running, awaitingApproval } = useAgentJobs()
  if (active === 0 && awaitingApproval === 0) return null

  const waiting = awaitingApproval > 0
  const label = waiting
    ? `${awaitingApproval} approval${awaitingApproval === 1 ? '' : 's'} pending`
    : `${running} running${active > running ? ` · ${active - running} queued` : ''}`
  const title = waiting
    ? `${awaitingApproval} agent ${awaitingApproval === 1 ? 'job is' : 'jobs are'} paused for your approval`
    : `${active} agent ${active === 1 ? 'job' : 'jobs'} in the always-on queue`

  return (
    <button
      type="button"
      onClick={onOpenAgents}
      className={`agent-pill hidden xl:inline-flex ${waiting ? 'agent-pill--approval' : ''}`}
      aria-label={`Agent jobs: ${title}. Open the agent workspace.`}
      title={title}
      data-tour="agent-activity"
    >
      <span className="agent-pill__dot" aria-hidden="true" />
      <span>Agents</span>
      <span className="tabular-nums opacity-80">{label}</span>
    </button>
  )
}
