import { useEffect, useMemo, useState } from 'react'
import { useDemoRequest } from '../workspace/useDemoRequest'
import { Activity, Download, Info, Radio, X } from 'lucide-react'
import TraceChart, { type TraceSeries } from '../charts/TraceChart'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Input } from '../ui/input'
import {
  AntennaDesigner,
  ANTENNA_ASSUMPTION_TEXT,
  ANTENNA_NOT_MODELED_TEXT,
  type AntennaArray,
  type AntennaElement,
  type AntennaNotModeledReason,
} from '../../lib/rf/antennaDesign'
import {
  RFCircuitDesigner,
  type RFPerformanceMetrics,
  type RFCircuit,
  type ScatteringParameters,
} from '../../lib/rf/rfCircuitDesign'
import {
  CANDIDATE_6G_BANDS,
  candidateBandsFor,
  linkBudget,
  numerology,
  rainAttenuationDbPerKm,
  slantRangeM,
  specificAttenuationDbPerKm,
  type LinkBudgetResult,
} from '../../lib/rf/linkBudget'
import { useTheme } from '../../lib/theme/useTheme'
import { chartSeriesColors } from '../../lib/theme/tokens'
import { describeError } from '../../lib/utils'
import { loadDomainDesign, usePublishDomainDesign } from '../../lib/project/domainDesign'
import { opticalLink, type OpticalLinkResult } from '../../lib/photonics/opticalLink'
import {
  MAX_QUBITS,
  qubitProbabilities,
  sampleCounts,
  simulateCircuit,
  type MeasurementCounts,
  type QuantumGate,
  type QuantumGateType,
  type QuantumState,
} from '../../lib/quantum/statevector'

interface RFDesignPanelProps {
  onClose: () => void
}

type PanelTab = 'antenna' | 'filter' | 'link' | 'photonics' | 'quantum'
type LinkScenario = 'terrestrial' | 'satellite'
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

const QUANTUM_GATE_LABELS: Record<QuantumGateType, string> = {
  h: 'Hadamard (H)',
  x: 'Pauli X',
  y: 'Pauli Y',
  z: 'Pauli Z',
  s: 'Phase (S)',
  t: 'π/8 (T)',
  rx: 'Rotation X',
  ry: 'Rotation Y',
  rz: 'Rotation Z',
  cnot: 'CNOT',
  cz: 'Controlled Z',
  swap: 'SWAP',
}

const DIMENSION_LABELS: Record<string, string> = {
  length: 'Length',
  width: 'Width',
  height: 'Height / substrate',
  radius: 'Wire radius',
  groundPlaneRadius: 'Ground plane radius',
  effectiveEpsilon: 'Effective εr',
  feedOffset: 'Inset feed (to 50 Ω)',
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

/** Axis ticks are whole decibels; a cursor readout keeps two decimals. */
const decibelAxis = (value: number) => `${value.toFixed(0)} dB`

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

/**
 * A null antenna result means the implemented model cannot produce the number.
 * Show the reason: a dash, a zero or a NaN would be read as a measurement, which
 * is exactly what the mission-critical rule forbids.
 */
function notModeledText(reason: AntennaNotModeledReason | undefined): string {
  return reason === undefined ? 'Not modelled' : `Not modelled — ${ANTENNA_NOT_MODELED_TEXT[reason]}`
}

/** Degrees, or the labelled not-modelled state; a null angle is never a dash. */
function angleText(value: number | null, reason?: AntennaNotModeledReason): string {
  return value === null ? notModeledText(reason) : `${value.toFixed(1)}°`
}

function downloadText(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function gateSummary(gate: QuantumGate): string {
  const label = QUANTUM_GATE_LABELS[gate.type]
  if (gate.type === 'cnot' || gate.type === 'cz') return `${label} · q${gate.control}→q${gate.target}`
  if (gate.type === 'swap') return `${label} · q${gate.control}↔q${gate.target}`
  if (gate.type === 'rx' || gate.type === 'ry' || gate.type === 'rz') {
    return `${label} · q${gate.qubit} · ${(((gate.angle ?? 0) * 180) / Math.PI).toFixed(1)}°`
  }
  return `${label} · q${gate.qubit}`
}

function formatAmplitude(amplitude: { re: number; im: number }): string {
  const re = Math.abs(amplitude.re) < 5e-4 ? 0 : amplitude.re
  const im = Math.abs(amplitude.im) < 5e-4 ? 0 : amplitude.im
  if (im === 0) return re.toFixed(3)
  if (re === 0) return `${im.toFixed(3)}i`
  return `${re.toFixed(3)} ${im < 0 ? '−' : '+'} ${Math.abs(im).toFixed(3)}i`
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

interface RFDesign {
  tab?: PanelTab
  antennaKind?: AntennaKind
  frequencyMHz?: number
  substrateHeightMM?: number
  dielectricConstant?: number
  yagiElements?: number
  arrayElements?: number
  arrayLayout?: 'linear' | 'circular'
  filterKind?: FilterKind
  cutoffMHz?: number
  bandwidthMHz?: number
  order?: number
  impedance?: number
  linkScenario?: LinkScenario
  linkDistanceKm?: number
  linkAltitudeKm?: number
  linkElevationDeg?: number
  linkTxPowerDbm?: number
  linkTxGainDbi?: number
  linkRxGainDbi?: number
  linkBandwidthMHz?: number
  linkNoiseFigureDb?: number
  linkRequiredEbN0Db?: number
  linkBitRateMbps?: number
  linkRainRate?: number
  linkAtmospheric?: boolean
  numerologyMu?: number
}

const linkTabOf = (value: unknown): PanelTab =>
  value === 'filter' || value === 'link' || value === 'photonics' || value === 'quantum' ? value : 'antenna'

const rfNumber = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

export default function RFDesignPanel({ onClose }: RFDesignPanelProps) {
  const { theme } = useTheme()
  const seriesColors = useMemo(() => chartSeriesColors(theme), [theme])

  const saved = loadDomainDesign<RFDesign>('rf')
  const [tab, setTab] = useState<PanelTab>(linkTabOf(saved?.tab))
  useDemoRequest('rf-filter', () => setTab('filter'))

  const [antennaKind, setAntennaKind] = useState<AntennaKind>(
    saved?.antennaKind && ['dipole', 'monopole', 'patch', 'yagi', 'phased'].includes(saved.antennaKind)
      ? saved.antennaKind
      : 'dipole',
  )
  const [frequencyMHz, setFrequencyMHz] = useState(rfNumber(saved?.frequencyMHz, 2400))
  const [substrateHeightMM, setSubstrateHeightMM] = useState(rfNumber(saved?.substrateHeightMM, 1.6))
  const [dielectricConstant, setDielectricConstant] = useState(rfNumber(saved?.dielectricConstant, 4.4))
  const [yagiElements, setYagiElements] = useState(rfNumber(saved?.yagiElements, 5))
  const [arrayElements, setArrayElements] = useState(rfNumber(saved?.arrayElements, 4))
  const [arrayLayout, setArrayLayout] = useState<'linear' | 'circular'>(
    saved?.arrayLayout === 'circular' ? 'circular' : 'linear',
  )

  const [filterKind, setFilterKind] = useState<FilterKind>(
    saved?.filterKind && ['lowpass', 'highpass', 'bandpass'].includes(saved.filterKind)
      ? saved.filterKind
      : 'lowpass',
  )
  const [cutoffMHz, setCutoffMHz] = useState(rfNumber(saved?.cutoffMHz, 1000))
  const [bandwidthMHz, setBandwidthMHz] = useState(rfNumber(saved?.bandwidthMHz, 100))
  const [order, setOrder] = useState(rfNumber(saved?.order, 5))
  const [impedance, setImpedance] = useState(rfNumber(saved?.impedance, 50))

  const [linkScenario, setLinkScenario] = useState<LinkScenario>(
    saved?.linkScenario === 'satellite' ? 'satellite' : 'terrestrial',
  )
  const [linkDistanceKm, setLinkDistanceKm] = useState(rfNumber(saved?.linkDistanceKm, 10))
  const [linkAltitudeKm, setLinkAltitudeKm] = useState(rfNumber(saved?.linkAltitudeKm, 550))
  const [linkElevationDeg, setLinkElevationDeg] = useState(rfNumber(saved?.linkElevationDeg, 30))
  const [linkTxPowerDbm, setLinkTxPowerDbm] = useState(rfNumber(saved?.linkTxPowerDbm, 30))
  const [linkTxGainDbi, setLinkTxGainDbi] = useState(rfNumber(saved?.linkTxGainDbi, 20))
  const [linkRxGainDbi, setLinkRxGainDbi] = useState(rfNumber(saved?.linkRxGainDbi, 0))
  const [linkBandwidthMHz, setLinkBandwidthMHz] = useState(rfNumber(saved?.linkBandwidthMHz, 20))
  const [linkNoiseFigureDb, setLinkNoiseFigureDb] = useState(rfNumber(saved?.linkNoiseFigureDb, 5))
  const [linkRequiredEbN0Db, setLinkRequiredEbN0Db] = useState(rfNumber(saved?.linkRequiredEbN0Db, 6))
  const [linkBitRateMbps, setLinkBitRateMbps] = useState(rfNumber(saved?.linkBitRateMbps, 10))
  const [linkRainRate, setLinkRainRate] = useState(rfNumber(saved?.linkRainRate, 0))
  const [linkAtmospheric, setLinkAtmospheric] = useState(saved?.linkAtmospheric !== false)
  const [numerologyMu, setNumerologyMu] = useState(rfNumber(saved?.numerologyMu, 0))

  const [fibreWavelengthNm, setFibreWavelengthNm] = useState(1550)
  const [fibreLaunchDbm, setFibreLaunchDbm] = useState(0)
  const [fibreBitRateGbps, setFibreBitRateGbps] = useState(10)
  const [fibreLengthKm, setFibreLengthKm] = useState(40)
  const [fibreAttenuation, setFibreAttenuation] = useState(0.2)
  const [fibreConnectorLossDb, setFibreConnectorLossDb] = useState(1)
  const [fibreSpliceCount, setFibreSpliceCount] = useState(8)
  const [fibreSpliceLossDb, setFibreSpliceLossDb] = useState(0.1)
  const [fibreDispersion, setFibreDispersion] = useState(17)
  const [fibreLinewidthNm, setFibreLinewidthNm] = useState(0.1)
  const [fibreResponsivity, setFibreResponsivity] = useState(0.8)
  const [fibreNoisePAPerSqrtHz, setFibreNoisePAPerSqrtHz] = useState(5)
  const [fibreDarkCurrentNa, setFibreDarkCurrentNa] = useState(5)
  const [fibreBerExponent, setFibreBerExponent] = useState(9)
  const [fibreSystemMarginDb, setFibreSystemMarginDb] = useState(3)

  const [quantumQubits, setQuantumQubits] = useState(2)
  const [quantumGates, setQuantumGates] = useState<QuantumGate[]>([
    { type: 'h', qubit: 0 },
    { type: 'cnot', control: 0, target: 1 },
  ])
  const [quantumGateType, setQuantumGateType] = useState<QuantumGateType>('h')
  const [quantumQubitInput, setQuantumQubitInput] = useState(0)
  const [quantumControlInput, setQuantumControlInput] = useState(0)
  const [quantumTargetInput, setQuantumTargetInput] = useState(1)
  const [quantumAngleDeg, setQuantumAngleDeg] = useState(45)
  const [quantumShots, setQuantumShots] = useState(1000)
  const [quantumCounts, setQuantumCounts] = useState<MeasurementCounts | null>(null)
  const [quantumBuilderError, setQuantumBuilderError] = useState<string | null>(null)

  usePublishDomainDesign('rf', {
    tab, antennaKind, frequencyMHz, substrateHeightMM, dielectricConstant, yagiElements,
    arrayElements, arrayLayout, filterKind, cutoffMHz, bandwidthMHz, order, impedance,
    linkScenario, linkDistanceKm, linkAltitudeKm, linkElevationDeg, linkTxPowerDbm,
    linkTxGainDbi, linkRxGainDbi, linkBandwidthMHz, linkNoiseFigureDb, linkRequiredEbN0Db,
    linkBitRateMbps, linkRainRate, linkAtmospheric, numerologyMu,
  }, (next) => {
    setTab(linkTabOf(next.tab))
    if (next.antennaKind && ['dipole', 'monopole', 'patch', 'yagi', 'phased'].includes(next.antennaKind)) {
      setAntennaKind(next.antennaKind)
    }
    setFrequencyMHz(rfNumber(next.frequencyMHz, frequencyMHz))
    setSubstrateHeightMM(rfNumber(next.substrateHeightMM, substrateHeightMM))
    setDielectricConstant(rfNumber(next.dielectricConstant, dielectricConstant))
    setYagiElements(rfNumber(next.yagiElements, yagiElements))
    setArrayElements(rfNumber(next.arrayElements, arrayElements))
    setArrayLayout(next.arrayLayout === 'circular' ? 'circular' : 'linear')
    if (next.filterKind && ['lowpass', 'highpass', 'bandpass'].includes(next.filterKind)) {
      setFilterKind(next.filterKind)
    }
    setCutoffMHz(rfNumber(next.cutoffMHz, cutoffMHz))
    setBandwidthMHz(rfNumber(next.bandwidthMHz, bandwidthMHz))
    setOrder(rfNumber(next.order, order))
    setImpedance(rfNumber(next.impedance, impedance))
    setLinkScenario(next.linkScenario === 'satellite' ? 'satellite' : 'terrestrial')
    setLinkDistanceKm(rfNumber(next.linkDistanceKm, linkDistanceKm))
    setLinkAltitudeKm(rfNumber(next.linkAltitudeKm, linkAltitudeKm))
    setLinkElevationDeg(rfNumber(next.linkElevationDeg, linkElevationDeg))
    setLinkTxPowerDbm(rfNumber(next.linkTxPowerDbm, linkTxPowerDbm))
    setLinkTxGainDbi(rfNumber(next.linkTxGainDbi, linkTxGainDbi))
    setLinkRxGainDbi(rfNumber(next.linkRxGainDbi, linkRxGainDbi))
    setLinkBandwidthMHz(rfNumber(next.linkBandwidthMHz, linkBandwidthMHz))
    setLinkNoiseFigureDb(rfNumber(next.linkNoiseFigureDb, linkNoiseFigureDb))
    setLinkRequiredEbN0Db(rfNumber(next.linkRequiredEbN0Db, linkRequiredEbN0Db))
    setLinkBitRateMbps(rfNumber(next.linkBitRateMbps, linkBitRateMbps))
    setLinkRainRate(rfNumber(next.linkRainRate, linkRainRate))
    setLinkAtmospheric(next.linkAtmospheric !== false)
    setNumerologyMu(rfNumber(next.numerologyMu, numerologyMu))
  })

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

  const link = useMemo<LinkBudgetResult | { error: string }>(() => {
    try {
      const distanceM =
        linkScenario === 'satellite'
          ? slantRangeM(linkAltitudeKm * 1000, linkElevationDeg)
          : linkDistanceKm * 1000
      return linkBudget({
        frequencyHz: frequencyMHz * 1e6,
        txPowerDbm: linkTxPowerDbm,
        txAntennaGainDbi: linkTxGainDbi,
        rxAntennaGainDbi: linkRxGainDbi,
        distanceM,
        bandwidthHz: linkBandwidthMHz * 1e6,
        receiverNoiseFigureDb: linkNoiseFigureDb,
        requiredEbN0Db: linkRequiredEbN0Db,
        bitRateBps: linkBitRateMbps * 1e6,
        atmospheric: linkAtmospheric,
        rainRateMmPerHour: linkRainRate,
      })
    } catch (error) {
      return { error: describeError(error) }
    }
  }, [
    frequencyMHz, linkScenario, linkAltitudeKm, linkElevationDeg, linkDistanceKm,
    linkTxPowerDbm, linkTxGainDbi, linkRxGainDbi, linkBandwidthMHz, linkNoiseFigureDb,
    linkRequiredEbN0Db, linkBitRateMbps, linkRainRate, linkAtmospheric,
  ])

  const antennaData = 'error' in antenna ? null : antenna
  const filterData = 'error' in filter ? null : filter
  const linkData = 'error' in link ? null : link
  const antennaError = 'error' in antenna ? antenna.error : 'Antenna design failed.'
  const filterError = 'error' in filter ? filter.error : 'Filter design failed.'
  const linkError = 'error' in link ? link.error : 'Link budget failed.'

  const photonic = useMemo<OpticalLinkResult | { error: string }>(() => {
    try {
      return opticalLink({
        wavelengthNm: fibreWavelengthNm,
        launchPowerDbm: fibreLaunchDbm,
        bitRateGbps: fibreBitRateGbps,
        lengthKm: fibreLengthKm,
        attenuationDbPerKm: fibreAttenuation,
        connectorLossDb: fibreConnectorLossDb,
        spliceCount: Math.round(fibreSpliceCount),
        spliceLossDb: fibreSpliceLossDb,
        dispersionPsPerNmKm: fibreDispersion,
        transmitterLinewidthNm: fibreLinewidthNm,
        receiverResponsivityAW: fibreResponsivity,
        receiverNoisePAPerSqrtHz: fibreNoisePAPerSqrtHz * 1e-12,
        darkCurrentNa: fibreDarkCurrentNa,
        targetBer: 10 ** -fibreBerExponent,
        systemMarginDb: fibreSystemMarginDb,
      })
    } catch (error) {
      return { error: describeError(error) }
    }
  }, [
    fibreWavelengthNm, fibreLaunchDbm, fibreBitRateGbps, fibreLengthKm, fibreAttenuation,
    fibreConnectorLossDb, fibreSpliceCount, fibreSpliceLossDb, fibreDispersion, fibreLinewidthNm,
    fibreResponsivity, fibreNoisePAPerSqrtHz, fibreDarkCurrentNa, fibreBerExponent, fibreSystemMarginDb,
  ])

  const quantum = useMemo<QuantumState | { error: string }>(() => {
    try {
      return simulateCircuit(quantumQubits, quantumGates)
    } catch (error) {
      return { error: describeError(error) }
    }
  }, [quantumQubits, quantumGates])

  const photonicData = 'error' in photonic ? null : photonic
  const photonicError = 'error' in photonic ? photonic.error : 'Optical link budget failed.'
  const quantumData = 'error' in quantum ? null : quantum
  const quantumError = 'error' in quantum ? quantum.error : 'Quantum circuit failed to simulate.'
  const quantumMarginals = quantumData ? qubitProbabilities(quantumData) : []
  const quantumTwoQubitGate =
    quantumGateType === 'cnot' || quantumGateType === 'cz' || quantumGateType === 'swap'
  const quantumRotationGate =
    quantumGateType === 'rx' || quantumGateType === 'ry' || quantumGateType === 'rz'

  const addQuantumGate = () => {
    setQuantumBuilderError(null)
    const gate: QuantumGate = quantumTwoQubitGate
      ? { type: quantumGateType, control: quantumControlInput, target: quantumTargetInput }
      : quantumRotationGate
        ? { type: quantumGateType, qubit: quantumQubitInput, angle: (quantumAngleDeg * Math.PI) / 180 }
        : { type: quantumGateType, qubit: quantumQubitInput }
    try {
      simulateCircuit(quantumQubits, [...quantumGates, gate])
      setQuantumGates((previous) => [...previous, gate])
      setQuantumCounts(null)
    } catch (error) {
      setQuantumBuilderError(describeError(error))
    }
  }

  const applyQuantumPreset = (preset: 'bell' | 'ghz' | 'hadamard' | 'phase') => {
    setQuantumBuilderError(null)
    setQuantumCounts(null)
    if (preset === 'ghz') {
      setQuantumQubits(3)
      setQuantumGates([
        { type: 'h', qubit: 0 },
        { type: 'cnot', control: 0, target: 1 },
        { type: 'cnot', control: 1, target: 2 },
      ])
    } else if (preset === 'hadamard') {
      setQuantumQubits(1)
      setQuantumGates([{ type: 'h', qubit: 0 }])
    } else if (preset === 'phase') {
      setQuantumQubits(1)
      setQuantumGates([{ type: 'h', qubit: 0 }, { type: 's', qubit: 0 }])
    } else {
      setQuantumQubits(2)
      setQuantumGates([{ type: 'h', qubit: 0 }, { type: 'cnot', control: 0, target: 1 }])
    }
  }

  const runQuantumMeasurement = () => {
    if (!quantumData) return
    setQuantumBuilderError(null)
    try {
      setQuantumCounts(sampleCounts(quantumData, Math.round(quantumShots)))
    } catch (error) {
      setQuantumBuilderError(describeError(error))
    }
  }

  const quantumOutcomes = quantumData
    ? quantumData.probabilities
        .map((probability, index) => ({ probability, index }))
        .filter((outcome) => outcome.probability > 1e-12)
        .sort((a, b) => b.probability - a.probability)
    : []

  const linkDistanceM =
    linkScenario === 'satellite'
      ? (() => {
          try {
            return slantRangeM(linkAltitudeKm * 1000, linkElevationDeg)
          } catch {
            return Number.NaN
          }
        })()
      : linkDistanceKm * 1000
  const linkNumerology = numerology(Math.min(6, Math.max(0, Math.round(numerologyMu))))
  const carrierHz = frequencyMHz * 1e6
  const linkBands = candidateBandsFor(carrierHz)

  const antennaGains = antennaData ? antennaData.pattern.gain.map((point) => point[0]) : []
  const peakGain = antennaGains.length > 0 ? Math.max(...antennaGains) : Number.NaN
  const beamwidth =
    antennaData && antennaGains.length > 0
      ? halfPowerBeamwidth(antennaData.pattern.theta, antennaGains)
      : Number.NaN
  const referenceElement = antennaData?.elements[0]
  const antennaParameters = referenceElement?.parameters ?? null

  // Null in, prose out: never a fabricated number, never a blank.
  const vsWRText = antennaParameters === null
    ? '—'
    : antennaParameters.vsWR === null
      ? notModeledText(antennaParameters.notModeled.vsWR)
      : `${antennaParameters.vsWR.toFixed(2)}:1`
  const fractionalBandwidthText = antennaParameters === null
    ? '—'
    : antennaParameters.bandwidth === null
      ? notModeledText(antennaParameters.notModeled.bandwidth)
      : `${(antennaParameters.bandwidth / (frequencyMHz * 1e6) * 100).toFixed(1)}%`

  const filterChartData = filterData
    ? filterData.sweep.map((point) => ({
        mhz: point.frequency / 1e6,
        s21: 20 * Math.log10(Math.max(Math.hypot(point.s21.real, point.s21.imag), 1e-12)),
        s11: 20 * Math.log10(Math.max(Math.hypot(point.s11.real, point.s11.imag), 1e-12)),
      }))
    : []
  const sParameterSeries = useMemo<TraceSeries[]>(
    () => [
      { key: 's21', label: 'S21 transmission', color: seriesColors[0] },
      { key: 's11', label: 'S11 reflection', color: seriesColors[1] ?? seriesColors[0], dash: '5 4' },
    ],
    [seriesColors],
  )

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
            <h1 className="text-sm font-semibold text-foreground">RF, Photonics &amp; Quantum</h1>
            <p className="text-xs text-muted-foreground">
              Antennas, lumped filters, radio and fibre link budgets, NR/6G numerology and exact statevector circuits
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border bg-muted p-0.5" role="tablist" aria-label="RF design tool">
            {(['antenna', 'filter', 'link', 'photonics', 'quantum'] as const).map((value) => (
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
                {value === 'antenna'
                  ? 'Antennas'
                  : value === 'filter'
                    ? 'Filters'
                    : value === 'link'
                      ? 'Link & 6G'
                      : value === 'photonics'
                        ? 'Photonics'
                        : 'Quantum'}
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
                  Directivity, beamwidth and feed resistance are integrated from the modelled far field:
                  the sinusoidal thin-wire pattern for the dipoles (radiation resistance referred to the feed
                  current) and the two-slot aperture for the patch. No reactive term is modelled, so bandwidth
                  and VSWR are reported as not modelled rather than estimated. These are design estimates, not
                  full-wave EM results — verify the final geometry in a field solver or on the bench.
                </CardContent>
              </Card>
            </>
          ) : tab === 'filter' ? (
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
          ) : tab === 'link' ? (
            <>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Link budget</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1">
                    <label htmlFor="link-scenario" className="text-xs font-medium text-muted-foreground">
                      Scenario
                    </label>
                    <select
                      id="link-scenario"
                      value={linkScenario}
                      onChange={(event) => setLinkScenario(event.target.value as LinkScenario)}
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="terrestrial">Terrestrial path</option>
                      <option value="satellite">Satellite (LEO slant range)</option>
                    </select>
                  </div>
                  <NumberField
                    id="link-frequency"
                    label="Carrier frequency"
                    value={frequencyMHz}
                    unit="MHz"
                    min={1}
                    step={100}
                    onChange={setFrequencyMHz}
                  />
                  {linkScenario === 'satellite' ? (
                    <>
                      <NumberField
                        id="link-altitude"
                        label="Satellite altitude"
                        value={linkAltitudeKm}
                        unit="km"
                        min={0}
                        step={50}
                        onChange={setLinkAltitudeKm}
                      />
                      <NumberField
                        id="link-elevation"
                        label="Elevation angle"
                        value={linkElevationDeg}
                        unit="°"
                        min={0.1}
                        max={90}
                        step={5}
                        onChange={setLinkElevationDeg}
                      />
                    </>
                  ) : (
                    <NumberField
                      id="link-distance"
                      label="Path length"
                      value={linkDistanceKm}
                      unit="km"
                      min={0.001}
                      step={10}
                      onChange={setLinkDistanceKm}
                    />
                  )}
                  <NumberField
                    id="link-tx-power"
                    label="Transmit power"
                    value={linkTxPowerDbm}
                    unit="dBm"
                    step={1}
                    onChange={setLinkTxPowerDbm}
                  />
                  <NumberField
                    id="link-tx-gain"
                    label="Transmit antenna gain"
                    value={linkTxGainDbi}
                    unit="dBi"
                    step={1}
                    onChange={setLinkTxGainDbi}
                  />
                  <NumberField
                    id="link-rx-gain"
                    label="Receive antenna gain"
                    value={linkRxGainDbi}
                    unit="dBi"
                    step={1}
                    onChange={setLinkRxGainDbi}
                  />
                  <NumberField
                    id="link-bandwidth"
                    label="Channel bandwidth"
                    value={linkBandwidthMHz}
                    unit="MHz"
                    min={0.001}
                    step={5}
                    onChange={setLinkBandwidthMHz}
                  />
                  <NumberField
                    id="link-bit-rate"
                    label="Information bit rate"
                    value={linkBitRateMbps}
                    unit="Mbit/s"
                    min={0.001}
                    step={1}
                    onChange={setLinkBitRateMbps}
                  />
                  <NumberField
                    id="link-noise-figure"
                    label="Receiver noise figure"
                    value={linkNoiseFigureDb}
                    unit="dB"
                    min={0}
                    step={1}
                    onChange={setLinkNoiseFigureDb}
                  />
                  <NumberField
                    id="link-required-ebn0"
                    label="Required Eb/N0"
                    value={linkRequiredEbN0Db}
                    unit="dB"
                    step={1}
                    onChange={setLinkRequiredEbN0Db}
                  />
                  <NumberField
                    id="link-rain"
                    label="Rainfall rate"
                    value={linkRainRate}
                    unit="mm/h"
                    min={0}
                    step={5}
                    onChange={setLinkRainRate}
                  />
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={linkAtmospheric}
                      onChange={(event) => setLinkAtmospheric(event.target.checked)}
                      className="h-4 w-4 rounded border-input"
                    />
                    Include sea-level atmospheric loss
                  </label>
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
                  Friis free-space loss, kTB noise, Shannon capacity and the Eb/N0 conversion. Atmospheric
                  loss is log-interpolated from ITU-R P.676 sea-level spot values (7.5 g/m³ water vapour);
                  rain uses ITU-R P.838 coefficients. No multipath, interference, blockage or antenna
                  misalignment is modelled.
                </CardContent>
              </Card>
            </>
          ) : tab === 'photonics' ? (
            <>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Fibre span</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <NumberField
                    id="fibre-wavelength"
                    label="Wavelength"
                    value={fibreWavelengthNm}
                    unit="nm"
                    min={1}
                    step={10}
                    onChange={setFibreWavelengthNm}
                  />
                  <NumberField
                    id="fibre-launch"
                    label="Launch power"
                    value={fibreLaunchDbm}
                    unit="dBm"
                    step={1}
                    onChange={setFibreLaunchDbm}
                  />
                  <NumberField
                    id="fibre-bitrate"
                    label="Bit rate"
                    value={fibreBitRateGbps}
                    unit="Gbit/s"
                    min={0.001}
                    step={1}
                    onChange={setFibreBitRateGbps}
                  />
                  <NumberField
                    id="fibre-length"
                    label="Fibre span"
                    value={fibreLengthKm}
                    unit="km"
                    min={0}
                    step={5}
                    onChange={setFibreLengthKm}
                  />
                  <NumberField
                    id="fibre-attenuation"
                    label="Attenuation at this wavelength"
                    value={fibreAttenuation}
                    unit="dB/km"
                    min={0}
                    step={0.01}
                    onChange={setFibreAttenuation}
                  />
                  <NumberField
                    id="fibre-connector-loss"
                    label="Connector / patch loss"
                    value={fibreConnectorLossDb}
                    unit="dB"
                    min={0}
                    step={0.1}
                    onChange={setFibreConnectorLossDb}
                  />
                  <NumberField
                    id="fibre-splice-count"
                    label="Fusion splices"
                    value={fibreSpliceCount}
                    min={0}
                    step={1}
                    onChange={setFibreSpliceCount}
                  />
                  <NumberField
                    id="fibre-splice-loss"
                    label="Loss per splice"
                    value={fibreSpliceLossDb}
                    unit="dB"
                    min={0}
                    step={0.01}
                    onChange={setFibreSpliceLossDb}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Dispersion and receiver</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <NumberField
                    id="fibre-dispersion"
                    label="Chromatic dispersion"
                    value={fibreDispersion}
                    unit="ps/(nm·km)"
                    min={0}
                    step={1}
                    onChange={setFibreDispersion}
                  />
                  <NumberField
                    id="fibre-linewidth"
                    label="Transmitter RMS linewidth"
                    value={fibreLinewidthNm}
                    unit="nm"
                    min={0}
                    step={0.01}
                    onChange={setFibreLinewidthNm}
                  />
                  <NumberField
                    id="fibre-responsivity"
                    label="Photodiode responsivity"
                    value={fibreResponsivity}
                    unit="A/W"
                    min={0.001}
                    step={0.05}
                    onChange={setFibreResponsivity}
                  />
                  <NumberField
                    id="fibre-noise-density"
                    label="Receiver noise density"
                    value={fibreNoisePAPerSqrtHz}
                    unit="pA/√Hz"
                    min={0}
                    step={0.5}
                    onChange={setFibreNoisePAPerSqrtHz}
                  />
                  <NumberField
                    id="fibre-dark-current"
                    label="Photodiode dark current"
                    value={fibreDarkCurrentNa}
                    unit="nA"
                    min={0}
                    step={1}
                    onChange={setFibreDarkCurrentNa}
                  />
                  <NumberField
                    id="fibre-ber-exponent"
                    label="Target BER = 10⁻ⁿ"
                    value={fibreBerExponent}
                    min={2}
                    max={15}
                    step={1}
                    onChange={setFibreBerExponent}
                  />
                  <NumberField
                    id="fibre-system-margin"
                    label="Ageing and repair allowance"
                    value={fibreSystemMarginDb}
                    unit="dB"
                    min={0}
                    step={0.5}
                    onChange={setFibreSystemMarginDb}
                  />
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
                  OOK fibre budget from the declared attenuation, splice and connector losses; chromatic
                  dispersion is a Gaussian eye-closure estimate; PIN sensitivity solves the Q-equation
                  with shot, dark-current and thermal noise. No fibre nonlinearity, polarisation-mode
                  dispersion, amplifier noise or FEC is modelled.
                </CardContent>
              </Card>
            </>
          ) : (
            <>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Register</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <NumberField
                    id="quantum-qubits"
                    label="Qubits"
                    value={quantumQubits}
                    min={1}
                    max={MAX_QUBITS}
                    step={1}
                    onChange={(value) => {
                      setQuantumQubits(Math.round(value))
                      setQuantumGates([])
                      setQuantumCounts(null)
                      setQuantumBuilderError(null)
                    }}
                  />
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    Changing the register clears the gate list. Qubit 0 is the leftmost bit of every basis
                    label; the simulator holds 2ⁿ complex amplitudes.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" size="sm" onClick={() => applyQuantumPreset('bell')}>
                      Bell pair
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => applyQuantumPreset('ghz')}>
                      GHZ-3
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => applyQuantumPreset('hadamard')}>
                      |+⟩
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => applyQuantumPreset('phase')}>
                      H then S
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Add gate</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1">
                    <label htmlFor="quantum-gate-type" className="text-xs font-medium text-muted-foreground">
                      Gate
                    </label>
                    <select
                      id="quantum-gate-type"
                      aria-label="Quantum gate"
                      value={quantumGateType}
                      onChange={(event) => setQuantumGateType(event.target.value as QuantumGateType)}
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      {(Object.keys(QUANTUM_GATE_LABELS) as QuantumGateType[]).map((type) => (
                        <option key={type} value={type}>
                          {QUANTUM_GATE_LABELS[type]}
                        </option>
                      ))}
                    </select>
                  </div>
                  {quantumTwoQubitGate ? (
                    <div className="grid grid-cols-2 gap-2">
                      <NumberField
                        id="quantum-control"
                        label="Control qubit"
                        value={quantumControlInput}
                        min={0}
                        max={quantumQubits - 1}
                        step={1}
                        onChange={setQuantumControlInput}
                      />
                      <NumberField
                        id="quantum-target"
                        label="Target qubit"
                        value={quantumTargetInput}
                        min={0}
                        max={quantumQubits - 1}
                        step={1}
                        onChange={setQuantumTargetInput}
                      />
                    </div>
                  ) : (
                    <NumberField
                      id="quantum-qubit"
                      label="Qubit"
                      value={quantumQubitInput}
                      min={0}
                      max={quantumQubits - 1}
                      step={1}
                      onChange={setQuantumQubitInput}
                    />
                  )}
                  {quantumRotationGate && (
                    <NumberField
                      id="quantum-angle"
                      label="Rotation angle"
                      value={quantumAngleDeg}
                      unit="°"
                      step={15}
                      onChange={setQuantumAngleDeg}
                    />
                  )}
                  <Button variant="outline" className="w-full gap-2" onClick={addQuantumGate}>
                    Add gate
                  </Button>
                  {quantumBuilderError && (
                    <p role="alert" className="text-xs text-destructive">
                      {quantumBuilderError}
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Measure</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <NumberField
                    id="quantum-shots"
                    label="Shots"
                    value={quantumShots}
                    min={1}
                    max={1_000_000}
                    step={100}
                    onChange={setQuantumShots}
                  />
                  <Button
                    className="w-full gap-2"
                    onClick={runQuantumMeasurement}
                    disabled={!quantumData}
                  >
                    Run measurement
                  </Button>
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    Sampling is statistical and draws from the exact distribution. The stored state is not
                    collapsed, so re-running draws independent shots.
                  </p>
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
                      <Metric
                        label="VSWR"
                        value={vsWRText}
                        pending={antennaParameters?.vsWR === null}
                      />
                      {/* Real part only: the reactive term needs a kernel this model does not have. */}
                      <Metric
                        label="Zin (resistive part)"
                        value={
                          antennaParameters === null
                            ? '—'
                            : `${antennaParameters.impedance.toFixed(1)} Ω`
                        }
                      />
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
                              {(antennaParameters?.gain ?? Number.NaN).toFixed(2)} dBi
                            </dd>
                          </div>
                          <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-1.5">
                            <dt className="text-muted-foreground">Directivity (integrated)</dt>
                            <dd className="font-mono text-foreground">
                              {(antennaParameters?.directivity ?? Number.NaN).toFixed(2)} dBi
                            </dd>
                          </div>
                          <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-1.5">
                            <dt className="text-muted-foreground">
                              {antennaParameters?.assumptions.includes('loss-free-efficiency')
                                // Gain = directivity here; the efficiency is an assumption, and the
                                // label has to say so instead of the panel implying a loss model.
                                ? 'Efficiency (assumed)'
                                : 'Efficiency'}
                            </dt>
                            <dd className="font-mono text-foreground">
                              {antennaParameters === null
                                ? '—'
                                : `${antennaParameters.efficiency.toFixed(0)} %`}
                            </dd>
                          </div>
                          <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-1.5">
                            <dt className="text-muted-foreground">E-plane −3 dB</dt>
                            <dd className="font-mono text-foreground">
                              {antennaParameters === null ? '—' : angleText(antennaParameters.ePlaneBeamwidth)}
                            </dd>
                          </div>
                          <div className="flex items-start justify-between gap-4 border-b border-border/60 pb-1.5">
                            <dt className="text-muted-foreground">H-plane −3 dB</dt>
                            <dd
                              className={
                                antennaParameters?.hPlaneBeamwidth === null
                                  ? 'max-w-[18rem] text-right text-[10px] leading-snug text-muted-foreground'
                                  : 'font-mono text-foreground'
                              }
                            >
                              {antennaParameters === null
                                ? '—'
                                : angleText(
                                  antennaParameters.hPlaneBeamwidth,
                                  antennaParameters.notModeled.hPlaneBeamwidth,
                                )}
                            </dd>
                          </div>
                          <div className="flex items-start justify-between gap-4">
                            <dt className="text-muted-foreground">Fractional bandwidth</dt>
                            <dd
                              className={
                                antennaParameters?.bandwidth === null
                                  ? 'max-w-[18rem] text-right text-[10px] leading-snug text-muted-foreground'
                                  : 'font-mono text-foreground'
                              }
                            >
                              {fractionalBandwidthText}
                            </dd>
                          </div>
                        </dl>
                        {antennaParameters !== null && antennaParameters.assumptions.length > 0 && (
                          <ul className="space-y-1 rounded-md bg-muted/60 p-2 text-[11px] leading-relaxed text-muted-foreground">
                            {antennaParameters.assumptions.map((assumption) => (
                              <li key={assumption}>{ANTENNA_ASSUMPTION_TEXT[assumption]}</li>
                            ))}
                          </ul>
                        )}
                        {antennaKind === 'yagi' && (
                          <p className="rounded-md bg-muted/60 p-2 text-[11px] leading-relaxed text-muted-foreground">
                            Reflector and directors are shortened/lengthened dipoles at λ/4 spacing. The array
                            factor sets the end-fire gain; element patterns are represented by their peak gain.
                          </p>
                        )}
                        {antennaKind === 'phased' && (
                          <p className="rounded-md bg-muted/60 p-2 text-[11px] leading-relaxed text-muted-foreground">
                            Symmetric cosh amplitude taper (not a Taylor-Σ distribution: no sidelobe level is
                            specified), uniform phase. Spacing is λ/2 for a linear array, or the equivalent
                            circumference spacing for a circular array.
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
                      <TraceChart
                        data={filterChartData}
                        series={sParameterSeries}
                        xKey="mhz"
                        height={320}
                        xLabel="Frequency"
                        xFormatter={formatAxisFrequency}
                        yFormatter={decibelAxis}
                        readoutFormatter={formatDb}
                        logX
                        yDomain={[-80, 5]}
                        yTicks={[-80, -60, -40, -20, 0]}
                        referencesY={[{ value: -3.01, label: '−3 dB' }]}
                        ariaLabel="Filter S-parameter sweep"
                      />
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

          {tab === 'link' && (
            <div className="space-y-4">
              {linkData ? (
                <>
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold text-foreground">
                        Link budget · {formatFrequency(frequencyMHz)}
                      </h2>
                      <p className="text-xs text-muted-foreground">
                        {linkScenario === 'satellite'
                          ? `${linkAltitudeKm} km orbit at ${linkElevationDeg}° elevation · ${(linkDistanceM / 1000).toFixed(0)} km slant range`
                          : `${linkDistanceKm} km terrestrial path`}{' '}
                        · {linkBandwidthMHz} MHz channel · {linkBitRateMbps} Mbit/s
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Metric label="Link margin" value={formatDb(linkData.linkMarginDb)} />
                      <Metric label="Received Eb/N0" value={formatDb(linkData.ebN0Db)} />
                      <Metric
                        label="Shannon bound"
                        value={formatEng(linkData.shannonCapacityBps, 'bit/s')}
                      />
                    </div>
                  </div>

                  <div
                    role="status"
                    className={`rounded-md border px-3 py-2 text-sm ${
                      linkData.closes
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600'
                        : 'border-destructive/40 bg-destructive/10 text-destructive'
                    }`}
                  >
                    {linkData.closes
                      ? `Link closes with ${linkData.linkMarginDb.toFixed(2)} dB margin against the ${linkRequiredEbN0Db} dB requirement.`
                      : `Link fails by ${Math.abs(linkData.linkMarginDb).toFixed(2)} dB against the ${linkRequiredEbN0Db} dB requirement.`}
                  </div>

                  <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Power chain</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <dl className="space-y-2 text-xs">
                          {([
                            ['Transmitter power', `${linkTxPowerDbm.toFixed(1)} dBm`],
                            ['EIRP', formatDb(linkData.txEirpDbm)],
                            ['Free-space loss', formatDb(-linkData.freeSpaceLossDb)],
                            ['Atmospheric loss', formatDb(-linkData.atmosphericLossDb)],
                            ['Rain loss', formatDb(-linkData.rainLossDb)],
                            ['Receive antenna gain', `${linkRxGainDbi >= 0 ? '+' : ''}${linkRxGainDbi.toFixed(1)} dBi`],
                            ['Received power', formatDb(linkData.receivedPowerDbm)],
                            ['Noise floor', formatDb(linkData.noiseFloorDbm)],
                            ['Signal-to-noise ratio', formatDb(linkData.snrDb)],
                            ['Required Eb/N0', `${linkRequiredEbN0Db.toFixed(1)} dB`],
                          ] as const).map(([label, value]) => (
                            <div
                              key={label}
                              className="flex items-center justify-between gap-4 border-b border-border/60 pb-1.5 last:border-0 last:pb-0"
                            >
                              <dt className="text-muted-foreground">{label}</dt>
                              <dd className="font-mono text-foreground">{value}</dd>
                            </div>
                          ))}
                        </dl>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="flex items-center gap-2 text-sm">
                          <Info className="h-4 w-4" />
                          What this result assumes
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2 text-xs leading-relaxed text-muted-foreground">
                        <ul className="list-disc space-y-1 pl-4">
                          {linkData.assumptions.map((assumption) => (
                            <li key={assumption}>{assumption}</li>
                          ))}
                        </ul>
                        <p className="rounded-md bg-muted/60 p-2">
                          Specific attenuation at {formatFrequency(frequencyMHz)}:{' '}
                          <span className="font-mono text-foreground">
                            {specificAttenuationDbPerKm(carrierHz).toFixed(3)} dB/km
                          </span>{' '}
                          clear air,{' '}
                          <span className="font-mono text-foreground">
                            {rainAttenuationDbPerKm(carrierHz, linkRainRate).toFixed(3)} dB/km
                          </span>{' '}
                          at {linkRainRate} mm/h.
                        </p>
                      </CardContent>
                    </Card>
                  </div>

                  <Card>
                    <CardHeader className="flex-row items-center justify-between pb-2">
                      <CardTitle className="text-sm">NR numerology and candidate bands</CardTitle>
                      <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        Numerology µ
                        <select
                          value={Math.round(numerologyMu)}
                          onChange={(event) => setNumerologyMu(Number(event.target.value))}
                          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                          aria-label="NR numerology"
                        >
                          {[0, 1, 2, 3, 4, 5, 6].map((value) => (
                            <option key={value} value={value}>
                              {value}
                            </option>
                          ))}
                        </select>
                      </label>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                        {([
                          ['Subcarrier spacing', formatEng(linkNumerology.subcarrierSpacingHz, 'Hz')],
                          ['Symbol length', `${linkNumerology.symbolUs.toFixed(3)} µs`],
                          ['Slot length', `${linkNumerology.slotUs.toFixed(3)} µs`],
                          ['Slots per frame', String(linkNumerology.slotsPerFrame)],
                          ['Symbols per frame', String(linkNumerology.symbolsPerFrame)],
                          ['Sample rate (4096 FFT)', formatEng(linkNumerology.sampleRateHz, 'Hz')],
                        ] as const).map(([label, value]) => (
                          <div key={label} className="rounded-md border border-border/60 px-2 py-1.5">
                            <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                              {label}
                            </dt>
                            <dd className="font-mono text-foreground">{value}</dd>
                          </div>
                        ))}
                      </dl>

                      <div className="space-y-1">
                        {CANDIDATE_6G_BANDS.map((band) => {
                          const active = linkBands.some((candidate) => candidate.name === band.name)
                          return (
                            <div
                              key={band.name}
                              className={`rounded-md border px-2 py-1.5 text-xs ${
                                active ? 'border-primary/50 bg-primary/10' : 'border-border/60'
                              }`}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-medium text-foreground">{band.name}</span>
                                <span className="font-mono text-[11px] text-muted-foreground">
                                  {formatFrequency(band.startHz / 1e6)} – {formatFrequency(band.stopHz / 1e6)}
                                </span>
                              </div>
                              <p className="text-[11px] leading-snug text-muted-foreground">{band.note}</p>
                            </div>
                          )
                        })}
                      </div>
                      <p className="text-[11px] leading-relaxed text-muted-foreground">
                        Candidate 6G bands are research and WRC agenda items, not allocations. Numerology
                        follows the NR relation 15·2^µ kHz; a slot is 14 symbols, and the 4096-point FFT is
                        the largest NR defines.
                      </p>
                    </CardContent>
                  </Card>
                </>
              ) : (
                <ErrorCard message={linkError} />
              )}
            </div>
          )}

          {tab === 'photonics' && (
            <div className="space-y-4">
              {photonicData ? (
                <>
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold text-foreground">
                        Optical budget · {fibreLengthKm} km at {fibreWavelengthNm} nm
                      </h2>
                      <p className="text-xs text-muted-foreground">
                        {fibreBitRateGbps} Gbit/s OOK · BER 1e−{fibreBerExponent} · {fibreLaunchDbm} dBm launch ·{' '}
                        {fibreResponsivity} A/W photodiode
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Metric label="Link margin" value={formatDb(photonicData.linkMarginDb)} />
                      <Metric label="Received power" value={formatDb(photonicData.receivedPowerDbm)} />
                      <Metric label="Receiver sensitivity" value={formatDb(photonicData.receiverSensitivityDbm)} />
                    </div>
                  </div>

                  <div
                    role="status"
                    className={`rounded-md border px-3 py-2 text-sm ${
                      photonicData.closes
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600'
                        : 'border-destructive/40 bg-destructive/10 text-destructive'
                    }`}
                  >
                    {photonicData.closes
                      ? `Optical link closes with ${photonicData.linkMarginDb.toFixed(2)} dB margin after the ${fibreSystemMarginDb} dB ageing allowance.`
                      : `Optical link fails by ${Math.abs(photonicData.linkMarginDb).toFixed(2)} dB after the ${fibreSystemMarginDb} dB ageing allowance.`}
                  </div>

                  <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Power chain</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <dl className="space-y-2 text-xs">
                          {([
                            ['Launch power', formatDb(fibreLaunchDbm)],
                            ['Fibre loss', formatDb(-photonicData.fibreLossDb)],
                            ['Splice loss', formatDb(-photonicData.spliceLossDb)],
                            ['Connector loss', formatDb(-photonicData.connectorLossDb)],
                            ['Dispersion penalty', formatDb(-photonicData.dispersionPenaltyDb)],
                            ['Received power', formatDb(photonicData.receivedPowerDbm)],
                            ['Receiver sensitivity', formatDb(photonicData.receiverSensitivityDbm)],
                            ['Ageing allowance', formatDb(-fibreSystemMarginDb)],
                          ] as const).map(([label, value]) => (
                            <div
                              key={label}
                              className="flex items-center justify-between gap-4 border-b border-border/60 pb-1.5 last:border-0 last:pb-0"
                            >
                              <dt className="text-muted-foreground">{label}</dt>
                              <dd className="font-mono text-foreground">{value}</dd>
                            </div>
                          ))}
                        </dl>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="flex items-center gap-2 text-sm">
                          <Info className="h-4 w-4" />
                          Photon budget
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2 text-xs">
                        <dl className="space-y-2">
                          {([
                            ['Optical frequency', `${photonicData.opticalFrequencyThz.toFixed(3)} THz`],
                            ['Photon energy', `${formatEng(photonicData.photonEnergyJ, 'J')}`],
                            ['Q factor', photonicData.qFactor.toFixed(3)],
                            [
                              'Photons per bit at sensitivity',
                              `${photonicData.photonsPerBitAtSensitivity.toFixed(0)} photons/bit`,
                            ],
                            [
                              'Ideal ln(1/BER) bound',
                              `${photonicData.quantumLimitPhotonsPerBit.toFixed(1)} photons/bit`,
                            ],
                          ] as const).map(([label, value]) => (
                            <div
                              key={label}
                              className="flex items-center justify-between gap-4 border-b border-border/60 pb-1.5 last:border-0 last:pb-0"
                            >
                              <dt className="text-muted-foreground">{label}</dt>
                              <dd className="font-mono text-foreground">{value}</dd>
                            </div>
                          ))}
                        </dl>
                        <p className="rounded-md bg-muted/60 p-2 leading-relaxed">
                          The ln(1/BER) figure is an ideal photon-counting bound. A PIN transimpedance
                          receiver is not a photon counter, so the achieved sensitivity sits far above it.
                        </p>
                      </CardContent>
                    </Card>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Chromatic dispersion</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <dl className="space-y-2 text-xs">
                          {([
                            ['Pulse broadening σ', `${photonicData.dispersionBroadeningPs.toFixed(2)} ps`],
                            ['Bit period', `${(1000 / fibreBitRateGbps).toFixed(2)} ps`],
                            ['σ / bit period', photonicData.dispersionRatio.toFixed(3)],
                            ['Eye-closure penalty', formatDb(photonicData.dispersionPenaltyDb)],
                          ] as const).map(([label, value]) => (
                            <div key={label} className="flex items-center justify-between gap-4">
                              <dt className="text-muted-foreground">{label}</dt>
                              <dd className="font-mono text-foreground">{value}</dd>
                            </div>
                          ))}
                        </dl>
                        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                          σ = D·Δλ·L and the penalty is 5·log₁₀(1 + (2π·B·σ)²), a Gaussian eye-closure
                          estimate rather than a waveform simulation.
                        </p>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="flex items-center gap-2 text-sm">
                          <Info className="h-4 w-4" />
                          What this result assumes
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ul className="list-disc space-y-1 pl-4 text-xs leading-relaxed text-muted-foreground">
                          {photonicData.assumptions.map((assumption) => (
                            <li key={assumption}>{assumption}</li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  </div>
                </>
              ) : (
                <ErrorCard message={photonicError} />
              )}
            </div>
          )}

          {tab === 'quantum' && (
            <div className="space-y-4">
              {quantumData ? (
                <>
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold text-foreground">
                        Statevector · {quantumQubits} qubit{quantumQubits === 1 ? '' : 's'}
                      </h2>
                      <p className="text-xs text-muted-foreground">
                        {quantumGates.length} gate{quantumGates.length === 1 ? '' : 's'} ·{' '}
                        {quantumData.amplitudes.length} amplitudes · exact unitary evolution
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {quantumMarginals.map((probability, qubit) => (
                        <Metric
                          key={qubit}
                          label={`P(q${qubit} = 1)`}
                          value={probability.toFixed(4)}
                        />
                      ))}
                    </div>
                  </div>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Circuit</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {quantumGates.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          The empty circuit is |{quantumData.basisLabels[0]}⟩ — add a gate or choose a preset.
                        </p>
                      ) : (
                        <ol className="space-y-1.5">
                          {quantumGates.map((gate, index) => (
                            <li
                              key={`${index}-${gate.type}`}
                              className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-2 py-1.5 text-xs"
                            >
                              <span className="font-mono text-foreground">
                                {index + 1}. {gateSummary(gate)}
                              </span>
                              <button
                                type="button"
                                aria-label={`Remove gate ${index + 1}`}
                                onClick={() => {
                                  setQuantumGates((previous) =>
                                    previous.filter((_, gateIndex) => gateIndex !== index),
                                  )
                                  setQuantumCounts(null)
                                }}
                                className="text-muted-foreground transition-colors hover:text-destructive"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </li>
                          ))}
                        </ol>
                      )}
                    </CardContent>
                  </Card>

                  <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Basis probabilities</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                              <th className="pb-1.5 font-medium">Basis</th>
                              <th className="pb-1.5 text-right font-medium">Probability</th>
                              <th className="pb-1.5 text-right font-medium">Amplitude</th>
                              <th className="pb-1.5 text-right font-medium">Phase</th>
                            </tr>
                          </thead>
                          <tbody>
                            {quantumOutcomes.slice(0, 16).map(({ probability, index }) => {
                              const amplitude = quantumData.amplitudes[index]
                              const phase = (Math.atan2(amplitude.im, amplitude.re) * 180) / Math.PI
                              return (
                                <tr key={index} className="border-b border-border/40 last:border-0">
                                  <td className="py-1 font-mono text-foreground">
                                    |{quantumData.basisLabels[index]}⟩
                                  </td>
                                  <td className="py-1 text-right font-mono text-foreground">
                                    {(probability * 100).toFixed(3)} %
                                  </td>
                                  <td className="py-1 text-right font-mono text-muted-foreground">
                                    {formatAmplitude(amplitude)}
                                  </td>
                                  <td className="py-1 text-right font-mono text-muted-foreground">
                                    {phase.toFixed(1)}°
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                        {quantumOutcomes.length > 16 && (
                          <p className="mt-2 text-[11px] text-muted-foreground">
                            Showing the 16 most probable of {quantumOutcomes.length} non-zero outcomes.
                          </p>
                        )}
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Sampled measurement</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {quantumCounts ? (
                          <>
                            <p
                              role="status"
                              className="rounded-md border border-border/60 bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground"
                            >
                              {quantumCounts.total} shots produced {quantumCounts.outcomes.length} observed
                              outcome{quantumCounts.outcomes.length === 1 ? '' : 's'}. Sampling is
                              statistical; the exact probabilities are listed alongside.
                            </p>
                            <ul className="space-y-2">
                              {quantumCounts.outcomes.map((outcome) => (
                                <li key={outcome.label}>
                                  <div className="flex items-center justify-between gap-3 text-xs">
                                    <span className="font-mono text-foreground">|{outcome.label}⟩</span>
                                    <span className="font-mono text-muted-foreground">
                                      {outcome.count} · {(outcome.frequency * 100).toFixed(1)} %
                                    </span>
                                  </div>
                                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                                    <div
                                      className="h-full rounded-full bg-primary"
                                      style={{ width: `${Math.min(100, outcome.frequency * 100)}%` }}
                                    />
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            Run a measurement to draw shots from the exact distribution.
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  </div>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center gap-2 text-sm">
                        <Info className="h-4 w-4" />
                        What this simulator is not
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-xs leading-relaxed text-muted-foreground">
                      A noiseless pure-state simulator with no density matrices, mid-circuit measurement,
                      gate error or hardware calibration. Sampling draws independent shots; it never
                      collapses the stored state. Physical noise and device characterisation are not
                      modelled.
                    </CardContent>
                  </Card>
                </>
              ) : (
                <ErrorCard message={quantumError} />
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

function Metric({ label, value, pending = false }: { label: string; value: string; pending?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      {/* pending = the model cannot produce this metric: prose, never a mono number. */}
      <div className={pending ? 'max-w-[16rem] text-[10px] leading-snug text-muted-foreground' : 'font-mono text-sm text-foreground'}>
        {value}
      </div>
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
