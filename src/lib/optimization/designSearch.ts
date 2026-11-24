/**
 * Bounded structural sizing search.
 *
 * The particle-swarm optimiser in `evolutionaryOptimization.ts` is generic. This
 * module gives it a concrete, reviewable engineering problem: pick a solid
 * rectangular cantilever section (width × height) that minimises mass while
 * satisfying a strength and a tip-deflection limit.
 *
 * Closed-form Euler–Bernoulli relations are used for the constraints:
 *   max stress   σ = 6 P L / (b h²)
 *   tip deflect. δ = 4 P L³ / (E b h³)
 *   mass         m = ρ L b h
 *
 * A slenderness limit `maxAspectRatio` (height / width) is included because a
 * solid rectangle's least-mass section is otherwise unbounded: at fixed
 * strength, mass falls as the section gets taller and thinner. That limit
 * stands in for local buckling and fabrication constraints, so the reported
 * optimum is a realistic section rather than a razor-thin plate.
 *
 * The optimiser maximises `fitness`, so fitness is −normalised mass with a
 * penalty on constraint violation. The returned section is always re-checked
 * against the closed-form constraints; a small deterministic repair (uniform
 * scale-up) is applied when the swarm lands just outside the feasible region.
 * If the repair would leave the search bounds, the result is reported as
 * infeasible rather than silently accepted.
 */
import { ParticleSwarmOptimizer } from './evolutionaryOptimization';
import { createSeededRandom } from '../simulation/numeric';

export interface CantileverMaterial {
  densityKgM3: number;
  youngsModulusPa: number;
  yieldStrengthPa: number;
}

export interface SizingBounds {
  minM: number;
  maxM: number;
}

export interface CantileverSizingRequest {
  spanM: number;
  loadN: number;
  material: CantileverMaterial;
  safetyFactor: number;
  deflectionLimitM: number;
  /** Maximum height / width ratio (local buckling and fabrication limit). */
  maxAspectRatio?: number;
  width: SizingBounds;
  height: SizingBounds;
  populationSize?: number;
  iterations?: number;
  seed?: number;
}

export interface CantileverSizingResult {
  widthM: number;
  heightM: number;
  massKg: number;
  stressPa: number;
  deflectionM: number;
  allowableStressPa: number;
  /** Stress divided by the allowable stress; ≤ 1 is acceptable. */
  stressUtilization: number;
  /** Tip deflection divided by the deflection limit; ≤ 1 is acceptable. */
  deflectionUtilization: number;
  /** Height / width of the returned section. */
  aspectRatio: number;
  /** Aspect ratio divided by the slenderness limit; ≤ 1 is acceptable. */
  aspectUtilization: number;
  feasible: boolean;
  /** True when the swarm result needed a uniform scale-up to satisfy the limits. */
  repaired: boolean;
  iterations: number;
  bestFitness: number;
  convergence: number[];
}

const DEFAULT_POPULATION = 24;
const DEFAULT_ITERATIONS = 60;
const DEFAULT_SEED = 0x5eed;
const DEFAULT_MAX_ASPECT = 20;

function assertPositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a finite value > 0.`);
  }
}

function assertBounds(bounds: SizingBounds, name: string): void {
  assertPositive(bounds.minM, `${name} minimum`);
  assertPositive(bounds.maxM, `${name} maximum`);
  if (bounds.maxM <= bounds.minM) {
    throw new Error(`${name} maximum must be greater than the minimum.`);
  }
}

function sectionResponse(
  widthM: number,
  heightM: number,
  request: CantileverSizingRequest,
): { massKg: number; stressPa: number; deflectionM: number } {
  const { spanM, loadN, material } = request;
  const inertia = (widthM * heightM ** 3) / 12;
  return {
    massKg: material.densityKgM3 * spanM * widthM * heightM,
    stressPa: (6 * loadN * spanM) / (widthM * heightM ** 2),
    deflectionM: (loadN * spanM ** 3) / (3 * material.youngsModulusPa * inertia),
  };
}

/** Validate the request and fail loudly before any search runs. */
export function validateSizingRequest(request: CantileverSizingRequest): void {
  assertPositive(request.spanM, 'Span');
  assertPositive(request.loadN, 'Tip load');
  assertPositive(request.material.densityKgM3, 'Material density');
  assertPositive(request.material.youngsModulusPa, 'Young’s modulus');
  assertPositive(request.material.yieldStrengthPa, 'Yield strength');
  assertPositive(request.deflectionLimitM, 'Deflection limit');
  assertBounds(request.width, 'Width');
  assertBounds(request.height, 'Height');
  if (!Number.isFinite(request.safetyFactor) || request.safetyFactor < 1) {
    throw new Error('Safety factor must be a finite value ≥ 1.');
  }
  if (request.maxAspectRatio !== undefined) {
    assertPositive(request.maxAspectRatio, 'Maximum aspect ratio');
  }
  const population = request.populationSize ?? DEFAULT_POPULATION;
  const iterations = request.iterations ?? DEFAULT_ITERATIONS;
  if (!Number.isInteger(population) || population < 2) {
    throw new Error('Population size must be an integer ≥ 2.');
  }
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new Error('Iterations must be an integer ≥ 1.');
  }
}

/**
 * Search the bounded section space. Deterministic for a given seed; throws on
 * malformed input instead of guessing.
 */
export async function searchCantileverSection(
  request: CantileverSizingRequest,
): Promise<CantileverSizingResult> {
  validateSizingRequest(request);

  const allowableStressPa = request.material.yieldStrengthPa / request.safetyFactor;
  const maxAspectRatio = request.maxAspectRatio ?? DEFAULT_MAX_ASPECT;
  const referenceMass = request.material.densityKgM3 * request.spanM * request.width.maxM * request.height.maxM;
  const populationSize = request.populationSize ?? DEFAULT_POPULATION;
  const iterations = request.iterations ?? DEFAULT_ITERATIONS;

  const evaluate = (position: Record<string, number>): number => {
    const { massKg, stressPa, deflectionM } = sectionResponse(position.widthM, position.heightM, request);
    const violation =
      Math.max(0, stressPa / allowableStressPa - 1) +
      Math.max(0, deflectionM / request.deflectionLimitM - 1) +
      Math.max(0, position.heightM / position.widthM / maxAspectRatio - 1);
    return -(massKg / referenceMass) - 10 * violation;
  };

  const convergence: number[] = [];
  const swarm = new ParticleSwarmOptimizer({
    populationSize,
    iterations,
    inertia: 0.72,
    cognitiveWeight: 1.5,
    socialWeight: 1.5,
    onProgress: ({ bestFitness }) => convergence.push(bestFitness),
  });
  swarm.setRandomSource(createSeededRandom(request.seed ?? DEFAULT_SEED));

  const position = await swarm.optimize(
    { widthM: request.width.maxM, heightM: request.height.maxM },
    async (candidate) => evaluate(candidate),
    {
      widthM: { min: request.width.minM, max: request.width.maxM },
      heightM: { min: request.height.minM, max: request.height.maxM },
    },
  );

  let widthM = position.widthM;
  let heightM = position.heightM;
  let response = sectionResponse(widthM, heightM, request);
  let repaired = false;

  const stressRatio = response.stressPa / allowableStressPa;
  const deflectionRatio = response.deflectionM / request.deflectionLimitM;
  if (stressRatio > 1 || deflectionRatio > 1) {
    // Scaling both dimensions by s divides stress by s³ and deflection by s⁴.
    const scale = Math.max(
      1,
      Math.cbrt(stressRatio),
      Math.pow(deflectionRatio, 0.25),
    );
    widthM = Math.min(request.width.maxM, widthM * scale);
    heightM = Math.min(request.height.maxM, heightM * scale);
    response = sectionResponse(widthM, heightM, request);
    repaired = true;
  }

  const finalStressRatio = response.stressPa / allowableStressPa;
  const finalDeflectionRatio = response.deflectionM / request.deflectionLimitM;
  const finalAspectRatio = heightM / widthM;

  return {
    widthM,
    heightM,
    massKg: response.massKg,
    stressPa: response.stressPa,
    deflectionM: response.deflectionM,
    allowableStressPa,
    stressUtilization: finalStressRatio,
    deflectionUtilization: finalDeflectionRatio,
    aspectRatio: finalAspectRatio,
    aspectUtilization: finalAspectRatio / maxAspectRatio,
    feasible:
      finalStressRatio <= 1 + 1e-9 &&
      finalDeflectionRatio <= 1 + 1e-9 &&
      finalAspectRatio <= maxAspectRatio * (1 + 1e-9),
    repaired,
    iterations,
    bestFitness: evaluate({ widthM, heightM }),
    convergence,
  };
}
