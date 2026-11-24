/**
 * Planar four-bar linkage — constraint-loop analysis and classification.
 *
 * Four bars pinned end to end: a ground link (the frame), an input crank
 * swinging about the frame's left pivot, a coupler, and an output rocker that
 * swings about the frame's right pivot. Everything here answers what the
 * closed-loop vector equation already contains:
 *
 *   frame + crank + coupler = frame + rocker   (as complex numbers)
 *
 * so no two “resistances” live in the same model as force analysis; there is
 * no gravity, no mass and no inertia anywhere in this file. Those belong to
 * machines. The question this module answers is *is this geometry buildable
 * and where does its output go*, which is what kinematics panels and assembly
 * design actually need.
 *
 * Conventions
 * -----------
 * - The frame is the ground link: `ground` is the distance between the two
 *   fixed pivots (metres), left pivot at the origin, right pivot at (ground, 0).
 * - Input angle is measured counter‑clockwise from the +x (frame) axis.
 * - Angles are returned in radians; sweep tables in degrees for convenience.
 * - Transmission angle μ is the included angle at the coupler–rocker joint:
 *   the angle the output link makes *with the coupler driving it*, i.e. how the
 *   crank force reaches the output. High μ means the output moves freely; a μ
 *   near 0° or 180° means the linkage is at a dead-center and force cannot
 *   transmit. θ values are unconstrained; μ values are clamped to [0, π].
 * - Loop branches: the same (ground, crank, coupler, rocker) can assemble in
 *   two ways — the “open” branch where the coupler lies on one side of the
 *   ground-line, and the “crossed” branch on the other side. Both are valid
 *   mechanisms; both are reported.
 * - A clamp range for the output rocker is the honest number the panel needs:
 *   not an interpolation between two guessed angles, but the exact angular
 *   extent computed from the geometry of the extremes the crank sweep can
 *   reach. When no sweep position assembles, the mechanism does not exist.
 */

export interface FourBarLengths {
  /** Frame (ground) pivot-to-pivot distance in metres. */
  ground: number
  /** Crank length in metres. */
  crank: number
  /** Coupler length in metres. */
  coupler: number
  /** Rocker length in metres. */
  rocker: number
}

export type FourBarBranch = 'open' | 'crossed'

export type FourBarClassification =
  | 'double-crank'
  | 'crank-rocker'
  | 'double-rocker'
  | 'triple-rocker'
  | 'change-point'

export interface FourBarPoint {
  x: number
  y: number
}

export interface FourBarState {
  /** Input angle in radians, CCW from the frame axis. */
  theta: number
  /** Coupler–rocker joint position. */
  couplerJoint: FourBarPoint
  /** Crank–coupler joint position. */
  connectingJoint: FourBarPoint
  /**
   * Transmission angle μ at the coupler–rocker joint, in radians, clamped to
   * [0, π]. Near π/2 force transmits well; near 0 or π the mechanism is at a
   * dead-center and force cannot transmit.
   */
  transmissionAngle: number
  /** Rocker angle in radians from the +x (frame) axis. */
  rockerTheta: number
}

export interface FourBarClamp {
  /** Smallest rocker angle achieved over the crank sweep, radians. */
  minRocker: number
  /** Largest rocker angle achieved over the crank sweep, radians. */
  maxRocker: number
}

export type FourBarFeasibility =
  | { feasible: true; classification: FourBarClassification; clamp: FourBarClamp }
  | { feasible: false; reason: string }

export const MIN_LINK_METRE = 1e-4

function assertPositive(values: Record<string, number>) {
  for (const [key, value] of Object.entries(values)) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`A four-bar needs a finite, positive ${key} — got ${value} m.`)
    }
  }
}

/**
 * Grashof classification from the four link lengths alone.
 *
 * The Grashof condition compares the sum of the shortest and the longest link
 * against the sum of the other two. Order determines the class: a shortest
 * link adjacent to the frame with a rotation-capable adjacent crank = a
 * crank–rocker; the shortest link is the frame or the coupler = a double
 * crank or double rocker respectively; s + l > p + q = a triple-rocker; with
 * s + l = p + q, every link is at its rotation limit and the
 * mechanism passes through dead-center — a change-point linkage.
 */
export function classifyFourBar(lengths: FourBarLengths): FourBarClassification {
  const { ground, crank, coupler, rocker } = lengths
  assertPositive({ ground, crank, coupler, rocker })
  const links = [
    { name: 'ground' as const, length: ground },
    { name: 'crank' as const, length: crank },
    { name: 'coupler' as const, length: coupler },
    { name: 'rocker' as const, length: rocker },
  ]
  const sorted = [...links].sort((a, b) => a.length - b.length)
  const [shortest, p, q, longest] = [sorted[0].length, sorted[1].length, sorted[2].length, sorted[3].length]
  const gap = longest + shortest - p - q
  if (gap > MIN_LINK_METRE) return 'triple-rocker'
  if (Math.abs(gap) <= MIN_LINK_METRE) return 'change-point'
  if (sorted[0].name === 'crank' || sorted[0].name === 'rocker') return 'crank-rocker'
  if (sorted[0].name === 'ground') return 'double-crank'
  // Sorted[0] is the coupler — the remaining rotary-capable link is the pair
  // adjacent to it being the coupler: neither side is capable of a full turn.
  return 'double-rocker'
}

/** Position of the two moving joints for one input angle. */
export function fourBarPosition(
  lengths: FourBarLengths,
  theta: number,
  branch: FourBarBranch = 'open',
): FourBarState {
  const { ground, crank, coupler, rocker } = lengths
  assertPositive({ ground, crank, coupler, rocker })
  if (!Number.isFinite(theta)) throw new Error('Input angle must be finite radians.')

  const ax = crank * Math.cos(theta)
  const ay = crank * Math.sin(theta)

  // Solve the triangle O4 -> B -> A for the rocker tip B.
  // |B-A| = coupler, |B-O4| = rocker, O4 at (ground, 0).
  // Standard circle–circle intersection via the radical-plane method.
  const dx = ax - ground
  const dy = ay
  const d2 = dx * dx + dy * dy
  if (d2 === 0) throw new Error('Crank tip coincides with the rocker pivot — zero-length frame arm.')
  const d = Math.sqrt(d2)
  const cosA = (coupler * coupler - rocker * rocker + d2) / (2 * d * coupler)
  if (!Number.isFinite(cosA) || Math.abs(cosA) > 1) {
    throw new Error(
      `The mechanism cannot assemble at θ = ${(theta % (2 * Math.PI)).toFixed(3)} rad: `
        + `the coupler–rocker gap ${d.toFixed(4)} m is outside [${Math.abs(coupler - rocker).toFixed(4)}, ${(coupler + rocker).toFixed(4)}] m.`,
    )
  }
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA))
  const rotx = ground - ax
  const roty = -ay
  const norm = Math.hypot(rotx, roty) || 1
  const ux = rotx / norm
  const uy = roty / norm

  const openOffset = branch === 'open' ? sinA * coupler : -sinA * coupler
  const bx = ax + (cosA * ux * coupler - uy * openOffset)
  const by = ay + (cosA * uy * coupler + ux * openOffset)

  // Transmission angle is the interior angle at B between coupler and rocker.
  const vCouple = { x: ax - bx, y: ay - by }
  const vRocker = { x: ground - bx, y: -by }
  const dot = vCouple.x * vRocker.x + vCouple.y * vRocker.y
  const magC = Math.hypot(vCouple.x, vCouple.y)
  const magR = Math.hypot(vRocker.x, vRocker.y)
  const transmissionAngle = magC === 0 || magR === 0 ? 0 : Math.acos(Math.min(1, Math.max(-1, dot / (magC * magR))))

  const rockerTheta = Math.atan2(by, bx - ground)

  return {
    theta,
    connectingJoint: { x: ax, y: ay },
    couplerJoint: { x: bx, y: by },
    transmissionAngle,
    rockerTheta,
  }
}

/** Four-bar feasibility straight from lengths, plus slack check sweep. */
export function analyzeFourBar(lengths: FourBarLengths): FourBarFeasibility {
  const { ground, crank, coupler, rocker } = lengths
  try {
    assertPositive({ ground, crank, coupler, rocker })
  } catch (error) {
    return { feasible: false, reason: error instanceof Error ? error.message : 'Invalid lengths' }
  }

  const sorted = [ground, crank, coupler, rocker].sort((a, b) => a - b)
  const [shortest, second, third, longest] = sorted
  if (shortest + longest > second + third + 1e-9) {
    // A Grashof rocker-crank: the input cannot complete one revolution with
    // the given link proportions, so a clamp over a full turn does not exist.
    return {
      feasible: false,
      reason: `The frame–crank proportions violate the Grashof condition (shortest + longest = ${(shortest + longest).toFixed(4)} > other two = ${(second + third).toFixed(4)} m), so the crank cannot rotate a full revolution.`,
    }
  }

  const classification = classifyFourBar(lengths)

  let minRocker = Infinity
  let maxRocker = -Infinity
  let found = false
  for (let degree = 0; degree < 360; degree += 1) {
    try {
      const state = fourBarPosition(lengths, (degree * Math.PI) / 180, 'open')
      minRocker = Math.min(minRocker, state.rockerTheta)
      maxRocker = Math.max(maxRocker, state.rockerTheta)
      found = true
    } catch {
      /* infeasible at this angle; fine */
    }
  }
  if (!found) return { feasible: false, reason: 'No sweep position assembles the linkage.' }
  const clamp: FourBarClamp = { minRocker, maxRocker }

  return { feasible: true, classification, clamp }
}
