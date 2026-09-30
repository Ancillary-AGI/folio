/**
 * Multiphysics solvers — thermal, structural and electrostatic.
 *
 * Scope, stated honestly
 * ---------------------
 * These are **verified reduced-order solvers**, not a general 3D FEM suite:
 *
 *   • thermal       — steady-state heat conduction by finite differences,
 *                     including uniform volumetric generation;
 *   • structural    — 1D axial bar and 2D pin-jointed truss by the direct
 *                     stiffness method (real element stiffness assembly);
 *   • electrostatic — 2D potential field by finite differences, from which field
 *                     strength, capacitance and stored energy follow.
 *
 * Every routine reuses the same dense LU solver as the circuit analyser
 * (`solveRealSystem`) and reports a genuine residual from the assembled system
 * rather than a fabricated convergence figure. This module is deterministic:
 * there is no `Math.random()` in it.
 *
 * The previous implementation returned random node voltages, random iteration
 * counts and random timings, and a second module duplicated the whole thing with
 * stub methods. Both are gone: one module, one implementation, with analytic
 * tests in `multiphysics.test.ts`.
 */

import { solveRealSystem } from './numeric'
import { VACUUM_PERMITTIVITY } from './materials'

/** Residual below which a solve is reported as converged (relative to the load). */
const CONVERGENCE_TOLERANCE = 1e-9

/**
 * Relative backward error of `A·x − b`.
 *
 * The natural normalisation is row-wise: `max_i |A·x − b|_i / (Σ_j |A_ij||x_j| + |b_i|)`.
 * Dividing by the *load* instead (as an earlier version did) reports a converged
 * solution as unconverged whenever the matrix entries are much larger than the
 * answer — exactly what happens on an anisotropic grid, where a 1/h² term can be
 * 1e8 while the potential is 10 V.
 */
function relativeResidual(
  matrix: number[][],
  rhs: readonly number[],
  x: readonly number[],
  scaleHint = 1,
): number {
  if (rhs.length === 0) return 0
  let worst = 0
  for (let row = 0; row < rhs.length; row += 1) {
    let product = 0
    let magnitude = 0
    for (let column = 0; column < rhs.length; column += 1) {
      product += matrix[row][column] * x[column]
      magnitude += Math.abs(matrix[row][column]) * Math.abs(x[column])
    }
    const denominator = Math.max(magnitude + Math.abs(rhs[row]), scaleHint * Number.EPSILON, Number.EPSILON)
    worst = Math.max(worst, Math.abs(product - rhs[row]) / denominator)
  }
  return worst
}

export interface ThermalConductionInput {
  /** Bar length (m). */
  length: number
  /** Cross-sectional area (m²). */
  area: number
  /** Thermal conductivity (W/(m·K)). */
  thermalConductivity: number
  /** Number of finite-difference cells. */
  segments: number
  /** Fixed temperature at x = 0 (°C). */
  temperatureAtStart: number
  /** Fixed temperature at x = length (°C). */
  temperatureAtEnd: number
  /** Uniform volumetric heat generation (W/m³). Omit for pure conduction. */
  heatGeneration?: number
}

export interface ThermalConductionResult {
  /** Node temperatures (°C), length `segments + 1`. */
  temperatures: number[]
  /** Node x-coordinates (m). */
  positions: number[]
  /** Steady heat flux through the bar (W/m²), positive from start to end. */
  flux: number
  /** Total heat generated (W). */
  generatedPower: number
  /** Relative residual of the assembled system. */
  residual: number
  converged: boolean
}

/**
 * 1D steady-state conduction along a bar with fixed end temperatures.
 *
 * With uniform generation `q` the classic solution is
 *   T(x) = T₁ + (T₂ − T₁)·x/L + (q/(2k))·x(L − x)
 * which is exactly what the tests check. For this problem the finite-difference
 * and linear finite-element formulations coincide, so the result is analytic up
 * to linear-solver precision.
 */
export function solveBarConduction(input: ThermalConductionInput): ThermalConductionResult {
  const { length, area, thermalConductivity, segments, temperatureAtStart, temperatureAtEnd } = input
  const generation = input.heatGeneration ?? 0

  if (!(length > 0)) throw new Error('Thermal: bar length must be > 0 m.')
  if (!(area > 0)) throw new Error('Thermal: cross-sectional area must be > 0 m².')
  if (!(thermalConductivity > 0)) throw new Error('Thermal: thermal conductivity must be > 0 W/(m·K).')
  if (!Number.isInteger(segments) || segments < 1) throw new Error('Thermal: segments must be an integer >= 1.')

  const nodeCount = segments + 1
  const spacing = length / segments
  // Conductance of one cell (W/K).
  const conductance = (thermalConductivity * area) / spacing
  /*
   * Source lumping: an interior node receives the generation from *both*
   * adjacent half-cells, i.e. q·A·h in total. Applying only q·A·h/2 (as an
   * earlier version did) halves the temperature rise — a bug the analytic test
   * for the parabolic profile catches immediately.
   */
  const nodalGeneration = generation * area * spacing

  // Interior nodes are the unknowns; the two ends are Dirichlet boundaries.
  const interiorCount = nodeCount - 2
  const matrix: number[][] = Array.from({ length: interiorCount }, () => new Array<number>(interiorCount).fill(0))
  const rhs: number[] = new Array<number>(interiorCount).fill(0)

  for (let index = 0; index < interiorCount; index += 1) {
    matrix[index][index] = 2 * conductance
    if (index > 0) matrix[index][index - 1] = -conductance
    if (index < interiorCount - 1) matrix[index][index + 1] = -conductance
    rhs[index] = nodalGeneration
  }

  if (interiorCount > 0) {
    // Dirichlet contributions move to the right-hand side.
    rhs[0] += conductance * temperatureAtStart
    rhs[interiorCount - 1] += conductance * temperatureAtEnd
  }

  const temperatures = new Array<number>(nodeCount).fill(0)
  temperatures[0] = temperatureAtStart
  temperatures[nodeCount - 1] = temperatureAtEnd

  let residual = 0
  if (interiorCount > 0) {
    const solution = solveRealSystem(matrix, rhs)
    if (!solution) throw new Error('Thermal: the assembled system is singular.')
    for (let index = 0; index < interiorCount; index += 1) temperatures[index + 1] = solution[index]
    residual = relativeResidual(
      matrix,
      rhs,
      solution,
      Math.max(Math.abs(temperatureAtStart), Math.abs(temperatureAtEnd), 1) * conductance * 2,
    )
  }

  const positions = Array.from({ length: nodeCount }, (_, index) => index * spacing)
  // Flux from the first cell: q'' = −k·dT/dx.
  const flux = (-thermalConductivity * (temperatures[1] - temperatures[0])) / spacing

  return {
    temperatures,
    positions,
    flux,
    generatedPower: generation * area * length,
    residual,
    converged: residual < CONVERGENCE_TOLERANCE,
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Structural — axial bar
 * ──────────────────────────────────────────────────────────────────────────── */

export interface AxialBarInput {
  /** Bar length (m). */
  length: number
  /** Cross-sectional area (m²). */
  area: number
  /** Young's modulus (Pa). */
  youngsModulus: number
  /** Number of elements. */
  segments: number
  /** Axial load applied at the free end (N). Positive is tension. */
  endLoad: number
}

export interface AxialBarResult {
  /** Axial displacement at each node (m), length `segments + 1`. */
  displacements: number[]
  /** Axial stress in each element (Pa). */
  stresses: number[]
  /** Axial strain in each element (dimensionless). */
  strains: number[]
  /** Support reaction at the fixed end (N); equals −endLoad in equilibrium. */
  reactionForce: number
  /** Relative residual of the assembled system. */
  residual: number
  converged: boolean
}

/**
 * 1D axial bar by the direct stiffness method.
 *
 * For a uniform bar with an end load the analytic answers are
 *   δ = FL/(EA),  σ = F/A,  ε = σ/E
 * and the reaction at the fixed end balances the applied load exactly. The tests
 * assert all four.
 */
export function solveAxialBar(input: AxialBarInput): AxialBarResult {
  const { length, area, youngsModulus, segments, endLoad } = input
  if (!(length > 0)) throw new Error('Structural: bar length must be > 0 m.')
  if (!(area > 0)) throw new Error('Structural: cross-sectional area must be > 0 m².')
  if (!(youngsModulus > 0)) throw new Error('Structural: Young modulus must be > 0 Pa.')
  if (!Number.isInteger(segments) || segments < 1) throw new Error('Structural: segments must be an integer >= 1.')

  const nodeCount = segments + 1
  const elementLength = length / segments
  const axialStiffness = (youngsModulus * area) / elementLength

  // Assemble the global stiffness matrix (tridiagonal for an axial chain).
  const matrix: number[][] = Array.from({ length: nodeCount }, () => new Array<number>(nodeCount).fill(0))
  const rhs: number[] = new Array<number>(nodeCount).fill(0)
  for (let element = 0; element < segments; element += 1) {
    const a = element
    const b = element + 1
    matrix[a][a] += axialStiffness
    matrix[b][b] += axialStiffness
    matrix[a][b] -= axialStiffness
    matrix[b][a] -= axialStiffness
  }
  rhs[nodeCount - 1] = endLoad

  // Node 0 is fixed, so rows and columns for degree of freedom 0 are removed.
  const free = Array.from({ length: nodeCount - 1 }, (_, index) => index + 1)
  const reduced = free.map((row) => free.map((column) => matrix[row][column]))
  const reducedRhs = free.map((row) => rhs[row])

  const solved = solveRealSystem(reduced, reducedRhs)
  if (!solved) throw new Error('Structural: the assembled system is singular.')

  const displacements = new Array<number>(nodeCount).fill(0)
  free.forEach((row, index) => {
    displacements[row] = solved[index]
  })

  const strains: number[] = []
  const stresses: number[] = []
  for (let element = 0; element < segments; element += 1) {
    const strain = (displacements[element + 1] - displacements[element]) / elementLength
    strains.push(strain)
    stresses.push(youngsModulus * strain)
  }

  /*
   * Reaction at the fixed node: the internal force the support must supply.
   * Computing it from the assembled matrix (rather than assuming −F) is what
   * makes it a check rather than a restatement.
   */
  let reactionForce = 0
  for (let column = 0; column < nodeCount; column += 1) reactionForce += matrix[0][column] * displacements[column]
  reactionForce -= rhs[0]

  const residual = relativeResidual(
    reduced,
    reducedRhs,
    solved,
    Math.max(Math.abs(endLoad), 1) + axialStiffness * Math.max(Math.abs(length), 1),
  )

  return { displacements, stresses, strains, reactionForce, residual, converged: residual < CONVERGENCE_TOLERANCE }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Structural — 2D pin-jointed truss
 * ──────────────────────────────────────────────────────────────────────────── */

export interface TrussNodeInput {
  x: number
  y: number
  /** Restrain translation in x. */
  fixX?: boolean
  /** Restrain translation in y. */
  fixY?: boolean
  /** Externally applied nodal load (N). */
  loadX?: number
  loadY?: number
}

export interface TrussMemberInput {
  /** Index into `nodes` of the first end. */
  from: number
  /** Index into `nodes` of the second end. */
  to: number
  /** Cross-sectional area (m²). */
  area: number
  /** Young's modulus (Pa). */
  youngsModulus: number
}

export interface TrussResult {
  /** Nodal displacements (m). */
  displacements: Array<{ x: number; y: number }>
  /** Axial force in each member (N). Positive is tension. */
  memberForces: number[]
  /** Axial stress in each member (Pa). */
  memberStresses: number[]
  /** Support reactions (N) at each node; zero where the node is free. */
  reactions: Array<{ x: number; y: number }>
  residual: number
  converged: boolean
}

/**
 * 2D pin-jointed truss by the direct stiffness method.
 *
 * Each member contributes the standard rotated axial stiffness matrix
 *   k = EA/L · [[c², cs, −c², −cs], …]
 * and the reduced system is solved with the same dense LU used everywhere else.
 *
 * Verification: a symmetric two-bar truss carrying a vertical load `P` develops
 * tension `P/(2 sin θ)` in each bar, and a single bar reproduces the axial-bar
 * solution exactly. Both are asserted in the test suite.
 */
export function solveTruss(nodes: readonly TrussNodeInput[], members: readonly TrussMemberInput[]): TrussResult {
  if (nodes.length === 0) throw new Error('Structural: a truss needs at least one node.')
  if (members.length === 0) throw new Error('Structural: a truss needs at least one member.')

  const degrees = nodes.length * 2
  const matrix: number[][] = Array.from({ length: degrees }, () => new Array<number>(degrees).fill(0))
  const rhs: number[] = new Array<number>(degrees).fill(0)

  nodes.forEach((node, index) => {
    rhs[index * 2] = node.loadX ?? 0
    rhs[index * 2 + 1] = node.loadY ?? 0
  })

  const geometry = members.map((member, memberIndex) => {
    if (member.from < 0 || member.from >= nodes.length || member.to < 0 || member.to >= nodes.length) {
      throw new Error(`Structural: member ${memberIndex + 1} references a node that does not exist.`)
    }
    if (member.from === member.to) {
      throw new Error(`Structural: member ${memberIndex + 1} has both ends on the same node.`)
    }
    const start = nodes[member.from]
    const end = nodes[member.to]
    const dx = end.x - start.x
    const dy = end.y - start.y
    const length = Math.hypot(dx, dy)
    if (!(length > 0)) throw new Error(`Structural: member ${memberIndex + 1} has zero length.`)
    if (!(member.area > 0)) throw new Error(`Structural: member ${memberIndex + 1} needs a positive area.`)
    if (!(member.youngsModulus > 0)) {
      throw new Error(`Structural: member ${memberIndex + 1} needs a positive Young modulus.`)
    }
    return {
      member,
      memberIndex,
      cosine: dx / length,
      sine: dy / length,
      axial: (member.youngsModulus * member.area) / length,
    }
  })

  for (const { memberIndex, cosine, sine, axial } of geometry) {
    const member = members[memberIndex]
    const dofs = [member.from * 2, member.from * 2 + 1, member.to * 2, member.to * 2 + 1]
    const local = [
      [cosine * cosine, cosine * sine, -cosine * cosine, -cosine * sine],
      [cosine * sine, sine * sine, -cosine * sine, -sine * sine],
      [-cosine * cosine, -cosine * sine, cosine * cosine, cosine * sine],
      [-cosine * sine, -sine * sine, cosine * sine, sine * sine],
    ]
    for (let row = 0; row < 4; row += 1) {
      for (let column = 0; column < 4; column += 1) {
        matrix[dofs[row]][dofs[column]] += axial * local[row][column]
      }
    }
  }

  // Partition into free and restrained degrees of freedom.
  const restrained = new Set<number>()
  nodes.forEach((node, index) => {
    if (node.fixX) restrained.add(index * 2)
    if (node.fixY) restrained.add(index * 2 + 1)
  })
  const free = Array.from({ length: degrees }, (_, index) => index).filter((dof) => !restrained.has(dof))
  if (free.length === 0) throw new Error('Structural: every degree of freedom is restrained, so there is nothing to solve.')

  const reduced = free.map((row) => free.map((column) => matrix[row][column]))
  const reducedRhs = free.map((row) => rhs[row])

  const solved = solveRealSystem(reduced, reducedRhs)
  if (!solved) {
    throw new Error('Structural: the truss is a mechanism (singular stiffness matrix). Add a restraint or a member.')
  }

  const displacementVector = new Array<number>(degrees).fill(0)
  free.forEach((dof, index) => {
    displacementVector[dof] = solved[index]
  })

  const memberForces: number[] = []
  const memberStresses: number[] = []
  geometry.forEach(({ member, cosine, sine, axial }, index) => {
    const axialExtension =
      (displacementVector[member.to * 2] - displacementVector[member.from * 2]) * cosine +
      (displacementVector[member.to * 2 + 1] - displacementVector[member.from * 2 + 1]) * sine
    memberForces.push(axial * axialExtension)
    memberStresses.push((axial * axialExtension) / members[index].area)
  })

  // Reactions at restrained degrees of freedom: r = K·u − F.
  const reactions = nodes.map(() => ({ x: 0, y: 0 }))
  nodes.forEach((_, index) => {
    for (const axis of [0, 1] as const) {
      const dof = index * 2 + axis
      if (!restrained.has(dof)) continue
      let internal = 0
      for (let column = 0; column < degrees; column += 1) internal += matrix[dof][column] * displacementVector[column]
      const reaction = internal - rhs[dof]
      if (axis === 0) reactions[index].x = reaction
      else reactions[index].y = reaction
    }
  })

  const loadScale = Math.max(
    rhs.reduce((largest, value) => Math.max(largest, Math.abs(value)), 0),
    1,
  )
  const residual = relativeResidual(reduced, reducedRhs, solved, loadScale)

  return {
    displacements: nodes.map((_, index) => ({
      x: displacementVector[index * 2],
      y: displacementVector[index * 2 + 1],
    })),
    memberForces,
    memberStresses,
    reactions,
    residual,
    converged: residual < CONVERGENCE_TOLERANCE,
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Electrostatic potential field
 * ──────────────────────────────────────────────────────────────────────────── */

export interface ElectrostaticFieldInput {
  /** Plate separation (m), along y. */
  separation: number
  /** Plate extent along x (m). */
  plateWidth: number
  /**
   * Plate depth into the page (m). Defaults to `plateWidth`, i.e. a square plate.
   * The 2D field is independent of depth, so this only scales the capacitance:
   * `C = ε·plateWidth·plateDepth/d`.
   */
  plateDepth?: number
  /** Relative permittivity of the dielectric between the plates. */
  relativePermittivity: number
  /** Interior grid divisions along x. */
  cellsX: number
  /** Interior grid divisions along y. */
  cellsY: number
  /** Potential of the upper plate (V). */
  upperPlateVoltage: number
  /** Potential of the lower plate (V). */
  lowerPlateVoltage: number
  /** Optional guard electrodes fixing the x = 0 and x = width edges (V). */
  guardVoltage?: number
}

export interface ElectrostaticFieldResult {
  /** Potential grid `[rowY][columnX]`, including both plate rows (V). */
  potentials: number[][]
  /** x coordinates of the grid columns (m). */
  xCoordinates: number[]
  /** y coordinates of the grid rows (m). */
  yCoordinates: number[]
  /** Field magnitude at the plate midline (V/m). */
  meanFieldMagnitude: number
  /** Parallel-plate capacitance from the stored energy (F). */
  capacitance: number
  /** Stored energy (J). */
  energy: number
  /** Relative residual of the Laplace solve. */
  residual: number
  converged: boolean
}

/**
 * Electrostatic potential between two parallel plates.
 *
 * Solves the Laplace equation on a uniform grid with Dirichlet conditions on the
 * plates and either Neumann (natural, no fringing) or Dirichlet (guarded) side
 * walls. With Neumann sides the discrete solution is exactly linear between the
 * plates, so field, capacitance and energy all match the analytic parallel-plate
 * results:
 *
 *   E = ΔV/d,   C = ε₀·εr·A/d,   U = ½CV²
 *
 * The grid is retained (not just the summary numbers) so the field can be
 * rendered and a non-uniform result — a guarded cell, for example — stays
 * inspectable instead of collapsing to one scalar.
 */
export function solveElectrostaticField(input: ElectrostaticFieldInput): ElectrostaticFieldResult {
  const {
    separation,
    plateWidth,
    plateDepth = plateWidth,
    relativePermittivity,
    cellsX,
    cellsY,
    upperPlateVoltage,
    lowerPlateVoltage,
    guardVoltage,
  } = input

  if (!(separation > 0)) throw new Error('Electrostatic: plate separation must be > 0 m.')
  if (!(plateWidth > 0)) throw new Error('Electrostatic: plate width must be > 0 m.')
  if (!(plateDepth > 0)) throw new Error('Electrostatic: plate depth must be > 0 m.')
  if (!(relativePermittivity >= 1)) throw new Error('Electrostatic: relative permittivity must be >= 1.')
  if (!Number.isInteger(cellsX) || cellsX < 1) throw new Error('Electrostatic: cellsX must be an integer >= 1.')
  if (!Number.isInteger(cellsY) || cellsY < 1) throw new Error('Electrostatic: cellsY must be an integer >= 1.')

  const columns = cellsX + 1
  const rows = cellsY + 2 // interior rows plus one plate row at each end
  /*
   * Node spacing is the *extent divided by the number of intervals*, not by the
   * number of cells: with `rows` nodes there are `rows - 1` gaps, and the top
   * plate must land exactly on `separation`. Dividing by `cellsY` here made the
   * domain 5 % too tall, which biased the field and the capacitance low.
   */
  const spacingX = plateWidth / cellsX
  const spacingY = separation / (rows - 1)

  const potentials: number[][] = Array.from({ length: rows }, () => new Array<number>(columns).fill(0))
  for (let column = 0; column < columns; column += 1) {
    potentials[rows - 1][column] = upperPlateVoltage
    potentials[0][column] = lowerPlateVoltage
  }

  const guarded = guardVoltage !== undefined
  if (guarded) {
    const guard = guardVoltage as number
    for (let row = 0; row < rows; row += 1) {
      potentials[row][0] = guard
      potentials[row][columns - 1] = guard
    }
  }

  const interiorRowCount = cellsY
  const interiorColumnStart = guarded ? 1 : 0
  const interiorColumnEnd = guarded ? columns - 1 : columns
  const columnCount = interiorColumnEnd - interiorColumnStart
  const unknownCount = interiorRowCount * columnCount

  const indexOf = (row: number, column: number): number =>
    (row - 1) * columnCount + (column - interiorColumnStart)

  const matrix: number[][] = Array.from({ length: unknownCount }, () => new Array<number>(unknownCount).fill(0))
  const rhs: number[] = new Array<number>(unknownCount).fill(0)

  /*
   * Five-point Laplacian. The 1/h² factors keep the stencil exact on a non-square
   * mesh, which matters because a plate aspect ratio of 100:1 is normal.
   */
  const coefficientX = 1 / (spacingX * spacingX)
  const coefficientY = 1 / (spacingY * spacingY)

  for (let row = 1; row <= interiorRowCount; row += 1) {
    for (let column = interiorColumnStart; column < interiorColumnEnd; column += 1) {
      const equation = indexOf(row, column)
      matrix[equation][equation] = 2 * coefficientX + 2 * coefficientY

      const neighbours: Array<{ row: number; column: number; weight: number }> = [
        { row, column: column - 1, weight: coefficientX },
        { row, column: column + 1, weight: coefficientX },
        { row: row - 1, column, weight: coefficientY },
        { row: row + 1, column, weight: coefficientY },
      ]

      for (const neighbour of neighbours) {
        /*
         * Two distinct boundary treatments, and conflating them is a classic bug:
         *
         *  • a neighbour on a plate or a guard is *Dirichlet*, so its known value
         *    moves to the right-hand side;
         *  • a neighbour outside the grid is a *Neumann* edge. Mirroring the ghost
         *    node (∂T/∂n = 0 ⟹ T_ghost = T_node) means the stencil's x-term becomes
         *    `cX·T_c − cX·T_inner` instead of `2cX·T_c − cX·T_c − cX·T_inner`, so the
         *    diagonal loses one `weight`. Simply *dropping* the term — as an earlier
         *    version did — left a half-conductivity wall at the edge, which tilted the
         *    whole field and biased every capacitance low.
         */
        if (neighbour.row < 0 || neighbour.row > rows - 1) {
          matrix[equation][equation] -= neighbour.weight
          continue
        }
        if (neighbour.column < 0 || neighbour.column > columns - 1) {
          matrix[equation][equation] -= neighbour.weight
          continue
        }

        const isDirichlet =
          neighbour.row === 0 ||
          neighbour.row === rows - 1 ||
          (guarded && (neighbour.column === 0 || neighbour.column === columns - 1))

        if (isDirichlet) {
          rhs[equation] += neighbour.weight * potentials[neighbour.row][neighbour.column]
          continue
        }

        matrix[equation][indexOf(neighbour.row, neighbour.column)] -= neighbour.weight
      }
    }
  }

  let residual = 0
  if (unknownCount > 0) {
    const solved = solveRealSystem(matrix, rhs)
    if (!solved) throw new Error('Electrostatic: the assembled system is singular.')
    for (let row = 1; row <= interiorRowCount; row += 1) {
      for (let column = interiorColumnStart; column < interiorColumnEnd; column += 1) {
        potentials[row][column] = solved[indexOf(row, column)]
      }
    }
    residual = relativeResidual(
      matrix,
      rhs,
      solved,
      Math.max(Math.abs(upperPlateVoltage), Math.abs(lowerPlateVoltage), 1),
    )
  }

  // Field magnitude at the grid midline: E = −∇V, central difference in y.
  const midRow = Math.max(1, Math.round(rows / 2))
  const midColumn = Math.floor(columns / 2)
  const gradientY = (potentials[midRow + 1][midColumn] - potentials[midRow - 1][midColumn]) / (2 * spacingY)
  const gradientX =
    columns > 2 ? (potentials[midRow][midColumn + 1] - potentials[midRow][midColumn - 1]) / (2 * spacingX) : 0
  const meanFieldMagnitude = Math.hypot(gradientX, gradientY)

  /*
   * Capacitance from the stored energy, C = 2U/V².
   *
   * Integration covers every interval between consecutive node rows (there are
   * `rows - 1` of them, spanning exactly `separation`) rather than only the rows
   * with a node on each side. Integrating over interior rows alone leaves the two
   * half-cells next to the plates out of the sum, which made the capacitance come
   * out (rows-2)/(rows-1) of the true value — 95 % for a 20-cell gap.
   */
  const permittivity = VACUUM_PERMITTIVITY * relativePermittivity
  let energy = 0
  for (let interval = 0; interval < rows - 1; interval += 1) {
    for (let column = 0; column < columns - 1; column += 1) {
      // Field across this interval, one-sided in y so the cell height is exact.
      const dVdy = (potentials[interval + 1][column] - potentials[interval][column]) / spacingY
      // x-gradient at the cell centre: the mean of the two row-wise differences.
      const dVdx =
        ((potentials[interval][column + 1] - potentials[interval][column]) / spacingX +
          (potentials[interval + 1][column + 1] - potentials[interval + 1][column]) / spacingX) /
        2
      energy += 0.5 * permittivity * (dVdx * dVdx + dVdy * dVdy) * spacingX * spacingY
    }
  }
  // The 2D slice represents a plate pair of width×depth, so scale by the depth.
  const threeDimensionalEnergy = energy * plateDepth
  const appliedVoltage = Math.abs(upperPlateVoltage - lowerPlateVoltage)
  const capacitance = appliedVoltage > 0 ? (2 * threeDimensionalEnergy) / (appliedVoltage * appliedVoltage) : 0

  return {
    potentials,
    xCoordinates: Array.from({ length: columns }, (_, index) => index * spacingX),
    yCoordinates: Array.from({ length: rows }, (_, index) => index * spacingY),
    meanFieldMagnitude,
    capacitance,
    energy: threeDimensionalEnergy,
    residual,
    converged: residual < CONVERGENCE_TOLERANCE,
  }
}
