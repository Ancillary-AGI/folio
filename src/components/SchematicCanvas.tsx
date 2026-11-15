import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { Stage, Layer, Rect, Line, Circle, Text, Group, Path } from 'react-konva'
import { Bot, DraftingCompass, FlaskConical, Package, PenTool } from 'lucide-react'
import { Component } from '../lib/supabase'
import { useAppStore } from '../stores/useAppStore'
import { useCursorTelemetry } from '../stores/useCursorTelemetry'
import { useProjectStore, type CanvasComponent, type CanvasWire } from '../stores/useProjectStore'
import { useTheme } from '../lib/theme/useTheme'
import { THEMES, hslTripletToRgb, rgbToHex } from '../lib/theme/tokens'
import Konva from 'konva'
import { useShortcutStore } from '../stores/useShortcutStore'
import { describeShortcut, isEditableTarget, matchesShortcut } from '../lib/keymap/shortcuts'
import { generateId } from '../lib/utils'
import { placePart } from '../lib/schematic/placePart'
import { applyContextAction, CONTEXT_ACTIONS, validateSymbol, type ContextActionId } from '../lib/schematic/contextMenu'
import SchematicSymbolEditor from './SchematicSymbolEditor'
import SketchLayer from './sketch/SketchLayer'
import { routePoints } from '../lib/schematic/wireRouting'
import { applyWireDrag, hitWireHandle, type WireHandle } from '../lib/schematic/wireDrag'
import { tidySchematic } from '../lib/schematic/tidyLayout'
import {
  drawingExtents,
  frameAround,
  layoutComponentLabels,
  layoutNetLabels,
  pinWorldCoord,
  rotatePinCoord,
  wireJunctions,
} from '../lib/schematic/drawingLayout'
import { SCHEMATIC_UNITS_PER_MM } from '../lib/schematic/units'
import { probeNet } from '../lib/schematic/netProbe'

const RULER_SIZE = 18
const RULER_STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000]

/** Compact coordinate label for rulers and the HUD. */
const fmtCoord = (value: number) =>
  Math.abs(value) >= 1000 ? String(Math.round(value)) : String(Math.round(value * 10) / 10)

type Box = { minX: number; minY: number; maxX: number; maxY: number }

/**
 * Axis-aligned bounds of a placed part, including rotation. Konva turns a part
 * about its origin, so rotating the four symbol corners and taking their
 * envelope is the same rectangle the user sees on the sheet.
 */
function placedBounds(comp: {
  x: number
  y: number
  rotation: number
  component: { symbol_data: { width: number; height: number } }
}): Box {
  const width = comp.component.symbol_data.width
  const height = comp.component.symbol_data.height
  const radians = (comp.rotation * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const corners = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ].map(([x, y]) => ({ x: comp.x + x * cos - y * sin, y: comp.y + x * sin + y * cos }))
  return {
    minX: Math.min(...corners.map((point) => point.x)),
    minY: Math.min(...corners.map((point) => point.y)),
    maxX: Math.max(...corners.map((point) => point.x)),
    maxY: Math.max(...corners.map((point) => point.y)),
  }
}

/** Marquee semantics are "touch": a part is caught if its box overlaps. */
function boxOverlaps(a: Box, b: Box): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY
}

interface SchematicCanvasProps {
  components: Component[]
  onSave: (data: Record<string, unknown>) => void
  /** Library part armed for click-to-place; drops on the next sheet click. */
  pendingComponent?: Component | null
  /** Notifies the parent once an armed part has been placed. */
  onPendingPlaced?: () => void
  /** Empty-sheet doorways: worked examples and the part catalogue. */
  onOpenDemos?: () => void
  onBrowseParts?: () => void
}

export default function SchematicCanvas({
  components,
  onSave,
  pendingComponent = null,
  onPendingPlaced,
  onOpenDemos,
  onBrowseParts,
}: SchematicCanvasProps) {
  const stageRef = useRef<Konva.Stage>(null)
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 })
  /** True while a part is being dragged (suppresses click-select on drop). */
  const [isDragging, setIsDragging] = useState(false)
  /** Middle-button / space-drag pan state (the ONLY way the sheet moves). */
  const [panning, setPanning] = useState<{ startX: number; startY: number; panX: number; panY: number } | null>(null)
  /**
   * Rubber-band selection in world coordinates. Started by a left drag on empty
   * sheet with the select tool; a press that never moves keeps its old meaning
   * (click empty space to clear the selection).
   */
  const [marquee, setMarquee] = useState<{ start: { x: number; y: number }; end: { x: number; y: number } } | null>(null)
  const marqueeRef = useRef<{
    start: { x: number; y: number }
    end: { x: number; y: number }
    startClient: { clientX: number; clientY: number }
    additive: boolean
    moved: boolean
  } | null>(null)
  /** Suppresses the click that the browser fires immediately after a marquee. */
  const marqueeJustEnded = useRef(false)
  /** Konva groups by id, so a multi-part drag can move siblings live. */
  const groupRefs = useRef(new Map<string, Konva.Group>())
  const dragGroupRef = useRef<{
    start: { x: number; y: number }
    others: Array<{ id: string; x: number; y: number }>
  } | null>(null)
  /**
   * Live preview of a wire pull. The sheet's wires are held in local state
   * while the pointer is down and committed as one design replacement on
   * release, so a pull is one undo step and the store never sees the frames
   * in between.
   */
  const [dragWires, setDragWires] = useState<CanvasWire[] | null>(null)
  const wireDragRef = useRef<{
    handle: WireHandle
    origin: { x: number; y: number }
    startWires: CanvasWire[]
    moved: boolean
  } | null>(null)
  /** rAF-throttled crosshair position in screen pixels. */
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const cursorFrame = useRef<number | null>(null)
  const pendingCursor = useRef<{ x: number; y: number } | null>(null)
  /** Pin under the pointer: drives the hover readout that follows the cursor. */
  const [hoveredPin, setHoveredPin] = useState<{
    id: string; ref: string; name: string; pin: { id: string; name: string }; at: { x: number; y: number }
  } | null>(null)
  /** Part body under the pointer (no pin): shows ref + value + footprint. */
  const [hoveredPart, setHoveredPart] = useState<{
    id: string; ref: string; name: string; props: Record<string, unknown>
  } | null>(null)
  /** Wire under the pointer; its whole net lights up as a preview. */
  const [hoveredWireId, setHoveredWireId] = useState<string | null>(null)

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
    setActiveTool,
    setZoom,
    setPan,
    selectedComponents,
    setSelectedComponents,
    selectedNet,
    selectNet,
    clearSelection,
    focusRequest,
    consumeComponentFocus,
    netFocusRequest,
    consumeNetFocus,
  } = useAppStore()

  const {
    components: canvasComponents,
    wires,
    addComponent,
    addWire,
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

  /** Centre a world-space box in the measured stage at a legible zoom. */
  const frameBox = useCallback((bounds: Box) => {
    const currentZoom = useAppStore.getState().viewport.zoom
    const zoom = Math.max(currentZoom, 0.9)
    const rulerInset = useAppStore.getState().settings.showRulers ? RULER_SIZE : 0
    if (zoom !== currentZoom) setZoom(zoom)
    setPan({
      x: (rulerInset + stageSize.width) / 2 - ((bounds.minX + bounds.maxX) / 2) * zoom,
      y: (rulerInset + stageSize.height) / 2 - ((bounds.minY + bounds.maxY) / 2) * zoom,
    })
  }, [stageSize, setZoom, setPan])

  /*
   * Locate from the design-health dock or the command palette: the caller has
   * already selected the part, and this brings it under the viewport at a
   * legible zoom so the offending pin is on screen rather than merely selected
   * off-screen. The request waits for a measured stage, which is what makes a
   * palette jump that also mounts the sheet land in the middle instead of 0,0.
   */
  useEffect(() => {
    if (!focusRequest || stageSize.width < 4 || stageSize.height < 4) return
    const comp = useProjectStore.getState().components.find(
      (candidate) => candidate.id === focusRequest.id,
    )
    consumeComponentFocus(focusRequest.nonce)
    if (!comp) return
    frameBox(placedBounds(comp))
  }, [focusRequest, stageSize, frameBox, consumeComponentFocus])

  /*
   * A net jump frames the whole wire run, not one part: the highlight only
   * reads when every segment the net reaches is inside the viewport.
   */
  useEffect(() => {
    if (!netFocusRequest || stageSize.width < 4 || stageSize.height < 4) return
    consumeNetFocus(netFocusRequest.nonce)
    const points = useProjectStore.getState().wires
      .filter((wire) => wire.netName === netFocusRequest.name)
      .flatMap((wire) => wire.points)
    if (points.length === 0) return
    frameBox({
      minX: Math.min(...points.map((point) => point.x)),
      minY: Math.min(...points.map((point) => point.y)),
      maxX: Math.max(...points.map((point) => point.x)),
      maxY: Math.max(...points.map((point) => point.y)),
    })
  }, [netFocusRequest, stageSize, frameBox, consumeNetFocus])

  /*
   * One-press tidy: the rail's Tidy button (and the T shortcut) dispatch
   * `folio:tidy-schematic`. This is a drafting pass, not a rewiring one —
   * the nets, pin memberships, rotations and part values are carried through
   * untouched, so the tidy sheet simulates identically to the messy one. The
   * whole sheet is replaced in one step, so a tidy is one undo.
   */
  useEffect(() => {
    const tidy = () => {
      const store = useProjectStore.getState()
      if (store.components.length === 0 && store.wires.length === 0) return
      const { gridSize } = useAppStore.getState().settings
      const next = tidySchematic(store.components, store.wires, { gridSize })
      store.replaceDesign({ components: next.components, wires: next.wires })
      store.markDirty()
      window.dispatchEvent(new CustomEvent('folio:fit-view'))
    }

    window.addEventListener('folio:tidy-schematic', tidy)
    return () => window.removeEventListener('folio:tidy-schematic', tidy)
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

  const handleDragStart = (e: Konva.KonvaEventObject<DragEvent>) => {
    setIsDragging(true)
    const id = e.target.id()
    const start = e.target.position()
    // Dragging any part of a multi-selection moves the whole group, the way a
    // CAD editor treats a selection as one object.
    dragGroupRef.current = selectedComponents.includes(id) && selectedComponents.length > 1
      ? {
          start,
          others: canvasComponents
            .filter((comp) => comp.id !== id && selectedComponents.includes(comp.id))
            .map((comp) => ({ id: comp.id, x: comp.x, y: comp.y })),
        }
      : null
  }

  /** Move sibling groups with the pointer without touching the store yet. */
  const handleDragMove = (e: Konva.KonvaEventObject<DragEvent>) => {
    const drag = dragGroupRef.current
    if (!drag || drag.others.length === 0) return
    const dx = e.target.x() - drag.start.x
    const dy = e.target.y() - drag.start.y
    for (const other of drag.others) {
      groupRefs.current.get(other.id)?.position({ x: other.x + dx, y: other.y + dy })
    }
  }

  /*
   * Rubber-band drag: moving a part reconciles every attached wire endpoint
   * onto its moved pin, so wires stay landed on terminals (your screenshot
   * showed them frozen mid-air). Corners survive: the moved endpoint rides
   * the pin delta, the joint before it holds unless the segment collapses.
   * The whole sheet is committed as one design replacement, so dragging a
   * part — or a multi-selection of ten — is a single undo step, not one
   * snapshot per wire it happens to touch.
   */
  const movePartsWithWires = (
    moves: Array<{ comp: CanvasComponent; to: { x: number; y: number } }>,
  ) => {
    const store = useProjectStore.getState()
    const wiresByIndex = new Map<number, CanvasWire>()
    store.wires.forEach((wire, wireIndex) => {
      // Every landing is measured against the ORIGINAL geometry: two moved
      // parts sharing a junction would otherwise fight over the same vertex.
      const landed = new Map<number, { x: number; y: number }>()
      for (const move of moves) {
        const pinsById = new Map(move.comp.component.pins.map((p) => [p.id, p]))
        for (const pinned of wire.connectedPins) {
          if (pinned.componentId !== move.comp.id) continue
          const pin = pinsById.get(pinned.pinId)
          if (!pin) continue
          const rotated = rotatePinCoord(pin, move.comp.rotation)
          const from = { x: move.comp.x + rotated.x, y: move.comp.y + rotated.y }
          wire.points.forEach((point, index) => {
            if (landed.has(index)) return
            if (Math.hypot(point.x - from.x, point.y - from.y) >= 1.5) return
            landed.set(index, { x: move.to.x + rotated.x, y: move.to.y + rotated.y })
          })
        }
      }
      if (landed.size === 0) return
      wiresByIndex.set(
        wireIndex,
        { ...wire, points: wire.points.map((point, index) => landed.get(index) ?? point) },
      )
    })
    if (wiresByIndex.size === 0 && moves.length === 0) return
    store.replaceDesign({
      components: store.components.map((comp) => {
        const move = moves.find((candidate) => candidate.comp.id === comp.id)
        return move ? { ...comp, x: move.to.x, y: move.to.y } : comp
      }),
      wires: store.wires.map((wire, wireIndex) => wiresByIndex.get(wireIndex) ?? wire),
    })
  }

  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    const id = e.target.id()
    const newPos = e.target.position()
    const moved = canvasComponents.find(c => c.id === id)
    const drag = dragGroupRef.current
    dragGroupRef.current = null
    if (id && moved) {
      const moves = [{ comp: moved, to: newPos }]
      if (drag && drag.others.length > 0) {
        const dx = newPos.x - drag.start.x
        const dy = newPos.y - drag.start.y
        for (const other of drag.others) {
          const comp = canvasComponents.find(c => c.id === other.id)
          if (comp) moves.push({ comp, to: { x: other.x + dx, y: other.y + dy } })
        }
      }
      movePartsWithWires(moves)
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

    addComponent(placePart(libraryComponent, useProjectStore.getState().components, pos))
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
    setHoveredWireId(null)
    // The browser fires click after the mouseup that ended a marquee.
    if (marqueeJustEnded.current) {
      marqueeJustEnded.current = false
      return
    }
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

    clearSelection()
  }

  const handleComponentClick = (id: string, pinId?: string, additive = false) => {
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

    if (additive) {
      setSelectedComponents(selectedComponents.includes(id)
        ? selectedComponents.filter((selectedId) => selectedId !== id)
        : [...selectedComponents, id])
      return
    }

    setSelectedComponents([id])
  }

  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  /** Placed part whose library symbol the editor dialog is open on. */
  const [symbolEditorId, setSymbolEditorId] = useState<string | null>(null)

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
    const { settings: currentSettings } = useAppStore.getState()
    const pos = screenToWorldRaw(screen)
    if (currentSettings.snapToGrid) {
      pos.x = Math.round(pos.x / currentSettings.gridSize) * currentSettings.gridSize
      pos.y = Math.round(pos.y / currentSettings.gridSize) * currentSettings.gridSize
    }
    return pos
  }

  /** Pointer → sheet millimetres without grid snapping (marquee corners). */
  const screenToWorldRaw = (screen: { x: number; y: number }): { x: number; y: number } => {
    const { viewport: currentViewport } = useAppStore.getState()
    return {
      x: (screen.x - currentViewport.pan.x) / currentViewport.zoom,
      y: (screen.y - currentViewport.pan.y) / currentViewport.zoom,
    }
  }

  /** Browser client coordinates → sheet millimetres, for window-level drags. */
  const clientToWorld = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const container = stageRef.current?.container()
    if (!container) return null
    const rect = container.getBoundingClientRect()
    return screenToWorldRaw({ x: clientX - rect.left, y: clientY - rect.top })
  }

  /*
   * Every pin tip on the sheet. A wire end that sits on one is a landed
   * connection, so the drag engine needs to know about it: a pulled run whose
   * end is pinned dog-legs away from the pin instead of tearing loose, and a
   * pinned junction is left to the part drag rather than offered as a node.
   */
  const pinTips = useMemo(
    () => canvasComponents.flatMap((comp) => comp.component.pins.map((pin) => pinWorldCoord(comp, pin))),
    [canvasComponents],
  )

  /** The wires the sheet draws and measures: the preview while a pull is live. */
  const shownWires = dragWires ?? wires

  const isWireSelected = useCallback((wire: CanvasWire) => {
    if (!selectedNet) return false
    return 'name' in selectedNet
      ? wire.netName === selectedNet.name
      : wire.id === selectedNet.wireId
  }, [selectedNet])

  /** Pin tips the selected net lands on, drawn as connection markers. */
  const selectedNetPins = useMemo(() => {
    if (!selectedNet) return []
    const seen = new Set<string>()
    const tips: Array<{ x: number; y: number }> = []
    for (const wire of wires) {
      if (!isWireSelected(wire)) continue
      for (const connection of wire.connectedPins) {
        const key = `${connection.componentId}:${connection.pinId}`
        if (seen.has(key)) continue
        seen.add(key)
        const comp = canvasComponents.find((candidate) => candidate.id === connection.componentId)
        const pin = comp?.component.pins.find((candidate) => candidate.id === connection.pinId)
        if (comp && pin) tips.push(pinWorldCoord(comp, pin))
      }
    }
    return tips
  }, [selectedNet, wires, canvasComponents, isWireSelected])

  /*
   * Hover preview: the wire under the pointer stands for its whole net, so the
   * sheet can light every segment and pin tip before the designer commits a
   * click. The probe shares the net inspector's figures.
   */
  const hoveredNet = useMemo(
    () => (hoveredWireId ? probeNet(wires, hoveredWireId) : null),
    [hoveredWireId, wires],
  )

  const hoveredNetIsSelected = Boolean(hoveredNet && hoveredNet.wires.every(isWireSelected))

  /** Pin tips the hovered net lands on, the same markers selection draws. */
  const hoveredNetPins = useMemo(() => {
    if (!hoveredNet) return []
    const seen = new Set<string>()
    const tips: Array<{ x: number; y: number }> = []
    for (const wire of hoveredNet.wires) {
      for (const connection of wire.connectedPins) {
        const key = `${connection.componentId}:${connection.pinId}`
        if (seen.has(key)) continue
        seen.add(key)
        const comp = canvasComponents.find((candidate) => candidate.id === connection.componentId)
        const pin = comp?.component.pins.find((candidate) => candidate.id === connection.pinId)
        if (comp && pin) tips.push(pinWorldCoord(comp, pin))
      }
    }
    return tips
  }, [hoveredNet, canvasComponents])

  /** Pick the net a wire carries: named nets span every segment of that name. */
  const selectWireNet = (wire: CanvasWire) => {
    selectNet(wire.netName ? { name: wire.netName } : { wireId: wire.id })
  }

  /*
   * Pull a wire run or a junction node, the way a drafting editor does it:
   * press the copper, drag, release. The hit test runs against the wire
   * geometry, not the netlist, so what moves is exactly what was grabbed —
   * `connectedPins` ride along untouched and the circuit does not change.
   * A press that never moves is a click, and a click on the copper picks the
   * net it carries.
   */
  const startWireDrag = (e: Konva.KonvaEventObject<MouseEvent>, wire: CanvasWire) => {
    if (e.evt.button !== 0 || activeTool !== 'select' || pendingComponent) return
    const stage = e.target.getStage()
    const pointer = stage?.getPointerPosition()
    if (!pointer) return
    const { settings: currentSettings, viewport: currentViewport } = useAppStore.getState()
    const handle = hitWireHandle(wires, screenToWorldRaw(pointer), {
      tolerance: 10 / currentViewport.zoom,
      nodeTolerance: 7 / currentViewport.zoom,
      terminals: pinTips,
    })
    if (!handle) {
      selectWireNet(wire)
      return
    }
    e.evt.preventDefault()
    wireDragRef.current = {
      handle,
      origin: screenToWorldRaw(pointer),
      startWires: wires,
      moved: false,
    }
    setDragWires(wires)

    const stepGrid = currentSettings.snapToGrid ? currentSettings.gridSize : 1
    let latest: CanvasWire[] | null = null
    const onMove = (event: MouseEvent) => {
      const drag = wireDragRef.current
      const world = clientToWorld(event.clientX, event.clientY)
      if (!drag || !world) return
      const offset = {
        x: Math.round((world.x - drag.origin.x) / stepGrid) * stepGrid,
        y: Math.round((world.y - drag.origin.y) / stepGrid) * stepGrid,
      }
      if (offset.x === 0 && offset.y === 0) return
      drag.moved = true
      latest = applyWireDrag(drag.startWires, drag.handle, offset, {
        grid: currentSettings.gridSize,
        terminals: pinTips,
      })
      setDragWires(latest)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      const drag = wireDragRef.current
      wireDragRef.current = null
      setDragWires(null)
      // A press that never moved the copper is a click, not an edit: it picks
      // the net and must not enter the undo history.
      if (!drag?.moved) {
        if (drag) selectWireNet(wire)
        return
      }
      if (!latest) return
      const store = useProjectStore.getState()
      store.replaceDesign({ components: store.components, wires: latest })
      markDirty()
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  /**
   * End a rubber band: select every part it touches. Shift keeps the existing
   * selection and adds to it, which is why the modifier is captured at press
   * time rather than read from the mouse-up event.
   */
  const finishMarquee = () => {
    const active = marqueeRef.current
    marqueeRef.current = null
    setMarquee(null)
    if (!active) return
    if (!active.moved) {
      // A press that never moved is still "click empty sheet".
      if (!active.additive) clearSelection()
      return
    }
    marqueeJustEnded.current = true
    const rect: Box = {
      minX: Math.min(active.start.x, active.end.x),
      minY: Math.min(active.start.y, active.end.y),
      maxX: Math.max(active.start.x, active.end.x),
      maxY: Math.max(active.start.y, active.end.y),
    }
    const hits = canvasComponents
      .filter((comp) => boxOverlaps(placedBounds(comp), rect))
      .map((comp) => comp.id)
    setSelectedComponents(active.additive
      ? Array.from(new Set([...selectedComponents, ...hits]))
      : hits)
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
    if (action === 'edit-symbol') {
      setSymbolEditorId(menu.id)
      setMenu(null)
      return
    }
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
   * Net names sit on the sheet the way a drawn schematic carries them. They
   * are laid out against the committed sheet (not a drag frame) so routing
   * copper does not make the labels dance, and they follow the same display
   * toggle as the grid and rulers.
   */
  const netLabels = useMemo(
    () => (settings.showNetLabels ? layoutNetLabels(wires, canvasComponents, labelLayout) : []),
    [settings.showNetLabels, wires, canvasComponents, labelLayout],
  )

  /*
   * Drawing sheet: a border, zone references and a title block sized around
   * the circuit. The extra bottom padding keeps the title block clear of the
   * annotations, so a screenshot of the sheet reads as a drawing rather than
   * a floating canvas.
   */
  const sheetFrame = useMemo(() => {
    if (canvasComponents.length === 0) return null
    const frame = frameAround(drawingExtents(canvasComponents, shownWires, labelLayout))
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
  }, [canvasComponents, shownWires, labelLayout])

  /*
   * Deletion is a cross-cutting shortcut, so it is memoised and attached once.
   * Re-registering the listener on every selection change is what made the
   * previous version stale-prone.
   */
  const shortcutOverrides = useShortcutStore((s) => s.overrides)
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (matchesShortcut(event, 'schematic.cancel', shortcutOverrides)) {
        // Cancel an in-progress wire first; the sheet owns this shortcut while wiring.
        if (wireStart) {
          setWireStart(null)
          return
        }
      }
      if (!matchesShortcut(event, 'schematic.deleteSelection', shortcutOverrides)) return
      // Never eat keys while the user is typing in a field.
      if (isEditableTarget(event.target)) return
      if (selectedComponents.length === 0) return
      event.preventDefault()
      selectedComponents.forEach((id) => removeComponent(id))
      setSelectedComponents([])
      markDirty()
    },
    [wireStart, selectedComponents, removeComponent, setSelectedComponents, markDirty, shortcutOverrides],
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
        ref={(node) => {
          if (node) groupRefs.current.set(canvasComp.id, node)
          else groupRefs.current.delete(canvasComp.id)
        }}
        x={canvasComp.x}
        y={canvasComp.y}
        rotation={canvasComp.rotation}
        draggable={activeTool === 'select'}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onClick={(event) => handleComponentClick(canvasComp.id, undefined, event.evt.shiftKey)}
        onContextMenu={(event) => handleComponentContextMenu(event, canvasComp.id)}
        onMouseEnter={() => {
          setHoveredWireId(null)
          setHoveredPin(null)
          setHoveredPart({ id: canvasComp.id, ref: canvasComp.reference, name: canvasComp.component.name, props: canvasComp.properties })
          setCursorFromEvent()
        }}
        onMouseMove={() => {
          setHoveredWireId(null)
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
              handleComponentClick(canvasComp.id, pin.id, event.evt.shiftKey)
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
        const touched = shownWires.some((w) =>
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
  }, [canvasComponents, shownWires]);

  /* Wire segments */
  const segments = useMemo(() => {
    const out: Array<{ x1: number; y1: number; x2: number; y2: number; wireId: string }> = []
    for (const wire of shownWires) {
      for (let k = 0; k + 1 < wire.points.length; k++) {
        out.push({ x1: wire.points[k].x, y1: wire.points[k].y,
          x2: wire.points[k + 1].x, y2: wire.points[k + 1].y, wireId: wire.id })
      }
    }
    return out
  }, [shownWires])

  /* Endpoint of one wire touching another wire (first/last point only):
     filled junction dot — same net only. A stub end landing anywhere on a
     same-net segment (rail midpoint, T corner) is a genuine joint and gets
     the dot; a touch across different nets never does. */
  const junctions = useMemo(() => wireJunctions(shownWires), [shownWires])

  /* Wires crossing without shared pins: hop bow on the crossing. Same-net
     crossings are already one node — hopping them would fake a disconnect,
     so only different nets jump. */
  const crossings = useMemo(() => {
    const hops: Array<{ x: number; y: number; wireId: string }> = []
    const seenHop = new Set<string>()
    const byId = new Map(shownWires.map((w) => [w.id, w.netName ?? '']))
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
        for (const w of shownWires) { for (const pt of w.points) { if (Math.abs(pt.x - x) < 8 && Math.abs(pt.y - y) < 8) { nearEnd = true; break } } if (nearEnd) break }
        if (nearEnd) continue
        const hopKey = Math.round(x) + ':' + Math.round(y)
        if (seenHop.has(hopKey)) continue
        seenHop.add(hopKey)
        hops.push({ x, y, wireId: h.wireId })
      }
    }
    return hops
  }, [segments, junctions, shownWires])

  /* A wire's own polyline — the hop is a segment of the wire's path, not a
     painted overlay. Splitting yields straight pieces and the semicircular
     bridge arcs; the crossing wire underneath is drawn straight through. */
  type WirePiece =
    | { kind: 'line'; points: number[] }
    | { kind: 'arc'; d: string }
  const splitWireAtHops = useCallback((wire: (typeof shownWires)[number]): WirePiece[] => {
    const hops = crossings.filter((h) => h.wireId === wire.id)
    if (hops.length === 0) {
      const points = wire.points.flatMap((pt) => [pt.x, pt.y])
      return points.length >= 4 ? [{ kind: 'line', points }] : []
    }
    const pieces: WirePiece[] = []
    let current: number[] = []
    const flush = () => {
      if (current.length >= 4) pieces.push({ kind: 'line', points: current })
      current = []
    }
    const pts = wire.points
    current = [pts[0]!.x, pts[0]!.y]
    for (let i = 0; i + 1 < pts.length; i += 1) {
      const a = pts[i]!
      const b = pts[i + 1]!
      const dir = Math.sign(b.x - a.x) || 1
      const isHorizontal = Math.abs(a.y - b.y) < 0.5
      const edgeHops = isHorizontal
        ? hops
            .filter((h) => Math.abs(h.y - a.y) < 0.5 && Math.min(a.x, b.x) + 0.5 < h.x && h.x < Math.max(a.x, b.x) - 0.5)
            .sort((p, q) => (p.x - a.x) * dir - (q.x - a.x) * dir)
        : []
      if (edgeHops.length === 0) {
        current.push(b.x, b.y)
        continue
      }
      for (const hop of edgeHops) {
        const inX = hop.x - 7 * dir
        const outX = hop.x + 7 * dir
        current.push(inX, a.y)
        flush()
        pieces.push({ kind: 'arc', d: `M ${hop.x - 7},${a.y} A 7,6 0 0,1 ${hop.x + 7},${a.y}` })
        current = [outX, a.y]
      }
      current.push(b.x, b.y)
    }
    flush()
    return pieces
  }, [crossings])
  const renderWires = () => {
    const { zoom } = viewport
    return (
      <>
        {/* Hover preview: the whole net glows, softer than a committed selection. */}
        {hoveredNet && !hoveredNetIsSelected && shownWires.filter((wire) => hoveredNet.wires.includes(wire)).map(wire => (
          <Line
            key={`net-hover-${wire.id}`}
            points={wire.points.flatMap(pt => [pt.x, pt.y])}
            stroke={palette.selectedStroke}
            strokeWidth={7 / zoom}
            opacity={0.13}
            lineCap="round"
            lineJoin="round"
            listening={false}
          />
        ))}
        {/* Selected net: a soft halo under the copper, plus pin markers. */}
        {shownWires.filter(isWireSelected).map(wire => (
          <Line
            key={`net-halo-${wire.id}`}
            points={wire.points.flatMap(pt => [pt.x, pt.y])}
            stroke={palette.selectedStroke}
            strokeWidth={7 / zoom}
            opacity={0.18}
            lineCap="round"
            lineJoin="round"
            listening={false}
          />
        ))}
        {shownWires.flatMap(wire => {
          const selected = isWireSelected(wire)
          const wireStyle = {
            stroke: selected ? palette.selectedStroke : palette.wire,
            strokeWidth: (selected ? 2.6 : 2) / zoom,
            lineCap: 'round' as const,
            lineJoin: 'round' as const,
            hitStrokeWidth: 12,
          }
          const interactive = {
            onMouseDown: (e: Konva.KonvaEventObject<MouseEvent>) => startWireDrag(e, wire),
            onMouseEnter: () => {
              setHoveredPin(null)
              setHoveredWireId(wire.id)
              setCursorFromEvent()
            },
            onMouseMove: () => setCursorFromEvent(),
            onMouseLeave: () => setHoveredWireId(null),
          }
          return splitWireAtHops(wire).map((piece, i) =>
            piece.kind === 'line' ? (
              <Line
                key={`${wire.id}-${i}`}
                points={piece.points}
                {...wireStyle}
                {...interactive}
              />
            ) : (
              // The hop is the wire's own path arcing over the crossing wire.
              <Path
                key={`${wire.id}-${i}`}
                data={piece.d}
                stroke={wireStyle.stroke}
                strokeWidth={wireStyle.strokeWidth}
                fillEnabled={false}
                lineCap="round"
                hitStrokeWidth={12}
                {...interactive}
              />
            ),
          )
        })}
        {hoveredNet && !hoveredNetIsSelected && hoveredNetPins.map((tip, k) => (
          <Circle
            key={`net-hover-pin-${k}`}
            x={tip.x}
            y={tip.y}
            radius={3.4 / zoom}
            fill={palette.selectedStroke}
            stroke={palette.sheet}
            strokeWidth={1 / zoom}
            opacity={0.6}
            listening={false}
          />
        ))}
        {selectedNetPins.map((tip, k) => (
          <Circle
            key={`net-pin-${k}`}
            x={tip.x}
            y={tip.y}
            radius={4 / zoom}
            fill={palette.selectedStroke}
            stroke={palette.sheet}
            strokeWidth={1 / zoom}
            listening={false}
          />
        ))}
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

      </>
    )
  }

  /*
   * Net-name labels. They are the sheet's own net cursor: a press selects the
   * whole net, exactly like pressing its copper, without needing to find an
   * exposed segment among the parts.
   */
  const renderNetLabels = () =>
    netLabels.map((label) => {
      const selected =
        selectedNet !== null && 'name' in selectedNet && selectedNet.name === label.name
      const { x, y, width, height } = label.box
      return (
        <Group
          key={`net-label-${label.name}`}
          x={x}
          y={y}
          onMouseDown={(event) => {
            event.cancelBubble = true
            selectNet({ name: label.name })
          }}
          onMouseEnter={() => {
            const wire = wires.find((candidate) => candidate.netName === label.name)
            if (!wire) return
            setHoveredPin(null)
            setHoveredWireId(wire.id)
            setCursorFromEvent()
          }}
          onMouseMove={() => setCursorFromEvent()}
          onMouseLeave={() => setHoveredWireId(null)}
        >
          <Rect
            width={width}
            height={height}
            cornerRadius={2}
            fill={palette.sheet}
            stroke={selected ? palette.selectedStroke : palette.wire}
            strokeWidth={selected ? 1.2 : 0.7}
          />
          <Text
            text={label.name}
            width={width}
            height={height}
            align="center"
            verticalAlign="middle"
            fontSize={8}
            fontStyle="bold"
            fontFamily="Inter, 'Segoe UI', system-ui, sans-serif"
            fill={selected ? palette.selectedStroke : palette.wire}
            listening={false}
            perfectDrawEnabled={false}
          />
        </Group>
      )
    })

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
    const band = marqueeRef.current
    if (band) {
      // A few pixels of shake should not turn a clearing click into a band.
      if (!band.moved
        && Math.hypot(e.clientX - band.startClient.clientX, e.clientY - band.startClient.clientY) > 3) {
        band.moved = true
      }
      if (band.moved) {
        band.end = screenToWorldRaw({ x: e.clientX - rect.left, y: e.clientY - rect.top })
        setMarquee({ start: band.start, end: band.end })
      }
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

  /* Report the mm position to the telemetry store; 10 sheet units = 1 mm
   * (src/lib/schematic/units.ts). Skipped when the pointer is off-stage. */
  const cursorXmm = cursorWorld ? cursorWorld.x / SCHEMATIC_UNITS_PER_MM : null
  const cursorYmm = cursorWorld ? cursorWorld.y / SCHEMATIC_UNITS_PER_MM : null
  useEffect(() => {
    if (cursorXmm === null || cursorYmm === null) return
    useCursorTelemetry.getState().setPosition(cursorXmm, cursorYmm)
  }, [cursorXmm, cursorYmm])

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
        // handleMouseMove while `panning` is set). Left drags are handled by
        // the stage: a part moves, empty sheet rubber-bands.
        if (e.button === 1) {
          e.preventDefault()
          const { pan } = useAppStore.getState().viewport
          setPanning({ startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y })
        }
      }}
      onMouseUp={() => {
        setPanning(null)
        // A release outside the sheet never reaches the div.
        finishMarquee()
      }}
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
          // Left press on EMPTY sheet with the select tool starts a rubber
          // band. Part presses never reach here — the part Group consumes
          // them. A press that does not move stays a plain clearing click.
          if (e.evt.button !== 0 || activeTool !== 'select' || pendingComponent) return
          if (e.target !== e.target.getStage()) return
          const pointer = e.target.getStage()?.getPointerPosition()
          if (!pointer) return
          const start = screenToWorldRaw(pointer)
          marqueeRef.current = {
            start,
            end: start,
            startClient: { clientX: e.evt.clientX, clientY: e.evt.clientY },
            additive: e.evt.shiftKey,
            moved: false,
          }
          // A release outside the sheet never reaches the div.
          const onUp = () => {
            window.removeEventListener('mouseup', onUp)
            finishMarquee()
          }
          window.addEventListener('mouseup', onUp)
        }}
      >
        <Layer>
          {/* Drawing sheet border + title block (behind the grid) */}
          {renderSheetFrame()}

          {/* Grid */}
          {renderGrid()}
          
          {/* Wires */}
          {renderWires()}

          {/* Net names, above their copper and below the parts */}
          {renderNetLabels()}

          {/* Pending wire start */}
          {renderWireStart()}
          
          {/* Components */}
          {canvasComponents.map(renderComponent)}

          {/* Rubber-band selection, drawn above the parts it is catching. */}
          {marquee ? (
            <Rect
              x={Math.min(marquee.start.x, marquee.end.x)}
              y={Math.min(marquee.start.y, marquee.end.y)}
              width={Math.abs(marquee.end.x - marquee.start.x)}
              height={Math.abs(marquee.end.y - marquee.start.y)}
              fill={palette.selectedStroke}
              opacity={0.12}
              stroke={palette.selectedStroke}
              strokeWidth={1.2 / viewport.zoom}
              dash={[4 / viewport.zoom, 3 / viewport.zoom]}
              listening={false}
            />
          ) : null}
        </Layer>
      </Stage>

      {/* Freehand/stylus ink sits above the sheet and commits real parts */}
      {activeTool === 'sketch' && <SketchLayer library={components} />}
      
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
      {(cursor && !hoveredPin && !hoveredNet && hoveredPart && (() => {
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

      {(cursor && !hoveredPin && hoveredNet && (
        <div
          className="cad-tip"
          style={{ transform: `translate(${Math.round(cursor.x + 14)}px, ${Math.round(cursor.y + 14)}px)` }}
          role="status"
        >
          <span className="font-semibold">net {hoveredNet.name ?? 'unnamed'}</span>
          <span className="text-muted-foreground">
            {hoveredNet.pins} pin{hoveredNet.pins === 1 ? '' : 's'} · {hoveredNet.segments} segment{hoveredNet.segments === 1 ? '' : 's'}
          </span>
          <span className="cad-readout">{(hoveredNet.length / SCHEMATIC_UNITS_PER_MM).toFixed(1)} mm</span>
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
          <span className="text-[11px] font-medium text-muted-foreground">Place</span>
          <span className="cad-readout text-foreground">{pendingComponent.name}</span>
          <span className="text-muted-foreground">click sheet to drop</span>
          <kbd className="cad-kbd">Esc</kbd>
        </div>
      )}
      
      {/* Empty sheet: real doorways instead of a caption. The card is
          pointer-transparent at its edges so the sheet behind still takes the
          first click; it steps aside entirely once a part is armed. */}
      {canvasComponents.length === 0 && !pendingComponent && (
        <div className="cad-empty-sheet">
          <div className="cad-empty-sheet__card">
            <span className="empty-radar" aria-hidden="true">
              <span className="empty-radar__mark">
                <DraftingCompass className="h-9 w-9" />
              </span>
            </span>
            <p className="cad-empty-sheet__eyebrow">A4 · Sheet 1 of 1</p>
            <h2 className="cad-empty-sheet__title">The sheet is yours</h2>
            <p className="cad-empty-sheet__lede">
              Drop a part onto the grid, open a worked example, or sketch the idea and let
              Folio read it onto the sheet.
            </p>
            <div className="cad-empty-sheet__actions">
              {onBrowseParts && (
                <button
                  type="button"
                  onClick={onBrowseParts}
                  className="cad-empty-sheet__action cad-empty-sheet__action--primary"
                >
                  <Package aria-hidden="true" />
                  Browse parts
                </button>
              )}
              {onOpenDemos && (
                <button
                  type="button"
                  onClick={onOpenDemos}
                  className="cad-empty-sheet__action"
                >
                  <FlaskConical aria-hidden="true" />
                  Load a demo
                </button>
              )}
              <button
                type="button"
                onClick={() => useAppStore.setState({ aiChatOpen: true })}
                className="cad-empty-sheet__action"
              >
                <Bot aria-hidden="true" />
                Ask the assistant
              </button>
              <button
                type="button"
                onClick={() => setActiveTool('sketch')}
                className="cad-empty-sheet__action"
              >
                <PenTool aria-hidden="true" />
                Sketch
              </button>
            </div>
            <dl className="cad-empty-sheet__keys">
              {[
                ['schematic.selectTool', 'Select'],
                ['schematic.wireTool', 'Wire'],
                ['schematic.sketchTool', 'Sketch'],
                ['schematic.fit', 'Fit'],
              ].map(([id, label]) => (
                <div key={id}>
                  <dt>{label}</dt>
                  <dd>
                    <kbd className="cad-kbd">{describeShortcut(id, shortcutOverrides)}</kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}

      {/* Symbol contract faults — fail loud, never a silently blank part */}
      {symbolFaults.length > 0 && (
        <div className="cad-symbol-faults" role="alert">
          <span className="text-[11px] font-medium">Symbol</span>
          <span className="cad-readout text-foreground">{symbolFaults.length} fault{symbolFaults.length === 1 ? '' : 's'}</span>
          <span className="min-w-0 flex-1 truncate">
            {symbolFaults[0].reference}: {symbolFaults[0].reason}
            {symbolFaults.length > 1 ? ` (+${symbolFaults.length - 1} more)` : ''}
          </span>
        </div>
      )}

      <SchematicSymbolEditor componentId={symbolEditorId} onClose={() => setSymbolEditorId(null)} />

      {/* Sheet status strip: the cursor and zoom belong to the sheet. Part and
          selection counts are in the app status bar, so they are not repeated. */}
      <div className="cad-hud">
        <span className="flex items-center gap-3">
          <span>
            X <span className="cad-readout text-foreground">{cursorWorld ? fmtCoord(cursorWorld.x) : '—'}</span>
          </span>
          <span>
            Y <span className="cad-readout text-foreground">{cursorWorld ? fmtCoord(cursorWorld.y) : '—'}</span>
          </span>
          <span>
            Zoom <span className="cad-readout text-foreground">{Math.round(viewport.zoom * 100)}%</span>
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