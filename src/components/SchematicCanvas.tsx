import React, { useRef, useEffect, useState } from 'react'
import { Stage, Layer, Rect, Line, Circle, Text, Group } from 'react-konva'
import { Component } from '../lib/supabase'
import { useAppStore } from '../stores/useAppStore'
import { useProjectStore } from '../stores/useProjectStore'
import Konva from 'konva'

interface SchematicCanvasProps {
  components: Component[]
  onSave: (data: Record<string, unknown>) => void
}

export default function SchematicCanvas({ components, onSave }: SchematicCanvasProps) {
  const stageRef = useRef<Konva.Stage>(null)
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 })
  const [isDragging, setIsDragging] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const {
    viewport,
    settings,
    activeTool,
    setZoom,
    setPan,
    selectedComponents,
    setSelectedComponents
  } = useAppStore()

  const {
    components: canvasComponents,
    wires,
    addComponent,
    updateComponent,
    removeComponent,
    markDirty
  } = useProjectStore()

  useEffect(() => {
    const handleResize = () => {
      const container = stageRef.current?.container()
      if (container) {
        const containerRect = container.getBoundingClientRect()
        setStageSize({
          width: containerRect.width,
          height: containerRect.height
        })
      }
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    // Auto-save canvas data
    const saveData = {
      components: canvasComponents,
      wires,
      viewport,
      timestamp: Date.now()
    }
    onSave(saveData)
  }, [canvasComponents, wires, viewport, onSave])

  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
    
    const scaleBy = 1.1
    const stage = e.target.getStage()
    if (!stage) return
    
    const oldScale = stage.scaleX()
    const pointer = stage.getPointerPosition()
    if (!pointer) return
    
    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    }
    
    const newScale = e.evt.deltaY > 0 ? oldScale * scaleBy : oldScale / scaleBy
    const clampedScale = Math.max(0.1, Math.min(5, newScale))
    
    setZoom(clampedScale)
    
    const newPos = {
      x: pointer.x - mousePointTo.x * clampedScale,
      y: pointer.y - mousePointTo.y * clampedScale,
    }
    
    setPan(newPos)
    stage.scale({ x: clampedScale, y: clampedScale })
    stage.position(newPos)
  }

  const handleDragStart = () => {
    setIsDragging(true)
  }

  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    setIsDragging(false)
    const id = e.target.id()
    const newPos = e.target.position()

    if (id && canvasComponents.find(c => c.id === id)) {
      updateComponent(id, { x: newPos.x, y: newPos.y })
      markDirty()
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const componentId = e.dataTransfer.getData('componentId')
    const component = components.find(c => c.id === componentId)

    if (component && stageRef.current) {
      const stage = stageRef.current.getStage()
      const pointer = stage.getPointerPosition()
      if (pointer) {
        const pos = {
          x: (pointer.x - viewport.pan.x) / viewport.zoom,
          y: (pointer.y - viewport.pan.y) / viewport.zoom
        }

        // Snap to grid if enabled
        if (settings.snapToGrid) {
          pos.x = Math.round(pos.x / settings.gridSize) * settings.gridSize
          pos.y = Math.round(pos.y / settings.gridSize) * settings.gridSize
        }

        const canvasComponent = {
          id: `comp-${Date.now()}-${Math.random()}`,
          componentId: component.id!,
          component,
          x: pos.x,
          y: pos.y,
          rotation: 0,
          reference: `${component.name.charAt(0)}${canvasComponents.length + 1}`,
          properties: { ...component.default_properties }
        }

        addComponent(canvasComponent)
        markDirty()
      }
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleStageClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.target === e.target.getStage()) {
      setSelectedId(null)
      setSelectedComponents([])
    }
  }

  const handleComponentClick = (id: string) => {
    setSelectedId(id)
    setSelectedComponents([id])
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Delete' && selectedComponents.length > 0) {
      selectedComponents.forEach(id => removeComponent(id))
      setSelectedComponents([])
      setSelectedId(null)
      markDirty()
    }
  }

  useEffect(() => {
    const handleKeyDownWrapper = (e: KeyboardEvent) => handleKeyDown(e)
    window.addEventListener('keydown', handleKeyDownWrapper)
    return () => window.removeEventListener('keydown', handleKeyDownWrapper)
  }, [selectedComponents, removeComponent, setSelectedComponents, setSelectedId, markDirty])

  const renderGrid = () => {
    if (!settings.showGrid) return null
    
    const gridLines = []
    const gridSize = settings.gridSize
    
    // Vertical lines
    for (let i = 0; i < stageSize.width / gridSize; i++) {
      gridLines.push(
        <Line
          key={`v-${i}`}
          points={[i * gridSize, 0, i * gridSize, stageSize.height]}
          stroke="#e0e0e0"
          strokeWidth={0.5}
          listening={false}
        />
      )
    }
    
    // Horizontal lines
    for (let i = 0; i < stageSize.height / gridSize; i++) {
      gridLines.push(
        <Line
          key={`h-${i}`}
          points={[0, i * gridSize, stageSize.width, i * gridSize]}
          stroke="#e0e0e0"
          strokeWidth={0.5}
          listening={false}
        />
      )
    }
    
    return gridLines
  }

  const renderComponent = (canvasComp: typeof canvasComponents[0]) => {
    const isSelected = selectedId === canvasComp.id

    return (
      <Group
        key={canvasComp.id}
        id={canvasComp.id}
        x={canvasComp.x}
        y={canvasComp.y}
        draggable={activeTool === 'select'}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onClick={() => handleComponentClick(canvasComp.id)}
      >
        {/* Component body */}
        <Rect
          width={canvasComp.component.symbol_data.width}
          height={canvasComp.component.symbol_data.height}
          fill={isSelected ? '#e3f2fd' : '#ffffff'}
          stroke={isSelected ? '#2196f3' : '#666666'}
          strokeWidth={isSelected ? 2 : 1}
        />

        {/* Component symbol paths */}
        {canvasComp.component.symbol_data.paths.map((path, index) => {
          const commands = path.match(/[MLHVCSQTAZmlhvcsqtaz][^MLHVCSQTAZmlhvcsqtaz]*/g) || []
          const points: number[] = []

          commands.forEach(command => {
            const type = command[0]
            const coords = command.slice(1).trim().split(/[\s,]+/).map(Number)

            if (type === 'M' || type === 'L') {
              points.push(coords[0], coords[1])
            }
          })

          return (
            <Line
              key={index}
              points={points}
              stroke="#333333"
              strokeWidth={2}
              closed={false}
            />
          )
        })}

        {/* Component label */}
        <Text
          text={canvasComp.reference}
          x={canvasComp.component.symbol_data.width / 2}
          y={-20}
          fontSize={12}
          fill="#333333"
          align="center"
          offsetX={canvasComp.reference.length * 3}
        />

        {/* Component value */}
        {canvasComp.properties.value && (
          <Text
            text={String(canvasComp.properties.value)}
            x={canvasComp.component.symbol_data.width / 2}
            y={canvasComp.component.symbol_data.height + 5}
            fontSize={10}
            fill="#666666"
            align="center"
            offsetX={String(canvasComp.properties.value).length * 2.5}
          />
        )}

        {/* Pins */}
        {canvasComp.component.pins.map(pin => (
          <Circle
            key={pin.id}
            x={pin.x}
            y={pin.y}
            radius={3}
            fill="#ff9800"
            stroke="#f57c00"
            strokeWidth={1}
          />
        ))}
      </Group>
    )
  }

  const renderWires = () => {
    return wires.map(wire => (
      <Line
        key={wire.id}
        points={wire.points.flatMap(p => [p.x, p.y])}
        stroke={wire.style?.color || '#2196f3'}
        strokeWidth={wire.style?.width || 2}
        lineCap="round"
        lineJoin="round"
      />
    ))
  }

  return (
    <div
      className="w-full h-full bg-white relative overflow-hidden"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      <Stage
        ref={stageRef}
        width={stageSize.width}
        height={stageSize.height}
        scaleX={viewport.zoom}
        scaleY={viewport.zoom}
        x={viewport.pan.x}
        y={viewport.pan.y}
        onWheel={handleWheel}
        onClick={handleStageClick}
        draggable={activeTool === 'select' && !isDragging}
      >
        <Layer>
          {/* Grid */}
          {renderGrid()}
          
          {/* Wires */}
          {renderWires()}
          
          {/* Components */}
          {canvasComponents.map(renderComponent)}
        </Layer>
      </Stage>
      
      {/* Canvas info overlay */}
      <div className="absolute bottom-4 left-4 bg-white bg-opacity-90 px-3 py-2 rounded shadow text-sm">
        <div>Zoom: {Math.round(viewport.zoom * 100)}%</div>
        <div>Components: {canvasComponents.length}</div>
        <div>Tool: {activeTool}</div>
      </div>
      
      {/* Instructions overlay */}
      {canvasComponents.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center text-gray-500">
            <div className="text-lg font-medium mb-2">Empty Canvas</div>
            <div className="text-sm">
              Drag components from the sidebar to start designing your circuit
            </div>
          </div>
        </div>
      )}
    </div>
  )
}