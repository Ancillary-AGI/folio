/**
 * Always-on — the background job queue surface.
 *
 * Jobs are queued with a plain prompt, planned against the live sheet, run
 * through plan → act → verify → report while the human keeps working, and can
 * be paused, resumed or cancelled. A job paused for an approval shows the
 * Approve/Deny decision here. The panel subscribes to the runner singleton, so
 * progress shows even when the user works in other workspaces.
 */
import { useSyncExternalStore, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  Clock,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Send,
  Shield,
  Trash2,
  XCircle,
} from 'lucide-react'
import { Button } from '../../ui/button'
import { Input } from '../../ui/input'
import { agentJobRunner } from '../../../lib/agents/agentJobs'
import type { AgentJob, AgentJobStatus } from '../../../lib/agents/jobQueue'
import type { AgentJobRunner } from '../../../lib/agents/jobRunner'

const TEMPLATES = [
  { label: 'Inspect schematic', prompt: 'Inspect the live schematic and report its parts, nets, and any issues.' },
  { label: 'DC simulation', prompt: 'Run a DC operating point simulation on the current schematic.' },
  { label: 'Transient run', prompt: 'Run a transient simulation and report whether the circuit settles.' },
  { label: 'Check DRC', prompt: 'Run design rule checks against JLCPCB profile on the current board.' },
  { label: 'Auto-route board', prompt: 'Convert the schematic to PCB and auto-route all traces on 2 layers.' },
  { label: 'Export for fab', prompt: 'Generate a complete Gerber + Excellon + centroid package for JLCPCB.' },
  { label: 'Signal integrity', prompt: 'Analyse trace impedance and reflection on the current PCB layout.' },
]

const STATUS_STYLE: Record<AgentJobStatus, string> = {
  queued: 'border-muted-foreground/40 bg-muted text-muted-foreground',
  running: 'border-primary/50 bg-primary/10 text-primary',
  paused: 'border-warning/50 bg-warning/10 text-warning',
  completed: 'border-success/50 bg-success/10 text-success',
  failed: 'border-destructive/50 bg-destructive/10 text-destructive',
  stopped: 'border-muted-foreground/40 bg-muted text-muted-foreground',
}

const STATUS_LABEL: Record<AgentJobStatus, string> = {
  queued: 'queued',
  running: 'running',
  paused: 'paused',
  completed: 'completed',
  failed: 'failed',
  stopped: 'stopped',
}

const STEP_ICON = {
  pending: <CircleDashed size={11} className="text-muted-foreground" />,
  running: <Loader2 size={11} className="animate-spin text-primary" />,
  succeeded: <CheckCircle size={11} className="text-success" />,
  failed: <XCircle size={11} className="text-destructive" />,
  denied: <Shield size={11} className="text-warning" />,
  skipped: <CircleDashed size={11} className="text-muted-foreground/50" />,
} as const

const phaseLabel = (job: AgentJob): string => {
  if (job.status === 'queued') return 'waiting'
  if (job.status === 'completed' || job.status === 'failed' || job.status === 'stopped') return 'done'
  return job.phase
}

const formatTime = (stamp: string): string => new Date(stamp).toLocaleString()

interface JobRunnerPanelProps {
  runner?: AgentJobRunner
}

export default function JobRunnerPanel({ runner = agentJobRunner }: JobRunnerPanelProps) {
  const jobs = useSyncExternalStore(runner.subscribe, runner.list)
  const [prompt, setPrompt] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const queueJob = (text?: string): void => {
    const value = (text ?? prompt).trim()
    if (!value) return
    const job = runner.enqueue({ prompt: value })
    if (job) {
      setPrompt('')
      setExpanded(job.id)
    }
  }

  const counts = jobs.reduce<Record<AgentJobStatus, number>>(
    (total, job) => ({ ...total, [job.status]: (total[job.status] ?? 0) + 1 }),
    { queued: 0, running: 0, paused: 0, completed: 0, failed: 0, stopped: 0 },
  )
  const activeCount = counts.queued + counts.running + counts.paused

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="shrink-0 border-b border-border px-3 py-2 text-xs leading-relaxed text-muted-foreground">
        Jobs run in the background while Folio is open — queue several and keep designing.
        Closing the tab pauses the active job; it resumes from its last completed step.
        24/7 execution needs the cloud runner documented in <code className="font-mono">docs/AGENT_CLOUD.md</code>.
      </p>

      <div className="shrink-0 space-y-2 border-b border-border p-3">
        <div className="scrollbar-none flex gap-1.5 overflow-x-auto pb-1">
          {TEMPLATES.map((template) => (
            <button
              key={template.label}
              type="button"
              onClick={() => queueJob(template.prompt)}
              className="shrink-0 rounded-full border border-border bg-card px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-muted"
            >
              {template.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            className="h-9 flex-1 border-border bg-card text-sm"
            placeholder="Describe the job: inspect, simulate, DRC, route, export…"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) queueJob()
            }}
            aria-label="Job prompt"
            data-testid="job-prompt-input"
          />
          <Button
            size="sm"
            onClick={() => queueJob()}
            disabled={!prompt.trim()}
            aria-label="Queue job"
            data-testid="job-add-button"
            className="h-9 bg-primary hover:bg-primary/90"
          >
            <Send size={14} />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {activeCount > 0
            ? `${activeCount} active job(s) — ${counts.running} running, ${counts.queued} queued, ${counts.paused} paused.`
            : 'No active jobs.'}
          {' '}{counts.completed + counts.failed + counts.stopped} finished in history.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3" data-testid="job-list">
        {jobs.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">
            No jobs yet. Queue an inspection, simulation, DRC or routing job above
            and keep working — it runs against the live sheet in the background.
          </p>
        ) : (
          <ul className="space-y-2">
            {jobs.map((job) => {
              const isOpen = expanded === job.id
              const doneSteps = job.steps.filter((step) => step.status === 'succeeded').length
              return (
                <li
                  key={job.id}
                  className="rounded-lg border border-border bg-card"
                  data-testid={`job-card-${job.id}`}
                >
                  <div className="flex items-start gap-2 p-2.5">
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : job.id)}
                      aria-label={isOpen ? `Collapse job ${job.title}` : `Expand job ${job.title}`}
                      className="mt-0.5 text-muted-foreground hover:text-foreground"
                    >
                      {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-xs font-medium">{job.title}</span>
                        <span className={`rounded-full border px-1.5 py-px text-[10px] uppercase tracking-wide ${STATUS_STYLE[job.status]}`}>
                          {STATUS_LABEL[job.status]}
                        </span>
                        <span className="text-[10px] text-muted-foreground">{phaseLabel(job)}</span>
                        {job.steps.length > 0 && (
                          <span className="text-[10px] text-muted-foreground">{doneSteps}/{job.steps.length} step(s)</span>
                        )}
                      </div>
                      <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">{job.prompt}</p>
                      {job.recoveredFromCrash && (
                        <p className="mt-0.5 flex items-center gap-1 text-[11px] text-warning">
                          <AlertTriangle size={10} /> Recovered after the app closed — paused at its last step.
                        </p>
                      )}
                      {job.error && <p className="mt-0.5 line-clamp-1 text-[11px] text-destructive">{job.error}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {job.status === 'queued' || job.status === 'running' ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs text-muted-foreground hover:text-warning"
                          onClick={() => runner.pause(job.id)}
                          aria-label={`Pause job ${job.title}`}
                        >
                          <Pause size={12} />
                        </Button>
                      ) : null}
                      {job.status === 'paused' && !job.pendingApproval && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs text-muted-foreground hover:text-success"
                          onClick={() => runner.resume(job.id)}
                          aria-label={`Resume job ${job.title}`}
                        >
                          <Play size={12} />
                        </Button>
                      )}
                      {(job.status === 'queued' || job.status === 'running' || job.status === 'paused') && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                          onClick={() => runner.cancel(job.id)}
                          aria-label={`Cancel job ${job.title}`}
                        >
                          <XCircle size={12} />
                        </Button>
                      )}
                      {job.status !== 'running' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                          onClick={() => runner.remove(job.id)}
                          aria-label={`Remove job ${job.title}`}
                        >
                          <Trash2 size={12} />
                        </Button>
                      )}
                    </div>
                  </div>

                  {job.pendingApproval && (
                    <div className="mx-2.5 mb-2 rounded border border-warning/50 bg-warning/10 p-2 text-xs">
                      <div className="flex items-center gap-1.5">
                        <Shield size={12} className="text-warning" />
                        <span className="font-semibold text-warning">Approval required</span>
                        <span className="ml-auto text-[10px] text-muted-foreground">
                          step {job.pendingApproval.stepIndex + 1} · {job.pendingApproval.tool}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 break-all text-[11px] text-muted-foreground">
                        Args: {JSON.stringify(job.pendingApproval.args).slice(0, 140)}
                      </p>
                      <div className="mt-1.5 flex gap-2">
                        <Button
                          size="sm"
                          className="h-7 bg-success text-xs hover:bg-success/90"
                          onClick={() => runner.decideApproval(job.id, true)}
                          aria-label={`Approve step ${job.pendingApproval.stepIndex + 1} of ${job.title}`}
                        >
                          <CheckCircle size={11} className="mr-1" />Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 border border-destructive/50 text-xs text-destructive hover:text-destructive"
                          onClick={() => runner.decideApproval(job.id, false)}
                          aria-label={`Deny step ${job.pendingApproval.stepIndex + 1} of ${job.title}`}
                        >
                          Deny
                        </Button>
                      </div>
                    </div>
                  )}

                  {isOpen && (
                    <div className="border-t border-border p-2.5">
                      {job.contextSummary && (
                        <p className="mb-2 flex items-start gap-1 text-[11px] text-muted-foreground">
                          <Clock size={10} className="mt-0.5 shrink-0" />
                          <span>
                            Context pack: {job.contextSummary.totalTokens} of {job.contextSummary.budgetTokens} estimated tokens
                            (chars/4 estimate)
                            {job.contextSummary.dropped.length > 0 ? `; dropped: ${job.contextSummary.dropped.join(', ')}` : ''}.
                          </span>
                        </p>
                      )}
                      {job.steps.length > 0 && (
                        <ul className="space-y-1">
                          {job.steps.map((step, index) => (
                            <li key={`${step.tool}-${index}`} className="flex items-start gap-1.5 text-xs">
                              <span className="mt-0.5 shrink-0">{STEP_ICON[step.status]}</span>
                              <span className="min-w-0 flex-1">
                                <span className="font-mono text-[11px] text-primary">{step.tool}</span>
                                <span className="ml-1 text-[11px] text-muted-foreground">{step.rationale}</span>
                                {step.error && <span className="ml-1 text-[11px] text-destructive">{step.error}</span>}
                                {step.summary && step.status === 'succeeded' && (
                                  <span className="ml-1 text-[11px] text-muted-foreground">— {step.summary}</span>
                                )}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {job.report && (
                        <div className="mt-2 rounded bg-muted p-2">
                          <p className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            <RotateCcw size={10} /> Report
                          </p>
                          <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-foreground">{job.report}</p>
                        </div>
                      )}
                      <p className="mt-2 text-[10px] text-muted-foreground">
                        Created {formatTime(job.createdAt)}
                        {job.finishedAt ? ` · finished ${formatTime(job.finishedAt)}` : ''}
                      </p>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
