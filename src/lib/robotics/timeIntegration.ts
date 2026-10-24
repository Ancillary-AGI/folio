/**
 * Time integration for the dynamics domains: robotics, multibody mechanics, and any
 * other place a state must be advanced in time.
 *
 * The integrators are deliberately simple, and the companion test holds them to
 * closed-form solutions — a simple pendulum against its elliptic-integral period, a
 * harmonic oscillator against `A cos(ωt + φ)`, exponential decay against `T₀e^{-kt}`,
 * free fall against `½gt²` — and measures each method's convergence order empirically.
 * The integrators never agree with the reference by construction: they are independent
 * implementations that are forced to match.
 *
 * Conventions
 * -----------
 * - `integrate` handles first-order systems `dy/dt = f(t, y)`.
 * - `integrateSecondOrder` handles `q̈ = a(t, q, q̇)`, keeping position and velocity in
 *   separate arrays so a symplectic method can advance velocity before position.
 * - Samples always include both endpoints, at an even cadence, with a final short step
 *   when the span is not a whole multiple of `dt`.
 *
 * Nothing masks a failure: a non-positive step throws, a non-finite state throws naming
 * the step, and a length mismatch between the derivative and the state is rejected.
 */

/** First-order system `dy/dt = f(t, y)`. */
export type Derivative = (time: number, state: readonly number[]) => number[];

/** Second-order system `q̈ = a(t, q, q̇)`. */
export type Acceleration = (
  time: number,
  position: readonly number[],
  velocity: readonly number[],
) => number[];

export type FirstOrderMethod = 'euler' | 'rk4' | 'rk45';
export type SecondOrderMethod = 'symplectic-euler' | 'rk4' | 'rk45';

export interface StepOptions {
  /** Step size. Must be strictly positive. */
  dt: number;
}

export interface Sample {
  time: number;
  state: number[];
}

export interface SecondOrderSample {
  time: number;
  position: number[];
  velocity: number[];
}

function assertFinite(values: readonly number[], label: string): void {
  if (values.length === 0) throw new Error(`${label}: expected at least one element.`);
  for (let i = 0; i < values.length; i += 1) {
    if (!Number.isFinite(values[i])) throw new Error(`${label}: element ${i} is ${values[i]}.`);
  }
}

/* ------------------------------------------------------------------ *
 * First-order systems
 * ------------------------------------------------------------------ */

/** Classical fourth-order Runge-Kutta, the workhorse. */
export function rk4Step(
  derivative: Derivative,
  time: number,
  state: readonly number[],
  dt: number,
): number[] {
  const k1 = derivative(time, state);
  const k2 = derivative(time + 0.5 * dt, state.map((v, i) => v + 0.5 * dt * k1[i]));
  const k3 = derivative(time + 0.5 * dt, state.map((v, i) => v + 0.5 * dt * k2[i]));
  const k4 = derivative(time + dt, state.map((v, i) => v + dt * k3[i]));
  return state.map((v, i) => v + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
}

/** Explicit forward Euler: first-order accurate, kept as the accuracy floor. */
export function eulerStep(
  derivative: Derivative,
  time: number,
  state: readonly number[],
  dt: number,
): number[] {
  const slope = derivative(time, state);
  return state.map((v, i) => v + dt * slope[i]);
}

const RK45_C = [0, 1 / 5, 3 / 10, 3 / 5, 1, 7 / 8];
const RK45_A: readonly number[][] = [
  [],
  [1 / 5],
  [3 / 40, 9 / 40],
  [3 / 10, -9 / 10, 6 / 5],
  [-11 / 54, 5 / 2, -70 / 27, 35 / 27],
  [1631 / 55296, 175 / 512, 575 / 13824, 44275 / 110592, 253 / 4096],
];
// Fifth-order weights: the final two entries are 0 and 512/1771, in that order.
const RK45_B5 = [37 / 378, 0, 250 / 621, 125 / 594, 0, 512 / 1771];
const RK45_B4 = [2825 / 27648, 0, 18575 / 48384, 13525 / 55296, 277 / 14336, 1 / 4];

function weighted(weights: readonly number[], stages: readonly number[][], index: number): number {
  let total = 0;
  for (let w = 0; w < weights.length; w += 1) total += weights[w] * stages[w + 1][index];
  return total;
}

/**
 * One fixed-step Cash-Karp 4(5) step, propagating the fifth-order solution. The
 * embedded fourth-order solution supplies the local error estimate, which a caller can
 * size its step from rather than guessing.
 */
export function rk45Step(
  derivative: Derivative,
  time: number,
  state: readonly number[],
  dt: number,
): { next: number[]; error: number[] } {
  const stages: number[][] = [state.map((v) => v)];
  for (let s = 0; s < 6; s += 1) {
    const argument = state.map((v, i) => {
      let sum = 0;
      for (let j = 0; j < s; j += 1) sum += RK45_A[s][j] * stages[j + 1][i];
      return v + dt * sum;
    });
    stages.push(derivative(time + dt * RK45_C[s], argument));
  }
  const fifth = state.map((v, i) => v + dt * weighted(RK45_B5, stages, i));
  const fourth = state.map((v, i) => v + dt * weighted(RK45_B4, stages, i));
  const next = fifth;
  const error = fifth.map((v, i) => v - fourth[i]);
  assertFinite(next, 'Cash-Karp step');
  return { next, error };
}

/** Advance `dy/dt = f(t, y)` from `t0` to `tEnd`, sampling every `dt`. */
export function integrate(
  derivative: Derivative,
  initial: readonly number[],
  t0: number,
  tEnd: number,
  options: StepOptions & { method?: FirstOrderMethod } = { dt: 1e-3, method: 'rk4' },
): Sample[] {
  const method = options.method ?? 'rk4';
  const dt = options.dt;
  if (!Number.isFinite(t0) || !Number.isFinite(tEnd)) throw new Error('Time bounds must be finite.');
  if (!(dt > 0)) throw new Error(`Step size must be positive, got ${dt}.`);
  if (tEnd < t0) throw new Error(`End time ${tEnd} precedes start time ${t0}.`);
  assertFinite(initial, 'initial state');

  const samples: Sample[] = [{ time: t0, state: [...initial] }];
  let state = [...initial];
  let time = t0;
  let step = 0;

  while (time < tEnd) {
    const remaining = tEnd - time;
    const last = remaining <= dt;
    const h = last ? remaining : dt;
    const slope = derivative(time, state);
    if (slope.length !== state.length) {
      throw new Error(`Step ${step}: derivative returned ${slope.length} values for ${state.length}.`);
    }
    const next =
      method === 'rk4'
        ? rk4Step(derivative, time, state, h)
        : method === 'rk45'
          ? rk45Step(derivative, time, state, h).next
          : eulerStep(derivative, time, state, h);
    assertFinite(next, `Step ${step} at t=${time}`);
    state = next;
    // Land exactly on tEnd on the final step instead of accumulating round-off
    // (and never spin on a step too small to advance the clock).
    time = last ? tEnd : time + h;
    step += 1;
    samples.push({ time, state: [...state] });
    if (last) break;
  }
  return samples;
}

/* ------------------------------------------------------------------ *
 * Second-order systems
 * ------------------------------------------------------------------ */

/**
 * Symplectic Euler for `q̈ = a`: velocity takes the full step from the current
 * acceleration, then position uses the *new* velocity. That ordering is what keeps the
 * scheme energy-stable over long swings, where plain Euler is not.
 */
export function symplecticEulerStep(
  acceleration: Acceleration,
  time: number,
  position: readonly number[],
  velocity: readonly number[],
  dt: number,
): { position: number[]; velocity: number[] } {
  const accel = acceleration(time, position, velocity);
  if (accel.length !== position.length) {
    throw new Error(`Acceleration returned ${accel.length} values for ${position.length}.`);
  }
  const nextVelocity = velocity.map((v, i) => v + dt * accel[i]);
  return {
    position: position.map((q, i) => q + dt * nextVelocity[i]),
    velocity: nextVelocity,
  };
}

/**
 * Advance `q̈ = a(t, q, q̇)` from `t0` to `tEnd`, sampling every `dt` and keeping
 * position and velocity separate so callers never slice a packed state themselves.
 */
export function integrateSecondOrder(
  acceleration: Acceleration,
  initialPosition: readonly number[],
  initialVelocity: readonly number[],
  t0: number,
  tEnd: number,
  options: StepOptions & { method?: SecondOrderMethod } = {
    dt: 1e-3,
    method: 'symplectic-euler',
  },
): SecondOrderSample[] {
  const method = options.method ?? 'symplectic-euler';
  const dt = options.dt;
  if (!Number.isFinite(t0) || !Number.isFinite(tEnd)) throw new Error('Time bounds must be finite.');
  if (!(dt > 0)) throw new Error(`Step size must be positive, got ${dt}.`);
  if (tEnd < t0) throw new Error(`End time ${tEnd} precedes start time ${t0}.`);
  assertFinite(initialPosition, 'initial position');
  assertFinite(initialVelocity, 'initial velocity');
  if (initialVelocity.length !== initialPosition.length) {
    throw new Error('Position and velocity must have the same length.');
  }

  const packed: Derivative = (time, state) => {
    const half = state.length / 2;
    const position = state.slice(0, half);
    const velocity = state.slice(half);
    return [...velocity, ...acceleration(time, position, velocity)];
  };

  const samples: SecondOrderSample[] = [
    { time: t0, position: [...initialPosition], velocity: [...initialVelocity] },
  ];
  let position = [...initialPosition];
  let velocity = [...initialVelocity];
  let time = t0;
  let step = 0;

  while (time < tEnd) {
    const remaining = tEnd - time;
    const last = remaining <= dt;
    const h = last ? remaining : dt;
    if (method === 'symplectic-euler') {
      const advanced = symplecticEulerStep(acceleration, time, position, velocity, h);
      position = advanced.position;
      velocity = advanced.velocity;
    } else {
      const packedState = [...position, ...velocity];
      const next =
        method === 'rk4'
          ? rk4Step(packed, time, packedState, h)
          : rk45Step(packed, time, packedState, h).next;
      position = next.slice(0, position.length);
      velocity = next.slice(position.length);
    }
    assertFinite(position, `Step ${step} position at t=${time}`);
    assertFinite(velocity, `Step ${step} velocity at t=${time}`);
    time = last ? tEnd : time + h;
    step += 1;
    samples.push({ time, position: [...position], velocity: [...velocity] });
    if (last) break;
  }
  return samples;
}
