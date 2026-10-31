import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, RotateCcw, Trash2, X } from 'lucide-react'
import { Button } from './ui/button'
import { useProjectStore } from '../stores/useProjectStore'
import {
  applyDraftToInstances,
  draftFromComponent,
  symbolDraftFaults,
  SYMBOL_PIN_TYPES,
  type SymbolDraft,
  type SymbolPinDraft,
  type SymbolPinType,
} from '../lib/schematic/symbolEditor'

interface SchematicSymbolEditorProps {
  /** Placed component whose library symbol is being edited. */
  componentId: string | null
  onClose: () => void
}

const PREVIEW_PAD = 8

function PinRow({
  pin,
  index,
  onChange,
  onRemove,
}: {
  pin: SymbolPinDraft
  index: number
  onChange: (next: SymbolPinDraft) => void
  onRemove: () => void
}) {
  const number = (raw: string) => (raw.trim() === '' ? Number.NaN : Number(raw))
  return (
    <div className="grid grid-cols-[1fr_1fr_3.5rem_3.5rem_6.5rem_1.75rem] items-center gap-1">
      <input
        className="min-w-0 rounded border border-border bg-background px-1.5 py-0.5 text-[11px]"
        value={pin.id}
        aria-label={`Pin ${index + 1} id`}
        onChange={(event) => onChange({ ...pin, id: event.target.value })}
      />
      <input
        className="min-w-0 rounded border border-border bg-background px-1.5 py-0.5 text-[11px]"
        value={pin.name}
        aria-label={`Pin ${index + 1} name`}
        onChange={(event) => onChange({ ...pin, name: event.target.value })}
      />
      <input
        type="number"
        className="min-w-0 rounded border border-border bg-background px-1 py-0.5 text-[11px]"
        value={Number.isFinite(pin.x) ? pin.x : ''}
        aria-label={`Pin ${index + 1} x`}
        onChange={(event) => onChange({ ...pin, x: number(event.target.value) })}
      />
      <input
        type="number"
        className="min-w-0 rounded border border-border bg-background px-1 py-0.5 text-[11px]"
        value={Number.isFinite(pin.y) ? pin.y : ''}
        aria-label={`Pin ${index + 1} y`}
        onChange={(event) => onChange({ ...pin, y: number(event.target.value) })}
      />
      <select
        className="min-w-0 rounded border border-border bg-background px-1 py-0.5 text-[11px]"
        value={pin.type}
        aria-label={`Pin ${index + 1} type`}
        onChange={(event) => onChange({ ...pin, type: event.target.value as SymbolPinType })}
      >
        {SYMBOL_PIN_TYPES.map((type) => (
          <option key={type} value={type}>{type}</option>
        ))}
      </select>
      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5"
        onClick={onRemove}
        aria-label={`Remove pin ${pin.id || index + 1}`}
      >
        <Trash2 className="w-3 h-3" />
      </Button>
    </div>
  )
}

/**
 * Symbol editor: the body box, the outline paths and the pin table of a placed
 * part's library symbol. It writes to every instance of that part, and it
 * refuses to save a symbol the canvas contract would reject — a pin outside
 * the body or a path with no commands is shown as a fault, not stored.
 */
export default function SchematicSymbolEditor({ componentId, onClose }: SchematicSymbolEditorProps) {
  const placed = useProjectStore((state) =>
    componentId ? state.components.find((component) => component.id === componentId) ?? null : null,
  )
  const [draft, setDraft] = useState<SymbolDraft | null>(null)

  // Reset the draft whenever a different part is opened, never on every store
  // write: applying an edit must not rewind the fields under the pointer.
  const openedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!placed) {
      openedFor.current = null
      setDraft(null)
      return
    }
    if (openedFor.current === placed.id) return
    openedFor.current = placed.id
    setDraft(draftFromComponent(placed))
  }, [placed])

  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!placed) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [placed])

  const faults = useMemo(() => (draft ? symbolDraftFaults(draft) : []), [draft])
  const instances = useProjectStore((state) =>
    placed ? state.components.filter((component) => component.componentId === placed.componentId).length : 0,
  )

  if (!placed || !draft) return null

  const size = (raw: string) => (raw.trim() === '' ? Number.NaN : Number(raw))
  const change = (patch: Partial<SymbolDraft>) => setDraft((current) => (current ? { ...current, ...patch } : current))

  const changePath = (index: number, value: string) =>
    change({ paths: draft.paths.map((path, position) => (position === index ? value : path)) })
  const removePath = (index: number) => change({ paths: draft.paths.filter((_, position) => position !== index) })
  const addPath = () => change({ paths: [...draft.paths, 'M 0,0'] })

  const changePin = (index: number, next: SymbolPinDraft) =>
    change({ pins: draft.pins.map((pin, position) => (position === index ? next : pin)) })
  const removePin = (index: number) =>
    change({ pins: draft.pins.filter((_, position) => position !== index) })
  const addPin = () =>
    change({
      pins: [
        ...draft.pins,
        {
          id: `p${draft.pins.length + 1}`,
          name: String(draft.pins.length + 1),
          x: 0,
          y: draft.height / 2,
          type: 'passive',
        },
      ],
    })

  const apply = () => {
    if (faults.length > 0) return
    const state = useProjectStore.getState()
    useProjectStore.setState({
      components: applyDraftToInstances(state.components, placed.componentId, draft),
      isDirty: true,
    })
    onClose()
  }

  const reset = () => setDraft(draftFromComponent(placed))
  const viewBox = [
    -PREVIEW_PAD,
    -PREVIEW_PAD,
    (Number.isFinite(draft.width) ? draft.width : 0) + PREVIEW_PAD * 2,
    (Number.isFinite(draft.height) ? draft.height : 0) + PREVIEW_PAD * 2,
  ].join(' ')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="symbol-editor-title"
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-border bg-card text-foreground shadow-xl"
      >
        <header className="flex items-start justify-between border-b border-border px-4 py-3">
          <div>
            <h2 id="symbol-editor-title" className="text-sm font-semibold">
              Symbol editor — {placed.reference} · {placed.component.name}
            </h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Applies to {instances} placed instance{instances === 1 ? '' : 's'} of this part. Pin ids must stay stable or their wires detach.
            </p>
          </div>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose} aria-label="Close symbol editor">
            <X className="w-4 h-4" />
          </Button>
        </header>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <div className="space-y-2">
            <svg
              viewBox={viewBox}
              className="h-56 w-full rounded border border-border bg-background"
              role="img"
              aria-label="Symbol preview"
              preserveAspectRatio="xMidYMid meet"
            >
              <rect
                x={0}
                y={0}
                width={Math.max(0, Number.isFinite(draft.width) ? draft.width : 0)}
                height={Math.max(0, Number.isFinite(draft.height) ? draft.height : 0)}
                fill="none"
                stroke="currentColor"
                strokeDasharray="2 3"
                strokeWidth={0.6}
                className="text-border"
              />
              {draft.paths.map((path, index) => (
                <path
                  key={index}
                  d={path}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-foreground"
                />
              ))}
              {draft.pins.map((pin) => (
                <g key={pin.id} className="text-primary">
                  <circle cx={pin.x} cy={pin.y} r={1.4} fill="currentColor" />
                  <text
                    x={pin.x + 2.2}
                    y={pin.y + 1}
                    fontSize={Math.max(2, draft.height / 14)}
                    fill="currentColor"
                    className="text-muted-foreground"
                  >
                    {pin.name}
                  </text>
                </g>
              ))}
            </svg>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[11px] text-muted-foreground">
                Width
                <input
                  type="number"
                  className="mt-0.5 w-full rounded border border-border bg-background px-1.5 py-0.5 text-xs text-foreground"
                  value={Number.isFinite(draft.width) ? draft.width : ''}
                  onChange={(event) => change({ width: size(event.target.value) })}
                />
              </label>
              <label className="text-[11px] text-muted-foreground">
                Height
                <input
                  type="number"
                  className="mt-0.5 w-full rounded border border-border bg-background px-1.5 py-0.5 text-xs text-foreground"
                  value={Number.isFinite(draft.height) ? draft.height : ''}
                  onChange={(event) => change({ height: size(event.target.value) })}
                />
              </label>
            </div>
          </div>

          <div className="min-w-0 space-y-4">
            <section>
              <div className="mb-1 flex items-center justify-between">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Outline paths</h3>
                <Button variant="outline" size="sm" className="h-6 text-[11px]" onClick={addPath}>
                  <Plus className="mr-1 w-3 h-3" /> Path
                </Button>
              </div>
              <div className="space-y-1">
                {draft.paths.map((path, index) => (
                  <div key={index} className="flex items-center gap-1">
                    <input
                      className="min-w-0 flex-1 rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[11px]"
                      value={path}
                      aria-label={`Outline path ${index + 1}`}
                      onChange={(event) => changePath(index, event.target.value)}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5"
                      onClick={() => removePath(index)}
                      aria-label={`Remove outline path ${index + 1}`}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
                {draft.paths.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">No paths — the symbol needs at least one.</p>
                ) : null}
              </div>
            </section>

            <section>
              <div className="mb-1 flex items-center justify-between">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Pins</h3>
                <Button variant="outline" size="sm" className="h-6 text-[11px]" onClick={addPin}>
                  <Plus className="mr-1 w-3 h-3" /> Pin
                </Button>
              </div>
              <div className="grid grid-cols-[1fr_1fr_3.5rem_3.5rem_6.5rem_1.75rem] gap-1 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                <span>Id</span><span>Name</span><span>X</span><span>Y</span><span>Type</span><span />
              </div>
              <div className="space-y-1">
                {draft.pins.map((pin, index) => (
                  <PinRow
                    key={`${pin.id}-${index}`}
                    pin={pin}
                    index={index}
                    onChange={(next) => changePin(index, next)}
                    onRemove={() => removePin(index)}
                  />
                ))}
                {draft.pins.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">No pins — a part with no pins cannot be wired.</p>
                ) : null}
              </div>
            </section>

            {faults.length > 0 ? (
              <section role="alert" className="rounded border border-destructive/40 bg-destructive/10 px-2 py-1.5">
                <h3 className="text-[11px] font-semibold text-destructive">{faults.length} fault(s) — not saveable</h3>
                <ul className="mt-1 list-inside list-disc text-[11px] text-muted-foreground">
                  {faults.map((fault) => <li key={fault}>{fault}</li>)}
                </ul>
              </section>
            ) : null}
          </div>
        </div>

        <footer className="flex items-center justify-between border-t border-border px-4 py-2.5">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={reset}>
            <RotateCcw className="mr-1 w-3 h-3" /> Reset
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onClose}>Cancel</Button>
            <Button size="sm" className="h-7 text-xs" onClick={apply} disabled={faults.length > 0}>
              Apply to {instances} instance{instances === 1 ? '' : 's'}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  )
}
