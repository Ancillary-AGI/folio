/**
 * DatasheetImporter — paste text or drop a text file → instant schematic component.
 *
 * Flow:
 *  1. User pastes raw datasheet text, drops a text-file, or enters a Digi-Key /
 *     LCSC part number (fetched through a public CORS proxy — see the URL tab).
 *  2. parseDatasheetText() or a URL-based extractor produces IngestedDatasheet.
 *  3. synthesizeComponentFromDatasheet() builds a component + footprint + SPICE stub.
 *  4. User can edit pin assignments in a table; the preview follows the edits.
 *  5. On confirm, the component joins this session's library and one instance is
 *     placed on the schematic at the next free grid slot.
 *
 * A PDF cannot be read here — there is no in-browser PDF text extractor in this
 * build, and the drop zone says so rather than feeding binary noise to the parser.
 */

import { useState, useRef, useMemo } from 'react'
import { Upload, FileText, Link, Plus, CheckCircle, AlertCircle, Cpu, Zap } from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import {
  parseDatasheetText,
  synthesizeComponentFromDatasheet,
  type ExtractedPin,
  type IngestedDatasheet,
} from '../../lib/ai/datasheetParser'
import { parseSpiceModelLibrary } from '../../lib/simulation/modelLibrary'
import { searchVendorModels, type VendorModelEntry } from '../../lib/simulation/vendorModels'
import { useProjectStore } from '../../stores/useProjectStore'
import { useDemoRequest } from '../workspace/useDemoRequest'
import { generateId } from '../../lib/utils'
import { DEMO_DATASHEET_TEXT } from '../../lib/demo/demoDatasheet'

interface PinRow {
  number: number
  name: string
  kind: string
  description: string
}

/** Pin kinds the symbol and the solver understand; the table offers exactly these. */
const PIN_KINDS: readonly ExtractedPin['kind'][] = ['power', 'ground', 'input', 'output', 'bidirectional', 'passive']

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
  const [pinRows, setPinRows] = useState<PinRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [vendorResults, setVendorResults] = useState<VendorModelEntry[]>([])
  const [vendorPick, setVendorPick] = useState<{ name: string; text: string; cards: string[] } | null>(null)
  const [placedNote, setPlacedNote] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  /**
   * The pin table is the editable source of truth for the symbol: a blanked
   * name or description falls back to the parsed value rather than deleting the
   * pin label, and the kind comes from a select limited to the six the solver
   * understands.
   */
  const editedPins = useMemo<ExtractedPin[]>(() => {
    if (!ingestedData) return []
    return ingestedData.pins.map((pin, index) => {
      const row = pinRows[index]
      if (!row) return pin
      return {
        ...pin,
        name: row.name.trim() || pin.name,
        kind: row.kind as ExtractedPin['kind'],
        description: row.description.trim() || pin.description,
      }
    })
  }, [ingestedData, pinRows])

  /** Derived from the edited pins, so the preview is always the part placed. */
  const synthesized = useMemo(
    () => (ingestedData ? synthesizeComponentFromDatasheet({ ...ingestedData, pins: editedPins }) : null),
    [ingestedData, editedPins],
  )

  const parseDatasheet = (text: string) => {
    setError(null)
    setPlacedNote(null)
    try {
      const data = parseDatasheetText(text)
      setIngestedData(data)
      setPinRows(data.pins.map(p => ({
        number: p.number,
        name: p.name,
        kind: p.kind,
        description: p.description ?? '',
      })))
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
    setPlacedNote(null)
    try {
      // The request is relayed through a public CORS proxy, so the datasheet URL
      // leaves this browser and is visible to that third service. Not for NDA parts.
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
    setError(null)
    setPlacedNote(null)
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      setError(`${file.name}: this build has no PDF text extractor, so the drop cannot read it. Open the datasheet, copy its pin table and ratings text, and paste that in the Paste tab.`)
      return
    }
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
    setIngestedData(null)
    setPinRows([])
    setError(null)
    setPlacedNote(null)
    // A vendor card carries a model line, not a symbol, so it cannot become a
    // schematic part here. Validate it with the parser the simulator uses and
    // hand the text to the model deck instead of pretending it was installed.
    const parsed = parseSpiceModelLibrary(entry.spiceText)
    if (parsed.models.size === 0) {
      setVendorPick(null)
      setError(`${entry.name}: no parsable .model card here (${parsed.errors.join(' ') || 'subcircuit-only text'}). Its SPICE text can still be pasted into the Simulation model deck.`)
      return
    }
    setVendorPick({ name: entry.name, text: entry.spiceText, cards: Array.from(parsed.models.keys()) })
    onPartAdded?.({ name: entry.name, spiceText: entry.spiceText })
  }

  const handleConfirm = () => {
    if (!synthesized || !ingestedData) return
    const componentId = synthesized.component.id
      ?? `comp-${synthesized.component.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
    const component = { ...synthesized.component, id: componentId }

    const store = useProjectStore.getState()
    store.setComponentLibrary([
      ...store.componentLibrary.filter(existing => existing.id !== componentId),
      component,
    ])

    // Not a canvas drop, so the instance takes the next free grid slot rather
    // than landing under the cursor or on top of an existing part.
    const slot = store.components.length
    const instance = {
      id: generateId('comp'),
      componentId,
      component,
      x: 100 + (slot % 5) * 120,
      y: 120 + Math.floor(slot / 5) * 100,
      rotation: 0,
      reference: `${component.name.charAt(0)}${slot + 1}`,
      properties: { ...component.default_properties },
    }
    store.addComponent(instance)

    setPlacedNote(`Added ${component.name} to this session's library and placed ${instance.reference} at ${instance.x}, ${instance.y} on the sheet.`)
    onPartAdded?.({ name: component.name, spiceText: synthesized.spiceSubcircuit })
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
          <h2 className="text-sm font-semibold">Import Component from Datasheet</h2>
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
              <span className="block text-xs text-muted-foreground">Drop a .txt / .csv / .md file here or click to browse — PDF text must be pasted</span>
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
              Fetching sends the URL through a public CORS proxy, so the request is visible to that third
              service — do not use it for NDA-protected documents. The fetched text lands in the Paste tab,
              where you can review and edit it before parsing. PDFs have to be pasted by hand: this build
              reads text files only.
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
                            aria-label={`Pin ${row.number} name`}
                            className="bg-transparent w-full outline-none text-foreground focus:text-primary"
                            value={row.name}
                            onChange={e => updatePinRow(i, 'name', e.target.value)}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <select
                            aria-label={`Pin ${row.number} kind`}
                            className="bg-muted text-foreground rounded text-xs outline-none"
                            value={row.kind}
                            onChange={e => updatePinRow(i, 'kind', e.target.value)}
                          >
                            {PIN_KINDS.map(k => (
                              <option key={k} value={k}>{k}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-1 text-muted-foreground">
                          <input
                            aria-label={`Pin ${row.number} description`}
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
              Add to Component Library and Place
            </Button>
            {placedNote && (
              <p role="status" className="text-xs text-success">{placedNote}</p>
            )}
          </div>
        )}

        {vendorPick && (
          <div className="space-y-1 rounded border border-success/40 bg-success/10 p-3 text-xs text-success">
            <p className="font-medium">{vendorPick.name}: {vendorPick.cards.length} .model card(s) parsed — {vendorPick.cards.join(', ')}.</p>
            <p className="text-muted-foreground">
              A model card is not a schematic symbol, so nothing was placed. Copy these lines into the
              Simulation panel's model deck to run the device:
            </p>
            <pre className="max-h-24 overflow-x-auto rounded bg-card p-2 text-xs text-foreground">{vendorPick.text.slice(0, 400)}</pre>
          </div>
        )}
      </div>
    </div>
  )
}
