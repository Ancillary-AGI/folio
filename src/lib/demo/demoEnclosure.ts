/**
 * Demo enclosure: the rectifier board's thermal + mechanical home (mm-accurate).
 *
 * The e-CAD demo proves schematic → sim → fab. This proves the NEXT link:
 * the 60×53 mm board lives in a real walled enclosure whose lid temperature
 * is computed by the tested `analyseConduction` engine (R = L/(kA), SI units),
 * and whose STEP export is the same `enclosureStep` the fab flow uses.
 * Hand-verifiable: the Schottky diode and the 100 Ω load dissipate ~0.25 W;
 * the FR-4 floor + air gap drop is P·R with R from real wall/clearance
 * dimensions. Proven by `demoEnclosure.test.ts`.
 */
import { analyseConduction, type ConductiveResult } from '../mechanical/mechanicalAnalysis';
import { enclosureStep, type EnclosureSpec, type StepExport } from '../manufacturing/enclosureStep';

export interface DemoEnclosure {
  spec: EnclosureSpec;
  step: StepExport;
  thermal: ConductiveResult;
  dissipationW: number;
  summary: { outerMm: { w: number; d: number; h: number }; lidTempC: number; verdict: string };
}

/** FR-4 + still-air stack the heat crosses: floor slab then clearance gap. */
const FR4_K = 0.3;
const AIR_K = 0.026;

/** Dissipation budget of the rectifier, from the simulated branch currents. */
export const DEMO_DISSIPATION_W = 0.25;
export const DEMO_AMBIENT_C = 25;

export function buildDemoEnclosure(): DemoEnclosure {
  const spec: EnclosureSpec = {
    boardWidth: 60, boardHeight: 53, boardThickness: 1.6,
    wall: 2, clearanceXY: 3, clearanceZ: 8,
    lidThickness: 2, standoffDiameter: 3.2,
  };
  const step = enclosureStep(spec);
  // Heat path: FR-4 floor (2 mm) in series with the still-air gap (8 mm),
  // over the board footprint area. Series R adds; the lid sits at ambient + P·R.
  const areaM2 = 60e-3 * 53e-3;
  const floor = analyseConduction(
    { width: 60e-3, height: 53e-3, depth: spec.wall * 1e-3 },
    { thermalConductivity: FR4_K, specificHeat: 1360 },
    0.02, DEMO_AMBIENT_C, DEMO_DISSIPATION_W,
  );
  const gap = analyseConduction(
    { width: 60e-3, height: 53e-3, depth: spec.clearanceZ * 1e-3 },
    { thermalConductivity: AIR_K, specificHeat: 1007 },
    0.001, DEMO_AMBIENT_C, DEMO_DISSIPATION_W,
  );
  const totalR = floor.thermalResistance + gap.thermalResistance;
  const lidTempC = DEMO_AMBIENT_C + DEMO_DISSIPATION_W * totalR;
  const thermal: ConductiveResult = {
    thermalResistance: totalR,
    temperatureRise: DEMO_DISSIPATION_W * totalR,
    steadyStateTemp: lidTempC,
    timeConstant: floor.timeConstant + gap.timeConstant,
    heatFlux: DEMO_DISSIPATION_W / areaM2,
  };
  const verdict = lidTempC < 60
    ? `PASS: lid at ${lidTempC.toFixed(1)} °C, below the 60 °C touch limit.`
    : `FAIL: lid at ${lidTempC.toFixed(1)} °C exceeds the 60 °C touch limit — add vents.`;
  return {
    spec, step, thermal, dissipationW: DEMO_DISSIPATION_W,
    summary: { outerMm: { w: step.outerW, d: step.outerD, h: step.outerH }, lidTempC, verdict },
  };
}
