import HoverHelp from '../ui/HoverHelp'
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
import { Play, Download, Upload, Cpu, Terminal, RefreshCw, ChevronRight, Check, AlertCircle, X } from 'lucide-react'
import { Button } from '../ui/button'
import { expandVerilogPorts, parseVerilogModule } from '../../lib/fpga/verilogSubset'
import { ACC_CPU_VERILOG } from '../../lib/fpga/accCpu'
import { FIR_DSP_VERILOG } from '../../lib/fpga/firDsp'
import { parseVhdl } from '../../lib/fpga/vhdlSubset'
import { simulateDigital, valueAt, type DigitalNetlist, type LogicValue } from '../../lib/simulation/digitalLogic'
import { synthesize } from '../../lib/ic/icFlowAdapter'
import { CodeEditor, type CodeEditorHandle } from '../editor/CodeEditor'
import LibraryDropNote from '../library/LibraryDropNote'
import { useDomainLibraryZone } from '../../lib/library/useDomainLibraryZone'
import { snippetVerdict } from '../../lib/library/snippetVerdict'
import type { LibraryItem } from '../../lib/library/types'
import { fpgaDesignFlow, FPGA_DEVICES } from '../../lib/fpga/fpgaDesignFlow'
import { useDemoRequest } from '../workspace/useDemoRequest'
import { loadDomainDesign, usePublishDomainDesign } from '../../lib/project/domainDesign'
import { compact } from '../../lib/numberFormat'

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
  /** Scalar bit nets: `[7:0] d` becomes d[0]…d[7]. Simulation and synthesis use these. */
  ports: Array<{ name: string; direction: 'input' | 'output' }>
  /** Ports as declared in the source, for the human-readable header. */
  declaredPorts: Array<{ name: string; direction: 'input' | 'output' }>
}

/** Parse either language into the common elaborated form. */
function elaborate(code: string, language: 'verilog' | 'vhdl'): ElaboratedDesign {
  if (language === 'verilog') {
    const elab = parseVerilogModule(code)
    return {
      name: elab.name,
      language,
      netlist: elab.netlist,
      ports: expandVerilogPorts(elab.ports),
      declaredPorts: elab.ports.map((port) => ({ name: port.name, direction: port.direction })),
    }
  }
  const elab = parseVhdl(code)
  const ports = elab.ports.map((port) => ({
    name: port.name,
    direction: (port.direction === 'in' ? 'input' : 'output') as 'input' | 'output',
  }))
  return { name: elab.entity, language, netlist: elab.netlist, ports, declaredPorts: ports }
}

const formatValue = (value: LogicValue): string => (value === 'X' || value === 'Z' ? String(value) : String(value))

/**
 * Deterministic testbench for combinational demos: drive each input port as a
 * binary count, least-significant input toggling fastest. Without this an
 * interactive simulation of a structural module has no drivers, so every node
 * correctly stays X and the waveform proves nothing. Inputs already driven by
 * the netlist are left alone.
 */
function autoInputStimuli(
  ports: ReadonlyArray<{ name: string; direction: 'input' | 'output' }>,
  stopTime: number,
  options: { exclude?: ReadonlySet<string>; phase?: number } = {},
): Array<{ node: string; time: number; value: 0 | 1 }> {
  const inputs = ports.filter(
    (port) => port.direction === 'input' && !options.exclude?.has(port.name),
  )
  // Clocked designs: park every transition a quarter period after an edge so
  // the stimulus never races the clock in a zero-delay event simulator.
  const phase = Math.max(0, Math.round(options.phase ?? 0))
  const unit = Math.max(1, phase)
  const stimuli: Array<{ node: string; time: number; value: 0 | 1 }> = []
  for (const [index, port] of inputs.entries()) {
    const halfPeriod = 2 ** (index + 1) * unit
    for (let step = 0; phase + step * halfPeriod <= stopTime; step += 1) {
      stimuli.push({ node: port.name, time: phase + step * halfPeriod, value: step % 2 === 0 ? 0 : 1 })
    }
  }
  return stimuli
}

export default function HDLEditor({ initialCode, language: initialLanguage = 'verilog', onCodeChange, onClose }: HDLEditorProps) {
  const saved = loadDomainDesign<{ language?: 'verilog' | 'vhdl'; code?: string; driveInputs?: boolean }>('hdl')
  const savedLanguage = saved?.language === 'vhdl' || saved?.language === 'verilog' ? saved.language : initialLanguage
  const resolvedLanguage = initialCode ? initialLanguage : savedLanguage
  const [language, setLanguage] = useState<'verilog' | 'vhdl'>(resolvedLanguage)
  const [code, setCode] = useState(
    initialCode ?? (typeof saved?.code === 'string' ? saved.code : (resolvedLanguage === 'vhdl' ? VHDL_TEMPLATE : VERILOG_TEMPLATE)),
  )
  const [output, setOutput] = useState('')
  const [signals, setSignals] = useState<SimSignal[]>([])
  const [parseOk, setParseOk] = useState<boolean | null>(null)
  const [activeTarget, setActiveTarget] = useState('simulate')
  const [driveInputs, setDriveInputs] = useState(saved?.driveInputs !== false)
  const [loading, setLoading] = useState(false)
  const [dropped, setDropped] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const editorRef = useRef<CodeEditorHandle>(null)

  usePublishDomainDesign('hdl', { language, code, driveInputs }, (next) => {
    const nextLanguage = next.language === 'vhdl' ? 'vhdl' : next.language === 'verilog' ? 'verilog' : language
    if (nextLanguage !== language) setLanguage(nextLanguage)
    if (typeof next.code === 'string') {
      setCode(next.code)
      onCodeChange?.(next.code, nextLanguage)
    }
    if (typeof next.driveInputs === 'boolean') setDriveInputs(next.driveInputs)
    setOutput('')
    setParseOk(null)
  })

  useDemoRequest('hdl-half-adder', () => { void runCompile() })

  const updateCode = useCallback((next: string, nextLanguage: 'verilog' | 'vhdl' = language) => {
    setCode(next)
    onCodeChange?.(next, nextLanguage)
  }, [language, onCodeChange])

  const loadExample = useCallback((example: string) => {
    const next =
      example === 'acc-cpu' ? ACC_CPU_VERILOG
        : example === 'fir-dsp' ? FIR_DSP_VERILOG
          : example === 'half-adder' ? VERILOG_TEMPLATE
            : null
    if (!next) return
    setLanguage('verilog')
    updateCode(next, 'verilog')
    setOutput('')
    setParseOk(null)
    setSignals([])
    setDropped(null)
  }, [updateCode])

  useDemoRequest('hdl-acc-cpu', () => {
    setLanguage('verilog')
    updateCode(ACC_CPU_VERILOG, 'verilog')
    setActiveTarget('simulate')
    void runCompile('simulate', ACC_CPU_VERILOG, 'verilog')
  })

  useDemoRequest('hdl-fir-dsp', () => {
    setLanguage('verilog')
    updateCode(FIR_DSP_VERILOG, 'verilog')
    setActiveTarget('simulate')
    void runCompile('simulate', FIR_DSP_VERILOG, 'verilog')
  })

  const placeSnippetRow = useCallback((item: LibraryItem) => {
    if (item.kind !== 'snippet') return
    editorRef.current?.insertAtCaret(item.payload.text)
    setDropped(`"${item.name}" inserted at the caret.`)
  }, [])

  const snippetZone = useDomainLibraryZone({
    accepts: snippetVerdict([language], 'this HDL buffer'),
    as: 'the editor',
    onPlace: placeSnippetRow,
  })

  const appendOutput = (text: string) => setOutput(prev => prev + text + '\n')

  const runCompile = useCallback(async (target = activeTarget, source = code, sourceLanguage = language) => {
    setLoading(true)
    setOutput('')
    setSignals([])
    setParseOk(null)
    setDropped(null)
    try {
      const design = elaborate(source, sourceLanguage)
      appendOutput(`Parsed ${design.language === 'verilog' ? 'module' : 'entity'}: ${design.name}`)
      appendOutput(`  Ports: ${design.declaredPorts.map(p => `${p.direction} ${p.name}`).join(', ')}`)
      if (design.ports.length !== design.declaredPorts.length) {
        appendOutput(`  Expanded to ${design.ports.length} scalar bit nets for simulation and synthesis.`)
      }

      if (target === 'simulate') {
        const clocks = design.netlist.clocks ?? []
        const maxPeriod = clocks.reduce((longest, clock) => Math.max(longest, clock.period), 0)
        // Sequential designs need several edges; combinational ones keep the
        // original short window.
        const stopTime = maxPeriod > 0 ? Math.max(20, maxPeriod * 8) : 20
        const sampleCount = maxPeriod > 0 ? 81 : 21
        const netlist = { ...design.netlist }
        const existingStimuli = netlist.stimuli?.length ?? 0
        const clockNets = new Set(clocks.map((clock) => clock.output))
        const generated = driveInputs && existingStimuli === 0
          ? autoInputStimuli(design.ports, stopTime, {
              exclude: clockNets,
              phase: maxPeriod > 0 ? maxPeriod / 4 : 0,
            })
          : []
        if (generated.length > 0) netlist.stimuli = generated
        const result = simulateDigital(netlist, stopTime)
        if (!result.success) throw new Error(result.error ?? 'digital simulation failed')
        appendOutput(`\nDigital simulation (0–${stopTime} time units, ${result.eventCount} events):`)
        if (clocks.length > 0) {
          appendOutput(
            `  Generated functional clock: ${[...clockNets].join(', ')} — period ${maxPeriod} time units. ` +
            'This clock exercises the logic; SKY130 static timing analysis is the timing sign-off.',
          )
        }
        if (generated.length > 0) {
          appendOutput(
            `  Auto testbench: ${design.ports
              .filter((port) => port.direction === 'input' && !clockNets.has(port.name))
              .map((port) => port.name)
              .join(', ')} driven as a binary count (LSB fastest).`,
          )
        } else if (driveInputs && existingStimuli > 0) {
          appendOutput('  Inputs already driven by the netlist — auto testbench skipped.')
        }
        const nominalStep = stopTime / (sampleCount - 1)
        for (const node of Object.keys(result.transitions)) {
          const bus = Array.from({ length: sampleCount }, (_, t) =>
            formatValue(valueAt(result, node, t * nominalStep)),
          ).join('')
          appendOutput(`  ${node.padEnd(12)}: ${bus}`)
        }
        setSignals(Object.keys(result.transitions).map(node => ({
          name: node,
          values: Array.from({ length: sampleCount }, (_, t) => ({
            time: t * nominalStep,
            value: valueAt(result, node, t * nominalStep),
          })),
        })))
      } else if (target === 'synthesize') {
        const synth = synthesize(design.netlist, design.ports)
        appendOutput('\nLogic synthesis (SkyWater SKY130):')
        appendOutput(`  Cells used: ${synth.cells.length}`)
        appendOutput(`  Total area: ${synth.totalArea.toFixed(2)} µm²`)
        appendOutput(`  Critical path: ${synth.criticalPathPs.toFixed(0)} ps`)
        appendOutput(`  Max frequency: ${synth.metrics.maxOperatingFreqMhz.toFixed(1)} MHz`)
        appendOutput(`  Leakage power: ${compact(synth.staticPowerUw)} µW`)
      } else if (target.startsWith('fpga:')) {
        const deviceId = target.slice(5)
        const synthesis = fpgaDesignFlow.synthesize(
          [{ name: design.name, language: design.language, source }],
          deviceId,
        )
        appendOutput(`\nFPGA elaboration for ${synthesis.device?.part ?? deviceId}:`)
        if (!synthesis.success) {
          throw new Error(synthesis.errors.join('; ') || 'FPGA elaboration failed')
        }
        appendOutput(`  Gates: ${synthesis.utilization.gates} → LUT estimate: ${synthesis.utilization.luts} / ${synthesis.device?.luts ?? '?'} (${synthesis.utilization.lutPercent.toFixed(1)}%)`)
        appendOutput(`  Flip-flops: ${synthesis.utilization.flipFlops} / ${synthesis.device?.flipFlops ?? '?'}`)
        appendOutput('  Timing: not modelled (vendor place-and-route required)')
        appendOutput('  BRAM/DSP: not inferred')
        for (const warning of synthesis.warnings) appendOutput(`  Warning: ${warning}`)
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
      appendOutput(`Error: ${message}`)
      setParseOk(false)
    } finally {
      setLoading(false)
    }
  }, [code, language, activeTarget, driveInputs])

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
      setDropped(null)
    }
    reader.readAsText(file)
  }

  return (
    <div className="flex flex-col h-full bg-background text-foreground">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0 flex-wrap">
        <h2 className="text-sm font-semibold whitespace-nowrap">HDL Editor</h2>
        <div className="flex rounded overflow-hidden border border-border">
          {(['verilog', 'vhdl'] as const).map(lang => (
            <button
              key={lang}
              onClick={() => { setLanguage(lang); updateCode(lang === 'vhdl' ? VHDL_TEMPLATE : VERILOG_TEMPLATE, lang); setOutput(''); setParseOk(null); setSignals([]); setDropped(null) }}
              className={`px-3 py-1 text-xs transition-colors ${language === lang ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {lang.toUpperCase()}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-1">
          <span className="hidden text-xs text-muted-foreground sm:inline">Example</span>
          <select
            aria-label="Load HDL example"
            className="min-w-0 max-w-[11rem] bg-card border border-input text-xs text-foreground rounded px-1 py-0.5 outline-none"
            value=""
            onChange={event => loadExample(event.target.value)}
          >
            <option value="" disabled>Load example…</option>
            <option value="half-adder">Half adder</option>
            <option value="acc-cpu">8-bit accumulator CPU</option>
            <option value="fir-dsp">4-tap FIR filter (DSP)</option>
          </select>
        </label>

        <div className="flex items-center gap-1">
          <span className="hidden text-xs text-muted-foreground sm:inline">Target:</span>
          <select
            aria-label="HDL target"
            className="min-w-0 max-w-[10.5rem] bg-card border border-input text-xs text-foreground rounded px-1 py-0.5 outline-none"
            value={activeTarget}
            onChange={event => setActiveTarget(event.target.value)}
          >
            <option value="simulate">Digital Simulation</option>
            <option value="synthesize">SKY130 Synthesis</option>
            {FPGA_DEVICES.map(device => (
              <option key={device.id} value={`fpga:${device.id}`}>{device.part}</option>
            ))}
          </select>
          <label
            className="flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground"
            title="Drive every input port as a binary count so combinational waveforms are measurable"
          >
            <input
              type="checkbox"
              checked={driveInputs}
              onChange={event => setDriveInputs(event.target.checked)}
              aria-label="Auto-drive input ports"
            />
            Drive inputs
          </label>
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

        {dropped !== null && (
          <span className="text-xs text-muted-foreground">{dropped}</span>
        )}

        <div className="ml-auto flex gap-1">
          <HoverHelp title="Import HDL file" description="Import HDL file">
<Button size="sm" variant="ghost" onClick={() => fileInputRef.current?.click()} aria-label="Import HDL file"><Upload size={13} aria-hidden="true" /></Button>
</HoverHelp>
          <HoverHelp title="Export HDL file" description="Export HDL file">
<Button size="sm" variant="ghost" onClick={handleExport} aria-label="Export HDL file"><Download size={13} aria-hidden="true" /></Button>
</HoverHelp>
          {onClose && (
            <HoverHelp title="Close the HDL editor. Source you have not saved to the project is lost." description="Close the HDL editor. Source you have not saved to the project is lost.">
<Button size="sm" variant="ghost" onClick={onClose} className="text-muted-foreground" aria-label="Close HDL editor"><X className="w-3.5 h-3.5" aria-hidden="true" /></Button>
</HoverHelp>
          )}
        </div>
        <input ref={fileInputRef} type="file" accept=".v,.sv,.vhd,.vhdl" aria-label="Import HDL file" className="hidden"
          onChange={event => { const file = event.target.files?.[0]; if (file) handleImport(file) }} />
      </div>

      {/* Main split: code editor | output */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        <div
          className="cad-dropzone relative min-h-0 flex-1 overflow-hidden"
          role="group"
          aria-label="HDL source — drop a code snippet here"
          {...snippetZone.zoneProps}
        >
          <CodeEditor
            ref={editorRef}
            value={code}
            onChange={updateCode}
            language={language}
            ariaLabel="HDL source"
            placeholder="module half_adder (…)"
            className="h-full rounded-none border-0"
          />
          <LibraryDropNote zone={snippetZone} surface="the editor" />
        </div>

        <div className="flex max-h-[45%] w-full flex-shrink-0 flex-col overflow-y-auto border-t border-border lg:max-h-none lg:w-80 lg:border-l lg:border-t-0">
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
                          title={`t=${sample.time.toFixed(1)}: ${formatValue(sample.value)}`}
                          className={`min-w-px flex-1 border-r border-border/40 ${
                            sample.value === 1 ? 'bg-success' : sample.value === 0 ? 'bg-muted' : 'bg-warning'
                          }`}
                          style={{ height: sample.value === 1 ? '100%' : sample.value === 0 ? '30%' : '60%' }}
                        />
                      ))}
                    </div>
                  </div>
                ))}
                {signals.length > 12 && (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Showing 12 of {signals.length} nodes — every node is listed in the output log.
                  </p>
                )}
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
