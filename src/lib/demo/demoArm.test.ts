import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ARM_L1_MM, ARM_L2_MM, buildDemoArm, buildSixDofDemoMechanism } from './demoArm';
import { advancedRobotics } from '../robotics/advancedRobotics';

describe('demo arm — FK + trajectory + gated STEP', () => {
  it('places the tip at (L1+L2, 0) home and (0, L1+L2) folded', () => {
    const demo = buildDemoArm();
    expect(demo.home.position[0] * 1000).toBeCloseTo(ARM_L1_MM + ARM_L2_MM, 6);
    expect(demo.home.position[1] * 1000).toBeCloseTo(0, 6);
    expect(demo.folded.position[0] * 1000).toBeCloseTo(0, 6);
    expect(demo.folded.position[1] * 1000).toBeCloseTo(ARM_L1_MM + ARM_L2_MM, 6);
    expect(demo.reachMm).toBe(ARM_L1_MM + ARM_L2_MM);
  });
  it('times the 90° shoulder sweep within limits (triangular: t = 2√(d/a))', () => {
    const demo = buildDemoArm();
    const d = Math.PI / 2;
    // d <= v²/a (1.5708 <= 0.5625)? No: 1.5708 > 0.5625 → trapezoidal.
    // t = d/v + v/a = 1.5708/1.5 + 1.5/4.
    expect(demo.durationS).toBeCloseTo(d / 1.5 + 1.5 / 4, 9);
    expect(demo.peakVel).toBeCloseTo(1.5, 9);
    expect(demo.samples).toBe(50);
  });
  it('exports STEP through the manufacturability gate', () => {
    const demo = buildDemoArm();
    expect(demo.export.ok).toBe(true);
    if (demo.export.ok) {
      expect(demo.export.step).toContain('folio-demo-arm');
      expect(demo.export.chainLength).toBeCloseTo(ARM_L1_MM + ARM_L2_MM, 6);
    }
    expect(demo.verdict).toMatch(/^PASS/);
  });
});

describe('six-DOF demo arm — articulated chain', () => {
  const home = [0, 0, 0, 0, 0, 0];

  it('stands 0.84 m tall at rest and pitches the tool with the shoulder', () => {
    const mech = buildSixDofDemoMechanism();
    const zero = advancedRobotics.endEffectorPose(mech, home);
    expect(zero).not.toBeNull();
    expect(zero!.position.x).toBeCloseTo(0, 9);
    expect(zero!.position.y).toBeCloseTo(0.84, 9);
    expect(zero!.position.z).toBeCloseTo(0, 9);

    const pitched = advancedRobotics.endEffectorPose(mech, [0, 10 * Math.PI / 180, 0, 0, 0, 0]);
    expect(pitched!.position.y).toBeCloseTo(0.1 + 0.74 * Math.cos(10 * Math.PI / 180), 6);
    expect(pitched!.position.z).toBeCloseTo(0.74 * Math.sin(10 * Math.PI / 180), 6);
  });

  it('solves IK from rest for the panel default target (multi-start fallback)', () => {
    const mech = buildSixDofDemoMechanism();
    const target = new THREE.Vector3(0.5, 0.3, 0.2);
    // A single seed from rest stalls at the elbow stop for this target; the
    // deterministic restarts must find the reachable pose instead of failing.
    const result = advancedRobotics.inverseKinematics(mech, target, undefined, 100, 0.001, home);
    expect(result.success).toBe(true);
    const pose = advancedRobotics.endEffectorPose(mech, result.jointAngles);
    expect(pose!.position.distanceTo(target)).toBeLessThan(0.001);
  });

  it('round-trips FK → IK for reachable poses', () => {
    const mech = buildSixDofDemoMechanism();
    const configs = [
      [1.2, 0.6, -0.8, 0.5, 0, 0.04],
      [3.0, 0.3, -0.1, 0.2, -1.0, 0.0],
      [0.4, -1.3, -2.2, 0.9, 0.7, 0.06],
    ];
    for (const config of configs) {
      const expected = advancedRobotics.endEffectorPose(mech, config);
      expect(expected).not.toBeNull();
      const result = advancedRobotics.inverseKinematics(
        mech, expected!.position.clone(), undefined, 100, 0.001, home,
      );
      expect(result.success).toBe(true);
      const solved = advancedRobotics.endEffectorPose(mech, result.jointAngles);
      expect(solved!.position.distanceTo(expected!.position)).toBeLessThan(0.001);
    }
  });

  it('plans and replays a 15% joint move without false link contacts', () => {
    const mech = buildSixDofDemoMechanism();
    const joints = Array.from(mech.joints.values());
    const target = home.map((angle, index) => {
      const { min, max } = joints[index].limits;
      const span = max - min;
      const margin = span * 0.05;
      const clamp = (value: number) => Math.max(min + margin, Math.min(max - margin, value));
      return clamp(angle + span * 0.15);
    });
    const frames = advancedRobotics.simulateMechanism(
      mech.id, 5, 0.1, { start: home, target, profile: 'quintic' },
    );
    expect(frames).toHaveLength(50);
    frames.forEach((frame) => expect(frame.collisions).toEqual([]));
    expect(frames[frames.length - 1].jointAngles.map((v, i) => Math.abs(v - target[i]) < 1e-9))
      .toEqual([true, true, true, true, true, true]);
  });
});
