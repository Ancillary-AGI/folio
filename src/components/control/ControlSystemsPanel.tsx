/**
 * Control-systems workspace: plant entry, PID design, time response, Bode
 * plot, stability margins and pole/zero locations.
 *
 * Every number on this page comes from `src/lib/control` — the panel parses
 * coefficients and renders, it never substitutes an estimate of its own.
 */
import { useMemo, useState } from 'react'
import { X, AlertCircle, Activity } from 'lucide-react'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Input } from '../ui/input'
import { loadDomainDesign, usePublishDomainDesign } from '../../lib/project/domainDesign'
import { Badge } from '../ui/badge'
import TraceChart from '../charts/TraceChart'
import ControllerToolbox from './ControllerToolbox'
import {
  bodeResponse,
  simulateStep,
  stabilityMargins,
  stepResponseMetrics,
  tfPoles,
  tfSeries,
  tfStability,
  tfZeros,
  type TransferFunction,
} from '../../lib/control/transferFunction'
import { pidClosedLoop, pidTransferFunction } from '../../lib/control/pid'
import { describeError } from '../../lib/utils'
import { chartSeriesColors } from '../../lib/theme/tokens'
import { useTheme } from '../../lib/theme/useTheme'

interface ControlSystemsPanelProps {
  onClose: () => void
}

const PRESETS: Array<{ name: string; numerator: string; denominator: string }> = [
  { name: 'First order', numerator: '1', denominator: '1, 1' },
  { name: 'Second order', numerator: '1', denominator: '1, 0.4, 1' },
  { name: 'Integrator', numerator: '1', denominator: '1, 0' },
  { name: 'Integrator + lag', numerator: '1', denominator: '1, 1, 0' },
]

function parseCoefficients(text: string, label: string): number[] {
  const parts = text.split(',').map((part) => part.trim()).filter((part) => part.length > 0)
  if (parts.length === 0) throw new Error(`${label} needs at least one coefficient.`)
  return parts.map((part) => {
    const value = Number(part)
    if (!Number.isFinite(value)) throw new Error(`${label}: "${part}" is not a finite number.`)
    return value
  })
}

function formatNumber(value: number, digits = 4): string {
  if (!Number.isFinite(value)) return Number.isNaN(value) ? '—' : '∞'
  if (value !== 0 && (Math.abs(value) >= 1e5 || Math.abs(value) < 1e-3)) return value.toExponential(2)
  return value.toFixed(digits)
}

function formatMargin(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : '∞'
}

function thin<T>(items: readonly T[], limit = 700): T[] {
  if (items.length <= limit) return [...items]
  const stride = Math.ceil(items.length / limit)
  const out = items.filter((_, index) => index % stride === 0)
  const last = items[items.length - 1]
  if (out[out.length - 1] !== last) out.push(last)
  return out
}

function formatComplex(re: number, im: number): string {
  if (Math.abs(im) < 1e-9) return formatNumber(re)
  return `${formatNumber(re)} ${im >= 0 ? '+' : '−'} ${formatNumber(Math.abs(im))}j`
}

interface ControlDesign {
  numeratorText?: string
  denominatorText?: string
  usePid?: boolean
  kp?: number
  ki?: number
  kd?: number
  filterTau?: number
  tEnd?: number
  dt?: number
  fMin?: number
  fMax?: number
}

const finiteOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

export default function ControlSystemsPanel({ onClose }: ControlSystemsPanelProps) {
  const saved = loadDomainDesign<ControlDesign>('control')
  const [numeratorText, setNumeratorText] = useState(
    typeof saved?.numeratorText === 'string' ? saved.numeratorText : '1',
  )
  const [denominatorText, setDenominatorText] = useState(
    typeof saved?.denominatorText === 'string' ? saved.denominatorText : '1, 1, 0',
  )
  const [usePid, setUsePid] = useState(saved?.usePid !== false)
  const [kp, setKp] = useState(finiteOr(saved?.kp, 2))
  const [ki, setKi] = useState(finiteOr(saved?.ki, 1))
  const [kd, setKd] = useState(finiteOr(saved?.kd, 0.1))
  const [filterTau, setFilterTau] = useState(finiteOr(saved?.filterTau, 0.01))
  const [tEnd, setTEnd] = useState(finiteOr(saved?.tEnd, 10))
  const [dt, setDt] = useState(finiteOr(saved?.dt, 0.005))
  const [fMin, setFMin] = useState(finiteOr(saved?.fMin, 0.01))
  const [fMax, setFMax] = useState(finiteOr(saved?.fMax, 1000))

  const { theme } = useTheme()
  const seriesColors = useMemo(() => chartSeriesColors(theme), [theme])

  usePublishDomainDesign('control', {
    numeratorText, denominatorText, usePid, kp, ki, kd, filterTau, tEnd, dt, fMin, fMax,
  }, (next) => {
    if (typeof next.numeratorText === 'string') setNumeratorText(next.numeratorText)
    if (typeof next.denominatorText === 'string') setDenominatorText(next.denominatorText)
    if (typeof next.usePid === 'boolean') setUsePid(next.usePid)
    setKp(finiteOr(next.kp, kp))
    setKi(finiteOr(next.ki, ki))
    setKd(finiteOr(next.kd, kd))
    setFilterTau(finiteOr(next.filterTau, filterTau))
    setTEnd(finiteOr(next.tEnd, tEnd))
    setDt(finiteOr(next.dt, dt))
    setFMin(finiteOr(next.fMin, fMin))
    setFMax(finiteOr(next.fMax, fMax))
  })

  const analysis = useMemo(() => {
    try {
      const plant: TransferFunction = {
        numerator: parseCoefficients(numeratorText, 'Numerator'),
        denominator: parseCoefficients(denominatorText, 'Denominator'),
      }
      const gains = { kp, ki, kd, derivativeFilterSeconds: filterTau }
      const controller = usePid ? pidTransferFunction(gains) : null
      const openLoop = controller ? tfSeries(plant, controller) : plant
      const closedLoop = usePid ? pidClosedLoop(plant, gains) : plant

      const samples = simulateStep(closedLoop, { tEndSeconds: tEnd, dtSeconds: dt })
      const overflow = samples.some(
        (sample) => !Number.isFinite(sample.output) || !Number.isFinite(sample.timeSeconds),
      )
      const metrics = stepResponseMetrics(samples.filter((sample) => Number.isFinite(sample.output)))

      const bode = bodeResponse(openLoop, { fMinHz: fMin, fMaxHz: fMax, points: 800 })
      const margins = stabilityMargins(openLoop, { fMinHz: fMin, fMaxHz: fMax })
      const poles = tfPoles(closedLoop)
      const zeros = tfZeros(plant)
      const stability = tfStability(closedLoop)

      return {
        ok: true as const,
        plant,
        openLoop,
        closedLoop,
        stability,
        overflow,
        metrics,
        margins,
        bode,
        poles,
        zeros,
        timeData: thin(samples).map((sample) => ({
          time: sample.timeSeconds,
          output: Number.isFinite(sample.output) ? sample.output : null,
        })),
        bodeData: thin(bode).map((point) => ({
          decade: Math.log10(point.frequencyHz),
          magnitudeDb: Number.isFinite(point.magnitudeDb) ? point.magnitudeDb : -400,
          phaseDeg: point.phaseDeg,
        })),
      }
    } catch (error) {
      return { ok: false as const, error: describeError(error) }
    }
  }, [
    numeratorText, denominatorText, usePid, kp, ki, kd, filterTau, tEnd, dt, fMin, fMax,
  ])

  const decadeTicks = useMemo(() => {
    if (!Number.isFinite(fMin) || !Number.isFinite(fMax) || fMin <= 0 || fMax <= fMin) return []
    const first = Math.ceil(Math.log10(fMin))
    const last = Math.floor(Math.log10(fMax))
    const ticks: number[] = []
    for (let decade = first; decade <= last; decade += 1) ticks.push(decade)
    return ticks.length > 0 ? ticks : [Math.log10(fMin), Math.log10(fMax)]
  }, [fMin, fMax])

  return (
    <div className="h-full overflow-auto bg-background p-4">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Control Systems</h2>
            <p className="text-sm text-muted-foreground">
              Transfer-function design, PID tuning, time response, Bode margins and pole locations.
            </p>
          </div>
          <Button variant="ghost" size="icon" aria-label="Close control systems" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Plant and controller</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Presets</span>
                <div className="flex flex-wrap gap-1">
                  {PRESETS.map((preset) => (
                    <Button
                      key={preset.name}
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setNumeratorText(preset.numerator)
                        setDenominatorText(preset.denominator)
                      }}
                    >
                      {preset.name}
                    </Button>
                  ))}
                </div>
              </div>

              <label className="block space-y-1 text-sm">
                <span className="font-medium">Numerator coefficients</span>
                <Input
                  value={numeratorText}
                  onChange={(event) => setNumeratorText(event.target.value)}
                  placeholder="e.g. 1, 2"
                  aria-label="Numerator coefficients"
                />
                <span className="text-xs text-muted-foreground">Descending powers of s, comma separated.</span>
              </label>

              <label className="block space-y-1 text-sm">
                <span className="font-medium">Denominator coefficients</span>
                <Input
                  value={denominatorText}
                  onChange={(event) => setDenominatorText(event.target.value)}
                  placeholder="e.g. 1, 3, 2"
                  aria-label="Denominator coefficients"
                />
              </label>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={usePid}
                  onChange={(event) => setUsePid(event.target.checked)}
                  className="h-4 w-4"
                />
                <span className="font-medium">Close the loop with a PID controller</span>
              </label>

              {usePid && (
                <div className="grid grid-cols-2 gap-3">
                  <label className="block space-y-1 text-sm">
                    <span>Kp</span>
                    <Input type="number" step="0.1" value={kp} onChange={(event) => setKp(Number(event.target.value))} aria-label="Proportional gain" />
                  </label>
                  <label className="block space-y-1 text-sm">
                    <span>Ki</span>
                    <Input type="number" step="0.1" value={ki} onChange={(event) => setKi(Number(event.target.value))} aria-label="Integral gain" />
                  </label>
                  <label className="block space-y-1 text-sm">
                    <span>Kd</span>
                    <Input type="number" step="0.01" value={kd} onChange={(event) => setKd(Number(event.target.value))} aria-label="Derivative gain" />
                  </label>
                  <label className="block space-y-1 text-sm">
                    <span>Derivative filter τ (s)</span>
                    <Input type="number" step="0.001" min="0.0001" value={filterTau} onChange={(event) => setFilterTau(Number(event.target.value))} aria-label="Derivative filter time constant" />
                  </label>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1 text-sm">
                  <span>Run time (s)</span>
                  <Input type="number" step="0.5" min="0.1" value={tEnd} onChange={(event) => setTEnd(Number(event.target.value))} aria-label="Step simulation run time" />
                </label>
                <label className="block space-y-1 text-sm">
                  <span>Step (s)</span>
                  <Input type="number" step="0.001" min="0.0001" value={dt} onChange={(event) => setDt(Number(event.target.value))} aria-label="Step simulation time step" />
                </label>
                <label className="block space-y-1 text-sm">
                  <span>Bode f min (Hz)</span>
                  <Input type="number" step="0.1" min="0.0001" value={fMin} onChange={(event) => setFMin(Number(event.target.value))} aria-label="Bode minimum frequency" />
                </label>
                <label className="block space-y-1 text-sm">
                  <span>Bode f max (Hz)</span>
                  <Input type="number" step="10" min="0.001" value={fMax} onChange={(event) => setFMax(Number(event.target.value))} aria-label="Bode maximum frequency" />
                </label>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4">
            {!analysis.ok ? (
              <Card>
                <CardContent className="flex items-start gap-2 p-4 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{analysis.error}</span>
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Card>
                    <CardContent className="p-3">
                      <div className="text-xs text-muted-foreground">Closed-loop stability</div>
                      <Badge
                        className="mt-1"
                        variant={analysis.stability === 'stable' ? 'default' : 'destructive'}
                      >
                        {analysis.stability}
                      </Badge>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-3">
                      <div className="text-xs text-muted-foreground">Phase margin</div>
                      <div className="text-lg font-semibold">{formatMargin(analysis.margins.phaseMarginDeg)}°</div>
                      <div className="text-xs text-muted-foreground">
                        at {Number.isFinite(analysis.margins.gainCrossoverHz) ? `${formatNumber(analysis.margins.gainCrossoverHz, 3)} Hz` : 'no crossover'}
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-3">
                      <div className="text-xs text-muted-foreground">Gain margin</div>
                      <div className="text-lg font-semibold">{formatMargin(analysis.margins.gainMarginDb)} dB</div>
                      <div className="text-xs text-muted-foreground">
                        at {Number.isFinite(analysis.margins.phaseCrossoverHz) ? `${formatNumber(analysis.margins.phaseCrossoverHz, 3)} Hz` : 'no crossover'}
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-3">
                      <div className="text-xs text-muted-foreground">Overshoot</div>
                      <div className="text-lg font-semibold">{formatNumber(analysis.metrics.overshootPct, 2)}%</div>
                      <div className="text-xs text-muted-foreground">
                        settle {formatNumber(analysis.metrics.settlingTimeSeconds, 3)} s
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {analysis.overflow && (
                  <div className="flex items-center gap-2 rounded-md border border-warning/50 bg-warning/10 text-warning p-3 text-sm">
                    <AlertCircle className="h-4 w-4" />
                    The response exceeded the numeric range before the run ended; points beyond that are not plotted.
                  </div>
                )}

                <div className="grid gap-4 xl:grid-cols-2">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Step response</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <TraceChart
                        data={analysis.timeData}
                        xKey="time"
                        series={[{ key: 'output', label: 'Output', color: seriesColors[0] }]}
                        xLabel="Time"
                        xFormatter={(value) => `${formatNumber(value, 4)} s`}
                        yFormatter={(value) => formatNumber(value, 3)}
                        readoutFormatter={(value) => formatNumber(value, 6)}
                        height={256}
                        ariaLabel="Closed-loop step response"
                      />
                      <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                        <span>Final: {formatNumber(analysis.metrics.steadyState, 4)}</span>
                        <span>Rise 10–90 %: {formatNumber(analysis.metrics.riseTimeSeconds, 3)} s</span>
                        <span>Poles: {analysis.poles.length}</span>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Bode magnitude</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <TraceChart
                        data={analysis.bodeData}
                        xKey="decade"
                        series={[{ key: 'magnitudeDb', label: 'Magnitude', unit: 'dB', color: seriesColors[1] }]}
                        ticks={decadeTicks}
                        xLabel="Frequency"
                        xFormatter={(value) => `${(10 ** value).toPrecision(3)} Hz`}
                        yFormatter={(value) => `${formatNumber(value, 0)} dB`}
                        readoutFormatter={(value) => `${formatNumber(value, 2)} dB`}
                        height={256}
                        ariaLabel="Bode magnitude"
                      />
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Bode phase</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <TraceChart
                        data={analysis.bodeData}
                        xKey="decade"
                        series={[{ key: 'phaseDeg', label: 'Phase', unit: '°', color: seriesColors[2] }]}
                        ticks={decadeTicks}
                        xLabel="Frequency"
                        xFormatter={(value) => `${(10 ** value).toPrecision(3)} Hz`}
                        yFormatter={(value) => `${formatNumber(value, 0)}°`}
                        readoutFormatter={(value) => `${formatNumber(value, 2)}°`}
                        height={256}
                        ariaLabel="Bode phase"
                      />
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Poles and zeros</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      <div>
                        <div className="mb-1 text-xs font-medium text-muted-foreground">Closed-loop poles</div>
                        <ul className="space-y-1 font-mono text-xs">
                          {analysis.poles.length === 0 && <li>none (static gain)</li>}
                          {analysis.poles.map((pole, index) => (
                            <li key={`pole-${index}`}>
                              {formatComplex(pole.re, pole.im)} {pole.re > 0 ? '· unstable' : ''}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <div className="mb-1 text-xs font-medium text-muted-foreground">Plant zeros</div>
                        <ul className="space-y-1 font-mono text-xs">
                          {analysis.zeros.length === 0 && <li>none</li>}
                          {analysis.zeros.map((zero, index) => (
                            <li key={`zero-${index}`}>{formatComplex(zero.re, zero.im)}</li>
                          ))}
                        </ul>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Activity className="h-3.5 w-3.5" />
                        Margins are for unity negative feedback around the open loop.
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </>
            )}
          </div>
        </div>

        <ControllerToolbox
          plant={analysis.ok ? analysis.plant : null}
          plantText={`${numeratorText} / ${denominatorText}`}
          currentGains={{ kp, ki, kd, derivativeFilterSeconds: filterTau }}
          horizon={{ tEndSeconds: tEnd, dtSeconds: dt }}
          marginScan={{ fMinHz: fMin, fMaxHz: fMax }}
          onApplyGains={(gains) => {
            setKp(gains.kp)
            setKi(gains.ki)
            setKd(gains.kd)
            const tau = gains.derivativeFilterSeconds
            if (typeof tau === 'number' && Number.isFinite(tau) && tau > 0) setFilterTau(tau)
            setUsePid(true)
          }}
        />

        <Card>
          <CardContent className="p-4 text-xs text-muted-foreground">
            The plots above are continuous-time, linear, SISO analysis. Not modelled there: time
            delays, MIMO/pole placement, actuator saturation, and non-minimum-phase plants where
            gain/phase margins do not tell the whole story. The toolbox above exercises two of those
            separately and labels them as such — a sampled-data PID with an actuator limit, and a
            dead time read off an identified FOPDT model — so nothing here silently replaces the
            linear plots. The closed-loop stability badge always comes from the closed-loop poles.
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
