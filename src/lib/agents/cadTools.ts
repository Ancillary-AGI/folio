/**
 * CAD tools for agents — the same actions a human performs on the sheet.
 *
 * Every tool reads and commits through a `CadRuntime`, and every mutation
 * returns a fresh observation: canonical nets, terminal coordinates, and an
 * SVG of the sheet. That is the closed loop made concrete — an agent cannot
 * claim a change worked unless the next observation shows it, and a
 * simulation result is tied to the exact design fingerprint it was solved on.
 *
 * Parameter names are deliberately flat (the harness validates primitive
 * types). Structured inputs travel as JSON strings and are parsed with a
 * message naming the offending field, never silently ignored.
 */
import type { AgentHarness, AgentTool } from './agentHarness'
import type { Component } from '../supabase'
import { spiceEngine, type CircuitNetlist, type SimulationParameters, type SimulationResult } from '../simulation/spiceEngine'
import { buildCircuitNetlist } from '../simulation/netlistBuilder'
import { summarizeWaveforms, findWaveform, statisticValue, type WaveformSummary } from '../simulation/waveformStats'
import { parseSpiceValue } from '../simulation/devices'
import { assessDesignMargins, type DesignMarginReport } from '../electronics/designMargins'
import { verifySchematic } from './schematicVerification'
import {
  captureDesignSnapshot,
  designFingerprint,
  schematicToSvg,
  waveformToSvg,
  type DesignSnapshot,
} from './designSnapshot'
import {
  autoPlace,
  findComponentByReference,
  findLibrarySymbol,
  listLibrarySymbols,
  nearestTapPoint,
  netOnTerminal,
  newComponentId,
  newWireId,
  nextReference,
  pinWorldPosition,
  referencePrefixFor,
  resolveTerminal,
  terminalLabel,
  type CadRuntime,
} from './cadRuntime'
import { routePoints } from '../schematic/wireRouting'
import type { CanvasComponent, CanvasWire } from '../../stores/useProjectStore'

type Args = Record<string, string | number | boolean>

const str = (args: Args, key: string, label = key): string => {
  const value = args[key]
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string.`)
  return value.trim()
}

const optionalStr = (args: Args, key: string): string | undefined => {
  const value = args[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`${key} must be a string.`)
  return value.trim() === '' ? undefined : value.trim()
}

const num = (args: Args, key: string, label = key): number => {
  const value = args[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a finite number.`)
  return value
}

const optionalNum = (args: Args, key: string): number | undefined => {
  const value = args[key]
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${key} must be a finite number.`)
  return value
}

const bool = (args: Args, key: string, fallback: boolean): boolean => {
  const value = args[key]
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw new Error(`${key} must be a boolean.`)
  return value
}

const jsonObject = (args: Args, key: string): Record<string, unknown> => {
  const raw = args[key]
  if (raw === undefined) return {}
  if (typeof raw !== 'string') throw new Error(`${key} must be a JSON object string.`)
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`${key} is not valid JSON.`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${key} must be a JSON object.`)
  }
  return parsed as Record<string, unknown>
}

const scalarProperties = (raw: Record<string, unknown>, label: string): Record<string, string | number | boolean> => {
  const properties: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      properties[key] = value
    } else {
      throw new Error(`${label}.${key} must be a string, number, or boolean.`)
    }
  }
  return properties
}

const normaliseRotation = (value: number): number => ((value % 360) + 360) % 360

const terminalSummary = (component: CanvasComponent): Array<{
  ref: string
  id: string
  name: string
  type: string
  x: number
  y: number
}> =>
  component.component.pins.map((pin) => {
    const world = pinWorldPosition(component, pin)
    return {
      ref: terminalLabel(component, pin),
      id: pin.id,
      name: pin.name,
      type: pin.type,
      x: Math.round(world.x * 100) / 100,
      y: Math.round(world.y * 100) / 100,
    }
  })

const componentSummary = (component: CanvasComponent) => ({
  reference: component.reference,
  part: component.component.name,
  category: component.component.category,
  value: String(component.properties['value'] ?? component.properties['type'] ?? ''),
  x: component.x,
  y: component.y,
  rotation: component.rotation,
  properties: { ...component.properties },
  terminals: terminalSummary(component),
})

export interface CadObservation {
  fingerprint: string
  stats: DesignSnapshot['stats']
  components: Array<ReturnType<typeof componentSummary>>
  nets: DesignSnapshot['nets']
  issues: string[]
  schematicSvg: string
}

/** Shape of `cad.simulate`'s result (tool handlers return `unknown`). */
export interface CadSimulationOutput {
  success: true
  analysis: SimulationParameters['type']
  fingerprint: string
  parameters: SimulationParameters
  operatingPoint?: Record<string, number>
  branchCurrents?: Record<string, number>
  deviceCurrents?: Record<string, number>
  probes?: SimulationResult['probes']
  notes: string[]
  warnings: string[]
  convergence?: SimulationResult['convergenceInfo']
  waveforms: WaveformSummary[]
  scope: string[]
  waveformSvg: string
}

/** Shape of `cad.assess`'s result. */
export interface CadAssessmentOutput {
  fingerprint: string
  analysis: SimulationParameters['type']
  status: { ok: number; warn: number; fail: number }
  worst?: DesignMarginReport['worst']
  limitingFactor?: string
  hottest?: DesignMarginReport['hottest']
  power: DesignMarginReport['power']
  coverage: DesignMarginReport['coverage']
  items: DesignMarginReport['items']
  measurements: DesignMarginReport['measurements']
  assumptions: string[]
  notes: string[]
  headline: string
}

export interface CadErcOutput {
  fingerprint: string
  passed: boolean
  errors: Array<{ severity: string; code: string; message: string; components: string[]; net?: string }>
  warnings: Array<{ severity: string; code: string; message: string; components: string[]; net?: string }>
  metrics: { nodeCount: number; pinCount: number; powerNets: string[]; groundNets: string[] }
  unconnectedTerminals: string[]
}

function observe(runtime: CadRuntime, options: { includeSvg?: boolean } = {}): CadObservation {
  const design = runtime.read()
  const snapshot = captureDesignSnapshot(design.components, design.wires, { firmware: design.firmware })
  return {
    fingerprint: designFingerprint(snapshot),
    stats: snapshot.stats,
    components: design.components.map(componentSummary),
    nets: snapshot.nets,
    issues: snapshot.issues,
    schematicSvg: options.includeSvg === false ? '' : schematicToSvg(snapshot),
  }
}

const changed = (runtime: CadRuntime, message: string, extra: Record<string, unknown> = {}) => ({
  message,
  ...observe(runtime),
  ...extra,
})

/* ------------------------------------------------------------------ *
 * Mutations
 * ------------------------------------------------------------------ */

const VALUE_KEYS = new Set([
  'value', 'vo', 'va', 'freq', 'phase', 'td', 'tr', 'tf', 'pw', 'per', 'v1', 'v2',
  'vbr', 'is', 'n', 'rs', 'cjo', 'tt', 'ic', 'vceo', 'vds', 'id', 'pd', 'icmax',
  'l', 'c', 'r', 'theta_ja', 'thetaja', 'tolerance', 'gain', 'rload', 'vcc',
])

function addPart(runtime: CadRuntime, args: Args): unknown {
  const symbolName = str(args, 'symbol')
  const symbol = findLibrarySymbol(symbolName)
  const design = runtime.read()
  const reference = optionalStr(args, 'reference')
    ?? nextReference(design.components, referencePrefixFor(symbol.name))

  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(reference)) {
    throw new Error(`reference "${reference}" must start with a letter and contain only letters, digits, or underscores.`)
  }
  if (findComponentByReference(design.components, reference)) {
    throw new Error(`Reference ${reference} is already used on this sheet.`)
  }
  if (symbol.pins.length === 0) throw new Error(`${symbol.name} has no terminals and cannot be placed as a part.`)

  const supplied = scalarProperties(jsonObject(args, 'properties'), 'properties')
  const properties = { ...symbol.default_properties, ...supplied }
  const position = optionalNum(args, 'x') !== undefined || optionalNum(args, 'y') !== undefined
    ? { x: num(args, 'x', 'x'), y: num(args, 'y', 'y') }
    : autoPlace(design.components, symbol)

  const component: CanvasComponent = {
    id: newComponentId(),
    componentId: symbol.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    component: {
      ...symbol,
      pins: symbol.pins.map((pin) => ({ ...pin })),
      symbol_data: { ...symbol.symbol_data, paths: [...symbol.symbol_data.paths] },
      default_properties: { ...symbol.default_properties },
    } as Component,
    x: Math.round(position.x),
    y: Math.round(position.y),
    rotation: normaliseRotation(optionalNum(args, 'rotation') ?? 0),
    reference,
    properties,
    visible: true,
  }

  runtime.commit({
    components: [...design.components, component],
    wires: design.wires,
  })
  return changed(runtime, `Added ${reference} (${symbol.name}).`, { added: componentSummary(component) })
}

function removePart(runtime: CadRuntime, args: Args): unknown {
  const reference = str(args, 'reference')
  const design = runtime.read()
  const component = findComponentByReference(design.components, reference)
  if (!component) throw new Error(`No component "${reference}" on the sheet.`)
  const removedWires = design.wires.filter((wire) =>
    wire.connectedPins.some((pin) => pin.componentId === component.id),
  )
  runtime.commit({
    components: design.components.filter((candidate) => candidate.id !== component.id),
    wires: design.wires.filter((wire) => !removedWires.includes(wire)),
  })
  return changed(runtime, `Removed ${component.reference}; ${removedWires.length} wire(s) went with it.`, {
    removedWires: removedWires.map((wire) => wire.id),
  })
}

function movePart(runtime: CadRuntime, args: Args): unknown {
  const reference = str(args, 'reference')
  const design = runtime.read()
  const component = findComponentByReference(design.components, reference)
  if (!component) throw new Error(`No component "${reference}" on the sheet.`)
  const x = num(args, 'x')
  const y = num(args, 'y')
  const rotation = optionalNum(args, 'rotation')
  runtime.commit({
    components: design.components.map((candidate) =>
      candidate.id === component.id
        ? { ...candidate, x, y, rotation: rotation === undefined ? candidate.rotation : normaliseRotation(rotation) }
        : candidate,
    ),
    wires: design.wires,
  })
  return changed(runtime, `Moved ${component.reference} to (${x}, ${y})${rotation === undefined ? '' : ` rotated ${normaliseRotation(rotation)}°`}.`)
}

function setProperty(runtime: CadRuntime, args: Args): unknown {
  const reference = str(args, 'reference')
  const property = str(args, 'property')
  const rawValue = args['value']
  if (typeof rawValue !== 'string' && typeof rawValue !== 'number' && typeof rawValue !== 'boolean') {
    throw new Error('value must be a string, number, or boolean.')
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(property)) throw new Error(`property "${property}" is not a valid name.`)
  const design = runtime.read()
  const component = findComponentByReference(design.components, reference)
  if (!component) throw new Error(`No component "${reference}" on the sheet.`)

  let value = rawValue
  if (VALUE_KEYS.has(property.toLowerCase()) && typeof value === 'string') {
    // Validate now, naming the part; otherwise the failure surfaces deep in the
    // netlist builder after the agent has already moved on.
    parseSpiceValue(value, `${reference}.${property}`)
    value = value.trim()
  } else if (typeof value === 'string') {
    value = value.trim()
  }

  runtime.commit({
    components: design.components.map((candidate) =>
      candidate.id === component.id
        ? { ...candidate, properties: { ...candidate.properties, [property]: value } }
        : candidate,
    ),
    wires: design.wires,
  })
  return changed(runtime, `Set ${reference}.${property} = ${String(value)}.`, {
    property: { reference, key: property, value },
  })
}

function connect(runtime: CadRuntime, args: Args): unknown {
  const fromToken = str(args, 'from')
  const toToken = str(args, 'to')
  const explicitNet = optionalStr(args, 'netName')
  const design = runtime.read()
  const from = resolveTerminal(design.components, fromToken)
  const fromWorld = pinWorldPosition(from.component, from.pin)
  const fromNet = netOnTerminal(design.wires, from.component.id, from.pin.id)

  let toWorld: { x: number; y: number }
  let toPin: { componentId: string; pinId: string } | undefined
  let toComponent: CanvasComponent | undefined
  let tapWire: string | undefined
  let toNet: string | undefined

  if (/^net:/i.test(toToken)) {
    const net = toToken.slice(4).trim()
    if (!net) throw new Error('to="net:<name>" needs a net name, e.g. net:GND.')
    const tap = nearestTapPoint(design.wires, net, fromWorld)
    if (!tap) {
      const nets = [...new Set(design.wires.map((wire) => wire.netName).filter(Boolean))]
      throw new Error(
        `No wire carries net "${net}".${nets.length ? ` Existing named nets: ${nets.join(', ')}.` : ' Name a net first with cad.connect.'}`,
      )
    }
    toWorld = tap.point
    tapWire = tap.wireId
    toNet = net
  } else {
    const to = resolveTerminal(design.components, toToken)
    if (to.component.id === from.component.id && to.pin.id === from.pin.id) {
      throw new Error('A terminal cannot connect to itself.')
    }
    toWorld = pinWorldPosition(to.component, to.pin)
    toPin = { componentId: to.component.id, pinId: to.pin.id }
    toComponent = to.component
    toNet = netOnTerminal(design.wires, to.component.id, to.pin.id)
  }

  const groundSymbol = (component: CanvasComponent | undefined): boolean =>
    component !== undefined && /ground/i.test(component.component.name)
  const fromGround = groundSymbol(from.component)
  const toGround = groundSymbol(toComponent)
  const groundAlias = /^(0|gnd|ground)$/i
  if (fromGround !== toGround) {
    // Connecting a named signal net to the ground symbol is a short. Refuse it
    // loudly; a human can still draw it deliberately on the canvas.
    const signalNet = fromGround ? toNet : fromNet
    if (signalNet && !groundAlias.test(signalNet)) {
      throw new Error(
        `Refusing to connect ${signalNet} to the ground symbol: that shorts the net to 0 V.`,
      )
    }
  }

  if (fromNet && toNet && fromNet.toLowerCase() !== toNet.toLowerCase()) {
    throw new Error(
      `Refusing to connect ${fromToken} (net ${fromNet}) to ${toToken} (net ${toNet}): that shorts two named nets. Rename one net first.`,
    )
  }
  if (explicitNet && fromNet && explicitNet.toLowerCase() !== fromNet.toLowerCase()) {
    throw new Error(`${fromToken} is already on net ${fromNet}; cannot also name it ${explicitNet}.`)
  }
  // A ground symbol without a name would netlist as an anonymous net, leaving
  // the circuit without a 0 V reference. Grounding a terminal names the net.
  const netName = explicitNet ?? fromNet ?? toNet ?? ((fromGround || toGround) ? 'GND' : undefined)
  const targetNet = tapWire ? toNet : undefined
  if (targetNet && fromNet && targetNet.toLowerCase() === fromNet.toLowerCase()) {
    return changed(runtime, `${fromToken} is already on net ${targetNet}; no wire added.`, {
      unchanged: true,
      netName: targetNet,
    })
  }

  if (toPin) {
    const existing = design.wires.find((wire) => {
      if (wire.connectedPins.length !== 2) return false
      const [a, b] = wire.connectedPins
      return (
        (a.componentId === from.component.id && a.pinId === from.pin.id && b.componentId === toPin!.componentId && b.pinId === toPin!.pinId)
        || (b.componentId === from.component.id && b.pinId === from.pin.id && a.componentId === toPin!.componentId && a.pinId === toPin!.pinId)
      )
    })
    if (existing) {
      return changed(runtime, `${fromToken} is already connected to ${toToken} (wire ${existing.id}).`, {
        wireId: existing.id,
        unchanged: true,
      })
    }
  }

  // Route around terminals and existing wire ends. A plain L can pass through
  // a part's other pin and silently join it (the netlister unions an endpoint
  // that lands on a segment).
  const obstacles = [
    ...design.components.flatMap((component) =>
      component.component.pins.map((pin) => pinWorldPosition(component, pin)),
    ),
    ...design.wires.flatMap((wire) => {
      const first = wire.points[0]
      const last = wire.points[wire.points.length - 1]
      return [first, last].filter((point): point is { x: number; y: number } => point !== undefined)
    }),
  ]
  const points = routePoints(fromWorld, toWorld, obstacles)
  const wire: CanvasWire = {
    id: newWireId(),
    netName,
    points,
    connectedPins: [
      { componentId: from.component.id, pinId: from.pin.id },
      ...(toPin ? [toPin] : []),
    ],
  }
  // A tap adds a dot where it meets the rail; the netlister resolves the
  // T-junction by geometry, and the shared net name makes the intent explicit.
  runtime.commit({
    components: design.components,
    wires: [...design.wires, wire],
  })
  return changed(
    runtime,
    `Connected ${fromToken} to ${toToken}${netName ? ` on net ${netName}` : ''}.`,
    {
      connection: {
        wireId: wire.id,
        netName,
        points,
        tappedWire: tapWire,
      },
    },
  )
}

function disconnect(runtime: CadRuntime, args: Args): unknown {
  const fromToken = str(args, 'from')
  const toToken = optionalStr(args, 'to')
  const design = runtime.read()
  const from = resolveTerminal(design.components, fromToken)
  const to = toToken ? resolveTerminal(design.components, toToken) : undefined
  const removed: string[] = []
  const wires: CanvasWire[] = []

  for (const wire of design.wires) {
    const hasFrom = wire.connectedPins.some((pin) => pin.componentId === from.component.id && pin.pinId === from.pin.id)
    if (!hasFrom) {
      wires.push(wire)
      continue
    }
    if (to) {
      const hasTo = wire.connectedPins.some((pin) => pin.componentId === to.component.id && pin.pinId === to.pin.id)
      if (!hasTo) {
        wires.push(wire)
        continue
      }
    }
    removed.push(wire.id)
    // Only the terminal named in `from` is disconnected. On a shared rail the
    // other pins (including `to`, used just to pick the wire) stay connected.
    const remaining = wire.connectedPins.filter(
      (pin) => !(pin.componentId === from.component.id && pin.pinId === from.pin.id),
    )
    if (remaining.length === 0) continue
    // Trim a now-dangling endpoint so the remaining rail does not point at a
    // terminal it no longer connects to.
    const points = [...wire.points]
    const fromWorld = pinWorldPosition(from.component, from.pin)
    const endsAt = (point: { x: number; y: number }) =>
      Math.abs(point.x - fromWorld.x) < 0.5 && Math.abs(point.y - fromWorld.y) < 0.5
    while (points.length > 2 && endsAt(points[points.length - 1])) points.pop()
    while (points.length > 2 && endsAt(points[0])) points.shift()
    wires.push({ ...wire, points, connectedPins: remaining })
  }

  if (removed.length === 0) {
    throw new Error(`No wire connects ${fromToken}${toToken ? ` to ${toToken}` : ''}.`)
  }
  runtime.commit({ components: design.components, wires })
  return changed(runtime, `Disconnected ${fromToken}${toToken ? ` from ${toToken}` : ''} (${removed.length} wire(s)).`, {
    removedWires: removed,
  })
}

function nameNet(runtime: CadRuntime, args: Args): unknown {
  const token = str(args, 'terminal')
  const name = str(args, 'name')
  if (!/^[A-Za-z0-9_+-]+$/.test(name)) {
    throw new Error('Net names may contain letters, digits, underscores, +, and -.')
  }
  const design = runtime.read()
  const terminal = resolveTerminal(design.components, token)
  const touching = design.wires.filter((wire) =>
    wire.connectedPins.some((pin) => pin.componentId === terminal.component.id && pin.pinId === terminal.pin.id),
  )
  if (touching.length === 0) throw new Error(`${token} has no wire to name. Connect it first.`)
  const conflicts = touching.filter(
    (wire) => wire.netName && wire.netName.toLowerCase() !== name.toLowerCase(),
  )
  if (conflicts.length > 0) {
    throw new Error(
      `${token} also touches net ${conflicts.map((wire) => wire.netName).join(', ')}; renaming would merge them silently. Disconnect that wire first.`,
    )
  }
  const wireIds = new Set(touching.map((wire) => wire.id))
  runtime.commit({
    components: design.components,
    wires: design.wires.map((wire) => (wireIds.has(wire.id) ? { ...wire, netName: name } : wire)),
  })
  return changed(runtime, `Named the net at ${token} "${name}".`, { netName: name, wireIds: [...wireIds] })
}

/* ------------------------------------------------------------------ *
 * Simulation and measurement
 * ------------------------------------------------------------------ */

const ANALYSIS_TYPES = new Set(['dc', 'dc-sweep', 'transient', 'ac', 'noise', 'montecarlo'])

function simulationParameters(args: Args): SimulationParameters {
  const analysis = str(args, 'analysis').toLowerCase()
  if (!ANALYSIS_TYPES.has(analysis)) {
    throw new Error(`analysis must be one of ${[...ANALYSIS_TYPES].join(', ')}.`)
  }
  const supplied = jsonObject(args, 'parameters') as Record<string, unknown>
  const merged: Record<string, unknown> = { ...supplied, type: analysis }
  const numeric = [
    'startTime', 'stopTime', 'stepTime', 'startFreq', 'stopFreq', 'pointsPerDecade',
    'temperature', 'sweepStart', 'sweepStop', 'sweepStep', 'iterations', 'tolerance', 'seed',
  ]
  for (const key of numeric) {
    const value = merged[key]
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) {
      throw new Error(`parameters.${key} must be a finite number.`)
    }
  }
  if (analysis === 'transient') {
    merged['stopTime'] ??= 20e-3
    merged['stepTime'] ??= 20e-6
  }
  if (analysis === 'ac' || analysis === 'noise') {
    merged['startFreq'] ??= 10
    merged['stopFreq'] ??= 1e6
    merged['pointsPerDecade'] ??= 20
  }
  if (analysis === 'dc-sweep') {
    merged['sweepSource'] ??= 'V1'
    merged['sweepStart'] ??= 0
    merged['sweepStop'] ??= 5
    merged['sweepStep'] ??= 0.1
  }
  if (analysis === 'montecarlo') {
    merged['iterations'] ??= 100
    merged['tolerance'] ??= 0.05
    merged['seed'] ??= 1
  }
  for (const key of ['integrationMethod', 'outputNode', 'sweepSource']) {
    const value = merged[key]
    if (value !== undefined && typeof value !== 'string') throw new Error(`parameters.${key} must be a string.`)
  }
  if (merged['useInitialConditions'] !== undefined && typeof merged['useInitialConditions'] !== 'boolean') {
    throw new Error('parameters.useInitialConditions must be a boolean.')
  }
  return merged as unknown as SimulationParameters
}

const SCOPE_PRIORITY = [/out/i, /in/i, /^V\(/, /^I\(/]

function pickScopeTraces(result: SimulationResult): SimulationResult['waveforms'] {
  const rank = (name: string): number => {
    for (let index = 0; index < SCOPE_PRIORITY.length; index++) {
      if (SCOPE_PRIORITY[index].test(name)) return index
    }
    return SCOPE_PRIORITY.length
  }
  return [...result.waveforms].sort((a, b) => rank(a.name) - rank(b.name)).slice(0, 6)
}

async function runAndCache(
  runtime: CadRuntime,
  args: Args,
  parameters: SimulationParameters,
  fingerprint: string,
  netlist: CircuitNetlist,
): Promise<unknown> {
  const validation = await spiceEngine.validateNetlist(netlist)
  if (!validation.isValid) {
    throw new Error(`The circuit cannot be simulated yet: ${validation.errors.join(' ')}`)
  }
  const result = await spiceEngine.simulate(netlist)
  if (!result.success) {
    throw new Error(`Simulation failed: ${result.error ?? 'the solver did not converge.'}`)
  }
  runtime.cacheSimulation({ fingerprint, analysis: parameters.type, parameters, netlist, result })

  const includeSamples = bool(args, 'includeWaveforms', false)
  const maxPoints = optionalNum(args, 'maxPoints') ?? 120
  const summaries: WaveformSummary[] = summarizeWaveforms(result, {
    includeSamples,
    maxPoints,
    // A transient's settled tail separates design behaviour from startup.
    settledFraction: result.analysis === 'transient' ? 0.5 : undefined,
  })
  const scope = pickScopeTraces(result)
  return {
    success: true,
    analysis: parameters.type,
    fingerprint,
    parameters,
    operatingPoint: result.operatingPoint,
    branchCurrents: result.branchCurrents,
    deviceCurrents: result.deviceCurrents,
    probes: result.probes,
    notes: result.notes ?? [],
    warnings: validation.warnings,
    convergence: result.convergenceInfo,
    waveforms: summaries,
    scope: scope.map((wave) => wave.name),
    waveformSvg: waveformToSvg(
      scope.map((wave) => ({ name: wave.name, unit: wave.unit, data: wave.data })),
      { maxPoints: 1200 },
    ),
  }
}

function assess(runtime: CadRuntime, args: Args): unknown {
  const design = runtime.read()
  const snapshot = captureDesignSnapshot(design.components, design.wires, { firmware: design.firmware })
  const fingerprint = designFingerprint(snapshot)
  const cached = runtime.lastSimulation()
  if (!cached) {
    throw new Error('No simulation result yet. Run cad.simulate on this design first; margins are always measured, never guessed.')
  }
  if (cached.fingerprint !== fingerprint) {
    throw new Error('The design changed since the last simulation. Run cad.simulate again so ratings compare against the current circuit.')
  }
  const ambientCelsius = optionalNum(args, 'ambientCelsius')
  const thetaJaOverride = optionalNum(args, 'thetaJa')
  const report = assessDesignMargins(snapshot, cached.result, { ambientCelsius, thetaJaOverride })
  const status = { ok: 0, warn: 0, fail: 0 }
  for (const item of report.items) status[item.status] += 1
  return {
    fingerprint,
    analysis: cached.analysis,
    status,
    worst: report.worst,
    limitingFactor: report.limitingFactor,
    hottest: report.hottest,
    power: report.power,
    coverage: report.coverage,
    items: report.items,
    measurements: report.measurements,
    assumptions: report.assumptions,
    notes: report.notes,
    /** The single sentence a dashboard should lead with. */
    headline: report.limitingFactor
      ? report.limitingFactor
      : report.items.length > 0
        ? 'Every declared rating is inside its limit.'
        : 'No ratings were declared for this circuit, so no margin claim can be made.',
  }
}

function erc(runtime: CadRuntime): unknown {
  const design = runtime.read()
  const snapshot = captureDesignSnapshot(design.components, design.wires, { firmware: design.firmware })
  let verification
  try {
    verification = verifySchematic(design.components, design.wires)
  } catch (error) {
    return {
      fingerprint: designFingerprint(snapshot),
      passed: false,
      errors: [{
        severity: 'error',
        code: 'ERC_NETLIST',
        message: error instanceof Error ? error.message : String(error),
        components: [],
      }],
      warnings: [],
      metrics: { nodeCount: 0, pinCount: 0, powerNets: [], groundNets: [] },
      unconnectedTerminals: snapshot.components.flatMap((component) =>
        component.pins.filter((pin) => !pin.connected).map((pin) => pin.ref),
      ),
    }
  }
  return {
    fingerprint: designFingerprint(snapshot),
    ...verification,
    unconnectedTerminals: snapshot.components.flatMap((component) =>
      component.pins.filter((pin) => !pin.connected).map((pin) => pin.ref),
    ),
  }
}

function exportNetlist(runtime: CadRuntime, args: Args): unknown {
  const format = (optionalStr(args, 'format') ?? 'spice').toLowerCase()
  if (format !== 'spice' && format !== 'json') throw new Error('format must be "spice" or "json".')
  const design = runtime.read()
  const netlist = buildCircuitNetlist('Agent export', design.components, design.wires, { type: 'dc' })
  return {
    format,
    deck: format === 'spice' ? spiceEngine.generateSPICENetlist(netlist) : undefined,
    netlist: format === 'json' ? netlist : undefined,
  }
}

/* ------------------------------------------------------------------ *
 * Registry
 * ------------------------------------------------------------------ */

export interface CadToolset {
  tools: AgentTool[]
  invoke(name: string, args?: Args): Promise<unknown>
}

/**
 * Build the tool surface over a runtime.
 *
 * `invoke` runs a handler directly (no approval/budget) so the deterministic
 * autopilot can use exactly the same actions the agent does; agent loops go
 * through `AgentHarness` for budgeting and audit.
 */
export function createCadToolset(runtime: CadRuntime): CadToolset {
  const tools: AgentTool[] = [
    {
      name: 'cad.observe',
      description:
        'See the whole sheet: components with terminal coordinates and canonical nets, unconnected terminals, and an SVG. Call this before and after every change.',
      parameters: { includeSvg: 'boolean' },
      optionalParameters: ['includeSvg'],
      needsApproval: false,
      handler: (args) => observe(runtime, { includeSvg: bool(args, 'includeSvg', true) }),
    },
    {
      name: 'cad.listLibrary',
      description:
        'List placeable symbols and their terminals. Filter by name/alias (e.g. "mosfet"); includePins adds terminal ids and defaults.',
      parameters: { filter: 'string', includePins: 'boolean' },
      optionalParameters: ['filter', 'includePins'],
      needsApproval: false,
      handler: (args) => {
        const filter = optionalStr(args, 'filter')?.toLowerCase()
        const includePins = bool(args, 'includePins', false)
        const entries = listLibrarySymbols()
          .filter((entry) =>
            !filter
            || entry.name.toLowerCase().includes(filter)
            || entry.aliases.some((alias) => alias.includes(filter))
            || entry.category.toLowerCase().includes(filter),
          )
          .map((entry) => ({
            name: entry.name,
            category: entry.category,
            aliases: entry.aliases,
            pinCount: entry.pins.length,
            ...(includePins ? { pins: entry.pins, defaults: entry.defaults } : {}),
          }))
        return { count: entries.length, symbols: entries }
      },
    },
    {
      name: 'cad.addPart',
      description:
        'Place a library part. symbol is a name or alias (Resistor, Capacitor, Sine Voltage Source, N-MOSFET…). properties is a JSON object merged over defaults; x/y are schematic pixels (auto-placed when omitted).',
      parameters: {
        symbol: 'string', reference: 'string', x: 'number', y: 'number', rotation: 'number', properties: 'string',
      },
      optionalParameters: ['reference', 'x', 'y', 'rotation', 'properties'],
      needsApproval: false,
      handler: (args) => addPart(runtime, args),
    },
    {
      name: 'cad.removePart',
      description: 'Delete a part and every wire attached to it. Returns the new sheet; the change is undoable.',
      parameters: { reference: 'string' },
      needsApproval: false,
      handler: (args) => removePart(runtime, args),
    },
    {
      name: 'cad.movePart',
      description: 'Move/rotate a part (schematic pixels, degrees clockwise). Wires keep their geometry; re-route if terminals moved.',
      parameters: { reference: 'string', x: 'number', y: 'number', rotation: 'number' },
      optionalParameters: ['rotation'],
      needsApproval: false,
      handler: (args) => movePart(runtime, args),
    },
    {
      name: 'cad.setProperty',
      description:
        'Set one component property, e.g. R1 value "100" or "10k", V1 va "12V", C1 footprint "1206", D1 vbr "40V". Numeric properties are parsed and rejected if malformed.',
      parameters: { reference: 'string', property: 'string', value: 'string' },
      needsApproval: false,
      handler: (args) => setProperty(runtime, args),
    },
    {
      name: 'cad.connect',
      description:
        'Wire two terminals (`R1.1`, `D1.A`, `Q1.collector`) with an orthogonal wire. to may be `net:GND` to tap the nearest point on a named net. Optional netName names the new net.',
      parameters: { from: 'string', to: 'string', netName: 'string' },
      optionalParameters: ['netName'],
      needsApproval: false,
      handler: (args) => connect(runtime, args),
    },
    {
      name: 'cad.disconnect',
      description: 'Remove the wire(s) between two terminals, or every wire on `from` when `to` is omitted. Keeps shared rails intact.',
      parameters: { from: 'string', to: 'string' },
      optionalParameters: ['to'],
      needsApproval: false,
      handler: (args) => disconnect(runtime, args),
    },
    {
      name: 'cad.nameNet',
      description: 'Name the net attached to a terminal (e.g. terminal "D1.A", name "MID"). Refuses to merge two differently named nets silently.',
      parameters: { terminal: 'string', name: 'string' },
      needsApproval: false,
      handler: (args) => nameNet(runtime, args),
    },
    {
      name: 'cad.simulate',
      description:
        'Build the netlist from the live sheet and solve it. analysis: dc | dc-sweep | transient | ac | noise | montecarlo. parameters is a JSON object (the field names on SimulationParameters; transient defaults to 20 ms / 20 µs). Returns per-waveform stats, an SVG scope, and the design fingerprint. includeWaveforms=true returns downsampled points.',
      parameters: {
        analysis: 'string', parameters: 'string', includeWaveforms: 'boolean', maxPoints: 'number',
      },
      optionalParameters: ['parameters', 'includeWaveforms', 'maxPoints'],
      needsApproval: false,
      handler: async (args) => {
        const parameters = simulationParameters(args)
        const design = runtime.read()
        const snapshot = captureDesignSnapshot(design.components, design.wires, { firmware: design.firmware })
        const fingerprint = designFingerprint(snapshot)
        const netlist = buildCircuitNetlist('Agent simulation', design.components, design.wires, parameters)
        return runAndCache(runtime, args, parameters, fingerprint, netlist)
      },
    },
    {
      name: 'cad.assess',
      description:
        'Rate the current design against declared limits using the last simulation on this exact design: worst utilization, limiting factor, hottest part, power budget, and unrated parts. Ambient is °C; thetaJa overrides the typical package table.',
      parameters: { ambientCelsius: 'number', thetaJa: 'number' },
      optionalParameters: ['ambientCelsius', 'thetaJa'],
      needsApproval: false,
      handler: (args) => assess(runtime, args),
    },
    {
      name: 'cad.erc',
      description: 'Deterministic electrical rule check over canonical nets: power/ground shorts, bus contention, floating inputs, plus unconnected terminals.',
      parameters: {},
      needsApproval: false,
      handler: () => erc(runtime),
    },
    {
      name: 'cad.exportNetlist',
      description: 'Export the sheet as a SPICE deck (format="spice") or the canonical netlist JSON (format="json").',
      parameters: { format: 'string' },
      optionalParameters: ['format'],
      needsApproval: false,
      handler: (args) => exportNetlist(runtime, args),
    },
    {
      name: 'cad.setFirmware',
      description: 'Replace the design firmware source (kept with the sheet and fingerprint). Empty string clears it.',
      parameters: { code: 'string' },
      needsApproval: false,
      handler: (args) => {
        const code = typeof args['code'] === 'string' ? args['code'] : ''
        runtime.setFirmware(code)
        return { message: `Firmware updated (${code.split('\n').length} line(s)).`, ...observe(runtime, { includeSvg: false }) }
      },
    },
    {
      name: 'cad.undo',
      description: 'Undo the most recent sheet change (one step). Returns the restored sheet, or reports that there is nothing to undo.',
      parameters: {},
      needsApproval: false,
      handler: () => {
        const undone = runtime.undo()
        if (!undone) return { message: 'Nothing to undo.', undone: false, ...observe(runtime) }
        return { message: 'Undid the last change.', undone: true, ...observe(runtime) }
      },
    },
  ]

  const byName = new Map(tools.map((tool) => [tool.name, tool]))
  return {
    tools,
    async invoke(name, args = {}) {
      const tool = byName.get(name)
      if (!tool) throw new Error(`Unknown CAD tool: ${name}.`)
      return tool.handler(args)
    },
  }
}

/** Register the CAD surface on a harness (budget/approval/audit apply). */
export function registerCadTools(harness: AgentHarness, runtime: CadRuntime): CadToolset {
  const toolset = createCadToolset(runtime)
  for (const tool of toolset.tools) harness.registerTool(tool)
  return toolset
}

/** Convenience for callers that only need the measurement helpers. */
export function measurementValue(
  result: SimulationResult,
  waveform: string,
  statistic: 'peak' | 'minimum' | 'mean' | 'rms' | 'final' | 'start' | 'ripple',
): number | undefined {
  const found = findWaveform(result, waveform)
  if (!found) return undefined
  const summary = summarizeWaveforms({ ...result, waveforms: [found] })[0]
  return summary ? statisticValue(summary.stats, statistic) : undefined
}
