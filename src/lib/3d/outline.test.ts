/**
 * The outline reading of a finished scene graph.
 *
 * jsdom has no WebGL, so what can be judged here is the bookkeeping the render
 * depends on: the solid finishes of a board are cached and shared between parts,
 * so the one thing an outline pass may never do is edit a material it was handed.
 * Everything else — that the creases belong to the geometry they trace, that the
 * host's disposers can be trusted not to eat them, that a toggle returns the
 * scene exactly as it was — is asserted directly.
 */
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  OUTLINE_TRIANGLE_LIMIT,
  OUTLINE_OVERLAY_NAME,
  applyOutlineShading,
  clearOutlineShading,
  setShadingMode,
} from './outline'

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], name = 'part') {
  const made = new THREE.Mesh(geometry, material)
  made.name = name
  return made
}

function overlays(root: THREE.Object3D): THREE.LineSegments[] {
  const found: THREE.LineSegments[] = []
  root.traverse((object) => {
    if (object.name === OUTLINE_OVERLAY_NAME) found.push(object as THREE.LineSegments)
  })
  return found
}

function solidFinish() {
  return new THREE.MeshStandardMaterial({ color: '#1f6f4a', roughness: 0.4, metalness: 0.2 })
}

describe('applyOutlineShading', () => {
  it('ghosts the surface without editing the finish it was handed', () => {
    const finish = solidFinish()
    const board = new THREE.Group()
    board.add(mesh(new THREE.BoxGeometry(10, 1, 4), finish))

    applyOutlineShading(board)

    const part = board.children[0] as THREE.Mesh
    const ghost = part.material as THREE.MeshStandardMaterial
    expect(ghost).not.toBe(finish)
    expect(ghost.transparent).toBe(true)
    expect(ghost.opacity).toBeLessThan(0.2)
    expect(ghost.depthWrite).toBe(false)
    // The shared finish is what fifty other parts are still drawing with.
    expect(finish.transparent).toBe(false)
    expect(finish.opacity).toBe(1)
    expect(finish.depthWrite).toBe(true)
    expect(finish.color.getHexString()).toBe('1f6f4a')
  })

  it('draws creases, not every triangle', () => {
    const board = new THREE.Group()
    board.add(mesh(new THREE.CylinderGeometry(3, 3, 8, 32), solidFinish()))

    applyOutlineShading(board)

    const [overlay] = overlays(board)
    const position = overlay.geometry.getAttribute('position')
    // 32 tessellated sides give 128 triangles; a wireframe would draw all of them.
    // The creases of the same part are the two rim circles and nothing else.
    expect(position.count / 2).toBeLessThan(128)
    expect(position.count).toBeGreaterThan(0)
  })

  it('traces a box as its twelve real edges', () => {
    const board = new THREE.Group()
    board.add(mesh(new THREE.BoxGeometry(2, 3, 4), solidFinish()))

    applyOutlineShading(board)

    const [overlay] = overlays(board)
    // One line segment is two vertices, and a box has twelve edges.
    expect(overlay.geometry.getAttribute('position').count).toBe(24)
  })

  it('serves one crease buffer to every part that shares a shape', () => {
    const shape = new THREE.BoxGeometry(2, 2, 2)
    const board = new THREE.Group()
    board.add(mesh(shape, solidFinish(), 'a'))
    board.add(mesh(shape, solidFinish(), 'b'))

    applyOutlineShading(board)

    const [first, second] = overlays(board)
    expect(first.geometry).toBe(second.geometry)
  })

  it('reuses the crease buffer after a theme change instead of rebuilding it', () => {
    const board = new THREE.Group()
    board.add(mesh(new THREE.BoxGeometry(2, 2, 2), solidFinish()))

    applyOutlineShading(board, { color: '#d6e7ff' })
    const built = overlays(board)[0].geometry
    applyOutlineShading(board, { color: '#101820' })

    expect(overlays(board)[0].geometry).toBe(built)
  })

  it('keeps a walk for each crease threshold it is asked for', () => {
    const shape = new THREE.CylinderGeometry(3, 3, 8, 24)
    const board = new THREE.Group()
    board.add(mesh(shape, solidFinish()))

    applyOutlineShading(board, { thresholdAngle: 25 })
    const sharp = overlays(board)[0].geometry.getAttribute('position').count
    applyOutlineShading(board, { thresholdAngle: 1 })
    const soft = overlays(board)[0].geometry.getAttribute('position').count

    // Almost nothing bends by less than a degree, so the two walks differ.
    expect(soft).toBeGreaterThan(sharp)
  })

  it('gives up on a mesh too dense to afford, and still ghosts it', () => {
    const board = new THREE.Group()
    const dense = mesh(new THREE.SphereGeometry(4, 64, 48), solidFinish())
    board.add(dense)

    const counted = applyOutlineShading(board, { triangleLimit: 100 })

    expect(counted.skipped).toBe(1)
    expect(overlays(board)).toHaveLength(0)
    expect((dense.material as THREE.MeshStandardMaterial).transparent).toBe(true)
    expect(dense.userData.outlineSkipped).toBe(true)
  })

  it('is idempotent, so a repaint does not stack overlays', () => {
    const board = new THREE.Group()
    board.add(mesh(new THREE.BoxGeometry(1, 1, 1), solidFinish()))

    applyOutlineShading(board)
    applyOutlineShading(board)
    applyOutlineShading(board)

    expect(overlays(board)).toHaveLength(1)
    expect(board.children[0]!.children).toHaveLength(1)
  })

  it('marks the overlay so it never reaches a board export', () => {
    const board = new THREE.Group()
    board.add(mesh(new THREE.BoxGeometry(1, 1, 1), solidFinish()))

    applyOutlineShading(board)

    const [overlay] = overlays(board)
    expect(overlay.userData.excludeFromExport).toBe(true)
    // The generic subtree disposers in this app honour `shared`, which is how
    // the cached crease buffer survives a mechanical rebuild.
    expect(overlay.userData.shared).toBe(true)
    expect(overlay.geometry.userData.shared).toBe(true)
  })

  it('reports what it shaded', () => {
    const board = new THREE.Group()
    board.add(mesh(new THREE.BoxGeometry(1, 1, 1), solidFinish()))
    board.add(new THREE.Group())
    board.children[1]!.add(mesh(new THREE.BoxGeometry(1, 1, 1), solidFinish()))
    board.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1))))

    expect(applyOutlineShading(board)).toEqual({ shaded: 2, skipped: 0 })
  })
})

describe('clearOutlineShading', () => {
  it('returns every material identity and drops the overlay', () => {
    const finish = solidFinish()
    const part = mesh(new THREE.BoxGeometry(1, 1, 1), finish)
    const board = new THREE.Group()
    board.add(part)

    applyOutlineShading(board)
    clearOutlineShading(board)

    expect(part.material).toBe(finish)
    expect(part.children).toHaveLength(0)
    expect(part.userData.solidMaterial).toBeUndefined()
    expect(part.userData.outlineOverlay).toBeUndefined()
  })

  it('restores a multi-material mesh as the same array', () => {
    const finishes = [solidFinish(), solidFinish()]
    const part = mesh(new THREE.BoxGeometry(1, 1, 1), finishes)
    const board = new THREE.Group()
    board.add(part)

    applyOutlineShading(board)
    clearOutlineShading(board)

    expect(part.material).toBe(finishes)
  })
})

describe('setShadingMode', () => {
  it('round-trips a whole scene no matter how often it is toggled', () => {
    const finish = solidFinish()
    const board = new THREE.Group()
    board.add(mesh(new THREE.BoxGeometry(1, 1, 1), finish))

    for (let i = 0; i < 3; i += 1) {
      setShadingMode(board, 'outline')
      setShadingMode(board, 'solid')
    }

    expect((board.children[0] as THREE.Mesh).material).toBe(finish)
    expect(overlays(board)).toHaveLength(0)
    expect(board.children[0]!.children).toHaveLength(0)
  })

  it('leaves the default density budget far above a normal part', () => {
    expect(OUTLINE_TRIANGLE_LIMIT).toBeGreaterThan(100_000)
  })

  it('does nothing to a ref that never became a scene node', () => {
    /*
     * Declarative viewers hold their parts behind a ref on a `<group>`, and only
     * the fiber reconciler turns that into a THREE node. Where no WebGL context
     * exists the ref lands on a plain element, or on nothing at all before the
     * first commit — the pass is being asked about geometry that is not on
     * screen, so it declines rather than throwing in the middle of a panel.
     */
    const notAScene = { children: [] } as unknown as THREE.Object3D

    expect(() => setShadingMode(notAScene, 'outline')).not.toThrow()
    expect(() => setShadingMode(notAScene, 'solid')).not.toThrow()
    expect(() => setShadingMode(null, 'outline')).not.toThrow()
    expect(() => setShadingMode(undefined, 'solid')).not.toThrow()
  })
})
