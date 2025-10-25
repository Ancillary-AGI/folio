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
  EdgeTypes
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { 
  Play, 
  Pause, 
  Square, 
  Download, 
  Upload, 
  Code, 
  Zap, 
  Settings,
  X,
  Plus,
  Trash2,
  Copy
} from 'lucide-react';

interface VisualProgrammingEditorProps {
  onClose: () => void;
}

// Custom node types
const InputNode = ({ data }: { data: any }) => (
  <div className="px-4 py-2 shadow-md rounded-md bg-blue-500 text-white border-2 border-blue-600">
    <div className="flex items-center">
      <div className="ml-2">
        <div className="text-lg font-bold">{data.label}</div>
        <div className="text-sm">{data.type}</div>
      </div>
    </div>
  </div>
);

const OutputNode = ({ data }: { data: any }) => (
  <div className="px-4 py-2 shadow-md rounded-md bg-green-500 text-white border-2 border-green-600">
    <div className="flex items-center">
      <div className="ml-2">
        <div className="text-lg font-bold">{data.label}</div>
        <div className="text-sm">{data.type}</div>
      </div>
    </div>
  </div>
);

const ProcessNode = ({ data }: { data: any }) => (
  <div className="px-4 py-2 shadow-md rounded-md bg-purple-500 text-white border-2 border-purple-600">
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

const ConditionNode = ({ data }: { data: any }) => (
  <div className="px-4 py-2 shadow-md rounded-md bg-yellow-500 text-white border-2 border-yellow-600">
    <div className="flex items-center">
      <div className="ml-2">
        <div className="text-lg font-bold">{data.label}</div>
        <div className="text-sm">{data.condition}</div>
      </div>
    </div>
  </div>
);

const LoopNode = ({ data }: { data: any }) => (
  <div className="px-4 py-2 shadow-md rounded-md bg-red-500 text-white border-2 border-red-600">
    <div className="flex items-center">
      <div className="ml-2">
        <div className="text-lg font-bold">{data.label}</div>
        <div className="text-sm">{data.loopType}</div>
        <div className="text-xs">Iterations: {data.iterations || 'N/A'}</div>
      </div>
    </div>
  </div>
);

const FunctionNode = ({ data }: { data: any }) => (
  <div className="px-4 py-2 shadow-md rounded-md bg-indigo-500 text-white border-2 border-indigo-600">
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
    { type: 'input', label: 'Digital Input', icon: '📥', data: { type: 'digital', pin: 2 } },
    { type: 'input', label: 'Analog Input', icon: '📊', data: { type: 'analog', pin: 'A0' } },
    { type: 'output', label: 'Digital Output', icon: '📤', data: { type: 'digital', pin: 13 } },
    { type: 'output', label: 'PWM Output', icon: '〰️', data: { type: 'pwm', pin: 9 } },
    { type: 'output', label: 'Serial Print', icon: '🖨️', data: { type: 'serial' } },
  ],
  'Logic': [
    { type: 'condition', label: 'If Statement', icon: '❓', data: { condition: 'if (condition)' } },
    { type: 'condition', label: 'If-Else', icon: '⚖️', data: { condition: 'if-else' } },
    { type: 'process', label: 'AND Gate', icon: '&', data: { operation: 'AND' } },
    { type: 'process', label: 'OR Gate', icon: '|', data: { operation: 'OR' } },
    { type: 'process', label: 'NOT Gate', icon: '!', data: { operation: 'NOT' } },
  ],
  'Math': [
    { type: 'process', label: 'Add', icon: '+', data: { operation: 'add' } },
    { type: 'process', label: 'Subtract', icon: '-', data: { operation: 'subtract' } },
    { type: 'process', label: 'Multiply', icon: '×', data: { operation: 'multiply' } },
    { type: 'process', label: 'Divide', icon: '÷', data: { operation: 'divide' } },
    { type: 'process', label: 'Map', icon: '🗺️', data: { operation: 'map', parameters: { fromLow: 0, fromHigh: 1023, toLow: 0, toHigh: 255 } } },
  ],
  'Control': [
    { type: 'loop', label: 'For Loop', icon: '🔄', data: { loopType: 'for', iterations: 10 } },
    { type: 'loop', label: 'While Loop', icon: '⏳', data: { loopType: 'while' } },
    { type: 'process', label: 'Delay', icon: '⏱️', data: { operation: 'delay', parameters: { ms: 1000 } } },
    { type: 'process', label: 'Wait Until', icon: '⏸️', data: { operation: 'waitUntil' } },
  ],
  'Functions': [
    { type: 'function', label: 'Custom Function', icon: '🔧', data: { functionName: 'myFunction', inputs: ['param1'] } },
    { type: 'function', label: 'Setup', icon: '🚀', data: { functionName: 'setup', inputs: [] } },
    { type: 'function', label: 'Loop', icon: '♾️', data: { functionName: 'loop', inputs: [] } },
  ],
  'Sensors': [
    { type: 'input', label: 'Temperature', icon: '🌡️', data: { type: 'temperature', sensor: 'DHT22' } },
    { type: 'input', label: 'Ultrasonic', icon: '📡', data: { type: 'ultrasonic', trigPin: 7, echoPin: 8 } },
    { type: 'input', label: 'Accelerometer', icon: '📱', data: { type: 'accelerometer', sensor: 'MPU6050' } },
    { type: 'input', label: 'Light Sensor', icon: '💡', data: { type: 'light', pin: 'A1' } },
  ],
  'Actuators': [
    { type: 'output', label: 'Servo Motor', icon: '🔄', data: { type: 'servo', pin: 9 } },
    { type: 'output', label: 'DC Motor', icon: '⚙️', data: { type: 'dcMotor', pin1: 3, pin2: 4 } },
    { type: 'output', label: 'Stepper Motor', icon: '🎯', data: { type: 'stepper', pins: [8, 9, 10, 11] } },
    { type: 'output', label: 'Buzzer', icon: '🔊', data: { type: 'buzzer', pin: 12 } },
  ]
};

export default function VisualProgrammingEditor({ onClose }: VisualProgrammingEditorProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('Input/Output');
  const [generatedCode, setGeneratedCode] = useState('');
  const [showCode, setShowCode] = useState(false);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);

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

  const onDragStart = (event: React.DragEvent, nodeType: string, blockData: any) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.setData('application/json', JSON.stringify(blockData));
    event.dataTransfer.effectAllowed = 'move';
  };

  const generateArduinoCode = () => {
    let code = '// Generated Arduino Code\n\n';
    
    // Add includes and setup
    code += '#include <Servo.h>\n';
    code += '#include <DHT.h>\n\n';
    
    // Variable declarations
    const servos = nodes.filter(n => n.data.type === 'servo');
    servos.forEach((servo, index) => {
      code += `Servo servo${index};\n`;
    });
    
    code += '\nvoid setup() {\n';
    code += '  Serial.begin(9600);\n';
    
    // Setup pins
    nodes.forEach(node => {
      if (node.type === 'input' && node.data.type === 'digital') {
        code += `  pinMode(${node.data.pin}, INPUT);\n`;
      } else if (node.type === 'output' && node.data.type === 'digital') {
        code += `  pinMode(${node.data.pin}, OUTPUT);\n`;
      } else if (node.data.type === 'servo') {
        const servoIndex = servos.findIndex(s => s.id === node.id);
        code += `  servo${servoIndex}.attach(${node.data.pin});\n`;
      }
    });
    
    code += '}\n\n';
    
    code += 'void loop() {\n';
    
    // Generate main loop code based on node connections
    const processedNodes = new Set<string>();
    const startNodes = nodes.filter(n => n.type === 'function' && n.data.functionName === 'loop');
    
    if (startNodes.length === 0) {
      // If no loop function, process all nodes
      nodes.forEach(node => {
        if (!processedNodes.has(node.id)) {
          code += generateNodeCode(node, nodes, edges);
          processedNodes.add(node.id);
        }
      });
    }
    
    code += '  delay(100); // Small delay to prevent overwhelming the system\n';
    code += '}\n';
    
    setGeneratedCode(code);
    setShowCode(true);
  };

  const generateNodeCode = (node: Node, allNodes: Node[], allEdges: Edge[]): string => {
    let code = '';
    
    switch (node.type) {
      case 'input':
        if (node.data.type === 'digital') {
          code += `  int ${node.id}_value = digitalRead(${node.data.pin});\n`;
        } else if (node.data.type === 'analog') {
          code += `  int ${node.id}_value = analogRead(${node.data.pin});\n`;
        }
        break;
        
      case 'output':
        if (node.data.type === 'digital') {
          code += `  digitalWrite(${node.data.pin}, HIGH);\n`;
        } else if (node.data.type === 'pwm') {
          code += `  analogWrite(${node.data.pin}, 128);\n`;
        }
        break;
        
      case 'process':
        if (node.data.operation === 'delay') {
          code += `  delay(${node.data.parameters?.ms || 1000});\n`;
        }
        break;
        
      case 'condition':
        code += `  if (condition) {\n`;
        code += `    // Condition body\n`;
        code += `  }\n`;
        break;
        
      case 'loop':
        if (node.data.loopType === 'for') {
          code += `  for (int i = 0; i < ${node.data.iterations || 10}; i++) {\n`;
          code += `    // Loop body\n`;
          code += `  }\n`;
        }
        break;
    }
    
    return code;
  };

  const handleRunProgram = () => {
    setIsRunning(true);
    generateArduinoCode();
    // In a real implementation, this would compile and upload to Arduino
    setTimeout(() => setIsRunning(false), 2000);
  };

  const handleStopProgram = () => {
    setIsRunning(false);
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-7xl h-[90vh] flex">
        {/* Block Palette */}
        <div className="w-80 bg-card border-r border-border flex flex-col">
          <div className="flex items-center justify-between p-4 border-b border-border">
            <h3 className="font-semibold text-foreground">Block Palette</h3>
            <Button variant="ghost" size="icon" onClick={onClose}>
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
                      {block.data.operation || block.data.type || block.data.functionName}
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
                disabled={isRunning}
                className="flex-1 flex items-center gap-2"
                variant={isRunning ? 'destructive' : 'default'}
              >
                {isRunning ? (
                  <>
                    <Pause className="w-4 h-4" />
                    Running...
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" />
                    Run
                  </>
                )}
              </Button>
              
              {isRunning && (
                <Button
                  onClick={handleStopProgram}
                  variant="destructive"
                  size="icon"
                >
                  <Square className="w-4 h-4" />
                </Button>
              )}
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
        <div className="flex-1 relative" ref={reactFlowWrapper}>
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
            <MiniMap />
            <Background variant={BackgroundVariant.Dots} gap={12} size={1} />
          </ReactFlow>

          {/* Status Overlay */}
          <div className="absolute top-4 right-4 bg-card/90 backdrop-blur-sm p-3 rounded-lg border border-border">
            <div className="text-sm space-y-1">
              <div>Blocks: {nodes.length}</div>
              <div>Connections: {edges.length}</div>
              <div>Status: {isRunning ? 'Running' : 'Stopped'}</div>
            </div>
          </div>
        </div>

        {/* Code Preview Panel */}
        {showCode && (
          <div className="w-96 bg-card border-l border-border flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 className="font-semibold text-foreground">Generated Code</h3>
              <Button variant="ghost" size="icon" onClick={() => setShowCode(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4">
              <pre className="text-xs bg-muted p-4 rounded-lg overflow-x-auto">
                <code>{generatedCode}</code>
              </pre>
            </div>
            
            <div className="p-4 border-t border-border">
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