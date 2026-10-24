/**
 * HDL Editor — Verilog / VHDL design entry, elaboration, and digital simulation.
 *
 * Flow: parse (verilogSubset / vhdlSubset) → elaborate a four-state digital
 * netlist → either run the event-driven logic simulator, map to SKY130 standard
 * cells, or report netlist-derived FPGA resource estimates. Every result comes
 * from the corresponding engine; unsupported syntax fails with a line-numbered
 * error. Vendor timing, bitstream assembly and device programming are not
 * modelled and are stated as such rather than estimated.
 */

import { useState, useRef, useCallback } from 'react'
import { Play, Download, Upload, Cpu, Terminal, RefreshCw, ChevronRight, Check, AlertCircle } from 'lucide-react'
import { Button } from '../ui/button'
import { parseVerilogModule } from '../../lib/fpga/verilogSubset'
import { parseVhdl } from '../../lib/fpga/vhdlSubset'
import { simulateDigital, valueAt, type DigitalNetlist, type LogicValue } from '../../lib/simulation/digitalLogic'
import { synthesize } from '../../lib/ic/icFlowAdapter'
import { fpgaDesignFlow, FPGA_DEVICES } from '../../lib/fpga/fpgaDesignFlow'

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

const VHDL_TEMPLATE = `-- VHDL structural entity + architecture
library ieee;

entity half_adder is
  port (
    a     : in  bit;
    b     : in  bit;
    sum   : out bit;
    carry : out bit
  );
end entity;

architecture rtl of half_adder is
begin
  u1: xor2 port map (a, b, sum);
  u2: and2 port map (a, b, carry);
end architecture;
`

interface SimSignal {
  name: string
  values: Array<{ time: number; value: LogicValue }>
}

interface HDLEditorProps {
  initialCode?: string
  language?: 'verilog' | 'vhdl'
  onCodeChange?: (code: string, language: 'verilog' | 'vhdl') => void
  onClose?: () => void
}

interface ElaboratedDesign {
  name: string
  language: 'verilog' | 'vhdl'
  netlist: DigitalNetlist
  ports: Array<{ name: string; direction: 'input' | 'output' }>
}

/** Parse either language into the common elaborated form. */
function elaborate(code: string, language: 'verilog' | 'vhdl'): ElaboratedDesign {
  if (language === 'verilog') {
    const elab = parseVerilogModule(code)
    return {
      name: elab.name,
      language,
      netlist: elab.netlist,
      ports: elab.ports.map((port) => ({ name: port.name, direction: port.direction })),
    }
  }
  const elab = parseVhdl(code)
  return {
    name: elab.entity,
    language,
    netlist: elab.netlist,
    ports: elab.ports.map((port) => ({
      name: port.name,
      direction: port.direction === 'in' ? 'input' : 'output',
    })),
  }
}

const formatValue = (value: LogicValue): string => (value === 'X' || value === 'Z' ? String(value) : String(value))

export default function HDLEditor({ initialCode, language: initialLanguage = 'verilog', onCodeChange, onClose }: HDLEditorProps) {
  const [language, setLanguage] = useState<'verilog' | 'vhdl'>(initialLanguage)
  const [code, setCode] = useState(initialCode ?? (initialLanguage === 'vhdl' ? VHDL_TEMPLATE : VERILOG_TEMPLATE))
  const [output, setOutput] = useState('')
  const [signals, setSignals] = useState<SimSignal[]>([])
  const [parseOk, setParseOk] = useState<boolean | null>(null)
  const [activeTarget, setActiveTarget] = useState('simulate')
  const [loading, setLoading] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const updateCode = useCallback((next: string, nextLanguage: 'verilog' | 'vhdl' = language) => {
    setCode(next)
    onCodeChange?.(next, nextLanguage)
  }, [language, onCodeChange])

  const appendOutput = (text: string) => setOutput(prev => prev + text + '\n')

  const runCompile = useCallback(async (target = activeTarget) => {
    setLoading(true)
    setOutput('')
    setSignals([])
    setParseOk(null)
    try {
      const design = elaborate(code, language)
      appendOutput(`✓ Parsed ${design.language === 'verilog' ? 'module' : 'entity'}: ${design.name}`)
      appendOutput(`  Ports: ${design.ports.map(p => `${p.direction} ${p.name}`).join(', ')}`)

      if (target === 'simulate') {
        const result = simulateDigital(design.netlist, 20)
        if (!result.success) throw new Error(result.error ?? 'digital simulation failed')
        appendOutput(`\n📊 Digital simulation (0–20 time units, ${result.eventCount} events):`)
        for (const node of Object.keys(result.transitions)) {
          const bus = Array.from({ length: 21 }, (_, t) => formatValue(valueAt(result, node, t))).join('')
          appendOutput(`  ${node.padEnd(12)}: ${bus}`)
        }
        setSignals(Object.keys(result.transitions).map(node => ({
          name: node,
          values: Array.from({ length: 21 }, (_, t) => ({ time: t, value: valueAt(result, node, t) })),
        })))
      } else if (target === 'synthesize') {
        const synth = synthesize(design.netlist, design.ports)
        appendOutput('\n🔬 Logic synthesis (SkyWater SKY130):')
        appendOutput(`  Cells used: ${synth.cells.length}`)
        appendOutput(`  Total area: ${synth.totalArea.toFixed(2)} µm²`)
        appendOutput(`  Critical path: ${synth.criticalPathPs.toFixed(0)} ps`)
        appendOutput(`  Max frequency: ${synth.metrics.maxOperatingFreqMhz.toFixed(1)} MHz`)
        appendOutput(`  Leakage power: ${(synth.staticPowerUw ?? 0).toFixed(2)} µW`)
      } else if (target.startsWith('fpga:')) {
        const deviceId = target.slice(5)
        const synthesis = fpgaDesignFlow.synthesize(
          [{ name: design.name, language: design.language, source: code }],
          deviceId,
        )
        appendOutput(`\n🔧 FPGA elaboration for ${synthesis.device?.part ?? deviceId}:`)
        if (!synthesis.success) {
          throw new Error(synthesis.errors.join('; ') || 'FPGA elaboration failed')
        }
        appendOutput(`  Gates: ${synthesis.utilization.gates} → LUT estimate: ${synthesis.utilization.luts} / ${synthesis.device?.luts ?? '?'} (${synthesis.utilization.lutPercent.toFixed(1)}%)`)
        appendOutput(`  Flip-flops: ${synthesis.utilization.flipFlops} / ${synthesis.device?.flipFlops ?? '?'}`)
        appendOutput('  Timing: not modelled (vendor place-and-route required)')
        appendOutput('  BRAM/DSP: not inferred')
        for (const warning of synthesis.warnings) appendOutput(`  ⚠ ${warning}`)
        const manifest = fpgaDesignFlow.generateManifest(synthesis)
        if (manifest) {
          const bytes = new TextEncoder().encode(JSON.stringify(manifest)).length
          appendOutput(`  Design manifest: ${bytes} bytes (hash ${manifest.netlistHash}) — no vendor bitstream`)
        } else {
          appendOutput('  Design manifest not generated')
        }
      }
      setParseOk(true)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      appendOutput(`✗ Error: ${message}`)
      setParseOk(false)
    } finally {
      setLoading(false)
    }
  }, [code, language, activeTarget])

  const handleExport = () => {
    const extension = language === 'verilog' ? 'v' : 'vhd'
    const blob = new Blob([code], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `design.${extension}`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = (file: File) => {
    const reader = new FileReader()
    reader.onload = event => {
      const text = typeof event.target?.result === 'string' ? event.target.result : ''
      const nextLanguage: 'verilog' | 'vhdl' =
        file.name.endsWith('.vhd') || file.name.endsWith('.vhdl') ? 'vhdl' : 'verilog'
      setLanguage(nextLanguage)
      updateCode(text || (nextLanguage === 'vhdl' ? VHDL_TEMPLATE : VERILOG_TEMPLATE), nextLanguage)
      setOutput('')
      setParseOk(null)
    }
    reader.readAsText(file)
  }

  const handleTabKey = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Tab') return
    event.preventDefault()
    const element = event.currentTarget
    const start = element.selectionStart
    const end = element.selectionEnd
    updateCode(code.slice(0, start) + '  ' + code.slice(end))
    requestAnimationFrame(() => { element.selectionStart = element.selectionEnd = start + 2 })
  }

  return (
    <div className="flex flex-col h-full bg-background text-foreground">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0 flex-wrap">
        <div className="flex rounded overflow-hidden border border-border">
          {(['verilog', 'vhdl'] as const).map(lang => (
            <button
              key={lang}
              onClick={() => { setLanguage(lang); updateCode(lang === 'vhdl' ? VHDL_TEMPLATE : VERILOG_TEMPLATE, lang); setOutput(''); setParseOk(null); setSignals([]) }}
              className={`px-3 py-1 text-xs font-mono transition-colors ${language === lang ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {lang.toUpperCase()}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <span className="hidden text-xs text-muted-foreground sm:inline">Target:</span>
          <select
            aria-label="HDL target"
            className="min-w-0 max-w-[10.5rem] bg-card border border-border text-xs text-foreground rounded px-1 py-0.5 outline-none"
            value={activeTarget}
            onChange={event => setActiveTarget(event.target.value)}
          >
            <option value="simulate">Digital Simulation</option>
            <option value="synthesize">SKY130 Synthesis</option>
            {FPGA_DEVICES.map(device => (
              <option key={device.id} value={`fpga:${device.id}`}>{device.part}</option>
            ))}
          </select>
        </div>

        <Button size="sm" onClick={() => { void runCompile() }} disabled={loading}
          className="bg-success hover:bg-success/90 text-xs">
          {loading ? <RefreshCw size={12} className="animate-spin mr-1" /> : <Play size={12} className="mr-1" />}
          Run
        </Button>

        {parseOk !== null && (
          <span className={`text-xs flex items-center gap-1 ${parseOk ? 'text-success' : 'text-destructive'}`}>
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
            <Button size="sm" variant="ghost" onClick={onClose} className="text-muted-foreground" aria-label="Close HDL editor">✕</Button>
          )}
        </div>
        <input ref={fileInputRef} type="file" accept=".v,.sv,.vhd,.vhdl" aria-label="Import HDL file" className="hidden"
          onChange={event => { const file = event.target.files?.[0]; if (file) handleImport(file) }} />
      </div>

      {/* Main split: code editor | output */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-8 bg-canvas border-r border-border overflow-hidden pointer-events-none">
            <div className="py-2 text-right pr-1">
              {code.split('\n').map((_, index) => (
                <div key={index} className="text-muted-foreground text-xs leading-5">{index + 1}</div>
              ))}
            </div>
          </div>
          <textarea
            ref={textareaRef}
            className="absolute inset-0 pl-10 pr-2 py-2 bg-background text-foreground text-xs font-mono leading-5 resize-none outline-none w-full h-full"
            value={code}
            onChange={event => updateCode(event.target.value)}
            onKeyDown={handleTabKey}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            aria-label="HDL source"
          />
        </div>

        <div className="flex max-h-[45%] w-full flex-shrink-0 flex-col overflow-hidden border-t border-border lg:max-h-none lg:w-80 lg:border-l lg:border-t-0">
          <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border shrink-0">
            <Terminal size={11} className="text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Output</span>
          </div>
          <pre className="flex-1 overflow-y-auto p-2 text-xs font-mono text-success bg-canvas leading-4 min-h-0">
            {output || <span className="text-muted-foreground">Press Run to parse, simulate, or synthesise…</span>}
          </pre>

          {signals.length > 0 && (
            <>
              <div className="flex items-center gap-1 px-3 py-1.5 border-t border-b border-border shrink-0">
                <Cpu size={11} className="text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Waveforms</span>
              </div>
              <div className="overflow-y-auto bg-canvas p-2" style={{ maxHeight: 180 }}>
                {signals.slice(0, 12).map(signal => (
                  <div key={signal.name} className="flex items-center gap-1 mb-0.5">
                    <span className="text-xs font-mono text-muted-foreground w-20 shrink-0 truncate">{signal.name}</span>
                    <div className="flex-1 h-4 flex items-end overflow-hidden">
                      {signal.values.map(sample => (
                        <div
                          key={sample.time}
                          title={`t=${sample.time}: ${formatValue(sample.value)}`}
                          className={`inline-block border-r border-border ${
                            sample.value === 1 ? 'bg-success' : sample.value === 0 ? 'bg-muted' : 'bg-warning'
                          }`}
                          style={{ width: '4px', height: sample.value === 1 ? '100%' : sample.value === 0 ? '30%' : '60%' }}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="hidden border-t border-border p-2 shrink-0 sm:block">
            <p className="text-xs text-muted-foreground mb-1">FPGA targets</p>
            <div className="flex flex-wrap gap-1">
              {FPGA_DEVICES.map(device => (
                <button
                  key={device.id}
                  onClick={() => { setActiveTarget(`fpga:${device.id}`); void runCompile(`fpga:${device.id}`) }}
                  className="text-xs bg-card hover:bg-muted text-foreground rounded px-1.5 py-0.5 flex items-center gap-0.5"
                >
                  <ChevronRight size={10} />{device.part}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
