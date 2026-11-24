import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../cloudConfig', () => ({
  cloudConfig: {
    apiUrl: 'https://db.example.com',
    resolvedAnonKey: 'anon-key',
  },
}))

import { NO_SITE_SETTINGS, contactHref, loadSiteSettings, parseSiteSettings } from './siteSettings'

afterEach(() => {
  vi.unstubAllGlobals()
})

const row = (overrides: Record<string, unknown> = {}) => ({
  product_name: 'Folio',
  parent_company: 'X Industries',
  tagline: 'Engineering workbench.',
  description: 'Verified engineering.',
  contact_email: 'founder@folio.dev',
  site_url: 'https://folio.dev',
  github_url: 'https://github.com/Ancillary-AGI/folio',
  codeberg_url: 'https://codeberg.org/X-Industries',
  security_policy_url: 'https://github.com/Ancillary-AGI/folio/blob/main/SECURITY.md',
  ...overrides,
})

describe('parseSiteSettings', () => {
  it('reads a full row', () => {
    expect(parseSiteSettings(row())).toEqual({
      productName: 'Folio',
      parentCompany: 'X Industries',
      tagline: 'Engineering workbench.',
      description: 'Verified engineering.',
      contactEmail: 'founder@folio.dev',
      siteUrl: 'https://folio.dev',
      githubUrl: 'https://github.com/Ancillary-AGI/folio',
      codebergUrl: 'https://codeberg.org/X-Industries',
      securityPolicyUrl: 'https://github.com/Ancillary-AGI/folio/blob/main/SECURITY.md',
    })
  })

  it('keeps plain text that is not a URL', () => {
    /* A company name is not a link. Running every field through the link check
     * dropped the product name and the parent company, so the footer lost the
     * identity it was supposed to show. */
    const settings = parseSiteSettings(row())
    expect(settings?.productName).toBe('Folio')
    expect(settings?.parentCompany).toBe('X Industries')
    expect(settings?.contactEmail).toBe('founder@folio.dev')
  })

  it('drops link fields that are not http(s) or mailto', () => {
    const settings = parseSiteSettings(row({
      github_url: 'javascript:alert(1)',
      codeberg_url: '/etc/passwd',
      security_policy_url: '',
    }))
    expect(settings?.githubUrl).toBeUndefined()
    expect(settings?.codebergUrl).toBeUndefined()
    expect(settings?.securityPolicyUrl).toBeUndefined()
  })

  it('accepts only an absolute site origin and normalises its trailing slash', () => {
    expect(parseSiteSettings(row({ site_url: 'https://example.com/' }))?.siteUrl).toBe('https://example.com')
    expect(parseSiteSettings(row({ site_url: 'https://example.com/docs/' }))?.siteUrl).toBe('https://example.com/docs')
    expect(parseSiteSettings(row({ site_url: 'javascript:alert(1)' }))?.siteUrl).toBeUndefined()
    expect(parseSiteSettings(row({ site_url: 'example.com' }))?.siteUrl).toBeUndefined()
    expect(parseSiteSettings(row({ site_url: '' }))?.siteUrl).toBeUndefined()
  })

  it('drops a malformed contact address', () => {
    expect(parseSiteSettings(row({ contact_email: 'not-an-email' }))?.contactEmail).toBeUndefined()
    expect(parseSiteSettings(row({ contact_email: '' }))?.contactEmail).toBeUndefined()
  })

  it('omits blank text rather than showing an empty element', () => {
    const settings = parseSiteSettings(row({
      product_name: '   ', parent_company: '', contact_email: '', tagline: '', description: '', site_url: '',
    }))
    expect(settings).toEqual({
      githubUrl: 'https://github.com/Ancillary-AGI/folio',
      codebergUrl: 'https://codeberg.org/X-Industries',
      securityPolicyUrl: 'https://github.com/Ancillary-AGI/folio/blob/main/SECURITY.md',
    })
  })

  it('refuses a non-object', () => {
    expect(parseSiteSettings(null)).toBeUndefined()
    expect(parseSiteSettings('Folio')).toBeUndefined()
  })
})

describe('contactHref', () => {
  it('builds a mailto from the contact address', () => {
    expect(contactHref({ contactEmail: 'a@b.co' })).toBe('mailto:a@b.co')
  })

  it('is undefined when there is no address, so callers omit the link', () => {
    expect(contactHref(NO_SITE_SETTINGS)).toBeUndefined()
    expect(contactHref({})).toBeUndefined()
  })
})

describe('loadSiteSettings', () => {
  it('returns the stored row', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([row()]), { status: 200 })))
    await expect(loadSiteSettings()).resolves.toMatchObject({ productName: 'Folio' })
  })

  it('returns empty settings when the read fails or yields nothing', async () => {
    for (const response of [
      new Response('nope', { status: 500 }),
      new Response(JSON.stringify([]), { status: 200 }),
    ]) {
      vi.stubGlobal('fetch', vi.fn(async () => response))
      await expect(loadSiteSettings()).resolves.toEqual(NO_SITE_SETTINGS)
    }
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    await expect(loadSiteSettings()).resolves.toEqual(NO_SITE_SETTINGS)
  })

  it('asks the resolved API base with the anon key', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await loadSiteSettings()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/rest/v1/site_settings')
    expect((init.headers as Record<string, string>).apikey).toBe('anon-key')
  })

  it('passes the abort signal through', async () => {
    let seen: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      seen = init?.signal ?? undefined
      return new Response(JSON.stringify([]), { status: 200 })
    }))
    const controller = new AbortController()
    await loadSiteSettings(controller.signal)
    expect(seen).toBe(controller.signal)
  })
})