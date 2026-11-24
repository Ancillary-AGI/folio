/**
 * Psychrometrics and zone cooling loads — steady-state design estimates.
 *
 * Scope, stated honestly
 * ----------------------
 *   • moist-air properties from the Buck saturation-pressure correlation with
 *     the ASHRAE humidity-ratio, enthalpy and specific-volume relations;
 *   • dew point and wet bulb solved on that same curve by bisection, so the
 *     three properties cannot disagree with each other;
 *   • zone load as a steady sensible/latent balance: envelope UA, solar and
 *     internal gains, occupancy, and outdoor ventilation air at the design
 *     condition.
 *
 * No thermal mass, solar path, duct gain, fan heat, coil bypass or part-load
 * bin method is modelled. This is a transparent sizing estimate, not a
 * certified Manual J or ASHRAE load calculation.
 */

export const STANDARD_PRESSURE_KPA = 101.325
export const DRY_AIR_CP_KJ_PER_KG_K = 1.006
export const WATER_VAPOUR_CP_KJ_PER_KG_K = 1.86
export const WATER_LATENT_HEAT_KJ_PER_KG = 2501
export const DRY_AIR_GAS_CONSTANT_KPA_M3_PER_KG_K = 0.287042
export const VAPOUR_SPECIFIC_VOLUME_RATIO = 1.607858
export const MIN_PSYCHROMETRIC_TEMP_C = -20
export const MAX_PSYCHROMETRIC_TEMP_C = 80

function assertRange(value: number, min: number, max: number, name: string): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}.`)
  }
}

function assertNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be zero or positive.`)
}

/** Buck saturation pressure over liquid water (kPa); valid −20…80 °C. */
function buckSaturationKPa(dryBulbC: number): number {
  return 0.61121 * Math.exp((18.678 - dryBulbC / 234.5) * (dryBulbC / (257.14 + dryBulbC)))
}

export function saturationVapourPressureKPa(dryBulbC: number): number {
  assertRange(dryBulbC, MIN_PSYCHROMETRIC_TEMP_C, MAX_PSYCHROMETRIC_TEMP_C, 'Dry-bulb temperature (°C)')
  return buckSaturationKPa(dryBulbC)
}

export function humidityRatioFromRh(
  dryBulbC: number,
  relativeHumidity: number,
  pressureKPa: number = STANDARD_PRESSURE_KPA,
): number {
  assertRange(dryBulbC, MIN_PSYCHROMETRIC_TEMP_C, MAX_PSYCHROMETRIC_TEMP_C, 'Dry-bulb temperature (°C)')
  assertRange(relativeHumidity, 0, 1, 'Relative humidity (0–1)')
  assertRange(pressureKPa, 50, 120, 'Atmospheric pressure (kPa)')
  const vapourPressure = relativeHumidity * buckSaturationKPa(dryBulbC)
  if (vapourPressure >= pressureKPa) {
    throw new Error('Vapour pressure cannot reach or exceed the atmospheric pressure.')
  }
  return (0.621945 * vapourPressure) / (pressureKPa - vapourPressure)
}

export function relativeHumidityFromHumidityRatio(
  dryBulbC: number,
  humidityRatio: number,
  pressureKPa: number = STANDARD_PRESSURE_KPA,
): number {
  assertRange(dryBulbC, MIN_PSYCHROMETRIC_TEMP_C, MAX_PSYCHROMETRIC_TEMP_C, 'Dry-bulb temperature (°C)')
  assertRange(pressureKPa, 50, 120, 'Atmospheric pressure (kPa)')
  assertNonNegative(humidityRatio, 'Humidity ratio (kg/kg)')
  const saturationPressure = buckSaturationKPa(dryBulbC)
  const vapourPressure = (humidityRatio * pressureKPa) / (0.621945 + humidityRatio)
  if (vapourPressure > saturationPressure) {
    throw new Error('Humidity ratio exceeds saturation at this temperature.')
  }
  return vapourPressure / saturationPressure
}

export function moistAirEnthalpyKJPerKg(dryBulbC: number, humidityRatio: number): number {
  assertNonNegative(humidityRatio, 'Humidity ratio (kg/kg)')
  return DRY_AIR_CP_KJ_PER_KG_K * dryBulbC + humidityRatio * (WATER_LATENT_HEAT_KJ_PER_KG + WATER_VAPOUR_CP_KJ_PER_KG_K * dryBulbC)
}

/** Specific volume of moist air per kilogram of dry air (m³/kg_da). */
export function moistAirSpecificVolumeM3PerKg(
  dryBulbC: number,
  humidityRatio: number,
  pressureKPa: number = STANDARD_PRESSURE_KPA,
): number {
  assertRange(pressureKPa, 50, 120, 'Atmospheric pressure (kPa)')
  assertNonNegative(humidityRatio, 'Humidity ratio (kg/kg)')
  return (
    (DRY_AIR_GAS_CONSTANT_KPA_M3_PER_KG_K *
      (dryBulbC + 273.15) *
      (1 + VAPOUR_SPECIFIC_VOLUME_RATIO * humidityRatio)) /
    pressureKPa
  )
}

function solveSaturationTemperature(vapourPressureKPa: number, upperC: number): number {
  if (vapourPressureKPa < buckSaturationKPa(MIN_PSYCHROMETRIC_TEMP_C)) {
    throw new Error(`Dew point is below ${MIN_PSYCHROMETRIC_TEMP_C} °C, outside the correlation.`)
  }
  let low = MIN_PSYCHROMETRIC_TEMP_C
  let high = upperC
  for (let i = 0; i < 100; i += 1) {
    const mid = (low + high) / 2
    if (buckSaturationKPa(mid) < vapourPressureKPa) low = mid
    else high = mid
  }
  return (low + high) / 2
}

export function dewPointC(
  dryBulbC: number,
  relativeHumidity: number,
  pressureKPa: number = STANDARD_PRESSURE_KPA,
): number {
  assertRange(relativeHumidity, Number.MIN_VALUE, 1, 'Relative humidity (0–1)')
  assertRange(pressureKPa, 50, 120, 'Atmospheric pressure (kPa)')
  const vapourPressure = relativeHumidity * saturationVapourPressureKPa(dryBulbC)
  return solveSaturationTemperature(vapourPressure, dryBulbC)
}

/**
 * Thermodynamic wet bulb from the ASHRAE adiabatic-saturation relation.
 * Bisection terminates on a 1e-9 °C bracket rather than an iteration guess.
 */
export function wetBulbC(
  dryBulbC: number,
  relativeHumidity: number,
  pressureKPa: number = STANDARD_PRESSURE_KPA,
): number {
  assertRange(relativeHumidity, Number.MIN_VALUE, 1, 'Relative humidity (0–1)')
  if (relativeHumidity >= 1 - 1e-12) return dryBulbC
  const humidityRatio = humidityRatioFromRh(dryBulbC, relativeHumidity, pressureKPa)
  const saturationAt = (temperatureC: number) => humidityRatioFromRh(temperatureC, 1, pressureKPa)
  const residual = (wetBulb: number) =>
    ((WATER_LATENT_HEAT_KJ_PER_KG - 2.326 * wetBulb) * saturationAt(wetBulb) -
      DRY_AIR_CP_KJ_PER_KG_K * (dryBulbC - wetBulb)) /
      (WATER_LATENT_HEAT_KJ_PER_KG + WATER_VAPOUR_CP_KJ_PER_KG_K * dryBulbC - 4.186 * wetBulb) -
    humidityRatio

  let low = MIN_PSYCHROMETRIC_TEMP_C
  let high = dryBulbC
  if (residual(low) > 0) {
    throw new Error('Wet bulb is below the correlation range for this dry-bulb and humidity ratio.')
  }
  for (let i = 0; i < 100; i += 1) {
    const mid = (low + high) / 2
    if (residual(mid) >= 0) high = mid
    else low = mid
  }
  return (low + high) / 2
}

export interface MoistAirState {
  dryBulbC: number
  relativeHumidity: number
  pressureKPa: number
  vapourPressureKPa: number
  humidityRatio: number
  saturationHumidityRatio: number
  enthalpyKJPerKg: number
  dewPointC: number
  wetBulbC: number
  specificVolumeM3PerKg: number
  /** Moist-air density, i.e. (1 + W) / v (kg per m³). */
  densityKgPerM3: number
}

export function moistAirState(
  dryBulbC: number,
  relativeHumidity: number,
  pressureKPa: number = STANDARD_PRESSURE_KPA,
): MoistAirState {
  assertRange(relativeHumidity, Number.MIN_VALUE, 1, 'Relative humidity (0–1)')
  const humidityRatio = humidityRatioFromRh(dryBulbC, relativeHumidity, pressureKPa)
  const saturationHumidityRatio = humidityRatioFromRh(dryBulbC, 1, pressureKPa)
  const specificVolume = moistAirSpecificVolumeM3PerKg(dryBulbC, humidityRatio, pressureKPa)
  return {
    dryBulbC,
    relativeHumidity,
    pressureKPa,
    vapourPressureKPa: relativeHumidity * saturationVapourPressureKPa(dryBulbC),
    humidityRatio,
    saturationHumidityRatio,
    enthalpyKJPerKg: moistAirEnthalpyKJPerKg(dryBulbC, humidityRatio),
    dewPointC: dewPointC(dryBulbC, relativeHumidity, pressureKPa),
    wetBulbC: wetBulbC(dryBulbC, relativeHumidity, pressureKPa),
    specificVolumeM3PerKg: specificVolume,
    densityKgPerM3: (1 + humidityRatio) / specificVolume,
  }
}

export interface ZoneCoolingLoadInput {
  indoorDryBulbC: number
  /** 0–1, not percent. */
  indoorRelativeHumidity: number
  outdoorDryBulbC: number
  outdoorRelativeHumidity: number
  /** Total envelope conductance including walls, roof, glazing and floor (W/K). */
  envelopeUaWPerK: number
  solarGainW?: number
  internalSensibleW?: number
  occupantSensibleW?: number
  occupantLatentW?: number
  /** Outdoor ventilation airflow, measured at the outdoor state (L/s). */
  ventilationLps: number
  /** Supply air dry-bulb; must be at least 0.5 K below the room. */
  supplyDryBulbC?: number
  /** Target velocity used to size one equivalent round duct (m/s). */
  ductVelocityMps?: number
  pressureKPa?: number
}

export interface ZoneCoolingLoadResult {
  indoor: MoistAirState
  outdoor: MoistAirState
  outdoorAirMassFlowKgPerS: number
  envelopeW: number
  ventilationSensibleW: number
  ventilationLatentW: number
  sensibleW: number
  latentW: number
  /** Signed: negative when the balance is a heating load. */
  netLoadW: number
  /** Sensible fraction of the net load; null when the net load is not positive. */
  sensibleHeatRatio: number | null
  supplyAirMassFlowKgPerS: number
  supplyAirVolumeLps: number
  equivalentDuctDiameterMm: number
  condensationExpected: boolean
  notes: string[]
}

export function analyseZoneCoolingLoad(input: ZoneCoolingLoadInput): ZoneCoolingLoadResult {
  const pressure = input.pressureKPa ?? STANDARD_PRESSURE_KPA
  const solarGainW = input.solarGainW ?? 0
  const internalSensibleW = input.internalSensibleW ?? 0
  const occupantSensibleW = input.occupantSensibleW ?? 0
  const occupantLatentW = input.occupantLatentW ?? 0
  const supplyDryBulbC = input.supplyDryBulbC ?? 13
  const ductVelocityMps = input.ductVelocityMps ?? 5

  assertNonNegative(input.envelopeUaWPerK, 'Envelope UA (W/K)')
  assertNonNegative(solarGainW, 'Solar gain (W)')
  assertNonNegative(internalSensibleW, 'Internal sensible gain (W)')
  assertNonNegative(occupantSensibleW, 'Occupant sensible gain (W)')
  assertNonNegative(occupantLatentW, 'Occupant latent gain (W)')
  assertNonNegative(input.ventilationLps, 'Ventilation airflow (L/s)')
  assertRange(supplyDryBulbC, -10, 30, 'Supply dry-bulb temperature (°C)')
  assertRange(ductVelocityMps, 1, 20, 'Duct velocity (m/s)')
  if (supplyDryBulbC > input.indoorDryBulbC - 0.5) {
    throw new Error('Supply air must be at least 0.5 °C below the room dry-bulb.')
  }

  const indoor = moistAirState(input.indoorDryBulbC, input.indoorRelativeHumidity, pressure)
  const outdoor = moistAirState(input.outdoorDryBulbC, input.outdoorRelativeHumidity, pressure)

  const outdoorVolumeFlowM3PerS = input.ventilationLps / 1000
  const outdoorAirMassFlowKgPerS = outdoorVolumeFlowM3PerS / outdoor.specificVolumeM3PerKg
  const envelopeW = input.envelopeUaWPerK * (outdoor.dryBulbC - indoor.dryBulbC)
  const ventilationTotalW =
    outdoorAirMassFlowKgPerS * (outdoor.enthalpyKJPerKg - indoor.enthalpyKJPerKg) * 1000
  const ventilationSensibleW =
    outdoorAirMassFlowKgPerS *
    DRY_AIR_CP_KJ_PER_KG_K *
    (outdoor.dryBulbC - indoor.dryBulbC) *
    1000
  const ventilationLatentW = ventilationTotalW - ventilationSensibleW

  const sensibleW =
    envelopeW + solarGainW + internalSensibleW + occupantSensibleW + ventilationSensibleW
  const latentW = occupantLatentW + ventilationLatentW
  const netLoadW = sensibleW + latentW
  const sensibleHeatRatio = netLoadW > 0 ? sensibleW / netLoadW : null

  const supplyDeltaTC = indoor.dryBulbC - supplyDryBulbC
  const supplyAirMassFlowKgPerS =
    sensibleW > 0 ? sensibleW / (DRY_AIR_CP_KJ_PER_KG_K * 1000 * supplyDeltaTC) : 0
  const supplySpecificVolume = moistAirSpecificVolumeM3PerKg(
    supplyDryBulbC,
    indoor.humidityRatio,
    pressure,
  )
  const supplyAirVolumeLps = supplyAirMassFlowKgPerS * supplySpecificVolume * 1000
  const equivalentDuctDiameterMm =
    supplyAirVolumeLps > 0
      ? Math.sqrt((4 * (supplyAirVolumeLps / 1000)) / (Math.PI * ductVelocityMps)) * 1000
      : 0
  const condensationExpected = latentW > 0 && supplyDryBulbC < indoor.dewPointC

  const notes: string[] = [
    `Steady sensible/latent balance at ${input.outdoorDryBulbC.toFixed(1)} °C outdoor design dry-bulb.`,
    'No thermal mass, solar path, duct gain, fan heat, coil bypass or part-load bin method is modelled.',
    'A transparent sizing estimate, not a certified Manual J or ASHRAE load calculation.',
  ]
  if (netLoadW <= 0) {
    notes.push('The balance is not a cooling load, so no supply airflow is sized.')
  } else {
    notes.push(
      `Supply volume assumes the supply humidity ratio equals the room value; a dehumidifying coil would move slightly less air.`,
    )
    if (condensationExpected) {
      notes.push(
        'Supply air is below the room dew point, so the coil must remove moisture; the latent load is the moisture-removal requirement.',
      )
    }
    if (supplyAirVolumeLps > 0) {
      notes.push(
        `The duct size is one equivalent round duct at ${ductVelocityMps.toFixed(1)} m/s, not a rectangular route or a friction calculation.`,
      )
    }
  }

  return {
    indoor,
    outdoor,
    outdoorAirMassFlowKgPerS,
    envelopeW,
    ventilationSensibleW,
    ventilationLatentW,
    sensibleW,
    latentW,
    netLoadW,
    sensibleHeatRatio,
    supplyAirMassFlowKgPerS,
    supplyAirVolumeLps,
    equivalentDuctDiameterMm,
    condensationExpected,
    notes,
  }
}
