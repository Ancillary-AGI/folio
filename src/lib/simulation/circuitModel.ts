/**
 * Circuit model construction.
 *
 * Turns a parsed `CircuitNetlist` into:
 *   • a typed device list (see `devices.ts`), and
 *   • the unknown vector layout used by modified nodal analysis (MNA).
 *
 * MNA layout
 * ----------
 *   [ 0 .. nodeCount-1 ]   node voltages (ground excluded)
 *   [ nodeCount .. ]       branch currents, one row per voltage source and
 *                          per inductor
 *
 * Voltage sources and inductors need a current unknown because their defining
 * equation is a voltage constraint, not a conductance. That is the point of MNA
 * over plain nodal analysis, and why a lone voltage source across two nodes is
 * solvable here while it would be singular with conductances alone.
 */

import { parseSpiceValue, normalizeNodeName, isGroundNode, pickParameter, type Device } from './devices'
import type { CircuitNetlist, Component } from './spiceEngine'

export interface CircuitModel {
  devices: Device[]
  /** Non-ground node names, sorted for a deterministic unknown ordering. */
  nodeNames: string[]
  /** Node name → row index. */
  nodeIndex: Map<string, number>
  /** Device name → branch-current row index (voltage sources and inductors). */
  branchRows: Map<string, number>
  /** Total number of unknowns (node voltages + branch currents). */
  size: number
  /** Every node name that is ground, including aliases found on devices. */
  groundNodes: Set<string>
  /** Non-fatal observations worth surfacing to the user. */
  notes: string[]
}

export interface BuildModelResult {
  model: CircuitModel
  /** Fatal problems. When non-empty the model must not be simulated. */
  errors: string[]
}

type DeviceKind = Device['kind']

/**
 * Component classification, in priority order. The `type` string is matched
 * first and is authoritative; the reference-designator prefix is the fallback
 * for hand-written netlists, which is the SPICE convention.
 */
const CLASSIFIERS: ReadonlyArray<{ kind: DeviceKind | 'ground'; matches: (type: string, name: string) => boolean }> = [
  { kind: 'ground', matches: (type, name) => type.includes('ground') || /^gnd$|^g\d/i.test(name) },
  {
    kind: 'voltage-source',
    matches: (type, name) => (type.includes('voltage') && type.includes('source')) || /^v\d/i.test(name),
  },
  {
    kind: 'current-source',
    matches: (type, name) => (type.includes('current') && type.includes('source')) || /^i\d/i.test(name),
  },
  { kind: 'capacitor', matches: (type, name) => type.includes('capacit') || /^c\d/i.test(name) },
  { kind: 'inductor', matches: (type, name) => type.includes('induct') || /^l\d/i.test(name) },
  { kind: 'diode', matches: (type, name) => type.includes('diode') || type.includes('rectifier') || /^d\d/i.test(name) },
  {
    kind: 'resistor',
    matches: (type, name) =>
      type.includes('resistor') || type.includes('resistance') || type.includes('potentiometer') || /^r\d/i.test(name),
  },
]

function classify(component: Component): DeviceKind | 'ground' | null {
  const type = `${component.type} ${component.name}`.toLowerCase().replace(/[^a-z]/g, '')
  for (const classifier of CLASSIFIERS) {
    if (classifier.matches(type, component.name)) return classifier.kind
  }
  return null
}

/** Terminals emitted by the netlist builder for pins with no wire attached. */
const isUnconnectedNode = (node: string): boolean => node.startsWith('NC_')

/** Read a required numeric parameter, with the alias list and label supplied. */
function requiredValue(component: Component, label: string, ...keys: string[]): number {
  return parseSpiceValue(pickParameter(component.parameters, ...keys), `${component.name} ${label}`)
}

/**
 * Convert one classified component into a `Device`.
 * Returns an error message instead of throwing so a single bad part does not
 * hide every other problem in the schematic.
 */
function toDevice(
  component: Component,
  kind: DeviceKind,
  p: string,
  n: string,
): { device: Device } | { error: string } {
  try {
    switch (kind) {
      case 'resistor': {
        const resistance = requiredValue(component, 'resistance', 'resistance', 'value', 'r')
        if (resistance <= 0) return { error: `${component.name} resistance must be > 0 Ω (got ${resistance}).` }
        return { device: { kind, name: component.name, p, n, resistance } }
      }
      case 'capacitor': {
        const capacitance = requiredValue(component, 'capacitance', 'capacitance', 'value', 'c')
        if (capacitance <= 0) return { error: `${component.name} capacitance must be > 0 F (got ${capacitance}).` }
        return { device: { kind, name: component.name, p, n, capacitance } }
      }
      case 'inductor': {
        const inductance = requiredValue(component, 'inductance', 'inductance', 'value', 'l')
        if (inductance <= 0) return { error: `${component.name} inductance must be > 0 H (got ${inductance}).` }
        return { device: { kind, name: component.name, p, n, inductance } }
      }
      case 'diode': {
        const saturationCurrent = requiredValue(
          component,
          'saturation current',
          'saturationCurrent',
          'is',
          'saturation',
        )
        const emissionCoefficient = requiredValue(
          component,
          'emission coefficient',
          'emissionCoefficient',
          'n',
          'ideality',
        )
        if (saturationCurrent <= 0) return { error: `${component.name} saturation current must be > 0 A.` }
        if (emissionCoefficient <= 0) return { error: `${component.name} emission coefficient must be > 0.` }
        return { device: { kind, name: component.name, p, n, saturationCurrent, emissionCoefficient } }
      }
      case 'voltage-source':
      case 'current-source': {
        const storageKey = kind === 'voltage-source' ? 'dcVoltage' : 'dcCurrent'
        const dcValue = parseSpiceValue(
          pickParameter(component.parameters, storageKey, 'dc', 'value'),
          `${component.name} ${kind === 'voltage-source' ? 'voltage' : 'current'}`,
        )
        /*
         * AC stimulation defaults to the DC value with zero phase. SPICE omits a
         * source from an AC sweep unless an `AC` card is present, which silently
         * plots a flat zero; for an interactive IDE the useful default is "sweep
         * the value you can already see on the source".
         */
        const acMagnitude =
          component.parameters.acMagnitude !== undefined
            ? parseSpiceValue(component.parameters.acMagnitude, `${component.name} AC magnitude`)
            : Math.abs(dcValue)
        const acPhaseDegrees =
          component.parameters.acPhase !== undefined
            ? parseSpiceValue(component.parameters.acPhase, `${component.name} AC phase`)
            : 0

        if (kind === 'voltage-source') {
          return { device: { kind, name: component.name, p, n, dcVoltage: dcValue, acMagnitude, acPhaseDegrees } }
        }
        return { device: { kind, name: component.name, p, n, dcCurrent: dcValue, acMagnitude, acPhaseDegrees } }
      }
      default:
        return { error: `${component.name} is not supported by the solver.` }
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : `${component.name} could not be modelled.` }
  }
}
/**
 * Build the MNA model for `netlist`.
 *
 * Never throws: topology problems come back as `errors` so the UI can list every
 * issue at once instead of surfacing one per run.
 */
export function buildCircuitModel(netlist: CircuitNetlist): BuildModelResult {
  const errors: string[] = []
  const notes: string[] = []
  const devices: Device[] = []
  const groundNodes = new Set<string>(['0'])
  const nodeNames = new Set<string>()

  const twoTerminal = (component: Component): [string, string] | null => {
    if (component.nodes.length < 2) {
      errors.push(`${component.name} needs two terminals but has ${component.nodes.length}.`)
      return null
    }
    if (component.nodes.length > 2) {
      notes.push(`${component.name}: only the first two terminals are used by this solver.`)
    }
    const p = normalizeNodeName(component.nodes[0])
    const n = normalizeNodeName(component.nodes[1])
    if (!p || !n) {
      errors.push(`${component.name} has an unnamed terminal.`)
      return null
    }
    if (p === n) notes.push(`${component.name} has both terminals on the same net.`)
    return [p, n]
  }

  for (const component of netlist.components) {
    const kind = classify(component)

    if (kind === 'ground') {
      if (component.nodes.length === 0) {
        errors.push(`${component.name} is a ground symbol with no net attached.`)
        continue
      }
      groundNodes.add(normalizeNodeName(component.nodes[0]))
      continue
    }

    if (kind === null) {
      errors.push(
        `${component.name} (${component.type}) has no model in this solver. Supported: resistor, capacitor, ` +
          'inductor, voltage source, current source, diode, ground.',
      )
      continue
    }

    const terminals = twoTerminal(component)
    if (!terminals) continue

    const resolved = toDevice(component, kind, terminals[0], terminals[1])
    if ('error' in resolved) errors.push(resolved.error)
    else devices.push(resolved.device)
  }

  // Discover unknowns from real device terminals only.
  for (const device of devices) {
    for (const node of [device.p, device.n]) {
      if (isGroundNode(node) || groundNodes.has(node)) continue
      if (isUnconnectedNode(node)) {
        errors.push(`${device.name} has an unconnected terminal. Connect it or delete the part.`)
        continue
      }
      nodeNames.add(node)
    }
  }

  const sortedNodes = [...nodeNames].sort()
  const nodeIndex = new Map(sortedNodes.map((node, index) => [node, index]))

  // One branch unknown per voltage source and per inductor, in declaration order.
  const branchRows = new Map<string, number>()
  for (const device of devices) {
    if (device.kind === 'voltage-source' || device.kind === 'inductor') {
      branchRows.set(device.name, sortedNodes.length + branchRows.size)
    }
  }

  if (sortedNodes.length === 0 && devices.length > 0 && errors.length === 0) {
    errors.push('Every net is ground — there is nothing to solve.')
  }

  return {
    model: {
      devices,
      nodeNames: sortedNodes,
      nodeIndex,
      branchRows,
      size: sortedNodes.length + branchRows.size,
      groundNodes,
      notes,
    },
    errors,
  }
}

