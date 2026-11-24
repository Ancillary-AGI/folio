import { afterEach, describe, expect, it, vi } from 'vitest'

/* The API base is resolved by cloudConfig at import time, so the tests mock it
 * rather than mutating process.env after the module has loaded. */
vi.mock('../cloudConfig', () => ({
  cloudConfig: {
    apiUrl: 'https://db.example.com',
    resolvedAnonKey: 'anon-key',
  },
}))

import {
  LEGAL_PAGE_SLUGS, isLegalPageSlug, loadLegalPage, parseLegalPage, parseLegalPageSections,
} from './legalPages'

afterEach(() => {
  vi.unstubAllGlobals()
})

const paragraph = (text: string) => ({ type: 'paragraph', runs: [{ text }] })

const row = (overrides: Record<string, unknown> = {}) => ({
  slug: 'terms',
  title: 'Terms',
  eyebrow: 'Terms of service',
  heading: 'Your work is yours.',
  lede: 'The plain terms.',
  sections: [{ heading: 'Using Folio', body: [paragraph('Body copy.')] }],
  ...overrides,
})

describe('the routes', () => {
  it('lists exactly the pages the shell serves', () => {
    expect(LEGAL_PAGE_SLUGS).toEqual(['about', 'terms', 'privacy', 'security'])
  })

  it('recognises only those slugs', () => {
    for (const slug of LEGAL_PAGE_SLUGS) expect(isLegalPageSlug(slug)).toBe(true)
    // The removed page must not be accepted as a route.
    expect(isLegalPageSlug('responsible-ai')).toBe(false)
    expect(isLegalPageSlug('nonsense')).toBe(false)
  })
})

describe('parseLegalPage', () => {
  it('normalises a stored row', () => {
    const parsed = parseLegalPage(row({
      slug: 'about', title: 'About us', eyebrow: '', heading: 'Hello',
      sections: [{ heading: 'One', body: [paragraph('First.'), paragraph('Second.')] }],
    }))
    expect(parsed).toMatchObject({ slug: 'about', title: 'About us', eyebrow: 'About us' })
    expect(parsed?.sections[0].body).toEqual([paragraph('First.'), paragraph('Second.')])
  })

  it('keeps inline rich text and drops unsafe link schemes', () => {
    const parsed = parseLegalPage(row({
      sections: [{
        heading: 'Report',
        body: [{
          type: 'paragraph',
          runs: [
            { text: 'Write to ' },
            { text: 'the team', bold: true, href: 'https://example.com/x' },
            { text: ' or ' },
            { text: 'the wrong link', href: 'javascript:alert(1)' },
          ],
        }],
      }],
    }))
    expect(parsed?.sections[0].body).toEqual([{
      type: 'paragraph',
      runs: [
        { text: 'Write to ' },
        { text: 'the team', bold: true, href: 'https://example.com/x' },
        { text: ' or the wrong link' },
      ],
    }])
  })

  it('reads the pre-rich-text shape without taking the page down', () => {
    const parsed = parseLegalPage(row({
      sections: [{
        heading: 'Legacy',
        paragraphs: ['First.', '  ', 'Second.'],
        links: [
          { label: 'Mail', href: 'mailto:a@b.c' },
          { label: 'Script', href: 'javascript:alert(1)' },
        ],
      }],
    }))
    expect(parsed?.sections[0].body).toEqual([
      paragraph('First.'),
      paragraph('Second.'),
      {
        type: 'paragraph',
        runs: [{ text: 'Mail', href: 'mailto:a@b.c' }],
      },
    ])
  })

  it('drops a section with no usable body', () => {
    const parsed = parseLegalPage(row({
      sections: [{ heading: 'Empty', body: [] }, { heading: 'Kept', body: [paragraph('Body.')] }],
    }))
    expect(parsed?.sections.map((section) => section.heading)).toEqual(['Kept'])
  })

  it('refuses a row it cannot render', () => {
    expect(parseLegalPage(row({ slug: 'responsible-ai' }))).toBeUndefined()
    expect(parseLegalPage(row({ slug: 'nonsense' }))).toBeUndefined()
    expect(parseLegalPage(row({ heading: '  ' }))).toBeUndefined()
    expect(parseLegalPage(row({ title: '' }))).toBeUndefined()
    expect(parseLegalPage(null)).toBeUndefined()
    expect(parseLegalPage('about')).toBeUndefined()
  })
})

describe('parseLegalPageSections', () => {
  it('returns an empty list for anything that is not an array', () => {
    expect(parseLegalPageSections(null)).toEqual([])
    expect(parseLegalPageSections({})).toEqual([])
    expect(parseLegalPageSections('nope')).toEqual([])
  })

  it('keeps only sections it can render', () => {
    expect(parseLegalPageSections([
      { heading: '', body: [paragraph('x')] },
      { heading: 'Kept', body: [paragraph('x')] },
      null,
    ]).map((section) => section.heading)).toEqual(['Kept'])
  })
})

describe('loadLegalPage', () => {
  it('returns undefined when the read fails or yields nothing usable', async () => {
    for (const response of [
      new Response('nope', { status: 500 }),
      new Response(JSON.stringify([]), { status: 200 }),
      new Response(JSON.stringify([{ slug: 'unknown' }]), { status: 200 }),
    ]) {
      vi.stubGlobal('fetch', vi.fn(async () => response))
      await expect(loadLegalPage('privacy')).resolves.toBeUndefined()
    }
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    await expect(loadLegalPage('privacy')).resolves.toBeUndefined()
  })

  it('asks for one page by slug with the anon key', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await loadLegalPage('about')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/rest/v1/legal_pages')
    expect(url).toContain('slug=eq.about')
    expect((init.headers as Record<string, string>).apikey).toBe('anon-key')
  })

  it('calls the resolved API base, which is the local backend when unconfigured', async () => {
    /* cloudConfig falls back to the bundled backend at 127.0.0.1:54321, so a
     * deployment with no cloud project still has a database to read. */
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await loadLegalPage('about')
    const [url] = fetchMock.mock.calls[0] as unknown as [string]
    expect(url.startsWith('https://db.example.com/rest/v1/legal_pages')).toBe(true)
  })

  it('passes the abort signal through so navigation cancels the read', async () => {
    let seen: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      seen = init?.signal ?? undefined
      return new Response(JSON.stringify([]), { status: 200 })
    }))
    const controller = new AbortController()
    await loadLegalPage('security', controller.signal)
    expect(seen).toBe(controller.signal)
  })
})
