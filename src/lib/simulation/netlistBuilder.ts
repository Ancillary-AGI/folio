import type { CanvasComponent, CanvasWire } from '../../stores/useProjectStore'
import type { CircuitNetlist, SimulationParameters } from './spiceEngine'

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
    return namesByRoot.get(root)?.values().next().value ?? `N_${root}`.replace(/[^a-zA-Z0-9_]/g, '_')
  }

  return {
    title,
    components: components.map((placed) => ({
      type: placed.component.name.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      name: placed.reference,
      nodes: placed.component.pins.map((pin) => nodeForPin(placed.id, pin.id)),
      parameters: placed.properties,
    })),
    analyses: [analysis],
  }
}
