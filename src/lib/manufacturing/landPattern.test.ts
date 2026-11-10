import { describe, expect, it } from 'vitest'
import { resolveFootprint } from './footprintLibrary'
import { landShapeOf, shapeGapMm } from '../geometry/landShape'
import { generatedFootprint, primaryPackage } from './landPattern'

/** The finest clearance this CAD routes with, same figure the library audits at. */
const MIN_LAND_GAP_MM = 0.15

/** Two lands in the same row must leave copper between them, or the part shorts. */
const rowGaps = (footprint: ReturnType<typeof generatedFootprint>): number[] => {
  if (!footprint) throw new Error('no footprint generated')
  const rows = new Map<number, number[]>()
  for (const pad of footprint.pads) {
    if (pad.id === 'padthermal') continue
    const key = pad.position.x
    rows.set(key, [...(rows.get(key) ?? []), pad.position.y])
  }
  return [...rows.values()].flatMap((column) => {
    const sorted = [...column].sort((a, b) => a - b)
    return sorted.slice(1).map((y, index) => y - sorted[index])
  })
}

describe('generatedFootprint', () => {
  it('gives a 16-pin SOIC the sixteen lands it was missing', () => {
    const soic = generatedFootprint('SOIC-16 (DW, 10.30 x 7.50 mm) / SSOP-16 (DBQ)')
    expect(soic).toBeDefined()
    expect(soic!.pads).toHaveLength(16)
    expect(soic!.pads.map((pad) => pad.id)).toEqual(
      Array.from({ length: 16 }, (_, index) => `pad${index + 1}`),
    )
    // Two rows of eight, symmetric about the body, 1.27 mm apart along the row.
    const columns = new Set(soic!.pads.map((pad) => pad.position.x))
    expect([...columns].sort((a, b) => a - b)).toEqual([-4.5, 4.5])
    expect(soic!.pads[0].position.y).toBeGreaterThan(0)
    expect(soic!.pads[8].position.y).toBeLessThan(0)
    for (const gap of rowGaps(soic)) expect(gap).toBeGreaterThan(0.5)
  })

  it('lays the shrink families at their own pitch, not at the library default', () => {
    const tssop = generatedFootprint('TSSOP-16 (PW)')
    expect(tssop?.pads).toHaveLength(16)
    for (const gap of rowGaps(tssop)) expect(gap).toBeCloseTo(0.65, 6)
    // A 0.65 mm pitch cannot carry a 0.6 mm land with a clearance between them.
    expect(tssop?.pads[0].size.height).toBeLessThan(0.65)
  })

  it('adds the exposed pad a QFN needs and keeps its lands on four sides', () => {
    const qfn = generatedFootprint('QFN-24 (4 x 4 x 0.85 mm) with exposed VSS pad')
    expect(qfn).toBeDefined()
    expect(qfn!.pads).toHaveLength(25)
    const thermal = qfn!.pads.find((pad) => pad.id === 'padthermal')
    expect(thermal?.position).toEqual({ x: 0, y: 0 })
    expect(thermal!.size.width).toBeGreaterThan(2)
    expect(qfn!.metadata.thermalPad).toBe(true)
    expect(Math.abs(qfn!.dimensions.width - qfn!.dimensions.height)).toBeLessThan(0.001)
  })

  it('reads a pin count off the name only where the digits are pins', () => {
    // SOT-23 is a 3-pin part whose name carries a JEDEC designator.
    expect(generatedFootprint('SOT-23', 3)?.pads).toHaveLength(3)
    expect(generatedFootprint('SOT-23')).toBeUndefined()
    expect(generatedFootprint('SOT-23-5 (DBV)', 5)?.pads).toHaveLength(5)
    expect(generatedFootprint('TO-220 (NDE)', 3)).toBeUndefined()
    expect(generatedFootprint('NOT-A-PACKAGE', 8)).toBeUndefined()
  })

  it('keeps every land inside the courtyard it declares', () => {
    for (const text of ['DIP-28', 'LQFP-64', 'SOIC-8 (DD)', 'VSSOP-8 (DGK)']) {
      const footprint = generatedFootprint(text)
      expect(footprint, `nothing generated for ${text}`).toBeDefined()
      const [corner] = footprint!.courtyard ?? []
      for (const pad of footprint!.pads) {
        expect(Math.abs(pad.position.x) + pad.size.width / 2).toBeLessThanOrEqual(Math.abs(corner.x) + 0.001)
        expect(Math.abs(pad.position.y) + pad.size.height / 2).toBeLessThanOrEqual(Math.abs(corner.y) + 0.001)
      }
      for (const pad of footprint!.pads) {
        expect(pad.size.width).toBeGreaterThan(0)
        expect(pad.size.height).toBeGreaterThan(0)
      }
    }
  })

  it('drills the through-hole families it draws', () => {
    const dip = generatedFootprint('DIP-16')
    expect(dip?.pads).toHaveLength(16)
    expect(dip?.pads[0].shape).toBe('circle')
    expect(dip?.pads[0].drillDiameter).toBe(0.8)
    expect(dip?.pads[0].layers).toContain('bottom_copper')
  })
})

describe('generatedFootprint geometry', () => {
  it('never lays copper on copper, at any lead count', () => {
    // The same measurement the hand-built library is audited with. A generated
    // pattern whose lands touch is a short between two pins that no amount of
    // routing can undo, and it is the failure mode a parametric generator brings
    // with it: the row that fits at eight leads does not automatically fit at
    // eighty.
    const offenders: string[] = []
    const counts = [2, 3, 4, 5, 6, 8, 10, 14, 16, 20, 24, 28, 32, 40, 48, 56, 64]
    for (const text of [
      'SOIC', 'TSSOP', 'VSSOP', 'X2SON', 'DSBGA', 'QFN', 'TQFP', 'DIP', 'SOT-23',
    ]) {
      for (const pins of counts) {
        const footprint = generatedFootprint(text, pins)
        if (!footprint) continue
        for (let i = 0; i < footprint.pads.length; i++) {
          for (let j = i + 1; j < footprint.pads.length; j++) {
            const a = footprint.pads[i]
            const b = footprint.pads[j]
            if (!a.layers.some((layer) => b.layers.includes(layer))) continue
            const gap = shapeGapMm(
              landShapeOf({ widthMm: a.size.width, depthMm: a.size.height, shape: a.shape }),
              landShapeOf({ widthMm: b.size.width, depthMm: b.size.height, shape: b.shape }),
              b.position.x - a.position.x,
              b.position.y - a.position.y,
            )
            if (gap < MIN_LAND_GAP_MM - 1e-9) {
              offenders.push(`${text}-${pins}: ${a.id}/${b.id} gap ${gap.toFixed(3)} mm`)
            }
          }
        }
      }
    }
    expect(offenders.slice(0, 12)).toEqual([])
  })

  it('keeps generated lands inside the courtyard they declare', () => {
    const offenders: string[] = []
    for (const text of ['SOIC', 'TSSOP', 'QFN', 'TQFP', 'DIP', 'SOT-23', 'DSBGA']) {
      for (let pins = 4; pins <= 64; pins += 4) {
        const footprint = generatedFootprint(text, pins)
        const courtyard = footprint?.courtyard
        if (!footprint || !courtyard?.length) continue
        const maxX = Math.max(...courtyard.map((point) => point.x))
        const maxY = Math.max(...courtyard.map((point) => point.y))
        for (const pad of footprint.pads) {
          const reachX = Math.abs(pad.position.x) + pad.size.width / 2
          const reachY = Math.abs(pad.position.y) + pad.size.height / 2
          if (reachX > maxX + 1e-9 || reachY > maxY + 1e-9) {
            offenders.push(`${text}-${pins}: ${pad.id} reaches ${reachX.toFixed(2)} x ${reachY.toFixed(2)}`)
          }
        }
      }
    }
    expect(offenders.slice(0, 12)).toEqual([])
  })
})

describe('resolveFootprint with a generated fallback', () => {
  it('prefers the hand-built pattern when the library has one', () => {
    expect(resolveFootprint('SOIC-8')?.id).toBe('soic_8')
    expect(resolveFootprint('SOT-23')?.id).toBe('sot_23')
  })

  it('falls back to the family pattern before falling back to a category', () => {
    // What the catalog puts on the board: the datasheet package string, with the
    // symbol's pin count to lay out.
    const generated = resolveFootprint('SOIC-16 (DW, 10.30 x 7.50 mm)', 'interface', 16)
    expect(generated?.id).toBe('generated_SOIC-16_16')
    expect(generated?.pads).toHaveLength(16)
    // A string that names no package still resolves the way it always did.
    expect(resolveFootprint('not-real', 'ic')?.category).toBe('ic')
    expect(resolveFootprint('not-real', 'not-a-family')).toBeUndefined()
  })

  it('refuses a category fallback that would drop nets', () => {
    // With no package in the string only the family is left, and the first IC
    // pattern in the library is an 8-land SOIC. Handing that to a 16-pin symbol
    // loses eight nets without a word about it, so a counted lookup has to land on
    // a pattern with the same number of lands.
    expect(resolveFootprint('not-real', 'ic')?.pads).toHaveLength(8)
    expect(resolveFootprint('not-real', 'ic', 8)?.pads).toHaveLength(8)
    expect(resolveFootprint('not-real', 'ic', 16)?.pads).toHaveLength(16)
    expect(resolveFootprint('not-real', 'ic', 13)).toBeUndefined()
  })
})

describe('primaryPackage', () => {
  it('takes the first option and drops its orderable suffix', () => {
    expect(primaryPackage('SOIC-16 (DW, 10.30 x 7.50 mm) / SSOP-16 (DBQ, 4.90 x 3.90 mm)')).toBe('SOIC-16')
    expect(primaryPackage('SSOP-8 (DCT) / VSSOP-8 (DCU)')).toBe('SSOP-8')
    expect(primaryPackage('QFN-24')).toBe('QFN-24')
    expect(primaryPackage('TO-263 (D2PAK)')).toBe('TO-263')
  })
})
