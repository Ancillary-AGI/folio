/**
 * Structures workspace: a pin-jointed frame drawn, solved and stood up in 3D.
 *
 * The sheet is the editor. Drop a standard truss from the library dock or draw
 * one joint at a time, and the direct-stiffness solver in
 * `../../lib/structures/truss` re-runs on every edit — the bars you see coloured
 * are the bars the solver reported, not a decoration. Nothing here is
 * pre-computed: a model that is a mechanism says so, and says which joint is
 * still free to move.
 *
 * Units are the ones the solver works in (metres, newtons) except where a
 * drafter would never think in them: loads are entered in kN, sections in mm².
 */
import { useCallback, useMemo, useState } from 'react'
import { CircleDot, Construction, Download, Minus, MousePointer2, Trash2, X } from 'lucide-react'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Checkbox } from '../ui/checkbox'
import { Input } from '../ui/input'
import { RangeControl } from '../ui/range-control'
import { useTheme } from '../../lib/theme/useTheme'
import { chartColor } from '../../lib/theme/tokens'
import { usePreference, usePreferenceValue } from '../../lib/settings/usePreference'
import { SHADING_MODES, type ShadingMode } from '../../lib/3d/outline'
import { SHADING_UI } from '../../lib/3d/shadingLabels'
import { useDemoRequest } from '../workspace/useDemoRequest'
import { loadDomainDesign, usePublishDomainDesign } from '../../lib/project/domainDesign'
import { useDomainLibraryZone } from '../../lib/library/useDomainLibraryZone'
import LibraryDropNote from '../library/LibraryDropNote'
import type { LibraryItem } from '../../lib/library/types'
import TrussSheet, { type TrussTool } from './TrussSheet'
import Truss3DView from './Truss3DView'
import {
  TRUSS_MATERIALS,
  deflectionScale as autoDeflectionScale,
  describeMemberForce,
  solveTruss,
  trussSpan,
  type TrussMaterialId,
  type TrussMember,
  type TrussModel,
  type TrussNode,
} from '../../lib/structures/truss'
import { TRUSS_PRESETS, trussDeterminacy, trussPresetById } from '../../lib/structures/trussPresets'
import { buildTrussDrawing } from '../../lib/structures/trussSheet'
import { downloadFile } from '../../lib/exportUtils'
import { describeError } from '../../lib/utils'
import { useProjectStore } from '../../stores/useProjectStore'

interface StructuresPanelProps {
  onClose: () => void
}

interface StructuresDesign {
  model?: unknown
  showDeflected?: boolean
  showForceLabels?: boolean
  exaggeration?: number
}

/** The section a hand-drawn bar gets: 800 mm² of S355, a plausible small angle. */
const DEFAULT_AREA_MM2 = 800
const DEFAULT_MATERIAL: TrussMaterialId = 'steel-s355'

const MATERIAL_IDS = Object.keys(TRUSS_MATERIALS) as TrussMaterialId[]

function cloneModel(model: TrussModel): TrussModel {
  return {
    nodes: model.nodes.map((node) => ({ ...node })),
    members: model.members.map((member) => ({ ...member })),
    supports: model.supports.map((support) => ({ ...support })),
    loads: model.loads.map((load) => ({ ...load })),
  }
}

/**
 * A restored design is user data, not a promise.
 *
 * The registry can hand back anything a previous session wrote, and the solver
 * throws on a member that joins a joint which no longer exists. Dropping the
 * rows that do not close, rather than loading them and showing a red banner, is
 * what makes reopening a half-edited truss safe.
 */
function readModel(value: unknown): TrussModel | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as {
    nodes?: unknown
    members?: unknown
    supports?: unknown
    loads?: unknown
  }
  if (!Array.isArray(raw.nodes) || !Array.isArray(raw.members)) return null

  const nodes: TrussNode[] = []
  for (const entry of raw.nodes as Array<Partial<TrussNode>>) {
    if (typeof entry?.id !== 'string') continue
    if (typeof entry.x !== 'number' || !Number.isFinite(entry.x)) continue
    if (typeof entry.y !== 'number' || !Number.isFinite(entry.y)) continue
    if (nodes.some((node) => node.id === entry.id)) continue
    nodes.push({ id: entry.id, x: entry.x, y: entry.y })
  }
  if (nodes.length < 2) return null
  const ids = new Set(nodes.map((node) => node.id))

  const members: TrussMember[] = []
  for (const entry of raw.members as Array<Partial<TrussMember>>) {
    if (typeof entry?.id !== 'string') continue
    if (typeof entry.from !== 'string' || typeof entry.to !== 'string') continue
    if (!ids.has(entry.from) || !ids.has(entry.to) || entry.from === entry.to) continue
    if (typeof entry.area !== 'number' || !(entry.area > 0)) continue
    const material = entry.material as TrussMaterialId | undefined
    if (!material || !TRUSS_MATERIALS[material]) continue
    if (members.some((member) => member.id === entry.id)) continue
    members.push({ id: entry.id, from: entry.from, to: entry.to, area: entry.area, material })
  }

  const supports = Array.isArray(raw.supports)
    ? (raw.supports as Array<Partial<{ node: string; holdsX: boolean; holdsY: boolean }>>).flatMap((entry) =>
        typeof entry?.node === 'string' && ids.has(entry.node) && (entry.holdsX || entry.holdsY)
          ? [{ node: entry.node, holdsX: Boolean(entry.holdsX), holdsY: Boolean(entry.holdsY) }]
          : [],
      )
    : []

  const loads = Array.isArray(raw.loads)
    ? (raw.loads as Array<Partial<{ node: string; fx: number; fy: number }>>).flatMap((entry) =>
        typeof entry?.node === 'string' &&
        ids.has(entry.node) &&
        typeof entry.fx === 'number' &&
        typeof entry.fy === 'number' &&
        Number.isFinite(entry.fx) &&
        Number.isFinite(entry.fy)
          ? [{ node: entry.node, fx: entry.fx, fy: entry.fy }]
          : [],
      )
    : []

  return { nodes, members, supports, loads }
}

/** `n`-suffixed id that is free in this model, so deletions never collide. */
function nextId(prefix: string, taken: ReadonlySet<string>): string {
  let index = 1
  while (taken.has(`${prefix}-${index}`)) index += 1
  return `${prefix}-${index}`
}

const readNumber = (raw: string, fallback: number): number => {
  const parsed = Number(raw)
  return raw.trim() === '' || !Number.isFinite(parsed) ? fallback : parsed
}

const kilo = (newtons: number): string => (newtons / 1e3).toFixed(2)
const mega = (pascals: number): string => (pascals / 1e6).toFixed(1)

/**
 * A frame's identity: joints, bars, bearings and loads, sorted.
 *
 * The exported sheet is named after a stock truss only while the model still is
 * that truss, so the signature is compared rather than remembering which preset
 * was last loaded — a half-edited king-post must not leave the shop floor
 * labelled as one.
 */
function signature(model: TrussModel): string {
  return [
    ...model.nodes.map((node) => `n${node.id}@${node.x},${node.y}`),
    ...model.members.map((bar) => `b${bar.id}:${bar.from}-${bar.to}@${bar.area},${bar.material}`),
    ...model.supports.map((support) => `s${support.node}:${support.holdsX ? 'x' : ''}${support.holdsY ? 'y' : ''}`),
    ...model.loads.map((load) => `l${load.node}:${load.fx},${load.fy}`),
  ]
    .sort()
    .join('|')
}

const PRESET_SIGNATURES = TRUSS_PRESETS.map((preset) => ({ name: preset.name, signature: signature(preset.model) }))

function Kpi({ label, value, detail, tone = 'default' }: { label: string; value: string; detail?: string; tone?: 'default' | 'warn' }) {
  return (
    <div className={`rounded-md border p-3 ${tone === 'warn' ? 'border-warning/50 bg-warning/5' : 'border-border bg-card'}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="cad-readout mt-1 text-lg font-semibold">{value}</div>
      {detail && <div className="mt-0.5 text-xs text-muted-foreground">{detail}</div>}
    </div>
  )
}

export default function StructuresPanel({ onClose }: StructuresPanelProps) {
  const saved = loadDomainDesign<StructuresDesign>('structures')
  const savedModel = readModel(saved?.model)
  const defaultModel = useMemo(() => cloneModel(TRUSS_PRESETS[0].model), [])

  const [model, setModel] = useState<TrussModel>(savedModel ?? defaultModel)
  const [tool, setTool] = useState<TrussTool>('select')
  const [barStart, setBarStart] = useState<string | null>(null)
  const [selection, setSelection] = useState<{ kind: 'node' | 'member'; id: string } | null>(null)
  const [showDeflected, setShowDeflected] = useState(saved?.showDeflected ?? true)
  const [showForceLabels, setShowForceLabels] = useState(saved?.showForceLabels ?? true)
  const [exaggeration, setExaggeration] = useState(
    saved?.exaggeration && Number.isFinite(saved.exaggeration) ? saved.exaggeration : 1,
  )
  const [shadingMode, setShadingMode] = usePreference('shadingMode')
  const drawingPaper = usePreferenceValue('drawingPaperSize')
  const { theme } = useTheme()

  usePublishDomainDesign<StructuresDesign>(
    'structures',
    { model, showDeflected, showForceLabels, exaggeration },
    (next) => {
      const restored = readModel(next.model)
      if (restored) setModel(restored)
      if (typeof next.showDeflected === 'boolean') setShowDeflected(next.showDeflected)
      if (typeof next.showForceLabels === 'boolean') setShowForceLabels(next.showForceLabels)
      if (typeof next.exaggeration === 'number' && Number.isFinite(next.exaggeration)) setExaggeration(next.exaggeration)
    },
  )

  const loadPreset = useCallback((presetId: string) => {
    const preset = trussPresetById(presetId)
    if (!preset) return false
    setModel(cloneModel(preset.model))
    setSelection(null)
    setBarStart(null)
    return true
  }, [])

  useDemoRequest('structures-warren', () => {
    loadPreset('warren-girder')
  })

  const zone = useDomainLibraryZone({
    accepts: ['truss'],
    as: 'the truss sheet',
    onPlace: (item: LibraryItem) => {
      if (item.kind !== 'truss') return
      loadPreset(item.payload.presetId)
    },
  })

  /*
   * The solver throws for a model that is not a model — a bar of no length, a
   * joint that is named nowhere. That is a statement about the drawing, so it is
   * shown as the error it is instead of being turned into a silent empty table.
   */
  const analysis = useMemo(() => {
    try {
      return solveTruss(model)
    } catch (error) {
      return { result: null, error: error instanceof Error ? error.message : String(error) }
    }
  }, [model])

  const { result, error } = analysis
  const span = useMemo(() => trussSpan(model.nodes), [model.nodes])
  const scale = result ? autoDeflectionScale(result.maxDisplacement, span) * exaggeration : 1
  const determinacy = useMemo(() => trussDeterminacy(model), [model])

  const projectName = useProjectStore((state) => state.currentProject?.name ?? null)
  const [sheetStatus, setSheetStatus] = useState<string | null>(null)
  const sheetTitle = useMemo(
    () => PRESET_SIGNATURES.find((preset) => preset.signature === signature(model))?.name
      ?? projectName
      ?? 'Pin-jointed frame',
    [model, projectName],
  )

  /**
   * The framing sheet: elevation at a preferred scale, bar schedule with the
   * axial force this solver reported, bearings, loads and overall dimensions on
   * an A3 sheet with a title block. A frame that will not solve still exports —
   * stamped NOT ANALYSED, with no force anywhere on it — because the geometry is
   * what the user needs to fix the model.
   */
  const handleExportSheet = () => {
    try {
      const svg = buildTrussDrawing(
        { model, result, status: error },
        { title: sheetTitle, projectName: projectName ?? undefined, paperSize: drawingPaper },
      )
      const filename = `${sheetTitle.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}_framing.svg`
      downloadFile(svg, filename, 'image/svg+xml')
      setSheetStatus(
        result
          ? `${filename} — ${model.members.length} bars scheduled, forces from the current solution.`
          : `${filename} — geometry only: the sheet is stamped NOT ANALYSED because this model did not solve.`,
      )
    } catch (exportError) {
      setSheetStatus(describeError(exportError))
    }
  }

  const memberRows = useMemo(() => {
    if (!result) return []
    return model.members
      .map((member) => ({ member, demand: result.members[member.id] }))
      .filter((row) => row.demand !== undefined)
      .sort((a, b) => Math.abs(b.demand.force) - Math.abs(a.demand.force))
  }, [model.members, result])

  const governing = memberRows[0]
  const worstUtilisation = useMemo(() => {
    if (!result) return null
    let worst = { id: '', utilisation: -1 }
    for (const member of model.members) {
      const demand = result.members[member.id]
      if (!demand) continue
      if (demand.utilisation > worst.utilisation) worst = { id: member.id, utilisation: demand.utilisation }
    }
    return worst.utilisation >= 0 ? worst : null
  }, [model.members, result])

  const nodeById = useMemo(() => new Map(model.nodes.map((node) => [node.id, node])), [model.nodes])
  const selectedNode = selection?.kind === 'node' ? nodeById.get(selection.id) ?? null : null
  const selectedMember = selection?.kind === 'member'
    ? model.members.find((member) => member.id === selection.id) ?? null
    : null

  const patchNode = useCallback((id: string, patch: Partial<TrussNode>) => {
    setModel((prev) => ({ ...prev, nodes: prev.nodes.map((node) => (node.id === id ? { ...node, ...patch } : node)) }))
  }, [])

  const patchMember = useCallback((id: string, patch: Partial<TrussMember>) => {
    setModel((prev) => ({
      ...prev,
      members: prev.members.map((member) => (member.id === id ? { ...member, ...patch } : member)),
    }))
  }, [])

  const addNode = useCallback((x: number, y: number) => {
    setModel((prev) => {
      const id = nextId('joint', new Set(prev.nodes.map((node) => node.id)))
      return { ...prev, nodes: [...prev.nodes, { id, x, y }] }
    })
  }, [])

  const removeNode = useCallback((id: string) => {
    setModel((prev) => ({
      nodes: prev.nodes.filter((node) => node.id !== id),
      members: prev.members.filter((member) => member.from !== id && member.to !== id),
      supports: prev.supports.filter((support) => support.node !== id),
      loads: prev.loads.filter((load) => load.node !== id),
    }))
    setSelection(null)
    setBarStart(null)
  }, [])

  const setSupport = useCallback((nodeId: string, holdsX: boolean, holdsY: boolean) => {
    setModel((prev) => {
      const others = prev.supports.filter((support) => support.node !== nodeId)
      if (!holdsX && !holdsY) return { ...prev, supports: others }
      return { ...prev, supports: [...others, { node: nodeId, holdsX, holdsY }] }
    })
  }, [])

  const setLoad = useCallback((nodeId: string, fx: number, fy: number) => {
    setModel((prev) => {
      const others = prev.loads.filter((load) => load.node !== nodeId)
      if (Math.abs(fx) < 1e-12 && Math.abs(fy) < 1e-12) return { ...prev, loads: others }
      return { ...prev, loads: [...others, { node: nodeId, fx, fy }] }
    })
  }, [])

  const removeLoad = useCallback((nodeId: string) => {
    setModel((prev) => ({ ...prev, loads: prev.loads.filter((load) => load.node !== nodeId) }))
  }, [])

  /** Bars are keyed by their ends, so a second bar between the same joints is refused. */
  const addMember = useCallback((from: string, to: string) => {
    setModel((prev) => {
      if (from === to) return prev
      const exists = prev.members.some(
        (member) => (member.from === from && member.to === to) || (member.from === to && member.to === from),
      )
      if (exists) return prev
      const id = nextId('bar', new Set(prev.members.map((member) => member.id)))
      return {
        ...prev,
        members: [
          ...prev.members,
          { id, from, to, area: DEFAULT_AREA_MM2 * 1e-6, material: DEFAULT_MATERIAL },
        ],
      }
    })
  }, [])

  const handleNodeClick = useCallback((id: string) => {
    if (tool === 'bar') {
      // Two clicks draw a bar; the same joint twice means the gesture was abandoned.
      if (!barStart) setBarStart(id)
      else {
        if (barStart !== id) addMember(barStart, id)
        setBarStart(null)
      }
      return
    }
    setBarStart(null)
    setSelection({ kind: 'node', id })
  }, [addMember, barStart, tool])

  const handleSheetClick = useCallback((point: { x: number; y: number }) => {
    if (tool === 'joint') {
      addNode(point.x, point.y)
      return
    }
    if (tool === 'bar') {
      setBarStart(null)
      return
    }
    setSelection(null)
  }, [addNode, tool])

  const handleMemberClick = useCallback((id: string) => {
    setBarStart(null)
    setSelection({ kind: 'member', id })
  }, [])

  const loadNode = selectedNode ? model.loads.find((load) => load.node === selectedNode.id) : undefined
  const supportNode = selectedNode ? model.supports.find((support) => support.node === selectedNode.id) : undefined
  const barsOnSelectedNode = selectedNode
    ? model.members.filter((member) => member.from === selectedNode.id || member.to === selectedNode.id).length
    : 0

  const legend = useMemo(() => [
    { token: '--force-tension', label: 'Tension' },
    { token: '--force-compression', label: 'Compression' },
    { token: '--force-neutral', label: 'No force' },
  ], [])

  return (
    <div className="h-full overflow-auto bg-background p-4">
      <div className="mx-auto max-w-[1600px] space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Construction className="h-5 w-5 flex-shrink-0 text-primary" aria-hidden="true" />
            <div className="min-w-0">
              <h2 className="text-xl font-semibold">Structures</h2>
              <p className="text-sm text-muted-foreground">
                Pin-jointed frames solved by direct stiffness — joints, bars, bearings and loads, in metres and newtons.
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" aria-label="Close structures workspace" onClick={onClose} title="Leave the structures workspace; closing writes nothing to the design.">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
          <div className="space-y-4">
            <Card className="cad-dropzone" {...zone.zoneProps}>
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-base">Lattice sheet</CardTitle>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex gap-1" role="group" aria-label="Sheet tool">
                      <Button
                        type="button"
                        size="sm"
                        variant={tool === 'select' ? 'default' : 'outline'}
                        onClick={() => {
                          setTool('select')
                          setBarStart(null)
                        }}
                        aria-pressed={tool === 'select'}
                        title="Select and drag joints"
                      >
                        <MousePointer2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                        Select
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={tool === 'joint' ? 'default' : 'outline'}
                        onClick={() => {
                          setTool('joint')
                          setBarStart(null)
                        }}
                        aria-pressed={tool === 'joint'}
                        title="Click the sheet to add a joint"
                      >
                        <CircleDot className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                        Joint
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={tool === 'bar' ? 'default' : 'outline'}
                        onClick={() => {
                          setTool('bar')
                          setBarStart(null)
                        }}
                        aria-pressed={tool === 'bar'}
                        title="Click two joints to draw a bar"
                      >
                        <Minus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                        Bar
                      </Button>
                    </div>
                    <div className="flex gap-1" role="group" aria-label="Sheet overlays">
                      <Button
                        type="button"
                        size="sm"
                        variant={showDeflected ? 'default' : 'outline'}
                        onClick={() => setShowDeflected(!showDeflected)}
                        aria-pressed={showDeflected}
                        title="Draw the deflected shape over the frame"
                      >
                        Deflected
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={showForceLabels ? 'default' : 'outline'}
                        onClick={() => setShowForceLabels(!showForceLabels)}
                        aria-pressed={showForceLabels}
                        title="Write each bar's axial force on the drawing"
                      >
                        kN labels
                      </Button>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={handleExportSheet}
                      title="Download the framing sheet — elevation, bar schedule and dimensions on an A3 drawing"
                    >
                      <Download className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                      Download drawing
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <LibraryDropNote zone={zone} surface="the sheet" className="cad-drop-note--inline" />
                {barStart && (
                  <p role="status" className="text-xs text-muted-foreground">
                    Bar started at <span className="font-semibold text-foreground">{barStart}</span> — click the
                    second joint, or click empty sheet to cancel.
                  </p>
                )}
                <div className="h-[420px] min-h-[320px] w-full overflow-hidden rounded-sm border border-border">
                  <TrussSheet
                    model={model}
                    result={result}
                    deflectionScale={scale}
                    showDeflected={showDeflected}
                    showForceLabels={showForceLabels}
                    tool={tool}
                    barStart={barStart}
                    selectedNodeId={selection?.kind === 'node' ? selection.id : null}
                    selectedMemberId={selection?.kind === 'member' ? selection.id : null}
                    onNodeClick={handleNodeClick}
                    onMemberClick={handleMemberClick}
                    onSheetClick={handleSheetClick}
                    onNodeMove={(id, point) => patchNode(id, point)}
                  />
                </div>
                {sheetStatus && (
                  <p role="status" aria-label="Drawing export status" className="text-xs text-muted-foreground">
                    {sheetStatus}
                  </p>
                )}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    {legend.map((entry) => (
                      <span key={entry.token} className="flex items-center gap-1.5 text-muted-foreground">
                        <span
                          className="inline-block h-2.5 w-6 rounded-sm"
                          style={{ backgroundColor: chartColor(theme, entry.token) }}
                          aria-hidden="true"
                        />
                        {entry.label}
                      </span>
                    ))}
                    <span className="text-muted-foreground">
                      {determinacy.members} bars + {determinacy.restraints} restraints vs{' '}
                      {2 * determinacy.joints} for {determinacy.joints} joints —{' '}
                      <span className="font-semibold text-foreground">{determinacy.kind}</span>
                    </span>
                  </div>
                  {showDeflected && (
                    <div className="w-56">
                      <RangeControl
                        label="Exaggeration"
                        value={exaggeration}
                        min={1}
                        max={8}
                        step={1}
                        onValueChange={setExaggeration}
                        format={(value) => `${value}× auto`}
                      />
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {error && (
              <Card className="border-destructive/50">
                <CardContent className="space-y-2 py-4 text-sm">
                  <p role="alert" className="font-medium text-destructive">
                    {error}
                  </p>
                  <p className="text-muted-foreground">
                    The drawing still shows the geometry as placed; the solver refuses to invent an answer for a frame
                    it cannot hold.
                  </p>
                </CardContent>
              </Card>
            )}

            {result && (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Kpi label="Span" value={`${span.toFixed(2)} m`} detail={`${model.nodes.length} joints · ${model.members.length} bars`} />
                <Kpi
                  label="Max deflection"
                  value={`${(result.maxDisplacement * 1000).toFixed(2)} mm`}
                  detail={
                    result.maxDisplacement > 0
                      ? `at ${result.maxDisplacementNode} · L/${Math.max(1, Math.round(span / result.maxDisplacement))}`
                      : 'no movement solved'
                  }
                />
                <Kpi
                  label="Worst utilisation"
                  value={worstUtilisation ? `${(worstUtilisation.utilisation * 100).toFixed(0)}%` : '—'}
                  detail={worstUtilisation ? `${worstUtilisation.id} against its own strength` : undefined}
                  tone={worstUtilisation && worstUtilisation.utilisation > 1 ? 'warn' : 'default'}
                />
                <Kpi
                  label="Reactions close"
                  value={
                    Math.hypot(
                      result.equilibrium.appliedX + result.equilibrium.reactionX,
                      result.equilibrium.appliedY + result.equilibrium.reactionY,
                    ) < 1e-6 * Math.max(1, Math.hypot(result.equilibrium.appliedX, result.equilibrium.appliedY))
                      ? 'Yes'
                      : 'No'
                  }
                  detail={`Σ applied ${kilo(result.equilibrium.appliedY)} kN vertical, ${kilo(result.equilibrium.appliedX)} kN horizontal`}
                />
              </div>
            )}

            {result && result.notes.length > 0 && (
              <Card className="border-warning/50">
                <CardContent className="space-y-1 py-3 text-sm">
                  {result.notes.map((note) => (
                    <p key={note} className="text-warning">
                      {note}
                    </p>
                  ))}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Member forces</CardTitle>
              </CardHeader>
              <CardContent>
                {result ? (
                  <div className="max-h-72 overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
                        <tr>
                          <th className="py-1.5 pr-2 font-medium">Bar</th>
                          <th className="py-1.5 pr-2 font-medium">Ends</th>
                          <th className="py-1.5 pr-2 text-right font-medium">Force</th>
                          <th className="py-1.5 pr-2 text-right font-medium">Stress</th>
                          <th className="py-1.5 pr-2 text-right font-medium">Utilisation</th>
                          <th className="py-1.5 pr-2 text-right font-medium">Euler</th>
                        </tr>
                      </thead>
                      <tbody>
                        {memberRows.map(({ member, demand }) => (
                          <tr
                            key={member.id}
                            onClick={() => setSelection({ kind: 'member', id: member.id })}
                            className={`cursor-pointer border-t border-border ${
                              selection?.kind === 'member' && selection.id === member.id ? 'bg-accent' : ''
                            }`}
                          >
                            <td className="py-1.5 pr-2">
                              <span
                                className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle"
                                style={{
                                  backgroundColor: chartColor(
                                    theme,
                                    demand.force > 0
                                      ? '--force-tension'
                                      : demand.force < 0
                                        ? '--force-compression'
                                        : '--force-neutral',
                                  ),
                                }}
                                aria-hidden="true"
                              />
                              {member.id}
                            </td>
                            <td className="py-1.5 pr-2 text-muted-foreground">
                              {member.from} → {member.to}
                            </td>
                            <td className="cad-readout py-1.5 pr-2 text-right">{describeMemberForce(demand)}</td>
                            <td className="cad-readout py-1.5 pr-2 text-right">{mega(demand.stress)} MPa</td>
                            <td
                              className={`cad-readout py-1.5 pr-2 text-right ${
                                demand.utilisation > 1 ? 'font-semibold text-destructive' : ''
                              }`}
                            >
                              {(demand.utilisation * 100).toFixed(0)}%
                            </td>
                            <td className="cad-readout py-1.5 pr-2 text-right">
                              {demand.bucklingLoad === null ? '—' : `${kilo(demand.bucklingLoad)} kN`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {governing && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Governing bar by force: <span className="font-semibold text-foreground">{governing.member.id}</span>{' '}
                        — {describeMemberForce(governing.demand)}, slenderness{' '}
                        {governing.demand.slenderness.toFixed(0)}, {TRUSS_MATERIALS[governing.member.material].label}.
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="py-2 text-sm text-muted-foreground">
                    Nothing solved yet. A frame needs at least one bar between two held joints before the solver has an
                    answer to give.
                  </p>
                )}
              </CardContent>
            </Card>

            {result && Object.keys(result.reactions).length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Support reactions</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {Object.entries(result.reactions).map(([node, reaction]) => (
                      <div key={node} className="flex items-baseline justify-between rounded-md border border-border bg-card px-3 py-2 text-sm">
                        <span className="truncate font-medium">{node}</span>
                        <span className="cad-readout whitespace-nowrap text-muted-foreground">
                          {kilo(reaction.x)} / {kilo(reaction.y)} kN
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Recovered from the restrained rows of the solved system, so these are the same numbers the
                    displacements came out of — not a separate statics check.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-base">Frame in space</CardTitle>
                  <div className="flex gap-1" role="group" aria-label="3D shading mode">
                    {SHADING_MODES.map((id: ShadingMode) => (
                      <Button
                        key={id}
                        type="button"
                        size="sm"
                        variant={shadingMode === id ? 'default' : 'outline'}
                        onClick={() => setShadingMode(id)}
                        aria-pressed={shadingMode === id}
                        title={SHADING_UI[id].hint}
                      >
                        {SHADING_UI[id].label}
                      </Button>
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="h-[320px] min-h-[240px] w-full overflow-hidden rounded-sm border border-border">
                  <Truss3DView
                    model={model}
                    result={result}
                    deflectionScale={scale}
                    showDeflected={showDeflected}
                    shading={shadingMode}
                  />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Bars are cylinders of the section you set; the hue is the solved axial force, so the frame can be read
                  for depth and clearance without leaving the drawing.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Inspector</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {!selectedNode && !selectedMember && (
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p>Click a joint or a bar on the sheet to edit it, or use the tools above the drawing.</p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const x = Math.max(...model.nodes.map((node) => node.x), 0) + 1
                          const y = model.nodes.reduce((sum, node) => sum + node.y, 0) / Math.max(1, model.nodes.length)
                          addNode(Math.round(x * 20) / 20, Math.round(y * 20) / 20)
                        }}
                      >
                        Add joint
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => setTool('bar')}>
                        Draw bar
                      </Button>
                    </div>
                  </div>
                )}

                {selectedNode && (
                  <>
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold">Joint {selectedNode.id}</h3>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => removeNode(selectedNode.id)}
                        title={`Delete this joint and the ${barsOnSelectedNode} bars meeting it`}
                      >
                        <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                        Delete
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block text-xs">
                        <span className="text-muted-foreground">X (m)</span>
                        <Input
                          type="number"
                          step="0.05"
                          value={selectedNode.x}
                          onChange={(event) => patchNode(selectedNode.id, { x: readNumber(event.target.value, selectedNode.x) })}
                          aria-label={`X position of ${selectedNode.id}`}
                          className="h-8"
                        />
                      </label>
                      <label className="block text-xs">
                        <span className="text-muted-foreground">Y (m)</span>
                        <Input
                          type="number"
                          step="0.05"
                          value={selectedNode.y}
                          onChange={(event) => patchNode(selectedNode.id, { y: readNumber(event.target.value, selectedNode.y) })}
                          aria-label={`Y position of ${selectedNode.id}`}
                          className="h-8"
                        />
                      </label>
                    </div>
                    <div className="space-y-1.5 rounded-md border border-border p-2">
                      <p className="text-xs text-muted-foreground">Bearing</p>
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={Boolean(supportNode?.holdsX)}
                          onCheckedChange={(checked) =>
                            setSupport(selectedNode.id, checked === true, Boolean(supportNode?.holdsY))
                          }
                          aria-label={`Hold ${selectedNode.id} horizontally`}
                        />
                        Hold X
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={Boolean(supportNode?.holdsY)}
                          onCheckedChange={(checked) =>
                            setSupport(selectedNode.id, Boolean(supportNode?.holdsX), checked === true)
                          }
                          aria-label={`Hold ${selectedNode.id} vertically`}
                        />
                        Hold Y
                      </label>
                      <p className="text-xs text-muted-foreground">
                        Holding one axis draws a roller, two draws a pin. A frame needs three restraint components in
                        total, or it is a mechanism.
                      </p>
                    </div>
                    <div className="space-y-1.5 rounded-md border border-border p-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-muted-foreground">Load</p>
                        {loadNode && (
                          <Button type="button" size="sm" variant="ghost" onClick={() => removeLoad(selectedNode.id)}>
                            Clear
                          </Button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block text-xs">
                          <span className="text-muted-foreground">Fx (kN)</span>
                          <Input
                            type="number"
                            step="0.5"
                            value={(loadNode?.fx ?? 0) / 1e3}
                            onChange={(event) =>
                              setLoad(
                                selectedNode.id,
                                readNumber(event.target.value, (loadNode?.fx ?? 0) / 1e3) * 1e3,
                                loadNode?.fy ?? 0,
                              )
                            }
                            aria-label={`Horizontal load at ${selectedNode.id} in kilonewtons`}
                            className="h-8"
                          />
                        </label>
                        <label className="block text-xs">
                          <span className="text-muted-foreground">Fy (kN)</span>
                          <Input
                            type="number"
                            step="0.5"
                            value={(loadNode?.fy ?? 0) / 1e3}
                            onChange={(event) =>
                              setLoad(
                                selectedNode.id,
                                loadNode?.fx ?? 0,
                                readNumber(event.target.value, (loadNode?.fy ?? 0) / 1e3) * 1e3,
                              )
                            }
                            aria-label={`Vertical load at ${selectedNode.id} in kilonewtons`}
                            className="h-8"
                          />
                        </label>
                      </div>
                      {result?.displacements[selectedNode.id] && (
                        <p className="text-xs text-muted-foreground">
                          Moves {(result.displacements[selectedNode.id].x * 1000).toFixed(3)} /{' '}
                          {(result.displacements[selectedNode.id].y * 1000).toFixed(3)} mm.
                        </p>
                      )}
                    </div>
                  </>
                )}

                {selectedMember && (
                  <>
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold">Bar {selectedMember.id}</h3>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setModel((prev) => ({ ...prev, members: prev.members.filter((m) => m.id !== selectedMember.id) }))
                          setSelection(null)
                        }}
                      >
                        <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                        Delete
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {(['from', 'to'] as const).map((end) => (
                        <label key={end} className="block text-xs">
                          <span className="text-muted-foreground capitalize">{end} joint</span>
                          <select
                            value={selectedMember[end]}
                            onChange={(event) => {
                              const other = end === 'from' ? selectedMember.to : selectedMember.from
                              if (event.target.value === other) return
                              patchMember(selectedMember.id, { [end]: event.target.value } as Partial<TrussMember>)
                            }}
                            aria-label={`${end} joint of ${selectedMember.id}`}
                            className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                          >
                            {model.nodes.map((node) => (
                              <option key={node.id} value={node.id}>
                                {node.id}
                              </option>
                            ))}
                          </select>
                        </label>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block text-xs">
                        <span className="text-muted-foreground">Area (mm²)</span>
                        <Input
                          type="number"
                          step="10"
                          min="1"
                          value={selectedMember.area * 1e6}
                          onChange={(event) =>
                            patchMember(selectedMember.id, {
                              area: Math.max(1, readNumber(event.target.value, selectedMember.area * 1e6)) * 1e-6,
                            })
                          }
                          aria-label={`Cross-sectional area of ${selectedMember.id} in square millimetres`}
                          className="h-8"
                        />
                      </label>
                      <label className="block text-xs">
                        <span className="text-muted-foreground">Material</span>
                        <select
                          value={selectedMember.material}
                          onChange={(event) =>
                            patchMember(selectedMember.id, { material: event.target.value as TrussMaterialId })
                          }
                          aria-label={`Material of ${selectedMember.id}`}
                          className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                        >
                          {MATERIAL_IDS.map((id) => (
                            <option key={id} value={id}>
                              {TRUSS_MATERIALS[id].label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {TRUSS_MATERIALS[selectedMember.material].source}.
                    </p>
                    {result?.members[selectedMember.id] && (
                      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                        {(
                          [
                            ['Axial force', describeMemberForce(result.members[selectedMember.id])],
                            ['Stress', `${mega(result.members[selectedMember.id].stress)} MPa`],
                            ['Utilisation', `${(result.members[selectedMember.id].utilisation * 100).toFixed(0)}%`],
                            ['Slenderness', result.members[selectedMember.id].slenderness.toFixed(0)],
                            [
                              'Euler load',
                              result.members[selectedMember.id].bucklingLoad === null
                                ? 'tension — cannot buckle'
                                : `${kilo(result.members[selectedMember.id].bucklingLoad as number)} kN`,
                            ],
                          ] as const
                        ).map(([term, value]) => (
                          <div key={term} className="contents">
                            <dt className="text-muted-foreground">{term}</dt>
                            <dd className="cad-readout text-right">{value}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Standard frames</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {TRUSS_PRESETS.map((preset) => (
                  <Button key={preset.id} type="button" size="sm" variant="outline" onClick={() => loadPreset(preset.id)}>
                    {preset.name}
                  </Button>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
