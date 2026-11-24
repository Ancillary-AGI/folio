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

/** Axis-aligned box in scene millimetres: centre plus half extents. */
export interface Framing {
  center: [number, number, number]
  half: [number, number, number]
}

/**
 * Slack left around the fitted frame, as a multiplier on the touching distance.
 * A quarter each way is what made a 245 mm mainboard read as a postage stamp in a
 * 16:9 viewport; the projected box already includes the tallest part.
 */
const FIT_MARGIN = 1.08
/**
 * The share of the viewport height the floating chrome covers — a view bar at the
 * top and a read-out strip at the bottom. Only the vertical fit pays for it,
 * because the chrome leaves the left and right edges clear.
 */
const FIT_HUD_HEIGHT_FRACTION = 0.3
/** A degenerate frame still has to be viewable rather than intersecting the camera. */
const FIT_MIN_DISTANCE_MM = 5

/**
 * Distance at which `frame` fits a `viewport` seen from `viewDirection` under a
 * vertical field of view `fovDeg`.
 *
 * Projecting the box onto the camera's own screen axes, rather than wrapping it
 * in a bounding sphere, is what lets a wide shallow circuit fill a wide viewport
 * instead of shrinking to a dot — a sphere fits a board to its diagonal. The HUD
 * allowance rides on the vertical term only.
 */
export function fitFrameDistance(
  frame: Framing,
  viewDirection: THREE.Vector3,
  viewport: { width: number; height: number },
  fovDeg: number,
): number {
  const direction = viewDirection.clone().normalize()
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), direction)
  // Looking straight down makes world-up parallel to the view direction.
  if (right.lengthSq() < 1e-8) right.set(1, 0, 0)
  else right.normalize()
  const up = new THREE.Vector3().crossVectors(direction, right).normalize()

  const aspect = viewport.height > 0 ? viewport.width / viewport.height : Number.NaN
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1.6
  const clearHeight = Math.max(0.4, 1 - FIT_HUD_HEIGHT_FRACTION)
  const tanHalfFov = Math.tan((fovDeg * Math.PI) / 360)

  const [halfX, halfY, halfZ] = frame.half
  const halfWidth = Math.abs(halfX * right.x) + Math.abs(halfY * right.y) + Math.abs(halfZ * right.z)
  const halfHeight = Math.abs(halfX * up.x) + Math.abs(halfY * up.y) + Math.abs(halfZ * up.z)

  return Math.max(
    FIT_MIN_DISTANCE_MM,
    Math.max(halfWidth / (tanHalfFov * safeAspect), halfHeight / (tanHalfFov * clearHeight)) * FIT_MARGIN + 1,
  )
}

/**
 * Smallest axis-aligned box containing both frames. A case dropped around a
 * board is bigger than the thing it holds, so the view has to grow to it or the
 * import lands off-screen and reads as nothing having happened.
 */
export function unionFrames(a: Framing, b: Framing): Framing {
  const corner = (frame: Framing, sign: 1 | -1, axis: number) => frame.center[axis] + sign * frame.half[axis]
  const center: [number, number, number] = [0, 0, 0]
  const half: [number, number, number] = [0, 0, 0]
  for (const axis of [0, 1, 2] as const) {
    const min = Math.min(corner(a, -1, axis), corner(b, -1, axis))
    const max = Math.max(corner(a, 1, axis), corner(b, 1, axis))
    center[axis] = (min + max) / 2
    half[axis] = (max - min) / 2
  }
  return { center, half }
}
