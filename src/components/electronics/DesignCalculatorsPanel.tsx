/**
 * Assembly & harness design calculators.
 *
 * Every value shown here is computed by the tested engineering modules in
 * `src/lib/electronics` — passive E-series selection, ADC/op-amp/UART/I2C
 * interfaces, AWG loop-drop and ampacity, crimp limits, TIM thermal
 * resistance, standoff geometry, coating/potting data, and JEDEC reflow
 * profile validation. The panel never substitutes a guessed value: invalid
 * input renders a named error instead of a plausible-looking number.
 */
import { useMemo, useState, type ReactNode } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Input } from '../ui/input'
import { Badge } from '../ui/badge'
import { describeError } from '../../lib/utils'
import {
  CHIP_PACKAGES,
  capacitor,
  inductor,
  nearestE12,
  resistor,
  type PassiveFamily,
} from '../../lib/electronics/passives'
import {
  adcLsb,
  adcQuantNoiseRms,
  i2cRiseTimeNs,
  opAmpGain,
  uartBaudError,
  uartFrameBits,
  type AdcSpec,
  type OpAmpConfig,
  type UartConfig,
} from '../../lib/electronics/analogInterfaces'
import {
  AWG_TABLE,
  calculateHarnessLoopDrop,
  recommendWireGauge,
} from '../../lib/electronics/wireHarness'
import {
  CONFORMAL_COATINGS,
  POTTING_COMPOUNDS,
  STANDARD_STANDOFFS,
  TIM_LIBRARY,
  thermalResistanceKw,
  type CoatingType,
} from '../../lib/electronics/fastenersAdhesives'
import {
  HEAT_SHRINK_TUBING,
  REFLOW_PROFILES,
  getMinimumCrimpTensileForce,
  validateReflowProfile,
} from '../../lib/electronics/assemblyTools'

type Attempt<T> = { ok: true; value: T } | { ok: false; error: string }

function attempt<T>(run: () => T): Attempt<T> {
  try {
    return { ok: true, value: run() }
  } catch (error) {
    return { ok: false, error: describeError(error) }
  }
}

/** Engineering notation with an SI prefix (4.7 kΩ, 10 nF). */
function formatEng(value: number, unit: string, digits = 4): string {
  if (!Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  const scales: ReadonlyArray<readonly [number, string]> = [
    [1e9, 'G'],
    [1e6, 'M'],
    [1e3, 'k'],
    [1, ''],
    [1e-3, 'm'],
    [1e-6, 'µ'],
    [1e-9, 'n'],
    [1e-12, 'p'],
  ]
  for (const [scale, prefix] of scales) {
    if (abs >= scale || scale === 1e-12) {
      return `${Number((value / scale).toPrecision(digits))} ${prefix}${unit}`.trim()
    }
  }
  return `${value} ${unit}`
}

function Row({ label, value, tone }: { label: string; value: ReactNode; tone?: 'ok' | 'warn' | 'bad' }) {
  const toneClass =
    tone === 'ok' ? 'text-success' : tone === 'warn' ? 'text-warning' : tone === 'bad' ? 'text-destructive' : ''
  return (
    <div className="flex items-start justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={`text-right font-medium ${toneClass}`}>{value}</span>
    </div>
  )
}

function NumberField({
  label,
  value,
  onChange,
  unit,
  min,
  step,
}: {
  label: string
  value: number
  onChange: (next: number) => void
  unit?: string
  min?: number
  step?: number | 'any'
}) {
  return (
    <label className="block text-xs">
      <span className="text-muted-foreground">
        {label}
        {unit ? ` (${unit})` : ''}
      </span>
      <Input
        type="number"
        value={Number.isFinite(value) ? value : ''}
        min={min}
        step={step ?? 'any'}
        onChange={(event) => onChange(event.target.value === '' ? Number.NaN : Number(event.target.value))}
        className="mt-1 h-8 text-xs"
      />
    </label>
  )
}

function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string
  value: string
  onChange: (next: string) => void
  children: ReactNode
}) {
  return (
    <label className="block text-xs">
      <span className="text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
      >
        {children}
      </select>
    </label>
  )
}

function ErrorLine({ error }: { error: string }) {
  return (
    <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
      {error}
    </div>
  )
}

/*
 * No default oven trace: a verdict printed from sample data the user never
 * supplied would certify a profile nobody measured. The textarea starts empty
 * and the verdict panel waits for real samples.
 */
const EMPTY_REFLOW_SAMPLES = ''

function parseReflowSamples(text: string): Array<{ timeSec: number; tempC: number }> {
  const samples: Array<{ timeSec: number; tempC: number }> = []
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim()
    if (!line || line.startsWith('#')) return
    const parts = line.split(/[,\s]+/)
    if (parts.length !== 2) throw new Error(`line ${index + 1}: expected "time,temperature".`)
    const timeSec = Number(parts[0])
    const tempC = Number(parts[1])
    if (!Number.isFinite(timeSec) || !Number.isFinite(tempC)) {
      throw new Error(`line ${index + 1}: time and temperature must be numeric.`)
    }
    samples.push({ timeSec, tempC })
  })
  return samples
}

const AWG_OPTIONS = Object.keys(AWG_TABLE)
  .map(Number)
  .sort((a, b) => a - b)

export default function DesignCalculatorsPanel() {
  // Passive selection
  const [passiveFamily, setPassiveFamily] = useState<PassiveFamily>('resistor')
  const [passiveTarget, setPassiveTarget] = useState(4700)
  const [passivePackage, setPassivePackage] = useState('0603')
  const [passiveTolerance, setPassiveTolerance] = useState(1)
  const [passiveDielectric, setPassiveDielectric] = useState<'C0G' | 'X7R' | 'X5R' | 'Y5V'>('X7R')
  const [passiveVoltage, setPassiveVoltage] = useState(50)
  const [passiveSatCurrent, setPassiveSatCurrent] = useState(1)

  // Analog interfaces
  const [adcBits, setAdcBits] = useState(10)
  const [adcVref, setAdcVref] = useState(5)
  const [opampKind, setOpampKind] = useState<OpAmpConfig['kind']>('non-inverting')
  const [opampRIn, setOpampRIn] = useState(10_000)
  const [opampRF, setOpampRF] = useState(100_000)
  const [uartTargetBaud, setUartTargetBaud] = useState(115_200)
  const [uartActualBaud, setUartActualBaud] = useState(114_943)
  const [uartDataBits, setUartDataBits] = useState<UartConfig['dataBits']>(8)
  const [uartStopBits, setUartStopBits] = useState<UartConfig['stopBits']>(1)
  const [uartParity, setUartParity] = useState<UartConfig['parity']>('none')
  const [i2cPullupKohm, setI2cPullupKohm] = useState(4.7)
  const [i2cBusCapPf, setI2cBusCapPf] = useState(150)

  // Harness
  const [harnessAwg, setHarnessAwg] = useState(18)
  const [harnessLengthM, setHarnessLengthM] = useState(3)
  const [harnessCurrentA, setHarnessCurrentA] = useState(5)
  const [harnessVoltageV, setHarnessVoltageV] = useState(12)
  const [harnessConductors, setHarnessConductors] = useState(4)
  const [harnessAmbientC, setHarnessAmbientC] = useState(25)
  const [heatShrinkIndex, setHeatShrinkIndex] = useState(1)

  // Thermal & mounting
  const [timId, setTimId] = useState(TIM_LIBRARY[0].id)
  const [timThicknessMm, setTimThicknessMm] = useState(TIM_LIBRARY[0].typicalThicknessMm)
  const [timAreaMm2, setTimAreaMm2] = useState(400)
  const [timPowerW, setTimPowerW] = useState(5)
  const [standoffId, setStandoffId] = useState(STANDARD_STANDOFFS[0].id)
  const [coatingType, setCoatingType] = useState<CoatingType>('AR')
  const [pottingId, setPottingId] = useState(POTTING_COMPOUNDS[0].id)

  // Reflow
  const [reflowAlloy, setReflowAlloy] = useState(Object.keys(REFLOW_PROFILES)[0])
  const [reflowText, setReflowText] = useState(EMPTY_REFLOW_SAMPLES)

  const passive = useMemo(
    () =>
      attempt(() => {
        if (!Number.isFinite(passiveTarget)) throw new Error('Enter a passive target value.')
        const e12 = nearestE12(passiveTarget)
        const chip = CHIP_PACKAGES[passivePackage]
        if (!chip) throw new Error(`Unknown package ${passivePackage}.`)
        if (passiveFamily === 'resistor') {
          const part = resistor(e12, passivePackage, passiveTolerance)
          return {
            e12,
            part,
            extraLabel: 'Max current at rated power',
            extraValue: formatEng(Math.sqrt(chip.rating / e12), 'A'),
          }
        }
        if (passiveFamily === 'capacitor') {
          const part = capacitor(e12 * 1e-9, passiveDielectric, passivePackage, passiveVoltage)
          return {
            e12,
            part,
            extraLabel: 'Dielectric tolerance',
            extraValue: `${part.tolerancePct}%`,
          }
        }
        const part = inductor(e12 * 1e-6, passivePackage, passiveSatCurrent)
        return {
          e12,
          part,
          extraLabel: 'Saturation current',
          extraValue: formatEng(passiveSatCurrent, 'A'),
        }
      }),
    [
      passiveFamily,
      passiveTarget,
      passivePackage,
      passiveTolerance,
      passiveDielectric,
      passiveVoltage,
      passiveSatCurrent,
    ],
  )

  const adc = useMemo(
    () =>
      attempt(() => {
        const spec: AdcSpec = {
          id: 'panel-adc',
          partNumber: 'custom',
          bits: adcBits,
          vref: adcVref,
          sampleRateSps: 0,
          interface: 'SPI',
          description: 'panel ADC',
        }
        const lsb = adcLsb(spec)
        return { lsb, noise: adcQuantNoiseRms(spec) }
      }),
    [adcBits, adcVref],
  )

  const opamp = useMemo(
    () => attempt(() => opAmpGain({ kind: opampKind, rIn: opampRIn, rF: opampRF })),
    [opampKind, opampRIn, opampRF],
  )

  const uart = useMemo(
    () =>
      attempt(() => {
        const config: UartConfig = {
          baud: uartTargetBaud,
          dataBits: uartDataBits,
          stopBits: uartStopBits,
          parity: uartParity,
        }
        const frameBits = uartFrameBits(config)
        return {
          frameBits,
          errorPercent: uartBaudError(uartTargetBaud, uartActualBaud) * 100,
          payloadBytesPerSec: uartActualBaud / frameBits,
        }
      }),
    [uartTargetBaud, uartActualBaud, uartDataBits, uartStopBits, uartParity],
  )

  const i2c = useMemo(
    () =>
      attempt(() =>
        i2cRiseTimeNs({
          pullupOhms: i2cPullupKohm * 1000,
          busCapacitanceF: i2cBusCapPf * 1e-12,
          vdd: 3.3,
        }),
      ),
    [i2cPullupKohm, i2cBusCapPf],
  )

  const harness = useMemo(
    () =>
      attempt(() => {
        const result = calculateHarnessLoopDrop(
          harnessAwg,
          harnessLengthM,
          harnessCurrentA,
          harnessVoltageV,
          harnessConductors,
          harnessAmbientC,
        )
        const recommendation = recommendWireGauge(
          harnessLengthM,
          harnessCurrentA,
          harnessVoltageV,
          3,
          harnessConductors,
          harnessAmbientC,
        )
        return { result, recommendation }
      }),
    [harnessAwg, harnessLengthM, harnessCurrentA, harnessVoltageV, harnessConductors, harnessAmbientC],
  )

  const crimp = useMemo(() => attempt(() => getMinimumCrimpTensileForce(harnessAwg)), [harnessAwg])

  const tim = TIM_LIBRARY.find((entry) => entry.id === timId) ?? TIM_LIBRARY[0]
  const thermal = useMemo(
    () =>
      attempt(() => {
        if (!Number.isFinite(timPowerW) || timPowerW < 0) throw new Error('Dissipation must be non-negative.')
        const resistanceKw = thermalResistanceKw(tim.conductivityWmk, timThicknessMm, timAreaMm2)
        return { resistanceKw, riseC: resistanceKw * timPowerW }
      }),
    [tim.conductivityWmk, timThicknessMm, timAreaMm2, timPowerW],
  )

  const standoff = STANDARD_STANDOFFS.find((entry) => entry.id === standoffId) ?? STANDARD_STANDOFFS[0]
  const coating = CONFORMAL_COATINGS[coatingType]
  const potting = POTTING_COMPOUNDS.find((entry) => entry.id === pottingId) ?? POTTING_COMPOUNDS[0]
  const heatShrink = HEAT_SHRINK_TUBING[heatShrinkIndex] ?? HEAT_SHRINK_TUBING[0]

  const reflowProfile = REFLOW_PROFILES[reflowAlloy] ?? REFLOW_PROFILES[Object.keys(REFLOW_PROFILES)[0]]
  const reflow = useMemo(
    () =>
      attempt(() => {
        const samples = parseReflowSamples(reflowText)
        return validateReflowProfile(reflowProfile, samples)
      }),
    [reflowProfile, reflowText],
  )

  const passiveUnit =
    passiveFamily === 'resistor' ? 'Ω' : passiveFamily === 'capacitor' ? 'nF' : 'µH'

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-2 pt-3 px-3">
          <CardTitle className="text-xs">Passive selection (E12)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 px-3 pb-3">
          <div className="grid grid-cols-2 gap-2">
            <SelectField label="Family" value={passiveFamily} onChange={(next) => setPassiveFamily(next as PassiveFamily)}>
              <option value="resistor">Resistor</option>
              <option value="capacitor">Capacitor</option>
              <option value="inductor">Inductor</option>
            </SelectField>
            <NumberField
              label={`Target value (${passiveUnit})`}
              value={passiveTarget}
              min={0}
              onChange={setPassiveTarget}
            />
            <SelectField label="Package" value={passivePackage} onChange={setPassivePackage}>
              {Object.keys(CHIP_PACKAGES).map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </SelectField>
            {passiveFamily === 'resistor' && (
              <NumberField label="Tolerance (%)" value={passiveTolerance} min={0} onChange={setPassiveTolerance} />
            )}
            {passiveFamily === 'capacitor' && (
              <>
                <SelectField
                  label="Dielectric"
                  value={passiveDielectric}
                  onChange={(next) => setPassiveDielectric(next as typeof passiveDielectric)}
                >
                  {['C0G', 'X7R', 'X5R', 'Y5V'].map((kind) => (
                    <option key={kind} value={kind}>
                      {kind}
                    </option>
                  ))}
                </SelectField>
                <NumberField label="Voltage rating (V)" value={passiveVoltage} min={0} onChange={setPassiveVoltage} />
              </>
            )}
            {passiveFamily === 'inductor' && (
              <NumberField label="Saturation current (A)" value={passiveSatCurrent} min={0} onChange={setPassiveSatCurrent} />
            )}
          </div>
          {passive.ok ? (
            <div className="space-y-1 pt-1">
              <Row label="Nearest E12" value={formatEng(passive.value.e12, '')} />
              <Row
                label="Selected value"
                value={formatEng(
                  passiveFamily === 'resistor'
                    ? passive.value.e12
                    : passiveFamily === 'capacitor'
                      ? passive.value.e12 * 1e-9
                      : passive.value.e12 * 1e-6,
                  passiveFamily === 'resistor' ? 'Ω' : passiveFamily === 'capacitor' ? 'F' : 'H',
                )}
              />
              <Row label="Package rating" value={formatEng(CHIP_PACKAGES[passivePackage].rating, passiveFamily === 'resistor' ? 'W' : 'A')} />
              <Row label="Tolerance" value={`±${passive.value.part.tolerancePct}%`} />
              <Row label="Voltage rating" value={`${passive.value.part.maxVoltageV} V`} />
              <Row label={passive.value.extraLabel} value={passive.value.extraValue} />
            </div>
          ) : (
            <ErrorLine error={passive.error} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 pt-3 px-3">
          <CardTitle className="text-xs">Analog & serial interfaces</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 px-3 pb-3 md:grid-cols-2">
          <div className="space-y-2 rounded-md border border-border p-2">
            <div className="text-xs font-medium">ADC</div>
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="Resolution (bits)" value={adcBits} min={1} onChange={setAdcBits} />
              <NumberField label="Vref (V)" value={adcVref} min={0} onChange={setAdcVref} />
            </div>
            {adc.ok ? (
              <div className="space-y-1">
                <Row label="LSB weight" value={formatEng(adc.value.lsb, 'V')} />
                <Row label="Quantization noise RMS" value={formatEng(adc.value.noise, 'V')} />
              </div>
            ) : (
              <ErrorLine error={adc.error} />
            )}
          </div>

          <div className="space-y-2 rounded-md border border-border p-2">
            <div className="text-xs font-medium">Op-amp</div>
            <SelectField label="Configuration" value={opampKind} onChange={(next) => setOpampKind(next as OpAmpConfig['kind'])}>
              <option value="non-inverting">Non-inverting</option>
              <option value="inverting">Inverting</option>
              <option value="voltage-follower">Voltage follower</option>
            </SelectField>
            {opampKind !== 'voltage-follower' && (
              <div className="grid grid-cols-2 gap-2">
                <NumberField label="R in (Ω)" value={opampRIn} min={0} onChange={setOpampRIn} />
                <NumberField label="R feedback (Ω)" value={opampRF} min={0} onChange={setOpampRF} />
              </div>
            )}
            {opamp.ok ? (
              <Row label="Closed-loop gain" value={opamp.value.toFixed(3)} />
            ) : (
              <ErrorLine error={opamp.error} />
            )}
          </div>

          <div className="space-y-2 rounded-md border border-border p-2">
            <div className="text-xs font-medium">UART</div>
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="Target baud" value={uartTargetBaud} min={0} onChange={setUartTargetBaud} />
              <NumberField label="Actual baud" value={uartActualBaud} min={0} onChange={setUartActualBaud} />
              <SelectField label="Data bits" value={String(uartDataBits)} onChange={(next) => setUartDataBits(Number(next) as UartConfig['dataBits'])}>
                {[5, 6, 7, 8].map((bits) => (
                  <option key={bits} value={bits}>
                    {bits}
                  </option>
                ))}
              </SelectField>
              <SelectField label="Parity" value={uartParity} onChange={(next) => setUartParity(next as UartConfig['parity'])}>
                <option value="none">None</option>
                <option value="even">Even</option>
                <option value="odd">Odd</option>
              </SelectField>
              <SelectField label="Stop bits" value={String(uartStopBits)} onChange={(next) => setUartStopBits(Number(next) as UartConfig['stopBits'])}>
                {[1, 1.5, 2].map((bits) => (
                  <option key={bits} value={bits}>
                    {bits}
                  </option>
                ))}
              </SelectField>
            </div>
            {uart.ok ? (
              <div className="space-y-1">
                <Row label="Frame size" value={`${uart.value.frameBits} bits`} />
                <Row label="Baud error" value={`${uart.value.errorPercent.toFixed(3)}%`} tone={Math.abs(uart.value.errorPercent) > 2 ? 'bad' : 'ok'} />
                <Row label="Payload throughput" value={`${Math.round(uart.value.payloadBytesPerSec)} B/s`} />
              </div>
            ) : (
              <ErrorLine error={uart.error} />
            )}
          </div>

          <div className="space-y-2 rounded-md border border-border p-2">
            <div className="text-xs font-medium">I²C bus</div>
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="Pull-up (kΩ)" value={i2cPullupKohm} min={0} onChange={setI2cPullupKohm} />
              <NumberField label="Bus capacitance (pF)" value={i2cBusCapPf} min={0} onChange={setI2cBusCapPf} />
            </div>
            {i2c.ok ? (
              <div className="space-y-1">
                <Row label="10–90% rise time" value={`${i2c.value.toFixed(1)} ns`} />
                <Row
                  label="Mode limit"
                  value={i2c.value <= 300 ? 'Fast-mode (≤300 ns)' : i2c.value <= 1000 ? 'Standard-mode only' : 'Exceeds 1000 ns'}
                  tone={i2c.value <= 300 ? 'ok' : i2c.value <= 1000 ? 'warn' : 'bad'}
                />
              </div>
            ) : (
              <ErrorLine error={i2c.error} />
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 pt-3 px-3">
          <CardTitle className="text-xs">Wire harness, crimp & heat shrink</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 px-3 pb-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <SelectField label="Conductor" value={String(harnessAwg)} onChange={(next) => setHarnessAwg(Number(next))}>
              {AWG_OPTIONS.map((awg) => (
                <option key={awg} value={awg}>
                  AWG {awg}
                </option>
              ))}
            </SelectField>
            <NumberField label="One-way length (m)" value={harnessLengthM} min={0} onChange={setHarnessLengthM} />
            <NumberField label="Current (A)" value={harnessCurrentA} min={0} onChange={setHarnessCurrentA} />
            <NumberField label="System voltage (V)" value={harnessVoltageV} min={0} onChange={setHarnessVoltageV} />
            <NumberField label="Loaded conductors" value={harnessConductors} min={1} step={1} onChange={setHarnessConductors} />
            <NumberField label="Ambient (°C)" value={harnessAmbientC} onChange={setHarnessAmbientC} />
          </div>
          {harness.ok ? (
            <div className="space-y-1">
              <Row label="Loop resistance" value={formatEng(harness.value.result.resistanceOhms, 'Ω')} />
              <Row label="Voltage drop" value={`${harness.value.result.voltageDropV.toFixed(3)} V (${harness.value.result.voltageDropPercent.toFixed(2)}%)`} tone={harness.value.result.voltageDropPercent > 3 ? 'warn' : undefined} />
              <Row label="Copper loss" value={`${harness.value.result.powerLossW.toFixed(3)} W`} />
              <Row
                label="Ampacity"
                value={harness.value.result.isAmpacityExceeded ? 'Exceeds bundle rating' : 'Within bundle rating'}
                tone={harness.value.result.isAmpacityExceeded ? 'bad' : 'ok'}
              />
              <Row
                label="Recommended gauge (≤3% drop)"
                value={`AWG ${harness.value.recommendation.recommendedAwg}`}
                tone={harness.value.recommendation.result.isAmpacityExceeded ? 'bad' : 'ok'}
              />
              <button
                type="button"
                className="text-xs font-medium text-primary underline underline-offset-2"
                onClick={() => setHarnessAwg(harness.value.recommendation.recommendedAwg)}
              >
                Apply recommended gauge
              </button>
            </div>
          ) : (
            <ErrorLine error={harness.error} />
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-md border border-border p-2 text-xs">
              <div className="text-muted-foreground">IPC/WHMA-A-620 minimum crimp pull</div>
              {crimp.ok ? (
                <div className="mt-1 font-medium">{crimp.value.toFixed(1)} N</div>
              ) : (
                <div className="mt-1 text-muted-foreground">{crimp.error}</div>
              )}
            </div>
            <div className="rounded-md border border-border p-2 text-xs">
              <SelectField label="Heat shrink" value={String(heatShrinkIndex)} onChange={(next) => setHeatShrinkIndex(Number(next))}>
                {HEAT_SHRINK_TUBING.map((spec, index) => (
                  <option key={spec.nominalSizeInch} value={index}>
                    {spec.nominalSizeInch} {spec.shrinkRatio}
                  </option>
                ))}
              </SelectField>
              <div className="mt-1 text-muted-foreground">
                {heatShrink.expandedDiameterMm} → {heatShrink.recoveredDiameterMm} mm, wall {heatShrink.recoveredWallMm} mm
                {heatShrink.hasAdhesiveLining ? ', adhesive lined' : ''}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 pt-3 px-3">
          <CardTitle className="text-xs">Thermal interface, mounting & protection</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 px-3 pb-3 md:grid-cols-2">
          <div className="space-y-2 rounded-md border border-border p-2">
            <SelectField
              label="Thermal interface material"
              value={timId}
              onChange={(next) => {
                setTimId(next)
                const entry = TIM_LIBRARY.find((item) => item.id === next)
                if (entry) setTimThicknessMm(entry.typicalThicknessMm)
              }}
            >
              {TIM_LIBRARY.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name} — {entry.conductivityWmk} W/m·K
                </option>
              ))}
            </SelectField>
            <div className="grid grid-cols-3 gap-2">
              <NumberField label="Thickness (mm)" value={timThicknessMm} min={0} onChange={setTimThicknessMm} />
              <NumberField label="Contact area (mm²)" value={timAreaMm2} min={0} onChange={setTimAreaMm2} />
              <NumberField label="Dissipation (W)" value={timPowerW} min={0} onChange={setTimPowerW} />
            </div>
            {thermal.ok ? (
              <div className="space-y-1">
                <Row label="Interface resistance" value={`${thermal.value.resistanceKw.toFixed(3)} K/W`} />
                <Row label="Rise across interface" value={`${thermal.value.riseC.toFixed(2)} °C`} />
                {tim.dielectricStrengthKvMm === 0 && (
                  <Row label="Electrical" value="Conductive TIM — isolate if needed" tone="warn" />
                )}
              </div>
            ) : (
              <ErrorLine error={thermal.error} />
            )}
            <div className="text-[11px] text-muted-foreground">
              Interface resistance only; spreading, heatsink and convection paths are not included.
            </div>
          </div>

          <div className="space-y-2 rounded-md border border-border p-2">
            <SelectField label="Standoff" value={standoffId} onChange={setStandoffId}>
              {STANDARD_STANDOFFS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.thread} {entry.gender} {entry.material} {entry.bodyLengthMm} mm
                </option>
              ))}
            </SelectField>
            <div className="space-y-1">
              <Row label="Recommended hole" value={`Ø${standoff.recommendedHoleDiameterMm} mm`} />
              <Row label="Keep-out diameter" value={`Ø${standoff.keepoutDiameterMm} mm`} />
              <Row label="Annular ring" value={`Ø${standoff.recommendedAnnularRingMm} mm`} />
              <Row label="Max torque" value={`${standoff.maxTorqueNm.toFixed(2)} N·m`} />
            </div>
            <SelectField label="Conformal coating" value={coatingType} onChange={(next) => setCoatingType(next as CoatingType)}>
              {(Object.keys(CONFORMAL_COATINGS) as CoatingType[]).map((type) => (
                <option key={type} value={type}>
                  {type} — {CONFORMAL_COATINGS[type].name}
                </option>
              ))}
            </SelectField>
            <div className="space-y-1">
              <Row label="Standard" value={coating.ipcStandard} />
              <Row label="Thickness" value={`${coating.typicalThicknessUm[0]}–${coating.typicalThicknessUm[1]} µm`} />
              <Row label="Dielectric strength" value={`${coating.dielectricStrengthVmil} V/mil`} />
              <Row label="Reworkability" value={coating.reworkability} />
            </div>
            <SelectField label="Potting compound" value={pottingId} onChange={setPottingId}>
              {POTTING_COMPOUNDS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </SelectField>
            <div className="space-y-1">
              <Row label="Hardness" value={potting.shoreHardness} />
              <Row label="Cure at 25 °C" value={`${potting.cureTimeHoursAt25C} h`} />
              <Row label="Water absorption" value={`${potting.waterAbsorptionPercent}%`} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 pt-3 px-3">
          <CardTitle className="text-xs">Reflow profile validation (J-STD-020)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 px-3 pb-3">
          <SelectField label="Alloy" value={reflowAlloy} onChange={setReflowAlloy}>
            {Object.entries(REFLOW_PROFILES).map(([id, profile]) => (
              <option key={id} value={id}>
                {profile.name}
              </option>
            ))}
          </SelectField>
          <label className="block text-xs">
            <span className="text-muted-foreground">Measured oven trace (time s, temperature °C — one pair per line)</span>
            <textarea
              value={reflowText}
              onChange={(event) => setReflowText(event.target.value)}
              aria-label="Measured reflow profile samples"
              className="mt-1 h-28 w-full rounded-md border border-input bg-background p-2 font-mono text-xs"
              spellCheck={false}
              placeholder={'Paste the trace your oven or profiler logged, e.g.\n0,25\n30,100\n…'}
            />
          </label>
          <div className="space-y-1">
            <Row label="Liquidus" value={`${reflowProfile.liquidusTempC} °C`} />
            <Row label="Peak window" value={`${reflowProfile.peakTempC[0]}–${reflowProfile.peakTempC[1]} °C`} />
            <Row label="Time above liquidus" value={`${reflowProfile.timeAboveLiquidusSec[0]}–${reflowProfile.timeAboveLiquidusSec[1]} s`} />
            <Row label="Max ramp" value={`${reflowProfile.maxRampUpRateCPerSec} °C/s up, ${reflowProfile.maxRampDownRateCPerSec} °C/s down`} />
          </div>
          {reflowText.trim() === '' ? (
            <div className="rounded-md border border-border bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
              Paste a measured trace to get a J-STD-020 verdict — no data means no verdict.
            </div>
          ) : reflow.ok ? (
            <div className="space-y-1">
              <Badge className={reflow.value.valid ? 'bg-success text-success-foreground' : 'bg-destructive text-destructive-foreground'}>
                {reflow.value.valid ? 'Profile inside JEDEC window' : `${reflow.value.violations.length} violation(s)`}
              </Badge>
              {reflow.value.violations.map((violation, index) => (
                <Row
                  key={`${violation.stage}-${violation.parameter}-${index}`}
                  label={`${violation.stage} · ${violation.parameter}`}
                  value={`${violation.measured} — expected ${violation.expected}`}
                  tone="bad"
                />
              ))}
            </div>
          ) : (
            <ErrorLine error={reflow.error} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
