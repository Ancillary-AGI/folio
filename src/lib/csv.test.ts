import { describe, expect, it } from 'vitest'
import { csvCell, csvRow, tsvCell, toCsv } from './csv'

describe('csvCell', () => {
  it('quotes only when the cell needs it and doubles embedded quotes', () => {
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('a\nb')).toBe('"a\nb"')
  })

  it('prefixes a spreadsheet formula leader with a single quote', () => {
    expect(csvCell('=cmd|/c calc')).toBe(`'=cmd|/c calc`)
    expect(csvCell('+HYPERLINK("x")')).toBe(`"'+HYPERLINK(""x"")"`)
    expect(csvCell('-10+20')).toBe(`'-10+20`)
    expect(csvCell('@SUM(1,1)')).toBe(`"'@SUM(1,1)"`)
    expect(csvCell('=1').startsWith(`'`)).toBe(true)
  })

  it('treats null and undefined as empty cells', () => {
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
  })
})

describe('csvRow / toCsv', () => {
  it('joins with commas and emits CRLF line endings', () => {
    expect(csvRow(['a', 'b,c', 'd"e'])).toBe('a,"b,c","d""e"')
    expect(toCsv(['h1', 'h2'], [['1', '2'], ['3', '4']])).toBe('h1,h2\r\n1,2\r\n3,4')
  })
})

describe('tsvCell', () => {
  it('collapses tabs and line breaks into single-line cells', () => {
    expect(tsvCell('a\tb')).toBe('a b')
    expect(tsvCell('a\r\nb')).toBe('a b')
    expect(tsvCell('1k\twith tab')).toBe('1k with tab')
  })

  it('applies the same formula-leader prefix as the CSV writer', () => {
    expect(tsvCell('=1+1')).toBe(`'=1+1`)
    expect(tsvCell('+x')).toBe(`'+x`)
    expect(tsvCell('@x')).toBe(`'@x`)
    expect(tsvCell('plain')).toBe('plain')
  })

  it('treats null and undefined as empty cells', () => {
    expect(tsvCell(null)).toBe('')
    expect(tsvCell(undefined)).toBe('')
  })
})
