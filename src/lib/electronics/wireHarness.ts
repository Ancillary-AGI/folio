/**
 * Wire harness engineering, AWG conductor standards, bundle derating, and voltage drop.
 * Connectors are only as good as the copper between them. Calculates resistance
 * over temperature, bundle ampacity derating per SAE AS50881 / IPC-2152,
 * and minimum gauge selection for allowable loop drops.
 */

export interface AwgConductorSpec {
  awg: number;
  diameterMm: number;
  crossSectionMm2: number;
  dcResistanceOhmsPerKmAt20C: number;
  ampacityChassisA: number;
  ampacityBundleA: number;
}

export const AWG_TABLE: Record<number, AwgConductorSpec> = {
  10: { awg: 10, diameterMm: 2.588, crossSectionMm2: 5.26, dcResistanceOhmsPerKmAt20C: 3.28, ampacityChassisA: 55, ampacityBundleA: 33 },
  12: { awg: 12, diameterMm: 2.053, crossSectionMm2: 3.31, dcResistanceOhmsPerKmAt20C: 5.21, ampacityChassisA: 41, ampacityBundleA: 25 },
  14: { awg: 14, diameterMm: 1.628, crossSectionMm2: 2.08, dcResistanceOhmsPerKmAt20C: 8.28, ampacityChassisA: 32, ampacityBundleA: 20 },
  16: { awg: 16, diameterMm: 1.291, crossSectionMm2: 1.31, dcResistanceOhmsPerKmAt20C: 13.17, ampacityChassisA: 22, ampacityBundleA: 13 },
  18: { awg: 18, diameterMm: 1.024, crossSectionMm2: 0.823, dcResistanceOhmsPerKmAt20C: 20.95, ampacityChassisA: 16, ampacityBundleA: 10 },
  20: { awg: 20, diameterMm: 0.812, crossSectionMm2: 0.518, dcResistanceOhmsPerKmAt20C: 33.31, ampacityChassisA: 11, ampacityBundleA: 6.5 },
  22: { awg: 22, diameterMm: 0.644, crossSectionMm2: 0.326, dcResistanceOhmsPerKmAt20C: 52.96, ampacityChassisA: 7.0, ampacityBundleA: 4.5 },
  24: { awg: 24, diameterMm: 0.511, crossSectionMm2: 0.205, dcResistanceOhmsPerKmAt20C: 84.22, ampacityChassisA: 3.5, ampacityBundleA: 2.1 },
  26: { awg: 26, diameterMm: 0.405, crossSectionMm2: 0.129, dcResistanceOhmsPerKmAt20C: 133.9, ampacityChassisA: 2.2, ampacityBundleA: 1.3 },
  28: { awg: 28, diameterMm: 0.321, crossSectionMm2: 0.081, dcResistanceOhmsPerKmAt20C: 212.9, ampacityChassisA: 1.4, ampacityBundleA: 0.8 },
  30: { awg: 30, diameterMm: 0.255, crossSectionMm2: 0.051, dcResistanceOhmsPerKmAt20C: 338.6, ampacityChassisA: 0.86, ampacityBundleA: 0.5 },
  32: { awg: 32, diameterMm: 0.202, crossSectionMm2: 0.032, dcResistanceOhmsPerKmAt20C: 538.4, ampacityChassisA: 0.53, ampacityBundleA: 0.3 },
};

const COPPER_TEMP_COEFF = 0.00393; // 1/°C at 20°C

/**
 * Conductor resistance adjusted for temperature.
 */
export function copperResistanceAtTemp(r20Ohms: number, tempC: number): number {
  return r20Ohms * (1 + COPPER_TEMP_COEFF * (tempC - 20));
}

/**
 * Bundle derating factor per SAE AS50881 based on number of loaded conductors.
 */
export function getBundleDeratingFactor(numberOfLoadedConductors: number): number {
  if (numberOfLoadedConductors <= 0) throw new Error('Loaded conductors must be at least 1.');
  if (numberOfLoadedConductors <= 3) return 1.0;
  if (numberOfLoadedConductors <= 6) return 0.8;
  if (numberOfLoadedConductors <= 9) return 0.7;
  if (numberOfLoadedConductors <= 15) return 0.6;
  if (numberOfLoadedConductors <= 20) return 0.5;
  return 0.4;
}

export interface LoopDropResult {
  resistanceOhms: number;
  voltageDropV: number;
  voltageDropPercent: number;
  powerLossW: number;
  isAmpacityExceeded: boolean;
}

/**
 * Calculate round-trip loop drop (forward + return path) for a wire harness run.
 */
export function calculateHarnessLoopDrop(
  awg: number,
  oneWayLengthMeters: number,
  currentA: number,
  systemVoltageV: number,
  conductorsInBundle: number = 1,
  ambientTempC: number = 25,
): LoopDropResult {
  const spec = AWG_TABLE[awg];
  if (!spec) throw new Error(`AWG ${awg} is not in standard lookup table (10–32).`);
  if (oneWayLengthMeters <= 0) throw new Error('Length must be positive.');
  if (currentA < 0) throw new Error('Current must be non-negative.');

  // Round trip length = 2 * oneWayLength
  const totalLengthKm = (2 * oneWayLengthMeters) / 1000;
  const r20 = spec.dcResistanceOhmsPerKmAt20C * totalLengthKm;
  const rActual = copperResistanceAtTemp(r20, ambientTempC);

  const vDrop = currentA * rActual;
  const vDropPercent = (vDrop / systemVoltageV) * 100;
  const pLoss = currentA * currentA * rActual;

  const derating = getBundleDeratingFactor(conductorsInBundle);
  const maxSafeCurrent = spec.ampacityBundleA * derating;

  return {
    resistanceOhms: Number(rActual.toFixed(4)),
    voltageDropV: Number(vDrop.toFixed(4)),
    voltageDropPercent: Number(vDropPercent.toFixed(2)),
    powerLossW: Number(pLoss.toFixed(4)),
    isAmpacityExceeded: currentA > maxSafeCurrent,
  };
}

/**
 * Recommend minimum AWG wire gauge that satisfies both ampacity and max voltage drop.
 */
export function recommendWireGauge(
  oneWayLengthMeters: number,
  currentA: number,
  systemVoltageV: number,
  maxAllowableDropPercent: number = 3.0,
  conductorsInBundle: number = 1,
  ambientTempC: number = 25,
): { recommendedAwg: number; result: LoopDropResult } {
  const availableGauges = Object.keys(AWG_TABLE)
    .map(Number)
    .sort((a, b) => b - a); // Start from thinnest (32 down to 10)

  for (const awg of availableGauges) {
    const res = calculateHarnessLoopDrop(
      awg,
      oneWayLengthMeters,
      currentA,
      systemVoltageV,
      conductorsInBundle,
      ambientTempC,
    );
    if (!res.isAmpacityExceeded && res.voltageDropPercent <= maxAllowableDropPercent) {
      return { recommendedAwg: awg, result: res };
    }
  }

  // If even AWG 10 fails, return AWG 10 with flag
  return {
    recommendedAwg: 10,
    result: calculateHarnessLoopDrop(
      10,
      oneWayLengthMeters,
      currentA,
      systemVoltageV,
      conductorsInBundle,
      ambientTempC,
    ),
  };
}
