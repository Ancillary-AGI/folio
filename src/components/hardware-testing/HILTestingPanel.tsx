import { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { 
  X, 
  Play, 
  Pause, 
  Square, 
  Settings, 
  Monitor, 
  Zap,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  Activity,
  Thermometer,
  Droplets,
  Wind,
  BarChart3,
  FileText,
  Download,
  RefreshCw
} from 'lucide-react';
import { hilTestingSystem, type HILDevice, type HILTestCase, type HILTestSession } from '../../lib/hardware-testing/hilTesting';

interface HILTestingPanelProps {
  onClose: () => void;
}

export default function HILTestingPanel({ onClose }: HILTestingPanelProps) {
  const [devices, setDevices] = useState<HILDevice[]>([]);
  const [testCases, setTestCases] = useState<HILTestCase[]>([]);
  const [sessions, setSessions] = useState<HILTestSession[]>([]);
  const [currentSession, setCurrentSession] = useState<HILTestSession | null>(null);
  const [selectedTestCases, setSelectedTestCases] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<'devices' | 'tests' | 'sessions' | 'results'>('devices');
  const [sessionName, setSessionName] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [environmentalData, setEnvironmentalData] = useState({
    temperature: 22.5,
    humidity: 45,
    pressure: 101.3,
    vibration: { x: 0.1, y: 0.1, z: 0.1 }
  });

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 2000); // Refresh every 2 seconds
    return () => clearInterval(interval);
  }, []);

  const loadData = () => {
    setDevices(hilTestingSystem.getConnectedDevices());
    setTestCases(hilTestingSystem.getAllTestCases());
    setSessions(hilTestingSystem.getAllTestSessions());
    
    // Simulate environmental data updates
    setEnvironmentalData({
      temperature: 22.5 + (Math.random() - 0.5) * 2,
      humidity: 45 + (Math.random() - 0.5) * 10,
      pressure: 101.3 + (Math.random() - 0.5) * 0.5,
      vibration: {
        x: Math.random() * 0.2,
        y: Math.random() * 0.2,
        z: Math.random() * 0.2
      }
    });
  };

  const handleConnectDevice = async (deviceId: string) => {
    try {
      await hilTestingSystem.connectDevice(deviceId);
      loadData();
    } catch (error) {
      console.error('Failed to connect device:', error);
    }
  };

  const handleDisconnectDevice = async (deviceId: string) => {
    try {
      await hilTestingSystem.disconnectDevice(deviceId);
      loadData();
    } catch (error) {
      console.error('Failed to disconnect device:', error);
    }
  };

  const handleCreateSession = async () => {
    if (!sessionName.trim() || selectedTestCases.length === 0) {
      alert('Please enter a session name and select test cases');
      return;
    }

    try {
      const sessionId = await hilTestingSystem.createTestSession(
        sessionName,
        'current-project',
        selectedTestCases
      );
      
      const session = hilTestingSystem.getTestSession(sessionId);
      setCurrentSession(session);
      setSessionName('');
      setSelectedTestCases([]);
      loadData();
    } catch (error) {
      alert(`Failed to create session: ${error}`);
    }
  };

  const handleRunSession = async () => {
    if (!currentSession) return;

    setIsRunning(true);
    try {
      await hilTestingSystem.runTestSession(currentSession.id);
      loadData();
    } catch (error) {
      console.error('Session failed:', error);
    } finally {
      setIsRunning(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'connected':
      case 'pass':
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'disconnected':
      case 'fail':
      case 'error':
        return <XCircle className="w-4 h-4 text-red-600" />;
      case 'running':
        return <Activity className="w-4 h-4 text-blue-600 animate-pulse" />;
      case 'timeout':
        return <Clock className="w-4 h-4 text-orange-600" />;
      default:
        return <AlertTriangle className="w-4 h-4 text-yellow-600" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'connected':
      case 'pass':
      case 'completed':
        return 'text-green-600 bg-green-50 border-green-200';
      case 'disconnected':
      case 'fail':
      case 'error':
        return 'text-red-600 bg-red-50 border-red-200';
      case 'running':
        return 'text-blue-600 bg-blue-50 border-blue-200';
      case 'timeout':
        return 'text-orange-600 bg-orange-50 border-orange-200';
      default:
        return 'text-yellow-600 bg-yellow-50 border-yellow-200';
    }
  };

  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-7xl h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="font-semibold text-foreground flex items-center gap-2">
            <Zap className="w-5 h-5" />
            Hardware-in-the-Loop Testing
          </h3>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex-1 flex">
          {/* Main Content */}
          <div className="flex-1 flex flex-col">
            {/* Tab Navigation */}
            <div className="flex border-b border-border">
              {[
                { id: 'devices', label: 'Devices', icon: Monitor },
                { id: 'tests', label: 'Test Cases', icon: FileText },
                { id: 'sessions', label: 'Sessions', icon: Play },
                { id: 'results', label: 'Results', icon: BarChart3 }
              ].map(tab => (
                <Button
                  key={tab.id}
                  variant={activeTab === tab.id ? 'default' : 'ghost'}
                  onClick={() => setActiveTab(tab.id as 'devices' | 'tests' | 'sessions' | 'results')}
                  className="rounded-none border-r border-border"
                >
                  <tab.icon className="w-4 h-4 mr-2" />
                  {tab.label}
                </Button>
              ))}
            </div>

            {/* Tab Content */}
            <div className="flex-1 overflow-y-auto p-4">
              {activeTab === 'devices' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium">Connected Devices</h4>
                    <Button variant="outline" size="sm" onClick={loadData}>
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Refresh
                    </Button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {devices.map(device => (
                      <Card key={device.id}>
                        <CardHeader className="pb-3">
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-sm">{device.name}</CardTitle>
                            {getStatusIcon(device.status)}
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <div className="text-xs space-y-1">
                            <div className="flex justify-between">
                              <span>Type:</span>
                              <span className="capitalize">{device.type}</span>
                            </div>
                            <div className="flex justify-between">
                              <span>Model:</span>
                              <span>{device.model}</span>
                            </div>
                            <div className="flex justify-between">
                              <span>Connection:</span>
                              <span className="uppercase">{device.connection.type}</span>
                            </div>
                            <div className="flex justify-between">
                              <span>Last Seen:</span>
                              <span>{new Date(device.lastSeen).toLocaleTimeString()}</span>
                            </div>
                          </div>

                          <div className="flex gap-2">
                            {device.status === 'connected' ? (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleDisconnectDevice(device.id)}
                                className="flex-1"
                              >
                                Disconnect
                              </Button>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleConnectDevice(device.id)}
                                className="flex-1"
                              >
                                Connect
                              </Button>
                            )}
                            <Button variant="outline" size="sm">
                              <Settings className="w-3 h-3" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  {devices.length === 0 && (
                    <div className="text-center py-8">
                      <Monitor className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                      <h3 className="font-medium mb-2">No devices connected</h3>
                      <p className="text-muted-foreground">Connect hardware devices to begin testing</p>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'tests' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium">Test Cases</h4>
                    <Button variant="outline" size="sm">
                      <FileText className="w-4 h-4 mr-2" />
                      New Test Case
                    </Button>
                  </div>

                  <div className="space-y-3">
                    {testCases.map(testCase => (
                      <Card key={testCase.id} className="cursor-pointer hover:shadow-md transition-shadow">
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <input
                                  type="checkbox"
                                  checked={selectedTestCases.includes(testCase.id)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSelectedTestCases([...selectedTestCases, testCase.id]);
                                    } else {
                                      setSelectedTestCases(selectedTestCases.filter(id => id !== testCase.id));
                                    }
                                  }}
                                  className="rounded"
                                />
                                <h5 className="font-medium">{testCase.name}</h5>
                                <span className={`px-2 py-1 rounded text-xs border ${
                                  testCase.priority === 'critical' ? 'text-red-600 bg-red-50 border-red-200' :
                                  testCase.priority === 'high' ? 'text-orange-600 bg-orange-50 border-orange-200' :
                                  testCase.priority === 'medium' ? 'text-blue-600 bg-blue-50 border-blue-200' :
                                  'text-gray-600 bg-gray-50 border-gray-200'
                                }`}>
                                  {testCase.priority}
                                </span>
                              </div>
                              <p className="text-sm text-muted-foreground mb-2">{testCase.description}</p>
                              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                                <span>Category: {testCase.category}</span>
                                <span>Steps: {testCase.steps.length}</span>
                                <span>Timeout: {formatDuration(testCase.timeout)}</span>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  {testCases.length === 0 && (
                    <div className="text-center py-8">
                      <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                      <h3 className="font-medium mb-2">No test cases available</h3>
                      <p className="text-muted-foreground">Create test cases to validate your hardware</p>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'sessions' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium">Test Sessions</h4>
                  </div>

                  {/* Create New Session */}
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">Create New Session</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <input
                        type="text"
                        value={sessionName}
                        onChange={(e) => setSessionName(e.target.value)}
                        placeholder="Session name"
                        className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background"
                      />
                      <div className="text-sm">
                        Selected test cases: {selectedTestCases.length}
                        {selectedTestCases.length > 0 && (
                          <div className="mt-1 text-xs text-muted-foreground">
                            {selectedTestCases.map(id => testCases.find(tc => tc.id === id)?.name).join(', ')}
                          </div>
                        )}
                      </div>
                      <Button
                        onClick={handleCreateSession}
                        disabled={!sessionName.trim() || selectedTestCases.length === 0}
                        className="w-full"
                      >
                        Create Session
                      </Button>
                    </CardContent>
                  </Card>

                  {/* Current Session */}
                  {currentSession && (
                    <Card>
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-sm">Current Session: {currentSession.name}</CardTitle>
                          {getStatusIcon(currentSession.status)}
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="text-sm space-y-2">
                          <div className="flex justify-between">
                            <span>Progress:</span>
                            <span>{currentSession.progress.current} / {currentSession.progress.total}</span>
                          </div>
                          {currentSession.progress.currentTest && (
                            <div className="flex justify-between">
                              <span>Current Test:</span>
                              <span className="text-xs">{currentSession.progress.currentTest}</span>
                            </div>
                          )}
                          {currentSession.progress.currentStep && (
                            <div className="flex justify-between">
                              <span>Current Step:</span>
                              <span className="text-xs">{currentSession.progress.currentStep}</span>
                            </div>
                          )}
                        </div>

                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                            style={{
                              width: `${(currentSession.progress.current / currentSession.progress.total) * 100}%`
                            }}
                          />
                        </div>

                        <div className="flex gap-2">
                          {currentSession.status === 'idle' && (
                            <Button
                              onClick={handleRunSession}
                              disabled={isRunning}
                              className="flex-1"
                            >
                              <Play className="w-4 h-4 mr-2" />
                              Run Session
                            </Button>
                          )}
                          {currentSession.status === 'running' && (
                            <Button variant="outline" className="flex-1">
                              <Pause className="w-4 h-4 mr-2" />
                              Pause
                            </Button>
                          )}
                          <Button variant="outline">
                            <Square className="w-4 h-4 mr-2" />
                            Stop
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Session History */}
                  <div className="space-y-3">
                    <h5 className="font-medium text-sm">Recent Sessions</h5>
                    {sessions.slice(0, 5).map(session => (
                      <Card key={session.id} className="cursor-pointer hover:shadow-md transition-shadow">
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <h6 className="font-medium text-sm">{session.name}</h6>
                              <div className="text-xs text-muted-foreground">
                                {session.testCases.length} tests • {session.startTime ? new Date(session.startTime).toLocaleString() : 'Not started'}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {getStatusIcon(session.status)}
                              <span className={`px-2 py-1 rounded text-xs border ${getStatusColor(session.status)}`}>
                                {session.status}
                              </span>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === 'results' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium">Test Results</h4>
                    <Button variant="outline" size="sm">
                      <Download className="w-4 h-4 mr-2" />
                      Export Report
                    </Button>
                  </div>

                  {currentSession && currentSession.results.length > 0 && (
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm">Latest Results</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          {currentSession.results.slice(-10).map((result, index) => (
                            <div key={index} className="flex items-center justify-between p-2 rounded border">
                              <div className="flex items-center gap-2">
                                {getStatusIcon(result.status)}
                                <span className="text-sm">
                                  {testCases.find(tc => tc.id === result.testCaseId)?.name || 'Unknown Test'}
                                </span>
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {formatDuration(result.duration)}
                              </div>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {(!currentSession || currentSession.results.length === 0) && (
                    <div className="text-center py-8">
                      <BarChart3 className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                      <h3 className="font-medium mb-2">No results available</h3>
                      <p className="text-muted-foreground">Run test sessions to see results</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right Sidebar - Environmental & Status */}
          <div className="w-80 border-l border-border p-4 space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Activity className="w-4 h-4" />
                  System Status
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-xs space-y-2">
                  <div className="flex justify-between">
                    <span>Connected Devices:</span>
                    <span className="font-medium">{devices.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Active Sessions:</span>
                    <span className="font-medium">{sessions.filter(s => s.status === 'running').length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Test Cases:</span>
                    <span className="font-medium">{testCases.length}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Thermometer className="w-4 h-4" />
                  Environmental
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Thermometer className="w-3 h-3" />
                      <span className="text-xs">Temperature</span>
                    </div>
                    <span className="text-xs font-medium">{environmentalData.temperature.toFixed(1)}°C</span>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Droplets className="w-3 h-3" />
                      <span className="text-xs">Humidity</span>
                    </div>
                    <span className="text-xs font-medium">{environmentalData.humidity.toFixed(1)}%</span>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Wind className="w-3 h-3" />
                      <span className="text-xs">Pressure</span>
                    </div>
                    <span className="text-xs font-medium">{environmentalData.pressure.toFixed(1)} kPa</span>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Activity className="w-3 h-3" />
                      <span className="text-xs">Vibration</span>
                    </div>
                    <span className="text-xs font-medium">
                      {Math.sqrt(
                        environmentalData.vibration.x ** 2 + 
                        environmentalData.vibration.y ** 2 + 
                        environmentalData.vibration.z ** 2
                      ).toFixed(2)}g
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {currentSession && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <BarChart3 className="w-4 h-4" />
                    Session Stats
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-xs space-y-2">
                    <div className="flex justify-between">
                      <span>Total Tests:</span>
                      <span className="font-medium">{currentSession.results.length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Passed:</span>
                      <span className="font-medium text-green-600">
                        {currentSession.results.filter(r => r.status === 'pass').length}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Failed:</span>
                      <span className="font-medium text-red-600">
                        {currentSession.results.filter(r => r.status === 'fail').length}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Errors:</span>
                      <span className="font-medium text-orange-600">
                        {currentSession.results.filter(r => r.status === 'error').length}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}