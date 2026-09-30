import { describe, expect, it } from 'vitest'
import {
  solveAxialBar,
  solveBarConduction,
  solveElectrostaticField,
  solveTruss,
  type TrussMemberInput,
  type TrussNodeInput,
} from './multiphysics'
import { MATERIAL_LIBRARY, MATERIAL_NAMES, VACUUM_PERMITTIVITY, getMaterial } from './materials'

/**
 * Multiphysics validation.
 *
 * Every assertion here is against a closed-form result, so a regression in the
 * finite-difference stencil, the element stiffness matrix or the energy integral
 * fails the suite rather than silently changing a plot.
 */

describe('material library', () => {
  it('stores relative permittivity, not an absolute value', () => {
    // The classic unit bug: 8.854e-12 stored as "relative" permittivity.
    for (const [name, material] of Object.entries(MATERIAL_LIBRARY)) {
      expect(material.relativePermittivity, `${name} relative permittivity`).toBeGreaterThanOrEqual(1)
      expect(material.relativePermittivity, `${name} relative permittivity`).toBeLessThan(1000)
    }
    expect(VACUUM_PERMITTIVITY).toBeCloseTo(8.8541878128e-12, 20)
  })

  it('carries provenance for every material', () => {
    for (const name of MATERIAL_NAMES) {
      expect(MATERIAL_LIBRARY[name].source.length, `${name} needs a source`).toBeGreaterThan(5)
    }
  })

  it('looks materials up case-insensitively', () => {
    expect(getMaterial('  Copper ')).toBe(MATERIAL_LIBRARY.copper)
    expect(getMaterial('unobtainium')).toBeUndefined()
  })

  it('quotes physically plausible conductivities', () => {
    expect(MATERIAL_LIBRARY.copper.thermalConductivity).toBeGreaterThan(MATERIAL_LIBRARY.fr4.thermalConductivity)
    expect(MATERIAL_LIBRARY.silicon.youngsModulus).toBeGreaterThan(MATERIAL_LIBRARY.pla.youngsModulus)
  })
})

describe('thermal: 1D steady-state conduction', () => {
  it('produces a linear profile with no generation', () => {
    const result = solveBarConduction({
      length: 1,
      area: 1e-4,
      thermalConductivity: 401,
      segments: 10,
      temperatureAtStart: 100,
      temperatureAtEnd: 0,
    })

    expect(result.converged).toBe(true)
    expect(result.temperatures).toHaveLength(11)
    result.temperatures.forEach((temperature, index) => {
      expect(temperature).toBeCloseTo(100 - index * 10, 6)
    })

    // Flux is constant: q'' = k·ΔT/L = 401 × 100 / 1 = 40.1 kW/m².
    expect(result.flux).toBeCloseTo(40100, 6)
  })

  it('matches the analytic solution with uniform heat generation', () => {
    const length = 0.1
    const conductivity = 200
    const generation = 1e6
    const endTemperature = 25

    const result = solveBarConduction({
      length,
      area: 1e-4,
      thermalConductivity: conductivity,
      segments: 20,
      temperatureAtStart: endTemperature,
      temperatureAtEnd: endTemperature,
      heatGeneration: generation,
    })

    expect(result.converged).toBe(true)
    result.positions.forEach((x, index) => {
      const analytic =
        endTemperature + (generation / (2 * conductivity)) * x * (length - x)
      expect(result.temperatures[index]).toBeCloseTo(analytic, 6)
    })

    // Peak at mid-length: q·L²/(8k) above the ends.
    const peak = endTemperature + (generation * length * length) / (8 * conductivity)
    expect(Math.max(...result.temperatures)).toBeCloseTo(peak, 6)
    expect(result.generatedPower).toBeCloseTo(generation * 1e-4 * length, 12)
  })

  it('solves with a single element (no interior nodes)', () => {
    const result = solveBarConduction({
      length: 2,
      area: 1,
      thermalConductivity: 1,
      segments: 1,
      temperatureAtStart: 10,
      temperatureAtEnd: 30,
    })
    expect(result.temperatures).toEqual([10, 30])
    expect(result.converged).toBe(true)
  })

  it('rejects unphysical inputs', () => {
    expect(() =>
      solveBarConduction({
        length: 0,
        area: 1,
        thermalConductivity: 1,
        segments: 4,
        temperatureAtStart: 0,
        temperatureAtEnd: 0,
      }),
    ).toThrow(/length/)
    expect(() =>
      solveBarConduction({
        length: 1,
        area: 1,
        thermalConductivity: 1,
        segments: 0,
        temperatureAtStart: 0,
        temperatureAtEnd: 0,
      }),
    ).toThrow(/segments/)
  })
})

describe('structural: axial bar', () => {
  it('reproduces δ = FL/(EA), σ = F/A and the reaction balance', () => {
    const length = 0.5
    const area = 1e-4
    const modulus = 200e9
    const load = 1000

    const result = solveAxialBar({ length, area, youngsModulus: modulus, segments: 8, endLoad: load })

    expect(result.converged).toBe(true)
    expect(result.displacements[result.displacements.length - 1]).toBeCloseTo(
      (load * length) / (modulus * area),
      12,
    )
    for (const stress of result.stresses) expect(stress).toBeCloseTo(load / area, 6)
    for (const strain of result.strains) expect(strain).toBeCloseTo(load / (modulus * area), 15)
    // Equilibrium: the support reaction must balance the applied load exactly.
    expect(result.reactionForce).toBeCloseTo(-load, 6)
  })

  it('gives a linear displacement field along the bar', () => {
    const result = solveAxialBar({ length: 1, area: 1e-4, youngsModulus: 70e9, segments: 4, endLoad: 500 })
    const tip = result.displacements[4]
    ;[1, 2, 3].forEach((node) => {
      expect(result.displacements[node]).toBeCloseTo((tip * node) / 4, 12)
    })
  })

  it('handles compression without sign confusion', () => {
    const result = solveAxialBar({ length: 1, area: 1e-4, youngsModulus: 70e9, segments: 2, endLoad: -500 })
    expect(result.displacements[2]).toBeLessThan(0)
    expect(result.stresses[0]).toBeLessThan(0)
    expect(result.reactionForce).toBeCloseTo(500, 6)
  })

  it('rejects a zero-modulus bar', () => {
    expect(() => solveAxialBar({ length: 1, area: 1, youngsModulus: 0, segments: 2, endLoad: 1 })).toThrow(/Young/)
  })
})

describe('structural: 2D truss', () => {
  /** A symmetric two-bar truss: apex loaded vertically, both feet pinned. */
  const twoBarTruss = (): { nodes: TrussNodeInput[]; members: TrussMemberInput[] } => ({
    nodes: [
      { x: -1, y: 0, fixX: true, fixY: true },
      { x: 1, y: 0, fixX: true, fixY: true },
      { x: 0, y: -1, loadY: -1000 },
    ],
    members: [
      { from: 0, to: 2, area: 1e-4, youngsModulus: 200e9 },
      { from: 1, to: 2, area: 1e-4, youngsModulus: 200e9 },
    ],
  })

  it('develops the textbook tension P/(2 sin θ) in each bar', () => {
    const { nodes, members } = twoBarTruss()
    const result = solveTruss(nodes, members)

    expect(result.converged).toBe(true)
    // Members run at 45°, so each carries P/(2·sin45°) = P/√2 = 707.1 N of tension.
    const expectedTension = 1000 / Math.SQRT2
    expect(result.memberForces[0]).toBeCloseTo(expectedTension, 4)
    expect(result.memberForces[1]).toBeCloseTo(expectedTension, 4)
    expect(result.memberStresses[0]).toBeCloseTo(expectedTension / 1e-4, 2)
  })

  it('balances the applied load with the support reactions', () => {
    const { nodes, members } = twoBarTruss()
    const result = solveTruss(nodes, members)
    const verticalReaction = result.reactions[0].y + result.reactions[1].y
    // ΣFy must vanish: the two supports together carry the 1000 N downward load.
    expect(verticalReaction).toBeCloseTo(1000, 4)
    expect(result.reactions[0].x + result.reactions[1].x).toBeCloseTo(0, 6)
  })

  it('sinks the apex by the analytic amount and stays symmetric', () => {
    const { nodes, members } = twoBarTruss()
    const result = solveTruss(nodes, members)

    /*
     * Axial stiffness of each bar is EA/L with L = √2 m, and its direction cosine
     * with the vertical is s = 1/√2. The apex vertical stiffness is therefore
     * 2·(EA/L)·s² = EA/√2, so the drop is P·√2/(EA).
     */
    const axialRigidity = 200e9 * 1e-4
    const expectedDrop = (1000 * Math.SQRT2) / axialRigidity

    expect(Math.abs(result.displacements[2].y)).toBeCloseTo(expectedDrop, 12)
    expect(result.displacements[2].y).toBeLessThan(0)
    // Symmetry: no lateral movement of the apex, equal foot reactions.
    expect(result.displacements[2].x).toBeCloseTo(0, 12)
    expect(result.reactions[0].y).toBeCloseTo(result.reactions[1].y, 6)
  })

  it('flags a mechanism instead of returning nonsense', () => {
    // A single unrestrained bar can slide freely in y, so the stiffness is singular.
    expect(() =>
      solveTruss(
        [{ x: 0, y: 0, fixX: true, fixY: true }, { x: 1, y: 0, loadY: -100 }],
        [{ from: 0, to: 1, area: 1e-4, youngsModulus: 200e9 }],
      ),
    ).toThrow(/mechanism|singular/i)
  })

  it('rejects malformed member references', () => {
    expect(() =>
      solveTruss([{ x: 0, y: 0, fixX: true, fixY: true }], [{ from: 0, to: 5, area: 1e-4, youngsModulus: 1e9 }]),
    ).toThrow(/does not exist/)
    expect(() =>
      solveTruss(
        [{ x: 0, y: 0, fixX: true, fixY: true }, { x: 1, y: 0 }],
        [{ from: 0, to: 1, area: 0, youngsModulus: 1e9 }],
      ),
    ).toThrow(/positive area/)
  })
})

describe('electrostatic: parallel-plate field', () => {
  const parallelPlates = (overrides: Record<string, number> = {}) =>
    solveElectrostaticField({
      separation: 1e-3, // 1 mm
      plateWidth: 0.1, // 100 mm square plate
      relativePermittivity: 4.3, // FR4
      cellsX: 8,
      cellsY: 20,
      upperPlateVoltage: 10,
      lowerPlateVoltage: 0,
      ...overrides,
    })

  it('produces a uniform field E = ΔV/d away from the plates', () => {
    const result = parallelPlates()
    expect(result.converged).toBe(true)
    // 10 V over 1 mm is 10 000 V/m.
    expect(result.meanFieldMagnitude).toBeCloseTo(10000, 3)

    // Every potential row must be evenly spaced: the discrete solution is linear.
    const potentials = result.potentials
    const intervals = potentials.length - 1
    for (let row = 1; row < intervals; row += 1) {
      expect(potentials[row][4]).toBeCloseTo((10 * row) / intervals, 9)
    }
  })

  it('reproduces C = ε₀·εr·A/d from the stored energy', () => {
    const result = parallelPlates()
    const analyticCapacitance = (VACUUM_PERMITTIVITY * 4.3 * 0.1 * 0.1) / 1e-3
    /*
     * Compared relatively, not absolutely: the energy is a sum over 160 cells plus
     * a dense LU solve, so ~1e-7 of relative round-off is expected and an absolute
     * tolerance of 1e-15 J on a 1.9e-8 J result would be unsatisfiable by design.
     */
    expect(Math.abs(result.capacitance / analyticCapacitance - 1)).toBeLessThan(1e-6)
    // Energy must equal ½CV².
    expect(Math.abs(result.energy / (0.5 * analyticCapacitance * 100) - 1)).toBeLessThan(1e-6)
  })

  it('scales with permittivity, separation and plate area as the formula requires', () => {
    const baseline = parallelPlates().capacitance
    const ratio = (candidate: number) => candidate / baseline

    expect(ratio(parallelPlates({ relativePermittivity: 8.6 }).capacitance)).toBeCloseTo(2, 5)
    expect(ratio(parallelPlates({ separation: 2e-3 }).capacitance)).toBeCloseTo(0.5, 5)
    // Area scales as width × depth, and depth defaults to the width, so doubling
    // the width quadruples the area — and therefore the capacitance.
    expect(ratio(parallelPlates({ plateWidth: 0.2 }).capacitance)).toBeCloseTo(4, 5)
    // Doubling only the depth doubles the area, so the capacitance doubles.
    expect(ratio(parallelPlates({ plateDepth: 0.2 }).capacitance)).toBeCloseTo(2, 5)
  })

  it('leaves a distant plate untouched by a guard, and shields a close one', () => {
    /*
     * A guard electrode only matters when the plate is comparable to the gap. For a
     * 100:1 plate the guard is 50 mm from the centre, so its influence has decayed
     * to nothing; for a 4:1 plate it dominates. The exact, checkable property is the
     * spread of the *interior* columns (the guard columns themselves are clamped by
     * definition and say nothing about reach).
     */
    const interior = (potentials: number[][]): number[] => {
      const row = Math.round((potentials.length - 1) / 2)
      return potentials[row].slice(1, -1)
    }
    const interiorSpread = (potentials: number[][]) => {
      const values = interior(potentials)
      return Math.max(...values) - Math.min(...values)
    }

    // Without a guard every column must be identical: the field is strictly 1D.
    expect(interiorSpread(parallelPlates().potentials)).toBeLessThan(1e-9)

    const wideGuarded = parallelPlates({ guardVoltage: 0 })
    expect(wideGuarded.converged).toBe(true)
    // Negligible: a few millivolts out of 5 V across the interior, i.e. LU round-off
    // rather than a physical effect.
    const wideSpread = interiorSpread(wideGuarded.potentials)
    expect(wideSpread).toBeLessThan(0.02)

    /*
     * The profile is still the analytic linear one. Note the node nearest the middle
     * sits at 11/21 of the gap (there is no node exactly at d/2, because 21 intervals
     * is odd), so the expected potential there is 10·11/21 V, not 5 V.
     */
    const midRow = Math.round((wideGuarded.potentials.length - 1) / 2)
    const linearPotential = (10 * midRow) / (wideGuarded.potentials.length - 1)
    for (const value of interior(wideGuarded.potentials)) {
      expect(value).toBeCloseTo(linearPotential, 2)
    }

    const narrowGuarded = parallelPlates({ plateWidth: 4e-3, cellsX: 8, guardVoltage: 0 })
    expect(narrowGuarded.converged).toBe(true)
    // The claim under test is reach, so assert the contrast: bringing the guard
    // inside one gap's distance changes the interior by more than an order of
    // magnitude compared with leaving it 50 mm away.
    expect(interiorSpread(narrowGuarded.potentials)).toBeGreaterThan(wideSpread * 10)

    // The guard is held at its enforced potential, unlike a Neumann edge.
    for (let row = 0; row < narrowGuarded.potentials.length; row += 1) {
      expect(narrowGuarded.potentials[row][0]).toBeCloseTo(0, 12)
      expect(narrowGuarded.potentials[row][narrowGuarded.potentials[row].length - 1]).toBeCloseTo(0, 12)
    }
  })

  it('rejects unphysical geometry', () => {
    expect(() => parallelPlates({ separation: 0 })).toThrow(/separation/)
    expect(() => parallelPlates({ relativePermittivity: 0.5 })).toThrow(/permittivity/)
    expect(() => parallelPlates({ cellsY: 0 })).toThrow(/cellsY/)
  })
})
