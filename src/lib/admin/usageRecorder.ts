/**
 * Single entry point for platform usage.
 *
 * Every event is recorded in the device ledger (always available, even offline).
 * In a configured cloud deployment the same event is mirrored into
 * `usage_events`, where the governance schema enforces quota policies. The
 * insert is best-effort: a failed mirror must never break the design action the
 * user just performed, and the local ledger remains the source for this device.
 */
import { isSupabaseConfigured, supabase } from '../supabase'
import type { User } from '../../types'
import { recordUsage, type UsageEvent, type UsageKind } from './usageLedger'

let lastCloudError: string | null = null

export function getLastCloudUsageError(): string | null {
  return lastCloudError
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
      lastCloudError = error ? error.message : null
    })
    .catch((error: unknown) => {
      lastCloudError = error instanceof Error ? error.message : String(error)
    })
}
