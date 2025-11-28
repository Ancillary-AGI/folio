import { Schematic, Component, Wire, PlacedComponent } from '../../types';

export interface PCBLayout {
  id: string;
  name: string;
  width: number;
  height: number;
  layers: PCBLayer[];
  components: PCBComponent[];
  traces: PCBTrace[];
  vias: PCBVia[];
  designRules: DesignRules;
}

export interface PCBLayer {
  id: string;
  name: string;
  type: 'signal' | 'power' | 'ground' | 'silk' | 'solder_mask' | 'drill';
  thickness: number;
  material: string;
  color?: string;
}

export interface PCBComponent {
  id: string;
  componentId: string;
  footprint: string;
  position: { x: number; y: number; z: number };
  rotation: number;
  side: 'top' | 'bottom';
  pads: PCBPad[];
}

export interface PCBPad {
  id: string;
  shape: 'circle' | 'rectangle' | 'oval';
  position: { x: number; y: number };
  size: { width: number; height: number };
  drill?: number;
  net?: string;
  clearance?: number;
}

export interface PCBTrace {
  id: string;
  net: string;
  layer: string;
  width: number;
  points: Array<{ x: number; y: number }>;
  clearance: number;
}

export interface PCBVia {
  id: string;
  position: { x: number; y: number };
  drill: number;
  pad: number;
  layers: string[];
  net?: string;
}

export interface DesignRules {
  minTraceWidth: number;
  minTraceClearance: number;
  minDrillSize: number;
  minAnnularRing: number;
  boardThickness: number;
  copperThickness: number;
  maxTraceWidth?: number;
}

export interface ConversionOptions {
  boardSize: { width: number; height: number };
  layerCount: number;
  designRules: DesignRules;
  autoRoute: boolean;
  optimizePlacement: boolean;
}

export class SchematicToPcbConverter {
  private layouts: Map<string, PCBLayout> = new Map();

  constructor() {}

  async convertSchematicToPCB(
    schematic: Schematic,
    options: ConversionOptions
  ): Promise<PCBLayout> {
    const layoutId = `pcb-${schematic.id}-${Date.now()}`;

    // Initialize PCB layout
    const layout: PCBLayout = {
      id: layoutId,
      name: `${schematic.name} PCB`,
      width: options.boardSize.width,
      height: options.boardSize.height,
      layers: this.createLayers(options.layerCount),
      components: [],
      traces: [],
      vias: [],
      designRules: options.designRules
    };

    // Convert components to PCB components
    layout.components = await this.convertComponents(schematic.components);

    // Place components
    if (options.optimizePlacement) {
      this.optimizeComponentPlacement(layout);
    } else {
      this.autoPlaceComponents(layout);
    }

    // Route traces
    if (options.autoRoute) {
      await this.autoRouteTraces(layout, schematic.wires);
    } else {
      layout.traces = this.convertWiresToTraces(schematic.wires, layout);
    }

    // Add vias where necessary
    this.addVias(layout);

    this.layouts.set(layoutId, layout);
    return layout;
  }

  private createLayers(layerCount: number): PCBLayer[] {
    const layers: PCBLayer[] = [];

    // Signal layers
    for (let i = 1; i <= layerCount; i++) {
      layers.push({
        id: `signal-${i}`,
        name: `Signal Layer ${i}`,
        type: 'signal',
        thickness: 0.035, // 35μm copper
        material: 'copper'
      });
    }

    // Power and ground planes
    if (layerCount >= 2) {
      layers.splice(1, 0, {
        id: 'power',
        name: 'Power Plane',
        type: 'power',
        thickness: 0.035,
        material: 'copper'
      });

      layers.splice(-1, 0, {
        id: 'ground',
        name: 'Ground Plane',
        type: 'ground',
        thickness: 0.035,
        material: 'copper'
      });
    }

    // Silk screen and solder mask
    layers.push(
      {
        id: 'top-silk',
        name: 'Top Silk Screen',
        type: 'silk',
        thickness: 0.01,
        material: 'ink',
        color: '#ffffff'
      },
      {
        id: 'top-solder-mask',
        name: 'Top Solder Mask',
        type: 'solder_mask',
        thickness: 0.02,
        material: 'solder_mask',
        color: '#00ff00'
      },
      {
        id: 'bottom-solder-mask',
        name: 'Bottom Solder Mask',
        type: 'solder_mask',
        thickness: 0.02,
        material: 'solder_mask',
        color: '#00ff00'
      }
    );

    return layers;
  }

  private async convertComponents(components: PlacedComponent[]): Promise<PCBComponent[]> {
    const pcbComponents: PCBComponent[] = [];

    for (const placedComponent of components) {
      const component = placedComponent.component;
      const footprint = await this.getComponentFootprint(component);
      const pads = await this.generatePads(component, footprint);

      const pcbComponent: PCBComponent = {
        id: `pcb-${placedComponent.id}`,
        componentId: placedComponent.id,
        footprint,
        position: { x: placedComponent.position.x, y: placedComponent.position.y, z: 0 },
        rotation: placedComponent.rotation,
        side: 'top',
        pads
      };

      pcbComponents.push(pcbComponent);
    }

    return pcbComponents;
  }

  private async getComponentFootprint(component: Component): Promise<string> {
    // Map component categories to standard footprints
    const footprintMap: Record<string, string> = {
      resistor: 'RES-0805',
      capacitor: 'CAP-0805',
      inductor: 'IND-0805',
      diode: 'DIO-SOD-323',
      transistor: 'SOT-23',
      ic: 'SOIC-8',
      connector: 'HDR-1X2',
      led: 'LED-0805'
    };

    return footprintMap[component.category] || 'GENERIC';
  }

  private async generatePads(_component: Component, footprint: string): Promise<PCBPad[]> {
    // Generate pads based on footprint
    const pads: PCBPad[] = [];

    // This is a simplified implementation
    // In a real system, this would load footprint data from a library
    switch (footprint) {
      case 'RES-0805':
        pads.push(
          { id: '1', shape: 'rectangle', position: { x: -0.5, y: 0 }, size: { width: 0.8, height: 0.6 } },
          { id: '2', shape: 'rectangle', position: { x: 0.5, y: 0 }, size: { width: 0.8, height: 0.6 } }
        );
        break;
      case 'SOIC-8':
        for (let i = 0; i < 8; i++) {
          const x = (i < 4) ? -1.27 : 1.27;
          const y = (i % 4 - 1.5) * 1.27;
          pads.push({
            id: (i + 1).toString(),
            shape: 'rectangle',
            position: { x, y },
            size: { width: 0.6, height: 1.5 }
          });
        }
        break;
      default:
        // Generic 2-pin component
        pads.push(
          { id: '1', shape: 'circle', position: { x: -1, y: 0 }, size: { width: 0.8, height: 0.8 } },
          { id: '2', shape: 'circle', position: { x: 1, y: 0 }, size: { width: 0.8, height: 0.8 } }
        );
    }

    return pads;
  }

  private optimizeComponentPlacement(layout: PCBLayout): void {
    // Implement intelligent component placement algorithm
    // This is a simplified version - real implementation would use optimization algorithms

    const centerX = layout.width / 2;
    const centerY = layout.height / 2;
    const radius = Math.min(layout.width, layout.height) * 0.3;

    layout.components.forEach((component, index) => {
      const angle = (index / layout.components.length) * Math.PI * 2;
      component.position.x = centerX + Math.cos(angle) * radius;
      component.position.y = centerY + Math.sin(angle) * radius;
      component.rotation = (angle * 180) / Math.PI;
    });
  }

  private autoPlaceComponents(layout: PCBLayout): void {
    // Simple grid-based placement
    const cols = Math.ceil(Math.sqrt(layout.components.length));
    const rows = Math.ceil(layout.components.length / cols);

    const spacingX = layout.width / (cols + 1);
    const spacingY = layout.height / (rows + 1);

    layout.components.forEach((component, index) => {
      const row = Math.floor(index / cols);
      const col = index % cols;

      component.position.x = (col + 1) * spacingX;
      component.position.y = (row + 1) * spacingY;
    });
  }

  private convertWiresToTraces(wires: Wire[], layout: PCBLayout): PCBTrace[] {
    const traces: PCBTrace[] = [];

    wires.forEach((wire, index) => {
      const trace: PCBTrace = {
        id: `trace-${index}`,
        net: wire.netName || `net-${index}`,
        layer: 'signal-1',
        width: layout.designRules.minTraceWidth,
        points: wire.points.map(p => ({ x: p.x, y: p.y })),
        clearance: layout.designRules.minTraceClearance
      };

      traces.push(trace);
    });

    return traces;
  }

  private async autoRouteTraces(layout: PCBLayout, wires: Wire[]): Promise<void> {
    // Advanced auto-routing algorithm with multi-layer support and obstacle avoidance

    // Create routing grid
    const gridSize = 0.5; // 0.5mm grid
    const grid = this.createRoutingGrid(layout, gridSize);

    for (const wire of wires) {
      const startPoint = wire.points[0];
      const endPoint = wire.points[wire.points.length - 1];

      // Find component pads at start and end
      const startPad = this.findPadAtPosition(layout, startPoint);
      const endPad = this.findPadAtPosition(layout, endPoint);

      if (startPad && endPad) {
        // Try routing on different layers
        let routed = false;
        const layers = ['signal-1', 'signal-2', 'signal-3', 'signal-4'];

        for (const layer of layers) {
          if (this.routeOnLayer(grid, startPad.position, endPad.position, layer, gridSize)) {
            const trace: PCBTrace = {
              id: `auto-trace-${wire.id}-${layer}`,
              net: wire.netName || `net-${wire.id}`,
              layer,
              width: this.calculateOptimalTraceWidth(wire, layout),
              points: this.calculateAdvancedTracePath(startPad.position, endPad.position),
              clearance: layout.designRules.minTraceClearance
            };

            layout.traces.push(trace);
            routed = true;

            // Add vias if changing layers
            if (layer !== 'signal-1') {
              this.addLayerChangeVias(layout, trace);
            }
            break;
          }
        }

        if (!routed) {
          // Fallback to simple routing
          const trace: PCBTrace = {
            id: `auto-trace-${wire.id}-fallback`,
            net: wire.netName || `net-${wire.id}`,
            layer: 'signal-1',
            width: layout.designRules.minTraceWidth,
            points: this.calculateTracePath(startPad.position, endPad.position),
            clearance: layout.designRules.minTraceClearance
          };
          layout.traces.push(trace);
        }
      }
    }
  }

  private createRoutingGrid(layout: PCBLayout, gridSize: number): boolean[][][] {
    const width = Math.ceil(layout.width / gridSize);
    const height = Math.ceil(layout.height / gridSize);
    const layers = layout.layers.length;

    const grid: boolean[][][] = Array(layers).fill(0).map(() =>
      Array(height).fill(0).map(() =>
        Array(width).fill(false)
      )
    );

    // Mark obstacles (components, existing traces, etc.)
    layout.components.forEach(component => {
      component.pads.forEach(pad => {
        const x = Math.floor(pad.position.x / gridSize);
        const y = Math.floor(pad.position.y / gridSize);
        const layerIndex = layout.layers.findIndex(l => l.id === 'signal-1'); // Top layer

        if (x >= 0 && x < width && y >= 0 && y < height && layerIndex >= 0) {
          const padClearance = pad.clearance || layout.designRules.minTraceClearance;
          const padRadius = Math.ceil((Math.max(pad.size.width, pad.size.height) / 2 + padClearance) / gridSize);
          for (let dy = -padRadius; dy <= padRadius; dy++) {
            for (let dx = -padRadius; dx <= padRadius; dx++) {
              const nx = x + dx;
              const ny = y + dy;
              if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                grid[layerIndex][ny][nx] = true; // Occupied
              }
            }
          }
        }
      });
    });

    return grid;
  }

  private routeOnLayer(grid: boolean[][][], start: {x: number, y: number}, end: {x: number, y: number}, _layerId: string, gridSize: number): boolean {
    // A* pathfinding algorithm for routing
    const layerIndex = 0; // Simplified - assume single layer for now
    const startX = Math.floor(start.x / gridSize);
    const startY = Math.floor(start.y / gridSize);
    const endX = Math.floor(end.x / gridSize);
    const endY = Math.floor(end.y / gridSize);

    if (startX < 0 || startX >= grid[0][0].length || startY < 0 || startY >= grid[0].length ||
        endX < 0 || endX >= grid[0][0].length || endY < 0 || endY >= grid[0].length) {
      return false;
    }

    // Simplified A* - in practice, this would be much more sophisticated
    const visited = new Set<string>();
    const queue: Array<{x: number, y: number, cost: number, heuristic: number}> = [];

    queue.push({ x: startX, y: startY, cost: 0, heuristic: Math.abs(endX - startX) + Math.abs(endY - startY) });

    while (queue.length > 0) {
      queue.sort((a, b) => (a.cost + a.heuristic) - (b.cost + b.heuristic));
      const current = queue.shift()!;

      const key = `${current.x},${current.y}`;
      if (visited.has(key)) continue;
      visited.add(key);

      if (current.x === endX && current.y === endY) {
        return true; // Path found
      }

      // Check neighbors
      const neighbors = [
        { x: current.x + 1, y: current.y },
        { x: current.x - 1, y: current.y },
        { x: current.x, y: current.y + 1 },
        { x: current.x, y: current.y - 1 }
      ];

      for (const neighbor of neighbors) {
        if (neighbor.x >= 0 && neighbor.x < grid[0][0].length &&
            neighbor.y >= 0 && neighbor.y < grid[0].length &&
            !grid[layerIndex][neighbor.y][neighbor.x] &&
            !visited.has(`${neighbor.x},${neighbor.y}`)) {
          queue.push({
            x: neighbor.x,
            y: neighbor.y,
            cost: current.cost + 1,
            heuristic: Math.abs(endX - neighbor.x) + Math.abs(endY - neighbor.y)
          });
        }
      }
    }

    return false; // No path found
  }

  private calculateOptimalTraceWidth(wire: Wire, layout: PCBLayout): number {
    // Calculate optimal trace width based on current requirements
    const current = wire.current || 0.1; // Default 100mA

    // Simplified formula: width = sqrt(current / k) where k is a constant
    // For FR4, k ≈ 0.048 for 1oz copper
    const k = 0.048;
    const width = Math.sqrt(current / k);
    const maxWidth = layout.designRules.maxTraceWidth || 2.0;

    return Math.max(layout.designRules.minTraceWidth, Math.min(width, maxWidth));
  }

  private calculateAdvancedTracePath(start: {x: number, y: number}, end: {x: number, y: number}): Array<{x: number, y: number}> {
    // For now, return simple path - in practice, this would reconstruct path from A* algorithm
    return this.calculateTracePath(start, end);
  }

  private addLayerChangeVias(layout: PCBLayout, trace: PCBTrace): void {
    // Add vias at layer changes
    const via: PCBVia = {
      id: `via-${trace.id}`,
      position: trace.points[Math.floor(trace.points.length / 2)], // Via in middle
      drill: layout.designRules.minDrillSize,
      pad: layout.designRules.minAnnularRing * 2,
      layers: [trace.layer, 'signal-1'], // Connect to top layer
      net: trace.net
    };

    layout.vias.push(via);
  }

  private findPadAtPosition(layout: PCBLayout, position: { x: number; y: number }): PCBPad | null {
    for (const component of layout.components) {
      for (const pad of component.pads) {
        const dx = pad.position.x + component.position.x - position.x;
        const dy = pad.position.y + component.position.y - position.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 0.5) { // 0.5mm tolerance
          return pad;
        }
      }
    }
    return null;
  }

  private calculateTracePath(
    start: { x: number; y: number },
    end: { x: number; y: number }
  ): Array<{ x: number; y: number }> {
    // Simple Manhattan routing
    const points: Array<{ x: number; y: number }> = [start];

    // Add intermediate points for L-shaped trace
    const midY = (start.y + end.y) / 2;

    points.push({ x: start.x, y: midY });
    points.push({ x: end.x, y: midY });
    points.push(end);

    return points;
  }

  private addVias(layout: PCBLayout): void {
    // Add vias where traces need to change layers
    // Simplified implementation

    layout.traces.forEach(trace => {
      if (trace.points.length > 2) {
        // Add via at trace start if needed
        const via: PCBVia = {
          id: `via-${trace.id}`,
          position: trace.points[0],
          drill: layout.designRules.minDrillSize,
          pad: layout.designRules.minAnnularRing * 2,
          layers: ['signal-1', 'signal-2'],
          net: trace.net
        };

        layout.vias.push(via);
      }
    });
  }

  getPCBLayout(layoutId: string): PCBLayout | undefined {
    return this.layouts.get(layoutId);
  }

  exportToGerber(layout: PCBLayout): string {
    // Generate Gerber files for manufacturing
    // This is a simplified implementation
    let gerber = '';

    // Header
    gerber += '%FSLAX46Y46*%\n';
    gerber += '%MOMM*%\n';
    gerber += '%LPD*%\n';

    // Components
    layout.components.forEach(component => {
      gerber += `X${Math.round(component.position.x * 1000000)}Y${Math.round(component.position.y * 1000000)}D01*\n`;
    });

    // Traces
    layout.traces.forEach(trace => {
      trace.points.forEach((point, index) => {
        const command = index === 0 ? 'D02' : 'D01';
        gerber += `X${Math.round(point.x * 1000000)}Y${Math.round(point.y * 1000000)}${command}*\n`;
      });
    });

    // Footer
    gerber += 'M02*\n';

    return gerber;
  }

  validateDesign(layout: PCBLayout): { valid: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // DRC checks
    const drcResult = this.runDRC(layout);
    errors.push(...drcResult.violations.filter(v => v.severity === 'error').map(v => v.message));
    warnings.push(...drcResult.violations.filter(v => v.severity === 'warning').map(v => v.message));

    // ERC checks
    const ercResult = this.runERC(layout);
    errors.push(...ercResult.violations.filter(v => v.severity === 'error').map(v => v.message));
    warnings.push(...ercResult.violations.filter(v => v.severity === 'warning').map(v => v.message));

    // EMC checks
    const emcResult = this.runEMCSimulation(layout);
    warnings.push(...emcResult.warnings);

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  private runDRC(layout: PCBLayout): { violations: Array<{ severity: string; message: string }> } {
    const violations: Array<{ severity: string; message: string }> = [];

    // Check minimum trace widths
    layout.traces.forEach(trace => {
      if (trace.width < layout.designRules.minTraceWidth) {
        violations.push({
          severity: 'error',
          message: `Trace ${trace.id} width ${trace.width}mm below minimum ${layout.designRules.minTraceWidth}mm`
        });
      }
    });

    // Check clearances
    layout.traces.forEach(trace => {
      if (trace.clearance < layout.designRules.minTraceClearance) {
        violations.push({
          severity: 'error',
          message: `Trace ${trace.id} clearance ${trace.clearance}mm below minimum ${layout.designRules.minTraceClearance}mm`
        });
      }
    });

    // Check drill sizes
    layout.vias.forEach(via => {
      if (via.drill < layout.designRules.minDrillSize) {
        violations.push({
          severity: 'error',
          message: `Via ${via.id} drill ${via.drill}mm below minimum ${layout.designRules.minDrillSize}mm`
        });
      }
    });

    return { violations };
  }

  private runERC(layout: PCBLayout): { violations: Array<{ severity: string; message: string }> } {
    const violations: Array<{ severity: string; message: string }> = [];

    // Basic ERC checks
    layout.components.forEach(component => {
      component.pads.forEach(pad => {
        if (!pad.net) {
          violations.push({
            severity: 'warning',
            message: `Pad ${pad.id} of component ${component.id} is not connected to any net`
          });
        }
      });
    });

    // Check for power/ground shorts
    const powerNets = new Set<string>();
    const groundNets = new Set<string>();

    layout.components.forEach(component => {
      component.pads.forEach(pad => {
        if (pad.net?.toLowerCase().includes('power') || pad.net?.toLowerCase().includes('vcc') || pad.net?.toLowerCase().includes('vdd')) {
          powerNets.add(pad.net);
        }
        if (pad.net?.toLowerCase().includes('ground') || pad.net?.toLowerCase().includes('gnd')) {
          groundNets.add(pad.net);
        }
      });
    });

    // Check for power-ground shorts
    powerNets.forEach(powerNet => {
      groundNets.forEach(groundNet => {
        if (powerNet === groundNet) {
          violations.push({
            severity: 'error',
            message: `Power net "${powerNet}" is shorted to ground net "${groundNet}"`
          });
        }
      });
    });

    return { violations };
  }

  private runEMCSimulation(layout: PCBLayout): { warnings: string[] } {
    const warnings: string[] = [];

    // Basic EMC analysis
    layout.traces.forEach(trace => {
      // Check for long traces that might radiate
      const length = this.calculateTraceLength(trace);
      if (length > 50) { // 50mm threshold
        warnings.push(`Trace ${trace.id} is ${length.toFixed(1)}mm long - consider EMI shielding`);
      }

      // Check for sharp angles
      for (let i = 1; i < trace.points.length - 1; i++) {
        const angle = this.calculateAngle(trace.points[i-1], trace.points[i], trace.points[i+1]);
        if (angle < 135) {
          warnings.push(`Sharp angle (${angle.toFixed(1)}°) in trace ${trace.id} may cause EMI`);
        }
      }

      // Check trace impedance
      const impedance = this.calculateTraceImpedance(trace, layout);
      if (impedance < 45 || impedance > 65) {
        warnings.push(`Trace ${trace.id} impedance (${impedance.toFixed(1)}Ω) outside 50Ω ±15% range`);
      }
    });

    return { warnings };
  }

  private calculateTraceLength(trace: PCBTrace): number {
    let length = 0;
    for (let i = 1; i < trace.points.length; i++) {
      const dx = trace.points[i].x - trace.points[i-1].x;
      const dy = trace.points[i].y - trace.points[i-1].y;
      length += Math.sqrt(dx * dx + dy * dy);
    }
    return length;
  }

  private calculateAngle(p1: {x: number, y: number}, p2: {x: number, y: number}, p3: {x: number, y: number}): number {
    const v1 = { x: p1.x - p2.x, y: p1.y - p2.y };
    const v2 = { x: p3.x - p2.x, y: p3.y - p2.y };

    const dot = v1.x * v2.x + v1.y * v2.y;
    const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
    const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);

    const cosAngle = dot / (mag1 * mag2);
    return Math.acos(Math.max(-1, Math.min(1, cosAngle))) * (180 / Math.PI);
  }

  private calculateTraceImpedance(trace: PCBTrace, layout: PCBLayout): number {
    // Simplified impedance calculation for microstrip line
    const height = layout.designRules.boardThickness || 1.6; // mm
    const er = 4.5; // Relative permittivity for FR4
    const w = trace.width;
    const t = 0.035; // Copper thickness in mm

    // Simplified formula for 50 ohm line
    const impedance = 87 / Math.sqrt(er + 1.41) * Math.log(5.98 * height / (0.8 * w + t));
    return impedance;
  }
}

export const schematicToPcbConverter = new SchematicToPcbConverter();