/**
 * Rigid-body kinematics for the mechanical CAD domain.
 *
 * Everything in this module is pure and unit-agnostic: one length unit, angles in
 * radians. Nothing reads the DOM, a store, or a service, so the same code backs the
 * UI, the solver, and the tests.
 *
 * Conventions
 * -----------
 * - Vectors are `[x, y, z]` triples.
 * - Transforms are row-major 4x4 matrices flattened to 16 numbers, so element
 *   (row `r`, column `c`) sits at index `r * 4 + c`. Row 3 is always `[0, 0, 0, 1]`.
 * - Rotation sense is right-handed, matching the Denavit-Hartenberg frames below.
 *
 * No helper invents an answer for an input it cannot represent: a malformed matrix
 * throws, and callers surface that rather than rendering a plausible lie.
 */

export type Vec3 = readonly [number, number, number];
/** Row-major 4x4 homogeneous transform, 16 numbers. */
export type Mat4 = readonly number[];

const ROW3 = [0, 0, 0, 1] as const;

/** Throws unless `m` is a well-formed finite transform. */
export function assertMat4(m: Mat4): void {
  if (m.length !== 16) throw new Error(`Expected a 16-element matrix, got ${m.length}.`);
  for (let i = 0; i < m.length; i += 1) {
    if (!Number.isFinite(m[i])) throw new Error(`Matrix element ${i} is not finite.`);
  }
  for (let c = 0; c < 4; c += 1) {
    if (m[12 + c] !== ROW3[c]) throw new Error(`Row 3 must be [0, 0, 0, 1] (column ${c}).`);
  }
}

/** Throws unless `v` is a finite 3-vector. */
export function assertVec3(v: Vec3): void {
  if (v.length !== 3) throw new Error(`Expected a 3-vector, got ${v.length} elements.`);
  for (let i = 0; i < 3; i += 1) {
    if (!Number.isFinite(v[i])) throw new Error(`Vector element ${i} is not finite.`);
  }
}

export function mat4Identity(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** Row-major `a * b`, i.e. "apply `b` first, then `a`". */
export function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  assertMat4(a);
  assertMat4(b);
  const out = new Array<number>(16).fill(0);
  for (let r = 0; r < 4; r += 1) {
    for (let c = 0; c < 4; c += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[r * 4 + k] * b[k * 4 + c];
      out[r * 4 + c] = sum;
    }
  }
  return out;
}

/** Applies only the rigid part of `m` to `v`, discarding translation. */
export function rotateVector(m: Mat4, v: Vec3): Vec3 {
  assertMat4(m);
  assertVec3(v);
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[4] * v[0] + m[5] * v[1] + m[6] * v[2],
    m[8] * v[0] + m[9] * v[1] + m[10] * v[2],
  ];
}

/** Applies the full transform `m` to the point `p`. */
export function transformPoint(m: Mat4, p: Vec3): Vec3 {
  assertMat4(m);
  assertVec3(p);
  return [
    m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
    m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
    m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11],
  ];
}

/** Origin column of `m`, i.e. where that frame's axes sit in its parent. */
export function translationOf(m: Mat4): Vec3 {
  assertMat4(m);
  return [m[3], m[7], m[11]];
}

export function translate(x: number, y: number, z: number): Mat4 {
  return [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];
}

export function rotateX(angle: number): Mat4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1];
}

export function rotateY(angle: number): Mat4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1];
}

export function rotateZ(angle: number): Mat4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** Exact inverse of a rigid transform: transpose the rotation, negate the offset. */
export function mat4InvertRigid(m: Mat4): Mat4 {
  assertMat4(m);
  const [r00, r01, r02] = [m[0], m[1], m[2]];
  const [r10, r11, r12] = [m[4], m[5], m[6]];
  const [r20, r21, r22] = [m[8], m[9], m[10]];
  const [tx, ty, tz] = [m[3], m[7], m[11]];
  return [
    r00, r10, r20, -(r00 * tx + r10 * ty + r20 * tz),
    r01, r11, r21, -(r01 * tx + r11 * ty + r21 * tz),
    r02, r12, r22, -(r02 * tx + r12 * ty + r22 * tz),
    0, 0, 0, 1,
  ];
}

/* ------------------------------------------------------------------ *
 * Denavit-Hartenberg chains
 * ------------------------------------------------------------------ */

/**
 * One Denavit-Hartenberg link, standard convention:
 * `Rot(z, theta) · Trans(z, d) · Trans(x, a) · Rot(x, alpha)`.
 */
export interface DhJoint {
  /** Link length along the joint's own X. */
  a: number;
  /** Link twist about the joint's own X, radians. */
  alpha: number;
  /** Link offset along the previous Z. */
  d: number;
  /** Joint variable: angle about the previous Z, or offset along it. */
  theta: number;
  /** Revolute joints move in `theta`; prismatic joints move in `d`. */
  kind: 'revolute' | 'prismatic';
}

/** Transform from frame `i-1` to frame `i` for a single DH joint. */
export function dhTransform(joint: DhJoint): Mat4 {
  const { a, alpha, d, theta, kind } = joint;
  if (kind !== 'revolute' && kind !== 'prismatic') {
    throw new Error(`Unknown joint kind: ${String(kind)}`);
  }
  const ct = Math.cos(theta);
  const st = Math.sin(theta);
  const ca = Math.cos(alpha);
  const sa = Math.sin(alpha);
  return [
    ct, -st * ca, st * sa, a * ct,
    st, ct * ca, -ct * sa, a * st,
    0, sa, ca, d,
    0, 0, 0, 1,
  ];
}

/**
 * Cumulative transforms for a serial chain. Entry `i` expresses frame `i` in the base
 * frame, so the last entry is the end-effector pose. An empty chain yields an empty
 * array rather than a fabricated identity pose.
 */
export function forwardKinematics(chain: readonly DhJoint[]): Mat4[] {
  const frames: Mat4[] = [];
  let current = mat4Identity();
  for (const joint of chain) {
    current = mat4Multiply(current, dhTransform(joint));
    frames.push(current);
  }
  return frames;
}

/** End-effector pose of a chain, or the identity for an empty chain. */
export function endEffectorPose(chain: readonly DhJoint[]): Mat4 {
  const frames = forwardKinematics(chain);
  return frames.length === 0 ? mat4Identity() : frames[frames.length - 1];
}

/* ------------------------------------------------------------------ *
 * Jacobian
 * ------------------------------------------------------------------ */

/** Geometric Jacobian, split so callers can use only the part they need. */
export interface Jacobian {
  /** `3 x n`; maps joint rates to end-effector linear velocity. */
  linear: number[][];
  /** `3 x n`; maps joint rates to end-effector angular velocity. */
  angular: number[][];
}

function cross(u: Vec3, v: Vec3): Vec3 {
  return [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/**
 * Analytic geometric Jacobian for a chain whose cumulative frames are already known.
 * For revolute joint `i` the linear column is `z(i-1) x (o(n) - o(i-1))` and the
 * angular column is `z(i-1)`; a prismatic joint swaps which of the two is zero.
 */
export function jacobian(chain: readonly DhJoint[], frames: readonly Mat4[]): Jacobian {
  if (frames.length !== chain.length) throw new Error('Frame count must match joint count.');
  if (chain.length === 0) return { linear: [[], [], []], angular: [[], [], []] };
  const tip = translationOf(frames[frames.length - 1]);
  const linear: number[][] = [[], [], []];
  const angular: number[][] = [[], [], []];

  let previous = mat4Identity();
  for (let i = 0; i < chain.length; i += 1) {
    const axis = rotateVector(previous, [0, 0, 1]);
    const origin = translationOf(previous);
    if (chain[i].kind === 'revolute') {
      const moment = cross(axis, subtract(tip, origin));
      for (let r = 0; r < 3; r += 1) {
        linear[r].push(moment[r]);
        angular[r].push(axis[r]);
      }
    } else {
      for (let r = 0; r < 3; r += 1) {
        linear[r].push(axis[r]);
        angular[r].push(0);
      }
    }
    previous = frames[i];
  }
  return { linear, angular };
}

/**
 * Reference Jacobian by central difference on the tip position, so the analytic
 * derivative above can be checked against an independent computation.
 */
export function numericalLinearJacobian(
  chain: readonly DhJoint[],
  epsilon = 1e-6,
): number[][] {
  if (!(epsilon > 0)) throw new Error('epsilon must be positive.');
  const out: number[][] = [[], [], []];
  const tipAt = (index: number, delta: number): Vec3 => {
    const varied = chain.map((joint, i) => {
      if (i !== index) return joint;
      return joint.kind === 'revolute'
        ? { ...joint, theta: joint.theta + delta }
        : { ...joint, d: joint.d + delta };
    });
    return translationOf(endEffectorPose(varied));
  };
  for (let i = 0; i < chain.length; i += 1) {
    const plus = tipAt(i, epsilon);
    const minus = tipAt(i, -epsilon);
    for (let r = 0; r < 3; r += 1) out[r].push((plus[r] - minus[r]) / (2 * epsilon));
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Dense linear algebra
 * ------------------------------------------------------------------ */

/**
 * Gaussian elimination with partial pivoting. Throws rather than returning a
 * near-singular "solution", because a garbage answer here silently poisons IK.
 */
export function solveLinearSystem(a: readonly number[][], b: readonly number[]): number[] {
  const n = b.length;
  if (a.length !== n) throw new Error('Matrix and vector sizes disagree.');
  const m = a.map((row, r) => {
    if (row.length !== n) throw new Error(`Row ${r} has ${row.length} columns, expected ${n}.`);
    return [...row, b[r]];
  });

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    }
    if (Math.abs(m[pivot][col]) < 1e-14) {
      throw new Error('System is singular to working precision.');
    }
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let r = col + 1; r < n; r += 1) {
      const factor = m[r][col] / m[col][col];
      if (factor === 0) continue;
      for (let c = col; c <= n; c += 1) m[r][c] -= factor * m[col][c];
    }
  }

  const out = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r -= 1) {
    let sum = m[r][n];
    for (let c = r + 1; c < n; c += 1) sum -= m[r][c] * out[c];
    out[r] = sum / m[r][r];
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Inverse kinematics
 * ------------------------------------------------------------------ */

export interface IkOptions {
  /** Damping on the least-squares step; larger is steadier near singularities. */
  lambda?: number;
  /** Iteration cap. The solver stops early once the error is under `tolerance`. */
  maxIterations?: number;
  /** Position error, in length units, at which to stop. */
  tolerance?: number;
}

export interface IkResult {
  /** Joint variables after solving, in the same order as the input chain. */
  values: number[];
  /** Residual position error actually achieved, in length units. */
  error: number;
  iterations: number;
  /** True only when the residual met `tolerance` inside `maxIterations`. */
  converged: boolean;
}

function variablesOf(chain: readonly DhJoint[]): number[] {
  return chain.map((joint) => (joint.kind === 'revolute' ? joint.theta : joint.d));
}

function withVariables(chain: readonly DhJoint[], values: readonly number[]): DhJoint[] {
  return chain.map((joint, i) =>
    joint.kind === 'revolute' ? { ...joint, theta: values[i] } : { ...joint, d: values[i] },
  );
}

/**
 * Damped-least-squares inverse kinematics on position only. Returns the joint
 * variables rather than a rebuilt chain, so callers keep their own joint metadata,
 * and reports the residual it actually reached instead of claiming convergence.
 */
export function solveIk(
  chain: readonly DhJoint[],
  target: Vec3,
  options: IkOptions = {},
): IkResult {
  assertVec3(target);
  const lambda = options.lambda ?? 1e-3;
  const maxIterations = options.maxIterations ?? 200;
  const tolerance = options.tolerance ?? 1e-9;
  if (chain.length === 0) throw new Error('Cannot solve IK for an empty chain.');
  if (!(lambda >= 0)) throw new Error('lambda must be non-negative.');
  if (!(maxIterations >= 1)) throw new Error('maxIterations must be at least 1.');

  let values = variablesOf(chain);
  let iterations = 0;

  for (; iterations < maxIterations; iterations += 1) {
    const current = withVariables(chain, values);
    const frames = forwardKinematics(current);
    const tip = translationOf(frames[frames.length - 1]);
    const delta = subtract(target, tip);
    if (Math.hypot(delta[0], delta[1], delta[2]) <= tolerance) break;

    const { linear } = jacobian(current, frames);
    // Least-squares step y = (J Jᵀ + λ²I)⁻¹ delta, applied as Jᵀ y.
    const damped: number[][] = [];
    for (let r = 0; r < 3; r += 1) {
      const row: number[] = [];
      for (let c = 0; c < 3; c += 1) {
        let sum = 0;
        for (let k = 0; k < values.length; k += 1) sum += linear[r][k] * linear[c][k];
        row.push(r === c ? sum + lambda * lambda : sum);
      }
      damped.push(row);
    }
    const y = solveLinearSystem(damped, delta);
    values = values.map((v, i) => {
      let sum = 0;
      for (let r = 0; r < 3; r += 1) sum += linear[r][i] * y[r];
      return v + sum;
    });
  }

  const tip = translationOf(endEffectorPose(withVariables(chain, values)));
  const error = Math.hypot(target[0] - tip[0], target[1] - tip[1], target[2] - tip[2]);
  return { values, error, iterations, converged: error <= tolerance };
}

/**
 * Both solutions of a planar two-link arm reaching `(x, y)`, from the law of cosines.
 *
 * `φ = atan2(y, x)` and `d = |target|` fix the shoulder-to-target line. The shoulder
 * offset is `α = acos((d² + l1² - l2²)/(2 d l1))` and the elbow interior angle is
 * `β = acos((l1² + l2² - d²)/(2 l1 l2))`, so `|θ2| = π - β`:
 *
 * - **elbow-up** (`θ2 = +(π - β)`): the wrist swings counter-clockwise from the upper
 *   arm, and the upper arm sits below the target line, so `θ1 = φ - α`.
 * - **elbow-down** (`θ2 = -(π - β)`): the mirror image, so `θ1 = φ + α`.
 *
 * Outside the annulus swept by the arm `reachable` is false and the angles are NaN,
 * rather than a clamped guess presented as a solution.
 */
export function twoLinkIk(
  x: number,
  y: number,
  l1: number,
  l2: number,
): {
  elbowUp: { shoulder: number; elbow: number };
  elbowDown: { shoulder: number; elbow: number };
  reachable: boolean;
} {
  if (!(l1 > 0) || !(l2 > 0)) throw new Error('Link lengths must be positive.');
  const distance = Math.hypot(x, y);
  const reachable =
    distance <= l1 + l2 + 1e-12 && distance >= Math.abs(l1 - l2) - 1e-12;
  if (!reachable) {
    const unreachable = { shoulder: Number.NaN, elbow: Number.NaN };
    return { elbowUp: unreachable, elbowDown: unreachable, reachable: false };
  }
  const clamp = (v: number): number => Math.min(1, Math.max(-1, v));
  const phi = Math.atan2(y, x);
  const shoulderOffset = Math.acos(clamp((distance * distance + l1 * l1 - l2 * l2) / (2 * distance * l1)));
  const relative = Math.PI - Math.acos(clamp((l1 * l1 + l2 * l2 - distance * distance) / (2 * l1 * l2)));
  return {
    elbowUp: { shoulder: phi - shoulderOffset, elbow: relative },
    elbowDown: { shoulder: phi + shoulderOffset, elbow: -relative },
    reachable: true,
  };
}
