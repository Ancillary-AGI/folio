import { describe, expect, it } from 'vitest';
import {
  analyseBeam,
  analyseConduction,
  analyseEmc,
  cylinderMassInertia,
  cylinderSectionInertia,
  prismInertia,
  prismMassInertia,
  sphereMassInertia,
  type PrismDimensions,
} from './mechanicalAnalysis';
import { circleInertia, rectangleInertia } from './structural';

const MU_0 = 4 * Math.PI * 1e-7;

const ALUMINIUM_THERMAL = { thermalConductivity: 167, specificHeat: 900 };
const STEEL = { youngsModulus: 200e9, yieldStrength: 250e6, density: 7850 };

/** A 100 x 60 x 20 mm aluminium slab. */
const SLAB: PrismDimensions = { width: 0.1, height: 0.06, depth: 0.02 };

describe('conduction', () => {
  it('matches R = L/(kA) with the real thickness', () => {
    const area = SLAB.width * SLAB.height;
    const expected = SLAB.depth / (ALUMINIUM_THERMAL.thermalConductivity * area);
    const result = analyseConduction(SLAB, ALUMINIUM_THERMAL, 0.324, 25, 10);
    expect(result.thermalResistance).toBeCloseTo(expected, 12);
    expect(result.temperatureRise).toBeCloseTo(10 * expected, 12);
    expect(result.steadyStateTemp).toBeCloseTo(25 + 10 * expected, 10);
    expect(result.heatFlux).toBeCloseTo(10 / area, 6);
  });

  it('matches the time constant C/R with C = m·c_p', () => {
    const mass = 0.5;
    const result = analyseConduction(SLAB, ALUMINIUM_THERMAL, mass, 20, 5);
    const capacity = mass * ALUMINIUM_THERMAL.specificHeat;
    expect(result.timeConstant).toBeCloseTo(capacity * result.thermalResistance, 12);
  });

  it('scales the resistance with thickness, which the old 1/(kA) form could not', () => {
    const thin = analyseConduction(SLAB, ALUMINIUM_THERMAL, 1, 20, 5);
    const thick = analyseConduction({ ...SLAB, depth: SLAB.depth * 3 }, ALUMINIUM_THERMAL, 1, 20, 5);
    expect(thick.thermalResistance / thin.thermalResistance).toBeCloseTo(3, 12);
    expect(thick.temperatureRise / thin.temperatureRise).toBeCloseTo(3, 12);
  });

  it('returns ambient at zero dissipation', () => {
    const result = analyseConduction(SLAB, ALUMINIUM_THERMAL, 1, 25, 0);
    expect(result.temperatureRise).toBe(0);
    expect(result.steadyStateTemp).toBeCloseTo(25, 12);
    expect(result.heatFlux).toBe(0);
  });

  it('rejects a non-positive dimension, conductivity, specific heat or mass', () => {
    expect(() =>
      analyseConduction({ ...SLAB, width: 0 }, ALUMINIUM_THERMAL, 1, 25, 5),
    ).toThrow(/width/);
    expect(() =>
      analyseConduction(SLAB, { ...ALUMINIUM_THERMAL, thermalConductivity: 0 }, 1, 25, 5),
    ).toThrow(/thermalConductivity/);
    expect(() =>
      analyseConduction(SLAB, { ...ALUMINIUM_THERMAL, specificHeat: -1 }, 1, 25, 5),
    ).toThrow(/specificHeat/);
    expect(() => analyseConduction(SLAB, ALUMINIUM_THERMAL, 0, 25, 5)).toThrow(/mass/);
    expect(() => analyseConduction(SLAB, ALUMINIUM_THERMAL, 1, 25, -5)).toThrow(
      /powerDissipation/,
    );
  });
});

describe('beam analysis', () => {
  it('matches σ_axial = P/A and σ_bending = Mc/I', () => {
    const area = SLAB.width * SLAB.depth;
    const inertia = prismInertia(SLAB);
    const fibre = SLAB.depth / 2;
    const result = analyseBeam(SLAB, STEEL, { force: 5_000, moment: 40, span: 0.3 });
    expect(result.area).toBeCloseTo(area, 15);
    expect(result.inertia).toBeCloseTo(rectangleInertia(SLAB.width, SLAB.depth), 12);
    expect(result.extremeFibre).toBeCloseTo(fibre, 15);
    expect(result.axialStress).toBeCloseTo(5_000 / area, 6);
    expect(result.bendingStress).toBeCloseTo((40 * fibre) / inertia, 6);
    expect(result.totalStress).toBeCloseTo(5_000 / area + (40 * fibre) / inertia, 6);
  });

  it('matches the cantilever deflection PL³/(3EI) over the supplied span', () => {
    const span = 0.25;
    const result = analyseBeam(SLAB, STEEL, { force: 2_000, span });
    const expected = (2_000 * span ** 3) / (3 * STEEL.youngsModulus * prismInertia(SLAB));
    expect(result.deflection).toBeCloseTo(expected, 18);
  });

  it('defaults the span to the part height rather than a hardcoded 100 mm', () => {
    const result = analyseBeam(SLAB, STEEL, { force: 1_000 });
    const expected =
      (1_000 * SLAB.height ** 3) / (3 * STEEL.youngsModulus * prismInertia(SLAB));
    expect(result.deflection).toBeCloseTo(expected, 18);
  });

  it('reports a null safety factor when nothing is loaded, not Infinity', () => {
    const unloaded = analyseBeam(SLAB, STEEL, {});
    expect(unloaded.safetyFactor).toBeNull();
    expect(unloaded.totalStress).toBe(0);
    expect(unloaded.deflection).toBe(0);
    expect(unloaded.yields).toBe(false);

    const loaded = analyseBeam(SLAB, STEEL, { force: 5_000, moment: 40 });
    expect(loaded.safetyFactor).toBeCloseTo(STEEL.yieldStrength / loaded.totalStress, 6);
  });

  it('flags yielding once the stress passes the yield strength', () => {
    const safe = analyseBeam(SLAB, STEEL, { force: 1_000 });
    expect(safe.yields).toBe(false);
    // A thin deep section under a large moment must exceed 250 MPa.
    const failing = analyseBeam(
      { width: 0.002, height: 0.5, depth: 0.002 },
      STEEL,
      { moment: 200 },
    );
    expect(failing.totalStress).toBeGreaterThan(STEEL.yieldStrength);
    expect(failing.yields).toBe(true);
    expect(failing.safetyFactor).toBeLessThan(1);
  });

  it('rejects a non-finite load and a non-positive modulus', () => {
    expect(() => analyseBeam(SLAB, STEEL, { force: Number.NaN })).toThrow(/force must be finite/);
    expect(() => analyseBeam(SLAB, STEEL, { moment: Number.NaN })).toThrow(/moment must be finite/);
    expect(() => analyseBeam(SLAB, STEEL, { span: 0 })).toThrow(/span/);
    expect(() => analyseBeam(SLAB, { ...STEEL, youngsModulus: 0 }, {})).toThrow(/youngsModulus/);
    expect(() => analyseBeam({ ...SLAB, depth: 0 }, STEEL, {})).toThrow(/depth/);
  });

  it('accepts a compressive force and a reverse moment', () => {
    const pushed = analyseBeam(SLAB, STEEL, { force: -5_000, moment: -40 });
    expect(pushed.axialStress).toBeLessThan(0);
    expect(pushed.bendingStress).toBeLessThan(0);
    expect(pushed.safetyFactor).toBeCloseTo(STEEL.yieldStrength / Math.abs(pushed.totalStress), 6);
  });
});

describe('mass inertia of solids', () => {
  it('matches the cuboid formula component by component', () => {
    const m = 4;
    const dims = { width: 0.2, height: 0.05, depth: 0.1 };
    const i = prismMassInertia(m, dims);
    expect(i[0]).toBeCloseTo((m * (dims.height ** 2 + dims.depth ** 2)) / 12, 12);
    expect(i[4]).toBeCloseTo((m * (dims.width ** 2 + dims.depth ** 2)) / 12, 12);
    expect(i[8]).toBeCloseTo((m * (dims.width ** 2 + dims.height ** 2)) / 12, 12);
  });

  it('matches mR²/2 axially for a solid cylinder', () => {
    const m = 3;
    const diameter = 0.08;
    const length = 0.3;
    const i = cylinderMassInertia(m, { diameter, height: length });
    expect(i[0]).toBeCloseTo((m * (diameter / 2) ** 2) / 2, 12);
    expect(i[4]).toBeCloseTo((m * (3 * (diameter / 2) ** 2 + length ** 2)) / 12, 12);
  });

  it('matches 2mR²/5 for a solid sphere', () => {
    const i = sphereMassInertia(2, 0.15);
    expect(i[0]).toBeCloseTo((2 * 2 * 0.15 ** 2) / 5, 12);
    expect(i[4]).toBeCloseTo(i[0], 12);
  });

  it('matches the section inertias of the same shapes', () => {
    expect(prismInertia(SLAB)).toBeCloseTo((SLAB.width * SLAB.depth ** 3) / 12, 15);
    expect(cylinderSectionInertia({ diameter: 0.05, height: 1 })).toBeCloseTo(
      circleInertia(0.05),
      24,
    );
  });

  it('rejects a non-positive mass or dimension', () => {
    expect(() => prismMassInertia(0, SLAB)).toThrow(/mass/);
    expect(() => cylinderMassInertia(1, { diameter: 0, height: 1 })).toThrow(/diameter/);
    expect(() => sphereMassInertia(1, -1)).toThrow(/radius/);
    expect(() => cylinderSectionInertia({ diameter: -1, height: 1 })).toThrow(/diameter/);
  });
});

describe('EMC', () => {
  const RLC = { resistance: 50, capacitance: 1e-9, inductance: 1e-6 };

  it('matches the series RLC impedance √(R² + (X_L − X_C)²)', () => {
    const f = 1e6;
    const omega = 2 * Math.PI * f;
    const result = analyseEmc(RLC, f);
    const xl = omega * RLC.inductance;
    const xc = 1 / (omega * RLC.capacitance);
    expect(result.angularFrequency).toBeCloseTo(omega, 6);
    expect(result.inductiveReactance).toBeCloseTo(xl, 8);
    expect(result.capacitiveReactance).toBeCloseTo(xc, 4);
    expect(result.impedance).toBeCloseTo(Math.sqrt(50 ** 2 + (xl - xc) ** 2), 4);
  });

  it('collapses to the resistance at resonance, where X_L equals X_C', () => {
    const resonance = analyseEmc(RLC, 1).resonanceFrequency;
    const expected = 1 / (2 * Math.PI * Math.sqrt(RLC.inductance * RLC.capacitance));
    expect(resonance).toBeCloseTo(expected, 3);
    const at = analyseEmc(RLC, resonance);
    expect(at.impedance).toBeCloseTo(RLC.resistance, 6);
    expect(at.inductiveReactance).toBeCloseTo(at.capacitiveReactance, 3);
  });

  it('matches the copper skin depth at 1 MHz', () => {
    const f = 1e6;
    const sigma = 5.8e7;
    const result = analyseEmc({ ...RLC, conductivity: sigma }, f);
    const expected = Math.sqrt(2 / (2 * Math.PI * f * MU_0 * sigma));
    // The textbook value for copper at 1 MHz is about 66 µm.
    expect(result.skinDepth).toBeCloseTo(expected, 12);
    expect(result.skinDepth!).toBeGreaterThan(6e-5);
    expect(result.skinDepth!).toBeLessThan(7e-5);
  });

  it('scales the skin depth as 1/√f and as 1/√μ_r', () => {
    const sigma = 5.8e7;
    const base = analyseEmc({ ...RLC, conductivity: sigma }, 1e6).skinDepth!;
    const faster = analyseEmc({ ...RLC, conductivity: sigma }, 4e6).skinDepth!;
    expect(faster).toBeCloseTo(base / 2, 12);
    const magnetic = analyseEmc(
      { ...RLC, conductivity: sigma, relativePermeability: 4 },
      1e6,
    ).skinDepth!;
    expect(magnetic).toBeCloseTo(base / 2, 12);
  });

  it('reports shielding as 8.686 · t/δ and null without a thickness or conductivity', () => {
    const sigma = 5.8e7;
    const noSigma = analyseEmc(RLC, 1e6);
    expect(noSigma.skinDepth).toBeNull();
    expect(noSigma.shieldingEffectiveness).toBeNull();

    const withSigma = analyseEmc({ ...RLC, conductivity: sigma }, 1e6);
    expect(withSigma.shieldingEffectiveness).toBeNull();

    const shielded = analyseEmc({ ...RLC, conductivity: sigma }, 1e6, 1e-3);
    expect(shielded.shieldingEffectiveness).toBeCloseTo(
      8.686 * (1e-3 / shielded.skinDepth!),
      8,
    );
    // A millimetre of copper at 1 MHz gives roughly 130 dB.
    expect(shielded.shieldingEffectiveness!).toBeGreaterThan(100);
  });

  it('rejects a non-positive frequency or component value', () => {
    expect(() => analyseEmc(RLC, 0)).toThrow(/frequency/);
    expect(() => analyseEmc({ ...RLC, resistance: 0 }, 1e6)).toThrow(/resistance/);
    expect(() => analyseEmc({ ...RLC, capacitance: -1 }, 1e6)).toThrow(/capacitance/);
    expect(() => analyseEmc({ ...RLC, conductivity: 0 }, 1e6)).toThrow(/conductivity/);
    expect(() => analyseEmc(RLC, 1e6, 0)).toThrow(/thickness/);
  });
});
