/**
 * Preset trusses have to be structures, not drawings of structures.
 *
 * Each one is counted (`m + r = 2j`), solved, and then read for the behaviour
 * the textbook says that form has: a Pratt's diagonals in tension, a canopy
 * bracket's strut in compression, a king-post tie pulling its wall plates
 * together. A preset that drops in as a mechanism, or that solves with the wrong
 * sign somewhere, is a defect in the shipped model — not in the solver's test.
 */
import { describe, expect, it } from 'vitest'
import { solveTruss } from './truss'
import { TRUSS_PRESETS, trussDeterminacy, trussPresetById } from './trussPresets'

describe('truss presets', () => {
  it.each(TRUSS_PRESETS.map((preset) => [preset.id, preset] as const))('%s is statically determinate', (_id, preset) => {
    const { kind, members, restraints, joints } = trussDeterminacy(preset.model)
    expect(kind, `${preset.id}: m=${members} r=${restraints} j=${joints}`).toBe('determinate')
  })

  it.each(TRUSS_PRESETS.map((preset) => [preset.id, preset] as const))('%s solves and closes on its load', (_id, preset) => {
    const analysis = solveTruss(preset.model)
    expect(analysis.error, `${preset.id} must not be a mechanism`).toBeNull()
    const result = analysis.result!
    const applied = preset.model.loads.reduce((sum, load) => sum + load.fy, 0)
    expect(result.equilibrium.reactionY).toBeCloseTo(-applied, 3)
    expect(result.equilibrium.reactionX).toBeCloseTo(-result.equilibrium.appliedX, 6)
    expect(result.maxDisplacement).toBeGreaterThan(0)
    expect(result.maxDisplacement).toBeLessThan(preset.span / 100)
  })

  it('the Pratt carries its deck load with every diagonal in tension', () => {
    const result = solveTruss(trussPresetById('pratt-footbridge')!.model).result!
    const diagonals = Object.entries(result.members).filter(([id]) => id.startsWith('diag-'))
    expect(diagonals).toHaveLength(6)
    for (const [id, demand] of diagonals) {
      expect(demand.force, `${id} should hang the deck in tension`).toBeGreaterThan(0)
    }
    // The midspan bottom chord is the biggest tension member in the girder.
    expect(result.members['bottom-2'].force).toBeGreaterThan(result.members['bottom-0'].force)
    // Bearings take half the load each on a symmetric girder with symmetric load.
    expect(result.reactions.b0.y).toBeCloseTo(result.reactions.b6.y, 3)
    expect(result.reactions.b0.y).toBeCloseTo(45.5e3, 3)
  })

  it('the Warren puts its top chord in compression and its bottom chord in tension', () => {
    const result = solveTruss(trussPresetById('warren-girder')!.model).result!
    expect(result.members['top-1'].force).toBeLessThan(0)
    expect(result.members['bottom-1'].force).toBeGreaterThan(0)
    const web = Object.entries(result.members).filter(([id]) => id.startsWith('rise-'))
    expect(web.length).toBe(5)
  })

  it('the king-post roof ties its rafters and carries its ridge load in the rafters', () => {
    const result = solveTruss(trussPresetById('kingpost-roof')!.model).result!
    // A tie beam under a pitched rafter is in tension, and it is the member that
    // stops the walls being pushed out.
    expect(result.members['tie-left'].force).toBeGreaterThan(0)
    expect(result.members['tie-right'].force).toBeGreaterThan(0)
    expect(result.members['rafter-left'].force).toBeLessThan(0)
    expect(result.reactions['left-foot'].y).toBeCloseTo(2.5e3, 6)
    expect(result.reactions['right-foot'].y).toBeCloseTo(2.5e3, 6)
    // Horizontal thrust at the feet is what the tie exists to remove.
    expect(result.reactions['left-foot'].x).toBeCloseTo(0, 6)
    // The determinate answer for a load applied at the ridge joint itself: the
    // rafters span past the post, so the post carries nothing.
    expect(result.members['king-post'].force).toBeCloseTo(0, 6)
  })

  it('the king-post hangs a load on the middle of its tie in tension', () => {
    const preset = trussPresetById('kingpost-roof')!
    const analysis = solveTruss({ ...preset.model, loads: [{ node: 'tie-middle', fx: 0, fy: -5e3 }] })
    expect(analysis.error).toBeNull()
    const result = analysis.result!
    // The post is the only vertical at that joint, so it takes the whole load —
    // as a hanger, which is why king posts are checked in tension perpendicular
    // to grain rather than for buckling.
    expect(result.members['king-post'].force).toBeCloseTo(5e3, 6)
    expect(result.reactions['left-foot'].y).toBeCloseTo(2.5e3, 6)
    expect(result.reactions['right-foot'].y).toBeCloseTo(2.5e3, 6)
    // The ridge is pulled down, so the rafters still squeeze the feet outwards
    // and the tie still works.
    expect(result.members['rafter-left'].force).toBeLessThan(0)
    expect(result.members['tie-left'].force).toBeGreaterThan(0)
  })

  it('the canopy bracket hangs from its boom and stands on its strut', () => {
    const result = solveTruss(trussPresetById('canopy-bracket')!.model).result!
    expect(result.members.boom.force).toBeGreaterThan(0)
    expect(result.members.strut.force).toBeLessThan(0)
    expect(result.members.strut.bucklingLoad).not.toBeNull()
    // The whole point of sizing the strut: it must not be the member that buckles.
    expect(result.members.strut.bucklingLoad!).toBeGreaterThan(Math.abs(result.members.strut.force))
    expect(result.notes).toEqual([])
  })

  it('every preset names real sections and materials the panel can quote', () => {
    for (const preset of TRUSS_PRESETS) {
      expect(preset.name.length).toBeGreaterThan(3)
      expect(preset.use.length).toBeGreaterThan(8)
      expect(preset.span).toBeGreaterThan(0)
      for (const member of preset.model.members) {
        expect(member.area, `${preset.id}/${member.id}`).toBeGreaterThan(0)
        expect(member.from, `${preset.id}/${member.id}`).not.toBe(member.to)
      }
      const jointIds = new Set(preset.model.nodes.map((node) => node.id))
      for (const member of preset.model.members) {
        expect(jointIds.has(member.from), `${preset.id}/${member.id} from`).toBe(true)
        expect(jointIds.has(member.to), `${preset.id}/${member.id} to`).toBe(true)
      }
      for (const support of preset.model.supports) {
        expect(jointIds.has(support.node), `${preset.id} support`).toBe(true)
      }
    }
    expect(trussPresetById('no-such-truss')).toBeUndefined()
  })

  it('keeps the member list free of duplicate bars', () => {
    for (const preset of TRUSS_PRESETS) {
      const pairs = preset.model.members.map((member) => [member.from, member.to].sort().join('/'))
      expect(new Set(pairs).size, preset.id).toBe(pairs.length)
    }
  })
})
