/**
 * Context engineering: a token-budgeted pack of the design context.
 *
 * A model can only reason about what fits in its window, so the pack is built
 * in strict priority order — goal, sheet, nets, issues, transcript — and every
 * section is truncated to the remaining budget. What was cut is reported
 * instead of silently omitted, so a planner knows its view is partial.
 * Token counts are the standard characters-per-token estimate (≈ chars/4),
 * not a tokenizer measurement, and are labelled as estimates.
 */

export interface ContextPart {
  reference: string
  name: string
  properties?: Record<string, string | number | boolean>
}

export interface ContextWire {
  id: string
  netName?: string
}

export interface ContextPackInput {
  goal: string
  parts?: ContextPart[]
  wires?: ContextWire[]
  issues?: string[]
  /** Recent tool-call lines, oldest first. */
  transcript?: string[]
  /** Approximate token budget; defaults to 1200. */
  budgetTokens?: number
}

export interface ContextSection {
  id: string
  title: string
  content: string
  tokens: number
}

export interface ContextPack {
  sections: ContextSection[]
  totalTokens: number
  budgetTokens: number
  /** Section ids that could not fit in the budget. */
  dropped: string[]
}

export const DEFAULT_CONTEXT_BUDGET_TOKENS = 1200

const clampBudget = (budget: number): number =>
  Math.max(64, Math.min(32_000, Math.floor(budget)))

/** Standard characters-per-token estimate — approximate by design. */
export const estimateTokens = (text: string): number => (
  text.length === 0 ? 0 : Math.ceil(text.length / 4)
)

const formatValue = (value: string | number | boolean): string =>
  typeof value === 'string' ? value : String(value)

const partLine = (part: ContextPart): string => {
  const properties = part.properties ?? {}
  const entries = Object.entries(properties)
  if (entries.length === 0) return `${part.reference} ${part.name}`
  return `${part.reference} ${part.name} (${entries
    .slice(0, 4)
    .map(([key, value]) => `${key}=${formatValue(value)}`)
    .join(', ')}${entries.length > 4 ? '…' : ''})`
}

const truncateText = (text: string, budgetTokens: number): string => {
  if (estimateTokens(text) <= budgetTokens) return text
  const maxChars = Math.max(1, budgetTokens * 4 - 1)
  return `${text.slice(0, maxChars)}…`
}

export function buildContextPack(input: ContextPackInput): ContextPack {
  const budget = clampBudget(input.budgetTokens ?? DEFAULT_CONTEXT_BUDGET_TOKENS)
  const parts = input.parts ?? []
  const wires = input.wires ?? []
  const issues = input.issues ?? []
  const transcript = input.transcript ?? []

  const sections: ContextSection[] = []
  const dropped: string[] = []
  let remaining = budget

  const push = (id: string, title: string, lines: string[], note: string, required = false): void => {
    if (remaining <= 0) {
      dropped.push(id)
      return
    }
    // The note is part of the body, so fit whole lines first and fall back to
    // fewer lines until body + note fits the remaining budget.
    let body: string | null = null
    for (let count = lines.length; count >= 0; count--) {
      const cut = lines.length - count
      const candidate = count === 0
        ? (lines.length === 0 ? note : '')
        : `${lines.slice(0, count).join('\n')}\n${cut > 0 ? `${note} (${cut} omitted)` : note}`
      if (candidate.trim() !== '' && estimateTokens(candidate) <= remaining) {
        body = candidate
        break
      }
    }
    if (!body) {
      if (!required) {
        dropped.push(id)
        return
      }
      // A required section (the goal) is truncated to the remaining budget
      // rather than dropped: the agent must at least see what was asked.
      body = truncateText(lines[0] ?? note, remaining)
    }
    const tokens = estimateTokens(body)
    sections.push({ id, title, content: body, tokens })
    remaining = Math.max(0, remaining - tokens)
  }

  // Goal always comes first: the reason the agent is running at all.
  push('goal', 'Goal', [input.goal], '', true)
  push(
    'sheet',
    'Sheet',
    parts.map(partLine),
    `${parts.length} part(s) total.`,
  )
  const namedNets = wires.filter((wire) => Boolean(wire.netName?.trim()))
  push(
    'nets',
    'Nets',
    [
      ...(namedNets.length > 0 ? [`Named nets: ${[...new Set(namedNets.map((wire) => wire.netName))].join(', ')}`] : []),
      `${wires.length} wire(s) total.`,
    ],
    '',
  )
  push('issues', 'Issues', issues, issues.length === 0 ? 'No issues listed.' : '')
  push('transcript', 'Recent tool calls', transcript, '')

  return {
    sections,
    totalTokens: sections.reduce((sum, section) => sum + section.tokens, 0),
    budgetTokens: budget,
    dropped,
  }
}
