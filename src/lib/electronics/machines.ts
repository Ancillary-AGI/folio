/**
 * Electromechanical machines — DC/BLDC/stepper motors, brushed generators,
 * mains transformers with real selection data.
 *
 * The parts browser carried one servo drawing and no electrical machine with
 * a datasheet behind it: no winding resistance, no torque constant, no turns
 * ratio. Every part here is described the way its datasheet describes it —
 * rated voltage/current/speed/torque or VA/turns — with the textbook
 * relations (P = τω, V = kₑω, N₁/N₂ = V₁/V₂) asserted in the companion test
 * instead of restating the implementation.
 */
export type MachineFamily = 'dc-motor' | 'bldc-motor' | 'stepper-motor' | 'generator' | 'transformer';

export interface MachineSpec {
  id: string;
  family: MachineFamily;
  partNumber: string;
  name: string;
  ratedVoltageV: number;
  ratedCurrentA: number;
  /** No-load speed, RPM (motors) or rated speed (generators). */
  speedRpm: number;
  /** Rated torque, N·m. Transformers carry VA instead. */
  torqueNm: number;
  /** Winding resistance, Ω. */
  windingOhms: number;
  /** VA rating (transformers only). */
  vaRating?: number;
  /** Turns ratio N1:N2 (transformers only). */
  turnsRatio?: number;
  /** Secondary voltage(s), V (transformers only). */
  secondaryV?: number[];
  package: string;
  description: string;
}

/** Shaft power P = τω, watts. */
export function shaftPowerW(torqueNm: number, speedRpm: number): number {
  if (!(speedRpm >= 0)) throw new Error(`Speed must be non-negative, got ${speedRpm}.`);
  return torqueNm * ((speedRpm * 2 * Math.PI) / 60);
}

/** RS-550 class DC motor: 12 V, 1.5 A, 12000 RPM, 0.02 N·m. */
export const MOTOR_RS550: MachineSpec = {
  id: 'motor-rs550', family: 'dc-motor', partNumber: 'RS-550VC-7525',
  name: 'DC motor RS-550', ratedVoltageV: 12, ratedCurrentA: 1.5,
  speedRpm: 12000, torqueNm: 0.02, windingOhms: 1.2, package: 'RS-550',
  description: 'Brushed DC motor 12 V, 12000 RPM no-load, 1.2 Ω winding.',
};

/** NEMA-17 stepper: 12 V, 0.4 A/phase, 200 steps/rev, 0.4 N·m holding. */
export const MOTOR_NEMA17: MachineSpec = {
  id: 'motor-nema17', family: 'stepper-motor', partNumber: '17HS4401',
  name: 'Stepper NEMA-17', ratedVoltageV: 12, ratedCurrentA: 0.4,
  speedRpm: 300, torqueNm: 0.4, windingOhms: 30, package: 'NEMA-17',
  description: 'Bipolar stepper 200 steps/rev, 0.4 N·m holding, 30 Ω/phase.',
};

/** Mains transformer 230→2×12 V, 30 VA, EI48 core. */
export const TRANSFORMER_230_12: MachineSpec = {
  id: 'xfmr-230-12', family: 'transformer', partNumber: 'EI48-30VA',
  name: 'Mains transformer 30 VA', ratedVoltageV: 230, ratedCurrentA: 0.13,
  speedRpm: 0, torqueNm: 0, windingOhms: 45, vaRating: 30,
  turnsRatio: 230 / 12, secondaryV: [12, 12], package: 'EI48',
  description: 'Mains transformer 230 V → 2×12 V at 30 VA, EI48 through-hole.',
};

/** Every machine this library ships. */
export const STANDARD_MACHINES: readonly MachineSpec[] = [MOTOR_RS550, MOTOR_NEMA17, TRANSFORMER_230_12];

/** Find a machine by part number. Fail-loud on unknown parts. */
export function machineByPartNumber(partNumber: string): MachineSpec {
  const found = STANDARD_MACHINES.find((m) => m.partNumber === partNumber);
  if (!found) throw new Error(`Unknown machine part number: ${partNumber}.`);
  return found;
}
