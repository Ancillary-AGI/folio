/**
 * AgentPanel — the AI-native command centre.
 *
 * Four surfaces share one live sheet:
 *  • Autopilot  — bounded autonomous tuning with schematic/waveform evidence.
 *  • Assistant  — explicit EDA plans (simulate, route, DRC, fab) with approvals.
 *  • Tools      — the exact capability surface, rendered from registrations.
 *  • Audit      — every tool call and durable session timeline.
 *
 * ERC stays available from the header on every tab; it runs the same symbolic
 * verifier over the netlist the simulator would build.
 */
import { useCallback, useMemo, useState } from 'react'
import {
  AlertCircle,
  Bot,
  CheckCircle,
  Cloud,
  CloudOff,
  Eye,
  Shield,
  Trash2,
  Wrench,
} from 'lucide-react'
import { Button } from '../ui/button'
import { useProjectStore } from '../../stores/useProjectStore'
import type { AgentCall } from '../../lib/agents/agentHarness'
import { verifySchematic } from '../../lib/agents/schematicVerification'
import type { SymbolicVerificationResult } from '../../lib/agents/symbolicVerifier'
import {
  agentSessionStore,
  describeSessionEvent,
  type AgentSession,
} from '../../lib/agents/agentSession'
import { cloudAgentConfigFromEnv } from '../../lib/agents/cloudAgentTransport'
import AutopilotWorkspace from './agent/AutopilotWorkspace'
import AgentAssistant from './agent/AgentAssistant'
import AgentToolCatalog from './agent/AgentToolCatalog'
import { useDemoRequest } from '../workspace/useDemoRequest'

type AgentTab = 'autopilot' | 'assistant' | 'tools' | 'audit'

const TABS: ReadonlyArray<{ id: AgentTab; label: string }> = [
  { id: 'autopilot', label: 'Autopilot' },
  { id: 'assistant', label: 'Assistant' },
  { id: 'tools', label: 'Tools' },
  { id: 'audit', label: 'Audit' },
]

interface AgentPanelProps {
  onClose?: () => void
}

export default function AgentPanel({ onClose }: AgentPanelProps) {
  const [tab, setTab] = useState<AgentTab>('autopilot')
  const [auditTrail, setAuditTrail] = useState<AgentCall[]>([])
  const [sessions, setSessions] = useState<AgentSession[]>(() => agentSessionStore.list())
  const [expandedSession, setExpandedSession] = useState<string | null>(null)

  const { components, wires } = useProjectStore()
  const [verification, setVerification] = useState<SymbolicVerificationResult | null>(null)
  const [verificationError, setVerificationError] = useState<string | null>(null)
  const cloud = useMemo(() => cloudAgentConfigFromEnv(), [])

  const handleVerifySchematic = useCallback(() => {
    try {
      if (components.length === 0) {
        throw new Error('Draw at least one component before running ERC.')
      }
      setVerificationError(null)
      setVerification(verifySchematic(components, wires))
    } catch (error) {
      setVerification(null)
      setVerificationError(error instanceof Error ? error.message : String(error))
    }
  }, [components, wires])

  const refreshSessions = useCallback(() => {
    setSessions(agentSessionStore.list())
  }, [])

  const selectTab = (next: AgentTab): void => {
    setTab(next)
    if (next === 'audit') refreshSessions()
  }

  // The gallery demo asks for the symbolic verifier's evidence rather than an
  // empty ERC surface, so the card proves what it claims on first paint. Tools
  // is the surface that also shows the exact harness the verifier ran inside.
  useDemoRequest('agents-verifier', () => {
    selectTab('tools')
    handleVerifySchematic()
  })

  const removeSession = (id: string): void => {
    agentSessionStore.delete(id)
    if (expandedSession === id) setExpandedSession(null)
    refreshSessions()
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Bot size={16} className="text-primary" />
          <span className="text-sm font-semibold">Engineering Agent</span>
          <span
            className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-xs text-muted-foreground"
            title={cloud.configured
              ? `Cloud runner: ${cloud.baseUrl}`
              : 'Local runner only — always-on jobs need the server-side runner documented in docs/AGENT_CLOUD.md'}
          >
            {cloud.configured ? <Cloud size={10} /> : <CloudOff size={10} />}
            {cloud.configured ? 'Cloud runner' : 'Local runner'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={handleVerifySchematic}
            title="Verify circuit topology (ERC)"
            aria-label="Verify circuit topology"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            <Shield size={13} className="mr-1" />ERC
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => selectTab('audit')}
            title="Audit trail and saved sessions"
            aria-label={`Open audit trail (${auditTrail.length} calls)`}
            className={`text-xs ${tab === 'audit' ? 'text-primary' : 'text-muted-foreground'}`}
          >
            <Eye size={13} className="mr-1" />{auditTrail.length}
          </Button>
          {onClose && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onClose}
              aria-label="Close agent panel"
              className="text-muted-foreground hover:text-foreground"
            >
              ✕
            </Button>
          )}
        </div>
      </div>

      <div role="tablist" aria-label="Agent surfaces" className="flex shrink-0 gap-0 border-b border-border px-2">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            id={`agent-tab-${entry.id}`}
            aria-selected={tab === entry.id}
            aria-controls={`agent-panel-${entry.id}`}
            onClick={() => selectTab(entry.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
              tab === entry.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {verificationError || verification ? (
        <div className="shrink-0 border-b border-border px-4 py-2 text-xs" aria-live="polite">
          {verificationError ? (
            <p role="alert" className="text-destructive">{verificationError}</p>
          ) : verification ? (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                {verification.passed ? (
                  <CheckCircle size={12} className="text-success" />
                ) : (
                  <AlertCircle size={12} className="text-destructive" />
                )}
                <span className={verification.passed ? 'text-success' : 'text-destructive'}>
                  ERC {verification.passed ? 'passed' : `found ${verification.errors.length} error(s)`}
                  {verification.warnings.length > 0 ? ` · ${verification.warnings.length} warning(s)` : ''}
                  {' '}· {verification.metrics.nodeCount} nets / {verification.metrics.pinCount} pins
                </span>
                <button
                  type="button"
                  aria-label="Dismiss ERC result"
                  onClick={() => setVerification(null)}
                  className="ml-auto text-muted-foreground hover:text-foreground"
                >
                  ✕
                </button>
              </div>
              {[...verification.errors, ...verification.warnings].slice(0, 4).map((issue, index) => (
                <p
                  key={`${issue.code}-${index}`}
                  className={issue.severity === 'error' ? 'text-destructive' : 'text-warning'}
                >
                  {issue.message}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div
        role="tabpanel"
        id="agent-panel-autopilot"
        aria-labelledby="agent-tab-autopilot"
        hidden={tab !== 'autopilot'}
        className={tab === 'autopilot' ? 'flex min-h-0 flex-1 flex-col' : undefined}
      >
        <AutopilotWorkspace onSessionSaved={() => refreshSessions()} />
      </div>

      <div
        role="tabpanel"
        id="agent-panel-assistant"
        aria-labelledby="agent-tab-assistant"
        hidden={tab !== 'assistant'}
        className={tab === 'assistant' ? 'flex min-h-0 flex-1 flex-col' : undefined}
      >
        <AgentAssistant onCalls={setAuditTrail} />
      </div>

      <div
        role="tabpanel"
        id="agent-panel-tools"
        aria-labelledby="agent-tab-tools"
        hidden={tab !== 'tools'}
        className={tab === 'tools' ? 'flex min-h-0 flex-1 flex-col' : undefined}
      >
        <AgentToolCatalog />
      </div>

      <div
        role="tabpanel"
        id="agent-panel-audit"
        aria-labelledby="agent-tab-audit"
        hidden={tab !== 'audit'}
        className={tab === 'audit' ? 'flex min-h-0 flex-1 flex-col overflow-y-auto p-3' : undefined}
      >
        <section className="mb-3 rounded-lg border border-border bg-card p-3" aria-labelledby="calls-heading">
          <div className="mb-1 flex items-center justify-between">
            <h3 id="calls-heading" className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Wrench size={13} /> Tool calls
            </h3>
            {auditTrail.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
                onClick={() => setAuditTrail([])}
                aria-label="Clear tool-call audit trail"
              >
                Clear
              </Button>
            )}
          </div>
          {auditTrail.length === 0 ? (
            <p className="text-xs text-muted-foreground">No calls this session. Assistant runs appear here as they execute.</p>
          ) : (
            <ol className="space-y-1.5">
              {auditTrail.map((call) => (
                <li key={call.seq} className="rounded-md border border-border bg-background p-2 text-xs">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="font-mono text-primary">{call.tool}</span>
                    {call.approved ? (
                      call.error
                        ? <AlertCircle size={10} className="text-destructive" />
                        : <CheckCircle size={10} className="text-success" />
                    ) : <Shield size={10} className="text-warning" />}
                    <span className="ml-auto text-muted-foreground">{call.endedAt - call.startedAt} ms</span>
                  </div>
                  {call.error && <p className="text-destructive">{call.error}</p>}
                  {!!call.result && !call.error && (
                    <pre className="overflow-x-auto text-xs text-muted-foreground">
                      {(JSON.stringify(call.result, null, 2) ?? String(call.result)).slice(0, 200)}
                    </pre>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="rounded-lg border border-border bg-card p-3" aria-labelledby="sessions-heading">
          <div className="mb-1 flex items-center justify-between">
            <h3 id="sessions-heading" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Saved sessions ({sessions.length})
            </h3>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs text-muted-foreground"
              onClick={refreshSessions}
              aria-label="Refresh saved agent sessions"
            >
              Refresh
            </Button>
          </div>
          {sessions.length === 0 ? (
            <p className="text-xs text-muted-foreground">Completed autopilot runs are saved here, with their goal and outcome.</p>
          ) : (
            <ol className="space-y-1.5">
              {sessions.map((session) => (
                <li key={session.id} className="rounded-md border border-border bg-background p-2 text-xs">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setExpandedSession(expandedSession === session.id ? null : session.id)}
                      aria-expanded={expandedSession === session.id}
                      aria-label={`Show session ${session.title}`}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block truncate font-medium text-foreground">{session.title}</span>
                      <span className="block truncate text-muted-foreground">
                        {session.status} · {session.iterationCount} iteration(s) · {new Date(session.updatedAt).toLocaleString()}
                      </span>
                    </button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-1.5 text-muted-foreground hover:text-destructive"
                      onClick={() => removeSession(session.id)}
                      aria-label={`Delete session ${session.title}`}
                    >
                      <Trash2 size={11} />
                    </Button>
                  </div>
                  {session.summary && <p className="mt-1 text-muted-foreground">{session.summary}</p>}
                  {expandedSession === session.id && (
                    <ol className="mt-1 space-y-0.5 border-t border-border pt-1">
                      {session.events.slice(-40).map((event) => (
                        <li key={event.seq} className="text-muted-foreground">
                          <span className="font-mono">#{event.seq}</span> {describeSessionEvent(event)}
                        </li>
                      ))}
                    </ol>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  )
}
