import { describe, expect, it } from 'vitest'
import { boxFaces, holePrism, stepAssemblyDocument, stepDocument } from './stepGeometry'

const count = (text: string, token: string): number => text.split(token).length - 1

describe('STEP geometry primitives', () => {
  it('builds six four-point box faces spanning the requested bounds', () => {
    const faces = boxFaces(0, 0, 0, 10, 20, 30)
    expect(faces).toHaveLength(6)
    expect(faces.every(face => face.length === 4)).toBe(true)
    const xs = faces.flat().map(point => point[0])
    const ys = faces.flat().map(point => point[1])
    const zs = faces.flat().map(point => point[2])
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([0, 10])
    expect([Math.min(...ys), Math.max(...ys)]).toEqual([0, 20])
    expect([Math.min(...zs), Math.max(...zs)]).toEqual([0, 30])
  })

  it('builds an N-gon prism for a hole with the requested diameter', () => {
    const faces = holePrism(5, 5, 0, 2, 4, 12)
    expect(faces).toHaveLength(12)
    for (const face of faces) {
      expect(face).toHaveLength(4)
      for (const [x, y, z] of face) {
        expect(Math.hypot(x - 5, y - 5)).toBeCloseTo(2, 9)
        expect([0, 2]).toContain(z)
      }
    }
  })
})

describe('STEP assembly document', () => {
  it('emits one closed shell and solid brep per part', () => {
    const text = stepAssemblyDocument([
      { name: 'lid', faces: boxFaces(0, 0, 0, 1, 1, 1) },
      { name: 'base', faces: boxFaces(0, 0, -2, 1, 1, 0) },
    ], 'enclosure')

    expect(text.startsWith('ISO-10303-21;')).toBe(true)
    expect(text.endsWith('END-ISO-10303-21;')).toBe(true)
    expect(text).toContain("FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));")
    expect(count(text, 'CLOSED_SHELL')).toBe(2)
    expect(count(text, 'MANIFOLD_SOLID_BREP')).toBe(2)
    expect(text).toContain("MANIFOLD_SOLID_BREP('lid'")
    expect(text).toContain("MANIFOLD_SOLID_BREP('base'")
  })

  it('defines every referenced entity and numbers them monotonically', () => {
    const text = stepDocument(boxFaces(0, 0, 0, 1, 1, 1), 'cube')
    const definitions = [...text.matchAll(/^#(\d+)=/gm)].map(match => Number(match[1]))
    expect(definitions.length).toBeGreaterThan(0)
    expect(definitions).toEqual([...definitions].sort((a, b) => a - b))
    expect(new Set(definitions).size).toBe(definitions.length)

    const references = [...text.matchAll(/\((#\d+(?:,#\d+)*)\)/g)]
      .flatMap(match => match[1].split(','))
      .map(reference => Number(reference.slice(1)))
    for (const reference of references) expect(definitions).toContain(reference)
  })

  it('escapes quotes in names and is deterministic across calls', () => {
    const first = stepDocument(boxFaces(0, 0, 0, 1, 1, 1), "O'Brien's part")
    const second = stepDocument(boxFaces(0, 0, 0, 1, 1, 1), "O'Brien's part")
    expect(first).toContain("O''Brien''s part")
    // Entity numbering restarts per document so output is reproducible.
    expect(first).toBe(second)
  })

  it('rounds coordinates to four decimals', () => {
    const text = stepDocument([[[0, 0, 0], [1 / 3, 0, 0], [0, 1 / 7, 0]]], 'tiny')
    expect(text).toContain('(0.3333,0,0)')
    expect(text).toContain('(0,0.1429,0)')
  })
})
