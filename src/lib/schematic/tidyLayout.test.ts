/**
 * Tidy-arrange proofs: signal flows left to right, everything lands on the
 * drafting grid, wires come back orthogonal with their ends on their pins, and
 * the arrange is deterministic enough to be idempotent.
 */
import { describe, expect, it } from 'vitest'
import { tidySchematic } from './tidyLayout'
import { pinWorldCoord } from './drawingLayout'
import type { CanvasComponent, CanvasWire } from '../../stores/useProjectStore'

type PinType = 'input' | 'output' | 'io' | 'power' | 'ground' | 'passive' | 'nc'
interface PinSpec {
  id: string
  x: number
  y: number
  type: PinType
}

let seq = 0

const part = (
  id: string,
  reference: string,
  pins: PinSpec[],
  at: { x: number; y: number },
  options: { width?: number; height?: number; rotation?: number; locked?: boolean } = {},
): CanvasComponent => {
  const width = options.width ?? 40
  const height = options.height ?? 20
  return {
    id,
    componentId: `${id}-lib`,
    component: {
      id: `${id}-lib`,
      name: reference,
      category: 'passive',
      is_standard: true,
      symbol_data: { width, height, paths: [`M0 0 L${width} 0`, `M0 ${height} L${width} ${height}`] },
      pins: pins.map((pin) => ({ ...pin, name: pin.id })),
      default_properties: {},
    },
    x: at.x,
    y: at.y,
    rotation: options.rotation ?? 0,
    reference,
    properties: { value: reference },
    locked: options.locked,
  }
}

const pinSpec = (component: CanvasComponent, pinId: string) => {
  const pin = component.component.pins.find((candidate) => candidate.id === pinId)
  if (!pin) throw new Error(`no pin ${pinId} on ${component.reference}`)
  return pin
}

const net = (a: CanvasComponent, pinA: string, b: CanvasComponent, pinB: string, netName: string): CanvasWire => ({
  id: `w${++seq}`,
  points: [pinWorldCoord(a, pinSpec(a, pinA)), pinWorldCoord(b, pinSpec(b, pinB))],
  netName,
  connectedPins: [
    { componentId: a.id, pinId: pinA },
    { componentId: b.id, pinId: pinB },
  ],
})

const onGrid = (value: number, grid: number): boolean => Math.abs(value % grid) < 1e-9

const isOrthogonal = (points: Array<{ x: number; y: number }>): boolean =>
  points.slice(1).every((point, index) => {
    const previous = points[index]
    return Math.abs(previous.x - point.x) < 0.5 || Math.abs(previous.y - point.y) < 0.5
  })

/** A three-stage chain, dropped anywhere on the sheet. */
function chain() {
  const driver = part('U1', 'U1', [{ id: 'out', x: 60, y: 20, type: 'output' }], { x: 412, y: 388 }, { width: 60, height: 40 })
  const resistor = part('R1', 'R1', [
    { id: 'a', x: 0, y: 10, type: 'passive' },
    { id: 'b', x: 40, y: 10, type: 'passive' },
  ], { x: 33, y: 201 })
  const load = part('L1', 'L1', [{ id: 'in', x: 0, y: 10, type: 'input' }], { x: 705, y: 66 })
  return { driver, resistor, load, wires: [net(driver, 'out', resistor, 'a', 'SIG'), net(resistor, 'b', load, 'in', 'GATE')] }
}

describe('tidy arrange', () => {
  it('runs the signal left to right on the grid', () => {
    const { driver, resistor, load, wires } = chain()
    const result = tidySchematic([load, resistor, driver], wires, { gridSize: 10 })

    expect(result.columns).toBe(3)
    expect(result.parts).toBe(3)
    expect(result.nets).toBe(2)
    const at = new Map(result.components.map((component) => [component.reference, component]))
    expect(at.get('U1')).toMatchObject({ x: 60, y: 60 })
    expect(at.get('R1')).toMatchObject({ x: 190, y: 60 })
    expect(at.get('L1')).toMatchObject({ x: 320, y: 60 })
    for (const component of result.components) {
      expect(onGrid(component.x, 10)).toBe(true)
      expect(onGrid(component.y, 10)).toBe(true)
    }
  })

  it('re-routes every wire orthogonally, landed on its pins', () => {
    const { driver, resistor, load, wires } = chain()
    const result = tidySchematic([driver, resistor, load], wires, { gridSize: 10 })
    const byId = new Map(result.components.map((component) => [component.id, component]))

    for (const wire of result.wires) {
      expect(isOrthogonal(wire.points)).toBe(true)
      for (const point of wire.points) {
        expect(onGrid(point.x, 10)).toBe(true)
        expect(onGrid(point.y, 10)).toBe(true)
      }
      const start = wire.points[0]
      const end = wire.points[wire.points.length - 1]
      for (const pin of wire.connectedPins) {
        const component = byId.get(pin.componentId)
        expect(component).toBeDefined()
        if (!component) continue
        const at = pinWorldCoord(component, pinSpec(component, pin.pinId))
        // Every named terminal is a vertex of the polyline that carries it.
        const distance = Math.min(Math.hypot(at.x - start.x, at.y - start.y), Math.hypot(at.x - end.x, at.y - end.y))
        expect(distance).toBeLessThan(0.5)
      }
    }
    expect(result.wires.map((wire) => wire.netName)).toEqual(['SIG', 'GATE'])
  })

  it('keeps rotations, values and wire identity through the arrange', () => {
    const driver = part('U1', 'U1', [{ id: 'out', x: 60, y: 20, type: 'output' }], { x: 20, y: 20 }, { rotation: 90 })
    const resistor = part('R1', 'R1', [{ id: 'a', x: 0, y: 10, type: 'passive' }], { x: 300, y: 300 })
    const wire = net(driver, 'out', resistor, 'a', 'N')
    const result = tidySchematic([driver, resistor], [wire], { gridSize: 10 })

    expect(result.components.find((component) => component.id === 'U1')?.rotation).toBe(90)
    expect(result.components.find((component) => component.id === 'R1')?.properties.value).toBe('R1')
    expect(result.wires[0].id).toBe(wire.id)
    expect(result.wires[0].connectedPins).toEqual([
      { componentId: 'U1', pinId: 'out' },
      { componentId: 'R1', pinId: 'a' },
    ])
  })

  it('survives a feedback loop instead of layering itself forever', () => {
    const inverter = part('U1', 'U1', [
      { id: 'in', x: 0, y: 20, type: 'input' },
      { id: 'out', x: 60, y: 20, type: 'output' },
    ], { x: 300, y: 100 }, { width: 60, height: 40 })
    const resistor = part('R1', 'R1', [
      { id: 'a', x: 0, y: 10, type: 'passive' },
      { id: 'b', x: 40, y: 10, type: 'passive' },
    ], { x: 50, y: 40 })
    const result = tidySchematic(
      [inverter, resistor],
      [net(inverter, 'out', resistor, 'a', 'OUT'), net(resistor, 'b', inverter, 'in', 'FB')],
      { gridSize: 10 },
    )
    expect(result.columns).toBe(2)
    for (const wire of result.wires) expect(isOrthogonal(wire.points)).toBe(true)
  })

  it('is deterministic and idempotent', () => {
    const { driver, resistor, load, wires } = chain()
    const first = tidySchematic([driver, resistor, load], wires, { gridSize: 10 })
    const second = tidySchematic([driver, resistor, load], wires, { gridSize: 10 })
    expect(second.components).toEqual(first.components)
    expect(second.wires).toEqual(first.wires)

    const again = tidySchematic(first.components, first.wires, { gridSize: 10 })
    expect(again.components).toEqual(first.components)
    expect(again.wires).toEqual(first.wires)
  })

  it('leaves a locked part exactly where the designer put it', () => {
    const { driver, resistor, load, wires } = chain()
    const anchor = part('K1', 'K1', [{ id: 'a', x: 0, y: 10, type: 'passive' }], { x: 190, y: 60 }, { locked: true })
    const result = tidySchematic([driver, resistor, load, anchor], wires, { gridSize: 10 })
    const kept = result.components.find((component) => component.id === 'K1')
    expect(kept).toMatchObject({ x: 190, y: 60 })
    for (const component of result.components.filter((candidate) => candidate.id !== 'K1')) {
      expect(component.x === 190 && component.y === 60).toBe(false)
    }
  })

  it('stacks disconnected circuits as bands, not as interleaved columns', () => {
    const top = part('U2', 'U2', [{ id: 'out', x: 40, y: 10, type: 'output' }], { x: 400, y: 40 })
    const topLoad = part('R2', 'R2', [{ id: 'a', x: 0, y: 10, type: 'passive' }], { x: 880, y: 250 })
    const bottom = part('U1', 'U1', [{ id: 'out', x: 40, y: 10, type: 'output' }], { x: 900, y: 900 })
    const bottomLoad = part('R1', 'R1', [{ id: 'a', x: 0, y: 10, type: 'passive' }], { x: 12, y: 400 })
    const result = tidySchematic(
      [top, topLoad, bottom, bottomLoad],
      [net(top, 'out', topLoad, 'a', 'B'), net(bottom, 'out', bottomLoad, 'a', 'A')],
      { gridSize: 10 },
    )
    const at = new Map(result.components.map((component) => [component.reference, component]))
    // The band the designer started higher up keeps its row; both repeat column 0.
    expect(at.get('U2')).toMatchObject({ x: 60, y: 60 })
    expect(at.get('R2')?.x).toBe(170)
    expect(at.get('U1')?.x).toBe(60)
    expect((at.get('U1')?.y ?? 0)).toBeGreaterThan(at.get('U2')?.y ?? 0)
  })

  it('handles an empty sheet and a wire that names no pin', () => {
    const empty = tidySchematic([], [], { gridSize: 10 })
    expect(empty.components).toEqual([])
    expect(empty.columns).toBe(0)

    const stray: CanvasWire = {
      id: 'loose',
      points: [{ x: 33, y: 47 }, { x: 120, y: 47 }],
      netName: 'TEST',
      connectedPins: [],
    }
    const kept = tidySchematic([], [stray], { gridSize: 10 })
    expect(kept.wires[0].points).toEqual([{ x: 30, y: 50 }, { x: 120, y: 50 }])
    expect(kept.wires[0].netName).toBe('TEST')
  })

  it('never mutates the sheet it was handed', () => {
    const { driver, resistor, load, wires } = chain()
    const before = JSON.stringify({ components: [driver, resistor, load], wires })
    tidySchematic([driver, resistor, load], wires, { gridSize: 10 })
    expect(JSON.stringify({ components: [driver, resistor, load], wires })).toBe(before)
  })
})
