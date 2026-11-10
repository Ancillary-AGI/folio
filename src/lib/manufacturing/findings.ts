import type { ERCResult, ERCViolation } from './erc'

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 } as const

/**
 * Findings in the order the design-health dock shows them: errors, then
 * warnings, notices. The dock renders this order and F8 steps through it, so
 * the two surfaces cannot disagree about what "next" means.
 */
export function orderedFindings(result: ERCResult): ERCViolation[] {
  return [...result.violations].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  )
}
