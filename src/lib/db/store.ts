/**
 * The storage seam.
 *
 * Every data call goes through `store.from(...)` rather than reaching for a
 * vendor client, so the deployment decides what answers: the bundled local
 * backend, a hosted Supabase project, or any other engine that implements this
 * surface. Swapping engines means writing one more `Store` — not editing 49 call
 * sites across the app.
 *
 * The default implementation delegates to the Supabase client, which is what
 ships today. `auth` stays on that client: it is identity, not storage.
 */
import { supabase } from '../supabase'

/**
 * A table handle. The query builder is chainable and awaitable, matching the
 * shape the app already uses, so migrating a call site is a one-word change.
 *
 * `auth` and `rpc` are included because the console needs them: identity and
 * stored functions are part of the storage surface, not separate from it.
 */
export type Store = Pick<typeof supabase, 'from' | 'auth' | 'rpc'>;

export const store: Store = {
  from: (table) => supabase.from(table),
  auth: supabase.auth,
  rpc: supabase.rpc,
}