/**
 * A worked coupled problem: sizing a current-carrying conductor.
 *
 * A bus bar's section is not a single-discipline choice. Electrically
 * `R = ρ·L/(w·t)`, so a thinner bar dissipates more. Thermally the dissipation
 * heats it, and the rise depends on the surface that the same width and thickness
 * set. The temperature feeds *back* into the resistance (`α ≈ 0.00393 /K`), which
 * closes the loop. Mechanically, mass grows with the section and a minimum second
 * moment is needed for rigidity.
 *
 * Sizing electrically and then checking the temperature gives a different answer
 * from solving them together, because the hotter bar is more resistive than the
 * cold one it was sized with. The fixed-point loop resolves that.
 */
import { optimizeCoupledDesign, type CoupledDesignResult } from './coupledDesign';

export interface ConductorMaterial {
  /** Electrical resistivity at the reference temperature, Ω·m. */
  resistivityOhmM: number;
  /** Density, kg/m³. */
  densityKgM3: number;
  /** Temperature coefficient of resistance, 1/K. */
  tempCoeffPerK: number;
  /** Temperature at which `resistivityOhmM` is quoted, °C. */
  referenceTempC: number;
}

/** Annealed copper at 20 °C. */
export const COPPER: ConductorMaterial = {
  resistivityOhmM: 1.68e-8,
  densityKgM3: 8960,
  tempCoeffPerK: 0.00393,
  referenceTempC: 20,
};

export interface ConductorBounds {
  min: number;
  max: number;
}

export interface ConductorRequest {
  /** Conductor length, m. */
  lengthM: number;
  /** RMS current, A. */
  currentA: number;
  /** Surrounding air temperature, °C. */
  ambientC: number;
  /** Permitted temperature rise above ambient, K. */
  maxTemperatureRiseK: number;
  /** Combined convection and radiation coefficient, W/(m²·K). */
  surfaceCoefficientWm2K: number;
  material: ConductorMaterial;
  width: ConductorBounds;
  thickness: ConductorBounds;
  /** Minimum second moment of area, m⁴ — the rigidity floor. */
  minSecondMomentM4: number;
  populationSize?: number;
  iterations?: number;
  seed?: number;
}

export interface ConductorResult extends CoupledDesignResult {
  widthM: number;
  thicknessM: number;
  lengthM: number;
  currentA: number;
  /** Operating temperature reached by the fixed-point solve, °C. */
  operatingC: number;
  temperatureRiseK: number;
  resistanceOhm: number;
  powerLossW: number;
  massKg: number;
  secondMomentM4: number;
  /** `temperatureRise / limit`; ≤ 1 is acceptable. */
  thermalUtilisation: number;
  /** `required second moment / achieved`; ≤ 1 is acceptable. */
  stiffnessUtilisation: number;
  /** The bar's aspect ratio, thickness / width. */
  aspectRatio: number;
}

/**
 * Solve the electrical–thermal fixed point at a given section.
 *
 * Resistance depends on temperature, temperature depends on dissipation, and
 * dissipation depends on resistance. Iterating converges quickly because the
 * feedback gain (`α·ΔT`) is small for any sane design; the iteration cap and the
 * final residual guard stop a pathological input from spinning.
 */
export function solveCoupledTemperature(
  widthM: number,
  thicknessM: number,
  request: ConductorRequest,
): { resistanceOhm: number; powerW: number; temperatureRiseK: number; converged: boolean } {
  const area = widthM * thicknessM;
  // Wetted surface: two broad faces plus two edges, ignoring the ends.
  const surfaceAreaM2 = 2 * (request.lengthM * (widthM + thicknessM));
  const thermalResistanceKW = 1 / (request.surfaceCoefficientWm2K * surfaceAreaM2);

  let temperatureRiseK = 0;
  let resistanceOhm = 0;
  let powerW = 0;
  let converged = false;

  for (let iteration = 0; iteration < 100; iteration += 1) {
    const hotTempC = request.ambientC + temperatureRiseK;
    const rho = request.material.resistivityOhmM * (
      1 + request.material.tempCoeffPerK * (hotTempC - request.material.referenceTempC)
    );
    resistanceOhm = (rho * request.lengthM) / area;
    powerW = request.currentA * request.currentA * resistanceOhm;
    const nextRise = powerW * thermalResistanceKW;
    if (Math.abs(nextRise - temperatureRiseK) <= 1e-9 * Math.max(1, nextRise)) {
      temperatureRiseK = nextRise;
      converged = true;
      break;
    }
    temperatureRiseK = nextRise;
  }

  return { resistanceOhm, powerW, temperatureRiseK, converged };
}

/** Validate the request and fail loudly before any search runs. */
export function validateConductorRequest(request: ConductorRequest): void {
  const positive = (value: number, name: string): void => {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${name} must be a finite value > 0.`);
    }
  };
  positive(request.lengthM, 'Length');
  positive(request.currentA, 'Current');
  positive(request.maxTemperatureRiseK, 'Temperature rise limit');
  positive(request.surfaceCoefficientWm2K, 'Surface coefficient');
  positive(request.minSecondMomentM4, 'Minimum second moment');
  positive(request.material.resistivityOhmM, 'Resistivity');
  positive(request.material.densityKgM3, 'Density');
  if (!Number.isFinite(request.ambientC)) throw new Error('Ambient temperature must be finite.');
  if (!Number.isFinite(request.material.tempCoeffPerK)) {
    throw new Error('Temperature coefficient must be finite.');
  }
  for (const [bounds, name] of [[request.width, 'Width'], [request.thickness, 'Thickness']] as const) {
    positive(bounds.min, `${name} minimum`);
    positive(bounds.max, `${name} maximum`);
    if (bounds.max <= bounds.min) {
      throw new Error(`${name} maximum must exceed its minimum.`);
    }
  }
}

/**
 * Find the least-mass rectangular conductor that holds its temperature rise and
 * its stiffness limits.
 *
 * Mass is the objective; the thermal and stiffness limits are constraints. The
 * electrical discipline reports the coupled temperature so the thermal constraint
 * sees the hot resistance rather than the cold one.
 */
export async function sizeCoupledConductor(
  request: ConductorRequest,
): Promise<ConductorResult> {
  validateConductorRequest(request);

  const area = (w: number, t: number): number => w * t;

  const thermal = {
    name: 'thermal',
    weight: 1,
    evaluate: (point: Record<string, number>) => {
      const widthM = point.widthM;
      const thicknessM = point.thicknessM;
      const solved = solveCoupledTemperature(widthM, thicknessM, request);
      return {
        cost: solved.temperatureRiseK / request.maxTemperatureRiseK,
        constraints: [
          {
            discipline: 'thermal',
            name: 'temperature-rise',
            utilisation: solved.temperatureRiseK / request.maxTemperatureRiseK,
            unit: 'K',
          },
        ],
        metrics: {
          temperatureRiseK: solved.temperatureRiseK,
          resistanceOhm: solved.resistanceOhm,
          powerW: solved.powerW,
        },
      };
    },
  };

  const mechanical = {
    name: 'mechanical',
    weight: 1,
    evaluate: (point: Record<string, number>) => {
      const widthM = point.widthM;
      const thicknessM = point.thicknessM;
      // Mass is the objective, normalised by the heaviest section the bounds allow.
      const maxMass = request.material.densityKgM3 * request.lengthM
        * area(request.width.max, request.thickness.max);
      const massKg = request.material.densityKgM3 * request.lengthM * area(widthM, thicknessM);
      // Second moment of a rectangle about its neutral axis: w·t³/12.
      const secondMomentM4 = (widthM * thicknessM ** 3) / 12;
      const stiffnessUtilisation = request.minSecondMomentM4 / secondMomentM4;
      return {
        cost: massKg / maxMass,
        constraints: [
          {
            discipline: 'mechanical',
            name: 'second-moment',
            utilisation: stiffnessUtilisation,
            unit: 'm^4',
          },
        ],
        metrics: { massKg, secondMomentM4 },
      };
    },
  };

  const result = await optimizeCoupledDesign({
    variables: [
      { name: 'widthM', min: request.width.min, max: request.width.max, unit: 'm' },
      { name: 'thicknessM', min: request.thickness.min, max: request.thickness.max, unit: 'm' },
    ],
    disciplines: [thermal, mechanical],
    populationSize: request.populationSize,
    iterations: request.iterations,
    seed: request.seed,
  });

  const widthM = result.point.widthM;
  const thicknessM = result.point.thicknessM;
  const solved = solveCoupledTemperature(widthM, thicknessM, request);
  const massKg = request.material.densityKgM3 * request.lengthM * area(widthM, thicknessM);
  const secondMomentM4 = (widthM * thicknessM ** 3) / 12;
  const thermalUtilisation = solved.temperatureRiseK / request.maxTemperatureRiseK;
  const stiffnessUtilisation = request.minSecondMomentM4 / secondMomentM4;

  return {
    ...result,
    widthM,
    thicknessM,
    lengthM: request.lengthM,
    currentA: request.currentA,
    operatingC: request.ambientC + solved.temperatureRiseK,
    temperatureRiseK: solved.temperatureRiseK,
    resistanceOhm: solved.resistanceOhm,
    powerLossW: solved.powerW,
    massKg,
    secondMomentM4,
    thermalUtilisation,
    stiffnessUtilisation,
    aspectRatio: thicknessM / widthM,
    /* Derived from the returned section's own numbers, not the optimiser's flag,
     * so the reported verdict can never contradict the utilisations printed
     * beside it. A penalty search converges onto the constraint boundary, and
     * which side of 1.0 it lands on is floating-point noise. */
    feasible: thermalUtilisation <= 1 && stiffnessUtilisation <= 1,
  };
}