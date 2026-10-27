/**
 * BOM Management Panel
 *
 * Features:
 *  • Aggregated Bill of Materials from current schematic components
 *  • Cost totals from each part's declared unit cost (flat — no quantity-break
 *    table here, and unpriced parts are reported separately, never as $0)
 *  • Component lifecycle status, read only from data the part actually
 *    declares — see `inferLifecycle` for what counts as evidence
 *  • Availability column, likewise only from a declared availability string
 *  • Sortable, filterable table
 *  • Export as CSV or JSON
 *  • Inline editing of the notes column, written back onto the schematic
 *    components so the note survives re-aggregation, export and project save
 *
 * There is no supplier or cross-reference lookup in this build: manufacturer
 * and part number are whatever the canvas components declare, and the demo
 * audit compares designators against the fab package rather than a parts API.
 */

import React, { useState, useMemo, useCallback } from 'react'
import { Download, Search, Filter, Edit3, Save, X, AlertTriangle, Package } from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Badge } from '../ui/badge'
import { Card, CardContent } from '../ui/card'
import { useProjectStore } from '../../stores/useProjectStore'
import { downloadFile } from '../../lib/exportUtils'
import { buildDemoBom, type DemoBomRow } from '../../lib/demo/demoBom'
import { describeError } from '../../lib/utils'
import { useDemoRequest } from '../workspace/useDemoRequest'

// ── Types ─────────────────────────────────────────────────────────────────────

export type LifecycleStatus = 'active' | 'nrnd' | 'obsolete' | 'unknown'
export type AvailabilityStatus = 'in-stock' | 'lead-time' | 'allocation' | 'eol' | 'unknown'

export interface BOMLineItem {
  key: string                    // unique key = name + value + package
  qty: number
  references: string[]
  /** Canvas instances folded into this row — the note target, since rows are derived data. */
  instanceIds: string[]
  partName: string
  value: string
  package: string
  description: string
  manufacturer: string
  partNumber: string
  unitCostUsd: number | null
  totalCostUsd: number | null
  lifecycle: LifecycleStatus
  availability: AvailabilityStatus
  leadTimeDays?: number
  notes: string
  category: string
}

type SortKey = keyof BOMLineItem
type SortDir = 'asc' | 'desc'

// ── Lifecycle helpers ─────────────────────────────────────────────────────────

/**
 * Lifecycle needs evidence from the part itself.
 *
 * Only a declared availability of `available` earns an "Active" badge, because
 * that is the one claim a parts library can actually make about a component.
 * Defaulting an undeclared part to Active would tell a designer a part is in
 * production with nothing behind it — the wrong kind of reassurance on a board
 * going to fab — so undeclared parts report `unknown` and the table labels them
 * "Unverified". The name checks stay: they only ever *raise* a risk flag, never
 * clear one.
 */
function inferLifecycle(name: string, properties: Record<string, string | number | boolean>): LifecycleStatus {
  const avail = String(properties.availability ?? '').toLowerCase()
  if (avail === 'obsolete') return 'obsolete'
  if (avail === 'limited' || avail === 'nrnd') return 'nrnd'
  if (avail === 'available') return 'active'
  const lower = name.toLowerCase()
  if (lower.includes('obsolete') || lower.includes('legacy')) return 'obsolete'
  if (lower.includes('nrnd') || lower.includes('end-of-life')) return 'nrnd'
  return 'unknown'
}

/**
 * Availability has the same rule as lifecycle: a status appears only because the
 * part declares it. A declared lead time is its own evidence, so a part with a
 * finite positive `leadTime` reads as Lead Time rather than nothing.
 */
function inferAvailability(props: Record<string, string | number | boolean>): AvailabilityStatus {
  const avail = String(props.availability ?? '').toLowerCase()
  if (avail === 'available') return 'in-stock'
  if (avail === 'limited') return 'allocation'
  if (avail === 'obsolete') return 'eol'
  const leadTime = props.leadTime
  if (typeof leadTime === 'number' && Number.isFinite(leadTime) && leadTime > 0) return 'lead-time'
  return 'unknown'
}

// ── BOM builder ───────────────────────────────────────────────────────────────

function buildBOM(components: ReturnType<typeof useProjectStore.getState>['components']): BOMLineItem[] {
  const map = new Map<string, BOMLineItem>()

  for (const comp of components) {
    const p = comp.properties
    const partName = comp.component?.name ?? comp.componentId ?? 'Unknown'
    const value = String(p.value ?? p.resistance ?? p.capacitance ?? p.inductance ?? '—')
    const pkg = String(p.package ?? p.footprint ?? '—')
    const key = `${partName}|${value}|${pkg}`

    if (map.has(key)) {
      const existing = map.get(key)!
      existing.qty += 1
      existing.references = [...existing.references, comp.reference]
      existing.instanceIds = [...existing.instanceIds, comp.id]
      existing.totalCostUsd = existing.unitCostUsd === null ? null : existing.qty * existing.unitCostUsd
    } else {
      const unitCost = typeof p.cost === 'number' && Number.isFinite(p.cost) ? p.cost : null
      map.set(key, {
        key,
        qty: 1,
        references: [comp.reference],
        instanceIds: [comp.id],
        partName,
        value,
        package: pkg,
        description: comp.component?.description ?? '—',
        manufacturer: String(p.manufacturer ?? comp.component?.manufacturer ?? '—'),
        partNumber: String(p.partNumber ?? comp.component?.part_number ?? '—'),
        unitCostUsd: unitCost,
        totalCostUsd: unitCost,
        lifecycle: inferLifecycle(partName, p),
        availability: inferAvailability(p),
        leadTimeDays: typeof p.leadTime === 'number' ? p.leadTime : undefined,
        notes: String(p.notes ?? ''),
        category: String(comp.component?.category ?? '—'),
      })
    }
  }

  return Array.from(map.values())
}

// ── Cell components ───────────────────────────────────────────────────────────

const LifecycleBadge: React.FC<{ status: LifecycleStatus }> = ({ status }) => {
  const cfg: Record<LifecycleStatus, { label: string; cls: string; title: string }> = {
    active: { label: 'Active', cls: 'bg-success text-success-foreground', title: 'Lifecycle from a declared availability of available' },
    nrnd: { label: 'NRND', cls: 'bg-warning text-warning-foreground', title: 'Lifecycle from a declared limited / NRND availability' },
    obsolete: { label: 'Obsolete', cls: 'bg-destructive text-destructive-foreground', title: 'Lifecycle from a declared obsolete availability' },
    unknown: { label: 'Unverified', cls: 'bg-muted text-muted-foreground', title: 'No lifecycle data declared on this part — not the same as being active' },
  }
  const { label, cls, title } = cfg[status]
  return <Badge className={`text-xs ${cls}`} title={title}>{label}</Badge>
}

const AvailBadge: React.FC<{ status: AvailabilityStatus }> = ({ status }) => {
  const cfg: Record<AvailabilityStatus, { label: string; cls: string; title: string }> = {
    'in-stock': { label: 'In Stock', cls: 'bg-success text-success-foreground', title: 'Part declares availability: available' },
    'lead-time': { label: 'Lead Time', cls: 'bg-primary text-primary-foreground', title: 'No availability declared, but the part declares a lead time' },
    allocation: { label: 'Allocation', cls: 'bg-warning text-warning-foreground', title: 'Part declares availability: limited' },
    eol: { label: 'EOL', cls: 'bg-destructive text-destructive-foreground', title: 'Part declares availability: obsolete' },
    unknown: { label: 'Not declared', cls: 'bg-muted text-muted-foreground', title: 'No availability or lead time declared, and no supplier data source is wired in' },
  }
  const { label, cls, title } = cfg[status]
  return <Badge className={`text-xs ${cls}`} title={title}>{label}</Badge>
}

// ── Main Panel ────────────────────────────────────────────────────────────────

const LIFECYCLE_FILTERS: Array<{ value: LifecycleStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'nrnd', label: 'NRND' },
  { value: 'obsolete', label: 'Obsolete' },
  { value: 'unknown', label: 'Unverified' },
]

interface BOMPanelProps {
  onClose?: () => void
}

const BOMPanel: React.FC<BOMPanelProps> = ({ onClose }) => {
  const { components } = useProjectStore()
  const rawBOM = useMemo(() => buildBOM(components), [components])

  const [search, setSearch] = useState('')
  const [filterLifecycle, setFilterLifecycle] = useState<LifecycleStatus | 'all'>('all')
  const [sortKey, setSortKey] = useState<SortKey>('category')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editNotes, setEditNotes] = useState('')
  const [demoAudit, setDemoAudit] = useState<{ verdict: string; coverage: string; rows: DemoBomRow[] } | null>(null)
  const [demoAuditError, setDemoAuditError] = useState<string | null>(null)

  /**
   * Re-run the demo board through the fab package and report the audited BOM.
   * Coverage is stated as reference presence only — the live canvas may hold
   * the same designators with different parts, which this check does not claim
   * to compare.
   */
  const handleDemoAudit = () => {
    try {
      const demo = buildDemoBom()
      const live = new Set(components.map((component) => component.reference))
      const demoReferences = demo.rows.map((row) => row.reference)
      const present = demoReferences.filter((reference) => live.has(reference))
      const coverage =
        components.length === 0
          ? 'No canvas parts to compare — this is the fab-audited demo board BOM.'
          : `Reference coverage: ${present.length}/${demoReferences.length} demo designators are on the current canvas${
              present.length === demoReferences.length
                ? ''
                : ` (missing ${demoReferences.filter((reference) => !live.has(reference)).join(', ')})`
            }.`
      setDemoAuditError(null)
      setDemoAudit({ verdict: demo.verdict, coverage, rows: demo.rows })
    } catch (error) {
      setDemoAudit(null)
      setDemoAuditError(describeError(error))
    }
  }

  useDemoRequest('bom-audit', handleDemoAudit)

  // ── Filter + sort ─────────────────────────────────────────────────────────

  const filteredBOM = useMemo(() => {
    let items = rawBOM
    if (search.trim()) {
      const q = search.toLowerCase()
      items = items.filter(i =>
        i.partName.toLowerCase().includes(q) ||
        i.value.toLowerCase().includes(q) ||
        i.package.toLowerCase().includes(q) ||
        i.references.join(' ').toLowerCase().includes(q) ||
        i.manufacturer.toLowerCase().includes(q) ||
        i.partNumber.toLowerCase().includes(q),
      )
    }
    if (filterLifecycle !== 'all') items = items.filter(i => i.lifecycle === filterLifecycle)

    return [...items].sort((a, b) => {
      const va = a[sortKey]
      const vb = b[sortKey]
      if (typeof va === 'number' && typeof vb === 'number') return sortDir === 'asc' ? va - vb : vb - va
      return sortDir === 'asc' ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va))
    })
  }, [rawBOM, search, filterLifecycle, sortKey, sortDir])

  const totalCost = useMemo(() => filteredBOM.reduce((sum, item) => sum + (item.totalCostUsd ?? 0), 0), [filteredBOM])
  const hasPricedItems = filteredBOM.some(item => item.totalCostUsd !== null)
  const hasUnpricedItems = filteredBOM.some(item => item.totalCostUsd === null)
  const costLabel = hasUnpricedItems && hasPricedItems ? 'Known Cost Subtotal' : 'Total BOM Cost'
  const formattedCost = hasPricedItems ? `$${totalCost.toFixed(2)}` : 'Not priced'
  const totalQty = useMemo(() => filteredBOM.reduce((s, i) => s + i.qty, 0), [filteredBOM])
  const obsoleteCount = useMemo(() => filteredBOM.filter(i => i.lifecycle === 'obsolete' || i.lifecycle === 'nrnd').length, [filteredBOM])
  const lifecycleCounts = useMemo(() => {
    const counts: Record<LifecycleStatus, number> = { active: 0, nrnd: 0, obsolete: 0, unknown: 0 }
    for (const item of filteredBOM) counts[item.lifecycle] += 1
    return counts
  }, [filteredBOM])

  // ── Sort helpers ──────────────────────────────────────────────────────────

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  // ── Notes editing ─────────────────────────────────────────────────────────

  /**
   * A BOM row is derived data, so a note typed here only survives if it is
   * written back onto the schematic components the row was aggregated from.
   * Every instance in the row gets the same note — they are the same part, and
   * the row cannot tell them apart. One replaceDesign call keeps the edit a
   * single undo step instead of one per instance.
   */
  const saveNotes = useCallback((item: BOMLineItem, notes: string) => {
    const { components, wires, replaceDesign } = useProjectStore.getState()
    const touched = new Set(item.instanceIds)
    replaceDesign({
      components: components.map((comp) =>
        touched.has(comp.id) ? { ...comp, properties: { ...comp.properties, notes } } : comp,
      ),
      wires,
    })
    setEditingKey(null)
  }, [])

  // ── Exports ───────────────────────────────────────────────────────────────

  const exportCSV = useCallback(() => {
    const headers = ['Qty', 'References', 'Part', 'Value', 'Package', 'Description', 'Manufacturer', 'Part Number', 'Unit Cost', 'Total Cost', 'Lifecycle', 'Availability', 'Lead Time', 'Notes']
    const rows = filteredBOM.map(i => [
      i.qty, i.references.join(' '), i.partName, i.value, i.package, i.description,
      i.manufacturer, i.partNumber,
      i.unitCostUsd === null ? '' : `$${i.unitCostUsd.toFixed(2)}`,
      i.totalCostUsd === null ? '' : `$${i.totalCostUsd.toFixed(2)}`,
      i.lifecycle, i.availability, i.leadTimeDays ?? '', i.notes,
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    const csv = [headers.join(','), ...rows].join('\n')
    downloadFile(csv, `bom_${Date.now()}.csv`, 'text/csv')
  }, [filteredBOM])

  const exportJSON = useCallback(() => {
    downloadFile(JSON.stringify({ generatedAt: new Date().toISOString(), totalParts: totalQty, totalUniqueParts: filteredBOM.length, totalCostUsd: totalCost, items: filteredBOM }, null, 2), `bom_${Date.now()}.json`, 'application/json')
  }, [filteredBOM, totalQty, totalCost])

  // ── Column header ─────────────────────────────────────────────────────────

  const ColHeader: React.FC<{ label: string; sk: SortKey }> = ({ label, sk }) => (
    <th className="text-left p-2 text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground whitespace-nowrap" onClick={() => handleSort(sk)}>
      {label}{sortKey === sk ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
    </th>
  )

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Package className="w-5 h-5 text-primary" />
          <h2 className="font-semibold">Bill of Materials</h2>
          <Badge variant="secondary">{filteredBOM.length} unique / {totalQty} total</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportCSV} className="text-xs"><Download className="w-3 h-3 mr-1" />CSV</Button>
          <Button variant="outline" size="sm" onClick={exportJSON} className="text-xs"><Download className="w-3 h-3 mr-1" />JSON</Button>
          <Button variant="outline" size="sm" onClick={handleDemoAudit} className="text-xs"><Search className="w-3 h-3 mr-1" />Audit demo BOM</Button>
          {components.length === 0 && (
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => {
                void import('../../lib/demo/demoBoard').then((m) => {
                  const board = m.buildDemoBoard();
                  useProjectStore.setState({ components: board.components, wires: board.wires, isDirty: true });
                });
              }}
            >
              <Package className="w-3 h-3 mr-1" />Load rectifier
            </Button>
          )}
          {onClose && <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close BOM panel"><X className="w-4 h-4" /></Button>}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3 p-4 border-b border-border">
        <Card><CardContent className="p-3">
          <div className="text-xl font-bold text-primary">{formattedCost}</div>
          <div className="text-xs text-muted-foreground">{costLabel}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-xl font-bold">{totalQty}</div>
          <div className="text-xs text-muted-foreground">Total Parts</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className={`text-xl font-bold ${obsoleteCount > 0 ? 'text-warning' : 'text-success'}`}>{obsoleteCount}</div>
          <div className="text-xs text-muted-foreground">Lifecycle Risks</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-xl font-bold text-info">{filteredBOM.length}</div>
          <div className="text-xs text-muted-foreground">Unique Line Items</div>
        </CardContent></Card>
      </div>

      {/* Demo BOM × fab audit: the verified rectifier parts list with MPNs. */}
      {demoAuditError && (
        <p role="alert" className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-xs text-destructive">
          Demo BOM audit failed: {demoAuditError}
        </p>
      )}
      {demoAudit && (
        <div className="border-b border-border p-4" aria-live="polite">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">Demo BOM × fab audit</h3>
              <p role="status" className="text-xs text-success">{demoAudit.verdict}</p>
              <p className="text-xs text-muted-foreground">{demoAudit.coverage}</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Dismiss demo BOM audit"
              onClick={() => setDemoAudit(null)}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead className="bg-muted/40">
                <tr>
                  {['Reference', 'Value', 'Footprint', 'Manufacturer', 'Part number'].map((label) => (
                    <th key={label} className="p-2 text-left font-medium text-muted-foreground">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {demoAudit.rows.map((row) => (
                  <tr key={row.reference} className="border-t border-border/50">
                    <td className="p-2 font-medium">{row.reference}</td>
                    <td className="p-2">{row.value}</td>
                    <td className="p-2 font-mono">{row.footprint}</td>
                    <td className="p-2 text-muted-foreground">{row.manufacturer}</td>
                    <td className="p-2 font-mono text-muted-foreground">{row.partNumber}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="space-y-2 border-b border-border p-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search parts, refs, value…" className="pl-8 h-8 text-xs" />
          </div>
          <div className="flex items-center gap-1">
            <Filter className="w-3.5 h-3.5 text-muted-foreground" />
            {LIFECYCLE_FILTERS.map(({ value, label }) => {
              const count = value === 'all' ? filteredBOM.length : lifecycleCounts[value]
              return (
                <Button
                  key={value}
                  variant={filterLifecycle === value ? 'default' : 'outline'}
                  size="sm"
                  className="h-7 text-xs px-2"
                  aria-pressed={filterLifecycle === value}
                  onClick={() => setFilterLifecycle(value)}
                >
                  {label}
                  <span className={filterLifecycle === value ? 'ml-1 opacity-80' : 'ml-1 text-muted-foreground'}>{count}</span>
                </Button>
              )
            })}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Lifecycle and availability are read from what each part declares — never inferred from a default.{' '}
          {lifecycleCounts.unknown === 0
            ? 'Every line item here carries a declared status.'
            : `${lifecycleCounts.unknown} of ${filteredBOM.length} line items carry none and show as Unverified: that is missing data, not a clean part, so confirm it with the manufacturer before ordering.`}{' '}
          Live supplier or stock checks would need a parts data source, which this build does not have.
        </p>
      </div>

      {/* Lifecycle risk banner */}
      {obsoleteCount > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 bg-warning/10 border-b border-warning/40 text-warning text-xs">
          <AlertTriangle className="w-3.5 h-3.5" />
          {obsoleteCount} part{obsoleteCount !== 1 ? 's' : ''} with NRND or Obsolete lifecycle status detected — review before production.
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {components.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <Package className="w-12 h-12 opacity-30" />
            <div className="text-sm">No components on canvas. Add components to the schematic to populate the BOM.</div>
          </div>
        ) : (
          <table className="w-full text-xs border-collapse">
            <thead className="bg-muted/50 sticky top-0">
              <tr>
                <ColHeader label="Qty" sk="qty" />
                <th className="text-left p-2 text-xs font-medium text-muted-foreground">References</th>
                <ColHeader label="Part" sk="partName" />
                <ColHeader label="Value" sk="value" />
                <ColHeader label="Package" sk="package" />
                <ColHeader label="Manufacturer" sk="manufacturer" />
                <ColHeader label="Part #" sk="partNumber" />
                <ColHeader label="Unit Cost" sk="unitCostUsd" />
                <ColHeader label="Total Cost" sk="totalCostUsd" />
                <ColHeader label="Lifecycle" sk="lifecycle" />
                <ColHeader label="Availability" sk="availability" />
                <th className="text-left p-2 text-xs font-medium text-muted-foreground">Notes</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {filteredBOM.map(item => (
                <tr key={item.key} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                  <td className="p-2 font-medium">{item.qty}</td>
                  <td className="p-2 text-muted-foreground max-w-[120px] truncate" title={item.references.join(', ')}>{item.references.slice(0, 3).join(', ')}{item.references.length > 3 && `…+${item.references.length - 3}`}</td>
                  <td className="p-2 font-medium">{item.partName}</td>
                  <td className="p-2">{item.value}</td>
                  <td className="p-2 font-mono">{item.package}</td>
                  <td className="p-2 text-muted-foreground">{item.manufacturer}</td>
                  <td className="p-2 font-mono text-muted-foreground">{item.partNumber}</td>
                  <td className="p-2">{item.unitCostUsd === null ? '—' : `$${item.unitCostUsd.toFixed(2)}`}</td>
                  <td className="p-2 font-medium">{item.totalCostUsd === null ? '—' : `$${item.totalCostUsd.toFixed(2)}`}</td>
                  <td className="p-2"><LifecycleBadge status={item.lifecycle} /></td>
                  <td className="p-2"><AvailBadge status={item.availability} /></td>
                  <td className="p-2 max-w-[160px]">
                    {editingKey === item.key ? (
                      <div className="flex gap-1">
                        <Input
                          value={editNotes}
                          onChange={e => setEditNotes(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') saveNotes(item, editNotes)
                            else if (e.key === 'Escape') setEditingKey(null)
                          }}
                          aria-label={`Notes for ${item.references.join(', ')}`}
                          placeholder="Applies to every instance in this row"
                          className="h-6 text-xs py-0"
                          autoFocus
                        />
                        <Button size="icon" className="h-6 w-6" onClick={() => saveNotes(item, editNotes)} aria-label={`Save notes for ${item.references.join(', ')}`}><Save className="w-3 h-3" /></Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEditingKey(null)} aria-label={`Discard note edit for ${item.references.join(', ')}`}><X className="w-3 h-3" /></Button>
                      </div>
                    ) : (
                      <span className="text-muted-foreground truncate block max-w-[150px]" title={item.notes || undefined}>{item.notes || '—'}</span>
                    )}
                  </td>
                  <td className="p-2">
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setEditingKey(item.key); setEditNotes(item.notes) }} aria-label={`Edit notes for ${item.references.join(', ')}`}>
                      <Edit3 className="w-3 h-3" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-muted/30 font-medium">
              <tr>
                <td className="p-2" colSpan={7}>Totals ({filteredBOM.length} line items, {totalQty} parts)</td>
                <td className="p-2">&nbsp;</td>
                <td className="p-2 font-bold">{formattedCost}</td>
                <td className="p-2" colSpan={4} />
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  )
}

export default BOMPanel
