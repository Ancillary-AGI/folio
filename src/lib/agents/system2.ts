/**
 * System 2 — the deliberate path.
 *
 * This is the loop a real engineering question needs: hold the goal, look at the
 * measured state, decide one step, let the harness run it as a governed tool
 * call, read the result back, and only then conclude. The model supplies the
 * judgement; the CAD tools supply every fact, and nothing here lets the model
 * state a number it did not obtain from a call.
 *
 * Two ways to ask: native function calling when the provider supports it, and a
 * strict JSON fallback when it does not — smaller local models frequently have
 * no tool schema, and an agent that only works with the biggest APIs is not an
 * agent. Both paths end in the same validated `AgentDecision`, and both reject a
 * tool name or parameter the harness has never heard of instead of guessing.
 */
import { Blackboard } from './blackboard'
import type { AgentBudget, AgentCall, AgentHarness, AgentTool } from './agentHarness'
import type { AgentDecision, AgentLoopContext } from './autopilot'
import type { CadObservation } from './cadTools'
import { buildContextPack, estimateTokens } from './contextPack'
import { generateText, ModelCallError } from '../models/client'
import type { GenerationResult, ModelMessage, ResolvedEndpoint, ToolSpec } from '../models/types'
import type { ReasoningEffort } from '../models/types'

type Args = Record<string, string | number | boolean>

export interface PlannerSettings {
  endpoint: ResolvedEndpoint
  model: string
  reasoningEffort: ReasoningEffort
  temperature: number
  /** Prompt ceiling for the pack; the model's own context window is its business. */
  contextBudgetTokens: number
  signal?: AbortSignal
}

export interface PlannerTranscriptEntry {
  role: 'plan' | 'call' | 'result' | 'error'
  text: string
}

export interface DeliberationState {
  goal: string
  board: Blackboard
  /** Model turns kept between steps so a plan has a memory. */
  messages: ModelMessage[]
  history: PlannerTranscriptEntry[]
  tokens: { input: number; output: number }
}

const SYSTEM_RULES = `You are Copilot, the engineering copilot inside Folio, an agentic CAD IDE. Rules, in priority order:
1. You act only through the listed tools. You cannot edit files, run code, or measure anything else.
2. Never state a number you did not receive from a tool result in this conversation. If you need one, call a tool.
3. Prefer the smallest useful step: one tool call per turn, then read what it returned.
4. If the tools cannot answer, say so plainly instead of inventing an answer.
5. When the goal is met, stop and summarise: what changed on the design, what was measured, what is still unknown.
6. Treat the sheet state as the truth. A measurement on an older state has been dropped and is not evidence.

Voice:
- Terse. Numbers and units before adjectives. No praise, no hedging soup, no filler.
- Every claim cites its evidence: the net, the pin, the file value, the tool that produced it.
- Computed results are labelled as computed (solver, 27 °C, ideal parts) unless a tool said otherwise.
- If you cannot verify something, say exactly what is missing and what it would take to know.
- Never say "done", "fixed" or "verified" without the evidence in front of you.`

function toolSpecs(tools: readonly AgentTool[]): ToolSpec[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: `${tool.description}${tool.needsApproval ? ' [requires the user to approve this call]' : ''}`,
    parameters: tool.parameters,
    optionalParameters: tool.optionalParameters,
  }))
}

/**
 * The first prompt. Built as a token-budgeted pack rather than a dump: a big
 * sheet will not fit, and the sections that get cut are reported so the model
 * knows its view is partial instead of confidently complete.
 */
export function buildInitialMessages(
  goal: string,
  observation: CadObservation,
  board: Blackboard,
  tools: readonly AgentTool[],
  budgetTokens: number,
): ModelMessage[] {
  const pack = buildContextPack({
    goal,
    parts: observation.components.map((component) => ({
      reference: component.reference,
      name: component.part,
      properties: component.properties,
    })),
    wires: observation.nets.map((net) => ({ id: net.name, netName: net.name })),
    issues: observation.issues,
    budgetTokens,
  })
  const measured = board.summarize(observation.fingerprint)
  const toolLines = tools.map((tool) => {
    const required = Object.entries(tool.parameters)
      .filter(([key]) => !(tool.optionalParameters ?? []).includes(key))
      .map(([key, type]) => `${key}:${type}`)
    return `- ${tool.name}(${required.join(', ')}) — ${tool.description}`
  })
  const context = pack.sections.map((section) => `## ${section.title}\n${section.content}`).join('\n\n')
  const dropped = pack.dropped.length ? `\n\n(Prompt budget reached; omitted sections: ${pack.dropped.join(', ')}.)` : ''
  return [
    { role: 'system', content: SYSTEM_RULES },
    {
      role: 'system',
      content: `Available tools:\n${toolLines.join('\n')}`,
    },
    {
      role: 'user',
      content: `${context}${dropped}\n\n## Verified measurements\n${measured}\n\nEstimate: ${estimateTokens(context + measured)} tokens of design context. Proceed.`,
    },
  ]
}

function describeResult(result: unknown): string {
  if (result === undefined || result === null) return 'ok'
  if (typeof result === 'string') return result.slice(0, 2000)
  try {
    return JSON.stringify(result).slice(0, 2000)
  } catch {
    return String(result)
  }
}

/** A model's answer, coerced into something the harness will accept. */
export function parseDecision(text: string, tools: readonly AgentTool[]): AgentDecision | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed.slice(start, end + 1))
  } catch {
    return null
  }
  const names = new Set(tools.map((tool) => tool.name))
  const value = parsed as Record<string, unknown>
  if (value.done === true) {
    return { done: true as const, summary: typeof value.summary === 'string' ? value.summary : 'Finished.' }
  }
  const tool = typeof value.tool === 'string' ? value.tool : ''
  if (!names.has(tool)) return null
  const args: Args = {}
  for (const [key, raw] of Object.entries((value.args ?? {}) as Record<string, unknown>)) {
    // Scalars only, because that is the contract AgentTool enforces; a model
    // that returns an object gets it dropped rather than stringified into a lie.
    if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') args[key] = raw
  }
  return {
    tool,
    args,
    rationale: typeof value.rationale === 'string' ? value.rationale : undefined,
  }
}

/** The shape demanded of a model that has no function calling. */
function jsonContract(tools: readonly AgentTool[]): string {
  return `Reply with exactly one JSON object and nothing else:
- one step: {"tool":"<name>","args":{...},"rationale":"<one sentence>"}
- finished: {"done":true,"summary":"<what changed, what was measured, what is unknown>"}
Only these tool names are valid: ${tools.map((tool) => tool.name).join(', ')}.
Use "cad.observe" if you need to see the sheet again; a tool that is not listed does not exist.`
}

/**
 * Turn the measured state into the next move.
 *
 * Returns a decision, or throws a `PlannerUnavailableError` when the model could
 * not be reached — the caller then reports that the run stopped because of the
 * provider, which is true, instead of pretending the design was finished.
 */
export class PlannerUnavailableError extends Error {
  constructor(message: string, readonly hint?: string) {
    super(message)
    this.name = 'PlannerUnavailableError'
  }
}

export interface ModelPlanner {
  decide: (context: AgentLoopContext) => Promise<AgentDecision>
  state: DeliberationState
}

export function createModelPlanner(
  goal: string,
  settings: PlannerSettings,
  harness: AgentHarness,
  board: Blackboard,
  observation: CadObservation,
): ModelPlanner {
  const tools = harness.toolSpecs()
  const specs = toolSpecs(tools)
  const state: DeliberationState = {
    goal,
    board,
    messages: buildInitialMessages(goal, observation, board, tools, settings.contextBudgetTokens),
    history: [],
    tokens: { input: 0, output: 0 },
  }

  const ask = async (prompt: string): Promise<GenerationResult> => {
    state.messages.push({ role: 'user', content: prompt })
    const answer = await generateText(
      settings.endpoint,
      {
        model: settings.model,
        messages: state.messages,
        // Native function calling when the provider speaks it; `jsonContract` in
        // the prompt is what a server without tool support still has to follow,
        // so both paths end in the same validated decision.
        tools: specs,
        temperature: settings.temperature,
        reasoningEffort: settings.reasoningEffort,
      },
      { signal: settings.signal },
    )
    state.tokens.input += answer.usage.inputTokens
    state.tokens.output += answer.usage.outputTokens
    return answer
  }

  const decide = async (context: AgentLoopContext): Promise<AgentDecision> => {
    const stepObservation = context.observation
    const last = context.transcript[context.transcript.length - 1]
    if (last) state.messages.push(...feedLastCall(last))

    // The sheet may have moved since the plan was written; say so in the prompt
    // rather than letting the model reason about a state that no longer exists.
    if (stepObservation.fingerprint !== observation.fingerprint) {
      state.messages.push({
        role: 'system',
        content: `The sheet changed since this plan began: ${stepObservation.stats.components} parts, ${stepObservation.stats.nets} nets, fingerprint ${stepObservation.fingerprint}.`,
      })
    }

    const prompt = [
      `Step ${context.step + 1}. ${context.remainingCalls} tool call(s) left in this budget.`,
      state.history.length
        ? `What has happened:\n${state.history.slice(-6).map((entry) => `- ${entry.role}: ${entry.text}`).join('\n')}`
        : 'Nothing has been done yet.',
      board.size > 0 ? `Verified measurements:\n${board.summarize(stepObservation.fingerprint)}` : '',
      'Decide the next single action.',
      jsonContract(tools),
    ].filter(Boolean).join('\n\n')

    let answer: GenerationResult
    try {
      answer = await ask(prompt)
    } catch (error) {
      if (settings.signal?.aborted) throw error
      const message = error instanceof ModelCallError ? error.message : String(error)
      throw new PlannerUnavailableError(message, error instanceof ModelCallError ? error.hint : undefined)
    }

    const call = answer.toolCalls[0]
    if (call) {
      const known = tools.some((tool) => tool.name === call.name)
      if (!known) {
        state.history.push({ role: 'error', text: `The model asked for "${call.name}", which is not a registered tool.` })
        return { tool: 'cad.observe', args: {}, rationale: 'The model named a tool that does not exist; looking again is the only safe move.' }
      }
      const args: Args = {}
      for (const [key, raw] of Object.entries(call.args)) {
        if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') args[key] = raw
      }
      state.history.push({ role: 'plan', text: `${call.name} ${JSON.stringify(args)}` })
      return { tool: call.name, args, rationale: answer.text.trim() || undefined }
    }

    const parsed = parseDecision(answer.text, tools)
    if (!parsed) {
      // One retry with the contract repeated is worth it: models drift into
      // prose, and losing a whole run to a formatting slip is not acceptable.
      state.history.push({ role: 'error', text: 'The reply was not a valid step; asked once more in the required shape.' })
      const retry = await ask(`That reply cannot be executed. ${jsonContract(tools)}`).catch(() => null)
      const fromRetry = retry ? parseDecision(retry.text, tools) ?? retry.toolCalls[0] : null
      if (fromRetry && 'tool' in fromRetry) return fromRetry
      if (fromRetry && 'done' in fromRetry) return fromRetry
      return { done: true as const, summary: answer.text.trim() || 'The model did not produce an executable step.' }
    }
    state.history.push({ role: 'plan', text: 'done' in parsed ? parsed.summary : `${parsed.tool} ${JSON.stringify(parsed.args ?? {})}` })
    return parsed
  }

  /** Turn a harness call into the transcript the model reads next round. */
  const feedLastCall = (last: AgentCall): ModelMessage[] => {
    const label = last.error ? `failed: ${last.error}` : describeResult(last.result)
    state.history.push({ role: last.error ? 'error' : 'result', text: `${last.tool} → ${label.slice(0, 400)}` })
    const callId = `${last.tool}#${last.seq}`
    // The assistant turn carries the call as a structured tool call, not a JSON
    // string: a provider with function calling rejects a result whose call id
    // does not match one it made itself.
    const messages: ModelMessage[] = [
      { role: 'assistant', content: '', toolCalls: [{ id: callId, name: last.tool, args: { ...last.args } }] },
      { role: 'tool', content: label, toolCallId: callId },
    ]
    if (!last.error) harvestFacts(last, board)
    return messages
  }

  return { decide, state }
}

/**
 * A successful measurement is written to the blackboard as it happens, so the
 * next step — and the next question, minutes later — can cite an instrument
 * result instead of re-running it.
 */
function harvestFacts(last: AgentCall, board: Blackboard): void {
  const result = last.result as { fingerprint?: string; operatingPoint?: Record<string, number>; issues?: string[] } | undefined
  if (!result || typeof result !== 'object') return
  const fingerprint = typeof result.fingerprint === 'string' ? result.fingerprint : ''
  if (!fingerprint) return
  if (last.tool === 'cad.simulate' && result.operatingPoint) {
    for (const [subject, value] of Object.entries(result.operatingPoint)) {
      board.assert({ subject, property: 'node voltage', value, unit: 'V', instrument: 'simulation', fingerprint })
    }
  }
  if (last.tool === 'cad.erc') {
    board.assert({
      subject: 'sheet',
      property: 'ERC issues',
      value: result.issues?.length ?? 0,
      instrument: 'erc',
      fingerprint,
    })
  }
}

/** A budget for a deliberate run: enough to plan, bounded so it cannot roam. */
export function deliberateBudget(maxCalls = 24, wallMs = 180_000): AgentBudget {
  return { maxCalls, maxWallMs: wallMs, startedAt: Date.now() }
}
