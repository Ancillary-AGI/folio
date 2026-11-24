import * as THREE from 'three'
import type { MeshReport } from './meshMeasure'

/**
 * The imported enclosure, built as a glass shell around the board.
 *
 * The faces alone read as fog over the circuit, so the shell's seams are drawn
 * as lines too. Above SHELL_EDGE_TRIANGLE_LIMIT the edge walk is skipped and
 * only the faces are drawn; a case that large is a preview, not something to
 * inspect facet by facet.
 *
 * The group is offset so its bounding-box centre sits on the scene origin, which
 * is the board centre — the same alignment the fit check measures, so what is on
 * screen is what is judged.
 */
export const SHELL_EDGE_TRIANGLE_LIMIT = 200_000

/** How see-through the case is: enough to register as a solid, not enough to hide copper. */
const SHELL_OPACITY = 0.07

export interface EnclosureShell {
  group: THREE.Group
  /** The translucent faces. Kept apart from the group so a test can name the material. */
  faces: THREE.Mesh
  /** The seams, or null when the mesh was too dense to walk. */
  seams: THREE.LineSegments | null
  /**
   * What the shell occupies about the scene origin, in millimetres: half the
   * mesh extent on each axis, because the group is centred there. The camera
   * frames this, so the case on screen is the case that was measured.
   */
  half: [number, number, number]
  /** Releases the buffers and materials this shell owns and shares with nobody. */
  dispose: () => void
}

export function buildEnclosureShell(mesh: MeshReport): EnclosureShell {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3))

  const seams = mesh.triangleCount <= SHELL_EDGE_TRIANGLE_LIMIT
    ? new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 25), new THREE.LineBasicMaterial({
      color: '#9fdcff',
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
    }))
    : null

  const faces = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color: '#8fd3ff',
    transparent: true,
    opacity: SHELL_OPACITY,
    side: THREE.DoubleSide,
    depthWrite: false,
    metalness: 0.05,
    roughness: 0.7,
  }))
  faces.renderOrder = 2

  const group = new THREE.Group()
  group.position.set(
    -(mesh.bounds.min[0] + mesh.bounds.max[0]) / 2,
    -(mesh.bounds.min[1] + mesh.bounds.max[1]) / 2,
    -(mesh.bounds.min[2] + mesh.bounds.max[2]) / 2,
  )
  group.add(faces)
  if (seams) {
    seams.renderOrder = 3
    group.add(seams)
  }

  // Neither the case nor its seams belong in a board export. The exporter
  // traverses the scene and skips flagged objects without pruning the subtree,
  // so the flag goes on the mesh itself as well as the group.
  group.userData.excludeFromExport = true
  faces.userData.excludeFromExport = true
  if (seams) seams.userData.excludeFromExport = true

  const dispose = () => {
    geometry.dispose()
    faces.material.dispose()
    if (seams) {
      seams.geometry.dispose()
      seams.material.dispose()
    }
  }

  return { group, faces, seams, half: [mesh.bounds.size[0] / 2, mesh.bounds.size[1] / 2, mesh.bounds.size[2] / 2], dispose }
}
