import { describe, expect, it } from 'vitest'
import { MAX_MESH_TRIANGLES, MeshImportError, readMeshFile } from './meshMeasure'
import { parseObj } from './objImporter'

type Triangle = [[number, number, number], [number, number, number], [number, number, number]]

// 2 x 3 x 4 box: volume 24 mm³, surface 52 mm². The same fixture the STL tests
// measure, so an OBJ of this shape must report the identical verdict.
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

/** Flat, duplicate-free wavefront text: every box corner is declared once. */
function obj(triangles: Triangle[]): string {
  const vertices: string[] = []
  const seen = new Map<string, number>()
  const faces: string[] = []
  for (const triangle of triangles) {
    const indices = triangle.map(([x, y, z]) => {
      const key = `${x}|${y}|${z}`
      const existing = seen.get(key)
      if (existing !== undefined) return existing
      const index = seen.size + 1
      seen.set(key, index)
      vertices.push(`v ${x} ${y} ${z}`)
      return index
    })
    faces.push(`f ${indices.join(' ')}`)
  }
  return ['# box', ...vertices, '', ...faces].join('\n')
}

describe('parseObj measurement', () => {
  it('measures a closed box the same way the STL reader does', () => {
    const mesh = parseObj(obj(BOX))
    expect(mesh.format).toBe('obj')
    expect(mesh.assumedUnit).toBe('mm')
    expect(mesh.triangleCount).toBe(12)
    expect(mesh.positions).toHaveLength(108)
    expect(mesh.bounds.min).toEqual([0, 0, 0])
    expect(mesh.bounds.max).toEqual([2, 3, 4])
    expect(mesh.volumeMm3).toBeCloseTo(24, 6)
    expect(mesh.surfaceAreaMm2).toBeCloseTo(52, 6)
    expect(mesh.degenerateTriangles).toBe(0)
    expect(mesh.topology).toEqual({
      analysed: true,
      watertight: true,
      openEdges: 0,
      nonManifoldEdges: 0,
      inconsistentEdges: 0,
    })
  })

  it('ignores texture coordinates, vertex normals and material directives', () => {
    const text = [
      'mtllib box.mtl',
      'o box',
      'g sides',
      's 1',
      'usemtl steel',
      '# a comment',
      'v 0 0 0',
      'v 2 0 0',
      'v 2 3 0',
      'v 0 3 0',
      'vt 0 0',
      'vn 0 0 -1',
      'f 1/1/1 2/1/1 3/1/1 4/1/1',
    ].join('\n')
    const mesh = parseObj(text)
    // The quad fans into two triangles, and both face +Z regardless of the vn line.
    expect(mesh.triangleCount).toBe(2)
    expect(mesh.surfaceAreaMm2).toBeCloseTo(6, 10)
    expect([mesh.normals[0], mesh.normals[1], mesh.normals[2]]).toEqual([0, 0, 1])
    expect(mesh.topology.openEdges).toBe(4)
  })

  it('reads negative face indices relative to the vertices defined so far', () => {
    const mesh = parseObj('v 0 0 0\nv 1 0 0\nv 0 1 0\nf -3 -2 -1')
    expect(mesh.triangleCount).toBe(1)
    expect(Array.from(mesh.positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0])
  })

  it('fans a polygon into triangles that keep the ring winding', () => {
    // A unit square split by the fan diagonal, open on four edges.
    const mesh = parseObj('v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4')
    expect(mesh.triangleCount).toBe(2)
    expect(mesh.surfaceAreaMm2).toBeCloseTo(1, 10)
    expect(mesh.topology.openEdges).toBe(4)
    expect(mesh.topology.watertight).toBe(false)
  })

  it('accepts the file as bytes and still measures it', () => {
    const mesh = parseObj(new TextEncoder().encode(obj(BOX)).buffer)
    expect(mesh.format).toBe('obj')
    expect(mesh.topology.watertight).toBe(true)
    expect(mesh.volumeMm3).toBeCloseTo(24, 6)
  })
})

describe('parseObj refusals', () => {
  it('names a mesh in another format instead of misreading it', () => {
    expect(() => parseObj('ISO-10303-21;\nHEADER;')).toThrow(/STEP file/)
    expect(() => parseObj('solid cube\n  facet normal 0 0 1\n  outer loop\n  vertex 0 0 0\n endloop\nendsolid cube')).toThrow(
      /ASCII STL/,
    )
    const stlBuffer = new ArrayBuffer(84 + 4 * 50)
    new DataView(stlBuffer).setUint32(80, 4, true)
    expect(() => parseObj(stlBuffer)).toThrow(/binary STL/)
  })

  it('refuses an empty or faceless file', () => {
    expect(() => parseObj('   ')).toThrow(/empty/)
    expect(() => parseObj(new ArrayBuffer(0))).toThrow(/empty/)
    expect(() => parseObj('v 0 0 0\nv 1 0 0\nv 0 1 0')).toThrow(/no faces/)
  })

  it('refuses faces that cannot enclose anything', () => {
    expect(() => parseObj('v 0 0 0\nv 1 0 0\nf 1 2')).toThrow(/needs at least 3/)
  })

  it('refuses face indices that were never defined', () => {
    expect(() => parseObj('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 4')).toThrow(/references vertex index 4/)
    expect(() => parseObj('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 -4')).toThrow(/references vertex index -4/)
    expect(() => parseObj('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 1.5')).toThrow(/fractional vertex index/)
  })

  it('refuses coordinates that are not numbers', () => {
    expect(() => parseObj('v 0 abc 0\nv 1 0 0\nv 0 1 0\nf 1 2 3')).toThrow(/vertex 1 coordinate has a non-numeric value "abc"/)
    expect(() => parseObj('v 0 0\nv 1 0 0\nf 1 2 1')).toThrow(/fewer than three coordinates/)
  })

  it('refuses an empty face index where a position is required', () => {
    // Number("") is 0, so this is caught as an out-of-range index rather than as
    // a non-numeric token; OBJ indices start at 1.
    expect(() => parseObj('v 0 0 0\nv 1 0 0\nv 0 1 0\nf /1 /2 /3')).toThrow(/references vertex index 0/)
  })

  it('refuses meshes above the import ceiling', () => {
    const faces = Array.from({ length: MAX_MESH_TRIANGLES + 1 }, () => 'f 1 2 3').join('\n')
    expect(() => parseObj(`v 0 0 0\nv 1 0 0\nv 0 1 0\n${faces}`)).toThrow(
      new RegExp(`at most ${MAX_MESH_TRIANGLES}`),
    )
  })

  it('throws a typed error so callers can report it verbatim', () => {
    try {
      parseObj('garbage')
      throw new Error('expected parseObj to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(MeshImportError)
      expect((error as MeshImportError).name).toBe('MeshImportError')
    }
  })
})

describe('readMeshFile', () => {
  it('hands the reader the whole file the designer chose', async () => {
    // The upload path in both viewers, without a DOM file picker in the way.
    const buffer = await readMeshFile(new File([obj(BOX)], 'box.obj', { type: 'text/plain' }))
    expect(buffer.byteLength).toBe(new TextEncoder().encode(obj(BOX)).byteLength)
    const mesh = parseObj(buffer)
    expect(mesh.triangleCount).toBe(BOX.length)
    expect(mesh.topology.watertight).toBe(true)
    expect(mesh.volumeMm3).toBeCloseTo(24, 6)
  })
})
