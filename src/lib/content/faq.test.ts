import { afterEach, describe, expect, it, vi } from 'vitest'
import { isFaqSurface, loadPublicFaq, parseFaqRows } from './faq'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('FAQ rows', () => {
  it('keeps complete question/answer pairs and drops malformed rows', () => {
    expect(parseFaqRows([
      { question: ' Why? ', answer: ' Because. ' },
      { question: '', answer: 'No question' },
      { question: 'No answer', answer: 42 },
      null,
    ])).toEqual([{ question: 'Why?', answer: 'Because.' }])
  })

  it('recognises only the two public surfaces', () => {
    expect(isFaqSurface('home')).toBe(true)
    expect(isFaqSurface('pricing')).toBe(true)
    expect(isFaqSurface('admin')).toBe(false)
    expect(isFaqSurface(null)).toBe(false)
  })

  it('asks for the requested surface, published only, in order', async () => {
    // Typed with parameters so the recorded call can be inspected: `vi.fn()` with
    // no signature infers a zero-argument function, and `calls[0][0]` then fails
    // to type.
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify([
      { question: 'Can I buy Pro today?', answer: 'Not yet.' },
    ]), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const rows = await loadPublicFaq('pricing')

    expect(rows).toEqual([{ question: 'Can I buy Pro today?', answer: 'Not yet.' }])
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('/rest/v1/faq_entries?')
    expect(url).toContain('surface=eq.pricing')
    expect(url).toContain('published=eq.true')
    expect(url).toContain('order=position.asc%2Cid.asc')
  })

  it('returns an empty list when the deployment cannot answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))

    expect(await loadPublicFaq()).toEqual([])
  })
})
