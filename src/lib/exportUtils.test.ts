import { describe, expect, it } from 'vitest'
import { exportToGerber } from './exportUtils'
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
