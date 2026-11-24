'use client'

/**
 * Coupled cross-domain studies, for a person.
 *
 * `coupled.study` gives the agent a way to size a design against several kinds
 * of physics at once. This is the same engine, rendered: pick a scenario, state
 * the duty, and read the optimum alongside what a single-discipline study would
 * have chosen.
 *
 * The comparison is the point. A study that printed only the coupled answer
 * would look like any other calculator; showing both is what makes the coupling
 * legible — you can see the mass you are paying to stay inside the thermal limit.
 */
import { useCallback, useState } from 'react'
import { Calculator, Play } from 'lucide-react'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { COUPLED_SCENARIOS, COUPLED_SCENARIO_LABELS, type CoupledScenario } from '../../lib/optimization/scenarios'
import { sizeCoupledHeatsink, type HeatsinkRequest } from '../../lib/optimization/coupledHeatsink'
import { sizeCoupledConductor, type ConductorRequest } from '../../lib/optimization/coupledConductor'
import { sizeCoupledBeam, type BeamRequest } from '../../lib/optimization/coupledBeam'

interface ConductorSummary {
  widthMm: number
  thicknessMm: number
  massKg: number
  temperatureRiseK: number
  massOnlyRiseK: number
  massPenaltyKg: number
  binding: string | null
  feasible: boolean
}

interface HeatsinkSummary {
  finCount: number
  finEfficiency: number
  massKg: number
  cost: number
  temperatureRiseK: number
  massOnlyRiseK: number
  massPenaltyKg: number
  binding: string | null
  feasible: boolean
}

type Summary = { scenario: 'conductor'; data: ConductorSummary }
  | { scenario: 'heatsink'; data: HeatsinkSummary }
  | { scenario: 'beam'; data: BeamSummary }

interface BeamSummary {
  widthMm: number
  depthMm: number
  massKg: number
  totalStressMPa: number
  thermalStressMPa: number
  deflectionMm: number
  coldMassKg: number
  binding: string | null
  feasible: boolean
}

const CONDUCTOR_DEFAULTS = {
  currentA: 30,
  lengthM: 0.1,
  maxRiseK: 30,
  minSecondMomentM4: 1e-12,
}

const HEATSINK_DEFAULTS = {
  powerW: 5,
  maxRiseK: 40,
  baseLengthM: 0.04,
  baseWidthM: 0.04,
  maxMassKg: 0.2,
}

const BEAM_DEFAULTS = {
  loadN: 500,
  spanM: 1,
  deltaT: 30,
  maxDeflectionM: 0.005,
}

const fmt = (value: number, digits = 3): string => value.toFixed(digits)

/** One numeric field, labelled and bounded. */
function NumberField({
  id, label, value, onChange, min, step = 'any', suffix,
}: {
  id: string
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  step?: string
  suffix?: string
}) {
  return (
    <div>
      <label htmlFor={id} className="text-xs font-medium text-foreground">
        {label}
      </label>
      <div className="flex items-center gap-1">
        <input
          id={id}
          type="number"
          min={min}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground"
        />
        {suffix && <span className="text-[11px] text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  )
}

export default function CoupledStudyPanel() {
  const [scenario, setScenario] = useState<CoupledScenario>('heatsink')
  const [busy, setBusy] = useState(false)
  const [error, setFailed] = useState<string | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)

  const [conductor, setConductor] = useState(CONDUCTOR_DEFAULTS)
  const [heatsink, setHeatsink] = useState(HEATSINK_DEFAULTS)
  const [beam, setBeam] = useState(BEAM_DEFAULTS)

  const run = useCallback(async () => {
    setBusy(true)
    setFailed(null)
    setSummary(null)
    try {
      if (scenario === 'beam') {
        const request: BeamRequest = {
          loadN: beam.loadN,
          spanM: beam.spanM,
          temperatureChangeK: beam.deltaT,
          maxDeflectionM: beam.maxDeflectionM,
          width: { min: 0.01, max: 0.1 },
          depth: { min: 0.01, max: 0.15 },
          material: {
            name: 'S275 structural steel',
            youngsModulusPa: 210e9,
            thermalExpansionPerK: 12e-6,
            densityKgM3: 7850,
            allowableStressPa: 275e6 / 1.5,
          },
          populationSize: 20,
          iterations: 40,
        }
        const result = await sizeCoupledBeam(request)
        const cold = await sizeCoupledBeam({ ...request, temperatureChangeK: 0 })
        setSummary({
          scenario: 'beam',
          data: {
            widthMm: result.widthM * 1000,
            depthMm: result.depthM * 1000,
            massKg: result.massKg,
            totalStressMPa: result.totalStressPa / 1e6,
            thermalStressMPa: result.thermalStressPa / 1e6,
            deflectionMm: result.deflectionM * 1000,
            coldMassKg: cold.massKg,
            binding: result.binding[0]?.name ?? null,
            feasible: result.feasible,
          },
        })
      } else if (scenario === 'heatsink') {
        const request: HeatsinkRequest = {
          powerW: heatsink.powerW,
          maxTemperatureRiseK: heatsink.maxRiseK,
          surfaceCoefficientWm2K: 10,
          baseLengthM: heatsink.baseLengthM,
          baseWidthM: heatsink.baseWidthM,
          baseThickness: { min: 0.002, max: 0.006 },
          finHeight: { min: 0.005, max: 0.03 },
          finThickness: { min: 0.0008, max: 0.003 },
          finCount: { min: 2, max: 20 },
          maxMassKg: heatsink.maxMassKg,
          material: { name: 'Aluminium 6063', conductivityWmK: 205, densityKgM3: 2700, costPerKg: 8 },
          populationSize: 20,
          iterations: 40,
        }
        const result = await sizeCoupledHeatsink(request)
        const massOnly = await sizeCoupledHeatsink({ ...request, maxTemperatureRiseK: 1e6 })
        setSummary({
          scenario: 'heatsink',
          data: {
            finCount: result.finCount,
            finEfficiency: result.finEfficiency,
            massKg: result.massKg,
            cost: result.cost,
            temperatureRiseK: result.temperatureRiseK,
            massOnlyRiseK: massOnly.temperatureRiseK,
            massPenaltyKg: result.massKg - massOnly.massKg,
            binding: result.binding[0]?.name ?? null,
            feasible: result.feasible,
          },
        })
      } else {
        const request: ConductorRequest = {
          lengthM: conductor.lengthM,
          currentA: conductor.currentA,
          ambientC: 25,
          maxTemperatureRiseK: conductor.maxRiseK,
          surfaceCoefficientWm2K: 10,
          minSecondMomentM4: conductor.minSecondMomentM4,
          material: { resistivityOhmM: 1.68e-8, densityKgM3: 8960, tempCoeffPerK: 0.00393, referenceTempC: 20 },
          width: { min: 0.002, max: 0.02 },
          thickness: { min: 0.0005, max: 0.005 },
          populationSize: 20,
          iterations: 40,
        }
        const result = await sizeCoupledConductor(request)
        const massOnly = await sizeCoupledConductor({ ...request, maxTemperatureRiseK: 1e6 })
        setSummary({
          scenario: 'conductor',
          data: {
            widthMm: result.widthM * 1000,
            thicknessMm: result.thicknessM * 1000,
            massKg: result.massKg,
            temperatureRiseK: result.temperatureRiseK,
            massOnlyRiseK: massOnly.temperatureRiseK,
            massPenaltyKg: result.massKg - massOnly.massKg,
            binding: result.binding[0]?.name ?? null,
            feasible: result.feasible,
          },
        })
      }
    } catch (cause) {
      setFailed(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [scenario, conductor, heatsink, beam])

  return (
    <Card>
      <CardHeader className="pb-2 pt-3 px-3">
        <CardTitle className="text-xs flex items-center gap-1">
          <Calculator className="h-3 w-3" aria-hidden="true" /> Coupled study
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 space-y-3">
        <p className="text-xs text-muted-foreground">
          Sizes a design against several kinds of physics at once, and shows what a
          single-discipline study would have chosen for comparison.
        </p>

        <div>
          <label htmlFor="coupled-scenario" className="text-xs font-medium text-foreground">
            Scenario
          </label>
          <select
            id="coupled-scenario"
            value={scenario}
            onChange={(event) => {
              setScenario(event.target.value as CoupledScenario)
              setSummary(null)
            }}
            className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground"
          >
            {COUPLED_SCENARIOS.map((entry) => (
              <option key={entry} value={entry}>{COUPLED_SCENARIO_LABELS[entry]}</option>
            ))}
          </select>
        </div>

        {scenario === 'heatsink' ? (
          <div className="grid grid-cols-2 gap-2">
            <NumberField id="hs-power" label="Power" value={heatsink.powerW} suffix="W" min={0.1}
              onChange={(value) => setHeatsink({ ...heatsink, powerW: value })} />
            <NumberField id="hs-rise" label="Max rise" value={heatsink.maxRiseK} suffix="K" min={0.1}
              onChange={(value) => setHeatsink({ ...heatsink, maxRiseK: value })} />
            <NumberField id="hs-mass" label="Mass ceiling" value={heatsink.maxMassKg} suffix="kg" min={0.001}
              onChange={(value) => setHeatsink({ ...heatsink, maxMassKg: value })} />
          </div>
        ) : scenario === 'beam' ? (
          <div className="grid grid-cols-2 gap-2">
            <NumberField id="bm-load" label="Load" value={beam.loadN} suffix="N" min={0.1}
              onChange={(value) => setBeam({ ...beam, loadN: value })} />
            <NumberField id="bm-span" label="Span" value={beam.spanM} suffix="m" min={0.01}
              onChange={(value) => setBeam({ ...beam, spanM: value })} />
            <NumberField id="bm-dt" label="Temp change" value={beam.deltaT} suffix="K"
              onChange={(value) => setBeam({ ...beam, deltaT: value })} />
            <NumberField id="bm-defl" label="Max deflection" value={beam.maxDeflectionM} suffix="m" min={0.0001}
              onChange={(value) => setBeam({ ...beam, maxDeflectionM: value })} />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <NumberField id="cd-current" label="Current" value={conductor.currentA} suffix="A" min={0.01}
              onChange={(value) => setConductor({ ...conductor, currentA: value })} />
            <NumberField id="cd-length" label="Length" value={conductor.lengthM} suffix="m" min={0.001}
              onChange={(value) => setConductor({ ...conductor, lengthM: value })} />
            <NumberField id="cd-rise" label="Max rise" value={conductor.maxRiseK} suffix="K" min={0.1}
              onChange={(value) => setConductor({ ...conductor, maxRiseK: value })} />
          </div>
        )}

        <Button size="sm" className="h-7 text-xs" onClick={() => void run()} disabled={busy}>
          <Play className="mr-1 h-3 w-3" aria-hidden="true" />
          {busy ? 'Solving…' : 'Run study'}
        </Button>

        {error && (
          <p role="alert" className="rounded border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            {error}
          </p>
        )}

        {summary && (
          <div className="space-y-1.5 rounded border border-border bg-muted/30 p-2 text-xs">
            <p className="font-medium text-foreground">
              {summary.data.feasible ? 'Feasible optimum' : 'No feasible design within these limits'}
            </p>
            {summary.scenario === 'heatsink' ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
                <dt className="text-muted-foreground">Fins</dt>
                <dd className="tabular-nums">{summary.data.finCount}</dd>
                <dt className="text-muted-foreground">Fin efficiency</dt>
                <dd className="tabular-nums">{(summary.data.finEfficiency * 100).toFixed(1)}%</dd>
                <dt className="text-muted-foreground">Rise</dt>
                <dd className="tabular-nums">{fmt(summary.data.temperatureRiseK, 2)} K</dd>
                <dt className="text-muted-foreground">Mass</dt>
                <dd className="tabular-nums">{fmt(summary.data.massKg * 1000, 1)} g</dd>
                <dt className="text-muted-foreground">Cost</dt>
                <dd className="tabular-nums">{summary.data.cost.toFixed(2)}</dd>
                <dt className="text-muted-foreground">Mass-only rise</dt>
        <dd className="tabular-nums">{fmt(summary.data.massOnlyRiseK, 2)} K</dd>
              </dl>
            ) : summary.scenario === 'beam' ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
                <dt className="text-muted-foreground">Section</dt>
                <dd className="tabular-nums">{fmt(summary.data.widthMm, 1)} × {fmt(summary.data.depthMm, 1)} mm</dd>
                <dt className="text-muted-foreground">Total stress</dt>
                <dd className="tabular-nums">{fmt(summary.data.totalStressMPa, 2)} MPa</dd>
                <dt className="text-muted-foreground">Thermal share</dt>
                <dd className="tabular-nums">{fmt(summary.data.thermalStressMPa, 2)} MPa</dd>
                <dt className="text-muted-foreground">Deflection</dt>
                <dd className="tabular-nums">{fmt(summary.data.deflectionMm, 3)} mm</dd>
                <dt className="text-muted-foreground">Mass</dt>
                <dd className="tabular-nums">{fmt(summary.data.massKg * 1000, 1)} g</dd>
                <dt className="text-muted-foreground">Cold-state mass</dt>
                <dd className="tabular-nums">{fmt(summary.data.coldMassKg * 1000, 1)} g</dd>
              </dl>
            ) : (
              <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
                <dt className="text-muted-foreground">Section</dt>
                <dd className="tabular-nums">
                  {fmt(summary.data.widthMm, 2)} × {fmt(summary.data.thicknessMm, 3)} mm
                </dd>
                <dt className="text-muted-foreground">Rise</dt>
                <dd className="tabular-nums">{fmt(summary.data.temperatureRiseK, 2)} K</dd>
                <dt className="text-muted-foreground">Mass</dt>
                <dd className="tabular-nums">{fmt(summary.data.massKg * 1000, 2)} g</dd>
                <dt className="text-muted-foreground">Mass-only rise</dt>
                <dd className="tabular-nums">{fmt(summary.data.massOnlyRiseK, 2)} K</dd>
              </dl>
            )}
            {summary.data.binding && (
              <p className="text-muted-foreground">{`Set by: ${summary.data.binding}`}</p>
            )}
            <p className="text-muted-foreground">
              {summary.scenario === 'beam'
                ? `The thermal load adds ${(summary.data.massKg - summary.data.coldMassKg).toFixed(3)} kg over sizing it cold.`
                : `Coupling costs ${(summary.data.massPenaltyKg * 1000).toFixed(2)} g over sizing on mass alone.`}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}