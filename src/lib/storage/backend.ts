/**
 * Which storage backend the app talks to.
 *
 * The app is written against the Supabase wire format (PostgREST + GoTrue), so
 * "database-agnostic" means the *deployment* decides what answers that API —
 * not that the client speaks every dialect. `cloudConfig.apiUrl` already
 * resolves this: a cloud project when configured, the bundled local backend
 * otherwise, and any other Supabase-compatible server by URL.
 *
 * This module names the choice so it is visible in one place.
 */
import { cloudConfig } from '../cloudConfig'

export type StorageBackend = 'local' | 'cloud'

/**
 * `local` — the bundled Supabase-compatible server (`npm run backend`), which
 * stores in PGlite or an external Postgres via `FOLIO_PG`.
 * `cloud` — a hosted or self-hosted Supabase project.
 */
export const storageBackend: StorageBackend = cloudConfig.configured ? 'cloud' : 'local'

/** The API base every data call goes to. */
export const apiUrl = cloudConfig.apiUrl

/** The anon key that goes with it. */
export const anonKey = cloudConfig.resolvedAnonKey