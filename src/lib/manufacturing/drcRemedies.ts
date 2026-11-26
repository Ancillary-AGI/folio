/**
 * Machine-actionable remedies for DRC findings: which tool call resolves a
 * violation, and with what arguments.
 *
 * Every tool named is one the harness registers, and every remedy ends at
 * `eda.drc`. `automatic` means the geometry misses a stated number; otherwise
 * the finding is about placement and the caller must choose.
 */
import type { DRCSettings, DRCViolation } from './drc'

/** The tool that applies a remedy, and the arguments to call it with. */
export interface DrcRemedy {
  /** Agent tool that performs the fix. */
  tool: string
  /** Arguments for that tool, filled from the violation where possible. */
  args: Record<string, unknown>
  /** One sentence a person can act on. */
  instruction: string
  /**
   * True when the fix is mechanical: the geometry should be brought up to the
   * stated requirement and no placement judgement is involved.
   */
  automatic: boolean
  /** The call that confirms the fix. */
  recheck: { tool: string; args: Record<string, unknown> }
}

const RECHECK = { tool: 'eda.drc', args: {} } as const

const mm = (value: number): string => `${Number(value.toFixed(4))} mm`

/**
 * The remedy for one violation.
 *
 * The `value`/`required` pair on a violation is the measurement and the rule;
 * where both are present the instruction states the shortfall numerically, which
 * is what makes it checkable rather than advisory.
 */
export function remedyFor(violation: DRCViolation, settings: DRCSettings): DrcRemedy {
  const { type, value, required, elementId } = violation
  const shortfall =
    typeof value === 'number' && typeof required === 'number' && required > value
      ? required - value
      : undefined
  const scope = elementId ? { elementId } : {}

  switch (type) {
    case 'width':
      return {
        tool: 'eda.addTrace',
        args: scope,
        instruction:
          shortfall !== undefined
            ? `Re-route this trace at ${mm(required ?? 0)} wide (at least ${mm(shortfall)} wider than it is), or lower the board minimum if your fabricator allows it.`
            : `Re-route this trace at ${mm(settings.minTraceWidth)} or wider.`,
        automatic: true,
        recheck: RECHECK,
      }

    case 'clearance':
      return {
        tool: 'eda.movePart',
        args: scope,
        instruction:
          shortfall !== undefined
            ? `Move the offending part or re-route the trace to open a gap of ${mm(shortfall)}; the board requires ${mm(settings.minTraceClearance)}.`
            : `Open the gap between these copper features to at least ${mm(settings.minTraceClearance)}.`,
        automatic: false,
        recheck: RECHECK,
      }

    case 'drill':
      return {
        tool: 'eda.addVia',
        args: scope,
        instruction:
          shortfall !== undefined
            ? `Replace the via with one whose drill is at least ${mm(required ?? 0)} (${mm(shortfall)} larger), or move to a process that supports the smaller drill.`
            : `Use a via with a drill of at least ${mm(settings.minViaDrillDiameter)}.`,
        automatic: true,
        recheck: RECHECK,
      }

    case 'annular_ring':
      return {
        tool: 'eda.addVia',
        args: scope,
        instruction: `Increase the pad diameter or reduce the drill so the copper ring is at least ${mm(
          settings.minAnnularRing,
        )} all round.`,
        automatic: true,
        recheck: RECHECK,
      }

    case 'courtyard_overlap':
      return {
        tool: 'eda.movePart',
        args: scope,
        instruction: `Move or rotate the parts so their courtyards clear by ${mm(
          settings.minCourtyardClearance,
        )}; placement order and connector access decide which one moves.`,
        automatic: false,
        recheck: RECHECK,
      }

    case 'unconnected_net':
      return {
        tool: 'eda.route',
        args: scope,
        instruction:
          'Route this net, or mark the deliberately unconnected pins as no-connect — an unrouted net is a net that will not work.',
        automatic: false,
        recheck: RECHECK,
      }

    case 'acute_angle':
      return {
        tool: 'eda.route',
        args: scope,
        instruction:
          'Re-route the offending segment with 45° or arc corners; an acute angle traps etchant and is a manufacturing defect, not a cosmetic one.',
        automatic: false,
        recheck: RECHECK,
      }

    case 'trace_length':
      return {
        tool: 'eda.route',
        args: scope,
        instruction:
          shortfall !== undefined
            ? `Shorten this trace by at least ${mm(shortfall)} or re-route it on a shorter path; the limit is ${mm(settings.maxTraceLength)}.`
            : `Bring this trace under ${mm(settings.maxTraceLength)}.`,
        automatic: false,
        recheck: RECHECK,
      }

    case 'keepout':
      return {
        tool: 'eda.movePart',
        args: scope,
        instruction:
          'Move the copper or the part out of the keepout, or shrink the keepout if it was drawn larger than the mechanism it protects.',
        automatic: false,
        recheck: RECHECK,
      }

    case 'outline':
      return {
        tool: 'eda.movePart',
        args: scope,
        instruction:
          'Bring the copper inside the board outline, or enlarge the outline if the edge is where the part belongs.',
        automatic: false,
        recheck: RECHECK,
      }

    default: {
      // Exhaustiveness guard: adding a rule type without a remedy must not
      // compile, so a new rule cannot ship without advice.
      const exhaustive: never = type
      return {
        tool: 'eda.drc',
        args: {},
        instruction: `Resolve the reported finding (${String(exhaustive)}).`,
        automatic: false,
        recheck: RECHECK,
      }
    }
  }
}

/** Every violation with its remedy attached, in the order reported. */
export interface AnnotatedViolation {
  violation: DRCViolation
  remedy: DrcRemedy
}

export function annotateViolations(
  violations: readonly DRCViolation[],
  settings: DRCSettings,
): AnnotatedViolation[] {
  return violations.map((violation) => ({
    violation,
    remedy: remedyFor(violation, settings),
  }))
}

/** How many findings a caller can fix without making a judgement call. */
export function countAutomaticRemedies(annotated: readonly AnnotatedViolation[]): number {
  return annotated.filter((entry) => entry.remedy.automatic).length
}

/**
 * Every tool this module names, so a test can assert the advice is actionable
 * rather than merely plausible.
 */
export const REMEDY_TOOLS: readonly string[] = [
  'eda.addTrace',
  'eda.addVia',
  'eda.movePart',
  'eda.route',
  'eda.drc',
]