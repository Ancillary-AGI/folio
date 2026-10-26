/// <reference types="vite/client" />
/// <reference types="@webgpu/types" />

interface ImportMetaEnv {
  /** Supabase project URL; optional — the app is fully local without it. */
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  /**
   * Base URL of the server-side always-on agent runner. Optional: local
   * autopilot runs entirely in the browser. See docs/AGENT_CLOUD.md.
   */
  readonly VITE_AGENT_CLOUD_URL?: string
  /**
   * Short-lived, backend-minted job token. Never put a service credential in
   * a VITE_ variable — every VITE_ value ships in the public bundle.
   */
  readonly VITE_AGENT_CLOUD_TOKEN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
