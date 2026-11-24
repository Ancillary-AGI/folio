/**
 * One module that knows the environment names, so nothing else reads
 * process.env directly in client code. `next.config.mjs` inlines the
 * NEXT_PUBLIC_* values (from either VITE_* or NEXT_PUBLIC_* at build time).
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
export const AGENT_CLOUD_URL = process.env.NEXT_PUBLIC_AGENT_CLOUD_URL ?? ''
export const AGENT_CLOUD_TOKEN = process.env.NEXT_PUBLIC_AGENT_CLOUD_TOKEN ?? ''
