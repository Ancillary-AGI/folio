/**
 * Structural mechanics for the mechanical CAD domain.
 *
 * Closed-form beam, shaft and column results plus a direct-stiffness one-dimensional
 * finite-element solver. The closed forms are the reference the FEM is checked
 * against, so the two never agree by construction: they are written from the textbook
 * equations independently of each other.
 *
 * Conventions
 * -----------
 * - Units are whatever the caller passes, consistently: a force per length² for
 *   stiffness, a length⁴ for second moment of area.
 * - `E` is Young's modulus, `G` the shear modulus, `I` the second moment of area,
 *   `A` the cross-sectional area, `c` the distance to the extreme fibre.
 * - Deflection is positive in the direction of the applied load.
 *
 * Nothing here smooths over an unphysical input: a non-positive modulus, length or
 * area throws, and an FEM system that cannot be solved reports that instead of
 * returning a zero-filled displacement vector.
 */

/** Throws unless `value` is strictly positive and finite. */
function positive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number, got ${value}.`);
  }
}

/** Throws unless every entry of `values` is finite. */
function finite(...values: number[]): void {
  for (const v of values) {
    if (!Number.isFinite(v)) throw new Error(`Expected a finite number, got ${v}.`);
  }
}

/* ------------------------------------------------------------------ *
 * Axial members
 * ------------------------------------------------------------------ */

/** Elongation of an axially loaded bar: `δ = PL/(EA)`. */
export function axialExtension(force: number, length: number, area: number, modulus: number): number {
  finite(force);
  positive(length, 'length');
  positive(area, 'area');
  positive(modulus, 'modulus');
  return (force * length) / (modulus * area);
}

/** Uniform axial stress `σ = P/A`, signed so compression comes out negative. */
export function axialStress(force: number, area: number): number {
  finite(force);
  positive(area, 'area');
  return force / area;
}

/** Axial stiffness of a bar, `k = EA/L`. */
export function axialStiffness(length: number, area: number, modulus: number): number {
  positive(length, 'length');
  positive(area, 'area');
  positive(modulus, 'modulus');
  return (modulus * area) / length;
}

/* ------------------------------------------------------------------ *
 * Bending
 * ------------------------------------------------------------------ */

/** Cantilever tip deflection under an end load: `δ = PL³/(3EI)`. */
export function cantileverTipDeflection(
  load: number,
  length: number,
  modulus: number,
  inertia: number,
): number {
  finite(load);
  positive(length, 'length');
  positive(modulus, 'modulus');
  positive(inertia, 'inertia');
  return (load * length ** 3) / (3 * modulus * inertia);
}

/** Cantilever tip rotation under an end load: `θ = PL²/(2EI)`. */
export function cantileverTipRotation(
  load: number,
  length: number,
  modulus: number,
  inertia: number,
): number {
  finite(load);
  positive(length, 'length');
  positive(modulus, 'modulus');
  positive(inertia, 'inertia');
  return (load * length ** 2) / (2 * modulus * inertia);
}

/** Cantilever tip deflection under a uniform load: `δ = wL⁴/(8EI)`. */
export function cantileverUniformDeflection(
  loadPerLength: number,
  length: number,
  modulus: number,
  inertia: number,
): number {
  finite(loadPerLength);
  positive(length, 'length');
  positive(modulus, 'modulus');
  positive(inertia, 'inertia');
  return (loadPerLength * length ** 4) / (8 * modulus * inertia);
}

/** Simply supported mid-span deflection under a central load: `δ = PL³/(48EI)`. */
export function simplySupportedCentreDeflection(
  load: number,
  length: number,
  modulus: number,
  inertia: number,
): number {
  finite(load);
  positive(length, 'length');
  positive(modulus, 'modulus');
  positive(inertia, 'inertia');
  return (load * length ** 3) / (48 * modulus * inertia);
}

/** Peak bending stress `σ = Mc/I`, signed with the moment. */
export function bendingStress(moment: number, extremeFibre: number, inertia: number): number {
  finite(moment, extremeFibre);
  positive(inertia, 'inertia');
  return (moment * extremeFibre) / inertia;
}

/** Elastic section modulus `S = I/c`. */
export function sectionModulus(inertia: number, extremeFibre: number): number {
  positive(inertia, 'inertia');
  positive(extremeFibre, 'extremeFibre');
  return inertia / extremeFibre;
}

/** Second moment of area of a solid rectangle about its centroid, `bh³/12`. */
export function rectangleInertia(width: number, depth: number): number {
  positive(width, 'width');
  positive(depth, 'depth');
  return (width * depth ** 3) / 12;
}

/** Second moment of area of a solid circle about a diameter, `πd⁴/64`. */
export function circleInertia(diameter: number): number {
  positive(diameter, 'diameter');
  return (Math.PI * diameter ** 4) / 64;
}

/** Polar second moment of area of a solid circle, `πd⁴/32`. */
export function circlePolarInertia(diameter: number): number {
  positive(diameter, 'diameter');
  return (Math.PI * diameter ** 4) / 32;
}

/* ------------------------------------------------------------------ *
 * Torsion
 * ------------------------------------------------------------------ */

/** Angle of twist of a circular shaft: `θ = TL/(GJ)`. */
export function shaftTwist(
  torque: number,
  length: number,
  shearModulus: number,
  polarInertia: number,
): number {
  finite(torque);
  positive(length, 'length');
  positive(shearModulus, 'shearModulus');
  positive(polarInertia, 'polarInertia');
  return (torque * length) / (shearModulus * polarInertia);
}

/** Peak shear stress in a circular shaft: `τ = Tc/J`. */
export function shaftShearStress(
  torque: number,
  radius: number,
  polarInertia: number,
): number {
  finite(torque, radius);
  positive(polarInertia, 'polarInertia');
  return (torque * radius) / polarInertia;
}

/* ------------------------------------------------------------------ *
 * Stability and vibration
 * ------------------------------------------------------------------ */

/** Effective-length factors for the usual column end conditions. */
export const BUCKLING_FACTOR = {
  pinned: 1,
  'fixed-free': 2,
  'fixed-pinned': 0.699,
  'fixed-fixed': 0.5,
} as const;

export type ColumnEndCondition = keyof typeof BUCKLING_FACTOR;

/** Euler critical buckling load `Pcr = π²EI/(kL)²`. */
export function eulerBucklingLoad(
  modulus: number,
  inertia: number,
  length: number,
  endCondition: ColumnEndCondition = 'pinned',
): number {
  positive(modulus, 'modulus');
  positive(inertia, 'inertia');
  positive(length, 'length');
  const factor = BUCKLING_FACTOR[endCondition];
  if (!(factor > 0)) throw new Error(`Unknown end condition: ${String(endCondition)}`);
  return (Math.PI ** 2 * modulus * inertia) / (factor * length) ** 2;
}

/**
 * Fundamental bending frequency of a cantilever, in hertz:
 * `f₁ = (β₁²/2π)·√(EI/(ρAL⁴))` with `β₁L = 1.875104…`.
 */
export function cantileverNaturalFrequency(
  modulus: number,
  inertia: number,
  density: number,
  area: number,
  length: number,
): number {
  positive(modulus, 'modulus');
  positive(inertia, 'inertia');
  positive(density, 'density');
  positive(area, 'area');
  positive(length, 'length');
  const betaL = 1.8751040687119611;
  const stiffnessPerMass = (modulus * inertia) / (density * area * length ** 4);
  return ((betaL ** 2) / (2 * Math.PI)) * Math.sqrt(stiffnessPerMass);
}

/* ------------------------------------------------------------------ *
 * Thermal
 * ------------------------------------------------------------------ */

/** Free thermal elongation `ΔL = αLΔT`. */
export function thermalExpansion(
  length: number,
  expansionCoefficient: number,
  temperatureRise: number,
): number {
  positive(length, 'length');
  finite(expansionCoefficient, temperatureRise);
  return expansionCoefficient * length * temperatureRise;
}

/** Stress in a fully restrained bar, `σ = -EαΔT` (heating puts it in compression). */
export function restrainedThermalStress(
  modulus: number,
  expansionCoefficient: number,
  temperatureRise: number,
): number {
  positive(modulus, 'modulus');
  finite(expansionCoefficient, temperatureRise);
  return -modulus * expansionCoefficient * temperatureRise;
}

/* ------------------------------------------------------------------ *
 * Direct-stiffness finite elements
 * ------------------------------------------------------------------ */

/** One two-node axial bar element. */
export interface AxialElement {
  /** Index of the left node in the global system. */
  left: number;
  /** Index of the right node. */
  right: number;
  /** Unstressed length. */
  length: number;
  area: number;
  modulus: number;
}

export interface FemResult {
  /** Nodal displacements, or `null` when the system could not be solved. */
  displacements: number[] | null;
  /** Non-null only alongside a `null` displacement vector, saying why. */
  error: string | null;
}

/**
 * Gaussian elimination with partial pivoting. A vanished pivot means the structure is
 * free to move as a rigid body, so the caller is told that rather than handed a
 * plausible-looking zero vector.
 */
function factorAndSolve(
  matrix: readonly number[][],
  rhs: readonly number[],
): { solution: number[] | null; error: string | null } {
  const n = rhs.length;
  const augmented = matrix.map((row, r) => [...row, rhs[r]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(augmented[r][col]) > Math.abs(augmented[pivot][col])) pivot = r;
    }
    if (Math.abs(augmented[pivot][col]) < 1e-12) {
      return { solution: null, error: `Structure is not restrained: pivot vanished at degree ${col}.` };
    }
    [augmented[col], augmented[pivot]] = [augmented[pivot], augmented[col]];
    for (let r = col + 1; r < n; r += 1) {
      const factor = augmented[r][col] / augmented[col][col];
      if (factor === 0) continue;
      for (let c = col; c <= n; c += 1) augmented[r][c] -= factor * augmented[col][c];
    }
  }
  const solution = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r -= 1) {
    let sum = augmented[r][n];
    for (let c = r + 1; c < n; c += 1) sum -= augmented[r][c] * solution[c];
    solution[r] = sum / augmented[r][r];
  }
  return { solution, error: null };
}

function zeroMatrix(n: number): number[][] {
  return Array.from({ length: n }, () => new Array<number>(n).fill(0));
}

/**
 * Assemble and solve a chain of axial bars. Nodes listed in `constrained` are held at
 * zero displacement; `loads[index]` is the outward force applied there.
 */
export function solveAxialChain(
  elements: readonly AxialElement[],
  nodeCount: number,
  constrained: readonly number[],
  loads: readonly number[],
): FemResult {
  if (elements.length === 0) throw new Error('At least one axial element is required.');
  if (nodeCount < 2) throw new Error('An axial chain needs at least two nodes.');
  if (loads.length !== nodeCount) throw new Error('Load vector must match the node count.');

  const held = new Set(constrained);
  for (const index of constrained) {
    if (!Number.isInteger(index) || index < 0 || index >= nodeCount) {
      throw new Error(`Constraint ${index} is out of range.`);
    }
  }
  loads.forEach((load, index) => {
    if (!Number.isFinite(load)) throw new Error(`Load ${index} must be finite, got ${load}.`);
  });
  elements.forEach((element, i) => {
    positive(element.length, `element ${i} length`);
    positive(element.area, `element ${i} area`);
    positive(element.modulus, `element ${i} modulus`);
    const leftValid = Number.isInteger(element.left) && element.left >= 0 && element.left < nodeCount;
    const rightValid = Number.isInteger(element.right) && element.right >= 0 && element.right < nodeCount;
    if (!leftValid || !rightValid) {
      throw new Error(`Element ${i} references a node outside the model.`);
    }
    if (element.left === element.right) {
      throw new Error(`Element ${i} connects node ${element.left} to itself.`);
    }
  });

  const free: number[] = [];
  for (let i = 0; i < nodeCount; i += 1) if (!held.has(i)) free.push(i);
  if (free.length === 0) {
    return { displacements: null, error: 'Every node is constrained; nothing is free to move.' };
  }

  const stiffness = zeroMatrix(nodeCount);
  for (const element of elements) {
    const k = axialStiffness(element.length, element.area, element.modulus);
    stiffness[element.left][element.left] += k;
    stiffness[element.left][element.right] -= k;
    stiffness[element.right][element.left] -= k;
    stiffness[element.right][element.right] += k;
  }

  const reduced = zeroMatrix(free.length);
  const reducedLoads = free.map((node) => loads[node] ?? 0);
  for (let r = 0; r < free.length; r += 1) {
    for (let c = 0; c < free.length; c += 1) reduced[r][c] = stiffness[free[r]][free[c]];
  }

  const { solution, error } = factorAndSolve(reduced, reducedLoads);
  if (!solution) return { displacements: null, error };
  const displacements = new Array<number>(nodeCount).fill(0);
  free.forEach((node, i) => {
    displacements[node] = solution[i];
  });
  return { displacements, error: null };
}

/** Internal force per element after solving, `N = (EA/L)(u_right − u_left)`; tension positive. */
export function axialElementForces(
  elements: readonly AxialElement[],
  displacements: readonly number[],
): number[] {
  if (displacements.length === 0) throw new Error('Displacements are required to recover forces.');
  return elements.map(
    (element) =>
      axialStiffness(element.length, element.area, element.modulus) *
      (displacements[element.right] - displacements[element.left]),
  );
}

/** Uniform axial stress implied by a solved internal force. */
export function axialElementStresses(
  elements: readonly AxialElement[],
  displacements: readonly number[],
): number[] {
  const forces = axialElementForces(elements, displacements);
  return forces.map((force, i) => axialStress(force, elements[i].area));
}
