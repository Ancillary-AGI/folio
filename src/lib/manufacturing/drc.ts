import type { PlacedComponent, Point } from '../../types'
import { polylineDistance, polylineLength } from '../geometry/distance'
import {
  landShapeOf,
  polylineShapeDistanceMm,
  shapeCircumRadiusMm,
  shapeGapMm,
  type LandShape,
} from '../geometry/landShape'
import type { PCBDesign, PCBKeepout, PCBPad, PCBTrace, PCBVIA } from './pcb'

export type DRCRuleType =
  | 'clearance'
  | 'width'
  | 'drill'
  | 'annular_ring'
  | 'courtyard_overlap'
  | 'unconnected_net'
  | 'acute_angle'
  | 'trace_length'
  | 'keepout'
  | 'outline'

export interface DRCViolation {
  type: DRCRuleType
  severity: 'error' | 'warning'
  message: string
  location: { x: number; y: number }
  elementId: string
  layer?: string
  value?: number
  required?: number
}

export interface DRCResult {
  isValid: boolean
  violations: DRCViolation[]
  summary: {
    errors: number
    warnings: number
    totalViolations: number
  }
}

export interface DRCSettings {
  minTraceWidth: number
  minTraceClearance: number
  minViaDiameter: number
  minViaDrillDiameter: number
  minPadDiameter: number
  /**
   * Smallest copper a *surface* land may print. A plated through pad is bounded
   * by its annular ring, so `minPadDiameter` carries that figure; a 0603 or a
   * QFP land has no hole to ring and is limited by what the etch can hold.
   */
  minSurfacePadWidth: number
  minAnnularRing: number
  minCourtyardClearance: number
  maxTraceWidth: number
  minHoleDiameter: number
  checkUnconnectedNets: boolean
  checkAcuteAngles: boolean
  checkTraceLength: boolean
  maxTraceLength: number
  /**
   * Audit routed copper against the board outline. Off by default because a
   * caller that has not told the checker where its outline starts would export
   * errors for a coordinate frame it never supplied; the PCB panel knows its
   * origin and turns it on.
   */
  checkBoardOutline: boolean
}

export const DEFAULT_DRC_RULES: DRCSettings = {
  minTraceWidth: 0.2,
  minTraceClearance: 0.2,
  minViaDiameter: 0.4,
  minViaDrillDiameter: 0.2,
  minPadDiameter: 0.5,
  minSurfacePadWidth: 0.15,
  minAnnularRing: 0.1,
  minCourtyardClearance: 0.25,
  maxTraceWidth: 2.0,
  minHoleDiameter: 0.3,
  checkUnconnectedNets: true,
  checkAcuteAngles: true,
  checkTraceLength: false,
  maxTraceLength: 100.0,
  checkBoardOutline: false,
}

/** Axis-aligned courtyard of a placed part, in board millimetres. */
function courtyardOf(component: PlacedComponent): { width: number; height: number } {
  const symbol = component.component.symbol
  const scale = Number.isFinite(component.scale) && component.scale > 0 ? component.scale : 1
  const rawWidth = symbol?.width && symbol.width > 0 ? symbol.width : 10
  const rawHeight = symbol?.height && symbol.height > 0 ? symbol.height : 10
  const rotation = Number.isFinite(component.rotation) ? component.rotation : 0
  const quarterTurn = Math.abs(Math.round(rotation / 90)) % 2 === 1
  return {
    width: (quarterTurn ? rawHeight : rawWidth) * scale,
    height: (quarterTurn ? rawWidth : rawHeight) * scale,
  }
}

const TOUCH_EPSILON = 1e-9

/** True when two layer sets share copper (an empty set means all layers). */
function layersOverlap(a: readonly string[], b: readonly string[]): boolean {
  return a.length === 0 || b.length === 0 || a.some(layer => b.includes(layer))
}

/**
 * A piece of copper the checker measures: the outline a pad or via prints, at
 * the position it was placed. Precomputing it keeps the rotated arithmetic out
 * of the inner loops, where every pair of pads on a dense board would otherwise
 * rebuild the same shape twice.
 */
interface CopperOutline {
  shape: LandShape
  x: number
  y: number
  /** Radius of the disc that contains the outline, for a cheap near-miss test. */
  reachMm: number
}

function outlineOf(pad: PCBPad): CopperOutline {
  const shape = landShapeOf({
    widthMm: pad.size.width,
    depthMm: pad.size.height,
    shape: pad.shape,
    rotationDeg: pad.rotationDeg,
  })
  return { shape, x: pad.position.x, y: pad.position.y, reachMm: shapeCircumRadiusMm(shape) }
}

function outlineOfVia(via: PCBVIA): CopperOutline {
  const radiusMm = via.diameter / 2
  return { shape: { kind: 'circle', radiusMm }, x: via.position.x, y: via.position.y, reachMm: radiusMm }
}

/** Axis-aligned bounds of a polyline, for ruling a far-away pad out of its test. */
function polylineBounds(points: readonly Point[]): { minX: number, minY: number, maxX: number, maxY: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of points) {
    if (point.x < minX) minX = point.x
    if (point.y < minY) minY = point.y
    if (point.x > maxX) maxX = point.x
    if (point.y > maxY) maxY = point.y
  }
  return { minX, minY, maxX, maxY }
}

/** Distance from a point to an axis-aligned box; zero on or inside it. */
function pointBoxDistance(x: number, y: number, box: { minX: number, minY: number, maxX: number, maxY: number }): number {
  const dx = Math.max(box.minX - x, 0, x - box.maxX)
  const dy = Math.max(box.minY - y, 0, y - box.maxY)
  return Math.hypot(dx, dy)
}

/**
 * Copper-to-copper gap between two pads in millimetres; negative means overlap.
 * Both outlines are the shapes their footprints really print, so a land rotated
 * 90° with its part is measured end-on rather than as its unrotated box.
 */
function padPadCopperGap(a: CopperOutline, b: CopperOutline): number {
  return shapeGapMm(a.shape, b.shape, b.x - a.x, b.y - a.y)
}

/** Copper gap between a pad and a via barrel in millimetres. */
function padViaCopperGap(pad: CopperOutline, via: CopperOutline): number {
  return shapeGapMm(pad.shape, via.shape, via.x - pad.x, via.y - pad.y)
}

/** Copper gap between a pad and a trace edge, millimetres. */
function padTraceCopperGap(pad: CopperOutline, trace: PCBTrace): number {
  return (
    polylineShapeDistanceMm(trace.points, { x: pad.x, y: pad.y }, pad.shape) -
    trace.width / 2
  )
}

/** Copper gap between a via barrel and a trace edge, millimetres. */
function viaTraceCopperGap(via: PCBVIA, trace: PCBTrace): number {
  return polylineDistance([via.position], trace.points) - via.diameter / 2 - trace.width / 2
}

/**
 * Gap between two axis-aligned courtyards in millimetres; negative means the
 * boxes overlap by that depth. Separation on either axis makes the gap
 * positive even when the boxes still overlap on the other axis.
 */
function courtyardGap(a: PlacedComponent, b: PlacedComponent): number {
  const ca = courtyardOf(a)
  const cb = courtyardOf(b)
  const dx = Math.abs(a.position.x - b.position.x) - (ca.width + cb.width) / 2
  const dy = Math.abs(a.position.y - b.position.y) - (ca.height + cb.height) / 2
  return Math.max(dx, dy)
}

/** Axis-aligned bounds of a keep-out in board millimetres. */
function keepoutBounds(keepout: PCBKeepout): { minX: number, minY: number, maxX: number, maxY: number } {
  return {
    minX: keepout.x,
    minY: keepout.y,
    maxX: keepout.x + keepout.width,
    maxY: keepout.y + keepout.height,
  }
}

/** A keep-out as the outline the shared geometry measures. */
function keepoutShape(keepout: PCBKeepout): LandShape {
  return {
    kind: 'rectangle',
    halfWidthMm: keepout.width / 2,
    halfHeightMm: keepout.height / 2,
    rotationRad: 0,
  }
}

function keepoutCentre(keepout: PCBKeepout): Point {
  return { x: keepout.x + keepout.width / 2, y: keepout.y + keepout.height / 2 }
}

/**
 * Gap between a piece of copper and a keep-out's boundary; zero or negative means
 * the copper reaches into the reserved region. A keep-out is a prohibition on
 * copper, not a clearance rule, so touching the boundary already fails.
 */
function copperKeepoutGap(
  keepout: PCBKeepout,
  centre: Point,
  offsetX: number,
  offsetY: number,
): number {
  return pointBoxDistance(centre.x + offsetX, centre.y + offsetY, keepoutBounds(keepout))
}

/**
 * Copper-to-copper gap between a land outline and a keep-out, measured in the
 * keep-out's own axis-aligned frame. Negative means the land is inside.
 */
function padKeepoutGap(pad: CopperOutline, keepout: PCBKeepout): number {
  const centre = keepoutCentre(keepout)
  return shapeGapMm(pad.shape, keepoutShape(keepout), centre.x - pad.x, centre.y - pad.y)
}

export class DesignRuleChecker {
  private design: PCBDesign
  private rules: DRCSettings
  /**
   * Land outlines for this design, measured once. Rotating a pad's rectangle is
   * trigonometry, not a comparison, and a dense board runs the pad tests over
   * millions of pairs.
   */
  private cachedOutlines: CopperOutline[] | null = null

  constructor(design: PCBDesign, rules?: Partial<DRCSettings>) {
    this.design = design
    this.rules = { ...DEFAULT_DRC_RULES, ...rules }
  }

  private padOutlines(): CopperOutline[] {
    if (!this.cachedOutlines) this.cachedOutlines = this.design.pads.map(outlineOf)
    return this.cachedOutlines
  }

  runDRC(): DRCResult {
    const violations: DRCViolation[] = [
      ...this.checkTraceWidths(),
      ...this.checkTraceClearances(),
      ...this.checkViaSizes(),
      ...this.checkViaClearances(),
      ...this.checkPadSizes(),
      ...this.checkPadClearances(),
      ...this.checkPadPadClearances(),
      ...this.checkPadViaClearances(),
      ...this.checkCourtyardOverlaps(),
      ...this.checkKeepouts(),
      ...this.checkBoardOutline(),
    ]

    if (this.rules.checkUnconnectedNets) violations.push(...this.checkUnconnectedNets())
    if (this.rules.checkAcuteAngles) violations.push(...this.checkAcuteAngles())
    if (this.rules.checkTraceLength) violations.push(...this.checkTraceLengths())

    const errors = violations.filter(v => v.severity === 'error').length
    const warnings = violations.filter(v => v.severity === 'warning').length

    return {
      isValid: errors === 0,
      violations,
      summary: { errors, warnings, totalViolations: violations.length },
    }
  }

  private checkTraceWidths(): DRCViolation[] {
    const violations: DRCViolation[] = []
    for (const trace of this.design.traces) {
      if (trace.width < this.rules.minTraceWidth) {
        violations.push({
          type: 'width',
          severity: 'error',
          message: `Trace "${trace.id}" width ${trace.width}mm is below minimum ${this.rules.minTraceWidth}mm`,
          location: this.getTraceCenter(trace),
          elementId: trace.id,
          layer: trace.layerId,
          value: trace.width,
          required: this.rules.minTraceWidth,
        })
      }
      if (trace.width > this.rules.maxTraceWidth) {
        violations.push({
          type: 'width',
          severity: 'warning',
          message: `Trace "${trace.id}" width ${trace.width}mm exceeds maximum ${this.rules.maxTraceWidth}mm`,
          location: this.getTraceCenter(trace),
          elementId: trace.id,
          layer: trace.layerId,
          value: trace.width,
          required: this.rules.maxTraceWidth,
        })
      }
    }
    return violations
  }

  private checkTraceClearances(): DRCViolation[] {
    const violations: DRCViolation[] = []
    const traces = this.design.traces

    for (let i = 0; i < traces.length; i += 1) {
      for (let j = i + 1; j < traces.length; j += 1) {
        const trace1 = traces[i]
        const trace2 = traces[j]
        if (trace1.netId === trace2.netId) continue
        // Copper only interacts on the same layer; a through-hole via bridges
        // layers and is checked separately.
        if (trace1.layerId && trace2.layerId && trace1.layerId !== trace2.layerId) continue

        const clearance = polylineDistance(trace1.points, trace2.points)
          - (trace1.width + trace2.width) / 2
        if (clearance < this.rules.minTraceClearance) {
          violations.push({
            type: 'clearance',
            severity: 'error',
            message: `Trace clearance ${Math.max(0, clearance).toFixed(3)}mm between "${trace1.id}" and "${trace2.id}" is below minimum ${this.rules.minTraceClearance}mm`,
            location: this.getTraceCenter(trace1),
            elementId: trace1.id,
            layer: trace1.layerId,
            value: Math.max(0, clearance),
            required: this.rules.minTraceClearance,
          })
        }
      }
    }

    return violations
  }

  private checkViaSizes(): DRCViolation[] {
    const violations: DRCViolation[] = []
    for (const via of this.design.vias) {
      if (via.diameter < this.rules.minViaDiameter) {
        violations.push({
          type: 'drill',
          severity: 'error',
          message: `Via "${via.id}" diameter ${via.diameter}mm is below minimum ${this.rules.minViaDiameter}mm`,
          location: via.position,
          elementId: via.id,
          value: via.diameter,
          required: this.rules.minViaDiameter,
        })
      }
      if (via.drillDiameter < this.rules.minViaDrillDiameter) {
        violations.push({
          type: 'drill',
          severity: 'error',
          message: `Via "${via.id}" drill diameter ${via.drillDiameter}mm is below minimum ${this.rules.minViaDrillDiameter}mm`,
          location: via.position,
          elementId: via.id,
          value: via.drillDiameter,
          required: this.rules.minViaDrillDiameter,
        })
      }
      const annularRing = (via.diameter - via.drillDiameter) / 2
      if (annularRing < this.rules.minAnnularRing) {
        violations.push({
          type: 'annular_ring',
          severity: 'error',
          message: `Via "${via.id}" annular ring ${annularRing.toFixed(3)}mm is below minimum ${this.rules.minAnnularRing}mm`,
          location: via.position,
          elementId: via.id,
          value: annularRing,
          required: this.rules.minAnnularRing,
        })
      }
    }
    return violations
  }

  private checkViaClearances(): DRCViolation[] {
    const violations: DRCViolation[] = []
    const { vias, traces } = this.design

    for (const via of vias) {
      for (const trace of traces) {
        if (via.netId !== undefined && trace.netId === via.netId) continue
        if (via.layers.length > 0 && !via.layers.includes(trace.layerId)) continue
        const gap = viaTraceCopperGap(via, trace)
        if (gap < this.rules.minTraceClearance) {
          violations.push({
            type: 'clearance',
            severity: 'error',
            message: `Via "${via.id}" clearance ${Math.max(0, gap).toFixed(3)}mm to trace "${trace.id}" is below minimum ${this.rules.minTraceClearance}mm`,
            location: via.position,
            elementId: via.id,
            layer: trace.layerId,
            value: Math.max(0, gap),
            required: this.rules.minTraceClearance,
          })
        }
      }
    }

    for (let i = 0; i < vias.length; i += 1) {
      for (let j = i + 1; j < vias.length; j += 1) {
        const a = vias[i]
        const b = vias[j]
        if (a.netId !== undefined && a.netId === b.netId) continue
        const shareLayer =
          a.layers.length === 0 ||
          b.layers.length === 0 ||
          a.layers.some(layer => b.layers.includes(layer))
        if (!shareLayer) continue
        const gap = Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y)
          - (a.diameter + b.diameter) / 2
        if (gap < this.rules.minTraceClearance) {
          violations.push({
            type: 'clearance',
            severity: 'error',
            message: `Via clearance ${Math.max(0, gap).toFixed(3)}mm between "${a.id}" and "${b.id}" is below minimum ${this.rules.minTraceClearance}mm`,
            location: a.position,
            elementId: a.id,
            value: Math.max(0, gap),
            required: this.rules.minTraceClearance,
          })
        }
      }
    }

    return violations
  }

  private checkPadSizes(): DRCViolation[] {
    const violations: DRCViolation[] = []
    for (const pad of this.design.pads) {
      const padSize = Math.min(pad.size.width, pad.size.height)
      const drilled = (pad.drillDiameter ?? 0) > 0
      // A surface land has no hole to ring, so it answers to the etch limit; only
      // plated copper answers to the annular figure.
      const minimum = drilled ? this.rules.minPadDiameter : this.rules.minSurfacePadWidth
      if (padSize < minimum) {
        violations.push({
          type: 'width',
          severity: 'error',
          message: `Pad "${pad.id}" size ${padSize}mm is below minimum ${minimum}mm`,
          location: pad.position,
          elementId: pad.id,
          value: padSize,
          required: minimum,
        })
      }
      if (drilled && pad.drillDiameter) {
        if (pad.drillDiameter < this.rules.minHoleDiameter) {
          violations.push({
            type: 'drill',
            severity: 'error',
            message: `Pad "${pad.id}" drill diameter ${pad.drillDiameter}mm is below minimum ${this.rules.minHoleDiameter}mm`,
            location: pad.position,
            elementId: pad.id,
            value: pad.drillDiameter,
            required: this.rules.minHoleDiameter,
          })
        }
        const annularRing = (padSize - pad.drillDiameter) / 2
        if (annularRing < this.rules.minAnnularRing) {
          violations.push({
            type: 'annular_ring',
            severity: 'error',
            message: `Pad "${pad.id}" annular ring ${annularRing.toFixed(3)}mm is below minimum ${this.rules.minAnnularRing}mm`,
            location: pad.position,
            elementId: pad.id,
            value: annularRing,
            required: this.rules.minAnnularRing,
          })
        }
      }
    }
    return violations
  }

  private checkPadClearances(): DRCViolation[] {
    const violations: DRCViolation[] = []
    const outlines = this.padOutlines()
    // A trace's bounding box rules out every pad whose containing disc cannot
    // reach it; on a board with thousands of lands that pruning is the whole
    // difference between a check that answers and one that runs for a minute.
    const bounds = this.design.traces.map(trace => polylineBounds(trace.points))

    this.design.pads.forEach((pad, padIndex) => {
      if (!pad.netId) return
      const outline = outlines[padIndex]
      this.design.traces.forEach((trace, traceIndex) => {
        if (trace.netId === pad.netId) return
        if (pad.layers.length > 0 && !pad.layers.includes(trace.layerId)) return
        const box = bounds[traceIndex]
        const near = outline.reachMm + trace.width / 2 + this.rules.minTraceClearance
        if (pointBoxDistance(outline.x, outline.y, box) > near) return

        const copperGap = padTraceCopperGap(outline, trace)
        if (copperGap < this.rules.minTraceClearance) {
          violations.push({
            type: 'clearance',
            severity: 'error',
            message: `Pad "${pad.id}" clearance ${Math.max(0, copperGap).toFixed(3)}mm to trace "${trace.id}" is below minimum ${this.rules.minTraceClearance}mm`,
            location: pad.position,
            elementId: pad.id,
            layer: trace.layerId,
            value: Math.max(0, copperGap),
            required: this.rules.minTraceClearance,
          })
        }
      })
    })
    return violations
  }

  private checkPadPadClearances(): DRCViolation[] {
    const violations: DRCViolation[] = []
    const pads = this.design.pads
    const outlines = this.padOutlines()

    for (let i = 0; i < pads.length; i += 1) {
      for (let j = i + 1; j < pads.length; j += 1) {
        const a = pads[i]
        const b = pads[j]
        // Pads of one footprint follow the package's own pitch, not the board
        // clearance; same-net pads are allowed to touch by design.
        if (a.componentId === b.componentId) continue
        if (a.netId && a.netId === b.netId) continue
        if (!layersOverlap(a.layers, b.layers)) continue
        if (
          Math.hypot(b.position.x - a.position.x, b.position.y - a.position.y)
          >= outlines[i].reachMm + outlines[j].reachMm + this.rules.minTraceClearance
        ) continue

        const gap = padPadCopperGap(outlines[i], outlines[j])
        if (gap < this.rules.minTraceClearance) {
          violations.push({
            type: 'clearance',
            severity: 'error',
            message: `Pad clearance ${Math.max(0, gap).toFixed(3)}mm between "${a.id}" and "${b.id}" is below minimum ${this.rules.minTraceClearance}mm`,
            location: {
              x: (a.position.x + b.position.x) / 2,
              y: (a.position.y + b.position.y) / 2,
            },
            elementId: a.id,
            value: Math.max(0, gap),
            required: this.rules.minTraceClearance,
          })
        }
      }
    }
    return violations
  }

  private checkPadViaClearances(): DRCViolation[] {
    const violations: DRCViolation[] = []
    const outlines = this.padOutlines()
    const vias = this.design.vias.map(outlineOfVia)

    this.design.pads.forEach((pad, padIndex) => {
      const outline = outlines[padIndex]
      this.design.vias.forEach((via, viaIndex) => {
        if (pad.netId && via.netId && pad.netId === via.netId) return
        if (!layersOverlap(pad.layers, via.layers)) return
        const other = vias[viaIndex]
        if (Math.hypot(other.x - outline.x, other.y - outline.y) >= outline.reachMm + other.reachMm + this.rules.minTraceClearance) return

        const gap = padViaCopperGap(outline, other)
        if (gap < this.rules.minTraceClearance) {
          violations.push({
            type: 'clearance',
            severity: 'error',
            message: `Pad "${pad.id}" clearance ${Math.max(0, gap).toFixed(3)}mm to via "${via.id}" is below minimum ${this.rules.minTraceClearance}mm`,
            location: pad.position,
            elementId: pad.id,
            value: Math.max(0, gap),
            required: this.rules.minTraceClearance,
          })
        }
      })
    })
    return violations
  }

  private checkCourtyardOverlaps(): DRCViolation[] {
    const violations: DRCViolation[] = []
    const components = this.design.components

    for (let i = 0; i < components.length; i += 1) {
      for (let j = i + 1; j < components.length; j += 1) {
        const gap = courtyardGap(components[i], components[j])
        if (gap < this.rules.minCourtyardClearance) {
          violations.push({
            type: 'courtyard_overlap',
            severity: 'warning',
            message: `Courtyard gap ${gap.toFixed(3)}mm between "${components[i].reference}" and "${components[j].reference}" is below minimum ${this.rules.minCourtyardClearance}mm`,
            location: {
              x: (components[i].position.x + components[j].position.x) / 2,
              y: (components[i].position.y + components[j].position.y) / 2,
            },
            elementId: components[i].id,
            value: gap,
            required: this.rules.minCourtyardClearance,
          })
        }
      }
    }
    return violations
  }

  /**
   * Copper inside a region the designer reserved.
   *
   * Every element is tested on the layers it actually owns: a keep-out scoped to
   * the top film leaves a bottom-only route legal, while an unscoped keep-out
   * bars a via wherever its barrel would land. The check reads the same
   * rectangles the router reserved, so a keep-out that blocked routing cannot
   * then be reported clean because someone drew copper over it by hand.
   */
  private checkKeepouts(): DRCViolation[] {
    const violations: DRCViolation[] = []
    const keepouts = this.design.keepouts ?? []
    if (keepouts.length === 0) return violations

    for (const keepout of keepouts) {
      const centre = keepoutCentre(keepout)
      const layers = keepout.layers.length === 0 ? null : new Set(keepout.layers)
      const onKeepoutLayer = (elementLayers: readonly string[]): boolean =>
        layers === null || elementLayers.some(layer => layers.has(layer))
      const report = (elementId: string, kind: string, layer?: string): void => {
        violations.push({
          type: 'keepout',
          severity: 'error',
          message: `Keep-out "${keepout.id}" contains copper of ${kind} "${elementId}"`,
          location: centre,
          elementId,
          layer,
        })
      }

      for (const trace of this.design.traces) {
        if (!onKeepoutLayer([trace.layerId])) continue
        const gap = polylineShapeDistanceMm(trace.points, centre, keepoutShape(keepout))
          - trace.width / 2
        if (gap <= TOUCH_EPSILON) report(trace.id, 'trace', trace.layerId)
      }

      for (const via of this.design.vias) {
        // A barrel spans the stackup, so it crosses every layer the keep-out
        // names, whichever face the landing is tested on.
        if (!onKeepoutLayer(via.layers)) continue
        const gap = copperKeepoutGap(keepout, via.position, 0, 0) - via.diameter / 2
        if (gap <= TOUCH_EPSILON) report(via.id, 'via')
      }

      this.design.pads.forEach((pad, index) => {
        if (!onKeepoutLayer(pad.layers)) return
        if (padKeepoutGap(this.padOutlines()[index], keepout) <= TOUCH_EPSILON) {
          report(pad.id, 'land')
        }
      })
    }

    return violations
  }

  /**
   * Routed copper outside the board outline.
   *
   * Lands are exempt: an edge connector is supposed to overhang its outline, and
   * flagging one would teach the designer to ignore this rule. A track or a via
   * whose copper crosses zero or the far edge cannot be fabricated, so it is the
   * case this reports. Off unless the caller has supplied a coordinate frame.
   */
  private checkBoardOutline(): DRCViolation[] {
    if (!this.rules.checkBoardOutline) return []
    const violations: DRCViolation[] = []
    const width = this.design.dimensions.width
    const height = this.design.dimensions.height
    // A copper extent is outside when either of its edges leaves [low, high].
    const overhangs = (min: number, max: number, low: number, high: number): boolean =>
      min < low - TOUCH_EPSILON || max > high + TOUCH_EPSILON
    const crosses = (x: number, y: number, half: number): boolean =>
      overhangs(x - half, x + half, 0, width) || overhangs(y - half, y + half, 0, height)

    for (const trace of this.design.traces) {
      const half = trace.width / 2
      const crossing = trace.points.find(point => crosses(point.x, point.y, half))
      if (crossing) {
        violations.push({
          type: 'outline',
          severity: 'error',
          message: `Trace "${trace.id}" crosses the board outline`,
          location: crossing,
          elementId: trace.id,
          layer: trace.layerId,
        })
      }
    }

    for (const via of this.design.vias) {
      if (crosses(via.position.x, via.position.y, via.diameter / 2)) {
        violations.push({
          type: 'outline',
          severity: 'error',
          message: `Via "${via.id}" crosses the board outline`,
          location: via.position,
          elementId: via.id,
        })
      }
    }

    return violations
  }

  /**
   * Reports both an entirely unrouted net and one whose copper forms separate
   * islands. The second case is what a "has any copper" rule misses: two pads
   * joined by nothing look routed to a per-net presence test but are open on
   * the board. Islands are found by unioning every pair of copper elements
   * that physically touch on a shared layer, so the result reflects geometry
   * rather than naming.
   */
  private checkUnconnectedNets(): DRCViolation[] {
    const violations: DRCViolation[] = []
    const outlines = this.padOutlines()
    const copper = this.design.pads.map((pad, index) => ({ pad, outline: outlines[index] }))
    for (const net of this.design.nets) {
      const pads = copper.filter(entry => entry.pad.netId === net.id)
      const traces = this.design.traces.filter(trace => trace.netId === net.id)
      const vias = this.design.vias.filter(via => via.netId === net.id)

      if (traces.length === 0 && vias.length === 0) {
        violations.push({
          type: 'unconnected_net',
          severity: 'warning',
          message: pads.length > 0
            ? `Net "${net.name}" has ${pads.length} pad(s) but no routed copper`
            : `Net "${net.name}" is not connected to any pads, traces, or vias`,
          location: pads[0]?.pad.position ?? { x: 0, y: 0 },
          elementId: net.id,
        })
        continue
      }
      if (pads.length < 2) continue

      const padOffset = 0
      const traceOffset = pads.length
      const viaOffset = pads.length + traces.length
      const parent = Array.from({ length: viaOffset + vias.length }, (_, index) => index)
      const find = (index: number): number => {
        let root = index
        while (parent[root] !== root) root = parent[root]
        let walk = index
        while (parent[walk] !== root) {
          const next = parent[walk]
          parent[walk] = root
          walk = next
        }
        return root
      }
      const union = (a: number, b: number): void => {
        const rootA = find(a)
        const rootB = find(b)
        if (rootA !== rootB) parent[rootB] = rootA
      }
      const touching = (gap: number): boolean => gap <= TOUCH_EPSILON

      const viaOutlines = vias.map(outlineOfVia)
      for (let i = 0; i < pads.length; i += 1) {
        const { pad, outline } = pads[i]
        for (let j = i + 1; j < pads.length; j += 1) {
          if (
            layersOverlap(pad.layers, pads[j].pad.layers)
            && touching(padPadCopperGap(outline, pads[j].outline))
          ) {
            union(padOffset + i, padOffset + j)
          }
        }
        for (let j = 0; j < traces.length; j += 1) {
          const trace = traces[j]
          if (layersOverlap(pad.layers, [trace.layerId]) && touching(padTraceCopperGap(outline, trace))) {
            union(padOffset + i, traceOffset + j)
          }
        }
        for (let j = 0; j < vias.length; j += 1) {
          if (layersOverlap(pad.layers, vias[j].layers) && touching(padViaCopperGap(outline, viaOutlines[j]))) {
            union(padOffset + i, viaOffset + j)
          }
        }
      }
      for (let i = 0; i < traces.length; i += 1) {
        const trace = traces[i]
        for (let j = i + 1; j < traces.length; j += 1) {
          const other = traces[j]
          if (trace.layerId !== other.layerId) continue
          const gap = polylineDistance(trace.points, other.points) - (trace.width + other.width) / 2
          if (touching(gap)) union(traceOffset + i, traceOffset + j)
        }
        for (let j = 0; j < vias.length; j += 1) {
          const via = vias[j]
          if (layersOverlap([trace.layerId], via.layers) && touching(viaTraceCopperGap(via, trace))) {
            union(traceOffset + i, viaOffset + j)
          }
        }
      }
      for (let i = 0; i < vias.length; i += 1) {
        for (let j = i + 1; j < vias.length; j += 1) {
          const a = vias[i]
          const b = vias[j]
          if (!layersOverlap(a.layers, b.layers)) continue
          const gap = Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y)
            - (a.diameter + b.diameter) / 2
          if (touching(gap)) union(viaOffset + i, viaOffset + j)
        }
      }

      const islands = new Map<number, number[]>()
      for (let i = 0; i < pads.length; i += 1) {
        const root = find(padOffset + i)
        const group = islands.get(root)
        if (group) group.push(i)
        else islands.set(root, [i])
      }
      if (islands.size <= 1) continue

      const groups = [...islands.values()].sort((a, b) => b.length - a.length)
      const stranded = groups.slice(1).flat()
      violations.push({
        type: 'unconnected_net',
        severity: 'warning',
        message:
          `Net "${net.name}" is split across ${islands.size} disconnected copper groups ` +
          `(${stranded.length} pad(s) stranded)`,
        location: pads[stranded[0]].pad.position,
        elementId: net.id,
      })
    }
    return violations
  }

  private checkAcuteAngles(): DRCViolation[] {
    const violations: DRCViolation[] = []
    for (const trace of this.design.traces) {
      for (let i = 1; i < trace.points.length - 1; i += 1) {
        const angle = this.calculateAngle(trace.points[i - 1], trace.points[i], trace.points[i + 1])
        if (Number.isFinite(angle) && angle < 90) {
          violations.push({
            type: 'acute_angle',
            severity: 'warning',
            message: `Acute angle ${angle.toFixed(1)}° found in trace "${trace.id}"`,
            location: trace.points[i],
            elementId: trace.id,
            layer: trace.layerId,
          })
        }
      }
    }
    return violations
  }

  private checkTraceLengths(): DRCViolation[] {
    const violations: DRCViolation[] = []
    for (const trace of this.design.traces) {
      const length = polylineLength(trace.points)
      if (length > this.rules.maxTraceLength) {
        violations.push({
          type: 'trace_length',
          severity: 'warning',
          message: `Trace "${trace.id}" length ${length.toFixed(2)}mm exceeds maximum ${this.rules.maxTraceLength}mm`,
          location: this.getTraceCenter(trace),
          elementId: trace.id,
          layer: trace.layerId,
          value: length,
          required: this.rules.maxTraceLength,
        })
      }
    }
    return violations
  }

  private getTraceCenter(trace: PCBTrace): { x: number; y: number } {
    if (trace.points.length === 0) return { x: 0, y: 0 }
    let sumX = 0
    let sumY = 0
    for (const point of trace.points) {
      sumX += point.x
      sumY += point.y
    }
    return { x: sumX / trace.points.length, y: sumY / trace.points.length }
  }

  private calculateAngle(p1: Point, p2: Point, p3: Point): number {
    const v1 = { x: p1.x - p2.x, y: p1.y - p2.y }
    const v2 = { x: p3.x - p2.x, y: p3.y - p2.y }
    const mag1 = Math.hypot(v1.x, v1.y)
    const mag2 = Math.hypot(v2.x, v2.y)
    if (mag1 === 0 || mag2 === 0) return Number.NaN
    const cosAngle = (v1.x * v2.x + v1.y * v2.y) / (mag1 * mag2)
    return Math.acos(Math.max(-1, Math.min(1, cosAngle))) * (180 / Math.PI)
  }

  updateRules(newRules: Partial<DRCSettings>): void {
    this.rules = { ...this.rules, ...newRules }
  }

  getRules(): DRCSettings {
    return { ...this.rules }
  }
}
