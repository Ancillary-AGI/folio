import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  SolidBuilder,
  buildRibbonGeometry,
  circleSection,
  rectSection,
  roundedRectSection,
} from './prismGeometry'

/**
 * These helpers replace ten thousand three.js constructor calls on the laptop
 * mainboard, so the contract they have to keep is the one the renderer cares
 * about: the solid occupies the millimetres asked for and every face points
 * outside it. A wall facing in is a hole in the mesh no light can fill.
 */

function faceCentroids(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  const faces: Array<{ center: THREE.Vector3; normal: THREE.Vector3 }> = []
  for (let index = 0; index < position.count; index += 3) {
    const center = new THREE.Vector3()
    const faceNormal = new THREE.Vector3()
    for (let offset = 0; offset < 3; offset += 1) {
      const i = index + offset
      center.add(new THREE.Vector3(position.getX(i), position.getY(i), position.getZ(i)))
      faceNormal.add(new THREE.Vector3(normal.getX(i), normal.getY(i), normal.getZ(i)))
    }
    center.divideScalar(3)
    faces.push({ center, normal: faceNormal.normalize() })
  }
  return faces
}

function solidOf(section: ReturnType<typeof rectSection>, yBottom: number, yTop: number): THREE.BufferGeometry {
  const builder = new SolidBuilder()
  builder.prism(section, yBottom, yTop)
  const geometry = builder.geometry()
  if (!geometry) throw new Error('the prism produced no faces')
  return geometry
}

/**
 * The bounds of a built buffer. `Box3` wants a `BufferAttribute` and three's
 * `getAttribute` will only promise an interleaved one too, so the narrowing the
 * renderer would do at upload happens here instead of a cast.
 */
function positions(geometry: THREE.BufferGeometry): THREE.BufferAttribute {
  const attribute = geometry.getAttribute('position')
  if (!(attribute instanceof THREE.BufferAttribute)) throw new Error('the buffer is not a plain attribute')
  return attribute
}

function boundsOf(geometry: THREE.BufferGeometry): THREE.Box3 {
  return new THREE.Box3().setFromBufferAttribute(positions(geometry))
}

describe('SolidBuilder.prism', () => {
  it('fills exactly the millimetres asked for', () => {
    const geometry = solidOf(rectSection(2, 4), -0.5, 1.5)
    const box = boundsOf(geometry)
    expect(box.min.x).toBeCloseTo(-1, 5)
    expect(box.max.x).toBeCloseTo(1, 5)
    expect(box.min.z).toBeCloseTo(-2, 5)
    expect(box.max.z).toBeCloseTo(2, 5)
    expect(box.min.y).toBeCloseTo(-0.5, 5)
    expect(box.max.y).toBeCloseTo(1.5, 5)
    // Four walls as quads plus one cap triangle per edge, on each face.
    expect(geometry.getAttribute('position').count).toBe((4 * 2 + 4 * 2) * 3)
  })

  it('points every face outward, whichever way round the section is listed', () => {
    const forward = faceCentroids(solidOf(circleSection(1, 12), 0, 0.2))
    const reversed = faceCentroids(solidOf(circleSection(1, 12).reverse(), 0, 0.2))
    for (const faces of [forward, reversed]) {
      expect(faces.length).toBeGreaterThan(0)
      for (const face of faces) {
        if (Math.abs(face.normal.y) > 0.9) {
          // A cap faces straight up or straight down.
          expect(Math.abs(face.normal.y)).toBeCloseTo(1, 6)
          continue
        }
        // Wall: the normal has to leave the solid, so it agrees with the
        // direction from the axis to the face it sits on.
        const radial = new THREE.Vector3(face.center.x, 0, face.center.z).normalize()
        expect(face.normal.dot(radial)).toBeGreaterThan(0.99)
        expect(Math.abs(face.normal.y)).toBeLessThan(0.01)
      }
    }
  })

  it('keeps a rounded land rounded and a zero radius square', () => {
    const rounded = roundedRectSection(2, 1, 0.25)
    expect(rounded.length).toBe(16)
    const sharp = roundedRectSection(2, 1, 0)
    expect(sharp).toEqual(rectSection(2, 1))
    const corner = rounded.reduce(
      (closest, point) => Math.min(closest, Math.hypot(Math.abs(point.x) - 1, Math.abs(point.z) - 0.5)),
      Number.POSITIVE_INFINITY,
    )
    expect(corner).toBeGreaterThan(0)
  })

  it('refuses a section or a height it cannot extrude', () => {
    const builder = new SolidBuilder()
    builder.prism(rectSection(1, 1), 0.5, 0.5)
    builder.prism([{ x: 0, z: 0 }, { x: 1, z: 0 }], 0, 1)
    expect(builder.geometry()).toBeNull()
  })
})

describe('buildRibbonGeometry', () => {
  it('lays a straight run at the rule width and the copper height', () => {
    const geometry = buildRibbonGeometry(
      [{ points: [{ x: -5, z: 2 }, { x: 5, z: 2 }], widthMm: 0.2 }],
      0,
      0.035,
    )
    if (!geometry) throw new Error('the ribbon produced no faces')
    const box = boundsOf(geometry)
    expect(box.min.x).toBeCloseTo(-5, 5)
    expect(box.max.x).toBeCloseTo(5, 5)
    expect(box.min.z).toBeCloseTo(1.9, 5)
    expect(box.max.z).toBeCloseTo(2.1, 5)
    expect(box.min.y).toBeCloseTo(0, 5)
    expect(box.max.y).toBeCloseTo(0.035, 5)
    // Twelve faces: two top, two bottom, four side wall, four end cap.
    expect(geometry.getAttribute('position').count).toBe(12 * 3)
  })

  it('mitres a corner to the point real copper turns at', () => {
    // Two half-width strips meeting at 90 degrees have their outer corner at
    // (x - half, z + half), which is one half-width/cos(45) along the bisector.
    // Beading every vertex with a disc, which is what this replaced, reached
    // half width in all directions and pinched between the beads.
    const half = 0.15
    const geometry = buildRibbonGeometry(
      [{ points: [{ x: 0, z: 0 }, { x: 0, z: 4 }, { x: 4, z: 4 }], widthMm: half * 2 }],
      0,
      0.035,
    )
    if (!geometry) throw new Error('the ribbon produced no faces')
    const box = boundsOf(geometry)
    expect(box.min.x).toBeCloseTo(-half, 6)
    expect(box.max.z).toBeCloseTo(4 + half, 6)
    // The run starts square at its terminal, so nothing hangs below z = 0.
    expect(box.min.z).toBeCloseTo(0, 6)
    const position = geometry.getAttribute('position')
    // The buffer is Float32, so a miter vertex is within microns of the exact
    // number, not within nanometres of it.
    const onMiterPoint = (x: number, z: number) => {
      for (let index = 0; index < position.count; index += 1) {
        if (Math.abs(position.getX(index) - x) < 1e-6 && Math.abs(position.getZ(index) - z) < 1e-6) return true
      }
      return false
    }
    expect(onMiterPoint(-half, 4 + half)).toBe(true)
    expect(onMiterPoint(half, 4 - half)).toBe(true)
  })

  it('limits a reversal to a bevel instead of a spike', () => {
    const geometry = buildRibbonGeometry(
      [{ points: [{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 0.0001, z: 0 }], widthMm: 0.2 }],
      0,
      0.035,
    )
    if (!geometry) throw new Error('the ribbon produced no faces')
    const box = boundsOf(geometry)
    // The clamp is four half-widths, so nothing may run away past it.
    expect(box.max.x).toBeLessThanOrEqual(2 + 0.4 + 1e-6)
    expect(box.min.z).toBeGreaterThanOrEqual(-0.4 - 1e-6)
  })

  it('draws a stud for a point net and nothing for an empty layer', () => {
    const single = buildRibbonGeometry([{ points: [{ x: 1, z: 1 }], widthMm: 0.4 }], 0, 0.035)
    expect(single).not.toBeNull()
    const box = boundsOf(single!)
    expect(box.min.x).toBeCloseTo(0.8, 6)
    expect(box.max.x).toBeCloseTo(1.2, 6)
    expect(buildRibbonGeometry([], 0, 0.035)).toBeNull()
    expect(buildRibbonGeometry([{ points: [{ x: 0, z: 0 }], widthMm: 0.2 }], 0.1, 0.1)).toBeNull()
  })
})
