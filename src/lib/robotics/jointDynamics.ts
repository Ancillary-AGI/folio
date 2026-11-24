/**
 * Single-joint dynamics for the interactive arm simulation.
 *
 * Each joint is advanced as a physical pendulum about its own axis:
 *
 *   θ̈ = −(g / r)·sin θ − b·θ̇ + τ / (m·r²)
 *
 * with `r` the centre-of-mass distance (`length/2`) and `b` a viscous damping
 * coefficient. A joint that rotates about the vertical (`y`) axis has no
 * gravitational torque — spinning a link about the world's up axis does not
 * raise or lower it — which is why `axis: 'y'` yields a free rotor.
 *
 * The state is advanced with the verified symplectic Euler integrator from
 * `timeIntegration`, so long swings keep their energy instead of drifting.
 * This is deliberately a per-joint model, not a coupled multibody solve; the
 * UI labels it as such.
 */

import { symplecticEulerStep } from './timeIntegration';

export type JointAxis = 'x' | 'y' | 'z';

export interface JointDynamicState {
  angle: number;
  velocity: number;
}

export interface JointDynamicsOptions {
  axis: JointAxis;
  /** Link length, metres. */
  linkLength: number;
  /** Link mass, kilograms. */
  mass: number;
  limits: { min: number; max: number };
  /** Gravitational acceleration, m/s². */
  gravity?: number;
  /** Viscous damping coefficient, 1/s. */
  damping?: number;
  /** Applied joint torque, N·m. */
  torque?: number;
}

/** Angular acceleration for the joint's current state. */
export function jointAngularAcceleration(
  state: JointDynamicState,
  options: JointDynamicsOptions,
): number {
  if (!Number.isFinite(state.angle) || !Number.isFinite(state.velocity)) {
    throw new Error('Joint dynamics state must be finite.');
  }
  if (!(options.linkLength > 0)) throw new Error('Joint dynamics needs a positive link length.');
  if (!(options.mass > 0)) throw new Error('Joint dynamics needs a positive link mass.');

  const lever = options.linkLength / 2;
  const gravity = options.gravity ?? 9.81;
  const damping = options.damping ?? 0.6;
  // A vertical rotation axis cannot lift the link, so gravity exerts no torque.
  const gravityAcceleration = options.axis === 'y' ? 0 : -(gravity / lever) * Math.sin(state.angle);
  const inertialTorque = (options.torque ?? 0) / (options.mass * lever * lever);
  return gravityAcceleration - damping * state.velocity + inertialTorque;
}

/** Advance one joint by `dt`, clamping at its limits (and stopping there). */
export function stepJointDynamics(
  state: JointDynamicState,
  dt: number,
  options: JointDynamicsOptions,
): JointDynamicState {
  if (!(dt > 0) || !Number.isFinite(dt)) {
    throw new Error(`Joint dynamics step must be positive and finite, got ${dt}.`);
  }
  const advanced = symplecticEulerStep(
    (_time, position, velocity) =>
      [jointAngularAcceleration({ angle: position[0], velocity: velocity[0] }, options)],
    0,
    [state.angle],
    [state.velocity],
    dt,
  );

  let angle = advanced.position[0];
  let velocity = advanced.velocity[0];
  if (angle < options.limits.min) {
    angle = options.limits.min;
    velocity = 0;
  } else if (angle > options.limits.max) {
    angle = options.limits.max;
    velocity = 0;
  }
  return { angle, velocity };
}
