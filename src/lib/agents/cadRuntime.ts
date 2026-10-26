/**
 * The CAD runtime an agent acts on.
 *
 * Tools never touch React state directly: they read and commit through this
 * interface. In the app the implementation is backed by `useProjectStore`, so
 * every tool call lands on the canvas the human sees (live visual feedback).
 * Tests get an in-memory runtime with the same contract, so the loop is
 * exercised without a browser.
 *
 * Geometry lives here too: a terminal reference like `D1.A` resolves to the
 * exact world coordinate the canvas draws and the netlister reads. Agents wire
 * to pins, never to approximate coordinates.
 */
import type { Component } from '../supabase'
import { standardComponents } from '../componentLibrary'
import { useProjectStore, type CanvasComponent, type CanvasWire } from '../../stores/useProjectStore'
import { generateId } from '../utils'
import type { SimulationResult, SimulationParameters, CircuitNetlist } from '../simulation/spiceEngine'

export interface CadDesignState {
  components: CanvasComponent[]
  wires: CanvasWire[]
  firmware: string
}

export interface CadSimulationCache {
  /** Fingerprint of the sheet the result was measured on. */
  fingerprint: string
  analysis: SimulationParameters['type']
  parameters: SimulationParameters
  netlist: CircuitNetlist
  result: SimulationResult
}

export interface CadRuntime {
  read(): CadDesignState
  /** Commit a whole sheet atomically (one undo step). */
  commit(next: { components: CanvasComponent[]; wires: CanvasWire[] }): void
  undo(): boolean
  setFirmware(code: string): void
  cacheSimulation(entry: CadSimulationCache): void
  lastSimulation(): CadSimulationCache | null
}

export const cloneComponent = (component: CanvasComponent): CanvasComponent => ({
  ...component,
  properties: { ...component.properties },
  component: {
    ...component.component,
    symbol_data: { ...component.component.symbol_data },
    pins: component.component.pins.map((pin) => ({ ...pin })),
    default_properties: { ...component.component.default_properties },
  },
})

export const cloneWire = (wire: CanvasWire): CanvasWire => ({
  ...wire,
  points: wire.points.map((point) => ({ ...point })),
  connectedPins: wire.connectedPins.map((pin) => ({ ...pin })),
  style: wire.style ? { ...wire.style, dashArray: wire.style.dashArray ? [...wire.style.dashArray] : undefined } : undefined,
})

export const cloneDesign = (design: CadDesignState): CadDesignState => ({
  components: design.components.map(cloneComponent),
  wires: design.wires.map(cloneWire),
  firmware: design.firmware,
})

/** Runtime backed by the live project store — the canvas the human sees. */
export function createStoreCadRuntime(): CadRuntime {
  let simulation: CadSimulationCache | null = null
  return {
    read: () => {
      const state = useProjectStore.getState()
      return {
        components: state.components.map(cloneComponent),
        wires: state.wires.map(cloneWire),
        firmware: state.firmwareCode,
      }
    },
    commit: (next) => {
      useProjectStore.getState().replaceDesign({
        components: next.components.map(cloneComponent),
        wires: next.wires.map(cloneWire),
      })
    },
    undo: () => {
      const store = useProjectStore.getState()
      if (!store.canUndo()) return false
      store.undo()
      return true
    },
    setFirmware: (code) => useProjectStore.getState().setFirmwareCode(code),
    cacheSimulation: (entry) => {
      simulation = entry
    },
    lastSimulation: () => simulation,
  }
}

/** In-memory runtime for tests, headless runs, and cloud workers. */
export function createMemoryCadRuntime(seed: Partial<CadDesignState> = {}): CadRuntime {
  let state: CadDesignState = {
    components: (seed.components ?? []).map(cloneComponent),
    wires: (seed.wires ?? []).map(cloneWire),
    firmware: seed.firmware ?? '',
  }
  const undoStack: Array<{ components: CanvasComponent[]; wires: CanvasWire[] }> = []
  let simulation: CadSimulationCache | null = null
  return {
    read: () => cloneDesign(state),
    commit: (next) => {
      undoStack.push({ components: state.components, wires: state.wires })
      if (undoStack.length > 50) undoStack.shift()
      state = {
        components: next.components.map(cloneComponent),
        wires: next.wires.map(cloneWire),
        firmware: state.firmware,
      }
    },
    undo: () => {
      const previous = undoStack.pop()
      if (!previous) return false
      state = { components: previous.components, wires: previous.wires, firmware: state.firmware }
      return true
    },
    setFirmware: (code) => {
      undoStack.push({ components: state.components, wires: state.wires })
      state = { ...state, firmware: code }
    },
    cacheSimulation: (entry) => {
      simulation = entry
    },
    lastSimulation: () => simulation,
  }
}

/* ------------------------------------------------------------------ *
 * Pin geometry
 * ------------------------------------------------------------------ */

export interface PinLike {
  x: number
  y: number
}

/** Rotate a pin offset by the part's rotation (clockwise, matching Konva). */
export function rotatePinOffset(pin: PinLike, rotationDegrees: number): { x: number; y: number } {
  const radians = ((rotationDegrees % 360) * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return { x: pin.x * cos - pin.y * sin, y: pin.x * sin + pin.y * cos }
}

/** World coordinate of a pin — the same point the canvas draws. */
export function pinWorldPosition(
  component: Pick<CanvasComponent, 'x' | 'y' | 'rotation'>,
  pin: PinLike,
): { x: number; y: number } {
  const rotated = rotatePinOffset(pin, component.rotation)
  return { x: component.x + rotated.x, y: component.y + rotated.y }
}

/** Components are keyed by reference on the sheet; matching ignores case. */
export function findComponentByReference(
  components: readonly CanvasComponent[],
  reference: string,
): CanvasComponent | undefined {
  const wanted = reference.trim().toLowerCase()
  return components.find((component) => component.reference.toLowerCase() === wanted)
}

/**
 * Resolve a pin token: id (`p1`), name (`A`, `+`), or 1-based ordinal (`1`).
 * Compound symbols (MOSFET, sources) make name-only lookups ambiguous, so id
 * always wins and the error lists every valid terminal.
 */
export function findPin(
  component: CanvasComponent,
  token: string,
): CanvasComponent['component']['pins'][number] {
  const wanted = token.trim().toLowerCase()
  const pins = component.component.pins
  const byId = pins.find((pin) => pin.id.toLowerCase() === wanted)
  if (byId) return byId
  const byName = pins.filter((pin) => pin.name.trim().toLowerCase() === wanted)
  if (byName.length === 1) return byName[0]
  if (/^\d+$/.test(wanted)) {
    const ordinal = Number(wanted) - 1
    if (ordinal >= 0 && ordinal < pins.length) return pins[ordinal]
  }
  const labels = pins.map((pin) => `${pin.id}${pin.name && pin.name !== pin.id ? ` (${pin.name})` : ''}`)
  throw new Error(
    `${component.reference} has no terminal "${token}". Terminals: ${labels.join(', ')}.`,
  )
}

/** Display label for a pin, e.g. `D1.A` or `Q1.collector`. */
export function terminalLabel(
  component: CanvasComponent,
  pin: CanvasComponent['component']['pins'][number],
): string {
  const duplicateName = component.component.pins.filter((candidate) => candidate.name === pin.name).length > 1
  const token = pin.name.trim() && !duplicateName ? pin.name.trim() : pin.id
  return `${component.reference}.${token}`
}

/** Parse `D1.A` into a component + pin, or fail with the sheet's references. */
export function resolveTerminal(
  components: readonly CanvasComponent[],
  reference: string,
): { component: CanvasComponent; pin: CanvasComponent['component']['pins'][number] } {
  const trimmed = reference.trim()
  const dot = trimmed.lastIndexOf('.')
  if (dot <= 0 || dot === trimmed.length - 1) {
    throw new Error(`"${reference}" is not a terminal reference; use <reference>.<pin>, e.g. R1.1.`)
  }
  const component = findComponentByReference(components, trimmed.slice(0, dot))
  if (!component) {
    const available = components.map((candidate) => candidate.reference).join(', ') || '(no components)'
    throw new Error(`No component "${trimmed.slice(0, dot)}" on the sheet. Components: ${available}.`)
  }
  return { component, pin: findPin(component, trimmed.slice(dot + 1)) }
}

/* ------------------------------------------------------------------ *
 * Library symbols
 * ------------------------------------------------------------------ */

export interface LibraryEntry {
  name: string
  category: string
  aliases: string[]
  pins: Array<{ id: string; name: string; type: string }>
  defaults: Record<string, string | number | boolean>
}

const ALIASES: Readonly<Record<string, string[]>> = {
  'Resistor': ['resistor', 'res', 'r'],
  'Capacitor': ['capacitor', 'cap', 'c'],
  'Inductor': ['inductor', 'ind', 'l'],
  'Diode': ['diode', 'd'],
  'LED': ['led'],
  'Ground': ['ground', 'gnd', 'g'],
  'DC Voltage Source': ['dc', 'dc source', 'vdc', 'voltage source'],
  'Sine Voltage Source': ['sine', 'sine source', 'vsin', 'ac source', 'ac'],
  'Pulse Voltage Source': ['pulse', 'pulse source', 'vpulse', 'square', 'pwm'],
  'EXP Voltage Source': ['exp', 'exp source', 'vexp'],
  'SFFM Voltage Source': ['sffm', 'fm source'],
  'PWL Voltage Source': ['pwl', 'piecewise'],
  'NPN Transistor': ['npn', 'bjt', 'npn transistor', 'qnpn'],
  'PNP Transistor': ['pnp', 'pnp transistor', 'qpnp'],
  'N-Channel MOSFET': ['nmos', 'nmosfet', 'n-channel mosfet', 'mosfet', 'nfet'],
  'P-Channel MOSFET': ['pmos', 'pmosfet', 'p-channel mosfet', 'pfet'],
  'N-Channel JFET': ['njfet', 'n-channel jfet', 'jfet'],
  'P-Channel JFET': ['pjfet', 'p-channel jfet'],
  'Transformer': ['transformer', 'xfmr'],
  'Transmission Line': ['transmission line', 'tline', 'tl'],
  'Voltage-Controlled Switch': ['switch', 'vcsw', 'voltage switch'],
  'Current-Controlled Switch': ['ccsw', 'current switch'],
  'Behavioral Source': ['behavioral', 'bsource', 'b source'],
  'Test Point': ['test point', 'tp', 'probe'],
}

export function listLibrarySymbols(): LibraryEntry[] {
  return standardComponents.map((symbol) => ({
    name: symbol.name,
    category: symbol.category,
    aliases: ALIASES[symbol.name] ?? [symbol.name.toLowerCase()],
    pins: symbol.pins.map((pin) => ({ id: pin.id, name: pin.name, type: pin.type })),
    defaults: { ...symbol.default_properties },
  }))
}

/** Resolve a human/agent symbol name to a library component. */
export function findLibrarySymbol(name: string): Omit<Component, 'id' | 'created_at'> {
  const wanted = name.trim().toLowerCase()
  const squash = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '')
  const squashed = squash(wanted)
  for (const symbol of standardComponents) {
    if (symbol.name.toLowerCase() === wanted) return symbol
    const aliases = ALIASES[symbol.name] ?? []
    if (aliases.includes(wanted)) return symbol
    // "N-MOSFET" / "n channel mosfet" / "nmosfet" all reach the same symbol.
    if (squash(symbol.name) === squashed || aliases.some((alias) => squash(alias) === squashed)) return symbol
  }
  const partial = standardComponents.find(
    (symbol) => squashed.length >= 3 && squash(symbol.name).includes(squashed),
  )
  if (partial) return partial
  const suggestions = listLibrarySymbols()
    .filter((entry) => entry.aliases.some((alias) => squash(alias).startsWith(squashed.slice(0, 2))))
    .slice(0, 8)
    .map((entry) => entry.name)
  throw new Error(
    `Unknown symbol "${name}".${suggestions.length ? ` Did you mean: ${suggestions.join(', ')}?` : ''}`,
  )
}

const REFERENCE_PREFIXES: Array<[RegExp, string]> = [
  [/^resistor$/i, 'R'],
  [/^capacitor$/i, 'C'],
  [/^inductor$/i, 'L'],
  [/^diode$/i, 'D'],
  [/^led$/i, 'D'],
  [/transistor|mosfet|jfet/i, 'Q'],
  [/voltage source|sine|pulse|exp |sffm|pwl|behavioral/i, 'V'],
  [/current source/i, 'I'],
  [/^ground$/i, 'G'],
  [/switch/i, 'SW'],
  [/transformer/i, 'T'],
  [/transmission line/i, 'TL'],
  [/test point/i, 'TP'],
  [/connector|header/i, 'J'],
  [/crystal/i, 'Y'],
  [/relay/i, 'K'],
  [/battery/i, 'BT'],
  [/motor|machine/i, 'M'],
]

export function referencePrefixFor(symbolName: string): string {
  for (const [pattern, prefix] of REFERENCE_PREFIXES) {
    if (pattern.test(symbolName)) return prefix
  }
  return 'X'
}

export function nextReference(components: readonly CanvasComponent[], prefix: string): string {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matcher = new RegExp(`^${escaped}(\\d+)$`, 'i')
  let highest = 0
  for (const component of components) {
    const match = matcher.exec(component.reference)
    if (match) highest = Math.max(highest, Number(match[1]))
  }
  return `${prefix}${highest + 1}`
}

const boundingBox = (component: CanvasComponent): { x: number; y: number; width: number; height: number } => {
  const width = component.component.symbol_data.width ?? 60
  const height = component.component.symbol_data.height ?? 40
  return { x: component.x, y: component.y, width, height }
}

const overlaps = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
  margin = 24,
): boolean =>
  a.x < b.x + b.width + margin
  && a.x + a.width + margin > b.x
  && a.y < b.y + b.height + margin
  && a.y + a.height + margin > b.y

/** First free slot on a drafting grid, so a dropped part never lands on one. */
export function autoPlace(
  components: readonly CanvasComponent[],
  symbol: Omit<Component, 'id' | 'created_at'>,
): { x: number; y: number } {
  const width = symbol.symbol_data.width ?? 60
  const height = symbol.symbol_data.height ?? 40
  for (let row = 0; row < 20; row++) {
    for (let column = 0; column < 12; column++) {
      const candidate = { x: 40 + column * Math.max(120, width + 40), y: 60 + row * Math.max(100, height + 45), width, height }
      if (!components.some((component) => overlaps(candidate, boundingBox(component)))) {
        return { x: candidate.x, y: candidate.y }
      }
    }
  }
  return { x: 40, y: 60 + components.length * 100 }
}

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

export type Point = { x: number; y: number }

/** Existing named net on a terminal, if unambiguous. */
export function netOnTerminal(
  wires: readonly CanvasWire[],
  componentId: string,
  pinId: string,
): string | undefined {
  const names = new Set<string>()
  for (const wire of wires) {
    if (!wire.netName) continue
    if (wire.connectedPins.some((pin) => pin.componentId === componentId && pin.pinId === pinId)) {
      names.add(wire.netName)
    }
  }
  if (names.size > 1) {
    throw new Error(`Terminal ${componentId}:${pinId} already belongs to ${[...names].join(' and ')} — resolve the conflict first.`)
  }
  return [...names][0]
}

/** Tangent point on a wire polyline nearest to a pin — a true T-tap. */
export function nearestTapPoint(
  wires: readonly CanvasWire[],
  netName: string,
  target: Point,
): { point: Point; distance: number; wireId: string } | undefined {
  let best: { point: Point; distance: number; wireId: string } | undefined
  const wanted = netName.trim().toLowerCase()
  for (const wire of wires) {
    if ((wire.netName ?? '').trim().toLowerCase() !== wanted) continue
    for (let index = 0; index + 1 < wire.points.length; index++) {
      const a = wire.points[index]
      const b = wire.points[index + 1]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const lengthSquared = dx * dx + dy * dy
      const t = lengthSquared > 0
        ? Math.max(0, Math.min(1, ((target.x - a.x) * dx + (target.y - a.y) * dy) / lengthSquared))
        : 0
      const point = { x: a.x + t * dx, y: a.y + t * dy }
      const distance = Math.hypot(point.x - target.x, point.y - target.y)
      if (!best || distance < best.distance) best = { point, distance, wireId: wire.id }
    }
  }
  return best
}

export const newComponentId = (): string => generateId('comp')
export const newWireId = (): string => generateId('wire')
