/**
 * Design observation for agents and humans.
 *
 * An agent cannot iterate on a circuit it cannot see. This module turns the
 * live canvas into (a) a compact, deterministic JSON snapshot with canonical
 * nets and (b) an SVG drawing of the same sheet, so every tool call can be
 * followed by visual feedback. Both are derived from the netlist builder —
 * the same union-find that simulation uses — so the picture an agent reasons
 * about is the circuit that will be simulated, not a parallel interpretation.
 */
import type { CanvasComponent, CanvasWire } from '../../stores/useProjectStore'
import { buildCircuitNetlist, orderedTerminalPins } from '../simulation/netlistBuilder'
import type { SimulationParameters } from '../simulation/spiceEngine'

export interface DesignPinSnapshot {
  id: string
  name: string
  type: string
  /** Terminal reference shown to agents/humans, e.g. `R1.1`. */
  ref: string
  /** Canonical simulation net, or `NC_…` for an unconnected pin. */
  net: string
  connected: boolean
  /** Pin position in the symbol's local frame (before rotation). */
  x: number
  y: number
}

export interface DesignComponentSnapshot {
  id: string
  reference: string
  part: string
  category: string
  description?: string
  /** Human-facing value (`10k`, `10uF`, `1N5817`, …). */
  value: string
  x: number
  y: number
  rotation: number
  width: number
  height: number
  properties: Record<string, string | number | boolean>
  pins: DesignPinSnapshot[]
  symbol: {
    paths: string[]
    circles: Array<{ cx: number; cy: number; r: number }>
    rectangles: Array<{ x: number; y: number; width: number; height: number }>
    text: Array<{ x: number; y: number; text: string; size?: number }>
  }
}

export interface DesignWireSnapshot {
  id: string
  netName?: string
  points: Array<{ x: number; y: number }>
}

export interface DesignNetSnapshot {
  name: string
  /** Terminal references on this net, e.g. `["V1.+", "R1.1"]`. */
  pins: string[]
  wires: string[]
}

export interface DesignSnapshot {
  schema: 'folio.design/1'
  capturedAt: number
  components: DesignComponentSnapshot[]
  wires: DesignWireSnapshot[]
  nets: DesignNetSnapshot[]
  firmware: string
  stats: {
    components: number
    wires: number
    nets: number
    pins: number
    unconnectedPins: number
  }
  /** Structural problems found while observing (never silently dropped). */
  issues: string[]
}

const DESIGN_SCHEMA = 'folio.design/1'

const valueLabel = (component: CanvasComponent): string => {
  const properties = component.properties
  const candidates = ['value', 'voltage', 'type', 'part', 'model', 'mpn']
  for (const key of candidates) {
    const raw = properties[key]
    if (raw !== undefined && String(raw).trim() !== '') return String(raw)
  }
  return ''
}

const isUnconnectedNode = (node: string): boolean => /^NC_/.test(node)

/**
 * Capture the current schematic.
 *
 * Canonical nets come from `buildCircuitNetlist`, including geometry T-taps and
 * named-net merging. A structurally invalid sheet (conflicting net names) is
 * still observable: the failure is reported in `issues` and nets fall back to
 * wire grouping so the user can see and fix the sheet.
 */
export function captureDesignSnapshot(
  components: CanvasComponent[],
  wires: CanvasWire[],
  options: { firmware?: string; now?: number } = {},
): DesignSnapshot {
  const issues: string[] = []
  const analysis: SimulationParameters = { type: 'dc' }

  const nodeByPin = new Map<string, string>()
  let nets: DesignNetSnapshot[] = []
  try {
    const netlist = buildCircuitNetlist('Design snapshot', components, wires, analysis)
    const placedByReference = new Map(components.map((component) => [component.reference, component]))

    // `buildCircuitNetlist` emits nodes in the simulator's terminal order.
    // Map each emitted node back to the pin it belongs to so the snapshot can
    // name a terminal the way a human does (`D1.anode`), not by index.
    const nodeToPin = new Map<string, string>()
    for (const emitted of netlist.components) {
      const placed = placedByReference.get(emitted.name)
      if (!placed) continue
      const ordered = orderedPinsFor(placed)
      ordered.forEach((pin, index) => {
        const net = emitted.nodes[index]
        if (net === undefined) return
        const ref = `${placed.reference}.${pin.name || pin.id}`
        nodeByPin.set(`${placed.id}\u0000${pin.id}`, net)
        nodeToPin.set(`${net}\u0000${placed.reference}\u0000${pin.id}`, ref)
      })
    }

    const netMap = new Map<string, DesignNetSnapshot>()
    for (const component of components) {
      for (const pin of orderedPinsFor(component)) {
        const net = nodeByPin.get(`${component.id}\u0000${pin.id}`)
        if (net === undefined) continue
        if (isUnconnectedNode(net)) continue
        const entry = netMap.get(net) ?? { name: net, pins: [], wires: [] }
        entry.pins.push(`${component.reference}.${pin.name || pin.id}`)
        netMap.set(net, entry)
      }
    }
    for (const wire of wires) {
      for (const connection of wire.connectedPins) {
        const net = nodeByPin.get(`${connection.componentId}\u0000${connection.pinId}`)
        if (!net || isUnconnectedNode(net)) continue
        const entry = netMap.get(net)
        if (entry && !entry.wires.includes(wire.id)) entry.wires.push(wire.id)
      }
    }
    nets = [...netMap.values()].sort((a, b) => a.name.localeCompare(b.name))
  } catch (error) {
    issues.push(
      `Netlist could not be canonicalised: ${error instanceof Error ? error.message : String(error)}.`,
    )
    // Fallback: group by the wire's declared name, or by the wire itself.
    const netMap = new Map<string, DesignNetSnapshot>()
    // Match the solver's canonical spelling even when the netlister failed,
    // so a later margin/probe lookup cannot miss by case alone.
    for (const wire of wires) {
      const raw = (wire.netName?.trim() || `N_${wire.id}`)
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .toUpperCase()
      const key = /^(?:0|GND|GROUND)$/.test(raw) ? '0' : raw
      const entry = netMap.get(key) ?? { name: key, pins: [], wires: [] }
      entry.wires.push(wire.id)
      for (const connection of wire.connectedPins) {
        const component = components.find((candidate) => candidate.id === connection.componentId)
        if (!component) continue
        const pin = component.component.pins.find((candidate) => candidate.id === connection.pinId)
        entry.pins.push(`${component.reference}.${pin?.name || connection.pinId}`)
        nodeByPin.set(`${connection.componentId}\u0000${connection.pinId}`, key)
      }
      netMap.set(key, entry)
    }
    nets = [...netMap.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  const snapshotComponents: DesignComponentSnapshot[] = components.map((component) => {
    const symbol = component.component.symbol_data ?? { width: 0, height: 0, paths: [] }
    const pins: DesignPinSnapshot[] = orderedPinsFor(component).map((pin) => {
      const net = nodeByPin.get(`${component.id}\u0000${pin.id}`) ?? `NC_${component.id}_${pin.id}`
      return {
        id: pin.id,
        name: pin.name,
        type: pin.type,
        ref: `${component.reference}.${pin.name || pin.id}`,
        net,
        connected: !isUnconnectedNode(net),
        x: pin.x,
        y: pin.y,
      }
    })
    return {
      id: component.id,
      reference: component.reference,
      part: component.component.name,
      category: component.component.category,
      description: component.component.description,
      value: valueLabel(component),
      x: component.x,
      y: component.y,
      rotation: component.rotation,
      width: symbol.width,
      height: symbol.height,
      properties: { ...component.properties },
      pins,
      symbol: {
        paths: [...(symbol.paths ?? [])],
        circles: (symbol.circles ?? []).map((circle) => ({ ...circle })),
        rectangles: (symbol.rectangles ?? []).map((rectangle) => ({ ...rectangle })),
        text: (symbol.text ?? []).map((text) => ({ ...text })),
      },
    }
  })

  const pinCount = snapshotComponents.reduce((sum, component) => sum + component.pins.length, 0)
  const unconnectedPins = snapshotComponents.reduce(
    (sum, component) => sum + component.pins.filter((pin) => !pin.connected).length,
    0,
  )

  return {
    schema: DESIGN_SCHEMA,
    capturedAt: options.now ?? Date.now(),
    components: snapshotComponents,
    wires: wires.map((wire) => ({
      id: wire.id,
      netName: wire.netName,
      points: wire.points.map((point) => ({ ...point })),
    })),
    nets,
    firmware: options.firmware ?? '',
    stats: {
      components: snapshotComponents.length,
      wires: wires.length,
      nets: nets.length,
      pins: pinCount,
      unconnectedPins,
    },
    issues,
  }
}

/** Ordered pins for a placed part, falling back to symbol order on bad symbols. */
function orderedPinsFor(component: CanvasComponent): CanvasComponent['component']['pins'] {
  try {
    // Imported lazily inside this module's own dependency; a missing terminal
    // in a malformed symbol should not stop the agent from seeing the sheet.
    return orderedTerminalPins(component.component)
  } catch {
    return component.component.pins
  }
}

/** JSON with recursively sorted object keys — the basis of the fingerprint. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`
}

/**
 * 64-bit non-cryptographic fingerprint (two independent FNV-style lanes).
 * Used for change detection and cache keys — not for security or integrity.
 */
export function hashString(input: string): string {
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index)
    first ^= code
    first = Math.imul(first, 0x01000193)
    second = Math.imul(second ^ code, 0x85ebca6b)
    second ^= second >>> 13
  }
  return (first >>> 0).toString(16).padStart(8, '0') + (second >>> 0).toString(16).padStart(8, '0')
}

/** Deterministic design fingerprint: identical sheets hash identically. */
export function designFingerprint(snapshot: DesignSnapshot): string {
  return hashString(
    stableStringify({
      schema: snapshot.schema,
      components: snapshot.components,
      wires: snapshot.wires,
      firmware: snapshot.firmware,
    }),
  )
}

export interface DesignDiff {
  added: string[]
  removed: string[]
  changed: string[]
  netsAdded: string[]
  netsRemoved: string[]
}

/** Structural diff by reference, for the iteration timeline. */
export function diffDesignSnapshots(before: DesignSnapshot, after: DesignSnapshot): DesignDiff {
  const beforeById = new Map(before.components.map((component) => [component.id, component]))
  const afterById = new Map(after.components.map((component) => [component.id, component]))
  const added: string[] = []
  const removed: string[] = []
  const changed: string[] = []
  for (const [id, component] of afterById) {
    const previous = beforeById.get(id)
    if (!previous) added.push(component.reference)
    else if (stableStringify(previous) !== stableStringify(component)) changed.push(component.reference)
  }
  for (const [id, component] of beforeById) {
    if (!afterById.has(id)) removed.push(component.reference)
  }
  const beforeNets = new Set(before.nets.map((net) => net.name))
  const afterNets = new Set(after.nets.map((net) => net.name))
  return {
    added: added.sort(),
    removed: removed.sort(),
    changed: changed.sort(),
    netsAdded: [...afterNets].filter((name) => !beforeNets.has(name)).sort(),
    netsRemoved: [...beforeNets].filter((name) => !afterNets.has(name)).sort(),
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * SVG observation (schematic + waveforms)
 * ──────────────────────────────────────────────────────────────────────────── */

const NET_PALETTE = [
  '#38bdf8', '#f472b6', '#facc15', '#4ade80', '#a78bfa', '#fb923c', '#22d3ee', '#f87171',
]

const netColor = (name: string): string => {
  let hash = 0
  for (let index = 0; index < name.length; index += 1) hash = (hash * 31 + name.charCodeAt(index)) | 0
  return NET_PALETTE[Math.abs(hash) % NET_PALETTE.length]
}

const escapeXml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

const formatNumber = (value: number): string => {
  if (!Number.isFinite(value)) return '—'
  const magnitude = Math.abs(value)
  if (magnitude === 0) return '0'
  if (magnitude >= 1e9) return `${(value / 1e9).toFixed(2)}G`
  if (magnitude >= 1e6) return `${(value / 1e6).toFixed(2)}M`
  if (magnitude >= 1e3) return `${(value / 1e3).toFixed(2)}k`
  if (magnitude >= 1) return value.toFixed(3).replace(/\.?0+$/, '')
  if (magnitude >= 1e-3) return `${(value * 1e3).toFixed(2)}m`
  if (magnitude >= 1e-6) return `${(value * 1e6).toFixed(2)}µ`
  if (magnitude >= 1e-9) return `${(value * 1e9).toFixed(2)}n`
  return value.toExponential(2)
}

const rotate = (point: { x: number; y: number }, degrees: number): { x: number; y: number } => {
  const radians = ((degrees % 360) * Math.PI) / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  return { x: point.x * cosine - point.y * sine, y: point.x * sine + point.y * cosine }
}

interface Rect {
  x1: number
  y1: number
  x2: number
  y2: number
}

const intersects = (a: Rect, b: Rect): boolean =>
  a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1

/** Axis-aligned world bounds of a component after its rotation. */
function worldBounds(component: DesignComponentSnapshot): Rect {
  const xs: number[] = []
  const ys: number[] = []
  for (const corner of [
    { x: 0, y: 0 },
    { x: component.width, y: 0 },
    { x: 0, y: component.height },
    { x: component.width, y: component.height },
  ]) {
    const rotated = rotate(corner, component.rotation)
    xs.push(component.x + rotated.x)
    ys.push(component.y + rotated.y)
  }
  return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) }
}

interface SchematicSvgOptions {
  /** Rendered width cap, CSS pixels. */
  maxWidth?: number
  maxHeight?: number
  showNetLabels?: boolean
  showPinLabels?: boolean
}

/**
 * Draw the observed sheet as a self-contained SVG.
 *
 * The output carries its own dark background and light ink so it renders the
 * same when embedded as an `<img>` or exported; `currentColor` alone resolves
 * to black outside a themed document. Nets keep stable colours across redraws,
 * which is what makes a change visible at a glance while an agent iterates.
 *
 * Labels are placed in world space below each part's rotated bounds, then
 * nudged down until they clear other parts and other labels — rotating a label
 * with its symbol made adjacent parts collide (D1's value landed on C1).
 */
export function schematicToSvg(snapshot: DesignSnapshot, options: SchematicSvgOptions = {}): string {
  const maxWidth = options.maxWidth ?? 720
  const maxHeight = options.maxHeight ?? 420
  const showNetLabels = options.showNetLabels ?? true
  const showPinLabels = options.showPinLabels ?? false

  const xs: number[] = []
  const ys: number[] = []
  const bounds = snapshot.components.map((component) => ({ component, rect: worldBounds(component) }))
  for (const { rect } of bounds) {
    xs.push(rect.x1, rect.x2)
    ys.push(rect.y1, rect.y2)
  }
  for (const wire of snapshot.wires) {
    for (const point of wire.points) {
      xs.push(point.x)
      ys.push(point.y)
    }
  }

  const labelBoxes: Rect[] = []
  const labelPlacements = new Map<string, { centerX: number; referenceY: number; valueY: number }>()
  for (const { component, rect } of bounds) {
    const width = Math.max(component.reference.length * 5.4, component.value.length * 4.8, 14) + 6
    const height = component.value ? 21 : 11
    const centerX = (rect.x1 + rect.x2) / 2
    let top = rect.y2 + 12
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const candidate = { x1: centerX - width / 2, x2: centerX + width / 2, y1: top, y2: top + height }
      const clashesComponent = bounds.some(
        (other) => other.component.id !== component.id && intersects(candidate, other.rect),
      )
      const clashesLabel = labelBoxes.some((other) => intersects(candidate, other))
      if (!clashesComponent && !clashesLabel) break
      top += 12
    }
    const box = { x1: centerX - width / 2, x2: centerX + width / 2, y1: top, y2: top + height }
    labelBoxes.push(box)
    labelPlacements.set(component.id, { centerX, referenceY: top + 8, valueY: top + 18 })
    xs.push(box.x1, box.x2)
    ys.push(box.y1, box.y2)
  }

  const minX = xs.length ? Math.min(...xs) : 0
  const maxX = xs.length ? Math.max(...xs) : 200
  const minY = ys.length ? Math.min(...ys) : 0
  const maxY = ys.length ? Math.max(...ys) : 120
  const padding = 36
  const contentWidth = Math.max(1, maxX - minX)
  const contentHeight = Math.max(1, maxY - minY)
  const scale = Math.min(
    (maxWidth - padding * 2) / contentWidth,
    (maxHeight - padding * 2) / contentHeight,
    1.6,
  )
  const width = Math.max(120, contentWidth * scale + padding * 2)
  const height = Math.max(90, contentHeight * scale + padding * 2)
  const viewBox = `${minX - padding},${minY - padding},${contentWidth + padding * 2},${contentHeight + padding * 2}`

  const netByPin = new Map<string, string>()
  for (const net of snapshot.nets) for (const pin of net.pins) netByPin.set(pin, net.name)

  const wireMarkup = snapshot.wires
    .filter((wire) => wire.points.length > 1)
    .map((wire) => {
      const points = wire.points.map((point) => `${point.x},${point.y}`).join(' ')
      const color = wire.netName ? netColor(wire.netName) : 'currentColor'
      const opacity = wire.netName ? 0.9 : 0.55
      const middle = wire.points[Math.floor(wire.points.length / 2)]
      const label =
        showNetLabels && wire.netName && middle
          ? `<text x="${middle.x}" y="${middle.y - 5}" font-size="8" fill="${color}" opacity="0.9">${escapeXml(wire.netName)}</text>`
          : ''
      return `<g><polyline points="${points}" fill="none" stroke="${color}" stroke-opacity="${opacity}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>${label}</g>`
    })
    .join('')

  const componentMarkup = snapshot.components
    .map((component) => {
      const pinMarkup = component.pins
        .map((pin) => {
          const rotated = rotate({ x: pin.x, y: pin.y }, component.rotation)
          const x = component.x + rotated.x
          const y = component.y + rotated.y
          const fill = pin.connected ? '#64748b' : '#ef4444'
          const label = showPinLabels
            ? `<text x="${x + 4}" y="${y - 4}" font-size="7" fill="currentColor" opacity="0.7">${escapeXml(pin.name)}</text>`
            : ''
          return `<circle cx="${x}" cy="${y}" r="2.2" fill="${fill}"/><title>${escapeXml(`${pin.ref} → ${pin.connected ? pin.net : 'unconnected'}`)}</title>${label}`
        })
        .join('')

      const paths = component.symbol.paths
        .map(
          (path) =>
            `<path d="${escapeXml(path)}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>`,
        )
        .join('')
      const circles = component.symbol.circles
        .map(
          (circle) =>
            `<circle cx="${circle.cx}" cy="${circle.cy}" r="${circle.r}" fill="none" stroke="currentColor" stroke-width="1.5"/>`,
        )
        .join('')
      const rectangles = component.symbol.rectangles
        .map(
          (rectangle) =>
            `<rect x="${rectangle.x}" y="${rectangle.y}" width="${rectangle.width}" height="${rectangle.height}" fill="none" stroke="currentColor" stroke-width="1.5"/>`,
        )
        .join('')
      const texts = component.symbol.text
        .map(
          (text) =>
            `<text x="${text.x}" y="${text.y}" font-size="${text.size ?? 9}" fill="currentColor" opacity="0.8">${escapeXml(text.text)}</text>`,
        )
        .join('')

      const label = labelPlacements.get(component.id)
      const reference = label
        ? `<text x="${label.centerX}" y="${label.referenceY}" font-size="9" font-weight="600" text-anchor="middle" fill="currentColor">${escapeXml(component.reference)}</text>`
        : ''
      const value = label && component.value
        ? `<text x="${label.centerX}" y="${label.valueY}" font-size="8" text-anchor="middle" fill="currentColor" opacity="0.7">${escapeXml(component.value)}</text>`
        : ''

      return `<g transform="translate(${component.x} ${component.y}) rotate(${component.rotation})">${paths}${circles}${rectangles}${texts}</g><g>${pinMarkup}</g>${reference}${value}`
    })
    .join('')

  const empty = snapshot.components.length === 0
  const emptyMarkup = empty
    ? `<text x="${minX + contentWidth / 2}" y="${minY + contentHeight / 2}" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.6">Empty sheet</text>`
    : ''

  const description = empty
    ? 'Empty schematic'
    : `${snapshot.stats.components} parts, ${snapshot.stats.nets} nets, ${snapshot.stats.unconnectedPins} unconnected pins`

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width)}" height="${Math.round(height)}" ` +
    `viewBox="${viewBox}" role="img" color="#e2e8f0" aria-label="${escapeXml(description)}">` +
    `<title>${escapeXml(description)}</title><desc>${escapeXml(description)}</desc>` +
    `<rect x="${minX - padding}" y="${minY - padding}" width="${contentWidth + padding * 2}" height="${contentHeight + padding * 2}" fill="#0b1220"/>` +
    wireMarkup +
    componentMarkup +
    emptyMarkup +
    `</svg>`
  )
}

/** Waveform trace shape accepted by `waveformToSvg`. */
export interface SvgWaveform {
  name: string
  unit: string
  data: Array<{ x: number; y: number }>
}

interface WaveformSvgOptions {
  width?: number
  paneHeight?: number
  maxPoints?: number
}

/**
 * Multi-trace SVG scope: one pane per unit, shared time axis, min/max bucket
 * downsampling that preserves spikes instead of skipping them by stride.
 */
export function waveformToSvg(seriesList: SvgWaveform[], options: WaveformSvgOptions = {}): string {
  const width = options.width ?? 720
  const paneHeight = options.paneHeight ?? 92
  const maxPoints = options.maxPoints ?? width * 2
  const usable = seriesList.filter((series) => series.data.length > 0)
  if (usable.length === 0) {
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="60" role="img" aria-label="No waveform data">` +
      `<text x="${width / 2}" y="32" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.6">No waveform data</text></svg>`
    )
  }

  const groups = new Map<string, SvgWaveform[]>()
  for (const series of usable) {
    const group = groups.get(series.unit) ?? []
    group.push(series)
    groups.set(series.unit, group)
  }
  const units = [...groups.keys()]
  const left = 52
  const right = 14
  const top = 22
  const plotWidth = Math.max(40, width - left - right)
  const height = top + units.length * paneHeight + 18

  let minX = Infinity
  let maxX = -Infinity
  for (const series of usable) {
    minX = Math.min(minX, series.data[0].x)
    maxX = Math.max(maxX, series.data[series.data.length - 1].x)
  }
  if (!(maxX > minX)) maxX = minX + 1

  const grid = `<pattern id="wf-grid" width="40" height="24" patternUnits="userSpaceOnUse"><path d="M 40 0 L 0 0 0 24" fill="none" stroke="currentColor" stroke-opacity="0.12" stroke-width="0.6"/></pattern>`

  const panes = units
    .map((unit, paneIndex) => {
      const group = groups.get(unit) ?? []
      let minY = Infinity
      let maxY = -Infinity
      for (const series of group) {
        for (const point of series.data) {
          minY = Math.min(minY, point.y)
          maxY = Math.max(maxY, point.y)
        }
      }
      if (!Number.isFinite(minY) || !Number.isFinite(maxY)) return ''
      if (maxY - minY < 1e-15) {
        minY -= 1
        maxY += 1
      } else {
        const pad = (maxY - minY) * 0.08
        minY -= pad
        maxY += pad
      }
      const paneTop = top + paneIndex * paneHeight
      const plotHeight = paneHeight - 20

      const traces = group
        .map((series, seriesIndex) => {
          const points = downsample(series.data, maxPoints)
            .map((point) => {
              const x = left + ((point.x - minX) / (maxX - minX)) * plotWidth
              const y = paneTop + (1 - (point.y - minY) / (maxY - minY)) * plotHeight
              return `${x.toFixed(2)},${y.toFixed(2)}`
            })
            .join(' ')
          const color = NET_PALETTE[(paneIndex * 3 + seriesIndex) % NET_PALETTE.length]
          return `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"><title>${escapeXml(series.name)}</title></polyline>`
        })
        .join('')

      const ticks = [maxY, (maxY + minY) / 2, minY]
        .map((value, tickIndex) => {
          const y = paneTop + (tickIndex * plotHeight) / 2
          return (
            `<text x="${left - 6}" y="${y + 3}" text-anchor="end" font-size="8" fill="currentColor" opacity="0.65">${formatNumber(value)}</text>` +
            `<line x1="${left}" y1="${y}" x2="${left + plotWidth}" y2="${y}" stroke="currentColor" stroke-opacity="0.18" stroke-width="0.6"/>`
          )
        })
        .join('')

      const legend = group
        .map((series, seriesIndex) => {
          const color = NET_PALETTE[(paneIndex * 3 + seriesIndex) % NET_PALETTE.length]
          const x = left + seriesIndex * 150
          return (
            `<rect x="${x}" y="${paneTop + 2}" width="8" height="3" fill="${color}"/>` +
            `<text x="${x + 12}" y="${paneTop + 7}" font-size="8" fill="currentColor" opacity="0.85">${escapeXml(series.name)}</text>`
          )
        })
        .join('')

      return (
        `<rect x="${left}" y="${paneTop}" width="${plotWidth}" height="${plotHeight}" fill="url(#wf-grid)"/>` +
        ticks +
        traces +
        legend +
        (paneIndex === units.length - 1
          ? `<text x="${left - 6}" y="${paneTop + plotHeight + 12}" text-anchor="end" font-size="8" fill="currentColor" opacity="0.6">t</text>`
          : '')
      )
    })
    .join('')

  const xTicks = [0, 0.25, 0.5, 0.75, 1]
    .map((fraction) => {
      const x = left + fraction * plotWidth
      const value = minX + fraction * (maxX - minX)
      return (
        `<line x1="${x}" y1="${top}" x2="${x}" y2="${height - 18}" stroke="currentColor" stroke-opacity="0.10" stroke-width="0.6"/>` +
        `<text x="${x}" y="${height - 6}" text-anchor="middle" font-size="8" fill="currentColor" opacity="0.65">${formatNumber(value)}</text>`
      )
    })
    .join('')

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" role="img" ` +
    `aria-label="${escapeXml(`Waveforms: ${usable.map((series) => series.name).join(', ')}`)}">` +
    `<defs>${grid}</defs>` +
    `<title>${escapeXml(usable.map((series) => series.name).join(', '))}</title>` +
    panes +
    xTicks +
    `</svg>`
  )
}

/**
 * Min/max bucket downsampling. Preserves the envelope: a 20 µs spike in a
 * 20 ms run survives even when the plot has room for 1 000 points.
 */
function downsample(data: ReadonlyArray<{ x: number; y: number }>, maxPoints: number): Array<{ x: number; y: number }> {
  if (data.length <= maxPoints) return [...data]
  const buckets = Math.max(1, Math.floor(maxPoints / 2))
  const span = data.length - 1
  const result: Array<{ x: number; y: number }> = [data[0]]
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const start = Math.floor((bucket * span) / buckets)
    const end = Math.min(span, Math.floor(((bucket + 1) * span) / buckets))
    let min = data[start]
    let max = data[start]
    for (let index = start; index <= end; index += 1) {
      const point = data[index]
      if (point.y < min.y) min = point
      if (point.y > max.y) max = point
    }
    const pair = min.x <= max.x ? [min, max] : [max, min]
    if (pair[0] !== result[result.length - 1]) result.push(pair[0])
    if (pair[1] !== result[result.length - 1]) result.push(pair[1])
  }
  const last = data[data.length - 1]
  if (result[result.length - 1] !== last) result.push(last)
  return result
}
