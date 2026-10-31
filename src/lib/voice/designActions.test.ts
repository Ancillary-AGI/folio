import { beforeEach, describe, expect, it } from 'vitest'
import { useProjectStore } from '../../stores/useProjectStore'
import {
  connectPartsFromText,
  libraryPartForText,
  placeComponentFromText,
} from './designActions'

const resetSheet = () => {
  useProjectStore.setState({ components: [], wires: [] })
}

describe('libraryPartForText', () => {
  it('maps spoken names onto library parts', () => {
    expect(libraryPartForText('place a resistor')).toBe('Resistor')
    expect(libraryPartForText('add a capacitor')).toBe('Capacitor')
    expect(libraryPartForText('add an led')).toBe('LED')
    expect(libraryPartForText('add a mosfet')).toBe('N-Channel MOSFET')
    expect(libraryPartForText('add an op amp')).toBe('Op-Amp')
    expect(libraryPartForText('drop a ground')).toBe('Ground')
    expect(libraryPartForText('something exotic')).toBeNull()
  })
})

describe('placeComponentFromText', () => {
  beforeEach(resetSheet)

  it('places a real library part at a free grid slot with a unique reference', () => {
    const first = placeComponentFromText('place a resistor')
    expect(first.applied).toBe(true)
    expect(useProjectStore.getState().components).toHaveLength(1)
    const placed = useProjectStore.getState().components[0]
    expect(placed.reference).toBe('R1')
    expect(placed.component.name).toBe('Resistor')
    expect(placed.x).toBe(80)
    expect(placed.y).toBe(80)
    expect(placed.rotation).toBe(0)

    const second = placeComponentFromText('place a resistor')
    expect(second.applied).toBe(true)
    const placedSecond = useProjectStore.getState().components[1]
    expect(placedSecond.reference).toBe('R2')
    // The second part lands in the next slot, not on top of the first.
    expect(placedSecond.x).not.toBe(placed.x)
  })

  it('assigns the right reference letter per family', () => {
    resetSheet()
    placeComponentFromText('add a capacitor')
    expect(useProjectStore.getState().components[0].reference).toBe('C1')
    resetSheet()
    placeComponentFromText('add a mosfet')
    expect(useProjectStore.getState().components[0].reference).toBe('Q1')
  })

  it('refuses an unknown part and leaves the sheet untouched', () => {
    const result = placeComponentFromText('place a graviton flux drive')
    expect(result.applied).toBe(false)
    expect(result.detail).toContain('could not tell')
    expect(useProjectStore.getState().components).toHaveLength(0)
  })
})

describe('connectPartsFromText', () => {
  beforeEach(() => {
    resetSheet()
    placeComponentFromText('place a resistor')
    placeComponentFromText('place a resistor')
    placeComponentFromText('place a diode')
  })

  it('wires two named references with real pins and an orthogonal route', () => {
    const result = connectPartsFromText('connect R1 to D1')
    expect(result.applied).toBe(true)
    expect(result.detail).toContain('NET1')
    const wires = useProjectStore.getState().wires
    expect(wires).toHaveLength(1)
    const wire = wires[0]
    expect(wire.connectedPins).toHaveLength(2)
    expect(wire.points[0].x).toBe(80) // R1 p1 at part origin
    // The wire ends on D1's anode: D1 origin (360, 80) + pin (0, 20).
    expect(wire.points.at(-1)).toEqual({ x: 360, y: 100 })
    // The route stays orthogonal: every bend shares x or y with a neighbour.
    for (let index = 1; index < wire.points.length; index += 1) {
      const a = wire.points[index - 1]
      const b = wire.points[index]
      expect(a.x === b.x || a.y === b.y).toBe(true)
    }
  })

  it('names the references that are missing instead of guessing', () => {
    const result = connectPartsFromText('connect R9 to X9')
    expect(result.applied).toBe(false)
    expect(result.detail).toContain('could not find')
    expect(result.detail).toContain('R1')
  })

  it('refuses to wire a part to itself', () => {
    const result = connectPartsFromText('connect R1 to R1')
    expect(result.applied).toBe(false)
    expect(result.detail).toContain('same part')
    expect(useProjectStore.getState().wires).toHaveLength(0)
  })

  it('asks for both ends when the phrase has no target', () => {
    const result = connectPartsFromText('connect R1')
    expect(result.applied).toBe(false)
    expect(result.detail).toContain('Name both ends')
  })

  it('supports pin numbers where the part has them', () => {
    const result = connectPartsFromText('connect R1 pin 2 to R2 pin 1')
    expect(result.applied).toBe(true)
    const wire = useProjectStore.getState().wires[0]
    expect(wire.connectedPins[0].pinId).toBe('p2')
    expect(wire.connectedPins[1].pinId).toBe('p1')
  })
})
