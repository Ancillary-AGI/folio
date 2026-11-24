/**
 * Haptic feedback via the Vibration API.
 *
 * This is honest about its reach: Android Chrome and Firefox honour
 * navigator.vibrate on a phone, so a confirm, a success or a blocked action
 * lands with a short pulse. iOS Safari and every desktop do not implement it —
 * for them every call below is a silent no-op, and the visual design never
 * depends on it. Nothing here fakes physics on a machine that has none.
 *
 * Patterns are short by design: feedback confirms, it does not demand.
 */
export type HapticPattern = 'tap' | 'success' | 'error' | 'warning'

const PATTERNS: Record<HapticPattern, number[]> = {
  /** A single short pulse — button pressed, row toggled, snap-to-grid armed. */
  tap: [10],
  /** A double rising tick — an action finished (export, sim pass, commit done). */
  success: [12, 60, 18],
  /** A heavier double thud — the app refused something (quota, DRC fail, bad input). */
  error: [30, 80, 30],
  /** One long pulse — attention before an irreversible action, or a pending gate. */
  warning: [120],
}

/** Fire a pulse on pattern. No-ops silently where the API is absent or blocked. */
export function triggerHaptic(pattern: HapticPattern = 'tap'): void {
  if (typeof navigator === 'undefined') return
  try {
    const vibrate = navigator.vibrate
    if (typeof vibrate !== 'function') return
    vibrate.call(navigator, PATTERNS[pattern])
  } catch {
    // Some browsers throw for a pattern they cannot express; feedback is a
    // courtesy, never a failure the user sees.
  }
}
