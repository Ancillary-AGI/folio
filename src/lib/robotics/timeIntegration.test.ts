import { describe, expect, it } from 'vitest';
import {
  eulerStep,
  integrate,
  integrateSecondOrder,
  rk45Step,
  rk4Step,
  symplecticEulerStep,
  type Acceleration,
  type Derivative,
} from './timeIntegration';
import { ellipticK } from '../mechanical/dynamics';

const G = 9.81;

/** Pendulum acceleration `θ̈ = -(g/L) sin θ`. */
function pendulumAcceleration(length: number): Acceleration {
  return (_time, position) => [(-G / length) * Math.sin(position[0])];
}

/** Runs a pendulum from rest at `amplitude` for `duration` and returns the last sample. */
function run(
  acceleration: Acceleration,
  duration: number,
  options: { dt: number; method: 'symplectic-euler' | 'rk4' | 'rk45' },
): { position: number[]; velocity: number[] } {
  const samples = integrateSecondOrder(acceleration, [1], [0], 0, duration, options);
  return samples[samples.length - 1];
}

describe('closed-form first-order systems', () => {
  it('solves exponential decay dy/dt = -ky against T₀e^{-kt}', () => {
    const k = 1.7;
    const t0 = 4;
    const derivative: Derivative = (_t, y) => [-k * y[0]];
    const samples = integrate(derivative, [t0], 0, 2, { dt: 1e-3 });
    const last = samples[samples.length - 1];
    expect(last.state[0]).toBeCloseTo(t0 * Math.exp(-k * 2), 10);
  });

  it('solves free fall against ½gt²', () => {
    // y' = v, v' = g, released from rest at the origin.
    const derivative: Derivative = (_t, y) => [y[1], G];
    const samples = integrate(derivative, [0, 0], 0, 1.5, { dt: 1e-3 });
    const last = samples[samples.length - 1];
    expect(last.state[0]).toBeCloseTo(0.5 * G * 1.5 ** 2, 9);
    expect(last.state[1]).toBeCloseTo(G * 1.5, 9);
  });

  it('solves a harmonic oscillator against A cos(ωt) + (v₀/ω) sin(ωt)', () => {
    const omega = 3.2;
    const x0 = 0.7;
    const v0 = -1.1;
    const derivative: Derivative = (_t, y) => [y[1], -omega * omega * y[0]];
    const samples = integrate(derivative, [x0, v0], 0, 4, { dt: 1e-4 });
    const last = samples[samples.length - 1];
    const expected = x0 * Math.cos(omega * 4) + (v0 / omega) * Math.sin(omega * 4);
    expect(last.state[0]).toBeCloseTo(expected, 8);
    expect(last.state[1]).toBeCloseTo(
      -omega * x0 * Math.sin(omega * 4) + v0 * Math.cos(omega * 4),
      7,
    );
  });

  it('propagates the fifth-order solution and reports an honest error estimate', () => {
    // For dy/dt = y over one quarter-step the 4(5) pair is not exact, so the embedded
    // estimate is non-zero by design: it measures the truncation error. It should be
    // small, and it should track the error actually observed against e^0.25.
    const derivative: Derivative = (_t, y) => [y[0]];
    const { next, error } = rk45Step(derivative, 0, [1], 0.25);
    const exact = Math.exp(0.25);
    const trueError = Math.abs(next[0] - exact);
    expect(next[0]).toBeCloseTo(exact, 7);
    expect(trueError).toBeLessThan(1e-7);
    expect(Math.abs(error[0])).toBeGreaterThan(0);
    expect(Math.abs(error[0])).toBeLessThan(1e-6);
    // The estimate should be within a small factor of the error it is estimating.
    expect(Math.abs(error[0])).toBeGreaterThan(trueError / 10);
  });
});

describe('closed-form second-order systems', () => {
  it('swings a small-amplitude pendulum close to its linearised period', () => {
    const L = 1.2;
    const omega = Math.sqrt(G / L);
    const amplitude = 0.02;
    const samples = integrateSecondOrder(pendulumAcceleration(L), [amplitude], [0], 0, 3, {
      dt: 1e-4,
      method: 'rk4',
    });
    // The comparison is against the *linearised* solution, so the residual floor is the
    // genuine nonlinear period correction (T/T0 ≈ 1 + θ0²/16), not integrator error.
    let worst = 0;
    for (const sample of samples) {
      worst = Math.max(worst, Math.abs(sample.position[0] - amplitude * Math.cos(omega * sample.time)));
    }
    expect(worst).toBeLessThan(1e-5);
  });

  it('matches the large-amplitude period against the elliptic-integral answer', () => {
    // A point mass on a massless rod has I = mL² and d = L.
    const L = 0.8;
    const amplitude = 2.2;
    const exact = 4 * Math.sqrt(L / G) * ellipticK(Math.sin(amplitude / 2));
    // Start at the far swing and integrate to the first return to the far swing.
    const samples = integrateSecondOrder(pendulumAcceleration(L), [amplitude], [0], 0, exact, {
      dt: exact / 20000,
      method: 'rk4',
    });
    const last = samples[samples.length - 1];
    expect(last.position[0]).toBeCloseTo(amplitude, 5);
    // It must not have drifted a full half-swing past the start.
    expect(last.position[0]).toBeGreaterThan(0);
  });

  it('bounds the energy error of symplectic Euler instead of letting it grow', () => {
    const L = 1;
    const amplitude = 1.0;
    const dt = 1e-3;
    const energy = (s: { position: number[]; velocity: number[] }): number =>
      0.5 * (L * s.velocity[0]) ** 2 + G * L * (1 - Math.cos(s.position[0]));
    const drift = (duration: number): number =>
      Math.abs(
        energy(run(pendulumAcceleration(L), duration, { dt, method: 'symplectic-euler' })) -
          energy({ position: [amplitude], velocity: [0] }),
      );

    const short = drift(10);
    const long = drift(40);
    // Symplectic Euler's energy error oscillates within a bound rather than accumulating,
    // so quadrupling the run time must not quadruple the error.
    expect(long).toBeLessThan(short * 2);
    expect(long).toBeLessThan(0.02);
  });

  it('keeps RK4 energy drift orders of magnitude below the symplectic bound', () => {
    const L = 1;
    const amplitude = 1.0;
    const dt = 1e-3;
    const energy = (s: { position: number[]; velocity: number[] }): number =>
      0.5 * (L * s.velocity[0]) ** 2 + G * L * (1 - Math.cos(s.position[0]));
    const series = run(pendulumAcceleration(L), 20, { dt, method: 'rk4' });
    const drift = Math.abs(energy(series) - energy({ position: [amplitude], velocity: [0] }));
    expect(drift).toBeLessThan(1e-6);
  });

  it('advances velocity before position in the symplectic step', () => {
    const acceleration: Acceleration = () => [2];
    const step = symplecticEulerStep(acceleration, 0, [0], [0], 0.5);
    // v = 0 + 2(0.5) = 1, then q = 0 + 1(0.5) = 0.5, not q = 0.
    expect(step.velocity[0]).toBeCloseTo(1, 12);
    expect(step.position[0]).toBeCloseTo(0.5, 12);
  });
});

describe('measured convergence order', () => {
  /** Error at `t = 1` for `y' = y`, whose exact answer is `e`. */
  function errorAt(method: 'euler' | 'rk4' | 'rk45', dt: number): number {
    const derivative: Derivative = (_t, y) => [y[0]];
    const samples = integrate(derivative, [1], 0, 1, { dt, method });
    return Math.abs(samples[samples.length - 1].state[0] - Math.E);
  }

  /** Observed order from halving the step: `log2(e(h)/e(h/2))`. */
  function observedOrder(method: 'euler' | 'rk4' | 'rk45', coarse: number): number {
    const fine = coarse / 2;
    return Math.log2(errorAt(method, coarse) / errorAt(method, fine));
  }

  it('gives forward Euler first order', () => {
    const order = observedOrder('euler', 1e-3);
    expect(order).toBeGreaterThan(0.9);
    expect(order).toBeLessThan(1.1);
  });

  it('gives classical RK4 fourth order', () => {
    const order = observedOrder('rk4', 0.05);
    expect(order).toBeGreaterThan(3.8);
    expect(order).toBeLessThan(4.2);
  });

  it('gives Cash-Karp fifth order', () => {
    const order = observedOrder('rk45', 0.2);
    expect(order).toBeGreaterThan(4.8);
    expect(order).toBeLessThan(5.2);
  });

  it('makes RK4 dramatically more accurate than Euler at the same step', () => {
    expect(errorAt('rk4', 1e-2)).toBeLessThan(errorAt('euler', 1e-2) / 1e6);
  });

  it('reaches machine precision with RK4 on a smooth problem', () => {
    expect(errorAt('rk4', 1e-3)).toBeLessThan(1e-13);
  });
});

describe('sampling contract and guards', () => {
  it('always includes both endpoints at an even cadence', () => {
    const derivative: Derivative = (_t, y) => [y[1], -y[0]];
    const samples = integrate(derivative, [1, 0], 0, 1, { dt: 0.05 });
    expect(samples[0].time).toBe(0);
    expect(samples[samples.length - 1].time).toBeCloseTo(1, 12);
    expect(samples).toHaveLength(21);
    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i].time - samples[i - 1].time).toBeCloseTo(0.05, 12);
    }
  });

  it('takes one short final step when the span is not a whole multiple', () => {
    const samples = integrate(() => [1], [0], 0, 0.25, { dt: 0.1 });
    expect(samples).toHaveLength(4);
    expect(samples.map((s) => s.time)).toEqual([0, 0.1, 0.2, 0.25]);
    expect(samples[3].state[0]).toBeCloseTo(0.25, 12);
  });

  it('returns just the start sample for a zero-length span', () => {
    const samples = integrate(() => [1], [5], 2, 2, { dt: 0.1 });
    expect(samples).toHaveLength(1);
    expect(samples[0].state[0]).toBe(5);
  });

  it('lands exactly on the end for a span shorter than the time epsilon', () => {
    const samples = integrate(() => [1], [0], 0, 1e-13, { dt: 1e-3 });
    expect(samples).toHaveLength(2);
    expect(samples[1].time).toBe(1e-13);
    expect(samples[1].state[0]).toBeCloseTo(1e-13, 25);
  });

  it('lands exactly on the end for a second-order span shorter than the time epsilon', () => {
    const samples = integrateSecondOrder(() => [0], [1], [0], 0, 1e-13, { dt: 1e-3 });
    expect(samples).toHaveLength(2);
    expect(samples[1].time).toBe(1e-13);
  });

  it('rejects a non-positive step, a reversed span and non-finite bounds', () => {
    expect(() => integrate(() => [1], [0], 0, 1, { dt: 0 })).toThrow(/positive/);
    expect(() => integrate(() => [1], [0], 0, 1, { dt: -0.1 })).toThrow(/positive/);
    expect(() => integrate(() => [1], [0], 1, 0, { dt: 0.1 })).toThrow(/precedes/);
    expect(() => integrate(() => [1], [0], Number.NaN, 1, { dt: 0.1 })).toThrow(/finite/);
  });

  it('rejects a derivative whose output length does not match the state', () => {
    expect(() => integrate(() => [1, 2], [0], 0, 0.1, { dt: 0.1 })).toThrow(/returned 2 values/);
  });

  it('names the step when a state goes non-finite', () => {
    const blowUp: Derivative = (_t, y) => [y[0] * y[0] * 1e3];
    expect(() => integrate(blowUp, [10], 0, 10, { dt: 1 })).toThrow(/Step \d+ at t=/);
  });

  it('rejects mismatched position and velocity lengths', () => {
    expect(() =>
      integrateSecondOrder(() => [0], [0, 0], [0], 0, 1, { dt: 0.1 }),
    ).toThrow(/same length/);
  });

  it('rejects an acceleration whose length does not match the position', () => {
    expect(() =>
      integrateSecondOrder(() => [0, 0], [0], [0], 0, 1, { dt: 0.1 }),
    ).toThrow(/returned 2 values/);
  });

  it('keeps every single-step helper consistent with the driver', () => {
    const derivative: Derivative = (_t, y) => [-y[0]];
    const manual = rk4Step(derivative, 0, [1], 0.1);
    const driven = integrate(derivative, [1], 0, 0.1, { dt: 0.1, method: 'rk4' });
    expect(driven[1].state[0]).toBeCloseTo(manual[0], 14);
    const explicit = eulerStep(derivative, 0, [1], 0.1);
    expect(explicit[0]).toBeCloseTo(1 - 0.1, 14);
  });
});
