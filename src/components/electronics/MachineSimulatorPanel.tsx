/**
 * Electric-machine simulator: brushed DC motor/generator, BLDC/PMSM and
 * stepper. All results come from `src/lib/electronics/machineDynamics`; the
 * panel only edits operating points and plots the returned states.
 */
import { useMemo, useState } from 'react'
import { useDemoRequest } from '../workspace/useDemoRequest'
import { X, AlertCircle, Gauge } from 'lucide-react'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Input } from '../ui/input'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  BLDC_PRESETS,
  DC_MACHINE_PRESETS,
  STEPPER_PRESETS,
  bldcSteadyState,
  dcMachineSteadyState,
  simulateBldc,
  simulateDcMachine,
  simulateStepper,
} from '../../lib/electronics/machineDynamics'
import { describeError } from '../../lib/utils'

interface MachineSimulatorPanelProps {
  onClose: () => void
}

type Family = 'dc-motor' | 'dc-generator' | 'bldc' | 'stepper'

const FAMILIES: Array<{ id: Family; label: string }> = [
  { id: 'dc-motor', label: 'DC motor' },
  { id: 'dc-generator', label: 'DC generator' },
  { id: 'bldc', label: 'BLDC / PMSM' },
  { id: 'stepper', label: 'Stepper' },
]

function thin<T>(items: readonly T[], limit = 700): T[] {
  if (items.length <= limit) return [...items]
  const stride = Math.ceil(items.length / limit)
  const out = items.filter((_, index) => index % stride === 0)
  const last = items[items.length - 1]
  if (out[out.length - 1] !== last) out.push(last)
  return out
}

function format(value: number, digits = 2, unit = ''): string {
  if (!Number.isFinite(value)) return '—'
  if (value !== 0 && (Math.abs(value) >= 1e5 || Math.abs(value) < 1e-3)) {
    return `${value.toExponential(2)}${unit}`
  }
  return `${value.toFixed(digits)}${unit}`
}

export default function MachineSimulatorPanel({ onClose }: MachineSimulatorPanelProps) {
  const [family, setFamily] = useState<Family>('dc-motor')
  const [dcPresetId, setDcPresetId] = useState(DC_MACHINE_PRESETS[0].id)
  const [bldcPresetId, setBldcPresetId] = useState(BLDC_PRESETS[0].id)
  const [stepperPresetId, setStepperPresetId] = useState(STEPPER_PRESETS[0].id)
  const [voltage, setVoltage] = useState(12)
  const [loadTorque, setLoadTorque] = useState(0.05)
  const [loadResistance, setLoadResistance] = useState(10)
  const [busVoltage, setBusVoltage] = useState(24)
  const [modulation, setModulation] = useState(0.9)
  const [bldcLoad, setBldcLoad] = useState(0.02)
  const [stepRate, setStepRate] = useState(100)
  const [stepperLoad, setStepperLoad] = useState(0)
  const [duration, setDuration] = useState(1)
  const [dt, setDt] = useState(0.001)

  useDemoRequest('machines-bldc', () => setFamily('bldc'))
  useDemoRequest('machines-stepper', () => setFamily('stepper'))

  const dcPreset = DC_MACHINE_PRESETS.find((preset) => preset.id === dcPresetId) ?? DC_MACHINE_PRESETS[0]
  const bldcPreset = BLDC_PRESETS.find((preset) => preset.id === bldcPresetId) ?? BLDC_PRESETS[0]
  const stepperPreset = STEPPER_PRESETS.find((preset) => preset.id === stepperPresetId) ?? STEPPER_PRESETS[0]

  const result = useMemo(() => {
    try {
      if (family === 'dc-motor' || family === 'dc-generator') {
        const generator = family === 'dc-generator'
        const operating = {
          supplyVoltageV: generator ? 0 : voltage,
          loadTorqueNm: generator ? -Math.abs(loadTorque) : loadTorque,
          loadResistanceOhm: generator ? Math.max(loadResistance, 0) : 0,
        }
        const samples = simulateDcMachine(dcPreset.parameters, operating, {
          tEndSeconds: duration,
          dtSeconds: dt,
        })
        const steady = dcMachineSteadyState(dcPreset.parameters, operating)
        return {
          ok: true as const,
          kind: 'dc' as const,
          generator,
          preset: dcPreset,
          steady,
          final: samples[samples.length - 1],
          speedData: thin(samples).map((sample) => ({
            time: sample.timeSeconds,
            rpm: sample.speedRpm,
            current: sample.currentA,
          })),
          powerData: thin(samples).map((sample) => ({
            time: sample.timeSeconds,
            torque: sample.electromagneticTorqueNm,
            electrical: sample.electricalPowerW,
            mechanical: sample.mechanicalPowerW,
          })),
        }
      }

      if (family === 'bldc') {
        const operating = { dcBusVoltageV: busVoltage, modulationIndex: modulation, loadTorqueNm: bldcLoad }
        const samples = simulateBldc(bldcPreset.parameters, operating, {
          tEndSeconds: duration,
          dtSeconds: dt,
        })
        const steady = bldcSteadyState(bldcPreset.parameters, operating)
        return {
          ok: true as const,
          kind: 'bldc' as const,
          preset: bldcPreset,
          steady,
          final: samples[samples.length - 1],
          speedData: thin(samples).map((sample) => ({
            time: sample.timeSeconds,
            rpm: sample.speedRpm,
            id: sample.currentDA,
            iq: sample.currentQA,
          })),
          powerData: thin(samples).map((sample) => ({
            time: sample.timeSeconds,
            torque: sample.torqueNm,
            electrical: sample.electricalPowerW,
            mechanical: sample.mechanicalPowerW,
          })),
        }
      }

      const samples = simulateStepper(
        stepperPreset.parameters,
        { stepRateStepsPerSecond: stepRate, loadTorqueNm: stepperLoad },
        { tEndSeconds: duration, dtSeconds: dt },
      )
      const final = samples[samples.length - 1]
      const averageStepsPerSecond =
        final.timeSeconds > 0 ? final.angleRad / final.timeSeconds / stepperPreset.parameters.stepAngleRad : 0
      return {
        ok: true as const,
        kind: 'stepper' as const,
        preset: stepperPreset,
        final,
        averageStepsPerSecond,
        positionData: thin(samples).map((sample) => ({
          time: sample.timeSeconds,
          command: sample.commandAngleRad / stepperPreset.parameters.stepAngleRad,
          actual: sample.angleRad / stepperPreset.parameters.stepAngleRad,
          currentPct: sample.currentFraction * 100,
        })),
        speedData: thin(samples).map((sample) => ({
          time: sample.timeSeconds,
          rate: sample.speedStepsPerSecond,
          currentPct: sample.currentFraction * 100,
        })),
      }
    } catch (error) {
      return { ok: false as const, error: describeError(error) }
    }
  }, [
    family, dcPreset, bldcPreset, stepperPreset,
    voltage, loadTorque, loadResistance,
    busVoltage, modulation, bldcLoad,
    stepRate, stepperLoad, duration, dt,
  ])

  const presetList =
    family === 'bldc' ? BLDC_PRESETS : family === 'stepper' ? STEPPER_PRESETS : DC_MACHINE_PRESETS
  const presetId = family === 'bldc' ? bldcPresetId : family === 'stepper' ? stepperPresetId : dcPresetId
  const selectPreset = (id: string): void => {
    if (family === 'bldc') setBldcPresetId(id)
    else if (family === 'stepper') setStepperPresetId(id)
    else setDcPresetId(id)
  }

  return (
    <div className="h-full overflow-auto bg-background p-4">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Electric Machines</h2>
            <p className="text-sm text-muted-foreground">
              Dynamic simulation of brushed DC machines, BLDC/PMSM drives and steppers.
            </p>
          </div>
          <Button variant="ghost" size="icon" aria-label="Close machine simulator" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Machine and operating point</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-1">
                {FAMILIES.map((entry) => (
                  <Button
                    key={entry.id}
                    type="button"
                    size="sm"
                    variant={family === entry.id ? 'default' : 'outline'}
                    onClick={() => setFamily(entry.id)}
                  >
                    {entry.label}
                  </Button>
                ))}
              </div>

              <label className="block space-y-1 text-sm">
                <span className="font-medium">Machine</span>
                <select
                  value={presetId}
                  onChange={(event) => selectPreset(event.target.value)}
                  aria-label="Machine preset"
                  className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {presetList.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.name}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-muted-foreground">{presetList.find((preset) => preset.id === presetId)?.note}</span>
              </label>

              {(family === 'dc-motor' || family === 'dc-generator') && (
                <>
                  {family === 'dc-motor' ? (
                    <label className="block space-y-1 text-sm">
                      <span>Supply voltage (V)</span>
                      <Input type="number" step="0.5" value={voltage} onChange={(event) => setVoltage(Number(event.target.value))} aria-label="Supply voltage" />
                    </label>
                  ) : (
                    <label className="block space-y-1 text-sm">
                      <span>Load resistance (Ω)</span>
                      <Input type="number" step="0.5" min="0.1" value={loadResistance} onChange={(event) => setLoadResistance(Number(event.target.value))} aria-label="Generator load resistance" />
                    </label>
                  )}
                  <label className="block space-y-1 text-sm">
                    <span>{family === 'dc-motor' ? 'Load torque (N·m)' : 'Prime-mover torque (N·m)'}</span>
                    <Input type="number" step="0.01" value={loadTorque} onChange={(event) => setLoadTorque(Number(event.target.value))} aria-label="Load torque" />
                  </label>
                </>
              )}

              {family === 'bldc' && (
                <>
                  <label className="block space-y-1 text-sm">
                    <span>DC bus (V)</span>
                    <Input type="number" step="1" value={busVoltage} onChange={(event) => setBusVoltage(Number(event.target.value))} aria-label="DC bus voltage" />
                  </label>
                  <label className="block space-y-1 text-sm">
                    <span>Modulation index (0–1)</span>
                    <Input type="number" step="0.05" min="0" max="1" value={modulation} onChange={(event) => setModulation(Number(event.target.value))} aria-label="Modulation index" />
                  </label>
                  <label className="block space-y-1 text-sm">
                    <span>Load torque (N·m)</span>
                    <Input type="number" step="0.01" value={bldcLoad} onChange={(event) => setBldcLoad(Number(event.target.value))} aria-label="BLDC load torque" />
                  </label>
                </>
              )}

              {family === 'stepper' && (
                <>
                  <label className="block space-y-1 text-sm">
                    <span>Step rate (steps/s)</span>
                    <Input type="number" step="10" min="0" value={stepRate} onChange={(event) => setStepRate(Number(event.target.value))} aria-label="Step rate" />
                  </label>
                  <label className="block space-y-1 text-sm">
                    <span>Load torque (N·m)</span>
                    <Input type="number" step="0.01" value={stepperLoad} onChange={(event) => setStepperLoad(Number(event.target.value))} aria-label="Stepper load torque" />
                  </label>
                </>
              )}

              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1 text-sm">
                  <span>Run time (s)</span>
                  <Input type="number" step="0.1" min="0.01" value={duration} onChange={(event) => setDuration(Number(event.target.value))} aria-label="Machine run time" />
                </label>
                <label className="block space-y-1 text-sm">
                  <span>Output step (s)</span>
                  <Input type="number" step="0.0005" min="0.0001" value={dt} onChange={(event) => setDt(Number(event.target.value))} aria-label="Machine output step" />
                </label>
              </div>

              {family === 'dc-generator' && (
                <p className="text-xs text-muted-foreground">
                  Prime-mover torque is entered as a positive magnitude and applied opposite rotation.
                </p>
              )}
            </CardContent>
          </Card>

          <div className="space-y-4">
            {!result.ok ? (
              <Card>
                <CardContent className="flex items-start gap-2 p-4 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{result.error}</span>
                </CardContent>
              </Card>
            ) : result.kind === 'dc' ? (
              <>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Card>
                    <CardContent className="p-3">
                      <div className="text-xs text-muted-foreground">Steady speed</div>
                      <div className="text-lg font-semibold">{format(result.steady.speedRpm, 0, ' rpm')}</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-3">
                      <div className="text-xs text-muted-foreground">Current</div>
                      <div className="text-lg font-semibold">{format(result.steady.currentA, 2, ' A')}</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-3">
                      <div className="text-xs text-muted-foreground">Terminal voltage</div>
                      <div className="text-lg font-semibold">{format(result.steady.terminalVoltageV, 2, ' V')}</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-3">
                      <div className="text-xs text-muted-foreground">Efficiency</div>
                      <div className="text-lg font-semibold">{format(result.steady.efficiency * 100, 1, ' %')}</div>
                    </CardContent>
                  </Card>
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-base">Speed and current</CardTitle></CardHeader>
                    <CardContent>
                      <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={result.speedData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="time" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(value: number) => `${value.toFixed(2)} s`} />
                            <YAxis yAxisId="speed" tickFormatter={(value: number) => `${value.toFixed(0)}`} />
                            <YAxis yAxisId="current" orientation="right" tickFormatter={(value: number) => `${value.toFixed(1)}`} />
                            <Tooltip labelFormatter={(value: number) => `Time: ${value.toFixed(4)} s`} />
                            <Legend />
                            <Line yAxisId="speed" type="monotone" dataKey="rpm" name="Speed (rpm)" stroke="#2563eb" strokeWidth={2} dot={false} isAnimationActive={false} />
                            <Line yAxisId="current" type="monotone" dataKey="current" name="Current (A)" stroke="#dc2626" strokeWidth={2} dot={false} isAnimationActive={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-base">Torque and power</CardTitle></CardHeader>
                    <CardContent>
                      <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={result.powerData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="time" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(value: number) => `${value.toFixed(2)} s`} />
                            <YAxis tickFormatter={(value: number) => value.toFixed(1)} />
                            <Tooltip labelFormatter={(value: number) => `Time: ${value.toFixed(4)} s`} />
                            <Legend />
                            <Line type="monotone" dataKey="torque" name="Torque (N·m)" stroke="#7c3aed" strokeWidth={2} dot={false} isAnimationActive={false} />
                            <Line type="monotone" dataKey="electrical" name="Electrical (W)" stroke="#d97706" strokeWidth={2} dot={false} isAnimationActive={false} />
                            <Line type="monotone" dataKey="mechanical" name="Mechanical (W)" stroke="#059669" strokeWidth={2} dot={false} isAnimationActive={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </>
            ) : result.kind === 'bldc' ? (
              <>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Steady speed</div><div className="text-lg font-semibold">{format(result.steady.speedRpm, 0, ' rpm')}</div></CardContent></Card>
                  <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">q-axis current</div><div className="text-lg font-semibold">{format(result.final.currentQA, 2, ' A')}</div></CardContent></Card>
                  <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Torque</div><div className="text-lg font-semibold">{format(result.final.torqueNm, 3, ' N·m')}</div></CardContent></Card>
                  <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Efficiency</div><div className="text-lg font-semibold">{format(result.final.efficiency * 100, 1, ' %')}</div></CardContent></Card>
                </div>
                <div className="grid gap-4 xl:grid-cols-2">
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-base">Speed and dq currents</CardTitle></CardHeader>
                    <CardContent>
                      <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={result.speedData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="time" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(value: number) => `${value.toFixed(2)} s`} />
                            <YAxis tickFormatter={(value: number) => value.toFixed(0)} />
                            <Tooltip labelFormatter={(value: number) => `Time: ${value.toFixed(4)} s`} />
                            <Legend />
                            <Line type="monotone" dataKey="rpm" name="Speed (rpm)" stroke="#2563eb" strokeWidth={2} dot={false} isAnimationActive={false} />
                            <Line type="monotone" dataKey="id" name="id (A)" stroke="#7c3aed" strokeWidth={2} dot={false} isAnimationActive={false} />
                            <Line type="monotone" dataKey="iq" name="iq (A)" stroke="#dc2626" strokeWidth={2} dot={false} isAnimationActive={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-base">Torque and power</CardTitle></CardHeader>
                    <CardContent>
                      <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={result.powerData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="time" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(value: number) => `${value.toFixed(2)} s`} />
                            <YAxis tickFormatter={(value: number) => value.toFixed(2)} />
                            <Tooltip labelFormatter={(value: number) => `Time: ${value.toFixed(4)} s`} />
                            <Legend />
                            <Line type="monotone" dataKey="torque" name="Torque (N·m)" stroke="#7c3aed" strokeWidth={2} dot={false} isAnimationActive={false} />
                            <Line type="monotone" dataKey="electrical" name="Electrical (W)" stroke="#d97706" strokeWidth={2} dot={false} isAnimationActive={false} />
                            <Line type="monotone" dataKey="mechanical" name="Mechanical (W)" stroke="#059669" strokeWidth={2} dot={false} isAnimationActive={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Average rate</div><div className="text-lg font-semibold">{format(result.averageStepsPerSecond, 1, ' steps/s')}</div></CardContent></Card>
                  <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Position error</div><div className="text-lg font-semibold">{format(result.final.positionErrorRad / result.preset.parameters.stepAngleRad, 2, ' steps')}</div></CardContent></Card>
                  <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Phase current</div><div className="text-lg font-semibold">{format(result.final.currentFraction * 100, 1, ' %')}</div></CardContent></Card>
                  <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Torque</div><div className="text-lg font-semibold">{format(result.final.torqueNm, 3, ' N·m')}</div></CardContent></Card>
                </div>
                <div className="grid gap-4 xl:grid-cols-2">
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-base">Command and rotor position</CardTitle></CardHeader>
                    <CardContent>
                      <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={result.positionData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="time" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(value: number) => `${value.toFixed(2)} s`} />
                            <YAxis tickFormatter={(value: number) => value.toFixed(0)} />
                            <Tooltip labelFormatter={(value: number) => `Time: ${value.toFixed(4)} s`} />
                            <Legend />
                            <Line type="monotone" dataKey="command" name="Command (steps)" stroke="#94a3b8" strokeWidth={2} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
                            <Line type="monotone" dataKey="actual" name="Rotor (steps)" stroke="#2563eb" strokeWidth={2} dot={false} isAnimationActive={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-base">Speed and phase current</CardTitle></CardHeader>
                    <CardContent>
                      <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={result.speedData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="time" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(value: number) => `${value.toFixed(2)} s`} />
                            <YAxis yAxisId="rate" tickFormatter={(value: number) => value.toFixed(0)} />
                            <YAxis yAxisId="current" orientation="right" tickFormatter={(value: number) => `${value.toFixed(0)}%`} />
                            <Tooltip labelFormatter={(value: number) => `Time: ${value.toFixed(4)} s`} />
                            <Legend />
                            <Line yAxisId="rate" type="monotone" dataKey="rate" name="Speed (steps/s)" stroke="#2563eb" strokeWidth={2} dot={false} isAnimationActive={false} />
                            <Line yAxisId="current" type="monotone" dataKey="currentPct" name="Current (%)" stroke="#dc2626" strokeWidth={2} dot={false} isAnimationActive={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </>
            )}
          </div>
        </div>

        <Card>
          <CardContent className="flex items-start gap-2 p-4 text-xs text-muted-foreground">
            <Gauge className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Lumped-parameter models: brushed DC includes R/L, back-EMF, inertia and friction;
              BLDC assumes surface magnets and an ideal field-oriented inverter with no switching
              ripple; the stepper uses sinusoidal holding torque with first-order current lag and
              lumped damping. Magnetic saturation, thermal drift, cogging harmonics and detailed
              power-electronics switching are not modelled. The DC machine is solved exactly
              (zero-order hold), so its result does not depend on the output step.
            </span>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
