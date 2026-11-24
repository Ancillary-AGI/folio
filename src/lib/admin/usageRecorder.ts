/**
 * Single entry point for platform usage.
 *
 * Every event is recorded in the workspace ledger first (always available).
 * In a configured cloud deployment the same event is mirrored into
 * `usage_events`, where the governance schema enforces quota policies. The
 * insert is best-effort: a failed mirror must never break the design action the
 * user just performed, and the workspace ledger remains the source of record.
 */
import { isSupabaseConfigured, supabase } from '../supabase'
import type { User } from '../../types'
import { recordUsage, type UsageEvent, type UsageKind } from './usageLedger'

let lastCloudError: string | null = null
const mirrorListeners = new Set<() => void>()

export function getLastCloudUsageError(): string | null {
  return lastCloudError
}

/**
 * Notify when the mirror result changes. The insert resolves after the design
 * action has already been recorded locally, so a listener on the ledger alone
 * would read the previous result.
 */
export function subscribeUsageMirror(listener: () => void): () => void {
  mirrorListeners.add(listener)
  return () => mirrorListeners.delete(listener)
}

function setMirrorError(message: string | null): void {
  if (lastCloudError === message) return
  lastCloudError = message
  for (const listener of mirrorListeners) listener()
}

export function recordPlatformUsage(
  kind: UsageKind,
  user: User | null,
  offlineMode: boolean,
  detail?: UsageEvent['detail'],
): void {
  if (!user) return
  recordUsage(kind, user.id, detail)
  if (offlineMode || !isSupabaseConfigured) return
  void Promise.resolve(
    supabase.from('usage_events').insert({
      user_id: user.id,
      kind,
      detail: detail ?? {},
    }),
  )
    .then(({ error }) => {
      setMirrorError(error ? error.message : null)
    })
    .catch((error: unknown) => {
      setMirrorError(error instanceof Error ? error.message : String(error))
    })
}
