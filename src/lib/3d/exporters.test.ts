import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { OBJExporter } from './objExporter'
import { STLExporter } from './stlExporter'

const triangle = {
  vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
  faces: [[0, 1, 2]],
}

const triangleGeometry = (): THREE.BufferGeometry => {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(triangle.vertices.flat(), 3))
  geometry.setIndex([0, 1, 2])
  geometry.computeVertexNormals()
  return geometry
}

describe('STLExporter ASCII', () => {
  it('writes a valid solid with a geometric facet normal', () => {
    const stl = STLExporter.exportToSTL(triangle, 'part one')
    expect(stl).toContain('solid part_one')
    expect(stl).toContain('endsolid part_one')
    expect(stl).toContain('facet normal 0 0 1')
    expect(stl).toContain('vertex 0 0 0')
    expect(STLExporter.validateSTL(stl)).toBe(true)
  })

  it('computes the facet normal when vertex normals are excluded', () => {
    const geometry = new THREE.BufferGeometry()
    // Triangle lying in the XZ plane; supplied normals deliberately disagree.
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0, 1, 0, 0, 0, 0, 1,
    ], 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute([
      0, 0, 1, 0, 0, 1, 0, 0, 1,
    ], 3))
    geometry.setIndex([0, 1, 2])
    const mesh = new THREE.Mesh(geometry)

    const stl = STLExporter.exportMesh(mesh, { includeNormals: false }) as string
    // Winding (0,0,0)→(1,0,0)→(0,0,1) gives -Y by the right-hand rule.
    expect(stl).toContain('facet normal 0 -1 0')
  })

  it('applies the scale option to meshes and scenes', () => {
    const mesh = new THREE.Mesh(triangleGeometry())
    const meshStl = STLExporter.exportMesh(mesh, { scale: 2 }) as string
    expect(meshStl).toContain('vertex 2 0 0')

    const scene = new THREE.Scene()
    const sceneMesh = new THREE.Mesh(triangleGeometry())
    scene.add(sceneMesh)
    const sceneStl = STLExporter.exportScene(scene, { scale: 3 }) as string
    expect(sceneStl).toContain('vertex 3 0 0')
  })

  it('rejects malformed triangle meshes', () => {
    expect(() => STLExporter.exportToSTL({ vertices: [[0, 0, 0]], faces: [] })).toThrow(/at least three vertices/)
    expect(() => STLExporter.exportToSTL({ vertices: [[0, 0, NaN], [1, 0, 0], [0, 1, 0]], faces: [[0, 1, 2]] })).toThrow(/finite/)
    expect(() => STLExporter.exportToSTL({ vertices: triangle.vertices, faces: [[0, 1, 9]] })).toThrow(/valid vertex indices/)
  })

  it('rejects text that is not a complete solid', () => {
    expect(STLExporter.validateSTL('solid x\n facet normal 0 0 1\n')).toBe(false)
    expect(STLExporter.validateSTL('not an stl')).toBe(false)
  })

  it('rejects geometry that would serialise as NaN or partial triangles', () => {
    const notWholeTriangles = new THREE.BufferGeometry()
    notWholeTriangles.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0], 3))
    expect(() => STLExporter.exportMesh(new THREE.Mesh(notWholeTriangles))).toThrow(/whole triangles/)

    const badIndex = triangleGeometry()
    badIndex.setIndex([0, 1, 9])
    expect(() => STLExporter.exportMesh(new THREE.Mesh(badIndex))).toThrow(/index outside the vertex buffer/)

    const partialIndex = triangleGeometry()
    partialIndex.setIndex([0, 1])
    expect(() => STLExporter.exportMesh(new THREE.Mesh(partialIndex))).toThrow(/whole triangles/)

    const nonFinite = new THREE.BufferGeometry()
    nonFinite.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, NaN, 1, 0, 0, 0, 1, 0], 3))
    nonFinite.setIndex([0, 1, 2])
    expect(() => STLExporter.exportMesh(new THREE.Mesh(nonFinite))).toThrow(/finite vertex coordinates/)
  })

  it('rejects scales that would collapse or mirror the mesh', () => {
    for (const scale of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => STLExporter.exportMesh(new THREE.Mesh(triangleGeometry()), { scale })).toThrow(/finite positive scale/)
    }
  })

  it('exports the current world transform of a mesh', () => {
    const mesh = new THREE.Mesh(triangleGeometry())
    mesh.position.set(2, 3, 0)
    const stl = STLExporter.exportMesh(mesh) as string
    expect(stl).toContain('vertex 2 3 0')
  })
})

describe('STLExporter binary', () => {
  it('encodes one triangle with the documented 50-byte record', () => {
    const mesh = new THREE.Mesh(triangleGeometry())
    const buffer = STLExporter.exportMesh(mesh, { binary: true }) as ArrayBuffer
    expect(buffer.byteLength).toBe(84 + 50)
    expect(STLExporter.validateSTL(buffer)).toBe(true)

    const view = new DataView(buffer)
    expect(view.getUint32(80, true)).toBe(1)
    expect(view.getFloat32(84, true)).toBe(0)
    expect(view.getFloat32(88, true)).toBe(0)
    expect(view.getFloat32(92, true)).toBe(1)
  })

  it('rejects a truncated binary payload', () => {
    expect(STLExporter.validateSTL(new ArrayBuffer(20))).toBe(false)
    const buffer = new ArrayBuffer(84)
    new DataView(buffer).setUint32(80, 2, true)
    expect(STLExporter.validateSTL(buffer)).toBe(false)
  })
})

describe('OBJExporter', () => {
  it('exports a box with twelve triangles and a material', () => {
    const result = new OBJExporter().exportBox(2, 4, 6, 'enclosure')
    expect(result.obj).toContain('mtllib model.mtl')
    expect(result.obj).toContain('usemtl default')
    expect(result.obj).toContain('o enclosure')
    expect(result.obj).toContain('v 1.000000 2.000000 3.000000')
    expect(result.triangleCount).toBe(12)
    expect(result.mtl).toContain('newmtl default')
  })

  it('offsets face indices per mesh and skips degenerate faces', () => {
    const result = new OBJExporter().exportMeshes([
      { name: 'a', vertices: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }], faces: [[0, 1, 2]] },
      { name: 'b', vertices: [{ x: 5, y: 0, z: 0 }, { x: 6, y: 0, z: 0 }, { x: 5, y: 1, z: 0 }], faces: [[0, 1, 2], [0, 1]] },
    ])
    expect(result.obj).toContain('f 1 2 3')
    expect(result.obj).toContain('f 4 5 6')
    expect(result.obj).not.toContain('f 0 1')
    expect(result.triangleCount).toBe(2)
  })

  it('rejects non-finite vertices and face indices outside the mesh', () => {
    const exporter = new OBJExporter()
    expect(() =>
      exporter.exportMeshes([{
        name: 'nan',
        vertices: [{ x: 0, y: 0, z: NaN }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }],
        faces: [[0, 1, 2]],
      }]),
    ).toThrow(/non-finite vertex/)

    expect(() =>
      exporter.exportMeshes([{
        name: 'oob',
        vertices: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }],
        faces: [[0, 1, 3]],
      }]),
    ).toThrow(/outside its vertex list/)

    expect(() =>
      exporter.exportMeshes([{
        name: 'negative',
        vertices: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }],
        faces: [[0, 1, -1]],
      }]),
    ).toThrow(/outside its vertex list/)
  })

  it('keeps names and material names on a single line', () => {
    const result = new OBJExporter().exportMeshes(
      [{
        name: 'evil\nusemtl injected',
        vertices: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }],
        faces: [[0, 1, 2]],
      }],
      'material\nwith newline',
    )
    expect(result.obj).toContain('o evil usemtl injected')
    expect(result.obj).not.toMatch(/^usemtl injected$/m)
    expect(result.obj).toContain('usemtl material with newline')
    expect(result.mtl).toContain('newmtl material with newline')
  })

  it('rejects boxes with non-positive or non-finite dimensions', () => {
    const exporter = new OBJExporter()
    expect(() => exporter.exportBox(0, 1, 1)).toThrow(/finite positive/)
    expect(() => exporter.exportBox(1, -2, 1)).toThrow(/finite positive/)
    expect(() => exporter.exportBox(1, 1, Number.NaN)).toThrow(/finite positive/)
  })
})
