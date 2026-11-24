import { createClient } from '@supabase/supabase-js'
import { cloudConfig } from './cloudConfig'

export { isSupabaseConfigured } from './cloudConfig'
export type { Project, Schematic, Component, PinType } from './db/types'

/**
 * The workbench's own session. The operator console keeps a separate client and
 * storage key (`src/lib/admin/operatorSession.ts`) so governing the product can
 * never ride on a designer's signed-in session.
 *
 * With no cloud project this points at the bundled local backend rather than
 * nowhere — `cloudConfig.apiUrl` resolves the same way for every caller.
 *
 * Passkeys are enabled as an experimental feature: the methods throw until this
 * flag is set, and enabling it only unlocks them — it makes no call on its own, so
 * password sign-in is unaffected and a backend without the passkey endpoints
 * simply reports that they are unavailable when one is used.
 */
export const supabase = createClient(cloudConfig.apiUrl, cloudConfig.resolvedAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    experimental: { passkey: true },
  },
})