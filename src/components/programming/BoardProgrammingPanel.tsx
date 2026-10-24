import { useState, useEffect, useCallback } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { describeError } from '../../lib/utils';
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
  CompilationResult,
  UploadResult,
  CODE_TEMPLATES,
  ArduinoIDEIntegration
} from '../../lib/programming/boardProgrammer';
import { compilerManager } from '../../lib/compilation/compiler';
import { useProjectStore } from '../../stores/useProjectStore';
import { useDemoRequest } from '../workspace/useDemoRequest';

interface BoardProgrammingPanelProps {
  onClose: () => void;
}

export default function BoardProgrammingPanel({ onClose }: BoardProgrammingPanelProps) {
  const { firmwareCode, setFirmwareCode } = useProjectStore()
  const [selectedBoard, setSelectedBoard] = useState<string>('arduino_uno');
  const [availablePorts, setAvailablePorts] = useState<string[]>([]);
  const [selectedPort, setSelectedPort] = useState<string>('');
  const [code, setCode] = useState<string>(firmwareCode || CODE_TEMPLATES.basic);
  const [isCompiling, setIsCompiling] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [compilationResult, setCompilationResult] = useState<CompilationResult | null>(null);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('basic');
  const [showOutput, setShowOutput] = useState(false);
  const [installedLibraries, setInstalledLibraries] = useState<Array<{ name: string; version: string; description: string }>>([]);
  const [arduinoIDEVersion, setArduinoIDEVersion] = useState<string | null>(null);
  const [toolchainError, setToolchainError] = useState<string | null>(null);
  const [schematicNotice, setSchematicNotice] = useState<string | null>(null);

  /*
   * Loaders are stable callbacks declared before the effect that uses them, so
   * the effect's dependency array is exactly what it reads.
   */
  const loadAvailablePorts = useCallback(async () => {
    try {
      const ports = await boardProgrammer.getAvailablePorts();
      setAvailablePorts(ports);
      setSelectedPort((current) => (current || ports.length === 0 ? current : ports[0]));
    } catch (error) {
      setToolchainError(`Could not enumerate serial ports: ${describeError(error)}`);
    }
  }, []);

  const loadInstalledLibraries = useCallback(async () => {
    try {
      setInstalledLibraries(await boardProgrammer.getInstalledLibraries());
    } catch (error) {
      setToolchainError(`Could not read the installed library index: ${describeError(error)}`);
    }
  }, []);

  const checkArduinoIDE = useCallback(async () => {
    try {
      setArduinoIDEVersion(await ArduinoIDEIntegration.getArduinoIDEVersion());
    } catch (error) {
      setToolchainError(`Could not detect the Arduino toolchain: ${describeError(error)}`);
    }
  }, []);

  useEffect(() => {
    boardProgrammer.setBoard(selectedBoard);
    void loadAvailablePorts();
    void loadInstalledLibraries();
    void checkArduinoIDE();
  }, [selectedBoard, loadAvailablePorts, loadInstalledLibraries, checkArduinoIDE]);

  const handleBoardChange = (boardId: string) => {
    setSelectedBoard(boardId);
    boardProgrammer.setBoard(boardId);
    setCompilationResult(null);
    setUploadResult(null);
  };

  const handleTemplateChange = (template: string) => {
    setSelectedTemplate(template);
    // The rectifier companion is a real, proven sketch — pull it from the
    // demo module rather than shipping a second copy here.
    if (template === 'demo_rectifier') {
      void import('../../lib/demo/demoFirmware').then((m) => {
        handleCodeChange(m.DEMO_SKETCH);
        setToolchainError(null);
      });
      return;
    }
    const next = CODE_TEMPLATES[template as keyof typeof CODE_TEMPLATES] || CODE_TEMPLATES.basic
    setCode(next);
    setFirmwareCode(next);
  };

  const handleCodeChange = (next: string) => {
    setCode(next);
    setFirmwareCode(next);
    setSchematicNotice(null);
  };

  useDemoRequest('embedded-rectifier', () => handleTemplateChange('demo_rectifier'));

  /** Generate a sketch from the schematic netlist into the editor. */
  const handleGenerateFromSchematic = async () => {
    setSchematicNotice(null);
    setToolchainError(null);
    const { components, wires } = useProjectStore.getState();
    if (components.length === 0) {
      setToolchainError('The schematic is empty, so there is nothing to generate firmware from.');
      return;
    }

    const target = compilerManager.getTargetsForBoard(selectedBoard)[0];
    if (!target) {
      setToolchainError(`No schematic compiler supports the board "${selectedBoard}".`);
      return;
    }

    // The canvas stores the library record; the compiler works on the schematic
    // domain type, so adapt the shape instead of casting across models.
    const placedComponents = components.map((placed) => {
      const source = placed.component;
      return {
        id: placed.id,
        name: placed.reference || source.name,
        category: source.category,
        symbol: {
          width: source.symbol_data?.width ?? 0,
          height: source.symbol_data?.height ?? 0,
          paths: source.symbol_data?.paths ?? [],
        },
        pins: source.pins,
        properties: placed.properties,
      };
    });
    const result = await compilerManager.compile(placedComponents, wires, [], {
      target: target.id,
      optimization: 'balanced',
      debug: false,
      warnings: true,
      includes: [],
      defines: {},
      libraries: [],
    });

    if (!result.success) {
      const detail = result.errors.map((error) => error.message).join('; ');
      setToolchainError(`Schematic compilation failed: ${detail || 'unknown error'}`);
      return;
    }

    handleCodeChange(result.code);
    setCompilationResult(null);
    setUploadResult(null);
    setSchematicNotice(
      `Generated ${result.code.length} characters for ${target.name}. Review the pin notes in the sketch before flashing.`,
    );
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

  const [serialStatus, setSerialStatus] = useState<string>('No serial port connected.')

  const handleConnectSerial = useCallback(async () => {
    try {
      const { WebSerialBridge } = await import('../../lib/hardware/hardwareInterfaces')
      const bridge = new WebSerialBridge()
      if (!bridge.isAvailable) {
        setSerialStatus('WebSerial is not available in this browser — use Chrome or Edge over USB.')
        return
      }
      const granted = await bridge.requestPort()
      if (!granted) {
        setSerialStatus('Serial port request was declined.')
        return
      }
      const opened = await bridge.open({ baudRate: 115200 })
      if (!opened) {
        setSerialStatus('Could not open the serial port at 115200 baud.')
        return
      }
      boardProgrammer.setBrowserTransport(bridge)
      setSelectedPort('webserial')
      setSerialStatus('Serial port connected at 115200 baud — upload is live.')
    } catch (error) {
      setSerialStatus(`Serial connect failed: ${describeError(error)}`)
    }
  }, [])

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
    setIsCompiling(true);
    setCompilationResult(null);
    setShowOutput(true);
    try {
      const result = await boardProgrammer.compileSketch(code);
      setCompilationResult(result);
      if (result.success && selectedPort) {
        setIsUploading(true);
        try {
          setUploadResult(await boardProgrammer.uploadSketch(selectedPort));
        } finally {
          setIsUploading(false);
        }
      } else if (result.success && !selectedPort) {
        setToolchainError('No serial port is available in this browser build, so upload cannot proceed.');
      }
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
          handleCodeChange(e.target?.result as string || '');
        };
        reader.readAsText(file);
      }
    };
    input.click();
  };

  const currentBoard = BOARD_DEFINITIONS[selectedBoard];

  return (
    <div className="fixed inset-0 bg-overlay/70 flex items-center justify-center z-50">
      <div className="app-panel flex max-h-[92dvh] w-full max-w-7xl flex-col overflow-y-auto rounded-xl border border-border shadow-2xl lg:h-[90vh] lg:flex-row lg:overflow-hidden">
        {/* Code Editor */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="app-panel-header">
            <h3 className="font-semibold text-surface-foreground">Arduino Programming</h3>
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
              <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close board programming panel">
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Toolchain problems are surfaced, never swallowed into the console. */}
          {toolchainError && (
            <div
              role="alert"
              className="flex items-start justify-between gap-3 border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-xs text-destructive"
            >
              <span className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {toolchainError}
              </span>
              <button
                type="button"
                onClick={() => {
                  setToolchainError(null);
                  void loadAvailablePorts();
                  void loadInstalledLibraries();
                  void checkArduinoIDE();
                }}
                className="flex shrink-0 items-center gap-1 font-medium underline underline-offset-2"
              >
                <RefreshCw className="h-3 w-3" />
                Retry
              </button>
            </div>
          )}

          {/* Template Selection */}
          <div className="border-b border-border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">Template:</span>
              <select
                aria-label="Firmware template"
                value={selectedTemplate}
                onChange={(e) => handleTemplateChange(e.target.value)}
                className="min-w-0 flex-1 basis-40 px-3 py-1 text-sm border border-input rounded bg-background"
              >
                <option value="basic">Basic Blink</option>
                <option value="demo_rectifier">Demo rectifier companion (tested)</option>
                <option value="sensor_reading">Sensor Reading</option>
                <option value="servo_control">Servo Control</option>
                <option value="wifi_connection">WiFi Connection</option>
              </select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void import('../../lib/demo/demoFirmware').then((m) => {
                    handleCodeChange(m.DEMO_SKETCH);
                    setSelectedTemplate('demo_rectifier');
                    setToolchainError(null);
                  });
                }}
              >
                Load demo firmware
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleGenerateFromSchematic()}
                className="flex items-center gap-2"
              >
                <Cpu className="w-3 h-3" />
                Generate from schematic
              </Button>
            </div>
            {schematicNotice && (
              <p role="status" className="mt-2 text-xs text-muted-foreground">
                {schematicNotice}
              </p>
            )}
          </div>

          <div className="flex min-h-0 flex-1 gap-0 p-4">
            <div
              aria-hidden="true"
              className="cad-code-gutter select-none overflow-hidden rounded-l-md border border-r-0 border-input bg-muted/40 px-2 py-4 text-right font-mono text-xs leading-6 text-muted-foreground"
            >
              {code.split('\n').map((_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
            <textarea
              value={code}
              onChange={(e) => handleCodeChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Tab') {
                  e.preventDefault();
                  const el = e.currentTarget;
                  const start = el.selectionStart;
                  const end = el.selectionEnd;
                  handleCodeChange(code.slice(0, start) + '  ' + code.slice(end));
                  requestAnimationFrame(() => {
                    el.selectionStart = el.selectionEnd = start + 2;
                  });
                }
              }}
              wrap="off"
              className="cad-code-area max-h-72 min-h-56 w-full flex-1 resize-y overflow-auto sm:min-h-72 rounded-r-md border border-input bg-background p-4 font-mono text-sm leading-6 text-foreground focus:border-transparent focus:ring-2 focus:ring-ring"
              placeholder="Enter your Arduino code here..."
              spellCheck={false}
              aria-label="Firmware source code"
            />
          </div>

          {/* Action Buttons */}
          <div className="p-4 border-t border-border">
            <div className="flex flex-wrap items-center gap-2">
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
        <div className="flex w-full flex-shrink-0 flex-col border-t border-border bg-card lg:max-h-none lg:w-80 lg:border-l lg:border-t-0">
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
                  aria-label="Target board"
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
                    aria-label="Serial port"
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
                   aria-label="Refresh serial ports">
                    <RefreshCw className="w-3 h-3" />
                  </Button>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Button variant="default" size="sm" onClick={handleConnectSerial}>
                    Connect serial (WebSerial)
                  </Button>
                  <span className="text-xs text-muted-foreground">{serialStatus}</span>
                </div>
              </CardContent>
            </Card>

            {/* Compilation Status */}
            {compilationResult && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    {compilationResult.success ? (
                      <CheckCircle className="w-4 h-4 text-success" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-destructive" />
                    )}
                    Compilation
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-xs space-y-1">
                    <div className="flex justify-between">
                      <span>Status:</span>
                      <span className={compilationResult.success ? 'text-success' : 'text-destructive'}>
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
                              className="bg-primary h-2 rounded-full"
                              style={{ width: `${Math.min(compilationResult.memoryUsage.flash.percentage, 100)}%` }}
                            />
                          </div>
                          <div className="flex justify-between text-xs">
                            <span>RAM:</span>
                            <span>{compilationResult.memoryUsage.ram.percentage.toFixed(1)}%</span>
                          </div>
                          <div className="w-full bg-muted rounded-full h-2">
                            <div
                              className="bg-success h-2 rounded-full"
                              style={{ width: `${Math.min(compilationResult.memoryUsage.ram.percentage, 100)}%` }}
                            />
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  {compilationResult.errors.length > 0 && (
                    <div className="text-xs">
                      <div className="font-medium text-destructive mb-1">Errors:</div>
                      <div className="bg-destructive/10 p-2 rounded text-destructive max-h-20 overflow-y-auto">
                        {compilationResult.errors.map((error, index) => (
                          <div key={index}>{error}</div>
                        ))}
                      </div>
                    </div>
                  )}

                  {compilationResult.warnings.length > 0 && (
                    <div className="text-xs">
                      <div className="font-medium text-warning mb-1">Warnings:</div>
                      <div className="bg-warning/10 p-2 rounded text-warning max-h-20 overflow-y-auto">
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
                      <CheckCircle className="w-4 h-4 text-success" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-destructive" />
                    )}
                    Upload
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-xs space-y-1">
                    <div className="flex justify-between">
                      <span>Status:</span>
                      <span className={uploadResult.success ? 'text-success' : 'text-destructive'}>
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
                      <div className="font-medium text-destructive mb-1">Error:</div>
                      <div className="bg-destructive/10 p-2 rounded text-destructive">
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
          <div className="flex max-h-[35%] w-full flex-shrink-0 flex-col border-t border-border bg-card lg:max-h-none lg:w-96 lg:border-l lg:border-t-0">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h4 className="font-semibold text-foreground">Output</h4>
              <Button variant="ghost" size="icon" onClick={() => setShowOutput(false)} aria-label="Close output panel">
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