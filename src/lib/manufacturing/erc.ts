import type { Component, Net, Pin, Schematic, Wire } from '../../types'

export type ERCViolationType =
  | 'unconnected_pin'
  | 'floating_input'
  | 'multiple_drivers'
  | 'power_ground_short'
  | 'supply_output_unconnected'
  | 'no_driver'

export interface ERCViolation {
  type: ERCViolationType
  severity: 'error' | 'warning' | 'info'
  message: string
  componentId?: string
  pinId?: string
  netId?: string
  location?: { x: number; y: number }
  suggestion?: string
}

export interface ERCResult {
  isValid: boolean
  violations: ERCViolation[]
  summary: {
    errors: number
    warnings: number
    info: number
    totalViolations: number
  }
}

const POWER_SUPPLY = /power|supply|regulator|battery|ldo|dc-dc|converter|charger/

function isPowerSupply(component: Component): boolean {
  return POWER_SUPPLY.test(`${component.category} ${component.name}`.toLowerCase())
}

function connectionKey(componentId: string, pinId: string): string {
  return `${componentId}\u0000${pinId}`
}

interface ResolvedPin {
  connection: { componentId: string; pinId: string }
  component: Component
  pin: Pin
}

/**
 * Electrical rule check over a flat component/wire/net graph.
 *
 * Compared with the earlier implementation this reports each physical problem
 * exactly once: unconnected pins are classified by `Pin.type` (the `nc` type
 * is skipped), multiple drivers and power/ground shorts are one net-level
 * violation each, and wire-only schematics — where `nets` is empty but wires
 * carry `connectedPins` — are analysed by deriving nets from the wires.
 */
export class ElectricalRuleChecker {
  private readonly components: Component[]
  private readonly wires: Wire[]
  private readonly nets: Net[]

  constructor(components: Component[], wires: Wire[], nets: Net[]) {
    this.components = components
    this.wires = wires
    this.nets = nets
  }

  runERC(): ERCResult {
    const connected = this.collectConnectedPins()
    const violations: ERCViolation[] = [
      ...this.checkUnconnectedPins(connected),
      ...this.checkNetConflicts(),
    ]

    const errors = violations.filter(v => v.severity === 'error').length
    const warnings = violations.filter(v => v.severity === 'warning').length
    const info = violations.filter(v => v.severity === 'info').length

    return {
      isValid: errors === 0,
      violations,
      summary: { errors, warnings, info, totalViolations: violations.length },
    }
  }

  private collectConnectedPins(): Set<string> {
    const connected = new Set<string>()
    for (const wire of this.wires) {
      for (const connection of wire.connectedPins) {
        connected.add(connectionKey(connection.componentId, connection.pinId))
      }
    }
    for (const net of this.nets) {
      for (const connection of net.connectedPins) {
        connected.add(connectionKey(connection.componentId, connection.pinId))
      }
    }
    return connected
  }

  private findPin(componentId: string, pinId: string): { component: Component; pin: Pin } | undefined {
    const component = this.components.find(candidate => candidate.id === componentId)
    const pin = component?.pins.find(candidate => candidate.id === pinId)
    return component && pin ? { component, pin } : undefined
  }

  private checkUnconnectedPins(connected: Set<string>): ERCViolation[] {
    const violations: ERCViolation[] = []

    for (const component of this.components) {
      for (const pin of component.pins) {
        if (pin.type === 'nc') continue
        if (connected.has(connectionKey(component.id, pin.id))) continue

        const base = {
          componentId: component.id,
          pinId: pin.id,
          location: { x: pin.x, y: pin.y },
        }

        switch (pin.type) {
          case 'power':
            violations.push({
              ...base,
              type: 'unconnected_pin',
              severity: 'error',
              message: `Power pin "${pin.name}" of ${component.name} is not connected`,
              suggestion: 'Connect this power pin to the appropriate power net',
            })
            break
          case 'ground':
            violations.push({
              ...base,
              type: 'unconnected_pin',
              severity: 'error',
              message: `Ground pin "${pin.name}" of ${component.name} is not connected`,
              suggestion: 'Connect this ground pin to the ground net',
            })
            break
          case 'input':
            violations.push({
              ...base,
              type: 'floating_input',
              severity: 'warning',
              message: `Input pin "${pin.name}" of ${component.name} is floating`,
              suggestion: 'Connect the input to a source or add a pull-up/pull-down resistor',
            })
            break
          case 'output':
            if (isPowerSupply(component)) {
              violations.push({
                ...base,
                type: 'supply_output_unconnected',
                severity: 'warning',
                message: `Power supply output "${pin.name}" of ${component.name} is not connected`,
                suggestion: 'Connect the supply output to its load circuit',
              })
            } else {
              violations.push({
                ...base,
                type: 'unconnected_pin',
                severity: 'info',
                message: `Output pin "${pin.name}" of ${component.name} is not connected`,
                suggestion: 'Acceptable for an unused output',
              })
            }
            break
          default:
            violations.push({
              ...base,
              type: 'unconnected_pin',
              severity: 'info',
              message: `Pin "${pin.name}" of ${component.name} is not connected`,
              suggestion: 'Leave unconnected only if intentional',
            })
        }
      }
    }

    return violations
  }

  /**
   * Merge declared nets and wire-carried connectivity into one net list.
   *
   * Wires are unified exactly as the netlist builder unifies them: by net
   * name, by shared pin, and — because a T-tap drawn on the canvas is one
   * node — by an endpoint of one wire landing on another wire's segment.
   * Without the geometry union, two drivers on a canvas T-tap report clean.
   * A wire with no others attached stays its own anonymous net, so two
   * drivers on the same unnamed wire are still detected.
   */
  private effectiveNets(): Array<{ id: string; name: string; connectedPins: Net['connectedPins'] }> {
    // Union-find over wires, keyed by wire identity.
    const parent = new Map<string, string>()
    const find = (id: string): string => {
      let root = id
      while (parent.get(root) !== root) root = parent.get(root) as string
      let current = id
      while (current !== root) {
        const next = parent.get(current) as string
        parent.set(current, root)
        current = next
      }
      return root
    }
    const union = (first: string, second: string): void => {
      const rootA = find(first)
      const rootB = find(second)
      if (rootA !== rootB) parent.set(rootA, rootB)
    }

    for (const wire of this.wires) parent.set(wire.id, wire.id)

    // Name joins.
    const byName = new Map<string, string>()
    for (const wire of this.wires) {
      if (!wire.netName?.trim()) continue
      const name = wire.netName.trim().toLowerCase().replace(/\s+/g, ' ')
      const existing = byName.get(name)
      if (existing) union(existing, wire.id)
      else byName.set(name, wire.id)
    }

    // Shared pin joins: two wires claiming the same pin are one node.
    const firstWireByPin = new Map<string, string>()
    for (const wire of this.wires) {
      for (const connection of wire.connectedPins) {
        const key = connectionKey(connection.componentId, connection.pinId)
        const existing = firstWireByPin.get(key)
        if (existing) union(existing, wire.id)
        else firstWireByPin.set(key, wire.id)
      }
    }

    // Geometry joins: a wire end landing on another wire's segment is the
    // same node the canvas draws a junction dot for.
    const pointOnSegment = (
      end: { x: number; y: number },
      a: { x: number; y: number },
      b: { x: number; y: number },
    ): boolean => {
      const abx = b.x - a.x
      const aby = b.y - a.y
      const lengthSquared = abx * abx + aby * aby
      const tolerance = 0.5
      if (lengthSquared === 0) return Math.hypot(end.x - a.x, end.y - a.y) <= tolerance
      const t = ((end.x - a.x) * abx + (end.y - a.y) * aby) / lengthSquared
      if (t < 0 || t > 1) return false
      return Math.hypot(end.x - (a.x + t * abx), end.y - (a.y + t * aby)) <= tolerance
    }
    for (const wire of this.wires) {
      if (wire.points.length === 0) continue
      const ends = [wire.points[0], wire.points[wire.points.length - 1]]
      for (const other of this.wires) {
        if (other.id === wire.id || other.points.length === 0) continue
        for (const end of ends) {
          for (let k = 0; k + 1 < other.points.length; k += 1) {
            if (pointOnSegment(end, other.points[k], other.points[k + 1])) {
              union(wire.id, other.id)
              break
            }
          }
        }
      }
    }

    // Group wires by root in one pass (no per-root rescans).
    const groups = new Map<string, Wire[]>()
    for (const wire of this.wires) {
      const root = find(wire.id)
      const bucket = groups.get(root)
      if (bucket) bucket.push(wire)
      else groups.set(root, [wire])
    }
    const nameFor = (root: string): string => {
      const group = groups.get(root) ?? []
      const named = group.map((wire) => wire.netName?.trim()).find((name) => !!name)
      return named ?? `wire:${group[0]?.id ?? root}`
    }

    const merged = new Map<string, { id: string; name: string; connectedPins: Net['connectedPins'] }>()
    for (const [root, group] of groups) {
      merged.set(root, {
        id: root,
        name: nameFor(root),
        connectedPins: group.flatMap((wire) => wire.connectedPins),
      })
    }

    // Declared nets merge by name, carrying their pins — and join the
    // wire-derived nets they name, so a netlist net and its wires are one.
    const byNetName = new Map<string, string>() // normalized name -> merged wire root id
    for (const [root, entry] of merged) {
      if (!entry.name.startsWith('wire:')) {
        byNetName.set(entry.name.toLowerCase(), root)
      }
    }
    for (const net of this.nets) {
      const key = (net.name || net.id).trim().toLowerCase().replace(/\s+/g, ' ')
      const root = byNetName.get(key)
      if (root) {
        merged.get(root)?.connectedPins.push(...net.connectedPins)
        continue
      }
      const existing = merged.get(key)
      if (existing) existing.connectedPins.push(...net.connectedPins)
      else merged.set(key, { id: net.id, name: net.name || net.id, connectedPins: [...net.connectedPins] })
    }

    for (const net of merged.values()) {
      const seen = new Set<string>()
      net.connectedPins = net.connectedPins.filter(connection => {
        const key = connectionKey(connection.componentId, connection.pinId)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
    }

    return Array.from(merged.values())
  }

  private checkNetConflicts(): ERCViolation[] {
    const violations: ERCViolation[] = []

    for (const net of this.effectiveNets()) {
      const resolved: ResolvedPin[] = []
      for (const connection of net.connectedPins) {
        const found = this.findPin(connection.componentId, connection.pinId)
        if (found) resolved.push({ connection, ...found })
      }

      const outputs = resolved.filter(entry => entry.pin.type === 'output')
      if (outputs.length > 1) {
        const drivers = outputs
          .map(entry => `${entry.component.name}.${entry.pin.name}`)
          .join(', ')
        violations.push({
          type: 'multiple_drivers',
          severity: 'error',
          message: `Net "${net.name}" is driven by ${outputs.length} outputs (${drivers})`,
          netId: net.id,
          suggestion: 'Separate the outputs or use tri-state buffers / multiplexing',
        })
      }

      const powerPins = resolved.filter(entry => entry.pin.type === 'power')
      const groundPins = resolved.filter(entry => entry.pin.type === 'ground')
      if (powerPins.length > 0 && groundPins.length > 0) {
        const supplies = powerPins.map(entry => `${entry.component.name}.${entry.pin.name}`).join(', ')
        const returns = groundPins.map(entry => `${entry.component.name}.${entry.pin.name}`).join(', ')
        violations.push({
          type: 'power_ground_short',
          severity: 'error',
          message: `Net "${net.name}" shorts power (${supplies}) to ground (${returns})`,
          netId: net.id,
          suggestion: 'Separate the power and ground nets',
        })
      }

      /*
       * Input pins wired only to other input pins: nothing on this net can drive
       * it. A passive pin is not flagged, because a connector or series part is
       * routinely the entry point of a signal from off-sheet.
       */
      const inputs = resolved.filter(entry => entry.pin.type === 'input')
      if (inputs.length > 0 && inputs.length === resolved.length) {
        const pins = inputs.map(entry => `${entry.component.name}.${entry.pin.name}`).join(', ')
        violations.push({
          type: 'no_driver',
          severity: 'warning',
          message: `Net "${net.name}" connects only inputs (${pins}) — nothing drives it`,
          netId: net.id,
          suggestion: 'Connect it to an output or source, or split the net',
        })
      }
    }

    return violations
  }

  getConnectedNet(componentId: string, pinId: string): Net | null {
    for (const net of this.nets) {
      if (net.connectedPins.some(connection =>
        connection.componentId === componentId && connection.pinId === pinId
      )) {
        return net
      }
    }
    return null
  }

  getPinConnections(componentId: string, pinId: string): Array<{ componentId: string; pinId: string }> {
    const connections: Array<{ componentId: string; pinId: string }> = []

    for (const wire of this.wires) {
      const ownsPin = wire.connectedPins.some(connection =>
        connection.componentId === componentId && connection.pinId === pinId
      )
      if (!ownsPin) continue
      for (const connection of wire.connectedPins) {
        if (connection.componentId !== componentId || connection.pinId !== pinId) {
          connections.push(connection)
        }
      }
    }

    return connections
  }
}

/**
 * Run ERC on a schematic. Placed instances become components with their
 * instance id, because wires and nets reference the instance rather than the
 * library part; connection checks would otherwise silently miss everything.
 */
export function runSchematicERC(schematic: Schematic): ERCResult {
  const components: Component[] = schematic.components.map(placed => ({
    ...placed.component,
    id: placed.id,
    name: placed.reference
      ? `${placed.component.name} (${placed.reference})`
      : placed.component.name,
  }))

  return new ElectricalRuleChecker(components, schematic.wires, schematic.nets).runERC()
}
