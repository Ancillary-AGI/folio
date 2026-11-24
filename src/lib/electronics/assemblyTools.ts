/**
 * Assembly tools, manufacturing techniques, soldering profiles, and wire harness standards.
 * Covers JEDEC J-STD-020 reflow profiles, IPC/WHMA-A-620 crimping pull-force limits,
 * and heat shrink tubing specifications.
 */

export interface ReflowProfileStage {
  name: string;
  targetTempC: number;
  durationSeconds: number;
  maxRampRateDegPerSec: number;
}

export interface ReflowProfileSpec {
  alloy: 'SAC305' | 'Sn63Pb37' | 'Sn42Bi58';
  name: string;
  isLeadFree: boolean;
  liquidusTempC: number;
  preheatRangeC: [number, number];
  preheatDurationSec: [number, number];
  timeAboveLiquidusSec: [number, number];
  peakTempC: [number, number];
  maxRampUpRateCPerSec: number;
  maxRampDownRateCPerSec: number;
}

export const REFLOW_PROFILES: Record<string, ReflowProfileSpec> = {
  sac305: {
    alloy: 'SAC305',
    name: 'JEDEC J-STD-020 Lead-Free Standard (SAC305)',
    isLeadFree: true,
    liquidusTempC: 217,
    preheatRangeC: [150, 200],
    preheatDurationSec: [60, 120],
    timeAboveLiquidusSec: [60, 150],
    peakTempC: [240, 255],
    maxRampUpRateCPerSec: 3.0,
    maxRampDownRateCPerSec: 6.0,
  },
  sn63pb37: {
    alloy: 'Sn63Pb37',
    name: 'Eutectic Tin-Lead Profile (Sn63/Pb37)',
    isLeadFree: false,
    liquidusTempC: 183,
    preheatRangeC: [120, 160],
    preheatDurationSec: [60, 120],
    timeAboveLiquidusSec: [45, 90],
    peakTempC: [215, 230],
    maxRampUpRateCPerSec: 3.0,
    maxRampDownRateCPerSec: 4.0,
  },
  lowTempBismuth: {
    alloy: 'Sn42Bi58',
    name: 'Low-Temperature Bismuth-Tin (Sn42/Bi58)',
    isLeadFree: true,
    liquidusTempC: 138,
    preheatRangeC: [90, 125],
    preheatDurationSec: [60, 100],
    timeAboveLiquidusSec: [45, 90],
    peakTempC: [165, 180],
    maxRampUpRateCPerSec: 2.5,
    maxRampDownRateCPerSec: 4.0,
  },
};

export interface ProfileViolation {
  stage: string;
  parameter: string;
  measured: number;
  expected: string;
}

/**
 * Validate a user-measured reflow oven profile against JEDEC specs.
 */
export function validateReflowProfile(
  profileSpec: ReflowProfileSpec,
  samples: Array<{ timeSec: number; tempC: number }>,
): { valid: boolean; violations: ProfileViolation[] } {
  const violations: ProfileViolation[] = [];
  if (samples.length < 2) {
    throw new Error('Profile requires at least two time-temperature samples.');
  }

  // 1. Check max ramp-up and ramp-down rates
  for (let i = 1; i < samples.length; i += 1) {
    const dt = samples[i].timeSec - samples[i - 1].timeSec;
    if (dt <= 0) throw new Error('Sample time must be strictly increasing.');
    const dTemp = samples[i].tempC - samples[i - 1].tempC;
    const rate = dTemp / dt;
    if (rate > profileSpec.maxRampUpRateCPerSec) {
      violations.push({
        stage: `t=${samples[i].timeSec}s`,
        parameter: 'Ramp-up rate',
        measured: Number(rate.toFixed(2)),
        expected: `<= ${profileSpec.maxRampUpRateCPerSec} °C/s`,
      });
    }
    if (rate < -profileSpec.maxRampDownRateCPerSec) {
      violations.push({
        stage: `t=${samples[i].timeSec}s`,
        parameter: 'Cooling rate',
        measured: Number(Math.abs(rate).toFixed(2)),
        expected: `<= ${profileSpec.maxRampDownRateCPerSec} °C/s`,
      });
    }
  }

  // 2. Peak temperature check
  const peakTemp = Math.max(...samples.map((s) => s.tempC));
  if (peakTemp < profileSpec.peakTempC[0] || peakTemp > profileSpec.peakTempC[1]) {
    violations.push({
      stage: 'Peak',
      parameter: 'Peak Temperature',
      measured: peakTemp,
      expected: `${profileSpec.peakTempC[0]}–${profileSpec.peakTempC[1]} °C`,
    });
  }

  // 3. Time above liquidus (TAL)
  let tal = 0;
  for (let i = 1; i < samples.length; i += 1) {
    const avgTemp = (samples[i].tempC + samples[i - 1].tempC) / 2;
    if (avgTemp >= profileSpec.liquidusTempC) {
      tal += samples[i].timeSec - samples[i - 1].timeSec;
    }
  }
  if (tal < profileSpec.timeAboveLiquidusSec[0] || tal > profileSpec.timeAboveLiquidusSec[1]) {
    violations.push({
      stage: 'Reflow',
      parameter: 'Time Above Liquidus (TAL)',
      measured: Number(tal.toFixed(1)),
      expected: `${profileSpec.timeAboveLiquidusSec[0]}–${profileSpec.timeAboveLiquidusSec[1]} s`,
    });
  }

  return { valid: violations.length === 0, violations };
}

/**
 * IPC/WHMA-A-620 Minimum pull-off tensile force requirements for crimped terminals.
 */
export const CRIMP_PULL_FORCE_N: Record<number, number> = {
  30: 7.0,
  28: 11.0,
  26: 18.0,
  24: 31.0,
  22: 49.0,
  20: 71.0,
  18: 111.0,
  16: 160.0,
  14: 245.0,
  12: 356.0,
  10: 489.0,
};

export function getMinimumCrimpTensileForce(awg: number): number {
  const force = CRIMP_PULL_FORCE_N[awg];
  if (force === undefined) {
    throw new Error(`AWG ${awg} is outside the IPC/WHMA-A-620 pull force lookup table (10–30).`);
  }
  return force;
}

export interface HeatShrinkSpec {
  nominalSizeInch: string;
  shrinkRatio: '2:1' | '3:1' | '4:1';
  expandedDiameterMm: number;
  recoveredDiameterMm: number;
  recoveredWallMm: number;
  hasAdhesiveLining: boolean;
  dielectricStrengthKvMm: number;
}

export const HEAT_SHRINK_TUBING: HeatShrinkSpec[] = [
  {
    nominalSizeInch: '1/16"',
    shrinkRatio: '2:1',
    expandedDiameterMm: 1.6,
    recoveredDiameterMm: 0.8,
    recoveredWallMm: 0.45,
    hasAdhesiveLining: false,
    dielectricStrengthKvMm: 25,
  },
  {
    nominalSizeInch: '1/8"',
    shrinkRatio: '2:1',
    expandedDiameterMm: 3.2,
    recoveredDiameterMm: 1.6,
    recoveredWallMm: 0.5,
    hasAdhesiveLining: false,
    dielectricStrengthKvMm: 25,
  },
  {
    nominalSizeInch: '3/16"',
    shrinkRatio: '3:1',
    expandedDiameterMm: 4.8,
    recoveredDiameterMm: 1.6,
    recoveredWallMm: 0.9,
    hasAdhesiveLining: true,
    dielectricStrengthKvMm: 30,
  },
  {
    nominalSizeInch: '1/4"',
    shrinkRatio: '3:1',
    expandedDiameterMm: 6.4,
    recoveredDiameterMm: 2.1,
    recoveredWallMm: 1.1,
    hasAdhesiveLining: true,
    dielectricStrengthKvMm: 30,
  },
];
