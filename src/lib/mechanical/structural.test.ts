import { describe, expect, it } from 'vitest';
import {
  axialElementForces,
  axialElementStresses,
  axialExtension,
  axialStiffness,
  axialStress,
  BUCKLING_FACTOR,
  bendingStress,
  cantileverNaturalFrequency,
  cantileverTipDeflection,
  cantileverTipRotation,
  cantileverUniformDeflection,
  circleInertia,
  circlePolarInertia,
  eulerBucklingLoad,
  rectangleInertia,
  restrainedThermalStress,
  sectionModulus,
  shaftShearStress,
  shaftTwist,
  simplySupportedCentreDeflection,
  solveAxialChain,
  thermalExpansion,
  type AxialElement,
} from './structural';

const STEEL_E = 200e9;

describe('axial members', () => {
  it('matches δ = PL/(EA) exactly', () => {
    const P = 40_000;
    const L = 2.5;
    const A = 5e-4;
    expect(axialExtension(P, L, A, STEEL_E)).toBeCloseTo((P * L) / (STEEL_E * A), 18);
  });

  it('signs compression negative and tension positive', () => {
    expect(axialStress(1_000, 0.01)).toBeCloseTo(100_000, 9);
    expect(axialStress(-1_000, 0.01)).toBeCloseTo(-100_000, 9);
  });

  it('reports stiffness as EA/L, the reciprocal of the extension', () => {
    const k = axialStiffness(3, 2e-4, 70e9);
    expect(k).toBeCloseTo((70e9 * 2e-4) / 3, 6);
    expect(axialExtension(1_000, 3, 2e-4, 70e9)).toBeCloseTo(1_000 / k, 15);
  });

  it('rejects a non-positive section or modulus', () => {
    expect(() => axialExtension(1, 1, 0, STEEL_E)).toThrow(/area/);
    expect(() => axialStress(1, -1)).toThrow(/area/);
    expect(() => axialExtension(Number.NaN, 1, 1, STEEL_E)).toThrow(/finite/);
  });
});

describe('bending', () => {
  it('matches the cantilever tip deflection PL³/(3EI)', () => {
    const P = 250;
    const L = 1.8;
    const I = rectangleInertia(0.05, 0.1);
    expect(cantileverTipDeflection(P, L, STEEL_E, I)).toBeCloseTo((P * L ** 3) / (3 * STEEL_E * I), 20);
  });

  it('matches the cantilever tip rotation PL²/(2EI)', () => {
    const P = 250;
    const L = 1.8;
    const I = rectangleInertia(0.05, 0.1);
    expect(cantileverTipRotation(P, L, STEEL_E, I)).toBeCloseTo((P * L ** 2) / (2 * STEEL_E * I), 20);
  });

  it('matches the uniformly loaded cantilever wL⁴/(8EI)', () => {
    const w = 800;
    const L = 2;
    const I = circleInertia(0.08);
    expect(cantileverUniformDeflection(w, L, STEEL_E, I)).toBeCloseTo(
      (w * L ** 4) / (8 * STEEL_E * I),
      20,
    );
  });

  it('matches the simply supported centre deflection PL³/(48EI)', () => {
    const P = 500;
    const L = 3;
    const I = circleInertia(0.1);
    expect(simplySupportedCentreDeflection(P, L, STEEL_E, I)).toBeCloseTo(
      (P * L ** 3) / (48 * STEEL_E * I),
      20,
    );
  });

  it('puts a simply supported beam at exactly 1/16 of the cantilever deflection', () => {
    // Same span and load: the coefficients are 1/48 versus 1/3.
    const P = 100;
    const L = 2;
    const I = rectangleInertia(0.02, 0.04);
    const ratio =
      cantileverTipDeflection(P, L, STEEL_E, I) / simplySupportedCentreDeflection(P, L, STEEL_E, I);
    expect(ratio).toBeCloseTo(16, 9);
  });

  it('computes bending stress as Mc/I and section modulus as I/c', () => {
    const I = rectangleInertia(0.03, 0.06);
    const c = 0.03;
    expect(sectionModulus(I, c)).toBeCloseTo(I / c, 15);
    expect(bendingStress(1_200, c, I)).toBeCloseTo((1_200 * c) / I, 12);
  });

  it('computes rectangle and circle second moments from their definitions', () => {
    expect(rectangleInertia(2, 3)).toBeCloseTo((2 * 27) / 12, 12);
    expect(circleInertia(0.05)).toBeCloseTo((Math.PI * 0.05 ** 4) / 64, 20);
    expect(circlePolarInertia(0.05)).toBeCloseTo(2 * circleInertia(0.05), 18);
  });
});

describe('torsion', () => {
  it('matches θ = TL/(GJ)', () => {
    const T = 300;
    const L = 0.9;
    const G = 79e9;
    const J = circlePolarInertia(0.04);
    expect(shaftTwist(T, L, G, J)).toBeCloseTo((T * L) / (G * J), 18);
  });

  it('matches τ = Tc/J', () => {
    const T = 300;
    const d = 0.04;
    const J = circlePolarInertia(d);
    expect(shaftShearStress(T, d / 2, J)).toBeCloseTo((T * d) / (2 * J), 12);
  });
});

describe('stability and vibration', () => {
  it('scales the Euler load by the inverse square of the effective length', () => {
    const I = 1e-6;
    const L = 2;
    const pinned = eulerBucklingLoad(STEEL_E, I, L);
    const fixedFree = eulerBucklingLoad(STEEL_E, I, L, 'fixed-free');
    const fixedFixed = eulerBucklingLoad(STEEL_E, I, L, 'fixed-fixed');
    expect(pinned).toBeCloseTo((Math.PI ** 2 * STEEL_E * I) / L ** 2, 4);
    expect(fixedFree / pinned).toBeCloseTo(1 / BUCKLING_FACTOR['fixed-free'] ** 2, 12);
    expect(fixedFixed / pinned).toBeCloseTo(1 / BUCKLING_FACTOR['fixed-fixed'] ** 2, 12);
    expect(fixedFixed).toBeGreaterThan(pinned);
    expect(pinned).toBeGreaterThan(fixedFree);
  });

  it('orders the end conditions by restraint', () => {
    expect(BUCKLING_FACTOR['fixed-fixed']).toBeLessThan(BUCKLING_FACTOR['fixed-pinned']);
    expect(BUCKLING_FACTOR['fixed-pinned']).toBeLessThan(BUCKLING_FACTOR.pinned);
    expect(BUCKLING_FACTOR.pinned).toBeLessThan(BUCKLING_FACTOR['fixed-free']);
  });

  it('scales the cantilever frequency as 1/L² for a uniform beam', () => {
    const I = rectangleInertia(0.02, 0.005);
    const A = 0.02 * 0.005;
    const rho = 7850;
    const short = cantileverNaturalFrequency(STEEL_E, I, rho, A, 0.2);
    const long = cantileverNaturalFrequency(STEEL_E, I, rho, A, 0.4);
    expect(long / short).toBeCloseTo(0.25, 9);
  });

  it('lands a steel ruler in the audible range and scales by 100 per decade of span', () => {
    const I = rectangleInertia(0.025, 0.001);
    const A = 0.025 * 0.001;
    const full = cantileverNaturalFrequency(STEEL_E, I, 7850, A, 0.3);
    const tenth = cantileverNaturalFrequency(STEEL_E, I, 7850, A, 0.03);
    expect(full).toBeGreaterThan(1);
    expect(full).toBeLessThan(20);
    expect(tenth / full).toBeCloseTo(100, 6);
  });
});

describe('thermal', () => {
  it('computes free expansion αLΔT', () => {
    expect(thermalExpansion(1.2, 12e-6, 80)).toBeCloseTo(12e-6 * 1.2 * 80, 18);
  });

  it('puts a restrained bar into compression when heated and tension when cooled', () => {
    const stress = restrainedThermalStress(STEEL_E, 12e-6, 80);
    expect(stress).toBeCloseTo(-STEEL_E * 12e-6 * 80, 4);
    expect(restrainedThermalStress(STEEL_E, 12e-6, -80)).toBeCloseTo(-stress, 4);
  });
});

describe('direct-stiffness axial solver', () => {
  const bar = (length: number, area = 1e-4, modulus = STEEL_E): AxialElement => ({
    left: 0,
    right: 1,
    length,
    area,
    modulus,
  });

  it('reproduces PL/(EA) for a single restrained bar', () => {
    const P = 12_000;
    const L = 1.5;
    const A = 2e-4;
    const result = solveAxialChain([bar(L, A)], 2, [0], [0, P]);
    expect(result.error).toBeNull();
    expect(result.displacements?.[0]).toBe(0);
    expect(result.displacements?.[1]).toBeCloseTo(axialExtension(P, L, A, STEEL_E), 18);
  });

  it('recovers the applied load as tension in the bar', () => {
    const P = 5_000;
    const elements = [bar(2)];
    const result = solveAxialChain(elements, 2, [0], [0, P]);
    expect(axialElementForces(elements, result.displacements!)[0]).toBeCloseTo(P, 6);
    expect(axialElementStresses(elements, result.displacements!)[0]).toBeCloseTo(P / 1e-4, 3);
  });

  it('adds compliance in series, matching the sum of each bar alone', () => {
    const P = 8_000;
    const L = 2;
    const A = 1e-4;
    const half = axialExtension(P, L / 2, A, STEEL_E);
    const pair: AxialElement[] = [
      { left: 0, right: 1, length: L / 2, area: A, modulus: STEEL_E },
      { left: 1, right: 2, length: L / 2, area: A, modulus: STEEL_E },
    ];
    const series = solveAxialChain(pair, 3, [0], [0, 0, P]);
    expect(series.displacements?.[1]).toBeCloseTo(half, 15);
    expect(series.displacements?.[2]).toBeCloseTo(2 * half, 15);
    expect(series.displacements?.[2]).toBeCloseTo(axialExtension(P, L, A, STEEL_E), 15);
  });

  it('stiffens bars in parallel, halving the stretch when the area doubles', () => {
    const P = 4_000;
    const L = 1;
    const A = 1e-4;
    const one = solveAxialChain([bar(L, A)], 2, [0], [0, P]);
    const two: AxialElement[] = [
      { left: 0, right: 1, length: L, area: A, modulus: STEEL_E },
      { left: 0, right: 1, length: L, area: A, modulus: STEEL_E },
    ];
    const both = solveAxialChain(two, 2, [0], [0, P]);
    expect(both.displacements?.[1]).toBeCloseTo((one.displacements?.[1] ?? 0) / 2, 16);
    expect(axialElementForces(two, both.displacements!)[0]).toBeCloseTo(P / 2, 6);
    expect(axialElementForces(two, both.displacements!)[1]).toBeCloseTo(P / 2, 6);
  });

  it('refuses an unrestrained structure instead of returning a zero vector', () => {
    const result = solveAxialChain([bar(1)], 2, [], [0, 100]);
    expect(result.displacements).toBeNull();
    expect(result.error).toMatch(/not restrained/);
  });

  it('reports a fully constrained model as having nothing free to move', () => {
    const result = solveAxialChain([bar(1)], 2, [0, 1], [0, 0]);
    expect(result.displacements).toBeNull();
    expect(result.error).toMatch(/nothing is free to move/);
  });

  it('validates its inputs rather than assembling a nonsense matrix', () => {
    expect(() => solveAxialChain([], 2, [0], [0, 0])).toThrow(/At least one/);
    expect(() => solveAxialChain([bar(1)], 1, [0], [0])).toThrow(/at least two nodes/);
    expect(() => solveAxialChain([bar(1)], 2, [0], [0])).toThrow(/node count/);
    expect(() => solveAxialChain([bar(0)], 2, [0], [0, 1])).toThrow(/length/);
    expect(() => solveAxialChain([bar(1)], 2, [5], [0, 1])).toThrow(/out of range/);
    expect(() =>
      solveAxialChain([{ left: 0, right: 4, length: 1, area: 1e-4, modulus: STEEL_E }], 2, [0], [0, 1]),
    ).toThrow(/outside the model/);
    expect(() =>
      solveAxialChain([{ left: 5, right: 0, length: 1, area: 1e-4, modulus: STEEL_E }], 2, [0], [0, 1]),
    ).toThrow(/outside the model/);
    expect(() =>
      solveAxialChain([{ left: 0, right: -1, length: 1, area: 1e-4, modulus: STEEL_E }], 2, [0], [0, 1]),
    ).toThrow(/outside the model/);
    expect(() =>
      solveAxialChain([{ left: 0, right: 0, length: 1, area: 1e-4, modulus: STEEL_E }], 2, [0], [0, 1]),
    ).toThrow(/itself/);
    expect(() => solveAxialChain([bar(1)], 2, [0], [0, Number.NaN])).toThrow(/finite/);
  });
});
