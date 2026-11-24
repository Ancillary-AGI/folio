/**
 * Machine-precision audit of every data catalog the CAD ships.
 *
 * The symbol library is audited in symbolIntegrity.test.ts; this file does the
 * same for the physical and engineering catalogs — materials, machines, robots,
 * truss presets and the power-flow solver. An out-of-range datum that reaches
 * a solver silently corrupts every downstream result, so the catalogs are
 * checked here, in CI, on every push.
 */
import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { MATERIALS } from './mechanical/materials'
import { STANDARD_MACHINES, machineByPartNumber, shaftPowerW } from './electronics/machines'
import { ROBOT_ARCHITECTURES, boxInertiaMatrix, robotArchitectureById } from './robotics/robotLibrary'
import { TRUSS_PRESETS } from './structures/trussPresets'
import { solveTruss } from './structures/truss'
import { solvePowerFlow } from './power/loadFlow'

describe('materials catalog', () => {
  const entries = Object.entries(MATERIALS)

  it('has a real library (at least the structural steels and aluminium)', () => {
    expect(entries.length).toBeGreaterThanOrEqual(8)
    const names = entries.map(([, material]) => material.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('keeps every material inside physical ranges', () => {
    for (const [key, material] of entries) {
      expect(material.density, `${key}: density`).toBeGreaterThan(200)
      expect(material.density, `${key}: density`).toBeLessThan(25_000)
      expect(material.youngsModulus, `${key}: E`).toBeGreaterThanOrEqual(1e8)
      expect(material.youngsModulus, `${key}: E`).toBeLessThan(2e12)
      expect(material.poissonRatio, `${key}: nu`).toBeGreaterThanOrEqual(0)
      expect(material.poissonRatio, `${key}: nu`).toBeLessThan(0.5)
      expect(material.yieldStrength, `${key}: yield`).toBeGreaterThan(0)
      expect(material.ultimateStrength, `${key}: ultimate`).toBeGreaterThanOrEqual(material.yieldStrength)
      expect(material.thermalConductivity, `${key}: k`).toBeGreaterThan(0)
      expect(material.thermalConductivity, `${key}: k`).toBeLessThan(2_000)
      expect(material.specificHeat, `${key}: cp`).toBeGreaterThan(0)
      expect(material.specificHeat, `${key}: cp`).toBeLessThan(5_000)
    }
  })

  it('pins the anchors every other model assumes (aluminium and structural steel)', () => {
    expect(MATERIALS.aluminum.density).toBe(2700)
    expect(MATERIALS.steel.density).toBe(7850)
    expect(MATERIALS.steel.youngsModulus).toBeGreaterThanOrEqual(200e9)
  })
})

describe('machines catalog', () => {
  it('has unique ids and part numbers', () => {
    const ids = STANDARD_MACHINES.map((machine) => machine.id)
    expect(new Set(ids).size).toBe(ids.length)
    const partNumbers = STANDARD_MACHINES.map((machine) => machine.partNumber)
    expect(new Set(partNumbers).size).toBe(partNumbers.length)
  })

  it('keeps ratings positive and speeds finite', () => {
    for (const machine of STANDARD_MACHINES) {
      expect(machine.ratedVoltageV, machine.id).toBeGreaterThan(0)
      expect(machine.ratedCurrentA, machine.id).toBeGreaterThan(0)
      expect(Number.isFinite(machine.speedRpm), machine.id).toBe(true)
      expect(machine.speedRpm, machine.id).toBeGreaterThanOrEqual(0)
      expect(machine.windingOhms, machine.id).toBeGreaterThan(0)
      expect(Number.isFinite(machine.torqueNm), machine.id).toBe(true)
      expect(machine.torqueNm, machine.id).toBeGreaterThanOrEqual(0)
      expect(machine.description.trim().length, machine.id).toBeGreaterThan(10)
    }
  })

  it('resolves by part number exactly as printed on the datasheet', () => {
    for (const machine of STANDARD_MACHINES) {
      expect(machineByPartNumber(machine.partNumber).id).toBe(machine.id)
    }
    expect(() => machineByPartNumber('NOT-A-REAL-PART')).toThrow()
  })

  it('computes shaft power from torque and speed, not from a lookup', () => {
    // P = tau * omega. 1 N·m at 60 RPM is exactly 2π W.
    expect(shaftPowerW(1, 60)).toBeCloseTo(2 * Math.PI, 9)
    expect(shaftPowerW(2.5, 1500)).toBeCloseTo(2.5 * ((1500 * 2 * Math.PI) / 60), 9)
  })

  it('rates transformers on VA with a positive turns ratio and positive secondaries', () => {
    for (const machine of STANDARD_MACHINES.filter((entry) => entry.family === 'transformer')) {
      expect(machine.vaRating, machine.id).toBeGreaterThan(0)
      expect(machine.turnsRatio, machine.id).toBeGreaterThan(0)
      expect(machine.secondaryV?.length ?? 0, machine.id).toBeGreaterThan(0)
      for (const secondary of machine.secondaryV ?? []) {
        expect(secondary, machine.id).toBeGreaterThan(0)
      }
    }
  })
})

describe('robot architectures', () => {
  it('has unique ids and a joint count that matches the dof', () => {
    const ids = ROBOT_ARCHITECTURES.map((robot) => robot.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const robot of ROBOT_ARCHITECTURES) {
      expect(robot.joints.length, robot.id).toBe(robot.dof)
      expect(robot.joints.length, robot.id).toBeGreaterThan(0)
    }
  })

  it('keeps every joint and link inside physical ranges', () => {
    for (const robot of ROBOT_ARCHITECTURES) {
      expect(robot.reachMm, robot.id).toBeGreaterThan(0)
      expect(robot.payloadKg, robot.id).toBeGreaterThan(0)
      for (const joint of robot.joints) {
        const axisNorm = Math.hypot(...joint.axis)
        expect(axisNorm, `${robot.id}/${joint.name}: axis must be a unit vector`).toBeCloseTo(1, 6)
        expect(joint.minLimit, `${robot.id}/${joint.name}`).toBeLessThan(joint.maxLimit)
        expect(joint.velocity, `${robot.id}/${joint.name}`).toBeGreaterThan(0)
        expect(joint.acceleration, `${robot.id}/${joint.name}`).toBeGreaterThan(0)
        expect(joint.rating, `${robot.id}/${joint.name}`).toBeGreaterThan(0)
        expect(joint.link.massKg, `${robot.id}/${joint.name}: link mass`).toBeGreaterThanOrEqual(0)
        expect(joint.link.sizeM, `${robot.id}/${joint.name}: link size`).toBeGreaterThan(0)
        expect(joint.link.lengthM, `${robot.id}/${joint.name}: link length`).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('round-trips every architecture by id', () => {
    for (const robot of ROBOT_ARCHITECTURES) {
      expect(robotArchitectureById(robot.id).id).toBe(robot.id)
    }
  })

  it('computes the solid-prism moment of inertia, not a guess', () => {
    // I = m (other two edges²) / 12 for a rectangular box about its centroidal
    // axis. THREE.Matrix3 stores row-major elements; the diagonal is [0, 4, 8].
    const m = boxInertiaMatrix(2, new Vector3(0.1, 0.2, 0.3))
    expect(m.elements[0]).toBeCloseTo((2 * (0.2 ** 2 + 0.3 ** 2)) / 12, 9)
    expect(m.elements[4]).toBeCloseTo((2 * (0.3 ** 2 + 0.1 ** 2)) / 12, 9)
    expect(m.elements[8]).toBeCloseTo((2 * (0.1 ** 2 + 0.2 ** 2)) / 12, 9)
    // Off-diagonals are exactly zero for a centroidal principal-axis frame.
    for (const index of [1, 2, 3, 5, 6, 7]) expect(m.elements[index]).toBe(0)
  })
})

describe('truss presets', () => {
  it('has unique ids and internally consistent geometry', () => {
    const ids = TRUSS_PRESETS.map((preset) => preset.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const preset of TRUSS_PRESETS) {
      const nodeIds = preset.model.nodes.map((node) => node.id)
      expect(new Set(nodeIds).size, preset.id).toBe(nodeIds.length)
      const nodeSet = new Set(nodeIds)
      for (const member of preset.model.members) {
        expect(nodeSet.has(member.from), `${preset.id}: member ${member.id} from unknown node`).toBe(true)
        expect(nodeSet.has(member.to), `${preset.id}: member ${member.id} to unknown node`).toBe(true)
        expect(member.area, `${preset.id}: member ${member.id} area`).toBeGreaterThan(0)
        const from = preset.model.nodes.find((node) => node.id === member.from)!
        const to = preset.model.nodes.find((node) => node.id === member.to)!
        expect(Math.hypot(to.x - from.x, to.y - from.y), `${preset.id}: member ${member.id} has zero length`).toBeGreaterThan(0)
      }
      for (const support of preset.model.supports) {
        expect(nodeSet.has(support.node), `${preset.id}: support on unknown node`).toBe(true)
      }
      for (const load of preset.model.loads) {
        expect(nodeSet.has(load.node), `${preset.id}: load on unknown node`).toBe(true)
      }
      expect(preset.span, preset.id).toBeGreaterThan(0)
    }
  })

  it('solves every preset to global equilibrium (the textbook check)', () => {
    for (const preset of TRUSS_PRESETS) {
      const result = solveTruss(preset.model)
      expect(result.error, `${preset.id}: ${result.error}`).toBeNull()
      // Reactions must balance the applied loads, i.e. ΣR + ΣF_applied = 0.
      const sumReaction = { x: 0, y: 0 }
      for (const reaction of Object.values(result.result!.reactions)) {
        sumReaction.x += reaction.x
        sumReaction.y += reaction.y
      }
      const sumApplied = { x: 0, y: 0 }
      for (const load of preset.model.loads) {
        sumApplied.x += load.fx
        sumApplied.y += load.fy
      }
      expect(Math.abs(sumReaction.x + sumApplied.x), `${preset.id}: ΣFx not in equilibrium`).toBeLessThan(1e-6 * Math.max(1, Math.abs(sumApplied.x)))
      expect(Math.abs(sumReaction.y + sumApplied.y), `${preset.id}: ΣFy not in equilibrium`).toBeLessThan(1e-6 * Math.max(1, Math.abs(sumApplied.y)))
    }
  })
})

describe('power flow solver — two bus verification case', () => {
  // 100 MVA base, 110 kV: Zbase = 121 Ω. Load 50 + j30 MVA at bus B over a
  // 2 + j10 Ω branch. The textbook answer: B sees a voltage drop below 1.0,
  // the slack supplies load plus losses, losses are nonzero.
  const input = {
    baseMva: 100,
    buses: [
      { id: 'A', type: 'slack' as const, baseKv: 110, voltageSetpointPu: 1.0 },
      { id: 'B', type: 'pq' as const, baseKv: 110, loadMw: 50, loadMvar: 30 },
    ],
    branches: [
      { id: 'L1', from: 'A', to: 'B', resistanceOhm: 2.0, reactanceOhm: 10.0 },
    ],
  }

  it('converges from flat start', () => {
    const result = solvePowerFlow(input)
    expect(result.converged).toBe(true)
  })

  it('drops the loaded bus below 1.0 pu and absorbs losses in the slack', () => {
    const result = solvePowerFlow(input)
    const busB = result.buses.find((bus) => bus.id === 'B')!
    const slack = result.buses.find((bus) => bus.id === 'A')!
    expect(busB.voltagePu).toBeLessThan(1.0)
    expect(busB.voltagePu).toBeGreaterThan(0.8)
    // Slack must supply the 50 MW load plus real losses — strictly more.
    expect(slack.generationMw).toBeGreaterThan(50)
    expect(slack.generationMw).toBeLessThan(60)
    const branch = result.branches[0]
    expect(branch.lossMw).toBeGreaterThan(0)
    // Power balance: losses are what the slack supplies above the load, to the
    // solver's own convergence tolerance (1e-8 class, not machine epsilon).
    expect(Math.abs(slack.generationMw - 50 - branch.lossMw)).toBeLessThan(1e-6)
  })
})
