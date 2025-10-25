import React, { useRef, useEffect, useState, useCallback } from 'react'
import { Stage, Layer, Rect, Text, Group, Line, Circle } from 'react-konva'
import Konva from 'konva'
import { CodeBlock, CodeConnection, CodePort } from '../../types/toolbox'
import { Button } from '../ui/button'
import { Play, Square, RotateCcw, Download } from 'lucide-react'

interface VisualProgrammingCanvasProps {
  blocks: CodeBlock[]
  connections: CodeConnection[]
  onBlockUpdate: (id: string, updates: Partial<CodeBlock>) => void
  onConnectionAdd: (connection: Omit<CodeConnection, 'id'>) => void
  onCompile: () => void
  onRun: () => void
  onStop: () => void
  isRunning: boolean
  className?: string
}

export default function VisualProgrammingCanvas({
  blocks,
  connections,
  onBlockUpdate,
  onConnectionAdd,
  onCompile,
  onRun,
  onStop,
  isRunning,
  className = ''
}: VisualProgrammingCanvasProps) {
  const stageRef = useRef<Konva.Stage>(null)
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 })
  const [selectedBlock, setSelectedBlock] = useState<string | null>(null)
  const [connecting, setConnecting] = useState<{
    fromBlock: string
    fromPort: string
    startPos: { x: number; y: number }
    currentPos: { x: number; y: number }
  } | null>(null)

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

  const handleBlockDragStart = useCallback(() => {
    // Block drag handling
  }, [])

  const handleBlockDragEnd = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    const blockId = e.target.id()
    const newPos = e.target.position()

    onBlockUpdate(blockId, {
      position: { x: newPos.x, y: newPos.y }
    })
  }, [onBlockUpdate])

  const handlePortMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent>, blockId: string, portId: string) => {
    e.cancelBubble = true
    const stage = e.target.getStage()
    if (!stage) return

    const pointer = stage.getPointerPosition()
    if (!pointer) return

    setConnecting({
      fromBlock: blockId,
      fromPort: portId,
      startPos: { x: pointer.x, y: pointer.y },
      currentPos: { x: pointer.x, y: pointer.y }
    })
  }, [])

  const handlePortMouseUp = useCallback((e: Konva.KonvaEventObject<MouseEvent>, blockId: string, portId: string, port: CodePort) => {
    if (!connecting) return

    // Check if this is a valid connection
    const fromBlock = blocks.find(b => b.id === connecting.fromBlock)
    const toBlock = blocks.find(b => b.id === blockId)

    if (!fromBlock || !toBlock || fromBlock.id === toBlock.id) {
      setConnecting(null)
      return
    }

    const fromPort = fromBlock.outputs.find(p => p.id === connecting.fromPort) ||
                    fromBlock.inputs.find(p => p.id === connecting.fromPort)
    const toPort = port

    if (!fromPort || !toPort) {
      setConnecting(null)
      return
    }

    // Check type compatibility and direction
    if (fromPort.type === toPort.type &&
        ((fromPort.direction === 'output' && toPort.direction === 'input') ||
         (fromPort.direction === 'input' && toPort.direction === 'output'))) {

      onConnectionAdd({
        fromBlock: connecting.fromBlock,
        fromPort: connecting.fromPort,
        toBlock: blockId,
        toPort: portId,
        path: [connecting.startPos, { x: e.evt.clientX, y: e.evt.clientY }]
      })
    }

    setConnecting(null)
  }, [connecting, blocks, onConnectionAdd])

  const handleMouseMove = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (connecting) {
      const stage = e.target.getStage()
      if (stage) {
        const pointer = stage.getPointerPosition()
        if (pointer) {
          setConnecting(prev => prev ? {
            ...prev,
            currentPos: { x: pointer.x, y: pointer.y }
          } : null)
        }
      }
    }
  }, [connecting])

  const handleStageClick = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.target === e.target.getStage()) {
      setSelectedBlock(null)
      setConnecting(null)
    }
  }, [])

  const renderBlock = useCallback((block: CodeBlock) => {
    const isSelected = selectedBlock === block.id
    const blockWidth = 120
    const blockHeight = 80
    const portRadius = 6

    return (
      <Group
        key={block.id}
        id={block.id}
        x={block.position.x}
        y={block.position.y}
        draggable
        onDragStart={handleBlockDragStart}
        onDragEnd={handleBlockDragEnd}
        onClick={() => setSelectedBlock(block.id)}
      >
        {/* Block body */}
        <Rect
          width={blockWidth}
          height={blockHeight}
          fill={isSelected ? '#e3f2fd' : '#ffffff'}
          stroke={isSelected ? '#2196f3' : '#666666'}
          strokeWidth={isSelected ? 2 : 1}
          cornerRadius={4}
        />

        {/* Block title */}
        <Text
          text={block.name}
          x={blockWidth / 2}
          y={8}
          fontSize={12}
          fill="#333333"
          align="center"
          offsetX={block.name.length * 3}
        />

        {/* Input ports */}
        {block.inputs.map((port, index) => (
          <Group key={port.id}>
            <Circle
              x={-portRadius}
              y={20 + index * 15}
              radius={portRadius}
              fill="#ff9800"
              stroke="#f57c00"
              strokeWidth={1}
              onMouseDown={(e) => handlePortMouseDown(e, block.id, port.id)}
              onMouseUp={(e) => handlePortMouseUp(e, block.id, port.id, port)}
            />
            <Text
              text={port.name}
              x={-portRadius - 25}
              y={16 + index * 15}
              fontSize={10}
              fill="#666666"
              align="right"
            />
          </Group>
        ))}

        {/* Output ports */}
        {block.outputs.map((port, index) => (
          <Group key={port.id}>
            <Circle
              x={blockWidth + portRadius}
              y={20 + index * 15}
              radius={portRadius}
              fill="#4caf50"
              stroke="#388e3c"
              strokeWidth={1}
              onMouseDown={(e) => handlePortMouseDown(e, block.id, port.id, port)}
              onMouseUp={(e) => handlePortMouseUp(e, block.id, port.id, port)}
            />
            <Text
              text={port.name}
              x={blockWidth + portRadius + 8}
              y={16 + index * 15}
              fontSize={10}
              fill="#666666"
            />
          </Group>
        ))}
      </Group>
    )
  }, [selectedBlock, handleBlockDragStart, handleBlockDragEnd, handlePortMouseDown, handlePortMouseUp])

  const renderConnection = useCallback((connection: CodeConnection) => {
    const fromBlock = blocks.find(b => b.id === connection.fromBlock)
    const toBlock = blocks.find(b => b.id === connection.toBlock)

    if (!fromBlock || !toBlock) return null

    const fromPort = fromBlock.outputs.find(p => p.id === connection.fromPort) ||
                    fromBlock.inputs.find(p => p.id === connection.fromPort)
    const toPort = toBlock.inputs.find(p => p.id === connection.toPort) ||
                  toBlock.outputs.find(p => p.id === connection.toPort)

    if (!fromPort || !toPort) return null

    const startX = fromBlock.position.x + (fromPort.direction === 'output' ? 120 : 0)
    const startY = fromBlock.position.y + 35
    const endX = toBlock.position.x + (toPort.direction === 'input' ? 0 : 120)
    const endY = toBlock.position.y + 35

    return (
      <Line
        key={connection.id}
        points={[startX, startY, endX, endY]}
        stroke="#2196f3"
        strokeWidth={2}
        lineCap="round"
        lineJoin="round"
      />
    )
  }, [blocks])

  const renderConnectingLine = useCallback(() => {
    if (!connecting) return null

    return (
      <Line
        points={[connecting.startPos.x, connecting.startPos.y, connecting.currentPos.x, connecting.currentPos.y]}
        stroke="#ff9800"
        strokeWidth={2}
        lineCap="round"
        lineJoin="round"
        dash={[5, 5]}
      />
    )
  }, [connecting])

  return (
    <div className={`relative ${className}`}>
      {/* Control Panel */}
      <div className="absolute top-4 left-4 z-10 bg-card border border-border rounded-lg p-2 shadow-lg">
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={onCompile}
            className="flex items-center gap-1"
          >
            <Download className="w-4 h-4" />
            Compile
          </Button>

          {!isRunning ? (
            <Button
              size="sm"
              onClick={onRun}
              className="flex items-center gap-1 bg-green-600 hover:bg-green-700"
            >
              <Play className="w-4 h-4" />
              Run
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={onStop}
              className="flex items-center gap-1 bg-red-600 hover:bg-red-700"
            >
              <Square className="w-4 h-4" />
              Stop
            </Button>
          )}

          <Button
            size="sm"
            variant="outline"
            onClick={() => {/* Reset canvas */}}
            className="flex items-center gap-1"
          >
            <RotateCcw className="w-4 h-4" />
            Reset
          </Button>
        </div>
      </div>

      {/* Canvas */}
      <Stage
        ref={stageRef}
        width={stageSize.width}
        height={stageSize.height}
        onMouseMove={handleMouseMove}
        onClick={handleStageClick}
      >
        <Layer>
          {/* Grid */}
          <Rect
            width={stageSize.width}
            height={stageSize.height}
            fill="#f8f9fa"
          />

          {/* Connections */}
          {connections.map(renderConnection)}

          {/* Connecting line */}
          {renderConnectingLine()}

          {/* Blocks */}
          {blocks.map(renderBlock)}
        </Layer>
      </Stage>

      {/* Info Panel */}
      <div className="absolute bottom-4 left-4 bg-card border border-border rounded-lg p-3 shadow-lg text-sm">
        <div className="text-foreground">
          Blocks: {blocks.length} | Connections: {connections.length}
        </div>
        <div className="text-muted-foreground">
          {connecting ? 'Connecting...' : 'Click and drag between ports to connect'}
        </div>
      </div>
    </div>
  )
}