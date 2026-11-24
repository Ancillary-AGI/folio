/**
 * Coupled cross-domain design tools.
 *
 * Every other tool in the harness sizes one discipline: `eda.drc` checks copper,
 * `mechanical.*` checks a beam, `thermal.*` checks a temperature. None of them
 * can answer the question a real design starts with — *what section do I need so
 * that this is simultaneously electrically adequate, thermally survivable and
 * stiff enough?*
 *
 * `optimizeCoupledDesign` has been able to answer that since it landed, with
 * disciplines sharing one design point. This module is what makes it reachable:
 * it exposes a study an agent can call, and it always reports the single-domain
 * answer alongside the coupled one, because the gap between the two *is* the
 * result. A study that only printed the coupled optimum would look like any
 * other sizing exercise and teach nothing.
 */
import type { AgentHarness } from './agentHarness'
import {
  COPPER,
  sizeCoupledConductor,
  validateConductorRequest,
  type ConductorRequest,
} from '../optimization/coupledConductor'
import {
  ALUMINIUM_6063,
  sizeCoupledHeatsink,
  validateHeatsinkRequest,
  type HeatsinkRequest,
} from '../optimization/coupledHeatsink'
import {
  S275_STEEL,
  sizeCoupledBeam,
  validateBeamRequest,
  type BeamRequest,
} from '../optimization/coupledBeam'
import {
  COUPLED_SCENARIOS,
  isCoupledScenario as isScenario,
} from '../optimization/scenarios'

export { COUPLED_SCENARIOS, type CoupledScenario } from '../optimization/scenarios'

/** Defaults for a study the caller only partly specifies. */
const DEFAULTS = {
  ambientC: 25,
  maxTemperatureRiseK: 30,
  surfaceCoefficientWm2K: 10,
  minSecondMomentM4: 1e-12,
  width: { min: 0.002, max: 0.02 },
  thickness: { min: 0.0005, max: 0.005 },
  heatsink: {
    baseThickness: { min: 0.002, max: 0.006 },
    finHeight: { min: 0.005, max: 0.03 },
    finThickness: { min: 0.0008, max: 0.003 },
    finCount: { min: 2, max: 20 },
    maxMassKg: 0.2,
  },
  beam: {
    width: { min: 0.01, max: 0.1 },
    depth: { min: 0.01, max: 0.15 },
    maxDeflectionM: 0.005,
  },
} as const

/**
 * Read a number from the tool arguments.
 *
 * `AgentHarness.call` has already refused a missing argument and one of the
 * wrong JS type before the handler runs, so these are reads, not validation —
 * the guards that matter (finite, positive, in range) belong to
 * `validateConductorRequest`, which runs before the search starts.
 */
const numberArg = (args: Record<string, unknown>, key: string, fallback?: number): number => {
  const raw = args[key]
  if (raw === undefined || raw === null || raw === '') {
    if (fallback !== undefined) return fallback
    // Unreachable through the harness; kept so a direct call still fails loudly.
    throw new Error(`coupled.study: ${key} is required.`)
  }
  return raw as number
}

const round = (value: number, places = 6): number => {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

/**
 * Run a coupled electromechanical-thermal sizing study.
 *
 * Reports the coupled optimum, the constraint that limits it, and the answer a
 * single-discipline study would have given — so the caller can see what coupling
 * changed rather than taking the number on faith.
 */
async function studyConductor(args: Record<string, unknown>): Promise<unknown> {
  const request: ConductorRequest = {
    lengthM: numberArg(args, 'lengthM'),
    currentA: numberArg(args, 'currentA'),
    ambientC: numberArg(args, 'ambientC', DEFAULTS.ambientC),
    maxTemperatureRiseK: numberArg(args, 'maxRiseK', DEFAULTS.maxTemperatureRiseK),
    surfaceCoefficientWm2K: numberArg(
      args,
      'surfaceCoefficientWm2K',
      DEFAULTS.surfaceCoefficientWm2K,
    ),
    minSecondMomentM4: numberArg(args, 'minSecondMomentM4', DEFAULTS.minSecondMomentM4),
    material: COPPER,
    width: DEFAULTS.width,
    thickness: DEFAULTS.thickness,
    populationSize: 24,
    iterations: 60,
    seed: 1234,
  }

  // Validate before searching: a study that runs for a minute and then reports
  // "current must be positive" has wasted the operator's time.
  validateConductorRequest(request)

  const result = await sizeCoupledConductor(request)

  /* The single-domain answer: size on mass and stiffness alone with the thermal
   * limit removed, then read the temperature that section actually reaches. The
   * gap between the two is the result — a study that only printed the coupled
   * optimum would look like any other sizing exercise. */
  const massOnly = await sizeCoupledConductor({ ...request, maxTemperatureRiseK: 1e6 })

  const binding = result.binding[0]

  return {
    scenario: 'conductor',
    notice:
      'Cross-domain study: electrical (resistance and loss), thermal (temperature rise, fed back into '
      + 'resistance) and mechanical (mass and second moment) are solved together on one section.',
    optimum: {
      widthMm: round(result.widthM * 1000, 4),
      thicknessMm: round(result.thicknessM * 1000, 4),
      lengthM: result.lengthM,
      currentA: result.currentA,
      massKg: round(result.massKg, 9),
      resistanceOhm: round(result.resistanceOhm, 6),
      powerLossW: round(result.powerLossW, 6),
      operatingC: round(result.operatingC, 4),
      temperatureRiseK: round(result.temperatureRiseK, 4),
      secondMomentM4: result.secondMomentM4,
      aspectRatio: round(result.aspectRatio, 6),
    },
    limits: {
      thermalUtilisation: round(result.thermalUtilisation, 6),
      stiffnessUtilisation: round(result.stiffnessUtilisation, 6),
      /** The constraint actually setting the section, or null when none binds. */
      binding: binding
        ? { name: binding.name, utilisation: round(binding.utilisation, 6) }
        : null,
    },
    feasible: result.feasible,
    /* The comparison, because the gap is the point: sizing on mass alone can give
     * a section the thermal limit forbids. */
    massOnlySection: {
      widthMm: round(massOnly.widthM * 1000, 4),
      thicknessMm: round(massOnly.thicknessM * 1000, 4),
      massKg: round(massOnly.massKg, 9),
      /** The temperature that section actually reaches — the reason it can fail. */
      temperatureRiseK: round(massOnly.temperatureRiseK, 4),
      withinThermalLimit: massOnly.temperatureRiseK <= request.maxTemperatureRiseK,
    },
    massPenaltyKg: round(result.massKg - massOnly.massKg, 9),
    conclusions: [
      binding
        ? `The ${binding.name} constraint sets the section.`
        : 'No constraint is active at the optimum.',
      massOnly.temperatureRiseK <= request.maxTemperatureRiseK
        ? 'Sizing on mass alone would also have met the thermal limit, so the two studies agree here.'
        : 'Sizing on mass alone would have produced a section that overheats, which is why the '
          + 'disciplines are solved together.',
    ],
  }
}

/**
 * Run a coupled thermal–mechanical–cost sizing study for a finned heatsink.
 *
 * Reports the coupled optimum and the single-discipline answer the same way the
 * conductor study does. The interesting number is `finEfficiency`: a fin is never
 * isothermal, so a study that sized on surface area alone would over-credit long
 * fins and over-build the part.
 */
async function studyHeatsink(args: Record<string, unknown>): Promise<unknown> {
  const request: HeatsinkRequest = {
    powerW: numberArg(args, 'powerW'),
    maxTemperatureRiseK: numberArg(args, 'maxRiseK'),
    surfaceCoefficientWm2K: numberArg(args, 'surfaceCoefficientWm2K', DEFAULTS.surfaceCoefficientWm2K),
    baseLengthM: numberArg(args, 'baseLengthM'),
    baseWidthM: numberArg(args, 'baseWidthM'),
    baseThickness: {
      min: numberArg(args, 'minBaseThicknessM', DEFAULTS.heatsink.baseThickness.min),
      max: numberArg(args, 'maxBaseThicknessM', DEFAULTS.heatsink.baseThickness.max),
    },
    finHeight: {
      min: numberArg(args, 'minFinHeightM', DEFAULTS.heatsink.finHeight.min),
      max: numberArg(args, 'maxFinHeightM', DEFAULTS.heatsink.finHeight.max),
    },
    finThickness: {
      min: numberArg(args, 'minFinThicknessM', DEFAULTS.heatsink.finThickness.min),
      max: numberArg(args, 'maxFinThicknessM', DEFAULTS.heatsink.finThickness.max),
    },
    finCount: {
      min: numberArg(args, 'minFinCount', DEFAULTS.heatsink.finCount.min),
      max: numberArg(args, 'maxFinCount', DEFAULTS.heatsink.finCount.max),
    },
    maxMassKg: numberArg(args, 'maxMassKg', DEFAULTS.heatsink.maxMassKg),
    material: ALUMINIUM_6063,
    populationSize: 24,
    iterations: 60,
  }

  // Validate before searching: a study that runs for a minute and then reports
  // "power must be positive" has wasted the operator's time.
  validateHeatsinkRequest(request)

  const result = await sizeCoupledHeatsink(request)

  /* The single-discipline answer: size on mass alone with the thermal limit
   * removed, then read the temperature that section actually reaches. */
  const massOnly = await sizeCoupledHeatsink({ ...request, maxTemperatureRiseK: 1e6 })

  const binding = result.binding[0]

  return {
    scenario: 'heatsink',
    notice:
      'Cross-domain study: thermal (surface area, derated by fin efficiency), mechanical (mass) and '
      + 'cost (material) are solved together. Fin efficiency depends on thickness, so adding area and '
      + 'adding material are not separable.',
    optimum: {
      baseThicknessMm: round(result.baseThicknessM * 1000, 4),
      finHeightMm: round(result.finHeightM * 1000, 4),
      finThicknessMm: round(result.finThicknessM * 1000, 4),
      finCount: result.finCount,
      massKg: round(result.massKg, 6),
      cost: round(result.cost, 4),
      thermalResistanceKW: round(result.thermalResistanceKW, 6),
      temperatureRiseK: round(result.temperatureRiseK, 4),
      finEfficiency: round(result.finEfficiency, 6),
      effectiveAreaM2: round(result.effectiveAreaM2, 6),
    },
    limits: {
      thermalUtilisation: round(result.thermalUtilisation, 6),
      massUtilisation: round(result.massUtilisation, 6),
      binding: binding
        ? { name: binding.name, utilisation: round(binding.utilisation, 6) }
        : null,
    },
    feasible: result.feasible,
    massOnlySection: {
      finCount: massOnly.finCount,
      massKg: round(massOnly.massKg, 6),
      temperatureRiseK: round(massOnly.temperatureRiseK, 4),
      withinThermalLimit: massOnly.temperatureRiseK <= request.maxTemperatureRiseK,
    },
    massPenaltyKg: round(result.massKg - massOnly.massKg, 6),
    conclusions: [
      binding
        ? `The ${binding.name} constraint sets the heatsink.`
        : 'No constraint is active at the optimum.',
      massOnly.temperatureRiseK <= request.maxTemperatureRiseK
        ? 'Sizing on mass alone would also have met the thermal limit, so the two studies agree here.'
        : 'Sizing on mass alone would have produced a heatsink that runs hot, which is why the '
          + 'disciplines are solved together.',
      `Fins are ${(result.finEfficiency * 100).toFixed(1)}% efficient at the optimum, so the `
        + `${result.finCount} fins deliver less than their full area.`,
    ],
  }
}

/**
 * Run a coupled structural–thermal sizing study for a beam.
 *
 * The thermal stress is independent of the section, so a hotter environment
 * raises the floor the bending stress must fit under. Sizing on the load alone is
 * unsafe near a heat source, and the comparison below shows how much section that
 * costs.
 */
async function studyBeam(args: Record<string, unknown>): Promise<unknown> {
  const request: BeamRequest = {
    loadN: numberArg(args, 'loadN'),
    spanM: numberArg(args, 'spanM'),
    temperatureChangeK: numberArg(args, 'deltaT', 0),
    maxDeflectionM: numberArg(args, 'maxDeflectionM', DEFAULTS.beam.maxDeflectionM),
    width: {
      min: numberArg(args, 'minWidthM', DEFAULTS.beam.width.min),
      max: numberArg(args, 'maxWidthM', DEFAULTS.beam.width.max),
    },
    depth: {
      min: numberArg(args, 'minDepthM', DEFAULTS.beam.depth.min),
      max: numberArg(args, 'maxDepthM', DEFAULTS.beam.depth.max),
    },
    material: S275_STEEL,
    populationSize: 24,
    iterations: 60,
  }

  validateBeamRequest(request)

  const result = await sizeCoupledBeam(request)
  const cold = await sizeCoupledBeam({ ...request, temperatureChangeK: 0 })
  const binding = result.binding[0]

  return {
    scenario: 'beam',
    notice:
      'Cross-domain study: structural (bending stress and deflection) and thermal (axial stress from a '
      + 'constrained temperature change) are solved together on one section.',
    optimum: {
      widthMm: round(result.widthM * 1000, 4),
      depthMm: round(result.depthM * 1000, 4),
      spanM: result.spanM,
      loadN: result.loadN,
      massKg: round(result.massKg, 6),
      bendingStressMPa: round(result.bendingStressPa / 1e6, 4),
      thermalStressMPa: round(result.thermalStressPa / 1e6, 4),
      totalStressMPa: round(result.totalStressPa / 1e6, 4),
      deflectionMm: round(result.deflectionM * 1000, 4),
      secondMomentM4: result.secondMomentM4,
    },
    limits: {
      stressUtilisation: round(result.stressUtilisation, 6),
      deflectionUtilisation: round(result.deflectionUtilisation, 6),
      binding: binding
        ? { name: binding.name, utilisation: round(binding.utilisation, 6) }
        : null,
    },
    feasible: result.feasible,
    coldSection: {
      widthMm: round(cold.widthM * 1000, 4),
      depthMm: round(cold.depthM * 1000, 4),
      massKg: round(cold.massKg, 6),
      totalStressMPa: round(cold.totalStressPa / 1e6, 4),
    },
    thermalMassPenaltyKg: round(result.massKg - cold.massKg, 6),
    conclusions: [
      binding
        ? `The ${binding.name} constraint sets the section.`
        : 'No constraint is active at the optimum.',
      request.temperatureChangeK === 0
        ? 'With no temperature change this is a plain structural sizing problem.'
        : `The ${request.temperatureChangeK} K change adds `
          + `${round(result.thermalStressPa / 1e6, 3)} MPa of axial stress that does not depend on the section.`,
    ],
  }
}

/**
 * Dispatch to the requested scenario.
 *
 * All scenario parameters are optional at the tool boundary, because which ones
 * are required depends on the scenario and the harness cannot express that. The
 * handler validates, so the error names the missing value for the scenario the
 * caller actually asked for rather than for some other one.
 */
async function studyCoupled(args: Record<string, unknown>): Promise<unknown> {
  const scenario = typeof args['scenario'] === 'string' ? args['scenario'].trim() : ''
  if (!isScenario(scenario)) {
    throw new Error(
      `coupled.study: unknown scenario "${scenario}". Use one of ${COUPLED_SCENARIOS.join(', ')}.`,
    )
  }
  if (scenario === 'heatsink') return studyHeatsink(args)
  if (scenario === 'beam') return studyBeam(args)
  return studyConductor(args)
}

export function coupledTools() {
  return [
    {
      name: 'coupled.study',
      description:
        'Run a cross-domain sizing study that solves several kinds of physics together on one design. '
        + 'Scenarios: conductor (electrical, thermal and mechanical on one section), heatsink '
        + '(thermal, mechanical and cost, where fin efficiency depends on the fin thickness that also '
        + 'sets mass) and beam (structural load plus thermal stress, where a constrained temperature '
        + 'change eats into the allowable the load must fit under). Reports the coupled optimum, which '
        + 'constraint binds, and what a single-discipline study would have chosen instead.',
      parameters: {
        scenario: 'string',
      } as const,
      optionalParameters: [
        // Conductor
        'currentA',
        'lengthM',
        'minSecondMomentM4',
        // Heatsink
        'powerW',
        'baseLengthM',
        'baseWidthM',
        'maxMassKg',
        'minBaseThicknessM',
        'maxBaseThicknessM',
        'minFinHeightM',
        'maxFinHeightM',
        'minFinThicknessM',
        'maxFinThicknessM',
        'minFinCount',
        'maxFinCount',
        // Beam
        'loadN',
        'spanM',
        'deltaT',
        'maxDeflectionM',
        'minWidthM',
        'maxWidthM',
        'minDepthM',
        'maxDepthM',
        // Shared
        'ambientC',
        'maxRiseK',
        'surfaceCoefficientWm2K',
      ],
      handler: studyCoupled,
      needsApproval: false,
    },
  ]
}

export function registerCoupledTools(harness: AgentHarness): void {
  for (const tool of coupledTools()) harness.registerTool(tool)
}