import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/* The route resolves its API base through cloudConfig, so the tests mock it
 * rather than mutating process.env after the module has loaded. */
vi.mock('../../../../src/lib/cloudConfig', () => ({
  cloudConfig: {
    apiUrl: 'https://db.example.com',
    resolvedAnonKey: 'anon-key',
  },
}))

import { cloudConfig } from '../../../../src/lib/cloudConfig'

const originalSecret = process.env.CAPTCHA_SECRET_KEY

beforeEach(() => {
  // No CAPTCHA secret: these tests exercise the route's own contract, and the
  // captcha module's refusals are covered in captcha.test.ts.
  delete process.env.CAPTCHA_SECRET_KEY
})

afterEach(() => {
  if (originalSecret === undefined) delete process.env.CAPTCHA_SECRET_KEY
  else process.env.CAPTCHA_SECRET_KEY = originalSecret
  // The apiUrl getter is spied on in one test; restore it so later tests see
  // the real resolution.
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest('http://localhost/api/newsletter/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })

const insertMock = (status: number) => {
  const fetchMock = vi.fn(async () => new Response(null, { status }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('POST /api/newsletter/subscribe', () => {
  it('subscribes a valid address', async () => {
    const fetchMock = insertMock(201)
    const { POST } = await import('./route')
    const response = await POST(post({ email: 'Ada@Example.com ', name: 'Ada' }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, alreadyOnList: false })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://db.example.com/rest/v1/newsletter_subscribers')
    const sent = JSON.parse(String(init.body)) as { email: string; display_name: string }
    // Normalised: trimmed and lower-cased, so duplicates are actually detected.
    expect(sent.email).toBe('ada@example.com')
    expect(sent.display_name).toBe('Ada')
  })

  it('reports a duplicate as success without revealing it', async () => {
    // Distinguishing "already subscribed" from "subscribed" would be an
    // enumeration channel for testing which addresses are on the list.
    insertMock(409)
    const { POST } = await import('./route')
    const response = await POST(post({ email: 'ada@example.com' }))
    expect(response.status).toBe(200)
    const body = (await response.json()) as { ok: boolean; alreadyOnList: boolean }
    expect(body.ok).toBe(true)
    expect(body.alreadyOnList).toBe(true)
  })

  it('rejects a malformed address without calling out', async () => {
    const fetchMock = insertMock(201)
    const { POST } = await import('./route')
    for (const email of ['', 'nope', 'a@b', 'a b@c.d', 'x'.repeat(250) + '@a.com']) {
      const response = await POST(post({ email }))
      expect(response.status).toBe(400)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a non-object body', async () => {
    const { POST } = await import('./route')
    for (const body of [null, 'text', 42, []]) {
      const response = await POST(post(body))
      expect(response.status).toBe(400)
    }
  })

  it('rejects a body over the size cap', async () => {
    const fetchMock = insertMock(201)
    const { POST } = await import('./route')
    const big = 'x'.repeat(6000)
    const response = await POST(post({ email: 'ada@example.com', note: big }))
    expect(response.status).toBe(413)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports 503 when there is no API base at all', async () => {
    /* cloudConfig always resolves to something — the cloud project or the
     * bundled local backend — so this only happens if that resolution is
     * explicitly empty. */
    vi.spyOn(cloudConfig, 'apiUrl', 'get').mockReturnValue('')
    const { POST } = await import('./route')
    const response = await POST(post({ email: 'ada@example.com' }))
    expect(response.status).toBe(503)
  })

  it('reports 502 when the database refuses', async () => {
    insertMock(500)
    const { POST } = await import('./route')
    const response = await POST(post({ email: 'ada@example.com' }))
    expect(response.status).toBe(502)
  })

  it('is not cached', async () => {
    insertMock(201)
    const { POST } = await import('./route')
    const response = await POST(post({ email: 'ada@example.com' }))
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})