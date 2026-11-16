/**
 * SplitViewportEngine
 *
 * Provides a futuristic multi-domain viewport engine allowing side-by-side
 * cross-domain engineering (Schematic + PCB, PCB + 3D Photorealistic, etc.)
 * with live cross-probing and floating 3D Picture-in-Picture.
 */
import React, { useState, useRef, useCallback, useEffect, type ReactNode } from 'react'
import { Box, Maximize2, X } from 'lucide-react'
import { useAppStore, type WorkspaceMode } from '../../stores/useAppStore'

interface SplitViewportEngineProps {
  primaryWorkspace: WorkspaceMode
  primaryNode: ReactNode
  secondaryNode?: ReactNode
}

export default function SplitViewportEngine({
  primaryWorkspace,
  primaryNode,
  secondaryNode,
}: SplitViewportEngineProps) {
  const splitMode = useAppStore((state) => state.splitMode)
  const setSplitMode = useAppStore((state) => state.setSplitMode)
  const secondaryWorkspace = useAppStore((state) => state.secondaryWorkspace)
  const splitRatio = useAppStore((state) => state.splitRatio)
  const setSplitRatio = useAppStore((state) => state.setSplitRatio)

  const [isDragging, setIsDragging] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const listenersRef = useRef<{ move: (event: PointerEvent) => void; up: () => void } | null>(null)

  // Release the window-level drag listeners on unmount or split close —
  // otherwise they leak and keep driving splitRatio on a dead tree.
  useEffect(() => () => {
    const listeners = listenersRef.current
    if (listeners) {
      window.removeEventListener('pointermove', listeners.move)
      window.removeEventListener('pointerup', listeners.up)
      listenersRef.current = null
    }
    setIsDragging(false)
  }, [])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    setIsDragging(true)

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      if (rect.width <= 0) return
      const newRatio = (moveEvent.clientX - rect.left) / rect.width
      setSplitRatio(newRatio)
    }

    const onPointerUp = () => {
      setIsDragging(false)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      listenersRef.current = null
    }

    listenersRef.current = { move: onPointerMove, up: onPointerUp }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }, [setSplitRatio])

  const handleSeparatorKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    // Arrow keys move the divider; Shift+arrows move faster; Home/End dock it.
    const step = event.shiftKey ? 0.1 : 0.02
    let next: number | null = null
    if (event.key === 'ArrowLeft') next = splitRatio - step
    else if (event.key === 'ArrowRight') next = splitRatio + step
    else if (event.key === 'Home') next = 0.2
    else if (event.key === 'End') next = 0.8
    if (next === null) return
    event.preventDefault()
    setSplitRatio(next)
  }, [setSplitRatio, splitRatio])

  if (splitMode === 'single' || !secondaryNode) {
    return <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{primaryNode}</div>
  }

  if (splitMode === 'pip-3d') {
    return (
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {primaryNode}

        {/* Floating Picture-in-Picture 3D Preview */}
        <aside
          className="chamfer-tile fixed bottom-20 right-6 z-30 flex h-72 w-80 flex-col overflow-hidden"
          role="region"
          aria-label="Floating 3D board viewport"
        >
          <div className="flex items-center justify-between border-b border-border/60 bg-muted/60 px-3 py-1.5 text-xs">
            <span className="flex items-center gap-1.5 font-semibold text-foreground">
              <Box className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
              Live 3D Viewport
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setSplitMode('split-h', secondaryWorkspace)}
                aria-label="Maximize split viewport"
                title="Expand to Side-by-Side Split"
                className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Maximize2 className="h-3 w-3" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setSplitMode('single')}
                aria-label="Close 3D viewport"
                title="Close floating 3D window"
                className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
          <div className="relative flex-1 overflow-hidden">{secondaryNode}</div>
        </aside>
      </div>
    )
  }

  // Split-H Dual Canvas layout
  const leftPct = Math.round(splitRatio * 100)
  const rightPct = 100 - leftPct

  return (
    <div
      ref={containerRef}
      className={`relative flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden ${
        isDragging ? 'select-none' : ''
      }`}
    >
      {/* Left / Primary Viewport */}
      <div
        style={{ width: `${leftPct}%` }}
        className="relative flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-border/60"
      >
        <div className="absolute left-3 top-3 z-20">
          <div className="chamfer-badge px-2.5 py-1">
            <span className="instrument-label" style={{ color: 'hsl(var(--primary) / 0.9)' }}>VP1 · {primaryWorkspace}</span>
          </div>
        </div>
        {primaryNode}
      </div>

      {/* Draggable Divider — fully keyboard operable (arrows, Shift for
          larger steps, Home/End to dock), not pointer-only. */}
      <div
        onPointerDown={handlePointerDown}
        onKeyDown={handleSeparatorKeyDown}
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-valuenow={Math.round(splitRatio * 100)}
        aria-valuemin={20}
        aria-valuemax={80}
        aria-label="Split viewport resize handle"
        title="Drag or use arrow keys to resize split viewports"
        className="cad-split-divider cad-split-divider-focusable"
      />

      {/* Right / Secondary Viewport */}
      <div
        style={{ width: `${rightPct}%` }}
        className="relative flex min-h-0 min-w-0 flex-col overflow-hidden"
      >
        <div className="absolute right-3 top-3 z-20 flex items-center justify-between gap-2">
          <div className="chamfer-badge px-2.5 py-1">
            <span className="instrument-label">VP2 · {secondaryWorkspace}</span>
          </div>

          <button
            type="button"
            onClick={() => setSplitMode('single')}
            aria-label="Close split view"
            title="Return to single full viewport"
            className="flex h-6 w-6 items-center justify-center rounded-full border border-border/60 bg-card/80 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
        {secondaryNode}
      </div>
    </div>
  )
}
