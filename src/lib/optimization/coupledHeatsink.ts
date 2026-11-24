/**
 * Coupled thermal–mechanical–cost sizing for a finned heatsink.
 *
 * Adding fins increases surface area (good), mass (bad) and material cost (bad),
 * and each fin is less effective than the last. Sizing on surface area alone buys
 * fins that do not pay for themselves.
 *
 * Straight rectangular fins, adiabatic tip — the standard closed form:
 *
 *   m = sqrt(2h/(k·t)),  Lc = L + t/2,  η = tanh(m·Lc)/(m·Lc)
 *   Q = h·θ·(A_base + n·η·A_fin),  Rth = 1/(h·(A_base + n·η·A_fin))
 *
 * `η` is what couples the problem: it depends on fin thickness, which is also a
 * mass and cost variable, so ignoring it over-credits long fins.
 */
import { optimizeCoupledDesign, type CoupledDesignResult } from './coupledDesign'

export interface HeatsinkMaterial {
  name: string
  /** Thermal conductivity, W/(m·K). */
  conductivityWmK: number
  /** Density, kg/m³. */
  densityKgM3: number
  /** Material cost per kilogram, in the currency of the study. */
  costPerKg: number
}

/** Extruded aluminium 6063, the default for a board-level heatsink. */
export const ALUMINIUM_6063: HeatsinkMaterial = {
  name: 'Aluminium 6063',
  conductivityWmK: 205,
  densityKgM3: 2700,
  costPerKg: 8,
}

export interface HeatsinkBounds {
  min: number
  max: number
}

export interface HeatsinkRequest {
  /** Power to dissipate, W. */
  powerW: number
  /** Permitted temperature rise above ambient, K. */
  maxTemperatureRiseK: number
  /** Combined convection and radiation coefficient, W/(m²·K). */
  surfaceCoefficientWm2K: number
  /** Base footprint, m. */
  baseLengthM: number
  baseWidthM: number
  /** Base thickness bounds, m. */
  baseThickness: HeatsinkBounds
  /** Fin height bounds, m. */
  finHeight: HeatsinkBounds
  /** Fin thickness bounds, m. */
  finThickness: HeatsinkBounds
  /** Fin count bounds, inclusive. */
  finCount: { min: number; max: number }
  /** Mass ceiling, kg. */
  maxMassKg: number
  material: HeatsinkMaterial
  populationSize?: number
  iterations?: number
}

export interface HeatsinkResult extends CoupledDesignResult {
  baseThicknessM: number
  finHeightM: number
  finThicknessM: number
  finCount: number
  /** Fin efficiency at the optimum, 0..1. */
  finEfficiency: number
  /** Effective wetted area including fin efficiency, m². */
  effectiveAreaM2: number
  thermalResistanceKW: number
  temperatureRiseK: number
  massKg: number
  cost: number
  /** Utilisation of the thermal limit; ≤ 1 is acceptable. */
  thermalUtilisation: number
  /** Utilisation of the mass ceiling; ≤ 1 is acceptable. */
  massUtilisation: number
}

/** Fin efficiency for one straight rectangular fin with an adiabatic tip. */
export function finEfficiency(
  finHeightM: number,
  finThicknessM: number,
  conductivityWmK: number,
  surfaceCoefficientWm2K: number,
): number {
  const m = Math.sqrt((2 * surfaceCoefficientWm2K) / (conductivityWmK * finThicknessM))
  const corrected = finHeightM + finThicknessM / 2
  const mL = m * corrected
  // tanh(mL)/(mL) → 1 as mL → 0, which is the isothermal-fin limit.
  if (mL < 1e-9) return 1
  return Math.tanh(mL) / mL
}

/** The dissipated power and mass of a candidate section. */
export function evaluateHeatsink(
  request: HeatsinkRequest,
  baseThicknessM: number,
  finHeightM: number,
  finThicknessM: number,
  finCount: number,
): { thermalResistanceKW: number; effectiveAreaM2: number; massKg: number; finEfficiency: number } {
  const baseAreaM2 = request.baseLengthM * request.baseWidthM
  const finAreaM2 = 2 * finHeightM * request.baseLengthM * finCount
  const efficiency = finEfficiency(
    finHeightM,
    finThicknessM,
    request.material.conductivityWmK,
    request.surfaceCoefficientWm2K,
  )

  const effectiveAreaM2 = baseAreaM2 + efficiency * finAreaM2
  const thermalResistanceKW = 1 / (request.surfaceCoefficientWm2K * effectiveAreaM2)

  const baseVolumeM3 = baseAreaM2 * baseThicknessM
  const finVolumeM3 = finThicknessM * finHeightM * request.baseLengthM * finCount
  const massKg = request.material.densityKgM3 * (baseVolumeM3 + finVolumeM3)

  return { thermalResistanceKW, effectiveAreaM2, massKg, finEfficiency: efficiency }
}

/** Validate the request before any search runs. */
export function validateHeatsinkRequest(request: HeatsinkRequest): void {
  const positive = (value: number, name: string): void => {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${name} must be a finite value > 0.`)
    }
  }
  positive(request.powerW, 'Power')
  positive(request.maxTemperatureRiseK, 'Temperature rise limit')
  positive(request.surfaceCoefficientWm2K, 'Surface coefficient')
  positive(request.baseLengthM, 'Base length')
  positive(request.baseWidthM, 'Base width')
  positive(request.maxMassKg, 'Mass ceiling')
  positive(request.material.conductivityWmK, 'Conductivity')
  positive(request.material.densityKgM3, 'Density')
  for (const [bounds, name] of [
    [request.baseThickness, 'Base thickness'],
    [request.finHeight, 'Fin height'],
    [request.finThickness, 'Fin thickness'],
  ] as const) {
    positive(bounds.min, `${name} minimum`)
    positive(bounds.max, `${name} maximum`)
    if (bounds.max <= bounds.min) {
      throw new Error(`${name} maximum must exceed its minimum.`)
    }
  }
  if (
    !Number.isInteger(request.finCount.min) ||
    !Number.isInteger(request.finCount.max) ||
    request.finCount.min < 0 ||
    request.finCount.max < request.finCount.min
  ) {
    throw new Error('Fin count must be an integer range with min ≤ max.')
  }
}

/**
 * Find the lightest heatsink that holds the thermal limit and the mass ceiling.
 *
 * Mass is the objective; the thermal limit and the mass ceiling are constraints.
 * Because fin efficiency depends on thickness, the search cannot separate "add
 * area" from "add material" — which is exactly why it needs a coupled study.
 */
export async function sizeCoupledHeatsink(
  request: HeatsinkRequest,
): Promise<HeatsinkResult> {
  validateHeatsinkRequest(request)

  const maxMass = request.maxMassKg

  const result = await optimizeCoupledDesign({
    variables: [
      { name: 'baseThicknessM', min: request.baseThickness.min, max: request.baseThickness.max, unit: 'm' },
      { name: 'finHeightM', min: request.finHeight.min, max: request.finHeight.max, unit: 'm' },
      { name: 'finThicknessM', min: request.finThickness.min, max: request.finThickness.max, unit: 'm' },
      { name: 'finCount', min: request.finCount.min, max: request.finCount.max, unit: 'fins' },
    ],
    disciplines: [
      {
        name: 'thermal',
        weight: 1,
        evaluate: (point) => {
          const solved = evaluateHeatsink(
            request,
            point.baseThicknessM,
            point.finHeightM,
            point.finThicknessM,
            point.finCount,
          )
          // Utilisation is relative to the *smallest* resistance the search can
          // build, so the cost stays normalised and comparable to the mass term.
          const bestPossible = evaluateHeatsink(
            request,
            request.baseThickness.max,
            request.finHeight.max,
            request.finThickness.min,
            request.finCount.max,
          )
          return {
            cost: solved.thermalResistanceKW / bestPossible.thermalResistanceKW,
            constraints: [
              {
                discipline: 'thermal',
                name: 'temperature-rise',
                utilisation: solved.thermalResistanceKW / (request.maxTemperatureRiseK / request.powerW),
                unit: 'K',
              },
            ],
            metrics: {
              thermalResistanceKW: solved.thermalResistanceKW,
              effectiveAreaM2: solved.effectiveAreaM2,
              finEfficiency: solved.finEfficiency,
            },
          }
        },
      },
      {
        name: 'mechanical',
        weight: 1,
        evaluate: (point) => {
          const solved = evaluateHeatsink(
            request,
            point.baseThicknessM,
            point.finHeightM,
            point.finThicknessM,
            point.finCount,
          )
          return {
            // Normalised against the heaviest section the bounds allow, so the
            // objective is comparable to the thermal term.
            cost: solved.massKg / (request.material.densityKgM3 * (
              request.baseLengthM * request.baseWidthM * request.baseThickness.max
              + request.finThickness.max * request.finHeight.max * request.baseLengthM * request.finCount.max
            )),
            constraints: [
              {
                discipline: 'mechanical',
                name: 'mass',
                utilisation: solved.massKg / maxMass,
                unit: 'kg',
              },
            ],
            metrics: { massKg: solved.massKg },
          };
        },
      },
    ],
    populationSize: request.populationSize,
    iterations: request.iterations,
    seed: 1234,
  })

  const solved = evaluateHeatsink(
    request,
    result.point.baseThicknessM,
    result.point.finHeightM,
    result.point.finThicknessM,
    result.point.finCount,
  )
  const thermalLimitKW = request.maxTemperatureRiseK / request.powerW
  const thermalUtilisation = solved.thermalResistanceKW / thermalLimitKW
  const massUtilisation = solved.massKg / maxMass

  return {
    ...result,
    baseThicknessM: result.point.baseThicknessM,
    finHeightM: result.point.finHeightM,
    finThicknessM: result.point.finThicknessM,
    finCount: Math.round(result.point.finCount),
    finEfficiency: solved.finEfficiency,
    effectiveAreaM2: solved.effectiveAreaM2,
    thermalResistanceKW: solved.thermalResistanceKW,
    temperatureRiseK: request.powerW * solved.thermalResistanceKW,
    massKg: solved.massKg,
    cost: solved.massKg * request.material.costPerKg,
    thermalUtilisation,
    massUtilisation,
    /* Derived from the returned section's own numbers, not the optimiser's flag,
     * so the verdict always matches the utilisations printed beside it. */
    feasible: thermalUtilisation <= 1 && massUtilisation <= 1,
  }
}