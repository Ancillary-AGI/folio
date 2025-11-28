import { useState, useEffect } from 'react'
import { Play, Square, Download, Zap, BarChart3, X } from 'lucide-react'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { spiceEngine, SimulationParameters, SimulationResult } from '../../lib/simulation/spiceEngine'
import { useProjectStore } from '../../stores/useProjectStore'

interface SimulationPanelProps {
  onClose: () => void
}

export default function SimulationPanel({ onClose }: SimulationPanelProps) {
  const [isSimulating, setIsSimulating] = useState(false)
  const [simulationResults, setSimulationResults] = useState<SimulationResult | null>(null)
  const [selectedAnalysis, setSelectedAnalysis] = useState<'dc' | 'ac' | 'transient' | 'noise'>('transient')
  const [parameters, setParameters] = useState<SimulationParameters>({
    type: 'transient',
    startTime: 0,
    stopTime: 0.001,
    stepTime: 0.000001,
    temperature: 27
  })
  const [selectedWaveforms, setSelectedWaveforms] = useState<string[]>([])
  
  const { components, wires } = useProjectStore()
  
  useEffect(() => {
    setParameters(prev => ({ ...prev, type: selectedAnalysis }))
  }, [selectedAnalysis])
  
  const handleRunSimulation = async () => {
    if (components.length === 0) {
      alert('No components to simulate')
      return
    }
    
    setIsSimulating(true)
    
    try {
      // Generate netlist from current circuit
      const netlist = {
        title: 'Circuit Simulation',
        components: components.map(comp => ({
          type: comp.component.name.toLowerCase().replace(/\s+/g, '_'),
          name: comp.reference,
          nodes: comp.component.pins.map(pin => {
            const connectedWire = wires.find(wire =>
              wire.connectedPins.some(p => p.componentId === comp.id && p.pinId === pin.id)
            )
            return connectedWire?.netName || `net_${comp.id}_${pin.id}`
          }),
          parameters: comp.properties
        })),
        analyses: [parameters]
      }
      
      const result = await spiceEngine.simulate(netlist)
      setSimulationResults(result)
      
      if (result.success && result.waveforms.length > 0) {
        setSelectedWaveforms([result.waveforms[0].name])
      }
    } catch (error) {
      console.error('Simulation error:', error)
      alert('Simulation failed: ' + (error instanceof Error ? error.message : 'Unknown error'))
    } finally {
      setIsSimulating(false)
    }
  }
  
  const handleStopSimulation = () => {
    setIsSimulating(false)
  }
  
  const handleParameterChange = (key: keyof SimulationParameters, value: string | number) => {
    setParameters(prev => ({ ...prev, [key]: value }))
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
    const colors = ['#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#00ff00', '#ff00ff']
    return selectedWaveforms.reduce((acc, name, index) => {
      acc[name] = colors[index % colors.length]
      return acc
    }, {} as Record<string, string>)
  }
  
  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-green-600" />
          Circuit Simulation
        </CardTitle>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="w-4 h-4" />
        </Button>
      </CardHeader>
      
      <CardContent className="flex-1 flex flex-col space-y-4">
        {/* Analysis Type Selection */}
        <div>
          <label className="text-sm font-medium mb-2 block">Analysis Type</label>
          <div className="flex gap-2">
            {(['dc', 'ac', 'transient', 'noise'] as const).map(type => (
              <Button
                key={type}
                variant={selectedAnalysis === type ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedAnalysis(type)}
                className="capitalize"
              >
                {type}
              </Button>
            ))}
          </div>
        </div>
        
        {/* Parameters */}
        <div className="grid grid-cols-2 gap-4">
          {selectedAnalysis === 'transient' && (
            <>
              <div>
                <label className="text-sm font-medium mb-1 block">Start Time (s)</label>
                <input
                  type="number"
                  value={parameters.startTime || 0}
                  onChange={(e) => handleParameterChange('startTime', parseFloat(e.target.value))}
                  className="w-full px-3 py-1 border rounded text-sm"
                  step="0.000001"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Stop Time (s)</label>
                <input
                  type="number"
                  value={parameters.stopTime || 0.001}
                  onChange={(e) => handleParameterChange('stopTime', parseFloat(e.target.value))}
                  className="w-full px-3 py-1 border rounded text-sm"
                  step="0.000001"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Step Time (s)</label>
                <input
                  type="number"
                  value={parameters.stepTime || 0.000001}
                  onChange={(e) => handleParameterChange('stepTime', parseFloat(e.target.value))}
                  className="w-full px-3 py-1 border rounded text-sm"
                  step="0.0000001"
                />
              </div>
            </>
          )}
          
          {selectedAnalysis === 'ac' && (
            <>
              <div>
                <label className="text-sm font-medium mb-1 block">Start Freq (Hz)</label>
                <input
                  type="number"
                  value={parameters.startFreq || 1}
                  onChange={(e) => handleParameterChange('startFreq', parseFloat(e.target.value))}
                  className="w-full px-3 py-1 border rounded text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Stop Freq (Hz)</label>
                <input
                  type="number"
                  value={parameters.stopFreq || 1000000}
                  onChange={(e) => handleParameterChange('stopFreq', parseFloat(e.target.value))}
                  className="w-full px-3 py-1 border rounded text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Points/Decade</label>
                <input
                  type="number"
                  value={parameters.pointsPerDecade || 10}
                  onChange={(e) => handleParameterChange('pointsPerDecade', parseInt(e.target.value))}
                  className="w-full px-3 py-1 border rounded text-sm"
                />
              </div>
            </>
          )}
          
          <div>
            <label className="text-sm font-medium mb-1 block">Temperature (°C)</label>
            <input
              type="number"
              value={parameters.temperature || 27}
              onChange={(e) => handleParameterChange('temperature', parseFloat(e.target.value))}
              className="w-full px-3 py-1 border rounded text-sm"
            />
          </div>
        </div>
        
        {/* Control Buttons */}
        <div className="flex gap-2">
          <Button
            onClick={handleRunSimulation}
            disabled={isSimulating || components.length === 0}
            className="flex items-center gap-2"
          >
            {isSimulating ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Simulating...
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Run Simulation
              </>
            )}
          </Button>
          
          {isSimulating && (
            <Button
              onClick={handleStopSimulation}
              variant="destructive"
              className="flex items-center gap-2"
            >
              <Square className="w-4 h-4" />
              Stop
            </Button>
          )}
          
          {simulationResults && (
            <Button
              onClick={handleExportResults}
              variant="outline"
              className="flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Export
            </Button>
          )}
        </div>
        
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
                        <div key={node} className="bg-gray-50 p-2 rounded">
                          <div className="font-medium">{node}</div>
                          <div className="text-gray-600">{value.toFixed(3)}V</div>
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
                          <span className="text-gray-500">({waveform.unit})</span>
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
                  <div className="text-xs text-gray-600">
                    Convergence: {simulationResults.convergenceInfo.converged ? 'Success' : 'Failed'} 
                    ({simulationResults.convergenceInfo.iterations} iterations)
                  </div>
                )}
              </>
            ) : (
              <div className="text-red-600 text-sm">
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="w-4 h-4" />
                  Simulation Error
                </div>
                <div className="bg-red-50 p-3 rounded">
                  {simulationResults.error}
                </div>
              </div>
            )}
          </div>
        )}
        
        {/* Empty State */}
        {!simulationResults && !isSimulating && (
          <div className="flex-1 flex items-center justify-center text-gray-500">
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