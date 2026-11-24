/**
 * Folio — the full-stack shell. The application is a Next.js App Router app:
 * the marketing pages are React Server Components prerendered at build time,
 * the CAD / consoles are client-only dynamic imports (they drive canvas,
 * workers and localStorage — none of which exists on a server), and the
 * environment contract is the NEXT_PUBLIC_* one. VITE_* values set for a
 * migrated deployment are honoured unchanged so no infrastructure work is
 * stranded by the move.
 */
import { fileURLToPath } from 'node:url'

/** konva ships a Node entry that hard-requires the native `canvas` package;
 * the browser build (`lib/index.js`, what the `browser` field points at) does
 * not. Force it — the workbench is client-only everywhere. */
const konvaBrowser = fileURLToPath(new URL('./node_modules/konva/lib/index.js', import.meta.url))

const nextConfig = {
  poweredByHeader: false,
  /* The gate (`npm run verify`) is what proves the tree compiles and behaves:
   * typecheck + lint + accessibility checks + the full test suite + build.
   * Next's duplicate in-build lint/type-check pass would re-check the same
   * files in a separate heap next to swc; the gate output is the source of
   * truth, so the redundant pass is skipped to keep builds schedulable. */
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  webpack(config) {
    /* `konva$` (bare entry only) → the browser build without touching
     * subpath imports (`konva/lib/Core.js`, which react-konva pulls directly). */
    config.resolve.alias = { ...(config.resolve.alias ?? {}), 'konva$': konvaBrowser }
    return config
  },
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
    NEXT_PUBLIC_AGENT_CLOUD_URL: process.env.VITE_AGENT_CLOUD_URL || process.env.NEXT_PUBLIC_AGENT_CLOUD_URL || '',
    NEXT_PUBLIC_AGENT_CLOUD_TOKEN: process.env.VITE_AGENT_CLOUD_TOKEN || process.env.NEXT_PUBLIC_AGENT_CLOUD_TOKEN || '',
  },
  async headers() {
    if (process.env.NODE_ENV !== 'production') return []
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), xr-spatial-tracking=(self)' },
        ],
      },
      {
        source: '/_next/static/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ]
  },
}

export default nextConfig
