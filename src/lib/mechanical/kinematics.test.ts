import { describe, expect, it } from 'vitest';
import {
  assertMat4,
  dhTransform,
  endEffectorPose,
  forwardKinematics,
  jacobian,
  mat4Identity,
  mat4InvertRigid,
  mat4Multiply,
  numericalLinearJacobian,
  rotateVector,
  solveIk,
  solveLinearSystem,
  translationOf,
  transformPoint,
  twoLinkIk,
  type DhJoint,
  type Vec3,
} from './kinematics';

/** A planar two-link arm in the X-Y plane, the canonical test case. */
function planarArm(theta1: number, theta2: number, l1 = 1, l2 = 1): DhJoint[] {
  return [
    { a: l1, alpha: 0, d: 0, theta: theta1, kind: 'revolute' },
    { a: l2, alpha: 0, d: 0, theta: theta2, kind: 'revolute' },
  ];
}

/** Textbook forward kinematics, written out independently of the implementation. */
function planarArmTip(theta1: number, theta2: number, l1 = 1, l2 = 1): Vec3 {
  return [
    l1 * Math.cos(theta1) + l2 * Math.cos(theta1 + theta2),
    l1 * Math.sin(theta1) + l2 * Math.sin(theta1 + theta2),
    0,
  ];
}

describe('transform primitives', () => {
  it('treats composition as "apply the right factor first"', () => {
    const shift = mat4Multiply(
      [1, 0, 0, 5, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    );
    expect(transformPoint(shift, [0, 0, 0])).toEqual([5, 0, 0]);
  });

  it('inverts a rigid transform exactly', () => {
    const pose = mat4Multiply(
      [1, 0, 0, 2, 0, 1, 0, 3, 0, 0, 1, 4, 0, 0, 0, 1],
      dhTransform({ a: 0.5, alpha: 0.7, d: 0.3, theta: 1.1, kind: 'revolute' }),
    );
    const round = mat4Multiply(pose, mat4InvertRigid(pose));
    for (let i = 0; i < 16; i += 1) {
      expect(round[i]).toBeCloseTo(mat4Identity()[i], 12);
    }
  });

  it('applies rotation without dragging the origin along', () => {
    const quarter = [0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const rotated = rotateVector(quarter, [1, 0, 0]);
    expect(rotated[0]).toBeCloseTo(0, 12);
    expect(rotated[1]).toBeCloseTo(1, 12);
  });
});

describe('fail-loud guards', () => {
  it('rejects a matrix that is not a transform', () => {
    expect(() => assertMat4([1, 2, 3])).toThrow(/16-element/);
    expect(() => assertMat4([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 4])).toThrow(/Row 3/);
  });

  it('rejects an unknown joint kind instead of guessing a frame', () => {
    expect(() =>
      dhTransform({ a: 1, alpha: 0, d: 0, theta: 0, kind: 'ball' as DhJoint['kind'] }),
    ).toThrow(/Unknown joint kind/);
  });

  it('refuses to solve kinematics for an empty chain', () => {
    expect(() => solveIk([], [0, 0, 0])).toThrow(/empty chain/);
  });

  it('rejects a non-positive IK tolerance', () => {
    const chain = planarArm(0, 0);
    for (const tolerance of [0, -1, Number.NaN]) {
      expect(() => solveIk(chain, [1, 0, 0], { tolerance })).toThrow(/tolerance/);
    }
  });

  it('reports a singular system rather than a fabricated solution', () => {
    expect(() =>
      solveLinearSystem(
        [
          [1, 2],
          [2, 4],
        ],
        [1, 2],
      ),
    ).toThrow(/singular/);
  });
});

describe('forward kinematics', () => {
  it('places a planar two-link arm where the textbook says', () => {
    const cases: [number, number][] = [
      [0, 0],
      [0.3, -0.8],
      [1.1, 2.4],
      [-2.0, 0.5],
    ];
    for (const [t1, t2] of cases) {
      const tip = translationOf(endEffectorPose(planarArm(t1, t2)));
      const expected = planarArmTip(t1, t2);
      expect(tip[0]).toBeCloseTo(expected[0], 12);
      expect(tip[1]).toBeCloseTo(expected[1], 12);
      expect(tip[2]).toBeCloseTo(0, 12);
    }
  });

  it('returns one frame per joint, and nothing for an empty chain', () => {
    expect(forwardKinematics(planarArm(0.2, 0.4))).toHaveLength(2);
    expect(forwardKinematics([])).toEqual([]);
  });

  it('respects link lengths when they differ', () => {
    const arm = planarArm(0.4, 0.9, 1.5, 0.25);
    const tip = translationOf(endEffectorPose(arm));
    const expected = planarArmTip(0.4, 0.9, 1.5, 0.25);
    expect(tip[0]).toBeCloseTo(expected[0], 12);
    expect(tip[1]).toBeCloseTo(expected[1], 12);
  });
});

describe('jacobian', () => {
  it('agrees with a central-difference reference on every column', () => {
    const chain = planarArm(0.45, -1.2, 1.4, 0.8);
    const analytic = jacobian(chain, forwardKinematics(chain)).linear;
    const numeric = numericalLinearJacobian(chain);
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 2; col += 1) {
        expect(analytic[row][col]).toBeCloseTo(numeric[row][col], 6);
      }
    }
  });

  it('agrees with the reference for a three-link chain too', () => {
    const chain: DhJoint[] = [
      { a: 1, alpha: 0, d: 0, theta: 0.2, kind: 'revolute' },
      { a: 0.7, alpha: 0, d: 0, theta: -0.9, kind: 'revolute' },
      { a: 0.4, alpha: 0, d: 0, theta: 1.7, kind: 'revolute' },
    ];
    const analytic = jacobian(chain, forwardKinematics(chain)).linear;
    const numeric = numericalLinearJacobian(chain);
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        expect(analytic[row][col]).toBeCloseTo(numeric[row][col], 6);
      }
    }
  });

  it('rejects a frame count that does not match the joint count', () => {
    expect(() => jacobian(planarArm(0, 0), forwardKinematics(planarArm(0, 0)).slice(0, 1))).toThrow(
      /Frame count/,
    );
  });
});

describe('inverse kinematics', () => {
  it('round-trips a reachable target back to its joint angles', () => {
    const l1 = 1.2;
    const l2 = 0.9;
    const target = translationOf(endEffectorPose(planarArm(0.6, -0.7, l1, l2)));
    const result = solveIk(planarArm(0.1, 0.1, l1, l2), target);
    expect(result.converged).toBe(true);
    expect(result.error).toBeLessThan(1e-8);
    const reached = translationOf(endEffectorPose(planarArm(result.values[0], result.values[1], l1, l2)));
    expect(reached[0]).toBeCloseTo(target[0], 8);
    expect(reached[1]).toBeCloseTo(target[1], 8);
  });

  it('reports the residual it reached instead of claiming success', () => {
    // The target sits far outside the arm's reach, so no honest solver converges.
    const result = solveIk(planarArm(0.2, 0.2, 1, 1), [50, 0, 0], { maxIterations: 40 });
    expect(result.converged).toBe(false);
    expect(result.iterations).toBe(40);
    expect(result.error).toBeGreaterThan(40);
  });

  it('projects every iterate into the supplied joint limits', () => {
    // One revolute joint can only reach (0, 1, 0) at a quarter turn; a 0.1 rad
    // stop makes that unreachable, and the solver must say so rather than
    // returning 1.57 rad.
    const chain: DhJoint[] = [{ a: 1, alpha: 0, d: 0, theta: 0, kind: 'revolute' }];
    const result = solveIk(chain, [0, 1, 0], { limits: [{ min: 0, max: 0.1 }] });
    expect(result.values[0]).toBeCloseTo(0.1, 12);
    expect(result.converged).toBe(false);
    expect(result.error).toBeGreaterThan(0.5);
  });

  it('finds a reachable solution that respects asymmetric limits', () => {
    const target = translationOf(endEffectorPose(planarArm(0.5, 0.8)));
    const result = solveIk(planarArm(0, 0), target, {
      limits: [{ min: 0, max: 1.5 }, { min: 0, max: 1.5 }],
    });
    expect(result.converged).toBe(true);
    expect(result.values[0]).toBeGreaterThanOrEqual(0);
    expect(result.values[0]).toBeLessThanOrEqual(1.5);
    expect(result.values[1]).toBeGreaterThanOrEqual(0);
    expect(result.values[1]).toBeLessThanOrEqual(1.5);
  });

  it('rejects malformed limits instead of silently ignoring them', () => {
    expect(() =>
      solveIk(planarArm(0, 0), [1, 0, 0], { limits: [{ min: 0, max: 1 }] }),
    ).toThrow(/match the chain length/);
    expect(() =>
      solveIk(planarArm(0, 0), [1, 0, 0], {
        limits: [{ min: 1, max: 0 }, { min: 0, max: 1 }],
      }),
    ).toThrow(/invalid/);
  });
});

describe('closed-form two-link solution', () => {
  it('recovers the elbow-up angles it was built from', () => {
    const l1 = 1.3;
    const l2 = 0.8;
    const shoulder = -0.4;
    const elbow = 1.05;
    const tip = planarArmTip(shoulder, elbow, l1, l2);
    const solution = twoLinkIk(tip[0], tip[1], l1, l2);
    expect(solution.reachable).toBe(true);
    expect(solution.elbowUp.shoulder).toBeCloseTo(shoulder, 10);
    expect(solution.elbowUp.elbow).toBeCloseTo(elbow, 10);
  });

  it('recovers the elbow-down angles too', () => {
    const l1 = 1.3;
    const l2 = 0.8;
    const shoulder = 0.55;
    const elbow = -1.05;
    const tip = planarArmTip(shoulder, elbow, l1, l2);
    const solution = twoLinkIk(tip[0], tip[1], l1, l2);
    expect(solution.reachable).toBe(true);
    expect(solution.elbowDown.shoulder).toBeCloseTo(shoulder, 10);
    expect(solution.elbowDown.elbow).toBeCloseTo(elbow, 10);
  });

  it('puts both solved branches back on the original target', () => {
    const l1 = 2;
    const l2 = 1.5;
    const target = planarArmTip(-0.9, 1.4, l1, l2);
    const { elbowUp, elbowDown, reachable } = twoLinkIk(target[0], target[1], l1, l2);
    expect(reachable).toBe(true);
    for (const branch of [elbowUp, elbowDown]) {
      const rebuilt = planarArmTip(branch.shoulder, branch.elbow, l1, l2);
      expect(rebuilt[0]).toBeCloseTo(target[0], 10);
      expect(rebuilt[1]).toBeCloseTo(target[1], 10);
    }
  });

  it('mirrors the two branches about the shoulder-to-target line', () => {
    const solution = twoLinkIk(1.4, 0.6, 1.2, 0.9);
    expect(solution.elbowUp.elbow).toBeCloseTo(-solution.elbowDown.elbow, 12);
    const phi = Math.atan2(0.6, 1.4);
    const midpoint = (solution.elbowUp.shoulder + solution.elbowDown.shoulder) / 2;
    expect(midpoint).toBeCloseTo(phi, 12);
  });

  it('declares an out-of-reach target unreachable with NaN angles', () => {
    const far = twoLinkIk(10, 0, 1, 1);
    expect(far.reachable).toBe(false);
    expect(Number.isNaN(far.elbowUp.shoulder)).toBe(true);
    expect(Number.isNaN(far.elbowDown.shoulder)).toBe(true);
    // A 1 m arm cannot fold inside a 2 m arm's stub, so 0.05 m is out of reach too.
    const folded = twoLinkIk(0.05, 0, 1, 2);
    expect(folded.reachable).toBe(false);
    expect(Number.isNaN(folded.elbowDown.elbow)).toBe(true);
  });

  it('rejects a non-positive link length', () => {
    expect(() => twoLinkIk(0.5, 0.5, 0, 1)).toThrow(/positive/);
  });

  it('folds equal links onto the shoulder without returning NaN', () => {
    const solution = twoLinkIk(0, 0, 1, 1);
    expect(solution.reachable).toBe(true);
    for (const branch of [solution.elbowUp, solution.elbowDown]) {
      expect(Number.isFinite(branch.shoulder)).toBe(true);
      expect(Number.isFinite(branch.elbow)).toBe(true);
      const tip = planarArmTip(branch.shoulder, branch.elbow, 1, 1);
      expect(tip[0]).toBeCloseTo(0, 12);
      expect(tip[1]).toBeCloseTo(0, 12);
    }
  });

  it('rejects a non-finite target', () => {
    expect(() => twoLinkIk(Number.NaN, 0, 1, 1)).toThrow(/finite/);
    expect(() => twoLinkIk(0, Number.POSITIVE_INFINITY, 1, 1)).toThrow(/finite/);
  });
});

describe('dense linear solve', () => {
  it('solves a small system with a checkable answer', () => {
    const x = solveLinearSystem(
      [
        [2, 1],
        [1, 3],
      ],
      [5, 10],
    );
    // 2x + y = 5 and x + 3y = 10 give x = 1, y = 3.
    expect(x[0]).toBeCloseTo(1, 12);
    expect(x[1]).toBeCloseTo(3, 12);
  });

  it('pivots when the leading entry is zero', () => {
    const x = solveLinearSystem(
      [
        [0, 1],
        [1, 0],
      ],
      [4, 7],
    );
    expect(x[0]).toBeCloseTo(7, 12);
    expect(x[1]).toBeCloseTo(4, 12);
  });

  it('rejects a matrix and vector of different sizes', () => {
    expect(() => solveLinearSystem([[1, 0]], [1, 2])).toThrow(/disagree/);
  });
});
