/**
 * Net classes: one rule set shared by manual routing, the autorouter's emitted
 * widths and DRC. A class is a glob over net names plus the copper rules those
 * nets must meet. The board-wide DRC minimums remain a floor: a class can
 * tighten a rule, never loosen it.
 *
 * Explicit assignments outrank patterns so a designer can pull one net out of
 * the bus pattern it happens to match, and the first matching class wins so the
 * result does not depend on object-key order.
 */

export interface NetClass {
  id: string
  name: string
  /** Case-insensitive globs over net names; `*` and `?` are the only wildcards. */
  patterns: string[]
  traceWidthMm: number
  clearanceMm: number
}

export interface NetClassRules {
  /** Per-net minimum copper width, millimetres. */
  widths: Record<string, number>
  /** Per-net minimum clearance to foreign copper, millimetres. */
  clearances: Record<string, number>
}

/**
 * The panel's house rules are 0.2 mm signal and 0.1 mm clearance; every default
 * class starts there so opening a routed board never reports violations the
 * board did not have. Widening a class is a deliberate edit.
 */
export const DEFAULT_NET_CLASSES: NetClass[] = [
  {
    id: 'power',
    name: 'Power',
    patterns: ['VCC*', 'VDD*', 'VSS*', 'GND', 'GND_*', 'VBUS*', 'VBAT*', 'V3V3*', 'V5*', 'V1V0*', '+*'],
    traceWidthMm: 0.2,
    clearanceMm: 0.1,
  },
  {
    id: 'high-speed',
    name: 'High speed',
    patterns: ['*_P', '*_N', '*_DP', '*_DM', 'DQ*', 'DQS*', '*CLK*', 'USB*', 'PCIe*', 'EDP*', 'SATA*', 'HDMI*', 'DDR*'],
    traceWidthMm: 0.2,
    clearanceMm: 0.1,
  },
  {
    id: 'default',
    name: 'Default',
    patterns: ['*'],
    traceWidthMm: 0.2,
    clearanceMm: 0.1,
  },
]

const patternCache = new Map<string, RegExp>()

/** Anchored, case-insensitive glob match over a net name. */
export function matchesNetPattern(pattern: string, net: string): boolean {
  if (pattern.length === 0) return false
  let regex = patternCache.get(pattern)
  if (!regex) {
    const source = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')
    regex = new RegExp(`^${source}$`, 'i')
    patternCache.set(pattern, regex)
  }
  return regex.test(net)
}

/**
 * The class a net belongs to: an explicit assignment first, then the first
 * class in list order whose pattern matches. Undefined means no class names
 * the net, and callers fall back to the board-wide rules.
 */
export function resolveNetClass(
  net: string,
  classes: readonly NetClass[],
  assignments: Readonly<Record<string, string>> = {},
): NetClass | undefined {
  const pinnedId = assignments[net]
  if (pinnedId) {
    const pinned = classes.find((entry) => entry.id === pinnedId)
    if (pinned) return pinned
  }
  return classes.find((entry) => entry.patterns.some((pattern) => matchesNetPattern(pattern, net)))
}

/** Per-net width and clearance maps for the given nets. */
export function netClassRules(
  nets: Iterable<string>,
  classes: readonly NetClass[],
  assignments: Readonly<Record<string, string>> = {},
): NetClassRules {
  const widths: Record<string, number> = {}
  const clearances: Record<string, number> = {}
  for (const net of nets) {
    const resolved = resolveNetClass(net, classes, assignments)
    if (!resolved) continue
    widths[net] = resolved.traceWidthMm
    clearances[net] = resolved.clearanceMm
  }
  return { widths, clearances }
}
