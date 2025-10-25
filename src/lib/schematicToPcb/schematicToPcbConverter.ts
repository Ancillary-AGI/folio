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

  private async generatePads(component: Component, footprint: string): Promise<PCBPad[]> {
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
    // Implement auto-routing algorithm
    // This is a complex algorithm - simplified implementation

    for (const wire of wires) {
      const startPoint = wire.points[0];
      const endPoint = wire.points[wire.points.length - 1];

      // Find component pads at start and end
      const startPad = this.findPadAtPosition(layout, startPoint);
      const endPad = this.findPadAtPosition(layout, endPoint);

      if (startPad && endPad) {
        const trace: PCBTrace = {
          id: `auto-trace-${wire.id}`,
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

  validateDesign(layout: PCBLayout): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check minimum trace widths
    layout.traces.forEach(trace => {
      if (trace.width < layout.designRules.minTraceWidth) {
        errors.push(`Trace ${trace.id} width ${trace.width}mm below minimum ${layout.designRules.minTraceWidth}mm`);
      }
    });

    // Check clearances
    layout.traces.forEach(trace => {
      if (trace.clearance < layout.designRules.minTraceClearance) {
        errors.push(`Trace ${trace.id} clearance ${trace.clearance}mm below minimum ${layout.designRules.minTraceClearance}mm`);
      }
    });

    // Check drill sizes
    layout.vias.forEach(via => {
      if (via.drill < layout.designRules.minDrillSize) {
        errors.push(`Via ${via.id} drill ${via.drill}mm below minimum ${layout.designRules.minDrillSize}mm`);
      }
    });

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

export const schematicToPcbConverter = new SchematicToPcbConverter();