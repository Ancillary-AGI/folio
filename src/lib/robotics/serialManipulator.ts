/**
 * Serial-manipulator kinematics and trajectory generation.
 *
 * The robotics service layer previously carried a hand-rolled "simplified" forward
 * kinematics that assumed every mechanism was a planar two-link arm — it accumulated
 * `link.length * cos(Σθ)` and returned `roll: 0, pitch: 0` unconditionally — and an
 * inverse kinematics that assigned the *same* angle to every joint while never
 * returning `null` despite declaring it could. Neither is kinematics.
 *
 * This module replaces both with the verified primitives from `../mechanical/kinematics`
 * — Denavit-Hartenberg chains, the analytic geometric Jacobian, damped-least-squares
 * inverse kinematics — and adds what a real motion controller needs on top: orientation
 * recovered from the actual rotation matrix, and time-parameterised trajectories under
 * velocity and acceleration limits.
 *
 * Conventions
 * -----------
 * - Joint angles are **radians** here; the service layer converts from degrees.
 * - Orientation is roll-pitch-yaw in the ZYX convention, `R = Rz(yaw)·Ry(pitch)·Rx(roll)`.
 * - Trajectories are time-parameterised, not shape-parameterised: every sample carries
 *   the instant it happens, so velocity and acceleration limits are actually honoured.
 *
 * Nothing invents an answer. An unreachable target reports the residual it reached; a
 * move whose limits cannot be met says so instead of silently overshooting.
 */

import {
  assertMat4,
  forwardKinematics,
  solveIk,
  translationOf,
  type DhJoint,
  type IkOptions,
  type Vec3,
} from '../mechanical/kinematics';

/** Position and ZYX roll-pitch-yaw orientation, radians. */
export interface Pose {
  position: Vec3;
  roll: number;
  pitch: number;
  yaw: number;
}

/**
 * Roll-pitch-yaw from a rigid transform's rotation block, ZYX convention:
 * `pitch = asin(-R20)`, `roll = atan2(R21, R22)`, `yaw = atan2(R10, R00)`.
 *
 * At `|R20| → 1` the pitch reaches ±90° and roll and yaw describe the same rotation, so
 * roll is pinned to zero. The remaining rotation is then a pure yaw,
 * `Rz(ψ)Ry(±90°)Rx(φ) = Rz(ψ ∓ φ)Ry(±90°)`, which is read from the first row of the
 * matrix (`atan2(-R01, R11)`); the ordinary yaw formula would divide zero by zero at
 * the singularity and discard the orientation. That is reported through `gimbalLock`
 * rather than silently returning a plausible-looking pair.
 */
export function rotationToRollPitchYaw(matrix: readonly number[]): {
  roll: number;
  pitch: number;
  yaw: number;
  gimbalLock: boolean;
} {
  assertMat4(matrix);
  const r20 = matrix[8];
  const clamp = (v: number): number => Math.min(1, Math.max(-1, v));
  const pitch = Math.asin(clamp(-r20));
  if (Math.abs(Math.abs(r20) - 1) < 1e-9) {
    return { roll: 0, pitch, yaw: Math.atan2(-matrix[1], matrix[5]), gimbalLock: true };
  }
  return {
    roll: Math.atan2(matrix[9], matrix[10]),
    pitch,
    yaw: Math.atan2(matrix[4], matrix[0]),
    gimbalLock: false,
  };
}

/** End-effector pose of a chain: tip position plus the recovered orientation. */
export function manipulatorPose(chain: readonly DhJoint[]): Pose {
  const frames = forwardKinematics(chain);
  if (frames.length === 0) throw new Error('An empty chain has no end-effector pose.');
  const tip = frames[frames.length - 1];
  const { roll, pitch, yaw } = rotationToRollPitchYaw(tip);
  return { position: translationOf(tip), roll, pitch, yaw };
}

/**
 * Joint values placing the tip at `target`, via the verified damped-least-squares
 * solver. Position only: a general six-degree-of-freedom pose is not solvable by a
 * position-only iteration, and claiming otherwise would be a lie.
 */
export function solveManipulatorIk(
  chain: readonly DhJoint[],
  target: Vec3,
  options: IkOptions = {},
): { values: number[]; error: number; converged: boolean } {
  const result = solveIk(chain, target, options);
  return { values: result.values, error: result.error, converged: result.converged };
}

/* ------------------------------------------------------------------ *
 * Time-parameterised trajectories
 * ------------------------------------------------------------------ */

export interface VelocityProfile {
  /** Total duration of the move. */
  duration: number;
  /** Peak velocity actually reached; `√(a·d)` in the triangular case. */
  peakVelocity: number;
  /** Time spent accelerating. */
  accelerateFor: number;
  /** Time spent at the peak; zero for a triangular profile. */
  cruiseFor: number;
  /** True when the move never reaches `maxVelocity`, so there is no cruise phase. */
  triangular: boolean;
}

/**
 * Trapezoidal velocity profile over a distance `d`, the standard three-phase motion.
 *
 * - Triangular (`d ≤ v²/a`): the peak is `√(a·d)` and `t = 2√(d/a)`.
 * - Trapezoidal otherwise: `t = d/v + v/a`.
 *
 * `d` may be negative for a reverse move; only its magnitude drives the profile.
 */
export function trapezoidalProfile(
  distance: number,
  maxVelocity: number,
  maxAcceleration: number,
): VelocityProfile {
  if (!Number.isFinite(distance)) throw new Error(`Distance must be finite, got ${distance}.`);
  if (!Number.isFinite(maxVelocity) || !(maxVelocity > 0)) {
    throw new Error(`maxVelocity must be positive and finite, got ${maxVelocity}.`);
  }
  if (!Number.isFinite(maxAcceleration) || !(maxAcceleration > 0)) {
    throw new Error(`maxAcceleration must be positive and finite, got ${maxAcceleration}.`);
  }
  const d = Math.abs(distance);
  if (d === 0) {
    return { duration: 0, peakVelocity: 0, accelerateFor: 0, cruiseFor: 0, triangular: true };
  }
  if (d <= (maxVelocity * maxVelocity) / maxAcceleration) {
    const peak = Math.sqrt(maxAcceleration * d);
    const accelerateFor = peak / maxAcceleration;
    return {
      duration: 2 * accelerateFor,
      peakVelocity: peak,
      accelerateFor,
      cruiseFor: 0,
      triangular: true,
    };
  }
  const accelerateFor = maxVelocity / maxAcceleration;
  const cruiseFor = d / maxVelocity - accelerateFor;
  return {
    duration: 2 * accelerateFor + cruiseFor,
    peakVelocity: maxVelocity,
    accelerateFor,
    cruiseFor,
    triangular: false,
  };
}

/** Distance a profile covers, reconstructed from its own phase times. */
export function profileDistance(profile: VelocityProfile): number {
  const { duration, accelerateFor: ta, cruiseFor: tc, peakVelocity: v } = profile;
  const decelerateFor = duration - ta - tc;
  return 0.5 * v * ta + v * tc + 0.5 * v * decelerateFor;
}

/**
 * Fraction of the total distance covered by instant `t`, in `[0, 1]`, integrating the
 * piecewise-constant acceleration of each phase. Clamped at both ends so an instant
 * outside the move cannot extrapolate past its end.
 */
export function profileFraction(profile: VelocityProfile, t: number): number {
  if (!Number.isFinite(t)) throw new Error(`Time must be finite, got ${t}.`);
  const distance = profileDistance(profile);
  if (distance === 0) return 1;
  if (t <= 0) return 0;
  if (t >= profile.duration) return 1;
  const { accelerateFor: ta, cruiseFor: tc, peakVelocity: v, duration } = profile;
  let covered: number;
  if (t <= ta) {
    // Accelerating from rest at a = v/ta.
    covered = 0.5 * (v / ta) * t * t;
  } else if (t <= ta + tc) {
    covered = 0.5 * v * ta + v * (t - ta);
  } else {
    // Decelerating at a = v/td to rest at `duration`.
    const td = duration - ta - tc;
    const into = t - ta - tc;
    covered = 0.5 * v * ta + v * tc + v * into - 0.5 * (v / td) * into * into;
  }
  return covered / distance;
}

/** Instantaneous speed at `t`, in distance units per time unit. */
export function profileVelocity(profile: VelocityProfile, t: number): number {
  if (!Number.isFinite(t)) throw new Error(`Time must be finite, got ${t}.`);
  if (profile.duration === 0 || t <= 0 || t >= profile.duration) return 0;
  const { accelerateFor: ta, cruiseFor: tc, peakVelocity: v, duration } = profile;
  if (t <= ta) return (v / ta) * t;
  if (t <= ta + tc) return v;
  const td = duration - ta - tc;
  return v - (v / td) * (t - ta - tc);
}

export interface TrajectorySample {
  /** Instant of this sample, in the profile's time unit. */
  time: number;
  /** Fraction of the move completed, in `[0, 1]`. */
  fraction: number;
  /** Joint values interpolated between `start` and `end`. */
  values: number[];
}

export interface TimedTrajectory {
  samples: TrajectorySample[];
  profile: VelocityProfile;
  /** Largest joint travel in the move, the quantity the profile was sized from. */
  span: number;
}

/**
 * Time-parameterised joint trajectory between two joint vectors. The most demanding
 * joint's travel sizes one shared velocity profile, and every joint follows it, which
 * is what keeps a multi-joint move synchronised rather than letting the short joint
 * arrive early.
 */
export function planTimedTrajectory(
  start: readonly number[],
  end: readonly number[],
  limits: { maxVelocity: number; maxAcceleration: number; samples?: number },
): TimedTrajectory {
  if (start.length !== end.length) throw new Error('Start and end must have the same length.');
  if (start.length === 0) throw new Error('A trajectory needs at least one joint.');
  const sampleCount = limits.samples ?? 50;
  // An infinite or fractional count would loop forever or emit mis-spaced samples.
  if (!Number.isInteger(sampleCount) || sampleCount < 2) {
    throw new Error(`samples must be an integer of at least 2, got ${sampleCount}.`);
  }

  let span = 0;
  for (let i = 0; i < start.length; i += 1) {
    if (!Number.isFinite(start[i]) || !Number.isFinite(end[i])) {
      throw new Error(`Joint ${i} has a non-finite start or end value.`);
    }
    span = Math.max(span, Math.abs(end[i] - start[i]));
  }
  const profile = trapezoidalProfile(span, limits.maxVelocity, limits.maxAcceleration);
  const samples: TrajectorySample[] = [];
  for (let i = 0; i < sampleCount; i += 1) {
    const time = (profile.duration * i) / (sampleCount - 1);
    const fraction = profileFraction(profile, time);
    samples.push({
      time,
      fraction,
      values: start.map((s, j) => s + (end[j] - s) * fraction),
    });
  }
  return { samples, profile, span };
}

