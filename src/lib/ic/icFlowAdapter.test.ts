import { describe, expect, it } from 'vitest'
import { exportGDSII, planFloorplan, synthesize } from './icFlowAdapter'
import { SKY130_CELLS, type StandardCellKind } from './standardCellLibrary'
import type { DigitalNetlist, GateType } from '../simulation/digitalLogic'

/**
 * Evaluate the synthesized cell netlist myself so the test checks the mapped
 * Boolean function rather than trusting the adapter's own descriptions.
 */
function evaluateCells(netlist: DigitalNetlist, inputs: Record<string, boolean>): Map<string, boolean> {
  const module = synthesize(netlist)
  const values = new Map(Object.entries(inputs))
  const remaining = [...module.instances]

  const cellValue = (kind: StandardCellKind, args: boolean[]): boolean => {
    switch (kind) {
      case 'INV': return !args[0]
      case 'CLKBUF': return args[0]
      case 'AND2': return args[0] && args[1]
      case 'OR2': return args[0] || args[1]
      case 'XOR2': return args[0] !== args[1]
      case 'NAND2': return !(args[0] && args[1])
      case 'NAND3': return !(args[0] && args[1] && args[2])
      case 'NOR2': return !(args[0] || args[1])
      case 'XNOR2': return args[0] === args[1]
      default: throw new Error(`Unexpected cell ${kind}`)
    }
  }

  while (remaining.length > 0) {
    const before = remaining.length
    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      const instance = remaining[index]
      const inputPins = instance.cell.pins.filter((pin) => pin.direction === 'input')
      if (!inputPins.every((pin) => values.has(instance.connections[pin.name]))) continue
      const args = inputPins.map((pin) => values.get(instance.connections[pin.name])!)
      const outputPin = instance.cell.pins.find((pin) => pin.direction === 'output')
      if (!outputPin) throw new Error(`Cell ${instance.cell.kind} has no output`)
      values.set(instance.connections[outputPin.name], cellValue(instance.cell.kind, args))
      remaining.splice(index, 1)
    }
    if (remaining.length === before) throw new Error('Synthesized netlist is not a DAG')
  }
  return values
}

const reference: Record<Exclude<GateType, 'NOT' | 'BUF'>, (bits: boolean[]) => boolean> = {
  AND: (bits) => bits.every(Boolean),
  NAND: (bits) => !bits.every(Boolean),
  OR: (bits) => bits.some(Boolean),
  NOR: (bits) => !bits.some(Boolean),
  XOR: (bits) => bits.filter(Boolean).length % 2 === 1,
  XNOR: (bits) => bits.filter(Boolean).length % 2 === 0,
}

describe('synthesize', () => {
  it('maps two-input gates to the cell with the same function', () => {
    for (const type of Object.keys(reference) as Array<keyof typeof reference>) {
      for (let bits = 0; bits < 4; bits += 1) {
        const a = (bits & 1) === 1
        const b = (bits & 2) === 2
        const result = evaluateCells(
          { gates: [{ id: 'g1', type, inputs: ['a', 'b'], output: 'y', delay: 0 }] },
          { a, b },
        )
        expect(result.get('y'), `${type} with a=${a} b=${b}`).toBe(reference[type]([a, b]))
      }
    }
  })

  it('reduces wide gates to a tree that keeps the original function', () => {
    for (const type of Object.keys(reference) as Array<keyof typeof reference>) {
      for (let bits = 0; bits < 16; bits += 1) {
        const inputs = [0, 1, 2, 3].map((index) => (bits & (1 << index)) !== 0)
        const result = evaluateCells(
          { gates: [{ id: 'g1', type, inputs: ['a', 'b', 'c', 'd'], output: 'y', delay: 0 }] },
          { a: inputs[0], b: inputs[1], c: inputs[2], d: inputs[3] },
        )
        expect(result.get('y'), `${type} with ${inputs.join('')}`).toBe(reference[type](inputs))
      }
    }
  })

  it('uses the native three-input NAND cell for a NAND3', () => {
    const module = synthesize({
      gates: [{ id: 'g1', type: 'NAND', inputs: ['a', 'b', 'c'], output: 'y', delay: 0 }],
    })
    expect(module.instances.map((instance) => instance.cell.kind)).toEqual(['NAND3'])
    expect(SKY130_CELLS.NAND3.pins.some((pin) => pin.direction === 'output')).toBe(true)
  })

  it('maps one-input gates to a buffer or inverter', () => {
    const ten = synthesize({ gates: [{ id: 'g1', type: 'AND', inputs: ['a'], output: 'y', delay: 0 }] })
    const tnand = synthesize({ gates: [{ id: 'g1', type: 'NAND', inputs: ['a'], output: 'y', delay: 0 }] })
    expect(ten.instances.map((instance) => instance.cell.kind)).toEqual(['CLKBUF'])
    expect(tnand.instances.map((instance) => instance.cell.kind)).toEqual(['INV'])
  })

  it('rejects a gate with no inputs instead of emitting an undriven net', () => {
    expect(() =>
      synthesize({ gates: [{ id: 'g1', type: 'AND', inputs: [], output: 'y', delay: 0 }] }),
    ).toThrow(/no inputs/)
  })

  it('infers primary I/O from the gate graph when ports are not supplied', () => {
    const module = synthesize({
      gates: [
        { id: 'g1', type: 'AND', inputs: ['a', 'b'], output: 'n1', delay: 0 },
        { id: 'g2', type: 'NOT', inputs: ['n1'], output: 'y', delay: 0 },
      ],
    })
    expect(module.primaryInputs.sort()).toEqual(['a', 'b'])
    expect(module.primaryOutputs).toEqual(['y'])
  })

  it('honours explicitly supplied ports', () => {
    const module = synthesize(
      { gates: [{ id: 'g1', type: 'AND', inputs: ['a', 'b'], output: 'n1', delay: 0 }] },
      [
        { name: 'a', direction: 'input' },
        { name: 'b', direction: 'input' },
        { name: 'n1', direction: 'output' },
      ],
    )
    expect(module.primaryInputs).toEqual(['a', 'b'])
    expect(module.primaryOutputs).toEqual(['n1'])
  })

  it('exports one GDS polygon per synthesized cell, not a truncated sample', () => {
    const gates = Array.from({ length: 60 }, (_, index) => ({
      id: `g${index + 1}`,
      type: 'BUF' as const,
      inputs: [index === 0 ? 'a' : `n${index}`],
      output: index === 59 ? 'y' : `n${index + 1}`,
      delay: 0,
    }))
    const result = synthesize({ gates })
    const floorplan = planFloorplan(result)
    const gds = exportGDSII(result, floorplan)

    expect(result.instances).toHaveLength(60)
    expect(gds.binary.byteLength).toBeGreaterThan(0)
    expect(gds.text).toContain('Cells: 60')
    expect(gds.text).toContain('Polygons: 60')
  })
})
