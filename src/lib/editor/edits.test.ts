/**
 * Editing behaviour tests — the parts that make an editor feel like an editor.
 */
import { describe, expect, it } from 'vitest'
import { LANGUAGE_SPECS } from './languages'
import {
  BRACKET_PAIRS,
  applyCompletion,
  backspacePair,
  findMatches,
  indentSelection,
  insertNewline,
  lineStartOf,
  matchingBracket,
  nextIndent,
  outdentSelection,
  positionOf,
  replaceRange,
  selectLineRange,
  toggleLineComment,
  wordPrefixAt,
  wrapQuotes,
} from './edits'

const verilog = LANGUAGE_SPECS.verilog
const python = LANGUAGE_SPECS.python
const spice = LANGUAGE_SPECS.spice
const state = (value: string, start = value.length, end = start) => ({ value, start, end })

describe('insertNewline', () => {
  it('carries the current line indent down to the next line', () => {
    const result = insertNewline(state('  assign a = b'), verilog)
    expect(result.value).toBe('  assign a = b\n  ')
    expect(result.start).toBe('  assign a = b\n  '.length)
  })

  it('adds a level after a line that opens a block, and none after a statement', () => {
    expect(insertNewline(state('module m\n  begin'), verilog).value).toBe('module m\n  begin\n    ')
    expect(insertNewline(state('  assign a = b;'), verilog).value).toBe('  assign a = b;\n  ')
  })

  it('splits a bracket pair onto three lines and leaves the caret on the middle one', () => {
    const result = insertNewline(state('foo()', 4), verilog)
    expect(result.value).toBe('foo(\n  \n)')
    expect(result.start).toBe(7)
  })

  it('indents a Python line after a colon', () => {
    expect(insertNewline(state('def f():'), python).value).toBe('def f():\n  ')
    expect(insertNewline(state('  return 1'), python).value).toBe('  return 1\n  ')
  })
})

describe('nextIndent', () => {
  it('reports the caret line indent plus a level when the line opens a block', () => {
    expect(nextIndent('    wire a', 8, verilog)).toBe('    ')
    expect(nextIndent('  begin', 7, verilog)).toBe('    ')
  })
})

describe('indentSelection', () => {
  it('inserts a tab stop at an empty caret', () => {
    const result = indentSelection(state('assign x'), verilog)
    expect(result.value).toBe('assign x  ')
    expect(result.start).toBe(10)
  })

  it('jumps over a closer instead of inserting when the caret sits before one', () => {
    const result = indentSelection(state('foo()', 4), verilog)
    expect(result.value).toBe('foo()')
    expect(result.start).toBe(5)
  })

  it('indents every line of a block selection', () => {
    const result = indentSelection(state('a\nb\nc', 0, 5), verilog)
    expect(result.value).toBe('  a\n  b\n  c')
  })

  it('is undone by outdent', () => {
    const indented = indentSelection(state('a\nb\nc', 0, 5), verilog)
    const outdented = outdentSelection({ ...indented, start: 0, end: 9 }, verilog)
    expect(outdented.value).toBe('a\nb\nc')
  })

  it('outdents a single caret by the tab stop, then the remaining spaces', () => {
    expect(outdentSelection(state('    a', 4), verilog).value).toBe('  a')
    expect(outdentSelection(state('  a', 2), verilog).value).toBe('a')
  })
})

describe('wrapQuotes', () => {
  it('inserts the matching closer and keeps the caret between them', () => {
    for (const open of ['(', '[', '{']) {
      const result = wrapQuotes(state('x'), open, BRACKET_PAIRS[open])
      expect(result.value).toBe(`x${open}${BRACKET_PAIRS[open]}`)
      expect(result.start).toBe(2)
    }
  })

  it('wraps a selection rather than replacing it', () => {
    const result = wrapQuotes(state('net_a', 0, 5), '"', '"')
    expect(result.value).toBe('"net_a"')
    expect(result.start).toBe(1)
    expect(result.end).toBe(6)
  })

  it('moves over a closer that is already there', () => {
    const result = wrapQuotes(state('foo()', 4), ')', ')')
    expect(result.value).toBe('foo()')
    expect(result.start).toBe(5)
  })

  it('pairs a quote once and steps over the second', () => {
    expect(wrapQuotes(state('x = '), '"', '"').value).toBe('x = ""')
    expect(wrapQuotes(state('x = ""', 4), '"', '"').value).toBe('x = ""')
  })

  it('nests an opener typed inside an empty pair instead of stepping over it', () => {
    const result = wrapQuotes(state('foo()', 4), '(', ')')
    expect(result.value).toBe('foo(())')
    expect(result.start).toBe(5)
  })
})

describe('backspacePair', () => {
  it('deletes both halves of an empty pair', () => {
    const result = backspacePair(state('foo()', 4), verilog)
    expect(result?.value).toBe('foo')
    expect(result?.start).toBe(3)
  })

  it('leaves the browser to handle anything that is not a pair', () => {
    expect(backspacePair(state('foo(', 4), verilog)).toBeNull()
    expect(backspacePair(state('a', 1), verilog)).toBeNull()
  })
})

describe('toggleLineComment', () => {
  it('comments a line and comments it back', () => {
    const commented = toggleLineComment(state('assign a = b', 0, 0), verilog)
    expect(commented.value).toBe('// assign a = b')
    expect(toggleLineComment(commented, verilog).value).toBe('assign a = b')
  })

  it('keeps the indentation and toggles a whole block', () => {
    const commented = toggleLineComment(state('  wire a\n  wire b', 0, 16), verilog)
    expect(commented.value).toBe('  // wire a\n  // wire b')
    expect(toggleLineComment({ ...commented, start: 0, end: 22 }, verilog).value).toBe('  wire a\n  wire b')
  })

  it('uses the language marker and refuses for a language without one', () => {
    expect(toggleLineComment(state('V1 a b dc 5', 0, 0), spice).value).toBe('* V1 a b dc 5')
    expect(toggleLineComment(state('plain', 0, 0), LANGUAGE_SPECS.text).changed).toBe(false)
  })

  it('anchors the caret to the line so the cursor does not drift', () => {
    const result = toggleLineComment(state('wire a', 6), verilog)
    expect(result.start).toBe(9)
  })
})

describe('matchingBracket', () => {
  it('pairs from either side and through nesting', () => {
    expect(matchingBracket('foo(bar(baz))', 3)).toBe(12)
    expect(matchingBracket('foo(bar(baz))', 12)).toBe(3)
    expect(matchingBracket('foo(bar(baz))', 7)).toBe(11)
  })

  it('gives up on an unbalanced buffer instead of guessing', () => {
    expect(matchingBracket('foo(bar', 3)).toBeNull()
    expect(matchingBracket('foo bar)', 7)).toBeNull()
  })
})

describe('applyCompletion', () => {
  it('replaces the partial word under the caret, including its tail', () => {
    const result = applyCompletion(state('assign res', 10), 'resolver', 7)
    expect(result.value).toBe('assign resolver')
    expect(result.start).toBe(15)
  })
})

describe('wordPrefixAt', () => {
  it('takes the word the caret is inside', () => {
    expect(wordPrefixAt('assign reset', 12)).toEqual({ prefix: 'reset', start: 7 })
    expect(wordPrefixAt('assign ', 7)).toEqual({ prefix: '', start: 7 })
  })
})

describe('findMatches and replaceRange', () => {
  it('finds every occurrence and is case-insensitive unless told otherwise', () => {
    expect(findMatches('R1 R2 r3', 'r', false)).toEqual([0, 3, 6])
    expect(findMatches('R1 R2 r3', 'r', true)).toEqual([6])
    expect(findMatches('abc', '', false)).toEqual([])
  })

  it('replaces one range and leaves the rest alone', () => {
    const result = replaceRange(state('V1 a b dc 5'), 3, 4, 'out')
    expect(result.value).toBe('V1 out b dc 5')
    expect(result.start).toBe(6)
  })
})

describe('positionOf and selectLineRange', () => {
  it('reports zero-based line and column', () => {
    expect(positionOf('abc\ndefg', 5)).toEqual({ line: 1, column: 1 })
    expect(positionOf('abc', 0)).toEqual({ line: 0, column: 0 })
  })

  it('expands a caret range to whole lines', () => {
    expect(selectLineRange('abc\ndef\nghi', 5, 5)).toEqual({ from: 4, to: 7 })
    expect(lineStartOf('abc\ndef', 5)).toBe(4)
  })
})
