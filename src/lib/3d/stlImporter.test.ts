import { describe, expect, it } from 'vitest'
import { MAX_MESH_TRIANGLES, MeshImportError, shellProblem } from './meshMeasure'
import { parseStl } from './stlImporter'

type Triangle = [[number, number, number], [number, number, number], [number, number, number]]

// Unit tetrahedron, outward winding on every face. Volume 1/6, area 3/2 + √3/2.
const TETRA: Triangle[] = [
  [[0, 0, 0], [0, 1, 0], [1, 0, 0]],
  [[0, 0, 0], [0, 0, 1], [0, 1, 0]],
  [[0, 0, 0], [1, 0, 0], [0, 0, 1]],
  [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
]

// 2 x 3 x 4 box: volume 24 mm³, surface 52 mm².
const BOX: Triangle[] = [
  [[0, 0, 0], [0, 3, 0], [2, 3, 0]],
  [[0, 0, 0], [2, 3, 0], [2, 0, 0]],
  [[0, 0, 4], [2, 0, 4], [2, 3, 4]],
  [[0, 0, 4], [2, 3, 4], [0, 3, 4]],
  [[0, 0, 0], [2, 0, 0], [2, 0, 4]],
  [[0, 0, 0], [2, 0, 4], [0, 0, 4]],
  [[0, 3, 0], [2, 3, 4], [2, 3, 0]],
  [[0, 3, 0], [0, 3, 4], [2, 3, 4]],
  [[0, 0, 0], [0, 3, 4], [0, 3, 0]],
  [[0, 0, 0], [0, 0, 4], [0, 3, 4]],
  [[2, 0, 0], [2, 3, 0], [2, 3, 4]],
  [[2, 0, 0], [2, 3, 4], [2, 0, 4]],
]

function ascii(triangles: Triangle[], name = 'test'): string {
  const lines = [`solid ${name}`]
  for (const triangle of triangles) {
    lines.push('  facet normal 0 0 0', '    outer loop')
    for (const [x, y, z] of triangle) lines.push(`      vertex ${x} ${y} ${z}`)
    lines.push('    endloop', '  endfacet')
  }
  lines.push(`endsolid ${name}`)
  return lines.join('\n')
}

function binary(triangles: Triangle[], header = 'binary test'): ArrayBuffer {
  const buffer = new ArrayBuffer(84 + triangles.length * 50)
  const view = new DataView(buffer)
  for (let i = 0; i < Math.min(header.length, 80); i += 1) {
    view.setUint8(i, header.charCodeAt(i))
  }
  view.setUint32(80, triangles.length, true)
  let offset = 84
  for (const triangle of triangles) {
    offset += 12 // facet normal left as zeros on purpose
    for (const [x, y, z] of triangle) {
      view.setFloat32(offset, x, true)
      view.setFloat32(offset + 4, y, true)
      view.setFloat32(offset + 8, z, true)
      offset += 12
    }
    offset += 2
  }
  return buffer
}

describe('parseStl measurement', () => {
  it('measures an ASCII tetrahedron as a closed solid', () => {
    const mesh = parseStl(ascii(TETRA))
    expect(mesh.format).toBe('ascii')
    expect(mesh.triangleCount).toBe(4)
    expect(mesh.positions).toHaveLength(36)
    expect(mesh.normals).toHaveLength(36)
    expect(mesh.assumedUnit).toBe('mm')
    expect(mesh.bounds.size).toEqual([1, 1, 1])
    expect(mesh.volumeMm3).toBeCloseTo(1 / 6, 10)
    expect(mesh.surfaceAreaMm2).toBeCloseTo(1.5 + Math.sqrt(3) / 2, 6)
    expect(mesh.degenerateTriangles).toBe(0)
    expect(mesh.topology).toEqual({
      analysed: true,
      watertight: true,
      openEdges: 0,
      nonManifoldEdges: 0,
      inconsistentEdges: 0,
    })
  })

  it('accepts the same mesh as a binary buffer and rebuilds normals from winding', () => {
    const mesh = parseStl(binary(TETRA))
    expect(mesh.format).toBe('binary')
    expect(mesh.triangleCount).toBe(4)
    expect(mesh.volumeMm3).toBeCloseTo(1 / 6, 6)
    expect(mesh.topology.watertight).toBe(true)
    // Base triangle (0,0,0) → (0,1,0) → (1,0,0) faces −Z.
    expect([mesh.normals[0], mesh.normals[1], mesh.normals[2]]).toEqual([0, 0, -1])
  })

  it('detects binary data whose header begins with the word solid', () => {
    const mesh = parseStl(binary(BOX, 'solid fake binary header'))
    expect(mesh.format).toBe('binary')
    expect(mesh.triangleCount).toBe(12)
  })

  it('measures a box and reports it closed', () => {
    const mesh = parseStl(ascii(BOX))
    expect(mesh.bounds.min).toEqual([0, 0, 0])
    expect(mesh.bounds.max).toEqual([2, 3, 4])
    expect(mesh.volumeMm3).toBeCloseTo(24, 6)
    expect(mesh.surfaceAreaMm2).toBeCloseTo(52, 6)
    expect(mesh.topology.watertight).toBe(true)
  })

  it('counts degenerate facets and open edges without losing the mesh', () => {
    const soup: Triangle[] = [
      [[0, 0, 0], [1, 0, 0], [1, 1, 0]],
      [[0, 0, 0], [1, 1, 0], [0, 1, 0]],
      [[0.5, 0.5, 0], [0.5, 0.5, 0], [0.5, 0.5, 0]],
    ]
    const mesh = parseStl(ascii(soup))
    expect(mesh.triangleCount).toBe(3)
    expect(mesh.degenerateTriangles).toBe(1)
    expect(mesh.surfaceAreaMm2).toBeCloseTo(1, 10)
    expect(mesh.topology.openEdges).toBe(4)
    expect(mesh.topology.watertight).toBe(false)
    expect(shellProblem(mesh)).toBe('Not a closed solid: 4 open edges')
  })

  it('flags two triangles sharing an edge in the same direction', () => {
    const flipped: Triangle[] = [
      [[0, 0, 0], [1, 0, 0], [1, 1, 0]],
      [[0, 0, 0], [0, 1, 0], [1, 1, 0]],
    ]
    const mesh = parseStl(ascii(flipped))
    expect(mesh.topology.inconsistentEdges).toBe(1)
    expect(mesh.topology.openEdges).toBe(4)
    expect(mesh.topology.watertight).toBe(false)
    expect(shellProblem(mesh)).toBe('Not a closed solid: 4 open edges, 1 reversed face')
  })
})

describe('parseStl refusals', () => {
  it('rejects text that is not an ASCII solid', () => {
    expect(() => parseStl('not an stl')).toThrow(/must begin with "solid/)
    expect(() => parseStl('solid x\n facet normal 0 0 1\n endsolid x')).toThrow(/no "vertex" lines/)
    const noFacets = 'solid x\n outer loop\n vertex 0 0 0\n vertex 1 0 0\n vertex 0 1 0\n endloop\nendsolid x'
    expect(() => parseStl(noFacets)).toThrow(/no facets/)
  })

  it('names STEP files instead of misreading them', () => {
    expect(() => parseStl('ISO-10303-21;\nHEADER;')).toThrow(/STEP file/)
  })

  it('rejects a truncated ASCII solid', () => {
    const text = ascii(TETRA).replace('endsolid test', '')
    expect(() => parseStl(text)).toThrow(/truncated/)
  })

  it('rejects ASCII vertices that are not finite numbers', () => {
    const text = ascii(TETRA).replace('vertex 0 1 0', 'vertex 0 NaN 0')
    expect(() => parseStl(text)).toThrow(/non-numeric coordinate/)
  })

  it('rejects ASCII facet counts that do not match the vertex count', () => {
    const text = ascii(TETRA).replace('    outer loop\n', '')
    expect(() => parseStl(text)).toThrow(/facet loops for/)
  })

  it('rejects a truncated binary payload', () => {
    const buffer = binary(TETRA).slice(0, 84 + 50)
    expect(() => parseStl(buffer)).toThrow(/Not an STL file: the binary header at byte 80 declares 4 triangles/)
  })

  it('does not read a stray binary header out of a file that is not an STL', () => {
    const html = new TextEncoder().encode(`<html>${'x'.repeat(200)}</html>`)
    expect(() => parseStl(html.buffer)).toThrow(/Not an STL file/)
  })

  it('rejects an empty binary solid', () => {
    const buffer = new ArrayBuffer(84)
    expect(() => parseStl(buffer)).toThrow(/no triangles/)
  })

  it('rejects a binary triangle with a non-finite coordinate', () => {
    const buffer = binary(TETRA)
    new DataView(buffer).setFloat32(84 + 12, Number.NaN, true)
    expect(() => parseStl(buffer)).toThrow(/triangle 1 has a non-finite coordinate/)
  })

  it('names an OBJ passed under an .stl extension instead of blaming its bytes', () => {
    const wavefront = new TextEncoder().encode('# housing\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n')
    expect(() => parseStl(wavefront.buffer)).toThrow(/This is an OBJ file, not an STL/)
  })

  it('refuses meshes above the import ceiling', () => {
    const count = MAX_MESH_TRIANGLES + 1
    const buffer = new ArrayBuffer(84 + count * 50)
    new DataView(buffer).setUint32(80, count, true)
    expect(() => parseStl(buffer)).toThrow(new RegExp(`at most ${MAX_MESH_TRIANGLES}`))
    expect(() => parseStl(new ArrayBuffer(0))).toThrow(/empty/)
    expect(() => parseStl('   ')).toThrow(/empty/)
  })

  it('throws a typed error so callers can report it verbatim', () => {
    try {
      parseStl('garbage')
      throw new Error('expected parseStl to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(MeshImportError)
      expect((error as MeshImportError).name).toBe('MeshImportError')
    }
  })
})
