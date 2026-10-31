/**
 * The imported enclosure as it is drawn in the PCB preview.
 *
 * jsdom has no WebGL, so the shell's credibility rests on the objects handed to
 * the renderer: a case that hides the copper it surrounds is useless, and a case
 * that is framed somewhere off screen reads as an import that did nothing.
 */
import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { boxMeshObj } from './meshFixtures'
import { parseObj } from './objImporter'
import { SHELL_EDGE_TRIANGLE_LIMIT, buildEnclosureShell } from './enclosureShell'

describe('buildEnclosureShell', () => {
  it('draws the case as glass over the board, not as a solid', () => {
    const shell = buildEnclosureShell(parseObj(boxMeshObj(120, 90, 20)))
    const material = shell.faces.material as THREE.MeshStandardMaterial
    // transparent is what makes three blend the faces; opacity alone would not.
    expect(material.transparent).toBe(true)
    expect(material.opacity).toBeLessThan(0.1)
    expect(material.depthWrite).toBe(false)
    expect(material.side).toBe(THREE.DoubleSide)
    // The seams draw after the faces, so the wireframe is not fogged by them.
    expect(shell.faces.renderOrder).toBeLessThan(shell.seams!.renderOrder)
  })

  it('centres the case on the board so the fit check measures what is shown', () => {
    // A box offset from the origin, the way a real CAD export arrives.
    const offset = boxMeshObj(120, 90, 20)
      .split('\n')
      .map((line) => (line.startsWith('v ')
        ? line.replace(/^v (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)/, (_all, x, y, z) => `v ${Number(x) + 30} ${Number(y) + 5} ${Number(z) - 12}`)
        : line))
      .join('\n')

    const shell = buildEnclosureShell(parseObj(offset))
    shell.group.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(shell.group)
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())

    expect(center.x).toBeCloseTo(0, 6)
    expect(center.y).toBeCloseTo(0, 6)
    expect(center.z).toBeCloseTo(0, 6)
    // The frame the camera is fitted to is this box, not the raw mesh extents.
    expect(shell.half).toEqual([size.x / 2, size.y / 2, size.z / 2])
    expect(size.x).toBeCloseTo(120, 6)
    expect(size.z).toBeCloseTo(90, 6)
  })

  it('walks the seams of a modest case and skips a stadium-sized one', () => {
    const small = buildEnclosureShell(parseObj(boxMeshObj(120, 90, 20)))
    expect(small.seams).toBeInstanceOf(THREE.LineSegments)
    expect(small.seams!.geometry.getAttribute('position')).toBeDefined()

    // A mesh past the limit is a preview, not something to inspect facet by facet.
    const triangles = SHELL_EDGE_TRIANGLE_LIMIT + 1
    const positions = new Float32Array(triangles * 9)
    const normals = new Float32Array(triangles * 9)
    const dense = buildEnclosureShell({
      format: 'obj',
      positions,
      normals,
      triangleCount: triangles,
      degenerateTriangles: 0,
      bounds: { min: [-60, -10, -45], max: [60, 10, 45], size: [120, 20, 90] },
      surfaceAreaMm2: 0,
      volumeMm3: 0,
      topology: { analysed: false, watertight: null, openEdges: 0, nonManifoldEdges: 0, inconsistentEdges: 0 },
      assumedUnit: 'mm',
    })
    expect(dense.seams).toBeNull()
    expect(dense.group.children).toEqual([dense.faces])
  })

  it('keeps the case out of the board export', () => {
    const shell = buildEnclosureShell(parseObj(boxMeshObj(120, 90, 20)))
    expect(shell.faces.userData.excludeFromExport).toBe(true)
    expect(shell.seams!.userData.excludeFromExport).toBe(true)
  })

  it('releases only what the shell itself built', () => {
    const shell = buildEnclosureShell(parseObj(boxMeshObj(120, 90, 20)))
    const geometryDispose = vi.spyOn(shell.faces.geometry, 'dispose')
    const materialDispose = vi.spyOn(shell.faces.material as THREE.Material, 'dispose')
    const seamGeometryDispose = vi.spyOn(shell.seams!.geometry, 'dispose')
    const seamMaterialDispose = vi.spyOn(shell.seams!.material as THREE.Material, 'dispose')

    shell.dispose()

    expect(geometryDispose).toHaveBeenCalled()
    expect(materialDispose).toHaveBeenCalled()
    expect(seamGeometryDispose).toHaveBeenCalled()
    expect(seamMaterialDispose).toHaveBeenCalled()
  })
})
