/**
 * Geometry written straight into typed arrays, for boards with thousands of parts.
 *
 * three.js's shape constructors are not built to be called once per copper
 * feature: the laptop mainboard asked for 9 107 trace boxes, 18 214 joint
 * cylinders and 2 747 pour keepaways, and building the preview group took 88 s —
 * long enough that the browser tab stopped answering. These helpers write the same
 * solids as plain position/normal buffers in one pass, so a whole layer of copper
 * costs one allocation and no `computeVertexNormals()` sweep.
 *
 * The builder therefore takes bare numbers rather than vectors and grows typed
 * arrays rather than pushing into plain ones: the pass that emits 450 000 triangles
 * is dominated by what it allocates per triangle, and a preview has to be built
 * while the page stays responsive.
 *
 * Every triangle is emitted against the normal it is meant to face and reordered to
 * agree with it, so the winding is derived instead of assumed: a section listed the
 * wrong way round still renders facing out.
 */
import * as THREE from 'three'

/** A point in the cross-section plane (scene X/Z, before extrusion along Y). */
export interface SectionPoint {
  x: number
  z: number
}

/** A regular polygon inscribed in a circle, centred on the origin. */
export function circleSection(radius: number, sides = 16): SectionPoint[] {
  const count = Math.max(3, Math.round(sides))
  const points: SectionPoint[] = []
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2
    points.push({ x: Math.cos(angle) * radius, z: Math.sin(angle) * radius })
  }
  return points
}

/** A rectangle centred on the origin, width along X and depth along Z. */
export function rectSection(width: number, depth: number): SectionPoint[] {
  const hw = width / 2
  const hd = depth / 2
  return [{ x: -hw, z: -hd }, { x: hw, z: -hd }, { x: hw, z: hd }, { x: -hw, z: hd }]
}

/**
 * A rectangle with its corners rounded — the section of a soldered land, and of
 * the keepaway that clears a plane around one.
 */
export function roundedRectSection(width: number, depth: number, radius: number, corners = 3): SectionPoint[] {
  const hw = width / 2
  const hd = depth / 2
  const r = Math.max(0, Math.min(radius, hw, hd))
  if (r <= 1e-4) return rectSection(width, depth)
  const points: SectionPoint[] = []
  const centres = [
    { x: -hw + r, z: -hd + r, from: Math.PI },
    { x: hw - r, z: -hd + r, from: -Math.PI / 2 },
    { x: hw - r, z: hd - r, from: 0 },
    { x: -hw + r, z: hd - r, from: Math.PI / 2 },
  ]
  for (const centre of centres) {
    for (let step = 0; step <= corners; step += 1) {
      const angle = centre.from + (step / corners) * (Math.PI / 2)
      points.push({ x: centre.x + Math.cos(angle) * r, z: centre.z + Math.sin(angle) * r })
    }
  }
  return points
}

const TRIANGLE_SLOTS = 9

/**
 * Accumulates triangles into one flat, non-indexed position/normal buffer.
 *
 * `triangle` takes the normal the face should have and orders the vertices to
 * agree with it, so callers never have to reason about the handedness of a
 * section or the direction a trace runs. Flipping the winding is exactly
 * negating the normal, so that is what the swap does instead of a second
 * cross product.
 */
export class SolidBuilder {
  private position = new Float32Array(TRIANGLE_SLOTS * 3 * 4096)
  private normal = new Float32Array(TRIANGLE_SLOTS * 3 * 4096)
  private used = 0

  get triangleCount(): number {
    return this.used / TRIANGLE_SLOTS
  }

  private reserve(slots: number): void {
    if (this.used + slots <= this.position.length) return
    const capacity = Math.max(this.position.length * 2, this.used + slots)
    const position = new Float32Array(capacity)
    const normal = new Float32Array(capacity)
    position.set(this.position.subarray(0, this.used))
    normal.set(this.normal.subarray(0, this.used))
    this.position = position
    this.normal = normal
  }

  /**
   * Append one flat-shaded triangle from twelve numbers.
   *
   * Positional, not vectors or tuples: the pass that lays a board's copper emits
   * hundreds of thousands of triangles, and a point object or an argument array
   * per corner spent more time in the collector than in the arithmetic.
   */
  triangle(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    wx: number, wy: number, wz: number,
  ): void {
    const ux = bx - ax
    const uy = by - ay
    const uz = bz - az
    const vx = cx - ax
    const vy = cy - ay
    const vz = cz - az
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    // Second and third corner, unless the winding opposes the wanted facing.
    let secondX = bx; let secondY = by; let secondZ = bz
    let thirdX = cx; let thirdY = cy; let thirdZ = cz
    if (nx * wx + ny * wy + nz * wz < 0) {
      secondX = cx; secondY = cy; secondZ = cz
      thirdX = bx; thirdY = by; thirdZ = bz
      nx = -nx; ny = -ny; nz = -nz
    }
    const length = Math.sqrt(nx * nx + ny * ny + nz * nz)
    if (!(length > 1e-9)) return
    const scale = 1 / length
    const fx = nx * scale
    const fy = ny * scale
    const fz = nz * scale
    this.reserve(TRIANGLE_SLOTS)
    const at = this.used
    const p = this.position
    const n = this.normal
    p[at] = ax; p[at + 1] = ay; p[at + 2] = az
    p[at + 3] = secondX; p[at + 4] = secondY; p[at + 5] = secondZ
    p[at + 6] = thirdX; p[at + 7] = thirdY; p[at + 8] = thirdZ
    n[at] = fx; n[at + 1] = fy; n[at + 2] = fz
    n[at + 3] = fx; n[at + 4] = fy; n[at + 5] = fz
    n[at + 6] = fx; n[at + 7] = fy; n[at + 8] = fz
    this.used = at + TRIANGLE_SLOTS
  }

  /**
   * Extrude a closed section between two Y planes: caps as fans off the centre,
   * walls as quads with the outward normal the surface actually has.
   */
  prism(section: SectionPoint[], yBottom: number, yTop: number, center: SectionPoint = { x: 0, z: 0 }): void {
    if (section.length < 3 || !(yTop > yBottom)) return
    const count = section.length
    for (let index = 0; index < count; index += 1) {
      const from = section[index]
      const to = section[(index + 1) % count]
      const fromX = center.x + from.x
      const fromZ = center.z + from.z
      const toX = center.x + to.x
      const toZ = center.z + to.z
      // The fan covers the whole polygon; each slice is one cap triangle.
      this.triangle(center.x, yTop, center.z, fromX, yTop, fromZ, toX, yTop, toZ, 0, 1, 0)
      this.triangle(center.x, yBottom, center.z, fromX, yBottom, fromZ, toX, yBottom, toZ, 0, -1, 0)
      const dx = to.x - from.x
      const dz = to.z - from.z
      const edge = Math.sqrt(dx * dx + dz * dz)
      if (edge < 1e-9) continue
      // Both perpendiculars are candidates; the one pointing away from the
      // section's own centre is the outside.
      const wallX = dz / edge
      const wallZ = -dx / edge
      const sign = wallX * (from.x + to.x) / 2 + wallZ * (from.z + to.z) / 2 >= 0 ? 1 : -1
      const ox = wallX * sign
      const oz = wallZ * sign
      this.triangle(fromX, yBottom, fromZ, toX, yBottom, toZ, toX, yTop, toZ, ox, 0, oz)
      this.triangle(fromX, yBottom, fromZ, toX, yTop, toZ, fromX, yTop, fromZ, ox, 0, oz)
    }
  }

  /**
   * Take the buffer out of the builder.
   *
   * The arrays are copied to their exact size, so the builder stays reusable for
   * the next pass with no re-sweep of what was just emitted.
   */
  geometry(): THREE.BufferGeometry | null {
    if (this.used === 0) return null
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(this.position.slice(0, this.used), 3))
    geometry.setAttribute('normal', new THREE.BufferAttribute(this.normal.slice(0, this.used), 3))
    this.used = 0
    return geometry
  }
}

/** One run of copper: the centre line the router laid and the width the rule allows. */
export interface RibbonPath {
  points: SectionPoint[]
  widthMm: number
}

/**
 * Trace copper as a mitred ribbon, not a string of beads.
 *
 * A trace is a flat conductor of one width through its corners, so every vertex is
 * offset along the miter of its two edges and the ribbon is extruded between the two
 * offset outlines. The corner turns to a point the way drawn copper does; a near
 * reversal is limited to a bevel instead of allowed to shoot off to infinity.
 */
export function buildRibbonGeometry(
  paths: RibbonPath[],
  yBottom: number,
  yTop: number,
): THREE.BufferGeometry | null {
  if (paths.length === 0 || !(yTop > yBottom)) return null
  const builder = new SolidBuilder()
  for (const path of paths) {
    const points = path.points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.z))
    if (points.length === 0) continue
    const half = Math.max(0.04, path.widthMm / 2)
    if (points.length === 1) {
      // A zero-length net still has a landing: a square stud of the rule's width.
      builder.prism(rectSection(half * 2, half * 2), yBottom, yTop, points[0])
      continue
    }
    const vertexCount = points.length
    const leftX = new Float64Array(vertexCount)
    const leftZ = new Float64Array(vertexCount)
    const rightX = new Float64Array(vertexCount)
    const rightZ = new Float64Array(vertexCount)
    // One left-hand normal per edge; a vertex between two edges takes their
    // bisector, an endpoint takes the single edge it belongs to.
    const edgeX = new Float64Array(vertexCount - 1)
    const edgeZ = new Float64Array(vertexCount - 1)
    for (let index = 0; index + 1 < vertexCount; index += 1) {
      const dx = points[index + 1].x - points[index].x
      const dz = points[index + 1].z - points[index].z
      const length = Math.sqrt(dx * dx + dz * dz) || 1
      edgeX[index] = -dz / length
      edgeZ[index] = dx / length
    }
    for (let index = 0; index < vertexCount; index += 1) {
      const current = points[index]
      const hasBefore = index > 0
      const hasAfter = index < vertexCount - 1
      let mx: number
      let mz: number
      let reach: number
      if (hasBefore && hasAfter) {
        mx = edgeX[index - 1] + edgeX[index]
        mz = edgeZ[index - 1] + edgeZ[index]
        const mLength = Math.sqrt(mx * mx + mz * mz)
        if (!(mLength > 1e-6)) {
          // A 180 degree reversal has no miter; square off on the incoming edge.
          mx = edgeX[index - 1]
          mz = edgeZ[index - 1]
          reach = half
        } else {
          mx /= mLength
          mz /= mLength
          // Miter length is the half width over the cosine of the half angle,
          // clamped so a hairpin turn stays a bevel instead of a spike.
          const cosine = mx * edgeX[index - 1] + mz * edgeZ[index - 1]
          reach = Math.min(half * 4, half / Math.max(0.25, Math.abs(cosine)))
        }
      } else {
        const only = hasBefore ? index - 1 : index
        mx = edgeX[only]
        mz = edgeZ[only]
        reach = half
      }
      leftX[index] = current.x + mx * reach
      leftZ[index] = current.z + mz * reach
      rightX[index] = current.x - mx * reach
      rightZ[index] = current.z - mz * reach
    }
    for (let index = 0; index + 1 < vertexCount; index += 1) {
      const l0x = leftX[index]; const l0z = leftZ[index]
      const l1x = leftX[index + 1]; const l1z = leftZ[index + 1]
      const r0x = rightX[index]; const r0z = rightZ[index]
      const r1x = rightX[index + 1]; const r1z = rightZ[index + 1]
      const dx = points[index + 1].x - points[index].x
      const dz = points[index + 1].z - points[index].z
      const edge = Math.sqrt(dx * dx + dz * dz) || 1
      const sideX = -dz / edge
      const sideZ = dx / edge
      builder.triangle(l0x, yTop, l0z, l1x, yTop, l1z, r1x, yTop, r1z, 0, 1, 0)
      builder.triangle(l0x, yTop, l0z, r1x, yTop, r1z, r0x, yTop, r0z, 0, 1, 0)
      builder.triangle(l0x, yBottom, l0z, l1x, yBottom, l1z, r1x, yBottom, r1z, 0, -1, 0)
      builder.triangle(l0x, yBottom, l0z, r1x, yBottom, r1z, r0x, yBottom, r0z, 0, -1, 0)
      builder.triangle(l0x, yBottom, l0z, l1x, yBottom, l1z, l1x, yTop, l1z, sideX, 0, sideZ)
      builder.triangle(l0x, yBottom, l0z, l1x, yTop, l1z, l0x, yTop, l0z, sideX, 0, sideZ)
      builder.triangle(r0x, yBottom, r0z, r1x, yBottom, r1z, r1x, yTop, r1z, -sideX, 0, -sideZ)
      builder.triangle(r0x, yBottom, r0z, r1x, yTop, r1z, r0x, yTop, r0z, -sideX, 0, -sideZ)
    }
    // Square ends, so cut copper reads as a conductor at each terminal.
    const last = vertexCount - 1
    const caps = [
      {
        fromX: leftX[0],
        fromZ: leftZ[0],
        toX: rightX[0],
        toZ: rightZ[0],
        outX: -(points[1].x - points[0].x),
        outZ: -(points[1].z - points[0].z),
      },
      {
        fromX: leftX[last],
        fromZ: leftZ[last],
        toX: rightX[last],
        toZ: rightZ[last],
        outX: points[last].x - points[last - 1].x,
        outZ: points[last].z - points[last - 1].z,
      },
    ]
    for (const cap of caps) {
      const length = Math.sqrt(cap.outX * cap.outX + cap.outZ * cap.outZ) || 1
      const wx = cap.outX / length
      const wz = cap.outZ / length
      builder.triangle(cap.fromX, yBottom, cap.fromZ, cap.toX, yBottom, cap.toZ, cap.toX, yTop, cap.toZ, wx, 0, wz)
      builder.triangle(cap.fromX, yBottom, cap.fromZ, cap.toX, yTop, cap.toZ, cap.fromX, yTop, cap.fromZ, wx, 0, wz)
    }
  }
  return builder.geometry()
}
