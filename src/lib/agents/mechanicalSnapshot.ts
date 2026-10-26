/**
 * Canonical observation of the mechanical assembly plus a deterministic SVG
 * front elevation.
 *
 * The snapshot reports millimetres and kilograms (the units engineers read on
 * a drawing) while keeping SI values the solvers consume. Analysis entries are
 * the same closed forms `MechanicalDesignPanel` displays; a part with no
 * support is reported as a warning instead of failing the whole observation,
 * so an agent can see the rest of the assembly and fix it.
 */
import {
  analysePart,
  type MechanicalPart,
} from '../mechanical/partModel'

export interface MechanicalSnapshotLoad {
  forceN: number
  pressurePa: number
  temperatureK: number
}

export interface MechanicalSnapshotPart {
  id: string
  name: string
  kind: 'beam' | 'plate'
  dimensionsMm: { length: number; width: number; height: number }
  positionM: [number, number, number]
  rotationDeg: [number, number, number]
  material: {
    key: string
    name: string
    densityKgM3: number
    youngsModulusPa: number
    yieldStrengthPa: number
  }
  massKg: number
  volumeM3: number
  support: 'fixed' | 'pinned' | 'roller' | 'free'
  loads: MechanicalSnapshotLoad
  analysis: {
    stressMPa: number
    deflectionMm: number
    safetyFactor: number | null
    yields: boolean
    naturalFrequenciesHz: number[]
    bucklingLoadN: number
  } | null
}

export interface MechanicalSnapshotWarning {
  code: 'unsupported-part' | 'yields'
  partId: string
  message: string
}

export interface MechanicalSnapshot {
  schema: 'folio.mechanical/1'
  units: { length: 'm'; drawing: 'mm'; mass: 'kg'; stress: 'Pa' }
  parts: MechanicalSnapshotPart[]
  summary: {
    partCount: number
    totalMassKg: number
    totalVolumeM3: number
    materials: string[]
    boundsMm: { min: [number, number, number]; max: [number, number, number]; size: [number, number, number] }
    highestStressMPa: number
    lowestSafetyFactor: number | null
    unfinishedParts: number
  }
  warnings: MechanicalSnapshotWarning[]
}

export interface MechanicalSvgOptions {
  width?: number
  title?: string
}

const round = (value: number, places: number): number => {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

const fmt = (value: number, places = 3): string => {
  if (!Number.isFinite(value)) return 'n/a'
  const rounded = round(value, places)
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(places).replace(/0+$/, '')
}

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/** Rotated half-extents in the drawing plane (length × height about Z). */
function halfExtents(part: MechanicalPart): { x: number; y: number } {
  const halfLength = part.dimensions.length / 2
  const halfHeight = part.dimensions.height / 2
  const angle = part.rotation[2]
  const cos = Math.abs(Math.cos(angle))
  const sin = Math.abs(Math.sin(angle))
  return {
    x: halfLength * cos + halfHeight * sin,
    y: halfLength * sin + halfHeight * cos,
  }
}

function supportLabel(part: MechanicalPart): 'fixed' | 'pinned' | 'roller' | 'free' {
  if (part.constraints.fixed) return 'fixed'
  if (part.constraints.pinned) return 'pinned'
  if (part.constraints.roller) return 'roller'
  return 'free'
}

export function captureMechanicalSnapshot(parts: readonly MechanicalPart[]): MechanicalSnapshot {
  const warnings: MechanicalSnapshotWarning[] = []
  let highestStressMPa = 0
  let lowestSafetyFactor: number | null = null
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY

  const snapshotParts = parts.map((part): MechanicalSnapshotPart => {
    const ext = halfExtents(part)
    minX = Math.min(minX, part.position[0] - ext.x)
    maxX = Math.max(maxX, part.position[0] + ext.x)
    minY = Math.min(minY, part.position[1] - ext.y)
    maxY = Math.max(maxY, part.position[1] + ext.y)
    minZ = Math.min(minZ, part.position[2] - part.dimensions.width / 2)
    maxZ = Math.max(maxZ, part.position[2] + part.dimensions.width / 2)

    let analysis: MechanicalSnapshotPart['analysis'] = null
    try {
      const result = analysePart(part)
      analysis = {
        stressMPa: round(result.stressPa / 1e6, 6),
        deflectionMm: round(result.deflectionM * 1000, 6),
        safetyFactor: result.safetyFactor === null ? null : round(result.safetyFactor, 4),
        yields: result.yields,
        naturalFrequenciesHz: result.naturalFrequenciesHz.map((value) => round(value, 3)),
        bucklingLoadN: round(result.bucklingLoadN, 3),
      }
      highestStressMPa = Math.max(highestStressMPa, result.stressPa / 1e6)
      if (result.safetyFactor !== null && Number.isFinite(result.safetyFactor)) {
        lowestSafetyFactor =
          lowestSafetyFactor === null ? result.safetyFactor : Math.min(lowestSafetyFactor, result.safetyFactor)
      }
      if (result.yields) {
        warnings.push({
          code: 'yields',
          partId: part.id,
          message: `${part.name} reaches ${fmt(result.stressPa / 1e6, 3)} MPa, above ${part.material.name}'s ${fmt(part.material.yieldStrength / 1e6, 3)} MPa yield strength.`,
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      warnings.push({ code: 'unsupported-part', partId: part.id, message })
    }

    return {
      id: part.id,
      name: part.name,
      kind: part.kind,
      dimensionsMm: {
        length: round(part.dimensions.length * 1000, 4),
        width: round(part.dimensions.width * 1000, 4),
        height: round(part.dimensions.height * 1000, 4),
      },
      positionM: [part.position[0], part.position[1], part.position[2]],
      rotationDeg: [
        round((part.rotation[0] * 180) / Math.PI, 4),
        round((part.rotation[1] * 180) / Math.PI, 4),
        round((part.rotation[2] * 180) / Math.PI, 4),
      ],
      material: {
        key: part.materialKey,
        name: part.material.name,
        densityKgM3: part.material.density,
        youngsModulusPa: part.material.youngsModulus,
        yieldStrengthPa: part.material.yieldStrength,
      },
      massKg: round(part.properties.mass, 9),
      volumeM3: round(part.properties.volume, 12),
      support: supportLabel(part),
      loads: {
        forceN: round(
          part.loads.forces.reduce((sum, load) => sum + load.magnitude, 0),
          6,
        ),
        pressurePa: part.loads.pressure,
        temperatureK: part.loads.temperature,
      },
      analysis,
    }
  })

  const hasParts = snapshotParts.length > 0
  const totalMass = parts.reduce((sum, part) => sum + part.properties.mass, 0)
  const totalVolume = parts.reduce((sum, part) => sum + part.properties.volume, 0)
  const materials = [...new Set(parts.map((part) => part.material.name))].sort()

  return {
    schema: 'folio.mechanical/1',
    units: { length: 'm', drawing: 'mm', mass: 'kg', stress: 'Pa' },
    parts: snapshotParts,
    summary: {
      partCount: snapshotParts.length,
      totalMassKg: round(totalMass, 9),
      totalVolumeM3: round(totalVolume, 12),
      materials,
      boundsMm: hasParts
        ? {
            min: [round(minX * 1000, 4), round(minY * 1000, 4), round(minZ * 1000, 4)],
            max: [round(maxX * 1000, 4), round(maxY * 1000, 4), round(maxZ * 1000, 4)],
            size: [
              round((maxX - minX) * 1000, 4),
              round((maxY - minY) * 1000, 4),
              round((maxZ - minZ) * 1000, 4),
            ],
          }
        : { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0] },
      highestStressMPa: round(highestStressMPa, 6),
      lowestSafetyFactor: lowestSafetyFactor === null ? null : round(lowestSafetyFactor, 4),
      unfinishedParts: warnings.filter((warning) => warning.code === 'unsupported-part').length,
    },
    warnings,
  }
}

/**
 * Deterministic front elevation (X right, Y up) of the assembly, in millimetres.
 * Parts are drawn as rotated rectangles with their names, supports, and the
 * overall envelope; the same drawing is returned to an agent and shown in the
 * workbench, so neither can see a different assembly.
 */
export function mechanicalToSvg(
  parts: readonly MechanicalPart[],
  options: MechanicalSvgOptions = {},
): string {
  const width = Math.max(280, options.width ?? 720)
  const margin = 48
  const title = options.title ?? 'Mechanical assembly · front elevation'
  const titleHeight = 34

  if (parts.length === 0) {
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="140" viewBox="0 0 ${width} 140" role="img" aria-label="Empty mechanical assembly">`,
      '<rect width="100%" height="100%" fill="#0b1220"/>',
      `<text x="${margin}" y="${margin}" font-family="monospace" font-size="12" fill="#94a3b8">${escapeXml(title)}</text>`,
      `<text x="${margin}" y="${margin + 28}" font-family="monospace" font-size="11" fill="#64748b">No parts. Add a beam or plate with mech.addPart.</text>`,
      '</svg>',
    ].join('')
  }

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const part of parts) {
    const ext = halfExtents(part)
    minX = Math.min(minX, part.position[0] - ext.x)
    maxX = Math.max(maxX, part.position[0] + ext.x)
    minY = Math.min(minY, part.position[1] - ext.y)
    maxY = Math.max(maxY, part.position[1] + ext.y)
  }
  const spanX = Math.max(1e-6, maxX - minX)
  const spanY = Math.max(1e-6, maxY - minY)
  const drawableWidth = width - margin * 2
  const scale = drawableWidth / spanX
  const drawableHeight = Math.max(160, Math.min(520, spanY * scale))

  const toX = (metres: number): number => margin + (metres - minX) * scale
  const toY = (metres: number): number => baseline + (maxY - metres) * scale
  const baseline = titleHeight + margin / 2

  // Numbered callouts keep overlapping projections (a wall seen through
  // another wall, a floor beneath both) readable; the legend carries the name
  // and support that would otherwise be drawn on top of each other.
  const shapes = parts.map((part, index) => {
    const cx = toX(part.position[0])
    const cy = toY(part.position[1])
    const w = part.dimensions.length * scale
    const h = part.dimensions.height * scale
    const rotationDeg = (part.rotation[2] * 180) / Math.PI
    const support = supportLabel(part)
    const supportInk =
      support === 'fixed' ? '#f59e0b' : support === 'pinned' ? '#38bdf8' : support === 'roller' ? '#a78bfa' : '#64748b'
    const ext = halfExtents(part)
    const markerY = cy + ext.y * scale
    return [
      `<g transform="translate(${fmt(cx, 2)} ${fmt(cy, 2)}) rotate(${fmt(-rotationDeg, 2)})">`,
      `<rect x="${fmt(-w / 2, 2)}" y="${fmt(-h / 2, 2)}" width="${fmt(Math.max(w, 1), 2)}" height="${fmt(Math.max(h, 1), 2)}" fill="#1d4ed8" fill-opacity="0.28" stroke="#60a5fa" stroke-width="1.4"/>`,
      `<circle cx="0" cy="0" r="7.5" fill="#0b1220" stroke="#93c5fd" stroke-width="1.2"/>`,
      `<text x="0" y="0" text-anchor="middle" dominant-baseline="central" font-family="monospace" font-size="9" fill="#e2e8f0">${index + 1}</text>`,
      '</g>',
      `<line x1="${fmt(cx, 2)}" y1="${fmt(markerY, 2)}" x2="${fmt(cx, 2)}" y2="${fmt(markerY + 6, 2)}" stroke="${supportInk}" stroke-width="2"/>`,
    ].join('')
  }).join('')

  const legend = parts.map((part, index) => `${index + 1} ${part.name} · ${supportLabel(part)}`)
  const charWidth = 5.4
  const maxChars = Math.max(20, Math.floor(drawableWidth / charWidth))
  const legendLines: string[] = []
  for (const entry of legend) {
    const current = legendLines[legendLines.length - 1]
    if (current !== undefined && `${current}   ${entry}`.length <= maxChars) {
      legendLines[legendLines.length - 1] = `${current}   ${entry}`
    } else {
      legendLines.push(entry)
    }
  }
  const legendHeight = legendLines.length > 0 ? legendLines.length * 13 + 8 : 0
  const height = titleHeight + drawableHeight + margin + legendHeight
  const legendTop = baseline + drawableHeight + 14

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${fmt(height, 0)}" viewBox="0 0 ${width} ${fmt(height, 0)}" role="img" aria-label="${escapeXml(title)}">`,
    '<rect width="100%" height="100%" fill="#0b1220"/>',
    `<text x="${margin}" y="24" font-family="monospace" font-size="12" fill="#94a3b8">${escapeXml(title)}</text>`,
    `<text x="${width - margin}" y="24" text-anchor="end" font-family="monospace" font-size="10" fill="#64748b">${fmt(spanX * 1000, 1)} × ${fmt(spanY * 1000, 1)} mm envelope</text>`,
    `<rect x="${margin}" y="${baseline}" width="${fmt(drawableWidth, 2)}" height="${fmt(drawableHeight, 2)}" fill="#0f172a" stroke="#334155" stroke-width="1" stroke-dasharray="3 4"/>`,
    shapes,
    ...legendLines.map((line, index) =>
      `<text x="${margin}" y="${fmt(legendTop + index * 13, 2)}" font-family="monospace" font-size="9" fill="#94a3b8">${escapeXml(line)}</text>`,
    ),
    `<text x="${margin}" y="${fmt(height - 12, 2)}" font-family="monospace" font-size="9" fill="#64748b">Front elevation (X × Y). Callouts are keyed below. Nominal model dimensions.</text>`,
    '</svg>',
  ].join('')
}
