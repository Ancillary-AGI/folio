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

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { lazy, Suspense } from 'react'
import { Cpu, Layers, Package, Download, Play, RefreshCw, ChevronRight, CheckCircle, AlertCircle, BarChart3 } from 'lucide-react'
import { Button } from '../ui/button'
import { useDemoRequest } from '../workspace/useDemoRequest'
import { synthesize, planFloorplan, generatePackageDescription, PACKAGE_TYPES, exportGDSII, type SynthesisResult, type FloorplanResult, type ChipPackage } from '../../lib/ic/icFlowAdapter'
import { parseVerilogModule } from '../../lib/fpga/verilogSubset'
import { parseVhdl } from '../../lib/fpga/vhdlSubset'
import { STANDARD_MEMORY } from '../../lib/electronics/logicMemory'
import {
  MemoryDevice,
  ShiftRegister165,
  ShiftRegister595,
  decode138,
  memoryDeviceFromSpec,
  type ShiftRegister165Outputs,
  type ShiftRegister595Inputs,
  type ShiftRegister595Outputs,
} from '../../lib/electronics/memoryBehavior'
import { loadDomainDesign, usePublishDomainDesign } from '../../lib/project/domainDesign'

const HDLEditor = lazy(() => import('./HDLEditor'))

const DEFAULT_VERILOG = `// SkyWater 130nm standard-cell example
// Structural full adder mapped to sky130 gates
module full_adder(
  input  a,
  input  b,
  input  cin,
  output sum,
  output cout
);
  wire n1, n2, n3;
  xor g1 (n1,  a, b);
  xor g2 (sum, n1, cin);
  and g3 (n2,  a, b);
  and g4 (n3,  n1, cin);
  or  g5 (cout, n2, n3);
endmodule`

interface StepStatus {
  done: boolean
  running: boolean
  error?: string
}

interface ICDesignPanelProps {
  onClose?: () => void
}

type ICTab = 'entry' | 'synthesis' | 'floorplan' | 'packaging' | 'export' | 'devices'

interface ICDesign {
  activeTab?: ICTab
  hdlCode?: string
  hdlLanguage?: 'verilog' | 'vhdl'
  devicePartId?: string
  shiftInputs?: ShiftRegister595Inputs
  parallelBits?: number[]
  parallelControls?: { plBar: boolean; ceBar: boolean; cp: boolean; ser: boolean }
  decoderInputs?: { a: boolean; b: boolean; c: boolean; g1: boolean; g2aBar: boolean; g2bBar: boolean }
  memoryAddress?: number
  memoryValue?: number
}

const IC_TABS: ICTab[] = ['entry', 'synthesis', 'floorplan', 'packaging', 'export', 'devices']

const icBool = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback

const icInt = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback

const sanitizeShift = (
  value: unknown,
  fallback: ShiftRegister595Inputs,
): ShiftRegister595Inputs => {
  if (!value || typeof value !== 'object') return fallback
  const raw = value as Record<string, unknown>
  return {
    ser: icBool(raw.ser, fallback.ser),
    srclk: icBool(raw.srclk, fallback.srclk),
    rclk: icBool(raw.rclk, fallback.rclk),
    oeBar: icBool(raw.oeBar, fallback.oeBar),
    srclrBar: icBool(raw.srclrBar, fallback.srclrBar),
  }
}

const sanitizeParallelControls = (
  value: unknown,
  fallback: { plBar: boolean; ceBar: boolean; cp: boolean; ser: boolean },
) => {
  if (!value || typeof value !== 'object') return fallback
  const raw = value as Record<string, unknown>
  return {
    plBar: icBool(raw.plBar, fallback.plBar),
    ceBar: icBool(raw.ceBar, fallback.ceBar),
    cp: icBool(raw.cp, fallback.cp),
    ser: icBool(raw.ser, fallback.ser),
  }
}

const sanitizeDecoder = (
  value: unknown,
  fallback: { a: boolean; b: boolean; c: boolean; g1: boolean; g2aBar: boolean; g2bBar: boolean },
) => {
  if (!value || typeof value !== 'object') return fallback
  const raw = value as Record<string, unknown>
  return {
    a: icBool(raw.a, fallback.a),
    b: icBool(raw.b, fallback.b),
    c: icBool(raw.c, fallback.c),
    g1: icBool(raw.g1, fallback.g1),
    g2aBar: icBool(raw.g2aBar, fallback.g2aBar),
    g2bBar: icBool(raw.g2bBar, fallback.g2bBar),
  }
}

const DEFAULT_SHIFT: ShiftRegister595Inputs = {
  ser: false, srclk: false, rclk: false, oeBar: false, srclrBar: true,
}
const DEFAULT_PARALLEL_CONTROLS = { plBar: true, ceBar: false, cp: false, ser: false }
const DEFAULT_DECODER = { a: false, b: false, c: false, g1: true, g2aBar: false, g2bBar: false }

export default function ICDesignPanel({ onClose }: ICDesignPanelProps) {
  const saved = loadDomainDesign<ICDesign>('ic')
  const [activeTab, setActiveTab] = useState<ICTab>(
    saved?.activeTab && IC_TABS.includes(saved.activeTab) ? saved.activeTab : 'entry',
  )
  const flowTabsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const active = flowTabsRef.current?.querySelector<HTMLElement>('[aria-current="page"]')
    active?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [activeTab])
  useDemoRequest('ic-device-lab', runDeviceLabDemo)
  const [hdlCode, setHdlCode] = useState(
    typeof saved?.hdlCode === 'string' ? saved.hdlCode : DEFAULT_VERILOG,
  )
  const [hdlLanguage, setHdlLanguage] = useState<'verilog' | 'vhdl'>(
    saved?.hdlLanguage === 'vhdl' ? 'vhdl' : 'verilog',
  )
  const [synthResult, setSynthResult] = useState<SynthesisResult | null>(null)
  const [floorplanResult, setFloorplanResult] = useState<FloorplanResult | null>(null)
  const [selectedPackage, setSelectedPackage] = useState<ChipPackage | null>(null)
  const [gdsContent, setGdsContent] = useState<{ binary: ArrayBuffer; text: string } | null>(null)
  const [status, setStatus] = useState<Record<string, StepStatus>>({})
  const [log, setLog] = useState<string[]>([])

  // ── Device lab: behavioural logic and memory chips ─────────────────────────
  const [devicePartId, setDevicePartId] = useState(
    saved?.devicePartId && STANDARD_MEMORY.some((part) => part.id === saved.devicePartId)
      ? saved.devicePartId
      : 'hc595',
  )
  const deviceSpec = useMemo(
    () => STANDARD_MEMORY.find((part) => part.id === devicePartId) ?? STANDARD_MEMORY[0],
    [devicePartId],
  )
  const [shiftInputs, setShiftInputs] = useState<ShiftRegister595Inputs>(
    sanitizeShift(saved?.shiftInputs, DEFAULT_SHIFT),
  )
  const [shiftOutput, setShiftOutput] = useState<ShiftRegister595Outputs | null>(null)
  const [parallelBits, setParallelBits] = useState<number[]>(
    Array.isArray(saved?.parallelBits)
      && saved.parallelBits.length === 8
      && saved.parallelBits.every((bit) => bit === 0 || bit === 1)
      ? [...saved.parallelBits]
      : [1, 0, 1, 0, 0, 1, 1, 0],
  )
  const [parallelControls, setParallelControls] = useState(
    sanitizeParallelControls(saved?.parallelControls, DEFAULT_PARALLEL_CONTROLS),
  )
  const [parallelOutput, setParallelOutput] = useState<ShiftRegister165Outputs | null>(null)
  const [decoderInputs, setDecoderInputs] = useState(
    sanitizeDecoder(saved?.decoderInputs, DEFAULT_DECODER),
  )
  const shiftRef = useRef(new ShiftRegister595())
  const parallelRef = useRef(new ShiftRegister165())
  const memoryRef = useRef<MemoryDevice | null>(null)
  const [memoryAddress, setMemoryAddress] = useState(icInt(saved?.memoryAddress, 0, 0, 0xffff))
  const [memoryValue, setMemoryValue] = useState(icInt(saved?.memoryValue, 0x5a, 0, 0xff))
  const [memoryMessage, setMemoryMessage] = useState<string | null>(null)
  const [deviceLabReport, setDeviceLabReport] = useState<string[]>([])
  const [, setMemoryRevision] = useState(0)

  usePublishDomainDesign('ic', {
    activeTab, hdlCode, hdlLanguage, devicePartId, shiftInputs, parallelBits,
    parallelControls, decoderInputs, memoryAddress, memoryValue,
  }, (next) => {
    if (next.activeTab && IC_TABS.includes(next.activeTab)) setActiveTab(next.activeTab)
    if (typeof next.hdlCode === 'string') setHdlCode(next.hdlCode)
    if (next.hdlLanguage === 'verilog' || next.hdlLanguage === 'vhdl') setHdlLanguage(next.hdlLanguage)
    if (next.devicePartId && STANDARD_MEMORY.some((part) => part.id === next.devicePartId)) {
      setDevicePartId(next.devicePartId)
    }
    setShiftInputs(sanitizeShift(next.shiftInputs, DEFAULT_SHIFT))
    if (Array.isArray(next.parallelBits) && next.parallelBits.length === 8) {
      setParallelBits(next.parallelBits.map((bit) => (bit === 1 ? 1 : 0)))
    }
    setParallelControls(sanitizeParallelControls(next.parallelControls, DEFAULT_PARALLEL_CONTROLS))
    setDecoderInputs(sanitizeDecoder(next.decoderInputs, DEFAULT_DECODER))
    setMemoryAddress(icInt(next.memoryAddress, 0, 0, 0xffff))
    setMemoryValue(icInt(next.memoryValue, 0x5a, 0, 0xff))
    // Behavioural models are runtime state; start them clean for the restored inputs.
    shiftRef.current = new ShiftRegister595()
    parallelRef.current = new ShiftRegister165()
    setShiftOutput(null)
    setParallelOutput(null)
    setMemoryMessage(null)
  })

  /*
   * Part changes reset the behavioural models explicitly. This used to be an
   * effect on `deviceSpec`, but the demo stages a whole sequence (shift, load,
   * decode, then flash) in one handler; an effect would wipe each step as the
   * next part rendered. The user path and the demo now share this function.
   */
  const loadDevicePart = (partId: string) => {
    const spec = STANDARD_MEMORY.find((part) => part.id === partId) ?? STANDARD_MEMORY[0]
    setDevicePartId(partId)
    shiftRef.current = new ShiftRegister595()
    parallelRef.current = new ShiftRegister165()
    setShiftOutput(null)
    setParallelOutput(null)
    setMemoryAddress(0)
    setMemoryMessage(null)
    try {
      memoryRef.current = memoryDeviceFromSpec(spec)
    } catch {
      memoryRef.current = null
    }
  }

  /**
   * Gallery demo: run one real operation on each behavioural model, then leave
   * the flash device selected so the page-inspect/erase/program semantics are
   * visible. The report is the evidence for the parts whose UI is no longer on
   * screen; every line is produced by the model, never hard-coded.
   */
  function runDeviceLabDemo() {
    setActiveTab('devices')
    const report: string[] = []

    // 74HC595: shift 0xA6 LSB-first, latch it into the output register.
    shiftRef.current = new ShiftRegister595()
    let shiftIn: ShiftRegister595Inputs = {
      ser: false, srclk: false, rclk: false, oeBar: false, srclrBar: true,
    }
    let shiftOut = shiftRef.current.step(shiftIn)
    for (let bit = 0; bit < 8; bit += 1) {
      const level = (0xa6 >> bit) & 1
      shiftIn = { ...shiftIn, ser: level === 1, srclk: true }
      shiftRef.current.step(shiftIn)
      shiftIn = { ...shiftIn, srclk: false }
      shiftOut = shiftRef.current.step(shiftIn)
    }
    shiftIn = { ...shiftIn, rclk: true }
    shiftRef.current.step(shiftIn)
    shiftIn = { ...shiftIn, rclk: false }
    shiftOut = shiftRef.current.step(shiftIn)
    setShiftInputs(shiftIn)
    setShiftOutput(shiftOut)
    report.push(
      `74HC595: shifted 0xA6 LSB-first, latched 0x${shiftOut.latchRegister.toString(16).padStart(2, '0')}, ` +
      `QH′ ${shiftOut.serialOut}, outputs ${shiftOut.outputsEnabled ? 'enabled' : 'high-Z'}.`,
    )

    // 74HC165: parallel-load the D0..D7 switches, then clock one bit out.
    parallelRef.current = new ShiftRegister165()
    const loaded = parallelRef.current.step({ ...parallelControls, plBar: false, parallel: parallelBits })
    const shifted = parallelRef.current.step({
      ...parallelControls, plBar: true, ceBar: false, cp: true, parallel: parallelBits,
    })
    setParallelOutput(shifted)
    report.push(
      `74HC165: parallel-loaded 0x${loaded.register.toString(16).padStart(2, '0')} from D0..D7, ` +
      `one clock → 0x${shifted.register.toString(16).padStart(2, '0')} (QH ${shifted.qh}).`,
    )

    // 74HC138: decode CBA=101 while enabled; Y5 must be the only low output.
    const decodeInputs = { a: true, b: false, c: true, g1: true, g2aBar: false, g2bBar: false }
    setDecoderInputs(decodeInputs)
    const decoded = decode138(decodeInputs)
    report.push(
      `74HC138: CBA=101 with G1 high selects Y${decoded.selected} (active low); ` +
      `${decoded.outputs.filter((level) => level === 0).length} output low.`,
    )

    // NOR flash: erase, program 0x5A, then try to set bits without erasing.
    loadDevicePart('flash-w25q128')
    const flash = memoryRef.current
    if (flash) {
      const erased = flash.eraseSector(0)
      flash.writeByte(0, 0x5a)
      const stored = flash.writeByte(0, 0xf0)
      setMemoryAddress(0)
      setMemoryValue(0xf0)
      setMemoryMessage(
        `Erased sector 0 (${erased.bytesErased} bytes, ${erased.timeMs} ms), wrote 0x5a, then 0xf0 → ` +
        `0x${stored.stored.toString(16).padStart(2, '0')} because NOR flash can only clear bits; ` +
        `read back 0x${flash.readByte(0).toString(16).padStart(2, '0')}.`,
      )
      report.push(
        `W25Q128JV: sector erase ${erased.bytesErased} bytes in ${erased.timeMs} ms; ` +
        `0x5a then 0xf0 stored 0x${stored.stored.toString(16).padStart(2, '0')} (AND semantics, ${stored.timeMs} ms).`,
      )
      setMemoryRevision((revision) => revision + 1)
    } else {
      report.push('W25Q128JV: no byte-addressed model available.')
    }

    setDeviceLabReport(report)
  }

  const stepShift595 = () => {
    setShiftOutput(shiftRef.current.step(shiftInputs))
  }

  const stepParallel165 = () => {
    try {
      setParallelOutput(parallelRef.current.step({ ...parallelControls, parallel: parallelBits }))
    } catch (error) {
      setMemoryMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const runMemoryOperation = (operation: 'read' | 'write' | 'erase') => {
    const memory = memoryRef.current
    if (!memory) return
    try {
      if (operation === 'read') {
        setMemoryMessage(`0x${memoryAddress.toString(16)} = 0x${memory.readByte(memoryAddress).toString(16).padStart(2, '0')}`)
      } else if (operation === 'write') {
        const result = memory.writeByte(memoryAddress, memoryValue)
        setMemoryMessage(
          `Wrote 0x${result.stored.toString(16).padStart(2, '0')} at 0x${result.address.toString(16)} in ${result.timeMs} ms${result.stored !== memoryValue ? ' (flash kept the zero bits)' : ''}.`,
        )
      } else {
        const result = memory.eraseSector(memoryAddress)
        setMemoryMessage(
          `Erased ${result.bytesErased} bytes from 0x${result.startAddress.toString(16)} in ${result.timeMs} ms.`,
        )
      }
      setMemoryRevision((revision) => revision + 1)
    } catch (error) {
      setMemoryMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const memoryIsArray = deviceSpec.capacityBits !== undefined && deviceSpec.kind !== 'shift-register' && deviceSpec.kind !== 'decoder'
  const memoryBytes = memoryIsArray && memoryRef.current
    ? Array.from(memoryRef.current.bytes().slice(0, 16))
    : null

  const appendLog = (msg: string) => setLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`])

  const setStep = (step: string, patch: Partial<StepStatus>) =>
    setStatus(prev => {
      const current = prev[step] ?? { done: false, running: false }
      return { ...prev, [step]: { ...current, ...patch } }
    })

  /** Any edit invalidates downstream results — never export a stale design. */
  const handleHdlChange = (code: string, language: 'verilog' | 'vhdl') => {
    setHdlCode(code)
    setHdlLanguage(language)
    setSynthResult(null)
    setFloorplanResult(null)
    setGdsContent(null)
  }

  const handleSynthesize = useCallback(async (code = hdlCode, language = hdlLanguage) => {
    setStep('synthesis', { running: true, done: false, error: undefined })
    // A new netlist invalidates every downstream artifact.
    setFloorplanResult(null)
    setSelectedPackage(null)
    setGdsContent(null)
    appendLog('Starting synthesis on SKY130 PDK…')
    try {
      const design = language === 'verilog'
        ? (() => {
            const elab = parseVerilogModule(code)
            return {
              name: elab.name,
              netlist: elab.netlist,
              ports: elab.ports.map((port) => ({ name: port.name, direction: port.direction })),
            }
          })()
        : (() => {
            const elab = parseVhdl(code)
            return {
              name: elab.entity,
              netlist: elab.netlist,
              ports: elab.ports.map((port) => ({
                name: port.name,
                direction: port.direction === 'in' ? 'input' as const : 'output' as const,
              })),
            }
          })()
      appendLog(`Parsed ${language === 'verilog' ? 'module' : 'entity'}: ${design.name} (${design.ports.length} ports)`)
      const result = synthesize(design.netlist, design.ports)
      setSynthResult(result)
      appendLog(`Synthesis complete: ${result.cells.length} cells, ${result.totalArea.toFixed(2)} µm², critical path ${result.criticalPathPs.toFixed(0)} ps`)
      setStep('synthesis', { done: true, running: false, error: undefined })
      setActiveTab('floorplan')
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      appendLog(`Synthesis failed: ${msg}`)
      setStep('synthesis', { running: false, error: msg })
      return null
    }
  }, [hdlCode, hdlLanguage])

  // The full-flow demo runs every stage on the preloaded full adder, stopping
  // on the GDSII summary rather than leaving an empty floorplan tab.
  useDemoRequest('ic-full-flow', () => {
    setHdlCode(DEFAULT_VERILOG)
    setHdlLanguage('verilog')
    setLog([])
    setStatus({})
    setSynthResult(null)
    setFloorplanResult(null)
    setSelectedPackage(null)
    setGdsContent(null)
    void (async () => {
      const synthesized = await handleSynthesize(DEFAULT_VERILOG, 'verilog')
      if (!synthesized) return
      const plan = planFloorplan(synthesized)
      setFloorplanResult(plan)
      appendLog(`Floorplan: die ${plan.dieWidthUm.toFixed(1)}×${plan.dieHeightUm.toFixed(1)} µm, utilization ${plan.utilizationPercent.toFixed(1)}%`)
      setStep('floorplan', { done: true, running: false, error: undefined })
      const pkg = PACKAGE_TYPES.find((candidate) => candidate.id === 'qfn-32') ?? PACKAGE_TYPES[0]
      setSelectedPackage(pkg)
      appendLog(`Package selected: ${pkg.name}`)
      setStep('packaging', { done: true, running: false, error: undefined })
      const gds = exportGDSII(synthesized, plan)
      setGdsContent(gds)
      appendLog(`GDSII generated: ${gds.binary.byteLength} bytes`)
      setStep('export', { done: true, running: false, error: undefined })
      setActiveTab('export')
    })()
  })

  const handleFloorplan = useCallback(async () => {
    if (!synthResult) { appendLog('Run synthesis first.'); return }
    setStep('floorplan', { running: true, done: false, error: undefined })
    appendLog('Planning floorplan…')
    try {
      const result = planFloorplan(synthResult)
      setFloorplanResult(result)
      appendLog(`Floorplan: die ${result.dieWidthUm.toFixed(1)}×${result.dieHeightUm.toFixed(1)} µm, utilization ${(result.utilizationPercent).toFixed(1)}%`)
      setStep('floorplan', { done: true, running: false, error: undefined })
      setActiveTab('packaging')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      appendLog(`Floorplan failed: ${msg}`)
      setStep('floorplan', { running: false, error: msg })
    }
  }, [synthResult])

  const handleExportGDSII = useCallback(() => {
    if (!synthResult || !floorplanResult) { appendLog('Complete synthesis and floorplan first.'); return }
    setStep('export', { running: true, done: false, error: undefined })
    appendLog('Generating GDSII stream…')
    try {
      const gds = exportGDSII(synthResult, floorplanResult)
      setGdsContent(gds)
      appendLog(`GDSII generated: ${gds.binary.byteLength} bytes`)
      setStep('export', { done: true, running: false, error: undefined })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      appendLog(`GDSII export failed: ${msg}`)
      setStep('export', { running: false, error: msg })
    }
  }, [synthResult, floorplanResult])

  const downloadGDSII = () => {
    if (!gdsContent) return
    const blob = new Blob([gdsContent.binary], { type: 'application/octet-stream' })
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
    { id: 'devices', label: 'Device Lab', step: null },
    { id: 'export', label: 'GDSII Export', step: 'export' },
  ] as const

  return (
    <div className="flex flex-col h-full bg-background text-foreground overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Cpu size={16} className="text-chart-4" />
          <h2 className="text-sm font-semibold">IC Design — SkyWater SKY130</h2>
        </div>
        {onClose && <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close IC design panel" className="text-muted-foreground">✕</Button>}
      </div>

      {/* Flow tabs */}
      <div className="relative shrink-0 border-b border-border">
        <div ref={flowTabsRef} className="scrollbar-none flex overflow-x-auto">
        {TABS.map((tab, i) => {
          const s = tab.step ? status[tab.step] : undefined
          return (
            <button key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              aria-current={activeTab === tab.id ? 'page' : undefined}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs whitespace-nowrap transition-colors ${
                activeTab === tab.id ? 'border-b-2 border-chart-4/50 text-chart-4' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {i > 0 && <ChevronRight size={10} className="text-muted-foreground" />}
              {s?.done && <CheckCircle size={10} className="text-success" />}
              {s?.error && <AlertCircle size={10} className="text-destructive" />}
              {s?.running && <RefreshCw size={10} className="text-warning animate-spin" />}
              {tab.label}
            </button>
          )
        })}
        </div>
        <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-background to-transparent" aria-hidden="true" />
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        {/* Main content */}
        <div className="min-h-0 flex-1 overflow-hidden">
          {activeTab === 'entry' && (
            <Suspense fallback={<div className="flex items-center justify-center h-full text-muted-foreground text-sm">Loading editor…</div>}>
              <HDLEditor
                initialCode={hdlCode}
                language={hdlLanguage}
                onCodeChange={handleHdlChange}
              />
            </Suspense>
          )}

          {activeTab === 'synthesis' && (
            <div className="p-4 space-y-4 overflow-y-auto h-full">
              <div className="flex items-center gap-2">
                <Button onClick={() => { void handleSynthesize() }} className="bg-primary hover:bg-primary/90" size="sm"
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
                      { label: 'Critical path', value: synthResult.metrics.criticalPathDelayPs > 0 ? `${synthResult.metrics.criticalPathDelayPs} ps` : 'n/a' },
                      { label: 'Max freq', value: synthResult.metrics.maxOperatingFreqMhz > 0 ? `${synthResult.metrics.maxOperatingFreqMhz} MHz` : 'n/a' },
                      { label: 'Static power', value: `${(synthResult.staticPowerUw ?? 0).toFixed(2)} µW` },
                      { label: 'Dynamic power', value: `${(synthResult.dynamicPowerMw ?? 0).toFixed(3)} mW` },
                    ].map(({ label, value }) => (
                      <div key={label} className="bg-card rounded p-2">
                        <p className="text-xs text-muted-foreground">{label}</p>
                        <p className="text-sm font-mono text-foreground">{value}</p>
                      </div>
                    ))}
                  </div>

                  <div>
                    <p className="text-xs text-muted-foreground mb-1.5">Cell breakdown</p>
                    <div className="max-h-48 overflow-y-auto rounded border border-border">
                      <table className="w-full text-xs">
                        <thead className="bg-card sticky top-0">
                          <tr>
                            {['Cell', 'Drive', 'Count', 'Area (µm²)', 'Delay (ps)'].map(h => (
                              <th key={h} className="text-left px-2 py-1 text-muted-foreground">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {synthResult.cells.slice(0, 20).map((cell, i) => (
                            <tr key={i} className="border-t border-border/50">
                              <td className="px-2 py-1 font-mono text-chart-4">{cell.name}</td>
                              <td className="px-2 py-1 text-muted-foreground">{cell.driveStrength ?? 1}</td>
                              <td className="px-2 py-1 text-foreground">1</td>
                              <td className="px-2 py-1 text-foreground">{cell.area.toFixed(3)}</td>
                              <td className="px-2 py-1 text-foreground">{(cell.delayPs ?? 0).toFixed(0)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <Button onClick={handleFloorplan} size="sm" className="bg-primary hover:bg-primary/90">
                    Continue → Floorplan
                  </Button>
                </div>
              )}
            </div>
          )}

          {activeTab === 'floorplan' && (
            <div className="p-4 space-y-4 overflow-y-auto h-full">
              {!synthResult && (
                <p className="text-sm text-muted-foreground">Run synthesis first to generate a netlist for floorplanning.</p>
              )}
              {synthResult && (
                <>
                  <Button onClick={handleFloorplan} size="sm" className="bg-primary hover:bg-primary/90"
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
                          <div key={label} className="bg-card rounded p-2">
                            <p className="text-xs text-muted-foreground">{label}</p>
                            <p className="text-sm font-mono text-foreground">{value}</p>
                          </div>
                        ))}
                      </div>

                      {/* Die visualization */}
                      <div className="bg-card rounded p-3">
                        <p className="text-xs text-muted-foreground mb-2">Die preview (not to scale)</p>
                        <div className="relative bg-canvas rounded border border-border"
                          style={{ height: 160, width: '100%' }}>
                          <div className="absolute inset-4 border-2 border-success/50 rounded" />
                          <div className="absolute inset-6 bg-chart-4/15 rounded flex items-center justify-center">
                            <div className="text-center">
                              <Cpu size={20} className="mx-auto text-chart-4 mb-1" />
                              <p className="text-xs text-chart-4">{synthResult.cells.length} cells</p>
                              <p className="text-xs text-muted-foreground">{floorplanResult.utilizationPercent.toFixed(1)}% utilized</p>
                            </div>
                          </div>
                        </div>
                      </div>

                      <Button onClick={() => setActiveTab('packaging')} size="sm" className="bg-primary hover:bg-primary/90">
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
              <p className="text-xs text-muted-foreground">Select a package type for the die.</p>
              <div className="grid grid-cols-2 gap-2">
                {PACKAGE_TYPES.slice(0, 8).map(pkg => (
                  <div key={pkg.id}
                    onClick={() => setSelectedPackage(pkg)}
                    className={`cursor-pointer rounded-lg p-3 border transition-colors ${
                      selectedPackage?.id === pkg.id
                        ? 'border-chart-4/50 bg-chart-4/10'
                        : 'border-border bg-card hover:border-primary/60'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Package size={13} className={selectedPackage?.id === pkg.id ? 'text-chart-4' : 'text-muted-foreground'} />
                      <span className="font-mono text-sm text-foreground">{pkg.name}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{pkg.description}</p>
                    <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                      <span>{pkg.pinCount} pins</span>
                      <span>{pkg.bodySize}</span>
                    </div>
                  </div>
                ))}
              </div>
              {selectedPackage && (
                <div className="bg-card rounded p-3">
                  <p className="text-xs text-muted-foreground mb-1">Package details</p>
                  <pre className="text-xs text-success font-mono whitespace-pre-wrap">
                    {generatePackageDescription(selectedPackage)}
                  </pre>
                </div>
              )}
              <Button onClick={() => setActiveTab('export')} size="sm" className="bg-primary hover:bg-primary/90">
                Continue → GDSII Export
              </Button>
            </div>
          )}

          {activeTab === 'devices' && (
            <div className="p-4 space-y-4 overflow-y-auto h-full">
              <div>
                <label htmlFor="device-part" className="text-xs text-muted-foreground block mb-1">Logic / memory part</label>
                <select
                  id="device-part"
                  value={devicePartId}
                  onChange={(event) => loadDevicePart(event.target.value)}
                  className="w-full rounded border border-border bg-card px-2 py-1.5 text-sm text-foreground"
                >
                  {STANDARD_MEMORY.map((part) => (
                    <option key={part.id} value={part.id}>{part.partNumber} — {part.name}</option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground mt-1">{deviceSpec.description}</p>
              </div>

              {deviceLabReport.length > 0 && (
                <div
                  role="status"
                  aria-label="Device lab demo report"
                  className="space-y-1 rounded border border-chart-4/40 bg-chart-4/10 p-3 text-xs"
                >
                  <p className="font-medium text-chart-4">
                    Device lab demo — every line below comes from the behavioural models:
                  </p>
                  {deviceLabReport.map((line) => (
                    <p key={line} className="font-mono leading-relaxed text-foreground/90">{line}</p>
                  ))}
                </div>
              )}

              {deviceSpec.partNumber === '74HC595' && (
                <div className="bg-card rounded p-3 space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Clock edges are detected between steps: toggle SRCLK on then off to shift one bit.
                  </p>
                  <div className="flex flex-wrap gap-3">
                    {([
                      ['ser', 'SER'], ['srclk', 'SRCLK'], ['rclk', 'RCLK'],
                      ['srclrBar', 'SRCLR̅'], ['oeBar', 'OE̅'],
                    ] as const).map(([key, label]) => (
                      <label key={key} className="flex items-center gap-1.5 text-xs text-foreground">
                        <input
                          type="checkbox"
                          checked={shiftInputs[key]}
                          onChange={(event) => setShiftInputs((prev) => ({ ...prev, [key]: event.target.checked }))}
                          aria-label={label}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  <Button size="sm" onClick={stepShift595} className="bg-primary hover:bg-primary/90">
                    Apply step
                  </Button>
                  {shiftOutput && (
                    <div className="space-y-2">
                      <div className="flex gap-1">
                        {shiftOutput.outputs.map((bit, index) => (
                          <span
                            key={index}
                            title={`Q${String.fromCharCode(65 + index)}`}
                            className={`flex h-6 w-6 items-center justify-center rounded-sm border text-[10px] ${
                              shiftOutput.outputsEnabled && bit
                                ? 'border-success bg-success text-success-foreground'
                                : 'border-border bg-muted text-muted-foreground'
                            }`}
                          >
                            {`Q${String.fromCharCode(65 + index)}`}
                          </span>
                        ))}
                      </div>
                      <p className="text-xs font-mono text-success">
                        Shift 0x{shiftOutput.shiftRegister.toString(16).padStart(2, '0')} ·
                        Latch 0x{shiftOutput.latchRegister.toString(16).padStart(2, '0')} ·
                        QH′ {shiftOutput.serialOut} ·
                        outputs {shiftOutput.outputsEnabled ? 'enabled' : 'high-Z'}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {deviceSpec.partNumber === '74HC165' && (
                <div className="bg-card rounded p-3 space-y-3">
                  <p className="text-xs text-muted-foreground">Parallel inputs D0..D7 (D0 first out).</p>
                  <div className="flex flex-wrap gap-2">
                    {parallelBits.map((bit, index) => (
                      <label key={index} className="flex items-center gap-1 text-xs text-foreground">
                        <input
                          type="checkbox"
                          checked={bit === 1}
                          aria-label={`D${index}`}
                          onChange={(event) => setParallelBits((prev) =>
                            prev.map((value, position) => position === index ? (event.target.checked ? 1 : 0) : value))}
                        />
                        D{index}
                      </label>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {([
                      ['plBar', 'PL̅'], ['ceBar', 'CE'], ['cp', 'CP'], ['ser', 'SER'],
                    ] as const).map(([key, label]) => (
                      <label key={key} className="flex items-center gap-1.5 text-xs text-foreground">
                        <input
                          type="checkbox"
                          checked={parallelControls[key]}
                          aria-label={label}
                          onChange={(event) => setParallelControls((prev) => ({ ...prev, [key]: event.target.checked }))}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  <Button size="sm" onClick={stepParallel165} className="bg-primary hover:bg-primary/90">
                    Apply step
                  </Button>
                  {parallelOutput && (
                    <p className="text-xs font-mono text-success">
                      Register 0x{parallelOutput.register.toString(16).padStart(2, '0')} ·
                      QH {parallelOutput.qh} · QH̅ {parallelOutput.qhBar}
                    </p>
                  )}
                </div>
              )}

              {deviceSpec.partNumber === '74HC138' && (
                <div className="bg-card rounded p-3 space-y-3">
                  <div className="flex flex-wrap gap-3">
                    {([
                      ['a', 'A'], ['b', 'B'], ['c', 'C'], ['g1', 'G1'],
                      ['g2aBar', 'G2A̅'], ['g2bBar', 'G2B̅'],
                    ] as const).map(([key, label]) => (
                      <label key={key} className="flex items-center gap-1.5 text-xs text-foreground">
                        <input
                          type="checkbox"
                          checked={decoderInputs[key]}
                          aria-label={label}
                          onChange={(event) => setDecoderInputs((prev) => ({ ...prev, [key]: event.target.checked }))}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  <div className="flex gap-1">
                    {decode138(decoderInputs).outputs.map((level, index) => (
                      <span
                        key={index}
                        className={`flex h-6 w-8 items-center justify-center rounded-sm border text-[10px] ${
                          level === 0
                            ? 'border-success bg-success text-success-foreground'
                            : 'border-border bg-muted text-muted-foreground'
                        }`}
                      >
                        Y{index}
                      </span>
                    ))}
                  </div>
                  <p className="text-xs font-mono text-success">
                    {decode138(decoderInputs).enabled
                      ? `Selected Y${decode138(decoderInputs).selected} (active low)`
                      : 'Disabled — all outputs high'}
                  </p>
                </div>
              )}

              {memoryIsArray && (
                <div className="bg-card rounded p-3 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="memory-address" className="text-xs text-muted-foreground block mb-1">Address (0x…)</label>
                      <input
                        id="memory-address"
                        type="number"
                        min="0"
                        max={(deviceSpec.capacityBits ?? 0) / 8 - 1}
                        value={memoryAddress}
                        onChange={(event) => {
                          const next = Number(event.target.value)
                          const limit = (deviceSpec.capacityBits ?? 0) / 8 - 1
                          if (Number.isInteger(next) && next >= 0 && next <= limit) setMemoryAddress(next)
                        }}
                        className="w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground"
                      />
                    </div>
                    <div>
                      <label htmlFor="memory-value" className="text-xs text-muted-foreground block mb-1">Value (0–255)</label>
                      <input
                        id="memory-value"
                        type="number"
                        min="0"
                        max="255"
                        value={memoryValue}
                        onChange={(event) => {
                          const next = Number(event.target.value)
                          if (Number.isInteger(next) && next >= 0 && next <= 255) setMemoryValue(next)
                        }}
                        className="w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="border-border" onClick={() => runMemoryOperation('read')}>
                      Read
                    </Button>
                    <Button size="sm" variant="outline" className="border-border" onClick={() => runMemoryOperation('write')}>
                      Write
                    </Button>
                    {deviceSpec.kind === 'flash' && (
                      <Button size="sm" variant="outline" className="border-border" onClick={() => runMemoryOperation('erase')}>
                        Erase sector
                      </Button>
                    )}
                  </div>
                  {memoryMessage && <p className="text-xs font-mono text-success">{memoryMessage}</p>}
                  <div className="text-xs text-muted-foreground">
                    {Math.round((deviceSpec.capacityBits ?? 0) / 8)} bytes ·
                    {' '}{deviceSpec.interface ?? 'parallel'} ·
                    {' '}page {memoryRef.current?.pageSizeBytes ?? '—'} bytes ·
                    {' '}write {memoryRef.current?.writeCycleMs ?? 0} ms
                  </div>
                  {memoryBytes && (
                    <p className="font-mono text-xs text-foreground break-all">
                      {memoryBytes.map((byte, index) =>
                        `${index.toString(16).padStart(2, '0')}:${byte.toString(16).padStart(2, '0')}`).join(' ')}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === 'export' && (
            <div className="p-4 space-y-4 overflow-y-auto h-full">
              <div className="flex gap-2">
                <Button onClick={handleExportGDSII} size="sm" className="bg-success hover:bg-success/90"
                  disabled={!synthResult || status['export']?.running}>
                  {status['export']?.running
                    ? <RefreshCw size={13} className="animate-spin mr-1" />
                    : <BarChart3 size={13} className="mr-1" />}
                  Generate GDSII
                </Button>
                {gdsContent && (
                  <Button onClick={downloadGDSII} size="sm" variant="outline" className="border-border">
                    <Download size={13} className="mr-1" /> Download .gds
                  </Button>
                )}
              </div>

              {gdsContent && (
                <div className="bg-card rounded p-3">
                  <p className="text-xs text-muted-foreground mb-1">GDSII summary</p>
                  <pre className="text-xs font-mono text-success overflow-x-auto whitespace-pre-wrap">
                    {gdsContent.text}
                  </pre>
                  <p className="text-xs text-muted-foreground mt-1">{gdsContent.binary.byteLength} bytes total</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Log pane */}
        <div className="flex max-h-[35%] w-full shrink-0 flex-col overflow-hidden border-t border-border lg:max-h-none lg:w-56 lg:border-l lg:border-t-0">
          <div className="px-3 py-2 border-b border-border shrink-0">
            <p className="text-xs text-muted-foreground">Build log</p>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {log.length === 0 && <p className="text-xs text-muted-foreground">No output yet.</p>}
            {log.map((line, i) => (
              <p key={i} className="text-xs font-mono text-muted-foreground leading-4">{line}</p>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
