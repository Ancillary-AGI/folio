/**
 * Netlist interchange bridge.
 *
 * KiCad's s-expression netlist and EAGLE's XML schematic share one
 * `{ components, nets }` shape. This module converts between that shape and
 * the canvas structures the simulator netlists from, so a design can leave
 * for layout in either tool and come back to be simulated.
 *
 * Scope is deliberately narrow and fail-loud: two-terminal R, C, L, D, V and
 * I parts with numeric pin ids. A transistor netlist is not silently reduced
 * to its first two terminals — that would simulate a different circuit — it
 * is rejected with the reference designator named.
 */
import type { CanvasComponent, CanvasWire } from '../../stores/useProjectStore'
import type { Component } from '../supabase'
import type { CircuitNetlist } from './spiceEngine'
import type { SchematicSheet } from './multiSheet'
import { parseKicadNetlist } from '../manufacturing/kicadNetlist'
import { parseEagleSchematic } from '../manufacturing/eagleSchematic'
import type { KicadNetlist } from '../manufacturing/kicadNetlist'
import type { EagleNetlist } from '../manufacturing/eagleSchematic'

/** Both interchange parsers produce this shape. */
export type InterchangeNetlist = KicadNetlist | EagleNetlist

export interface ImportedInterchange {
  format: 'kicad' | 'eagle'
  netlist: InterchangeNetlist
}

interface TwoTerminalSymbol {
  symbol: string
  category: string
}

/**
 * Reference-designator prefixes a two-terminal import understands. The digit
 * after the prefix matters: `LED1` is not an inductor and is rejected rather
 * than mis-simulated as one.
 */
const TWO_TERMINAL_SYMBOLS: Readonly<Record<string, TwoTerminalSymbol>> = {
  R: { symbol: 'Resistor', category: 'passive' },
  C: { symbol: 'Capacitor', category: 'passive' },
  L: { symbol: 'Inductor', category: 'passive' },
  D: { symbol: 'Diode', category: 'semiconductor' },
  V: { symbol: 'Voltage Source', category: 'source' },
  I: { symbol: 'Current Source', category: 'source' },
}

const prefixOf = (reference: string): string | null => {
  const match = /^([RCLDVI])\d/i.exec(reference.trim())
  return match ? match[1].toUpperCase() : null
}

const unconnectedNode = (node: string): boolean => node.startsWith('NC_')

/**
 * Project a simulated circuit netlist onto the interchange shape.
 *
 * Unconnected terminals (`NC_*`) are omitted: an interchange net is a
 * connection, and inventing a one-pin net would import back as a dangling
 * wire that was never drawn.
 */
export function circuitToInterchange(netlist: CircuitNetlist): InterchangeNetlist {
  const components = netlist.components.map((component) => {
    const parameters = component.parameters
    const value =
      parameters.value
      ?? parameters.dc
      ?? parameters.voltage
      ?? parameters.current
      ?? parameters.amplitude
      ?? parameters.resistance
      ?? parameters.capacitance
      ?? parameters.inductance
      ?? ''
    return {
      ref: component.name,
      value: String(value),
      footprint: String(parameters.footprint ?? ''),
    }
  })
  const nets = new Map<string, Array<{ ref: string; pin: string }>>()
  for (const component of netlist.components) {
    component.nodes.forEach((node, index) => {
      if (unconnectedNode(node) || !node.trim()) return
      const name = /^(?:0|gnd|ground)$/i.test(node.trim()) ? 'GND' : node
      const nodes = nets.get(name) ?? []
      nodes.push({ ref: component.name, pin: String(index + 1) })
      nets.set(name, nodes)
    })
  }
  return {
    components,
    nets: [...nets].map(([name, nodes], index) => ({ code: String(index + 1), name, nodes })),
  }
}

const twoPinSymbol = (): Component => ({
  name: '',
  category: 'passive',
  is_standard: true,
  symbol_data: { width: 60, height: 30, paths: [] },
  pins: [
    { id: '1', name: '1', x: 0, y: 15, type: 'passive' },
    { id: '2', name: '2', x: 60, y: 15, type: 'passive' },
  ],
  default_properties: {},
})

/** Parse either supported interchange format, detected from the document root. */
export function parseInterchangeText(text: string): ImportedInterchange {
  const trimmed = text.trimStart()
  if (!trimmed) throw new Error('The netlist file is empty.')
  if (trimmed.startsWith('(')) {
    return { format: 'kicad', netlist: parseKicadNetlist(trimmed) }
  }
  if (/<\s*eagle\b/i.test(trimmed)) {
    return { format: 'eagle', netlist: parseEagleSchematic(trimmed) }
  }
  throw new Error(
    'Unrecognised netlist — expected a KiCad (export …) document or an EAGLE XML schematic.',
  )
}

export function interchangeStats(netlist: InterchangeNetlist): {
  components: number
  nets: number
  pins: number
} {
  return {
    components: netlist.components.length,
    nets: netlist.nets.length,
    pins: netlist.nets.reduce((sum, net) => sum + net.nodes.length, 0),
  }
}

/**
 * Convert an interchange netlist into a canvas sheet.
 *
 * Wires carry the pin connections directly — the simulator reads
 * `connectedPins`, not drawn geometry — so imported sheets simulate exactly
 * as their netlist describes. Positions are only a legible default layout
 * for the sheet if it is ever drawn.
 */
export function interchangeToSheet(name: string, netlist: InterchangeNetlist): SchematicSheet {
  const references = new Set<string>()
  const components: CanvasComponent[] = netlist.components.map((entry, index) => {
    const reference = entry.ref.trim()
    if (!reference) throw new Error('Netlist component without a reference designator.')
    if (references.has(reference)) {
      throw new Error(`Duplicate reference ${reference} in the imported netlist.`)
    }
    references.add(reference)
    const prefix = prefixOf(reference)
    if (!prefix) {
      throw new Error(
        `${reference}: unsupported import — only two-terminal R, C, L, D, V and I parts are supported.`,
      )
    }
    const template = TWO_TERMINAL_SYMBOLS[prefix]
    const value = entry.value.trim()
    if (!value) {
      throw new Error(`${reference}: the imported netlist has no value — a value is required to simulate it.`)
    }
    const symbol = twoPinSymbol()
    return {
      id: `imported-${index + 1}-${reference.replace(/[^A-Za-z0-9_]/g, '_')}`,
      componentId: `imported-${prefix}`,
      component: {
        ...symbol,
        name: template.symbol,
        category: template.category,
      },
      x: 80 + (index % 6) * 180,
      y: 80 + Math.floor(index / 6) * 120,
      rotation: 0,
      reference,
      properties: { value, ...(entry.footprint.trim() ? { footprint: entry.footprint.trim() } : {}) },
    }
  })

  const byReference = new Map(components.map((component) => [component.reference, component]))
  const pinOwner = new Map<string, string>()
  const wires: CanvasWire[] = []
  // One routing lane per net, below every part row. Collinear wires would sit
  // in each other's bounding boxes and the netlist builder's T-junction test
  // would electrically join unrelated nets; distinct lanes keep geometry
  // honest while `connectedPins` carries the real connectivity.
  const rows = Math.max(1, Math.ceil(components.length / 6))
  const laneBaseY = 80 + rows * 120 + 20
  netlist.nets.forEach((net, netIndex) => {
    if (net.nodes.length === 0) return
    const connections: CanvasWire['connectedPins'] = []
    const points: Array<{ x: number; y: number }> = []
    for (const node of net.nodes) {
      const component = byReference.get(node.ref)
      if (!component) {
        throw new Error(`Net ${net.name || net.code}: unknown component ${node.ref}.`)
      }
      const pin = node.pin.trim()
      if (pin !== '1' && pin !== '2') {
        throw new Error(
          `${node.ref}: pin ${pin} is not a two-terminal pin — only pins 1 and 2 are supported.`,
        )
      }
      const key = `${node.ref}\u0000${pin}`
      const owner = pinOwner.get(key)
      if (owner !== undefined) {
        throw new Error(`${node.ref} pin ${pin} is on both net ${owner} and net ${net.name || net.code}.`)
      }
      pinOwner.set(key, net.name || net.code)
      connections.push({ componentId: component.id, pinId: pin })
      points.push({ x: component.x + (pin === '1' ? 0 : 60), y: component.y + 15 })
    }
    if (points.length === 1) points.push({ ...points[0] })
    const laneY = laneBaseY + netIndex * 14
    const routed: Array<{ x: number; y: number }> = [points[0], { x: points[0].x, y: laneY }]
    for (let index = 1; index < points.length; index++) {
      routed.push({ x: points[index].x, y: laneY }, points[index])
      if (index < points.length - 1) routed.push({ x: points[index].x, y: laneY })
    }
    wires.push({
      id: `imported-wire-${netIndex + 1}`,
      points: routed,
      ...(net.name.trim() ? { netName: net.name.trim() } : {}),
      connectedPins: connections,
    })
  })

  return { name, components, wires }
}
