/**
 * SplitViewportEngine
 *
 * Provides a futuristic multi-domain viewport engine allowing side-by-side
 * cross-domain engineering (Schematic + PCB, PCB + 3D Photorealistic, etc.)
 * with live cross-probing and floating 3D Picture-in-Picture.
 */
import React, { useState, useRef, useCallback, type ReactNode } from 'react'
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
  const { splitMode, setSplitMode, secondaryWorkspace, splitRatio, setSplitRatio } = useAppStore()

  const [isDragging, setIsDragging] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    setIsDragging(true)

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const newRatio = (moveEvent.clientX - rect.left) / rect.width
      setSplitRatio(newRatio)
    }

    const onPointerUp = () => {
      setIsDragging(false)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }, [setSplitRatio])

  if (splitMode === 'single' || !secondaryNode) {
    return <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{primaryNode}</div>
  }

  if (splitMode === 'pip-3d') {
    return (
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {primaryNode}

        {/* Floating Picture-in-Picture 3D Preview */}
        <aside
          className="cad-glass-panel fixed bottom-20 right-6 z-30 flex h-72 w-80 flex-col overflow-hidden rounded-2xl border border-border/80 shadow-2xl backdrop-blur-2xl"
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
        <div className="absolute left-3 top-3 z-20 flex items-center gap-1.5 rounded-full border border-border/60 bg-card/80 px-2.5 py-0.5 text-[10px] font-semibold text-foreground backdrop-blur-md">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
          <span>Viewport 1 • {primaryWorkspace}</span>
        </div>
        {primaryNode}
      </div>

      {/* Draggable Divider */}
      <div
        onPointerDown={handlePointerDown}
        role="separator"
        aria-orientation="vertical"
        aria-label="Split viewport resize handle"
        title="Drag to resize split viewports"
        className="cad-split-divider"
      />

      {/* Right / Secondary Viewport */}
      <div
        style={{ width: `${rightPct}%` }}
        className="relative flex min-h-0 min-w-0 flex-col overflow-hidden"
      >
        <div className="absolute right-3 top-3 z-20 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 rounded-full border border-border/60 bg-card/80 px-2.5 py-0.5 text-[10px] font-semibold text-foreground backdrop-blur-md">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
            <span>Viewport 2 • {secondaryWorkspace}</span>
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
