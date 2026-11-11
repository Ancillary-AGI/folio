/**
 * Status-bar cell for the always-on agent runner. Renders nothing while the
 * queue is idle; when jobs are in flight (or one waits on a human approval)
 * it states the fact and jumps to the agent workspace on click.
 */
import { Bot, ShieldQuestion } from 'lucide-react'
import { useAgentJobs } from '../../lib/agents/useAgentJobs'

interface AgentStatusSegmentProps {
  onOpenAgents: () => void
}

export default function AgentStatusSegment({ onOpenAgents }: AgentStatusSegmentProps) {
  const { active, running, awaitingApproval } = useAgentJobs()
  if (active === 0 && awaitingApproval === 0) return null

  const waiting = awaitingApproval > 0
  const title = waiting
    ? `${awaitingApproval} agent ${awaitingApproval === 1 ? 'job' : 'jobs'} paused for your approval — open the agent workspace to decide`
    : `${active} agent ${active === 1 ? 'job' : 'jobs'} in flight (${running} running) — open the agent workspace`

  return (
    <button
      type="button"
      onClick={onOpenAgents}
      aria-label={`Agent activity: ${title}`}
      title={title}
      data-tour="agent-activity-segment"
      className={`status-segment transition-colors hover:bg-accent ${waiting ? 'text-warning' : 'status-segment--live'}`}
    >
      {waiting ? (
        <ShieldQuestion className="h-3 w-3" aria-hidden="true" />
      ) : (
        <Bot className="h-3 w-3 cad-live-indicator" aria-hidden="true" />
      )}
      {waiting ? (
        <>
          Approval <span className="cad-readout">{awaitingApproval}</span>
        </>
      ) : (
        <>
          Agents <span className="cad-readout">{running}</span>
          {active > running ? (
            <span className="text-muted-foreground">+{active - running} queued</span>
          ) : null}
        </>
      )}
    </button>
  )
}
