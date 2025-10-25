import { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { 
  Play, 
  Square, 
  CheckCircle, 
  XCircle, 
  Clock, 
  Download, 
  RefreshCw,
  AlertTriangle,
  BarChart3,
  FileText,
  Settings,
  X
} from 'lucide-react';
import { 
  testFramework, 
  TestSuite, 
  TestResult, 
  TestReport, 
  CIRCUIT_TEST_SUITES 
} from '../../lib/testing/testFramework';

interface TestingPanelProps {
  onClose: () => void;
}

export default function TestingPanel({ onClose }: TestingPanelProps) {
  const [testSuites, setTestSuites] = useState<TestSuite[]>([]);
  const [selectedSuite, setSelectedSuite] = useState<string>('');
  const [isRunning, setIsRunning] = useState(false);
  const [currentTest, setCurrentTest] = useState<string>('');
  const [testReports, setTestReports] = useState<Map<string, TestReport>>(new Map());
  const [showReport, setShowReport] = useState<string>('');
  const [testProgress, setTestProgress] = useState({ current: 0, total: 0 });

  useEffect(() => {
    // Load available test suites
    const suites = testFramework.getAllTestSuites();
    setTestSuites(suites);
    if (suites.length > 0 && !selectedSuite) {
      setSelectedSuite(suites[0].id);
    }
  }, [selectedSuite]);

  const handleRunTestSuite = async (suiteId: string) => {
    setIsRunning(true);
    setCurrentTest('');
    
    const suite = testSuites.find(s => s.id === suiteId);
    if (!suite) return;

    setTestProgress({ current: 0, total: suite.testCases.length });

    try {
      // Simulate running individual tests with progress updates
      for (let i = 0; i < suite.testCases.length; i++) {
        const testCase = suite.testCases[i];
        setCurrentTest(testCase.name);
        setTestProgress({ current: i + 1, total: suite.testCases.length });
        
        // Add delay to show progress
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      const report = await testFramework.runTestSuite(suiteId);
      setTestReports(prev => new Map(prev).set(suiteId, report));
      setShowReport(suiteId);
    } catch (error) {
      console.error('Error running test suite:', error);
    } finally {
      setIsRunning(false);
      setCurrentTest('');
      setTestProgress({ current: 0, total: 0 });
    }
  };

  const handleRunAllTests = async () => {
    setIsRunning(true);
    
    for (const suite of testSuites) {
      await handleRunTestSuite(suite.id);
    }
    
    setIsRunning(false);
  };

  const handleExportReport = (suiteId: string) => {
    const reportText = testFramework.generateTestReport(suiteId);
    const blob = new Blob([reportText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `test_report_${suiteId}_${Date.now()}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const getTestSuiteStatus = (suiteId: string) => {
    const report = testReports.get(suiteId);
    if (!report) return 'not-run';
    
    if (report.summary.failed > 0) return 'failed';
    if (report.summary.passed === report.summary.total) return 'passed';
    return 'partial';
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'passed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" />;
      case 'partial':
        return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
      default:
        return <Clock className="w-4 h-4 text-gray-400" />;
    }
  };

  const selectedSuiteData = testSuites.find(s => s.id === selectedSuite);
  const selectedReport = showReport ? testReports.get(showReport) : null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-7xl h-[90vh] flex">
        {/* Test Suites List */}
        <div className="w-80 bg-card border-r border-border flex flex-col">
          <div className="flex items-center justify-between p-4 border-b border-border">
            <h3 className="font-semibold text-foreground">Test Suites</h3>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {testSuites.map(suite => {
              const status = getTestSuiteStatus(suite.id);
              const report = testReports.get(suite.id);
              
              return (
                <Card
                  key={suite.id}
                  className={`cursor-pointer transition-colors ${
                    selectedSuite === suite.id ? 'border-primary bg-primary/5' : 'hover:bg-accent'
                  }`}
                  onClick={() => setSelectedSuite(suite.id)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-medium text-sm">{suite.name}</h4>
                      {getStatusIcon(status)}
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">{suite.description}</p>
                    <div className="flex items-center justify-between text-xs">
                      <span>{suite.testCases.length} tests</span>
                      {report && (
                        <span className={`font-medium ${
                          status === 'passed' ? 'text-green-600' : 
                          status === 'failed' ? 'text-red-600' : 'text-yellow-600'
                        }`}>
                          {report.summary.passed}/{report.summary.total}
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Control Buttons */}
          <div className="p-4 border-t border-border space-y-2">
            <Button
              onClick={() => selectedSuite && handleRunTestSuite(selectedSuite)}
              disabled={isRunning || !selectedSuite}
              className="w-full flex items-center gap-2"
            >
              {isRunning ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Running Tests...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  Run Selected Suite
                </>
              )}
            </Button>
            
            <Button
              onClick={handleRunAllTests}
              disabled={isRunning}
              variant="outline"
              className="w-full flex items-center gap-2"
            >
              <Play className="w-4 h-4" />
              Run All Tests
            </Button>

            {isRunning && (
              <Button
                onClick={() => setIsRunning(false)}
                variant="destructive"
                className="w-full flex items-center gap-2"
              >
                <Square className="w-4 h-4" />
                Stop Tests
              </Button>
            )}
          </div>
        </div>

        {/* Test Details */}
        <div className="flex-1 flex flex-col">
          <div className="p-4 border-b border-border">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-foreground">
                {selectedSuiteData?.name || 'Select a test suite'}
              </h3>
              <div className="flex items-center gap-2">
                {selectedReport && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleExportReport(showReport)}
                    className="flex items-center gap-2"
                  >
                    <Download className="w-3 h-3" />
                    Export Report
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowReport('')}
                  className="flex items-center gap-2"
                >
                  <FileText className="w-3 h-3" />
                  {showReport ? 'Hide Report' : 'Show Tests'}
                </Button>
              </div>
            </div>
          </div>

          {/* Progress Bar */}
          {isRunning && (
            <div className="p-4 border-b border-border">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span>Running: {currentTest}</span>
                  <span>{testProgress.current}/{testProgress.total}</span>
                </div>
                <div className="w-full bg-muted rounded-full h-2">
                  <div
                    className="bg-primary h-2 rounded-full transition-all duration-300"
                    style={{ 
                      width: `${testProgress.total > 0 ? (testProgress.current / testProgress.total) * 100 : 0}%` 
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            {showReport && selectedReport ? (
              /* Test Report View */
              <div className="p-4 space-y-4">
                {/* Summary */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <BarChart3 className="w-4 h-4" />
                      Test Summary
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-4 gap-4 text-center">
                      <div>
                        <div className="text-2xl font-bold text-foreground">
                          {selectedReport.summary.total}
                        </div>
                        <div className="text-sm text-muted-foreground">Total</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-green-600">
                          {selectedReport.summary.passed}
                        </div>
                        <div className="text-sm text-muted-foreground">Passed</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-red-600">
                          {selectedReport.summary.failed}
                        </div>
                        <div className="text-sm text-muted-foreground">Failed</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-foreground">
                          {selectedReport.summary.executionTime}ms
                        </div>
                        <div className="text-sm text-muted-foreground">Time</div>
                      </div>
                    </div>
                    
                    <div className="mt-4">
                      <div className="flex items-center justify-between text-sm mb-2">
                        <span>Success Rate</span>
                        <span>{((selectedReport.summary.passed / selectedReport.summary.total) * 100).toFixed(1)}%</span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2">
                        <div
                          className="bg-green-500 h-2 rounded-full"
                          style={{ 
                            width: `${(selectedReport.summary.passed / selectedReport.summary.total) * 100}%` 
                          }}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Test Results */}
                <Card>
                  <CardHeader>
                    <CardTitle>Test Results</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {selectedReport.results.map(result => (
                        <div
                          key={result.testCaseId}
                          className={`p-3 rounded-lg border ${
                            result.passed 
                              ? 'border-green-200 bg-green-50' 
                              : 'border-red-200 bg-red-50'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              {result.passed ? (
                                <CheckCircle className="w-4 h-4 text-green-600" />
                              ) : (
                                <XCircle className="w-4 h-4 text-red-600" />
                              )}
                              <span className="font-medium text-sm">{result.name}</span>
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {result.executionTime}ms
                            </span>
                          </div>
                          
                          {result.error && (
                            <div className="mt-2 text-xs text-red-700 bg-red-100 p-2 rounded">
                              {result.error}
                            </div>
                          )}
                          
                          {Object.keys(result.actualOutputs).length > 0 && (
                            <div className="mt-2 text-xs">
                              <div className="font-medium mb-1">Outputs:</div>
                              <div className="bg-muted p-2 rounded font-mono">
                                {JSON.stringify(result.actualOutputs, null, 2)}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : selectedSuiteData ? (
              /* Test Cases View */
              <div className="p-4 space-y-4">
                <div className="text-sm text-muted-foreground mb-4">
                  {selectedSuiteData.description}
                </div>

                <div className="space-y-2">
                  {selectedSuiteData.testCases.map(testCase => (
                    <Card key={testCase.id}>
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="font-medium text-sm">{testCase.name}</h4>
                          <span className={`px-2 py-1 rounded text-xs font-medium ${
                            testCase.category === 'unit' ? 'bg-blue-100 text-blue-700' :
                            testCase.category === 'integration' ? 'bg-green-100 text-green-700' :
                            testCase.category === 'simulation' ? 'bg-purple-100 text-purple-700' :
                            testCase.category === 'visual' ? 'bg-orange-100 text-orange-700' :
                            'bg-red-100 text-red-700'
                          }`}>
                            {testCase.category}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mb-3">
                          {testCase.description}
                        </p>
                        
                        <div className="grid grid-cols-2 gap-4 text-xs">
                          <div>
                            <div className="font-medium mb-1">Inputs:</div>
                            <div className="bg-muted p-2 rounded font-mono">
                              {JSON.stringify(testCase.inputs, null, 2)}
                            </div>
                          </div>
                          <div>
                            <div className="font-medium mb-1">Expected Outputs:</div>
                            <div className="bg-muted p-2 rounded font-mono">
                              {JSON.stringify(testCase.expectedOutputs, null, 2)}
                            </div>
                          </div>
                        </div>
                        
                        {testCase.tolerance && (
                          <div className="mt-2 text-xs text-muted-foreground">
                            Tolerance: ±{(testCase.tolerance * 100).toFixed(1)}%
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            ) : (
              /* Empty State */
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center text-muted-foreground">
                  <Settings className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>Select a test suite to view details</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}