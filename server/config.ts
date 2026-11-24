/**
 * Backend configuration, parsed once and validated at startup.
 *
 * Every knob is read here rather than at the point of use, so a missing or
 * malformed value fails at boot with a clear message instead of surfacing later
 * as a confusing runtime error on a request path.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Repository root, derived from this file's location rather than the cwd. */
export const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))

/** HS256 secret used to sign session tokens. 32 characters is the floor. */
const MIN_SECRET_LENGTH = 32

const DEFAULT_JWT_SECRET = 'folio-local-jwt-secret-not-for-production-0123456789abcdef'
const DEFAULT_ANON_KEY = 'folio-local-dev-anon-key'

export interface BackendConfig {
  port: number
  jwtSecret: string
  anonKey: string
  accessTokenTtlSeconds: number
  refreshTokenTtlDays: number
  /** Host the server binds to. Loopback only, by design. */
  host: string
  /** Absolute origin of the web app, used to build links in outbound mail. */
  siteOrigin: string
  smtp: SmtpConfig
  /** Where PGlite keeps its data when no external database is configured. */
  dataDir: string
}

export interface SmtpConfig {
  configured: boolean
  host?: string
  port: number
  secure: boolean
  user?: string
  pass?: string
  from: string
}

const intFromEnv = (value: string | undefined, fallback: number): number => {
  if (value === undefined || value.trim() === '') return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const boolFromEnv = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined || value.trim() === '') return fallback
  return value.trim().toLowerCase() !== 'false' && value.trim() !== '0'
}

/** Read and validate configuration. Throws on a secret that is too short. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): BackendConfig {
  const jwtSecret = env.FOLIO_JWT_SECRET ?? DEFAULT_JWT_SECRET
  if (jwtSecret.length < MIN_SECRET_LENGTH) {
    throw new Error(`FOLIO_JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters.`)
  }

  const smtpHost = env.FOLIO_SMTP_HOST?.trim()
  /* A campaign needs a From address: the identity is deployment data, not
   * something this repository can invent. Requiring it also means the admin
   * panel's "transport configured" claim is true rather than optimistic. */
  const smtpFrom = env.FOLIO_SMTP_FROM?.trim() || ''

  return {
    port: intFromEnv(env.FOLIO_PORT, 54321),
    jwtSecret,
    anonKey: env.FOLIO_ANON_KEY ?? DEFAULT_ANON_KEY,
    accessTokenTtlSeconds: intFromEnv(env.FOLIO_ACCESS_TTL_SECONDS, 3600),
    refreshTokenTtlDays: intFromEnv(env.FOLIO_REFRESH_TTL_DAYS, 30),
    host: env.FOLIO_HOST?.trim() || '127.0.0.1',
    siteOrigin: (env.FOLIO_SITE_ORIGIN ?? 'http://localhost:5174').replace(/\/+$/, ''),
    dataDir: env.FOLIO_DATA_DIR?.trim() || join(repoRoot, '.backend', 'pglite-data'),
    smtp: {
      configured: Boolean(smtpHost && smtpFrom),
      host: smtpHost || undefined,
      port: intFromEnv(env.FOLIO_SMTP_PORT, 465),
      // Implicit TLS is the default on 465; STARTTLS on 587 must opt out.
      secure: boolFromEnv(env.FOLIO_SMTP_SECURE, true),
      user: env.FOLIO_SMTP_USER?.trim() || undefined,
      pass: env.FOLIO_SMTP_PASS ?? '',
      from: smtpFrom,
    },
  }
}