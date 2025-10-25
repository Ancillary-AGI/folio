import React, { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { Progress } from '../ui/progress';
import { ScrollArea } from '../ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import {
  Play,
  Square,
  CheckCircle,
  XCircle,
  AlertCircle,
  Clock,
  FileText,
  Download
} from 'lucide-react';
import { comprehensiveTestSuite, TestResult } from '../../lib/testing/comprehensiveTestSuite';

interface TestRunnerPanelProps {
  onClose?: () => void;
}

export const TestRunnerPanel: React.FC<TestRunnerPanelProps> = ({ onClose }) => {
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [selectedSuite, setSelectedSuite] = useState<string>('all');
  const [testSuites, setTestSuites] = useState<string[]>([]);

  useEffect(() => {
    setTestSuites(['all', ...comprehensiveTestSuite.getTestSuites()]);
  }, []);

  const runAllTests = async () => {
    setIsRunning(true);
    setProgress(0);
    setTestResults([]);

    try {
      const results = await comprehensiveTestSuite.runAllTests();
      setTestResults(results);
    } catch (error) {
      console.error('Test execution failed:', error);
    } finally {
      setIsRunning(false);
      setProgress(100);
    }
  };

  const runSuiteTests = async (suiteName: string) => {
    if (suiteName === 'all') {
      await runAllTests();
      return;
    }

    setIsRunning(true);
    setProgress(0);
    setTestResults([]);

    try {
      const results = await comprehensiveTestSuite.runTestSuite(suiteName);
      setTestResults(results);
    } catch (error) {
      console.error(`Suite ${suiteName} execution failed:`, error);
    } finally {
      setIsRunning(false);
      setProgress(100);
    }
  };

  const stopTests = () => {
    setIsRunning(false);
    setProgress(0);
  };

  const exportReport = () => {
    const report = comprehensiveTestSuite.generateTestReport();
    const blob = new Blob([report], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `test-report-${new Date().toISOString().split('T')[0]}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const getStatusIcon = (status: TestResult['status']) => {
    switch (status) {
      case 'passed':
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-600" />;
      case 'skipped':
        return <AlertCircle className="w-4 h-4 text-yellow-600" />;
      default:
        return <Clock className="w-4 h-4 text-gray-600" />;
    }
  };

  const getStatusBadge = (status: TestResult['status']) => {
    const variants = {
      passed: 'default',
      failed: 'destructive',
      skipped: 'secondary'
    } as const;

    return (
      <Badge variant={variants[status] || 'outline'}>
        {status.toUpperCase()}
      </Badge>
    );
  };

  const passedTests = testResults.filter(r => r.status === 'passed').length;
  const failedTests = testResults.filter(r => r.status === 'failed').length;
  const skippedTests = testResults.filter(r => r.status === 'skipped').length;
  const totalTests = testResults.length;
  const successRate = totalTests > 0 ? (passedTests / totalTests) * 100 : 0;

  return (
    <div className="w-full h-full flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <FileText className="w-5 h-5" />
          Test Runner
        </h2>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={exportReport}
            disabled={testResults.length === 0}
          >
            <Download className="w-4 h-4 mr-2" />
            Export Report
          </Button>
          {onClose && (
            <Button variant="ghost" size="icon" onClick={onClose}>
              ✕
            </Button>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-4 mb-4">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium">Test Suite:</label>
            <select
              value={selectedSuite}
              onChange={(e) => setSelectedSuite(e.target.value)}
              className="px-3 py-1 text-sm border border-input rounded-md bg-background"
              disabled={isRunning}
            >
              {testSuites.map(suite => (
                <option key={suite} value={suite}>
                  {suite === 'all' ? 'All Tests' : suite}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            {!isRunning ? (
              <Button onClick={() => runSuiteTests(selectedSuite)}>
                <Play className="w-4 h-4 mr-2" />
                Run Tests
              </Button>
            ) : (
              <Button variant="destructive" onClick={stopTests}>
                <Square className="w-4 h-4 mr-2" />
                Stop
              </Button>
            )}
          </div>
        </div>

        {/* Progress */}
        {isRunning && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span>Running tests...</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} className="w-full" />
          </div>
        )}

        {/* Summary */}
        {testResults.length > 0 && (
          <div className="grid grid-cols-4 gap-4 mt-4">
            <Card>
              <CardContent className="p-3">
                <div className="text-2xl font-bold text-green-600">{passedTests}</div>
                <div className="text-xs text-muted-foreground">Passed</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <div className="text-2xl font-bold text-red-600">{failedTests}</div>
                <div className="text-xs text-muted-foreground">Failed</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <div className="text-2xl font-bold text-yellow-600">{skippedTests}</div>
                <div className="text-xs text-muted-foreground">Skipped</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <div className="text-2xl font-bold">{successRate.toFixed(1)}%</div>
                <div className="text-xs text-muted-foreground">Success Rate</div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* Test Results */}
      <div className="flex-1 overflow-hidden">
        <Tabs defaultValue="all" className="h-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="all">All ({totalTests})</TabsTrigger>
            <TabsTrigger value="passed">Passed ({passedTests})</TabsTrigger>
            <TabsTrigger value="failed">Failed ({failedTests})</TabsTrigger>
            <TabsTrigger value="skipped">Skipped ({skippedTests})</TabsTrigger>
          </TabsList>

          <TabsContent value="all" className="h-full mt-0">
            <ScrollArea className="h-full">
              <div className="p-4 space-y-2">
                {testResults.map((result, index) => (
                  <Card key={index}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          {getStatusIcon(result.status)}
                          <div>
                            <div className="font-medium">{result.testName}</div>
                            <div className="text-sm text-muted-foreground">
                              {result.duration}ms
                            </div>
                          </div>
                        </div>
                        {getStatusBadge(result.status)}
                      </div>

                      {result.error && (
                        <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-md">
                          <div className="text-sm font-medium text-red-800">Error:</div>
                          <div className="text-sm text-red-700 mt-1">{result.error}</div>
                        </div>
                      )}

                      {result.details && (
                        <div className="mt-3 p-3 bg-gray-50 border border-gray-200 rounded-md">
                          <div className="text-sm font-medium text-gray-800">Details:</div>
                          <pre className="text-xs text-gray-700 mt-1 whitespace-pre-wrap">
                            {JSON.stringify(result.details, null, 2)}
                          </pre>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}

                {testResults.length === 0 && !isRunning && (
                  <div className="text-center py-8 text-muted-foreground">
                    <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>No test results yet</p>
                    <p className="text-sm">Run tests to see results here</p>
                  </div>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="passed" className="h-full mt-0">
            <ScrollArea className="h-full">
              <div className="p-4 space-y-2">
                {testResults
                  .filter(r => r.status === 'passed')
                  .map((result, index) => (
                    <Card key={index}>
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {getStatusIcon(result.status)}
                            <span className="font-medium">{result.testName}</span>
                          </div>
                          <span className="text-sm text-muted-foreground">{result.duration}ms</span>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="failed" className="h-full mt-0">
            <ScrollArea className="h-full">
              <div className="p-4 space-y-2">
                {testResults
                  .filter(r => r.status === 'failed')
                  .map((result, index) => (
                    <Card key={index}>
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {getStatusIcon(result.status)}
                            <span className="font-medium">{result.testName}</span>
                          </div>
                          <span className="text-sm text-muted-foreground">{result.duration}ms</span>
                        </div>
                        {result.error && (
                          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-md">
                            <div className="text-sm font-medium text-red-800">Error:</div>
                            <div className="text-sm text-red-700 mt-1">{result.error}</div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="skipped" className="h-full mt-0">
            <ScrollArea className="h-full">
              <div className="p-4 space-y-2">
                {testResults
                  .filter(r => r.status === 'skipped')
                  .map((result, index) => (
                    <Card key={index}>
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {getStatusIcon(result.status)}
                            <span className="font-medium">{result.testName}</span>
                          </div>
                          <span className="text-sm text-muted-foreground">{result.duration}ms</span>
                        </div>
                        {result.details && (
                          <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                            <div className="text-sm font-medium text-yellow-800">Reason:</div>
                            <div className="text-sm text-yellow-700 mt-1">
                              {result.details.reason || 'Test was skipped'}
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};