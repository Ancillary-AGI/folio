/**
 * Power sources, battery chemistries, and power conversion calculators.
 * Real electronics require realistic power modeling: battery discharge curves,
 * internal resistance (ESR), switching regulator inductor/capacitor sizing,
 * and LDO thermal junction dissipation.
 */

export type BatteryChemistry = 'li-ion' | 'lifepo4' | 'cr2032' | 'lead-acid' | 'alkaline-aa';

export interface BatterySpec {
  id: string;
  name: string;
  chemistry: BatteryChemistry;
  nominalVoltageV: number;
  fullChargeVoltageV: number;
  cutoffVoltageV: number;
  capacityMah: number;
  internalResistanceOhms: number;
  maxContinuousDischargeA: number;
  chargeCurrentRecommendedA: number;
  cycleLife: number;
  weightGrams: number;
}

export const BATTERY_LIBRARY: BatterySpec[] = [
  {
    id: 'batt-18650-3000mah',
    name: '18650 Li-ion Cell (Samsung 30Q)',
    chemistry: 'li-ion',
    nominalVoltageV: 3.7,
    fullChargeVoltageV: 4.2,
    cutoffVoltageV: 3.0,
    capacityMah: 3000,
    internalResistanceOhms: 0.025,
    maxContinuousDischargeA: 15.0,
    chargeCurrentRecommendedA: 1.5,
    cycleLife: 500,
    weightGrams: 48,
  },
  {
    id: 'batt-lifepo4-26650',
    name: '26650 LiFePO4 Cell (A123 Systems)',
    chemistry: 'lifepo4',
    nominalVoltageV: 3.2,
    fullChargeVoltageV: 3.65,
    cutoffVoltageV: 2.5,
    capacityMah: 2500,
    internalResistanceOhms: 0.010,
    maxContinuousDischargeA: 50.0,
    chargeCurrentRecommendedA: 2.5,
    cycleLife: 2000,
    weightGrams: 76,
  },
  {
    id: 'batt-coin-cr2032',
    name: 'CR2032 Lithium Coin Cell',
    chemistry: 'cr2032',
    nominalVoltageV: 3.0,
    fullChargeVoltageV: 3.3,
    cutoffVoltageV: 2.0,
    capacityMah: 225,
    internalResistanceOhms: 20.0,
    maxContinuousDischargeA: 0.003, // 3 mA continuous
    chargeCurrentRecommendedA: 0.0, // Primary cell (non-rechargeable)
    cycleLife: 1,
    weightGrams: 3.0,
  },
  {
    id: 'batt-alkaline-aa',
    name: 'Standard Alkaline AA Cell',
    chemistry: 'alkaline-aa',
    nominalVoltageV: 1.5,
    fullChargeVoltageV: 1.6,
    cutoffVoltageV: 0.9,
    capacityMah: 2500,
    internalResistanceOhms: 0.15,
    maxContinuousDischargeA: 1.0,
    chargeCurrentRecommendedA: 0.0,
    cycleLife: 1,
    weightGrams: 23,
  },
];

/**
 * Approximate Open Circuit Voltage (OCV) as a function of State of Charge (SOC 0.0 to 1.0).
 */
export function batteryOcvAtSoc(battery: BatterySpec, soc: number): number {
  const s = Math.max(0.0, Math.min(1.0, soc));
  const vMin = battery.cutoffVoltageV;
  const vNom = battery.nominalVoltageV;
  const vMax = battery.fullChargeVoltageV;

  if (battery.chemistry === 'li-ion') {
    // Typical S-curve for Li-ion NMC
    if (s <= 0.1) return vMin + (vNom - 0.2 - vMin) * (s / 0.1);
    if (s <= 0.9) return (vNom - 0.2) + 0.4 * ((s - 0.1) / 0.8);
    return (vNom + 0.2) + (vMax - (vNom + 0.2)) * ((s - 0.9) / 0.1);
  }

  if (battery.chemistry === 'lifepo4') {
    // Ultra-flat 3.2V plateau
    if (s <= 0.05) return vMin + (3.15 - vMin) * (s / 0.05);
    if (s <= 0.95) return 3.20 + 0.10 * ((s - 0.05) / 0.9);
    return 3.30 + (vMax - 3.30) * ((s - 0.95) / 0.05);
  }

  // Linear interpolation for simple chemistries
  return vMin + s * (vMax - vMin);
}

/**
 * Calculate terminal voltage under load: V_term = V_ocv - I_load * R_int.
 */
export function batteryTerminalVoltage(battery: BatterySpec, soc: number, loadCurrentA: number): number {
  if (loadCurrentA < 0) throw new Error('Load current must be non-negative.');
  const ocv = batteryOcvAtSoc(battery, soc);
  return ocv - loadCurrentA * battery.internalResistanceOhms;
}

export interface BuckDesignInput {
  vinV: number;
  voutV: number;
  ioutA: number;
  switchingFreqHz: number;
  efficiencyPercent?: number;
  inductorRippleRatio?: number; // delta_IL / Iout, default 0.35
  maxVoutRippleV?: number;
}

export interface BuckDesignResult {
  dutyCycle: number;
  inductanceHenrys: number;
  inductanceMicroH: number;
  inductorPeakCurrentA: number;
  inductorRmsCurrentA: number;
  minOutputCapacitanceFarads: number;
  minOutputCapacitanceUf: number;
}

/**
 * Calculate ideal component parameters for a synchronous buck regulator.
 */
export function calculateBuckConverter(input: BuckDesignInput): BuckDesignResult {
  const { vinV, voutV, ioutA, switchingFreqHz } = input;
  if (vinV <= voutV) throw new Error(`Buck requires Vin (${vinV}V) > Vout (${voutV}V).`);
  if (ioutA <= 0) throw new Error('Output current must be positive.');
  if (switchingFreqHz <= 0) throw new Error('Switching frequency must be positive.');

  const efficiency = (input.efficiencyPercent ?? 90) / 100;
  const rippleRatio = input.inductorRippleRatio ?? 0.35;
  const maxRippleV = input.maxVoutRippleV ?? (voutV * 0.01); // 1% default

  const d = voutV / (vinV * efficiency);
  const deltaIl = rippleRatio * ioutA;
  const l = (voutV * (1 - d)) / (deltaIl * switchingFreqHz);
  const iPeak = ioutA + deltaIl / 2;
  const iRms = Math.sqrt(ioutA * ioutA + (deltaIl * deltaIl) / 12);

  // Cout based on capacitive charge ripple: delta_V = delta_IL / (8 * f_sw * C_out)
  const cout = deltaIl / (8 * switchingFreqHz * maxRippleV);

  return {
    dutyCycle: Number(d.toFixed(4)),
    inductanceHenrys: l,
    inductanceMicroH: Number((l * 1e6).toFixed(2)),
    inductorPeakCurrentA: Number(iPeak.toFixed(2)),
    inductorRmsCurrentA: Number(iRms.toFixed(2)),
    minOutputCapacitanceFarads: cout,
    minOutputCapacitanceUf: Number((cout * 1e6).toFixed(2)),
  };
}

export interface LdoThermalResult {
  powerDissipationW: number;
  junctionTempC: number;
  isOverheating: boolean;
  maxAmbientTempC: number;
}

/**
 * Calculate thermal dissipation and junction temperature for an LDO.
 */
export function calculateLdoThermal(
  vinV: number,
  voutV: number,
  iloadA: number,
  quiescentCurrentA: number,
  thetaJaCperW: number,
  ambientTempC: number = 25,
  maxAllowedJunctionTempC: number = 125,
): LdoThermalResult {
  if (vinV < voutV) throw new Error('LDO Vin must be >= Vout.');
  const pd = (vinV - voutV) * iloadA + vinV * quiescentCurrentA;
  const tj = ambientTempC + pd * thetaJaCperW;
  const maxTamb = maxAllowedJunctionTempC - pd * thetaJaCperW;

  return {
    powerDissipationW: Number(pd.toFixed(3)),
    junctionTempC: Number(tj.toFixed(1)),
    isOverheating: tj > maxAllowedJunctionTempC,
    maxAmbientTempC: Number(maxTamb.toFixed(1)),
  };
}
