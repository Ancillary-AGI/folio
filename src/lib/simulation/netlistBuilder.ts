import type { CanvasComponent, CanvasWire } from '../../stores/useProjectStore'
import type { CircuitNetlist, SimulationParameters } from './spiceEngine'

/**
 * Terminal order expected by the simulator for each classified device kind —
 * the netlist builder passes pin nodes positionally, so a symbol whose pins
 * were added in a different order must be remapped here rather than silently
 * mis-wired. Entries list the pin `id`s in simulator order (SPICE order for
 * transistors: C/B/E and D/G/S; in+/in−/out for controlled sources).
 */
const PIN_ORDER: Readonly<Record<string, ReadonlyArray<string>>> = {
  'npn_transistor': ['collector', 'base', 'emitter'],
  'pnp_transistor': ['collector', 'base', 'emitter'],
  'n_channel_mosfet': ['drain', 'gate', 'source'],
  'p_channel_mosfet': ['drain', 'gate', 'source'],
  'n_channel_jfet': ['drain', 'gate', 'source'],
  'p_channel_jfet': ['drain', 'gate', 'source'],
  'voltage_controlled_switch': ['positive', 'negative', 'control_pos', 'control_neg'],
  'current_controlled_switch': ['positive', 'negative'],
  'behavioral_source': ['positive', 'negative'],
}

const pinKey = (componentId: string, pinId: string): string => `${componentId}\u0000${pinId}`

const normalizeNetName = (name: string): string => {
  const trimmed = name.trim()
  if (/^(?:0|gnd|ground)$/i.test(trimmed)) return '0'
  return trimmed.replace(/[^a-zA-Z0-9_]/g, '_')
}

export function buildCircuitNetlist(
  title: string,
  components: CanvasComponent[],
  wires: CanvasWire[],
  analysis: SimulationParameters,
): CircuitNetlist {
  const parents = new Map(wires.map((wire) => [wire.id, wire.id]))
  const firstWireByPin = new Map<string, string>()

  const find = (wireId: string): string => {
    const parent = parents.get(wireId)
    if (!parent) throw new Error(`Wire ${wireId} is missing from the circuit`)
    if (parent === wireId) return wireId
    const root = find(parent)
    parents.set(wireId, root)
    return root
  }

  const union = (left: string, right: string): void => {
    const leftRoot = find(left)
    const rightRoot = find(right)
    if (leftRoot !== rightRoot) {
      const [first, second] = [leftRoot, rightRoot].sort()
      parents.set(second, first)
    }
  }

  for (const wire of wires) {
    for (const connection of wire.connectedPins) {
      const key = pinKey(connection.componentId, connection.pinId)
      const existingWire = firstWireByPin.get(key)
      if (existingWire) union(existingWire, wire.id)
      else firstWireByPin.set(key, wire.id)
    }
  }

  const wiresByName = new Map<string, string>()
  for (const wire of wires) {
    if (!wire.netName?.trim()) continue
    const name = normalizeNetName(wire.netName)
    const existingWire = wiresByName.get(name)
    if (existingWire) union(existingWire, wire.id)
    else wiresByName.set(name, wire.id)
  }

  const namesByRoot = new Map<string, Set<string>>()
  for (const wire of wires) {
    if (!wire.netName?.trim()) continue
    const root = find(wire.id)
    const names = namesByRoot.get(root) ?? new Set<string>()
    names.add(normalizeNetName(wire.netName))
    namesByRoot.set(root, names)
  }
  for (const names of namesByRoot.values()) {
    if (names.size > 1) throw new Error(`Connected wires have conflicting net names: ${[...names].join(', ')}`)
  }

  const nodeForPin = (componentId: string, pinId: string): string => {
    const wireId = firstWireByPin.get(pinKey(componentId, pinId))
    if (!wireId) return `NC_${componentId}_${pinId}`.replace(/[^a-zA-Z0-9_]/g, '_')
    const root = find(wireId)
    const named = namesByRoot.get(root)?.values().next().value
    if (named) return named
    // Anonymous wires keep the historical `N_<root>` name — never a wire-id
    // derived name, because two different canvas sessions could otherwise map
    // unrelated nets onto colliding node names.
    return `N_${root}`.replace(/[^a-zA-Z0-9_]/g, '_')
  }

  return {
    title,
    components: components.map((placed) => {
      const type = placed.component.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')
      const order = PIN_ORDER[type]
      const pins = order
        ? order.map((pinId) => {
            const pin = placed.component.pins.find((candidate) => candidate.id === pinId)
            if (!pin) throw new Error(`${placed.reference}: symbol ${placed.component.name} is missing pin ${pinId}`)
            return pin
          })
        : placed.component.pins
      return {
        type,
        name: placed.reference,
        nodes: pins.map((pin) => nodeForPin(placed.id, pin.id)),
        parameters: placed.properties,
      }
    }),
    analyses: [analysis],
  }
}
