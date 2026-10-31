import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import type { Component } from '../../lib/supabase'
import { useAppStore } from '../../stores/useAppStore'
import { useProjectStore } from '../../stores/useProjectStore'
import { useSketchStore, type SketchStroke } from '../../stores/useSketchStore'
import { useShortcutStore } from '../../stores/useShortcutStore'
import { describeShortcut, isEditableTarget, matchesShortcut } from '../../lib/keymap/shortcuts'
import { recognizeSketch } from '../../lib/sketch/recognize'
import { commitSketch } from '../../lib/sketch/commit'
import { fitStrokesToBox, traceImageToStrokes } from '../../lib/sketch/imageTrace'
import type { Point } from '../../lib/sketch/geometry'

interface SketchLayerProps {
  library: Component[]
}

interface Status {
  tone: 'ok' | 'warn' | 'error'
  text: string
}

interface DraftStroke {
  points: Point[]
  pressure: number[]
  pointerType: SketchStroke['pointerType']
}

const clampZoom = (zoom: number) => Math.min(8, Math.max(0.1, zoom))

const pointerKind = (pointerType: string): SketchStroke['pointerType'] =>
  pointerType === 'pen' || pointerType === 'touch' ? pointerType : 'mouse'

const pressureOf = (event: ReactPointerEvent): number => {
  const pressure = Number.isFinite(event.pressure) ? event.pressure : 0
  // A mouse reports 0 or 0.5 depending on the platform; treat it as a normal pen.
  return pressure > 0 ? Math.min(1, pressure) : 0.5
}

const imageFromFile = (file: File): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('That file could not be read as an image.'))
    }
    image.src = url
  })

/**
 * Freehand/stylus drawing over the sheet. Ink is captured in sheet
 * coordinates, recognised with the offline template matcher, previewed in
 * place, and committed as ordinary parts and wires so everything downstream
 * (ERC, netlist, simulation, PCB) sees a normal schematic.
 */
export default function SketchLayer({ library }: SketchLayerProps) {
  const { viewport, setZoom, setPan } = useAppStore()
  const strokes = useSketchStore((state) => state.strokes)
  const addStroke = useSketchStore((state) => state.addStroke)
  const undoStroke = useSketchStore((state) => state.undoStroke)
  const clearInk = useSketchStore((state) => state.clear)

  const surfaceRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const draftRef = useRef<DraftStroke | null>(null)
  const drawingRef = useRef<{ pointerId: number } | null>(null)
  const penSeenAt = useRef(Number.NEGATIVE_INFINITY)
  const [draft, setDraft] = useState<DraftStroke | null>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const [importing, setImporting] = useState(false)

  const recognition = useMemo(
    () => recognizeSketch(strokes.map((stroke) => ({ points: stroke.points }))),
    [strokes],
  )

  const toWorld = (clientX: number, clientY: number): Point => {
    const rect = surfaceRef.current?.getBoundingClientRect()
    const { viewport: current } = useAppStore.getState()
    return {
      x: (clientX - (rect?.left ?? 0) - current.pan.x) / current.zoom,
      y: (clientY - (rect?.top ?? 0) - current.pan.y) / current.zoom,
    }
  }

  const toScreen = (point: Point) => ({
    x: point.x * viewport.zoom + viewport.pan.x,
    y: point.y * viewport.zoom + viewport.pan.y,
  })

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const kind = pointerKind(event.pointerType)
    const now = performance.now()
    if (kind === 'pen') penSeenAt.current = now
    // A palm resting on the glass must not draw while the stylus is in use.
    if (kind === 'touch' && now - penSeenAt.current < 1500) return

    try {
      surfaceRef.current?.setPointerCapture?.(event.pointerId)
    } catch {
      // A synthetic pointer may not be capturable; the surface still tracks it.
    }
    drawingRef.current = { pointerId: event.pointerId }
    const next: DraftStroke = {
      points: [toWorld(event.clientX, event.clientY)],
      pressure: [pressureOf(event)],
      pointerType: kind,
    }
    draftRef.current = next
    setDraft(next)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drawing = drawingRef.current
    const active = draftRef.current
    if (!drawing || drawing.pointerId !== event.pointerId || !active) return
    const world = toWorld(event.clientX, event.clientY)
    const last = active.points[active.points.length - 1]
    const { zoom } = useAppStore.getState().viewport
    // One sample per ~1.5 screen pixels: dense enough for shape, small enough
    // that a long stroke does not pile up thousands of points.
    if (Math.hypot(world.x - last.x, world.y - last.y) < 1.5 / zoom) return
    active.points.push(world)
    active.pressure.push(pressureOf(event))
    // New object identity, same arrays: re-render reads the appended points
    // without copying the whole stroke on every move.
    setDraft({ ...active })
  }

  const finishStroke = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drawing = drawingRef.current
    if (!drawing || drawing.pointerId !== event.pointerId) return
    drawingRef.current = null
    try {
      surfaceRef.current?.releasePointerCapture?.(event.pointerId)
    } catch {
      // The capture may already be gone if the pointer left the window.
    }
    const finished = draftRef.current
    draftRef.current = null
    setDraft(null)
    if (!finished) return
    if (finished.points.length < 2) {
      setStatus({ tone: 'warn', text: 'A single tap is not a line — draw or drag to make a stroke.' })
      return
    }
    addStroke(finished)
    setStatus(null)
  }

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    const rect = surfaceRef.current?.getBoundingClientRect()
    const pointer = { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }
    const { viewport: current } = useAppStore.getState()
    const nextZoom = clampZoom(current.zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12))
    const world = {
      x: (pointer.x - current.pan.x) / current.zoom,
      y: (pointer.y - current.pan.y) / current.zoom,
    }
    setZoom(nextZoom)
    setPan({ x: pointer.x - world.x * nextZoom, y: pointer.y - world.y * nextZoom })
  }

  const commit = useCallback(() => {
    const project = useProjectStore.getState()
    const result = commitSketch(recognition, {
      library,
      existingComponents: project.components,
      existingWires: project.wires,
      gridSize: useAppStore.getState().settings.gridSize,
    })
    if (result.components.length === 0 && result.wires.length === 0) {
      setStatus({
        tone: 'warn',
        text: result.warnings[0] ?? 'Nothing in the ink could be read as a part or a wire.',
      })
      return
    }
    project.replaceDesign({
      components: [...project.components, ...result.components],
      wires: [...project.wires, ...result.wires],
    })
    const parts = result.components.length
    const wires = result.wires.length
    const summary = `${parts} part${parts === 1 ? '' : 's'} and ${wires} wire${wires === 1 ? '' : 's'} placed.`
    setStatus(
      result.warnings.length > 0
        ? { tone: 'warn', text: `${summary} ${result.warnings.join(' ')}` }
        : { tone: 'ok', text: summary },
    )
    clearInk()
  }, [recognition, library, clearInk])

  const shortcutOverrides = useShortcutStore((state) => state.overrides)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return
      if (matchesShortcut(event, 'schematic.sketchCommit', shortcutOverrides)) {
        event.preventDefault()
        commit()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [commit, shortcutOverrides])

  const importImage = async (file: File) => {
    setImporting(true)
    setStatus(null)
    try {
      const image = await imageFromFile(file)
      const canvas = document.createElement('canvas')
      const scale = Math.min(1, 1400 / Math.max(image.naturalWidth, image.naturalHeight, 1))
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) throw new Error('This browser cannot rasterise images for tracing.')
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
      const traced = traceImageToStrokes({ width: pixels.width, height: pixels.height, data: pixels.data })
      if (traced.strokes.length === 0) {
        setStatus({
          tone: 'error',
          text:
            traced.inkRatio === 0
              ? 'No dark ink was found. Trace needs dark line art on a light background.'
              : traced.inkRatio > 0.65
                ? 'That page is mostly ink. Crop to the drawing and try again.'
                : 'Ink was found, but it has no line structure to follow.',
        })
        return
      }
      const rect = surfaceRef.current?.getBoundingClientRect()
      const { viewport: current } = useAppStore.getState()
      const center = {
        x: ((rect?.width ?? 800) / 2 - current.pan.x) / current.zoom,
        y: ((rect?.height ?? 600) / 2 - current.pan.y) / current.zoom,
      }
      const span = (Math.min(rect?.width ?? 800, rect?.height ?? 600) / current.zoom) * 0.7
      const placed = fitStrokesToBox(traced.strokes, traced, { center, span })
      for (const points of placed) {
        addStroke({ points, pressure: points.map(() => 0.4), pointerType: 'mouse' })
      }
      setStatus({
        tone: 'ok',
        text: `Traced ${placed.length} line${placed.length === 1 ? '' : 's'}. Check the preview, then place it.`,
      })
    } catch (error) {
      setStatus({ tone: 'error', text: error instanceof Error ? error.message : 'The image could not be traced.' })
    } finally {
      setImporting(false)
    }
  }

  const parts = recognition.symbols.length
  const wires = recognition.wires.length
  const junctions = recognition.junctions.length
  const rejected = recognition.rejected.length
  const canCommit = parts + wires > 0

  return (
    <div className="absolute inset-0 z-[15]" data-testid="sketch-layer">
      <div
        ref={surfaceRef}
        className="absolute inset-0 cursor-crosshair touch-none"
        style={{ touchAction: 'none' }}
        data-testid="sketch-surface"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishStroke}
        onPointerCancel={finishStroke}
        onWheel={handleWheel}
      >
        <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
          {strokes.map((stroke) => {
            const points = stroke.points.map(toScreen)
            const width = 1.4 + (stroke.pressure.reduce((sum, value) => sum + value, 0) / Math.max(1, stroke.pressure.length)) * 1.8
            return (
              <polyline
                key={stroke.id}
                points={points.map((point) => `${point.x},${point.y}`).join(' ')}
                fill="none"
                style={{ stroke: 'var(--primary)' }}
                strokeOpacity={0.9}
                strokeWidth={width}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )
          })}
          {draft && draft.points.length > 1 && (
            <polyline
              points={draft.points.map(toScreen).map((point) => `${point.x},${point.y}`).join(' ')}
              fill="none"
              style={{ stroke: 'var(--primary)' }}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          {recognition.symbols.map((symbol) => {
            const topLeft = toScreen({ x: symbol.bounds.x, y: symbol.bounds.y })
            const width = symbol.bounds.width * viewport.zoom
            const height = symbol.bounds.height * viewport.zoom
            return (
              <g key={`${symbol.templateId}-${symbol.strokeIndexes.join('-')}`}>
                <rect
                  x={topLeft.x - 6}
                  y={topLeft.y - 6}
                  width={width + 12}
                  height={height + 12}
                  rx={4}
                  fill="none"
                  style={{ stroke: 'var(--ring)' }}
                  strokeDasharray="4 3"
                  strokeWidth={1}
                />
                <text
                  x={topLeft.x - 6}
                  y={topLeft.y - 11}
                  style={{ fill: 'var(--foreground)' }}
                  fontSize={10}
                  fontFamily="ui-monospace, monospace"
                >
                  {symbol.label} {Math.round(symbol.confidence * 100)}%
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      <aside
        className="absolute right-3 top-3 z-20 w-[292px] rounded-md border border-border bg-card/95 p-3 text-xs shadow-lg backdrop-blur"
        aria-label="Sketch to schematic"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-baseline justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground">Sketch to schematic</h2>
          <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
            {strokes.length} stroke{strokes.length === 1 ? '' : 's'}
          </span>
        </div>

        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
          Draw with a stylus, finger or mouse. Each stroke is matched offline against the library symbols below;
          anything not recognised is reported, never guessed. Parts land at library size — the sketch sets position
          and rotation, not scale.
        </p>

        <div className="mt-2 flex flex-wrap gap-1.5 font-mono text-[10px]">
          <span className="rounded-sm bg-muted px-1.5 py-0.5">parts {parts}</span>
          <span className="rounded-sm bg-muted px-1.5 py-0.5">wires {wires}</span>
          <span className="rounded-sm bg-muted px-1.5 py-0.5">junctions {junctions}</span>
          {rejected > 0 && (
            <span className="rounded-sm bg-destructive/10 px-1.5 py-0.5 text-destructive">rejected {rejected}</span>
          )}
        </div>

        {recognition.symbols.length > 0 && (
          <ul className="mt-2 space-y-0.5">
            {recognition.symbols.map((symbol, index) => (
              <li key={`${symbol.templateId}-${index}`} className="flex items-baseline justify-between gap-2">
                <span className="truncate text-foreground">
                  {symbol.label}
                  {symbol.alternatives[0] ? (
                    <span className="ml-1 text-[9px] text-muted-foreground">or {symbol.alternatives[0].label}</span>
                  ) : null}
                </span>
                <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                  {Math.round(symbol.confidence * 100)}%
                </span>
              </li>
            ))}
          </ul>
        )}

        {status && (
          <p
            role="status"
            aria-live="polite"
            className={`mt-2 rounded-sm px-2 py-1.5 text-[10px] leading-relaxed ${
              status.tone === 'ok'
                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : status.tone === 'warn'
                  ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                  : 'bg-destructive/10 text-destructive'
            }`}
          >
            {status.text}
          </p>
        )}

        <div className="mt-2.5 grid grid-cols-2 gap-1.5">
          <button
            type="button"
            aria-label="Place on sheet"
            className="flex items-center justify-center gap-1 rounded-sm bg-primary px-2 py-1.5 text-[10px] font-semibold text-primary-foreground disabled:opacity-40"
            disabled={!canCommit}
            onClick={commit}
          >
            Place on sheet
            <kbd aria-hidden="true" className="font-mono text-[9px] font-normal opacity-80">
              {describeShortcut('schematic.sketchCommit', shortcutOverrides)}
            </kbd>
          </button>
          <button
            type="button"
            className="rounded-sm border border-border px-2 py-1.5 text-[10px] font-medium text-foreground disabled:opacity-40"
            disabled={strokes.length === 0}
            onClick={undoStroke}
          >
            Undo stroke
          </button>
          <button
            type="button"
            className="rounded-sm border border-border px-2 py-1.5 text-[10px] font-medium text-foreground disabled:opacity-40"
            disabled={strokes.length === 0}
            onClick={clearInk}
          >
            Clear ink
          </button>
          <button
            type="button"
            className="rounded-sm border border-border px-2 py-1.5 text-[10px] font-medium text-foreground disabled:opacity-40"
            disabled={importing}
            onClick={() => fileRef.current?.click()}
          >
            {importing ? 'Tracing…' : 'Import image…'}
          </button>
        </div>

        <p className="mt-2 text-[9px] leading-relaxed text-muted-foreground">
          Image trace reads clean dark line art on a light page and does not correct perspective or shading.
          While the pen is down, palm touches are ignored.
        </p>

        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif,image/bmp"
          className="sr-only"
          aria-label="Import a drawing or schematic image"
          data-testid="sketch-import-input"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void importImage(file)
          }}
        />

        {(parts > 0 || wires > 0) && (
          <p className="mt-2 border-t border-border pt-1.5 text-[9px] text-muted-foreground">
            Recognises resistor, capacitor, inductor, diode, ground, source and junction ink.
          </p>
        )}
      </aside>
    </div>
  )
}
