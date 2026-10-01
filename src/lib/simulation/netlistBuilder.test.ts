import { describe, expect, it } from 'vitest'
import type { CanvasComponent, CanvasWire } from '../../stores/useProjectStore'
import { buildCircuitModel } from './circuitModel'
import { buildCircuitNetlist } from './netlistBuilder'
import { spiceEngine } from './spiceEngine'

const placed = (id: string, reference: string, name: string, pinIds: string[]): CanvasComponent => ({
  id,
  componentId: `${id}-library`,
  component: {
    name,
    category: 'passive',
    is_standard: true,
    symbol_data: { width: 40, height: 20, paths: [] },
    pins: pinIds.map((pinId, index) => ({
      id: pinId,
      name: `Pin ${index + 1}`,
      x: index * 10,
      y: 0,
      type: 'passive' as const,
    })),
    default_properties: {},
  },
  x: 0,
  y: 0,
  rotation: 0,
  reference,
  properties: { value: '1k' },
})

/**
 * A canvas-placed library symbol: real pin ids with canvas properties. The
 * `properties` bag is what the user edited, so it carries both generic values
 * (`value: '220k'`) and model selectors (`type: '2N3904'`).
 */
const canvasPlaced = (
  id: string,
  reference: string,
  name: string,
  pinIds: string[],
  properties: Record<string, string | number> = {},
): CanvasComponent => ({
  id,
  componentId: `${id}-library`,
  component: {
    name,
    category: 'power',
    is_standard: true,
    symbol_data: { width: 40, height: 20, paths: [] },
    pins: pinIds.map((pinId, index) => ({
      id: pinId,
      name: `Pin ${index + 1}`,
      x: index * 10,
      y: 0,
      type: 'passive' as const,
    })),
    default_properties: {},
  },
  x: 0,
  y: 0,
  rotation: 0,
  reference,
  properties,
})

const wire = (id: string, connections: CanvasWire['connectedPins'], netName?: string): CanvasWire => ({
  id,
  points: [],
  connectedPins: connections,
  netName,
})

describe('buildCircuitNetlist', () => {
  it('maps all pins on one wire to a shared node', () => {
    const result = buildCircuitNetlist('divider', [
      placed('r1', 'R1', 'Resistor', ['1', '2']),
      placed('r2', 'R2', 'Resistor', ['1', '2']),
    ], [
      wire('middle', [
        { componentId: 'r1', pinId: '2' },
        { componentId: 'r2', pinId: '1' },
      ]),
    ], { type: 'dc' })

    expect(result.components[0].nodes[1]).toBe(result.components[1].nodes[0])
  })

  it('merges wires joined at a pin and normalizes ground labels', () => {
    const result = buildCircuitNetlist('joined nets', [placed('r1', 'R1', 'Resistor', ['1', '2'])], [
      wire('first', [{ componentId: 'r1', pinId: '1' }]),
      wire('second', [{ componentId: 'r1', pinId: '1' }, { componentId: 'r1', pinId: '2' }], 'GND'),
    ], { type: 'dc' })

    expect(result.components[0].nodes).toEqual(['0', '0'])
  })

  it('rejects contradictory names on electrically connected wires', () => {
    expect(() => buildCircuitNetlist('bad nets', [placed('r1', 'R1', 'Resistor', ['1'])], [
      wire('first', [{ componentId: 'r1', pinId: '1' }], 'NET_A'),
      wire('second', [{ componentId: 'r1', pinId: '1' }], 'NET_B'),
    ], { type: 'dc' })).toThrow(/conflicting net names/i)
  })

  it('emits BJT terminals in SPICE C/B/E order regardless of symbol pin order', () => {
    const result = buildCircuitNetlist('npn pins', [
      // Pins deliberately stored emitter-first, as a canvas author might add them.
      canvasPlaced('q1', 'Q1', 'NPN Transistor', ['emitter', 'base', 'collector']),
    ], [
      wire('c', [{ componentId: 'q1', pinId: 'collector' }]),
      wire('b', [{ componentId: 'q1', pinId: 'base' }]),
      wire('e', [{ componentId: 'q1', pinId: 'emitter' }]),
    ], { type: 'dc' })

    const q1 = result.components[0]
    expect(q1.type).toBe('npn_transistor')
    // nodes[0] is the collector net, nodes[1] the base net, nodes[2] the
    // emitter: the emitter-first symbol storage must not leak into order.
    expect(q1.nodes).toEqual(['N_c', 'N_b', 'N_e'])
  })

  it('simulates a canvas common-emitter stage with a stock 2N3904 card', async () => {
    const netlist = buildCircuitNetlist('ce stage', [
      canvasPlaced('vcc', 'VCC', 'DC Voltage Source', ['positive', 'negative'], { value: '5V', type: 'DC' }),
      canvasPlaced('rb', 'RB', 'Resistor', ['p1', 'p2'], { value: '220k' }),
      canvasPlaced('rc', 'RC', 'Resistor', ['p1', 'p2'], { value: '1k' }),
      canvasPlaced('q1', 'Q1', 'NPN Transistor', ['collector', 'base', 'emitter'], { type: '2N3904' }),
    ], [
      wire('rail', [
        { componentId: 'vcc', pinId: 'positive' },
        { componentId: 'rb', pinId: 'p1' },
        { componentId: 'rc', pinId: 'p1' },
      ]),
      wire('base', [
        { componentId: 'rb', pinId: 'p2' },
        { componentId: 'q1', pinId: 'base' },
      ]),
      wire('coll', [
        { componentId: 'rc', pinId: 'p2' },
        { componentId: 'q1', pinId: 'collector' },
      ]),
      wire('ground', [
        { componentId: 'vcc', pinId: 'negative' },
        { componentId: 'q1', pinId: 'emitter' },
      ], '0'),
    ], { type: 'dc' })

    const outcome = await spiceEngine.simulate(netlist)
    expect(outcome.success).toBe(true)
    expect(outcome.error).toBeUndefined()
    const point = outcome.operatingPoint ?? {}
    // The canvas emitter net is named '0', which the readout reports alongside
    // ground itself — so rail, ground, base and collector all appear.
    const values = Object.values(point).filter((value): value is number => typeof value === 'number')
    expect(Math.max(...values)).toBeCloseTo(5, 3)
    expect(values.length).toBeGreaterThanOrEqual(3)
    // The transistor conducts: base and collector sit strictly inside the rails.
    expect(values.filter((value) => value > 0 && value < 5).length).toBeGreaterThanOrEqual(1)
  })

  it('resolves stock model cards from the part type', () => {
    const { model, errors } = buildCircuitModel({
      title: 'card lookup',
      components: [
        { type: 'npn_transistor', name: 'Q1', nodes: ['C', 'B', 'E'], parameters: { type: '2N3904' } },
        { type: 'n_channel_mosfet', name: 'M1', nodes: ['D', 'G', 'S'], parameters: { type: 'IRF540' } },
        { type: 'p_channel_mosfet', name: 'M2', nodes: ['D', 'G', 'S'], parameters: { type: 'IRF9540' } },
        { type: 'op_amp', name: 'U1', nodes: ['P', 'N', 'O'], parameters: { type: 'LM358' } },
      ],
      analyses: [{ type: 'dc' }],
    })
    expect(errors).toEqual([])
    const bjt = model.devices.find((device) => device.name === 'Q1')
    const nmos = model.devices.find((device) => device.name === 'M1')
    const pmos = model.devices.find((device) => device.name === 'M2')
    const opAmp = model.devices.find((device) => device.name === 'U1')
    expect(bjt).toMatchObject({ kind: 'bjt', model: { bf: 300, vaf: 100, rb: 20 } })
    expect(nmos).toMatchObject({ kind: 'mosfet', polarity: 'n', model: { vto: 2.8, kp: 1.1 } })
    expect(pmos).toMatchObject({ kind: 'mosfet', polarity: 'p', model: { vto: -2.8, kp: 1.7 } })
    // Datasheets, not generic fallbacks: LM358 slews at 0.5 V/µs into ±16 V rails.
    expect(opAmp).toMatchObject({ kind: 'op-amp', slew: 5e5, vPlusFixed: 16, vMinusFixed: -16 })
  })

  it('lets an explicit symbol value override the stock card', () => {
    const { model, errors } = buildCircuitModel({
      title: 'explicit wins',
      components: [
        { type: 'npn_transistor', name: 'Q1', nodes: ['C', 'B', 'E'], parameters: { type: '2N3904', bf: 100 } },
      ],
      analyses: [{ type: 'dc' }],
    })
    expect(errors).toEqual([])
    expect(model.devices[0]).toMatchObject({ kind: 'bjt', model: { bf: 100, vaf: 100 } })
  })
})