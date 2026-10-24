/**
 * DatasheetImporter — drag-a-PDF/paste-text → instant schematic component.
 *
 * Flow:
 *  1. User pastes raw datasheet text, drops a PDF, or enters a Digi-Key / LCSC
 *     part number (URL fetch on click).
 *  2. parseDatasheetText() or a URL-based extractor produces IngestedDatasheet.
 *  3. synthesizeComponentFromDatasheet() builds a component + footprint + SPICE stub.
 *  4. User can edit pin assignments in a table before confirming.
 *  5. On confirm, the component is added to the local library and placed in
 *     the current schematic.
 */

import { useState, useRef } from 'react'
import { Upload, FileText, Link, Plus, CheckCircle, AlertCircle, Cpu, Zap } from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { parseDatasheetText, synthesizeComponentFromDatasheet, type IngestedDatasheet } from '../../lib/ai/datasheetParser'
import { searchVendorModels, type VendorModelEntry } from '../../lib/simulation/vendorModels'
import { useDemoRequest } from '../workspace/useDemoRequest'
import { DEMO_DATASHEET_TEXT } from '../../lib/demo/demoDatasheet'

interface PinRow {
  number: number
  name: string
  kind: string
  description: string
}

interface DatasheetImporterProps {
  onPartAdded?: (part: { name: string; spiceText: string }) => void
  onClose?: () => void
}

export default function DatasheetImporter({ onPartAdded, onClose }: DatasheetImporterProps) {
  const [tab, setTab] = useState<'paste' | 'url' | 'search'>('paste')
  const [rawText, setRawText] = useState('')
  const [urlInput, setUrlInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [ingestedData, setIngestedData] = useState<IngestedDatasheet | null>(null)
  const [synthesized, setSynthesized] = useState<ReturnType<typeof synthesizeComponentFromDatasheet> | null>(null)
  const [pinRows, setPinRows] = useState<PinRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [vendorResults, setVendorResults] = useState<VendorModelEntry[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const parseDatasheet = (text: string) => {
    setError(null)
    try {
      const data = parseDatasheetText(text)
      setIngestedData(data)
      setPinRows(data.pins.map(p => ({
        number: p.number,
        name: p.name,
        kind: p.kind,
        description: p.description ?? '',
      })))
      const syn = synthesizeComponentFromDatasheet(data)
      setSynthesized(syn)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Parse failed')
    }
  }

  const handleParse = () => parseDatasheet(rawText)

  // Seed the Parts demo with a real datasheet and run the importer immediately
  // so the card lands on extracted pins, a synthesized symbol and a SPICE stub.
  useDemoRequest('datasheet-demo', () => {
    setTab('paste')
    setRawText(DEMO_DATASHEET_TEXT)
    parseDatasheet(DEMO_DATASHEET_TEXT)
  })

  const handleUrlFetch = async () => {
    if (!urlInput.trim()) return
    setLoading(true)
    setError(null)
    try {
      // In browser: proxy via a cors-anywhere or a local companion.
      // For now try fetch and fall back with instructions.
      const resp = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(urlInput)}`)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const text = await resp.text()
      // Strip HTML if it looks like a web page
      const stripped = text.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ')
      setRawText(stripped.slice(0, 20000))
      setTab('paste')
    } catch (err) {
      setError(`Could not fetch URL: ${err instanceof Error ? err.message : 'Unknown error'}. Try pasting the datasheet text directly.`)
    } finally {
      setLoading(false)
    }
  }

  const handleFileRead = (file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      setRawText(text.slice(0, 50000))
      setTab('paste')
    }
    reader.readAsText(file)
  }

  const handleSearch = () => {
    const results = searchVendorModels(searchQuery)
    setVendorResults(results.slice(0, 20))
  }

  const handleSelectVendorModel = (entry: VendorModelEntry) => {
    setSynthesized(null)
    setIngestedData(null)
    setError(null)
    onPartAdded?.({ name: entry.name, spiceText: entry.spiceText })
  }

  const handleConfirm = () => {
    if (!synthesized) return
    onPartAdded?.({ name: synthesized.component.name, spiceText: synthesized.spiceSubcircuit })
  }

  const updatePinRow = (index: number, field: keyof PinRow, value: string) => {
    setPinRows(prev => prev.map((row, i) => i === index ? { ...row, [field]: value } : row))
  }

  return (
    <div className="flex flex-col h-full bg-background text-foreground overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Cpu size={16} className="text-primary" />
          <span className="font-semibold text-sm">Import Component from Datasheet</span>
        </div>
        {onClose && (
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close datasheet importer" className="text-muted-foreground hover:text-foreground">✕</Button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border shrink-0">
        {(['paste', 'url', 'search'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-xs font-medium capitalize transition-colors ${
              tab === t ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t === 'paste' ? 'Paste / Upload' : t === 'url' ? 'URL / Part#' : 'Built-in Library'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* Paste / Upload tab */}
        {tab === 'paste' && (
          <div className="space-y-3">
            {/* Drop zone */}
            <button
              type="button"
              className="w-full cursor-pointer rounded-lg border-2 border-dashed border-border p-4 text-center transition-colors hover:border-primary"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFileRead(f) }}
            >
              <Upload size={20} className="mx-auto mb-1 text-muted-foreground" />
              <span className="block text-xs text-muted-foreground">Drop a .txt / .pdf text file here or click to browse</span>
            </button>
            <input ref={fileInputRef} type="file" accept=".txt,.csv,.md" aria-label="Upload datasheet text file" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFileRead(f) }} />

            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Datasheet text</Label>
              <textarea
                className="w-full h-48 bg-card text-foreground text-xs font-mono p-2 rounded border border-border focus:border-primary resize-none outline-none"
                placeholder="Paste datasheet text here — pinout tables, electrical specs, package info..."
                value={rawText}
                onChange={e => setRawText(e.target.value)}
              />
            </div>

            <Button size="sm" onClick={handleParse} disabled={!rawText.trim()}
              className="w-full bg-primary hover:bg-primary/90">
              <FileText size={14} className="mr-1" /> Parse Datasheet
            </Button>
          </div>
        )}

        {/* URL tab */}
        {tab === 'url' && (
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Datasheet URL or part number</Label>
              <div className="flex gap-2">
                <Input
                  className="flex-1 bg-card border-border text-sm"
                  placeholder="https://www.ti.com/lit/ds/… or LCSC: C123456"
                  value={urlInput}
                  onChange={e => setUrlInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleUrlFetch()}
                />
                <Button size="sm" onClick={handleUrlFetch} disabled={loading || !urlInput.trim()}>
                  <Link size={14} className="mr-1" />
                  {loading ? 'Fetching…' : 'Fetch'}
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              After fetching, you can review and edit the extracted text before parsing.
              For PDFs, paste the text content manually.
            </p>
          </div>
        )}

        {/* Built-in library search tab */}
        {tab === 'search' && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input
                className="flex-1 bg-card border-border text-sm"
                placeholder="Search: 2N3904, LM741, IRF540, 1N4148…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
              />
              <Button size="sm" onClick={handleSearch}>Search</Button>
            </div>

            {vendorResults.length > 0 && (
              <div className="space-y-1.5">
                {vendorResults.map(entry => (
                  <div key={entry.name}
                    className="flex items-center justify-between bg-card rounded p-2.5 hover:bg-accent cursor-pointer"
                    onClick={() => handleSelectVendorModel(entry)}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm text-foreground">{entry.name}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          entry.category === 'bjt' ? 'bg-warning/15 text-warning' :
                          entry.category === 'mosfet' ? 'bg-primary/15 text-primary' :
                          entry.category === 'diode' ? 'bg-success/15 text-success' :
                          entry.category === 'opamp' ? 'bg-chart-4/15 text-chart-4' :
                          'bg-muted text-foreground'
                        }`}>{entry.category.toUpperCase()}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{entry.description}</p>
                      <p className="text-xs text-muted-foreground">{entry.manufacturer} · {entry.footprint}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Select ${entry.name}`}
                      className="text-primary hover:text-primary shrink-0"
                    >
                      <Plus size={14} />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {vendorResults.length === 0 && searchQuery && (
              <p className="text-xs text-muted-foreground text-center py-4">
                No built-in models matched. Try the Paste tab with a datasheet.
              </p>
            )}

            {!searchQuery && (
              <p className="text-xs text-muted-foreground text-center py-4">
                Search the built-in vendor model library — 2N3904, LM741, IRF540N, NE555, and more.
              </p>
            )}
          </div>
        )}

        {/* Error display */}
        {error && (
          <div className="flex items-start gap-2 bg-destructive/10 border border-destructive/50 rounded p-3 text-xs text-destructive">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Parsed result */}
        {ingestedData && !error && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-success text-xs">
              <CheckCircle size={14} />
              <span>Parsed: <strong>{ingestedData.partNumber}</strong> by {ingestedData.manufacturer}</span>
            </div>

            {/* Summary */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-card rounded p-2">
                <p className="text-muted-foreground mb-1">Package</p>
                <p className="text-foreground">{ingestedData.packaging.packageName} ({ingestedData.packaging.pinCount} pins)</p>
              </div>
              <div className="bg-card rounded p-2">
                <p className="text-muted-foreground mb-1">Supply</p>
                <p className="text-foreground">
                  {ingestedData.electrical.minSupplyVoltageV ?? '?'}–{ingestedData.electrical.maxSupplyVoltageV ?? '?'} V
                </p>
              </div>
            </div>

            {/* Pin editor */}
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Pin assignments (edit before import)</p>
              <div className="max-h-48 overflow-y-auto rounded border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-card sticky top-0">
                    <tr>
                      <th className="text-left px-2 py-1 text-muted-foreground">#</th>
                      <th className="text-left px-2 py-1 text-muted-foreground">Name</th>
                      <th className="text-left px-2 py-1 text-muted-foreground">Kind</th>
                      <th className="text-left px-2 py-1 text-muted-foreground">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pinRows.map((row, i) => (
                      <tr key={i} className="border-t border-border/50">
                        <td className="px-2 py-1 text-muted-foreground">{row.number}</td>
                        <td className="px-2 py-1">
                          <input
                            className="bg-transparent w-full outline-none text-foreground focus:text-primary"
                            value={row.name}
                            onChange={e => updatePinRow(i, 'name', e.target.value)}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <select
                            className="bg-muted text-foreground rounded text-xs outline-none"
                            value={row.kind}
                            onChange={e => updatePinRow(i, 'kind', e.target.value)}
                          >
                            {['power','ground','input','output','bidirectional','passive'].map(k => (
                              <option key={k} value={k}>{k}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-1 text-muted-foreground">
                          <input
                            className="bg-transparent w-full outline-none"
                            value={row.description}
                            onChange={e => updatePinRow(i, 'description', e.target.value)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* SPICE stub preview */}
            {synthesized && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Generated SPICE stub</p>
                <pre className="bg-card rounded p-2 text-xs text-success overflow-x-auto max-h-24">
                  {synthesized.spiceSubcircuit.slice(0, 400)}
                </pre>
              </div>
            )}

            <Button onClick={handleConfirm} className="w-full bg-success hover:bg-success/90 text-sm">
              <Zap size={14} className="mr-1" />
              Add to Component Library
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
