import { describe, expect, it } from 'vitest'
import { buildSchematicDrawing } from '../lib/schematic/engineeringDrawing'
import type { CanvasComponent, CanvasWire } from '../stores/useProjectStore'
import type { Component } from '../lib/supabase'

const libraryPart = (
  id: string,
  name: string,
  pins: Component['pins'],
  paths: string[],
): Component => ({
  id,
  name,
  category: 'passive',
  is_standard: true,
  symbol_data: { width: 60, height: 30, paths },
  pins,
  default_properties: {},
})

const placed = (
  id: string,
  reference: string,
  component: Component,
  x: number,
  y: number,
  rotation = 0,
  properties: Record<string, string | number | boolean> = {},
): CanvasComponent => ({
  id,
  componentId: component.id!,
  component,
  x,
  y,
  rotation,
  reference,
  properties,
})

const resistor = libraryPart(
  'lib-r',
  'Resistor',
  [
    { id: 'p1', name: '1', x: 0, y: 15, type: 'passive' },
    { id: 'p2', name: '2', x: 60, y: 15, type: 'passive' },
  ],
  ['M 0,15 L 15,15', 'M 15,5 L 15,25 L 45,25 L 45,5 L 15,5', 'M 45,15 L 60,15'],
)

const ground = libraryPart(
  'lib-gnd',
  'Ground',
  [{ id: 'g1', name: 'GND', x: 30, y: 0, type: 'power' }],
  ['M 30,0 L 30,12', 'M 18,12 L 42,12', 'M 22,18 L 38,18', 'M 27,24 L 33,24'],
)

const components = [
  placed('r1', 'R1', resistor, 100, 100, 90, { value: '1k' }),
  placed('g1', 'G1', ground, 200, 200),
]

const wires: CanvasWire[] = [
  {
    id: 'w1',
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
    netName: 'VCC',
    connectedPins: [{ componentId: 'r1', pinId: 'p1' }],
  },
  {
    id: 'w2',
    points: [
      { x: 100, y: 0 },
      { x: 100, y: 60 },
    ],
    netName: 'VCC',
    connectedPins: [{ componentId: 'r1', pinId: 'p2' }],
  },
]

const drawing = (options: Partial<Parameters<typeof buildSchematicDrawing>[2]> = {}) =>
  buildSchematicDrawing(components, wires, {
    title: 'Half-wave rectifier',
    revision: 'B',
    date: '2026-10-25',
    ...options,
  })

describe('engineering schematic drawing', () => {
  it('emits a real A4 print sheet with a title block', () => {
    const svg = drawing()
    expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"')
    expect(svg).toContain('width="297mm" height="210mm" viewBox="0 0 297 210"')
    expect(svg).toContain('role="img"')
    expect(svg).toContain('<title id="drawing-title">Half-wave rectifier — schematic drawing</title>')
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true)
    // Title block cells
    expect(svg).toContain('>FOLIO</text>')
    expect(svg).toContain('>REV B</text>')
    expect(svg).toContain('>TITLE</text>')
    expect(svg).toContain('>A4</text>')
    expect(svg).toContain('>NTS</text>')
    expect(svg).toContain('>2026-10-25</text>')
    expect(svg).toContain('>1/1</text>')
    // Printable white ink by default
    expect(svg).toContain('fill="#ffffff"')
  })

  it('supports a larger A3 sheet', () => {
    expect(drawing({ paperSize: 'A3' })).toContain('width="420mm" height="297mm" viewBox="0 0 420 297"')
  })

  it('escapes user-authored titles, values and notes', () => {
    const svg = drawing({
      title: 'A & B <bridge>',
      notes: ['Keep <5 mm & rising'],
    })
    expect(svg).toContain('A &amp; B &lt;bridge&gt;')
    expect(svg).not.toContain('<bridge>')
    expect(svg).toContain('Keep &lt;5 mm &amp; rising')
    expect(svg).toContain('>NOTES</text>')
  })

  it('draws one polyline per multi-point wire and a junction where same-net wires meet', () => {
    const svg = drawing()
    const polylines = svg.match(/<polyline points=/g) ?? []
    expect(polylines).toHaveLength(wires.length)
    expect(svg).toContain('<polyline points="0,0 100,0"/>')
    // The shared vertex joins two VCC segments and earns exactly one dot.
    expect(svg.match(/data-role="junction"/g) ?? []).toHaveLength(1)
  })

  it('does not dot a crossing between different nets', () => {
    const crossing: CanvasWire[] = [
      { id: 'h', points: [{ x: 0, y: 50 }, { x: 100, y: 50 }], netName: 'A', connectedPins: [] },
      { id: 'v', points: [{ x: 50, y: 0 }, { x: 50, y: 100 }], netName: 'B', connectedPins: [] },
    ]
    const svg = buildSchematicDrawing(components, crossing, { title: 'Crossing' })
    expect(svg.match(/data-role="junction"/g) ?? []).toHaveLength(0)
  })

  it('rings only unwired terminals so wired pins cannot cover a junction', () => {
    const svg = drawing()
    // Three pins total, two of them wired: only the floating GND pin is open.
    expect(svg.match(/data-role="pin-open"/g) ?? []).toHaveLength(1)
    expect(svg).not.toContain('data-role="pin-connected"')
  })

  it('writes horizontal reference and value labels regardless of part rotation', () => {
    const svg = drawing()
    expect(svg).toContain('>R1</text>')
    // Engineering suffixes are already unit-bearing and stay untouched.
    expect(svg).toContain('>1k</text>')
    // A ground symbol has no value to print.
    expect(svg).toContain('>G1</text>')
    // Labels are never attached to the rotated symbol group.
    expect(svg).not.toMatch(/<text[^>]*transform="rotate/)
    expect(svg).toContain('text-anchor="middle"')
  })

  it('renders a dark-screen variant and notes strip', () => {
    const svg = drawing({ palette: 'screen', notes: ['Reference designators per IEC 60617'] })
    expect(svg).toContain('fill="#0b1017"')
    expect(svg).toContain('>NOTES</text>')
    expect(svg).toContain('Reference designators per IEC 60617')
  })
})
