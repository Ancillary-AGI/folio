/**
 * Rigid-body dynamics for the mechanical CAD domain.
 *
 * Pure functions over explicit numeric inputs, sharing no state with the solver, the
 * UI, or a store — so the same code that drives a simulation also backs the tests that
 * check it against textbook results.
 *
 * Conventions
 * -----------
 * - Inertia tensors are `3 x 3` row-major, nine numbers, about a stated point.
 * - Angular velocity is `[wx, wy, wz]`; torque and force are plain triples.
 * - Gravity acts along `-Y`, so a planar arm in the X-Y plane feels it directly.
 *
 * Nothing here returns a plausible-looking number for an input it cannot represent:
 * a non-positive mass or dimension throws.
 */

export type Vec3 = readonly [number, number, number];
/** Row-major 3x3 inertia tensor. */
export type Inertia3 = readonly number[];

/** Throws unless a mass or length is strictly positive and finite. */
export function assertPositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number, got ${value}.`);
  }
}

function symmetric3(a: number, b: number, c: number): Inertia3 {
  return [a, 0, 0, 0, b, 0, 0, 0, c];
}

/**
 * Principal inertia of a solid cuboid about its centre:
 * `Ixx = m(ly² + lz²)/12` and cyclic permutations.
 */
export function boxInertia(mass: number, lx: number, ly: number, lz: number): Inertia3 {
  assertPositive(mass, 'mass');
  assertPositive(lx, 'lx');
  assertPositive(ly, 'ly');
  assertPositive(lz, 'lz');
  return symmetric3(
    (mass * (ly * ly + lz * lz)) / 12,
    (mass * (lx * lx + lz * lz)) / 12,
    (mass * (lx * lx + ly * ly)) / 12,
  );
}

/**
 * Slender rod of mass `m` and length `length`.
 * `'centre'` gives `mL²/12` about the transverse axis through the middle;
 * `'end'` gives `mL²/3` about the same axis through one end.
 */
export function rodInertia(mass: number, length: number, about: 'centre' | 'end'): Inertia3 {
  assertPositive(mass, 'mass');
  assertPositive(length, 'length');
  const transverse =
    about === 'end' ? (mass * length * length) / 3 : (mass * length * length) / 12;
  // A slender rod carries no meaningful inertia about its own long axis.
  return symmetric3(0, transverse, transverse);
}

/** Solid cylinder: `mR²/2` about its own axis, `m(3R² + L²)/12` about a diameter. */
export function cylinderInertia(mass: number, radius: number, length: number): Inertia3 {
  assertPositive(mass, 'mass');
  assertPositive(radius, 'radius');
  assertPositive(length, 'length');
  return symmetric3(
    (mass * radius * radius) / 2,
    (mass * (3 * radius * radius + length * length)) / 12,
    (mass * (3 * radius * radius + length * length)) / 12,
  );
}

/** Solid sphere about any diameter: `2mR²/5`. */
export function sphereInertia(mass: number, radius: number): Inertia3 {
  assertPositive(mass, 'mass');
  assertPositive(radius, 'radius');
  const value = (2 * mass * radius * radius) / 5;
  return symmetric3(value, value, value);
}

/**
 * Parallel-axis shift of a centroidal tensor to a point displaced by `r`:
 * `I_p = I_cm + m(|r|²I₃ - r rᵀ)`.
 */
export function parallelAxis(centroidal: Inertia3, mass: number, r: Vec3): Inertia3 {
  assertPositive(mass, 'mass');
  if (centroidal.length !== 9) throw new Error('Inertia tensor must have 9 elements.');
  for (let i = 0; i < 9; i += 1) {
    if (!Number.isFinite(centroidal[i])) throw new Error(`Inertia element ${i} is not finite.`);
  }
  const sq = r[0] * r[0] + r[1] * r[1] + r[2] * r[2];
  const out = new Array<number>(9);
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      const base = row === col ? sq : 0;
      out[row * 3 + col] = centroidal[row * 3 + col] + mass * (base - r[row] * r[col]);
    }
  }
  return out;
}

/** Angular momentum `L = I ω`. */
export function angularMomentum(inertia: Inertia3, omega: Vec3): Vec3 {
  if (inertia.length !== 9) throw new Error('Inertia tensor must have 9 elements.');
  const out: [number, number, number] = [0, 0, 0];
  for (let row = 0; row < 3; row += 1) {
    out[row] =
      inertia[row * 3] * omega[0] + inertia[row * 3 + 1] * omega[1] + inertia[row * 3 + 2] * omega[2];
  }
  return out;
}

/** Rotational kinetic energy `½ ωᵀ I ω`. */
export function rotationalKineticEnergy(inertia: Inertia3, omega: Vec3): number {
  const l = angularMomentum(inertia, omega);
  return 0.5 * (omega[0] * l[0] + omega[1] * l[1] + omega[2] * l[2]);
}

/* ------------------------------------------------------------------ *
 * Compound pendulum
 * ------------------------------------------------------------------ */

/**
 * Complete elliptic integral of the first kind by the arithmetic-geometric mean, so
 * the exact pendulum period needs no special-function dependency.
 */
export function ellipticK(modulus: number): number {
  if (!(modulus >= 0) || modulus >= 1) {
    throw new Error(`Elliptic modulus must be in [0, 1), got ${modulus}.`);
  }
  let a = 1;
  let b = Math.sqrt(1 - modulus * modulus);
  for (let i = 0; i < 64; i += 1) {
    const next = (a + b) / 2;
    b = Math.sqrt(a * b);
    a = next;
    if (Math.abs(a - b) < 1e-16) break;
  }
  return Math.PI / (2 * a);
}

/**
 * Exact period of a compound pendulum released from `amplitude` radians:
 * `T = 4√(I/(m g d)) · K(sin(θ₀/2))`, which reduces to the familiar
 * `2π√(I/(mgd))` as the amplitude approaches zero.
 */
export function pendulumPeriodExact(
  inertia: number,
  mass: number,
  gravity: number,
  pivotToCentre: number,
  amplitude: number,
): number {
  assertPositive(inertia, 'inertia');
  assertPositive(mass, 'mass');
  assertPositive(gravity, 'gravity');
  assertPositive(pivotToCentre, 'pivotToCentre');
  if (!(amplitude > 0) || amplitude >= Math.PI) {
    throw new Error(`Amplitude must be in (0, pi), got ${amplitude}.`);
  }
  const scale = 4 * Math.sqrt(inertia / (mass * gravity * pivotToCentre));
  return scale * ellipticK(Math.sin(amplitude / 2));
}

/** Small-amplitude pendulum period `2π√(I/(mgd))`, the θ₀ → 0 limit above. */
export function pendulumPeriodSmallAngle(
  inertia: number,
  mass: number,
  gravity: number,
  pivotToCentre: number,
): number {
  assertPositive(inertia, 'inertia');
  assertPositive(mass, 'mass');
  assertPositive(gravity, 'gravity');
  assertPositive(pivotToCentre, 'pivotToCentre');
  return 2 * Math.PI * Math.sqrt(inertia / (mass * gravity * pivotToCentre));
}

/** Torque needed to hold a planar arm horizontal against gravity: `Σ mᵢ g rᵢ`. */
export function staticHoldTorque(
  links: readonly { mass: number; distance: number }[],
  gravity: number,
): number {
  assertPositive(gravity, 'gravity');
  let total = 0;
  for (const link of links) {
    assertPositive(link.mass, 'link mass');
    assertPositive(link.distance, 'link distance');
    total += link.mass * gravity * link.distance;
  }
  return total;
}

/* ------------------------------------------------------------------ *
 * Planar two-link inverse dynamics
 * ------------------------------------------------------------------ */

export interface TwoLinkModel {
  /** Length of the first link. */
  l1: number;
  /** Length of the second link. */
  l2: number;
  /** Mass of the first link. */
  m1: number;
  /** Mass of the second link. */
  m2: number;
  /** Shoulder to link-1 centre of mass. */
  d1: number;
  /** Elbow to link-2 centre of mass. */
  d2: number;
  gravity: number;
}

export interface TwoLinkState {
  /** `[theta1, theta2]`, measured from horizontal, radians. */
  angles: readonly [number, number];
  /** `[thetaDot1, thetaDot2]`, radians per unit time. */
  rates: readonly [number, number];
}

/**
 * Joint torques for a planar two-link arm under gravity:
 * `τ = M(θ) q̈ + C(θ, q̇) q̇ + G(θ)`.
 *
 * With `h = -m2 l1 d2 sin θ2` the standard closed form is
 * `M = [[m1 d1² + m2(l1² + d2² + 2 l1 d2 cos θ2), m2(d2² + l1 d2 cos θ2)], [·, m2 d2²]]`,
 * `C = [[h θ̇2, h(θ̇1 + θ̇2)], [-h θ̇1, 0]]`,
 * `G = [m1 g d1 cos θ1 + m2 g(l1 cos θ1 + d2 cos(θ1+θ2)), m2 g d2 cos(θ1+θ2)]`.
 *
 * Implementing it this way keeps the dynamics auditable line by line against the
 * textbook equations rather than hidden behind a general-purpose integrator.
 */
export function twoLinkTorques(
  model: TwoLinkModel,
  state: TwoLinkState,
  acceleration: readonly [number, number],
): { torque: [number, number]; massMatrix: number[][]; coriolis: [number, number]; gravity: [number, number] } {
  const { l1, l2, m1, m2, d1, d2, gravity } = model;
  assertPositive(l1, 'l1');
  assertPositive(l2, 'l2');
  assertPositive(m1, 'm1');
  assertPositive(m2, 'm2');
  assertPositive(d1, 'd1');
  assertPositive(d2, 'd2');
  assertPositive(gravity, 'gravity');

  const [t1, t2] = state.angles;
  const [w1, w2] = state.rates;
  const [a1, a2] = acceleration;
  for (const [label, value] of [['theta1', t1], ['theta2', t2], ['w1', w1], ['w2', w2], ['a1', a1], ['a2', a2]] as const) {
    if (!Number.isFinite(value)) throw new Error(`${label} must be finite.`);
  }

  const c2 = Math.cos(t2);
  const s2 = Math.sin(t2);
  const h = -m2 * l1 * d2 * s2;

  const m11 = m1 * d1 * d1 + m2 * (l1 * l1 + d2 * d2 + 2 * l1 * d2 * c2);
  const m12 = m2 * (d2 * d2 + l1 * d2 * c2);
  const m22 = m2 * d2 * d2;
  const massMatrix = [
    [m11, m12],
    [m12, m22],
  ];

  const coriolis: [number, number] = [h * w2 * w1 + h * w2 * (w1 + w2), -h * w1 * w1];
  const gravityTorque: [number, number] = [
    m1 * gravity * d1 * Math.cos(t1) + m2 * gravity * (l1 * Math.cos(t1) + d2 * Math.cos(t1 + t2)),
    m2 * gravity * d2 * Math.cos(t1 + t2),
  ];

  const torque: [number, number] = [
    massMatrix[0][0] * a1 + massMatrix[0][1] * a2 + coriolis[0] + gravityTorque[0],
    massMatrix[1][0] * a1 + massMatrix[1][1] * a2 + coriolis[1] + gravityTorque[1],
  ];
  return { torque, massMatrix, coriolis, gravity: gravityTorque };
}

