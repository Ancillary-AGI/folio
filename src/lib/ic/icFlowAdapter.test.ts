import { describe, expect, it } from 'vitest'
import { exportGDSII, planFloorplan, synthesize } from './icFlowAdapter'
import { SKY130_CELLS, type StandardCellKind } from './standardCellLibrary'
import { expandVerilogPorts, parseVerilogModule } from '../fpga/verilogSubset'
import { ACC_CPU_VERILOG } from '../fpga/accCpu'
import { FIR_DSP_VERILOG } from '../fpga/firDsp'
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

  it('maps a D flip-flop to the DFF cell and derives Q-bar with one inverter', () => {
    const netlist: DigitalNetlist = {
      gates: [
        { id: 'g1', type: 'AND', inputs: ['a', 'b'], output: 'd', delay: 1 },
        { id: 'g2', type: 'BUF', inputs: ['q'], output: 'feedback', delay: 1 },
      ],
      flipFlops: [
        { id: 'ff1', type: 'D', clock: 'clk', edge: 'rising', delay: 1, inputs: { D: 'd' }, q: 'q', qbar: 'qb' },
      ],
      initialValues: { q: 0 },
    }
    // A flop in the feedback path is a legal sequential loop, not a combinational one.
    const module = synthesize(netlist, [
      { name: 'a', direction: 'input' },
      { name: 'b', direction: 'input' },
      { name: 'clk', direction: 'input' },
      { name: 'q', direction: 'output' },
    ])
    const kinds = module.instances.map((instance) => instance.cell.kind)
    expect(kinds).toContain('DFF')
    expect(kinds.filter((kind) => kind === 'INV')).toHaveLength(1)
    expect(module.metrics.criticalPathDelayPs).toBeGreaterThan(0)
  })

  it('emits a tie cell when a netlist reads a constant', () => {
    const module = synthesize({
      gates: [{ id: 'g1', type: 'AND', inputs: ['__vdd', 'a'], output: 'y', delay: 0 }],
      initialValues: { __vdd: 1 },
    })
    const kinds = module.instances.map((instance) => instance.cell.kind)
    expect(kinds).toContain('TIEHI')
    expect(module.primaryInputs).toEqual(['a'])
  })

  it('maps the 8-bit accumulator CPU to DFFs and carries it through floorplan and GDSII', () => {
    const elab = parseVerilogModule(ACC_CPU_VERILOG)
    const result = synthesize(elab.netlist, expandVerilogPorts(elab.ports))
    const kinds = result.instances.map((instance) => instance.cell.kind)

    expect(kinds.filter((kind) => kind === 'DFF')).toHaveLength(8)
    expect(result.primaryInputs.sort()).toEqual(
      ['clk', 'op[0]', 'op[1]', 'operand[0]', 'operand[1]', 'operand[2]', 'operand[3]',
       'operand[4]', 'operand[5]', 'operand[6]', 'operand[7]', 'rst'].sort(),
    )
    expect(result.primaryOutputs.sort()).toEqual(
      ['acc[0]', 'acc[1]', 'acc[2]', 'acc[3]', 'acc[4]', 'acc[5]', 'acc[6]', 'acc[7]', 'zero'].sort(),
    )
    expect(result.cells).toHaveLength(result.instances.length)
    expect(result.totalArea).toBeGreaterThan(0)
    expect(result.criticalPathPs).toBeGreaterThan(0)

    const floorplan = planFloorplan(result)
    const gds = exportGDSII(result, floorplan)
    expect(gds.binary.byteLength).toBeGreaterThan(0)
    expect(gds.text).toContain(`Cells: ${result.instances.length}`)
    expect(gds.text).toContain(`Polygons: ${result.instances.length}`)
  })

  it('maps the FIR DSP datapath to 24 DFFs and carries it through layout', () => {
    const elab = parseVerilogModule(FIR_DSP_VERILOG)
    const result = synthesize(elab.netlist, expandVerilogPorts(elab.ports))
    const kinds = result.instances.map((instance) => instance.cell.kind)

    expect(kinds.filter((kind) => kind === 'DFF')).toHaveLength(24)
    expect(result.primaryInputs.sort()).toEqual(
      ['clk', 'rst', ...Array.from({ length: 8 }, (_, i) => `sample[${i}]`)].sort(),
    )
    expect(result.primaryOutputs.sort()).toEqual(
      Array.from({ length: 12 }, (_, i) => `y[${i}]`).sort(),
    )
    expect(result.instances.length).toBeGreaterThan(80)
    expect(result.totalArea).toBeGreaterThan(0)
    expect(result.criticalPathPs).toBeGreaterThan(0)

    const floorplan = planFloorplan(result)
    const gds = exportGDSII(result, floorplan)
    expect(gds.text).toContain(`Cells: ${result.instances.length}`)
    expect(gds.text).toContain(`Polygons: ${result.instances.length}`)
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
