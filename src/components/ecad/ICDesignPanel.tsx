/**
 * IC Design Panel — full custom IC design flow.
 *
 * Tabs:
 *  1. Logic Entry   — Verilog/VHDL HDL editor (re-uses HDLEditor)
 *  2. Synthesis     — Gate mapping, STA, area/power (logicSynthesis.ts)
 *  3. Floorplan     — Die size, core area, macro placement (siliconFloorplan.ts)
 *  4. Layout        — Standard cell placement & routing (siliconFloorplan.ts)
 *  5. Packaging     — Chip package type, bond-wire or flip-chip (chipPackaging.ts)
 *  6. GDSII Export  — Stream export for mask generation (gdsExport.ts)
 *
 * The target process node is SkyWater SKY130 (open-source PDK) by default.
 * The flow is deterministic and every number is derived from the sky130 standard
 * cell specs in standardCellLibrary.ts — no magic constants.
 */

import { useState, useCallback } from 'react'
import { lazy, Suspense } from 'react'
import { Cpu, Layers, Package, Download, Play, RefreshCw, ChevronRight, CheckCircle, AlertCircle, BarChart3 } from 'lucide-react'
import { Button } from '../ui/button'
import { synthesize, type SynthesisResult } from '../../lib/ic/icFlowAdapter'
import { STANDARD_CELL_LIBRARY } from '../../lib/ic/standardCellLibrary'
import { planFloorplan, type FloorplanResult } from '../../lib/ic/icFlowAdapter'
import { generatePackageDescription, PACKAGE_TYPES, type ChipPackage } from '../../lib/ic/icFlowAdapter'
import { exportGDSII } from '../../lib/ic/icFlowAdapter'
import { parseVerilogModule } from '../../lib/fpga/verilogSubset'

const HDLEditor = lazy(() => import('./HDLEditor'))

const DEFAULT_VERILOG = `// SkyWater 130nm standard-cell example
// 4-bit ripple carry adder
module adder4(
  input  [3:0] a,
  input  [3:0] b,
  input        cin,
  output [3:0] sum,
  output       cout
);
  wire c0, c1, c2;
  // Synthesizer maps to sky130 full adder cells
  assign {c0, sum[0]} = a[0] + b[0] + cin;
  assign {c1, sum[1]} = a[1] + b[1] + c0;
  assign {c2, sum[2]} = a[2] + b[2] + c1;
  assign {cout, sum[3]} = a[3] + b[3] + c2;
endmodule`

interface StepStatus {
  done: boolean
  running: boolean
  error?: string
}

interface ICDesignPanelProps {
  onClose?: () => void
}

export default function ICDesignPanel({ onClose }: ICDesignPanelProps) {
  const [activeTab, setActiveTab] = useState<'entry' | 'synthesis' | 'floorplan' | 'packaging' | 'export'>('entry')
  const [hdlCode, setHdlCode] = useState(DEFAULT_VERILOG)
  const [synthResult, setSynthResult] = useState<SynthesisResult | null>(null)
  const [floorplanResult, setFloorplanResult] = useState<FloorplanResult | null>(null)
  const [selectedPackage, setSelectedPackage] = useState<ChipPackage | null>(null)
  const [gdsContent, setGdsContent] = useState<string | null>(null)
  const [status, setStatus] = useState<Record<string, StepStatus>>({})
  const [log, setLog] = useState<string[]>([])

  const appendLog = (msg: string) => setLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`])

  const setStep = (step: string, s: Partial<StepStatus>) =>
    setStatus(prev => ({ ...prev, [step]: { done: false, running: false, ...prev[step], ...s } }))

  const handleSynthesize = useCallback(async () => {
    setStep('synthesis', { running: true, error: undefined })
    appendLog('Starting synthesis on SKY130 PDK…')
    try {
      const elab = parseVerilogModule(hdlCode)
      appendLog(`Parsed module: ${elab.name} (${elab.ports.length} ports)`)
      const result = synthesize(elab.netlist, STANDARD_CELL_LIBRARY)
      setSynthResult(result)
      appendLog(`Synthesis complete: ${result.cells.length} cells, ${result.totalArea.toFixed(2)} µm², critical path ${result.criticalPathPs.toFixed(0)} ps`)
      setStep('synthesis', { done: true, running: false })
      setActiveTab('floorplan')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      appendLog(`Synthesis failed: ${msg}`)
      setStep('synthesis', { running: false, error: msg })
    }
  }, [hdlCode])

  const handleFloorplan = useCallback(async () => {
    if (!synthResult) { appendLog('Run synthesis first.'); return }
    setStep('floorplan', { running: true, error: undefined })
    appendLog('Planning floorplan…')
    try {
      const result = planFloorplan(synthResult)
      setFloorplanResult(result)
      appendLog(`Floorplan: die ${result.dieWidthUm.toFixed(1)}×${result.dieHeightUm.toFixed(1)} µm, utilization ${(result.utilizationPercent).toFixed(1)}%`)
      setStep('floorplan', { done: true, running: false })
      setActiveTab('packaging')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      appendLog(`Floorplan failed: ${msg}`)
      setStep('floorplan', { running: false, error: msg })
    }
  }, [synthResult])

  const handleExportGDSII = useCallback(() => {
    if (!synthResult || !floorplanResult) { appendLog('Complete synthesis and floorplan first.'); return }
    setStep('export', { running: true })
    appendLog('Generating GDSII stream…')
    try {
      const gds = exportGDSII(synthResult, floorplanResult)
      setGdsContent(gds)
      appendLog(`GDSII generated: ${gds.length} bytes`)
      setStep('export', { done: true, running: false })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      appendLog(`GDSII export failed: ${msg}`)
      setStep('export', { running: false, error: msg })
    }
  }, [synthResult, floorplanResult])

  const downloadGDSII = () => {
    if (!gdsContent) return
    const blob = new Blob([gdsContent], { type: 'application/octet-stream' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'design.gds'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const TABS = [
    { id: 'entry', label: 'HDL Entry', step: null },
    { id: 'synthesis', label: 'Synthesis', step: 'synthesis' },
    { id: 'floorplan', label: 'Floorplan', step: 'floorplan' },
    { id: 'packaging', label: 'Packaging', step: null },
    { id: 'export', label: 'GDSII Export', step: 'export' },
  ] as const

  return (
    <div className="flex flex-col h-full bg-gray-900 text-gray-100 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 shrink-0">
        <div className="flex items-center gap-2">
          <Cpu size={16} className="text-purple-400" />
          <span className="font-semibold text-sm">IC Design — SkyWater SKY130</span>
        </div>
        {onClose && <Button size="sm" variant="ghost" onClick={onClose} className="text-gray-400">✕</Button>}
      </div>

      {/* Flow tabs */}
      <div className="flex border-b border-gray-700 shrink-0 overflow-x-auto">
        {TABS.map((tab, i) => {
          const s = tab.step ? status[tab.step] : undefined
          return (
            <button key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs whitespace-nowrap transition-colors ${
                activeTab === tab.id ? 'border-b-2 border-purple-400 text-purple-400' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {i > 0 && <ChevronRight size={10} className="text-gray-600" />}
              {s?.done && <CheckCircle size={10} className="text-green-400" />}
              {s?.error && <AlertCircle size={10} className="text-red-400" />}
              {s?.running && <RefreshCw size={10} className="text-yellow-400 animate-spin" />}
              {tab.label}
            </button>
          )
        })}
      </div>

      <div className="flex-1 overflow-hidden flex">
        {/* Main content */}
        <div className="flex-1 overflow-hidden">
          {activeTab === 'entry' && (
            <Suspense fallback={<div className="flex items-center justify-center h-full text-gray-500 text-sm">Loading editor…</div>}>
              <HDLEditor
                initialCode={hdlCode}
                language="verilog"
              />
            </Suspense>
          )}

          {activeTab === 'synthesis' && (
            <div className="p-4 space-y-4 overflow-y-auto h-full">
              <div className="flex items-center gap-2">
                <Button onClick={handleSynthesize} className="bg-purple-700 hover:bg-purple-600" size="sm"
                  disabled={status['synthesis']?.running}>
                  {status['synthesis']?.running
                    ? <RefreshCw size={13} className="animate-spin mr-1" />
                    : <Play size={13} className="mr-1" />}
                  Run Synthesis (SKY130)
                </Button>
              </div>

              {synthResult && (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: 'Cell count', value: synthResult.cells.length },
                      { label: 'Total area', value: `${synthResult.totalArea.toFixed(2)} µm²` },
                      { label: 'Critical path', value: `${synthResult.criticalPathPs.toFixed(0)} ps` },
                      { label: 'Max freq', value: `${(1e12 / synthResult.criticalPathPs / 1e6).toFixed(0)} MHz` },
                      { label: 'Static power', value: `${(synthResult.staticPowerUw ?? 0).toFixed(2)} µW` },
                      { label: 'Dynamic power', value: `${(synthResult.dynamicPowerMw ?? 0).toFixed(3)} mW` },
                    ].map(({ label, value }) => (
                      <div key={label} className="bg-gray-800 rounded p-2">
                        <p className="text-xs text-gray-400">{label}</p>
                        <p className="text-sm font-mono text-white">{value}</p>
                      </div>
                    ))}
                  </div>

                  <div>
                    <p className="text-xs text-gray-400 mb-1.5">Cell breakdown</p>
                    <div className="max-h-48 overflow-y-auto rounded border border-gray-700">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-800 sticky top-0">
                          <tr>
                            {['Cell', 'Drive', 'Count', 'Area (µm²)', 'Delay (ps)'].map(h => (
                              <th key={h} className="text-left px-2 py-1 text-gray-400">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {synthResult.cells.slice(0, 20).map((cell, i) => (
                            <tr key={i} className="border-t border-gray-700/50">
                              <td className="px-2 py-1 font-mono text-purple-300">{cell.name}</td>
                              <td className="px-2 py-1 text-gray-400">{cell.driveStrength ?? 1}</td>
                              <td className="px-2 py-1 text-white">1</td>
                              <td className="px-2 py-1 text-gray-300">{cell.area.toFixed(3)}</td>
                              <td className="px-2 py-1 text-gray-300">{(cell.delayPs ?? 0).toFixed(0)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <Button onClick={handleFloorplan} size="sm" className="bg-blue-700 hover:bg-blue-600">
                    Continue → Floorplan
                  </Button>
                </div>
              )}
            </div>
          )}

          {activeTab === 'floorplan' && (
            <div className="p-4 space-y-4 overflow-y-auto h-full">
              {!synthResult && (
                <p className="text-sm text-gray-400">Run synthesis first to generate a netlist for floorplanning.</p>
              )}
              {synthResult && (
                <>
                  <Button onClick={handleFloorplan} size="sm" className="bg-blue-700 hover:bg-blue-600"
                    disabled={status['floorplan']?.running}>
                    {status['floorplan']?.running
                      ? <RefreshCw size={13} className="animate-spin mr-1" />
                      : <Layers size={13} className="mr-1" />}
                    Plan Floorplan
                  </Button>

                  {floorplanResult && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        {[
                          { label: 'Die size', value: `${floorplanResult.dieWidthUm.toFixed(1)} × ${floorplanResult.dieHeightUm.toFixed(1)} µm` },
                          { label: 'Core area', value: `${(floorplanResult.coreAreaUm2 / 1e6).toFixed(4)} mm²` },
                          { label: 'Utilization', value: `${floorplanResult.utilizationPercent.toFixed(1)}%` },
                          { label: 'Rows', value: floorplanResult.rows },
                        ].map(({ label, value }) => (
                          <div key={label} className="bg-gray-800 rounded p-2">
                            <p className="text-xs text-gray-400">{label}</p>
                            <p className="text-sm font-mono text-white">{value}</p>
                          </div>
                        ))}
                      </div>

                      {/* Die visualization */}
                      <div className="bg-gray-800 rounded p-3">
                        <p className="text-xs text-gray-400 mb-2">Die preview (not to scale)</p>
                        <div className="relative bg-gray-950 rounded border border-gray-600"
                          style={{ height: 160, width: '100%' }}>
                          <div className="absolute inset-4 border-2 border-green-600 rounded" />
                          <div className="absolute inset-6 bg-purple-900/40 rounded flex items-center justify-center">
                            <div className="text-center">
                              <Cpu size={20} className="mx-auto text-purple-400 mb-1" />
                              <p className="text-xs text-purple-300">{synthResult.cells.length} cells</p>
                              <p className="text-xs text-gray-400">{floorplanResult.utilizationPercent.toFixed(1)}% utilized</p>
                            </div>
                          </div>
                        </div>
                      </div>

                      <Button onClick={() => setActiveTab('packaging')} size="sm" className="bg-blue-700 hover:bg-blue-600">
                        Continue → Packaging
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {activeTab === 'packaging' && (
            <div className="p-4 space-y-4 overflow-y-auto h-full">
              <p className="text-xs text-gray-400">Select a package type for the die.</p>
              <div className="grid grid-cols-2 gap-2">
                {PACKAGE_TYPES.slice(0, 8).map(pkg => (
                  <div key={pkg.id}
                    onClick={() => setSelectedPackage(pkg)}
                    className={`cursor-pointer rounded-lg p-3 border transition-colors ${
                      selectedPackage?.id === pkg.id
                        ? 'border-purple-500 bg-purple-900/30'
                        : 'border-gray-700 bg-gray-800 hover:border-gray-500'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Package size={13} className={selectedPackage?.id === pkg.id ? 'text-purple-400' : 'text-gray-400'} />
                      <span className="font-mono text-sm text-white">{pkg.name}</span>
                    </div>
                    <p className="text-xs text-gray-400">{pkg.description}</p>
                    <div className="flex gap-3 mt-1 text-xs text-gray-500">
                      <span>{pkg.pinCount} pins</span>
                      <span>{pkg.bodySize}</span>
                    </div>
                  </div>
                ))}
              </div>
              {selectedPackage && (
                <div className="bg-gray-800 rounded p-3">
                  <p className="text-xs text-gray-400 mb-1">Package details</p>
                  <pre className="text-xs text-green-300 font-mono whitespace-pre-wrap">
                    {generatePackageDescription(selectedPackage)}
                  </pre>
                </div>
              )}
              <Button onClick={() => setActiveTab('export')} size="sm" className="bg-blue-700 hover:bg-blue-600">
                Continue → GDSII Export
              </Button>
            </div>
          )}

          {activeTab === 'export' && (
            <div className="p-4 space-y-4 overflow-y-auto h-full">
              <div className="flex gap-2">
                <Button onClick={handleExportGDSII} size="sm" className="bg-green-700 hover:bg-green-600"
                  disabled={!synthResult || status['export']?.running}>
                  {status['export']?.running
                    ? <RefreshCw size={13} className="animate-spin mr-1" />
                    : <BarChart3 size={13} className="mr-1" />}
                  Generate GDSII
                </Button>
                {gdsContent && (
                  <Button onClick={downloadGDSII} size="sm" variant="outline" className="border-gray-600">
                    <Download size={13} className="mr-1" /> Download .gds
                  </Button>
                )}
              </div>

              {gdsContent && (
                <div className="bg-gray-800 rounded p-3">
                  <p className="text-xs text-gray-400 mb-1">GDSII preview (first 512 bytes)</p>
                  <pre className="text-xs font-mono text-green-300 overflow-x-auto whitespace-pre-wrap">
                    {gdsContent.slice(0, 512)}…
                  </pre>
                  <p className="text-xs text-gray-500 mt-1">{gdsContent.length} bytes total</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Log pane */}
        <div className="w-56 border-l border-gray-700 flex flex-col overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-700 shrink-0">
            <p className="text-xs text-gray-500">Build log</p>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {log.length === 0 && <p className="text-xs text-gray-600">No output yet.</p>}
            {log.map((line, i) => (
              <p key={i} className="text-xs font-mono text-gray-400 leading-4">{line}</p>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
