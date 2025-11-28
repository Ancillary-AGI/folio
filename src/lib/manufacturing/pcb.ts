import { Point, PlacedComponent, Net } from '../../types';

export interface PCBLayer {
  id: string;
  name: string;
  type: 'copper' | 'solder_mask' | 'silk_screen' | 'drill';
  thickness: number;
  material: string;
  color?: string;
}

export interface PCBTrace {
  id: string;
  netId: string;
  layerId: string;
  width: number;
  points: Point[];
  clearance: number;
}

export interface PCBVIA {
  id: string;
  position: Point;
  diameter: number;
  drillDiameter: number;
  layers: string[]; // Layer IDs this via connects
  netId?: string;
}

export interface PCBPad {
  id: string;
  componentId: string;
  pinId: string;
  position: Point;
  shape: 'circle' | 'rectangle' | 'oval';
  size: { width: number; height: number };
  drillDiameter?: number;
  layers: string[];
  netId?: string;
}

export interface PCBDesign {
  id: string;
  name: string;
  dimensions: { width: number; height: number; thickness: number };
  layers: PCBLayer[];
  traces: PCBTrace[];
  vias: PCBVIA[];
  pads: PCBPad[];
  components: PlacedComponent[];
  nets: Net[];
  designRules: PCBDesignRules;
}

export interface PCBDesignRules {
  minTraceWidth: number;
  minTraceSpacing: number;
  minViaDiameter: number;
  minViaDrillDiameter: number;
  minPadDiameter: number;
  minHoleDiameter: number;
  copperThickness: number;
  solderMaskClearance: number;
  silkScreenClearance: number;
}

export class PCBDesignEngine {
  private designs: Map<string, PCBDesign> = new Map();
  private defaultDesignRules: PCBDesignRules = {
    minTraceWidth: 0.2, // mm
    minTraceSpacing: 0.2, // mm
    minViaDiameter: 0.4, // mm
    minViaDrillDiameter: 0.2, // mm
    minPadDiameter: 0.5, // mm
    minHoleDiameter: 0.3, // mm
    copperThickness: 0.035, // mm
    solderMaskClearance: 0.1, // mm
    silkScreenClearance: 0.15 // mm
  };

  createPCB(name: string, width: number, height: number): PCBDesign {
    const design: PCBDesign = {
      id: `pcb_${Date.now()}`,
      name,
      dimensions: { width, height, thickness: 1.6 },
      layers: this.createDefaultLayers(),
      traces: [],
      vias: [],
      pads: [],
      components: [],
      nets: [],
      designRules: { ...this.defaultDesignRules }
    };

    this.designs.set(design.id, design);
    return design;
  }

  private createDefaultLayers(): PCBLayer[] {
    return [
      { id: 'top_copper', name: 'Top Copper', type: 'copper', thickness: 0.035, material: 'copper' },
      { id: 'top_solder_mask', name: 'Top Solder Mask', type: 'solder_mask', thickness: 0.02, material: 'solder_mask', color: '#FF0000' },
      { id: 'top_silk_screen', name: 'Top Silk Screen', type: 'silk_screen', thickness: 0.01, material: 'ink', color: '#FFFFFF' },
      { id: 'bottom_copper', name: 'Bottom Copper', type: 'copper', thickness: 0.035, material: 'copper' },
      { id: 'bottom_solder_mask', name: 'Bottom Solder Mask', type: 'solder_mask', thickness: 0.02, material: 'solder_mask', color: '#0000FF' },
      { id: 'bottom_silk_screen', name: 'Bottom Silk Screen', type: 'silk_screen', thickness: 0.01, material: 'ink', color: '#FFFFFF' }
    ];
  }

  importFromSchematic(schematic: { name: string; components?: PlacedComponent[]; nets?: Net[] }, designRules?: Partial<PCBDesignRules>): PCBDesign {
    const design = this.createPCB(`${schematic.name}_PCB`, 100, 80);

    if (designRules) {
      design.designRules = { ...design.designRules, ...designRules };
    }

    // Import components and create pads
    schematic.components?.forEach((placedComp: PlacedComponent) => {
      design.components.push(placedComp);
      this.createPadsForComponent(design, placedComp);
    });

    // Import nets
    schematic.nets?.forEach((net: Net) => {
      design.nets.push(net);
    });

    // Auto-route traces (simplified)
    this.autoRouteTraces(design);

    return design;
  }

  private createPadsForComponent(design: PCBDesign, placedComponent: PlacedComponent): void {
    placedComponent.component.pins.forEach(pin => {
      const pad: PCBPad = {
        id: `pad_${placedComponent.id}_${pin.id}`,
        componentId: placedComponent.id,
        pinId: pin.id,
        position: {
          x: placedComponent.position.x + (pin.x || 0),
          y: placedComponent.position.y + (pin.y || 0)
        },
        shape: 'circle',
        size: { width: 1.5, height: 1.5 },
        drillDiameter: 0.8,
        layers: ['top_copper', 'bottom_copper'],
        netId: undefined
      };
      design.pads.push(pad);
    });
  }

  private autoRouteTraces(design: PCBDesign): void {
    // Simplified auto-routing algorithm
    design.nets.forEach(net => {
      const connectedPads = design.pads.filter(pad =>
        net.connectedPins.some(cp => cp.componentId === pad.componentId && cp.pinId === pad.pinId)
      );

      if (connectedPads.length >= 2) {
        // Create a simple trace connecting the pads
        const trace: PCBTrace = {
          id: `trace_${net.id}`,
          netId: net.id,
          layerId: 'top_copper',
          width: design.designRules.minTraceWidth,
          points: connectedPads.map(pad => pad.position),
          clearance: design.designRules.minTraceSpacing
        };
        design.traces.push(trace);

        // Update pad net assignments
        connectedPads.forEach(pad => {
          pad.netId = net.id;
        });
      }
    });
  }

  addVia(designId: string, position: Point, layers: string[], netId?: string): PCBVIA {
    const design = this.designs.get(designId);
    if (!design) throw new Error('PCB design not found');

    const via: PCBVIA = {
      id: `via_${Date.now()}`,
      position,
      diameter: design.designRules.minViaDiameter,
      drillDiameter: design.designRules.minViaDrillDiameter,
      layers,
      netId
    };

    design.vias.push(via);
    return via;
  }

  validateDesign(designId: string): PCBValidationResult {
    const design = this.designs.get(designId);
    if (!design) throw new Error('PCB design not found');

    const errors: PCBValidationError[] = [];
    const warnings: PCBValidationWarning[] = [];

    // Check design rules
    design.traces.forEach(trace => {
      if (trace.width < design.designRules.minTraceWidth) {
        errors.push({
          type: 'trace_width',
          message: `Trace width ${trace.width}mm is below minimum ${design.designRules.minTraceWidth}mm`,
          elementId: trace.id,
          severity: 'error'
        });
      }

      // Check trace spacing
      design.traces.forEach(otherTrace => {
        if (otherTrace.id !== trace.id && otherTrace.netId !== trace.netId) {
          const spacing = this.calculateTraceSpacing(trace, otherTrace);
          if (spacing < design.designRules.minTraceSpacing) {
            errors.push({
              type: 'trace_spacing',
              message: `Trace spacing ${spacing.toFixed(2)}mm is below minimum ${design.designRules.minTraceSpacing}mm`,
              elementId: trace.id,
              severity: 'error'
            });
          }
        }
      });
    });

    // Check via sizes
    design.vias.forEach(via => {
      if (via.diameter < design.designRules.minViaDiameter) {
        errors.push({
          type: 'via_size',
          message: `Via diameter ${via.diameter}mm is below minimum ${design.designRules.minViaDiameter}mm`,
          elementId: via.id,
          severity: 'error'
        });
      }
    });

    return { isValid: errors.length === 0, errors, warnings };
  }

  private calculateTraceSpacing(trace1: PCBTrace, trace2: PCBTrace): number {
    // Simplified spacing calculation
    let minDistance = Infinity;

    trace1.points.forEach(p1 => {
      trace2.points.forEach(p2 => {
        const distance = Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
        minDistance = Math.min(minDistance, distance);
      });
    });

    return minDistance - (trace1.width + trace2.width) / 2;
  }

  exportGerber(designId: string): Map<string, string> {
    const design = this.designs.get(designId);
    if (!design) throw new Error('PCB design not found');

    const gerberFiles = new Map<string, string>();

    // Generate Gerber files for each layer
    design.layers.forEach(layer => {
      let gerber = '%FSLAX46Y46*%\n'; // Gerber format header
      gerber += '%MOMM*%\n'; // Units: mm

      switch (layer.type) {
        case 'copper':
          gerber += this.generateCopperGerber(design, layer);
          break;
        case 'solder_mask':
          gerber += this.generateSolderMaskGerber(design, layer);
          break;
        case 'silk_screen':
           gerber += this.generateSilkScreenGerber(design);
           break;
        case 'drill':
          gerber += this.generateDrillGerber(design);
          break;
      }

      gerber += 'M02*\n'; // End of file
      gerberFiles.set(`${design.name}_${layer.name}.gbr`, gerber);
    });

    return gerberFiles;
  }

  private generateCopperGerber(design: PCBDesign, layer: PCBLayer): string {
    let gerber = '';

    // Aperture definitions
    gerber += '%ADD10C,1.5*%\n'; // Pad aperture
    gerber += '%ADD11C,0.2*%\n'; // Trace aperture

    // Traces
    design.traces.forEach(trace => {
      if (trace.layerId === layer.id) {
        gerber += 'G54D11*\n'; // Select trace aperture
        trace.points.forEach((point, index) => {
          if (index === 0) {
            gerber += `X${Math.round(point.x * 1000000)}Y${Math.round(point.y * 1000000)}D02*\n`;
          } else {
            gerber += `X${Math.round(point.x * 1000000)}Y${Math.round(point.y * 1000000)}D01*\n`;
          }
        });
      }
    });

    // Pads
    design.pads.forEach(pad => {
      if (pad.layers.includes(layer.id)) {
        gerber += 'G54D10*\n'; // Select pad aperture
        gerber += `X${Math.round(pad.position.x * 1000000)}Y${Math.round(pad.position.y * 1000000)}D03*\n`;
      }
    });

    return gerber;
  }

  private generateSolderMaskGerber(design: PCBDesign, layer: PCBLayer): string {
    let gerber = '';

    // Solder mask openings around pads
    gerber += '%ADD12C,2.0*%\n'; // Solder mask aperture

    design.pads.forEach(pad => {
      if (pad.layers.includes(layer.id.replace('_solder_mask', '_copper'))) {
        gerber += 'G54D12*\n';
        gerber += `X${Math.round(pad.position.x * 1000000)}Y${Math.round(pad.position.y * 1000000)}D03*\n`;
      }
    });

    return gerber;
  }

  private generateSilkScreenGerber(design: PCBDesign): string {
    let gerber = '';

    // Component reference designators and outlines
    gerber += '%ADD13C,0.1*%\n'; // Text aperture

    design.components.forEach(placedComp => {
      // Use the component's position directly
      gerber += 'G54D13*\n';
      gerber += `X${Math.round(placedComp.position.x * 1000000)}Y${Math.round(placedComp.position.y * 1000000)}D03*\n`;
    });

    return gerber;
  }

  private generateDrillGerber(design: PCBDesign): string {
    let gerber = '';

    // Drill holes for vias and pads
    design.vias.forEach(via => {
      gerber += `X${Math.round(via.position.x * 1000000)}Y${Math.round(via.position.y * 1000000)}C${Math.round(via.drillDiameter * 1000000)}*\n`;
    });

    design.pads.forEach(pad => {
      if (pad.drillDiameter) {
        gerber += `X${Math.round(pad.position.x * 1000000)}Y${Math.round(pad.position.y * 1000000)}C${Math.round(pad.drillDiameter * 1000000)}*\n`;
      }
    });

    return gerber;
  }

  getDesign(designId: string): PCBDesign | undefined {
    return this.designs.get(designId);
  }

  getAllDesigns(): PCBDesign[] {
    return Array.from(this.designs.values());
  }
}

export interface PCBValidationError {
  type: 'trace_width' | 'trace_spacing' | 'via_size' | 'pad_size' | 'clearance';
  message: string;
  elementId: string;
  severity: 'error' | 'warning';
}

export interface PCBValidationWarning {
  type: string;
  message: string;
  elementId: string;
  severity: 'warning' | 'info';
}

export interface PCBValidationResult {
  isValid: boolean;
  errors: PCBValidationError[];
  warnings: PCBValidationWarning[];
}

export const pcbDesignEngine = new PCBDesignEngine();