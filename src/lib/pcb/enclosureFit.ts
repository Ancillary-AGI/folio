/**
 * Enclosure fit. Compares the board stack — outline plus every body, pad and
 * via that hangs off it — against an imported enclosure mesh, and reports the
 * room left on each side.
 *
 * The comparison is a bounding-box comparison. An imported shell carries no
 * feature tree, so bosses, ribs, connector cut-outs and a lid that dishes
 * inward are invisible to this check; the verdict is about the envelope, not a
 * proof the board assembles. The numbers are honest about that.
 */

import type { MeshReport } from '../3d/meshMeasure'
import type { PcbScene } from './pcbScene'

/** Board-centred millimetres. Y is the stack axis, so Z is the board's depth. */
export interface Envelope {
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
  /** True when nothing was placed, so the box has no extent to speak of. */
  empty: boolean
}

export interface EnclosureClearanceMm {
  /** Room between the stack and the enclosure walls at −X, +X, −Z, +Z. */
  negX: number
  posX: number
  negZ: number
  posZ: number
  /** Room below the board (negY) and above the tallest feature (posY). */
  negY: number
  posY: number
}

export interface EnclosureFit {
  /** The enclosure's own bounding box — the cavity only if the shell is a simple box. */
  cavityMm: { width: number; depth: number; height: number }
  /** The board stack: outline and everything mounted on it. */
  stackMm: { width: number; depth: number; height: number }
  clearanceMm: EnclosureClearanceMm
  /** The smallest of the six clearances; negative means the stack leaves the box. */
  tightestMm: number
  /** True when every side has non-negative room. */
  fits: boolean
  /** Stated because the model's own origin is not trusted. */
  alignment: 'bounding-box centres coincident'
  shellClosed: boolean | null
  openEdges: number
  nonManifoldEdges: number
  inconsistentEdges: number
}

/**
 * The extent of what has been placed on the board: bodies on both sides, pads
 * and vias at their own diameter, copper at its own width. The board outline is
 * deliberately not included — a tightly placed circuit frames tighter than the
 * panel it sits on.
 */
export function contentEnvelope(scene: PcbScene): Envelope {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  let minY = -scene.board.thicknessMm / 2
  let maxY = scene.board.thicknessMm / 2

  const include = (x: number, z: number, radius: number): void => {
    minX = Math.min(minX, x - radius)
    maxX = Math.max(maxX, x + radius)
    minZ = Math.min(minZ, z - radius)
    maxZ = Math.max(maxZ, z + radius)
  }

  for (const component of scene.components) {
    include(
      component.position.x,
      component.position.z,
      Math.max(component.bodyWidthMm, component.bodyDepthMm) / 2,
    )
    for (const pad of component.pads) {
      include(pad.position.x, pad.position.z, Math.max(pad.widthMm, pad.depthMm) / 2)
    }
    minY = Math.min(minY, component.position.y - component.bodyHeightMm / 2)
    maxY = Math.max(maxY, component.position.y + component.bodyHeightMm / 2)
  }
  for (const trace of scene.traces) {
    include(trace.start.x, trace.start.z, trace.widthMm / 2)
    include(trace.end.x, trace.end.z, trace.widthMm / 2)
  }
  for (const via of scene.vias) {
    include(via.position.x, via.position.z, via.padDiameterMm / 2)
  }

  const empty = !Number.isFinite(minX)
  return { minX, maxX, minY, maxY, minZ, maxZ, empty }
}

/** The content envelope widened to the board outline, which always has to fit. */
export function stackEnvelope(scene: PcbScene): Envelope {
  const content = contentEnvelope(scene)
  return {
    minX: Math.min(content.minX, -scene.board.widthMm / 2),
    maxX: Math.max(content.maxX, scene.board.widthMm / 2),
    minY: content.minY,
    maxY: content.maxY,
    minZ: Math.min(content.minZ, -scene.board.heightMm / 2),
    maxZ: Math.max(content.maxZ, scene.board.heightMm / 2),
    empty: false,
  }
}

/**
 * Which side is holding the design back. A negative clearance is only useful if
 * it names the wall, the floor or the lid it belongs to.
 */
export function tightestSide(fit: EnclosureFit): { side: string; clearanceMm: number } {
  const sides: Array<{ side: string; clearanceMm: number }> = [
    { side: 'left wall', clearanceMm: fit.clearanceMm.negX },
    { side: 'right wall', clearanceMm: fit.clearanceMm.posX },
    { side: 'front wall', clearanceMm: fit.clearanceMm.negZ },
    { side: 'back wall', clearanceMm: fit.clearanceMm.posZ },
    { side: 'floor', clearanceMm: fit.clearanceMm.negY },
    { side: 'lid', clearanceMm: fit.clearanceMm.posY },
  ]
  return sides.reduce((worst, next) => (next.clearanceMm < worst.clearanceMm ? next : worst), sides[0])
}

/**
 * Fit the board stack inside an imported enclosure mesh. Both are treated as
 * axis-aligned boxes centred on each other; the mesh is taken as authored, with
 * its Y axis read as the stack direction.
 */
export function assessEnclosureFit(stack: Envelope, mesh: MeshReport): EnclosureFit {
  // The measure reports size per axis: X is width, Y is the stack direction the
  // board lies along, Z is depth.
  const meshWidth = mesh.bounds.size[0]
  const meshHeight = mesh.bounds.size[1]
  const meshDepth = mesh.bounds.size[2]
  const halfX = meshWidth / 2
  const halfZ = meshDepth / 2
  const halfY = meshHeight / 2

  const clearanceMm: EnclosureClearanceMm = {
    negX: halfX + stack.minX,
    posX: halfX - stack.maxX,
    negZ: halfZ + stack.minZ,
    posZ: halfZ - stack.maxZ,
    negY: halfY + stack.minY,
    posY: halfY - stack.maxY,
  }

  const sides = [
    clearanceMm.negX, clearanceMm.posX,
    clearanceMm.negZ, clearanceMm.posZ,
    clearanceMm.negY, clearanceMm.posY,
  ]
  const { topology } = mesh

  return {
    cavityMm: { width: meshWidth, depth: meshDepth, height: meshHeight },
    stackMm: {
      width: stack.maxX - stack.minX,
      depth: stack.maxZ - stack.minZ,
      height: stack.maxY - stack.minY,
    },
    clearanceMm,
    tightestMm: Math.min(...sides),
    fits: Math.min(...sides) >= 0,
    alignment: 'bounding-box centres coincident',
    shellClosed: topology.watertight,
    openEdges: topology.openEdges,
    nonManifoldEdges: topology.nonManifoldEdges,
    inconsistentEdges: topology.inconsistentEdges,
  }
}
