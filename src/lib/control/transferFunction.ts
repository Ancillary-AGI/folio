/**
 * Continuous-time control-systems analysis for SISO plants.
 *
 * Everything here works on polynomials given in **descending** powers
 * (`[a_n, …, a_1, a_0]`), the same order a textbook writes them. A transfer
 * function keeps its numerator and denominator separate, so a pole at the
 * origin (an integrator) never has to be cancelled out of the coefficient list.
 *
 * What is modelled:
 *   - transfer-function algebra (series, parallel, feedback),
 *   - poles, zeros and stability classification,
 *   - conversion to controllable canonical state space,
 *   - state-space simulation with RK4,
 *   - step/impulse responses and their usual metrics,
 *   - Bode and Nyquist data, and gain/phase stability margins.
 *
 * What is not modelled: time delays (`e^{-sT}`), sampled-data/discrete design,
 * MIMO systems, and pole placement. Bode margins are meaningful for open-loop
 * stable, minimum-phase plants; the reported `closedLoopStable` flag always
 * comes from the actual closed-loop poles, not from the margins.
 *
 * Invalid input throws. Coefficients must be finite, the denominator must not
 * be the zero polynomial, and simulation options must describe a real time
 * base — silently returning an empty or zero trace would look like a valid
 * answer.
 */

export interface Complex {
  re: number;
  im: number;
}

/** `numerator` and `denominator` are descending-power real coefficients. */
export interface TransferFunction {
  numerator: number[];
  denominator: number[];
}

export interface StateSpace {
  /** n×n state matrix (empty for a static gain). */
  a: number[][];
  /** n input vector. */
  b: number[];
  /** n output vector. */
  c: number[];
  /** Feed-through gain. */
  d: number;
}

export interface SimulationOptions {
  tEndSeconds: number;
  dtSeconds: number;
  /** Optional initial state (same length as `a`). Defaults to rest. */
  initialState?: number[];
}

export interface SimulationSample {
  timeSeconds: number;
  output: number;
  state: number[];
}

export interface StepMetrics {
  steadyState: number;
  /** Peak overshoot as a percentage of the final value; 0 when none. */
  overshootPct: number;
  /** 10 % → 90 % rise time; NaN when the response never crosses both levels. */
  riseTimeSeconds: number;
  /** Last time outside a ±2 % band; NaN when the response never settles. */
  settlingTimeSeconds: number;
}

export interface BodeOptions {
  fMinHz: number;
  fMaxHz: number;
  points?: number;
}

export interface BodePoint {
  frequencyHz: number;
  omega: number;
  magnitudeDb: number;
  /**
   * Unwrapped so the trace is continuous across ±180°, and anchored on the
   * low-frequency asymptote set by the poles and zeros at the origin — see
   * `phaseBranchOffset`.
   */
  phaseDeg: number;
}

export interface StabilityMargins {
  /** Positive is stable; Infinity when the phase never crosses −180°. */
  gainMarginDb: number;
  /** Positive is stable; Infinity when |G| never crosses 0 dB. */
  phaseMarginDeg: number;
  gainCrossoverHz: number;
  phaseCrossoverHz: number;
  /** From the poles of G/(1+G), the authoritative check. */
  closedLoopStable: boolean;
}

export interface NyquistPoint {
  frequencyHz: number;
  re: number;
  im: number;
}

const MAX_SAMPLES = 200_000;
const ROOT_TOLERANCE = 1e-12;
const STABILITY_TOLERANCE = 1e-9;

/* ------------------------------------------------------------------ *
 * Polynomials and complex arithmetic
 * ------------------------------------------------------------------ */

function assertFiniteArray(values: readonly number[], label: string): void {
  if (values.length === 0) throw new Error(`${label} must contain at least one coefficient.`);
  for (let i = 0; i < values.length; i += 1) {
    if (!Number.isFinite(values[i])) {
      throw new Error(`${label} coefficient ${i} is not finite (${values[i]}).`);
    }
  }
}

/** Drop leading zeros; an all-zero polynomial becomes `[0]`. */
export function trimPolynomial(coefficients: readonly number[]): number[] {
  const copy = [...coefficients];
  let first = 0;
  while (first < copy.length - 1 && copy[first] === 0) first += 1;
  return copy.slice(first);
}

function polynomialDegree(coefficients: readonly number[]): number {
  return trimPolynomial(coefficients).length - 1;
}

function polyScale(coefficients: readonly number[], gain: number): number[] {
  return coefficients.map((value) => value * gain);
}

function polyAdd(a: readonly number[], b: readonly number[]): number[] {
  const length = Math.max(a.length, b.length);
  const out = new Array<number>(length).fill(0);
  for (let i = 0; i < a.length; i += 1) out[length - a.length + i] += a[i];
  for (let i = 0; i < b.length; i += 1) out[length - b.length + i] += b[i];
  return trimPolynomial(out);
}

function polyMultiply(a: readonly number[], b: readonly number[]): number[] {
  const out = new Array<number>(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < b.length; j += 1) out[i + j] += a[i] * b[j];
  }
  return trimPolynomial(out);
}

export function complex(re: number, im = 0): Complex {
  return { re, im };
}

export function complexAdd(a: Complex, b: Complex): Complex {
  return { re: a.re + b.re, im: a.im + b.im };
}

export function complexMultiply(a: Complex, b: Complex): Complex {
  return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
}

export function complexDivide(a: Complex, b: Complex): Complex {
  const denominator = b.re * b.re + b.im * b.im;
  if (denominator === 0) throw new Error('Complex division by zero.');
  return {
    re: (a.re * b.re + a.im * b.im) / denominator,
    im: (a.im * b.re - a.re * b.im) / denominator,
  };
}

export function complexMagnitude(value: Complex): number {
  return Math.hypot(value.re, value.im);
}

export function complexArgumentDeg(value: Complex): number {
  return (Math.atan2(value.im, value.re) * 180) / Math.PI;
}

/** Horner evaluation of a descending-power real polynomial at a complex point. */
export function evaluatePolynomial(coefficients: readonly number[], s: Complex): Complex {
  let result: Complex = { re: 0, im: 0 };
  for (const coefficient of coefficients) {
    result = complexAdd(complexMultiply(result, s), complex(coefficient));
  }
  return result;
}

/* ------------------------------------------------------------------ *
 * Transfer-function algebra
 * ------------------------------------------------------------------ */

export function validateTransferFunction(tf: TransferFunction): TransferFunction {
  assertFiniteArray(tf.numerator, 'Transfer-function numerator');
  assertFiniteArray(tf.denominator, 'Transfer-function denominator');
  const denominator = trimPolynomial(tf.denominator);
  if (denominator.length === 1 && denominator[0] === 0) {
    throw new Error('Transfer-function denominator is the zero polynomial.');
  }
  return {
    numerator: trimPolynomial(tf.numerator),
    denominator,
  };
}

/** Series connection `G₁·G₂`. */
export function tfSeries(first: TransferFunction, second: TransferFunction): TransferFunction {
  const a = validateTransferFunction(first);
  const b = validateTransferFunction(second);
  return validateTransferFunction({
    numerator: polyMultiply(a.numerator, b.numerator),
    denominator: polyMultiply(a.denominator, b.denominator),
  });
}

/** Parallel connection `G₁ + G₂`. */
export function tfParallel(first: TransferFunction, second: TransferFunction): TransferFunction {
  const a = validateTransferFunction(first);
  const b = validateTransferFunction(second);
  return validateTransferFunction({
    numerator: polyAdd(
      polyMultiply(a.numerator, b.denominator),
      polyMultiply(b.numerator, a.denominator),
    ),
    denominator: polyMultiply(a.denominator, b.denominator),
  });
}

/**
 * Closed loop around `forward` with `feedback` (unity when omitted).
 * Negative feedback gives `G/(1+GH)`; positive gives `G/(1−GH)`.
 */
export function tfFeedback(
  forward: TransferFunction,
  feedback: TransferFunction = { numerator: [1], denominator: [1] },
  negative = true,
): TransferFunction {
  const g = validateTransferFunction(forward);
  const h = validateTransferFunction(feedback);
  const denominator = polyAdd(
    polyMultiply(g.denominator, h.denominator),
    polyScale(polyMultiply(g.numerator, h.numerator), negative ? 1 : -1),
  );
  if (denominator.length === 1 && denominator[0] === 0) {
    throw new Error('Closed-loop denominator is the zero polynomial (algebraic loop).');
  }
  return validateTransferFunction({
    numerator: polyMultiply(g.numerator, h.denominator),
    denominator,
  });
}

export function tfGain(gain: number): TransferFunction {
  if (!Number.isFinite(gain)) throw new Error(`Gain must be finite, got ${gain}.`);
  return { numerator: [gain], denominator: [1] };
}

/** Evaluate `G(s)` at a complex point. */
export function tfEvaluate(tf: TransferFunction, s: Complex): Complex {
  const valid = validateTransferFunction(tf);
  return complexDivide(
    evaluatePolynomial(valid.numerator, s),
    evaluatePolynomial(valid.denominator, s),
  );
}

/** Steady-state gain `G(0)`, or Infinity when there is an integrator. */
export function tfDcGain(tf: TransferFunction): number {
  const valid = validateTransferFunction(tf);
  const numerator = evaluatePolynomial(valid.numerator, complex(0)).re;
  const denominator = evaluatePolynomial(valid.denominator, complex(0)).re;
  if (denominator === 0) return Math.abs(numerator) > 0 ? Infinity : Number.NaN;
  return numerator / denominator;
}

/* ------------------------------------------------------------------ *
 * Roots
 * ------------------------------------------------------------------ */

/** Roots of a real descending-power polynomial, complex when necessary. */
export function polynomialRoots(coefficients: readonly number[]): Complex[] {
  assertFiniteArray(coefficients, 'Polynomial');
  const normalised = trimPolynomial(coefficients);
  const degree = normalised.length - 1;
  if (degree < 1) return [];

  const leading = normalised[0];
  if (leading === 0) return [];
  const monic: number[] = new Array<number>(degree + 1);
  for (let i = 0; i <= degree; i += 1) {
    monic[i] = normalised[i] / leading;
    if (!Number.isFinite(monic[i])) {
      throw new Error(
        `Polynomial coefficient ${i} divided by the leading coefficient exceeds double range ` +
          `(${normalised[i]}/${leading}); normalise the transfer function before asking for its roots.`,
      );
    }
  }
  monic[0] = 1;

  if (degree === 1) return [{ re: -monic[1], im: 0 }];

  if (degree === 2) {
    const a1 = monic[1];
    const a2 = monic[2];
    /*
     * The textbook discriminant `a1*a1 - 4*a2` overflows past |a1| ~ 1.3e154,
     * and `(-a1 ± sqrt(discriminant))/2` cancels away the small root when the
     * two roots differ by many orders of magnitude. Both are avoided by
     * solving in the scaled variable x = s*y, where s bounds the root
     * magnitudes, and recovering the second root from the product
     * x1*x2 = a2.
     *
     * Real roots are exact up to the usual rounding of sqrt; complex roots are
     * exact up to sqrt as well. Repeated roots (discriminant 0) lose about
     * half of the significant digits, which is inherent to the formula.
     */
    const scale = Math.max(Math.abs(a1), Math.sqrt(Math.abs(a2)), 1);
    const p = a1 / scale;
    const q = (a2 / scale) / scale;
    const discriminant = p * p - 4 * q;
    if (!Number.isFinite(discriminant)) {
      throw new Error(`Quadratic discriminant overflow for coefficients [1, ${a1}, ${a2}].`);
    }
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant);
      const large = p >= 0 ? -(p + root) / 2 : -(p - root) / 2;
      const x1 = scale * large;
      if (x1 === 0) return [{ re: 0, im: 0 }, { re: 0, im: 0 }];
      const x2 = a2 / x1;
      if (!Number.isFinite(x1) || !Number.isFinite(x2)) {
        throw new Error(
          `Quadratic roots of [1, ${a1}, ${a2}] exceed double range (|root| ~ ${scale}).`,
        );
      }
      return [
        { re: x1, im: 0 },
        { re: x2, im: 0 },
      ];
    }
    const imaginary = (Math.sqrt(-discriminant) * scale) / 2;
    const real = (-p * scale) / 2;
    if (!Number.isFinite(real) || !Number.isFinite(imaginary)) {
      throw new Error(
        `Quadratic roots of [1, ${a1}, ${a2}] exceed double range (|root| ~ ${scale}).`,
      );
    }
    return [
      { re: real, im: imaginary },
      { re: real, im: -imaginary },
    ];
  }

  /*
   * Durand–Kerner: all roots at once, iterated on a scaled variable.
   *
   * Horner evaluation of the raw monic coefficients overflows long before the
   * roots do — `(s+1)^50` has coefficients near 1e29 and any iteration step
   * outside the root ring squares into Infinity and poisons every guess with
   * NaN. Substituting x = scale*y keeps |coefficient| <= 1 by construction, so
   * the initial ring (radius <= 2) and all intermediate products stay inside
   * double range.
   *
   * Honest limits: convergence is quadratic for distinct roots but only linear
   * for repeated ones, and multiple roots are intrinsically ill-conditioned —
   * a degree-50 polynomial with one root repeated 50 times is only accurate to
   * roughly the square/cube root of machine epsilon (1e-4 relative). Reach for
   * a factorised representation when exact multiplicity matters. Non-finite
   * results are rejected below rather than returned.
   */
  let scale = 0;
  for (let k = 1; k <= degree; k += 1) {
    const bound = Math.abs(monic[k]) ** (1 / k);
    if (bound > scale) scale = bound;
  }
  if (!(scale > 0) || !Number.isFinite(scale)) scale = 1;

  const scaled: number[] = new Array<number>(degree + 1);
  scaled[0] = 1;
  let factor = 1;
  for (let k = 1; k <= degree; k += 1) {
    factor /= scale;
    scaled[k] = monic[k] * factor;
  }

  let ringRadius = 1;
  for (let k = 1; k <= degree; k += 1) ringRadius = Math.max(ringRadius, 1 + Math.abs(scaled[k]));
  const roots: Complex[] = [];
  for (let k = 0; k < degree; k += 1) {
    const angle = (2 * Math.PI * k) / degree + 0.4;
    roots.push({
      re: ringRadius * Math.cos(angle),
      im: ringRadius * Math.sin(angle),
    });
  }

  const evaluate = (z: Complex): Complex => {
    let result: Complex = { re: 0, im: 0 };
    for (const coefficient of scaled) {
      result = complexAdd(complexMultiply(result, z), { re: coefficient, im: 0 });
    }
    return result;
  };

  for (let iteration = 0; iteration < 2000; iteration += 1) {
    let largestCorrection = 0;
    for (let i = 0; i < degree; i += 1) {
      const zi = roots[i];
      let denominator: Complex = { re: 1, im: 0 };
      for (let j = 0; j < degree; j += 1) {
        if (j === i) continue;
        denominator = complexMultiply(denominator, {
          re: zi.re - roots[j].re,
          im: zi.im - roots[j].im,
        });
      }
      if (complexMagnitude(denominator) < 1e-300) continue;
      const correction = complexDivide(evaluate(zi), denominator);
      roots[i] = { re: zi.re - correction.re, im: zi.im - correction.im };
      largestCorrection = Math.max(
        largestCorrection,
        complexMagnitude(correction) / Math.max(1, complexMagnitude(zi)),
      );
    }
    if (largestCorrection < ROOT_TOLERANCE) break;
  }

  const finalised = roots.map((root) => {
    const re = root.re * scale;
    const im = root.im * scale;
    return {
      re,
      im: Math.abs(im) < 1e-9 * Math.max(scale, Math.abs(re)) ? 0 : im,
    };
  });

  for (const root of finalised) {
    if (!Number.isFinite(root.re) || !Number.isFinite(root.im)) {
      throw new Error(
        `Root finder of degree ${degree} did not converge to finite values — the polynomial is ` +
          'either too ill-conditioned for a dense solve or its roots exceed double range.',
      );
    }
  }

  return finalised;
}

export function tfPoles(tf: TransferFunction): Complex[] {
  return polynomialRoots(validateTransferFunction(tf).denominator);
}

export function tfZeros(tf: TransferFunction): Complex[] {
  const numerator = validateTransferFunction(tf).numerator;
  if (numerator.length === 1 && numerator[0] === 0) return [];
  return polynomialRoots(numerator);
}

export type Stability = 'stable' | 'marginal' | 'unstable';

/** Classify from the pole locations, not from a coefficient test. */
export function tfStability(tf: TransferFunction): Stability {
  const poles = tfPoles(tf);
  if (poles.length === 0) return 'stable';
  let marginal = false;
  for (const pole of poles) {
    const tolerance = STABILITY_TOLERANCE * Math.max(1, complexMagnitude(pole));
    if (pole.re > tolerance) return 'unstable';
    if (Math.abs(pole.re) <= tolerance) marginal = true;
  }
  return marginal ? 'marginal' : 'stable';
}

/* ------------------------------------------------------------------ *
 * State space
 * ------------------------------------------------------------------ */

/** Controllable canonical realisation of a proper transfer function. */
export function tfToStateSpace(tf: TransferFunction): StateSpace {
  const valid = validateTransferFunction(tf);
  const numeratorDegree = polynomialDegree(valid.numerator);
  const denominatorDegree = polynomialDegree(valid.denominator);
  if (numeratorDegree > denominatorDegree) {
    throw new Error(
      `Transfer function is improper (numerator degree ${numeratorDegree} > denominator degree ${denominatorDegree}); only proper systems can be simulated.`,
    );
  }
  if (denominatorDegree === 0) {
    return {
      a: [],
      b: [],
      c: [],
      d: valid.numerator[0] / valid.denominator[0],
    };
  }

  const n = denominatorDegree;
  // Monic denominator: divide BOTH polynomials by the leading denominator
  // coefficient. Scaling only the denominator would silently change the gain.
  const leading = valid.denominator[0];
  const monic = valid.denominator.map((value) => value / leading);
  const scaledNumerator = valid.numerator.map((value) => value / leading);
  const paddedNumerator = new Array<number>(n + 1).fill(0);
  for (let i = 0; i < scaledNumerator.length; i += 1) {
    paddedNumerator[n + 1 - scaledNumerator.length + i] = scaledNumerator[i];
  }

  let d = 0;
  let remainder = paddedNumerator;
  if (numeratorDegree === n) {
    d = paddedNumerator[0];
    // Keep the subtraction aligned to n+1 coefficients: trimming its leading
    // zero would silently shift every C entry by one state.
    const subtracted = polyAdd(paddedNumerator, polyScale(monic, -d));
    remainder = new Array<number>(n + 1).fill(0);
    for (let i = 0; i < subtracted.length; i += 1) {
      remainder[n + 1 - subtracted.length + i] = subtracted[i];
    }
  }

  const a = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n - 1; i += 1) a[i][i + 1] = 1;
  for (let i = 0; i < n; i += 1) a[n - 1][i] = -monic[n - i];

  const b = new Array<number>(n).fill(0);
  b[n - 1] = 1;

  const tail = remainder.slice(1); // degree ≤ n−1, descending
  const c = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i += 1) c[i] = tail[n - 1 - i];

  return { a, b, c, d };
}

function assertStateSpace(ss: StateSpace): void {
  const n = ss.b.length;
  if (ss.a.length !== n || ss.c.length !== n) {
    throw new Error(`State-space dimensions disagree: A is ${ss.a.length}×${ss.a[0]?.length ?? 0}, B ${n}, C ${ss.c.length}.`);
  }
  if (!Number.isFinite(ss.d)) throw new Error(`State-space feed-through is not finite (${ss.d}).`);
  for (const row of ss.a) {
    if (row.length !== n) throw new Error('State-space state matrix must be square.');
    for (const value of row) if (!Number.isFinite(value)) throw new Error('State matrix contains a non-finite value.');
  }
  for (const value of ss.b) if (!Number.isFinite(value)) throw new Error('Input vector contains a non-finite value.');
  for (const value of ss.c) if (!Number.isFinite(value)) throw new Error('Output vector contains a non-finite value.');
}

function stateDerivative(ss: StateSpace, state: readonly number[], input: number): number[] {
  const n = state.length;
  const derivative = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    let sum = ss.b[i] * input;
    for (let j = 0; j < n; j += 1) sum += ss.a[i][j] * state[j];
    derivative[i] = sum;
  }
  return derivative;
}

function stateOutput(ss: StateSpace, state: readonly number[], input: number): number {
  let output = ss.d * input;
  for (let i = 0; i < state.length; i += 1) output += ss.c[i] * state[i];
  return output;
}

function rk4StateStep(
  ss: StateSpace,
  time: number,
  state: readonly number[],
  dt: number,
  input: (time: number) => number,
): number[] {
  const k1 = stateDerivative(ss, state, input(time));
  const s2 = state.map((value, i) => value + 0.5 * dt * k1[i]);
  const k2 = stateDerivative(ss, s2, input(time + 0.5 * dt));
  const s3 = state.map((value, i) => value + 0.5 * dt * k2[i]);
  const k3 = stateDerivative(ss, s3, input(time + 0.5 * dt));
  const s4 = state.map((value, i) => value + dt * k3[i]);
  const k4 = stateDerivative(ss, s4, input(time + dt));
  return state.map((value, i) => value + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
}

function assertSimulationOptions(options: SimulationOptions): { steps: number; dt: number } {
  const { tEndSeconds, dtSeconds } = options;
  if (!Number.isFinite(tEndSeconds) || tEndSeconds <= 0) {
    throw new Error(`Simulation end time must be positive and finite (got ${tEndSeconds}).`);
  }
  if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) {
    throw new Error(`Simulation step must be positive and finite (got ${dtSeconds}).`);
  }
  const steps = Math.ceil(tEndSeconds / dtSeconds);
  if (steps > MAX_SAMPLES) {
    throw new Error(
      `Simulation would take ${steps} samples (limit ${MAX_SAMPLES}); increase dt or shorten the run.`,
    );
  }
  return { steps, dt: dtSeconds };
}

/** Simulate `ẋ = Ax + Bu`, `y = Cx + Du` with classical RK4. */
export function simulateStateSpace(
  ss: StateSpace,
  input: (timeSeconds: number) => number,
  options: SimulationOptions,
): SimulationSample[] {
  assertStateSpace(ss);
  const { steps, dt } = assertSimulationOptions(options);
  const n = ss.b.length;
  let state = options.initialState ? [...options.initialState] : new Array<number>(n).fill(0);
  if (state.length !== n) {
    throw new Error(`Initial state has ${state.length} element(s); the system needs ${n}.`);
  }
  for (const value of state) if (!Number.isFinite(value)) throw new Error('Initial state contains a non-finite value.');
  for (let i = 0; i <= steps; i += 1) {
    if (!Number.isFinite(input((i * dt)))) throw new Error('Input function returned a non-finite value.');
  }

  const samples: SimulationSample[] = [];
  let time = 0;
  for (let step = 0; step <= steps; step += 1) {
    samples.push({ timeSeconds: time, output: stateOutput(ss, state, input(time)), state: [...state] });
    if (step === steps) break;
    state = rk4StateStep(ss, time, state, dt, input);
    time = Math.min((step + 1) * dt, options.tEndSeconds);
  }
  return samples;
}

/** Unit step response from rest. */
export function simulateStep(tf: TransferFunction, options: SimulationOptions): SimulationSample[] {
  return simulateStateSpace(tfToStateSpace(tf), () => 1, options);
}

export interface ImpulseResult {
  samples: SimulationSample[];
  /**
   * A proper transfer function with as many zeros as poles has a direct
   * `D·δ(t)` term. Samples cannot represent the Dirac impulse, so it is
   * reported here instead of being faked as one huge sample.
   */
  hasDirectTerm: boolean;
}

/** Unit impulse response; `x(0) = B` produces the state part exactly. */
export function simulateImpulse(tf: TransferFunction, options: SimulationOptions): ImpulseResult {
  const ss = tfToStateSpace(tf);
  return {
    samples: simulateStateSpace(ss, () => 0, { ...options, initialState: [...ss.b] }),
    hasDirectTerm: ss.d !== 0,
  };
}

export function stepResponseMetrics(samples: readonly SimulationSample[]): StepMetrics {
  if (samples.length < 2) {
    return {
      steadyState: samples[0]?.output ?? Number.NaN,
      overshootPct: Number.NaN,
      riseTimeSeconds: Number.NaN,
      settlingTimeSeconds: Number.NaN,
    };
  }
  const final = samples[samples.length - 1].output;
  if (!Number.isFinite(final)) {
    return {
      steadyState: final,
      overshootPct: Number.NaN,
      riseTimeSeconds: Number.NaN,
      settlingTimeSeconds: Number.NaN,
    };
  }
  if (final === 0) {
    return {
      steadyState: 0,
      overshootPct: 0,
      riseTimeSeconds: Number.NaN,
      settlingTimeSeconds: Number.NaN,
    };
  }

  const lowLevel = 0.1 * final;
  const highLevel = 0.9 * final;
  const direction = final >= 0 ? 1 : -1;
  const crosses = (value: number, level: number): boolean => direction * (value - level) >= 0;

  let lowTime = Number.NaN;
  let highTime = Number.NaN;
  for (const sample of samples) {
    if (Number.isNaN(lowTime) && crosses(sample.output, lowLevel)) lowTime = sample.timeSeconds;
    if (Number.isNaN(highTime) && crosses(sample.output, highLevel)) {
      highTime = sample.timeSeconds;
      break;
    }
  }

  let peak = -Infinity;
  for (const sample of samples) peak = Math.max(peak, sample.output * direction);
  const overshootPct = peak > Math.abs(final) ? ((peak - Math.abs(final)) / Math.abs(final)) * 100 : 0;

  const band = 0.02 * Math.abs(final);
  let settlingTime = 0;
  for (const sample of samples) {
    if (Math.abs(sample.output - final) > band) settlingTime = sample.timeSeconds;
  }

  return {
    steadyState: final,
    overshootPct,
    riseTimeSeconds: Number.isNaN(lowTime) || Number.isNaN(highTime) ? Number.NaN : highTime - lowTime,
    settlingTimeSeconds: settlingTime,
  };
}

/* ------------------------------------------------------------------ *
 * Frequency response
 * ------------------------------------------------------------------ */

function assertBodeOptions(options: BodeOptions): number {
  if (!Number.isFinite(options.fMinHz) || options.fMinHz <= 0) {
    throw new Error(`Bode start frequency must be positive (got ${options.fMinHz}).`);
  }
  if (!Number.isFinite(options.fMaxHz) || options.fMaxHz <= options.fMinHz) {
    throw new Error(`Bode end frequency must exceed the start (got ${options.fMaxHz}).`);
  }
  const points = options.points ?? 800;
  if (!Number.isInteger(points) || points < 2 || points > MAX_SAMPLES) {
    throw new Error(`Bode point count must be an integer between 2 and ${MAX_SAMPLES} (got ${points}).`);
  }
  return points;
}

/**
 * Exact count of the factors of `s` in a polynomial given in descending powers:
 * the trailing zero coefficients. Read from the coefficients rather than from the
 * computed roots, because a root finder splits a repeated root at the origin into
 * a tiny pair that no tolerance reliably recognises.
 */
function originFactorCount(coefficients: readonly number[]): number {
  let count = 0
  for (let index = coefficients.length - 1; index >= 0; index -= 1) {
    if (Math.abs(coefficients[index]) >= ROOT_TOLERANCE) return count
    count += 1
  }
  // Every coefficient is zero: an identically zero polynomial has no asymptote.
  return 0
}

/**
 * Degrees to add to the whole unwrapped trace so that its first sample sits on
 * the branch implied by the low-frequency asymptote.
 *
 * `atan2` only ever returns the principal value, and for a loop with two poles at
 * the origin the true −180.01° and the principal +179.99° are the same number
 * seen from opposite sides of the cut — which side the last bit lands on is
 * arbitrary. Continuing from whichever value came out first puts the trace on a
 * branch offset by 360°, and a phase margin read off it is 360° too large: a
 * −41° loop (unstable) would be reported as +319°.
 */
function phaseBranchOffset(tf: TransferFunction, firstPhaseDeg: number): number {
  const asymptoteDeg = 90 * (originFactorCount(tf.numerator) - originFactorCount(tf.denominator))
  if (!Number.isFinite(firstPhaseDeg) || asymptoteDeg === 0) return 0
  return Math.round((asymptoteDeg - firstPhaseDeg) / 360) * 360
}

export function bodeResponse(tf: TransferFunction, options: BodeOptions): BodePoint[] {
  const valid = validateTransferFunction(tf);
  const points = assertBodeOptions(options);
  const logMin = Math.log10(options.fMinHz);
  const logMax = Math.log10(options.fMaxHz);
  const result: BodePoint[] = [];
  let previousPhase = Number.NaN;

  for (let i = 0; i < points; i += 1) {
    const fraction = i / (points - 1);
    const frequencyHz = 10 ** (logMin + fraction * (logMax - logMin));
    const omega = 2 * Math.PI * frequencyHz;
    const response = tfEvaluate(valid, complex(0, omega));
    const magnitude = complexMagnitude(response);
    let phase = complexArgumentDeg(response);
    if (Number.isFinite(previousPhase)) {
      while (phase - previousPhase > 180) phase -= 360;
      while (phase - previousPhase < -180) phase += 360;
    }
    previousPhase = phase;
    result.push({
      frequencyHz,
      omega,
      magnitudeDb: magnitude === 0 ? -Infinity : 20 * Math.log10(magnitude),
      phaseDeg: phase,
    });
  }

  const offset = phaseBranchOffset(valid, result[0]?.phaseDeg ?? Number.NaN);
  return offset === 0 ? result : result.map((point) => ({ ...point, phaseDeg: point.phaseDeg + offset }));
}

export interface MarginOptions extends BodeOptions {
  fMinHz: number;
  fMaxHz: number;
  points?: number;
}

/**
 * Gain and phase margins of the open loop around unity negative feedback.
 * The worst (smallest) margin over all crossings is reported, so a plant with
 * several crossovers cannot look healthier than its weakest one.
 */
export function stabilityMargins(tf: TransferFunction, options: MarginOptions): StabilityMargins {
  const bode = bodeResponse(tf, { ...options, points: options.points ?? 6000 });
  let worstPhaseMargin = Infinity;
  let gainCrossoverHz = Number.NaN;
  let worstGainMargin = Infinity;
  let phaseCrossoverHz = Number.NaN;

  for (let i = 1; i < bode.length; i += 1) {
    const previous = bode[i - 1];
    const current = bode[i];
    if (!Number.isFinite(previous.magnitudeDb) || !Number.isFinite(current.magnitudeDb)) continue;

    if ((previous.magnitudeDb >= 0 && current.magnitudeDb < 0) ||
        (previous.magnitudeDb <= 0 && current.magnitudeDb > 0)) {
      const fraction = previous.magnitudeDb === current.magnitudeDb
        ? 0
        : (0 - previous.magnitudeDb) / (current.magnitudeDb - previous.magnitudeDb);
      const logFrequency = Math.log10(previous.frequencyHz) +
        fraction * (Math.log10(current.frequencyHz) - Math.log10(previous.frequencyHz));
      const phase = previous.phaseDeg + fraction * (current.phaseDeg - previous.phaseDeg);
      const phaseMargin = 180 + phase;
      if (phaseMargin < worstPhaseMargin) {
        worstPhaseMargin = phaseMargin;
        gainCrossoverHz = 10 ** logFrequency;
      }
    }

    const previousOffset = previous.phaseDeg + 180;
    const currentOffset = current.phaseDeg + 180;
    if ((previousOffset >= 0 && currentOffset < 0) || (previousOffset <= 0 && currentOffset > 0)) {
      const fraction = previous.phaseDeg === current.phaseDeg
        ? 0
        : (previous.phaseDeg + 180) / (previous.phaseDeg - current.phaseDeg);
      const logFrequency = Math.log10(previous.frequencyHz) +
        fraction * (Math.log10(current.frequencyHz) - Math.log10(previous.frequencyHz));
      const magnitudeDb = previous.magnitudeDb + fraction * (current.magnitudeDb - previous.magnitudeDb);
      const gainMargin = -magnitudeDb;
      if (gainMargin < worstGainMargin) {
        worstGainMargin = gainMargin;
        phaseCrossoverHz = 10 ** logFrequency;
      }
    }
  }

  return {
    gainMarginDb: worstGainMargin,
    phaseMarginDeg: worstPhaseMargin,
    gainCrossoverHz,
    phaseCrossoverHz,
    closedLoopStable: tfStability(tfFeedback(tf)) === 'stable',
  };
}

/** Positive-frequency Nyquist locus; the negative half is its conjugate. */
export function nyquistResponse(tf: TransferFunction, options: BodeOptions): NyquistPoint[] {
  return bodeResponse(tf, options).map((point) => {
    const response = tfEvaluate(tf, complex(0, point.omega));
    return { frequencyHz: point.frequencyHz, re: response.re, im: response.im };
  });
}

/* ------------------------------------------------------------------ *
 * State-space properties
 * ------------------------------------------------------------------ */

function matrixRank(matrix: readonly (readonly number[])[]): number {
  if (matrix.length === 0) return 0;
  const rows = matrix.length;
  const cols = matrix[0].length;
  const a = matrix.map((row) => [...row]);
  let rank = 0;

  for (let col = 0; col < cols && rank < rows; col += 1) {
    let pivot = rank;
    for (let row = rank + 1; row < rows; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-10) continue;
    [a[rank], a[pivot]] = [a[pivot], a[rank]];
    const scale = a[rank][col];
    for (let c = col; c < cols; c += 1) a[rank][c] /= scale;
    for (let row = 0; row < rows; row += 1) {
      if (row === rank) continue;
      const factor = a[row][col];
      if (factor === 0) continue;
      for (let c = col; c < cols; c += 1) a[row][c] -= factor * a[rank][c];
    }
    rank += 1;
  }
  return rank;
}

/** Controllability matrix `[B AB … Aⁿ⁻¹B]` has full rank. */
export function isControllable(ss: StateSpace): boolean {
  assertStateSpace(ss);
  const n = ss.b.length;
  if (n === 0) return true;
  const matrix: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  let vector = [...ss.b];
  for (let column = 0; column < n; column += 1) {
    for (let row = 0; row < n; row += 1) matrix[row][column] = vector[row];
    const next = new Array<number>(n).fill(0);
    for (let row = 0; row < n; row += 1) {
      for (let k = 0; k < n; k += 1) next[row] += ss.a[row][k] * vector[k];
    }
    vector = next;
  }
  return matrixRank(matrix) === n;
}

/** Observability matrix `[C; CA; …; CAⁿ⁻¹]` has full rank. */
export function isObservable(ss: StateSpace): boolean {
  assertStateSpace(ss);
  const n = ss.b.length;
  if (n === 0) return true;
  const matrix: number[][] = [];
  let vector = [...ss.c];
  for (let block = 0; block < n; block += 1) {
    matrix.push([...vector]);
    const next = new Array<number>(n).fill(0);
    for (let column = 0; column < n; column += 1) {
      for (let row = 0; row < n; row += 1) next[column] += vector[row] * ss.a[row][column];
    }
    vector = next;
  }
  return matrixRank(matrix) === n;
}
