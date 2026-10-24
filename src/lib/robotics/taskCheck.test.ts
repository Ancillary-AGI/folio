import { describe, expect, it } from 'vitest';
import { checkTaskPath, endEffectorPose, interpolateJointAngles, type ChainJoint, type ChainLink } from './taskCheck';

/** Two revolute joints about +Z; the second joint sits 1 m along the first link. */
const joints: ChainJoint[] = [
  {
    id: 'j1',
    type: 'revolute',
    axis: { x: 0, y: 0, z: 1 },
    position: { x: 0, y: 0, z: 0 },
    limits: { min: -Math.PI, max: Math.PI },
  },
  {
    id: 'j2',
    type: 'revolute',
    axis: { x: 0, y: 0, z: 1 },
    position: { x: 1, y: 0, z: 0 },
    limits: { min: -Math.PI, max: Math.PI },
  },
];

const links: ChainLink[] = [
  { id: 'l1', length: 1, mass: 1 },
  { id: 'l2', length: 0.8, mass: 1 },
];

describe('serial end-effector pose', () => {
  it('rotates the tool about the first joint and matches the chain formula', () => {
    const pose = endEffectorPose(joints, [Math.PI / 2, 0]);
    expect(pose.position.x).toBeCloseTo(0, 9);
    expect(pose.position.y).toBeCloseTo(1, 9);
    expect(pose.position.z).toBeCloseTo(0, 9);
  });

  it('reflects a joint offset after the previous rotation', () => {
    // The second joint's 1 m offset is rotated by the first joint.
    const pose = endEffectorPose(joints, [Math.PI, 0]);
    expect(pose.position.x).toBeCloseTo(-1, 9);
    expect(pose.position.y).toBeCloseTo(0, 9);
  });

  it('rejects a non-finite angle rather than returning NaN', () => {
    expect(() => endEffectorPose(joints, [Number.NaN, 0])).toThrow(/non-finite/);
  });
});

describe('joint-space interpolation', () => {
  it('includes both endpoints and is monotonic', () => {
    const path = interpolateJointAngles([0, 0], [1, -1], 5);
    expect(path).toHaveLength(5);
    expect(path[0]).toEqual([0, 0]);
    expect(path[4]).toEqual([1, -1]);
    for (let index = 1; index < path.length; index += 1) {
      expect(path[index][0]).toBeGreaterThan(path[index - 1][0]);
      expect(path[index][1]).toBeLessThan(path[index - 1][1]);
    }
  });

  it('throws when the configurations do not match', () => {
    expect(() => interpolateJointAngles([0], [0, 0], 3)).toThrow(/length/);
    expect(() => interpolateJointAngles([0], [0], 0)).toThrow(/integer/);
  });
});

describe('task-path collision check', () => {
  it('clears an empty scene and reports the travelled tool path', async () => {
    const result = await checkTaskPath({
      joints,
      links,
      startAngles: [0, 0],
      endAngles: [Math.PI / 2, -Math.PI / 2],
      obstacles: [],
      samples: 12,
      durationSeconds: 2,
    });

    expect(result.success).toBe(true);
    expect(result.collisions).toBe(0);
    expect(result.pathLength).toBeGreaterThan(0);
    expect(result.waypoints).toHaveLength(12);
    expect(result.waypoints[0].timestamp).toBe(0);
    expect(result.waypoints[11].timestamp).toBeCloseTo(2, 12);
  });

  it('reports a collision when an obstacle sits on the swept arc', async () => {
    // The tool traces the unit circle; this obstacle sits at 45°.
    const obstacle = {
      position: { x: Math.cos(Math.PI / 4), y: Math.sin(Math.PI / 4), z: 0 },
      size: { x: 0.4, y: 0.4, z: 0.4 },
    };
    const result = await checkTaskPath({
      joints,
      links,
      startAngles: [0, 0],
      endAngles: [Math.PI / 2, 0],
      obstacles: [obstacle],
      samples: 16,
    });

    expect(result.collisions).toBeGreaterThan(0);
    expect(result.success).toBe(false);
  });

  it('rejects a mismatched joint/link count', async () => {
    await expect(
      checkTaskPath({
        joints,
        links: [links[0]],
        startAngles: [0, 0],
        endAngles: [0, 0],
        obstacles: [],
      }),
    ).rejects.toThrow(/one link per joint/);
  });
});
