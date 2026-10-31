import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { buildLaptopPcb } from '../demo/demoLaptopBoard'
import { buildPcbScene, type PcbScene } from './pcbScene'
import {
  applyComponentScale,
  buildPcbGroup,
  disposePcbGroup,
  type PcbBoardGroupOptions,
} from './pcb3dModel'

/**
 * The budget the dense-board 3-D preview has to stay inside.
 *
 * Rendering the laptop mainboard used to stop the tab: `buildPcbGroup` laid one
 * geometry per copper feature, ear-clipped the boundary of six poured planes and
 * 2 747 keepaways against them and put 1 853 objects in the shadow map, and the
 * call took 83 seconds.
 * Every bound below was read off a run of this file against the fixed build and
 * given headroom, and the defect each one guards against is named with it.
 * Timings are reported, not asserted: the same build is fast on an idle machine
 * and slow on a loaded runner, so a wall-clock check teaches nothing.
 */

const OPTIONS: PcbBoardGroupOptions = {
  showPCB: true,
  showTraces: true,
  showComponents: true,
  hiddenLayerIds: new Set<string>(),
  hiddenComponentIds: new Set<string>(),
}

interface BuildReport {
  buildMs: number
  meshes: number
  uniqueGeometries: number
  uniqueMaterials: number
  shadowCasters: number
  vertices: number
  triangles: number
}

function build(scene: PcbScene, options: PcbBoardGroupOptions = OPTIONS): { group: THREE.Group; report: BuildReport } {
  const start = performance.now()
  const group = buildPcbGroup(scene, options)
  const buildMs = Math.round(performance.now() - start)
  let meshes = 0
  let vertices = 0
  let triangles = 0
  let shadowCasters = 0
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  group.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    meshes += 1
    if (mesh.castShadow) shadowCasters += 1
    geometries.add(mesh.geometry)
    const position = mesh.geometry.getAttribute('position')
    if (position) vertices += position.count
    const index = mesh.geometry.getIndex()
    triangles += index ? index.count / 3 : (position ? position.count / 3 : 0)
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    list.forEach((material) => materials.add(material))
  })
  return {
    group,
    report: {
      buildMs,
      meshes,
      uniqueGeometries: geometries.size,
      uniqueMaterials: materials.size,
      shadowCasters,
      vertices,
      triangles: Math.round(triangles),
    },
  }
}

function named(group: THREE.Object3D, prefix: string): THREE.Object3D[] {
  const found: THREE.Object3D[] = []
  group.traverse((object) => {
    if (object.name.startsWith(prefix)) found.push(object)
  })
  return found
}

function meshNamed(group: THREE.Object3D, prefix: string): THREE.Mesh {
  const found = named(group, prefix)[0]
  if (!found || !(found instanceof THREE.Mesh)) throw new Error(`No mesh named ${prefix}* in the group.`)
  return found
}

describe('pcb 3d build budget', () => {
  const laptop = buildLaptopPcb()
  const scene = buildPcbScene(laptop.scene)

  it('keeps a 56-part eight-layer mainboard inside the geometry budget', () => {
    const { report } = build(scene)
    console.info(JSON.stringify({ ...report, counts: scene.counts }))
    expect(scene.counts.components).toBe(56)
    // One land per pad: copper lands stay individual objects because they are
    // what the picker, the highlight and the STL export name after them.
    expect(report.meshes).toBeLessThanOrEqual(1_500)
    // Shapes repeat: 615 lands come from a few dozen footprint families.
    expect(report.uniqueGeometries).toBeLessThanOrEqual(200)
    expect(report.uniqueMaterials).toBeLessThanOrEqual(60)
    // Copper is flat and 35 um thick; only mouldings and the slab are worth a
    // shadow-map entry.
    expect(report.shadowCasters).toBeLessThanOrEqual(400)
    expect(report.triangles).toBeLessThanOrEqual(750_000)
  })

  it('draws one ribbon per copper layer and one buffer per via class', () => {
    const { group } = build(scene)
    // One buffer for the drawn copper of a layer — and only the layers that have
    // any: on this stackup the inner planes carry pours, not routed signals.
    const routedLayers = new Set(scene.traces.map((segment) => segment.layerId))
    expect(named(group, 'trace-copper-')).toHaveLength(routedLayers.size)
    expect(routedLayers.size).toBeLessThan(scene.counts.copperLayers)
    expect(named(group, 'via-')).toHaveLength(4)
    // Each poured plane carries its own outline and its own clearance plugs.
    expect(named(group, 'pour-')).toHaveLength(scene.counts.pours * 2)
  })

  it('reuses shared shapes across rebuilds and releases only its own', () => {
    const first = build(scene)
    const second = build(scene)
    const shared = meshNamed(first.group, 'pad-').geometry
    const ribbon = meshNamed(first.group, 'trace-copper-').geometry

    // A land of the same footprint is the same buffer in both boards, so a
    // rebuild after a toggle costs transforms instead of 615 new geometries.
    expect(meshNamed(second.group, 'pad-').geometry).toBe(shared)
    expect(shared.userData.shared).toBe(true)
    // The copper the router laid belongs to this build alone, so this build owns it.
    expect(ribbon).not.toBe(meshNamed(second.group, 'trace-copper-').geometry)

    let sharedFreed = false
    let ribbonFreed = false
    shared.addEventListener('dispose', () => { sharedFreed = true })
    ribbon.addEventListener('dispose', () => { ribbonFreed = true })
    disposePcbGroup(first.group)
    // Freeing the outgoing group must not free the shape the board still on
    // screen is drawn with, and must free what that group built for itself.
    expect(sharedFreed).toBe(false)
    expect(ribbonFreed).toBe(true)

    const third = build(scene)
    expect(meshNamed(third.group, 'pad-').geometry).toBe(shared)
    expect(shared.getAttribute('position').count).toBeGreaterThan(0)
    disposePcbGroup(second.group)
    disposePcbGroup(third.group)
  })

  it('grows bodies about their own centres without lifting the lands', () => {
    const { group } = build(scene)
    const landPositions = named(group, 'pad-').map((pad) => (pad as THREE.Mesh).position.clone())
    applyComponentScale(group, 2.5)
    expect(named(group, 'pad-').map((pad) => (pad as THREE.Mesh).position.clone())).toEqual(landPositions)
    const body = named(group, 'component-')[0]
    if (!body) throw new Error('The board built no component bodies.')
    expect(body.scale.x).toBeCloseTo(2.5, 10)
    // A part grows where it sits: its world centre is still its own position.
    const center = new THREE.Vector3().setFromMatrixPosition(body.matrixWorld)
    expect(center.distanceTo(body.position)).toBeLessThan(1e-9)
  })
})
