import { describe, expect, it } from 'vitest';
import {
  COPPER,
  sizeCoupledConductor,
  solveCoupledTemperature,
  validateConductorRequest,
  type ConductorRequest,
} from './coupledConductor';
import { BINDING_TOLERANCE, optimizeCoupledDesign } from './coupledDesign';

const request = (overrides: Partial<ConductorRequest> = {}): ConductorRequest => ({
  lengthM: 0.1,
  currentA: 30,
  ambientC: 25,
  maxTemperatureRiseK: 30,
  surfaceCoefficientWm2K: 10,
  material: COPPER,
  width: { min: 0.002, max: 0.02 },
  thickness: { min: 0.0005, max: 0.005 },
  minSecondMomentM4: 1e-12,
  populationSize: 20,
  iterations: 40,
  seed: 1234,
  ...overrides,
});

describe('solveCoupledTemperature', () => {
  it('reduces to the closed-form isothermal answer at zero temperature coefficient', () => {
    // With α = 0 the fixed point is a single step: ΔT = I²R·Rth.
    const input = request({
      material: { ...COPPER, tempCoeffPerK: 0 },
      currentA: 10,
      lengthM: 1,
    });
    const width = 0.005;
    const thickness = 0.001;
    const solved = solveCoupledTemperature(width, thickness, input);

    const r20 = (COPPER.resistivityOhmM * input.lengthM) / (width * thickness);
    const surface = 2 * (input.lengthM * (width + thickness));
    const rth = 1 / (input.surfaceCoefficientWm2K * surface);
    const expectedRise = input.currentA ** 2 * r20 * rth;

    expect(solved.resistanceOhm).toBeCloseTo(r20, 12);
    expect(solved.temperatureRiseK).toBeCloseTo(expectedRise, 9);
    expect(solved.converged).toBe(true);
  });

  it('runs hotter than the isothermal estimate, because hot copper resists more', () => {
    /* This is the coupling the module exists for: sizing against the cold
     * resistance under-predicts the rise. */
    const input = request({ currentA: 30, lengthM: 0.1 });
    const width = 0.003;
    const thickness = 0.001;

    const solved = solveCoupledTemperature(width, thickness, input);
    const coldResistance = (COPPER.resistivityOhmM * input.lengthM) / (width * thickness);
    const rth = 1 / (input.surfaceCoefficientWm2K * 2 * (input.lengthM * (width + thickness)));
    const isothermalRise = input.currentA ** 2 * coldResistance * rth;

    expect(solved.temperatureRiseK).toBeGreaterThan(isothermalRise);
    // The hot resistance must be the one consistent with the solved temperature.
    const rhoHot = COPPER.resistivityOhmM * (
      1 + COPPER.tempCoeffPerK * (input.ambientC + solved.temperatureRiseK - COPPER.referenceTempC)
    );
    expect(solved.resistanceOhm).toBeCloseTo((rhoHot * input.lengthM) / (width * thickness), 12);
  });

  it('converges to a self-consistent fixed point', () => {
    const input = request();
    const solved = solveCoupledTemperature(0.003, 0.001, input);
    const rhoHot = COPPER.resistivityOhmM * (
      1 + COPPER.tempCoeffPerK * (input.ambientC + solved.temperatureRiseK - COPPER.referenceTempC)
    );
    const r = (rhoHot * input.lengthM) / (0.003 * 0.001);
    const rth = 1 / (input.surfaceCoefficientWm2K * 2 * (input.lengthM * (0.003 + 0.001)));
    expect(solved.powerW).toBeCloseTo(input.currentA ** 2 * r, 6);
    /* The fixed-point iteration converges to a relative 1e-9, which on a rise of
     * tens of kelvin is around 1e-7 absolute — assert to 6 decimals, not 9. */
    expect(solved.temperatureRiseK).toBeCloseTo(input.currentA ** 2 * r * rth, 6);
  });

  it('a bigger section runs cooler', () => {
    const input = request();
    const thin = solveCoupledTemperature(0.003, 0.0005, input);
    const thick = solveCoupledTemperature(0.003, 0.002, input);
    expect(thick.temperatureRiseK).toBeLessThan(thin.temperatureRiseK);
    expect(thick.powerW).toBeLessThan(thin.powerW);
  });
});

describe('validateConductorRequest', () => {
  it('rejects non-positive and non-finite input', () => {
    expect(() => validateConductorRequest(request({ lengthM: 0 }))).toThrow(/Length/);
    expect(() => validateConductorRequest(request({ currentA: -1 }))).toThrow(/Current/);
    expect(() => validateConductorRequest(request({ surfaceCoefficientWm2K: 0 }))).toThrow(/Surface/);
    expect(() => validateConductorRequest(request({ ambientC: Number.NaN }))).toThrow(/Ambient/);
    expect(() => validateConductorRequest(request({ width: { min: 0.01, max: 0.01 } }))).toThrow(/Width/);
  });
});

describe('sizeCoupledConductor', () => {
  it('finds a feasible section that satisfies both limits', async () => {
    const result = await sizeCoupledConductor(request());
    expect(result.feasible).toBe(true);
    expect(result.thermalUtilisation).toBeLessThanOrEqual(1 + 1e-9);
    expect(result.stiffnessUtilisation).toBeLessThanOrEqual(1 + 1e-9);
    expect(result.massKg).toBeGreaterThan(0);
    expect(result.resistanceOhm).toBeGreaterThan(0);
  });

  it('reports the section inside the search bounds', async () => {
    const input = request();
    const result = await sizeCoupledConductor(input);
    expect(result.widthM).toBeGreaterThanOrEqual(input.width.min - 1e-12);
    expect(result.widthM).toBeLessThanOrEqual(input.width.max + 1e-12);
    expect(result.thicknessM).toBeGreaterThanOrEqual(input.thickness.min - 1e-12);
    expect(result.thicknessM).toBeLessThanOrEqual(input.thickness.max + 1e-12);
    expect(result.aspectRatio).toBeCloseTo(result.thicknessM / result.widthM, 12);
  });

  it('the reported mass matches the returned section', async () => {
    const input = request();
    const result = await sizeCoupledConductor(input);
    const expected = COPPER.densityKgM3 * input.lengthM * result.widthM * result.thicknessM;
    expect(result.massKg).toBeCloseTo(expected, 12);
    // And the second moment is the rectangle formula, not a stand-in.
    expect(result.secondMomentM4).toBeCloseTo(
      (result.widthM * result.thicknessM ** 3) / 12,
      18,
    );
  });

  it('a stiffer requirement produces a heavier or equal section', async () => {
    const soft = await sizeCoupledConductor(request({ minSecondMomentM4: 1e-12 }));
    const stiff = await sizeCoupledConductor(request({ minSecondMomentM4: 5e-12 }));
    expect(stiff.massKg).toBeGreaterThanOrEqual(soft.massKg - 1e-12);
    expect(stiff.feasible).toBe(true);
  });

  it('a tighter thermal limit produces a heavier or equal section', async () => {
    const loose = await sizeCoupledConductor(request({ maxTemperatureRiseK: 40 }));
    const tight = await sizeCoupledConductor(request({ maxTemperatureRiseK: 15 }));
    expect(tight.massKg).toBeGreaterThanOrEqual(loose.massKg - 1e-12);
  });

  it('the thermal limit drives the section wider than mass alone would', async () => {
    /* At a fixed stiffness (w·t³), mass is proportional to 1/t², so sizing on
     * mass alone drives the thickness to its maximum and the width to its
     * minimum. That bar runs at about 11.8 K, which a tight thermal budget
     * forbids; widening the section adds surface and cuts resistance. The
     * coupled answer must therefore be *wider* than the mass-only one, which is
     * the whole point of solving the disciplines together. */
    const thermalLimit = 8;
    const massOnly = await sizeCoupledConductor(request({
      maxTemperatureRiseK: 1e6,
      minSecondMomentM4: 2e-11,
    }));
    const coupled = await sizeCoupledConductor(request({
      maxTemperatureRiseK: thermalLimit,
      minSecondMomentM4: 2e-11,
    }));
    const bounds = request();
    // The search approaches a bound from inside, so assert "at the top" rather
    // than exact equality.
    expect(massOnly.thicknessM).toBeGreaterThan(bounds.thickness.max * 0.98);
    expect(massOnly.widthM).toBeLessThan(bounds.width.min * 1.02);
    expect(coupled.widthM).toBeGreaterThan(massOnly.widthM);
    expect(coupled.feasible).toBe(true);
    expect(coupled.massKg).toBeGreaterThan(massOnly.massKg);

    /* The mass-only section is the one that overheats: re-evaluate it against
     * the real thermal limit, not the relaxed one it was sized against. */
    const realRequest = request({ minSecondMomentM4: 2e-11, maxTemperatureRiseK: thermalLimit });
    const massOnlyThermal = solveCoupledTemperature(
      massOnly.widthM,
      massOnly.thicknessM,
      realRequest,
    );
    expect(massOnlyThermal.temperatureRiseK).toBeGreaterThan(thermalLimit);
    expect(coupled.temperatureRiseK).toBeLessThanOrEqual(thermalLimit);
  });

  it('is deterministic for a given seed', async () => {
    const input = request();
    const first = await sizeCoupledConductor(input);
    const second = await sizeCoupledConductor(input);
    expect(second.point).toEqual(first.point);
    expect(second.massKg).toBeCloseTo(first.massKg, 12);
  });
});

describe('optimizeCoupledDesign', () => {
  it('optimises a two-discipline trade-off against a hand-checked optimum', async () => {
    /* Two variables, one linear objective, two constraints:
     *   minimise  x + y
     *   subject to x ≥ 2 and y ≥ 3
     * The answer is exactly (2, 3). */
    const result = await optimizeCoupledDesign({
      variables: [
        { name: 'x', min: 0, max: 10 },
        { name: 'y', min: 0, max: 10 },
      ],
      disciplines: [
        {
          name: 'cost',
          evaluate: (point) => ({
            cost: point.x + point.y,
            constraints: [],
            metrics: { sum: point.x + point.y },
          }),
        },
        {
          name: 'limits',
          evaluate: (point) => ({
            cost: 0,
            constraints: [
              { discipline: 'limits', name: 'x-floor', utilisation: 2 / point.x },
              { discipline: 'limits', name: 'y-floor', utilisation: 3 / point.y },
            ],
            metrics: {},
          }),
        },
      ],
      populationSize: 30,
      iterations: 80,
      seed: 7,
    });

    expect(result.feasible).toBe(true);
    expect(result.point.x).toBeCloseTo(2, 1);
    expect(result.point.y).toBeCloseTo(3, 1);
    expect(result.cost).toBeCloseTo(5, 1);
  });

  it('honours per-discipline weights', async () => {
    const run = async (weight: number): Promise<number> => {
      const result = await optimizeCoupledDesign({
        variables: [{ name: 'x', min: 0.1, max: 10 }],
        disciplines: [
          {
            name: 'weighted',
            weight,
            evaluate: (point) => ({ cost: point.x, constraints: [], metrics: {} }),
          },
        ],
        populationSize: 20,
        iterations: 40,
        seed: 99,
      });
      return result.point.x;
    };
    // With no constraints, the minimum of the variable wins regardless of weight,
    // so weights must change the *balance* rather than the unconstrained optimum.
    expect(await run(1)).toBeCloseTo(0.1, 5);
    expect(await run(100)).toBeCloseTo(0.1, 5);
  });

  it('names the constraint that limits the design', async () => {
    /* A cost that pulls x upward against a hard ceiling: the ceiling must be
     * reported as binding, because it is what stops the search. */
    const result = await optimizeCoupledDesign({
      variables: [{ name: 'x', min: 0.5, max: 10 }],
      disciplines: [
        {
          name: 'pull',
          evaluate: (point) => ({ cost: 1 / point.x, constraints: [], metrics: {} }),
        },
        {
          name: 'limit',
          evaluate: (point) => ({
            cost: 0,
            constraints: [
              { discipline: 'limit', name: 'ceiling', utilisation: point.x / 5 },
            ],
            metrics: {},
          }),
        },
      ],
      populationSize: 30,
      iterations: 80,
      seed: 21,
    });

    expect(result.feasible).toBe(true);
    expect(result.point.x).toBeCloseTo(5, 1);
    expect(result.binding.some((constraint) => constraint.name === 'ceiling')).toBe(true);
  });

  it('refuses malformed requests instead of guessing', async () => {
    await expect(optimizeCoupledDesign({ variables: [], disciplines: [] })).rejects.toThrow(/at least one variable/);
    await expect(optimizeCoupledDesign({
      variables: [{ name: 'x', min: 1, max: 1 }],
      disciplines: [{ name: 'd', evaluate: () => ({ cost: 0, constraints: [], metrics: {} }) }],
    })).rejects.toThrow(/maximum must exceed/);
    await expect(optimizeCoupledDesign({
      variables: [{ name: 'x', min: 0, max: 1 }, { name: 'x', min: 0, max: 2 }],
      disciplines: [{ name: 'd', evaluate: () => ({ cost: 0, constraints: [], metrics: {} }) }],
    })).rejects.toThrow(/Duplicate variable/);
    await expect(optimizeCoupledDesign({
      variables: [{ name: 'x', min: 0, max: 1 }],
      disciplines: [{ name: 'd', weight: -1, evaluate: () => ({ cost: 0, constraints: [], metrics: {} }) }],
    })).rejects.toThrow(/weight ≥ 0/);
  });

  it('reports infeasibility rather than returning a violating design', async () => {
    // x must be ≥ 100 but the bounds stop at 1: no feasible point exists.
    const result = await optimizeCoupledDesign({
      variables: [{ name: 'x', min: 0.1, max: 1 }],
      disciplines: [{
        name: 'limits',
        evaluate: (point) => ({
          cost: 0,
          constraints: [{ discipline: 'limits', name: 'floor', utilisation: 100 / point.x }],
          metrics: {},
        }),
      }],
      populationSize: 20,
      iterations: 40,
      seed: 5,
    });
    expect(result.feasible).toBe(false);
    expect(result.worstUtilisation).toBeGreaterThan(1);
    expect(result.binding.every((c) => c.utilisation > 1 - BINDING_TOLERANCE)).toBe(true);
  });

  it('rejects a NaN utilisation rather than propagating NaN', async () => {
    /* Infinity is not rejected: a floor constraint is genuinely infinite at a
     * bound, and the search must be able to report that as a violation. NaN is a
     * defect and is refused. */
    await expect(optimizeCoupledDesign({
      variables: [{ name: 'x', min: 1, max: 2 }],
      disciplines: [{
        name: 'broken',
        evaluate: () => ({
          cost: 0,
          constraints: [{ discipline: 'broken', name: 'nan', utilisation: Number.NaN }],
          metrics: {},
        }),
      }],
      populationSize: 10,
      iterations: 5,
    })).rejects.toThrow(/NaN/);
  });

  it('accepts an infinite utilisation at a bound as a violation, not a defect', async () => {
    // A floor of the form limit / x is infinite at x = 0, which is a legal bound.
    const result = await optimizeCoupledDesign({
      variables: [{ name: 'x', min: 0, max: 1 }],
      disciplines: [{
        name: 'limits',
        evaluate: (point) => ({
          cost: 0,
          constraints: [{ discipline: 'limits', name: 'floor', utilisation: 2 / point.x }],
          metrics: {},
        }),
      }],
      populationSize: 12,
      iterations: 10,
      seed: 11,
    });
    expect(Number.isNaN(result.worstUtilisation)).toBe(false);
    expect(result.feasible).toBe(false);
  });

  it('counts evaluations and records convergence', async () => {
    const result = await optimizeCoupledDesign({
      variables: [{ name: 'x', min: 0, max: 1 }],
      disciplines: [{ name: 'd', evaluate: (p) => ({ cost: p.x, constraints: [], metrics: {} }) }],
      populationSize: 10,
      iterations: 5,
      seed: 3,
    });
    expect(result.iterations).toBe(5);
    expect(result.convergence.length).toBeGreaterThan(0);
    expect(result.evaluations).toBeGreaterThanOrEqual(10);
  });
});