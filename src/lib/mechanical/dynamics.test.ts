import { describe, expect, it } from 'vitest';
import {
  angularMomentum,
  assertPositive,
  boxInertia,
  cylinderInertia,
  ellipticK,
  parallelAxis,
  pendulumPeriodExact,
  pendulumPeriodSmallAngle,
  rodInertia,
  rotationalKineticEnergy,
  sphereInertia,
  staticHoldTorque,
  twoLinkTorques,
  type TwoLinkModel,
} from './dynamics';

const G = 9.81;

describe('canonical inertia tensors', () => {
  it('matches the cuboid formula Ixx = m(ly² + lz²)/12', () => {
    const m = 3;
    const [lx, ly, lz] = [2, 0.5, 1.5];
    const i = boxInertia(m, lx, ly, lz);
    expect(i[0]).toBeCloseTo((m * (ly * ly + lz * lz)) / 12, 12);
    expect(i[4]).toBeCloseTo((m * (lx * lx + lz * lz)) / 12, 12);
    expect(i[8]).toBeCloseTo((m * (lx * lx + ly * ly)) / 12, 12);
  });

  it('gives a rod mL²/12 about its centre and mL²/3 about its end', () => {
    const m = 2;
    const L = 1.5;
    expect(rodInertia(m, L, 'centre')[4]).toBeCloseTo((m * L * L) / 12, 12);
    expect(rodInertia(m, L, 'end')[4]).toBeCloseTo((m * L * L) / 3, 12);
  });

  it('gives a solid cylinder mR²/2 about its axis', () => {
    const m = 4;
    const r = 0.3;
    const L = 1.2;
    expect(cylinderInertia(m, r, L)[0]).toBeCloseTo((m * r * r) / 2, 12);
    expect(cylinderInertia(m, r, L)[4]).toBeCloseTo((m * (3 * r * r + L * L)) / 12, 12);
  });

  it('gives a solid sphere 2mR²/5 about any diameter', () => {
    const i = sphereInertia(5, 0.4);
    const expected = (2 * 5 * 0.4 * 0.4) / 5;
    expect(i[0]).toBeCloseTo(expected, 12);
    expect(i[4]).toBeCloseTo(expected, 12);
    expect(i[8]).toBeCloseTo(expected, 12);
  });

  it('rejects a non-positive dimension instead of returning zero', () => {
    expect(() => boxInertia(1, 0, 1, 1)).toThrow(/lx/);
    expect(() => sphereInertia(0, 1)).toThrow(/mass/);
    expect(() => assertPositive(Number.NaN, 'thing')).toThrow(/thing/);
  });
});

describe('parallel-axis theorem', () => {
  it('turns a rod about its centre into a rod about its end', () => {
    const m = 2;
    const L = 1.5;
    const shifted = parallelAxis(rodInertia(m, L, 'centre'), m, [L / 2, 0, 0]);
    // I_end = I_cm + m(L/2)² must reproduce mL²/3.
    expect(shifted[4]).toBeCloseTo((m * L * L) / 12 + m * (L / 2) * (L / 2), 12);
    expect(shifted[4]).toBeCloseTo((m * L * L) / 3, 12);
  });

  it('agrees with the point-mass form m r² for an off-axis translation', () => {
    const m = 3;
    const r: [number, number, number] = [0, 0, 2];
    const shifted = parallelAxis([0, 0, 0, 0, 0, 0, 0, 0, 0], m, r);
    expect(shifted[0]).toBeCloseTo(m * r[2] * r[2], 12);
    expect(shifted[4]).toBeCloseTo(m * r[2] * r[2], 12);
    expect(shifted[8]).toBeCloseTo(0, 12);
  });

  it('keeps the tensor symmetric', () => {
    const shifted = parallelAxis(boxInertia(2, 1, 1, 1), 2, [0.4, -0.7, 0.2]);
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        expect(shifted[row * 3 + col]).toBeCloseTo(shifted[col * 3 + row], 12);
      }
    }
  });
});

describe('angular momentum and kinetic energy', () => {
  it('computes L = Iω component by component', () => {
    const l = angularMomentum([2, 0, 0, 0, 3, 0, 0, 0, 4], [1, 2, 3]);
    expect(l[0]).toBeCloseTo(2, 12);
    expect(l[1]).toBeCloseTo(6, 12);
    expect(l[2]).toBeCloseTo(12, 12);
  });

  it('computes rotational energy as half of ωᵀIω', () => {
    const i = [2, 0, 0, 0, 3, 0, 0, 0, 4];
    const omega: [number, number, number] = [1, 2, 3];
    expect(rotationalKineticEnergy(i, omega)).toBeCloseTo(0.5 * (2 + 12 + 36), 12);
  });
});

describe('compound pendulum', () => {
  it('reduces to 2π√(L/g) for a simple pendulum at small amplitude', () => {
    // A point mass m on a massless rod of length L has I = mL² and d = L.
    const m = 1.5;
    const L = 0.75;
    const inertia = m * L * L;
    const simple = 2 * Math.PI * Math.sqrt(L / G);
    expect(pendulumPeriodExact(inertia, m, G, L, 1e-6)).toBeCloseTo(simple, 8);
    expect(pendulumPeriodSmallAngle(inertia, m, G, L)).toBeCloseTo(simple, 12);
  });

  it('stretches the period as the amplitude grows, as physics requires', () => {
    const m = 2;
    const L = 1;
    const inertia = m * L * L;
    const small = pendulumPeriodExact(inertia, m, G, L, 0.05);
    const large = pendulumPeriodExact(inertia, m, G, L, 2.5);
    expect(large).toBeGreaterThan(small);
    expect(large / pendulumPeriodSmallAngle(inertia, m, G, L)).toBeGreaterThan(1.2);
  });

  it('evaluates the elliptic integral at the known endpoints', () => {
    expect(ellipticK(0)).toBeCloseTo(Math.PI / 2, 12);
    // K(1/√2) = 1.8540746773013719...
    expect(ellipticK(Math.SQRT1_2)).toBeCloseTo(1.8540746773013719, 10);
  });

  it('refuses an amplitude that would swing past straight up', () => {
    expect(() => pendulumPeriodExact(1, 1, G, 1, Math.PI)).toThrow(/Amplitude/);
  });
});

describe('static hold torque', () => {
  it('sums mᵢ g rᵢ over the links', () => {
    const links = [
      { mass: 2, distance: 0.4 },
      { mass: 1, distance: 1.1 },
    ];
    expect(staticHoldTorque(links, G)).toBeCloseTo(2 * G * 0.4 + 1 * G * 1.1, 12);
  });

  it('is zero for an empty arm and rejects a bad link', () => {
    expect(staticHoldTorque([], G)).toBe(0);
    expect(() => staticHoldTorque([{ mass: 0, distance: 1 }], G)).toThrow(/link mass/);
  });
});

describe('planar two-link inverse dynamics', () => {
  const model: TwoLinkModel = {
    l1: 1,
    l2: 0.8,
    m1: 2,
    m2: 1.5,
    d1: 0.5,
    d2: 0.4,
    gravity: G,
  };

  it('reduces to the gravity term when the arm is still', () => {
    const t1 = 0.3;
    const t2 = -0.6;
    const { torque, gravity } = twoLinkTorques(model, { angles: [t1, t2], rates: [0, 0] }, [0, 0]);
    const expectedFirst =
      model.m1 * G * model.d1 * Math.cos(t1) +
      model.m2 * G * (model.l1 * Math.cos(t1) + model.d2 * Math.cos(t1 + t2));
    const expectedSecond = model.m2 * G * model.d2 * Math.cos(t1 + t2);
    expect(torque[0]).toBeCloseTo(expectedFirst, 10);
    expect(torque[1]).toBeCloseTo(expectedSecond, 10);
    expect(gravity[0]).toBeCloseTo(expectedFirst, 10);
  });

  it('builds a symmetric, positive-definite mass matrix', () => {
    const { massMatrix } = twoLinkTorques(model, { angles: [0.4, 0.9], rates: [0, 0] }, [0, 0]);
    expect(massMatrix[0][1]).toBeCloseTo(massMatrix[1][0], 12);
    expect(massMatrix[0][0]).toBeGreaterThan(0);
    const determinant = massMatrix[0][0] * massMatrix[1][1] - massMatrix[0][1] * massMatrix[1][0];
    expect(determinant).toBeGreaterThan(0);
  });

  it('matches the textbook mass matrix at a known configuration', () => {
    const { massMatrix } = twoLinkTorques(model, { angles: [0, 0], rates: [0, 0] }, [0, 0]);
    const { m1, m2, l1, d1, d2 } = model;
    expect(massMatrix[0][0]).toBeCloseTo(m1 * d1 * d1 + m2 * (l1 * l1 + d2 * d2 + 2 * l1 * d2), 12);
    expect(massMatrix[0][1]).toBeCloseTo(m2 * (d2 * d2 + l1 * d2), 12);
    expect(massMatrix[1][1]).toBeCloseTo(m2 * d2 * d2, 12);
  });

  it('vanishes the Coriolis term when the joints are still', () => {
    const { coriolis } = twoLinkTorques(model, { angles: [0.7, -1.1], rates: [0, 0] }, [0, 0]);
    expect(coriolis[0]).toBeCloseTo(0, 12);
    expect(coriolis[1]).toBeCloseTo(0, 12);
  });

  it('rejects a non-finite joint value instead of propagating NaN', () => {
    expect(() =>
      twoLinkTorques(model, { angles: [Number.NaN, 0], rates: [0, 0] }, [0, 0]),
    ).toThrow(/theta1/);
  });
});
