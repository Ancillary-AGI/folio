import { useEffect, useState } from 'react'
import { AlertCircle, AlertTriangle, ArrowUpRight, Info, X } from 'lucide-react'
import { Button } from './ui/button'
import type { ERCViolation } from '../lib/manufacturing/erc'

export interface NetInspectorPin {
  componentId: string
  /** Unique within the part; two pins can share a display name. */
  pinId: string
  reference: string
  partName: string
  pinName: string
  pinType: string
}

export interface NetInspectorModel {
  /** The ERC net key: the net name, or `wire:<id>` for an unnamed net. */
  key: string
  name: string | null
  pins: NetInspectorPin[]
  wireIds: string[]
  segmentCount: number
  lengthMm: number
}

interface NetInspectorProps {
  net: NetInspectorModel
  findings: ERCViolation[]
  /** Rename the whole net. Returns a message when the name is rejected. */
  onRename: (next: string) => string | null
  onSelectPin: (componentId: string) => void
  onClose: () => void
}

const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_.+-]*$/

const SEVERITY_ICON = {
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
} as const

const formatLength = (mm: number) =>
  `${mm >= 1000 ? Math.round(mm) : mm.toFixed(1)} mm`

/**
 * Net inspector, in the same palette anatomy as the part inspector: flat
 * section bars over dense label → value rows. A net is a first-class design
 * object, so this dock answers what it is (name, copper, pins) and what the
 * rule check thinks of it — not merely which parts it reaches.
 */
export default function NetInspector({
  net,
  findings,
  onRename,
  onSelectPin,
  onClose,
}: NetInspectorProps) {
  const [draftName, setDraftName] = useState(net.name ?? '')
  const [renameError, setRenameError] = useState<string | null>(null)

  useEffect(() => {
    setDraftName(net.name ?? '')
    setRenameError(null)
  }, [net.key, net.name])

  const nextName = draftName.trim()
  const hasUnsavedChanges = nextName !== (net.name ?? '')

  const applyRename = () => {
    if (!NAME_PATTERN.test(nextName)) {
      setRenameError(
        nextName === ''
          ? 'Enter a net name.'
          : 'Names start with a letter; use letters, digits, ".", "_", "+" or "-".',
      )
      return
    }
    const error = onRename(nextName)
    setRenameError(error)
  }

  const resetName = () => {
    setDraftName(net.name ?? '')
    setRenameError(null)
  }

  return (
    <aside className="cad-inspector" aria-label="Net inspector">
      <div className="cad-palette-title">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="cad-readout text-[11px] font-bold normal-case tracking-normal text-foreground">
            {net.name ?? 'Unnamed net'}
          </span>
          <span className="truncate font-normal normal-case tracking-normal text-muted-foreground">
            {net.pins.length} pin{net.pins.length === 1 ? '' : 's'}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5"
          onClick={onClose}
          title="Close net inspector"
          aria-label="Close net inspector"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <div className="cad-section-title">General</div>
        <div className="cad-prop-row">
          <label className="cad-prop-label" htmlFor="net-name">
            Name
          </label>
          <input
            id="net-name"
            className="cad-field font-mono"
            value={draftName}
            onChange={(event) => {
              setDraftName(event.target.value)
              setRenameError(null)
            }}
            placeholder={net.name ? undefined : 'unnamed'}
            aria-invalid={renameError ? true : undefined}
            aria-describedby={renameError ? 'net-name-error' : undefined}
            spellCheck={false}
          />
        </div>
        {renameError && (
          <p id="net-name-error" role="alert" className="px-2 py-1 text-[10px] text-destructive">
            {renameError}
          </p>
        )}
        <div className="cad-prop-row">
          <span className="cad-prop-label">Pins</span>
          <span className="cad-prop-value">{net.pins.length}</span>
        </div>
        <div className="cad-prop-row">
          <span className="cad-prop-label">Segments</span>
          <span className="cad-prop-value">{net.segmentCount}</span>
        </div>
        <div className="cad-prop-row">
          <span className="cad-prop-label">Length</span>
          <span className="cad-prop-value">{formatLength(net.lengthMm)}</span>
        </div>

        <div className="cad-section-title">
          <span>Connectivity</span>
          <span className="font-mono tabular-nums normal-case tracking-normal">
            {net.pins.length}
          </span>
        </div>
        {net.pins.length === 0 ? (
          <p className="px-2 py-2 text-[11px] text-muted-foreground">
            No pins on this net yet. Route it to a part pin to give it a
            connection.
          </p>
        ) : (
          net.pins.map((pin) => (
            <button
              key={`${pin.componentId}:${pin.pinId}`}
              type="button"
              className="cad-prop-row w-full text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              onClick={() => onSelectPin(pin.componentId)}
              title={`Select ${pin.reference} · ${pin.partName} · pin ${pin.pinName}`}
            >
              <span className="cad-readout truncate text-[11px] font-bold text-foreground">
                {pin.reference}
              </span>
              <span className="flex min-w-0 items-center justify-between gap-1.5">
                <span className="truncate text-[11px] text-muted-foreground">
                  {pin.pinName}
                  <span className="ml-1.5 text-[10px] text-muted-foreground/70">· {pin.pinType}</span>
                </span>
                <ArrowUpRight className="h-3 w-3 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
              </span>
            </button>
          ))
        )}

        <div className="cad-section-title">
          <span>Findings</span>
          <span className="font-mono tabular-nums normal-case tracking-normal">
            {findings.length}
          </span>
        </div>
        {findings.length === 0 ? (
          <p className="px-2 py-2 text-[11px] text-muted-foreground">
            No rule findings on this net.
          </p>
        ) : (
          findings.map((finding, index) => {
            const Icon = SEVERITY_ICON[finding.severity]
            return (
              <div
                key={`${finding.type}-${index}`}
                className="flex items-start gap-2 border-b border-border/50 px-2 py-1.5"
              >
                <Icon
                  className={`cad-problem__icon cad-problem__icon--${finding.severity} mt-0.5`}
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <p className="text-[11px] leading-snug text-foreground">{finding.message}</p>
                  {finding.suggestion && (
                    <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
                      {finding.suggestion}
                    </p>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      <div className="flex h-9 flex-shrink-0 items-center justify-between gap-2 border-t border-border bg-surface px-2">
        <span className="text-[11px] text-muted-foreground">
          {hasUnsavedChanges ? 'Modified' : 'In sync'}
        </span>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={resetName}
            disabled={!hasUnsavedChanges}
          >
            Reset
          </Button>
          <Button
            size="sm"
            className="h-6 px-3 text-[11px]"
            onClick={applyRename}
            disabled={!hasUnsavedChanges}
          >
            Apply
          </Button>
        </div>
      </div>
    </aside>
  )
}
