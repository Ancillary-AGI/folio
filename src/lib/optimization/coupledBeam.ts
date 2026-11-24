/**
 * Coupled structural–thermal sizing for a beam.
 *
 * A beam near a heat source is where two usually-separate disciplines meet. For a
 * simply supported beam with a central point load:
 *
 *   M = P·L/4,  I = b·h³/12,  σ_m = M(h/2)/I = 1.5·P·L/(b·h²),  δ = P·L³/(48·E·I)
 *
 * A fully constrained member changing temperature by ΔT carries σ_th = E·α·ΔT,
 * independent of its length, so the governing constraint is σ_m + σ_th ≤ σ_allow.
 * A hotter environment therefore demands a larger section for the same load, and
 * the larger section costs mass — sizing on the load alone is unsafe here.
 */
import { optimizeCoupledDesign, type CoupledDesignResult } from './coupledDesign'

/** How close to the limit a constraint must sit to be called binding. */
const BINDING_TOLERANCE = 0.95
/** The utilisation the repair aims for, just inside the limit. */
const FEASIBILITY_TARGET = 0.999

export interface BeamMaterial {
  name: string
  /** Young's modulus, Pa. */
  youngsModulusPa: number
  /** Coefficient of thermal expansion, 1/K. */
  thermalExpansionPerK: number
  /** Density, kg/m³. */
  densityKgM3: number
  /** Allowable stress, Pa — yield divided by the design factor. */
  allowableStressPa: number
}

/** S275 structural steel, allowable stress already divided by 1.5. */
export const S275_STEEL: BeamMaterial = {
  name: 'S275 structural steel',
  youngsModulusPa: 210e9,
  thermalExpansionPerK: 12e-6,
  densityKgM3: 7850,
  allowableStressPa: 275e6 / 1.5,
}

/** 6061-T6 aluminium, allowable stress already divided by 1.5. */
export const ALUMINIUM_6061_T6: BeamMaterial = {
  name: '6061-T6 aluminium',
  youngsModulusPa: 69e9,
  thermalExpansionPerK: 23.6e-6,
  densityKgM3: 2700,
  allowableStressPa: 276e6 / 1.5,
}

export interface BeamBounds {
  min: number
  max: number
}

export interface BeamRequest {
  /** Central point load, N. */
  loadN: number
  /** Span, m. */
  spanM: number
  /** Temperature change from the stress-free state, K. */
  temperatureChangeK: number
  /** Maximum permitted deflection, m. */
  maxDeflectionM: number
  width: BeamBounds
  depth: BeamBounds
  material: BeamMaterial
  populationSize?: number
  iterations?: number
}

export interface BeamResult extends CoupledDesignResult {
  widthM: number
  depthM: number
  spanM: number
  loadN: number
  /** Second moment of area, m⁴. */
  secondMomentM4: number
  /** Bending stress from the load, Pa. */
  bendingStressPa: number
  /** Axial stress from the temperature change, Pa. */
  thermalStressPa: number
  /** Combined stress at the outer fibre, Pa. */
  totalStressPa: number
  deflectionM: number
  massKg: number
  /** Utilisation of the allowable stress; ≤ 1 is acceptable. */
  stressUtilisation: number
  /** Utilisation of the deflection limit; ≤ 1 is acceptable. */
  deflectionUtilisation: number
}

/** The section properties and stresses of a candidate beam. */
export function evaluateBeam(
  request: BeamRequest,
  widthM: number,
  depthM: number,
): {
  secondMomentM4: number
  bendingStressPa: number
  thermalStressPa: number
  totalStressPa: number
  deflectionM: number
  massKg: number
  volumeM3: number
} {
  const secondMomentM4 = (widthM * depthM ** 3) / 12
  const moment = (request.loadN * request.spanM) / 4
  const bendingStressPa = (moment * (depthM / 2)) / secondMomentM4
  const thermalStressPa =
    request.material.youngsModulusPa * request.material.thermalExpansionPerK * request.temperatureChangeK
  const deflectionM =
    (request.loadN * request.spanM ** 3) / (48 * request.material.youngsModulusPa * secondMomentM4)
  const volumeM3 = widthM * depthM * request.spanM

  return {
    secondMomentM4,
    bendingStressPa,
    thermalStressPa,
    totalStressPa: bendingStressPa + thermalStressPa,
    deflectionM,
    massKg: request.material.densityKgM3 * volumeM3,
    volumeM3,
  }
}

/** Validate the request before any search runs. */
export function validateBeamRequest(request: BeamRequest): void {
  const positive = (value: number, name: string): void => {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${name} must be a finite value > 0.`)
    }
  }
  positive(request.loadN, 'Load')
  positive(request.spanM, 'Span')
  positive(request.maxDeflectionM, 'Deflection limit')
  positive(request.material.youngsModulusPa, "Young's modulus")
  positive(request.material.allowableStressPa, 'Allowable stress')
  positive(request.material.thermalExpansionPerK, 'Expansion coefficient')
  positive(request.material.densityKgM3, 'Density')
  if (!Number.isFinite(request.temperatureChangeK)) {
    throw new Error('Temperature change must be finite.')
  }
  for (const [bounds, name] of [[request.width, 'Width'], [request.depth, 'Depth']] as const) {
    positive(bounds.min, `${name} minimum`)
    positive(bounds.max, `${name} maximum`)
    if (bounds.max <= bounds.min) {
      throw new Error(`${name} maximum must exceed its minimum.`)
    }
  }
}

/**
 * Find the lightest beam that satisfies the combined stress and deflection limits.
 *
 * Mass is the objective. Because the thermal stress is independent of the
 * section, a hot environment raises the floor the bending stress must fit under,
 * which forces a larger section than the load alone would.
 */
export async function sizeCoupledBeam(request: BeamRequest): Promise<BeamResult> {
  validateBeamRequest(request)

  const maxVolume = request.width.max * request.depth.max * request.spanM
  const maxMass = request.material.densityKgM3 * maxVolume
  const allowable = request.material.allowableStressPa

  const result = await optimizeCoupledDesign({
    variables: [
      { name: 'widthM', min: request.width.min, max: request.width.max, unit: 'm' },
      { name: 'depthM', min: request.depth.min, max: request.depth.max, unit: 'm' },
    ],
    disciplines: [
      {
        name: 'structural',
        weight: 1,
        evaluate: (point) => {
          const solved = evaluateBeam(request, point.widthM, point.depthM)
          return {
            // Normalised against the lightest section the bounds allow.
            cost: solved.massKg / maxMass,
            constraints: [
              {
                discipline: 'structural',
                name: 'combined-stress',
                utilisation: solved.totalStressPa / allowable,
                unit: 'Pa',
              },
              {
                discipline: 'structural',
                name: 'deflection',
                utilisation: solved.deflectionM / request.maxDeflectionM,
                unit: 'm',
              },
            ],
            metrics: {
              totalStressPa: solved.totalStressPa,
              deflectionM: solved.deflectionM,
            },
          };
        },
      },
    ],
    populationSize: request.populationSize,
    iterations: request.iterations,
    seed: 1234,
  })

  let widthM = result.point.widthM
  let depthM = result.point.depthM
  let solved = evaluateBeam(request, widthM, depthM)
  let stressUtilisation = solved.totalStressPa / allowable
  let deflectionUtilisation = solved.deflectionM / request.maxDeflectionM

  /* A penalty search converges *to* the constraint boundary, so the returned
   * point sits on it — and which side of 1.0 it lands on is decided by floating
   * point. Measured: 1.0000007, i.e. seven parts per million over, which is not
   * a design violation but would report the beam as infeasible.
   *
   * Rather than loosen the check, repair the section deterministically using the
   * physics: bending stress goes as 1/(b·h²), so scaling both dimensions by k
   * divides the bending part by k³. The exact k that brings the total to the
   * target follows, and deflection improves faster still (1/k⁴).
   */
  if (stressUtilisation > FEASIBILITY_TARGET) {
    const bending = solved.bendingStressPa
    const thermal = solved.thermalStressPa
    const headroom = allowable * FEASIBILITY_TARGET - thermal
    if (bending > 0 && headroom > 0) {
      const scale = Math.cbrt(bending / headroom)
      if (Number.isFinite(scale) && scale > 1) {
        const repairedWidth = Math.min(request.width.max, widthM * scale)
        const repairedDepth = Math.min(request.depth.max, depthM * scale)
        const repaired = evaluateBeam(request, repairedWidth, repairedDepth)
        const repairedStress = repaired.totalStressPa / allowable
        const repairedDeflection = repaired.deflectionM / request.maxDeflectionM
        // Take the repair only when it actually improves the stress and stays
        // inside both limits; a clamp at the bound may achieve neither.
        if (
          repairedStress < stressUtilisation &&
          repairedStress <= 1 &&
          repairedDeflection <= 1
        ) {
          widthM = repairedWidth
          depthM = repairedDepth
          solved = repaired
          stressUtilisation = repairedStress
          deflectionUtilisation = repairedDeflection
        }
      }
    }
  }

  const binding =
    stressUtilisation >= BINDING_TOLERANCE && stressUtilisation >= deflectionUtilisation
      ? { discipline: 'structural' as const, name: 'combined-stress', utilisation: stressUtilisation, unit: 'Pa' }
      : deflectionUtilisation >= BINDING_TOLERANCE
        ? { discipline: 'structural' as const, name: 'deflection', utilisation: deflectionUtilisation, unit: 'm' }
        : null

  return {
    ...result,
    widthM,
    depthM,
    spanM: request.spanM,
    loadN: request.loadN,
    secondMomentM4: solved.secondMomentM4,
    bendingStressPa: solved.bendingStressPa,
    thermalStressPa: solved.thermalStressPa,
    totalStressPa: solved.totalStressPa,
    deflectionM: solved.deflectionM,
    massKg: solved.massKg,
    stressUtilisation,
    deflectionUtilisation,
    /* Derived from the returned section's own numbers, not taken from the
     * optimiser's flag, so the reported feasibility always matches the
     * utilisations printed beside it. */
    feasible: stressUtilisation <= 1 && deflectionUtilisation <= 1,
    binding: binding ? [binding] : [],
  }
}