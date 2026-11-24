import { describe, expect, it } from 'vitest'
import {
  RICH_TEXT_LIMITS, normalizeRichText, richTextHasText, richTextLength,
  richTextToHtml, richTextToPlainText, safeRichTextHref, serializeRichTextDom,
} from './richText'

describe('safeRichTextHref', () => {
  it('keeps http(s) and mailto links only', () => {
    expect(safeRichTextHref('https://example.com/a')).toBe('https://example.com/a')
    expect(safeRichTextHref('mailto:a@b.c')).toBe('mailto:a@b.c')
    expect(safeRichTextHref('javascript:alert(1)')).toBeUndefined()
    expect(safeRichTextHref('data:text/html,x')).toBeUndefined()
    expect(safeRichTextHref('/relative')).toBeUndefined()
    expect(safeRichTextHref('   ')).toBeUndefined()
    expect(safeRichTextHref(undefined)).toBeUndefined()
  })
})

describe('normalizeRichText', () => {
  it('normalises a mixed document and merges adjacent identical runs', () => {
    const blocks = normalizeRichText([
      { type: 'paragraph', runs: [{ text: 'One ' }, { text: 'bold', bold: true }, { text: 'bold', bold: true }] },
      { type: 'heading', level: 3, runs: [{ text: 'Sub' }] },
      { type: 'list', ordered: true, items: [[{ text: 'First' }], [{ text: 'Second' }]] },
      { type: 'quote', runs: [{ text: 'Quoted' }] },
    ])
    expect(blocks).toHaveLength(4)
    expect(blocks[0]).toEqual({
      type: 'paragraph',
      runs: [{ text: 'One ' }, { text: 'boldbold', bold: true }],
    })
    expect(blocks[1]).toEqual({ type: 'heading', level: 3, runs: [{ text: 'Sub' }] })
    expect(blocks[2]).toEqual({ type: 'list', ordered: true, items: [[{ text: 'First' }], [{ text: 'Second' }]] })
    expect(blocks[3]).toEqual({ type: 'quote', runs: [{ text: 'Quoted' }] })
  })

  it('drops unknown blocks, empty blocks and unsafe hrefs', () => {
    const blocks = normalizeRichText([
      { type: 'script', runs: [{ text: 'alert(1)' }] },
      { type: 'paragraph', runs: [] },
      { type: 'paragraph', runs: [{ text: ' ' }] },
      { type: 'paragraph', runs: [{ text: 'Safe', href: 'https://example.com' }, { text: ' unsafe', href: 'javascript:alert(1)' }] },
      { type: 'list', items: [] },
    ])
    expect(blocks).toEqual([
      { type: 'paragraph', runs: [{ text: 'Safe', href: 'https://example.com' }, { text: ' unsafe' }] },
    ])
  })

  it('accepts a plain string as one paragraph', () => {
    expect(normalizeRichText('Hello')).toEqual([{ type: 'paragraph', runs: [{ text: 'Hello' }] }])
  })

  it('caps a hostile document', () => {
    const huge = 'x'.repeat(RICH_TEXT_LIMITS.maxCharacters + 100)
    const blocks = normalizeRichText([{ type: 'paragraph', runs: [{ text: huge }] }])
    expect(richTextLength(blocks)).toBeLessThanOrEqual(RICH_TEXT_LIMITS.maxCharacters)
  })
})

describe('text projections', () => {
  it('reports whether a document has visible text', () => {
    expect(richTextHasText(normalizeRichText([]))).toBe(false)
    expect(richTextHasText(normalizeRichText([{ type: 'paragraph', runs: [{ text: 'x' }] }]))).toBe(true)
  })

  it('projects a plain-text version', () => {
    expect(richTextToPlainText(normalizeRichText([
      { type: 'paragraph', runs: [{ text: 'Intro' }] },
      { type: 'list', ordered: false, items: [[{ text: 'A' }], [{ text: 'B' }]] },
    ]))).toBe('Intro\n• A\n• B')
  })
})

describe('richTextToHtml', () => {
  it('escapes text and attributes', () => {
    const html = richTextToHtml(normalizeRichText([
      { type: 'paragraph', runs: [{ text: '<script>x</script>', bold: true }] },
      { type: 'paragraph', runs: [{ text: 'link', href: 'https://example.com/?a="b"' }] },
    ]))
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).toContain('href="https://example.com/?a=&quot;b&quot;"')
  })

  it('emits an editable empty paragraph for an empty document', () => {
    expect(richTextToHtml([])).toBe('<p><br></p>')
  })
})

describe('serializeRichTextDom', () => {
  const parse = (html: string): HTMLElement => {
    const root = document.createElement('div')
    root.innerHTML = html
    return root
  }

  it('reads paragraphs, headings, lists, quotes and inline marks', () => {
    const root = parse(
      '<p>Hello <strong>bold</strong> and <em>italic</em></p>' +
      '<h2>Title</h2>' +
      '<ul><li>One</li><li><a href="https://example.com">Two</a></li></ul>' +
      '<blockquote>Quoted</blockquote>',
    )
    expect(serializeRichTextDom(root)).toEqual([
      { type: 'paragraph', runs: [{ text: 'Hello ' }, { text: 'bold', bold: true }, { text: ' and ' }, { text: 'italic', italic: true }] },
      { type: 'heading', level: 2, runs: [{ text: 'Title' }] },
      { type: 'list', ordered: false, items: [[{ text: 'One' }], [{ text: 'Two', href: 'https://example.com' }]] },
      { type: 'quote', runs: [{ text: 'Quoted' }] },
    ])
  })

  it('does not carry scripts or unsafe links into the model', () => {
    const root = parse('<p>Safe <a href="javascript:alert(1)">link</a></p><script>alert(1)</script>')
    expect(serializeRichTextDom(root)).toEqual([
      { type: 'paragraph', runs: [{ text: 'Safe link' }] },
    ])
  })

  it('turns root-level text and breaks into paragraphs', () => {
    const root = parse('first<br>second')
    expect(serializeRichTextDom(root)).toEqual([
      { type: 'paragraph', runs: [{ text: 'first' }] },
      { type: 'paragraph', runs: [{ text: 'second' }] },
    ])
  })
})
