import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { Stage, Layer, Rect, Line, Circle, Text, Group, Path } from 'react-konva'
import { Component } from '../lib/supabase'
import { useAppStore } from '../stores/useAppStore'
import { useProjectStore } from '../stores/useProjectStore'
import { useTheme } from '../lib/theme/useTheme'
import { THEMES, hslTripletToRgb, rgbToHex } from '../lib/theme/tokens'
import Konva from 'konva'
import { generateId } from '../lib/utils'
import { applyContextAction, CONTEXT_ACTIONS, validateSymbol, type ContextActionId } from '../lib/schematic/contextMenu'
import { routePoints } from '../lib/schematic/wireRouting'
import {
  drawingExtents,
  frameAround,
  layoutComponentLabels,
  pinWorldCoord,
  rotatePinCoord,
  wireJunctions,
} from '../lib/schematic/drawingLayout'

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
  /** Pin under the pointer: drives the KiCad-style hover readout. */
  const [hoveredPin, setHoveredPin] = useState<{
    id: string; ref: string; name: string; pin: { id: string; name: string }; at: { x: number; y: number }
  } | null>(null)
  /** Part body under the pointer (no pin): shows ref + value + footprint. */
  const [hoveredPart, setHoveredPart] = useState<{
    id: string; ref: string; name: string; props: Record<string, unknown>
  } | null>(null)
  /** Wire under the pointer: shows its net name. */
  const [hoveredWire, setHoveredWire] = useState<{
    id: string; netName: string; pins: number
  } | null>(null)

  /** Screen cursor from the stage pointer (tooltip anchor). */
  const setCursorFromEvent = () => {
    const stage = stageRef.current
    const pointer = stage?.getPointerPosition()
    if (pointer) setCursor({ x: pointer.x, y: pointer.y })
  }

  /** Net name touching a pin, for the hover readout. */
  const netOfPin = (componentId: string, pinId: string): string => {
    const wire = wires.find((w) =>
      w.connectedPins?.some((p) => p.componentId === componentId && p.pinId === pinId),
    )
    return wire?.netName ?? '—'
  }

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
    markDirty,
    liveFrame,
    currentProject,
    currentSchematic,
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

      const frame = frameAround({ minX, minY, maxX, maxY })
      // Keep a margin around the sheet and centre it in the drawing area
      // (the rulers are 18 px overlays on the top and left edges).
      const rulerInset = useAppStore.getState().settings.showRulers ? RULER_SIZE : 0
      const availableWidth = Math.max(120, stageSize.width - 32 - rulerInset)
      const availableHeight = Math.max(120, stageSize.height - 32 - rulerInset)
      const zoom = Math.max(
        0.1,
        Math.min(5, Math.min(availableWidth / frame.width, availableHeight / frame.height)),
      )
      setZoom(zoom)
      setPan({
        x: (rulerInset + stageSize.width) / 2 - (frame.x + frame.width / 2) * zoom,
        y: (rulerInset + stageSize.height) / 2 - (frame.y + frame.height / 2) * zoom,
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

  const pinch = useRef<{ dist: number; mid: { x: number; y: number }; scale: number } | null>(null)
  const lastWheelZoom = useRef(0)

  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
    if (!e.evt.ctrlKey && !e.evt.metaKey) {
      const factor = 1.1
      const dx = e.evt.shiftKey ? e.evt.deltaY : e.evt.deltaX
      const dy = e.evt.shiftKey ? 0 : e.evt.deltaY
      const { pan } = useAppStore.getState().viewport
      const margin = 200000
      setPan({
        x: Math.min(margin, Math.max(-margin, pan.x - dx * factor)),
        y: Math.min(margin, Math.max(-margin, pan.y - dy * factor)),
      })
      return
    }
    if (pinch.current !== null) return
    const now = performance.now()
    if (now - lastWheelZoom.current < 16) return
    lastWheelZoom.current = now
    const scaleBy = Math.pow(1.0015, -Math.max(-200, Math.min(200, e.evt.deltaY)))
    const stage = e.target.getStage()
    if (!stage) return
    const oldScale = stage.scaleX()
    const pointer = stage.getPointerPosition()
    if (!pointer) return
    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    }
    const clampedScale = Math.max(0.1, Math.min(5, oldScale * scaleBy))
    setZoom(clampedScale)
    const newPos = {
      x: pointer.x - mousePointTo.x * clampedScale,
      y: pointer.y - mousePointTo.y * clampedScale,
    }
    setPan(newPos)
    stage.scale({ x: clampedScale, y: clampedScale })
    stage.position(newPos)
  }

  const handleTouchMove = (e: Konva.KonvaEventObject<TouchEvent>) => {
    const touches = e.evt.touches
    if (touches.length !== 2) { pinch.current = null; return }
    e.evt.preventDefault()
    e.evt.stopPropagation()
    const stage = e.target.getStage()
    if (!stage) return
    const t0 = touches[0]; const t1 = touches[1]
    const rect = stage.container().getBoundingClientRect()
    const p0 = { x: t0.clientX - rect.left, y: t0.clientY - rect.top }
    const p1 = { x: t1.clientX - rect.left, y: t1.clientY - rect.top }
    const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y)
    const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 }
    const prev = pinch.current
    if (!prev || prev.dist === 0) { pinch.current = { dist, mid, scale: stage.scaleX() }; return }
    if (Math.abs(dist - prev.dist) < 1) return
    const clampedRatio = Math.max(0.9, Math.min(1.1, dist / prev.dist))
    const next = Math.max(0.1, Math.min(5, prev.scale * clampedRatio))
    const world = { x: (mid.x - stage.x()) / stage.scaleX(), y: (mid.y - stage.y()) / stage.scaleX() }
    pinch.current = { dist, mid, scale: next }
    setZoom(next)
    const pos = { x: mid.x - world.x * next, y: mid.y - world.y * next }
    setPan(pos)
    stage.scale({ x: next, y: next })
    stage.position(pos)
  }

  const handleTouchEnd = () => {
    pinch.current = null
    lastWheelZoom.current = performance.now()
  }

  const handleDragStart = () => {
    setIsDragging(true)
  }

  /*
   * Rubber-band drag: moving a part reconciles every attached wire endpoint
   * onto its moved pin, so wires stay landed on terminals (your screenshot
   * showed them frozen mid-air). Corners survive: the moved endpoint rides
   * the pin delta, the joint before it holds unless the segment collapses.
   */
  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    const id = e.target.id()
    const newPos = e.target.position()
    const moved = canvasComponents.find(c => c.id === id)
    if (id && moved) {
      const store = useProjectStore.getState()
      for (const wire of store.wires) {
        // Stretch every point attached to the dragged part; hold the rest.
        // The old endpoint-only version left T-junction middles behind,
        // which is why your screenshot showed segments floating off-pin.
        const pinsById = new Map(moved.component.pins.map((p) => [p.id, p]))
        const landed = new Map<number, { x: number; y: number }>()
        wire.connectedPins.forEach((pinned) => {
          if (pinned.componentId !== id) return
          const pin = pinsById.get(pinned.pinId)
          if (!pin) return
          const rotated = rotatePinCoord(pin, moved.rotation)
          const at = { x: newPos.x + rotated.x, y: newPos.y + rotated.y }
          wire.points.forEach((pt, index) => {
            if (Math.hypot(pt.x - (moved.x + rotated.x), pt.y - (moved.y + rotated.y)) < 1.5) {
              landed.set(index, at)
            }
          })
        })
        if (landed.size === 0) continue
        const points = wire.points.map((pt, index) => landed.get(index) ?? pt)
        store.updateWire(wire.id, { points })
      }
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
    setHoveredWire(null)
    if (e.target !== e.target.getStage()) return
    const pointer = e.target.getStage()?.getPointerPosition()

    // Left-drag on EMPTY sheet with the select tool was a pan, not a click:
    // the viewport already moved under handleMouseMove. Swallow it.
    if (activeTool === 'select' && !pendingComponent && panning && pointer) {
      const moved = Math.hypot(e.evt.clientX - panning.startX, e.evt.clientY - panning.startY)
      if (moved > 3) return
    }

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
    const start = pinWorldCoord(startComp, startPin)
    const end = pinWorldCoord(endComp, endPin)
    // Drafting rule: one orthogonal corner, chosen so the wire does not run
    // through another terminal or wire end (which would silently join nets).
    const obstacles = [
      ...canvasComponents.flatMap((comp) =>
        comp.component.pins.map((pin) => pinWorldCoord(comp, pin)),
      ),
      ...wires.flatMap((wire) => {
        const first = wire.points[0]
        const last = wire.points[wire.points.length - 1]
        return [first, last].filter((point): point is { x: number; y: number } => point !== undefined)
      }),
    ]
    const points = routePoints(start, end, obstacles)
    addWire({
      id: generateId('wire'),
      points,
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
        const rotated = rotatePinCoord(pin, comp.rotation)
        const dx = comp.x + rotated.x - world.x
        const dy = comp.y + rotated.y - world.y
        if (dx * dx + dy * dy <= tolerance * tolerance) {
          return { componentId: comp.id, pinId: pin.id }
        }
      }
    }
    return null
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
   * Annotation placement. Reference and value are laid out in world space so
   * they stay horizontal when a part is rotated (rotating a body must not
   * rotate its text), then the chosen block is tested against every part,
   * wire segment and already-placed label. Above is preferred, then below,
   * then the sides — the first collision-free candidate wins.
   */
  const labelLayout = useMemo(
    () => layoutComponentLabels(canvasComponents, wires),
    [canvasComponents, wires],
  )

  /*
   * Drawing sheet: a border, zone references and a title block sized around
   * the circuit. The extra bottom padding keeps the title block clear of the
   * annotations, so a screenshot of the sheet reads as a drawing rather than
   * a floating canvas.
   */
  const sheetFrame = useMemo(() => {
    if (canvasComponents.length === 0) return null
    const frame = frameAround(drawingExtents(canvasComponents, wires, labelLayout))
    const blockWidth = Math.min(300, frame.width - 40)
    const blockHeight = 88
    return {
      ...frame,
      block: {
        x: frame.x + frame.width - 14 - blockWidth,
        y: frame.y + frame.height - 14 - blockHeight,
        width: blockWidth,
        height: blockHeight,
      },
    }
  }, [canvasComponents, wires, labelLayout])

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

  /*
   * Sheet border and title block. Strokes are divided by zoom so the frame
   * keeps a one-pixel drafting weight at any magnification; text scales with
   * the sheet (that is what a printed drawing does).
   */
  const renderSheetFrame = () => {
    if (!sheetFrame) return null
    const { x, y, width, height, block } = sheetFrame
    const { zoom } = viewport
    const strong = palette.ref
    const quiet = palette.value
    const outerStroke = 1.35 / zoom
    const hairline = 0.7 / zoom
    const title = currentSchematic?.name || currentProject?.name || 'Untitled schematic'
    const date = new Date().toISOString().slice(0, 10)
    const columns = ['A', 'B', 'C', 'D']
    const rows = ['1', '2', '3']
    const fontFamily = "Inter, 'Segoe UI', system-ui, sans-serif"
    const cells = [
      { label: 'SIZE', value: 'A4' },
      { label: 'SCALE', value: 'NTS' },
      { label: 'DATE', value: date },
      { label: 'SHEET', value: '1/1' },
    ]

    return (
      <Group listening={false}>
        <Rect x={x} y={y} width={width} height={height} stroke={strong} strokeWidth={outerStroke} fillEnabled={false} />
        <Rect
          x={x + 14}
          y={y + 14}
          width={width - 28}
          height={height - 28}
          stroke={strong}
          strokeWidth={hairline}
          fillEnabled={false}
        />

        {columns.map((zone, index) => (
          <Text
            key={`zone-c-${zone}`}
            text={zone}
            x={x + (width * (index + 0.5)) / 4 - 5}
            y={y + 3}
            width={10}
            align="center"
            fontSize={8}
            fontFamily={fontFamily}
            fill={quiet}
          />
        ))}
        {rows.map((zone, index) => (
          <Text
            key={`zone-r-${zone}`}
            text={zone}
            x={x + 3}
            y={y + (height * (index + 0.5)) / 3 - 5}
            width={10}
            align="center"
            fontSize={8}
            fontFamily={fontFamily}
            fill={quiet}
          />
        ))}

        {[1, 2, 3].map((index) => (
          <Line
            key={`tick-t-${index}`}
            points={[x + (width * index) / 4, y + 8, x + (width * index) / 4, y + 14]}
            stroke={strong}
            strokeWidth={hairline}
          />
        ))}
        {[1, 2, 3].map((index) => (
          <Line
            key={`tick-b-${index}`}
            points={[
              x + (width * index) / 4,
              y + height - 14,
              x + (width * index) / 4,
              y + height - 8,
            ]}
            stroke={strong}
            strokeWidth={hairline}
          />
        ))}
        {[1, 2].map((index) => (
          <Line
            key={`tick-l-${index}`}
            points={[x + 8, y + (height * index) / 3, x + 14, y + (height * index) / 3]}
            stroke={strong}
            strokeWidth={hairline}
          />
        ))}
        {[1, 2].map((index) => (
          <Line
            key={`tick-r-${index}`}
            points={[
              x + width - 14,
              y + (height * index) / 3,
              x + width - 8,
              y + (height * index) / 3,
            ]}
            stroke={strong}
            strokeWidth={hairline}
          />
        ))}

        <Rect
          x={block.x}
          y={block.y}
          width={block.width}
          height={block.height}
          fill={palette.sheet}
          stroke={strong}
          strokeWidth={hairline}
        />
        <Line
          points={[block.x, block.y + 22, block.x + block.width, block.y + 22]}
          stroke={strong}
          strokeWidth={hairline}
        />
        <Line
          points={[block.x, block.y + 58, block.x + block.width, block.y + 58]}
          stroke={strong}
          strokeWidth={hairline}
        />
        {[1, 2, 3].map((index) => (
          <Line
            key={`title-cell-${index}`}
            points={[
              block.x + (block.width * index) / 4,
              block.y + 58,
              block.x + (block.width * index) / 4,
              block.y + block.height,
            ]}
            stroke={strong}
            strokeWidth={hairline}
          />
        ))}

        <Text
          text="FOLIO"
          x={block.x + 8}
          y={block.y + 5}
          fontSize={12}
          fontStyle="bold"
          fontFamily={fontFamily}
          fill={strong}
        />
        <Text
          text="REV A"
          x={block.x + 8}
          y={block.y + 7}
          width={block.width - 16}
          align="right"
          fontSize={8}
          fontFamily={fontFamily}
          fill={quiet}
        />
        <Text
          text="TITLE"
          x={block.x + 8}
          y={block.y + 25}
          fontSize={6}
          fontFamily={fontFamily}
          fill={quiet}
        />
        <Text
          text={title}
          x={block.x + 8}
          y={block.y + 32}
          width={block.width - 16}
          fontSize={12}
          fontStyle="bold"
          fontFamily={fontFamily}
          fill={strong}
          wrap="none"
          ellipsis
        />
        {cells.map((cell, index) => {
          const cellX = block.x + (block.width * index) / 4 + 6
          return (
            <Group key={cell.label}>
              <Text
                text={cell.label}
                x={cellX}
                y={block.y + 62}
                fontSize={6}
                fontFamily={fontFamily}
                fill={quiet}
              />
              <Text
                text={cell.value}
                x={cellX}
                y={block.y + 69}
                fontSize={8}
                fontFamily={fontFamily}
                fill={strong}
              />
            </Group>
          )
        })}
      </Group>
    )
  }

  const renderGrid = () => {
    if (!settings.showGrid) return null

    const { pan, zoom } = viewport
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
    const lit = liveFrame?.lit[canvasComp.reference.toUpperCase()] ?? false
    const { zoom } = viewport

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
        onMouseEnter={() => {
          setHoveredWire(null)
          setHoveredPin(null)
          setHoveredPart({ id: canvasComp.id, ref: canvasComp.reference, name: canvasComp.component.name, props: canvasComp.properties })
          setCursorFromEvent()
        }}
        onMouseMove={() => {
          setHoveredWire(null)
          if (!hoveredPart || hoveredPart.id !== canvasComp.id) {
            setHoveredPin(null)
            setHoveredPart({ id: canvasComp.id, ref: canvasComp.reference, name: canvasComp.component.name, props: canvasComp.properties })
          }
          setCursorFromEvent()
        }}
        onMouseLeave={() => setHoveredPart(null)}
      >
        {/* Selection outline */}
        <Rect
          width={canvasComp.component.symbol_data.width}
          height={canvasComp.component.symbol_data.height}
          fill="transparent"
          stroke={lit || isSelected ? palette.selectedStroke : 'transparent'}
          strokeWidth={lit || isSelected ? 2 / zoom : 0}
          shadowBlur={lit ? 12 : 0}
          shadowColor={lit ? palette.selectedStroke : 'transparent'}
        />

        {canvasComp.component.symbol_data.paths.map((path, index) => (
          <Path
            key={index}
            data={path}
            stroke={palette.line}
            strokeWidth={1.75 / zoom}
            fillEnabled={false}
            lineCap="round"
            lineJoin="round"
          />
        ))}

        {/* Reference + value, placed in world space and counter-rotated so
            they stay horizontal while the symbol body turns. */}
        {labelLayout.get(canvasComp.id)?.lines.map((line, index) => {
          const placement = labelLayout.get(canvasComp.id)
          if (!placement) return null
          const radians = (-canvasComp.rotation * Math.PI) / 180
          const worldX = placement.box.x + placement.box.width / 2 - canvasComp.x
          const worldY = placement.box.y + line.centerY - canvasComp.y
          const local = {
            x: worldX * Math.cos(radians) - worldY * Math.sin(radians),
            y: worldX * Math.sin(radians) + worldY * Math.cos(radians),
          }
          return (
            <Text
              key={`label-${index}`}
              text={line.text}
              x={local.x}
              y={local.y}
              width={placement.box.width}
              align="center"
              fontSize={line.fontSize}
              fontStyle={line.bold ? 'bold' : 'normal'}
              fontFamily="Inter, 'Segoe UI', system-ui, sans-serif"
              fill={line.bold ? palette.ref : palette.value}
              stroke={palette.sheet}
              strokeWidth={3}
              fillAfterStrokeEnabled
              offsetX={placement.box.width / 2}
              offsetY={line.fontSize * 0.55}
              rotation={-canvasComp.rotation}
              listening={false}
              perfectDrawEnabled={false}
            />
          )
        })}

        {/* Pins on top; ring marks wire start */}
        {canvasComp.component.pins.map(pin => {
          const armed = wireStart?.componentId === canvasComp.id && wireStart?.pinId === pin.id
          return (
          <Circle
            key={pin.id}
            x={pin.x}
            y={pin.y}
            radius={armed ? 4.5 : 1.9}
            fill={armed ? palette.selectedStroke : palette.pinFill}
            stroke={palette.pinStroke}
            strokeWidth={(armed ? 1.5 : 0.9) / zoom}
            hitStrokeWidth={14}
            onClick={(event) => {
              event.cancelBubble = true
              handleComponentClick(canvasComp.id, pin.id)
            }}
            onMouseDown={(event) => {
              if (activeTool === 'wire') {
                event.cancelBubble = true
                handleComponentClick(canvasComp.id, pin.id)
              } else {
                event.cancelBubble = true
              }
            }}
            onMouseEnter={() => {
              setHoveredPart(null)
              setHoveredPin({ id: canvasComp.id, ref: canvasComp.reference, name: canvasComp.component.name, pin, at: pinWorldCoord(canvasComp, pin) })
              setCursorFromEvent()
            }}
            onMouseMove={() => {
              setHoveredPin({ id: canvasComp.id, ref: canvasComp.reference, name: canvasComp.component.name, pin, at: pinWorldCoord(canvasComp, pin) })
              setCursorFromEvent()
            }}
            onMouseLeave={() => {
              // Restore part readout when leaving pin for body
              setHoveredPin(null)
              setHoveredPart({ id: canvasComp.id, ref: canvasComp.reference, name: canvasComp.component.name, props: canvasComp.properties })
            }}
          />
          )
        })}

      </Group>
    )
  }

  /* Terminal landing dots: the pins themselves ARE the dots (drawn last in
     the part group). This layer only marks untouched pins as open rings —
     touched pins already render filled, so drawing here would double them. */
  const terminals = useMemo(() => {
    const out: Array<{ x: number; y: number; open: boolean }> = [];
    const seen = new Set<string>();
    for (const comp of canvasComponents) {
      for (const pin of comp.component.pins) {
        const touched = wires.some((w) =>
          w.connectedPins?.some((cp) => cp.componentId === comp.id && cp.pinId === pin.id),
        );
        if (touched) continue;
        const rotated = rotatePinCoord(pin, comp.rotation);
        const at = { x: comp.x + rotated.x, y: comp.y + rotated.y };
        const key = Math.round(at.x) + ':' + Math.round(at.y);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ x: at.x, y: at.y, open: true });
      }
    }
    return out;
  }, [canvasComponents, wires]);

  /* Wire segments */
  const segments = useMemo(() => {
    const out: Array<{ x1: number; y1: number; x2: number; y2: number; wireId: string }> = []
    for (const wire of wires) {
      for (let k = 0; k + 1 < wire.points.length; k++) {
        out.push({ x1: wire.points[k].x, y1: wire.points[k].y,
          x2: wire.points[k + 1].x, y2: wire.points[k + 1].y, wireId: wire.id })
      }
    }
    return out
  }, [wires])

  /* Endpoint of one wire touching another wire (first/last point only):
     filled junction dot — same net only. A stub end landing anywhere on a
     same-net segment (rail midpoint, T corner) is a genuine joint and gets
     the dot; a touch across different nets never does. */
  const junctions = useMemo(() => wireJunctions(wires), [wires])

  /* Wires crossing without shared pins: hop bow on the crossing. Same-net
     crossings are already one node — hopping them would fake a disconnect,
     so only different nets jump. */
  const crossings = useMemo(() => {
    const hops: Array<{ x: number; y: number }> = []
    const seenHop = new Set<string>()
    const byId = new Map(wires.map((w) => [w.id, w.netName ?? '']))
    for (let a = 0; a < segments.length; a++) {
      for (let b = a + 1; b < segments.length; b++) {
        const s1 = segments[a]
        const s2 = segments[b]
        if (s1.wireId === s2.wireId) continue
        // Same named net skips hop
        const n1 = byId.get(s1.wireId) ?? ''
        const n2 = byId.get(s2.wireId) ?? ''
        if (n1 !== '' && n1 === n2) continue
        const h1 = Math.abs(s1.y1 - s1.y2) < 0.5
        const h2 = Math.abs(s2.y1 - s2.y2) < 0.5
        if (h1 === h2) continue
        const h = h1 ? s1 : s2
        const v = h1 ? s2 : s1
        const x = v.x1
        const y = h.y1
        const inH = Math.min(h.x1, h.x2) + 0.5 < x && x < Math.max(h.x1, h.x2) - 0.5
        const inV = Math.min(v.y1, v.y2) + 0.5 < y && y < Math.max(v.y1, v.y2) - 0.5
        if (!inH || !inV) continue
        if (junctions.some((d) => Math.abs(d.x - x) < 4 && Math.abs(d.y - y) < 4)) continue
        let nearEnd = false
        for (const w of wires) { for (const pt of w.points) { if (Math.abs(pt.x - x) < 8 && Math.abs(pt.y - y) < 8) { nearEnd = true; break } } if (nearEnd) break }
        if (nearEnd) continue
        const hopKey = Math.round(x) + ':' + Math.round(y)
        if (seenHop.has(hopKey)) continue
        seenHop.add(hopKey)
        hops.push({ x, y })
      }
    }
    return hops
  }, [segments, junctions, wires])
  const renderWires = () => {
    const { zoom } = viewport
    return (
      <>
        {wires.map(wire => {
          return (
            <Line
              key={wire.id}
              points={wire.points.flatMap(pt => [pt.x, pt.y])}
              stroke={palette.wire}
              strokeWidth={2 / zoom}
              lineCap="round"
              lineJoin="round"
              hitStrokeWidth={12}
              onMouseEnter={() => {
                setHoveredPin(null)
                setHoveredWire({ id: wire.id, netName: wire.netName || '—', pins: wire.connectedPins?.length ?? 0 })
                setCursorFromEvent()
              }}
              onMouseMove={() => setCursorFromEvent()}
              onMouseLeave={() => setHoveredWire(null)}
            />
          )
        })}
        {junctions.map((d, k) => (
          <Circle key={"j" + k} x={d.x} y={d.y} radius={3.2}
            fill={palette.wire} stroke={palette.sheet} strokeWidth={0.8 / viewport.zoom} listening={false} />
        ))}
        {terminals.map((t, k) => (
          <Circle key={"t" + k} x={t.x} y={t.y} radius={3.2}
            fill={palette.sheet}
            stroke={palette.pinStroke} strokeWidth={1.1 / viewport.zoom}
            listening={false} />
        ))}
        {crossings.map((h, k) => (
          <Group key={'hj' + k} listening={false}>
            <Line
              points={[h.x - 8, h.y, h.x + 8, h.y]}
              stroke={palette.sheet}
              strokeWidth={6}
              lineCap="butt"
              listening={false}
            />
            <Path
              data={'M ' + (h.x - 8) + ',' + h.y + ' L ' + (h.x - 7) + ',' + h.y + ' A 7,7 0 0,1 ' + (h.x + 7) + ',' + h.y + ' L ' + (h.x + 8) + ',' + h.y}
            stroke={palette.wire}
            strokeWidth={2}
            fillEnabled={false}
            lineCap="round"
            listening={false}
          />
          </Group>
        ))}
      </>
    )
  }

  /* Wire-start marker */
  const renderWireStart = () => {
    if (activeTool !== 'wire' || !wireStart) return null
    const comp = canvasComponents.find((c) => c.id === wireStart.componentId)
    const pin = comp?.component.pins.find((p) => p.id === wireStart.pinId)
    if (!comp || !pin) return null
    const at = pinWorldCoord(comp, pin)
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
      const margin = 200000
      setPan({
        x: Math.min(margin, Math.max(-margin, panning.panX + (e.clientX - panning.startX))),
        y: Math.min(margin, Math.max(-margin, panning.panY + (e.clientY - panning.startY))),
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
    const { pan, zoom } = viewport
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
    const { pan, zoom } = viewport
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
        // Middle button always starts a clamped pan (applied by
        // handleMouseMove while `panning` is set). Left-drag pan on empty
        // sheet starts from the Konva stage handler, which knows whether the
        // press landed on empty sheet or on a part.
        if (e.button === 1) {
          e.preventDefault()
          const { pan } = useAppStore.getState().viewport
          setPanning({ startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y })
        }
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
        draggable={false}
        onWheel={handleWheel}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={handleStageClick}
        onMouseDown={(e) => {
          // Left press on EMPTY sheet with the select tool starts a pan
          // candidate (confirmed vs click on mouse-up by distance moved).
          // Part presses never reach here — the part Group consumes them.
          if (e.evt.button === 0 && activeTool === 'select' && !pendingComponent && e.target === e.target.getStage()) {
            const { pan } = useAppStore.getState().viewport
            setPanning({ startX: e.evt.clientX, startY: e.evt.clientY, panX: pan.x, panY: pan.y })
          }
        }}
      >
        <Layer>
          {/* Drawing sheet border + title block (behind the grid) */}
          {renderSheetFrame()}

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

      {(cursor && hoveredPin && (
        <div
          className="cad-tip"
          style={{ transform: `translate(${Math.round(cursor.x + 14)}px, ${Math.round(cursor.y + 14)}px)` }}
          role="status"
        >
          <span className="font-semibold">{hoveredPin.ref}</span>
          <span className="text-muted-foreground">{hoveredPin.name} · {hoveredPin.pin.name}</span>
          <span className="cad-readout">net {hoveredPin.pin.id === 'gnd' ? 'GND' : (netOfPin(hoveredPin.id, hoveredPin.pin.id) === '—' ? hoveredPin.id : netOfPin(hoveredPin.id, hoveredPin.pin.id))}</span>
        </div>
      ))}
      {(cursor && !hoveredPin && !hoveredWire && hoveredPart && (() => {
        const value = hoveredPart.props.value ?? hoveredPart.props.voltage ?? hoveredPart.props.type ?? ''
        const fp = hoveredPart.props.footprint ? String(hoveredPart.props.footprint) : ''
        return (
          <div
            className="cad-tip"
            style={{ transform: `translate(${Math.round(cursor.x + 14)}px, ${Math.round(cursor.y + 14)}px)` }}
            role="status"
          >
            <span className="font-semibold">{hoveredPart.ref}</span>
            <span className="text-muted-foreground">{hoveredPart.name}{value ? ` · ${String(value)}` : ''}{fp ? ` · ${fp}` : ''}</span>
          </div>
        )
      })())}

      {(cursor && !hoveredPin && hoveredWire && (
        <div
          className="cad-tip"
          style={{ transform: `translate(${Math.round(cursor.x + 14)}px, ${Math.round(cursor.y + 14)}px)` }}
          role="status"
        >
          <span className="font-semibold">net {hoveredWire.netName}</span>
          <span className="text-muted-foreground">{hoveredWire.pins} pin{hoveredWire.pins === 1 ? '' : 's'}</span>
        </div>
      ))}

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