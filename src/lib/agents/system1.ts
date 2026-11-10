/**
 * System 1 — the fast path.
 *
 * Recognition without reasoning: what a designer says is usually one of a few
 * hundred things, and the sheet has already been measured. This answers from the
 * blackboard and the live observation, in microseconds, with no model call and
 * no token cost. It is also the path that runs when no model is configured, so
 * "bring your own key" is an enhancement rather than a dependency.
 *
 * It deliberately stops short of anything multi-step. A reflex that guesses at a
 * plan is how an assistant ends up doing the wrong thing quickly; when this
 * cannot answer with certainty it says so, and the router escalates.
 */
import type { Blackboard } from './blackboard'
import type { CadObservation } from './cadTools'

type Args = Record<string, string | number | boolean>

export type FastIntent =
  | { kind: 'greeting' }
  | { kind: 'help' }
  | { kind: 'sheet-stats' }
  | { kind: 'fact'; subject: string; property?: string }
  | { kind: 'set-value'; subject: string; value: string }
  | { kind: 'analysis'; analysis: 'dc' | 'operating-point' | 'transient' | 'ac' | 'noise' }
  | { kind: 'check' }
  | { kind: 'observe' }
  | { kind: 'unknown' }

export interface System1Verdict {
  intent: FastIntent
  /** Set when the reflex can name the single tool call the request implies. */
  call?: { tool: string; args: Args }
  reply?: string
  /** 0…1. Below `ROUTER_FAST_THRESHOLD` the request goes to System 2. */
  confidence: number
  /** Why this was answerable without a model, in the user's terms. */
  basis: string
}

const GREETING = /^(hi|hey|hello|yo|good (morning|afternoon|evening))\b/
const HELP = /\b(what can you do|help|commands?|capabilities|how do i use you)\b/
const STATS = /\b(how many|how much|what'?s? on the sheet|count|tally|summar(y|ie)s? the (sheet|design|schematic))\b/
const OBSERVE = /\b(what does the sheet look like|show me the (sheet|schematic)|describe the (sheet|schematic|design)|current state)\b/
const CHECK = /\b(check|erc|verify|validate|is there anything wrong|any (errors|issues)|lint)\b/
const ANALYSES: Array<{ analysis: 'dc' | 'operating-point' | 'transient' | 'ac' | 'noise'; pattern: RegExp }> = [
  { analysis: 'operating-point', pattern: /\b(operating point|bias point|dc bias|quiescent)\b/ },
  { analysis: 'transient', pattern: /\b(transient|time (domain|response)|step response|waveform|run for)\b/ },
  { analysis: 'ac', pattern: /\b(ac (analysis|sweep|response)|bode|frequency response|gain sweep)\b/ },
  { analysis: 'noise', pattern: /\bnoise\b/ },
  { analysis: 'dc', pattern: /\bdc (sweep|analysis|sweep it)|\.dc\b|\bsweep\b/ },
]

/** `R1`, `C3`, `U2A`, `net VCC`, `N_12` — the references a designer actually types. */
const REFERENCE = /\b([RULCQDX]\d{1,4}[A-Z]?)\b/i
const NET = /\b(?:net|node)\s+([A-Za-z][\w+]*)/i

/**
 * A one-paragraph edit that needs no judgement: "set R1 to 10k". The reference
 * and the quantity are both in the sentence, so the reflex can name the exact
 * tool call; anything phrased less precisely than that falls through to the
 * planner. The value is captured loosely and then validated by
 * `parseEngineeringValue`, so the strictness lives in one place.
 */
const DIRECTIVE = /\b(?:set|change|make)\s+([RULCQDX]\d{1,4}[A-Z]?)\s+(?:value\s+)?(?:to\s+|=|:)?\s*(.+?)\s*$/i

const scaleFor = (prefix?: string): number =>
  ({ p: 1e-12, n: 1e-9, u: 1e-6, 'µ': 1e-6, m: 1e-3, k: 1e3, M: 1e6, G: 1e9 })[prefix ?? ''] ?? 1

/**
 * Parse a value with its unit the way a schematic label is written, returning
 * the SI number and the unit text to echo back. Deliberately forgiving about
 * case and spacing and strict about nothing else: an unparseable quantity is
 * simply not a quantity, and the request goes to the planner.
 */
export function parseEngineeringValue(text: string): { value: number; unit: string } | null {
  const match = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*(p|n|u|µ|m|k|M|G)?\s*([VvAaFfHhWwΩo][hHmM]?)?$/)
  if (!match) return null
  const [, digits, prefix, unit] = match
  const number = Number(digits)
  if (!Number.isFinite(number)) return null
  const suffix = (unit ?? '').toLowerCase()
  const resolved = suffix === 'v' ? 'V'
    : suffix === 'a' ? 'A'
    : suffix === 'f' ? 'F'
    : suffix === 'h' ? 'H'
    : suffix === 'w' ? 'W'
    : suffix === 'Ω' || suffix === 'o' ? 'Ω'
    : ''
  return { value: number * scaleFor(prefix), unit: resolved }
}

/**
 * A reflex answer from the measured sheet, or `null` when there is nothing
 * verified to say. The `null` is the important branch: silence here is what makes
 * the router escalate instead of inventing.
 */
export function system1Respond(
  request: string,
  context: { observation: CadObservation; board: Blackboard; fingerprint: string },
): System1Verdict {
  const text = request.toLowerCase().trim()
  const { board, observation, fingerprint } = context

  if (!text) return { intent: { kind: 'unknown' }, confidence: 0, basis: 'Nothing was asked.' }

  if (GREETING.test(text) && text.length < 24) {
    return {
      intent: { kind: 'greeting' },
      reply: `Ready. ${observation.stats.components} parts and ${observation.stats.nets} nets on the sheet — ask me to measure, simulate or change something.`,
      confidence: 0.95,
      basis: 'Greeting, answered from the live sheet.',
    }
  }

  if (HELP.test(text) && !/\b(simulate|run|check|place|delete)\b/.test(text)) {
    return {
      intent: { kind: 'help' },
      reply: 'I act through named CAD tools on your real design: observe the sheet, simulate, run ERC, place or change parts, route and export. Ask for one of those, or open Autopilot for a search over parameters.',
      confidence: 0.9,
      basis: 'Capability question, answered from the tool list.',
    }
  }

  if (OBSERVE.test(text)) {
    return {
      intent: { kind: 'observe' },
      call: { tool: 'cad.observe', args: {} },
      confidence: 0.9,
      basis: 'A request to look at the sheet is one tool call, not a plan.',
    }
  }

  if (STATS.test(text)) {
    const facts = board.factsFor({ subject: 'sheet', fingerprint })
    const said = facts.length >= 3
    const source = said ? facts : [
      { property: 'parts', value: observation.stats.components },
      { property: 'nets', value: observation.stats.nets },
      { property: 'wires', value: observation.stats.wires },
    ]
    const line = source
      .map((fact) => `${'property' in fact ? fact.property : ''} ${'value' in fact ? fact.value : ''}`.trim())
      .join(', ')
    return {
      intent: { kind: 'sheet-stats' },
      reply: `The sheet holds ${line}.`,
      confidence: 0.95,
      basis: said ? 'Counted by the canvas, not estimated.' : 'Measured from the current observation.',
    }
  }

  if (CHECK.test(text) && !/\b(simulate|sweep)\b/.test(text)) {
    return {
      intent: { kind: 'check' },
      call: { tool: 'cad.erc', args: {} },
      confidence: 0.88,
      basis: 'A rule check is one tool call with no parameters to decide.',
    }
  }

  const analysis = ANALYSES.find((entry) => entry.pattern.test(text))
  if (analysis) {
    const args: Args = { analysis: analysis.analysis === 'operating-point' ? 'dc' : analysis.analysis }
    if (analysis.analysis === 'transient') {
      const duration = text.match(/\b(\d+(?:\.\d+)?)\s*(ms|us|ns|s)\b/)
      if (duration) {
        const multiplier = duration[2] === 'ms' ? 1e-3 : duration[2] === 'us' ? 1e-6 : duration[2] === 'ns' ? 1e-9 : 1
        args.stopS = Number(duration[1]) * multiplier
      } else {
        // Without a run length the request needs a decision, which is the
        // planner's job — a reflex inventing a duration is how a wrong answer
        // gets produced quickly.
        return {
          intent: { kind: 'analysis', analysis: analysis.analysis },
          confidence: 0.4,
          basis: 'Transient analysis needs a run length the request did not give.',
        }
      }
    }
    return {
      intent: { kind: 'analysis', analysis: analysis.analysis },
      call: { tool: 'cad.simulate', args },
      confidence: 0.9,
      basis: `Named ${analysis.analysis} analysis with everything the tool needs.`,
    }
  }

  const directive = request.match(DIRECTIVE)
  if (directive) {
    const subject = directive[1].toUpperCase()
    // Echo the designer's own spelling onto the part ("10k", "12V"): the parse
    // only proves the text is a quantity, it does not normalise the label.
    const raw = directive[2].trim()
    const quantity = parseEngineeringValue(raw.toLowerCase())
    const component = observation.components.find((entry) => entry.reference.toUpperCase() === subject)
    if (quantity && component) {
      return {
        intent: { kind: 'set-value', subject, value: raw },
        call: { tool: 'cad.setProperty', args: { reference: subject, property: 'value', value: raw } },
        confidence: 0.9,
        basis: `${subject} is on the sheet and "${raw}" is a value — one property change, nothing to decide.`,
      }
    }
    return {
      intent: { kind: 'set-value', subject, value: raw },
      confidence: quantity ? 0.3 : 0.15,
      basis: quantity
        ? `"${subject}" is not on the sheet, so placing and wiring it is a plan, not a reflex.`
        : `"${raw}" did not read as a value, so nothing is written to a part until it does.`,
    }
  }

  const net = request.match(NET)
  if (net) {
    const facts = board.factsFor({ subject: net[1], fingerprint })
    if (facts.length) {
      return {
        intent: { kind: 'fact', subject: net[1] },
        reply: facts.slice(0, 3).map((fact) => `${fact.property} ${fact.value}${fact.unit ? ` ${fact.unit}` : ''}`).join('; '),
        confidence: 0.92,
        basis: `Read back from ${facts[0].instrument} output already on the blackboard.`,
      }
    }
    return {
      intent: { kind: 'fact', subject: net[1] },
      confidence: 0.3,
      basis: `Nothing has been measured about "${net[1]}" yet, so there is no verified number to give.`,
    }
  }

  const reference = request.match(REFERENCE)
  if (reference && /\b(what|value|is|is it|tell me|which)\b/.test(text)) {
    const facts = board.factsFor({ subject: reference[1].toUpperCase(), fingerprint })
    const component = observation.components.find((entry) => entry.reference.toUpperCase() === reference[1].toUpperCase())
    if (facts.length) {
      return {
        intent: { kind: 'fact', subject: reference[1].toUpperCase() },
        reply: facts.slice(0, 3).map((fact) => `${fact.property} ${fact.value}${fact.unit ? ` ${fact.unit}` : ''}`).join('; '),
        confidence: 0.9,
        basis: `Measured value for ${reference[1].toUpperCase()} is on the blackboard.`,
      }
    }
    if (component) {
      const detail = [component.category, component.value].filter(Boolean).join(' ')
      return {
        intent: { kind: 'fact', subject: reference[1].toUpperCase() },
        reply: `${reference[1].toUpperCase()} is ${component.part}${detail ? ` — ${detail}` : ''}, at ${component.x}, ${component.y}.`,
        confidence: 0.85,
        basis: 'Read from the canvas — no simulation was needed to answer that.',
      }
    }
    return {
      intent: { kind: 'fact', subject: reference[1].toUpperCase() },
      confidence: 0.25,
      basis: `"${reference[1]}" is not on the sheet, so the answer has to come from a plan, not a lookup.`,
    }
  }

  return { intent: { kind: 'unknown' }, confidence: 0, basis: 'No reflex matches this request.' }
}
