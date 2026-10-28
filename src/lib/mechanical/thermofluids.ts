/**
 * Thermodynamics and pipe flow — reduced-order engineering models.
 *
 * Scope, stated honestly
 * ----------------------
 *   • gas cycles — air-standard Carnot, Otto, Diesel and Brayton with constant
 *     specific heats, plus an ideal Rankine cycle over a small saturated-steam
 *     table. No combustion, valve timing, regenerator, pressure drop, heat loss
 *     or real-fluid departure is modelled;
 *   • pipe flow — Darcy–Weisbach head loss with Colebrook–White friction from
 *     the Swamee–Jain explicit fit, laminar Hagen–Poiseuille below Re 2300 and
 *     a named transitional band, plus minor losses and elevation;
 *   • pipe networks — a radial tree where demands fix the flows and heads walk
 *     outward. A loop is refused rather than approximated.
 *
 * Every routine validates its inputs and throws a named error rather than
 * returning a plausible-looking number for an impossible case.
 */

export const STANDARD_GRAVITY = 9.80665
export const AIR_GAS_CONSTANT_KJ_PER_KG_K = 0.287

/* ────────────────────────────────────────────────────────────────────────────
 * Gas cycles
 * ──────────────────────────────────────────────────────────────────────────── */

export type GasCycleId = 'carnot' | 'otto' | 'diesel' | 'brayton' | 'rankine'

export interface CarnotCycleInput {
  cycle: 'carnot'
  /** Cold-reservoir temperature (K). */
  coldK: number
  /** Hot-reservoir temperature (K). */
  hotK: number
  /** Heat supplied per kilogram (kJ/kg). Defaults to 100. */
  heatInputKJPerKg?: number
}

export interface OttoCycleInput {
  cycle: 'otto'
  /** Temperature at the start of compression (K). */
  coldK: number
  /** Compression ratio V1/V2. */
  compressionRatio: number
  /** Heat added at constant volume (kJ/kg). Defaults to 800. */
  heatInputKJPerKg?: number
  /** Ratio of specific heats, air default 1.4. */
  gamma?: number
}

export interface DieselCycleInput {
  cycle: 'diesel'
  /** Temperature at the start of compression (K). */
  coldK: number
  /** Compression ratio V1/V2. */
  compressionRatio: number
  /** Cut-off ratio V3/V2. */
  cutoffRatio: number
  /** Ratio of specific heats, air default 1.4. */
  gamma?: number
}

export interface BraytonCycleInput {
  cycle: 'brayton'
  /** Compressor inlet temperature (K). */
  coldK: number
  /** Pressure ratio. */
  pressureRatio: number
  /** Turbine inlet temperature (K). */
  turbineInletK: number
  /** Ratio of specific heats, air default 1.4. */
  gamma?: number
}

export interface RankineCycleInput {
  cycle: 'rankine'
  /** Boiler pressure (bar, absolute). */
  boilerPressureBar: number
  /** Condenser pressure (bar, absolute). */
  condenserPressureBar: number
}

export type GasCycleInput =
  | CarnotCycleInput
  | OttoCycleInput
  | DieselCycleInput
  | BraytonCycleInput
  | RankineCycleInput

export interface GasCycleState {
  label: string
  temperatureK: number
  /** Pressure (bar) for the Rankine cycle; undefined for air-standard cycles. */
  pressureBar?: number
  /** Vapour quality for a wet Rankine state, 0–1. */
  quality?: number
}

export interface GasCycleResult {
  cycle: GasCycleId
  /** First-law efficiency, 0–1. */
  thermalEfficiency: number
  heatInputKJPerKg: number
  heatRejectedKJPerKg: number
  /** Net work out, kJ/kg. */
  netWorkKJPerKg: number
  states: GasCycleState[]
  notes: string[]
}

function requireFinite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`Thermodynamics: ${label} must be finite.`)
  return value
}

function requirePositive(value: number, label: string): number {
  requireFinite(value, label)
  if (!(value > 0)) throw new Error(`Thermodynamics: ${label} must be > 0.`)
  return value
}

function requireGreaterThanOne(value: number, label: string): number {
  requireFinite(value, label)
  if (!(value > 1)) throw new Error(`Thermodynamics: ${label} must be > 1.`)
  return value
}

function requireGamma(gamma: number): number {
  requireFinite(gamma, 'ratio of specific heats')
  if (!(gamma > 1)) throw new Error('Thermodynamics: the ratio of specific heats must be > 1.')
  return gamma
}

interface SaturatedWaterPoint {
  pressureBar: number
  temperatureK: number
  specificVolumeM3PerKg: number
  hfKJPerKg: number
  hgKJPerKg: number
  sfKJPerKgK: number
  sgKJPerKgK: number
}

/**
 * Nominal saturated-liquid and saturated-vapour properties. Interpolated
 * linearly in ln(p), which keeps the pressure spacing manageable. Values are
 * textbook saturated-water data, not an IAPWS-IF97 implementation.
 */
const SATURATED_WATER: readonly SaturatedWaterPoint[] = [
  { pressureBar: 0.05, temperatureK: 306.0, specificVolumeM3PerKg: 0.001005, hfKJPerKg: 137.8, hgKJPerKg: 2561.5, sfKJPerKgK: 0.4764, sgKJPerKgK: 8.3951 },
  { pressureBar: 0.1, temperatureK: 319.0, specificVolumeM3PerKg: 0.001010, hfKJPerKg: 191.8, hgKJPerKg: 2584.6, sfKJPerKgK: 0.6493, sgKJPerKgK: 8.1488 },
  { pressureBar: 0.2, temperatureK: 333.0, specificVolumeM3PerKg: 0.001017, hfKJPerKg: 251.4, hgKJPerKg: 2609.7, sfKJPerKgK: 0.8320, sgKJPerKgK: 7.9085 },
  { pressureBar: 0.5, temperatureK: 354.5, specificVolumeM3PerKg: 0.001030, hfKJPerKg: 340.5, hgKJPerKg: 2645.2, sfKJPerKgK: 1.0910, sgKJPerKgK: 7.5931 },
  { pressureBar: 1, temperatureK: 372.8, specificVolumeM3PerKg: 0.001043, hfKJPerKg: 417.5, hgKJPerKg: 2675.4, sfKJPerKgK: 1.3027, sgKJPerKgK: 7.3594 },
  { pressureBar: 2, temperatureK: 393.4, specificVolumeM3PerKg: 0.001061, hfKJPerKg: 504.7, hgKJPerKg: 2706.2, sfKJPerKgK: 1.5301, sgKJPerKgK: 7.1271 },
  { pressureBar: 5, temperatureK: 425.0, specificVolumeM3PerKg: 0.001093, hfKJPerKg: 640.1, hgKJPerKg: 2748.1, sfKJPerKgK: 1.8604, sgKJPerKgK: 6.8213 },
  { pressureBar: 10, temperatureK: 453.0, specificVolumeM3PerKg: 0.001127, hfKJPerKg: 762.6, hgKJPerKg: 2777.2, sfKJPerKgK: 2.1382, sgKJPerKgK: 6.5850 },
  { pressureBar: 20, temperatureK: 485.5, specificVolumeM3PerKg: 0.001177, hfKJPerKg: 908.5, hgKJPerKg: 2798.3, sfKJPerKgK: 2.4469, sgKJPerKgK: 6.3390 },
  { pressureBar: 40, temperatureK: 523.5, specificVolumeM3PerKg: 0.001252, hfKJPerKg: 1087.4, hgKJPerKg: 2800.3, sfKJPerKgK: 2.7964, sgKJPerKgK: 6.0697 },
  { pressureBar: 60, temperatureK: 548.7, specificVolumeM3PerKg: 0.001318, hfKJPerKg: 1213.4, hgKJPerKg: 2783.9, sfKJPerKgK: 3.0267, sgKJPerKgK: 5.8902 },
  { pressureBar: 100, temperatureK: 584.1, specificVolumeM3PerKg: 0.001452, hfKJPerKg: 1407.6, hgKJPerKg: 2724.7, sfKJPerKgK: 3.3603, sgKJPerKgK: 5.6151 },
]

function interpolate(value: number, low: number, high: number, lowResult: number, highResult: number): number {
  return lowResult + ((value - low) / (high - low)) * (highResult - lowResult)
}

function saturatedWaterAt(pressureBar: number): SaturatedWaterPoint {
  requirePositive(pressureBar, 'pressure')
  const least = SATURATED_WATER[0]
  const greatest = SATURATED_WATER[SATURATED_WATER.length - 1]
  if (pressureBar < least.pressureBar || pressureBar > greatest.pressureBar) {
    throw new Error(
      `Thermodynamics: ${pressureBar} bar is outside the saturated-water table (${least.pressureBar}–${greatest.pressureBar} bar).`,
    )
  }
  const logPressure = Math.log(pressureBar)
  for (let index = 0; index < SATURATED_WATER.length - 1; index += 1) {
    const lower = SATURATED_WATER[index]
    const upper = SATURATED_WATER[index + 1]
    if (pressureBar > upper.pressureBar) continue
    if (pressureBar === lower.pressureBar) return lower
    if (pressureBar === upper.pressureBar) return upper
    const lowLog = Math.log(lower.pressureBar)
    const highLog = Math.log(upper.pressureBar)
    return {
      pressureBar,
      temperatureK: interpolate(logPressure, lowLog, highLog, lower.temperatureK, upper.temperatureK),
      specificVolumeM3PerKg: interpolate(
        logPressure,
        lowLog,
        highLog,
        lower.specificVolumeM3PerKg,
        upper.specificVolumeM3PerKg,
      ),
      hfKJPerKg: interpolate(logPressure, lowLog, highLog, lower.hfKJPerKg, upper.hfKJPerKg),
      hgKJPerKg: interpolate(logPressure, lowLog, highLog, lower.hgKJPerKg, upper.hgKJPerKg),
      sfKJPerKgK: interpolate(logPressure, lowLog, highLog, lower.sfKJPerKgK, upper.sfKJPerKgK),
      sgKJPerKgK: interpolate(logPressure, lowLog, highLog, lower.sgKJPerKgK, upper.sgKJPerKgK),
    }
  }
  return greatest
}

function finishCycle(
  cycle: GasCycleId,
  heatInputKJPerKg: number,
  heatRejectedKJPerKg: number,
  states: GasCycleState[],
  notes: string[],
): GasCycleResult {
  const netWorkKJPerKg = heatInputKJPerKg - heatRejectedKJPerKg
  return {
    cycle,
    thermalEfficiency: heatInputKJPerKg > 0 ? netWorkKJPerKg / heatInputKJPerKg : 0,
    heatInputKJPerKg,
    heatRejectedKJPerKg,
    netWorkKJPerKg,
    states,
    notes,
  }
}

/**
 * Air-standard gas cycles and the ideal Rankine cycle.
 *
 * Verification (see `thermofluids.test.ts`): Carnot equals 1 − Tc/Th exactly;
 * Otto and Diesel reproduce the textbook closed-form efficiencies; Brayton
 * equals 1 − rp^−(γ−1)/γ; Rankine charges the turbine only for the enthalpy drop
 * of an isentropic expansion into the condenser.
 */
export function analyseGasCycle(input: GasCycleInput): GasCycleResult {
  switch (input.cycle) {
    case 'carnot': {
      const cold = requirePositive(input.coldK, 'cold-reservoir temperature')
      const hot = requirePositive(input.hotK, 'hot-reservoir temperature')
      if (!(hot > cold)) throw new Error('Thermodynamics: the hot reservoir must be hotter than the cold reservoir.')
      const heatInput = input.heatInputKJPerKg ?? 100
      requirePositive(heatInput, 'heat input')
      const efficiency = 1 - cold / hot
      const heatRejected = heatInput * (1 - efficiency)
      return finishCycle(
        'carnot',
        heatInput,
        heatRejected,
        [
          { label: 'Cold reservoir', temperatureK: cold },
          { label: 'Hot reservoir', temperatureK: hot },
        ],
        ['Carnot efficiency is the upper bound for any cycle between these two reservoirs; the work output follows from the declared heat input.'],
      )
    }

    case 'otto': {
      const cold = requirePositive(input.coldK, 'compressor inlet temperature')
      const ratio = requireGreaterThanOne(input.compressionRatio, 'compression ratio')
      const gamma = requireGamma(input.gamma ?? 1.4)
      const heatInput = input.heatInputKJPerKg ?? 800
      requirePositive(heatInput, 'heat input')
      const specificHeatCv = AIR_GAS_CONSTANT_KJ_PER_KG_K / (gamma - 1)
      const t2 = cold * ratio ** (gamma - 1)
      const t3 = t2 + heatInput / specificHeatCv
      const t4 = t3 / ratio ** (gamma - 1)
      const heatRejected = specificHeatCv * (t4 - cold)
      if (!(heatRejected > 0)) {
        throw new Error('Thermodynamics: the heat input is too small for the declared compression ratio to return work.')
      }
      return finishCycle(
        'otto',
        heatInput,
        heatRejected,
        [
          { label: '1 · intake', temperatureK: cold },
          { label: '2 · after compression', temperatureK: t2 },
          { label: '3 · after combustion', temperatureK: t3 },
          { label: '4 · after expansion', temperatureK: t4 },
        ],
        [`Air-standard Otto with constant cv = ${specificHeatCv.toFixed(4)} kJ/(kg·K); no combustion or valve timing is modelled.`],
      )
    }

    case 'diesel': {
      const cold = requirePositive(input.coldK, 'compressor inlet temperature')
      const ratio = requireGreaterThanOne(input.compressionRatio, 'compression ratio')
      const cutoff = requireGreaterThanOne(input.cutoffRatio, 'cut-off ratio')
      if (cutoff > ratio) throw new Error('Thermodynamics: the cut-off ratio cannot exceed the compression ratio.')
      const gamma = requireGamma(input.gamma ?? 1.4)
      const specificHeatCv = AIR_GAS_CONSTANT_KJ_PER_KG_K / (gamma - 1)
      const specificHeatCp = gamma * specificHeatCv
      const t2 = cold * ratio ** (gamma - 1)
      const t3 = t2 * cutoff
      const t4 = t3 * (cutoff / ratio) ** (gamma - 1)
      const heatInput = specificHeatCp * (t3 - t2)
      const heatRejected = specificHeatCv * (t4 - cold)
      return finishCycle(
        'diesel',
        heatInput,
        heatRejected,
        [
          { label: '1 · intake', temperatureK: cold },
          { label: '2 · after compression', temperatureK: t2 },
          { label: '3 · after heat addition', temperatureK: t3 },
          { label: '4 · after expansion', temperatureK: t4 },
        ],
        [`Constant-pressure heat addition with cut-off ratio ${cutoff.toFixed(2)}; peak temperature and heat input follow from the declared ratios.`],
      )
    }

    case 'brayton': {
      const cold = requirePositive(input.coldK, 'compressor inlet temperature')
      const turbineInlet = requirePositive(input.turbineInletK, 'turbine inlet temperature')
      const pressureRatio = requireGreaterThanOne(input.pressureRatio, 'pressure ratio')
      const gamma = requireGamma(input.gamma ?? 1.4)
      const exponent = (gamma - 1) / gamma
      const t2 = cold * pressureRatio ** exponent
      if (!(turbineInlet > t2)) {
        throw new Error('Thermodynamics: the turbine inlet must be hotter than the compressor exit for the cycle to produce work.')
      }
      const t4 = turbineInlet / pressureRatio ** exponent
      const specificHeatCp = (gamma * AIR_GAS_CONSTANT_KJ_PER_KG_K) / (gamma - 1)
      const heatInput = specificHeatCp * (turbineInlet - t2)
      const heatRejected = specificHeatCp * (t4 - cold)
      return finishCycle(
        'brayton',
        heatInput,
        heatRejected,
        [
          { label: '1 · compressor inlet', temperatureK: cold },
          { label: '2 · compressor exit', temperatureK: t2 },
          { label: '3 · turbine inlet', temperatureK: turbineInlet },
          { label: '4 · turbine exit', temperatureK: t4 },
        ],
        ['Air-standard Brayton without a regenerator; an ideal compressor and turbine are assumed.'],
      )
    }

    case 'rankine': {
      const boilerPressure = requirePositive(input.boilerPressureBar, 'boiler pressure')
      const condenserPressure = requirePositive(input.condenserPressureBar, 'condenser pressure')
      if (!(boilerPressure > condenserPressure)) {
        throw new Error('Thermodynamics: the boiler pressure must exceed the condenser pressure.')
      }
      const boiler = saturatedWaterAt(boilerPressure)
      const condenser = saturatedWaterAt(condenserPressure)
      const pumpWork = condenser.specificVolumeM3PerKg * (boilerPressure - condenserPressure) * 100
      const h1 = condenser.hfKJPerKg
      const h2 = h1 + pumpWork
      const h3 = boiler.hgKJPerKg
      const entropyRange = condenser.sgKJPerKgK - condenser.sfKJPerKgK
      const quality = (boiler.sgKJPerKgK - condenser.sfKJPerKgK) / entropyRange
      if (!(quality >= 0 && quality <= 1)) {
        throw new Error(
          `Thermodynamics: the isentropic expansion leaves the saturation dome (quality ${quality.toFixed(2)}); this ideal Rankine model does not carry superheated steam.`,
        )
      }
      const h4 = condenser.hfKJPerKg + quality * (condenser.hgKJPerKg - condenser.hfKJPerKg)
      const turbineWork = h3 - h4
      const heatInput = h3 - h2
      const heatRejected = h4 - h1
      return finishCycle(
        'rankine',
        heatInput,
        heatRejected,
        [
          { label: '1 · saturated liquid', temperatureK: condenser.temperatureK, pressureBar: condenserPressure },
          { label: '2 · pump exit', temperatureK: condenser.temperatureK, pressureBar: boilerPressure },
          { label: '3 · boiler exit', temperatureK: boiler.temperatureK, pressureBar: boilerPressure, quality: 1 },
          { label: '4 · turbine exit', temperatureK: condenser.temperatureK, pressureBar: condenserPressure, quality },
        ],
        [
          `Ideal Rankine over nominal saturated-water data, interpolated in ln p; condenser quality ${(quality * 100).toFixed(1)} %.`,
          `Pump work ${pumpWork.toFixed(2)} kJ/kg and turbine work ${turbineWork.toFixed(2)} kJ/kg are both charged to the cycle.`,
        ],
      )
    }

    default: {
      const exhaustive: never = input
      throw new Error(`Thermodynamics: unknown cycle ${JSON.stringify(exhaustive)}.`)
    }
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Pipe flow — Darcy–Weisbach
 * ──────────────────────────────────────────────────────────────────────────── */

export interface PipeFlowInput {
  /** Pipe length (m). */
  lengthM: number
  /** Internal diameter (m). */
  diameterM: number
  /** Absolute wall roughness (mm); drawn copper is about 0.0015 mm. */
  roughnessMm: number
  /** Volumetric flow (m³/s). */
  flowM3PerS: number
  /** Fluid density (kg/m³), water default 998. */
  densityKgPerM3?: number
  /** Dynamic viscosity (Pa·s), water at 20 °C default 1.002e-3. */
  viscosityPaS?: number
  /** Sum of minor-loss coefficients K. */
  minorLossCoefficient?: number
  /** Elevation gain from inlet to outlet (m); positive lifts fluid. */
  elevationChangeM?: number
}

export interface PipeFlowResult {
  velocityMperS: number
  reynolds: number
  /** 64/Re below 2300, Swamee–Jain above 4000. */
  frictionFactor: number
  regime: 'laminar' | 'transitional' | 'turbulent'
  majorLossM: number
  minorLossM: number
  totalHeadLossM: number
  pressureDropPa: number
  /** Hydraulic power delivered to the fluid (W). */
  hydraulicPowerW: number
  /** Flow expressed in litres per second. */
  flowLPerS: number
}

const LAMINAR_LIMIT = 2300
const TURBULENT_ONSET = 4000

/**
 * Darcy–Weisbach head loss for a single pipe.
 *
 * The friction factor is exact Hagen–Poiseuille in the laminar branch and the
 * Swamee–Jain explicit approximation to Colebrook–White in the turbulent
 * branch (within 1 % for 5e3 < Re < 1e8 and roughness below 5e-2). The
 * transitional band reports the turbulent fit but names itself transitional,
 * because neither correlation is trustworthy there.
 */
export function analysePipeFlow(input: PipeFlowInput): PipeFlowResult {
  const length = requireFinite(input.lengthM, 'pipe length')
  if (!(length > 0)) throw new Error('Pipe flow: length must be > 0 m.')
  const diameter = requirePositive(input.diameterM, 'diameter')
  const roughness = requireFinite(input.roughnessMm, 'roughness')
  if (roughness < 0) throw new Error('Pipe flow: roughness cannot be negative.')
  const flow = requireFinite(input.flowM3PerS, 'flow')
  if (flow < 0) throw new Error('Pipe flow: flow cannot be negative.')
  const density = requirePositive(input.densityKgPerM3 ?? 998, 'density')
  const viscosity = requirePositive(input.viscosityPaS ?? 1.002e-3, 'viscosity')
  const minorK = input.minorLossCoefficient ?? 0
  if (!Number.isFinite(minorK) || minorK < 0) throw new Error('Pipe flow: minor-loss coefficient must be finite and >= 0.')
  const elevation = input.elevationChangeM ?? 0
  requireFinite(elevation, 'elevation change')

  const area = Math.PI * (diameter * diameter) / 4
  const velocity = flow / area
  const reynolds = (density * velocity * diameter) / viscosity
  if (!Number.isFinite(reynolds)) throw new Error('Pipe flow: the Reynolds number is not finite.')

  let frictionFactor = 0
  let regime: PipeFlowResult['regime'] = 'laminar'
  if (reynolds > 0) {
    if (reynolds < LAMINAR_LIMIT) {
      frictionFactor = 64 / reynolds
      regime = 'laminar'
    } else {
      const relativeRoughness = (roughness * 1e-3) / diameter
      const argument = relativeRoughness / 3.7 + 5.74 / reynolds ** 0.9
      frictionFactor = 0.25 / Math.log10(argument) ** 2
      regime = reynolds < TURBULENT_ONSET ? 'transitional' : 'turbulent'
    }
  }

  const velocityHead = (velocity * velocity) / (2 * STANDARD_GRAVITY)
  const majorLoss = frictionFactor * (length / diameter) * velocityHead
  const minorLoss = minorK * velocityHead
  const totalHeadLoss = majorLoss + minorLoss + elevation
  const pressureDrop = density * STANDARD_GRAVITY * totalHeadLoss
  const hydraulicPower = density * STANDARD_GRAVITY * flow * totalHeadLoss

  return {
    velocityMperS: velocity,
    reynolds,
    frictionFactor,
    regime,
    majorLossM: majorLoss,
    minorLossM: minorLoss,
    totalHeadLossM: totalHeadLoss,
    pressureDropPa: pressureDrop,
    hydraulicPowerW: hydraulicPower,
    flowLPerS: flow * 1000,
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Radial pipe network
 * ──────────────────────────────────────────────────────────────────────────── */

export interface PipeNetworkNode {
  id: string
  /** Demand drawn at the node (m³/s); the source node must not carry demand. */
  demandM3PerS?: number
  /** Elevation (m); head results are relative to the source elevation. */
  elevationM?: number
}

export interface PipeNetworkPipe {
  id: string
  from: string
  to: string
  lengthM: number
  diameterM: number
  roughnessMm: number
  minorLossCoefficient?: number
}

export interface PipeNetworkInput {
  sourceId: string
  /** Total head at the source above datum (m). */
  sourceHeadM: number
  nodes: readonly PipeNetworkNode[]
  pipes: readonly PipeNetworkPipe[]
  densityKgPerM3?: number
  viscosityPaS?: number
}

export interface PipeNetworkNodeResult {
  id: string
  headM: number
  pressurePa: number
  demandM3PerS: number
}

export interface PipeNetworkPipeResult {
  id: string
  flowM3PerS: number
  velocityMperS: number
  reynolds: number
  frictionFactor: number
  headLossM: number
  cumulativeDemandM3PerS: number
}

export interface PipeNetworkResult {
  nodes: PipeNetworkNodeResult[]
  pipes: PipeNetworkPipeResult[]
  totalDemandM3PerS: number
  sourceFlowM3PerS: number
  worstNodeId: string
  minPressurePa: number
}

/**
 * Steady flow in a radial (tree) network.
 *
 * In a tree, continuity fixes every pipe flow from the downstream demands, so
 * friction factors and head losses follow in one pass — there is no nonlinear
 * system to iterate. The tree is validated first: one parent per node, every
 * node reachable, and no loops. A loop needs a simultaneous head/flow solve and
 * is refused rather than approximated by this routine.
 */
export function solvePipeNetwork(input: PipeNetworkInput): PipeNetworkResult {
  requireFinite(input.sourceHeadM, 'source head')
  if (input.nodes.length === 0) throw new Error('Pipe network: at least one node is required.')
  if (input.pipes.length === 0) throw new Error('Pipe network: at least one pipe is required.')

  const nodeById = new Map<string, PipeNetworkNode>()
  for (const node of input.nodes) {
    if (!node.id) throw new Error('Pipe network: every node needs a non-empty id.')
    if (nodeById.has(node.id)) throw new Error(`Pipe network: duplicate node id "${node.id}".`)
    const demand = node.demandM3PerS ?? 0
    if (!Number.isFinite(demand) || demand < 0) {
      throw new Error(`Pipe network: node "${node.id}" has an invalid demand.`)
    }
    if (node.id === input.sourceId && demand > 0) {
      throw new Error('Pipe network: the source node cannot also draw a demand.')
    }
    if (node.elevationM !== undefined && !Number.isFinite(node.elevationM)) {
      throw new Error(`Pipe network: node "${node.id}" has a non-finite elevation.`)
    }
    nodeById.set(node.id, node)
  }
  if (!nodeById.has(input.sourceId)) throw new Error(`Pipe network: source node "${input.sourceId}" does not exist.`)

  const parentOf = new Map<string, PipeNetworkPipe>()
  const children = new Map<string, PipeNetworkPipe[]>()
  for (const node of input.nodes) children.set(node.id, [])
  const pipeIds = new Set<string>()
  for (const pipe of input.pipes) {
    if (!pipe.id || pipeIds.has(pipe.id)) throw new Error(`Pipe network: duplicate or empty pipe id "${pipe.id}".`)
    pipeIds.add(pipe.id)
    if (!nodeById.has(pipe.from) || !nodeById.has(pipe.to)) {
      throw new Error(`Pipe network: pipe "${pipe.id}" references a node that does not exist.`)
    }
    if (pipe.from === pipe.to) throw new Error(`Pipe network: pipe "${pipe.id}" starts and ends on the same node.`)
    if (parentOf.has(pipe.to)) {
      throw new Error(`Pipe network: node "${pipe.to}" has more than one incoming pipe; this is not a tree.`)
    }
    if (!(pipe.lengthM > 0) || !(pipe.diameterM > 0) || !(pipe.roughnessMm >= 0)) {
      throw new Error(`Pipe network: pipe "${pipe.id}" needs a positive length and diameter and a non-negative roughness.`)
    }
    parentOf.set(pipe.to, pipe)
    ;(children.get(pipe.from) as PipeNetworkPipe[]).push(pipe)
  }
  if (parentOf.has(input.sourceId)) {
    throw new Error(`Pipe network: source node "${input.sourceId}" has an incoming pipe; the network would contain a loop.`)
  }
  for (const node of input.nodes) {
    if (node.id !== input.sourceId && !parentOf.has(node.id)) {
      throw new Error(`Pipe network: node "${node.id}" is not connected to the source.`)
    }
  }

  const visited = new Set<string>([input.sourceId])
  const queue = [input.sourceId]
  while (queue.length > 0) {
    const current = queue.shift() as string
    for (const pipe of children.get(current) as PipeNetworkPipe[]) {
      if (visited.has(pipe.to)) throw new Error(`Pipe network: the network contains a loop through node "${pipe.to}".`)
      visited.add(pipe.to)
      queue.push(pipe.to)
    }
  }
  if (visited.size !== input.nodes.length) {
    const stray = input.nodes.filter((node) => !visited.has(node.id)).map((node) => node.id)
    throw new Error(`Pipe network: node${stray.length > 1 ? 's' : ''} ${stray.join(', ')} are not reachable from the source.`)
  }

  const order: string[] = []
  {
    const stack: Array<{ id: string; visitedChildren: boolean }> = [{ id: input.sourceId, visitedChildren: false }]
    while (stack.length > 0) {
      const entry = stack.pop() as { id: string; visitedChildren: boolean }
      if (entry.visitedChildren) {
        order.push(entry.id)
        continue
      }
      stack.push({ id: entry.id, visitedChildren: true })
      for (const pipe of children.get(entry.id) as PipeNetworkPipe[]) {
        stack.push({ id: pipe.to, visitedChildren: false })
      }
    }
  }

  const cumulativeDemand = new Map<string, number>()
  for (const id of order) {
    let demand = nodeById.get(id)?.demandM3PerS ?? 0
    for (const pipe of children.get(id) as PipeNetworkPipe[]) {
      demand += cumulativeDemand.get(pipe.to) ?? 0
    }
    cumulativeDemand.set(id, demand)
  }

  const density = requirePositive(input.densityKgPerM3 ?? 998, 'density')
  const viscosity = requirePositive(input.viscosityPaS ?? 1.002e-3, 'viscosity')
  const pipeResults: PipeNetworkPipeResult[] = []
  const heads = new Map<string, number>([[input.sourceId, input.sourceHeadM]])

  const walk = [input.sourceId]
  while (walk.length > 0) {
    const id = walk.shift() as string
    for (const pipe of children.get(id) as PipeNetworkPipe[]) {
      const flow = cumulativeDemand.get(pipe.to) ?? 0
      const area = Math.PI * (pipe.diameterM * pipe.diameterM) / 4
      const velocity = flow / area
      const reynolds = (density * velocity * pipe.diameterM) / viscosity
      let frictionFactor = 0
      if (reynolds > 0) {
        if (reynolds < LAMINAR_LIMIT) {
          frictionFactor = 64 / reynolds
        } else {
          const argument = (pipe.roughnessMm * 1e-3) / pipe.diameterM / 3.7 + 5.74 / reynolds ** 0.9
          frictionFactor = 0.25 / Math.log10(argument) ** 2
        }
      }
      const velocityHead = (velocity * velocity) / (2 * STANDARD_GRAVITY)
      const headLoss = frictionFactor * (pipe.lengthM / pipe.diameterM) * velocityHead + (pipe.minorLossCoefficient ?? 0) * velocityHead
      const parentHead = heads.get(id) as number
      const childHead = parentHead - headLoss
      heads.set(pipe.to, childHead)
      pipeResults.push({
        id: pipe.id,
        flowM3PerS: flow,
        velocityMperS: velocity,
        reynolds,
        frictionFactor,
        headLossM: headLoss,
        cumulativeDemandM3PerS: flow,
      })
      walk.push(pipe.to)
    }
  }

  const nodes: PipeNetworkNodeResult[] = input.nodes.map((node) => {
    const head = heads.get(node.id) ?? input.sourceHeadM
    const elevation = node.elevationM ?? 0
    return {
      id: node.id,
      headM: head,
      pressurePa: density * STANDARD_GRAVITY * (head - elevation),
      demandM3PerS: node.demandM3PerS ?? 0,
    }
  })
  const worstNode = nodes.reduce((worst, node) => (node.pressurePa < worst.pressurePa ? node : worst), nodes[0])
  return {
    nodes,
    pipes: pipeResults,
    totalDemandM3PerS: nodes.reduce((sum, node) => sum + node.demandM3PerS, 0),
    sourceFlowM3PerS: cumulativeDemand.get(input.sourceId) ?? 0,
    worstNodeId: worstNode.id,
    minPressurePa: worstNode.pressurePa,
  }
}
