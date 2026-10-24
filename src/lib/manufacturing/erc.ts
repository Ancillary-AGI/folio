import type { Component, Net, Pin, Schematic, Wire } from '../../types'

export type ERCViolationType =
  | 'unconnected_pin'
  | 'floating_input'
  | 'multiple_drivers'
  | 'power_ground_short'
  | 'supply_output_unconnected'

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
   * A wire without a `netName` is its own anonymous net, so two drivers on
   * the same unnamed wire are still detected.
   */
  private effectiveNets(): Array<{ id: string; name: string; connectedPins: Net['connectedPins'] }> {
    const byName = new Map<string, { id: string; name: string; connectedPins: Net['connectedPins'] }>()

    for (const net of this.nets) {
      const key = net.name || net.id
      const existing = byName.get(key)
      if (existing) {
        existing.connectedPins.push(...net.connectedPins)
      } else {
        byName.set(key, { id: net.id, name: key, connectedPins: [...net.connectedPins] })
      }
    }

    for (const wire of this.wires) {
      const key = wire.netName || `wire:${wire.id}`
      const existing = byName.get(key)
      if (existing) {
        existing.connectedPins.push(...wire.connectedPins)
      } else {
        byName.set(key, { id: key, name: key, connectedPins: [...wire.connectedPins] })
      }
    }

    for (const net of byName.values()) {
      const seen = new Set<string>()
      net.connectedPins = net.connectedPins.filter(connection => {
        const key = connectionKey(connection.componentId, connection.pinId)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
    }

    return Array.from(byName.values())
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
