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
  /**
   * Keep one sample in this many, counting from the start sample, and always the
   * final one. Defaults to keeping every step.
   *
   * The two domains that integrate a stiff fast subsystem and plot it coarsely ask
   * for a stride here instead of calling `decimate` afterwards: keeping every
   * internal step means copying a whole state vector per step, and for a cable run
   * that is the difference between a solve and a stalled tab. The result is the
   * same array `decimate` would have returned.
   */
  keepEvery?: number;
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

/** Caller-owned working space for one first-order system of a fixed size. */
export interface Rk4Scratch {
  /** The `y + Σ a·k` argument handed to each stage. */
  argument: number[];
  /** Where the finished step is written. */
  out: number[];
}

/** Allocate the two buffers one `rk4StepInto` needs for a state of `size`. */
export function createRk4Scratch(size: number): Rk4Scratch {
  if (!Number.isInteger(size) || size < 0) throw new Error(`RK4 scratch needs a whole state size, got ${size}.`);
  return { argument: new Array<number>(size), out: new Array<number>(size) };
}

/**
 * Classical fourth-order Runge-Kutta, written into caller-owned buffers.
 *
 * The arithmetic is the same as `rk4Step` — same stage arguments, same final
 * weighted sum, same order of operations, so the numbers are bit-identical — and
 * only the allocation differs: a run reuses these two arrays for every step
 * instead of building four new ones. `out` may alias `state`: each element is
 * read before it is written, and every stage argument is computed from the state
 * that was handed in, so a caller can ping-pong a single buffer.
 */
export function rk4StepInto(
  derivative: Derivative,
  time: number,
  state: readonly number[],
  dt: number,
  scratch: Rk4Scratch,
): number[] {
  const half = 0.5 * dt;
  const { argument, out } = scratch;
  const size = state.length;
  const k1 = derivative(time, state);
  for (let i = 0; i < size; i += 1) argument[i] = state[i] + half * k1[i];
  const k2 = derivative(time + half, argument);
  for (let i = 0; i < size; i += 1) argument[i] = state[i] + half * k2[i];
  const k3 = derivative(time + half, argument);
  for (let i = 0; i < size; i += 1) argument[i] = state[i] + dt * k3[i];
  const k4 = derivative(time + dt, argument);
  const sixth = dt / 6;
  for (let i = 0; i < size; i += 1) out[i] = state[i] + sixth * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
  return out;
}

/** Classical fourth-order Runge-Kutta, the workhorse. */
export function rk4Step(
  derivative: Derivative,
  time: number,
  state: readonly number[],
  dt: number,
): number[] {
  return rk4StepInto(derivative, time, state, dt, createRk4Scratch(state.length));
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
  const keepEvery = options.keepEvery === undefined ? 1 : Math.max(1, Math.floor(options.keepEvery));
  if (!Number.isFinite(t0) || !Number.isFinite(tEnd)) throw new Error('Time bounds must be finite.');
  if (!(dt > 0)) throw new Error(`Step size must be positive, got ${dt}.`);
  if (tEnd < t0) throw new Error(`End time ${tEnd} precedes start time ${t0}.`);
  assertFinite(initial, 'initial state');

  // The length check belongs on the derivative itself, not on an extra call made
  // only to inspect it: that call was a fifth evaluation of a four-stage method,
  // paid on every step of every run in the app.
  let step = 0;
  const checked: Derivative = (time, state) => {
    const slope = derivative(time, state);
    if (slope.length !== state.length) {
      throw new Error(`Step ${step}: derivative returned ${slope.length} values for ${state.length}.`);
    }
    return slope;
  };

  const samples: Sample[] = [{ time: t0, state: [...initial] }];
  const scratch = method === 'rk4' ? createRk4Scratch(initial.length) : null;
  let state = [...initial];
  let time = t0;

  while (time < tEnd) {
    const remaining = tEnd - time;
    // The k-th grid time, not `time + dt`: accumulating the clock over hundreds of
    // thousands of steps drifts a few ulps, which lands the last step just short of
    // `tEnd` and makes it short. Then the endpoint sample sits one index off the
    // reporting stride, `decimate` appends it next to the grid sample it almost
    // equals, and the caller gets two chart points at the same time.
    const target = t0 + (step + 1) * dt;
    const last = remaining <= dt || target >= tEnd;
    const h = last ? remaining : dt;
    const next =
      method === 'rk4' && scratch
        ? rk4StepInto(checked, time, state, h, scratch)
        : method === 'rk45'
          ? rk45Step(checked, time, state, h).next
          : eulerStep(checked, time, state, h);
    assertFinite(next, `Step ${step} at t=${time}`);
    state = next;
    // Land exactly on tEnd on the final step instead of accumulating round-off
    // (and never spin on a step too small to advance the clock).
    time = last ? tEnd : target;
    step += 1;
    // With a stride, the states between the kept samples are never copied: a fine
    // internal step is the point of the run, not something to report.
    if (last || step % keepEvery === 0) samples.push({ time, state: [...state] });
    if (last) break;
  }
  return samples;
}

/* ------------------------------------------------------------------ *
 * Output cadence and step planning
 *
 * Two domains — electric machines and biological models — integrate a stiff
 * fast subsystem and plot it at a much coarser cadence. The plan is the same
 * in both: pick an internal step that resolves the fastest time constant, then
 * keep one sample in `stride` for the caller. It lives here so both use one
 * implementation of the arithmetic and one ceiling on internal work.
 * ------------------------------------------------------------------ */

export interface SubStepPlan {
  /** Internal integration step actually handed to `integrate`. */
  dt: number
  /** How many internal samples are dropped between reported samples. */
  stride: number
}

/**
 * Validate a caller-supplied window and step, and enforce a ceiling on the
 * number of *output* samples. A run that would emit tens of millions of chart
 * points is a mistake, not a long job, so it throws instead of hanging.
 */
export function assertOutputPlan(
  tEnd: number,
  outputDt: number,
  maxOutputSteps: number,
  limitLabel = 'output',
): void {
  if (!Number.isFinite(tEnd) || tEnd <= 0) throw new Error(`Simulation end time must be positive and finite (got ${tEnd}).`)
  if (!Number.isFinite(outputDt) || outputDt <= 0) throw new Error(`Simulation step must be positive and finite (got ${outputDt}).`)
  const steps = Math.ceil(tEnd / outputDt)
  if (steps > maxOutputSteps) {
    throw new Error(
      `Simulation would take ${steps} ${limitLabel} steps (limit ${maxOutputSteps}); ` +
        'increase the step size or shorten the run.',
    )
  }
}

/**
 * Choose an internal step that resolves `fastestTau`, keeping the caller's
 * output step as the reporting cadence.
 *
 * The rule of thumb is one twentieth of the fastest time constant: RK4 is
 * stable to roughly |λh| < 2.8 and accurate to a few percent at h = τ/20, so
 * the internal step is never the thing that ruins the answer. An infinite (or
 * non-positive) `fastestTau` means nothing faster than the output step needs
 * resolving, so the caller's step is used unchanged.
 */
export function planStableSubSteps(
  tEnd: number,
  outputDt: number,
  fastestTau: number,
  maxInternalSteps: number,
): SubStepPlan {
  const target = Number.isFinite(fastestTau) && fastestTau > 0 ? fastestTau / 20 : outputDt
  const stride = Math.max(1, Math.ceil(outputDt / target))
  const dt = outputDt / stride
  const steps = Math.ceil(tEnd / dt)
  if (steps > maxInternalSteps) {
    throw new Error(
      `A stable step of ${dt.toExponential(2)} needs ${steps} internal steps (limit ${maxInternalSteps}); ` +
        'shorten the run or use a system with slower dynamics.',
    )
  }
  return { dt, stride }
}

/** Keep every `stride`-th sample, and always keep the final one. */
export function decimate<T extends { time: number }>(samples: T[], stride: number): T[] {
  if (stride === 1) return samples
  const out = samples.filter((_, index) => index % stride === 0)
  const last = samples[samples.length - 1]
  if (out[out.length - 1] !== last) out.push(last)
  return out
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
