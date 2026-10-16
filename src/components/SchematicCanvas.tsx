import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { Stage, Layer, Rect, Line, Circle, Text, Group } from 'react-konva'
import { Component } from '../lib/supabase'
import { useAppStore } from '../stores/useAppStore'
import { useProjectStore } from '../stores/useProjectStore'
import { useTheme } from '../lib/theme/useTheme'
import { THEMES, hslTripletToRgb, rgbToHex } from '../lib/theme/tokens'
import Konva from 'konva'
import { generateId } from '../lib/utils'
import { applyContextAction, CONTEXT_ACTIONS, validateSymbol, type ContextActionId } from '../lib/schematic/contextMenu'

const RULER_SIZE = 18
const RULER_STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000]

/** Compact coordinate label for rulers and the HUD. */
const fmtCoord = (value: number) =>
  Math.abs(value) >= 1000 ? String(Math.round(value)) : String(Math.round(value * 10) / 10)

interface SchematicCanvasProps {
  components: Component[]
  onSave: (data: Record<string, unknown>) => void
  /** Library part armed for click-to-place; drops on the next sheet click. */
  pendingComponent?: Component | null
  /** Notifies the parent once an armed part has been placed. */
  onPendingPlaced?: () => void
}

export default function SchematicCanvas({
  components,
  onSave,
  pendingComponent = null,
  onPendingPlaced,
}: SchematicCanvasProps) {
  const stageRef = useRef<Konva.Stage>(null)
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 })
  /** True while a part is being dragged (suppresses click-select on drop). */
  const [isDragging, setIsDragging] = useState(false)
  /** Middle-button / space-drag pan state (the ONLY way the sheet moves). */
  const [panning, setPanning] = useState<{ startX: number; startY: number; panX: number; panY: number } | null>(null)
  /** rAF-throttled crosshair position in screen pixels. */
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const cursorFrame = useRef<number | null>(null)
  const pendingCursor = useRef<{ x: number; y: number } | null>(null)

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
    addWire,
    updateComponent,
    removeComponent,
    markDirty
  } = useProjectStore()

  // Konva renders raw strings, not CSS variables, so resolve the canvas
  // palette from the active theme's validated tokens. Every colour below
  // comes from the theme — there are no hard-coded light fills here.
  const { theme } = useTheme()
  const palette = useMemo(() => {
    const hex = (token: string) => rgbToHex(hslTripletToRgb(THEMES[theme][token]))
    return {
      sheet: hex('--canvas'),
      grid: hex('--grid'),
      gridMajor: hex('--grid-major'),
      body: hex('--symbol-fill'),
      bodyStroke: hex('--symbol-outline'),
      line: hex('--symbol'),
      ref: hex('--reference-label'),
      value: hex('--value-label'),
      pinFill: hex('--pin'),
      pinStroke: hex('--pin-ring'),
      wire: hex('--wire'),
      selectedBody: hex('--symbol-selected-fill'),
      selectedStroke: hex('--selection'),
    }
  }, [theme])

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

  /* Drop the crosshair frame when the sheet unmounts. */
  useEffect(() => {
    return () => {
      if (cursorFrame.current !== null) cancelAnimationFrame(cursorFrame.current)
    }
  }, [])

  /*
   * Fit view: the rail's Fit button (and the F shortcut) dispatch
   * `folio:fit-view` on the window; here we frame every placed part with a
   * small margin, or reset the viewport when the sheet is empty.
   */
  useEffect(() => {
    const fit = () => {
      const list = useProjectStore.getState().components
      if (list.length === 0) {
        setZoom(1)
        setPan({ x: 0, y: 0 })
        return
      }

      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const comp of list) {
        const width = comp.component.symbol_data.width
        const height = comp.component.symbol_data.height
        minX = Math.min(minX, comp.x)
        minY = Math.min(minY, comp.y)
        maxX = Math.max(maxX, comp.x + width)
        maxY = Math.max(maxY, comp.y + height)
      }

      const padding = 48
      const frameWidth = maxX - minX + padding * 2
      const frameHeight = maxY - minY + padding * 2
      const zoom = Math.max(
        0.1,
        Math.min(5, Math.min(stageSize.width / frameWidth, stageSize.height / frameHeight)),
      )
      setZoom(zoom)
      setPan({
        x: stageSize.width / 2 - ((minX + maxX) / 2) * zoom,
        y: stageSize.height / 2 - ((minY + maxY) / 2) * zoom,
      })
    }

    window.addEventListener('folio:fit-view', fit)
    return () => window.removeEventListener('folio:fit-view', fit)
  }, [stageSize, setZoom, setPan])

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
    const id = e.target.id()
    const newPos = e.target.position()

    if (id && canvasComponents.find(c => c.id === id)) {
      updateComponent(id, { x: newPos.x, y: newPos.y })
      markDirty()
    }
    setIsDragging(false)
  }

  /** Drop a library part at a screen-space point, snapped to the grid. */
  const placeComponent = (libraryComponent: Component, screen: { x: number; y: number }) => {
    const { viewport: currentViewport, settings: currentSettings } = useAppStore.getState()
    const pos = {
      x: (screen.x - currentViewport.pan.x) / currentViewport.zoom,
      y: (screen.y - currentViewport.pan.y) / currentViewport.zoom,
    }

    if (currentSettings.snapToGrid) {
      pos.x = Math.round(pos.x / currentSettings.gridSize) * currentSettings.gridSize
      pos.y = Math.round(pos.y / currentSettings.gridSize) * currentSettings.gridSize
    }

    const placedCount = useProjectStore.getState().components.length
    const canvasComponent = {
      id: generateId('comp'),
      componentId: libraryComponent.id!,
      component: libraryComponent,
      x: pos.x,
      y: pos.y,
      rotation: 0,
      reference: `${libraryComponent.name.charAt(0)}${placedCount + 1}`,
      properties: { ...libraryComponent.default_properties }
    }

    addComponent(canvasComponent)
    markDirty()
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const componentId = e.dataTransfer.getData('componentId')
    const component = components.find(c => c.id === componentId)

    if (component && stageRef.current) {
      const pointer = stageRef.current.getPointerPosition()
      if (pointer) placeComponent(component, pointer)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleStageClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.target !== e.target.getStage()) return
    const pointer = e.target.getStage()?.getPointerPosition()

    // Armed library part: drop it on the empty sheet.
    if (pendingComponent && pointer) {
      placeComponent(pendingComponent, pointer)
      onPendingPlaced?.()
      return
    }

    // Wire tool: pin-to-pin click-to-click wiring (shared finishWire).
    if (activeTool === 'wire' && pointer) {
      const world = screenToWorld(pointer)
      const hit = pinHit(world)
      if (!hit) {
        setWireStart(null)
        return
      }
      finishWire(hit)
      return
    }

    setSelectedComponents([])
  }

  const handleComponentClick = (id: string, pinId?: string) => {
    // A drag-end click carries no pin and must not re-select the part.
    if (isDragging && !pinId) return
    // Delete tool removes the part in place of selecting it.
    if (activeTool === 'delete') {
      removeComponent(id)
      markDirty()
      setSelectedComponents(selectedComponents.filter((selectedId) => selectedId !== id))
      return
    }

    // Wire tool on a pin: same shared finishWire as empty-sheet pin hits.
    if (activeTool === 'wire' && pinId) {
      finishWire({ componentId: id, pinId })
      return
    }

    setSelectedComponents([id])
  }

  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)

  /*
   * Click-to-click wiring with the wire tool armed: first pin click starts,
   * second pin click finishes with both pins in `connectedPins` — the exact
   * shape the netlister reads. Clicking the SAME pin or empty space cancels.
   * The pins themselves are the targets (12px hit circles); the empty-sheet
   * hit test is the fallback for near-misses.
   */
  const [wireStart, setWireStart] = useState<{ componentId: string; pinId: string } | null>(null)

  const finishWire = (hit: { componentId: string; pinId: string }): void => {
    if (!wireStart) {
      setWireStart(hit)
      return
    }
    if (wireStart.componentId === hit.componentId && wireStart.pinId === hit.pinId) {
      setWireStart(null)
      return
    }
    const startComp = canvasComponents.find((c) => c.id === wireStart.componentId)
    const endComp = canvasComponents.find((c) => c.id === hit.componentId)
    const startPin = startComp?.component.pins.find((p) => p.id === wireStart.pinId)
    const endPin = endComp?.component.pins.find((p) => p.id === hit.pinId)
    if (!startComp || !endComp || !startPin || !endPin) {
      setWireStart(null)
      return
    }
    // No duplicate wire between the same two pins: re-clicking a connected
    // pair removes it (toggle), instead of stacking invisible copies.
    const existing = wires.find(
      (w) =>
        w.connectedPins.length === 2 &&
        ((w.connectedPins[0].componentId === wireStart.componentId &&
          w.connectedPins[0].pinId === wireStart.pinId &&
          w.connectedPins[1].componentId === hit.componentId &&
          w.connectedPins[1].pinId === hit.pinId) ||
          (w.connectedPins[1].componentId === wireStart.componentId &&
            w.connectedPins[1].pinId === wireStart.pinId &&
            w.connectedPins[0].componentId === hit.componentId &&
            w.connectedPins[0].pinId === hit.pinId)),
    )
    if (existing) {
      useProjectStore.getState().removeWire(existing.id)
      markDirty()
      setWireStart(null)
      return
    }
    const start = pinWorld(startComp, startPin)
    const end = pinWorld(endComp, endPin)
    addWire({
      id: generateId('wire'),
      points: [start, end],
      connectedPins: [wireStart, hit],
    })
    markDirty()
    setWireStart(null)
  }

  /** World position of every pin on the sheet, for hit-testing wire clicks. */
  const pinHit = (
    world: { x: number; y: number },
  ): { componentId: string; pinId: string } | null => {
    const tolerance = 10 / viewport.zoom
    for (const comp of canvasComponents) {
      for (const pin of comp.component.pins) {
        const rotated = rotatePin(pin, comp.rotation)
        const dx = comp.x + rotated.x - world.x
        const dy = comp.y + rotated.y - world.y
        if (dx * dx + dy * dy <= tolerance * tolerance) {
          return { componentId: comp.id, pinId: pin.id }
        }
      }
    }
    return null
  }

  /** Pin offset rotated by the part's rotation (degrees, clockwise positive). */
  const rotatePin = (
    pin: { x: number; y: number },
    rotationDegrees: number,
  ): { x: number; y: number } => {
    const radians = ((rotationDegrees % 360) * Math.PI) / 180
    const cos = Math.cos(radians)
    const sin = Math.sin(radians)
    return { x: pin.x * cos - pin.y * sin, y: pin.x * sin + pin.y * cos }
  }

  const pinWorld = (
    comp: { x: number; y: number; rotation: number },
    pin: { x: number; y: number },
  ): { x: number; y: number } => {
    const rotated = rotatePin(pin, comp.rotation)
    return { x: comp.x + rotated.x, y: comp.y + rotated.y }
  }

  const screenToWorld = (screen: { x: number; y: number }): { x: number; y: number } => {
    const { viewport: currentViewport, settings: currentSettings } = useAppStore.getState()
    const pos = {
      x: (screen.x - currentViewport.pan.x) / currentViewport.zoom,
      y: (screen.y - currentViewport.pan.y) / currentViewport.zoom,
    }
    if (currentSettings.snapToGrid) {
      pos.x = Math.round(pos.x / currentSettings.gridSize) * currentSettings.gridSize
      pos.y = Math.round(pos.y / currentSettings.gridSize) * currentSettings.gridSize
    }
    return pos
  }

  const handleComponentContextMenu = (event: Konva.KonvaEventObject<PointerEvent>, id: string) => {
    event.evt.preventDefault()
    setSelectedComponents([id])
    const stage = stageRef.current
    const pointer = stage?.getPointerPosition()
    setMenu({ id, x: pointer?.x ?? 0, y: pointer?.y ?? 0 })
  }

  const handleMenuAction = (action: ContextActionId) => {
    if (!menu) return
    const next = applyContextAction(useProjectStore.getState().components, menu.id, action, () => generateId('comp'))
    useProjectStore.setState({ components: next })
    markDirty()
    setMenu(null)
  }

  /*
   * Symbol contract audit. A symbol whose body or pins are broken used to
   * render as nothing at all; now every placed part is checked on each render
   * and the failures are listed, never silently dropped.
   */
  const symbolFaults = useMemo(
    () =>
      canvasComponents.flatMap((canvasComp) =>
        validateSymbol(
          {
            width: canvasComp.component.symbol_data.width,
            height: canvasComp.component.symbol_data.height,
            paths: canvasComp.component.symbol_data.paths ?? [],
          },
          canvasComp.component.pins ?? [],
        ).map((reason) => ({ id: canvasComp.id, reference: canvasComp.reference, reason })),
      ),
    [canvasComponents],
  )

  /*
   * Deletion is a cross-cutting shortcut, so it is memoised and attached once.
   * Re-registering the listener on every selection change is what made the
   * previous version stale-prone.
   */
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // Cancel an in-progress wire first; the sheet owns this shortcut while wiring.
        if (wireStart) {
          setWireStart(null)
          return
        }
      }
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      // Never eat keys while the user is typing in a field.
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }
      if (selectedComponents.length === 0) return
      event.preventDefault()
      selectedComponents.forEach((id) => removeComponent(id))
      setSelectedComponents([])
      markDirty()
    },
    [wireStart, selectedComponents, removeComponent, setSelectedComponents, markDirty],
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const renderGrid = () => {
    if (!settings.showGrid) return null

    const { zoom, pan } = viewport
    const gridSize = settings.gridSize

    // Keep grid density readable when zoomed far out.
    let step = gridSize
    while (step * zoom < 4) step *= 5

    // Only draw over the world range currently visible in the viewport.
    const worldLeft = -pan.x / zoom
    const worldRight = (stageSize.width - pan.x) / zoom
    const worldTop = -pan.y / zoom
    const worldBottom = (stageSize.height - pan.y) / zoom

    const firstCol = Math.ceil(worldLeft / step)
    const lastCol = Math.floor(worldRight / step)
    const firstRow = Math.ceil(worldTop / step)
    const lastRow = Math.floor(worldBottom / step)

    // Safety valve for pathological zoom levels.
    if (lastCol - firstCol + (lastRow - firstRow) > 4000) return null

    const gridLines: React.ReactElement[] = []
    const isMajor = (index: number) => ((index % 5) + 5) % 5 === 0

    for (let i = firstCol; i <= lastCol; i++) {
      const x = i * step
      const major = isMajor(i)
      gridLines.push(
        <Line
          key={`v-${i}`}
          points={[x, worldTop, x, worldBottom]}
          stroke={major ? palette.gridMajor : palette.grid}
          strokeWidth={(major ? 1 : 0.55) / zoom}
          listening={false}
        />
      )
    }

    for (let i = firstRow; i <= lastRow; i++) {
      const y = i * step
      const major = isMajor(i)
      gridLines.push(
        <Line
          key={`h-${i}`}
          points={[worldLeft, y, worldRight, y]}
          stroke={major ? palette.gridMajor : palette.grid}
          strokeWidth={(major ? 1 : 0.55) / zoom}
          listening={false}
        />
      )
    }

    return gridLines
  }

  const renderComponent = (canvasComp: typeof canvasComponents[0]) => {
    const isSelected = selectedComponents.includes(canvasComp.id)

    return (
      <Group
        key={canvasComp.id}
        id={canvasComp.id}
        x={canvasComp.x}
        y={canvasComp.y}
        rotation={canvasComp.rotation}
        draggable={activeTool === 'select'}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onClick={() => handleComponentClick(canvasComp.id)}
        onContextMenu={(event) => handleComponentContextMenu(event, canvasComp.id)}
      >
        {/* Component body */}
        <Rect
          width={canvasComp.component.symbol_data.width}
          height={canvasComp.component.symbol_data.height}
          fill={isSelected ? palette.selectedBody : palette.body}
          stroke={isSelected ? palette.selectedStroke : palette.bodyStroke}
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
              stroke={palette.line}
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
          fill={palette.ref}
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
            fill={palette.value}
            align="center"
            offsetX={String(canvasComp.properties.value).length * 2.5}
          />
        )}

        {/* Pins — clickable targets for the wire tool (larger hit area). */}
        {canvasComp.component.pins.map(pin => (
          <Circle
            key={pin.id}
            x={pin.x}
            y={pin.y}
            radius={3}
            fill={palette.pinFill}
            stroke={wireStart?.componentId === canvasComp.id && wireStart?.pinId === pin.id ? palette.selectedStroke : palette.pinStroke}
            strokeWidth={wireStart?.componentId === canvasComp.id && wireStart?.pinId === pin.id ? 2 : 1}
            hitStrokeWidth={12}
            onClick={(event) => {
              event.cancelBubble = true
              handleComponentClick(canvasComp.id, pin.id)
            }}
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
        stroke={wire.style?.color || palette.wire}
        strokeWidth={wire.style?.width || 2}
        lineCap="round"
        lineJoin="round"
      />
    ))
  }

  /* Pending first-pin marker while wiring: the exact pin the wire starts from. */
  const renderWireStart = () => {
    if (activeTool !== 'wire' || !wireStart) return null
    const comp = canvasComponents.find((c) => c.id === wireStart.componentId)
    const pin = comp?.component.pins.find((p) => p.id === wireStart.pinId)
    if (!comp || !pin) return null
    const at = pinWorld(comp, pin)
    return (
      <Circle
        x={at.x}
        y={at.y}
        radius={6}
        stroke={palette.selectedStroke}
        strokeWidth={2}
        listening={false}
      />
    )
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    // Active middle-button pan: viewport follows the pointer, clamped so the
    // sheet origin can never leave the visible area entirely.
    if (panning) {
      const { zoom } = useAppStore.getState().viewport
      const margin = 200
      setPan({
        x: Math.min(margin, Math.max(stageSize.width - 2000 * zoom - margin, panning.panX + (e.clientX - panning.startX))),
        y: Math.min(margin, Math.max(stageSize.height - 1500 * zoom - margin, panning.panY + (e.clientY - panning.startY))),
      })
    }
    pendingCursor.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    if (cursorFrame.current !== null) return
    cursorFrame.current = requestAnimationFrame(() => {
      cursorFrame.current = null
      const next = pendingCursor.current
      if (next) setCursor(next)
    })
  }

  const handleMouseLeave = () => {
    setPanning(null)
    pendingCursor.current = null
    if (cursorFrame.current !== null) {
      cancelAnimationFrame(cursorFrame.current)
      cursorFrame.current = null
    }
    setCursor(null)
  }

  /* Crosshair position in world coordinates, for the HUD readout. */
  const cursorWorld = cursor
    ? {
        x: (cursor.x - viewport.pan.x) / viewport.zoom,
        y: (cursor.y - viewport.pan.y) / viewport.zoom,
      }
    : null

  /* Ruler ticks in screen space; a major tick with a label every fifth step. */
  const xTicks = useMemo(() => {
    if (!settings.showRulers) return []
    const { zoom, pan } = viewport
    const majorStep = RULER_STEPS.find((candidate) => candidate * zoom >= 64) ?? 100000
    const minorStep = majorStep / 5
    const first = Math.ceil(-pan.x / zoom / minorStep)
    const last = Math.floor((stageSize.width - pan.x) / zoom / minorStep)
    const ticks: Array<{ pos: number; major: boolean; label: string }> = []
    for (let i = first; i <= last && ticks.length < 600; i++) {
      const major = ((i % 5) + 5) % 5 === 0
      ticks.push({
        pos: i * minorStep * zoom + pan.x,
        major,
        label: major ? fmtCoord(i * minorStep) : '',
      })
    }
    return ticks
  }, [settings.showRulers, viewport, stageSize.width])

  const yTicks = useMemo(() => {
    if (!settings.showRulers) return []
    const { zoom, pan } = viewport
    const majorStep = RULER_STEPS.find((candidate) => candidate * zoom >= 64) ?? 100000
    const minorStep = majorStep / 5
    const first = Math.ceil(-pan.y / zoom / minorStep)
    const last = Math.floor((stageSize.height - pan.y) / zoom / minorStep)
    const ticks: Array<{ pos: number; major: boolean; label: string }> = []
    for (let i = first; i <= last && ticks.length < 600; i++) {
      const major = ((i % 5) + 5) % 5 === 0
      ticks.push({
        pos: i * minorStep * zoom + pan.y,
        major,
        label: major ? fmtCoord(i * minorStep) : '',
      })
    }
    return ticks
  }, [settings.showRulers, viewport, stageSize.height])

  const rulerInset = settings.showRulers ? RULER_SIZE : 0

  return (
    <div
      className={`relative h-full w-full overflow-hidden bg-canvas text-canvas-foreground ${
        pendingComponent || activeTool === 'delete' || activeTool === 'wire' ? 'cursor-crosshair' : ''
      }`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onMouseDown={(e) => {
        // Middle button starts a clamped pan; left button never pans.
        if (e.button !== 1) return
        e.preventDefault()
        const { pan } = useAppStore.getState().viewport
        setPanning({ startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y })
      }}
      onMouseUp={() => setPanning(null)}
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
        /*
         * The sheet itself is NEVER draggable: dragging empty canvas used to
         * throw the whole grid off-screen with no way back. Pan with the
         * middle mouse button, space+drag, or the Fit button instead —
         * the KiCad convention.
         */
        draggable={false}
      >
        <Layer>
          {/* Grid */}
          {renderGrid()}
          
          {/* Wires */}
          {renderWires()}

          {/* Pending wire start */}
          {renderWireStart()}
          
          {/* Components */}
          {canvasComponents.map(renderComponent)}
        </Layer>
      </Stage>
      
      {/* Coordinate rulers */}
      {settings.showRulers && (
        <>
          {/* Left face */}
          <div
            className="cad-ruler-face bottom-0 left-0 top-[18px] z-10 w-[18px] overflow-hidden border-r border-border"
            aria-hidden="true"
          >
            {yTicks.map((tick, index) => (
              <div key={index}>
                <div
                  className={`absolute right-0 h-px ${tick.major ? 'bg-muted-foreground' : 'bg-border'}`}
                  style={{ top: Math.round(tick.pos) + 0.5, width: tick.major ? 8 : 4 }}
                />
                {tick.major && (
                  <span
                    className="absolute origin-top-left -rotate-90 font-mono text-[9px] leading-none tabular-nums text-muted-foreground"
                    style={{ left: 14, top: Math.round(tick.pos) + 2 }}
                  >
                    {tick.label}
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Top face */}
          <div
            className="cad-ruler-face left-0 right-0 top-0 z-10 h-[18px] overflow-hidden border-b border-border"
            aria-hidden="true"
          >
            {xTicks.map((tick, index) => (
              <div key={index}>
                <div
                  className={`absolute bottom-0 w-px ${tick.major ? 'bg-muted-foreground' : 'bg-border'}`}
                  style={{ left: Math.round(tick.pos) + 0.5, height: tick.major ? 8 : 4 }}
                />
                {tick.major && (
                  <span
                    className="absolute top-px font-mono text-[9px] leading-none tabular-nums text-muted-foreground"
                    style={{ left: Math.round(tick.pos) + 2 }}
                  >
                    {tick.label}
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Corner */}
          <div
            className="cad-ruler-face left-0 top-0 z-20 h-[18px] w-[18px] border-b border-r border-border"
            aria-hidden="true"
          />
        </>
      )}

      {/* Crosshair */}
      {cursor && (
        <div className="pointer-events-none absolute inset-0 z-[1] overflow-hidden" aria-hidden="true">
          <div
            className="absolute w-px bg-muted-foreground"
            style={{ left: Math.round(cursor.x), top: rulerInset, bottom: 0 }}
          />
          <div
            className="absolute h-px bg-muted-foreground"
            style={{ top: Math.round(cursor.y), left: rulerInset, right: 0 }}
          />
        </div>
      )}

      {/* Armed-placement chip */}
      {pendingComponent && (
        <div className="cad-place-chip" role="status">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Place</span>
          <span className="cad-readout text-foreground">{pendingComponent.name}</span>
          <span className="text-muted-foreground">click sheet to drop</span>
          <kbd className="cad-kbd">Esc</kbd>
        </div>
      )}
      
      {/* Instructions overlay */}
      {canvasComponents.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <div className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              Empty sheet
            </div>
            <div className="text-[11px] text-muted-foreground">
              Drag a part from the library — or click to arm, then click here to place.
            </div>
          </div>
        </div>
      )}

      {/* Symbol contract faults — fail loud, never a silently blank part */}
      {symbolFaults.length > 0 && (
        <div className="cad-symbol-faults" role="alert">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em]">Symbol</span>
          <span className="cad-readout text-foreground">{symbolFaults.length} fault{symbolFaults.length === 1 ? '' : 's'}</span>
          <span className="min-w-0 flex-1 truncate">
            {symbolFaults[0].reference}: {symbolFaults[0].reason}
            {symbolFaults.length > 1 ? ` (+${symbolFaults.length - 1} more)` : ''}
          </span>
        </div>
      )}

      {/* Sheet status strip */}
      <div className="cad-hud">
        <span className="flex items-center gap-3">
          <span>
            X <span className="cad-readout text-foreground">{cursorWorld ? fmtCoord(cursorWorld.x) : '—'}</span>
          </span>
          <span>
            Y <span className="cad-readout text-foreground">{cursorWorld ? fmtCoord(cursorWorld.y) : '—'}</span>
          </span>
          <span>
            Z <span className="cad-readout text-foreground">{Math.round(viewport.zoom * 100)}%</span>
          </span>
        </span>
        <span className="flex items-center gap-3">
          <span>
            PARTS <span className="cad-readout text-foreground">{canvasComponents.length}</span>
          </span>
          <span>
            SEL <span className="cad-readout text-foreground">{selectedComponents.length}</span>
          </span>
        </span>
      </div>

      {/* Right-click menu over the sheet */}
      {menu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setMenu(null)}
            onContextMenu={(event) => {
              event.preventDefault()
              setMenu(null)
            }}
          />
          <div
            className="cad-context-menu"
            role="menu"
            aria-label="Component actions"
            style={{ left: menu.x + RULER_SIZE, top: menu.y + RULER_SIZE }}
          >
            {CONTEXT_ACTIONS.map((action) => (
              <button
                key={action.id}
                type="button"
                role="menuitem"
                className={`cad-context-item${action.id === 'delete' ? ' cad-context-item--danger' : ''}`}
                onClick={() => handleMenuAction(action.id)}
              >
                {action.label}
              </button>
            ))}
          </div>
        </>
      )}

    </div>
  )
}