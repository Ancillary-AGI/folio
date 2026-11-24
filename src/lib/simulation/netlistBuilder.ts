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
  'n_channel_finfet': ['drain', 'gate', 'source'],
  'n_channel_gan_hemt': ['drain', 'gate', 'source'],
  'n_channel_jfet': ['drain', 'gate', 'source'],
  'p_channel_jfet': ['drain', 'gate', 'source'],
  'voltage_controlled_switch': ['positive', 'negative', 'control_pos', 'control_neg'],
  'current_controlled_switch': ['positive', 'negative'],
  'lm358_op_amp': ['in_a_pos', 'in_a_neg', 'out_a', 'vcc', 'vee'],
  'behavioral_source': ['positive', 'negative'],
  'transformer': ['primary_in', 'primary_out', 'secondary_in', 'secondary_out'],
  'transmission_line': ['p1', 'n1', 'p2', 'n2'],
}

const pinKey = (componentId: string, pinId: string): string => `${componentId}\u0000${pinId}`

/**
 * Terminal pins in the exact order `buildCircuitNetlist` emits nodes.
 *
 * Exported so analyses that need to correlate a node index back to its pin
 * (ERC, probes) cannot drift from the netlist builder's ordering.
 */
export function orderedTerminalPins(
  component: CanvasComponent['component'],
): CanvasComponent['component']['pins'] {
  const type = component.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')
  const order = PIN_ORDER[type]
  if (!order) return component.pins
  return order.map((pinId) => {
    const pin = component.pins.find((candidate) => candidate.id === pinId)
    if (!pin) throw new Error(`Symbol ${component.name} is missing pin ${pinId}`)
    return pin
  })
}

/** SPICE-compatible net key: trimmed, punctuation folded, case-folded, GND→0.
 * The same spelling the router and the solver use, so net identity never
 * drifts between the schematic, the board, the fab package and the solver. */
export const normalizeNetName = (name: string): string => {
  const trimmed = name.trim()
  if (/^(?:0|gnd|ground)$/i.test(trimmed)) return '0'
  // SPICE is case-insensitive and the solver upper-cases every node before it
  // exposes operating points and waveforms. Emit the same spelling here, or a
  // snapshot net named `out` cannot be matched to the solver's `OUT`.
  return trimmed.replace(/[^a-zA-Z0-9_]/g, '_').toUpperCase()
}

/** Board-domain net key: trimmed, whitespace-collapsed, case-folded. Keeps
 * GND as GND — a real net on a board, unlike the solver's `0` — while still
 * folding 'Out', 'OUT' and 'out' into one net for the router, DRC and fab. */
export const normalizeBoardNetName = (name: string): string =>
  name.trim().replace(/\s+/g, ' ').toUpperCase()

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

  // Geometry joins: a stub END landing on another wire's segment is the same
  // node the canvas draws a junction dot for. Without this, a T-tap (stub
  // end on a rail midpoint) would simulate open while the sheet shows a
  // connected dot — the exact lie your screenshot caught.
  /*
   * Segment membership, not bounding-box containment: a point is on the
   * segment when it sits within tolerance of the line itself. The old box
   * test unioned any stub end whose x/y fell inside the other wire's
   * rectangle — a stub landing under a *diagonal* wire joined nets the sheet
   * draws as separate.
   */
  const pointOnSegment = (
    end: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number },
  ): boolean => {
    const abx = b.x - a.x
    const aby = b.y - a.y
    const lengthSquared = abx * abx + aby * aby
    const tolerance = 0.5
    if (lengthSquared === 0) {
      // Degenerate segment: the two ends coincide.
      return Math.hypot(end.x - a.x, end.y - a.y) <= tolerance
    }
    // Project onto the segment, clamp to [0, 1], then measure the distance
    // from the clamped foot back to the point.
    const t = ((end.x - a.x) * abx + (end.y - a.y) * aby) / lengthSquared
    if (t < 0 || t > 1) return false
    const footX = a.x + t * abx
    const footY = a.y + t * aby
    return Math.hypot(end.x - footX, end.y - footY) <= tolerance
  }
  for (let i = 0; i < wires.length; i++) {
    const wire = wires[i]
    const ends = [wire.points[0], wire.points[wire.points.length - 1]]
    for (const end of ends) {
      if (!end) continue
      for (let j = 0; j < wires.length; j++) {
        if (i === j) continue
        const other = wires[j]
        for (let k = 0; k + 1 < other.points.length; k++) {
          if (pointOnSegment(end, other.points[k], other.points[k + 1])) {
            union(wire.id, other.id)
            break
          }
        }
      }
    }
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
    if (!wireId) return `NC_${componentId}_${pinId}`.replace(/[^a-zA-Z0-9_]/g, '_').toUpperCase()
    const root = find(wireId)
    const named = namesByRoot.get(root)?.values().next().value
    if (named) return named
    // Anonymous wires keep the historical `N_<root>` name — never a wire-id
    // derived name, because two different canvas sessions could otherwise map
    // unrelated nets onto colliding node names.
    return `N_${root}`.replace(/[^a-zA-Z0-9_]/g, '_').toUpperCase()
  }

  return {
    title,
    components: components.map((placed) => {
      const type = placed.component.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')
      const pins = orderedTerminalPins(placed.component)
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
