/**
 * The robot library must build mechanisms the kinematics engine actually solves,
 * and the numbers in a dock row must be the numbers the built machine has.
 */
import { describe, expect, it } from 'vitest'
import {
  ROBOT_ARCHITECTURES,
  buildRobotMechanism,
  robotArchitectureById,
} from './robotLibrary'
import { advancedRobotics } from './advancedRobotics'

const DEG = Math.PI / 180

describe('robot library', () => {
  it('builds every architecture with one link per joint', () => {
    for (const architecture of ROBOT_ARCHITECTURES) {
      const mechanism = buildRobotMechanism(architecture)
      expect(mechanism.joints.size).toBe(architecture.joints.length)
      expect(mechanism.links.size).toBe(architecture.joints.length)
      expect(mechanism.dof).toBe(architecture.dof)
    }
  })

  it('keeps the planar arm tip exactly 220 mm out at zero angles', () => {
    const mechanism = buildRobotMechanism(robotArchitectureById('planar-2r-220'))
    const joints = Array.from(mechanism.joints.values())
    const result = advancedRobotics.forwardKinematics(joints, joints.map(() => 0))
    expect(result.success).toBe(true)
    const tip = result.positions.at(-1)
    expect(tip).toBeDefined()
    // Two links along +X, so the last joint origin sits at 120 mm and the tool
    // offset adds the remaining 100 mm.
    expect(tip!.x).toBeCloseTo(0.12, 9)
    const posed = advancedRobotics.endEffectorPose(mechanism, joints.map(() => 0))
    expect(posed).not.toBeNull()
    expect(posed!.position.x).toBeCloseTo(0.22, 9)
  })

  it('honours the travel limits a row advertises', () => {
    const cobot = robotArchitectureById('cobot-6r-850')
    const mechanism = buildRobotMechanism(cobot)
    const shoulder = Array.from(mechanism.joints.values())[1]
    expect(shoulder.limits.min).toBeCloseTo(-180 * DEG, 9)
    expect(shoulder.limits.max).toBeCloseTo(180 * DEG, 9)
  })

  it('refuses an unknown architecture instead of substituting one', () => {
    expect(() => robotArchitectureById('delta-parallel' as never)).toThrow(/Unknown robot architecture/)
  })

  it('rejects a target outside a joint limit rather than clamping silently', () => {
    const gantry = robotArchitectureById('gantry-400')
    const mechanism = buildRobotMechanism(gantry)
    const joints = Array.from(mechanism.joints.values())
    const beyond = joints.map((_, index) => (index === 0 ? 0.45 : 0))
    expect(() =>
      advancedRobotics.simulateMechanism(mechanism.id, 1, 0.05, { target: beyond }),
    ).toThrow(/outside its limits/)
  })
})
