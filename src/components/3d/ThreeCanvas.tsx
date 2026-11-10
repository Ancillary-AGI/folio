import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { Download, Focus, Upload, X } from 'lucide-react'
import type { MechanicalComponent } from '../../types/mechanical'
import { ThreeManager } from '../../lib/3d/threeManager'
import {
  VIEW_DIRECTIONS,
  VIEW_UPS,
  framingDistance,
  updateClipPlanes,
  type ThreeView,
} from '../../lib/3d/framing'
import { MeshImportError, readMeshFile, shellProblem, type MeshReport } from '../../lib/3d/meshMeasure'
import { restoreSolidMaterials, setShadingMode as shadeScene } from '../../lib/3d/outline'
import { parseObj } from '../../lib/3d/objImporter'
import { parseStl } from '../../lib/3d/stlImporter'
import { useProjectStore } from '../../stores/useProjectStore'
import { usePreferenceValue } from '../../lib/settings/usePreference'
import { useReferenceModelStore } from '../../stores/useReferenceModelStore'
import { Button } from '../ui/button'

export type { ThreeView }

export interface MechanicalLoadArrow {
  componentId: string
  direction: { x: number; y: number; z: number }
  magnitude: number
}

export interface MechanicalSupportMarker {
  componentId: string
  kind: 'fixed' | 'pinned' | 'roller'
}

interface ThreeCanvasProps {
  components: MechanicalComponent[]
  className?: string
  /** Camera preset; changing it reframes the model. */
  view?: ThreeView
  showLoads?: boolean
  loads?: MechanicalLoadArrow[]
  showSupports?: boolean
  supports?: MechanicalSupportMarker[]
  /** von Mises stress in MPa keyed by component id; colours the part green → red. */
  stress?: Record<string, number>
}

/** WebGL cannot be created in jsdom or in browsers with GPU access disabled. */
function webglAvailable(): boolean {
  return typeof WebGLRenderingContext !== 'undefined'
}

const NO_LOADS: MechanicalLoadArrow[] = []
const NO_SUPPORTS: MechanicalSupportMarker[] = []

/** Metallic vs. polymer response for the PBR material. */
function finishFor(materialName: string): { metalness: number; roughness: number } {
  const name = materialName.toLowerCase()
  if (/alum|steel|titan|copper|brass|iron|alloy|metal/.test(name)) {
    return { metalness: 0.9, roughness: 0.32 }
  }
  if (/rubber|elastomer|silicone/.test(name)) {
    return { metalness: 0, roughness: 0.92 }
  }
  if (/abs|pla|nylon|petg|resin|plastic|polymer/.test(name)) {
    return { metalness: 0.03, roughness: 0.55 }
  }
  return { metalness: 0.4, roughness: 0.45 }
}

/** Bounds of the actual models plus any imported reference flagged for framing. */
function modelBounds(scene: NonNullable<ReturnType<ThreeManager['getScene']>>): THREE.Box3 {
  const bounds = new THREE.Box3()
  for (const model of scene.models) bounds.expandByObject(model.mesh)
  scene.scene.traverse(object => {
    if (object.userData.includeInFraming) bounds.expandByObject(object)
  })
  return bounds
}

function formatMillimetres(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (value >= 100) return value.toFixed(0)
  if (value >= 10) return value.toFixed(1)
  return value.toFixed(2)
}

function formatVolume(mm3: number): string {
  if (mm3 >= 1_000_000) return `${(mm3 / 1_000_000).toFixed(2)} L`
  if (mm3 >= 1_000) return `${(mm3 / 1_000).toFixed(2)} cm³`
  return `${mm3.toFixed(1)} mm³`
}

/** Says what the shell walk found, rather than claiming every import is a solid. */
function shellSummary(mesh: MeshReport): string {
  const problem = shellProblem(mesh)
  if (problem === null) return `Closed shell · ${formatVolume(mesh.volumeMm3)}`
  return `${problem}; volume ${mesh.topology.analysed ? 'undefined' : 'unchecked'}`
}

/** The extension picks the reader; the bytes decide whether the file was named honestly. */
async function readReferenceMesh(file: File): Promise<MeshReport> {
  const buffer = await readMeshFile(file)
  return /\.obj$/i.test(file.name) ? parseObj(buffer) : parseStl(buffer)
}

function meshKind(format: MeshReport['format']): string {
  return format === 'obj' ? 'OBJ' : 'STL'
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse(child => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
      /*
       * Buffers and finishes flagged `shared` belong to a cache outside this
       * subtree: the outline pass keeps one crease wire per shape and one ghost
       * per colour, and this viewport rebuilds every part on each edit. Releasing
       * what it does not own would kill the shading of every part still on screen.
       */
      if (!child.geometry.userData.shared) child.geometry.dispose()
      const materials = Array.isArray(child.material) ? child.material : [child.material]
      materials.forEach(material => {
        if (!material.userData.shared) material.dispose()
      })
    }
  })
}

export default function ThreeCanvas({
  components,
  className = '',
  view = 'iso',
  showLoads = false,
  loads = NO_LOADS,
  showSupports = false,
  supports = NO_SUPPORTS,
  stress,
}: ThreeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const managerRef = useRef<ThreeManager | null>(null)
  const sceneIdRef = useRef<string | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const frameRef = useRef<(mode: ThreeView) => void>(() => {})
  const fileInputRef = useRef<HTMLInputElement>(null)
  const reference = useReferenceModelStore((state) => state.reference)
  const setReference = useReferenceModelStore((state) => state.setReference)
  /** Read from the app, not from a prop: every viewport shades the same way. */
  const shadingMode = usePreferenceValue('shadingMode')
  const projectId = useProjectStore((state) => state.currentProject?.id ?? null)
  const [unavailable, setUnavailable] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

  /*
   * A reference belongs to the project it was imported for. Carrying another
   * design's housing beside this assembly would mislead the viewport and every
   * agent that reads it, so switching projects drops it.
   */
  useEffect(() => {
    if (reference && reference.projectId !== projectId) setReference(null)
  }, [reference, projectId, setReference])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (!webglAvailable()) {
      setUnavailable(true)
      return
    }

    let created: { manager: ThreeManager; scene: ReturnType<ThreeManager['createScene']> } | null = null
    try {
      const manager = new ThreeManager()
      created = { manager, scene: manager.createScene('Mechanical assembly', canvas) }
    } catch (error) {
      console.warn('3D viewport unavailable:', error)
      setUnavailable(true)
      return
    }

    const { manager, scene } = created
    let environment: { texture: THREE.Texture; generator: THREE.PMREMGenerator } | null = null
    try {
      // A captured room gives metals real reflections instead of flat shading.
      const generator = new THREE.PMREMGenerator(scene.renderer)
      const texture = generator.fromScene(new RoomEnvironment(), 0.04).texture
      scene.scene.environment = texture
      scene.scene.environmentIntensity = 0.65
      environment = { texture, generator }
    } catch (error) {
      console.warn('Environment map unavailable:', error)
    }

    const controls = new OrbitControls(scene.camera, canvas)
    controls.enableDamping = true
    controls.addEventListener('change', () => manager.renderScene(scene.id))
    managerRef.current = manager
    sceneIdRef.current = scene.id
    controlsRef.current = controls

    const frame = (mode: ThreeView) => {
      const bounds = modelBounds(scene)
      if (bounds.isEmpty()) {
        scene.camera.position.set(4, 3, 4)
        scene.camera.lookAt(0, 0, 0)
        controls.target.set(0, 0, 0)
        controls.update()
        return
      }
      const center = bounds.getCenter(new THREE.Vector3())
      const size = bounds.getSize(new THREE.Vector3())
      const distance = framingDistance(scene.camera, size)
      updateClipPlanes(scene.camera, distance)
      scene.camera.up.copy(VIEW_UPS[mode])
      scene.camera.position.copy(center).addScaledVector(VIEW_DIRECTIONS[mode], distance)
      scene.camera.lookAt(center)
      controls.target.copy(center)
      controls.update()
      manager.renderScene(scene.id)
    }
    frameRef.current = frame

    const resize = () => {
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      if (width === 0 || height === 0) return
      scene.renderer.setSize(width, height, false)
      scene.camera.aspect = width / height
      scene.camera.updateProjectionMatrix()
      manager.renderScene(scene.id)
    }
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(canvas)
    resize()
    let frameId = 0
    const renderFrame = () => {
      controls.update()
      manager.renderScene(scene.id)
      frameId = requestAnimationFrame(renderFrame)
    }
    frameId = requestAnimationFrame(renderFrame)

    return () => {
      cancelAnimationFrame(frameId)
      resizeObserver.disconnect()
      controls.dispose()
      manager.disposeScene(scene.id)
      scene.scene.environment = null
      environment?.texture.dispose()
      environment?.generator.dispose()
      frameRef.current = () => {}
      controlsRef.current = null
      managerRef.current = null
      sceneIdRef.current = null
    }
  }, [])

  useEffect(() => {
    const manager = managerRef.current
    const sceneId = sceneIdRef.current
    const scene = sceneId ? manager?.getScene(sceneId) : undefined
    if (!manager || !scene || !sceneId) return

    for (const model of [...scene.models]) {
      scene.scene.remove(model.mesh)
      // A shaded part keeps its real finish on `userData`, where the walk below
      // cannot see it; put it back so the finish dies with the part.
      restoreSolidMaterials(model.mesh)
      disposeObject(model.mesh)
      scene.models.splice(scene.models.indexOf(model), 1)
    }

    const columns = Math.max(1, Math.ceil(Math.sqrt(components.length)))
    const maxStress = stress ? Math.max(0, ...Object.values(stress)) : 0
    components.forEach((component, index) => {
      const dimensions = component.geometry.dimensions ?? { width: 0.25, height: 0.25 }
      const requestedType = component.geometry.type
      const geometryType = requestedType === 'sphere' || requestedType === 'cylinder' ? requestedType : 'box'
      const depth = component.geometry.depth ?? (component.geometry.radius ? component.geometry.radius * 2 : 0.25)
      const model = manager.createModel(component.name, geometryType, dimensions, { depth })
      model.id = component.id
      model.mesh.name = component.id
      const placement = component.geometry.position
      model.position = {
        x: placement?.x ?? (index % columns) * 0.75,
        y: placement?.y ?? 0,
        z: placement?.z ?? Math.floor(index / columns) * 0.75,
      }
      if (component.geometry.rotation) {
        model.rotation = { ...component.geometry.rotation }
      }
      manager.addModelToScene(sceneId, model)

      const material = Array.isArray(model.material) ? model.material[0] : model.material
      if ('color' in material && material.color instanceof THREE.Color) {
        const value = stress?.[component.id]
        if (value !== undefined && maxStress > 0) {
          const heat = Math.min(1, Math.max(0, value / maxStress))
          material.color.setHSL(0.33 * (1 - heat), 0.85, 0.45)
        } else if (component.material.color !== undefined) {
          material.color.setHex(component.material.color)
        }
      }
      if (material instanceof THREE.MeshStandardMaterial) {
        const finish = finishFor(component.material.name)
        material.metalness = finish.metalness
        material.roughness = finish.roughness
      }

      // Machined edges: a crisp bevel line reads as a solid part rather than a
      // flat-shaded block. Child of the mesh, so exports still use the nominal
      // box and never include the overlay.
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(model.geometry, 28),
        new THREE.LineBasicMaterial({ color: 0x0b1017, transparent: true, opacity: 0.35 }),
      )
      edges.name = 'part-edges'
      model.mesh.add(edges)

      /*
       * The bevel stroke is the same crease the outline pass draws, only darker
       * and fainter — two strokes on one edge read as a printing error. Parts are
       * annotated geometry's only competition, so the load arrows and support
       * markers outside the mesh keep their solid look either way.
       */
      edges.visible = shadingMode !== 'outline'
      shadeScene(model.mesh, shadingMode)
    })

    manager.renderScene(sceneId)
  }, [components, stress, shadingMode])

  /*
   * Swapping assemblies can change scale by orders of magnitude (a metre-long
   * beam replaced by a 70 mm enclosure). The camera is only framed on mount or
   * an explicit view change, so reframe when the overall extent changes that
   * drastically. Small edits keep the user's current orbit.
   */
  const lastExtentRef = useRef<number | null>(null)
  useEffect(() => {
    if (unavailable) return
    const manager = managerRef.current
    const sceneId = sceneIdRef.current
    const scene = sceneId ? manager?.getScene(sceneId) : undefined
    if (!manager || !scene || !sceneId) return
    const bounds = modelBounds(scene)
    if (bounds.isEmpty()) return
    const size = bounds.getSize(new THREE.Vector3())
    const extent = Math.max(size.x, size.y, size.z)
    const previous = lastExtentRef.current
    lastExtentRef.current = extent
    if (previous !== null && extent > 0 && previous > 0) {
      const ratio = extent / previous
      if (ratio > 4 || ratio < 0.25) frameRef.current(view)
    }
  }, [components, view, unavailable])

  /* Ground plane + grid: without a receiver, the shadow-map work never shows;
     the grid also gives the camera an absolute sense of scale. */
  useEffect(() => {
    const manager = managerRef.current
    const sceneId = sceneIdRef.current
    const scene = sceneId ? manager?.getScene(sceneId) : undefined
    if (!manager || !scene || !sceneId || scene.models.length === 0) return

    const bounds = modelBounds(scene)
    if (bounds.isEmpty()) return
    const size = bounds.getSize(new THREE.Vector3())
    // Scale the workbench to the assembly. A fixed 2 m floor dwarfed the 70 mm
    // enclosure until it read as a speck on a mostly empty grid.
    const extent = Math.max(size.x, size.z, 1e-3)
    const groundY = bounds.min.y - Math.max(0.0005, extent * 0.002)
    const centerX = (bounds.min.x + bounds.max.x) / 2
    const centerZ = (bounds.min.z + bounds.max.z) / 2

    const group = new THREE.Group()
    group.name = 'mechanical-ground'

    const gridSize = Math.max(0.05, extent * 1.8)
    const grid = new THREE.GridHelper(gridSize, Math.max(8, Math.min(40, Math.round(gridSize / 0.1))), 0x334155, 0x1e293b)
    grid.position.set(centerX, groundY, centerZ)
    const gridMaterial = grid.material as THREE.LineBasicMaterial
    gridMaterial.transparent = true
    gridMaterial.opacity = 0.5
    group.add(grid)

    const shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(gridSize * 1.4, gridSize * 1.4),
      new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.38 }),
    )
    shadowPlane.rotation.x = -Math.PI / 2
    shadowPlane.position.set(centerX, groundY - 0.001, centerZ)
    shadowPlane.receiveShadow = true
    group.add(shadowPlane)

    scene.scene.add(group)
    manager.renderScene(sceneId)

    return () => {
      scene.scene.remove(group)
      disposeObject(group)
    }
  }, [components])

  useEffect(() => {
    const manager = managerRef.current
    const sceneId = sceneIdRef.current
    const scene = sceneId ? manager?.getScene(sceneId) : undefined
    if (!manager || !scene || !sceneId || !showLoads || loads.length === 0) return

    const group = new THREE.Group()
    group.name = 'mechanical-loads'
    const maxMagnitude = Math.max(1, ...loads.map(load => load.magnitude))
    for (const load of loads) {
      const model = scene.models.find(candidate => candidate.id === load.componentId)
      if (!model) continue
      const direction = new THREE.Vector3(load.direction.x, load.direction.y, load.direction.z)
      if (direction.lengthSq() === 0) continue
      direction.normalize()
      const length = 0.25 + 0.55 * Math.min(1, load.magnitude / maxMagnitude)
      group.add(
        new THREE.ArrowHelper(direction, model.mesh.position.clone(), length, 0xef4444, length * 0.3, length * 0.18),
      )
    }
    scene.scene.add(group)
    manager.renderScene(sceneId)

    return () => {
      disposeObject(group)
      scene.scene.remove(group)
    }
  }, [loads, showLoads, components])

  useEffect(() => {
    const manager = managerRef.current
    const sceneId = sceneIdRef.current
    const scene = sceneId ? manager?.getScene(sceneId) : undefined
    if (!manager || !scene || !sceneId || !showSupports || supports.length === 0) return

    const group = new THREE.Group()
    group.name = 'mechanical-supports'
    for (const support of supports) {
      const model = scene.models.find(candidate => candidate.id === support.componentId)
      if (!model) continue
      const bounds = new THREE.Box3().setFromObject(model.mesh)
      if (bounds.isEmpty()) continue
      const marker = new THREE.Group()
      marker.position.set(model.mesh.position.x, bounds.min.y, model.mesh.position.z)
      if (support.kind === 'fixed') {
        marker.add(new THREE.AxesHelper(0.15))
      } else if (support.kind === 'pinned') {
        const cone = new THREE.Mesh(
          new THREE.ConeGeometry(0.04, 0.08, 4),
          new THREE.MeshBasicMaterial({ color: 0xfbbf24 }),
        )
        cone.position.y = 0.04
        marker.add(cone)
      } else {
        marker.add(
          new THREE.Mesh(
            new THREE.SphereGeometry(0.035, 12, 8),
            new THREE.MeshBasicMaterial({ color: 0x22d3ee }),
          ),
        )
      }
      group.add(marker)
    }
    scene.scene.add(group)
    manager.renderScene(sceneId)

    return () => {
      disposeObject(group)
      scene.scene.remove(group)
    }
  }, [supports, showSupports, components])

  /*
   * Imported STL reference. It lives directly on the scene rather than in
   * scene.models, so the STL/OBJ/GLTF exporters keep exporting the assembly
   * the user is designing — not the reference they brought in to compare.
   */
  useEffect(() => {
    const manager = managerRef.current
    const sceneId = sceneIdRef.current
    const scene = sceneId ? manager?.getScene(sceneId) : undefined
    if (!manager || !scene || !sceneId || !reference) return

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(reference.mesh.positions, 3))
    geometry.setAttribute('normal', new THREE.BufferAttribute(reference.mesh.normals, 3))
    geometry.computeBoundingSphere()

    const material = new THREE.MeshStandardMaterial({
      color: 0x9fb3c8,
      metalness: 0.35,
      roughness: 0.45,
      side: THREE.DoubleSide,
      flatShading: true,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = 'reference-model-mesh'
    // STL carries no unit; read as millimetres and convert to scene metres.
    mesh.scale.setScalar(0.001)

    // Centre the model in its own footprint and put its base at y = 0, so the
    // group can be placed beside the assembly without re-measuring.
    const { bounds } = reference.mesh
    mesh.position.set(
      -((bounds.min[0] + bounds.max[0]) / 2) * 0.001,
      -bounds.min[1] * 0.001,
      -((bounds.min[2] + bounds.max[2]) / 2) * 0.001,
    )

    const group = new THREE.Group()
    group.name = 'reference-model'
    group.userData.includeInFraming = true
    group.add(mesh)

    const assembly = modelBounds(scene)
    if (!assembly.isEmpty()) {
      const size = assembly.getSize(new THREE.Vector3())
      const centre = assembly.getCenter(new THREE.Vector3())
      const gap = Math.max(0.02, Math.max(size.x, size.z) * 0.15)
      group.position.set(assembly.max.x + gap + (bounds.size[0] * 0.001) / 2, assembly.min.y, centre.z)
    }

    scene.scene.add(group)
    manager.renderScene(sceneId)

    return () => {
      scene.scene.remove(group)
      geometry.dispose()
      material.dispose()
    }
  }, [reference])

  useEffect(() => {
    if (!unavailable) frameRef.current(view)
  }, [view, unavailable])

  const fitToView = useCallback(() => {
    const manager = managerRef.current
    const sceneId = sceneIdRef.current
    const scene = sceneId ? manager?.getScene(sceneId) : undefined
    const controls = controlsRef.current
    if (!manager || !scene || !controls) return

    const bounds = modelBounds(scene)
    if (bounds.isEmpty()) return
    const center = bounds.getCenter(new THREE.Vector3())
    const size = bounds.getSize(new THREE.Vector3())
    const direction = scene.camera.position.clone().sub(controls.target)
    if (direction.lengthSq() === 0) direction.set(1, 0.8, 1)
    direction.normalize()
    const distance = framingDistance(scene.camera, size)
    updateClipPlanes(scene.camera, distance)
    scene.camera.position.copy(center).addScaledVector(direction, distance)
    scene.camera.lookAt(center)
    controls.target.copy(center)
    controls.update()
    manager.renderScene(scene.id)
  }, [])

  /*
   * A newly imported model must be visible without hunting for it, and removing
   * it should bring the assembly back into frame while keeping the camera
   * direction the user chose.
   */
  const hadReferenceRef = useRef(false)
  useEffect(() => {
    if (reference) {
      hadReferenceRef.current = true
      frameRef.current('iso')
    } else if (hadReferenceRef.current) {
      hadReferenceRef.current = false
      fitToView()
    }
  }, [reference, fitToView])

  const download = (content: string, filename: string, type: string) => {
    const url = URL.createObjectURL(new Blob([content], { type }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    // Revoking synchronously can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  const exportModel = useCallback((format: 'stl' | 'obj') => {
    const manager = managerRef.current
    const sceneId = sceneIdRef.current
    if (!manager || !sceneId) return

    try {
      const content = format === 'stl' ? manager.exportToSTL(sceneId) : manager.exportToOBJ(sceneId)
      download(content, `mechanical-assembly.${format}`, 'text/plain')
      setExportError(null)
    } catch (error) {
      setExportError(`${format.toUpperCase()} export failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [])

  const exportGLTF = useCallback(() => {
    const manager = managerRef.current
    const sceneId = sceneIdRef.current
    const scene = sceneId ? manager?.getScene(sceneId) : undefined
    if (!scene) return

    // The assembly models, not the workbench: the grid, load arrows, support
    // markers and any imported reference stay out of the file.
    new GLTFExporter().parse(
      scene.models.map(model => model.mesh),
      result => {
        download(JSON.stringify(result), 'mechanical-assembly.gltf', 'model/gltf+json')
        setExportError(null)
      },
      error => setExportError(`GLTF export failed: ${error instanceof Error ? error.message : String(error)}`),
      { binary: false },
    )
  }, [])

  const importReference = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Reset first so choosing the same file again still fires a change event.
    event.target.value = ''
    if (!file) return
    setImporting(true)
    setImportError(null)
    try {
      const mesh = await readReferenceMesh(file)
      setReference({ name: file.name, mesh, projectId })
    } catch (error) {
      setImportError(
        error instanceof MeshImportError
          ? error.message
          : `Could not read "${file.name}": ${error instanceof Error ? error.message : String(error)}`,
      )
    } finally {
      setImporting(false)
    }
  }, [setReference, projectId])

  const removeReference = useCallback(() => {
    setReference(null)
    setImportError(null)
  }, [setReference])

  if (unavailable) {
    return (
      <div
        className={`relative flex h-full min-h-64 w-full flex-col items-center justify-center gap-2 overflow-hidden bg-canvas p-6 text-center ${className}`}
        role="status"
      >
        <p className="text-sm font-medium text-foreground">3D viewport unavailable</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          This environment did not provide a WebGL context. Geometry and the analysis report remain available.
        </p>
      </div>
    )
  }

  return (
    <div className={`relative h-full min-h-0 w-full overflow-hidden bg-canvas ${className}`}>
      <canvas ref={canvasRef} className="block h-full w-full" aria-label="Mechanical 3D viewport" />
      <input
        ref={fileInputRef}
        type="file"
        accept=".stl,.obj,model/stl,application/sla,text/plain"
        className="hidden"
        onChange={event => {
          void importReference(event)
        }}
        aria-label="Choose an STL or OBJ file to import"
      />
      {/*
       * One right-aligned column, starting clear of the camera presets the
       * mechanical panel anchors top-left. On a narrow viewport the toolbar
       * wraps instead of sliding under those buttons, and the card stays below
       * the controls it describes.
       */}
      <div className="absolute left-64 right-3 top-3 flex flex-col items-end gap-2">
        <div className="flex flex-wrap items-center justify-end gap-1 border border-border bg-card/95 p-1 shadow-md">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => fileInputRef.current?.click()}
            title="Import an STL or OBJ model (millimetres)"
            aria-label="Import STL or OBJ model"
            disabled={importing}
          >
            <Upload className="h-4 w-4" />
          </Button>
          {reference && (
            <Button
              variant="ghost"
              size="icon"
              onClick={removeReference}
              title="Remove imported model"
              aria-label="Remove imported model"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={fitToView} title="Fit model to view" aria-label="Fit model to view">
            <Focus className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => exportModel('stl')} title="Export STL" aria-label="Export STL">
            <Download className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => exportModel('obj')} title="Export OBJ" aria-label="Export OBJ">
            OBJ
          </Button>
          <Button variant="ghost" size="sm" onClick={exportGLTF} title="Export GLTF" aria-label="Export GLTF">
            GLTF
          </Button>
        </div>
        {reference && (
          <div
            className="w-60 max-w-full border border-border bg-card/95 p-2 text-xs shadow-md"
            data-testid="reference-model-card"
          >
            <p className="truncate font-medium text-foreground" title={reference.name}>
              {reference.name}
            </p>
            <p className="text-muted-foreground">
              {meshKind(reference.mesh.format)} · {reference.mesh.triangleCount.toLocaleString()} triangles
            </p>
            <p className="text-muted-foreground">
              {formatMillimetres(reference.mesh.bounds.size[0])} × {formatMillimetres(reference.mesh.bounds.size[1])} ×{' '}
              {formatMillimetres(reference.mesh.bounds.size[2])} mm
            </p>
            <p
              className={
                reference.mesh.topology.watertight === true
                  ? 'text-success'
                  : reference.mesh.topology.watertight === null
                    ? 'text-muted-foreground'
                    : 'text-warning'
              }
            >
              {shellSummary(reference.mesh)}
            </p>
            {reference.mesh.degenerateTriangles > 0 && (
              <p className="text-warning">
                {reference.mesh.degenerateTriangles} degenerate facet
                {reference.mesh.degenerateTriangles === 1 ? '' : 's'} ignored
              </p>
            )}
            <p className="mt-1 text-muted-foreground">
              {meshKind(reference.mesh.format)} is unitless; coordinates read as millimetres.
            </p>
          </div>
        )}
        {(exportError || importError) && (
          <p
            role="alert"
            className="w-60 max-w-full border border-destructive/40 bg-card/95 px-3 py-2 text-xs text-destructive shadow-md"
          >
            {exportError ?? importError}
          </p>
        )}
      </div>
    </div>
  )
}
