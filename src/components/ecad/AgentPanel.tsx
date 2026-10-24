/**
 * AgentPanel — AI engineering agent harness UI.
 *
 * The agent panel is the AI-native command centre for Folio:
 *  • Chat with a multi-modal engineering agent
 *  • The agent can execute real EDA tools (simulate, DRC, route, export)
 *  • Every tool call is shown, budgeted, and requires approval for dangerous ops
 *  • Plan view: show the full DAG before executing
 *  • Audit trail: every call, result, and timestamp
 *
 * Architecture:
 *   User prompt → MetaHarness.createPlan() → AgentHarness.call() per step
 *   → EDA tools: spiceEngine, fabExport, autorouter, boardProgrammer
 */

import { useState, useRef, useCallback } from 'react'
import { Bot, CheckCircle, AlertCircle, Clock, ChevronRight, Eye, Send, Shield, Terminal } from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { AgentHarness, type AgentCall, type AgentBudget } from '../../lib/agents/agentHarness'
import { edaTools, planEdaFlow, type EdaPlanStep } from '../../lib/agents/edaTools'
import { MetaHarness } from '../../lib/agents/metaHarness'
import { verifySchematic } from '../../lib/agents/schematicVerification'
import type { SymbolicVerificationResult } from '../../lib/agents/symbolicVerifier'
import { useProjectStore } from '../../stores/useProjectStore'

// ─── One agent harness instance per panel mount ───────────────────────────────

function createHarness(): { harness: AgentHarness; meta: MetaHarness } {
  const harness = new AgentHarness()
  for (const tool of edaTools()) harness.registerTool(tool)
  const meta = new MetaHarness(harness)
  return { harness, meta }
}

// ─── Pre-built prompt templates ───────────────────────────────────────────────

const TEMPLATES = [
  { label: 'Simulate circuit', prompt: 'Run a DC operating point simulation on the current schematic.' },
  { label: 'Check DRC', prompt: 'Run design rule checks against JLCPCB profile on the current board.' },
  { label: 'Auto-route board', prompt: 'Convert the schematic to PCB and auto-route all traces on 2 layers.' },
  { label: 'Export for fab', prompt: 'Generate a complete Gerber + Excellon + centroid package for JLCPCB.' },
  { label: 'Analyse signal integrity', prompt: 'Analyse trace impedance and reflection on the current PCB layout.' },
  { label: 'Generate SPICE netlist', prompt: 'Generate and validate a SPICE netlist for the current schematic.' },
]

// ─── Message types ─────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string
  role: 'user' | 'agent' | 'system'
  content: string
  timestamp: number
  plan?: EdaPlanStep[]
  calls?: AgentCall[]
  error?: string
}

// ─── Component ────────────────────────────────────────────────────────────────

interface AgentPanelProps {
  onClose?: () => void
}

export default function AgentPanel({ onClose }: AgentPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([{
    id: 'welcome',
    role: 'system',
    content: 'Engineering Agent ready. I can simulate circuits, check DRC, auto-route boards, and export fab packages. What would you like to build?',
    timestamp: Date.now(),
  }])
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const [pendingApproval, setPendingApproval] = useState<{ call: { tool: string; args: Record<string, string | number | boolean> }; resolve: (v: boolean) => void } | null>(null)
  const [harnessRef] = useState(() => createHarness())
  const [auditTrail, setAuditTrail] = useState<AgentCall[]>([])
  const [showAudit, setShowAudit] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const { components, wires, generateNetlist } = useProjectStore()
  const [verification, setVerification] = useState<SymbolicVerificationResult | null>(null)
  const [verificationError, setVerificationError] = useState<string | null>(null)

  const handleVerifySchematic = useCallback(() => {
    try {
      if (components.length === 0) {
        throw new Error('Draw at least one component before running ERC.')
      }
      setVerificationError(null)
      setVerification(verifySchematic(components, wires))
    } catch (err) {
      setVerification(null)
      setVerificationError(err instanceof Error ? err.message : String(err))
    }
  }, [components, wires])

  const addMessage = useCallback((msg: Omit<ChatMessage, 'id' | 'timestamp'>) => {
    const full: ChatMessage = { ...msg, id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, timestamp: Date.now() }
    setMessages(prev => [...prev, full])
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
    return full
  }, [])

  const handleSend = useCallback(async (promptText?: string) => {
    const text = (promptText ?? input).trim()
    if (!text || running) return
    setInput('')
    addMessage({ role: 'user', content: text })

    setRunning(true)

    try {
      // Build EDA plan from the user's goal
      const netlistJson = JSON.stringify(generateNetlist())
      const componentsJson = JSON.stringify(components)
      const wiresJson = JSON.stringify(wires)

      // Map intent keywords to plan
      const plan = planEdaFlow(text, { netlist: netlistJson, components: componentsJson, wires: wiresJson })

      if (!plan || plan.steps.length === 0) {
        addMessage({ role: 'agent', content: `I understand you want to: "${text}". I can help with: simulate, DRC, route, export. Please be more specific or use a template below.` })
        setRunning(false)
        return
      }

      addMessage({ role: 'agent', content: `Plan created: ${plan.goal}\n${plan.steps.map((s, i) => `${i+1}. [${s.tool}] ${s.rationale}`).join('\n')}`, plan: plan.steps })

      // Execute the plan
      const budget: AgentBudget = { maxCalls: 20, maxWallMs: 60_000, startedAt: Date.now() }

      const approve = (tool: string, args: Record<string, string | number | boolean>): Promise<boolean> => {
        return new Promise(resolve => {
          setPendingApproval({ call: { tool, args }, resolve })
        })
      }

      const calls: AgentCall[] = []

      for (const step of plan.steps) {
        try {
          const call = await harnessRef.harness.call(step.tool, step.args, budget, approve)
          calls.push(call)
          setAuditTrail(prev => [...prev, call])
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err)
          addMessage({ role: 'agent', content: `Step failed: ${errMsg}`, error: errMsg, calls })
          setRunning(false)
          return
        }
      }

      // Summarise results
      const successCalls = calls.filter(c => !c.error && c.approved)
      const failedCalls = calls.filter(c => c.error || !c.approved)

      let summary = `Completed ${successCalls.length} of ${calls.length} steps.`
      for (const call of successCalls) {
        const result = call.result as Record<string, unknown>
        if (result && typeof result === 'object') {
          if ('converged' in result) summary += `\n• Simulation: ${result.converged ? '✓ Converged' : '✗ Did not converge'}`
          if ('shippable' in result) summary += `\n• DRC: ${result.shippable ? '✓ Shippable' : `✗ ${(result.violations as unknown[])?.length ?? 0} violations`}`
          if ('traces' in result) summary += `\n• Route: ${result.traces} traces placed`
          if ('files' in result) summary += `\n• Fab package: ${result.files} files generated`
        }
      }
      if (failedCalls.length > 0) summary += `\n\n${failedCalls.length} step(s) failed or were denied.`

      addMessage({ role: 'agent', content: summary, calls })

    } catch (err) {
      addMessage({ role: 'agent', content: `Error: ${err instanceof Error ? err.message : String(err)}`, error: String(err) })
    } finally {
      setRunning(false)
      setPendingApproval(null)
    }
  }, [input, running, addMessage, components, wires, generateNetlist, harnessRef])

  return (
    <div className="flex flex-col h-full bg-background text-foreground overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Bot size={16} className="text-primary" />
          <span className="font-semibold text-sm">Engineering Agent</span>
          {running && <span className="text-xs text-warning animate-pulse">● Running</span>}
        </div>
        <div className="flex gap-1">
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
          <Button size="sm" variant="ghost" onClick={() => setShowAudit(v => !v)} title="Audit trail"
            className={`text-xs ${showAudit ? 'text-primary' : 'text-muted-foreground'}`}>
            <Eye size={13} className="mr-1" />{auditTrail.length}
          </Button>
          {onClose && (
            <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close agent panel" className="text-muted-foreground hover:text-foreground">✕</Button>
          )}
        </div>
      </div>

      {verificationError || verification ? (
        <div className="border-b border-border px-4 py-2 shrink-0 text-xs" aria-live="polite">
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

      {showAudit ? (
        /* Audit trail view */
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          <p className="text-xs text-muted-foreground mb-2">All agent tool calls — full audit</p>
          {auditTrail.length === 0 && <p className="text-xs text-muted-foreground">No calls yet.</p>}
          {auditTrail.map((call, i) => (
            <div key={i} className="bg-card rounded p-2 text-xs">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono text-primary">{call.tool}</span>
                {call.approved ? (
                  call.error ? <AlertCircle size={10} className="text-destructive" /> : <CheckCircle size={10} className="text-success" />
                ) : <Shield size={10} className="text-warning" />}
                <span className="text-muted-foreground ml-auto">{call.endedAt - call.startedAt}ms</span>
              </div>
              {call.error && <p className="text-destructive">{call.error}</p>}
              {!!call.result && !call.error && (
                <pre className="text-muted-foreground text-xs overflow-x-auto">{(JSON.stringify(call.result, null, 2) ?? String(call.result)).slice(0, 200)}</pre>
              )}
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.map(msg => (
              <div key={msg.id} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role !== 'user' && (
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                    msg.role === 'agent' ? 'bg-primary' : 'bg-muted'
                  }`}>
                    {msg.role === 'agent' ? <Bot size={13} /> : <Terminal size={11} />}
                  </div>
                )}
                <div className={`max-w-xs rounded-xl px-3 py-2 text-xs leading-relaxed ${
                  msg.role === 'user' ? 'bg-primary text-primary-foreground rounded-br-none' :
                  msg.role === 'agent' ? 'bg-card text-foreground rounded-bl-none' :
                  'bg-surface text-muted-foreground w-full text-center py-1 rounded-none bg-transparent border-none'
                }`}>
                  <p className="whitespace-pre-wrap">{msg.content}</p>

                  {/* Plan steps */}
                  {msg.plan && (
                    <div className="mt-2 space-y-1">
                      {msg.plan.map((step, i) => (
                        <div key={i} className="flex items-start gap-1.5 text-xs bg-muted rounded p-1.5">
                          <ChevronRight size={10} className="text-primary shrink-0 mt-0.5" />
                          <div>
                            <span className="font-mono text-primary">{step.tool}</span>
                            <span className="text-muted-foreground ml-1">{step.rationale}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Tool call results */}
                  {msg.calls && msg.calls.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {msg.calls.slice(-3).map((call, i) => (
                        <div key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          {call.error ? <AlertCircle size={10} className="text-destructive" /> : <CheckCircle size={10} className="text-success" />}
                          <span className="font-mono">{call.tool}</span>
                          <span className="ml-auto text-muted-foreground">{call.endedAt - call.startedAt}ms</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {msg.error && (
                    <div className="mt-1.5 text-xs text-destructive flex items-start gap-1">
                      <AlertCircle size={10} className="mt-0.5 shrink-0" />
                      <span>{msg.error}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Approval gate */}
          {pendingApproval && (
            <div className="mx-3 mb-2 bg-warning/10 border border-warning/50 rounded-lg p-3 text-xs">
              <div className="flex items-center gap-2 mb-2">
                <Shield size={13} className="text-warning" />
                <span className="font-semibold text-warning">Approval Required</span>
              </div>
              <p className="text-warning mb-1">
                The agent wants to call: <code className="font-mono bg-warning/15 px-1 rounded">{pendingApproval.call.tool}</code>
              </p>
              <p className="text-muted-foreground mb-2 line-clamp-2">
                Args: {JSON.stringify(pendingApproval.call.args).slice(0, 120)}…
              </p>
              <div className="flex gap-2">
                <Button size="sm" className="bg-success hover:bg-success/90 h-7 text-xs"
                  onClick={() => { pendingApproval.resolve(true); setPendingApproval(null) }}>
                  <CheckCircle size={11} className="mr-1" />Allow
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:text-destructive border border-destructive/50"
                  onClick={() => { pendingApproval.resolve(false); setPendingApproval(null) }}>
                  Deny
                </Button>
              </div>
            </div>
          )}

          {/* Templates */}
          <div className="relative shrink-0 px-3 pb-1">
            <div className="scrollbar-none flex gap-1.5 overflow-x-auto pb-1">
              {TEMPLATES.map(t => (
                <button
                  key={t.label}
                  onClick={() => handleSend(t.prompt)}
                  disabled={running}
                  className="shrink-0 text-xs bg-card hover:bg-muted text-foreground rounded-full px-2.5 py-1 transition-colors border border-border"
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="pointer-events-none absolute inset-y-0 right-3 w-6 bg-gradient-to-l from-background to-transparent" aria-hidden="true" />
          </div>

          {/* Input */}
          <div className="flex gap-2 p-3 border-t border-border shrink-0">
            <Input
              className="flex-1 bg-card border-border text-sm h-9"
              placeholder="Simulate, route, check DRC, export…"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
              disabled={running}
            />
            <Button size="sm" onClick={() => handleSend()} disabled={running || !input.trim()}
              aria-label={running ? 'Sending request' : 'Send message'}
              className="bg-primary hover:bg-primary/90 h-9">
              {running ? <Clock size={14} className="animate-spin" /> : <Send size={14} />}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
