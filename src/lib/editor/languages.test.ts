/**
 * Lexer and completion-alphabet tests for the editor languages.
 */
import { describe, expect, it } from 'vitest'
import {
  LANGUAGE_SPECS,
  commonPrefix,
  completionVocabulary,
  rankCompletions,
  segmentsByLine,
  tokenize,
  tokenizeLines,
} from './languages'

const kinds = (source: string, id: keyof typeof LANGUAGE_SPECS) =>
  tokenize(source, LANGUAGE_SPECS[id])
    .filter(segment => segment.kind !== null)
    .map(segment => `${segment.kind}:${segment.text.trim()}`)

describe('tokenize', () => {
  it('colours Verilog keywords, types, sized literals, strings and both comment forms', () => {
    const out = kinds("module top (input a);\n  wire [7:0] bus = 8'hFF;\n  // note\n  /* block */ x = \"txt\";\nend", 'verilog')
    expect(out).toContain('keyword:module')
    expect(out).toContain('keyword:input')
    expect(out).toContain('type:wire')
    expect(out).toContain('number:8\'hFF')
    expect(out).toContain('string:"txt"')
    expect(out).toContain('comment:// note')
    expect(out).toContain('comment:/* block */')
  })

  it('treats Verilog port connections and compiler directives as their own roles', () => {
    const out = kinds('`include "defs.v"\nfoo f (.clk(clk), .rst(rst));', 'verilog')
    expect(out.some(entry => entry.startsWith('preprocessor:`include'))).toBe(true)
    expect(out).toContain('type:.clk')
    expect(out).toContain('type:.rst')
  })

  it('is case-insensitive for VHDL, as the language is', () => {
    const out = kinds('ENTITY counter IS\n  PORT (clk : IN STD_LOGIC);\nEND ENTITY;\n-- comment', 'vhdl')
    expect(out).toContain('keyword:ENTITY')
    expect(out).toContain('keyword:IN')
    expect(out).toContain('type:STD_LOGIC')
    expect(out).toContain('comment:-- comment')
  })

  it('marks SPICE commands as keywords, device designators as types, and * lines as comments', () => {
    const out = kinds('* a deck\n.param vdd=5\nR1 a b 1k\n.subckt stage in out\n.ends', 'spice')
    expect(out).toContain('comment:* a deck')
    expect(out.some(entry => entry.startsWith('keyword:.param'))).toBe(true)
    expect(out.some(entry => entry.startsWith('type:R1'))).toBe(true)
    expect(out.some(entry => entry.startsWith('keyword:.subckt'))).toBe(true)
    expect(out.some(entry => entry.startsWith('keyword:.ends'))).toBe(true)
  })

  it('colours the digital timing DSL with the words its parser accepts', () => {
    const out = kinds('GATE g1 AND out=y in=a,b\nFF f1 D q=nq clock=clk\nCLOCK c1 out=clk period=10\nSET n0 1\nRUN until=100', 'netlist')
    expect(out).toContain('keyword:GATE')
    expect(out).toContain('keyword:FF')
    expect(out).toContain('keyword:CLOCK')
    expect(out).toContain('keyword:SET')
    expect(out).toContain('keyword:RUN')
    expect(out).toContain('type:AND')
    expect(out).toContain('type:out')
    expect(out).toContain('type:q')
    expect(out).toContain('type:period')
    expect(out).toContain('number:100')
  })

  it('reads SPICE engineering suffixes as one number', () => {
    const out = kinds('V1 n0 n1 dc 3.3\nC1 a b 100n', 'spice')
    expect(out).toContain('number:3.3')
    expect(out).toContain('number:100n')
  })

  it('handles Python triple-quoted strings and decorators', () => {
    const out = kinds('def f():\n    """doc\n    string"""\n    return 3', 'python')
    expect(out.some(entry => entry.startsWith('string:"""doc'))).toBe(true)
    expect(out).toContain('keyword:return')
  })

  it('keeps C preprocessor lines together and counts them separately from keywords', () => {
    const out = kinds('#include <stdio.h>\nint main(void) { return 0; }', 'c')
    expect(out).toContain('preprocessor:#include <stdio.h>')
    expect(out).toContain('type:int')
    expect(out).toContain('keyword:return')
  })

  it('never loses a character: the segments reassemble into the source', () => {
    for (const id of Object.keys(LANGUAGE_SPECS) as (keyof typeof LANGUAGE_SPECS)[]) {
      const source = 'a1 = "x" // c\n2\n\nlast'
      expect(tokenize(source, LANGUAGE_SPECS[id]).map(segment => segment.text).join('')).toBe(source)
    }
  })
})

describe('segmentsByLine', () => {
  it('splits a token that spans lines so every row renders one line', () => {
    const lines = segmentsByLine(tokenize('/* a\nb */', LANGUAGE_SPECS.c))
    expect(lines).toHaveLength(2)
    expect(lines[0][0].kind).toBe('comment')
    expect(lines[1][0].kind).toBe('comment')
    expect(tokenizeLines('x\ny', LANGUAGE_SPECS.text)).toHaveLength(2)
  })
})

describe('completionVocabulary', () => {
  it('offers the language vocabulary plus identifiers from the buffer, and nothing invented', () => {
    const words = completionVocabulary(LANGUAGE_SPECS.verilog, 'module demo\n  wire counter_q;')
    expect(words).toContain('module')
    expect(words).toContain('wire')
    expect(words).toContain('counter_q')
    expect(words).not.toContain('quantum_flux_capacitor')
  })
})

describe('rankCompletions', () => {
  it('prefers prefix matches, shortest first, then substring matches', () => {
    const items = rankCompletions('res', ['resistor_model', 'reset', 'res', 'aggressive', 'resync'])
    expect(items[0]).toBe('res')
    expect(items.slice(0, 3)).toEqual(['res', 'reset', 'resync'])
    expect(items).toContain('aggressive')
    expect(items[items.length - 1]).toBe('aggressive')
  })

  it('needs a prefix, and the editor waits for two characters before asking', () => {
    expect(rankCompletions('', ['always'])).toEqual([])
    expect(rankCompletions('al', ['always', 'and', 'assign'])).toEqual(['always'])
  })

  it('caps the list', () => {
    expect(rankCompletions('a', ['aa', 'ab', 'ac', 'ad', 'ae', 'af', 'ag', 'ah', 'ai'], 8)).toHaveLength(8)
  })
})

describe('commonPrefix', () => {
  it('finds what several candidates share and stops at the difference', () => {
    expect(commonPrefix(['response', 'reset'])).toBe('res')
    expect(commonPrefix(['resistor', 'capacity'])).toBe('')
    expect(commonPrefix(['res'])).toBe('res')
    expect(commonPrefix([])).toBe('')
  })
})
