import * as THREE from 'three'

export type ThreeView = 'iso' | 'front' | 'side' | 'top'

export const VIEW_DIRECTIONS: Record<ThreeView, THREE.Vector3> = {
  iso: new THREE.Vector3(1, 0.8, 1).normalize(),
  front: new THREE.Vector3(0, 0, 1),
  side: new THREE.Vector3(1, 0, 0),
  top: new THREE.Vector3(0, 1, 0),
}

/*
 * A top view looks along -Y, so the default +Y up vector is degenerate and
 * lookAt falls back to an arbitrary roll (a rectangular tray landed at 45°).
 * Looking down with -Z up keeps the model's X axis horizontal on screen.
 */
export const VIEW_UPS: Record<ThreeView, THREE.Vector3> = {
  iso: new THREE.Vector3(0, 1, 0),
  front: new THREE.Vector3(0, 1, 0),
  side: new THREE.Vector3(0, 1, 0),
  top: new THREE.Vector3(0, 0, -1),
}

/**
 * Distance at which a box of `size` fits the camera frustum with a small
 * margin. The only floor is a degenerate-geometry guard: flooring at a real
 * size framed a 70 mm enclosure as if it were 250 mm.
 */
export function framingDistance(camera: THREE.Camera, size: THREE.Vector3): number {
  const perspective = camera as THREE.PerspectiveCamera
  const fov = (perspective.isPerspectiveCamera ? perspective.fov : 50) * (Math.PI / 180)
  const aspect = perspective.isPerspectiveCamera ? Math.max(0.1, perspective.aspect) : 1.5
  const halfFov = Math.tan(fov / 2)
  const extent = Math.max(size.x, size.y, size.z, 1e-4)
  return Math.max(extent / (2 * halfFov), extent / (2 * halfFov * aspect)) * 1.3
}

/**
 * Scale the clip range with the framed distance. A fixed 50 mm near plane
 * swallowed assemblies smaller than that once framing stopped flooring the
 * extent at 250 mm.
 */
export function updateClipPlanes(camera: THREE.Camera, distance: number): void {
  const perspective = camera as THREE.PerspectiveCamera
  if (!perspective.isPerspectiveCamera) return
  perspective.near = Math.max(distance / 100, 1e-5)
  perspective.far = Math.max(distance * 100, 1)
  perspective.updateProjectionMatrix()
}
