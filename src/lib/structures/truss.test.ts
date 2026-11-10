/**
 * The truss solver is checked against the closed forms it is meant to reproduce.
 *
 * A stiffness method can be wrong in a way that still looks right — a sign
 * flipped on one row, a transformed matrix that keeps its symmetry but not its
 * physics — and every number downstream inherits the mistake. So each case here
 * has an answer that was worked out by hand or by the textbook formulas in
 * `../mechanical/structural`, and the assertions are on those, not on a snapshot
 * of whatever the code produced.
 */
import { describe, expect, it } from 'vitest'
import { axialExtension } from '../mechanical/structural'
import {
  TRUSS_MATERIALS,
  deflectionScale,
  describeMemberForce,
  solveTruss,
  trussSpan,
  type TrussModel,
} from './truss'

const STEEL = TRUSS_MATERIALS['steel-s355'].elasticModulus
/** 100 mm × 100 mm solid bar, an area a lattice member is actually sold at. */
const AREA = 0.1 * 0.1

const symmetricRidge: TrussModel = {
  nodes: [
    { id: 'left', x: 0, y: 0 },
    { id: 'right', x: 4, y: 0 },
    { id: 'apex', x: 2, y: 2 },
  ],
  members: [
    { id: 'left-rafter', from: 'left', to: 'apex', area: AREA, material: 'steel-s355' },
    { id: 'right-rafter', from: 'right', to: 'apex', area: AREA, material: 'steel-s355' },
  ],
  /*
   * Both feet are held sideways: two bars meeting above two supports have nothing
   * else to stop the feet spreading, so with only one horizontal restraint the
   * frame is a mechanism rather than a ridge. The thrust the bearings take is the
   * whole reason a real roof puts a tie between its feet.
   */
  supports: [
    { node: 'left', holdsX: true, holdsY: true },
    { node: 'right', holdsX: true, holdsY: true },
  ],
  loads: [{ node: 'apex', fx: 0, fy: -10e3 }],
}

describe('solveTruss', () => {
  it('reproduces the hand answer for a symmetric two-bar ridge', () => {
    const analysis = solveTruss(symmetricRidge)
    expect(analysis.error).toBeNull()
    const result = analysis.result!

    /*
     * Each rafter is at 45°, so verticals balance as 2·|F|·sin45 = P and the bars
     * are squeezed: 7.071 kN compression. Each bearing takes P/2 upward and 5 kN
     * of inward thrust, and the two thrusts cancel across the frame.
     */
    expect(result.members['left-rafter'].force / 1e3).toBeCloseTo(-7.0711, 3)
    expect(result.members['right-rafter'].force / 1e3).toBeCloseTo(-7.0711, 3)
    expect(result.reactions.left.y).toBeCloseTo(5e3, 6)
    expect(result.reactions.right.y).toBeCloseTo(5e3, 6)
    expect(result.reactions.left.x).toBeCloseTo(5e3, 6)
    expect(result.reactions.right.x).toBeCloseTo(-5e3, 6)

    // With neither foot free to slide, the apex stiffness is the sum of the two
    // bars' axial stiffness along the load, which reduces to δ = P·L/(A·E).
    const length = Math.hypot(2, 2)
    expect(result.displacements.apex.y).toBeCloseTo((-10e3 * length) / (AREA * STEEL), 12)
    expect(result.displacements.apex.x).toBeCloseTo(0, 12)
    expect(result.maxDisplacementNode).toBe('apex')
  })

  it('agrees with the axial bar formula for a tie rod', () => {
    const model: TrussModel = {
      nodes: [
        { id: 'wall', x: 0, y: 0 },
        { id: 'tip', x: 1.5, y: 0 },
      ],
      members: [{ id: 'tie', from: 'wall', to: 'tip', area: AREA, material: 'steel-s355' }],
      supports: [
        { node: 'wall', holdsX: true, holdsY: true },
        { node: 'tip', holdsX: false, holdsY: true },
      ],
      loads: [{ node: 'tip', fx: 2e3, fy: 0 }],
    }
    const result = solveTruss(model).result!
    expect(result.displacements.tip.x).toBeCloseTo(axialExtension(2e3, 1.5, AREA, STEEL), 15)
    expect(result.members.tie.force).toBeCloseTo(2e3, 6)
    expect(result.reactions.wall.x).toBeCloseTo(-2e3, 6)
    // The y-restraints carry nothing when no load has a vertical component.
    expect(result.reactions.wall.y).toBeCloseTo(0, 9)
  })

  it('finds the zero-force members a joint without a load implies', () => {
    /*
     * Joint `c` carries two non-collinear bars and no load, so the textbook
     * rule says both are zero-force members — and the load at `b` runs into the
     * bottom chord alone. Getting this right is the check that the transformed
     * stiffness rows, not just the diagonal terms, are correct.
     */
    const model: TrussModel = {
      nodes: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 2, y: 0 },
        { id: 'c', x: 2, y: 1 },
      ],
      members: [
        { id: 'bottom', from: 'a', to: 'b', area: AREA, material: 'steel-s355' },
        { id: 'riser', from: 'b', to: 'c', area: AREA, material: 'steel-s355' },
        { id: 'diagonal', from: 'c', to: 'a', area: AREA, material: 'steel-s355' },
      ],
      supports: [
        { node: 'a', holdsX: true, holdsY: true },
        { node: 'b', holdsX: false, holdsY: true },
      ],
      loads: [{ node: 'b', fx: 1e3, fy: 0 }],
    }
    const result = solveTruss(model).result!
    expect(result.members.riser.force).toBeCloseTo(0, 6)
    expect(result.members.diagonal.force).toBeCloseTo(0, 6)
    expect(result.members.bottom.force).toBeCloseTo(1e3, 6)
    expect(result.reactions.a.x).toBeCloseTo(-1e3, 6)
  })

  it('names the joint that makes a mechanism a mechanism', () => {
    const model: TrussModel = {
      nodes: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 1, y: 0 },
        { id: 'c', x: 2, y: 0 },
      ],
      members: [
        { id: 'ab', from: 'a', to: 'b', area: AREA, material: 'steel-s355' },
        { id: 'bc', from: 'b', to: 'c', area: AREA, material: 'steel-s355' },
      ],
      /*
       * Every joint is held vertically and nothing holds the chain sideways, so
       * it slides along its own axis — the classic missing horizontal reaction.
       * The stiffness matrix knows this as a vanished pivot; the message has to
       * say which joint slides.
       */
      supports: [
        { node: 'a', holdsX: false, holdsY: true },
        { node: 'b', holdsX: false, holdsY: true },
        { node: 'c', holdsX: false, holdsY: true },
      ],
      loads: [{ node: 'c', fx: 1e3, fy: 0 }],
    }
    const analysis = solveTruss(model)
    expect(analysis.result).toBeNull()
    expect(analysis.error).toContain('mechanism')
    expect(analysis.error, 'the message has to say which joint moves').toContain('c')
    expect(analysis.error).toContain('horizontal')
  })

  it('refuses a model that holds every degree of freedom', () => {
    const model: TrussModel = {
      nodes: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 1, y: 0 },
      ],
      members: [{ id: 'ab', from: 'a', to: 'b', area: AREA, material: 'steel-s355' }],
      supports: [
        { node: 'a', holdsX: true, holdsY: true },
        { node: 'b', holdsX: true, holdsY: true },
      ],
      loads: [{ node: 'b', fx: 0, fy: -1e3 }],
    }
    const analysis = solveTruss(model)
    expect(analysis.result).toBeNull()
    expect(analysis.error).toMatch(/nothing can move/i)
  })

  it('throws on a model that is not a model', () => {
    const base: TrussModel = {
      nodes: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 1, y: 0 },
      ],
      members: [{ id: 'ab', from: 'a', to: 'b', area: AREA, material: 'steel-s355' }],
      supports: [
        { node: 'a', holdsX: true, holdsY: true },
        { node: 'b', holdsX: false, holdsY: true },
      ],
      loads: [],
    }
    expect(() => solveTruss({ ...base, nodes: [base.nodes[0]] })).toThrow(/at least two joints/)
    expect(() => solveTruss({ ...base, members: [] })).toThrow(/at least one member/)
    expect(() =>
      solveTruss({ ...base, members: [{ ...base.members[0], to: 'ghost' }] }),
    ).toThrow(/not a joint/)
    expect(() =>
      solveTruss({ ...base, members: [{ ...base.members[0], area: 0 }] }),
    ).toThrow(/positive cross-sectional area/)
    expect(() =>
      solveTruss({
        ...base,
        nodes: [base.nodes[0], base.nodes[0]],
      }),
    ).toThrow(/Duplicate joint id/)
    expect(() =>
      solveTruss({ ...base, supports: [{ node: 'a', holdsX: false, holdsY: false }] }),
    ).toThrow(/holds nothing/)
  })

  it('reports compression members that buckle before they yield', () => {
    const model: TrussModel = {
      nodes: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 3, y: 0 },
      ],
      // A 10 cm² bar over 3 m is slender enough to fail in elasticity first.
      members: [{ id: 'strut', from: 'a', to: 'b', area: 1e-5, material: 'steel-s355' }],
      supports: [
        { node: 'a', holdsX: true, holdsY: true },
        { node: 'b', holdsX: false, holdsY: true },
      ],
      loads: [{ node: 'b', fx: -5e3, fy: 0 }],
    }
    const result = solveTruss(model).result!
    expect(result.members.strut.force).toBeCloseTo(-5e3, 6)
    expect(result.members.strut.bucklingLoad).not.toBeNull()
    // Euler, pin-ended: π²EI/L² with I = πr⁴/4 for the equal-area circular bar.
    expect(result.members.strut.bucklingLoad! / 1e3).toBeLessThan(5)
    expect(result.members.strut.slenderness).toBeGreaterThan(100)
    expect(result.notes.join(' ')).toContain('buckles')
  })

  it('keeps reactions and loads in equilibrium on the ridge case', () => {
    const result = solveTruss(symmetricRidge).result!
    expect(result.equilibrium.appliedY + result.equilibrium.reactionY).toBeCloseTo(0, 6)
    expect(result.equilibrium.appliedX + result.equilibrium.reactionX).toBeCloseTo(0, 6)
  })
})

describe('truss geometry helpers', () => {
  it('measures the span across the joints, not the members', () => {
    expect(trussSpan(symmetricRidge.nodes)).toBeCloseTo(4, 12)
    expect(trussSpan([])).toBe(0)
  })

  it('scales a deflected shape to a fortieth of the span', () => {
    expect(deflectionScale(0, 4)).toBe(1)
    expect(deflectionScale(1, 0)).toBe(1)
    // 1 mm on a 4 m span is drawn at ×100, which lands the apex 0.1 m out — a
    // fortieth of the span: visible as a shape, not mistaken for the structure.
    expect(deflectionScale(1e-3, 4)).toBeCloseTo(100, 9)
    // A rigid model is not drawn with an infinite multiplier.
    expect(deflectionScale(1e-12, 4)).toBe(5000)
  })

  it('says tension and compression instead of a bare sign', () => {
    expect(describeMemberForce({ force: 2500, stress: 0, utilisation: 0, slenderness: 0, bucklingLoad: null }))
      .toBe('2.50 kN tension')
    expect(describeMemberForce({ force: -1000, stress: 0, utilisation: 0, slenderness: 0, bucklingLoad: 5e3 }))
      .toBe('1.00 kN compression')
  })
})
