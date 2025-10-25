import React, { useRef, useEffect } from 'react'
import { ThreeManager } from '../../lib/3d/threeManager'
import { MechanicalComponent } from '../../types/toolbox'

interface ThreeCanvasProps {
  components: MechanicalComponent[]
  className?: string
}

export default function ThreeCanvas({ components, className = '' }: ThreeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const threeManagerRef = useRef<ThreeManager | null>(null)

  useEffect(() => {
    if (canvasRef.current && !threeManagerRef.current) {
      threeManagerRef.current = new ThreeManager(canvasRef.current)

      // Add initial components
      components.forEach(component => {
        threeManagerRef.current!.addMechanicalComponent(component)
      })
    }

    return () => {
      if (threeManagerRef.current) {
        threeManagerRef.current.dispose()
        threeManagerRef.current = null
      }
    }
  }, [])

  // Update components when they change
  useEffect(() => {
    if (!threeManagerRef.current) return

    // Clear existing components
    const manager = threeManagerRef.current
    components.forEach(component => {
      if (!manager.getScene().getObjectByName(component.id)) {
        manager.addMechanicalComponent(component)
      }
    })

    // Fit to view when components change
    setTimeout(() => {
      manager.fitToView()
    }, 100)
  }, [components])

  const handleExportSTL = () => {
    if (!threeManagerRef.current) return

    const stlData = threeManagerRef.current.exportSTL()
    const blob = new Blob([stlData], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)

    const link = document.createElement('a')
    link.href = url
    link.download = 'model.stl'
    link.click()

    URL.revokeObjectURL(url)
  }

  const handleExportOBJ = () => {
    if (!threeManagerRef.current) return

    const objData = threeManagerRef.current.exportOBJ()
    const blob = new Blob([objData], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)

    const link = document.createElement('a')
    link.href = url
    link.download = 'model.obj'
    link.click()

    URL.revokeObjectURL(url)
  }

  const handleExportGLTF = async () => {
    if (!threeManagerRef.current) return

    try {
      const gltfData = await threeManagerRef.current.exportGLTF()
      const blob = new Blob([gltfData], { type: 'application/json' })
      const url = URL.createObjectURL(blob)

      const link = document.createElement('a')
      link.href = url
      link.download = 'model.gltf'
      link.click()

      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Failed to export GLTF:', error)
    }
  }

  const handleFitToView = () => {
    if (threeManagerRef.current) {
      threeManagerRef.current.fitToView()
    }
  }

  return (
    <div className={`relative ${className}`}>
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{ display: 'block' }}
      />

      {/* Control Panel */}
      <div className="absolute top-4 left-4 bg-card border border-border rounded-lg p-2 shadow-lg">
        <div className="flex gap-2">
          <button
            onClick={handleFitToView}
            className="px-3 py-1 bg-primary text-primary-foreground rounded text-sm hover:bg-primary/90"
            title="Fit to View"
          >
            Fit
          </button>
          <button
            onClick={handleExportSTL}
            className="px-3 py-1 bg-secondary text-secondary-foreground rounded text-sm hover:bg-secondary/90"
            title="Export STL"
          >
            STL
          </button>
          <button
            onClick={handleExportOBJ}
            className="px-3 py-1 bg-secondary text-secondary-foreground rounded text-sm hover:bg-secondary/90"
            title="Export OBJ"
          >
            OBJ
          </button>
          <button
            onClick={handleExportGLTF}
            className="px-3 py-1 bg-secondary text-secondary-foreground rounded text-sm hover:bg-secondary/90"
            title="Export GLTF"
          >
            GLTF
          </button>
        </div>
      </div>

      {/* Info Panel */}
      <div className="absolute bottom-4 left-4 bg-card border border-border rounded-lg p-3 shadow-lg text-sm">
        <div className="text-foreground">
          Components: {components.length}
        </div>
        <div className="text-muted-foreground">
          Use mouse to orbit, zoom, and pan
        </div>
      </div>
    </div>
  )
}