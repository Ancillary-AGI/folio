import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { buildPcbScene, type PcbSceneInput } from './pcbScene'
import {
  buildPcbGroup,
  PAD_FINISH_SPECS,
  SOLDERMASK_SPECS,
  type PcbBoardGroupOptions,
} from './pcb3dModel'

const LAYERS: PcbSceneInput['layers'] = [
  { id: 'top-cu', name: 'Top Copper', kind: 'copper', color: '#cc0000', side: 'top' },
  { id: 'top-silk', name: 'Top Silkscreen', kind: 'silk', color: '#ffffff', side: 'top' },
  { id: 'top-mask', name: 'Top Soldermask', kind: 'mask', color: '#008800', side: 'top' },
]

function input(rotationDeg = 0): PcbSceneInput {
  return {
    widthMm: 40,
    heightMm: 30,
    thicknessMm: 1.6,
    layers: LAYERS,
    traces: [],
    vias: [],
    components: [{
      id: 'D1', reference: 'D1', footprint: 'SMC', category: 'semiconductor',
      x: 20, y: 15, rotationDeg, side: 'top',
    }],
  }
}

const OPTIONS: PcbBoardGroupOptions = {
  showPCB: true,
  showTraces: true,
  showComponents: true,
  hiddenLayerIds: new Set<string>(),
  hiddenComponentIds: new Set<string>(),
  componentScale: 1,
}

function meshesWithPrefix(group: THREE.Group, prefix: string): THREE.Mesh[] {
  const found: THREE.Mesh[] = []
  group.traverse((object) => {
    if (object instanceof THREE.Mesh && object.name.startsWith(prefix)) found.push(object)
  })
  return found
}

function cosmeticTop(scene: ReturnType<typeof buildPcbScene>, kind: 'mask' | 'silk'): number {
  const layer = scene.layers.find((entry) => entry.kind === kind && entry.side !== 'bottom')
  if (!layer) throw new Error(`Missing top ${kind} layer`)
  return layer.yMm + layer.thicknessMm / 2
}

describe('buildPcbGroup copper lands', () => {
  it('seats every pad proud of the mask and silkscreen films', () => {
    const scene = buildPcbScene(input())
    const group = buildPcbGroup(scene, OPTIONS)
    const maskTop = cosmeticTop(scene, 'mask')
    const silkTop = cosmeticTop(scene, 'silk')
    const pads = meshesWithPrefix(group, 'pad-D1-')
    expect(pads).toHaveLength(2)
    const boxes = pads.map((pad) => new THREE.Box3().setFromObject(pad))
    for (const box of boxes) {
      // Embedded in the mask so no coplanar faces flicker at the opening...
      expect(box.min.y).toBeLessThan(maskTop)
      // ...but far enough above the silk film for the depth buffer to order it.
      expect(box.max.y).toBeGreaterThan(silkTop + 0.02)
    }
    expect(boxes[0].max.y).toBeCloseTo(boxes[1].max.y, 9)
  })

  it('keeps copper lands when component bodies are hidden', () => {
    const scene = buildPcbScene(input())
    const group = buildPcbGroup(scene, { ...OPTIONS, showComponents: false })
    expect(meshesWithPrefix(group, 'pad-D1-')).toHaveLength(2)
    expect(group.getObjectByName('component-D1')).toBeUndefined()
  })
})

describe('buildPcbGroup rotation', () => {
  it('rotates a part and its pads together', () => {
    const scene = buildPcbScene(input(90))
    const group = buildPcbGroup(scene, OPTIONS)
    const body = group.getObjectByName('component-D1')
    expect(body).toBeDefined()
    const pads = meshesWithPrefix(group, 'pad-D1-').sort((a, b) => a.name.localeCompare(b.name))
    expect(pads).toHaveLength(2)
    const padAxis = new THREE.Vector3().subVectors(pads[1].position, pads[0].position).normalize()
    const bodyAxis = new THREE.Vector3(1, 0, 0)
      .applyQuaternion(body!.getWorldQuaternion(new THREE.Quaternion()))
      .normalize()
    // A clockwise 90 degree layout rotation puts the pads along board Y.
    expect(Math.abs(padAxis.z)).toBeCloseTo(1, 6)
    expect(Math.abs(padAxis.dot(bodyAxis))).toBeCloseTo(1, 6)
  })

  it('places pads at the scene coordinates the layout produced', () => {
    const scene = buildPcbScene(input(90))
    const group = buildPcbGroup(scene, OPTIONS)
    const pads = meshesWithPrefix(group, 'pad-D1-')
    for (const pad of pads) {
      const source = scene.components[0].pads.find((entry) => `pad-${entry.id}` === pad.name)
      expect(source).toBeDefined()
      expect(pad.position.x).toBeCloseTo(source!.position.x, 9)
      expect(pad.position.z).toBeCloseTo(source!.position.z, 9)
    }
  })
})

interface RecordedCut {
  composite: string
  args: number[]
}

function recordingContext(): { context: CanvasRenderingContext2D; cuts: RecordedCut[] } {
  const cuts: RecordedCut[] = []
  const states: string[] = []
  let composite = 'source-over'
  const context = {
    get globalCompositeOperation() { return composite },
    set globalCompositeOperation(value: string) { composite = value },
    strokeStyle: '', fillStyle: '', lineWidth: 1, lineCap: '', textAlign: '', textBaseline: '', font: '',
    save() { states.push(composite) },
    restore() { composite = states.pop() ?? 'source-over' },
    translate() {}, rotate() {}, scale() {},
    beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, arc() {},
    stroke() {}, fill() {}, strokeRect() {}, fillText() {},
    fillRect(...args: number[]) { cuts.push({ composite, args }) },
    createImageData(width: number, height: number) {
      return { data: new Uint8ClampedArray(width * height * 4) }
    },
    putImageData() {},
  }
  return { context: context as unknown as CanvasRenderingContext2D, cuts }
}

describe('soldermask and pad finish', () => {
  it('paints the slab and the mask film in the selected colour', () => {
    const scene = buildPcbScene(input())
    const group = buildPcbGroup(scene, { ...OPTIONS, maskColor: 'black' })
    const substrate = group.getObjectByName('pcb-substrate') as THREE.Mesh
    const substrateMaterials = Array.isArray(substrate.material) ? substrate.material : [substrate.material]
    const coat = substrateMaterials[0] as THREE.MeshPhysicalMaterial
    expect(`#${coat.color.getHexString()}`).toBe(SOLDERMASK_SPECS.black.baseColor)
    // The matte lacquer must be genuinely rougher than the standard gloss.
    expect(coat.roughness).toBeGreaterThan(SOLDERMASK_SPECS.green.roughness)
    expect(coat.clearcoat).toBeLessThan(SOLDERMASK_SPECS.green.clearcoat)

    const overlay = group.getObjectByName('soldermask-overlay') as THREE.Mesh
    const overlayMaterial = overlay.material as THREE.MeshPhysicalMaterial
    expect(`#${overlayMaterial.color.getHexString()}`).toBe(SOLDERMASK_SPECS.black.overlayColor)
    expect(overlayMaterial.opacity).toBeCloseTo(0.46, 6)
  })

  it('marks every copper land with the selected finish metal', () => {
    const scene = buildPcbScene(input())
    for (const finish of ['enig', 'hasl', 'osp'] as const) {
      const group = buildPcbGroup(scene, { ...OPTIONS, padFinish: finish })
      const [pad] = meshesWithPrefix(group, 'pad-D1-')
      const material = pad.material as THREE.MeshStandardMaterial
      expect(`#${material.color.getHexString()}`).toBe(PAD_FINISH_SPECS[finish].color)
      expect(material.metalness).toBeCloseTo(PAD_FINISH_SPECS[finish].metalness, 6)
      expect(material.roughness).toBeCloseTo(PAD_FINISH_SPECS[finish].roughness, 6)
    }
  })
})

describe('silkscreen artwork', () => {
  it('erases artwork over exposed pads instead of printing across copper', () => {
    const { context, cuts } = recordingContext()
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation(() => context as never)
    try {
      buildPcbGroup(buildPcbScene(input()), OPTIONS)
    } finally {
      spy.mockRestore()
    }
    const erased = cuts.filter((cut) => cut.composite === 'destination-out')
    expect(erased).toHaveLength(2)
    // 2.4 x 3.4 mm pads plus the 0.08 mm mask-opening clearance, at 30 px/mm.
    expect(erased[0].args[2]).toBeCloseTo((2.4 + 0.16) * 30, 6)
    expect(erased[0].args[3]).toBeCloseTo((3.4 + 0.16) * 30, 6)
  })
})
