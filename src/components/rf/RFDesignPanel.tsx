import { useEffect, useMemo, useState } from 'react'
import { useDemoRequest } from '../workspace/useDemoRequest'
import { Activity, Download, Info, Radio, X } from 'lucide-react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Input } from '../ui/input'
import { AntennaDesigner, type AntennaArray, type AntennaElement } from '../../lib/rf/antennaDesign'
import {
  RFCircuitDesigner,
  type RFPerformanceMetrics,
  type RFCircuit,
  type ScatteringParameters,
} from '../../lib/rf/rfCircuitDesign'
import { useTheme } from '../../lib/theme/useTheme'
import { chartSeriesColors } from '../../lib/theme/tokens'
import { describeError } from '../../lib/utils'

interface RFDesignPanelProps {
  onClose: () => void
}

type PanelTab = 'antenna' | 'filter'
type AntennaKind = 'dipole' | 'monopole' | 'patch' | 'yagi' | 'phased'
type FilterKind = 'lowpass' | 'highpass' | 'bandpass'

interface AntennaResult {
  elements: AntennaElement[]
  pattern: { theta: number[]; gain: number[][] }
  label: string
}

interface FilterResult {
  circuit: RFCircuit
  metrics: RFPerformanceMetrics
  sweep: ScatteringParameters[]
  startMHz: number
  stopMHz: number
}

const ANTENNA_LABELS: Record<AntennaKind, string> = {
  dipole: 'Half-wave dipole',
  monopole: 'Quarter-wave monopole',
  patch: 'Microstrip patch',
  yagi: 'Yagi-Uda array',
  phased: 'Phased patch array',
}

const FILTER_LABELS: Record<FilterKind, string> = {
  lowpass: 'Low-pass',
  highpass: 'High-pass',
  bandpass: 'Band-pass',
}

const DIMENSION_LABELS: Record<string, string> = {
  length: 'Length',
  width: 'Width',
  height: 'Height / substrate',
  radius: 'Wire radius',
  groundPlaneRadius: 'Ground plane radius',
  effectiveEpsilon: 'Effective εr',
  feedOffset: 'Feed offset',
}

function formatLength(meters: number): string {
  if (!Number.isFinite(meters)) return '—'
  if (Math.abs(meters) >= 1) return `${meters.toFixed(3)} m`
  return `${(meters * 1000).toFixed(2)} mm`
}

function formatEng(value: number, unit: string): string {
  if (!Number.isFinite(value)) return '—'
  if (value === 0) return `0 ${unit}`
  const scales: Array<[number, string]> = [
    [1e9, 'G'],
    [1e6, 'M'],
    [1e3, 'k'],
    [1, ''],
    [1e-3, 'm'],
    [1e-6, 'µ'],
    [1e-9, 'n'],
    [1e-12, 'p'],
    [1e-15, 'f'],
  ]
  const magnitude = Math.abs(value)
  for (const [scale, prefix] of scales) {
    if (magnitude >= scale) {
      const scaled = value / scale
      const digits = Math.abs(scaled) >= 100 ? 1 : Math.abs(scaled) >= 10 ? 2 : 3
      return `${scaled.toFixed(digits)} ${prefix}${unit}`
    }
  }
  return `${value.toExponential(3)} ${unit}`
}

function formatDb(value: number): string {
  if (Number.isNaN(value)) return '—'
  if (!Number.isFinite(value)) return value > 0 ? '∞' : '−∞'
  return `${value.toFixed(2)} dB`
}

function formatReturnLoss(value: number): string {
  if (Number.isNaN(value)) return '—'
  if (!Number.isFinite(value)) return 'matched (∞)'
  return `${value.toFixed(1)} dB`
}

function formatFrequency(mhz: number): string {
  if (mhz >= 1000) return `${(mhz / 1000).toFixed(3)} GHz`
  return `${mhz.toFixed(1)} MHz`
}

function formatAxisFrequency(mhz: number): string {
  if (mhz >= 1000) return `${(mhz / 1000).toFixed(mhz >= 10000 ? 0 : 1)} GHz`
  return `${mhz.toFixed(0)} MHz`
}

function halfPowerBeamwidth(theta: number[], gains: number[]): number {
  let peakIndex = 0
  for (let index = 1; index < gains.length; index += 1) {
    if (gains[index] > gains[peakIndex]) peakIndex = index
  }
  const threshold = gains[peakIndex] - 3
  let left = peakIndex
  let right = peakIndex
  while (left > 0 && gains[left - 1] >= threshold) left -= 1
  while (right < gains.length - 1 && gains[right + 1] >= threshold) right += 1
  if (peakIndex === 0) return 2 * theta[right]
  if (peakIndex === gains.length - 1) return 2 * (180 - theta[left])
  return theta[right] - theta[left]
}

function downloadText(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

interface NumberFieldProps {
  id: string
  label: string
  value: number
  unit?: string
  min?: number
  max?: number
  step?: number
  onChange: (value: number) => void
}

function NumberField({ id, label, value, unit, min, max, step, onChange }: NumberFieldProps) {
  const [draft, setDraft] = useState(String(value))

  useEffect(() => {
    setDraft(String(value))
  }, [value])

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <div className="relative">
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          className="h-9 pr-14"
          min={min}
          max={max}
          step={step}
          value={draft}
          onChange={(event) => {
            const next = event.target.value
            setDraft(next)
            const parsed = Number(next)
            if (next.trim() !== '' && Number.isFinite(parsed)) onChange(parsed)
          }}
          onBlur={() => {
            if (draft.trim() === '' || !Number.isFinite(Number(draft))) setDraft(String(value))
          }}
        />
        {unit && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            {unit}
          </span>
        )}
      </div>
    </div>
  )
}

function PolarPattern({
  theta,
  gains,
  color,
}: {
  theta: number[]
  gains: number[]
  color: string
}) {
  const size = 280
  const center = size / 2
  const radius = 102
  const floor = -30
  const peak = Math.max(...gains)
  const ceiling = Math.max(5, Math.ceil(peak / 5) * 5)

  const point = (angleDeg: number, gain: number, mirror: 1 | -1): [number, number] => {
    const normalized = Math.max(0, Math.min(1, (gain - floor) / (ceiling - floor)))
    const r = normalized * radius
    const angle = (angleDeg * Math.PI) / 180
    return [center + mirror * r * Math.sin(angle), center - r * Math.cos(angle)]
  }

  const right = gains.map((gain, index) => point(theta[index], gain, 1))
  const left = gains.map((gain, index) => point(theta[index], gain, -1)).reverse()
  const path = [
    `M ${center} ${center}`,
    ...right.map(([x, y]) => `L ${x.toFixed(2)} ${y.toFixed(2)}`),
    ...left.map(([x, y]) => `L ${x.toFixed(2)} ${y.toFixed(2)}`),
    'Z',
  ].join(' ')

  let peakIndex = 0
  for (let index = 1; index < gains.length; index += 1) {
    if (gains[index] > gains[peakIndex]) peakIndex = index
  }
  const [peakX, peakY] = point(theta[peakIndex], gains[peakIndex], 1)

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="mx-auto h-64 w-full max-w-xs"
      role="img"
      aria-label={`Principal-plane radiation pattern, peak ${peak.toFixed(2)} dBi`}
    >
      {[0.25, 0.5, 0.75, 1].map((fraction) => (
        <circle
          key={fraction}
          cx={center}
          cy={center}
          r={radius * fraction}
          fill="none"
          stroke="hsl(var(--border))"
          strokeWidth={1}
        />
      ))}
      {[0, 45, 90, 135, 180].map((angle) => {
        const [x, y] = point(angle, ceiling, 1)
        return (
          <line
            key={angle}
            x1={center}
            y1={center}
            x2={x}
            y2={y}
            stroke="hsl(var(--border))"
            strokeWidth={1}
          />
        )
      })}
      <path d={path} fill={color} fillOpacity={0.14} stroke={color} strokeWidth={2} />
      <circle cx={peakX} cy={peakY} r={3.5} fill={color} />
      <text x={center} y={12} textAnchor="middle" className="fill-muted-foreground text-[9px]">
        0°
      </text>
      <text x={size - 16} y={center + 3} textAnchor="middle" className="fill-muted-foreground text-[9px]">
        90°
      </text>
      <text x={center} y={size - 4} textAnchor="middle" className="fill-muted-foreground text-[9px]">
        180°
      </text>
      <text x={center + 6} y={center - radius * 0.55} className="fill-muted-foreground text-[9px]">
        {Math.round((floor + ceiling) / 2)} dBi
      </text>
    </svg>
  )
}

export default function RFDesignPanel({ onClose }: RFDesignPanelProps) {
  const { theme } = useTheme()
  const seriesColors = useMemo(() => chartSeriesColors(theme), [theme])

  const [tab, setTab] = useState<PanelTab>('antenna')
  useDemoRequest('rf-filter', () => setTab('filter'))

  const [antennaKind, setAntennaKind] = useState<AntennaKind>('dipole')
  const [frequencyMHz, setFrequencyMHz] = useState(2400)
  const [substrateHeightMM, setSubstrateHeightMM] = useState(1.6)
  const [dielectricConstant, setDielectricConstant] = useState(4.4)
  const [yagiElements, setYagiElements] = useState(5)
  const [arrayElements, setArrayElements] = useState(4)
  const [arrayLayout, setArrayLayout] = useState<'linear' | 'circular'>('linear')

  const [filterKind, setFilterKind] = useState<FilterKind>('lowpass')
  const [cutoffMHz, setCutoffMHz] = useState(1000)
  const [bandwidthMHz, setBandwidthMHz] = useState(100)
  const [order, setOrder] = useState(5)
  const [impedance, setImpedance] = useState(50)

  const antenna = useMemo<AntennaResult | { error: string }>(() => {
    try {
      const designer = new AntennaDesigner()
      const frequency = frequencyMHz * 1e6
      let designed: AntennaElement | AntennaArray
      switch (antennaKind) {
        case 'dipole':
          designed = designer.designDipole(frequency)
          break
        case 'monopole':
          designed = designer.designMonopole(frequency)
          break
        case 'patch':
          designed = designer.designPatchAntenna(frequency, substrateHeightMM / 1000, dielectricConstant)
          break
        case 'yagi':
          designed = designer.designYagiUda(frequency, yagiElements)
          break
        case 'phased':
          designed = designer.designPhasedArray(frequency, arrayElements, arrayLayout)
          break
      }
      const elements = 'elements' in designed ? designed.elements : [designed]
      const pattern = designer.calculateRadiationPattern(designed, 181)
      const label = 'elements' in designed ? designed.name : ANTENNA_LABELS[antennaKind]
      return {
        elements,
        pattern: {
          theta: pattern.theta,
          gain: pattern.gain,
        },
        label,
      }
    } catch (error) {
      return { error: describeError(error) }
    }
  }, [antennaKind, frequencyMHz, substrateHeightMM, dielectricConstant, yagiElements, arrayElements, arrayLayout])

  const filter = useMemo<FilterResult | { error: string }>(() => {
    try {
      const designer = new RFCircuitDesigner()
      const center = cutoffMHz * 1e6
      let circuit: RFCircuit
      if (filterKind === 'bandpass') {
        circuit = designer.designBandPassFilter(center, bandwidthMHz * 1e6, order, impedance)
      } else if (filterKind === 'highpass') {
        circuit = designer.designHighPassFilter(center, order, impedance)
      } else {
        circuit = designer.designLowPassFilter(center, order, impedance)
      }
      const metrics = designer.calculatePerformanceMetrics(circuit)
      const f0 = circuit.design?.centerFrequency ?? center
      const startHz = filterKind === 'bandpass' ? f0 / 5 : f0 / 100
      const stopHz = filterKind === 'bandpass' ? f0 * 5 : f0 * 10
      const sweep = designer.sweepSParameters(circuit, startHz, stopHz, 181)
      return { circuit, metrics, sweep, startMHz: startHz / 1e6, stopMHz: stopHz / 1e6 }
    } catch (error) {
      return { error: describeError(error) }
    }
  }, [filterKind, cutoffMHz, bandwidthMHz, order, impedance])

  const antennaData = 'error' in antenna ? null : antenna
  const filterData = 'error' in filter ? null : filter
  const antennaError = 'error' in antenna ? antenna.error : 'Antenna design failed.'
  const filterError = 'error' in filter ? filter.error : 'Filter design failed.'

  const antennaGains = antennaData ? antennaData.pattern.gain.map((point) => point[0]) : []
  const peakGain = antennaGains.length > 0 ? Math.max(...antennaGains) : Number.NaN
  const beamwidth =
    antennaData && antennaGains.length > 0
      ? halfPowerBeamwidth(antennaData.pattern.theta, antennaGains)
      : Number.NaN
  const referenceElement = antennaData?.elements[0]

  const filterChartData = filterData
    ? filterData.sweep.map((point) => ({
        mhz: point.frequency / 1e6,
        s21: 20 * Math.log10(Math.max(Math.hypot(point.s21.real, point.s21.imag), 1e-12)),
        s11: 20 * Math.log10(Math.max(Math.hypot(point.s11.real, point.s11.imag), 1e-12)),
      }))
    : []
  const s21Color = seriesColors[0]
  const s11Color = seriesColors[1] ?? seriesColors[0]

  const exportAntenna = () => {
    if (!antennaData) return
    const rows = ['theta_deg,gain_dbi']
    antennaData.pattern.theta.forEach((angle, index) => {
      rows.push(`${angle.toFixed(3)},${antennaData.pattern.gain[index][0].toFixed(4)}`)
    })
    downloadText(`antenna-${antennaKind}-pattern.csv`, rows.join('\n'), 'text/csv')
  }

  const exportFilter = () => {
    if (!filterData) return
    const rows = ['frequency_hz,s11_db,s21_db,s11_phase_deg,s21_phase_deg']
    for (const point of filterData.sweep) {
      const s11Db = 20 * Math.log10(Math.max(Math.hypot(point.s11.real, point.s11.imag), 1e-15))
      const s21Db = 20 * Math.log10(Math.max(Math.hypot(point.s21.real, point.s21.imag), 1e-15))
      const s11Phase = (Math.atan2(point.s11.imag, point.s11.real) * 180) / Math.PI
      const s21Phase = (Math.atan2(point.s21.imag, point.s21.real) * 180) / Math.PI
      rows.push(
        `${point.frequency.toExponential(8)},${s11Db.toFixed(4)},${s21Db.toFixed(4)},` +
          `${s11Phase.toFixed(4)},${s21Phase.toFixed(4)}`,
      )
    }
    downloadText(`filter-${filterKind}-${cutoffMHz}MHz.csv`, rows.join('\n'), 'text/csv')
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="rounded-md bg-primary/10 p-2 text-primary">
            <Radio className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-foreground">RF &amp; Microwave</h1>
            <p className="text-xs text-muted-foreground">
              Antenna synthesis and lumped Butterworth filters, computed from first principles
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border bg-muted p-0.5" role="tablist" aria-label="RF design tool">
            {(['antenna', 'filter'] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={`rounded-sm px-3 py-1.5 text-xs font-medium transition-colors ${
                  tab === value
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {value === 'antenna' ? 'Antennas' : 'Filters'}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close RF workspace">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="max-h-[45%] w-full flex-shrink-0 space-y-4 overflow-y-auto border-b border-border bg-card/40 p-4 lg:max-h-none lg:w-80 lg:border-b-0 lg:border-r">
          {tab === 'antenna' ? (
            <>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Antenna</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1">
                    <label htmlFor="antenna-kind" className="text-xs font-medium text-muted-foreground">
                      Topology
                    </label>
                    <select
                      id="antenna-kind"
                      value={antennaKind}
                      onChange={(event) => setAntennaKind(event.target.value as AntennaKind)}
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      {(Object.keys(ANTENNA_LABELS) as AntennaKind[]).map((kind) => (
                        <option key={kind} value={kind}>
                          {ANTENNA_LABELS[kind]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <NumberField
                    id="antenna-frequency"
                    label="Design frequency"
                    value={frequencyMHz}
                    unit="MHz"
                    min={0.001}
                    step={10}
                    onChange={setFrequencyMHz}
                  />
                  {antennaKind === 'patch' && (
                    <>
                      <NumberField
                        id="substrate-height"
                        label="Substrate height"
                        value={substrateHeightMM}
                        unit="mm"
                        min={0.05}
                        step={0.1}
                        onChange={setSubstrateHeightMM}
                      />
                      <NumberField
                        id="dielectric-constant"
                        label="Relative permittivity"
                        value={dielectricConstant}
                        min={1}
                        step={0.1}
                        onChange={setDielectricConstant}
                      />
                    </>
                  )}
                  {antennaKind === 'yagi' && (
                    <NumberField
                      id="yagi-elements"
                      label="Elements (reflector + driven + directors)"
                      value={yagiElements}
                      min={2}
                      max={12}
                      step={1}
                      onChange={setYagiElements}
                    />
                  )}
                  {antennaKind === 'phased' && (
                    <>
                      <NumberField
                        id="array-elements"
                        label="Array elements"
                        value={arrayElements}
                        min={2}
                        max={32}
                        step={1}
                        onChange={setArrayElements}
                      />
                      <div className="space-y-1">
                        <label htmlFor="array-layout" className="text-xs font-medium text-muted-foreground">
                          Array geometry
                        </label>
                        <select
                          id="array-layout"
                          value={arrayLayout}
                          onChange={(event) => setArrayLayout(event.target.value as 'linear' | 'circular')}
                          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                        >
                          <option value="linear">Linear, λ/2 spacing</option>
                          <option value="circular">Circular</option>
                        </select>
                      </div>
                    </>
                  )}
                  <Button variant="outline" className="w-full gap-2" onClick={exportAntenna} disabled={!antennaData}>
                    <Download className="h-4 w-4" />
                    Export pattern CSV
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Info className="h-4 w-4" />
                    Model basis
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs leading-relaxed text-muted-foreground">
                  Closed-form synthesis: half-wave dipole, quarter-wave monopole, transmission-line patch
                  model with fringing extension, and array-factor patterns. These are design estimates, not
                  full-wave EM results — verify the final geometry in a field solver or on the bench.
                </CardContent>
              </Card>
            </>
          ) : (
            <>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Filter</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1">
                    <label htmlFor="filter-kind" className="text-xs font-medium text-muted-foreground">
                      Response
                    </label>
                    <select
                      id="filter-kind"
                      value={filterKind}
                      onChange={(event) => setFilterKind(event.target.value as FilterKind)}
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      {(Object.keys(FILTER_LABELS) as FilterKind[]).map((kind) => (
                        <option key={kind} value={kind}>
                          {FILTER_LABELS[kind]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <NumberField
                    id="filter-frequency"
                    label={filterKind === 'bandpass' ? 'Center frequency' : 'Cutoff frequency'}
                    value={cutoffMHz}
                    unit="MHz"
                    min={0.001}
                    step={10}
                    onChange={setCutoffMHz}
                  />
                  {filterKind === 'bandpass' && (
                    <NumberField
                      id="filter-bandwidth"
                      label="Bandwidth"
                      value={bandwidthMHz}
                      unit="MHz"
                      min={0.001}
                      step={1}
                      onChange={setBandwidthMHz}
                    />
                  )}
                  <NumberField
                    id="filter-order"
                    label="Order (1–8)"
                    value={order}
                    min={1}
                    max={8}
                    step={1}
                    onChange={setOrder}
                  />
                  <NumberField
                    id="filter-impedance"
                    label="Termination"
                    value={impedance}
                    unit="Ω"
                    min={1}
                    step={5}
                    onChange={setImpedance}
                  />
                  <Button variant="outline" className="w-full gap-2" onClick={exportFilter} disabled={!filterData}>
                    <Download className="h-4 w-4" />
                    Export S-parameters CSV
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Info className="h-4 w-4" />
                    Model basis
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs leading-relaxed text-muted-foreground">
                  Butterworth prototype with equal terminations; the ladder is evaluated as an ABCD cascade
                  and converted to S-parameters. Elements are ideal unless a Q is attached. Component values
                  are exact synthesis values, not snapped to an E-series.
                </CardContent>
              </Card>
            </>
          )}
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto p-4">
          {tab === 'antenna' && (
            <div className="space-y-4">
              {antennaData ? (
                <>
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold text-foreground">{antennaData.label}</h2>
                      <p className="text-xs text-muted-foreground">
                        Principal E-plane cut, {formatFrequency(frequencyMHz)} · {antennaData.elements.length}{' '}
                        {antennaData.elements.length === 1 ? 'element' : 'elements'}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Metric label="Peak gain" value={`${peakGain.toFixed(2)} dBi`} />
                      <Metric
                        label="−3 dB beamwidth"
                        value={Number.isFinite(beamwidth) ? `${beamwidth.toFixed(1)}°` : '—'}
                      />
                      <Metric label="VSWR" value={`${(referenceElement?.parameters.vsWR ?? Number.NaN).toFixed(2)}:1`} />
                      <Metric label="Zin" value={`${(referenceElement?.parameters.impedance ?? Number.NaN).toFixed(1)} Ω`} />
                    </div>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Radiation pattern</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <PolarPattern
                          theta={antennaData.pattern.theta}
                          gains={antennaGains}
                          color={seriesColors[0]}
                        />
                        <p className="mt-2 text-center text-[11px] text-muted-foreground">
                          Mirror-symmetric principal-plane cut; pattern floor −30 dBi.
                        </p>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Synthesized geometry</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <dl className="space-y-2 text-xs">
                          {referenceElement &&
                            Object.entries(referenceElement.dimensions).map(([key, value]) => (
                              <div key={key} className="flex items-center justify-between gap-4 border-b border-border/60 pb-1.5">
                                <dt className="text-muted-foreground">{DIMENSION_LABELS[key] ?? key}</dt>
                                <dd className="font-mono text-foreground">
                                  {key === 'effectiveEpsilon' ? value.toFixed(3) : formatLength(value)}
                                </dd>
                              </div>
                            ))}
                          <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-1.5">
                            <dt className="text-muted-foreground">Wavelength</dt>
                            <dd className="font-mono text-foreground">
                              {formatLength(referenceElement?.parameters.wavelength ?? Number.NaN)}
                            </dd>
                          </div>
                          <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-1.5">
                            <dt className="text-muted-foreground">Element gain</dt>
                            <dd className="font-mono text-foreground">
                              {(referenceElement?.parameters.gain ?? Number.NaN).toFixed(2)} dBi
                            </dd>
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <dt className="text-muted-foreground">Fractional bandwidth</dt>
                            <dd className="font-mono text-foreground">
                              {((referenceElement?.parameters.bandwidth ?? 0) / (frequencyMHz * 1e6) * 100).toFixed(1)}%
                            </dd>
                          </div>
                        </dl>
                        {antennaKind === 'yagi' && (
                          <p className="rounded-md bg-muted/60 p-2 text-[11px] leading-relaxed text-muted-foreground">
                            Reflector and directors are shortened/lengthened dipoles at λ/4 spacing. The array
                            factor sets the end-fire gain; element patterns are represented by their peak gain.
                          </p>
                        )}
                        {antennaKind === 'phased' && (
                          <p className="rounded-md bg-muted/60 p-2 text-[11px] leading-relaxed text-muted-foreground">
                            Taylor amplitude taper, uniform phase. Spacing is λ/2 for a linear array, or the
                            equivalent circumference spacing for a circular array.
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                </>
              ) : (
                <ErrorCard message={antennaError} />
              )}
            </div>
          )}

          {tab === 'filter' && (
            <div className="space-y-4">
              {filterData ? (
                <>
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold text-foreground">
                        {FILTER_LABELS[filterKind]} filter · order {order}
                      </h2>
                      <p className="text-xs text-muted-foreground">
                        {filterKind === 'bandpass'
                          ? `${formatFrequency(cutoffMHz)} centre, ${formatFrequency(bandwidthMHz)} bandwidth`
                          : `${formatFrequency(cutoffMHz)} cutoff`}{' '}
                        · {impedance} Ω · {filterData.circuit.elements.length} elements
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Metric label="Gain at design point" value={formatDb(filterData.metrics.gain)} />
                      <Metric label="Input RL" value={formatReturnLoss(filterData.metrics.inputReturnLoss)} />
                      <Metric label="Output RL" value={formatReturnLoss(filterData.metrics.outputReturnLoss)} />
                      <Metric
                        label="Passband"
                        value={
                          Number.isFinite(filterData.metrics.bandwidth)
                            ? formatFrequency(filterData.metrics.bandwidth / 1e6)
                            : '∞'
                        }
                      />
                    </div>
                  </div>

                  <Card>
                    <CardHeader className="flex-row items-center justify-between pb-2">
                      <CardTitle className="flex items-center gap-2 text-sm">
                        <Activity className="h-4 w-4" />
                        S-parameters
                      </CardTitle>
                      <span className="text-[11px] text-muted-foreground">
                        ABCD cascade · {filterData.sweep.length} points
                      </span>
                    </CardHeader>
                    <CardContent>
                      <div className="h-80 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={filterChartData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                            <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                            <XAxis
                              dataKey="mhz"
                              type="number"
                              scale="log"
                              domain={[filterData.startMHz, filterData.stopMHz]}
                              tickFormatter={(value) => formatAxisFrequency(Number(value))}
                              stroke="hsl(var(--muted-foreground))"
                              fontSize={11}
                              minTickGap={28}
                            />
                            <YAxis
                              domain={[-80, 5]}
                              ticks={[-80, -60, -40, -20, 0]}
                              allowDataOverflow
                              stroke="hsl(var(--muted-foreground))"
                              fontSize={11}
                              width={46}
                              tickFormatter={(value) => `${value} dB`}
                            />
                            <Tooltip
                              labelFormatter={(value) => formatFrequency(Number(value))}
                              formatter={(value, name) => [
                                `${Number(value).toFixed(2)} dB`,
                                name === 's21' ? 'S21 — transmission' : 'S11 — reflection',
                              ]}
                              contentStyle={{
                                background: 'hsl(var(--popover))',
                                border: '1px solid hsl(var(--border))',
                                borderRadius: 6,
                                fontSize: 12,
                              }}
                            />
                            <Legend
                              formatter={(value) => (value === 's21' ? 'S21 transmission' : 'S11 reflection')}
                              wrapperStyle={{ fontSize: 11 }}
                            />
                            <ReferenceLine
                              y={-3.01}
                              stroke="hsl(var(--muted-foreground))"
                              strokeDasharray="4 4"
                              label={{ value: '−3 dB', position: 'insideTopRight', fontSize: 10 }}
                            />
                            <Line
                              type="monotone"
                              dataKey="s21"
                              stroke={s21Color}
                              strokeWidth={2}
                              dot={false}
                              isAnimationActive={false}
                            />
                            <Line
                              type="monotone"
                              dataKey="s11"
                              stroke={s11Color}
                              strokeWidth={1.5}
                              strokeDasharray="5 4"
                              dot={false}
                              isAnimationActive={false}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Synthesized ladder</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="text-muted-foreground">
                            <tr className="border-b border-border">
                              <th className="py-2 pr-4 font-medium">Ref</th>
                              <th className="py-2 pr-4 font-medium">Type</th>
                              <th className="py-2 pr-4 font-medium">Role</th>
                              <th className="py-2 pr-4 font-medium">Value</th>
                              <th className="py-2 font-medium">Prototype g</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filterData.circuit.elements.map((element) => (
                              <tr key={element.id} className="border-b border-border/50 last:border-0">
                                <td className="py-2 pr-4 font-mono text-foreground">{element.id}</td>
                                <td className="py-2 pr-4 capitalize text-foreground">{element.type}</td>
                                <td className="py-2 pr-4 text-muted-foreground">{element.role ?? '—'}</td>
                                <td className="py-2 pr-4 font-mono text-foreground">
                                  {formatEng(
                                    element.value,
                                    element.type === 'inductor' ? 'H' : element.type === 'capacitor' ? 'F' : 'Ω',
                                  )}
                                </td>
                                <td className="py-2 font-mono text-muted-foreground">
                                  {element.parameters.g?.toFixed(4) ?? '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                        Series branches carry the signal; shunt branches return to ground. A band-pass
                        resonator is two elements sharing a role. Snapping these values to an E-series and
                        including component Q will shift the measured corner — re-sweep after substitution.
                      </p>
                    </CardContent>
                  </Card>
                </>
              ) : (
                <ErrorCard message={filterError} />
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-mono text-sm text-foreground">{value}</div>
    </div>
  )
}

function ErrorCard({ message }: { message: string }) {
  return (
    <Card className="border-destructive/40">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-destructive">Design cannot be synthesized</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground" role="alert">
          {message}
        </p>
      </CardContent>
    </Card>
  )
}
