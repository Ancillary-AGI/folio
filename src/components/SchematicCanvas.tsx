import React, { useRef, useState, useEffect } from 'react';
import { Component } from '../lib/supabase';

interface CanvasComponent {
  id: string;
  componentId: string;
  component: Component;
  x: number;
  y: number;
  rotation: number;
  reference: string;
  properties: Record<string, any>;
}

interface CanvasWire {
  id: string;
  points: Array<{ x: number; y: number }>;
  netName?: string;
}

interface SchematicCanvasProps {
  components: Component[];
  onSave?: (data: { components: CanvasComponent[]; wires: CanvasWire[] }) => void;
}

export default function SchematicCanvas({ components, onSave }: SchematicCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [placedComponents, setPlacedComponents] = useState<CanvasComponent[]>([]);
  const [wires, setWires] = useState<CanvasWire[]>([]);
  const [selectedComponent, setSelectedComponent] = useState<Component | null>(null);
  const [draggingComponent, setDraggingComponent] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [tool, setTool] = useState<'select' | 'wire' | 'delete'>('select');
  const [wirePoints, setWirePoints] = useState<Array<{ x: number; y: number }>>([]);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [hoveredComponent, setHoveredComponent] = useState<string | null>(null);
  const [componentCounter, setComponentCounter] = useState<Record<string, number>>({
    'Resistor': 1,
    'Capacitor': 1,
    'Inductor': 1,
    'Diode': 1,
    'LED': 1,
    'NPN Transistor': 1,
    'PNP Transistor': 1,
    'N-Channel MOSFET': 1,
    'DC Voltage Source': 1,
    'Ground': 1,
    'Op-Amp': 1,
    'Logic Gate AND': 1,
    'Logic Gate OR': 1,
    'Logic Gate NOT': 1,
    'Terminal': 1
  });

  const gridSize = 10;
  const canvasWidth = 2000;
  const canvasHeight = 1500;

  const snapToGrid = (value: number) => Math.round(value / gridSize) * gridSize;

  const getNextReference = (component: Component): string => {
    const prefixes: Record<string, string> = {
      'Resistor': 'R',
      'Capacitor': 'C',
      'Inductor': 'L',
      'Diode': 'D',
      'LED': 'LED',
      'NPN Transistor': 'Q',
      'PNP Transistor': 'Q',
      'N-Channel MOSFET': 'M',
      'DC Voltage Source': 'V',
      'Ground': 'GND',
      'Op-Amp': 'U',
      'Logic Gate AND': 'U',
      'Logic Gate OR': 'U',
      'Logic Gate NOT': 'U',
      'Terminal': 'TP'
    };

    const prefix = prefixes[component.name] || 'X';
    const num = componentCounter[component.name] || 1;
    setComponentCounter(prev => ({ ...prev, [component.name]: num + 1 }));
    return `${prefix}${num}`;
  };

  useEffect(() => {
    drawCanvas();
  }, [placedComponents, wires, pan, zoom, hoveredComponent, wirePoints, tool]);

  const drawCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    drawGrid(ctx);
    drawWires(ctx);
    drawPlacedComponents(ctx);

    if (tool === 'wire' && wirePoints.length > 0) {
      drawWirePreview(ctx);
    }

    ctx.restore();
  };

  const drawGrid = (ctx: CanvasRenderingContext2D) => {
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 0.5;

    for (let x = 0; x <= canvasWidth; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvasHeight);
      ctx.stroke();
    }

    for (let y = 0; y <= canvasHeight; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvasWidth, y);
      ctx.stroke();
    }

    ctx.strokeStyle = '#9ca3af';
    ctx.lineWidth = 1;

    for (let x = 0; x <= canvasWidth; x += gridSize * 10) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvasHeight);
      ctx.stroke();
    }

    for (let y = 0; y <= canvasHeight; y += gridSize * 10) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvasWidth, y);
      ctx.stroke();
    }
  };

  const drawWires = (ctx: CanvasRenderingContext2D) => {
    wires.forEach(wire => {
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      ctx.beginPath();
      wire.points.forEach((point, index) => {
        if (index === 0) {
          ctx.moveTo(point.x, point.y);
        } else {
          ctx.lineTo(point.x, point.y);
        }
      });
      ctx.stroke();

      wire.points.forEach(point => {
        ctx.fillStyle = '#10b981';
        ctx.beginPath();
        ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
        ctx.fill();
      });
    });
  };

  const drawWirePreview = (ctx: CanvasRenderingContext2D) => {
    if (wirePoints.length === 0) return;

    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    wirePoints.forEach((point, index) => {
      if (index === 0) {
        ctx.moveTo(point.x, point.y);
      } else {
        ctx.lineTo(point.x, point.y);
      }
    });
    ctx.stroke();
    ctx.setLineDash([]);

    wirePoints.forEach(point => {
      ctx.fillStyle = '#10b981';
      ctx.beginPath();
      ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
      ctx.fill();
    });
  };

  const drawPlacedComponents = (ctx: CanvasRenderingContext2D) => {
    placedComponents.forEach(comp => {
      ctx.save();
      ctx.translate(comp.x, comp.y);
      ctx.rotate((comp.rotation * Math.PI) / 180);

      const isHovered = hoveredComponent === comp.id;
      if (isHovered) {
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 2;
        const bounds = comp.component.symbol_data;
        ctx.strokeRect(-5, -5, bounds.width + 10, bounds.height + 10);
      }

      ctx.strokeStyle = '#1f2937';
      ctx.fillStyle = '#1f2937';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      comp.component.symbol_data.paths.forEach((path: string) => {
        const p = new Path2D(path);
        ctx.stroke(p);
      });

      comp.component.pins.forEach((pin: any) => {
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(pin.x, pin.y, 3, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.fillStyle = '#1f2937';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(comp.reference, comp.component.symbol_data.width / 2, -8);

      const valueText = comp.properties.value || '';
      if (valueText) {
        ctx.fillStyle = '#6b7280';
        ctx.fillText(valueText, comp.component.symbol_data.width / 2, comp.component.symbol_data.height + 15);
      }

      ctx.restore();
    });
  };

  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left - pan.x) / zoom;
    const y = (e.clientY - rect.top - pan.y) / zoom;
    return { x, y };
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getCanvasCoords(e);

    if (tool === 'wire') {
      const snappedX = snapToGrid(coords.x);
      const snappedY = snapToGrid(coords.y);
      setWirePoints([...wirePoints, { x: snappedX, y: snappedY }]);
      return;
    }

    if (tool === 'delete') {
      const clickedComponent = placedComponents.find(comp => {
        const bounds = comp.component.symbol_data;
        return coords.x >= comp.x && coords.x <= comp.x + bounds.width &&
               coords.y >= comp.y && coords.y <= comp.y + bounds.height;
      });

      if (clickedComponent) {
        setPlacedComponents(prev => prev.filter(c => c.id !== clickedComponent.id));
      }
      return;
    }

    if (selectedComponent && tool === 'select') {
      const snappedX = snapToGrid(coords.x);
      const snappedY = snapToGrid(coords.y);

      const newComponent: CanvasComponent = {
        id: `comp-${Date.now()}-${Math.random()}`,
        componentId: selectedComponent.id || '',
        component: selectedComponent,
        x: snappedX,
        y: snappedY,
        rotation: 0,
        reference: getNextReference(selectedComponent),
        properties: { ...selectedComponent.default_properties }
      };

      setPlacedComponents([...placedComponents, newComponent]);
      setSelectedComponent(null);
    }
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button === 1 || (e.button === 0 && e.ctrlKey)) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      return;
    }

    if (tool !== 'select') return;

    const coords = getCanvasCoords(e);
    const clickedComponent = placedComponents.find(comp => {
      const bounds = comp.component.symbol_data;
      return coords.x >= comp.x && coords.x <= comp.x + bounds.width &&
             coords.y >= comp.y && coords.y <= comp.y + bounds.height;
    });

    if (clickedComponent) {
      setDraggingComponent(clickedComponent.id);
      setDragOffset({
        x: coords.x - clickedComponent.x,
        y: coords.y - clickedComponent.y
      });
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isPanning) {
      setPan({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y
      });
      return;
    }

    if (draggingComponent) {
      const coords = getCanvasCoords(e);
      const snappedX = snapToGrid(coords.x - dragOffset.x);
      const snappedY = snapToGrid(coords.y - dragOffset.y);

      setPlacedComponents(prev =>
        prev.map(comp =>
          comp.id === draggingComponent
            ? { ...comp, x: snappedX, y: snappedY }
            : comp
        )
      );
    } else {
      const coords = getCanvasCoords(e);
      const hovered = placedComponents.find(comp => {
        const bounds = comp.component.symbol_data;
        return coords.x >= comp.x && coords.x <= comp.x + bounds.width &&
               coords.y >= comp.y && coords.y <= comp.y + bounds.height;
      });
      setHoveredComponent(hovered ? hovered.id : null);
    }
  };

  const handleMouseUp = () => {
    setDraggingComponent(null);
    setIsPanning(false);
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(prev => Math.max(0.1, Math.min(3, prev * delta)));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setSelectedComponent(null);
      setWirePoints([]);
    } else if (e.key === 'Enter' && wirePoints.length > 1) {
      setWires([...wires, { id: `wire-${Date.now()}`, points: wirePoints }]);
      setWirePoints([]);
    } else if (e.key === 'r' && hoveredComponent) {
      setPlacedComponents(prev =>
        prev.map(comp =>
          comp.id === hoveredComponent
            ? { ...comp, rotation: (comp.rotation + 90) % 360 }
            : comp
        )
      );
    }
  };

  const handleSave = () => {
    if (onSave) {
      onSave({ components: placedComponents, wires });
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="bg-white border-b border-gray-200 p-3 flex items-center gap-4">
        <div className="flex gap-2">
          <button
            onClick={() => setTool('select')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              tool === 'select'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Select
          </button>
          <button
            onClick={() => setTool('wire')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              tool === 'wire'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Wire
          </button>
          <button
            onClick={() => setTool('delete')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              tool === 'delete'
                ? 'bg-red-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Delete
          </button>
        </div>

        <div className="flex-1" />

        <div className="flex gap-2 items-center">
          <button
            onClick={() => setZoom(prev => Math.max(0.1, prev - 0.1))}
            className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
          >
            -
          </button>
          <span className="text-sm font-medium text-gray-700 w-16 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom(prev => Math.min(3, prev + 0.1))}
            className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
          >
            +
          </button>
        </div>

        <button
          onClick={handleSave}
          className="px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700"
        >
          Save
        </button>
      </div>

      <div className="flex-1 bg-gray-50 overflow-hidden relative">
        <canvas
          ref={canvasRef}
          width={1400}
          height={800}
          className="cursor-crosshair"
          onClick={handleCanvasClick}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
          onKeyDown={handleKeyDown}
          tabIndex={0}
        />

        {selectedComponent && (
          <div className="absolute top-4 left-4 bg-blue-100 border border-blue-300 rounded-lg p-3 shadow-lg">
            <p className="text-sm font-medium text-blue-900">
              Click on canvas to place: {selectedComponent.name}
            </p>
            <p className="text-xs text-blue-700 mt-1">Press ESC to cancel</p>
          </div>
        )}

        {tool === 'wire' && (
          <div className="absolute top-4 left-4 bg-green-100 border border-green-300 rounded-lg p-3 shadow-lg">
            <p className="text-sm font-medium text-green-900">Wire Mode</p>
            <p className="text-xs text-green-700 mt-1">Click to add points, ENTER to finish, ESC to cancel</p>
          </div>
        )}

        <div className="absolute bottom-4 right-4 bg-white border border-gray-200 rounded-lg p-3 shadow-lg text-xs">
          <p className="text-gray-600">
            <strong>Controls:</strong>
          </p>
          <p className="text-gray-600">Ctrl+Click or Middle Click: Pan</p>
          <p className="text-gray-600">Scroll: Zoom</p>
          <p className="text-gray-600">R: Rotate (hover component)</p>
        </div>
      </div>

      <div className="bg-white border-t border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Component Library</h3>
        <div className="grid grid-cols-6 gap-2">
          {components.map(comp => (
            <button
              key={comp.id || comp.name}
              onClick={() => setSelectedComponent(comp)}
              className={`p-3 border rounded-lg hover:bg-blue-50 hover:border-blue-300 transition-all ${
                selectedComponent?.name === comp.name
                  ? 'bg-blue-100 border-blue-400'
                  : 'bg-gray-50 border-gray-200'
              }`}
              title={comp.name}
            >
              <div className="text-xs font-medium text-gray-700 truncate">
                {comp.name}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
