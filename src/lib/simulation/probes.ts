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
 * built circuit model. A reference that does not resolve to a solved net or a
 * measurable device is returned as a failed measurement with `value: null` and
 * a message naming the reference — never as a zero.
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
  /**
   * The measured value, or `null` when nothing was measured. A failed probe
   * never carries a stand-in number: `0` is a legitimate reading, so leaving it
   * in place on failure would make "unknown node" and "0 V node" identical.
   */
  value: number | null
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
 * The slice of the circuit model a measurement needs. `CircuitModel` satisfies
 * it structurally; importing the type here would cycle with `circuitModel.ts`,
 * which imports this module.
 */
export interface ProbeModel {
  devices: Array<{
    kind: string
    name: string
    p: string
    n: string
    resistance?: number
    dcCurrent?: number
  }>
  branchRows: Map<string, number>
  /** Non-ground net names the model was built with. */
  nodeNames: readonly string[]
  /** Every net name that is ground, including aliases found on devices. */
  groundNodes: ReadonlySet<string>
}

type Read = { value: number } | { error: string }

/**
 * Compute probe measurements given solved node voltages and branch currents.
 *
 * A node the solver never reported — a typo'd net, a net that dropped out of
 * this analysis, a model-internal tap — is reported as a failure naming that
 * net. Answering `0 V` there (as `voltages.get(node) ?? 0` did) is a wrong
 * answer, not a missing one: it is indistinguishable from a genuinely grounded
 * or discharged net on the readout.
 */
export function measureProbes(
  model: ProbeModel,
  probes: ProbeRequest[],
  voltages: Map<string, number>,
  branchCurrents: Map<string, number>,
  deviceCurrents?: Map<string, number>,
): ProbeResult[] {
  /*
   * Ground is 0 V by definition and is excluded from the reported operating
   * point, so it is a known read rather than a missing one.
   */
  const solved = new Map<string, number>()
  for (const [name, value] of voltages) solved.set(name.toUpperCase(), value)
  const knownNets = new Set<string>(model.nodeNames.map((name) => name.toUpperCase()))
  const grounds = new Set<string>(['0', 'GND'])
  for (const name of model.groundNodes) grounds.add(name.toUpperCase())

  const v = (node: string): Read => {
    const name = node.trim().toUpperCase()
    if (!name) return { error: 'Probe has no node name.' }
    if (grounds.has(name)) return { value: 0 }
    const measured = solved.get(name)
    if (measured !== undefined) return { value: measured }
    return {
      error: knownNets.has(name)
        ? `Node "${node}" is a net of this circuit but this analysis reports no voltage for it ` +
          '(an analysis without an operating point, or a model-internal node that is not a schematic net).'
        : `Unknown node "${node}": it is not a net in this circuit, so no voltage can be measured there.`,
    }
  }

  const deviceByName = new Map(model.devices.map((d) => [d.name.toUpperCase(), d]))

  return probes.map((probe) => {
    if (probe.kind === 'node-voltage') {
      const node = probe.node ?? ''
      const base = { id: probe.id, label: probe.label, kind: probe.kind, target: node, unit: 'V' as const }
      const read = v(node)
      return 'error' in read ? { ...base, value: null, error: read.error } : { ...base, value: read.value }
    }
    const name = (probe.device ?? '').toUpperCase()
    const fail = (error: string): ProbeResult => ({
      id: probe.id,
      label: probe.label,
      kind: probe.kind,
      target: name,
      value: null,
      unit: 'A',
      error,
    })
    const device = deviceByName.get(name)
    if (!device) return fail(`Unknown device ${name}.`)
    const rowCurrent = branchCurrents.get(name) ?? branchCurrents.get(device.name)
    if (rowCurrent !== undefined) {
      return { id: probe.id, label: probe.label, kind: probe.kind, target: name, value: rowCurrent, unit: 'A' }
    }
    const solvedCurrent = deviceCurrents?.get(name) ?? deviceCurrents?.get(device.name)
    if (solvedCurrent !== undefined) {
      return { id: probe.id, label: probe.label, kind: probe.kind, target: name, value: solvedCurrent, unit: 'A' }
    }
    if (device.kind === 'resistor' && typeof device.resistance === 'number' && device.resistance !== 0) {
      const high = v(device.p)
      if ('error' in high) return fail(`Cannot measure ${name}: ${high.error}`)
      const low = v(device.n)
      if ('error' in low) return fail(`Cannot measure ${name}: ${low.error}`)
      return {
        id: probe.id,
        label: probe.label,
        kind: probe.kind,
        target: name,
        value: (high.value - low.value) / device.resistance,
        unit: 'A',
      }
    }
    if (device.kind === 'current-source') {
      const dc = device.dcCurrent ?? 0
      return { id: probe.id, label: probe.label, kind: probe.kind, target: name, value: dc, unit: 'A' }
    }
    return fail(`Device ${name} (${device.kind}) has no measurable branch current in this solver.`)
  })
}
