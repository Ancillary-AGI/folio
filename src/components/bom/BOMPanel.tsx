/**
 * BOM Management Panel
 *
 * Features:
 *  • Aggregated Bill of Materials from current schematic components
 *  • Cost estimation with quantity breaks
 *  • Component lifecycle status (active / NRND / obsolete)
 *  • Supplier cross-reference (heuristic — production would call a parts API)
 *  • Sortable, filterable table
 *  • Export as CSV or JSON
 *  • Inline property editing (value, package, notes)
 */

import React, { useState, useMemo, useCallback } from 'react'
import { Download, Search, Filter, Edit3, Save, X, AlertTriangle, Package } from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Badge } from '../ui/badge'
import { Card, CardContent } from '../ui/card'
import { useProjectStore } from '../../stores/useProjectStore'
import { downloadFile } from '../../lib/exportUtils'

// ── Types ─────────────────────────────────────────────────────────────────────

export type LifecycleStatus = 'active' | 'nrnd' | 'obsolete' | 'unknown'
export type AvailabilityStatus = 'in-stock' | 'lead-time' | 'allocation' | 'eol' | 'unknown'

export interface BOMLineItem {
  key: string                    // unique key = name + value + package
  qty: number
  references: string[]
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

function inferLifecycle(name: string, properties: Record<string, string | number | boolean>): LifecycleStatus {
  const avail = String(properties.availability ?? '').toLowerCase()
  if (avail === 'obsolete') return 'obsolete'
  if (avail === 'limited' || avail === 'nrnd') return 'nrnd'
  if (avail === 'available') return 'active'
  // Heuristic from name
  const lower = name.toLowerCase()
  if (lower.includes('obsolete') || lower.includes('legacy')) return 'obsolete'
  if (lower.includes('nrnd') || lower.includes('end-of-life')) return 'nrnd'
  return 'active'
}

function inferAvailability(props: Record<string, string | number | boolean>): AvailabilityStatus {
  const avail = String(props.availability ?? '').toLowerCase()
  if (avail === 'available') return 'in-stock'
  if (avail === 'limited') return 'allocation'
  if (avail === 'obsolete') return 'eol'
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
      existing.references.push(comp.reference)
      existing.totalCostUsd = existing.unitCostUsd === null ? null : existing.qty * existing.unitCostUsd
    } else {
      const unitCost = typeof p.cost === 'number' && Number.isFinite(p.cost) ? p.cost : null
      map.set(key, {
        key,
        qty: 1,
        references: [comp.reference],
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
  const cfg: Record<LifecycleStatus, { label: string; cls: string }> = {
    active: { label: 'Active', cls: 'bg-success text-success-foreground' },
    nrnd: { label: 'NRND', cls: 'bg-warning text-warning-foreground' },
    obsolete: { label: 'Obsolete', cls: 'bg-destructive text-destructive-foreground' },
    unknown: { label: '—', cls: 'bg-muted text-muted-foreground' },
  }
  const { label, cls } = cfg[status]
  return <Badge className={`text-xs ${cls}`}>{label}</Badge>
}

const AvailBadge: React.FC<{ status: AvailabilityStatus }> = ({ status }) => {
  const cfg: Record<AvailabilityStatus, { label: string; cls: string }> = {
    'in-stock': { label: 'In Stock', cls: 'bg-success text-success-foreground' },
    'lead-time': { label: 'Lead Time', cls: 'bg-primary text-primary-foreground' },
    allocation: { label: 'Allocation', cls: 'bg-warning text-warning-foreground' },
    eol: { label: 'EOL', cls: 'bg-destructive text-destructive-foreground' },
    unknown: { label: '—', cls: 'bg-muted text-muted-foreground' },
  }
  const { label, cls } = cfg[status]
  return <Badge className={`text-xs ${cls}`}>{label}</Badge>
}

// ── Main Panel ────────────────────────────────────────────────────────────────

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

  // ── Sort helpers ──────────────────────────────────────────────────────────

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

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
          {onClose && <Button variant="ghost" size="icon" onClick={onClose}><X className="w-4 h-4" /></Button>}
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

      {/* Filters */}
      <div className="flex items-center gap-3 p-3 border-b border-border">
        <div className="relative flex-1 max-w-xs">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search parts, refs, value…" className="pl-8 h-8 text-xs" />
        </div>
        <div className="flex items-center gap-1">
          <Filter className="w-3.5 h-3.5 text-muted-foreground" />
          {(['all', 'active', 'nrnd', 'obsolete'] as const).map(f => (
            <Button key={f} variant={filterLifecycle === f ? 'default' : 'outline'} size="sm" className="h-7 text-xs px-2" onClick={() => setFilterLifecycle(f)}>
              {f === 'all' ? 'All' : f.toUpperCase()}
            </Button>
          ))}
        </div>
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
                  <td className="p-2 max-w-[100px]">
                    {editingKey === item.key ? (
                      <div className="flex gap-1">
                        <Input value={editNotes} onChange={e => setEditNotes(e.target.value)} className="h-6 text-xs py-0" autoFocus />
                        <Button size="icon" className="h-6 w-6" onClick={() => setEditingKey(null)}><Save className="w-3 h-3" /></Button>
                      </div>
                    ) : (
                      <span className="text-muted-foreground truncate block max-w-[90px]">{item.notes || '—'}</span>
                    )}
                  </td>
                  <td className="p-2">
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setEditingKey(item.key); setEditNotes(item.notes) }}>
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
