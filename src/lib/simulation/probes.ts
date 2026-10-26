/**
 * Simulation probes / test points.
 *
 * A probe is a *measurement* derived from a solved circuit — it is never
 * stamped as a device. Two kinds exist:
 *   - `node-voltage`: the voltage of a named net.
 *   - `device-current`: the current through a named device (branch current for
 *     voltage sources / inductors / controlled sources, Ohm's-law for
 *     resistors, etc.).
 *
 * Probe definitions arrive from the schematic (Test Point components) or from
 * a hand-written netlist. They are normalised here and validated against the
 * built circuit model; invalid / missing references surface as notes rather
 * than silent zeros.
 */

export type ProbeKind = 'node-voltage' | 'device-current'

export interface ProbeRequest {
  /** Stable identifier. */
  id: string
  /** Optional human label (defaults to the target). */
  label: string
  kind: ProbeKind
  /** Node name for node-voltage probes. */
  node?: string
  /** Device reference designator for device-current probes. */
  device?: string
}

export interface ProbeResult {
  id: string
  label: string
  kind: ProbeKind
  target: string
  value: number
  unit: 'V' | 'A'
  error?: string
}

/** Raw probe shape as it travels through the netlist. */
export interface RawProbe {
  id?: string
  label?: string
  kind?: string
  measurement?: string
  type?: string
  node?: string
  target?: string
  device?: string
  name?: string
}

const normNode = (name: string): string => (name.trim().toUpperCase() === 'GND' ? '0' : name.trim())

export function normalizeProbeRequest(raw: RawProbe, index: number): { probe?: ProbeRequest; error?: string } {
  const id = (raw.id ?? raw.label ?? raw.target ?? raw.device ?? raw.node ?? `probe_${index + 1}`).toString()
  const label = (raw.label ?? raw.target ?? raw.device ?? raw.node ?? id).toString()
  const kindHint = (raw.kind ?? raw.measurement ?? raw.type ?? '').toString().toLowerCase()
  const isCurrent =
    kindHint.includes('current') ||
    kindHint === 'i' ||
    kindHint === 'device-current' ||
    (raw.device !== undefined && raw.node === undefined)
  const isVoltage =
    kindHint.includes('voltage') || kindHint === 'v' || kindHint === 'node-voltage' || kindHint === 'node'

  if (raw.device !== undefined && (raw.node === undefined || isCurrent)) {
    const device = String(raw.device).trim().toUpperCase()
    if (!device) return { error: `Probe ${id}: missing device reference.` }
    return { probe: { id, label, kind: 'device-current', device } }
  }
  if (raw.node !== undefined || raw.target !== undefined || isVoltage) {
    const nodeRaw = raw.node ?? raw.target ?? raw.name
    if (nodeRaw === undefined) return { error: `Probe ${id}: missing node reference.` }
    const node = normNode(String(nodeRaw))
    if (!node) return { error: `Probe ${id}: missing node reference.` }
    return { probe: { id, label, kind: 'node-voltage', node } }
  }
  if (isCurrent) {
    const device = String(raw.target ?? raw.name ?? '').trim().toUpperCase()
    if (!device) return { error: `Probe ${id}: missing device reference.` }
    return { probe: { id, label, kind: 'device-current', device } }
  }
  return { error: `Probe ${id}: could not determine voltage vs. current measurement.` }
}

export function normalizeProbeRequests(raws: RawProbe[]): { probes: ProbeRequest[]; errors: string[] } {
  const probes: ProbeRequest[] = []
  const errors: string[] = []
  raws.forEach((raw, index) => {
    const result = normalizeProbeRequest(raw, index)
    if (result.error) errors.push(result.error)
    else if (result.probe) probes.push(result.probe)
  })
  return { probes, errors }
}

/** Build a probe from a Test Point component on the schematic. */
export function probeFromTestPoint(component: { name: string; nodes: string[]; parameters?: Record<string, unknown> }): ProbeRequest | null {
  const node = component.nodes[0]
  if (!node) return null
  const params = component.parameters ?? {}
  const device = params.probeDevice ?? params.device ?? params.currentDevice
  if (device) {
    return {
      id: component.name,
      label: component.name,
      kind: 'device-current',
      device: String(device).trim().toUpperCase(),
    }
  }
  return {
    id: component.name,
    label: component.name,
    kind: 'node-voltage',
    node: normNode(node),
  }
}

/**
 * Compute probe measurements given solved node voltages and branch currents.
 */
export function measureProbes(
  model: { devices: Array<{ kind: string; name: string; p: string; n: string; resistance?: number; dcCurrent?: number }>; branchRows: Map<string, number> },
  probes: ProbeRequest[],
  voltages: Map<string, number>,
  branchCurrents: Map<string, number>,
  deviceCurrents?: Map<string, number>,
): ProbeResult[] {
  const v = (node: string): number => voltages.get(node) ?? 0
  const deviceByName = new Map(model.devices.map((d) => [d.name.toUpperCase(), d]))

  return probes.map((probe) => {
    if (probe.kind === 'node-voltage') {
      const node = probe.node ?? ''
      const value = v(node)
      return { id: probe.id, label: probe.label, kind: probe.kind, target: node, value, unit: 'V' }
    }
    const name = (probe.device ?? '').toUpperCase()
    const device = deviceByName.get(name)
    if (!device) {
      return { id: probe.id, label: probe.label, kind: probe.kind, target: name, value: 0, unit: 'A', error: `Unknown device ${name}.` }
    }
    const rowCurrent = branchCurrents.get(name) ?? branchCurrents.get(device.name)
    if (rowCurrent !== undefined) {
      return { id: probe.id, label: probe.label, kind: probe.kind, target: name, value: rowCurrent, unit: 'A' }
    }
    const solvedCurrent = deviceCurrents?.get(name) ?? deviceCurrents?.get(device.name)
    if (solvedCurrent !== undefined) {
      return { id: probe.id, label: probe.label, kind: probe.kind, target: name, value: solvedCurrent, unit: 'A' }
    }
    if (device.kind === 'resistor' && typeof device.resistance === 'number' && device.resistance !== 0) {
      const current = (v(device.p) - v(device.n)) / device.resistance
      return { id: probe.id, label: probe.label, kind: probe.kind, target: name, value: current, unit: 'A' }
    }
    if (device.kind === 'current-source') {
      const dc = device.dcCurrent ?? 0
      return { id: probe.id, label: probe.label, kind: probe.kind, target: name, value: dc, unit: 'A' }
    }
    return { id: probe.id, label: probe.label, kind: probe.kind, target: name, value: 0, unit: 'A', error: `Device ${name} (${device.kind}) has no measurable branch current in this solver.` }
  })
}
