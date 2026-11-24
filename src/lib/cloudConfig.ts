/**
 * Deployment configuration, read once from the build environment.
 *
 * Kept apart from `supabase.ts` so the operator console can create its own
 * client without importing the workbench's: two clients sharing one storage key
 * would sign the designer in and out of the console and vice versa.
 *
 * A deployment with no cloud project is not a deployment with no database. The
 * repository ships a Supabase-compatible local backend (`server/folio-backend.mjs`,
 * `npm run backend`) on 127.0.0.1:54321, and the workbench client has always
 * fallen back to it. Anything that talks to the database must resolve the same
 * way, or it works in the cloud and silently reports "not configured" locally —
 * which is exactly the bug this module exists to prevent.
 */
import { SUPABASE_URL, SUPABASE_ANON_KEY, AGENT_CLOUD_URL } from './env'

/** The bundled local backend: GoTrue on /auth/v1, PostgREST on /rest/v1. */
export const LOCAL_BACKEND_URL = 'http://127.0.0.1:54321'

/**
 * The key sent to the local backend. It is not a credential: `rest.mjs` runs
 * every request as the `anon` or `authenticated` role and lets RLS decide, so
 * the key only has to be present.
 */
export const LOCAL_BACKEND_ANON_KEY = 'local-development-placeholder'

function isValidSupabaseUrl(value: string | undefined): boolean {
  if (!value || value.startsWith('your_')) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

const supabaseUrl = SUPABASE_URL
const supabaseAnonKey = SUPABASE_ANON_KEY
const configured = Boolean(
  isValidSupabaseUrl(supabaseUrl) && supabaseAnonKey && !supabaseAnonKey.startsWith('your_'),
)

export const cloudConfig = {
  url: supabaseUrl,
  anonKey: supabaseAnonKey,
  configured,
  /** Host only: an operator may see which deployment they are governing, never a key. */
  host: (() => {
    try {
      return supabaseUrl ? new URL(supabaseUrl).host : ''
    } catch {
      return ''
    }
  })(),
  agentRunnerConfigured: Boolean(AGENT_CLOUD_URL),
  /**
   * The base every database call goes to: the cloud project when one is
   * configured, the bundled local backend otherwise.
   */
  apiUrl: configured ? supabaseUrl.replace(/\/+$/, '') : LOCAL_BACKEND_URL,
  /** The key that goes with `apiUrl`. */
  resolvedAnonKey: configured ? supabaseAnonKey : LOCAL_BACKEND_ANON_KEY,
} as const

export const isSupabaseConfigured = cloudConfig.configured