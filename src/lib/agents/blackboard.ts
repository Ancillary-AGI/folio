/**
 * The blackboard: what Folio actually knows about the design right now.
 *
 * A language model is not a source of truth about a circuit — a solver is. This
 * is where verified facts live: each one comes from a named instrument (a
 * simulation, an ERC pass, a geometry measurement, the canvas itself) and
 * carries the sheet fingerprint it was measured on. A fact measured on a
 * different sheet is not a fact, it is a stale claim, and `factsFor` refuses it.
 *
 * Both reasoning systems read this. System 1 answers from it directly; System 2
 * must cite it, and a model assertion that contradicts an instrument is rejected
 * rather than relayed. That is the difference between an agent that describes a
 * design and one that hallucinates one.
 */
export type FactInstrument =
  | 'canvas'
  | 'netlist'
  | 'simulation'
  | 'erc'
  | 'drc'
  | 'geometry'
  | 'ratings'
  | 'human'

export interface Fact {
  /** Stable key, e.g. `net.VCC.voltage` or `part.R1.value`. */
  key: string
  subject: string
  property: string
  value: string | number | boolean
  /** Unit as printed, or empty for a dimensionless count. */
  unit: string
  instrument: FactInstrument
  /** Fingerprint of the design state the instrument measured. */
  fingerprint: string
  measuredAt: number
  /**
   * A model's own guess is a hypothesis, never a fact: it can propose, and an
   * instrument has to confirm. This flag is what makes that distinction
   * structural instead of a naming convention.
   */
  verified: boolean
}

export interface FactInput {
  subject: string
  property: string
  value: string | number | boolean
  unit?: string
  instrument: FactInstrument
  fingerprint: string
  verified?: boolean
}

export interface BlackboardQuery {
  subject?: string
  property?: string
  instrument?: FactInstrument
  /** Only facts measured on this exact sheet state. */
  fingerprint?: string
  /** Include unverified hypotheses. Off by default: a guess is not an answer. */
  includeUnverified?: boolean
}

const format = (fact: Fact): string =>
  `${fact.subject} ${fact.property} = ${fact.value}${fact.unit ? ` ${fact.unit}` : ''}`

export class Blackboard {
  private readonly facts = new Map<string, Fact>()
  private readonly history: Fact[] = []

  /**
   * Record a measurement. A fact measured on an older fingerprint is refused
   * with the reason rather than silently kept, because the commonest agent
   * failure is answering correctly about a design that no longer exists.
   */
  assert(input: FactInput, currentFingerprint?: string): { accepted: boolean; reason?: string; fact?: Fact } {
    if (currentFingerprint !== undefined && input.fingerprint !== currentFingerprint) {
      return {
        accepted: false,
        reason: `"${input.subject} ${input.property}" was measured on a different sheet state and was dropped.`,
      }
    }
    const fact: Fact = {
      key: `${input.subject}.${input.property}`,
      subject: input.subject,
      property: input.property,
      value: input.value,
      unit: input.unit ?? '',
      instrument: input.instrument,
      fingerprint: input.fingerprint,
      measuredAt: Date.now(),
      verified: input.verified ?? true,
    }
    this.facts.set(fact.key, fact)
    this.history.push(fact)
    return { accepted: true, fact }
  }

  get(key: string): Fact | undefined {
    return this.facts.get(key)
  }

  /**
   * Facts still true for the given sheet state. The fingerprint filter is not
   * optional decoration: every reader of the blackboard gets staleness
   * protection by default.
   */
  factsFor(query: BlackboardQuery): Fact[] {
    return [...this.facts.values()]
      .filter((fact) => (query.subject === undefined || fact.subject === query.subject))
      .filter((fact) => (query.property === undefined || fact.property === query.property))
      .filter((fact) => (query.instrument === undefined || fact.instrument === query.instrument))
      .filter((fact) => (query.fingerprint === undefined || fact.fingerprint === query.fingerprint))
      .filter((fact) => (query.includeUnverified ? true : fact.verified))
      .sort((a, b) => b.measuredAt - a.measuredAt)
  }

  /** Every measurement this board has taken, oldest first — the audit trail. */
  log(): readonly Fact[] {
    return this.history
  }

  /**
   * Does an instrument contradict this claim? Used by the verifier before a
   * model's sentence is allowed to reach the user.
   */
  contradictionOf(claim: FactInput): Fact | undefined {
    const existing = this.facts.get(`${claim.subject}.${claim.property}`)
    if (!existing || !existing.verified) return undefined
    if (existing.fingerprint !== claim.fingerprint) return undefined
    return String(existing.value) === String(claim.value) ? undefined : existing
  }

  /** Drop everything measured on other sheet states, e.g. after an undo. */
  pruneTo(fingerprint: string): number {
    let dropped = 0
    for (const [key, fact] of this.facts) {
      if (fact.fingerprint !== fingerprint) {
        this.facts.delete(key)
        dropped += 1
      }
    }
    return dropped
  }

  clear(): void {
    this.facts.clear()
  }

  /** One line per fact, for the prompt: models read tables better than prose. */
  summarize(fingerprint?: string): string {
    const rows = this.factsFor({ fingerprint })
    if (!rows.length) return 'No verified measurements.'
    return rows.slice(0, 40).map(format).join('\n')
  }

  get size(): number {
    return this.facts.size
  }
}

/**
 * Read the instruments' own outputs into facts. Each converter is small and
 * explicit so that a new solver reports its results by adding one function here
 * rather than by teaching a panel to improvise.
 */
export function factsFromSimulation(
  fingerprint: string,
  operatingPoint: Record<string, number>,
): FactInput[] {
  return Object.entries(operatingPoint).map(([subject, value]) => ({
    subject,
    property: 'node voltage',
    value: Number(value.toFixed(6)),
    unit: 'V',
    instrument: 'simulation' as const,
    fingerprint,
  }))
}

export function factsFromErc(fingerprint: string, issues: readonly string[]): FactInput[] {
  return [{
    subject: 'sheet',
    property: 'ERC issues',
    value: issues.length,
    unit: issues.length === 1 ? 'issue' : 'issues',
    instrument: 'erc',
    fingerprint,
  }]
}

/** The design as the canvas sees it — the facts a question is usually asking about. */
export function factsFromObservation(
  fingerprint: string,
  stats: { components: number; nets: number; wires: number },
): FactInput[] {
  const sheet = String(fingerprint)
  return [
    { subject: 'sheet', property: 'parts', value: stats.components, instrument: 'canvas', fingerprint: sheet },
    { subject: 'sheet', property: 'nets', value: stats.nets, instrument: 'canvas', fingerprint: sheet },
    { subject: 'sheet', property: 'wires', value: stats.wires, instrument: 'canvas', fingerprint: sheet },
  ]
}

let shared: Blackboard | undefined

/**
 * One board per running app: the panels and the agent must not maintain separate
 * ideas of what was measured. Tests create their own instance.
 */
export function sharedBlackboard(): Blackboard {
  shared ??= new Blackboard()
  return shared
}
