/**
 * The workbench's data client.
 *
 * The API base and anon key come from `lib/storage/backend`, which resolves the
 * deployment's storage: a cloud project when configured, the bundled local
 * backend otherwise. Nothing here knows which.
 *
 * The operator console keeps a separate client and storage key
 * (`src/lib/admin/operatorSession.ts`) so governing the product can never ride
 * on a designer's signed-in session.
 *
 * Passkeys are an experimental feature: the methods throw until the flag is set,
* and enabling it only unlocks them — it makes no call on its own.
 */
import { createClient } from '@supabase/supabase-js'
import { apiUrl, anonKey } from './storage/backend'

export { isSupabaseConfigured } from './cloudConfig'
export type { Project, Schematic, Component, PinType } from './db/types'

export const supabase = createClient(apiUrl, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    experimental: { passkey: true },
  },
})