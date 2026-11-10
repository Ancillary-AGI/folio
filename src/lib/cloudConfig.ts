/**
 * Deployment configuration, read once from the build environment.
 *
 * Kept apart from `supabase.ts` so the operator console can create its own
 * client without importing the workbench's: two clients sharing one storage key
 * would sign the designer in and out of the console and vice versa.
 */
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

function isValidSupabaseUrl(value: string | undefined): boolean {
  if (!value || value.startsWith('your_')) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

export const cloudConfig = {
  url: supabaseUrl,
  anonKey: supabaseAnonKey,
  configured: Boolean(isValidSupabaseUrl(supabaseUrl) && supabaseAnonKey && !supabaseAnonKey.startsWith('your_')),
  /** Host only: an operator may see which deployment they are governing, never a key. */
  host: (() => {
    try {
      return supabaseUrl ? new URL(supabaseUrl).host : ''
    } catch {
      return ''
    }
  })(),
  agentRunnerConfigured: Boolean(import.meta.env.VITE_AGENT_CLOUD_URL),
} as const

export const isSupabaseConfigured = cloudConfig.configured