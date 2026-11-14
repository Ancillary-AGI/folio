import HoverHelp from '../ui/HoverHelp'
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  Crosshair,
  Info,
  ListTree,
  ShieldCheck,
  X,
} from 'lucide-react'
import type { ERCViolation, ERCResult } from '../../lib/manufacturing/erc'
import { orderedFindings } from '../../lib/manufacturing/findings'
import type { CanvasComponent, CanvasWire } from '../../stores/useProjectStore'
import { useAppStore } from '../../stores/useAppStore'
import {
  useDesignHealthStore,
  type DesignHealthTab,
} from '../../stores/useDesignHealthStore'

type Severity = ERCViolation['severity']
type Filter = 'all' | Severity

const SEVERITY_ICON = {
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
} as const

const SEVERITY_TONE: Readonly<Record<Severity, string>> = {
  error: 'cad-problem--error',
  warning: 'cad-problem--warning',
  info: 'cad-problem--info',
}

/** The panel never shrinks below its own bar, nor past most of the work area. */
const MIN_PANEL_HEIGHT = 116
const clampPanelHeight = (height: number) => {
  const ceiling = typeof window === 'undefined' ? 560 : Math.max(MIN_PANEL_HEIGHT, window.innerHeight * 0.62)
  return Math.round(Math.max(MIN_PANEL_HEIGHT, Math.min(height, ceiling)))
}

interface DesignHealthPanelProps {
  result: ERCResult
  components: CanvasComponent[]
  wires: CanvasWire[]
  onClose: () => void
}

/** Select the part and bring it under the viewport, not just into the store. */
function locateComponent(id: string) {
  useAppStore.getState().setSelectedComponents([id])
  useAppStore.getState().requestComponentFocus(id)
}

/**
 * Workbench bottom dock: the sheet's electrical rule check and a parts
 * outline, held in one tabbed surface the way an IDE holds Problems beside
 * Outline. Every row is live data from the ERC engine — nothing here is a
 * decorative count.
 */
export default function DesignHealthPanel({
  result,
  components,
  wires,
  onClose,
}: DesignHealthPanelProps) {
  const tab = useDesignHealthStore((state) => state.tab)
  const setTab = useDesignHealthStore((state) => state.setTab)
  const panelHeight = useDesignHealthStore((state) => state.panelHeight)
  const setPanelHeight = useDesignHealthStore((state) => state.setPanelHeight)
  const activeFindingIndex = useDesignHealthStore((state) => state.activeFindingIndex)
  const setActiveFindingIndex = useDesignHealthStore((state) => state.setActiveFindingIndex)
  const [filter, setFilter] = useState<Filter>('all')
  const [resizing, setResizing] = useState(false)
  const resizeStart = useRef<{ y: number; height: number } | null>(null)
  const listRef = useRef<HTMLUListElement>(null)

  /* F8 can land on a finding below the fold; the dock follows the cursor the
   * same way an editor scrolls to the problem it just stepped onto. */
  useEffect(() => {
    if (activeFindingIndex === null) return
    listRef.current
      ?.querySelector<HTMLElement>('[data-active-finding="true"]')
      ?.scrollIntoView?.({ block: 'nearest' })
  }, [activeFindingIndex, tab, filter])

  /*
   * A findings list is read at the reader's chosen depth: the dock's top edge
   * is a real splitter. Pointer drags cover the mouse; arrow keys cover the
   * keyboard with the same 24px step so the separator is not a mouse-only tool.
   */
  useEffect(() => {
    if (!resizing) return
    const move = (event: PointerEvent) => {
      const start = resizeStart.current
      if (!start) return
      setPanelHeight(clampPanelHeight(start.height - (event.clientY - start.y)))
    }
    const end = () => setResizing(false)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
  }, [resizing, setPanelHeight])

  const { errors, warnings, info, totalViolations } = result.summary
  const pins = components.reduce((sum, component) => sum + component.component.pins.length, 0)
  const quiet = tab === 'problems' && totalViolations === 0
  const heightCeiling = Math.round(
    (typeof window === 'undefined' ? 900 : window.innerHeight) * 0.62,
  )

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    resizeStart.current = { y: event.clientY, height: panelHeight }
    setResizing(true)
  }

  const resizeWithKeys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowUp') setPanelHeight(clampPanelHeight(panelHeight + 24))
    else if (event.key === 'ArrowDown') setPanelHeight(clampPanelHeight(panelHeight - 24))
    else if (event.key === 'Home') setPanelHeight(MIN_PANEL_HEIGHT)
    else if (event.key === 'End') setPanelHeight(clampPanelHeight(heightCeiling))
    else return
    event.preventDefault()
  }

  const findings = orderedFindings(result)
  const visible = filter === 'all' ? findings : findings.filter((finding) => finding.severity === filter)

  const referenceOf = (componentId?: string) =>
    componentId ? components.find((component) => component.id === componentId)?.reference ?? null : null

  const tabs: ReadonlyArray<{ id: DesignHealthTab; label: string; count: number }> = [
    { id: 'problems', label: 'Problems', count: totalViolations },
    { id: 'outline', label: 'Outline', count: components.length },
  ]

  const filters: ReadonlyArray<{ id: Filter; label: string; count: number }> = [
    { id: 'all', label: 'All', count: totalViolations },
    { id: 'error', label: 'Errors', count: errors },
    { id: 'warning', label: 'Warnings', count: warnings },
    { id: 'info', label: 'Notices', count: info },
  ]

  return (
    <section
      className={`cad-panel ${quiet ? 'cad-panel--quiet' : ''}`}
      id="design-health-panel"
      aria-label="Design health"
      style={quiet ? undefined : { height: panelHeight }}
    >
      {!quiet && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize the design health panel"
          aria-valuemin={MIN_PANEL_HEIGHT}
          aria-valuemax={heightCeiling}
          aria-valuenow={panelHeight}
          tabIndex={0}
          className={`cad-panel__resize ${resizing ? 'cad-panel__resize--active' : ''}`}
          onPointerDown={startResize}
          onKeyDown={resizeWithKeys}
        />
      )}
      <div className="cad-panel__bar">
        <div className="cad-panel__tabs" role="tablist" aria-label="Design health panels">
          {tabs.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              id={`dh-tab-${entry.id}`}
              aria-selected={tab === entry.id}
              aria-controls={`dh-panel-${entry.id}`}
              className="cad-panel__tab"
              onClick={() => setTab(entry.id)}
            >
              {entry.id === 'problems' ? (
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <ListTree className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {entry.label}
              <span
                className={`cad-panel__count ${
                  entry.id === 'problems' && errors > 0 ? 'cad-panel__count--alert' : ''
                }`}
              >
                {entry.count}
              </span>
            </button>
          ))}
        </div>

        <div className="cad-panel__actions">
          {tab === 'problems' && (
            <div className="cad-panel__filters" role="group" aria-label="Filter findings by severity">
              {filters.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={`cad-panel__filter ${filter === entry.id ? 'cad-panel__filter--active' : ''}`}
                  aria-pressed={filter === entry.id}
                  onClick={() => setFilter(entry.id)}
                >
                  {entry.id !== 'all' && (
                    <span
                      className={`cad-panel__filter-dot cad-panel__filter-dot--${entry.id}`}
                      aria-hidden="true"
                    />
                  )}
                  {entry.label}
                  <span className="cad-panel__filter-count">{entry.count}</span>
                </button>
              ))}
            </div>
          )}
          <HoverHelp title="Hide the design health panel" description="Hide the design health panel">
<button type="button"
            className="cad-ctl cad-ctl--icon"
            onClick={onClose} aria-label="Hide the design health panel">
            <X />
          </button>
</HoverHelp>
        </div>
      </div>

      {tab === 'problems' ? (
        <div
          className="cad-panel__body"
          id="dh-panel-problems"
          role="tabpanel"
          aria-labelledby="dh-tab-problems"
        >
          {visible.length === 0 ? (
            <div className="cad-panel__empty">
              <ShieldCheck className="h-5 w-5 flex-shrink-0 text-success" aria-hidden="true" />
              <span className="min-w-0">
                <p className="truncate text-xs font-medium text-foreground">
                  {totalViolations === 0
                    ? 'No electrical rule violations'
                    : `No findings in ${filters.find((entry) => entry.id === filter)?.label ?? 'this filter'}`}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {components.length} part{components.length === 1 ? '' : 's'} · {pins} pin
                  {pins === 1 ? '' : 's'} · {wires.length} wire{wires.length === 1 ? '' : 's'}{' '}
                  checked after every edit.
                </p>
              </span>
            </div>
          ) : (
            <ul ref={listRef} className="cad-panel__list" aria-label="Electrical rule violations">
              {visible.map((violation, index) => {
                const Icon = SEVERITY_ICON[violation.severity]
                const reference = referenceOf(violation.componentId)
                const active = activeFindingIndex !== null && findings[activeFindingIndex] === violation
                const rowClass = `cad-problem ${SEVERITY_TONE[violation.severity]} ${
                  active ? 'cad-problem--active' : ''
                }`
                const content = (
                  <>
                    <Icon
                      className={`cad-problem__icon cad-problem__icon--${violation.severity}`}
                      aria-hidden="true"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-xs text-foreground">{violation.message}</span>
                      {violation.suggestion && (
                        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                          {violation.suggestion}
                        </span>
                      )}
                    </span>
                    <span className="cad-problem__side">
                      {reference && <span className="cad-chip text-[10px]">{reference}</span>}
                      {violation.componentId && (
                        <span className="cad-problem__locate">
                          <Crosshair className="h-3 w-3" aria-hidden="true" />
                          Locate
                        </span>
                      )}
                    </span>
                  </>
                )
                return (
                  <li key={`${violation.type}-${violation.componentId ?? violation.netId ?? index}-${index}`}>
                    {violation.componentId ? (
                      <button
                        type="button"
                        className={rowClass}
                        data-active-finding={active ? 'true' : undefined}
                        onClick={() => {
                          // A click is also a cursor move: the next F8 carries
                          // on from the row the reader just chose.
                          const orderedIndex = findings.indexOf(violation)
                          if (orderedIndex >= 0) setActiveFindingIndex(orderedIndex)
                          locateComponent(violation.componentId as string)
                        }}
                        title={`${violation.message}. ${violation.suggestion ?? ''}`}
                        aria-label={`Locate ${violation.message}${violation.suggestion ? `. ${violation.suggestion}` : ''}`}
                      >
                        {content}
                      </button>
                    ) : (
                      <div
                        className={rowClass}
                        data-active-finding={active ? 'true' : undefined}
                      >
                        {content}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      ) : (
        <div
          className="cad-panel__body"
          id="dh-panel-outline"
          role="tabpanel"
          aria-labelledby="dh-tab-outline"
        >
          {components.length === 0 ? (
            <div className="cad-panel__empty">
              <ListTree className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              <p className="text-xs font-medium text-foreground">No parts on the sheet</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Placed parts appear here in reference order, ready to locate.
              </p>
            </div>
          ) : (
            <ul className="cad-panel__list" aria-label="Parts on the sheet">
              {components.map((component) => (
                <li key={component.id}>
                  <button
                    type="button"
                    className="cad-problem cad-problem--outline"
                    onClick={() => locateComponent(component.id)}
                    title={`Locate ${component.reference} on the sheet`}
                  >
                    <span className="cad-chip text-[10px]">{component.reference}</span>
                    <span className="min-w-0 truncate text-xs text-foreground">
                      {component.component.name}
                    </span>
                    <span className="cad-problem__side text-[11px] text-muted-foreground">
                      {component.component.category}
                      <Crosshair className="h-3 w-3" aria-hidden="true" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="cad-panel__foot">
        <span className="inline-flex items-center gap-1.5">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              errors > 0 ? 'bg-destructive' : totalViolations > 0 ? 'bg-warning' : 'bg-success'
            }`}
            aria-hidden="true"
          />
          {errors > 0
            ? `${errors} error${errors === 1 ? '' : 's'} block a clean netlist`
            : totalViolations > 0
              ? 'No blocking errors'
              : 'Rules pass'}
        </span>
        <span className="flex items-center gap-3">
          {findings.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <span className="cad-kbd">F8</span>
              {activeFindingIndex !== null ? `${activeFindingIndex + 1} / ${findings.length}` : 'step findings'}
            </span>
          )}
          <span>Electrical rules · live</span>
        </span>
      </div>
    </section>
  )
}
