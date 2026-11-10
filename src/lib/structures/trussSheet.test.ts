/**
 * The truss framing drawing.
 *
 * Two promises are pinned here, because they are the two a fabricator is burned
 * by: the sheet states the scale it was actually drawn at, and the numbers in the
 * bar schedule are the solver's, not a re-derivation that can drift. What the
 * solver refused to answer is also pinned — an unanalysed model must say so on
 * the paper, since a schedule of zeroes reads exactly like a schedule of answers.
 */
import { describe, expect, it } from 'vitest'
import { solveTruss, type TrussModel, type TrussResult } from './truss'
import { TRUSS_PRESETS, trussCounts, trussPresetById } from './trussPresets'
import { buildTrussDrawing } from './trussSheet'

const escape = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const pratt = trussPresetById('pratt-footbridge')?.model
const warren = trussPresetById('warren-girder')?.model
const kingpost = trussPresetById('kingpost-roof')?.model
const canopy = trussPresetById('canopy-bracket')?.model
if (!pratt || !warren || !kingpost || !canopy) throw new Error('A truss preset went missing.')

const solved = (model: TrussModel): TrussResult => {
  const analysis = solveTruss(model)
  if (!analysis.result) throw new Error(`Fixture should solve: ${analysis.error}`)
  return analysis.result
}

const drawing = (model: TrussModel, overrides: { title?: string; [key: string]: unknown } = {}): string =>
  buildTrussDrawing(
    { model, result: solveTruss(model).result, status: solveTruss(model).error },
    { title: 'Footbridge girder', ...overrides },
  )

/** The x-extent of the drawn bars only, so the measurement is of the frame. */
function barExtents(svg: string): { minX: number; maxX: number } {
  const start = svg.indexOf('stroke-linecap="round" stroke-width="0.45"')
  const group = svg.slice(start, svg.indexOf('</g>', start))
  const xs: number[] = []
  for (const match of group.matchAll(/x1="(-?[\d.]+)".*?x2="(-?[\d.]+)"/g)) {
    xs.push(Number(match[1]), Number(match[2]))
  }
  expect(xs.length).toBeGreaterThan(0)
  return { minX: Math.min(...xs), maxX: Math.max(...xs) }
}

const declaredScale = (svg: string): number => {
  const cell = svg.match(/<text[^>]*>(1:\d+|\d+:1)<\/text>/)?.[1]
  expect(cell).toBeTruthy()
  return cell?.startsWith('1:') ? 1 / Number(cell.slice(2)) : Number(cell?.replace(':1', ''))
}

describe('buildTrussDrawing', () => {
  it('writes a real A3 sheet with the shared chrome', () => {
    const svg = drawing(pratt)
    expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(svg).toContain('width="420mm" height="297mm" viewBox="0 0 420 297"')
    expect(svg).toContain('role="img"')
    expect(svg).toContain('<title id="truss-drawing-title">Footbridge girder — truss framing drawing</title>')
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true)
    expect(svg).toContain('>FOLIO</text>')
    expect(svg).toContain('>TITLE</text>')
    // Zone letters, so a reference like "grid B/2" means the same thing twice.
    for (const zone of ['A', 'B', 'C', 'D', '1', '2', '3']) {
      expect(svg).toContain(`>${zone}</text>`)
    }
  })

  it('draws the elevation at the scale the title block declares', () => {
    const svg = drawing(pratt)
    // 12 m of girder on an A3 sheet is 240 mm at the largest preferred scale that
    // fits, and the geometry has to measure exactly that.
    expect(declaredScale(svg)).toBeCloseTo(1 / 50, 9)
    const { minX, maxX } = barExtents(svg)
    expect(maxX - minX).toBeCloseTo(12000 / 50, 1)
  })

  it('draws a short frame at a larger scale, never at a fake one', () => {
    const svg = drawing(kingpost)
    const scale = declaredScale(svg)
    const { minX, maxX } = barExtents(svg)
    expect(maxX - minX).toBeCloseTo(4000 * scale, 1)
    expect(scale).toBeGreaterThan(1 / 50)
  })

  it('schedules every bar with the solver force and the solver sign', () => {
    const result = solved(pratt)
    const svg = drawing(pratt)
    for (const member of pratt.members) {
      const demand = result.members[member.id]
      expect(svg).toContain(`>${(demand.force / 1e3).toFixed(2)}</text>`)
      // The on-bar note names tension or compression rather than trusting a sign.
      expect(svg).toContain(`${member.id} ${demand.force >= 0 ? 'T' : 'C'}`)
      expect(svg).toContain(`${member.from}→${member.to}`)
    }
    expect((svg.match(/→/g) ?? []).length).toBe(pratt.members.length)
  })

  it('marks a bar over its own capacity and says what the mark means', () => {
    const undersized: TrussModel = {
      ...pratt,
      members: pratt.members.map((member) => ({ ...member, area: 1e-6 })),
    }
    const result = solved(undersized)
    const over = undersized.members.find((member) => result.members[member.id].utilisation > 1)
    expect(over).toBeTruthy()
    const svg = drawing(undersized)
    expect(svg).toContain(
      `>${result.members[over?.id ?? ''].utilisation.toFixed(2)}*</text>`,
    )
    expect(svg).toContain('MARKS A BAR OVER ITS OWN CAPACITY')
  })

  it('draws a bearing at every support and states every load', () => {
    const svg = drawing(warren)
    // A bearing is the only paper-filled triangle on the sheet.
    expect((svg.match(/<polygon points="[^"]*" fill="#ffffff"/g) ?? []).length).toBe(
      warren.supports.length,
    )
    for (const load of warren.loads) {
      expect(svg).toContain(`${(Math.hypot(load.fx, load.fy) / 1e3).toFixed(1)} kN`)
    }
  })

  it('dimensions the span and every panel pitch in millimetres', () => {
    const svg = drawing(pratt)
    expect(svg).toContain('>OVERALL SPAN<')
    expect(svg).toContain('>12000</text>')
    expect(svg).toContain('>2000</text>')
    // A bracket cantilevered off a wall has no span between bearings to state.
    expect(drawing(canopy)).toContain('>2000</text>')
  })

  it('states determinacy and the assumptions the solver worked under', () => {
    const { members, restraints, joints } = trussCounts(pratt)
    const svg = drawing(pratt)
    expect(svg).toContain('>NOTES</text>')
    expect(svg).toContain(
      `${members} BARS + ${restraints} RESTRAINTS vs ${2 * joints} FOR ${joints} JOINTS — DETERMINATE`,
    )
    expect(svg).toContain('PIN-JOINTED MODEL')
    expect(svg).toContain('SELF-WEIGHT IS NOT INCLUDED')
    expect(svg).toContain('IT DOES NOT CERTIFY')
    expect(svg).toContain('Structural steel S355')
  })

  it('refuses to imply an answer for a model the solver rejected', () => {
    // Same girder with its far-end hold-down dropped: a mechanism, and the sheet
    // has to read as unanalysed rather than as a solved frame with blanks.
    const broken: TrussModel = { ...pratt, supports: pratt.supports.slice(0, 1) }
    const analysis = solveTruss(broken)
    expect(analysis.result).toBeNull()
    const svg = buildTrussDrawing(
      { model: broken, result: analysis.result, status: analysis.error },
      { title: 'Girder with one bearing' },
    )
    expect(svg).toContain('NOT ANALYSED')
    expect(svg).toContain(escape(analysis.error ?? ''))
    expect(svg).toContain('NO BAR FORCE IS STATED ON THIS SHEET')
    // No cell carries a force, so no reader can mistake a blank for a zero.
    expect(svg).not.toMatch(/>\d+\.\d\d<\/text>/)
  })

  it('escapes a title that contains markup', () => {
    const svg = drawing(pratt, { title: 'Girder <B> & "long" span' })
    expect(svg).toContain('Girder &lt;B&gt; &amp; &quot;long&quot; span')
    expect(svg).not.toContain('<B> &')
  })

  it('splits the schedule into two column groups only when the paper has room', () => {
    expect((drawing(pratt, { paperSize: 'A3' }).match(/>BAR</g) ?? []).length).toBe(2)
    expect((drawing(pratt, { paperSize: 'A4' }).match(/>BAR</g) ?? []).length).toBe(1)
  })

  it('lists every bar it can and says which ones it left out', () => {
    const long: TrussModel = {
      ...pratt,
      members: Array.from({ length: 60 }, (_, index) => ({
        ...pratt.members[index % pratt.members.length],
        id: `x${index}`,
      })),
    }
    const svg = drawing(long, { paperSize: 'A4' })
    expect(svg).toContain('further bars are in the model')
  })

  it('refuses a model it cannot dimension and a sheet it cannot fit', () => {
    expect(() =>
      buildTrussDrawing({ model: { ...pratt, nodes: [pratt.nodes[0]] }, result: null }, { title: 'One joint' }),
    ).toThrow(/at least two joints/)
    const huge: TrussModel = {
      nodes: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 400, y: 0 },
      ],
      members: [{ id: 'm0', from: 'a', to: 'b', area: 1e-4, material: 'steel-s355' }],
      supports: [
        { node: 'a', holdsX: true, holdsY: true },
        { node: 'b', holdsX: false, holdsY: true },
      ],
      loads: [{ node: 'b', fx: 0, fy: -1000 }],
    }
    expect(() => buildTrussDrawing({ model: huge, result: null }, { title: 'Too long', paperSize: 'A4' })).toThrow(
      /preferred scale/,
    )
  })

  it('prints a framing drawing for every preset the library offers', () => {
    for (const preset of TRUSS_PRESETS) {
      const analysis = solveTruss(preset.model)
      const svg = buildTrussDrawing(
        { model: preset.model, result: analysis.result, status: analysis.error },
        { title: preset.name, projectName: 'Bridge study' },
      )
      expect(svg).toContain(`>${escape(preset.name)}</text>`)
      expect(svg).toContain('>Bridge study</text>')
    }
  })
})
