import { describe, expect, it } from 'vitest';
import { jointAngularAcceleration, stepJointDynamics } from './jointDynamics';

const base = {
  axis: 'z' as const,
  linkLength: 1,
  mass: 1,
  limits: { min: -Math.PI, max: Math.PI },
};

describe('joint dynamics', () => {
  it('pulls a displaced joint toward hanging down', () => {
    const acceleration = jointAngularAcceleration({ angle: 0.5, velocity: 0 }, { ...base, damping: 0 });
    expect(acceleration).toBeLessThan(0);
    expect(acceleration).toBeCloseTo(-(9.81 / 0.5) * Math.sin(0.5), 12);
  });

  it('has no gravitational torque about the vertical axis', () => {
    const acceleration = jointAngularAcceleration({ angle: 0.9, velocity: 0 }, { ...base, axis: 'y' });
    expect(acceleration).toBe(0);
  });

  it('keeps a free vertical rotor spinning at constant velocity', () => {
    let state = { angle: 0, velocity: 2 };
    for (let step = 0; step < 1000; step += 1) {
      state = stepJointDynamics(state, 1e-3, { ...base, axis: 'y', damping: 0 });
    }
    expect(state.velocity).toBeCloseTo(2, 9);
    expect(state.angle).toBeCloseTo(2, 6);
  });

  it('dissipates energy with damping', () => {
    let state = { angle: 1, velocity: 0 };
    const options = { ...base, damping: 1.5 };
    for (let step = 0; step < 6000; step += 1) {
      state = stepJointDynamics(state, 1e-3, options);
    }
    expect(Math.abs(state.angle)).toBeLessThan(0.2);
    expect(Math.abs(state.velocity)).toBeLessThan(0.2);
  });

  it('clamps at a joint limit and stops the joint there', () => {
    const state = stepJointDynamics(
      { angle: 0.9, velocity: 100 },
      0.1,
      { ...base, gravity: 0, damping: 0, limits: { min: -1, max: 1 } },
    );
    expect(state.angle).toBe(1);
    expect(state.velocity).toBe(0);
  });

  it('rejects a bad step or non-physical link', () => {
    expect(() => stepJointDynamics({ angle: 0, velocity: 0 }, 0, base)).toThrow(/positive/);
    expect(() => jointAngularAcceleration({ angle: 0, velocity: 0 }, { ...base, mass: 0 })).toThrow(/mass/);
  });
});
