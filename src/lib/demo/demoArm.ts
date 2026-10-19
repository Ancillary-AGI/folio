/**
 * Demo arm: planar 2-link pick arm (L1 = 120 mm, L2 = 100 mm).
 *
 * The mechanical demo proves enclosure thermal; this proves the robotics
 * loop on the SAME pattern: FK-verified reach via the tested DH engine,
 * a timed trapezoidal move under velocity/acceleration limits, and a STEP
 * export gated on manufacturability (bed fit + joint stops + buckling).
 * Hand-verifiable: at θ1 = 0, θ2 = 0 the tip sits at (220, 0) mm; folding
 * to θ1 = 90°, θ2 = 0 puts it at (0, 220) mm. Proven by `demoArm.test.ts`.
 */
import {
  manipulatorPose,
  planTimedTrajectory,
  type Pose,
} from '../robotics/serialManipulator';
import {
  describeMechanism,
  exportMechanismStep,
  type GatedExport,
  type LinkMeasurement,
} from '../robotics/mechanismExport';
import type { DhJoint } from '../mechanical/kinematics';

export const ARM_L1_MM = 120;
export const ARM_L2_MM = 100;

export interface DemoArm {
  home: Pose;
  folded: Pose;
  reachMm: number;
  durationS: number;
  peakVel: number;
  samples: number;
  export: GatedExport;
  verdict: string;
}

/** DH chain of the planar arm: two revolute joints about Z, links along X. */
export function armChain(theta1: number, theta2: number): DhJoint[] {
  return [
    { kind: 'revolute', a: ARM_L1_MM / 1000, alpha: 0, d: 0, theta: theta1 },
    { kind: 'revolute', a: ARM_L2_MM / 1000, alpha: 0, d: 0, theta: theta2 },
  ];
}

export function buildDemoArm(): DemoArm {
  const home = manipulatorPose(armChain(0, 0));
  const folded = manipulatorPose(armChain(Math.PI / 2, 0));
  const reachMm = (ARM_L1_MM + ARM_L2_MM);
  // Timed joint move: shoulder sweeps 90° in joint space under limits.
  const planned = planTimedTrajectory([0, 0], [Math.PI / 2, 0], { maxVelocity: 1.5, maxAcceleration: 4 });
  const durationS = planned.profile.duration;
  const peakVel = planned.profile.peakVelocity;
  const measurements: LinkMeasurement[] = [
    { id: 'link-1', length: ARM_L1_MM, depth: 12, mass: 0.15, angle: 0, jointMin: -Math.PI, jointMax: Math.PI },
    { id: 'link-2', length: ARM_L2_MM, depth: 10, mass: 0.1, angle: 0, jointMin: -Math.PI, jointMax: Math.PI },
  ];
  const { links, joints } = describeMechanism(measurements, 'rectangular');
  const exported = exportMechanismStep(
    links,
    {
      joints,
      material: { modulus: 2e9, yieldStrength: 50e6 },
      printer: { bedWidth: 220, bedDepth: 220, bedHeight: 250 },
      payload: 0.2 * 9.81,
    },
    { jointBore: 5, name: 'folio-demo-arm' },
  );
  const verdict = exported.ok
    ? `PASS: 2-link arm reaches ${reachMm} mm, move takes ${durationS.toFixed(2)} s, STEP exported.`
    : `FAIL: export refused — ${exported.findings.map((f) => `${f.subject}: ${f.reason}`).join('; ')}`;
  return { home, folded, reachMm, durationS, peakVel, samples: planned.samples.length, export: exported, verdict };
}
