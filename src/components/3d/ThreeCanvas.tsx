import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { Download, Focus } from 'lucide-react'
import type { MechanicalComponent } from '../../types/toolbox'
import { ThreeManager } from '../../lib/3d/threeManager'
import { Button } from '../ui/button'

export type ThreeView = 'iso' | 'front' | 'side' | 'top'

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

function disposeObject(object: THREE.Object3D): void {
  object.traverse(child => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
      child.geometry.dispose()
      const materials = Array.isArray(child.material) ? child.material : [child.material]
      materials.forEach(material => material.dispose())
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
  const [unavailable, setUnavailable] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

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
    const controls = new OrbitControls(scene.camera, canvas)
    controls.enableDamping = true
    controls.addEventListener('change', () => manager.renderScene(scene.id))
    managerRef.current = manager
    sceneIdRef.current = scene.id
    controlsRef.current = controls

    const frame = (mode: ThreeView) => {
      const bounds = new THREE.Box3().setFromObject(scene.scene)
      if (bounds.isEmpty()) {
        scene.camera.position.set(4, 3, 4)
        scene.camera.lookAt(0, 0, 0)
        controls.target.set(0, 0, 0)
        controls.update()
        return
      }
      const center = bounds.getCenter(new THREE.Vector3())
      const size = bounds.getSize(new THREE.Vector3())
      const extent = Math.max(size.x, size.y, size.z, 0.25)
      const distance = extent * 1.9
      const offsets: Record<ThreeView, THREE.Vector3> = {
        iso: new THREE.Vector3(distance, distance * 0.8, distance),
        front: new THREE.Vector3(0, 0, distance * 1.2),
        side: new THREE.Vector3(distance * 1.2, 0, 0),
        top: new THREE.Vector3(0.001, distance * 1.2, 0.001),
      }
      scene.camera.position.copy(center).add(offsets[mode])
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
      model.geometry.dispose()
      if (Array.isArray(model.material)) model.material.forEach(material => material.dispose())
      else model.material.dispose()
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
    })

    manager.renderScene(sceneId)
  }, [components, stress])

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

  useEffect(() => {
    if (!unavailable) frameRef.current(view)
  }, [view, unavailable])

  const fitToView = useCallback(() => {
    const manager = managerRef.current
    const sceneId = sceneIdRef.current
    const scene = sceneId ? manager?.getScene(sceneId) : undefined
    const controls = controlsRef.current
    if (!manager || !scene || !controls) return

    const bounds = new THREE.Box3().setFromObject(scene.scene)
    if (bounds.isEmpty()) return
    const center = bounds.getCenter(new THREE.Vector3())
    const size = bounds.getSize(new THREE.Vector3())
    const extent = Math.max(size.x, size.y, size.z, 0.5)
    const direction = scene.camera.position.clone().sub(controls.target)
    if (direction.lengthSq() === 0) direction.set(1, 0.8, 1)
    direction.normalize()
    scene.camera.position.copy(center).addScaledVector(direction, extent * 2.2)
    scene.camera.lookAt(center)
    controls.target.copy(center)
    controls.update()
    manager.renderScene(scene.id)
  }, [])

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

    new GLTFExporter().parse(
      scene.scene,
      result => {
        download(JSON.stringify(result), 'mechanical-assembly.gltf', 'model/gltf+json')
        setExportError(null)
      },
      error => setExportError(`GLTF export failed: ${error instanceof Error ? error.message : String(error)}`),
      { binary: false },
    )
  }, [])

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
    <div className={`relative h-full min-h-64 w-full overflow-hidden bg-canvas ${className}`}>
      <canvas ref={canvasRef} className="block h-full w-full" aria-label="Mechanical 3D viewport" />
      <div className="absolute right-3 top-3 flex items-center gap-1 border border-border bg-card/95 p-1 shadow-md">
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
      {exportError && (
        <p
          role="alert"
          className="absolute bottom-3 left-3 right-3 border border-destructive/40 bg-card/95 px-3 py-2 text-xs text-destructive shadow-md"
        >
          {exportError}
        </p>
      )}
    </div>
  )
}
