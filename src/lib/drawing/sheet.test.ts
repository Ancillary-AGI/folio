/**
 * The shared drawing sheet.
 *
 * Every exported drawing in Folio is built on this paper, so these tests are not
 * about one domain: they pin the geometry a reader measures a printout with. A
 * dimension line that lands 1 mm off, a title block whose cells stop matching the
 * dividers drawn for them, or a fit that silently picks a scale the sheet does not
 * state are all failures a user discovers on paper, in a workshop, with the app
 * closed.
 */
import { describe, expect, it } from 'vitest'
import {
  dimensionInk,
  escapeXml,
  fitBox,
  fitBoxAt,
  fitText,
  formatNumber,
  linearDimension,
  openSheet,
  paletteFor,
  paperSize,
  pickStandardScale,
  round,
  scaleLabel,
  STANDARD_SCALES,
} from './sheet'

/** Everything a sheet needs, with the least ceremony. */
const sheet = (overrides = {}) =>
  openSheet({ title: 'Test sheet', subject: 'test sheet', ...overrides })

const lines = (svg: string): string[] => svg.split('\n')

describe('paper', () => {
  it('knows the trimmed sizes it prints at', () => {
    expect(paperSize('A4')).toEqual({ width: 297, height: 210 })
    expect(paperSize('A3')).toEqual({ width: 420, height: 297 })
    expect(paperSize('Letter')).toEqual({ width: 279.4, height: 215.9 })
    // An unset paper is the sheet a user reaches for first, not a crash.
    expect(paperSize(undefined)).toEqual({ width: 297, height: 210 })
  })

  it('separates print ink from screen ink', () => {
    expect(paletteFor('print').paper).toBe('#ffffff')
    expect(paletteFor().paper).toBe('#ffffff')
    expect(paletteFor('screen').paper).toBe('#0b1017')
    expect(paletteFor('screen').text).not.toBe(paletteFor('print').text)
  })
})

describe('text helpers', () => {
  it('escapes every character that would end an element', () => {
    expect(escapeXml(`<a & "b" 'c'>`)).toBe('&lt;a &amp; &quot;b&quot; &apos;c&apos;&gt;')
  })

  it('keeps whole numbers whole and shows one decimal for a fraction', () => {
    expect(formatNumber(12)).toBe('12')
    expect(formatNumber(12.5)).toBe('12.5')
    expect(formatNumber(12.49)).toBe('12.5')
  })

  it('rounds to two decimals, which is half a hair on a printed sheet', () => {
    expect(round(1.23456)).toBe(1.23)
    expect(round(-1.23456)).toBe(-1.23)
    expect(round(0.004)).toBe(0)
  })

  it('trims a string to the room it has rather than overprinting the rule', () => {
    expect(fitText('SHORT', 40, 4)).toBe('SHORT')
    const trimmed = fitText('A very long project name indeed', 20, 4)
    expect(trimmed.endsWith('…')).toBe(true)
    expect(trimmed.length).toBeLessThan(12)
    // Even a one-character cell still shows something.
    expect(fitText('ABCDEFG', 1, 4)).toHaveLength(3)
  })
})

describe('scale', () => {
  it('labels both enlargements and reductions as a drafter writes them', () => {
    expect(scaleLabel(5)).toBe('5:1')
    expect(scaleLabel(1)).toBe('1:1')
    expect(scaleLabel(0.02)).toBe('1:50')
    expect(scaleLabel(0.005)).toBe('1:200')
  })

  it('takes the largest preferred scale that fits, and says so when none does', () => {
    const needed = (scale: number) => ({ width: 1000 * scale, height: 200 * scale })
    expect(pickStandardScale(300, 300, needed)).toBe(0.2)
    // Exactly room for 1000 units at 5:1: the boundary scale is still usable.
    expect(pickStandardScale(5000, 1000, needed)).toBe(5)
    // Even 1:1000 needs a millimetre of paper, so half a millimetre fits nothing.
    expect(pickStandardScale(0.5, 0.5, needed)).toBeNull()
    expect(STANDARD_SCALES[0]).toBeGreaterThan(STANDARD_SCALES[STANDARD_SCALES.length - 1])
  })
})

describe('openSheet', () => {
  it('opens a document that a browser and a plotter both read', () => {
    const svg = sheet({ paper: 'A3' }).toString()
    expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg')).toBe(true)
    expect(svg).toContain('width="420mm" height="297mm" viewBox="0 0 420 297"')
    expect(svg).toContain('role="img" aria-labelledby="sheet-title"')
    expect(svg).toContain('<title id="sheet-title">Test sheet — test sheet</title>')
    expect(svg).toContain('<rect width="420" height="297" fill="#ffffff"/>')
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true)
    expect((svg.match(/<\/svg>/g) ?? []).length).toBe(1)
    // Reading one sheet twice must not append a second closing tag.
    const twice = sheet({ paper: 'A3' })
    expect(twice.toString()).toBe(twice.toString())
  })

  it('lets a page of two sheets name each one separately', () => {
    expect(sheet({ titleId: 'first' }).toString()).toContain('aria-labelledby="first"')
    expect(sheet({ titleId: 'first' }).toString()).toContain('<title id="first">')
  })

  it('reserves the bottom band for the block and keeps geometry out of it', () => {
    const board = sheet()
    // 10 mm of trim margin, then the printed border, then the drawing area.
    expect(board.frame).toEqual({ x: 10, y: 10, width: 277, height: 190 })
    expect(board.content.x).toBe(18)
    expect(board.block.y).toBe(160)
    expect(board.block.x + board.block.width).toBeLessThanOrEqual(board.frame.x + board.frame.width)
    expect(board.content.y + board.content.height).toBeLessThan(board.block.y)
  })

  it('honours a block the domain needs taller or wider', () => {
    const board = sheet({ blockWidth: 150, blockHeight: 44 })
    expect(board.block.width).toBe(150)
    expect(board.block.height).toBe(44)
    // The block sits 4 mm inside the border's bottom edge, so on A4 it starts at
    // 10 + 190 - 4 - 44 = 152 and the drawing area stops 12 mm above that.
    expect(board.block.y).toBe(152)
    expect(board.content.height).toBe(130)
    expect(board.content.height).toBe(board.block.y - board.frame.y - 12)
  })

  it('draws the border, the zone ticks and the zone letters', () => {
    const board = sheet()
    board.drawChrome()
    const svg = board.toString()
    expect(svg).toContain('<rect x="10" y="10" width="277" height="190"/>')
    expect(svg).toContain('<rect x="15" y="15" width="267" height="180" stroke-width="0.3"/>')
    // Three quarter-points on the top and bottom edges, two thirds on the sides.
    expect((svg.match(/y1="10" x2=/g) ?? []).length).toBe(3)
    for (const zone of ['A', 'B', 'C', 'D', '1', '2', '3']) {
      expect(svg).toContain(`>${zone}</text>`)
    }
  })
})

describe('fitting a model to paper', () => {
  it('takes the binding dimension and centres the rest', () => {
    const board = sheet()
    const fit = board.fitTo({ x: 0, y: 0, width: 100, height: 50 })
    expect(fit.scale).toBeCloseTo(261 / 100, 6)
    expect(fit.offsetX).toBeCloseTo(18, 6)
    expect(fit.offsetY).toBeCloseTo(18 + (138 - 50 * fit.scale) / 2, 6)
    expect(fit.toPaper(0, 0)).toEqual({ x: fit.offsetX, y: fit.offsetY })
    expect(fit.toPaper(100, 50).x).toBeCloseTo(18 + 261, 6)
  })

  it('keeps the line weight constant on paper whatever the fit is', () => {
    const fit = sheet().fitTo({ x: 0, y: 0, width: 100, height: 50 })
    expect(fit.stroke(0.22)).toBeCloseTo(0.22 / fit.scale, 2)
    // A model unit at this scale is far less than a millimetre of ink.
    expect(fit.stroke(0)).toBe(0)
  })

  it('never divides by a model that has no size', () => {
    const fit = sheet().fitTo({ x: 0, y: 0, width: 0, height: 0 })
    expect(Number.isFinite(fit.scale)).toBe(true)
    expect(fit.scale).toBeGreaterThan(0)
    expect(Number.isFinite(fit.offsetX)).toBe(true)
  })

  it('leaves a clear edge when asked to', () => {
    const board = sheet()
    const model = { x: 0, y: 0, width: 100, height: 50 }
    const bare = board.fitTo(model)
    const edged = board.fitTo(model, 20)
    expect(edged.scale).toBeLessThan(bare.scale)
    // Padding is symmetric, so the model re-centres inside the shrunken box.
    expect(edged.offsetX).toBeCloseTo(18 + 20 + (261 - 40 - 100 * edged.scale) / 2, 6)
    expect(edged.toPaper(0, 0).x).toBeGreaterThanOrEqual(board.content.x + 20 - 1e-9)
    expect(edged.toPaper(model.width, 0).x).toBeLessThanOrEqual(
      board.content.x + board.content.width - 20 + 1e-9,
    )
  })

  it('fits into any area, not only the whole content box', () => {
    const band = { x: 0, y: 0, width: 100, height: 40 }
    const fit = fitBox({ x: 0, y: 0, width: 200, height: 10 }, band)
    expect(fit.scale).toBeCloseTo(0.5, 6)
    expect(fit.offsetY).toBeCloseTo((40 - 5) / 2, 6)
  })

  it('draws at the scale it declares, not at the largest that fits', () => {
    const band = { x: 0, y: 0, width: 100, height: 40 }
    const fit = fitBoxAt({ x: 0, y: 0, width: 200, height: 10 }, band, 0.25)
    expect(fit.scale).toBe(0.25)
    // 200 units at 1:4 is 50 mm of paper, centred in the 100 mm band.
    expect(fit.toPaper(0, 0).x).toBeCloseTo(25, 6)
    expect(fit.toPaper(200, 0).x).toBeCloseTo(75, 6)
    expect(fit.toPaper(0, 10).y).toBeCloseTo(18.75 + 2.5, 6)
  })

  it('wraps model geometry in one transform, in and out', () => {
    const fit = sheet().fitTo({ x: 0, y: 0, width: 100, height: 50 })
    expect(fit.open()).toMatch(/^<g transform="translate\(-?[\d.]+ -?[\d.]+\) scale\([\d.]+\)">$/)
    expect(fit.close()).toBe('</g>')
  })
})

describe('dimensions', () => {
  const palette = paletteFor('print')

  it('puts a 2.2 mm arrowhead with its butt on the point', () => {
    const at = dimensionInk(palette).arrow({ x: 10, y: 10 }, 0)
    expect(at).toContain('10,10 12.2,10')
    expect(at).toContain('fill="#111827"')
  })

  it('runs a thin line with arrowheads inboard at both ends', () => {
    const run = dimensionInk(palette).run({ x: 0, y: 20 }, { x: 40, y: 20 })
    expect(run).toContain('stroke-width="0.18"')
    expect(run.match(/<polygon/g)).toHaveLength(2)
    // A vertical run points its arrows along the run, not across it.
    expect(dimensionInk(palette).run({ x: 5, y: 0 }, { x: 5, y: 30 })).toContain('5,0 5,2.2')
  })

  it('measures across a feature and prints the value in millimetres', () => {
    const svg = linearDimension({
      from: { x: 20, y: 50 },
      to: { x: 120, y: 50 },
      offset: 14,
      text: '100',
      caption: 'OVERALL LENGTH',
      palette,
    }).join('\n')
    expect(svg).toContain('<line x1="20" y1="64" x2="120" y2="64"')
    // Witness lines start 1 mm off the feature and overshoot the line by 2 mm.
    expect(svg).toContain('<line x1="20" y1="51" x2="20" y2="66"')
    expect(svg).toContain('>100</text>')
    expect(svg).toContain('y="61.4"')
    expect(svg).toContain('>OVERALL LENGTH</text>')
    expect(svg).toContain('y="67.4"')
  })

  it('mirrors a dimension placed on the other side of the feature', () => {
    const svg = linearDimension({
      from: { x: 20, y: 50 },
      to: { x: 120, y: 50 },
      offset: -14,
      text: '100',
      palette,
    }).join('\n')
    expect(svg).toContain('<line x1="20" y1="36" x2="120" y2="36"')
    expect(svg).toContain('<line x1="20" y1="49" x2="20" y2="34"')
  })

  it('turns the text of a vertical dimension so it reads up the sheet', () => {
    const svg = linearDimension({
      from: { x: 40, y: 10 },
      to: { x: 40, y: 90 },
      offset: 13,
      text: '80',
      palette,
    }).join('\n')
    expect(svg).toContain('<line x1="53" y1="10" x2="53" y2="90"')
    expect(svg).toContain('transform="rotate(-90')
    expect(svg).toContain('x1="41" y1="10" x2="55" y2="10"')
  })

  it('haloes the number so it stays legible over the geometry it crosses', () => {
    const svg = dimensionInk(palette).text({ x: 10, y: 10 }, '5')
    expect(svg).toContain('paint-order="stroke"')
    expect(svg).toContain('stroke="#ffffff"')
    expect(svg).toContain('font-size="3"')
  })

  it('escapes a value that contains markup', () => {
    expect(dimensionInk(palette).text({ x: 0, y: 0 }, '<A> & B')).toContain('&lt;A&gt; &amp; B')
  })
})

describe('notes', () => {
  it('draws nothing when there is nothing to say', () => {
    const board = sheet()
    const before = board.toString()
    board.drawNotes([])
    expect(board.toString()).toBe(before)
  })

  it('stacks the lines under a NOTES heading, escaped and inside the band', () => {
    const board = sheet()
    board.drawNotes(['DO NOT SCALE DRAWING', 'Welds per <ISO 5817>'])
    const svg = board.toString()
    expect(svg).toContain('>NOTES</text>')
    expect(svg).toContain('>DO NOT SCALE DRAWING</text>')
    expect(svg).toContain('Welds per &lt;ISO 5817&gt;')
    // One note size for the whole strip, carried by the group so the rows inherit it.
    expect((svg.match(/font-size="2.4"/g) ?? []).length).toBe(1)
    expect((svg.match(/font-size="2.2"/g) ?? []).length).toBe(1)
    // The first note clears the heading; the band belongs to the block row.
    const first = Number(lines(svg).find((line) => line.includes('DO NOT SCALE'))?.match(/y="([\d.]+)"/)?.[1])
    expect(first).toBeGreaterThan(board.block.y)
    expect(first).toBeLessThan(board.size.height)
  })

  it('trims a note to the room left of the title block', () => {
    const board = sheet()
    board.drawNotes(['X'.repeat(400)])
    expect(board.toString()).toContain('…')
  })
})

describe('title block', () => {
  it('states size, scale, date and sheet by default', () => {
    const board = sheet({ paper: 'A4' })
    board.drawTitleBlock({ title: 'Girder', date: '2026-10-25', scaleNote: '1:50' })
    const svg = board.toString()
    expect(svg).toContain('>FOLIO</text>')
    expect(svg).toContain('>REV A</text>')
    expect(svg).toContain('>Girder</text>')
    for (const cell of ['SIZE', 'SCALE', 'DATE', 'SHEET', 'A4', '1:50', '2026-10-25', '1/1']) {
      expect(svg).toContain(`>${cell}</text>`)
    }
  })

  it('divides the band into exactly as many cells as it labels', () => {
    const board = sheet()
    board.drawTitleBlock({
      title: 'T',
      cells: [1, 2, 3, 4, 5, 6].map((index) => ({ label: `C${index}`, value: String(index) })),
    })
    const svg = board.toString()
    for (const index of [1, 2, 3, 4, 5, 6]) {
      expect(svg).toContain(`>C${index}</text>`)
    }
    // Five dividers for six cells, and no stray ninth column.
    expect((svg.match(/y1="[\d.]+" x2="[\d.]+" y2="196"/g) ?? []).length).toBe(5)
  })

  it('keeps a revision and a date the caller gave, and repeats the project only once', () => {
    const board = sheet()
    board.drawTitleBlock({ title: 'Same name', projectName: 'Same name', revision: 'C', date: '2020-01-01' })
    const svg = board.toString()
    expect(svg).toContain('>REV C</text>')
    expect(svg).toContain('>2020-01-01</text>')
    // A project called the same thing as the sheet is not a second label.
    expect((svg.match('>Same name</text>') !== null && svg.split('>Same name</text>').length - 1)).toBe(1)
  })

  it('trims a value that would overrun its cell', () => {
    const board = sheet()
    board.drawTitleBlock({
      title: 'T',
      cells: [
        { label: 'MATERIAL', value: 'A'.repeat(80) },
        { label: 'MASS', value: '1.0 kg' },
        { label: 'SCALE', value: '1:50' },
        { label: 'SIZE', value: 'A3' },
        { label: 'SHEET', value: '1/1' },
      ],
    })
    const svg = board.toString()
    // Five cells across a 144 mm band leaves room for about fifteen characters,
    // so an over-long material name must not print across the divider.
    expect(svg).toContain('…')
    expect(svg).not.toContain('A'.repeat(80))
  })

  it('pushes markup in paint order, so paper never covers geometry', () => {
    const board = sheet()
    board.push('<rect data-role="model"/>')
    board.drawTitleBlock({ title: 'T' })
    const svg = board.toString()
    expect(svg.indexOf('data-role="model"')).toBeLessThan(svg.indexOf('>FOLIO</text>'))
  })
})
