import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Turn an unknown thrown value into a message that is safe to show a user.
 *
 * `catch (error)` narrows to `unknown` under `strict`, and reaching for
 * `(error as Error).message` is how `undefined` ends up on screen. This helper
 * always returns something actionable.
 */
export function describeError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === 'string' && error.trim()) return error
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  try {
    const serialised = JSON.stringify(error)
    if (serialised && serialised !== '{}') return serialised
  } catch {
    /* circular or non-serialisable */
  }
  return 'Unknown error'
}

/**
 * Monotonic in-process id. Replaces `Math.random().toString(36)` fingerprints
 * with a counter that is unique within the session and stable to reason about.
 * Pass a distinct prefix per call site (e.g. `generateId('op')`).
 */
let idCounter = 0;
export function generateId(prefix = 'id'): string {
  idCounter += 1;
  return `${prefix}_${Date.now()}_${idCounter}`;
}
