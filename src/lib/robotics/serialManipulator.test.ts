import { describe, expect, it } from 'vitest';
import {
  manipulatorPose,
  planTimedTrajectory,
  profileDistance,
  profileFraction,
  profileVelocity,
  rotationToRollPitchYaw,
  solveManipulatorIk,
  trapezoidalProfile,
} from './serialManipulator';
import { endEffectorPose, translationOf, type DhJoint } from '../mechanical/kinematics';

/** Pure yaw about +Z: `Rz(θ)`. */
function yawMatrix(angle: number): number[] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function planarArm(theta1: number, theta2: number, l1 = 1, l2 = 1): DhJoint[] {
  return [
    { a: l1, alpha: 0, d: 0, theta: theta1, kind: 'revolute' },
    { a: l2, alpha: 0, d: 0, theta: theta2, kind: 'revolute' },
  ];
}

describe('roll-pitch-yaw extraction', () => {
  it('reads a pure yaw rotation back out exactly', () => {
    for (const angle of [0, 0.4, -1.2, 2.9, -3.0]) {
      const { roll, pitch, yaw, gimbalLock } = rotationToRollPitchYaw(yawMatrix(angle));
      expect(roll).toBeCloseTo(0, 12);
      expect(pitch).toBeCloseTo(0, 12);
      expect(yaw).toBeCloseTo(angle, 12);
      expect(gimbalLock).toBe(false);
    }
  });

  it('reads a pure pitch rotation back out exactly', () => {
    const angle = 0.7;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    // Ry(θ): pitch is +θ in the ZYX convention when R20 = -sin θ.
    const matrix = [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1];
    const { roll, pitch, yaw } = rotationToRollPitchYaw(matrix);
    expect(roll).toBeCloseTo(0, 12);
    expect(pitch).toBeCloseTo(angle, 12);
    expect(yaw).toBeCloseTo(0, 12);
  });

  it('reads a pure roll rotation back out exactly', () => {
    const angle = -0.55;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const matrix = [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1];
    const { roll, pitch, yaw } = rotationToRollPitchYaw(matrix);
    expect(roll).toBeCloseTo(angle, 12);
    expect(pitch).toBeCloseTo(0, 12);
    expect(yaw).toBeCloseTo(0, 12);
  });

  it('reports gimbal lock instead of inventing a yaw at pitch ±90°', () => {
    // Ry(+90°) = [0,0,1; 0,1,0; -1,0,0], so R20 = -1 and pitch = asin(1) = +π/2.
    // Every roll/yaw pair describing this pose is equally valid, so yaw is pinned to 0.
    const straight = [0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1];
    const result = rotationToRollPitchYaw(straight);
    expect(result.pitch).toBeCloseTo(Math.PI / 2, 12);
    expect(result.gimbalLock).toBe(true);
    expect(result.roll).toBe(0);
    expect(Number.isFinite(result.yaw)).toBe(true);

    // The mirrored case lands on pitch -π/2 and must also be reported.
    const flipped = [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1];
    const mirrored = rotationToRollPitchYaw(flipped);
    expect(mirrored.pitch).toBeCloseTo(-Math.PI / 2, 12);
    expect(mirrored.gimbalLock).toBe(true);
  });

  it('rejects a matrix that is not a transform', () => {
    expect(() => rotationToRollPitchYaw([1, 2, 3])).toThrow(/16-element/);
  });
});

describe('manipulator pose', () => {
  it('puts a planar arm where the textbook says, with zero roll and pitch', () => {
    const pose = manipulatorPose(planarArm(0.5, -0.3, 1.2, 0.9));
    const expected = [
      1.2 * Math.cos(0.5) + 0.9 * Math.cos(0.2),
      1.2 * Math.sin(0.5) + 0.9 * Math.sin(0.2),
      0,
    ];
    expect(pose.position[0]).toBeCloseTo(expected[0], 12);
    expect(pose.position[1]).toBeCloseTo(expected[1], 12);
    expect(pose.position[2]).toBeCloseTo(0, 12);
    // The old service returned roll: 0, pitch: 0 unconditionally; here it is earned.
    expect(pose.roll).toBeCloseTo(0, 12);
    expect(pose.pitch).toBeCloseTo(0, 12);
    expect(pose.yaw).toBeCloseTo(0.5 + -0.3, 12);
  });

  it('recovers a real twist from a chain, which the old code could not', () => {
    // A 90° twist about the joint's own X is a *roll*, not a pitch — that is exactly
    // what the DH alpha term means. The old service returned roll: 0, pitch: 0 always.
    const chain: DhJoint[] = [
      { a: 1, alpha: Math.PI / 2, d: 0, theta: 0, kind: 'revolute' },
      { a: 0.6, alpha: 0, d: 0, theta: 0, kind: 'revolute' },
    ];
    const pose = manipulatorPose(chain);
    // Both links lie along +X once the twist is applied, so the tip is at 1.6 on X.
    expect(pose.position[0]).toBeCloseTo(1.6, 12);
    expect(pose.position[1]).toBeCloseTo(0, 12);
    expect(pose.position[2]).toBeCloseTo(0, 12);
    expect(pose.roll).toBeCloseTo(Math.PI / 2, 12);
    expect(pose.pitch).toBeCloseTo(0, 12);
    expect(pose.yaw).toBeCloseTo(0, 12);
  });

  it('separates a real yaw from a real roll on a mixed chain', () => {
    // Yaw the first link 30°, then twist 90°: yaw must survive and roll must appear.
    const chain: DhJoint[] = [
      { a: 1, alpha: Math.PI / 2, d: 0, theta: Math.PI / 6, kind: 'revolute' },
      { a: 0.5, alpha: 0, d: 0, theta: 0, kind: 'revolute' },
    ];
    const pose = manipulatorPose(chain);
    expect(pose.yaw).toBeCloseTo(Math.PI / 6, 12);
    expect(pose.roll).toBeCloseTo(Math.PI / 2, 12);
    expect(pose.pitch).toBeCloseTo(0, 12);
  });

  it('refuses to report a pose for an empty chain', () => {
    expect(() => manipulatorPose([])).toThrow(/no end-effector pose/);
  });
});

describe('inverse kinematics through the verified solver', () => {
  it('reaches a target it was built from', () => {
    const chain = planarArm(0, 0, 1.3, 0.9);
    const target = translationOf(endEffectorPose(planarArm(0.6, -0.8, 1.3, 0.9)));
    const result = solveManipulatorIk(chain, target);
    expect(result.converged).toBe(true);
    const reached = translationOf(endEffectorPose(planarArm(result.values[0], result.values[1], 1.3, 0.9)));
    expect(reached[0]).toBeCloseTo(target[0], 8);
    expect(reached[1]).toBeCloseTo(target[1], 8);
  });

  it('reports a residual and refuses to claim convergence when unreachable', () => {
    const result = solveManipulatorIk(planarArm(0, 0, 1, 1), [40, 0, 0], { maxIterations: 30 });
    expect(result.converged).toBe(false);
    expect(result.error).toBeGreaterThan(30);
  });
});

describe('trapezoidal velocity profile', () => {
  it('uses the triangular solution below the v²/a threshold', () => {
    // v = 2, a = 4 → threshold distance is 1 m, so a 0.5 m move never cruises.
    const profile = trapezoidalProfile(0.5, 2, 4);
    expect(profile.triangular).toBe(true);
    expect(profile.cruiseFor).toBe(0);
    expect(profile.peakVelocity).toBeCloseTo(Math.sqrt(4 * 0.5), 12);
    expect(profile.duration).toBeCloseTo(2 * Math.sqrt(0.5 / 4), 12);
  });

  it('uses the trapezoidal solution above the threshold', () => {
    // v = 2, a = 4 → a 5 m move cruises for 5/2 − 2/4 = 2 s.
    const profile = trapezoidalProfile(5, 2, 4);
    expect(profile.triangular).toBe(false);
    expect(profile.accelerateFor).toBeCloseTo(0.5, 12);
    expect(profile.cruiseFor).toBeCloseTo(2, 12);
    expect(profile.peakVelocity).toBeCloseTo(2, 12);
    expect(profile.duration).toBeCloseTo(5 / 2 + 2 / 4, 12);
  });

  it('reconstructs the requested distance from its own phase times', () => {
    for (const [d, v, a] of [
      [0.5, 2, 4],
      [5, 2, 4],
      [12.75, 3.3, 1.7],
    ] as const) {
      expect(profileDistance(trapezoidalProfile(d, v, a))).toBeCloseTo(d, 10);
    }
  });

  it('treats a reverse move identically to a forward one', () => {
    const forward = trapezoidalProfile(4, 2, 4);
    const reverse = trapezoidalProfile(-4, 2, 4);
    expect(reverse.duration).toBeCloseTo(forward.duration, 12);
    expect(reverse.peakVelocity).toBeCloseTo(forward.peakVelocity, 12);
  });

  it('returns an instantaneous profile for a zero-distance move', () => {
    const profile = trapezoidalProfile(0, 2, 4);
    expect(profile.duration).toBe(0);
    expect(profileDistance(profile)).toBe(0);
    expect(profileFraction(profile, 0)).toBe(1);
  });

  it('rejects a non-positive limit', () => {
    expect(() => trapezoidalProfile(1, 0, 1)).toThrow(/maxVelocity/);
    expect(() => trapezoidalProfile(1, 1, 0)).toThrow(/maxAcceleration/);
    expect(() => trapezoidalProfile(Number.NaN, 1, 1)).toThrow(/finite/);
  });
});

describe('profile integration and limits', () => {
  it('walks the fraction monotonically from 0 to 1', () => {
    const profile = trapezoidalProfile(5, 2, 4);
    let previous = -1;
    for (let i = 0; i <= 200; i += 1) {
      const fraction = profileFraction(profile, (profile.duration * i) / 200);
      expect(fraction).toBeGreaterThanOrEqual(previous);
      previous = fraction;
    }
    expect(previous).toBeCloseTo(1, 12);
  });

  it('never exceeds the requested peak velocity or acceleration', () => {
    const profile = trapezoidalProfile(5, 2, 4);
    const steps = 4000;
    const dt = profile.duration / steps;
    let peakSpeed = 0;
    let peakAcceleration = 0;
    let previousSpeed = profileVelocity(profile, 0);
    for (let i = 1; i <= steps; i += 1) {
      const speed = profileVelocity(profile, i * dt);
      peakSpeed = Math.max(peakSpeed, speed);
      peakAcceleration = Math.max(peakAcceleration, Math.abs((speed - previousSpeed) / dt));
      previousSpeed = speed;
    }
    expect(peakSpeed).toBeCloseTo(2, 6);
    expect(peakSpeed).toBeLessThanOrEqual(2 + 1e-12);
    expect(peakAcceleration).toBeLessThanOrEqual(4 + 1e-6);
  });

  it('starts and ends at rest, and stays at rest outside the move', () => {
    const profile = trapezoidalProfile(5, 2, 4);
    expect(profileVelocity(profile, 0)).toBe(0);
    expect(profileVelocity(profile, profile.duration)).toBe(0);
    expect(profileVelocity(profile, -1)).toBe(0);
    expect(profileVelocity(profile, profile.duration + 1)).toBe(0);
  });

  it('clamps an instant outside the move instead of extrapolating', () => {
    const profile = trapezoidalProfile(5, 2, 4);
    expect(profileFraction(profile, -5)).toBe(0);
    expect(profileFraction(profile, 500)).toBe(1);
    expect(() => profileFraction(profile, Number.NaN)).toThrow(/finite/);
  });

  it('agrees between the fraction integral and the distance covered', () => {
    // At the end of the acceleration phase the fraction times the span is ½·v·ta.
    const profile = trapezoidalProfile(5, 2, 4);
    expect(profileFraction(profile, profile.accelerateFor) * 5).toBeCloseTo(0.5 * 2 * 0.5, 12);
  });
});

describe('timed joint trajectory', () => {
  const limits = { maxVelocity: 2, maxAcceleration: 4, samples: 11 };

  it('starts and ends exactly on the requested joint vectors', () => {
    const trajectory = planTimedTrajectory([0, 0], [1, 0.4], limits);
    expect(trajectory.samples[0].values).toEqual([0, 0]);
    expect(trajectory.samples[0].time).toBe(0);
    const last = trajectory.samples[trajectory.samples.length - 1];
    expect(last.values[0]).toBeCloseTo(1, 12);
    expect(last.values[1]).toBeCloseTo(0.4, 12);
    expect(last.fraction).toBeCloseTo(1, 12);
  });

  it('sizes the profile from the most demanding joint, not the average', () => {
    const trajectory = planTimedTrajectory([0, 0], [3, 0.01], limits);
    expect(trajectory.span).toBeCloseTo(3, 12);
    expect(profileDistance(trajectory.profile)).toBeCloseTo(3, 10);
  });

  it('keeps every joint synchronised so none arrives early', () => {
    const trajectory = planTimedTrajectory([0, 0], [3, 0.5], limits);
    for (const sample of trajectory.samples) {
      expect(sample.values[0] / 3).toBeCloseTo(sample.fraction, 10);
      expect(sample.values[1] / 0.5).toBeCloseTo(sample.fraction, 10);
    }
  });

  it('honours the velocity limit on the fastest joint', () => {
    const trajectory = planTimedTrajectory([0], [10], { maxVelocity: 1.5, maxAcceleration: 3 });
    let previous = trajectory.samples[0];
    for (const sample of trajectory.samples.slice(1)) {
      const speed = Math.abs(sample.values[0] - previous.values[0]) / (sample.time - previous.time);
      expect(speed).toBeLessThanOrEqual(1.5 + 1e-9);
      previous = sample;
    }
  });

  it('advances time monotonically across the samples', () => {
    const trajectory = planTimedTrajectory([0, 0], [2, -1], limits);
    for (let i = 1; i < trajectory.samples.length; i += 1) {
      expect(trajectory.samples[i].time).toBeGreaterThan(trajectory.samples[i - 1].time);
    }
  });

  it('validates its inputs', () => {
    expect(() => planTimedTrajectory([0], [0, 0], limits)).toThrow(/same length/);
    expect(() => planTimedTrajectory([], [], limits)).toThrow(/at least one joint/);
    expect(() =>
      planTimedTrajectory([0], [1], { maxVelocity: 1, maxAcceleration: 1, samples: 1 }),
    ).toThrow(/at least 2/);
  });
});
