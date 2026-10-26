import { describe, expect, it } from 'vitest'
import { buildPartDrawing, type PartDrawingInput } from './partDrawing'

const beam: PartDrawingInput = {
  id: 'beam-1',
  name: 'Main Beam',
  dimensions: { length: 2, width: 0.1, height: 0.1 },
  materialName: 'Aluminum 6061-T6',
  massKg: 54,
}

const plate: PartDrawingInput = {
  id: 'plate-1',
  name: 'Support Plate',
  dimensions: { length: 0.5, width: 0.5, height: 0.02 },
  materialName: 'ABS',
  massKg: 0.525,
}

describe('machine-part engineering drawing', () => {
  it('emits a millimetre-sized A3 sheet with a title block', () => {
    const svg = buildPartDrawing(beam, { date: '2026-10-25', revision: 'B' })
    expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(svg).toContain('width="420mm" height="297mm" viewBox="0 0 420 297"')
    expect(svg).toContain('role="img"')
    expect(svg).toContain('>FOLIO</text>')
    expect(svg).toContain('>Main Beam</text>')
    expect(svg).toContain('>Aluminum 6061-T6</text>')
    expect(svg).toContain('>54.00 kg</text>')
    expect(svg).toContain('>1:10</text>')
    expect(svg).toContain('>A3</text>')
    expect(svg).toContain('>REV B</text>')
    expect(svg).toContain('>2026-10-25</text>')
    expect(svg).toContain('>1 / 1</text>')
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true)
  })

  it('draws third-angle views at a standard scale with nominal dimensions', () => {
    const svg = buildPartDrawing(beam, { date: '2026-10-25' })
    // 2000 × 100 × 100 mm at 1:10 → 200 × 10 and 10 × 10 rectangles.
    expect(svg).toContain('width="200" height="10"')
    expect(svg).toContain('width="10" height="10"')
    expect(svg).toContain('>FRONT VIEW</text>')
    expect(svg).toContain('>TOP VIEW</text>')
    expect(svg).toContain('>RIGHT SIDE</text>')
    // Overall dimensions in millimetres, not metres or screen pixels.
    expect(svg).toContain('>2000</text>')
    expect(svg).toContain('>100</text>')
    expect(svg).toContain('>OVERALL LENGTH</text>')
    expect(svg).toContain('ALL DIMENSIONS IN MILLIMETRES')
    expect(svg).toContain('GENERAL TOLERANCES ±0.2 UNLESS NOTED')
  })

  it('draws a pictorial view when the smallest section reads on paper', () => {
    expect(buildPartDrawing(beam, { date: '2026-10-25' })).toContain('ISOMETRIC VIEW — NOT TO SCALE')
    expect(buildPartDrawing(plate, { date: '2026-10-25' })).toContain('ISOMETRIC VIEW — NOT TO SCALE')
    // A 2 mm shim at 1:10 would be a hairline, so the pictorial is omitted.
    const shim: PartDrawingInput = {
      ...plate,
      dimensions: { length: 2, width: 0.5, height: 0.002 },
    }
    expect(buildPartDrawing(shim, { date: '2026-10-25' })).not.toContain('ISOMETRIC VIEW')
  })

  it('uses a larger standard scale for a small part', () => {
    const small = { ...plate, dimensions: { length: 0.1, width: 0.1, height: 0.1 } }
    const svg = buildPartDrawing(small, { date: '2026-10-25' })
    // 100 mm cube: 1:1 needs 248 mm of sheet height, so 1:2 is the largest fit.
    expect(svg).toContain('>1:2</text>')
    expect(svg).toContain('width="50" height="50"')
    expect(svg).toContain('>100</text>')
  })

  it('records material-specific notes and escapes user text', () => {
    const svg = buildPartDrawing(
      { ...plate, name: 'Bracket <A> & "B"', materialName: 'PLA+' },
      { date: '2026-10-25', finish: 'as printed', notes: ['DEBURR ALL EDGES & < 0.5 mm'] },
    )
    expect(svg).toContain('Bracket &lt;A&gt; &amp; &quot;B&quot;')
    expect(svg).toContain('FINISH: AS PRINTED')
    expect(svg).toContain('MATERIAL: PLA+')
    expect(svg).toContain('DEBURR ALL EDGES &amp; &lt; 0.5 mm')
    expect(svg).not.toContain('<A>')
  })

  it('omits a finish claim when none is supplied', () => {
    expect(buildPartDrawing(beam, { date: '2026-10-25' })).not.toContain('FINISH:')
  })

  it('rejects degenerate and oversized parts instead of drawing nonsense', () => {
    expect(() =>
      buildPartDrawing(
        { ...beam, dimensions: { length: 0, width: 0.1, height: 0.1 } },
        { paperSize: 'A4' },
      ),
    ).toThrow(/positive/)
    expect(() =>
      buildPartDrawing(
        { ...beam, dimensions: { length: 5000, width: 5000, height: 5000 } },
        { paperSize: 'A4' },
      ),
    ).toThrow(/too large/)
  })

  it('honours A4 and Letter paper sizes', () => {
    expect(buildPartDrawing(beam, { paperSize: 'A4' })).toContain('width="297mm" height="210mm"')
    expect(buildPartDrawing(beam, { paperSize: 'Letter' })).toContain('width="279.4mm" height="215.9mm"')
  })
})
