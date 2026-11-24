import * as THREE from 'three'

/**
 * Outline (hidden-line) shading for every 3D viewport in the app.
 *
 * A CAD viewer needs two readings of the same model, not two models: the shaded
 * solid for judging appearance, and the outline for judging geometry — how a
 * bracket folds, whether a trace passes under a connector, which edge of a
 * machined face a drawing dimension refers to. The stock `wireframe: true` flag
 * is no use for that: it draws every triangle of a tessellated cylinder, so a
 * round part becomes a frosted ball of noise.
 *
 * So this draws *crease* edges — only the bends above `thresholdAngle`, plus the
 * silhouette boundary of open sheets such as copper — and leaves a faint ghost
 * of the surface behind them so the eye still gets depth. It works on a scene
 * graph someone else built, which is what all four viewers already produce.
 *
 * Two rules make it safe to bolt onto a graph it does not own:
 *
 * 1. **No material is ever mutated.** Each mesh's solid material is remembered
 *    on `userData.solidMaterial` and the mesh is pointed at a shared ghost
 *    instead. The board builder caches one finish per hue and hands it to fifty
 *    parts, so dimming one part would otherwise turn the whole board's moulding
 *    translucent — and leak that into every other board holding the same cache.
 * 2. **Nothing this pass creates is disposed by the host.** The edge buffers
 *    hang off the source geometry and the stroke materials are module-level, so
 *    both carry `userData.shared = true` — the flag the disposers here honour.
 */

export type ShadingMode = 'solid' | 'outline'

export const SHADING_MODES: readonly ShadingMode[] = ['solid', 'outline']

/** Name of the overlay object, so hosts and tests can identify it. */
export const OUTLINE_OVERLAY_NAME = 'cad-outline'

/**
 * Above this many triangles the crease walk is skipped for that one mesh.
 * The budget the imported enclosure uses for the same reason: past it the edges
 * are noise, and the walk costs more than the frame it is preparing.
 */
export const OUTLINE_TRIANGLE_LIMIT = 200_000

/** Creases flatter than this are grazing shading, not geometry. */
export const OUTLINE_THRESHOLD_ANGLE = 25

/** How much surface survives behind the lines: enough to read depth, not to hide the far side. */
export const OUTLINE_GHOST_OPACITY = 0.1

export interface OutlineStyle {
  /** Stroke of the crease lines. Defaults to a cool white that reads on a dark viewport. */
  color?: THREE.ColorRepresentation
  /** Fill of the ghosted surface. A mid steel that stays visible on either theme. */
  ghostColor?: THREE.ColorRepresentation
  ghostOpacity?: number
  thresholdAngle?: number
  /** Per-mesh triangle budget; raise it to walk denser meshes, at a cost. */
  triangleLimit?: number
}

/** Cached per colour so a theme switch does not allocate another shader program. */
const MAX_CACHED_OUTLINE_MATERIALS = 16

const ghostMaterials = new Map<string, THREE.Material>()
const strokeMaterials = new Map<string, THREE.LineBasicMaterial>()

function ghostMaterial(style: OutlineStyle): THREE.Material {
  const key = `${String(style.ghostColor ?? '#7f96b8')}|${style.ghostOpacity ?? OUTLINE_GHOST_OPACITY}`
  const cached = ghostMaterials.get(key)
  if (cached) return cached
  const made = new THREE.MeshStandardMaterial({
    color: style.ghostColor ?? '#7f96b8',
    transparent: true,
    opacity: style.ghostOpacity ?? OUTLINE_GHOST_OPACITY,
    depthWrite: false,
    roughness: 0.9,
    metalness: 0,
  })
  if (ghostMaterials.size < MAX_CACHED_OUTLINE_MATERIALS) {
    made.userData.shared = true
    ghostMaterials.set(key, made)
  }
  return made
}

function strokeMaterial(style: OutlineStyle): THREE.LineBasicMaterial {
  const color = style.color ?? '#d6e7ff'
  const key = String(color)
  const cached = strokeMaterials.get(key)
  if (cached) return cached
  const made = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false })
  if (strokeMaterials.size < MAX_CACHED_OUTLINE_MATERIALS) {
    made.userData.shared = true
    strokeMaterials.set(key, made)
  }
  return made
}

/**
 * The crease wire of one shape, remembered on the shape itself.
 *
 * Hanging the cache on the geometry is what keeps a 400-part board affordable:
 * every SOT-23 body shares one box, so one `EdgesGeometry` serves all of them,
 * and when the shape goes away the wire goes with it — no registry to prune and
 * no way to leak a buffer the scene no longer draws. Null means the shape is
 * too dense to walk, which the caller treats as "ghost only" rather than an error.
 */
function creaseGeometry(
  geometry: THREE.BufferGeometry,
  thresholdAngle: number,
  limit: number,
): THREE.BufferGeometry | null {
  const position = geometry.getAttribute('position')
  if (!position) return null
  if ((geometry.index?.count ?? position.count) / 3 > limit) return null

  const perShape: Map<number, THREE.BufferGeometry> =
    geometry.userData.creases ??= new Map<number, THREE.BufferGeometry>()
  const cached = perShape.get(thresholdAngle)
  if (cached !== undefined) return cached
  const built = new THREE.EdgesGeometry(geometry, thresholdAngle)
  // Flagged shared so a host that disposes whole subtrees — the mechanical
  // viewport does exactly that on every component edit — leaves it alone.
  built.userData.shared = true
  perShape.set(thresholdAngle, built)
  return built
}

function asMesh(object: THREE.Object3D): THREE.Mesh | null {
  const mesh = object as THREE.Mesh
  return mesh.isMesh ? mesh : null
}

/**
 * Whether the handed-in root is a scene node at all.
 *
 * Viewers that build their parts declaratively hold them behind a ref on a JSX
 * `<group>`, and that JSX only becomes a THREE node once the fiber reconciler
 * runs. Where no WebGL context exists — a headless render, the stubbed test
 * Canvas — the ref lands on a plain element with no children to walk. Outline
 * asks a question about geometry that is not on screen, so the answer is to do
 * nothing rather than throw in code the real viewport would have answered.
 */
function isSceneRoot(root: THREE.Object3D | null | undefined): root is THREE.Object3D {
  return typeof root?.traverse === 'function'
}

/** Point every mesh in the subtree at the ghost fill and lay its creases over it. */
export function applyOutlineShading(
  root: THREE.Object3D,
  style: OutlineStyle = {},
): { shaded: number; skipped: number } {
  const ghost = ghostMaterial(style)
  const stroke = strokeMaterial(style)
  const threshold = style.thresholdAngle ?? OUTLINE_THRESHOLD_ANGLE
  const limit = style.triangleLimit ?? OUTLINE_TRIANGLE_LIMIT
  let shaded = 0
  let skipped = 0

  root.traverse((object) => {
    // Overlays are LineSegments, so they fail this test and never shade themselves.
    const mesh = asMesh(object)
    if (!mesh) return
    if (mesh.userData.solidMaterial === undefined) mesh.userData.solidMaterial = mesh.material
    mesh.material = ghost
    shaded += 1

    // Past the budget the walk is abandoned, which reads as "ghost only" and is
    // not an error — but the reason has to be remembered for the read-out.
    const creases = creaseGeometry(mesh.geometry, threshold, limit)
    if (!creases) {
      skipped += 1
      mesh.userData.outlineSkipped = true
      return
    }
    delete mesh.userData.outlineSkipped

    const existing = mesh.userData.outlineOverlay as THREE.LineSegments | undefined
    if (existing) {
      existing.material = stroke
      // A repaint may have asked for a different crease threshold, and the
      // overlay has to trace what was asked for, not what the last repaint wanted.
      existing.geometry = creases
      return
    }

    const overlay = new THREE.LineSegments(creases, stroke)
    overlay.name = OUTLINE_OVERLAY_NAME
    overlay.userData.shared = true
    overlay.userData.excludeFromExport = true
    // Last in the transparent sort, so the crease stays crisp through the pack of parts in front.
    overlay.renderOrder = 4
    mesh.add(overlay)
    mesh.userData.outlineOverlay = overlay
  })

  return { shaded, skipped }
}

/** Undo everything {@link applyOutlineShading} did, down to material identity. */
export function clearOutlineShading(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = asMesh(object)
    if (!mesh) return
    const overlay = mesh.userData.outlineOverlay as THREE.LineSegments | undefined
    if (overlay) {
      mesh.remove(overlay)
      delete mesh.userData.outlineOverlay
      delete mesh.userData.outlineSkipped
    }
    const solid = mesh.userData.solidMaterial as THREE.Material | THREE.Material[] | undefined
    if (solid !== undefined) {
      mesh.material = solid
      delete mesh.userData.solidMaterial
    }
  })
}

/**
 * Put the solid materials back where the host's disposer can find them.
 *
 * A builder that releases the materials its group owns walks the meshes and
 * reads `mesh.material`. While a group is shaded that pointer is the ghost and
 * the real finish is parked on `userData`, so the finish would outlive the group
 * that made it. Restore first, then dispose.
 */
export function restoreSolidMaterials(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = asMesh(object)
    if (!mesh) return
    const solid = mesh.userData.solidMaterial as THREE.Material | THREE.Material[] | undefined
    if (solid !== undefined) mesh.material = solid
  })
}

/** Switch between the two readings of the model. Idempotent in both directions. */
export function setShadingMode(
  root: THREE.Object3D | null | undefined,
  mode: ShadingMode,
  style: OutlineStyle = {},
): void {
  if (!isSceneRoot(root)) return
  if (mode === 'outline') applyOutlineShading(root, style)
  else clearOutlineShading(root)
}
