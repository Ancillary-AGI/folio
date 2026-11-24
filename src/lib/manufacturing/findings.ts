import type { ERCResult, ERCViolation } from './erc'

const SEVERITY_ORDER: Readonly<Record<ERCViolation['severity'], number>> = {
  error: 0,
  warning: 1,
  info: 2,
}

/**
 * Findings in the order the design-health dock shows them: errors, then
 * warnings, notices. The dock renders this order and F8 steps through it, so
 * the two surfaces cannot disagree about what "next" means.
 *
 * A severity outside the declared union would sort as NaN — browser-dependent
 * ordering — so it is refused instead of guessed.
 */
export function orderedFindings(result: ERCResult): ERCViolation[] {
  return [...result.violations].sort((a, b) => {
    const orderA = SEVERITY_ORDER[a.severity]
    const orderB = SEVERITY_ORDER[b.severity]
    if (orderA === undefined || orderB === undefined) {
      throw new Error(`Unknown finding severity "${orderA === undefined ? String(a.severity) : String(b.severity)}".`)
    }
    return orderA - orderB
  })
}
