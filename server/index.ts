#!/usr/bin/env node
/**
 * Folio local backend — one process, four jobs.
 *
 *   1. GoTrue-compatible auth on `/auth/v1/*` (sign up, password and refresh
 *      token grants, user lookup, sign out).
 *   2. PostgREST-compatible REST on `/rest/v1/*` for the tables the app uses.
 *   3. Operator newsletter routes under `/admin/newsletter/*`, plus one-click
 *      unsubscribe.
 *   4. A research tool on `/tools/fetch-text` — bounded, uncredentialed text
 *      fetch for datasheet and reference lookups. The page that comes back is
 *      untrusted data; it is never interpreted or executed here.
 *
 * Everything runs against a real PostgreSQL (PGlite embedded by default, or an
 * external server via FOLIO_PG) with the repository's own migrations and RLS
 * applied, so the access decision for every row is made by the database, not by
 * this process.
 *
 * Single-origin, like hosted Supabase — the frontend needs no code changes, only
 * build flags:
 *
 *   VITE_SUPABASE_URL=http://127.0.0.1:54321
 *   VITE_SUPABASE_ANON_KEY=folio-local-dev-anon-key
 *
 * Binds 127.0.0.1 only. For a shared deployment, override FOLIO_JWT_SECRET, set
 * FOLIO_PG to a real database, and put a TLS terminator in front.
 *
 * Environment: see `server/config.ts`, which documents and validates every knob.
 */
import http from 'node:http'
import { loadConfig } from './config'
import { CORS_HEADERS, HttpError, sendJson } from './http/respond'
import { createDb } from './db'
import { createRestHandler } from './rest'
import { createMailer } from './newsletter/mailer'
import {
  handleNewsletterSend,
  handleNewsletterStatus,
  handleNewsletterUnsubscribe,
  type NewsletterAdminContext,
} from './newsletter/admin'
import { handleFetchText } from './tools/research'
import { verifyJwt } from './auth/jwt'
import {
  handleAuthorize,
  handleLogout,
  handleSettings,
  handleSignup,
  handleToken,
  handleUser,
} from './auth/gotrue'

async function main(): Promise<void> {
  const config = loadConfig()
  const db = await createDb(config.dataDir)
  const rest = createRestHandler({
    db,
    verifyJwt: (token) => verifyJwt(token, config.jwtSecret),
    log: (...rest2) => console.error(...rest2),
  })
  await rest.loadSchema()

  const newsletter: NewsletterAdminContext = {
    db,
    jwtSecret: config.jwtSecret,
    smtp: config.smtp,
    siteOrigin: config.siteOrigin,
    createMailer: () => createMailer(config.smtp),
    logger: (message, ...rest2) => console.log(message, ...rest2),
  }
  const auth = {
    db,
    options: {
      jwtSecret: config.jwtSecret,
      accessTokenTtlSeconds: config.accessTokenTtlSeconds,
      refreshTokenTtlDays: config.refreshTokenTtlDays,
    },
  }

  const server = http.createServer((req, res) => {
    void route(req, res).catch((error: unknown) => {
      console.error('[backend] request failed:', error)
      if (res.headersSent) {
        res.end()
        return
      }
      if (error instanceof HttpError) {
        sendJson(res, error.status, { msg: error.message, code: error.code })
        return
      }
      sendJson(res, 500, {
        msg: 'Internal error',
        error: String(error instanceof Error ? error.message : error),
      })
    })
  })

  const route = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    for (const [name, value] of Object.entries(CORS_HEADERS)) res.setHeader(name, value)
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const url = new URL(req.url ?? '/', `http://${config.host}:${config.port}`)
    const path = url.pathname

    if (path === '/healthz') {
      await db.query('select 1')
      sendJson(res, 200, { ok: true, mode: db.mode })
      return
    }
    if (path === '/admin/newsletter/send' && req.method === 'POST') {
      await handleNewsletterSend(newsletter, req, res)
      return
    }
    if (path === '/admin/newsletter/status' && req.method === 'GET') {
      await handleNewsletterStatus(newsletter, req, res, url)
      return
    }
    if (path === '/newsletter/unsubscribe' && req.method === 'POST') {
      await handleNewsletterUnsubscribe(newsletter, req, res)
      return
    }
    if (path === '/tools/fetch-text' && req.method === 'GET') {
      await handleFetchText(res, url)
      return
    }
    if (path === '/auth/v1/settings' && req.method === 'GET') {
      handleSettings(res)
      return
    }
    if (path === '/auth/v1/authorize' && req.method === 'GET') {
      handleAuthorize(res, url)
      return
    }
    if (path === '/auth/v1/signup' && req.method === 'POST') {
      await handleSignup(auth, req, res)
      return
    }
    if (path === '/auth/v1/token' && req.method === 'POST') {
      await handleToken(auth, req, res, url.searchParams.get('grant_type'))
      return
    }
    if (path === '/auth/v1/logout' && req.method === 'POST') {
      await handleLogout(auth, req, res)
      return
    }
    if (path === '/auth/v1/user' && req.method === 'GET') {
      await handleUser(auth, req, res)
      return
    }
    if (path.startsWith('/auth/v1/')) {
      sendJson(res, 404, { msg: 'Not found' })
      return
    }
    if (path.startsWith('/rest/v1/')) {
      await rest.handle(req, res)
      return
    }
    sendJson(res, 404, { msg: 'Not found' })
  }

  server.listen(config.port, config.host, () => {
    console.log(
      `[backend] Folio local backend on http://${config.host}:${config.port} (${db.mode})`,
    )
    console.log('[backend]   auth:  /auth/v1/*   rest: /rest/v1/*')
    console.log(`[backend]   Build the app with VITE_SUPABASE_URL=http://${config.host}:${config.port}`)
    console.log(`[backend]   and VITE_SUPABASE_ANON_KEY=${config.anonKey}`)
  })

  const shutdown = async (): Promise<void> => {
    console.log('\n[backend] shutting down')
    await db.close().catch(() => {})
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
}

main().catch((error: unknown) => {
  console.error('[backend] failed to start:', error instanceof Error ? error.message : error)
  process.exit(1)
})