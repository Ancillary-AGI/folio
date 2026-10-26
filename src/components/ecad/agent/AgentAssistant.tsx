/**
 * Assistant — explicit, reviewable EDA tasks.
 *
 * Unlike the autopilot's bounded search, this surface runs a named plan
 * (simulate → route → DRC → fab) through the same harness, with approval gates
 * and a visible audit trail. Payloads are built from the live canvas so the
 * tools see the circuit the simulator would build, not a parallel copy.
 */
import { useCallback, useRef, useState } from 'react'
import { AlertCircle, Bot, CheckCircle, ChevronRight, Clock, Send, Shield, Terminal } from 'lucide-react'
import { Button } from '../../ui/button'
import { Input } from '../../ui/input'
import { AgentHarness, type AgentCall, type AgentBudget } from '../../../lib/agents/agentHarness'
import { registerCadTools } from '../../../lib/agents/cadTools'
import { createStoreCadRuntime } from '../../../lib/agents/cadRuntime'
import { planEdaFlow, registerEdaTools, type EdaPlanStep } from '../../../lib/agents/edaTools'
import { registerMechanicalTools } from '../../../lib/agents/mechanicalTools'
import { buildCircuitNetlist } from '../../../lib/simulation/netlistBuilder'
import type { SimulationParameters } from '../../../lib/simulation/spiceEngine'
import type { CanvasComponent, CanvasWire } from '../../../stores/useProjectStore'
import { useProjectStore } from '../../../stores/useProjectStore'

const TEMPLATES = [
  { label: 'Inspect schematic', prompt: 'Inspect the live schematic and report its parts, nets, and any issues.' },
  { label: 'Simulate circuit', prompt: 'Run a DC operating point simulation on the current schematic.' },
  { label: 'Transient run', prompt: 'Run a transient simulation and report whether the circuit settles.' },
  { label: 'Check DRC', prompt: 'Run design rule checks against JLCPCB profile on the current board.' },
  { label: 'Auto-route board', prompt: 'Convert the schematic to PCB and auto-route all traces on 2 layers.' },
  { label: 'Export for fab', prompt: 'Generate a complete Gerber + Excellon + centroid package for JLCPCB.' },
  { label: 'Analyse signal integrity', prompt: 'Analyse trace impedance and reflection on the current PCB layout.' },
]

interface ChatMessage {
  id: string
  role: 'user' | 'agent' | 'system'
  content: string
  timestamp: number
  plan?: EdaPlanStep[]
  calls?: AgentCall[]
  schematicSvg?: string
  error?: string
}

const analysisForPrompt = (text: string): SimulationParameters => {
  if (/transient|pulse|waveform|settle|ripple/i.test(text)) {
    return { type: 'transient', stopTime: 20e-3, stepTime: 20e-6 }
  }
  if (/\bac\b|frequency|bode|sweep/i.test(text)) {
    return { type: 'ac', startFreq: 10, stopFreq: 1e6, pointsPerDecade: 20 }
  }
  return { type: 'dc' }
}

/**
 * The PCB/fab tools operate on the placement shape (`position`, `scale`), while
 * the canvas stores an origin (`x`, `y`). Convert once, explicitly, instead of
 * letting a missing `position` crash inside a tool.
 */
const placedForFabrication = (components: CanvasComponent[]) =>
  components.map((component) => ({
    ...component,
    position: { x: component.x, y: component.y },
    scale: 1,
    locked: false,
    visible: true,
    selected: false,
  }))

const pcbWires = (wires: CanvasWire[]) =>
  wires.map((wire) => ({
    ...wire,
    style: { ...(wire.style ?? {}), width: wire.style?.width ?? 0.25 },
    selected: false,
  }))

interface AgentAssistantProps {
  onCalls?: (calls: AgentCall[]) => void
}

export default function AgentAssistant({ onCalls }: AgentAssistantProps) {
  const components = useProjectStore((state) => state.components)
  const wires = useProjectStore((state) => state.wires)

  const [messages, setMessages] = useState<ChatMessage[]>([{
    id: 'welcome',
    role: 'system',
    content: 'Engineering assistant ready. Ask for a simulation, DRC, routing, fabrication package, or a schematic inspection. ' +
      'The cad.* tools observe and edit the live sheet; mechanical parts are editable through mech.*. ' +
      'Autonomous design search lives in the Autopilot tab.',
    timestamp: Date.now(),
  }])
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const [pendingApproval, setPendingApproval] = useState<{
    call: { tool: string; args: Record<string, string | number | boolean> }
    resolve: (value: boolean) => void
  } | null>(null)
  const [harness] = useState(() => {
    const instance = new AgentHarness()
    // The cad.* tools act on the same store the canvas renders, so an agent
    // edit and a human edit are the same edit — never a shadow copy.
    registerCadTools(instance, createStoreCadRuntime())
    registerEdaTools(instance)
    registerMechanicalTools(instance)
    return instance
  })
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const addMessage = useCallback((message: Omit<ChatMessage, 'id' | 'timestamp'>) => {
    const full: ChatMessage = {
      ...message,
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
    }
    setMessages((current) => [...current, full])
    setTimeout(() => messagesEndRef.current?.scrollIntoView?.({ behavior: 'smooth' }), 50)
    return full
  }, [])

  const handleSend = useCallback(async (promptText?: string) => {
    const text = (promptText ?? input).trim()
    if (!text || running) return
    setInput('')
    addMessage({ role: 'user', content: text })
    setRunning(true)

    try {
      let netlist: string
      try {
        const built = buildCircuitNetlist(
          'agent-assistant',
          components,
          wires,
          analysisForPrompt(text),
        )
        netlist = JSON.stringify(built)
      } catch (netlistError) {
        addMessage({
          role: 'agent',
          content: `The sheet cannot be netlisted yet: ${netlistError instanceof Error ? netlistError.message : String(netlistError)}`,
          error: String(netlistError),
        })
        setRunning(false)
        return
      }

      const placed = placedForFabrication(components)
      const schematic = JSON.stringify({
        id: 'current-schematic',
        name: 'Current schematic',
        components: placed,
        wires: pcbWires(wires),
        nets: [],
        metadata: {
          created: new Date().toISOString(),
          modified: new Date().toISOString(),
          version: '1',
          author: 'folio',
        },
        settings: {
          gridSize: 10,
          snapToGrid: true,
          showGrid: true,
          showPinNumbers: true,
          showPinNames: true,
          showNetNames: true,
        },
      })

      const plan = planEdaFlow(text, {
        netlist,
        components: JSON.stringify(placed),
        wires: JSON.stringify(pcbWires(wires)),
        schematic,
      })
      if (!plan || plan.steps.length === 0) {
        addMessage({
          role: 'agent',
          content: `I can run simulations, DRC, routing, and fabrication checks. ` +
            `I couldn't map "${text}" to a concrete plan — try a template below, or use Autopilot for open-ended tuning.`,
        })
        setRunning(false)
        return
      }

      addMessage({
        role: 'agent',
        content: `Plan: ${plan.goal}\n${plan.steps.map((step, index) => `${index + 1}. [${step.tool}] ${step.rationale}`).join('\n')}`,
        plan: plan.steps,
      })

      const budget: AgentBudget = { maxCalls: 20, maxWallMs: 60_000, startedAt: Date.now() }
      const approve = (tool: string, args: Record<string, string | number | boolean>): Promise<boolean> =>
        new Promise((resolve) => {
          setPendingApproval({ call: { tool, args }, resolve })
        })

      const calls: AgentCall[] = []
      let schematicSvg: string | undefined
      for (const step of plan.steps) {
        const call = await harness.call(step.tool, step.args, budget, approve)
        calls.push(call)
        const observation = call.result as { schematicSvg?: unknown } | undefined
        if (typeof observation?.schematicSvg === 'string' && observation.schematicSvg) {
          schematicSvg = observation.schematicSvg
        }
        onCalls?.([...harness.auditTrail()])
        if (call.error) break
      }

      const succeeded = calls.filter((call) => !call.error && call.approved)
      const failed = calls.filter((call) => call.error || !call.approved)
      let summary = `Completed ${succeeded.length} of ${calls.length} step(s).`
      for (const call of succeeded) {
        const result = call.result as Record<string, unknown> | undefined
        if (!result || typeof result !== 'object') continue
        const stats = result.stats as { components?: number; nets?: number; unconnectedPins?: number } | undefined
        const issues = Array.isArray(result.issues) ? result.issues as string[] : []
        if (stats) {
          summary += `\n• Schematic: ${stats.components ?? 0} part(s), ${stats.nets ?? 0} net(s)` +
            `${stats.unconnectedPins ? `, ${stats.unconnectedPins} unconnected pin(s)` : ''}`
          if (issues.length > 0) summary += `\n  ${issues.slice(0, 3).join('; ')}`
        }
        if ('success' in result) {
          const convergence = result.convergenceInfo as { converged?: boolean } | undefined
          summary += `\n• Simulation: ${result.success ? '✓ solved' : `✗ ${String(result.error ?? 'failed')}`}` +
            `${convergence ? convergence.converged ? ' · converged' : ' · did not converge' : ''}`
        }
        if ('shippable' in result) {
          const violations = Array.isArray(result.violations) ? result.violations.length : 0
          summary += `\n• DRC: ${result.shippable ? '✓ shippable' : `✗ ${violations} violation(s)`}`
        }
        if ('traces' in result) summary += `\n• Route: ${String(result.traces)} trace(s) placed`
        if ('files' in result) summary += `\n• Fab package: ${String(result.files)} file(s) prepared`
      }
      if (failed.length > 0) summary += `\n\n${failed.length} step(s) failed or were denied.`
      addMessage({ role: 'agent', content: summary, calls, schematicSvg })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addMessage({ role: 'agent', content: `Error: ${message}`, error: message })
    } finally {
      setRunning(false)
      setPendingApproval(null)
    }
  }, [addMessage, components, harness, input, onCalls, running, wires])

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.map((message) => (
          <div key={message.id} className={`flex gap-2 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {message.role !== 'user' && (
              <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                message.role === 'agent' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
              }`}>
                {message.role === 'agent' ? <Bot size={13} /> : <Terminal size={11} />}
              </div>
            )}
            <div className={`max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
              message.role === 'user'
                ? 'rounded-br-none bg-primary text-primary-foreground'
                : message.role === 'agent'
                  ? 'rounded-bl-none border border-border bg-card text-foreground'
                  : 'w-full bg-transparent py-1 text-center text-muted-foreground'
            }`}>
              <p className="whitespace-pre-wrap">{message.content}</p>

              {message.plan && (
                <div className="mt-2 space-y-1">
                  {message.plan.map((step, index) => (
                    <div key={`${step.tool}-${index}`} className="flex items-start gap-1.5 rounded bg-muted p-1.5 text-xs">
                      <ChevronRight size={10} className="mt-0.5 shrink-0 text-primary" />
                      <div>
                        <span className="font-mono text-primary">{step.tool}</span>
                        <span className="ml-1 text-muted-foreground">{step.rationale}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {message.calls && message.calls.length > 0 && (
                <div className="mt-2 space-y-1">
                  {message.calls.map((call) => (
                    <div key={call.seq} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      {call.error
                        ? <AlertCircle size={10} className="text-destructive" />
                        : <CheckCircle size={10} className="text-success" />}
                      <span className="font-mono">{call.tool}</span>
                      <span className="ml-auto">{call.endedAt - call.startedAt} ms</span>
                    </div>
                  ))}
                </div>
              )}

              {message.schematicSvg && (
                <img
                  src={`data:image/svg+xml;utf8,${encodeURIComponent(message.schematicSvg)}`}
                  alt="Schematic after agent step"
                  className="mt-2 w-full rounded border border-border bg-[#0b1220]"
                />
              )}

              {message.error && (
                <div className="mt-1.5 flex items-start gap-1 text-xs text-destructive">
                  <AlertCircle size={10} className="mt-0.5 shrink-0" />
                  <span>{message.error}</span>
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {pendingApproval && (
        <div className="mx-3 mb-2 rounded-lg border border-warning/50 bg-warning/10 p-3 text-xs">
          <div className="mb-2 flex items-center gap-2">
            <Shield size={13} className="text-warning" />
            <span className="font-semibold text-warning">Approval required</span>
          </div>
          <p className="mb-1 text-warning">
            The agent wants to call{' '}
            <code className="rounded bg-warning/15 px-1 font-mono">{pendingApproval.call.tool}</code>
          </p>
          <p className="mb-2 line-clamp-2 text-muted-foreground">
            Args: {JSON.stringify(pendingApproval.call.args).slice(0, 120)}…
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              className="h-7 bg-success text-xs hover:bg-success/90"
              onClick={() => { pendingApproval.resolve(true); setPendingApproval(null) }}
            >
              <CheckCircle size={11} className="mr-1" />Allow
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 border border-destructive/50 text-xs text-destructive hover:text-destructive"
              onClick={() => { pendingApproval.resolve(false); setPendingApproval(null) }}
            >
              Deny
            </Button>
          </div>
        </div>
      )}

      <div className="relative shrink-0 px-3 pb-1">
        <div className="scrollbar-none flex gap-1.5 overflow-x-auto pb-1">
          {TEMPLATES.map((template) => (
            <button
              key={template.label}
              type="button"
              onClick={() => { void handleSend(template.prompt) }}
              disabled={running}
              className="shrink-0 rounded-full border border-border bg-card px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              {template.label}
            </button>
          ))}
        </div>
        <div className="pointer-events-none absolute inset-y-0 right-3 w-6 bg-gradient-to-l from-background to-transparent" aria-hidden="true" />
      </div>

      <div className="flex shrink-0 gap-2 border-t border-border p-3">
        <Input
          className="h-9 flex-1 border-border bg-card text-sm"
          placeholder="Simulate, route, check DRC, export…"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) void handleSend()
          }}
          disabled={running}
          aria-label="Assistant prompt"
        />
        <Button
          size="sm"
          onClick={() => { void handleSend() }}
          disabled={running || !input.trim()}
          aria-label={running ? 'Sending request' : 'Send message'}
          className="h-9 bg-primary hover:bg-primary/90"
        >
          {running ? <Clock size={14} className="animate-spin" /> : <Send size={14} />}
        </Button>
      </div>
    </div>
  )
}
