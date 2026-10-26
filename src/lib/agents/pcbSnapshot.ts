/**
 * Board observation for agents and humans.
 *
 * `eda.route` publishes copper the agent can no longer see as a schematic. This
 * module turns that layout into (a) a deterministic JSON snapshot of the board
 * the canvas and 3-D preview render and (b) an SVG top view of the same copper.
 * Both come from `buildPcbScene`, so the pads, traces and warnings an agent
 * reasons about are exactly the ones the viewer draws.
 */
import {
  buildPcbScene,
  type PcbScene,
  type PcbSceneInput,
} from '../pcb/pcbScene'

export interface PcbSnapshotPad {
  id: string
  shape: 'circle' | 'rectangle' | 'oval'
  /** Board millimetres from the top-left of the outline. */
  x: number
  y: number
  widthMm: number
  depthMm: number
  drillMm?: number
  /** Same rotation as the owning part; the pad rectangle is not axis-aligned. */
  rotationDeg: number
}

export interface PcbSnapshotComponent {
  id: string
  reference: string
  footprintId: string
  footprintName: string
  category: string
  side: 'top' | 'bottom'
  x: number
  y: number
  rotationDeg: number
  body: {
    widthMm: number
    depthMm: number
    heightMm: number
    shape: 'box' | 'cylinder'
  }
  pads: PcbSnapshotPad[]
  onBoard: boolean
}

export interface PcbSnapshotTrace {
  id: string
  net: string
  layerId: string
  widthMm: number
  lengthMm: number
  points: Array<{ x: number; y: number }>
}

export interface PcbSnapshotVia {
  id: string
  net: string
  x: number
  y: number
  padDiameterMm: number
  drillDiameterMm: number
}

export interface PcbSnapshotLayer {
  id: string
  name: string
  kind: 'copper' | 'mask' | 'silk'
  side?: 'top' | 'bottom'
  /** Scene Y of the layer mid-plane (0 is the substrate mid-plane). */
  yMm: number
  thicknessMm: number
  color: string
  visible: boolean
}

export interface PcbSnapshotWarning {
  code: string
  message: string
  elementId?: string
}

export interface PcbSnapshot {
  schema: 'folio.pcb/1'
  board: {
    widthMm: number
    heightMm: number
    thicknessMm: number
    copperLayers: number
  }
  /** Resolved stack: copper, mask and silk with their actual heights. */
  layers: PcbSnapshotLayer[]
  components: PcbSnapshotComponent[]
  traces: PcbSnapshotTrace[]
  vias: PcbSnapshotVia[]
  stats: {
    components: number
    pads: number
    traces: number
    traceLengthMm: number
    vias: number
    nets: number
  }
  /** Placement/manufacturability problems, never silently clamped. */
  warnings: PcbSnapshotWarning[]
}

const PCB_SCHEMA = 'folio.pcb/1'

/** Board-space helper: scene X/Z are centred, board X/Y start at the corner. */
const toBoard = (scene: PcbScene) => (x: number, z: number) => ({
  x: x + scene.board.widthMm / 2,
  y: z + scene.board.heightMm / 2,
})

/**
 * Capture the routed board.
 *
 * Invalid geometry still produces a snapshot: `buildPcbScene` reports it in
 * `warnings` (off-board trace, unknown footprint, …) so an agent can see the
 * problem and fix it instead of receiving an empty result.
 */
export function capturePcbSnapshot(layout: PcbSceneInput): PcbSnapshot {
  const scene = buildPcbScene(layout)
  const boardPoint = toBoard(scene)

  const traces = layout.traces.flatMap((trace) => {
    const segments = scene.traces.filter((segment) => segment.traceId === trace.id)
    if (segments.length === 0) return []
    const points = trace.points
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
      .map((point) => ({ ...point }))
    if (points.length < 2) return []
    return [{
      id: trace.id,
      net: trace.net,
      layerId: trace.layerId,
      widthMm: segments[0].widthMm,
      lengthMm: segments.reduce((sum, segment) => sum + segment.lengthMm, 0),
      points,
    }]
  })

  const components: PcbSnapshotComponent[] = scene.components.map((component) => ({
    id: component.id,
    reference: component.reference,
    footprintId: component.footprintId,
    footprintName: component.footprintName,
    category: component.category,
    side: component.side,
    ...boardPoint(component.position.x, component.position.z),
    rotationDeg: component.rotationYDeg,
    body: {
      widthMm: component.bodyWidthMm,
      depthMm: component.bodyDepthMm,
      heightMm: component.bodyHeightMm,
      shape: component.bodyShape,
    },
    pads: component.pads.map((pad) => ({
      id: pad.id,
      shape: pad.shape,
      ...boardPoint(pad.position.x, pad.position.z),
      widthMm: pad.widthMm,
      depthMm: pad.depthMm,
      drillMm: pad.drillMm,
      rotationDeg: component.rotationYDeg,
    })),
    onBoard: component.onBoard,
  }))

  const vias: PcbSnapshotVia[] = scene.vias.map((via) => ({
    id: via.id,
    net: via.net,
    ...boardPoint(via.position.x, via.position.z),
    padDiameterMm: via.padDiameterMm,
    drillDiameterMm: via.drillDiameterMm,
  }))

  const nets = new Set<string>()
  for (const trace of traces) nets.add(trace.net)
  for (const via of vias) if (via.net) nets.add(via.net)

  return {
    schema: PCB_SCHEMA,
    board: {
      widthMm: scene.board.widthMm,
      heightMm: scene.board.heightMm,
      thicknessMm: scene.board.thicknessMm,
      copperLayers: scene.counts.copperLayers,
    },
    layers: scene.layers.map((layer) => ({
      id: layer.id,
      name: layer.name,
      kind: layer.kind,
      ...(layer.side ? { side: layer.side } : {}),
      yMm: layer.yMm,
      thicknessMm: layer.thicknessMm,
      color: layer.color,
      visible: layer.visible,
    })),
    components,
    traces,
    vias,
    stats: {
      components: components.length,
      pads: scene.counts.pads,
      traces: traces.length,
      traceLengthMm: traces.reduce((sum, trace) => sum + trace.lengthMm, 0),
      vias: vias.length,
      nets: nets.size,
    },
    warnings: scene.warnings.map((warning) => ({ ...warning })),
  }
}

interface PcbSvgOptions {
  /** Overall drawing width in CSS pixels; height follows the board aspect. */
  width?: number
  margin?: number
}

const escapeXml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

const fmt = (value: number, digits = 2): string => {
  if (!Number.isFinite(value)) return '0'
  return Number(value.toFixed(digits)).toString()
}

/**
 * Top view of the routed board: bottom copper, top copper, lands, vias and
 * silkscreen outlines. Deliberately schematic-like rather than photoreal — an
 * agent needs unambiguous geometry, not shading.
 */
export function pcbToSvg(layout: PcbSceneInput, options: PcbSvgOptions = {}): string {
  const scene = buildPcbScene(layout)
  const width = options.width ?? 720
  const margin = options.margin ?? 20
  const legendHeight = 18
  const boardWidth = Math.max(1, scene.board.widthMm)
  const boardHeight = Math.max(1, scene.board.heightMm)
  const scale = (width - margin * 2) / boardWidth
  const boardTop = margin + legendHeight
  const height = boardTop + boardHeight * scale + margin
  const boardPoint = toBoard(scene)
  const px = (x: number, z: number) => {
    const point = boardPoint(x, z)
    return { x: margin + point.x * scale, y: boardTop + point.y * scale }
  }

  const bottomTraces = scene.traces.filter((segment) => {
    const layer = scene.layers.find((entry) => entry.id === segment.layerId)
    return layer?.side === 'bottom'
  })
  const topTraces = scene.traces.filter((segment) => !bottomTraces.includes(segment))

  const traceMarkup = (segments: typeof scene.traces, color: string, opacity: number) =>
    segments
      .map((segment) => {
        const from = px(segment.start.x, segment.start.z)
        const to = px(segment.end.x, segment.end.z)
        const stroke = Math.max(0.9, segment.widthMm * scale)
        return `<line x1="${fmt(from.x)}" y1="${fmt(from.y)}" x2="${fmt(to.x)}" y2="${fmt(to.y)}" stroke="${color}" stroke-opacity="${opacity}" stroke-width="${fmt(stroke)}" stroke-linecap="round"><title>${escapeXml(`${segment.net} · ${segment.layerId} · ${fmt(segment.widthMm)} mm`)}</title></line>`
      })
      .join('')

  const padMarkup = scene.components
    .flatMap((component) => component.pads.map((pad) => {
      const center = px(pad.position.x, pad.position.z)
      const widthPx = Math.max(1, pad.widthMm * scale)
      const depthPx = Math.max(1, pad.depthMm * scale)
      const transform = `translate(${fmt(center.x)} ${fmt(center.y)}) rotate(${fmt(component.rotationYDeg)})`
      const title = `<title>${escapeXml(`${component.reference} pad`)}</title>`
      if (pad.shape === 'circle') {
        return `<g transform="${transform}"><ellipse rx="${fmt(widthPx / 2)}" ry="${fmt(depthPx / 2)}" fill="#d5af47"/>${title}</g>`
      }
      const rx = pad.shape === 'oval' ? fmt(Math.min(widthPx, depthPx) / 2) : '0'
      return `<g transform="${transform}"><rect x="${fmt(-widthPx / 2)}" y="${fmt(-depthPx / 2)}" width="${fmt(widthPx)}" height="${fmt(depthPx)}" rx="${rx}" fill="#d5af47"/>${title}</g>`
    }))
    .join('')

  const viaMarkup = scene.vias
    .map((via) => {
      const center = px(via.position.x, via.position.z)
      const padRadius = (via.padDiameterMm / 2) * scale
      const drillRadius = (via.drillDiameterMm / 2) * scale
      return `<circle cx="${fmt(center.x)}" cy="${fmt(center.y)}" r="${fmt(Math.max(1, padRadius))}" fill="#d5af47"/><circle cx="${fmt(center.x)}" cy="${fmt(center.y)}" r="${fmt(Math.max(0.6, drillRadius))}" fill="#0b1a12"><title>${escapeXml(`via ${via.net}`)}</title></circle>`
    })
    .join('')

  const componentMarkup = scene.components
    .map((component) => {
      const center = px(component.position.x, component.position.z)
      const widthPx = Math.max(2, component.bodyWidthMm * scale)
      const depthPx = Math.max(2, component.bodyDepthMm * scale)
      const fontSize = Math.max(7, Math.min(12, scale * 1.1))
      // References stay upright so a rotated part is still readable, and the
      // halo keeps them legible where a label crosses a land or a trace.
      return (
        `<g transform="translate(${fmt(center.x)} ${fmt(center.y)}) rotate(${fmt(component.rotationYDeg)})">` +
        `<rect x="${fmt(-widthPx / 2)}" y="${fmt(-depthPx / 2)}" width="${fmt(widthPx)}" height="${fmt(depthPx)}" fill="none" stroke="#f8fafc" stroke-opacity="0.75" stroke-width="0.9"/>` +
        `<text x="0" y="${fmt(fontSize * 0.35)}" text-anchor="middle" font-family="monospace" font-size="${fmt(fontSize)}" fill="#f8fafc" fill-opacity="0.95" stroke="#0f3d27" stroke-width="2.2" stroke-linejoin="round" paint-order="stroke" transform="rotate(${fmt(-component.rotationYDeg)})">${escapeXml(component.reference)}</text>` +
        `<title>${escapeXml(`${component.reference} · ${component.footprintName}`)}</title>` +
        `</g>`
      )
    })
    .join('')

  const legend = [
    { color: '#e05252', label: 'top copper' },
    { color: '#f2a33c', label: 'bottom copper' },
    { color: '#d5af47', label: 'lands / vias' },
    { color: '#f8fafc', label: 'silkscreen' },
  ]
    .map((entry, index) => {
      const x = margin + index * 118
      return `<rect x="${x}" y="${margin - 4}" width="8" height="8" fill="${entry.color}"/><text x="${x + 12}" y="${margin + 3.5}" font-family="monospace" font-size="9" fill="currentColor" fill-opacity="0.75">${entry.label}</text>`
    })
    .join('')

  const description = `${fmt(boardWidth)} × ${fmt(boardHeight)} mm board: ${scene.counts.components} parts, ${scene.counts.pads} pads, ${scene.counts.traces} trace segments, ${scene.counts.vias} vias`
  const warningMarkup = scene.warnings.length > 0
    ? `<text x="${margin}" y="${height - 6}" font-family="monospace" font-size="9" fill="#fca5a5">${escapeXml(`${scene.warnings.length} placement warning(s)`)}</text>`
    : ''

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width)}" height="${Math.round(height)}" ` +
    `viewBox="0 0 ${fmt(width)} ${fmt(height)}" role="img" aria-label="${escapeXml(description)}" ` +
    `style="color:#cbd5e1;background:#0b1a12">` +
    `<title>${escapeXml(description)}</title><desc>${escapeXml(description)}</desc>` +
    legend +
    `<rect x="${margin}" y="${boardTop}" width="${fmt(boardWidth * scale)}" height="${fmt(boardHeight * scale)}" rx="3" fill="#0f3d27" stroke="#5eead4" stroke-opacity="0.7"/>` +
    traceMarkup(bottomTraces, '#f2a33c', 0.8) +
    traceMarkup(topTraces, '#e05252', 0.95) +
    padMarkup +
    viaMarkup +
    componentMarkup +
    warningMarkup +
    `</svg>`
  )
}
