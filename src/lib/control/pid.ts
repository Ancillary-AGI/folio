/**
 * PID control design and a discrete controller implementation.
 *
 * Two forms are provided because they answer different questions:
 *
 *   - `pidTransferFunction` / `pidClosedLoop` are continuous-time, used for
 *     step response, Bode margins and stability of the designed loop.
 *   - `pidStep` is a sampled controller with a filtered derivative on the
 *     measurement and conditional-integration anti-windup, used to run the
 *     controller against a plant or a real-time loop.
 *
 * The derivative term is filtered (`kd·s/(τs+1)`) so the controller stays
 * proper; an ideal differentiator would have infinite high-frequency gain and
 * cannot be simulated honestly.
 */

import {
  tfFeedback,
  tfSeries,
  type TransferFunction,
} from './transferFunction'

export interface PidGains {
  kp: number
  ki: number
  kd: number
  /** Derivative low-pass time constant in seconds. Must be > 0. */
  derivativeFilterSeconds?: number
}

export const DEFAULT_DERIVATIVE_FILTER_SECONDS = 0.01

export interface PidLimits {
  minOutput: number
  maxOutput: number
}

export interface DiscretePidState {
  integral: number
  previousMeasurement: number
  derivative: number
}

export interface DiscretePidStep {
  output: number
  error: number
  integral: number
  derivative: number
  saturated: boolean
  state: DiscretePidState
}

function assertGains(gains: PidGains): number {
  for (const [name, value] of [
    ['kp', gains.kp],
    ['ki', gains.ki],
    ['kd', gains.kd],
  ] as const) {
    if (!Number.isFinite(value)) throw new Error(`PID gain ${name} must be finite (got ${value}).`);
  }
  const tau = gains.derivativeFilterSeconds ?? DEFAULT_DERIVATIVE_FILTER_SECONDS;
  if (!Number.isFinite(tau) || tau <= 0) {
    throw new Error(`PID derivative filter time constant must be positive and finite (got ${tau}).`);
  }
  return tau;
}

/**
 * `C(s) = kp + ki/s + kd·s/(τs+1)`, assembled as one rational function:
 * `[(kpτ+kd)s² + (kp+kiτ)s + ki] / [τs² + s]`.
 *
 * The denominator always carries the integrator `s` and the filter `τs+1`. Two
 * structures cancel against it exactly, and the cancellation is done here rather
 * than left in the fraction:
 *
 *   - `kd = 0` — the numerator becomes `(τs+1)(kp·s + ki)`, so the filter pole is
 *     not real: a PI controller is `kp + ki/s`, with one integrator and no lag.
 *   - `kd = 0` *and* `ki = 0` — what is left is the pure gain `kp`.
 *
 * Leaving an uncompensated pole at the origin in a proportional controller would
 * make every downstream reader (pole/zero maps, stability classification,
 * spectral abscissa) report a marginally stable loop that is in fact stable.
 */
export function pidTransferFunction(gains: PidGains): TransferFunction {
  const tau = assertGains(gains);
  if (gains.kd === 0) {
    if (gains.ki === 0) return { numerator: [gains.kp], denominator: [1] };
    return { numerator: [gains.kp, gains.ki], denominator: [1, 0] };
  }
  if (gains.ki === 0) {
    return { numerator: [gains.kp * tau + gains.kd, gains.kp], denominator: [tau, 1] };
  }
  return {
    numerator: [gains.kp * tau + gains.kd, gains.kp + gains.ki * tau, gains.ki],
    denominator: [tau, 1, 0],
  };
}

/** Unit-feedback loop `C·P / (1 + C·P)`. */
export function pidClosedLoop(plant: TransferFunction, gains: PidGains): TransferFunction {
  return tfFeedback(tfSeries(plant, pidTransferFunction(gains)))
}

export function initialPidState(measurement = 0): DiscretePidState {
  if (!Number.isFinite(measurement)) throw new Error(`Initial measurement must be finite (got ${measurement}).`);
  return { integral: 0, previousMeasurement: measurement, derivative: 0 };
}

/**
 * Advance a sampled PID by one period.
 *
 * - The derivative acts on the measurement, not the error, so a setpoint step
 *   does not produce a derivative kick.
 * - The derivative is low-pass filtered with the same τ as the continuous form.
 * - Conditional integration stops the integrator while the output is saturated
 *   and the error would only push it further into the limit.
 */
export function pidStep(
  state: DiscretePidState,
  gains: PidGains,
  setpoint: number,
  measurement: number,
  dtSeconds: number,
  limits?: PidLimits,
): DiscretePidStep {
  const tau = assertGains(gains);
  if (!Number.isFinite(setpoint)) throw new Error(`PID setpoint must be finite (got ${setpoint}).`);
  if (!Number.isFinite(measurement)) throw new Error(`PID measurement must be finite (got ${measurement}).`);
  if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) {
    throw new Error(`PID sample time must be positive and finite (got ${dtSeconds}).`);
  }
  if (limits && (!Number.isFinite(limits.minOutput) || !Number.isFinite(limits.maxOutput) || limits.minOutput > limits.maxOutput)) {
    throw new Error(`PID output limits are invalid (${limits.minOutput} … ${limits.maxOutput}).`);
  }
  for (const [name, value] of Object.entries(state)) {
    if (!Number.isFinite(value)) throw new Error(`PID state ${name} is not finite (${value}).`);
  }

  const error = setpoint - measurement;
  const rawDerivative = (-gains.kd * (measurement - state.previousMeasurement)) / dtSeconds;
  const alpha = tau / (tau + dtSeconds);
  const derivative = alpha * state.derivative + (1 - alpha) * rawDerivative;

  let integral = state.integral + gains.ki * error * dtSeconds;
  let output = gains.kp * error + integral + derivative;
  let saturated = false;

  if (limits) {
    const wouldExceedHigh = output > limits.maxOutput;
    const wouldExceedLow = output < limits.minOutput;
    saturated = wouldExceedHigh || wouldExceedLow;
    if (saturated && (wouldExceedHigh ? error > 0 : error < 0)) {
      // Do not integrate further into the limit.
      integral = state.integral;
      output = gains.kp * error + integral + derivative;
    }
    output = Math.min(limits.maxOutput, Math.max(limits.minOutput, output));
  }

  return {
    output,
    error,
    integral,
    derivative,
    saturated: Boolean(limits) && saturated,
    state: { integral, previousMeasurement: measurement, derivative },
  }
}
