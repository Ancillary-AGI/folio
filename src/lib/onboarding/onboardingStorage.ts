/**
 * Onboarding persistence.
 *
 * Kept in one place so the "has the user seen the guide?" question has a single
 * answer, and so a storage failure can never leave the app in a state where the
 * guide can be dismissed but never re-opened.
 */

const COMPLETED_KEY = 'folio.onboarding.completed.v2'
const STEP_KEY = 'folio.onboarding.step'

/** True when the guide has been finished or explicitly skipped. */
export function hasCompletedOnboarding(): boolean {
  if (typeof localStorage === 'undefined') return true
  try {
    return localStorage.getItem(COMPLETED_KEY) === 'true'
  } catch {
    return true
  }
}

/** Remember that the guide is done. Storage failures are non-fatal. */
export function markOnboardingComplete(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(COMPLETED_KEY, 'true')
    localStorage.removeItem(STEP_KEY)
  } catch {
    /* Private mode: the session still hides the guide. */
  }
}

/** Forget the completion flag so the guide shows again. */
export function resetOnboarding(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(COMPLETED_KEY)
    localStorage.removeItem(STEP_KEY)
  } catch {
    /* ignore */
  }
}

/** Resume the guide where the user left off (0 when unknown). */
export function readOnboardingStep(totalSteps: number): number {
  if (typeof localStorage === 'undefined' || totalSteps <= 0) return 0
  try {
    const raw = Number(localStorage.getItem(STEP_KEY))
    if (!Number.isInteger(raw) || raw < 0) return 0
    return Math.min(raw, totalSteps - 1)
  } catch {
    return 0
  }
}

/** Persist progress so a mid-guide refresh resumes in place. */
export function writeOnboardingStep(step: number): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STEP_KEY, String(step))
  } catch {
    /* ignore */
  }
}
