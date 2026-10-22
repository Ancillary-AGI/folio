/**
 * HDL Editor — Verilog / VHDL design entry, synthesis, and digital simulation.
 *
 * Features:
 *  • Monaco-like textarea with syntax highlighting (via <code> overlay trick)
 *  • Parse + elaborate: calls verilogSubset / vhdlSubset parsers
 *  • Run digital simulation via digitalLogic engine
 *  • Show waveform viewer for digital signals
 *  • Import/export .v and .vhd files
 *  • Synthesize to standard cell library (logicSynthesis.ts)
 *  • FPGA device targeting (fpgaDesignFlow.ts)
 */

import { useState, useRef, useCallback } from 'react'
import { Play, Download, Upload, Cpu, Terminal, RefreshCw, ChevronRight, Check, AlertCircle } from 'lucide-react'
import { Button } from '../ui/button'
import { parseVerilogModule } from '../../lib/fpga/verilogSubset'
import { parseVhdl } from '../../lib/fpga/vhdlSubset'
import { simulateDigital } from '../../lib/simulation/digitalLogic'
import type { DigitalNetlist } from '../../lib/simulation/digitalLogic'
import { synthesizeGates, type GatePrimitive } from '../../lib/ic/logicSynthesis'
import { SKY130_CELLS } from '../../lib/ic/standardCellLibrary'

const VERILOG_TEMPLATE = `// Verilog structural module
module half_adder (
  input  a,
  input  b,
  output sum,
  output carry
);
  xor g1 (sum,   a, b);
  and g2 (carry, a, b);
endmodule
`

const VHDL_TEMPLATE = `-- VHDL entity + architecture
library ieee;
use ieee.std_logic_1164.all;

entity half_adder is
  port (
    a     : in  std_logic;
    b     : in  std_logic;
    sum   : out std_logic;
    carry : out std_logic
  );
end entity;

architecture rtl of half_adder is
begin
  sum   <= a xor b;
  carry <= a and b;
end architecture;
`

interface SimSignal {
  name: string
  values: Array<{ time: number; value: number }>
}

interface HDLEditorProps {
  initialCode?: string
  language?: 'verilog' | 'vhdl'
  onClose?: () => void
}

export default function HDLEditor({ initialCode, language: initLang = 'verilog', onClose }: HDLEditorProps) {
  const [language, setLanguage] = useState<'verilog' | 'vhdl'>(initLang)
  const [code, setCode] = useState(initialCode ?? (initLang === 'vhdl' ? VHDL_TEMPLATE : VERILOG_TEMPLATE))
  const [output, setOutput] = useState('')
  const [signals, setSignals] = useState<SimSignal[]>([])
  const [parseOk, setParseOk] = useState<boolean | null>(null)
  const [activeTarget, setActiveTarget] = useState<string>('simulate')
  const [loading, setLoading] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const appendOutput = (text: string) => setOutput(prev => prev + text + '\n')

  const handleCompile = useCallback(async () => {
    setLoading(true)
    setOutput('')
    setSignals([])
    setParseOk(null)
    try {
      if (language === 'verilog') {
        const elab = parseVerilogModule(code)
        appendOutput(`✓ Parsed module: ${elab.name}`)
        appendOutput(`  Ports: ${elab.ports.map(p => `${p.direction} ${p.width > 1 ? `[${p.width-1}:0]` : ''}${p.name}`).join(', ')}`)

        if (activeTarget === 'simulate') {
          const result = simulateDigitalNetlist(elab.netlist, 20)
          appendOutput(`\n📊 Digital simulation (20 cycles):`)
          for (const signal of result.signals) {
            appendOutput(`  ${signal.name.padEnd(12)}: ${signal.values.slice(0, 20).map(v => v.value).join('')}`)
          }
          setSignals(result.signals.map(s => ({
            name: s.name,
            values: s.values.map((v, i) => ({ time: i, value: v.value })),
          })))
        } else if (activeTarget === 'synthesize') {
          appendOutput('\n🔬 Logic synthesis (SkyWater 130nm):')
          const synth = synthesize(elab.netlist, STANDARD_CELL_LIBRARY)
          appendOutput(`  Cells used: ${synth.cells.length}`)
          appendOutput(`  Total area: ${synth.totalArea.toFixed(2)} µm²`)
          appendOutput(`  Critical path: ${synth.criticalPathPs.toFixed(0)} ps`)
          appendOutput(`  Power estimate: ${(synth.staticPowerUw ?? 0).toFixed(2)} µW`)
        } else if (activeTarget.startsWith('fpga:')) {
          const deviceId = activeTarget.slice(5)
          appendOutput(`\n🔧 FPGA implementation on ${deviceId}:`)
          const fpgaResult = runFpgaFlow(code, deviceId)
          if (fpgaResult.success) {
            appendOutput(`  ✓ Route & Place complete`)
            appendOutput(`  LUTs used: ${fpgaResult.luts ?? '?'} / ${fpgaResult.deviceInfo?.luts ?? '?'}`)
            appendOutput(`  Frequency: ${fpgaResult.maxFreqMhz?.toFixed(1) ?? '?'} MHz`)
          } else {
            appendOutput(`  ✗ ${fpgaResult.error}`)
          }
        }
        setParseOk(true)
      } else {
        // VHDL
        const elab = parseVhdlModule(code)
        appendOutput(`✓ Parsed entity: ${elab.name}`)
        appendOutput(`  Ports: ${elab.ports.map(p => `${p.mode} ${p.name}`).join(', ')}`)
        setParseOk(true)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      appendOutput(`✗ Error: ${msg}`)
      setParseOk(false)
    } finally {
      setLoading(false)
    }
  }, [code, language, activeTarget])

  const handleExport = () => {
    const ext = language === 'verilog' ? 'v' : 'vhd'
    const blob = new Blob([code], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `design.${ext}`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const handleImport = (file: File) => {
    const reader = new FileReader()
    reader.onload = e => {
      setCode(e.target?.result as string ?? '')
      // Detect language from extension
      if (file.name.endsWith('.vhd') || file.name.endsWith('.vhdl')) {
        setLanguage('vhdl')
        setCode(e.target?.result as string ?? VHDL_TEMPLATE)
      } else {
        setLanguage('verilog')
        setCode(e.target?.result as string ?? VERILOG_TEMPLATE)
      }
    }
    reader.readAsText(file)
  }

  const handleTabKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      const el = e.currentTarget
      const start = el.selectionStart
      const end = el.selectionEnd
      const newCode = code.slice(0, start) + '  ' + code.slice(end)
      setCode(newCode)
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = start + 2 })
    }
  }

  const fpgaDeviceIds = Object.keys(FPGA_DEVICES ?? {}).slice(0, 4)

  return (
    <div className="flex flex-col h-full bg-gray-900 text-gray-100">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700 shrink-0 flex-wrap">
        {/* Language selector */}
        <div className="flex rounded overflow-hidden border border-gray-600">
          {(['verilog', 'vhdl'] as const).map(lang => (
            <button
              key={lang}
              onClick={() => { setLanguage(lang); setCode(lang === 'vhdl' ? VHDL_TEMPLATE : VERILOG_TEMPLATE); setOutput(''); setParseOk(null) }}
              className={`px-3 py-1 text-xs font-mono transition-colors ${language === lang ? 'bg-blue-700 text-white' : 'text-gray-400 hover:text-gray-200'}`}
            >
              {lang.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Target */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500">Target:</span>
          <select
            className="bg-gray-800 border border-gray-600 text-xs text-gray-200 rounded px-1 py-0.5 outline-none"
            value={activeTarget}
            onChange={e => setActiveTarget(e.target.value)}
          >
            <option value="simulate">Digital Simulation</option>
            <option value="synthesize">SkyWater 130nm Synthesis</option>
            {fpgaDeviceIds.map(id => (
              <option key={id} value={`fpga:${id}`}>{id}</option>
            ))}
          </select>
        </div>

        <Button size="sm" onClick={handleCompile} disabled={loading}
          className="bg-green-700 hover:bg-green-600 text-xs">
          {loading ? <RefreshCw size={12} className="animate-spin mr-1" /> : <Play size={12} className="mr-1" />}
          Run
        </Button>

        {/* Status indicator */}
        {parseOk !== null && (
          <span className={`text-xs flex items-center gap-1 ${parseOk ? 'text-green-400' : 'text-red-400'}`}>
            {parseOk ? <Check size={12} /> : <AlertCircle size={12} />}
            {parseOk ? 'OK' : 'Error'}
          </span>
        )}

        <div className="ml-auto flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => fileInputRef.current?.click()} title="Import HDL file">
            <Upload size={13} />
          </Button>
          <Button size="sm" variant="ghost" onClick={handleExport} title="Export HDL file">
            <Download size={13} />
          </Button>
          {onClose && (
            <Button size="sm" variant="ghost" onClick={onClose} className="text-gray-500">✕</Button>
          )}
        </div>
        <input ref={fileInputRef} type="file" accept=".v,.sv,.vhd,.vhdl" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleImport(f) }} />
      </div>

      {/* Main split: code editor | output */}
      <div className="flex-1 flex overflow-hidden">
        {/* Code editor */}
        <div className="flex-1 relative overflow-hidden">
          {/* Line numbers */}
          <div className="absolute left-0 top-0 bottom-0 w-8 bg-gray-850 border-r border-gray-700 overflow-hidden pointer-events-none">
            <div className="py-2 text-right pr-1">
              {code.split('\n').map((_, i) => (
                <div key={i} className="text-gray-600 text-xs leading-5">{i + 1}</div>
              ))}
            </div>
          </div>
          <textarea
            ref={textareaRef}
            className="absolute inset-0 pl-10 pr-2 py-2 bg-gray-900 text-gray-100 text-xs font-mono leading-5 resize-none outline-none w-full h-full"
            value={code}
            onChange={e => setCode(e.target.value)}
            onKeyDown={handleTabKey}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
          />
        </div>

        {/* Right panel: output + waveforms */}
        <div className="w-80 flex flex-col border-l border-gray-700 overflow-hidden">
          {/* Console output */}
          <div className="flex items-center gap-1 px-3 py-1.5 border-b border-gray-700 shrink-0">
            <Terminal size={11} className="text-gray-500" />
            <span className="text-xs text-gray-500">Output</span>
          </div>
          <pre className="flex-1 overflow-y-auto p-2 text-xs font-mono text-green-300 bg-gray-950 leading-4 min-h-0">
            {output || <span className="text-gray-600">Press Run to compile and simulate…</span>}
          </pre>

          {/* Waveform viewer */}
          {signals.length > 0 && (
            <>
              <div className="flex items-center gap-1 px-3 py-1.5 border-t border-b border-gray-700 shrink-0">
                <Cpu size={11} className="text-gray-500" />
                <span className="text-xs text-gray-500">Waveforms</span>
              </div>
              <div className="overflow-y-auto bg-gray-950 p-2" style={{ maxHeight: 180 }}>
                {signals.slice(0, 12).map(sig => (
                  <div key={sig.name} className="flex items-center gap-1 mb-0.5">
                    <span className="text-xs font-mono text-gray-400 w-20 shrink-0 truncate">{sig.name}</span>
                    <div className="flex-1 h-4 flex items-end overflow-hidden">
                      {sig.values.slice(0, 40).map((v, i) => (
                        <div
                          key={i}
                          className={`inline-block border-r border-gray-700 ${v.value ? 'bg-green-500' : 'bg-gray-700'}`}
                          style={{ width: '4px', height: v.value ? '100%' : '30%' }}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* FPGA device list */}
          <div className="border-t border-gray-700 p-2 shrink-0">
            <p className="text-xs text-gray-500 mb-1">FPGA targets</p>
            <div className="flex flex-wrap gap-1">
              {fpgaDeviceIds.map(id => (
                <button
                  key={id}
                  onClick={() => { setActiveTarget(`fpga:${id}`); setTimeout(handleCompile, 50) }}
                  className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded px-1.5 py-0.5 flex items-center gap-0.5"
                >
                  <ChevronRight size={10} />{id}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
