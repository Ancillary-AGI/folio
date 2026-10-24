import { describe, expect, it } from 'vitest'
import type { Component, Net, Pin, PlacedComponent, Schematic, Wire } from '../../types'
import { ElectricalRuleChecker, runSchematicERC } from './erc'

function pin(id: string, name: string, type: Pin['type'], electricalType?: Pin['electricalType']): Pin {
  return { id, name, x: 0, y: 0, type, electricalType }
}

function component(id: string, name: string, pins: Pin[], category = 'ic'): Component {
  return {
    id,
    name,
    category,
    symbol: { width: 10, height: 10, paths: [] },
    pins,
    properties: {},
  }
}

function wire(id: string, netName: string | undefined, connectedPins: Wire['connectedPins']): Wire {
  return { id, points: [], netName, connectedPins }
}

function net(id: string, name: string, connectedPins: Net['connectedPins']): Net {
  return { id, name, connectedPins, wires: [] }
}

function placed(id: string, reference: string, source: Component, x = 0, y = 0): PlacedComponent {
  return {
    id,
    componentId: source.id,
    component: source,
    position: { x, y },
    rotation: 0,
    scale: 1,
    reference,
    properties: {},
  }
}

function schematic(components: PlacedComponent[], wires: Wire[], nets: Net[] = []): Schematic {
  return {
    id: 'sch',
    name: 'Test',
    components,
    wires,
    nets,
    metadata: { created: '', modified: '', version: '1' },
    settings: {
      gridSize: 10,
      snapToGrid: true,
      showGrid: true,
      showPinNumbers: true,
      showPinNames: true,
      showNetNames: true,
    },
  }
}

describe('ElectricalRuleChecker unconnected pins', () => {
  it('reports unconnected power and ground pins as errors', () => {
    const ic = component('u1', 'MCU', [
      pin('1', 'VCC', 'power'),
      pin('2', 'GND', 'ground'),
    ])
    const result = new ElectricalRuleChecker([ic], [], []).runERC()

    expect(result.isValid).toBe(false)
    expect(result.violations).toHaveLength(2)
    expect(result.violations[0]).toMatchObject({
      type: 'unconnected_pin',
      severity: 'error',
      pinId: '1',
      message: 'Power pin "VCC" of MCU is not connected',
    })
    expect(result.violations[1]).toMatchObject({
      type: 'unconnected_pin',
      severity: 'error',
      message: 'Ground pin "GND" of MCU is not connected',
    })
  })

  it('classifies floating inputs, outputs, passives, and NC pins', () => {
    const ic = component('u1', 'Gate', [
      pin('1', 'IN', 'input'),
      pin('2', 'OUT', 'output'),
      pin('3', 'TP', 'passive'),
      pin('4', 'NC', 'nc'),
    ])
    const result = new ElectricalRuleChecker([ic], [], []).runERC()

    expect(result.violations.map(v => ({ type: v.type, severity: v.severity, pinId: v.pinId }))).toEqual([
      { type: 'floating_input', severity: 'warning', pinId: '1' },
      { type: 'unconnected_pin', severity: 'info', pinId: '2' },
      { type: 'unconnected_pin', severity: 'info', pinId: '3' },
    ])
    expect(result.violations.some(v => v.pinId === '4')).toBe(false)
    expect(result.isValid).toBe(true)
    expect(result.summary).toEqual({ errors: 0, warnings: 1, info: 2, totalViolations: 3 })
  })

  it('treats a pin listed on a wire or a net as connected', () => {
    const ic = component('u1', 'MCU', [pin('1', 'VCC', 'power'), pin('2', 'GND', 'ground')])
    const wires = [wire('w1', 'VCC', [{ componentId: 'u1', pinId: '1' }])]
    const nets = [net('n1', 'GND', [{ componentId: 'u1', pinId: '2' }])]
    const result = new ElectricalRuleChecker([ic], wires, nets).runERC()

    expect(result.violations).toEqual([])
  })

  it('flags an unconnected supply output distinctly', () => {
    const regulator = component('u1', 'LDO Regulator', [pin('1', 'VOUT', 'output')], 'power supply')
    const result = new ElectricalRuleChecker([regulator], [], []).runERC()

    expect(result.violations).toEqual([
      expect.objectContaining({
        type: 'supply_output_unconnected',
        severity: 'warning',
        message: 'Power supply output "VOUT" of LDO Regulator is not connected',
      }),
    ])
  })
})

describe('ElectricalRuleChecker net conflicts', () => {
  it('reports multiple drivers as one violation per net', () => {
    const a = component('u1', 'Buffer A', [pin('1', 'Y', 'output')])
    const b = component('u2', 'Buffer B', [pin('1', 'Y', 'output')])
    const nets = [net('n1', 'SIG', [
      { componentId: 'u1', pinId: '1' },
      { componentId: 'u2', pinId: '1' },
    ])]
    const result = new ElectricalRuleChecker([a, b], [], nets).runERC()

    expect(result.violations.filter(v => v.type === 'multiple_drivers')).toHaveLength(1)
    expect(result.violations[0]).toMatchObject({ type: 'multiple_drivers', severity: 'error', netId: 'n1' })
    expect(result.violations[0].message).toBe('Net "SIG" is driven by 2 outputs (Buffer A.Y, Buffer B.Y)')
  })

  it('detects conflicts on wire-only schematics with no net table', () => {
    const a = component('u1', 'A', [pin('1', 'Y', 'output')])
    const b = component('u2', 'B', [pin('1', 'Y', 'output')])
    const wires = [wire('w1', 'BUS', [
      { componentId: 'u1', pinId: '1' },
      { componentId: 'u2', pinId: '1' },
    ])]
    const result = new ElectricalRuleChecker([a, b], wires, []).runERC()

    expect(result.violations.filter(v => v.type === 'multiple_drivers')).toHaveLength(1)
  })

  it('detects a power-to-ground short from Pin.type, not the optional electricalType', () => {
    const supply = component('u1', 'Supply', [pin('1', 'VCC', 'power')])
    const load = component('u2', 'Load', [pin('1', 'GND', 'ground')])
    const nets = [net('n1', 'VCC', [
      { componentId: 'u1', pinId: '1' },
      { componentId: 'u2', pinId: '1' },
    ])]
    const result = new ElectricalRuleChecker([supply, load], [], nets).runERC()

    expect(result.violations).toEqual([
      expect.objectContaining({
        type: 'power_ground_short',
        severity: 'error',
        netId: 'n1',
        message: 'Net "VCC" shorts power (Supply.VCC) to ground (Load.GND)',
      }),
    ])
  })

  it('ignores legacy electricalType tags for power/ground conflict detection', () => {
    const a = component('u1', 'A', [pin('1', 'P', 'passive', 'power')])
    const b = component('u2', 'B', [pin('1', 'G', 'passive', 'ground')])
    const nets = [net('n1', 'SIG', [
      { componentId: 'u1', pinId: '1' },
      { componentId: 'u2', pinId: '1' },
    ])]
    const result = new ElectricalRuleChecker([a, b], [], nets).runERC()

    expect(result.violations).toEqual([])
  })

  it('does not double-report a net as both a short and a driver conflict', () => {
    const a = component('u1', 'A', [pin('1', 'Y', 'output'), pin('2', 'VCC', 'power')])
    const b = component('u2', 'B', [pin('1', 'Y', 'output'), pin('2', 'GND', 'ground')])
    const nets = [net('n1', 'SIG', [
      { componentId: 'u1', pinId: '1' },
      { componentId: 'u2', pinId: '1' },
      { componentId: 'u1', pinId: '2' },
      { componentId: 'u2', pinId: '2' },
    ])]
    const result = new ElectricalRuleChecker([a, b], [], nets).runERC()

    expect(result.violations).toHaveLength(2)
    expect(result.summary.errors).toBe(2)
  })

  it('deduplicates repeated pin connections across wires and nets', () => {
    const a = component('u1', 'A', [pin('1', 'Y', 'output')])
    const b = component('u2', 'B', [pin('1', 'Y', 'output')])
    const connection = [
      { componentId: 'u1', pinId: '1' },
      { componentId: 'u2', pinId: '1' },
    ]
    const wires = [wire('w1', 'SIG', connection), wire('w2', 'SIG', connection)]
    const nets = [net('n1', 'SIG', connection)]
    const result = new ElectricalRuleChecker([a, b], wires, nets).runERC()

    expect(result.violations.filter(v => v.type === 'multiple_drivers')).toHaveLength(1)
  })
})

describe('runSchematicERC', () => {
  it('checks placed instances using instance ids', () => {
    const libraryPart = component('lib-ic', 'OpAmp', [
      pin('1', 'V+', 'power'),
      pin('2', 'OUT', 'output'),
    ])
    const first = placed('inst-1', 'U1', libraryPart)
    const second = placed('inst-2', 'U2', libraryPart)
    const wires = [wire('w1', 'VCC', [{ componentId: 'inst-1', pinId: '1' }])]

    const result = runSchematicERC(schematic([first, second], wires))

    const messages = result.violations.map(v => v.message)
    expect(messages).toContain('Power pin "V+" of OpAmp (U2) is not connected')
    expect(messages).toContain('Output pin "OUT" of OpAmp (U1) is not connected')
    expect(messages).toContain('Output pin "OUT" of OpAmp (U2) is not connected')
    expect(messages).toHaveLength(3)
  })

  it('passes a fully wired divider', () => {
    const resistor = component('res', 'Resistor', [
      pin('1', 'A', 'passive'),
      pin('2', 'B', 'passive'),
    ])
    const r1 = placed('r1', 'R1', resistor)
    const r2 = placed('r2', 'R2', resistor)
    const wires = [
      wire('w1', 'VIN', [{ componentId: 'r1', pinId: '1' }, { componentId: 'r2', pinId: '1' }]),
      wire('w2', 'VOUT', [{ componentId: 'r1', pinId: '2' }, { componentId: 'r2', pinId: '2' }]),
    ]

    expect(runSchematicERC(schematic([r1, r2], wires)).violations).toEqual([])
  })
})
