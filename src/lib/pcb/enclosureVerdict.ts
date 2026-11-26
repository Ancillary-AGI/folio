/**
 * The enclosure verdict: one derived answer to "does the board fit, and what is
 * in the way", shared by the 3-D panel and the agent tool so they cannot
 * disagree. The fit is a bounding-box comparison — ribs and cut-outs are not
 * measured, and `blockers` says so.
 */
import type { PcbScene } from './pcbScene'
import { assessEnclosureFit, stackEnvelope, tightestSide, type EnclosureFit } from './enclosureFit'
import { shellProblem, type MeshReport } from '../3d/meshMeasure'

/** An enclosure as the store holds it: a name, a mesh, and its owning project. */
export interface EnclosureSource {
  name: string
  projectId?: string | null
  mesh: MeshReport
}

export type EnclosureVerdictFormat = MeshReport['format']
export type EnclosureAssumedUnit = MeshReport['assumedUnit']

export interface EnclosureVerdict {
  name: string
  format: EnclosureVerdictFormat
  assumedUnit: EnclosureAssumedUnit
  /** The enclosure's cavity, mm. */
  cavityMm: { width: number; depth: number; height: number }
  /** The board stack it must fit inside: outline and every mounted part. */
  stackMm: { width: number; depth: number; height: number }
  /** Room at each face; negative means the stack leaves the box there. */
  clearanceMm: EnclosureFit['clearanceMm']
  /** The smallest clearance — the one that decides the verdict. */
  tightestMm: number
  /** Which wall, floor or lid holds the design back. */
  tightestSide: string
  fits: boolean
  /** The shell's health as one sentence, or `closed solid` when it is fine. */
  shell: string
  shellClosed: boolean | null
  openEdges: number
  nonManifoldEdges: number
  inconsistentEdges: number
  /** Stated because the model's own origin is not trusted. */
  alignment: string
  /**
   * Actionable statements, worst first. Empty when the board fits and the shell
   * is sound — an empty list is the pass condition, not the absence of a check.
   */
  blockers: string[]
}

const mm = (value: number): number => Number(value.toFixed(6))

const box = (width: number, depth: number, height: number): { width: number; depth: number; height: number } => ({
  width: mm(width),
  depth: mm(depth),
  height: mm(height),
})

/**
 * Sentences for what is actually wrong, ordered by how badly it blocks the
 * design. A shell defect and a fit failure are both blockers; a negative
 * clearance names the face so the fix is obvious.
 */
function blockersFor(fit: EnclosureFit, shell: string): string[] {
  const blockers: string[] = []

  if (shell !== 'closed solid') {
    // A shell that is not watertight cannot be printed or trusted as a cavity.
    blockers.push(`The enclosure mesh is not a closed solid: ${shell}.`)
  }

  if (!fit.fits) {
    const { side, clearanceMm } = tightestSide(fit)
    blockers.push(
      `The board stack breaks out of the ${side} by ${Math.abs(clearanceMm).toFixed(2)} mm.`,
    )
  }

  if (fit.shellClosed === false) {
    blockers.push('The shell has open edges, so the cavity is not sealed.')
  }
  if (fit.nonManifoldEdges > 0) {
    blockers.push(`The shell has ${fit.nonManifoldEdges} non-manifold edge(s) that will not print cleanly.`)
  }
  if (fit.inconsistentEdges > 0) {
    blockers.push(`The shell has ${fit.inconsistentEdges} inconsistently wound edge(s); normals may be inverted.`)
  }

  return blockers
}

/**
 * Derive the verdict for a scene and an enclosure.
 *
 * Returns `null` when there is no enclosure, or when it belongs to a different
 * project — showing another project's shell around this board would be a lie the
 * UI would then repeat.
 */
export function enclosureVerdict(
  scene: PcbScene,
  enclosure: EnclosureSource | null | undefined,
  currentProjectId: string | null,
): EnclosureVerdict | null {
  if (!enclosure) return null
  if ((enclosure.projectId ?? null) !== currentProjectId) return null

  const fit = assessEnclosureFit(stackEnvelope(scene), enclosure.mesh)
  const shell = shellProblem(enclosure.mesh) ?? 'closed solid'
  const { side } = tightestSide(fit)

  return {
    name: enclosure.name,
    format: enclosure.mesh.format,
    assumedUnit: enclosure.mesh.assumedUnit,
    cavityMm: box(fit.cavityMm.width, fit.cavityMm.depth, fit.cavityMm.height),
    stackMm: box(fit.stackMm.width, fit.stackMm.depth, fit.stackMm.height),
    clearanceMm: {
      negX: mm(fit.clearanceMm.negX),
      posX: mm(fit.clearanceMm.posX),
      negZ: mm(fit.clearanceMm.negZ),
      posZ: mm(fit.clearanceMm.posZ),
      negY: mm(fit.clearanceMm.negY),
      posY: mm(fit.clearanceMm.posY),
    },
    tightestMm: mm(fit.tightestMm),
    tightestSide: side,
    fits: fit.fits,
    shell,
    shellClosed: fit.shellClosed,
    openEdges: fit.openEdges,
    nonManifoldEdges: fit.nonManifoldEdges,
    inconsistentEdges: fit.inconsistentEdges,
    alignment: fit.alignment,
    blockers: blockersFor(fit, shell),
  }
}

/**
 * One sentence for a status line or a tool result summary.
 *
 * Says the verdict and, when it fails, the face that fails — the two things a
 * reader needs without opening the detail.
 */
export function describeEnclosureVerdict(verdict: EnclosureVerdict): string {
  if (verdict.blockers.length === 0) {
    return `Fits: ${verdict.stackMm.width} × ${verdict.stackMm.depth} × ${verdict.stackMm.height} mm `
      + `inside a ${verdict.cavityMm.width} × ${verdict.cavityMm.depth} × ${verdict.cavityMm.height} mm cavity `
      + `(tightest ${verdict.tightestSide}, ${verdict.tightestMm.toFixed(2)} mm).`
  }
  return `Does not fit: ${verdict.blockers[0]}`;
}

/**
 * What an enclosure is, stated once: not copper, excluded from fabrication,
 * measured by its bounding box. Every surface that shows a fit verdict should
 * carry this, so nobody mistakes the shell for part of the board.
 */
export const ENCLOSURE_ROLE =
  'Imported enclosure shown around the board. Not copper: excluded from the fab package, '
  + 'DRC, the router and every export. Fit compares bounding boxes, so ribs, bosses and '
  + 'cut-outs inside the shell are not measured.'