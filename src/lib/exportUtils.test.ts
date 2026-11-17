import { describe, expect, it } from 'vitest'
import { exportToGerber, exportToNetlist, exportToBOM } from './exportUtils'
import type { PlacedComponent, Wire } from '../types'

const component = (rotation = 0): PlacedComponent => ({
  id: 'c1',
  componentId: 'resistor',
  component: {
    id: 'resistor',
    name: 'Resistor',
    category: 'passive',
    symbol: { width: 40, height: 20, paths: [] },
    pins: [
      { id: 'p1', name: '1', x: 10, y: 0, type: 'passive' },
      { id: 'p2', name: '2', x: -10, y: 0, type: 'passive' },
    ],
    properties: {},
  },
  position: { x: 25.4, y: 50.8 },
  rotation,
  scale: 1,
  reference: 'R1',
  properties: {},
})

const wire = (): Wire => ({
  id: 'w1',
  points: [
    { x: 0, y: 0 },
    { x: 25.4, y: 0 },
  ],
  connectedPins: [],
})

describe('exportToGerber', () => {
  it('emits 3.6 mm coordinates and mm apertures in mm mode', () => {
    const gerber = exportToGerber([component()], [wire()], { traceWidth: 0.25 })
    expect(gerber).toContain('%FSLAX36Y36*%')
    expect(gerber).toContain('%MOMM*%')
    expect(gerber).toContain('%ADD10C,0.2500*%')
    // 25.4 mm at 3.6 mm precision
    expect(gerber).toContain('X25400000Y0D01*')
  })

  it('converts lengths and declares inch format in inch mode', () => {
    const gerber = exportToGerber([component()], [wire()], { traceWidth: 0.25, units: 'in' })
    expect(gerber).toContain('%FSLAX26Y26*%')
    expect(gerber).toContain('%MOIN*%')
    expect(gerber).not.toContain('%FSLAX36Y36*%')
    expect(gerber).toContain('%ADD10C,0.009843*%') // 0.25 mm
    // 25.4 mm = 1 in
    expect(gerber).toContain('X1000000Y0D01*')
  })

  it('rotates pin offsets with the placed component', () => {
    const rotated = exportToGerber([component(90)], [], {})
    // pin (10,0) at (25.4,50.8) rotated 90° → (25.4, 60.8)
    expect(rotated).toContain('X25400000Y60800000D03*')
    // pin (-10,0) rotated 90° → (25.4, 40.8)
    expect(rotated).toContain('X25400000Y40800000D03*')
  })
})

const netlisted = (overrides: Partial<PlacedComponent['properties']> = {}): PlacedComponent[] => {
  const comp = component()
  comp.properties = { value: '2N7000', ...overrides }
  return [comp]
}

describe('exportToNetlist', () => {
  const wireTo = (netName: string): Wire => ({
    id: 'w1',
    points: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
    connectedPins: [{ componentId: 'c1', pinId: 'p1' }],
    netName,
  })

  it('a project title with a newline cannot open a second statement', () => {
    const text = exportToNetlist(netlisted(), [], 'Amp\n.tran 1u\nForged')
    const dotCards = text.split('\n').filter((line) => line.startsWith('.'))
    expect(dotCards).toEqual(['.end'])
    expect(text).toContain('* Amp .tran 1u Forged Netlist')
  })

  it('a net name with a newline cannot smuggle a directive into the deck', () => {
    const text = exportToNetlist(netlisted(), [wireTo('VCC\n.end')], 'Board')
    const dotCards = text.split('\n').filter((line) => line.startsWith('.'))
    expect(dotCards).toEqual(['.end'])
    // The hostile token stayed a single atom on the component's card.
    expect(text).toMatch(/R1 VCC_\.end /)
  })

  it('a component value with a newline cannot smuggle a directive either', () => {
    const text = exportToNetlist(netlisted({ value: '1k\n.end' }), [], 'Board')
    const dotCards = text.split('\n').filter((line) => line.startsWith('.'))
    expect(dotCards).toEqual(['.end'])
    expect(text).toContain('1k_.end')
  })

  it('a net name with spaces lands on one node atom', () => {
    const text = exportToNetlist(netlisted(), [wireTo('USB D+')], 'Board')
    expect(text).toMatch(/R1 USB_D\+ /)
  })
})

describe('exportToBOM', () => {
  it('neutralises a formula leader in user-editable property cells', () => {
    const comp = component()
    comp.properties = { value: '1k', manufacturer: '=cmd|/c calc', partNumber: '@SUM(1,1)' }
    comp.component = { ...comp.component, description: '+HYPERLINK("http://evil")' }
    const text = exportToBOM([comp])
    const row = text.split('\n').find((line) => line.includes('1k')) ?? ''
    const cells = row.split('\t')
    expect(cells[6]).toBe(`'=cmd|/c calc`)
    expect(cells[7]).toBe(`'@SUM(1,1)`)
    expect(cells[5]).toBe(`'+HYPERLINK("http://evil")`)
  })

  it('tabs and newlines inside a property cannot split the row', () => {
    const comp = component()
    comp.properties = { value: '1k\twith tab', partNumber: 'a\nb' }
    const text = exportToBOM([comp])
    const row = text.split('\n').find((line) => line.includes('with tab')) ?? ''
    expect(row.split('\t')).toHaveLength(10)
  })
})
