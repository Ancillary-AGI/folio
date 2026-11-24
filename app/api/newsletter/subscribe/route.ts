/**
 * POST /api/newsletter/subscribe
 *
 * The public subscribe strip posts here instead of inserting straight into
 * `newsletter_subscribers`. That indirection is the point: the insert is a
 * write from an unauthenticated visitor, so it must carry proof the request came
 * from a person. The CAPTCHA token is verified here, before anything is written.
 *
 * The body is validated, the address is normalised, and the insert uses the
 * public anon key — the table's RLS still allows exactly this one operation, so
 * a compromised route cannot widen what the key can do.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isCaptchaConfigured, verifyCaptcha } from '../../../../src/lib/captcha'
import { cloudConfig } from '../../../../src/lib/cloudConfig'

export const runtime = 'nodejs'

const MAX_BODY_CHARS = 4_000
const ACTION = 'newsletter-subscribe'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const reply = (body: unknown, status: number) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

export async function POST(request: NextRequest) {
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > MAX_BODY_CHARS) {
    return reply({ error: 'Request body is too large.' }, 413)
  }

  let payload: unknown
  try {
    const raw = await request.text()
    if (raw.length > MAX_BODY_CHARS) {
      return reply({ error: 'Request body is too large.' }, 413)
    }
    payload = JSON.parse(raw)
  } catch {
    return reply({ error: 'The request body must be JSON.' }, 400)
  }

  if (!payload || typeof payload !== 'object') {
    return reply({ error: 'The request body must be a JSON object.' }, 400)
  }
  const body = payload as Record<string, unknown>

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!EMAIL.test(email) || email.length > 254) {
    return reply({ error: 'Enter a valid email address.' }, 400)
  }
  const displayName = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : ''

  // An unconfigured deployment must not accept unchallenged writes.
  if (isCaptchaConfigured()) {
    const result = await verifyCaptcha(body.captchaToken, {
      expectedAction: ACTION,
      remoteIp: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
    })
    if (!result.ok) return reply({ error: result.reason ?? 'Verification failed.' }, 403)
  }

  /* `cloudConfig.apiUrl` resolves to the cloud project when one is configured
   * and to the bundled local backend otherwise, so this works in both modes. */
  const backend = cloudConfig.apiUrl
  const anon = cloudConfig.resolvedAnonKey
  if (!backend) {
    return reply({ error: 'Subscriptions are not available on this deployment.' }, 503)
  }

  try {
    const response = await fetch(`${backend}/rest/v1/newsletter_subscribers`, {
      method: 'POST',
      headers: {
        apikey: anon,
        authorization: `Bearer ${anon}`,
        'content-type': 'application/json',
        prefer: 'return=minimal',
      },
      body: JSON.stringify({ email, display_name: displayName, source: 'site' }),
    })
    if (response.ok) return reply({ ok: true, alreadyOnList: false }, 200)
    if (response.status === 409 || response.status === 400) {
      /* A duplicate is reported as success: revealing whether an address is
       * already subscribed would be an enumeration channel. */
      return reply({ ok: true, alreadyOnList: true }, 200)
    }
    return reply({ error: `The server could not save your address (${response.status}).` }, 502)
  } catch {
    return reply({ error: 'The backend did not answer. Try again in a moment.' }, 502)
  }
}