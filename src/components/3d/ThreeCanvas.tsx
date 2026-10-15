import { useCallback, useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { Download, Focus } from 'lucide-react'
import type { MechanicalComponent } from '../../types/toolbox'
import { ThreeManager } from '../../lib/3d/threeManager'
import { Button } from '../ui/button'

interface ThreeCanvasProps {
  components: MechanicalComponent[]
  className?: string
}

export default function ThreeCanvas({ components, className = '' }: ThreeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const managerRef = useRef<ThreeManager | null>(null)
  const sceneIdRef = useRef<string | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const manager = new ThreeManager()
    const scene = manager.createScene('Mechanical assembly', canvas)
    const controls = new OrbitControls(scene.camera, canvas)
    controls.enableDamping = true
    controls.addEventListener('change', () => manager.renderScene(scene.id))
    managerRef.current = manager
    sceneIdRef.current = scene.id
    controlsRef.current = controls

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

    const activeIds = new Set(components.map(component => component.id))
    for (const model of [...scene.models]) {
      if (activeIds.has(model.id)) continue
      scene.scene.remove(model.mesh)
      model.geometry.dispose()
      if (Array.isArray(model.material)) model.material.forEach(material => material.dispose())
      else model.material.dispose()
      scene.models.splice(scene.models.indexOf(model), 1)
    }

    const columns = Math.max(1, Math.ceil(Math.sqrt(components.length)))
    components.forEach((component, index) => {
      const existing = scene.models.find(model => model.id === component.id)
      if (existing) return

      const dimensions = component.geometry.dimensions ?? { width: 0.25, height: 0.25 }
      const requestedType = component.geometry.type
      const geometryType = requestedType === 'sphere' || requestedType === 'cylinder' ? requestedType : 'box'
      const model = manager.createModel(component.name, geometryType, dimensions, {
        depth: component.geometry.radius ? component.geometry.radius * 2 : 0.25,
      })
      model.id = component.id
      model.mesh.name = component.id
      model.mesh.position.set((index % columns) * 0.75, 0, Math.floor(index / columns) * 0.75)
      if (component.material.color !== undefined) {
        const material = Array.isArray(model.material) ? model.material[0] : model.material
        if ('color' in material && material.color instanceof THREE.Color) {
          material.color.setHex(component.material.color)
        }
      }
      manager.addModelToScene(sceneId, model)
    })

    manager.renderScene(sceneId)
  }, [components])

  const fitToView = useCallback(() => {
    const manager = managerRef.current
    const sceneId = sceneIdRef.current
    const scene = sceneId ? manager?.getScene(sceneId) : undefined
    if (!manager || !scene) return

    const bounds = new THREE.Box3().setFromObject(scene.scene)
    if (bounds.isEmpty()) return
    const center = bounds.getCenter(new THREE.Vector3())
    const size = bounds.getSize(new THREE.Vector3())
    const extent = Math.max(size.x, size.y, size.z, 0.5)
    scene.camera.position.set(center.x + extent * 1.8, center.y + extent * 1.5, center.z + extent * 1.8)
    scene.camera.lookAt(center)
    scene.renderer.render(scene.scene, scene.camera)
    controlsRef.current?.target.copy(center)
    controlsRef.current?.update()
  }, [])

  const download = (content: string, filename: string, type: string) => {
    const url = URL.createObjectURL(new Blob([content], { type }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const exportModel = useCallback((format: 'stl' | 'obj') => {
    const manager = managerRef.current
    const sceneId = sceneIdRef.current
    if (!manager || !sceneId) return

    const content = format === 'stl' ? manager.exportToSTL(sceneId) : manager.exportToOBJ(sceneId)
    download(content, `mechanical-assembly.${format}`, 'text/plain')
  }, [])

  const exportGLTF = useCallback(() => {
    const manager = managerRef.current
    const sceneId = sceneIdRef.current
    const scene = sceneId ? manager?.getScene(sceneId) : undefined
    if (!scene) return

    new GLTFExporter().parse(
      scene.scene,
      result => download(JSON.stringify(result), 'mechanical-assembly.gltf', 'model/gltf+json'),
      error => console.error('GLTF export failed:', error),
      { binary: false },
    )
  }, [])

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
    </div>
  )
}
