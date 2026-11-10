/**
 * The router: which mind answers.
 *
 * Human cognition has this split, and so does a well-built agent. System 1 is
 * fast, cheap and certain about the obvious; System 2 is slow, costs tokens and
 * is the only one allowed to plan. Sending every utterance through a model is
 * both slower and more expensive than a designer needs, and sending none through
 * one is not an agent — so the decision is explicit, stated in the transcript,
 * and reversible.
 *
 * The thresholds are deliberately blunt, because the failure modes are not
 * symmetric: a wrong reflex answer costs trust, a needless escalation costs a
 * few cents and a second. So the fast path only wins when it is confident and
 * the request is single-step.
 */
import type { Blackboard } from './blackboard'
import type { System1Verdict } from './system1'
import { system1Respond } from './system1'
import type { AgentTool } from './agentHarness'
import type { CadObservation } from './cadTools'

export type RouteChoice = 'system1' | 'system2' | 'unavailable'

export interface RouteDecision {
  choice: RouteChoice
  /** Always said out loud: a user should know which mind answered. */
  reason: string
  /** Set on the fast path; it carries the reply or the single tool call. */
  fast?: System1Verdict
  /** True when the reflex knew something even though the planner took over. */
  escalated: boolean
  elapsedMs: number
}

/** Mirrors `modelReadiness` from the settings store, without importing the store. */
export interface ModelAvailability {
  ready: boolean
  reason: string
}

export interface RouterContext {
  observation: CadObservation
  board: Blackboard
  fingerprint: string
  tools: readonly AgentTool[]
  availability: ModelAvailability
}

/** Below this, the reflex does not answer — it was not sure, so the planner runs. */
export const FAST_CONFIDENCE_FLOOR = 0.7

/**
 * Markers of a request that needs a plan rather than a reflex. Multi-step,
 * causal, comparative, or open-ended: none of these can be answered by looking
 * one thing up.
 */
const DELIBERATE_MARKERS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: 'a sequence of steps', pattern: /\b(then|after that|next|and then|finally|in that case)\b/ },
  { label: 'a question about cause or comparison', pattern: /\b(why|because|explain|compare|versus|trade-?offs?|which is better)\b/ },
  { label: 'a search over parameters', pattern: /\b(optimi[sz]e|tune|search|iterate|improve|maximi[sz]e|minimi[sz]e|balance)\b/ },
  { label: 'an open design task', pattern: /\b(design|plan|lay out|rework|redesign|figure out|work out)\b/ },
  { label: 'a conditional', pattern: /\b(if |unless |otherwise |whenever )/ },
  // Two imperatives in one sentence means more than one step.
  { label: 'more than one instruction', pattern: /\b(place|wire|delete|move|rotate|simulate|route|export|add|remove)\b.*\b(place|wire|delete|move|rotate|simulate|route|export|add|remove)\b/ },
]

/** A reflex that names exactly one registered tool is safe to run. */
function reflexIsExecutable(verdict: System1Verdict, tools: readonly AgentTool[]): boolean {
  if (!verdict.call) return Boolean(verdict.reply)
  return tools.some((tool) => tool.name === verdict.call?.tool)
}

export function routeRequest(request: string, context: RouterContext): RouteDecision {
  const startedAt = Date.now()
  const text = request.toLowerCase()
  const fast = system1Respond(request, {
    observation: context.observation,
    board: context.board,
    fingerprint: context.fingerprint,
  })
  const marker = DELIBERATE_MARKERS.find((entry) => entry.pattern.test(text))

  if (marker && fast.confidence < 0.95) {
    if (!context.availability.ready) {
      return {
        choice: 'unavailable',
        reason: `This carries ${marker.label}, which needs a plan — and no model is reachable: ${context.availability.reason}`,
        fast,
        escalated: false,
        elapsedMs: Date.now() - startedAt,
      }
    }
    return {
      choice: 'system2',
      reason: `The request carries ${marker.label}, so it goes to the planner instead of a lookup.`,
      fast,
      escalated: fast.confidence > 0,
      elapsedMs: Date.now() - startedAt,
    }
  }

  if (fast.confidence >= FAST_CONFIDENCE_FLOOR && reflexIsExecutable(fast, context.tools)) {
    return { choice: 'system1', reason: fast.basis, fast, escalated: false, elapsedMs: Date.now() - startedAt }
  }

  if (!context.availability.ready) {
    // No model, and the reflex is unsure. Say which, and what to do about it,
    // instead of either failing silently or guessing.
    return {
      choice: 'unavailable',
      reason: `The reflex was not certain (${Math.round(fast.confidence * 100)}%): ${fast.basis} No model is reachable either: ${context.availability.reason}`,
      fast,
      escalated: false,
      elapsedMs: Date.now() - startedAt,
    }
  }

  return {
    choice: 'system2',
    reason: `${fast.basis} A model is configured, so the planner takes it from here.`,
    fast,
    escalated: fast.confidence > 0,
    elapsedMs: Date.now() - startedAt,
  }
}
