/**
 * The lattice sheet: the truss drawn the way a structural drafter draws it.
 *
 * Bars carry the sign of their axial force as colour, joints are circles, a
 * bearing is a triangle and a load is an arrow with its magnitude written
 * beside it. The deflected shape is laid over the undeformed one rather than
 * replacing it, because the whole point of the overlay is to see how far the
 * frame moved from the geometry that was drawn.
 *
 * Editing lives here as pointer gestures (drag a joint, click to pick, click
 * empty sheet to place), but every gesture has a numeric twin in the inspector:
 * this component reports what was asked for, in metres, and the panel owns the
 * model.
 */
import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import { useTheme } from '../../lib/theme/useTheme'
import { chartColor } from '../../lib/theme/tokens'
import type { TrussModel, TrussNode, TrussResult } from '../../lib/structures/truss'
import { describeMemberForce } from '../../lib/structures/truss'
import {
  deflectedNode,
  fitTrussView,
  forceToken,
  gridPitch,
  loadArrow,
  projectTruss,
  snapToGrid,
  unprojectTruss,
  type TrussPoint,
} from '../../lib/structures/trussDrawing'

/** What a click on the sheet means: pick, place a joint, or start/finish a bar. */
export type TrussTool = 'select' | 'joint' | 'bar'

export interface TrussSheetProps {
  model: TrussModel
  /** Null while the model is a mechanism or malformed: the sheet draws geometry only. */
  result: TrussResult | null
  /** Multiply the auto exaggeration so a shallow sag can be read at all. */
  deflectionScale: number
  showDeflected: boolean
  showForceLabels: boolean
  tool: TrussTool
  /** First joint of a bar being drawn, when the bar tool is mid-gesture. */
  barStart: string | null
  selectedNodeId: string | null
  selectedMemberId: string | null
  onNodeClick: (id: string) => void
  onMemberClick: (id: string) => void
  /** A click on empty sheet, in snapped model metres. */
  onSheetClick: (point: { x: number; y: number }) => void
  /** A joint dragged to a new snapped position, in model metres. */
  onNodeMove: (id: string, point: { x: number; y: number }) => void
}

/** jsdom reports no layout, so the drawing falls back to a known viewport. */
const FALLBACK = { width: 900, height: 520 }

function extent(nodes: readonly TrussNode[]): { minX: number; maxX: number; minY: number; maxY: number } {
  if (nodes.length === 0) return { minX: 0, maxX: 1, minY: 0, maxY: 1 }
  const xs = nodes.map((node) => node.x)
  const ys = nodes.map((node) => node.y)
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
}

export default function TrussSheet({
  model,
  result,
  deflectionScale,
  showDeflected,
  showForceLabels,
  tool,
  barStart,
  selectedNodeId,
  selectedMemberId,
  onNodeClick,
  onMemberClick,
  onSheetClick,
  onNodeMove,
}: TrussSheetProps) {
  const { theme } = useTheme()
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<string | null>(null)
  const [size, setSize] = useState(FALLBACK)

  useEffect(() => {
    const node = wrapRef.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      // A zero-size box is a hidden panel, not a viewport: drawing into it would
      // collapse every projection to the same pixel.
      if (!box || box.width < 80 || box.height < 80) return
      setSize({ width: Math.round(box.width), height: Math.round(box.height) })
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const view = useMemo(() => fitTrussView(model.nodes, size.width, size.height), [model.nodes, size])
  const box = useMemo(() => extent(model.nodes), [model.nodes])
  const nodeById = useMemo(
    () => new Map(model.nodes.map((node) => [node.id, node])),
    [model.nodes],
  )

  /** Literal `hsl(...)` values: `var()` is not resolved inside SVG presentation attributes. */
  const ink = useMemo(() => ({
    grid: chartColor(theme, '--grid'),
    gridMajor: chartColor(theme, '--grid-major'),
    tension: chartColor(theme, '--force-tension'),
    compression: chartColor(theme, '--force-compression'),
    neutral: chartColor(theme, '--force-neutral'),
    muted: chartColor(theme, '--muted-foreground'),
    foreground: chartColor(theme, '--foreground'),
    primary: chartColor(theme, '--primary'),
    selection: chartColor(theme, '--selection'),
    warning: chartColor(theme, '--canvas-warning'),
    card: chartColor(theme, '--card'),
  }), [theme])

  const forceInk = (force: number): string => {
    const token = forceToken(force)
    if (token === '--force-tension') return ink.tension
    if (token === '--force-compression') return ink.compression
    return ink.neutral
  }

  const pitch = gridPitch(Math.max(box.maxX - box.minX, box.maxY - box.minY))
  const gridLines: Array<{ key: string; x1: number; y1: number; x2: number; y2: number; major: boolean }> = []
  for (let gx = Math.ceil(box.minX / pitch) * pitch; gx <= box.maxX + 1e-9; gx += pitch) {
    const px = projectTruss({ x: gx, y: 0 }, view).x
    gridLines.push({
      key: `x${gx.toFixed(3)}`,
      x1: px, y1: 0, x2: px, y2: size.height,
      major: Math.abs(gx - Math.round(gx)) < 1e-9,
    })
  }
  for (let gy = Math.ceil(box.minY / pitch) * pitch; gy <= box.maxY + 1e-9; gy += pitch) {
    const py = projectTruss({ x: 0, y: gy }, view).y
    gridLines.push({
      key: `y${gy.toFixed(3)}`,
      x1: 0, y1: py, x2: size.width, y2: py,
      major: Math.abs(gy - Math.round(gy)) < 1e-9,
    })
  }

  const localPoint = (event: { clientX: number; clientY: number }): TrussPoint => {
    const rect = svgRef.current?.getBoundingClientRect()
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }
  }

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const id = dragRef.current
    if (!id) return
    const moved = unprojectTruss(localPoint(event), view)
    onNodeMove(id, { x: snapToGrid(moved.x, pitch), y: snapToGrid(moved.y, pitch) })
  }

  const startDrag = (event: PointerEvent<SVGCircleElement>, id: string) => {
    if (tool !== 'select') return
    dragRef.current = id
    // Capture on the root so the joint keeps following the pointer even when it
    // leaves the circle it was pressed on.
    svgRef.current?.setPointerCapture?.(event.pointerId)
  }

  const endDrag = () => {
    dragRef.current = null
  }

  const handleSheetClick = (event: MouseEvent<SVGSVGElement>) => {
    if (event.target !== event.currentTarget) return
    const point = unprojectTruss(localPoint(event), view)
    onSheetClick({ x: snapToGrid(point.x, pitch), y: snapToGrid(point.y, pitch) })
  }

  const deflectedOf = (node: TrussNode): TrussNode =>
    deflectedNode(node, result?.displacements[node.id], deflectionScale)

  return (
    <div ref={wrapRef} className="relative h-full min-h-0 w-full overflow-hidden bg-canvas">
      <svg
        ref={svgRef}
        data-testid="truss-sheet"
        className="block h-full w-full touch-none select-none"
        width={size.width}
        height={size.height}
        viewBox={`0 0 ${size.width} ${size.height}`}
        role="application"
        aria-label={`Truss sheet, ${tool} tool. ${model.nodes.length} joints, ${model.members.length} bars.`}
        onClick={handleSheetClick}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        style={{ cursor: tool === 'select' ? 'default' : 'crosshair' }}
      >
        <g aria-hidden="true" pointerEvents="none">
          {gridLines.map((line) => (
            <line
              key={line.key}
              x1={line.x1}
              y1={line.y1}
              x2={line.x2}
              y2={line.y2}
              stroke={line.major ? ink.gridMajor : ink.grid}
              strokeWidth={1}
              opacity={line.major ? 0.7 : 0.45}
            />
          ))}
        </g>

        {/* Deflected shape behind the bars: the drawn geometry stays the reference. */}
        {showDeflected && result && (
          <g aria-hidden="true" pointerEvents="none">
            {model.members.map((member) => {
              const a = nodeById.get(member.from)
              const b = nodeById.get(member.to)
              if (!a || !b) return null
              const pa = projectTruss(deflectedOf(a), view)
              const pb = projectTruss(deflectedOf(b), view)
              return (
                <line
                  key={`deflected-${member.id}`}
                  x1={pa.x}
                  y1={pa.y}
                  x2={pb.x}
                  y2={pb.y}
                  stroke={ink.primary}
                  strokeWidth={1.5}
                  strokeDasharray="5 4"
                  opacity={0.85}
                />
              )
            })}
          </g>
        )}

        {model.members.map((member) => {
          const a = nodeById.get(member.from)
          const b = nodeById.get(member.to)
          if (!a || !b) return null
          const pa = projectTruss(a, view)
          const pb = projectTruss(b, view)
          const demand = result?.members[member.id]
          const stroke = demand ? forceInk(demand.force) : ink.muted
          const selected = member.id === selectedMemberId
          const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 }
          return (
            <g key={member.id} data-member-id={member.id}>
              {/* A fat invisible stroke makes a thin bar easy to hit with the pointer. */}
              <line
                x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
                stroke="transparent"
                strokeWidth={14}
                onClick={(event) => {
                  event.stopPropagation()
                  onMemberClick(member.id)
                }}
                style={{ cursor: 'pointer' }}
              />
              <line
                x1={pa.x}
                y1={pa.y}
                x2={pb.x}
                y2={pb.y}
                stroke={stroke}
                strokeWidth={selected ? 5 : 3}
                strokeLinecap="round"
                opacity={selected ? 1 : 0.95}
                pointerEvents="none"
              >
                <title>
                  {`${member.id} · ${a.id} → ${b.id} · ${demand ? describeMemberForce(demand) : 'not solved'}`}
                </title>
              </line>
              {selected && (
                <circle cx={mid.x} cy={mid.y} r={3} fill={ink.selection} pointerEvents="none" />
              )}
              {showForceLabels && demand && (
                <text
                  x={mid.x}
                  y={mid.y - 6}
                  textAnchor="middle"
                  fontSize={10}
                  fill={stroke}
                  pointerEvents="none"
                >
                  {`${(demand.force / 1e3).toFixed(1)} kN`}
                </text>
              )}
            </g>
          )
        })}

        {model.supports.map((support) => {
          const node = nodeById.get(support.node)
          if (!node) return null
          const point = projectTruss(
            showDeflected && result ? deflectedOf(node) : node,
            view,
          )
          const single = support.holdsX !== support.holdsY
          // A horizontal-only restraint gets the same glyph turned on its side.
          const rotate = support.holdsX && !support.holdsY ? -90 : 0
          return (
            <g
              key={`support-${support.node}`}
              transform={`translate(${point.x} ${point.y}) rotate(${rotate})`}
              data-support-node={support.node}
              pointerEvents="none"
            >
              <polygon
                points="0,0 -11,18 11,18"
                fill={ink.card}
                stroke={ink.foreground}
                strokeWidth={1.5}
              />
              {single ? (
                <>
                  <circle cx={-5} cy={22} r={3} fill={ink.card} stroke={ink.foreground} strokeWidth={1.2} />
                  <circle cx={5} cy={22} r={3} fill={ink.card} stroke={ink.foreground} strokeWidth={1.2} />
                  <line x1={-13} y1={26} x2={13} y2={26} stroke={ink.foreground} strokeWidth={1.2} />
                </>
              ) : (
                <>
                  <line x1={-13} y1={18} x2={13} y2={18} stroke={ink.foreground} strokeWidth={1.5} />
                  {[-9, -3, 3, 9].map((hatch) => (
                    <line
                      key={hatch}
                      x1={hatch}
                      y1={18}
                      x2={hatch - 5}
                      y2={25}
                      stroke={ink.muted}
                      strokeWidth={1.1}
                    />
                  ))}
                </>
              )}
              <title>
                {`${support.node}: ${
                  support.holdsX && support.holdsY
                    ? 'held in both axes'
                    : support.holdsX
                      ? 'held horizontally only'
                      : 'held vertically only'
                }`}
              </title>
            </g>
          )
        })}

        {model.loads.map((load) => {
          const node = nodeById.get(load.node)
          if (!node) return null
          const arrow = loadArrow(
            showDeflected && result ? deflectedOf(node) : node,
            load.fx,
            load.fy,
            view,
          )
          if (!arrow) return null
          const dx = arrow.to.x - arrow.from.x
          const dy = arrow.to.y - arrow.from.y
          const length = Math.hypot(dx, dy) || 1
          const ux = dx / length
          const uy = dy / length
          const head = [
            `${arrow.to.x},${arrow.to.y}`,
            `${arrow.to.x - ux * 9 - uy * 4.5},${arrow.to.y - uy * 9 + ux * 4.5}`,
            `${arrow.to.x - ux * 9 + uy * 4.5},${arrow.to.y - uy * 9 - ux * 4.5}`,
          ].join(' ')
          return (
            <g key={`load-${load.node}`} data-load-node={load.node} pointerEvents="none">
              <line
                x1={arrow.from.x}
                y1={arrow.from.y}
                x2={arrow.to.x}
                y2={arrow.to.y}
                stroke={ink.warning}
                strokeWidth={2}
              />
              <polygon points={head} fill={ink.warning} />
              <text
                x={arrow.to.x + ux * 10}
                y={arrow.to.y + uy * 10 + 3}
                textAnchor="middle"
                fontSize={10}
                fill={ink.warning}
              >
                {`${(Math.hypot(load.fx, load.fy) / 1e3).toFixed(1)} kN`}
              </text>
            </g>
          )
        })}

        {model.nodes.map((node) => {
          const point = projectTruss(node, view)
          const selected = node.id === selectedNodeId
          const isBarStart = node.id === barStart
          const moved = result?.displacements[node.id]
          return (
            <g key={node.id} data-node-id={node.id}>
              {showDeflected && moved && (
                <circle
                  cx={projectTruss(deflectedOf(node), view).x}
                  cy={projectTruss(deflectedOf(node), view).y}
                  r={2.5}
                  fill={ink.primary}
                  pointerEvents="none"
                />
              )}
              <circle
                cx={point.x}
                cy={point.y}
                r={selected || isBarStart ? 8 : 6}
                fill={ink.card}
                stroke={selected ? ink.selection : isBarStart ? ink.primary : ink.foreground}
                strokeWidth={selected || isBarStart ? 3 : 1.6}
                onPointerDown={(event) => {
                  event.stopPropagation()
                  startDrag(event, node.id)
                  onNodeClick(node.id)
                }}
                onClick={(event) => event.stopPropagation()}
                style={{ cursor: 'grab' }}
              >
                <title>{`${node.id} · ${node.x.toFixed(2)} m, ${node.y.toFixed(2)} m`}</title>
              </circle>
              <text
                x={point.x + 9}
                y={point.y - 8}
                fontSize={10}
                fill={ink.muted}
                pointerEvents="none"
              >
                {node.id}
              </text>
            </g>
          )
        })}

        {/* Span dimension along the bottom, in the units the model is drawn in. */}
        <g aria-hidden="true" opacity={0.9} pointerEvents="none">
          <line
            x1={projectTruss({ x: box.minX, y: box.minY }, view).x}
            y1={size.height - 14}
            x2={projectTruss({ x: box.maxX, y: box.minY }, view).x}
            y2={size.height - 14}
            stroke={ink.muted}
            strokeWidth={1}
          />
          {[
            projectTruss({ x: box.minX, y: box.minY }, view).x,
            projectTruss({ x: box.maxX, y: box.minY }, view).x,
          ].map((tick, index) => (
            <line
              key={index}
              x1={tick}
              y1={size.height - 20}
              x2={tick}
              y2={size.height - 8}
              stroke={ink.muted}
              strokeWidth={1}
            />
          ))}
          <text
            x={(projectTruss({ x: box.minX, y: box.minY }, view).x + projectTruss({ x: box.maxX, y: box.minY }, view).x) / 2}
            y={size.height - 22}
            textAnchor="middle"
            fontSize={10}
            fill={ink.muted}
          >
            {`${(box.maxX - box.minX).toFixed(2)} m`}
          </text>
        </g>
      </svg>
    </div>
  )
}
