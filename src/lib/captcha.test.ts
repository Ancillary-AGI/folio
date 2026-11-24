import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CAPTCHA_SITE_KEY, isCaptchaConfigured, verifyCaptcha } from './captcha'

const originalSecret = process.env.CAPTCHA_SECRET_KEY
const originalProvider = process.env.CAPTCHA_PROVIDER

beforeEach(() => {
  process.env.CAPTCHA_SECRET_KEY = 'test-secret'
  delete process.env.CAPTCHA_PROVIDER
})

afterEach(() => {
  if (originalSecret === undefined) delete process.env.CAPTCHA_SECRET_KEY
  else process.env.CAPTCHA_SECRET_KEY = originalSecret
  if (originalProvider === undefined) delete process.env.CAPTCHA_PROVIDER
  else process.env.CAPTCHA_PROVIDER = originalProvider
  vi.unstubAllGlobals()
})

const formOf = (init: RequestInit): URLSearchParams => {
  const body = init.body
  if (!(body instanceof FormData)) throw new Error('expected FormData')
  const params = new URLSearchParams()
  for (const [key, value] of body.entries()) params.set(key, String(value))
  return params
}

describe('isCaptchaConfigured', () => {
  it('is false when no site key is inlined', () => {
    // The site key is read at module load, so this reflects the build, not the
    // test environment.
    expect(typeof CAPTCHA_SITE_KEY).toBe('string')
    expect(isCaptchaConfigured()).toBe(Boolean(CAPTCHA_SITE_KEY))
  })
})

describe('verifyCaptcha', () => {
  it('refuses when the deployment has no secret, rather than passing', async () => {
    // A half-configured deployment must not silently accept unchallenged writes.
    delete process.env.CAPTCHA_SECRET_KEY
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const result = await verifyCaptcha('a-token')
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/not configured/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a missing or non-string token without calling out', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    for (const token of [undefined, null, '', '   ', 42, {}]) {
      const result = await verifyCaptcha(token)
      expect(result.ok).toBe(false)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts a token the provider confirms', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ success: true }),
      { status: 200 },
    )))
    await expect(verifyCaptcha('good-token')).resolves.toEqual({ ok: true })
  })

  it('rejects a token the provider refuses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ success: false, 'error-codes': ['invalid-input-response'] }),
      { status: 200 },
    )))
    const result = await verifyCaptcha('bad-token')
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/failed/i)
  })

  it('rejects a token minted for a different action', async () => {
    // A signup token must not open the newsletter form.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ success: true, action: 'signup' }),
      { status: 200 },
    )))
    const result = await verifyCaptcha('signup-token', { expectedAction: 'newsletter-subscribe' })
    expect(result.ok).toBe(false)
  })

  it('accepts a token minted for the expected action', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ success: true, action: 'signup' }),
      { status: 200 },
    )))
    await expect(verifyCaptcha('signup-token', { expectedAction: 'signup' })).resolves.toEqual({ ok: true })
  })

  it('sends the secret, the token and the action to the provider', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await verifyCaptcha('tok', { expectedAction: 'signup', remoteIp: '203.0.113.9' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify')
    const form = formOf(init)
    expect(form.get('secret')).toBe('test-secret')
    expect(form.get('response')).toBe('tok')
    expect(form.get('action')).toBe('signup')
    expect(form.get('remoteip')).toBe('203.0.113.9')
  })

  it('reports a transport failure as a refusal, not a pass', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const result = await verifyCaptcha('tok')
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/could not be reached/i)
  })

  it('reports a non-200 from the provider as a refusal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 503 })))
    const result = await verifyCaptcha('tok')
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/did not answer/i)
  })

  it('switches endpoint when the provider changes', async () => {
    process.env.CAPTCHA_PROVIDER = 'hcaptcha'
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await verifyCaptcha('tok')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.hcaptcha.com/siteverify')
    // hCaptcha wants the sitekey too, so the secret alone cannot be replayed.
    expect(formOf(init).get('sitekey')).toBe(CAPTCHA_SITE_KEY)
  })

  it('treats an unknown provider name as turnstile', async () => {
    process.env.CAPTCHA_PROVIDER = 'nonsense'
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await verifyCaptcha('tok')
    const [url] = fetchMock.mock.calls[0] as unknown as [string]
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify')
  })
})