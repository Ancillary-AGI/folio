/**
 * CAPTCHA verification.
 *
 * Two public forms write to the deployment without a session: the newsletter
 * subscribe strip and account signup. Both need proof the request came from a
 * person, so both carry a token from the configured provider and both are
 * checked on the server before anything is written.
 *
 * Cloudflare Turnstile is the default provider: free at this volume, no
 * cookie, and it renders as a widget the app does not have to style. hCaptcha
 * and reCAPTCHA verify the same way with a different endpoint, so switching is
 * a configuration change rather than a code change.
 *
 * Configuration:
 *   NEXT_PUBLIC_CAPTCHA_SITE_KEY  public key, inlined into the bundle
 *   CAPTCHA_SECRET_KEY            server only, never sent to the browser
 *   CAPTCHA_PROVIDER              turnstile | hcaptcha | recaptcha (default turnstile)
 *
 * With no site key the widget is omitted and `isCaptchaConfigured()` is false.
 * Callers decide what that means; the default is to refuse a public write
 * rather than accept one unchallenged.
 */

export type CaptchaProvider = 'turnstile' | 'hcaptcha' | 'recaptcha'

const VERIFY_ENDPOINT: Readonly<Record<CaptchaProvider, string>> = {
  turnstile: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
  hcaptcha: 'https://api.hcaptcha.com/siteverify',
  recaptcha: 'https://www.google.com/recaptcha/api/siteverify',
}

export const CAPTCHA_SITE_KEY = process.env.NEXT_PUBLIC_CAPTCHA_SITE_KEY ?? ''

const provider = (): CaptchaProvider => {
  const configured = (process.env.CAPTCHA_PROVIDER ?? '').trim().toLowerCase()
  if (configured === 'hcaptcha' || configured === 'recaptcha') return configured
  return 'turnstile'
}

/** True when the deployment has a CAPTCHA provider configured at all. */
export const isCaptchaConfigured = (): boolean => Boolean(CAPTCHA_SITE_KEY)

export interface CaptchaResult {
  ok: boolean
  /** Short, user-safe reason when `ok` is false. */
  reason?: string
}

/**
 * Verify a CAPTCHA token with the provider.
 *
 * Returns `{ ok: true }` only when the provider confirms the token and, if
 * `expectedAction` is given, that the token was issued for that action. A
 * missing secret is a configuration error, not a pass: it reports `ok: false`
 * so a half-configured deployment cannot silently accept unverified writes.
 */
export async function verifyCaptcha(
  token: unknown,
  options: { expectedAction?: string; remoteIp?: string } = {},
): Promise<CaptchaResult> {
  const secret = (process.env.CAPTCHA_SECRET_KEY ?? '').trim()
  if (!secret) return { ok: false, reason: 'CAPTCHA is not configured on this deployment.' }
  if (typeof token !== 'string' || token.trim() === '') {
    return { ok: false, reason: 'The CAPTCHA token is missing. Reload the page and try again.' }
  }

  const kind = provider()
  const form = new FormData()
  form.set('secret', secret)
  form.set('response', token.trim())
  if (options.remoteIp) form.set('remoteip', options.remoteIp)
  if (kind === 'hcaptcha') form.set('sitekey', CAPTCHA_SITE_KEY)
  if (options.expectedAction && kind === 'turnstile') {
    form.set('action', options.expectedAction)
  }

  try {
    const response = await fetch(VERIFY_ENDPOINT[kind], { method: 'POST', body: form })
    if (!response.ok) {
      return { ok: false, reason: 'The CAPTCHA service did not answer. Try again in a moment.' }
    }
    const body = (await response.json()) as {
      success?: unknown
      action?: unknown
    }
    if (body.success !== true) {
      return { ok: false, reason: 'CAPTCHA verification failed. Complete the challenge and try again.' }
    }
    // A token minted for a different action must not open this form.
    if (options.expectedAction && kind === 'turnstile' && body.action !== options.expectedAction) {
      return { ok: false, reason: 'CAPTCHA verification failed. Complete the challenge and try again.' }
    }
    return { ok: true }
  } catch {
    return { ok: false, reason: 'The CAPTCHA service could not be reached. Try again in a moment.' }
  }
}