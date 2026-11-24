/**
 * Backdrop layout tests — the spans the editor paints under the textarea.
 */
import { describe, expect, it } from 'vitest'
import { LANGUAGE_SPECS, tokenizeLines } from './languages'
import { decorateLine, decorationsForLine } from './pieces'

const line = (source: string) => tokenizeLines(source, LANGUAGE_SPECS.verilog)[0]
const text = (segments: ReturnType<typeof line>) => segments.map(segment => segment.text).join('')

describe('decorateLine', () => {
  it('keeps tokens whole when nothing overlaps them', () => {
    const pieces = decorateLine(line('assign wire_a = 1;'), [])
    expect(pieces.map(piece => piece.text).join('')).toBe('assign wire_a = 1;')
    expect(pieces[0]).toMatchObject({ kind: 'keyword', text: 'assign' })
    expect(pieces.some(piece => piece.className === undefined)).toBe(true)
  })

  it('splits a token so a match inside it shows both colours', () => {
    const segments = line('assign')
    const pieces = decorateLine(segments, [{ from: 2, to: 5, className: 'code-match' }])
    expect(pieces.map(piece => `${piece.text}${piece.className ? `(${piece.className})` : ''}`)).toEqual([
      'as', 'sig(code-match)', 'n',
    ])
    expect(text(segments)).toBe('assign')
  })

  it('paints a ghost suffix at the caret without consuming a character', () => {
    const pieces = decorateLine(line('wire con'), [
      { from: 8, to: 8, className: 'code-ghost', insert: 'troller' },
    ])
    expect(pieces.map(piece => piece.text).join('')).toBe('wire controller')
    expect(pieces.at(-1)).toMatchObject({ className: 'code-ghost', text: 'troller' })
    expect(pieces.at(-2)?.text).toBe('con')
  })

  it('places the ghost on an empty line too', () => {
    const pieces = decorateLine([], [{ from: 0, to: 0, className: 'code-ghost', insert: 'begin' }])
    expect(pieces).toEqual([{ kind: null, text: 'begin', className: 'code-ghost', key: '0i0' }])
  })

  it('marks several matches on one row and ignores rows with none', () => {
    const segments = line('R1 a b R2')
    const decorations = decorationsForLine(0, 9, [0, 7], 2, 7)
    const pieces = decorateLine(segments, decorations)
    expect(pieces.filter(piece => piece.className === 'code-match').map(piece => piece.text)).toEqual(['R1'])
    expect(pieces.filter(piece => piece.className === 'code-match code-match-active').map(piece => piece.text)).toEqual(['R2'])
    expect(decorationsForLine(20, 4, [0, 6], 2, 6)).toEqual([])
  })

  it('clamps decorations that run past the end of the row', () => {
    const pieces = decorateLine(line('ab'), [{ from: 1, to: 90, className: 'code-match' }])
    expect(pieces.map(piece => piece.text).join('')).toBe('ab')
    expect(pieces[1].className).toBe('code-match')
  })
})
