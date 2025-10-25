import { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { 
  Play, 
  Upload, 
  Download, 
  Settings, 
  Code, 
  Cpu, 
  Zap, 
  AlertCircle, 
  CheckCircle, 
  Clock,
  X,
  RefreshCw,
  FileText,
  Wrench
} from 'lucide-react';
import { 
  boardProgrammer, 
  BOARD_DEFINITIONS, 
  BoardDefinition, 
  CompilationResult, 
  UploadResult,
  CODE_TEMPLATES,
  ArduinoIDEIntegration
} from '../../lib/programming/boardProgrammer';

interface BoardProgrammingPanelProps {
  onClose: () => void;
}

export default function BoardProgrammingPanel({ onClose }: BoardProgrammingPanelProps) {
  const [selectedBoard, setSelectedBoard] = useState<string>('arduino_uno');
  const [availablePorts, setAvailablePorts] = useState<string[]>([]);
  const [selectedPort, setSelectedPort] = useState<string>('');
  const [code, setCode] = useState<string>(CODE_TEMPLATES.basic);
  const [isCompiling, setIsCompiling] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [compilationResult, setCompilationResult] = useState<CompilationResult | null>(null);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('basic');
  const [showOutput, setShowOutput] = useState(false);
  const [installedLibraries, setInstalledLibraries] = useState<Array<{ name: string; version: string; description: string }>>([]);
  const [arduinoIDEVersion, setArduinoIDEVersion] = useState<string | null>(null);

  useEffect(() => {
    // Initialize board programmer
    boardProgrammer.setBoard(selectedBoard);
    
    // Load available ports
    loadAvailablePorts();
    
    // Load installed libraries
    loadInstalledLibraries();
    
    // Check Arduino IDE
    checkArduinoIDE();
  }, [selectedBoard]);

  const loadAvailablePorts = async () => {
    try {
      const ports = await boardProgrammer.getAvailablePorts();
      setAvailablePorts(ports);
      if (ports.length > 0 && !selectedPort) {
        setSelectedPort(ports[0]);
      }
    } catch (error) {
      console.error('Failed to load ports:', error);
    }
  };

  const loadInstalledLibraries = async () => {
    try {
      const libraries = await boardProgrammer.getInstalledLibraries();
      setInstalledLibraries(libraries);
    } catch (error) {
      console.error('Failed to load libraries:', error);
    }
  };

  const checkArduinoIDE = async () => {
    try {
      const version = await ArduinoIDEIntegration.getArduinoIDEVersion();
      setArduinoIDEVersion(version);
    } catch (error) {
      console.error('Failed to check Arduino IDE:', error);
    }
  };

  const handleBoardChange = (boardId: string) => {
    setSelectedBoard(boardId);
    boardProgrammer.setBoard(boardId);
    setCompilationResult(null);
    setUploadResult(null);
  };

  const handleTemplateChange = (template: string) => {
    setSelectedTemplate(template);
    setCode(CODE_TEMPLATES[template as keyof typeof CODE_TEMPLATES] || CODE_TEMPLATES.basic);
  };

  const handleCompile = async () => {
    setIsCompiling(true);
    setCompilationResult(null);
    setShowOutput(true);

    try {
      const result = await boardProgrammer.compileSketch(code);
      setCompilationResult(result);
    } catch (error) {
      setCompilationResult({
        success: false,
        output: 'Compilation failed',
        errors: [error instanceof Error ? error.message : 'Unknown error'],
        warnings: [],
        binarySize: 0,
        memoryUsage: {
          flash: { used: 0, total: 0, percentage: 0 },
          ram: { used: 0, total: 0, percentage: 0 }
        },
        compilationTime: 0
      });
    } finally {
      setIsCompiling(false);
    }
  };

  const handleUpload = async () => {
    if (!selectedPort) {
      alert('Please select a port');
      return;
    }

    if (!compilationResult?.success) {
      alert('Please compile the sketch first');
      return;
    }

    setIsUploading(true);
    setUploadResult(null);

    try {
      const result = await boardProgrammer.uploadSketch(selectedPort);
      setUploadResult(result);
    } catch (error) {
      setUploadResult({
        success: false,
        output: 'Upload failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        uploadTime: 0
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleCompileAndUpload = async () => {
    await handleCompile();
    // Wait a bit for compilation to complete
    setTimeout(async () => {
      if (compilationResult?.success) {
        await handleUpload();
      }
    }, 1000);
  };

  const handleOpenInArduinoIDE = async () => {
    try {
      const success = await ArduinoIDEIntegration.openInArduinoIDE(code);
      if (!success) {
        alert('Failed to open Arduino IDE. Make sure it is installed.');
      }
    } catch (error) {
      console.error('Failed to open Arduino IDE:', error);
      alert('Failed to open Arduino IDE');
    }
  };

  const handleSaveSketch = () => {
    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `sketch_${Date.now()}.ino`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleLoadSketch = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.ino,.cpp,.c';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
          setCode(e.target?.result as string || '');
        };
        reader.readAsText(file);
      }
    };
    input.click();
  };

  const currentBoard = BOARD_DEFINITIONS[selectedBoard];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-7xl h-[90vh] flex">
        {/* Code Editor */}
        <div className="flex-1 flex flex-col">
          <div className="flex items-center justify-between p-4 border-b border-border">
            <h3 className="font-semibold text-foreground">Arduino Programming</h3>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleLoadSketch}
                className="flex items-center gap-2"
              >
                <Upload className="w-3 h-3" />
                Load
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSaveSketch}
                className="flex items-center gap-2"
              >
                <Download className="w-3 h-3" />
                Save
              </Button>
              {arduinoIDEVersion && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleOpenInArduinoIDE}
                  className="flex items-center gap-2"
                >
                  <Code className="w-3 h-3" />
                  Arduino IDE
                </Button>
              )}
              <Button variant="ghost" size="icon" onClick={onClose}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Template Selection */}
          <div className="p-4 border-b border-border">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Template:</span>
              <select
                value={selectedTemplate}
                onChange={(e) => handleTemplateChange(e.target.value)}
                className="px-3 py-1 text-sm border border-input rounded bg-background"
              >
                <option value="basic">Basic Blink</option>
                <option value="sensor_reading">Sensor Reading</option>
                <option value="servo_control">Servo Control</option>
                <option value="wifi_connection">WiFi Connection</option>
              </select>
            </div>
          </div>

          {/* Code Editor */}
          <div className="flex-1 p-4">
            <textarea
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full h-full font-mono text-sm border border-input rounded-md p-4 bg-background resize-none focus:ring-2 focus:ring-ring focus:border-transparent"
              placeholder="Enter your Arduino code here..."
              spellCheck={false}
            />
          </div>

          {/* Action Buttons */}
          <div className="p-4 border-t border-border">
            <div className="flex items-center gap-2">
              <Button
                onClick={handleCompile}
                disabled={isCompiling}
                className="flex items-center gap-2"
              >
                {isCompiling ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Compiling...
                  </>
                ) : (
                  <>
                    <Wrench className="w-4 h-4" />
                    Compile
                  </>
                )}
              </Button>

              <Button
                onClick={handleUpload}
                disabled={isUploading || !compilationResult?.success || !selectedPort}
                variant="secondary"
                className="flex items-center gap-2"
              >
                {isUploading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    Upload
                  </>
                )}
              </Button>

              <Button
                onClick={handleCompileAndUpload}
                disabled={isCompiling || isUploading || !selectedPort}
                className="flex items-center gap-2"
              >
                <Play className="w-4 h-4" />
                Compile & Upload
              </Button>

              <Button
                variant="outline"
                onClick={() => setShowOutput(!showOutput)}
                className="flex items-center gap-2"
              >
                <FileText className="w-4 h-4" />
                {showOutput ? 'Hide' : 'Show'} Output
              </Button>
            </div>
          </div>
        </div>

        {/* Configuration Panel */}
        <div className="w-80 bg-card border-l border-border flex flex-col">
          <div className="p-4 border-b border-border">
            <h4 className="font-semibold text-foreground">Configuration</h4>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Board Selection */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Cpu className="w-4 h-4" />
                  Board
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <select
                  value={selectedBoard}
                  onChange={(e) => handleBoardChange(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-input rounded bg-background"
                >
                  {Object.entries(BOARD_DEFINITIONS).map(([id, board]) => (
                    <option key={id} value={id}>
                      {board.name}
                    </option>
                  ))}
                </select>

                {currentBoard && (
                  <div className="text-xs space-y-1">
                    <div><strong>MCU:</strong> {currentBoard.mcu}</div>
                    <div><strong>Frequency:</strong> {(currentBoard.frequency / 1000000).toFixed(0)}MHz</div>
                    <div><strong>Flash:</strong> {(currentBoard.flash / 1024).toFixed(0)}KB</div>
                    <div><strong>RAM:</strong> {(currentBoard.ram / 1024).toFixed(1)}KB</div>
                    <div><strong>Voltage:</strong> {currentBoard.voltage}V</div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Port Selection */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Zap className="w-4 h-4" />
                  Port
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2">
                  <select
                    value={selectedPort}
                    onChange={(e) => setSelectedPort(e.target.value)}
                    className="flex-1 px-3 py-2 text-sm border border-input rounded bg-background"
                  >
                    <option value="">Select Port</option>
                    {availablePorts.map(port => (
                      <option key={port} value={port}>
                        {port}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={loadAvailablePorts}
                    className="h-8 w-8"
                  >
                    <RefreshCw className="w-3 h-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Compilation Status */}
            {compilationResult && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    {compilationResult.success ? (
                      <CheckCircle className="w-4 h-4 text-green-500" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-red-500" />
                    )}
                    Compilation
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-xs space-y-1">
                    <div className="flex justify-between">
                      <span>Status:</span>
                      <span className={compilationResult.success ? 'text-green-600' : 'text-red-600'}>
                        {compilationResult.success ? 'Success' : 'Failed'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Time:</span>
                      <span>{compilationResult.compilationTime}ms</span>
                    </div>
                    {compilationResult.success && (
                      <>
                        <div className="flex justify-between">
                          <span>Binary Size:</span>
                          <span>{compilationResult.binarySize} bytes</span>
                        </div>
                        <div className="space-y-1">
                          <div className="flex justify-between text-xs">
                            <span>Flash:</span>
                            <span>{compilationResult.memoryUsage.flash.percentage.toFixed(1)}%</span>
                          </div>
                          <div className="w-full bg-muted rounded-full h-2">
                            <div
                              className="bg-blue-500 h-2 rounded-full"
                              style={{ width: `${Math.min(compilationResult.memoryUsage.flash.percentage, 100)}%` }}
                            />
                          </div>
                          <div className="flex justify-between text-xs">
                            <span>RAM:</span>
                            <span>{compilationResult.memoryUsage.ram.percentage.toFixed(1)}%</span>
                          </div>
                          <div className="w-full bg-muted rounded-full h-2">
                            <div
                              className="bg-green-500 h-2 rounded-full"
                              style={{ width: `${Math.min(compilationResult.memoryUsage.ram.percentage, 100)}%` }}
                            />
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  {compilationResult.errors.length > 0 && (
                    <div className="text-xs">
                      <div className="font-medium text-red-600 mb-1">Errors:</div>
                      <div className="bg-red-50 p-2 rounded text-red-700 max-h-20 overflow-y-auto">
                        {compilationResult.errors.map((error, index) => (
                          <div key={index}>{error}</div>
                        ))}
                      </div>
                    </div>
                  )}

                  {compilationResult.warnings.length > 0 && (
                    <div className="text-xs">
                      <div className="font-medium text-yellow-600 mb-1">Warnings:</div>
                      <div className="bg-yellow-50 p-2 rounded text-yellow-700 max-h-20 overflow-y-auto">
                        {compilationResult.warnings.map((warning, index) => (
                          <div key={index}>{warning}</div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Upload Status */}
            {uploadResult && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    {uploadResult.success ? (
                      <CheckCircle className="w-4 h-4 text-green-500" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-red-500" />
                    )}
                    Upload
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-xs space-y-1">
                    <div className="flex justify-between">
                      <span>Status:</span>
                      <span className={uploadResult.success ? 'text-green-600' : 'text-red-600'}>
                        {uploadResult.success ? 'Success' : 'Failed'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Time:</span>
                      <span>{uploadResult.uploadTime}ms</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Port:</span>
                      <span>{selectedPort}</span>
                    </div>
                  </div>

                  {uploadResult.error && (
                    <div className="text-xs">
                      <div className="font-medium text-red-600 mb-1">Error:</div>
                      <div className="bg-red-50 p-2 rounded text-red-700">
                        {uploadResult.error}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Libraries */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Settings className="w-4 h-4" />
                  Libraries
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-32 overflow-y-auto">
                  {installedLibraries.map(library => (
                    <div key={library.name} className="text-xs p-2 bg-muted/30 rounded">
                      <div className="font-medium">{library.name}</div>
                      <div className="text-muted-foreground">v{library.version}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* System Info */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  System
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs space-y-1">
                {arduinoIDEVersion && (
                  <div className="flex justify-between">
                    <span>Arduino IDE:</span>
                    <span>v{arduinoIDEVersion}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>Compiler:</span>
                  <span>avr-gcc</span>
                </div>
                <div className="flex justify-between">
                  <span>Platform:</span>
                  <span>{currentBoard?.architecture}</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Output Panel */}
        {showOutput && (
          <div className="w-96 bg-card border-l border-border flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h4 className="font-semibold text-foreground">Output</h4>
              <Button variant="ghost" size="icon" onClick={() => setShowOutput(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              <div className="font-mono text-xs space-y-2">
                {compilationResult && (
                  <div className="bg-muted p-3 rounded">
                    <div className="font-medium mb-2">Compilation Output:</div>
                    <pre className="whitespace-pre-wrap">{compilationResult.output}</pre>
                  </div>
                )}

                {uploadResult && (
                  <div className="bg-muted p-3 rounded">
                    <div className="font-medium mb-2">Upload Output:</div>
                    <pre className="whitespace-pre-wrap">{uploadResult.output}</pre>
                  </div>
                )}

                {!compilationResult && !uploadResult && (
                  <div className="text-muted-foreground text-center py-8">
                    Output will appear here after compilation or upload
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}