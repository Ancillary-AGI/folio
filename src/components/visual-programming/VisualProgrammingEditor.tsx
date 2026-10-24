import { useState, useRef, useCallback } from 'react';
import {
  ReactFlow,
  Node,
  Edge,
  addEdge,
  Connection,
  useNodesState,
  useEdgesState,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  NodeTypes,
  ReactFlowInstance
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Button } from '../ui/button';
import {
  Wrench,
  Download,
  Upload,
  Code,
  X,
  Copy
} from 'lucide-react';
import {
  analyseSource,
  buildFirmwareImage,
  describeImageCaveat,
} from '../../lib/compilation/compiler';
import { downloadFile } from '../../lib/exportUtils';
import { generateArduinoProgram } from '../../lib/programming/visualProgram';
import { useDemoRequest } from '../workspace/useDemoRequest';

interface VisualProgrammingEditorProps {
  onClose: () => void;
}

/** Result of the last real build (static analysis + firmware image). */
interface BuildReport {
  ok: boolean;
  flashEstimate: number;
  ramEstimate: number;
  imageBytes: number;
  baseAddress: number;
  hex: string;
  errors: string[];
  notes: Array<{ severity: 'warning' | 'info'; text: string }>;
}

interface NodeData {
  label: string;
  type?: string;
  operation?: string;
  condition?: string;
  loopType?: string;
  iterations?: number;
  functionName?: string;
  inputs?: string[];
  parameters?: Record<string, unknown>;
  pin?: number | string;
  sensor?: string;
  trigPin?: number;
  echoPin?: number;
  pin1?: number;
  pin2?: number;
  pins?: number[];
  ms?: number;
}

// Custom node types
const InputNode = ({ data }: { data: NodeData }) => (
  <div className="px-4 py-2 shadow-md rounded-md bg-primary text-primary-foreground border-2 border-primary">
    <div className="flex items-center">
      <div className="ml-2">
        <div className="text-lg font-bold">{data.label}</div>
        <div className="text-sm">{data.type}</div>
      </div>
    </div>
  </div>
);

const OutputNode = ({ data }: { data: NodeData }) => (
  <div className="px-4 py-2 shadow-md rounded-md bg-success text-success-foreground border-2 border-success">
    <div className="flex items-center">
      <div className="ml-2">
        <div className="text-lg font-bold">{data.label}</div>
        <div className="text-sm">{data.type}</div>
      </div>
    </div>
  </div>
);

const ProcessNode = ({ data }: { data: NodeData }) => (
  <div className="px-4 py-2 shadow-md rounded-md bg-info text-info-foreground border-2 border-info">
    <div className="flex items-center">
      <div className="ml-2">
        <div className="text-lg font-bold">{data.label}</div>
        <div className="text-sm">{data.operation}</div>
        {data.parameters && (
          <div className="text-xs mt-1">
            {Object.entries(data.parameters).map(([key, value]) => (
              <div key={key}>{key}: {String(value)}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  </div>
);

const ConditionNode = ({ data }: { data: NodeData }) => (
  <div className="px-4 py-2 shadow-md rounded-md bg-warning text-warning-foreground border-2 border-warning">
    <div className="flex items-center">
      <div className="ml-2">
        <div className="text-lg font-bold">{data.label}</div>
        <div className="text-sm">{data.condition}</div>
      </div>
    </div>
  </div>
);

const LoopNode = ({ data }: { data: NodeData }) => (
  <div className="px-4 py-2 shadow-md rounded-md bg-destructive text-destructive-foreground border-2 border-destructive">
    <div className="flex items-center">
      <div className="ml-2">
        <div className="text-lg font-bold">{data.label}</div>
        <div className="text-sm">{data.loopType}</div>
        <div className="text-xs">Iterations: {data.iterations || 'N/A'}</div>
      </div>
    </div>
  </div>
);

const FunctionNode = ({ data }: { data: NodeData }) => (
  <div className="px-4 py-2 shadow-md rounded-md bg-primary text-primary-foreground border-2 border-primary">
    <div className="flex items-center">
      <div className="ml-2">
        <div className="text-lg font-bold">{data.label}</div>
        <div className="text-sm">{data.functionName}</div>
        {data.inputs && (
          <div className="text-xs mt-1">
            Inputs: {data.inputs.join(', ')}
          </div>
        )}
      </div>
    </div>
  </div>
);

const nodeTypes: NodeTypes = {
  input: InputNode,
  output: OutputNode,
  process: ProcessNode,
  condition: ConditionNode,
  loop: LoopNode,
  function: FunctionNode,
};

// Block categories for the palette
const blockCategories = {
  'Input/Output': [
    { type: 'input', label: 'Digital Input', icon: 'DIN', data: { type: 'digital', pin: 2 } },
    { type: 'input', label: 'Analog Input', icon: 'AIN', data: { type: 'analog', pin: 'A0' } },
    { type: 'output', label: 'Digital Output', icon: 'DOUT', data: { type: 'digital', pin: 13 } },
    { type: 'output', label: 'PWM Output', icon: 'PWM', data: { type: 'pwm', pin: 9 } },
    { type: 'output', label: 'Serial Print', icon: 'UART', data: { type: 'serial' } },
  ],
  'Logic': [
    { type: 'condition', label: 'If Statement', icon: 'IF', data: { condition: 'if (condition)' } },
    { type: 'condition', label: 'If-Else', icon: 'IF/ELSE', data: { condition: 'if-else' } },
    { type: 'process', label: 'AND Gate', icon: '&', data: { operation: 'AND' } },
    { type: 'process', label: 'OR Gate', icon: '|', data: { operation: 'OR' } },
    { type: 'process', label: 'NOT Gate', icon: '!', data: { operation: 'NOT' } },
  ],
  'Math': [
    { type: 'process', label: 'Add', icon: '+', data: { operation: 'add' } },
    { type: 'process', label: 'Subtract', icon: '-', data: { operation: 'subtract' } },
    { type: 'process', label: 'Multiply', icon: '×', data: { operation: 'multiply' } },
    { type: 'process', label: 'Divide', icon: '÷', data: { operation: 'divide' } },
    { type: 'process', label: 'Map', icon: 'MAP', data: { operation: 'map', parameters: { fromLow: 0, fromHigh: 1023, toLow: 0, toHigh: 255 } } },
  ],
  'Control': [
    { type: 'loop', label: 'For Loop', icon: 'FOR', data: { loopType: 'for', iterations: 10 } },
    { type: 'loop', label: 'While Loop', icon: 'WHILE', data: { loopType: 'while' } },
    { type: 'process', label: 'Delay', icon: 'WAIT', data: { operation: 'delay', parameters: { ms: 1000 } } },
    { type: 'process', label: 'Wait Until', icon: 'UNTIL', data: { operation: 'waitUntil' } },
  ],
  'Functions': [
    { type: 'function', label: 'Custom Function', icon: 'FN', data: { functionName: 'myFunction', inputs: ['param1'] } },
    { type: 'function', label: 'Setup', icon: 'INIT', data: { functionName: 'setup', inputs: [] } },
    { type: 'function', label: 'Loop', icon: 'LOOP', data: { functionName: 'loop', inputs: [] } },
  ],
  'Sensors': [
    { type: 'input', label: 'Temperature', icon: 'TEMP', data: { type: 'temperature', sensor: 'DHT22' } },
    { type: 'input', label: 'Ultrasonic', icon: 'SONAR', data: { type: 'ultrasonic', trigPin: 7, echoPin: 8 } },
    { type: 'input', label: 'Accelerometer', icon: 'IMU', data: { type: 'accelerometer', sensor: 'MPU6050' } },
    { type: 'input', label: 'Light Sensor', icon: 'LIGHT', data: { type: 'light', pin: 'A1' } },
  ],
  'Actuators': [
    { type: 'output', label: 'Servo Motor', icon: 'SERVO', data: { type: 'servo', pin: 9 } },
    { type: 'output', label: 'DC Motor', icon: 'MOTOR', data: { type: 'dcMotor', pin1: 3, pin2: 4 } },
    { type: 'output', label: 'Stepper Motor', icon: 'STEP', data: { type: 'stepper', pins: [8, 9, 10, 11] } },
    { type: 'output', label: 'Buzzer', icon: 'BUZZ', data: { type: 'buzzer', pin: 12 } },
  ]
};

/**
 * The demo graph: a button drives an LED and an analog input drives a servo.
 * It is a normal editable graph, so the compiler sees the same data a user
 * would have built by hand.
 */
const DEMO_NODES: Node[] = [
  { id: 'loop', type: 'function', position: { x: 40, y: 30 }, data: { label: 'Loop', functionName: 'loop', inputs: [] } },
  { id: 'button', type: 'input', position: { x: 40, y: 150 }, data: { label: 'Digital Input', type: 'digital', pin: 2 } },
  { id: 'led', type: 'output', position: { x: 320, y: 150 }, data: { label: 'Digital Output', type: 'digital', pin: 13 } },
  { id: 'light', type: 'input', position: { x: 40, y: 280 }, data: { label: 'Analog Input', type: 'analog', pin: 'A0' } },
  { id: 'servo', type: 'output', position: { x: 320, y: 280 }, data: { label: 'Servo Motor', type: 'servo', pin: 9 } },
]

const DEMO_EDGES: Edge[] = [
  { id: 'e-loop-button', source: 'loop', target: 'button', animated: true },
  { id: 'e-button-led', source: 'button', target: 'led', animated: true },
  { id: 'e-light-servo', source: 'light', target: 'servo', animated: true },
]

function getBlockDescription(data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  const properties = data as Record<string, unknown>
  for (const key of ['operation', 'type', 'functionName']) {
    const value = properties[key]
    if (typeof value === 'string') return value
  }
  return ''
}

export default function VisualProgrammingEditor({ onClose }: VisualProgrammingEditorProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedCategory, setSelectedCategory] = useState('Input/Output');
  const [generatedCode, setGeneratedCode] = useState('');
  const [showCode, setShowCode] = useState(false);
  const [buildReport, setBuildReport] = useState<BuildReport | null>(null);

  useDemoRequest('visual-blocks', () => {
    setNodes(DEMO_NODES);
    setEdges(DEMO_EDGES);
    setGeneratedCode('');
    setShowCode(false);
    setBuildReport(null);
  });
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const reactFlowBounds = reactFlowWrapper.current?.getBoundingClientRect();
      const type = event.dataTransfer.getData('application/reactflow');
      const blockData = JSON.parse(event.dataTransfer.getData('application/json'));

      if (typeof type === 'undefined' || !type || !reactFlowBounds) {
        return;
      }

      if (!reactFlowInstance) return;

      const position = reactFlowInstance.project({
        x: event.clientX - reactFlowBounds.left,
        y: event.clientY - reactFlowBounds.top,
      });

      const newNode: Node = {
        id: `${type}-${Date.now()}`,
        type,
        position,
        data: { ...blockData.data, label: blockData.label },
      };

      setNodes((nds) => nds.concat(newNode));
    },
    [reactFlowInstance, setNodes]
  );

  const onDragStart = (event: React.DragEvent, nodeType: string, blockData: NodeData) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.setData('application/json', JSON.stringify(blockData));
    event.dataTransfer.effectAllowed = 'move';
  };

  const generateArduinoCode = () => {
    const code = generateArduinoProgram(nodes);
    setGeneratedCode(code);
    setShowCode(true);
    return code;
  };

  const handleRunProgram = () => {
    // A browser cannot flash hardware, so "Run" performs the real part of the
    // pipeline: generate the sketch, run the compiler's static checks, and build
    // a spec-correct firmware image. Results are reported verbatim below.
    const code = generateArduinoCode();
    const analysis = analyseSource(code, { requireSetupAndLoop: true });
    const image = buildFirmwareImage(code);

    setBuildReport({
      ok: analysis.errors.length === 0,
      flashEstimate: analysis.flashEstimate,
      ramEstimate: analysis.ramEstimate,
      imageBytes: image.imageBytes,
      baseAddress: image.baseAddress,
      hex: image.hex,
      errors: analysis.errors.map(error => `Line ${error.line}:${error.column} — ${error.message}`),
      notes: [
        ...analysis.warnings.map(warning => ({
          severity: warning.severity as 'warning' | 'info',
          text: `Line ${warning.line}:${warning.column} — ${warning.message}`,
        })),
        { severity: 'info' as const, text: describeImageCaveat() },
        {
          severity: 'info' as const,
          text: 'Uploading to a physical board requires a connected programmer — see the Arduino / HIL workspace.',
        },
      ],
    });
  };

  const handleDownloadHex = () => {
    if (!buildReport?.ok) return;
    downloadFile(buildReport.hex, 'visual_program.hex', 'text/plain');
  };

  const handleSaveProgram = () => {
    const programData = {
      nodes,
      edges,
      timestamp: Date.now(),
      name: 'Visual Program'
    };
    
    const dataStr = JSON.stringify(programData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'visual_program.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleLoadProgram = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const programData = JSON.parse(e.target?.result as string);
            setNodes(programData.nodes || []);
            setEdges(programData.edges || []);
          } catch (error) {
            console.error('Failed to load program:', error);
          }
        };
        reader.readAsText(file);
      }
    };
    input.click();
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background">
      <div className="flex h-full w-full flex-col overflow-hidden bg-card lg:flex-row">
        {/* Block Palette */}
        <div className="flex max-h-[38%] w-full flex-shrink-0 flex-col border-b border-border bg-card lg:max-h-none lg:w-80 lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between p-4 border-b border-border">
            <h3 className="font-semibold text-foreground">Block Palette</h3>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close visual programming editor">
              <X className="w-4 h-4" />
            </Button>
          </div>

          {/* Category Tabs */}
          <div className="border-b border-border">
            <div className="flex flex-wrap gap-1 p-2">
              {Object.keys(blockCategories).map(category => (
                <Button
                  key={category}
                  variant={selectedCategory === category ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setSelectedCategory(category)}
                  className="text-xs"
                >
                  {category}
                </Button>
              ))}
            </div>
          </div>

          {/* Blocks */}
          <div className="flex-1 overflow-y-auto p-4">
            <div className="space-y-2">
              {blockCategories[selectedCategory as keyof typeof blockCategories]?.map((block, index) => (
                <div
                  key={index}
                  className="flex items-center gap-3 p-3 border border-border rounded-lg cursor-grab hover:bg-accent transition-colors"
                  draggable
                  onDragStart={(event) => onDragStart(event, block.type, block)}
                >
                  <span className="text-lg">{block.icon}</span>
                  <div>
                    <div className="font-medium text-sm">{block.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {getBlockDescription(block.data)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Controls */}
          <div className="p-4 border-t border-border space-y-2">
            <div className="flex gap-2">
              <Button
                onClick={handleRunProgram}
                className="flex-1 flex items-center gap-2"
                variant={buildReport && !buildReport.ok ? 'destructive' : 'default'}
              >
                <Wrench className="w-4 h-4" />
                Build &amp; Verify
              </Button>
            </div>
            
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleLoadProgram}
                className="flex-1 flex items-center gap-2"
              >
                <Upload className="w-3 h-3" />
                Load
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSaveProgram}
                className="flex-1 flex items-center gap-2"
              >
                <Download className="w-3 h-3" />
                Save
              </Button>
            </div>
            
            <Button
              variant="outline"
              size="sm"
              onClick={generateArduinoCode}
              className="w-full flex items-center gap-2"
            >
              <Code className="w-3 h-3" />
              Generate Code
            </Button>
          </div>
        </div>

        {/* Visual Programming Canvas */}
        <div className="relative min-h-0 flex-1" ref={reactFlowWrapper}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onInit={setReactFlowInstance}
            onDrop={onDrop}
            onDragOver={onDragOver}
            nodeTypes={nodeTypes}
            fitView
          >
            <Controls />
            <MiniMap
              style={{ backgroundColor: 'hsl(var(--card))', width: 128, height: 88 }}
              maskColor="hsl(var(--background) / 0.65)"
              nodeColor="hsl(var(--muted-foreground))"
              nodeStrokeColor="hsl(var(--border))"
            />
            <Background variant={BackgroundVariant.Dots} gap={12} size={1} />
          </ReactFlow>

          {/* Status Overlay */}
          <div className="absolute top-4 right-4 bg-card/90 backdrop-blur-sm p-3 rounded-lg border border-border">
            <div className="text-sm space-y-1">
              <div>Blocks: {nodes.length}</div>
              <div>Connections: {edges.length}</div>
              <div>
                Status:{' '}
                {buildReport
                  ? buildReport.ok
                    ? 'Build OK'
                    : 'Build failed'
                  : 'Not built'}
              </div>
              {buildReport && <div>Flash ≈ {buildReport.flashEstimate} B</div>}
            </div>
          </div>
        </div>

        {/* Code Preview Panel */}
        {showCode && (
          <div className="flex max-h-[35%] w-full flex-shrink-0 flex-col border-t border-border bg-card lg:max-h-none lg:w-96 lg:border-l lg:border-t-0">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 className="font-semibold text-foreground">Generated Code</h3>
              <Button variant="ghost" size="icon" onClick={() => setShowCode(false)} aria-label="Close code view">
                <X className="w-4 h-4" />
              </Button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4">
              {buildReport && (
                <div className="mb-3 space-y-1 text-xs">
                  <div className={buildReport.ok ? 'text-success font-medium' : 'text-destructive font-medium'}>
                    {buildReport.ok
                      ? `Static checks passed — image ${buildReport.imageBytes} bytes at 0x${buildReport.baseAddress
                          .toString(16)
                          .toUpperCase()
                          .padStart(4, '0')}, flash ≈ ${buildReport.flashEstimate} B, RAM ≈ ${buildReport.ramEstimate} B`
                      : `Static checks failed — ${buildReport.errors.length} error(s)`}
                  </div>
                  {buildReport.errors.map((error, index) => (
                    <div key={`error-${index}`} className="text-destructive">{error}</div>
                  ))}
                  {buildReport.notes.map((note, index) => (
                    <div
                      key={`note-${index}`}
                      className={note.severity === 'warning' ? 'text-warning' : 'text-muted-foreground'}
                    >
                      {note.text}
                    </div>
                  ))}
                </div>
              )}
              <pre className="text-xs bg-muted p-4 rounded-lg overflow-x-auto">
                <code>{generatedCode}</code>
              </pre>
            </div>
            
            <div className="p-4 border-t border-border space-y-2">
              {buildReport?.ok && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadHex}
                  className="w-full flex items-center gap-2"
                >
                  <Download className="w-3 h-3" />
                  Download HEX
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  navigator.clipboard.writeText(generatedCode);
                }}
                className="w-full flex items-center gap-2"
              >
                <Copy className="w-3 h-3" />
                Copy Code
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}