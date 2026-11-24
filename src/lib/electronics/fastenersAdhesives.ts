/**
 * Fasteners, mounting hardware, thermal adhesives, and protective coatings.
 * Real CAD boards are physical objects: they mount on standoffs, transfer heat
 * through thermal interface materials (TIM), resist shock via potting/underfill,
 * and resist humidity and corrosion through IPC-CC-830 conformal coatings.
 */

export type FastenerMaterial = 'brass' | 'nylon' | 'stainless-steel' | 'aluminum';
export type StandoffGender = 'female-female' | 'male-female' | 'male-male';
export type ThreadSize = 'M2' | 'M2.5' | 'M3' | 'M4';

export interface StandoffSpec {
  id: string;
  thread: ThreadSize;
  gender: StandoffGender;
  material: FastenerMaterial;
  bodyLengthMm: number;
  threadLengthMm: number;
  outerDiameterMm: number;
  keepoutDiameterMm: number;
  recommendedHoleDiameterMm: number;
  recommendedAnnularRingMm: number;
  maxTorqueNm: number;
}

export const THREAD_PITCH_MM: Record<ThreadSize, number> = {
  M2: 0.4,
  'M2.5': 0.45,
  M3: 0.5,
  M4: 0.7,
};

export const STANDARD_STANDOFFS: StandoffSpec[] = [
  {
    id: 'standoff-m2-10mm-brass',
    thread: 'M2',
    gender: 'female-female',
    material: 'brass',
    bodyLengthMm: 10,
    threadLengthMm: 0,
    outerDiameterMm: 4.0,
    keepoutDiameterMm: 5.0,
    recommendedHoleDiameterMm: 2.2,
    recommendedAnnularRingMm: 4.5,
    maxTorqueNm: 0.25,
  },
  {
    id: 'standoff-m2.5-12mm-brass',
    thread: 'M2.5',
    gender: 'female-female',
    material: 'brass',
    bodyLengthMm: 12,
    threadLengthMm: 0,
    outerDiameterMm: 4.8,
    keepoutDiameterMm: 6.0,
    recommendedHoleDiameterMm: 2.7,
    recommendedAnnularRingMm: 5.5,
    maxTorqueNm: 0.45,
  },
  {
    id: 'standoff-m3-15mm-brass-mf',
    thread: 'M3',
    gender: 'male-female',
    material: 'brass',
    bodyLengthMm: 15,
    threadLengthMm: 6,
    outerDiameterMm: 5.5,
    keepoutDiameterMm: 7.0,
    recommendedHoleDiameterMm: 3.2,
    recommendedAnnularRingMm: 6.5,
    maxTorqueNm: 0.65,
  },
  {
    id: 'standoff-m3-10mm-nylon',
    thread: 'M3',
    gender: 'female-female',
    material: 'nylon',
    bodyLengthMm: 10,
    threadLengthMm: 0,
    outerDiameterMm: 5.5,
    keepoutDiameterMm: 7.0,
    recommendedHoleDiameterMm: 3.2,
    recommendedAnnularRingMm: 6.5,
    maxTorqueNm: 0.2,
  },
];

export interface TimSpec {
  id: string;
  name: string;
  kind: 'thermal-pad' | 'thermal-grease' | 'phase-change' | 'conductive-epoxy';
  /** Thermal conductivity in W/(m·K). */
  conductivityWmk: number;
  /** Thickness in millimetres. */
  typicalThicknessMm: number;
  /** Dielectric breakdown voltage in kV/mm. */
  dielectricStrengthKvMm: number;
  operatingTempRangeC: [number, number];
  densityGcm3: number;
}

export const TIM_LIBRARY: TimSpec[] = [
  {
    id: 'tim-pad-standard',
    name: 'Silicone Thermal Gap Pad',
    kind: 'thermal-pad',
    conductivityWmk: 3.0,
    typicalThicknessMm: 1.0,
    dielectricStrengthKvMm: 5.0,
    operatingTempRangeC: [-40, 150],
    densityGcm3: 2.1,
  },
  {
    id: 'tim-pad-high-perf',
    name: 'Advanced Boron-Nitride Gap Pad',
    kind: 'thermal-pad',
    conductivityWmk: 6.0,
    typicalThicknessMm: 0.5,
    dielectricStrengthKvMm: 8.0,
    operatingTempRangeC: [-50, 180],
    densityGcm3: 2.7,
  },
  {
    id: 'tim-grease-silver',
    name: 'Silver-Loaded Thermal Paste',
    kind: 'thermal-grease',
    conductivityWmk: 8.5,
    typicalThicknessMm: 0.05,
    dielectricStrengthKvMm: 0.0, // Electrically conductive
    operatingTempRangeC: [-50, 150],
    densityGcm3: 3.2,
  },
  {
    id: 'tim-epoxy-alumina',
    name: 'Thermally Conductive Epoxy (Alumina)',
    kind: 'conductive-epoxy',
    conductivityWmk: 1.8,
    typicalThicknessMm: 0.1,
    dielectricStrengthKvMm: 12.0,
    operatingTempRangeC: [-40, 130],
    densityGcm3: 1.9,
  },
];

/**
 * Calculate thermal resistance R_th = t / (k * A) in K/W.
 * @param conductivityWmk Thermal conductivity in W/(m·K)
 * @param thicknessMm Thickness in millimetres
 * @param areaMm2 Contact area in square millimetres
 */
export function thermalResistanceKw(conductivityWmk: number, thicknessMm: number, areaMm2: number): number {
  if (conductivityWmk <= 0) throw new Error('Thermal conductivity must be positive.');
  if (thicknessMm <= 0) throw new Error('Thickness must be positive.');
  if (areaMm2 <= 0) throw new Error('Contact area must be positive.');
  const thicknessM = thicknessMm * 1e-3;
  const areaM2 = areaMm2 * 1e-6;
  return thicknessM / (conductivityWmk * areaM2);
}

export type CoatingType = 'AR' | 'UR' | 'ER' | 'SR' | 'XY';

export interface ConformalCoatingSpec {
  type: CoatingType;
  name: string;
  ipcStandard: string;
  typicalThicknessUm: [number, number];
  dielectricStrengthVmil: number;
  moistureResistance: 'fair' | 'good' | 'excellent';
  chemicalResistance: 'fair' | 'good' | 'excellent';
  reworkability: 'easy' | 'moderate' | 'difficult';
  tempRangeC: [number, number];
}

export const CONFORMAL_COATINGS: Record<CoatingType, ConformalCoatingSpec> = {
  AR: {
    type: 'AR',
    name: 'Acrylic Resin',
    ipcStandard: 'IPC-CC-830 Type AR',
    typicalThicknessUm: [30, 130],
    dielectricStrengthVmil: 1500,
    moistureResistance: 'good',
    chemicalResistance: 'fair',
    reworkability: 'easy',
    tempRangeC: [-65, 125],
  },
  UR: {
    type: 'UR',
    name: 'Polyurethane Resin',
    ipcStandard: 'IPC-CC-830 Type UR',
    typicalThicknessUm: [30, 130],
    dielectricStrengthVmil: 3500,
    moistureResistance: 'excellent',
    chemicalResistance: 'good',
    reworkability: 'difficult',
    tempRangeC: [-65, 125],
  },
  ER: {
    type: 'ER',
    name: 'Epoxy Resin',
    ipcStandard: 'IPC-CC-830 Type ER',
    typicalThicknessUm: [30, 130],
    dielectricStrengthVmil: 2000,
    moistureResistance: 'excellent',
    chemicalResistance: 'excellent',
    reworkability: 'difficult',
    tempRangeC: [-65, 150],
  },
  SR: {
    type: 'SR',
    name: 'Silicone Resin',
    ipcStandard: 'IPC-CC-830 Type SR',
    typicalThicknessUm: [50, 210],
    dielectricStrengthVmil: 1000,
    moistureResistance: 'good',
    chemicalResistance: 'fair',
    reworkability: 'moderate',
    tempRangeC: [-65, 200],
  },
  XY: {
    type: 'XY',
    name: 'Parylene (Vapour Deposited)',
    ipcStandard: 'IPC-CC-830 Type XY',
    typicalThicknessUm: [10, 50],
    dielectricStrengthVmil: 5000,
    moistureResistance: 'excellent',
    chemicalResistance: 'excellent',
    reworkability: 'difficult',
    tempRangeC: [-200, 150],
  },
};

export interface PottingCompoundSpec {
  id: string;
  name: string;
  baseChemistry: 'polyurethane' | 'epoxy' | 'silicone';
  shoreHardness: string;
  operatingTempRangeC: [number, number];
  cureTimeHoursAt25C: number;
  dielectricStrengthKvMm: number;
  waterAbsorptionPercent: number;
}

export const POTTING_COMPOUNDS: PottingCompoundSpec[] = [
  {
    id: 'potting-pu-flexible',
    name: 'Flexible Polyurethane Potting',
    baseChemistry: 'polyurethane',
    shoreHardness: 'Shore A 60',
    operatingTempRangeC: [-40, 120],
    cureTimeHoursAt25C: 24,
    dielectricStrengthKvMm: 18,
    waterAbsorptionPercent: 0.15,
  },
  {
    id: 'potting-epoxy-rigid',
    name: 'Rigid High-Impact Epoxy Potting',
    baseChemistry: 'epoxy',
    shoreHardness: 'Shore D 85',
    operatingTempRangeC: [-50, 155],
    cureTimeHoursAt25C: 16,
    dielectricStrengthKvMm: 22,
    waterAbsorptionPercent: 0.08,
  },
];
