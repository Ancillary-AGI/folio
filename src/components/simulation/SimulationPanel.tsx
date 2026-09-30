import { useState, useEffect, useMemo } from 'react'
import { Play, Download, Zap, BarChart3, X, AlertCircle, Info } from 'lucide-react'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { spiceEngine, SimulationParameters, SimulationResult } from '../../lib/simulation/spiceEngine'
import { buildCircuitNetlist } from '../../lib/simulation/netlistBuilder'
import { useProjectStore } from '../../stores/useProjectStore'
import { useTheme } from '../../lib/theme/useTheme'
import { chartSeriesColors } from '../../lib/theme/tokens'
import { describeError } from '../../lib/utils'

interface SimulationPanelProps {
  onClose: () => void
}

/** Analyses the solver actually implements, in menu order. */
const ANALYSIS_TYPES = ['dc', 'transient', 'ac', 'noise', 'montecarlo'] as const
type AnalysisType = (typeof ANALYSIS_TYPES)[number]

const ANALYSIS_LABELS: Record<AnalysisType, string> = {
  dc: 'DC operating point',
  transient: 'Transient',
  ac: 'AC sweep',
  noise: 'Noise',
  montecarlo: 'Monte Carlo',
}

const ANALYSIS_SUMMARY: Record<AnalysisType, string> = {
  dc: 'Solves the bias point by modified nodal analysis. Capacitors are open, inductors are shorts, and diodes are linearised by Newton iteration.',
  transient: 'Integrates capacitors and inductors with backward-Euler companion models — unconditionally stable, and it will not ring on an ideal step.',
  ac: 'Sweeps the complex small-signal network, linearising diodes at the DC operating point so the response belongs to the bias you designed.',
  noise: 'Output-referred thermal and shot noise via the adjoint (transposed) network method, with an integrated RMS figure.',
  montecarlo: 'Re-solves the bias with R/C/L perturbed inside a tolerance band, reporting the mean and the ±3σ envelope. Seeded, so a sweep is reproducible.',
}

export default function SimulationPanel({ onClose }: SimulationPanelProps) {
  const [isSimulating, setIsSimulating] = useState(false)
  const [simulationResults, setSimulationResults] = useState<SimulationResult | null>(null)
  const [selectedAnalysis, setSelectedAnalysis] = useState<AnalysisType>('dc')
  const [error, setError] = useState<string | null>(null)
  const [parameters, setParameters] = useState<SimulationParameters>({ type: 'dc' })
  const [selectedWaveforms, setSelectedWaveforms] = useState<string[]>([])

  const { components, wires, addSimulationRun } = useProjectStore()
  const { theme } = useTheme()
  const seriesColors = useMemo(() => chartSeriesColors(theme), [theme])

  useEffect(() => {
    setParameters((previous) => ({ ...previous, type: selectedAnalysis }))
  }, [selectedAnalysis])

  const handleRunSimulation = async () => {
    setIsSimulating(true)
    setError(null)

    try {
      const netlist = buildCircuitNetlist('Circuit Simulation', components, wires, parameters)
      const result = await spiceEngine.simulate(netlist)
      setSimulationResults(result)
      setSelectedWaveforms(result.waveforms.length > 0 ? [result.waveforms[0].name] : [])
      // Persist the run into the design so it survives save/load and VCS commits.
      addSimulationRun({
        name: `${ANALYSIS_LABELS[selectedAnalysis]} — ${new Date().toLocaleString()}`,
        type: selectedAnalysis,
        parameters: parameters as unknown as Record<string, unknown>,
        results: result as unknown as Record<string, unknown>,
        status: 'completed',
      })
    } catch (thrown) {
      // Building the netlist can fail (conflicting net names). Report it here
      // rather than in an `alert`, so it stays attached to the panel.
      setError(describeError(thrown))
      setSimulationResults(null)
    } finally {
      setIsSimulating(false)
    }
  }

  const handleParameterChange = (key: keyof SimulationParameters, value: string | number | boolean) => {
    setParameters((previous) => ({ ...previous, [key]: value }))
  }
  
  const handleExportResults = () => {
    if (!simulationResults) return
    
    const data = {
      timestamp: new Date().toISOString(),
      parameters,
      results: simulationResults
    }
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `simulation_results_${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }
  
  const getWaveformData = () => {
    if (!simulationResults?.waveforms) return []
    
    const selectedWaveformData = simulationResults.waveforms.filter(wf =>
      selectedWaveforms.includes(wf.name)
    )
    
    if (selectedWaveformData.length === 0) return []
    
    // Combine all selected waveforms into a single dataset
    const maxLength = Math.max(...selectedWaveformData.map(wf => wf.data.length))
    
    return Array.from({ length: maxLength }, (_, i) => {
      const point: Record<string, number> = {}
      
      selectedWaveformData.forEach(waveform => {
        if (i < waveform.data.length) {
          if (!point.x) point.x = waveform.data[i].x
          point[waveform.name] = waveform.data[i].y
        }
      })
      
      return point
    })
  }
  
  const getWaveformColors = () => {
    return selectedWaveforms.reduce<Record<string, string>>((acc, name, index) => {
      acc[name] = seriesColors[index % seriesColors.length]
      return acc
    }, {})
  }
  
  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-success" />
          Circuit Simulation
        </CardTitle>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="w-4 h-4" />
        </Button>
      </CardHeader>
      
      <CardContent className="flex-1 flex flex-col space-y-4 overflow-y-auto scrollbar-thin">
        {/* Analysis Type Selection */}
        <div>
          <span className="text-sm font-medium mb-2 block">Analysis type</span>
          <div className="flex flex-wrap gap-2">
            {ANALYSIS_TYPES.map((type) => (
              <Button
                key={type}
                variant={selectedAnalysis === type ? 'default' : 'outline'}
                size="sm"
                disabled={isSimulating}
                onClick={() => setSelectedAnalysis(type)}
              >
                {ANALYSIS_LABELS[type]}
              </Button>
            ))}
          </div>
          <p className="mt-2 flex gap-2 text-xs leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {ANALYSIS_SUMMARY[selectedAnalysis]}
          </p>
        </div>

        {/* Parameters */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="sim-temperature" className="text-sm font-medium mb-1 block">
              Temperature (°C)
            </label>
            <input
              id="sim-temperature"
              type="number"
              value={parameters.temperature ?? 27}
              onChange={(event) => handleParameterChange('temperature', Number(event.target.value))}
              className="w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground"
            />
          </div>

          {selectedAnalysis === 'transient' && (
            <>
              <div>
                <label htmlFor="sim-stop" className="text-sm font-medium mb-1 block">
                  Stop time (s)
                </label>
                <input
                  id="sim-stop"
                  type="number"
                  value={parameters.stopTime ?? 1e-3}
                  onChange={(event) => handleParameterChange('stopTime', Number(event.target.value))}
                  className="w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground"
                  step="0.000001"
                  min="0"
                />
              </div>
              <div>
                <label htmlFor="sim-step" className="text-sm font-medium mb-1 block">
                  Max step (s)
                </label>
                <input
                  id="sim-step"
                  type="number"
                  value={parameters.stepTime ?? 1e-6}
                  onChange={(event) => handleParameterChange('stepTime', Number(event.target.value))}
                  className="w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground"
                  step="0.0000001"
                  min="0"
                />
              </div>
              <label className="col-span-2 flex items-center justify-between gap-3 rounded-md border border-border p-2">
                <span className="text-sm text-card-foreground">
                  Start from zero stored energy
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    Off: begin at the DC operating point (SPICE default). On: watch capacitors charge.
                  </span>
                </span>
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[hsl(var(--primary))]"
                  checked={parameters.useInitialConditions ?? false}
                  onChange={(event) => handleParameterChange('useInitialConditions', event.target.checked)}
                />
              </label>
            </>
          )}
        </div>

        {/* Frequency-domain and tolerance controls */}
        {(selectedAnalysis === 'ac' || selectedAnalysis === 'noise' || selectedAnalysis === 'montecarlo') && (
          <div className="grid grid-cols-2 gap-3">
            {(selectedAnalysis === 'ac' || selectedAnalysis === 'noise') && (
              <>
                <div>
                  <label htmlFor="sim-fstart" className="text-sm font-medium mb-1 block">
                    Start frequency (Hz)
                  </label>
                  <input
                    id="sim-fstart"
                    type="number"
                    value={parameters.startFreq ?? 10}
                    onChange={(event) => handleParameterChange('startFreq', Number(event.target.value))}
                    className="w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground"
                    min="0"
                  />
                </div>
                <div>
                  <label htmlFor="sim-fstop" className="text-sm font-medium mb-1 block">
                    Stop frequency (Hz)
                  </label>
                  <input
                    id="sim-fstop"
                    type="number"
                    value={parameters.stopFreq ?? 1e6}
                    onChange={(event) => handleParameterChange('stopFreq', Number(event.target.value))}
                    className="w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground"
                    min="0"
                  />
                </div>
                <div>
                  <label htmlFor="sim-ppd" className="text-sm font-medium mb-1 block">
                    Points per decade
                  </label>
                  <input
                    id="sim-ppd"
                    type="number"
                    value={parameters.pointsPerDecade ?? (selectedAnalysis === 'noise' ? 10 : 20)}
                    onChange={(event) => handleParameterChange('pointsPerDecade', Number(event.target.value))}
                    className="w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground"
                    min="2"
                    max="200"
                  />
                </div>
              </>
            )}

            {selectedAnalysis === 'noise' && (
              <div>
                <label htmlFor="sim-out" className="text-sm font-medium mb-1 block">
                  Output net
                </label>
                <input
                  id="sim-out"
                  type="text"
                  value={parameters.outputNode ?? ''}
                  placeholder="Auto-detect a net named OUT"
                  onChange={(event) => handleParameterChange('outputNode', event.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground"
                />
              </div>
            )}

            {selectedAnalysis === 'montecarlo' && (
              <>
                <div>
                  <label htmlFor="sim-runs" className="text-sm font-medium mb-1 block">
                    Runs
                  </label>
                  <input
                    id="sim-runs"
                    type="number"
                    value={parameters.iterations ?? 100}
                    onChange={(event) => handleParameterChange('iterations', Number(event.target.value))}
                    className="w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground"
                    min="1"
                    max="500"
                  />
                </div>
                <div>
                  <label htmlFor="sim-tol" className="text-sm font-medium mb-1 block">
                    Tolerance (%)
                  </label>
                  <input
                    id="sim-tol"
                    type="number"
                    value={Number(((parameters.tolerance ?? 0.05) * 100).toFixed(2))}
                    onChange={(event) =>
                      handleParameterChange('tolerance', Math.max(0, Number(event.target.value)) / 100)
                    }
                    className="w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground"
                    min="0"
                    step="0.1"
                  />
                </div>
                <div className="col-span-2">
                  <label htmlFor="sim-seed" className="text-sm font-medium mb-1 block">
                    Random seed
                  </label>
                  <input
                    id="sim-seed"
                    type="number"
                    value={parameters.seed ?? 20260101}
                    onChange={(event) => handleParameterChange('seed', Number(event.target.value))}
                    className="w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    The same seed reproduces the same sweep exactly.
                  </p>
                </div>
              </>
            )}
          </div>
        )}
        {components.length === 0 && (
          <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
            Place at least one component on the schematic before simulating.
          </p>
        )}

        {error && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}

        {/* Control Buttons */}
        <div className="flex gap-2">
          <Button
            onClick={handleRunSimulation}
            disabled={isSimulating || components.length === 0}
            className="flex items-center gap-2"
          >
            {isSimulating ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                Solving…
              </>
            ) : (
              <>
                <Play className="h-4 w-4" />
                Run simulation
              </>
            )}
          </Button>

          {simulationResults && (
            <Button onClick={handleExportResults} variant="outline" className="flex items-center gap-2">
              <Download className="h-4 w-4" />
              Export results
            </Button>
          )}
        </div>

        {/* Solver diagnostics: floating nets, non-convergence, step widening. */}
        {simulationResults?.notes && simulationResults.notes.length > 0 && (
          <div className="rounded-md border border-border bg-muted/50 p-3">
            <h4 className="mb-1 flex items-center gap-2 text-xs font-medium text-card-foreground">
              <Info className="h-3.5 w-3.5" aria-hidden="true" />
              Solver diagnostics
            </h4>
            <ul className="space-y-1">
              {simulationResults.notes.map((note) => (
                <li key={note} className="text-xs leading-relaxed text-muted-foreground">
                  {note}
                </li>
              ))}
            </ul>
          </div>
        )}

        {simulationResults && !simulationResults.success && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {simulationResults.error ?? 'The simulation could not be completed.'}
          </p>
        )}

        {/* Results */}
        {simulationResults && (
          <div className="flex-1 flex flex-col space-y-4">
            {simulationResults.success ? (
              <>
                {/* Operating Point */}
                {simulationResults.operatingPoint && (
                  <div>
                    <h4 className="text-sm font-medium mb-2">Operating Point</h4>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      {Object.entries(simulationResults.operatingPoint).map(([node, value]) => (
                        <div key={node} className="bg-muted p-2 rounded">
                          <div className="font-medium">{node}</div>
                          <div className="text-muted-foreground">{value.toFixed(6)} V</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                {/* Waveform Selection */}
                {simulationResults.waveforms.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium mb-2">Waveforms</h4>
                    <div className="flex flex-wrap gap-2">
                      {simulationResults.waveforms.map(waveform => (
                        <label key={waveform.name} className="flex items-center gap-1 text-xs">
                          <input
                            type="checkbox"
                            checked={selectedWaveforms.includes(waveform.name)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedWaveforms(prev => [...prev, waveform.name])
                              } else {
                                setSelectedWaveforms(prev => prev.filter(name => name !== waveform.name))
                              }
                            }}
                            className="w-3 h-3"
                          />
                          <span>{waveform.name}</span>
                          <span className="text-muted-foreground">({waveform.unit})</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                
                {/* Waveform Plot */}
                {selectedWaveforms.length > 0 && (
                  <div className="flex-1 min-h-0">
                    <h4 className="text-sm font-medium mb-2">Waveform Plot</h4>
                    <div className="h-64 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={getWaveformData()}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis
                            dataKey="x"
                            type="number"
                            scale="linear"
                            domain={['dataMin', 'dataMax']}
                            tickFormatter={(value) => {
                              if (selectedAnalysis === 'ac') {
                                return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value.toFixed(0)
                              }
                              return value.toExponential(2)
                            }}
                          />
                          <YAxis
                            tickFormatter={(value) => value.toFixed(2)}
                          />
                          <Tooltip
                            formatter={(value: number, name: string) => [
                              typeof value === 'number' ? value.toFixed(4) : value,
                              name
                            ]}
                            labelFormatter={(value: number) => {
                              if (selectedAnalysis === 'ac') {
                                return `Frequency: ${value >= 1000 ? `${(value / 1000).toFixed(1)}kHz` : `${value}Hz`}`
                              }
                              return `Time: ${value}s`
                            }}
                          />
                          <Legend />
                          {selectedWaveforms.map(name => (
                            <Line
                              key={name}
                              type="monotone"
                              dataKey={name}
                              stroke={getWaveformColors()[name]}
                              strokeWidth={2}
                              dot={false}
                            />
                          ))}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
                
                {/* Convergence Info */}
                {simulationResults.convergenceInfo && (
                  <div className="text-xs text-muted-foreground">
                    Convergence: {simulationResults.convergenceInfo.converged ? 'Success' : 'Failed'} 
                    ({simulationResults.convergenceInfo.iterations} iterations)
                  </div>
                )}
              </>
            ) : (
              <div className="text-destructive text-sm">
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="w-4 h-4" />
                  Simulation Error
                </div>
                <div className="bg-destructive/10 p-3 rounded">
                  {simulationResults.error}
                </div>
              </div>
            )}
          </div>
        )}
        
        {/* Empty State */}
        {!simulationResults && !isSimulating && (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <BarChart3 className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p className="text-sm">Configure parameters and run simulation</p>
              <p className="text-xs mt-1">
                {components.length === 0 ? 'Add components to your circuit first' : `${components.length} components ready`}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}