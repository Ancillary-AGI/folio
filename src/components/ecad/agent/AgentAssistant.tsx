/**
 * Assistant â€” the two-mind surface.
 *
 * Every utterance is routed, not guessed at. A reflex answers what is already
 * measured or what one tool call can do, in microseconds and for nothing. A
 * planner holds the goal, decides one governed tool call at a time, and reads
 * the result back before concluding. A deterministic EDA plan (simulate â†’ route
 * â†’ DRC â†’ fab) still runs when no model is reachable, so the panel does the same
 * jobs it always did. Each reply says which of the three answered.
 *
 * The tools act on the live store the canvas renders, so an agent edit and a
 * human edit are the same edit â€” never a shadow copy.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  Bot,
  Brain,
  CheckCircle,
  ChevronRight,
  Clock,
  Gauge,
  Send,
  Shield,
  SlidersHorizontal,
  Square,
  Terminal,
} from 'lucide-react'
import { Button } from '../../ui/button'
import { Input } from '../../ui/input'
import { AgentHarness, type AgentBudget, type AgentCall } from '../../../lib/agents/agentHarness'
import { registerCadTools, type CadObservation } from '../../../lib/agents/cadTools'
import { createStoreCadRuntime } from '../../../lib/agents/cadRuntime'
import { planEdaFlow, registerEdaTools, type EdaPlanStep } from '../../../lib/agents/edaTools'
import { registerMechanicalTools } from '../../../lib/agents/mechanicalTools'
import { runAgentLoop } from '../../../lib/agents/autopilot'
import { createModelPlanner, deliberateBudget, PlannerUnavailableError } from '../../../lib/agents/system2'
import { routeRequest, type RouteDecision } from '../../../lib/agents/router'
import type { System1Verdict } from '../../../lib/agents/system1'
import { sharedBlackboard } from '../../../lib/agents/blackboard'
import { modelReadiness, resolveEndpoint, useModelSettings } from '../../../lib/models/settings'
import { buildCircuitNetlist } from '../../../lib/simulation/netlistBuilder'
import type { SimulationParameters } from '../../../lib/simulation/spiceEngine'
import type { CanvasComponent, CanvasWire } from '../../../stores/useProjectStore'
import { useProjectStore } from '../../../stores/useProjectStore'

const TEMPLATES = [
  { label: 'Inspect schematic', prompt: 'Describe the schematic, its parts and nets, and what is connected.' },
  { label: 'Simulate circuit', prompt: 'Run a DC operating point simulation on the current schematic.' },
  { label: 'Transient run', prompt: 'Run a transient simulation and report whether the circuit settles.' },
  { label: 'Check DRC', prompt: 'Run design rule checks against JLCPCB profile on the current board.' },
  { label: 'Auto-route board', prompt: 'Convert the schematic to PCB and auto-route all traces on 2 layers.' },
  { label: 'Export for fab', prompt: 'Generate a complete Gerber + Excellon + centroid package for JLCPCB.' },
  { label: 'Analyse signal integrity', prompt: 'Analyse trace impedance and reflection on the current PCB layout.' },
]

/**
 * Ceiling for the sheet pack handed to the planner. The model's own context
 * window is its business; this only bounds what Folio sends about the design, so
 * a 400-part board cannot crowd the instructions out of the prompt.
 */
const CONTEXT_BUDGET_TOKENS = 6000

type Args = Record<string, string | number | boolean>

type Mind = 'reflex' | 'planner' | 'plan'

const MIND_LABEL: Record<Mind, string> = { reflex: 'Reflex', planner: 'Planner', plan: 'EDA plan' }

interface ChatMessage {
  id: string
  role: 'user' | 'agent' | 'system'
  content: string
  timestamp: number
  /** Which mind answered, so an answer can be trusted or doubted appropriately. */
  mind?: Mind
  mindDetail?: string
  plan?: EdaPlanStep[]
  calls?: AgentCall[]
  schematicSvg?: string
  error?: string
  /** Set when the answer needed a model that is not reachable: offers the fix. */
  needsModels?: boolean
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

/**
 * The harness counts every call it has made this session against a budget, so a
 * turn's allowance is the trail so far plus what this turn may spend. Expressed
 * any other way, the fourth message of a session would find its budget already
 * spent by the first three.
 */
function turnBudget(harness: AgentHarness, allowance: { maxCalls: number; maxWallMs: number }): AgentBudget {
  return {
    maxCalls: harness.auditTrail().length + allowance.maxCalls,
    maxWallMs: allowance.maxWallMs,
    startedAt: Date.now(),
  }
}

/** A schematic snapshot from whichever call last produced one. */
function svgFromCalls(calls: readonly AgentCall[]): string | undefined {
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    const observation = calls[index].result as { schematicSvg?: unknown } | undefined
    if (typeof observation?.schematicSvg === 'string' && observation.schematicSvg) return observation.schematicSvg
  }
  return undefined
}

/**
 * Only numbers the tools returned, in the tools' own words. A sentence written
 * here is a sentence someone can check against an audit entry.
 */
function summariseCalls(calls: readonly AgentCall[]): string {
  const succeeded = calls.filter((call) => !call.error && call.approved)
  const failed = calls.filter((call) => call.error || !call.approved)
  let summary = `Completed ${succeeded.length} of ${calls.length} step(s).`
  for (const call of succeeded) {
    const result = call.result as Record<string, unknown> | undefined
    if (!result || typeof result !== 'object') continue
    const stats = result.stats as { components?: number; nets?: number; unconnectedPins?: number } | undefined
    const issues = Array.isArray(result.issues) ? result.issues as string[] : []
    if (stats) {
      summary += `\nâ€¢ Schematic: ${stats.components ?? 0} part(s), ${stats.nets ?? 0} net(s)` +
        `${stats.unconnectedPins ? `, ${stats.unconnectedPins} unconnected pin(s)` : ''}`
      if (issues.length > 0) summary += `\n  ${issues.slice(0, 3).join('; ')}`
    }
    if ('success' in result) {
      const convergence = result.convergenceInfo as { converged?: boolean } | undefined
      summary += `\nâ€¢ Simulation: ${result.success ? 'solved' : `failed â€” ${String(result.error ?? 'unknown error')}`}` +
        `${convergence ? convergence.converged ? ' Â· converged' : ' Â· did not converge' : ''}`
    }
    if ('shippable' in result) {
      const violations = Array.isArray(result.violations) ? result.violations.length : 0
      summary += `\nâ€¢ DRC: ${result.shippable ? 'shippable' : `not shippable â€” ${violations} violation(s)`}`
    }
    if ('traces' in result) summary += `\nâ€¢ Route: ${String(result.traces)} trace(s) placed`
    if ('files' in result) summary += `\nâ€¢ Fab package: ${String(result.files)} file(s) prepared`
  }
  if (failed.length > 0) summary += `\n\n${failed.length} step(s) failed or were denied.`
  return summary
}

interface AgentAssistantProps {
  onCalls?: (calls: AgentCall[]) => void
  /** Jumps to the Models tab when the answer was waiting on a model. */
  onOpenModels?: () => void
}

export default function AgentAssistant({ onCalls, onOpenModels }: AgentAssistantProps) {
  const components = useProjectStore((state) => state.components)
  const wires = useProjectStore((state) => state.wires)
  const settings = useModelSettings((state) => state.settings)
  const apiKey = useModelSettings((state) => state.apiKey)

  const [messages, setMessages] = useState<ChatMessage[]>([{
    id: 'welcome',
    role: 'system',
    content: 'Engineering assistant ready. Ask for a measurement, a simulation, DRC, routing, a fabrication package, ' +
      'or a change to a part. The cad.* tools observe and edit the live sheet; mechanical parts are editable through mech.*. ' +
      'Each request is routed: a reflex answers what is already measured, a planner handles anything multi-step, ' +
      'and a fixed EDA plan runs when no model is reachable.',
    timestamp: Date.now(),
  }])
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [pendingApproval, setPendingApproval] = useState<{
    call: { tool: string; args: Args }
    resolve: (value: boolean) => void
  } | null>(null)
  const [harness] = useState(() => {
    const instance = new AgentHarness()
    // The cad.* tools act on the same store the canvas renders, so an agent
    // edit and a human edit are the same edit â€” never a shadow copy.
    registerCadTools(instance, createStoreCadRuntime())
    registerEdaTools(instance)
    registerMechanicalTools(instance)
    return instance
  })
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const availability = useMemo(
    () => modelReadiness(settings, apiKey),
    [settings, apiKey],
  )

  useEffect(() => () => { abortRef.current?.abort() }, [])

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

  const approve = useCallback((tool: string, args: Args): Promise<boolean> =>
    new Promise((resolve) => {
      setPendingApproval({ call: { tool, args }, resolve })
    }), [])

  /** The single measurement the router needs before it can decide anything. */
  const observeSheet = useCallback(async (): Promise<CadObservation | null> => {
    try {
      const call = await harness.call(
        'cad.observe',
        {},
        turnBudget(harness, { maxCalls: 1, maxWallMs: 15_000 }),
        () => true,
      )
      if (call.error) {
        addMessage({ role: 'agent', content: `Could not read the sheet: ${call.error}`, error: call.error })
        return null
      }
      return call.result as CadObservation
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addMessage({ role: 'agent', content: `Could not read the sheet: ${message}`, error: message })
      return null
    }
  }, [addMessage, harness])

  /**
   * The deterministic flow the panel had before there were models: map the
   * request onto a named plan and run it. Returns false when the request maps to
   * nothing, so the caller can say which mind was missing instead of failing quiet.
   */
  const runEdaPlan = useCallback(async (text: string): Promise<boolean> => {
    let netlist: string
    try {
      netlist = JSON.stringify(buildCircuitNetlist('agent-assistant', components, wires, analysisForPrompt(text)))
    } catch (netlistError) {
      addMessage({
        role: 'agent',
        content: `The sheet cannot be netlisted yet: ${netlistError instanceof Error ? netlistError.message : String(netlistError)}`,
        error: String(netlistError),
      })
      return true
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
    if (!plan || plan.steps.length === 0) return false

    addMessage({
      role: 'agent',
      content: `Plan: ${plan.goal}\n${plan.steps.map((step, index) => `${index + 1}. [${step.tool}] ${step.rationale}`).join('\n')}`,
      plan: plan.steps,
      mind: 'plan',
      mindDetail: 'fixed flow, no model involved',
    })

    const budget = turnBudget(harness, { maxCalls: 20, maxWallMs: 60_000 })
    const calls: AgentCall[] = []
    for (const step of plan.steps) {
      setStatus(`${step.tool} â€” ${step.rationale}`)
      const call = await harness.call(step.tool, step.args, budget, approve)
      calls.push(call)
      onCalls?.([...harness.auditTrail()])
      if (call.error) break
    }

    addMessage({
      role: 'agent',
      content: summariseCalls(calls),
      calls,
      mind: 'plan',
      mindDetail: `${calls.length} step(s) Â· deterministic`,
      schematicSvg: svgFromCalls(calls),
    })
    return true
  }, [addMessage, approve, components, harness, onCalls, wires])

  /** One gated tool call, answered without a model. */
  const runReflex = useCallback(async (fast: System1Verdict, route: RouteDecision) => {
    const detail = `${route.elapsedMs} ms Â· no model called`
    if (!fast.call) {
      addMessage({ role: 'agent', content: fast.reply ?? 'I had no verified answer for that.', mind: 'reflex', mindDetail: detail })
      return
    }
    if (fast.reply) {
      addMessage({ role: 'agent', content: fast.reply, mind: 'reflex', mindDetail: detail })
    }
    setStatus(`${fast.call.tool} â€” ${route.reason}`)
    const call = await harness.call(
      fast.call.tool,
      fast.call.args,
      turnBudget(harness, { maxCalls: 2, maxWallMs: 60_000 }),
      approve,
    )
    onCalls?.([...harness.auditTrail()])
    addMessage({
      role: 'agent',
      content: summariseCalls([call]),
      calls: [call],
      mind: 'reflex',
      mindDetail: detail,
      schematicSvg: svgFromCalls([call]),
      error: call.error ?? undefined,
    })
  }, [addMessage, approve, harness, onCalls])

  /** The planner: observe â†’ decide one call â†’ read the result, until it stops. */
  const runDeliberate = useCallback(async (
    text: string,
    observation: CadObservation,
    route: RouteDecision,
    signal: AbortSignal,
  ) => {
    const planner = createModelPlanner(
      text,
      {
        endpoint: resolveEndpoint(settings, apiKey),
        model: settings.plannerModel,
        reasoningEffort: settings.reasoningEffort,
        temperature: settings.temperature,
        contextBudgetTokens: CONTEXT_BUDGET_TOKENS,
        signal,
      },
      harness,
      sharedBlackboard(),
      observation,
    )

    const trailBefore = harness.auditTrail().length
    const failure: { message: string | null; unreachable: boolean } = { message: null, unreachable: false }

    const result = await runAgentLoop({
      harness,
      decide: async (context) => {
        try {
          return await planner.decide(context)
        } catch (error) {
          failure.unreachable = error instanceof PlannerUnavailableError
          failure.message = error instanceof Error ? error.message : String(error)
          throw error
        }
      },
      budget: turnBudget(harness, deliberateBudget()),
      approve,
      signal,
      onEvent: (event) => {
        setStatus(`${event.message} Â· ${harness.auditTrail().length - trailBefore} call(s) this turn`)
      },
    })

    // `result.calls` is the whole session trail; only this turn's calls belong to
    // this answer, or every reply would claim the credit for all of them.
    const calls = harness.auditTrail().slice(trailBefore)
    onCalls?.([...harness.auditTrail()])

    const tokens = planner.state.tokens.input + planner.state.tokens.output
    // The model's own words first, then what the tools actually returned: a
    // summary is a claim until it sits next to the measurements behind it.
    const evidence = summariseCalls(calls)
    let content = result.summary ? `${result.summary}\n\n${evidence}` : evidence
    const meaningful = calls.filter((call) => !call.error && call.tool !== 'cad.observe')
    let fellBack = false
    if (failure.unreachable && meaningful.length === 0) {
      content += '\n\nThe model could not be reached, so the fixed EDA plan is being tried instead.'
      fellBack = true
    }

    addMessage({
      role: 'agent',
      content,
      calls,
      mind: 'planner',
      mindDetail: `${route.elapsedMs} ms to route Â· ${calls.length} call(s) Â· ${tokens} tokens`,
      schematicSvg: svgFromCalls(calls),
      error: failure.message ?? undefined,
    })
    if (fellBack) {
      const handled = await runEdaPlan(text)
      if (!handled) {
        addMessage({
          role: 'agent',
          content: 'The fixed EDA plan has no flow for that request either, so nothing ran. ' +
            'A reachable model in Models is what turns this into a plan.',
          needsModels: true,
        })
      }
    }
  }, [addMessage, apiKey, approve, harness, onCalls, runEdaPlan, settings])

  const handleSend = useCallback(async (promptText?: string) => {
    const text = (promptText ?? input).trim()
    if (!text || running) return
    setInput('')
    addMessage({ role: 'user', content: text })
    setRunning(true)
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const observation = await observeSheet()
      if (!observation || controller.signal.aborted) return

      const route = routeRequest(text, {
        observation,
        board: sharedBlackboard(),
        fingerprint: observation.fingerprint,
        tools: harness.toolSpecs(),
        availability,
      })

      if (route.choice === 'system1' && route.fast) {
        await runReflex(route.fast, route)
        return
      }
      if (route.choice === 'system2') {
        await runDeliberate(text, observation, route, controller.signal)
        return
      }

      const handled = await runEdaPlan(text)
      if (!handled) {
        addMessage({
          role: 'agent',
          content: `${route.reason}` +
            (route.fast?.reply ? `\n\nWhat I can say without one: ${route.fast.reply}` : '') +
            '\n\nOpen Models to point me at a local server or your own key, or use a template below for a fixed flow.',
          needsModels: true,
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addMessage({ role: 'agent', content: `Error: ${message}`, error: message })
    } finally {
      setRunning(false)
      setStatus(null)
      setPendingApproval(null)
      abortRef.current = null
    }
  }, [addMessage, availability, harness, input, observeSheet, runDeliberate, runEdaPlan, runReflex, running])

  const stop = useCallback(() => { abortRef.current?.abort() }, [])

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-3">
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
              {message.mind && (
                <div className="mb-1 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                  {message.mind === 'reflex'
                    ? <Gauge size={9} className="text-success" />
                    : message.mind === 'planner'
                      ? <Brain size={9} className="text-primary" />
                      : <SlidersHorizontal size={9} className="text-info" />}
                  <span>{MIND_LABEL[message.mind]}{message.mindDetail ? ` Â· ${message.mindDetail}` : ''}</span>
                </div>
              )}
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

              {message.needsModels && onOpenModels && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onOpenModels}
                  className="mt-2 h-7 border border-border text-xs text-primary hover:bg-muted"
                >
                  <SlidersHorizontal size={11} className="mr-1" />Open Models
                </Button>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {status && (
        <p
          role="status"
          aria-live="polite"
          className="mx-3 mb-2 flex items-start gap-1.5 rounded-md border border-border bg-card px-2 py-1.5 text-xs text-muted-foreground"
        >
          <Brain size={11} className="mt-0.5 shrink-0 animate-pulse text-primary" />
          <span>{status}</span>
        </p>
      )}

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
            Args: {JSON.stringify(pendingApproval.call.args).slice(0, 120)}â€¦
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
        <div className="flex flex-wrap gap-1.5">
          {TEMPLATES.map((template) => (
            <button
              key={template.label}
              type="button"
              onClick={() => { void handleSend(template.prompt) }}
              disabled={running}
              className="cad-ctl shrink-0"
            >
              {template.label}
            </button>
          ))}
        </div>
        <div className="pointer-events-none absolute inset-y-0 right-3 w-6 bg-gradient-to-l from-background to-transparent" aria-hidden="true" />
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-border p-3">
        <span
          className="cad-chip shrink-0"
          title={availability.ready
            ? `The planner will use ${availability.reason}`
            : `No model reachable, so only reflexes and fixed EDA plans run: ${availability.reason}`}
        >
          {availability.ready ? 'Planner ready' : 'Reflexes only'}
        </span>
        <Input
          className="h-9 flex-1 border-input bg-card text-sm"
          placeholder="Simulate, route, check DRC, exportâ€¦"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) void handleSend()
          }}
          disabled={running}
          aria-label="Assistant prompt"
        />
        {running ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={stop}
            aria-label="Stop this agent run"
            className="h-9 border border-destructive/50 text-destructive hover:bg-transparent hover:text-destructive"
          >
            <Square size={12} className="mr-1" />Stop
          </Button>
        ) : null}
        <Button
          size="sm"
          onClick={() => { void handleSend() }}
          disabled={running || !input.trim()}
          aria-label={running ? 'Sending request' : 'Send message'}
          className="h-9 bg-primary hover:bg-primary/90"
          title="Run this request through the agent and watch it work on the live design.">
          {running ? <Clock size={14} className="animate-spin" /> : <Send size={14} />}
        </Button>
      </div>
    </div>
  )
}

