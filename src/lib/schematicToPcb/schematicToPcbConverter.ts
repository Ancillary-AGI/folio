import type { Schematic, Component, Wire, PlacedComponent } from '../../types';
import {
  DEFAULT_DRC_RULES,
  DesignRuleChecker,
  type DRCSettings,
} from '../manufacturing/drc';
import type { PCBDesign, PCBPad as DesignPad } from '../manufacturing/pcb';
import { autoroute, type RouterPad } from '../manufacturing/autorouter';
import { footprintLibrary } from '../manufacturing/footprintLibrary';
import { polylineLength } from '../geometry/distance';

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
    layout.components = await this.convertComponents(schematic.components, schematic);

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

    this.layouts.set(layoutId, layout);
    return layout;
  }

  private createLayers(layerCount: number): PCBLayer[] {
    if (!Number.isInteger(layerCount) || layerCount < 1 || layerCount > 32) {
      throw new Error('PCB copper layer count must be an integer between 1 and 32')
    }

    const layers: PCBLayer[] = []
    const addCopperLayer = (id: string, name: string, type: PCBLayer['type'] = 'signal') => {
      layers.push({ id, name, type, thickness: 0.035, material: 'copper' })
    }

    if (layerCount === 1) {
      addCopperLayer('signal-1', 'Signal Layer 1')
    } else if (layerCount === 2) {
      addCopperLayer('signal-1', 'Top Signal Layer')
      addCopperLayer('signal-2', 'Bottom Signal Layer')
    } else {
      addCopperLayer('signal-1', 'Top Signal Layer')
      addCopperLayer('power', 'Power Plane', 'power')
      addCopperLayer('ground', 'Ground Plane', 'ground')
      addCopperLayer('signal-2', 'Bottom Signal Layer')
      for (let index = 5; index <= layerCount; index += 1) {
        addCopperLayer(`signal-${index - 2}`, `Signal Layer ${index - 2}`)
      }
    }

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
        id: 'bottom-silk',
        name: 'Bottom Silk Screen',
        type: 'silk',
        thickness: 0.01,
        material: 'ink',
        color: '#ffffff'
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

  private async convertComponents(components: PlacedComponent[], schematic: Schematic): Promise<PCBComponent[]> {
    const pcbComponents: PCBComponent[] = [];
    const netByPin = this.buildPinNetMap(schematic);

    for (const placedComponent of components) {
      const component = placedComponent.component;
      const footprint = this.getComponentFootprint(component);
      const pads = this.generatePads(component, footprint).map((pad, index) => ({
        ...pad,
        net: netByPin.get(`${placedComponent.id}:${component.pins[index].id}`),
      }));

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

  /**
   * Pad-to-net assignment. Wires carry connectivity, so they take priority;
   * declared nets fill in any pin the wire table missed. Without this map
   * every generated pad was netless, which made both the router and DRC
   * blind to the schematic.
   */
  private buildPinNetMap(schematic: Schematic): Map<string, string> {
    const netByPin = new Map<string, string>();
    const key = (componentId: string, pinId: string) => `${componentId}:${pinId}`;

    for (const net of schematic.nets) {
      const name = net.name || net.id;
      for (const connection of net.connectedPins) {
        netByPin.set(key(connection.componentId, connection.pinId), name);
      }
    }

    for (const wire of schematic.wires) {
      const name = wire.netName || wire.id;
      for (const connection of wire.connectedPins) {
        netByPin.set(key(connection.componentId, connection.pinId), name);
      }
    }

    return netByPin;
  }

  /**
   * Choose a real footprint whose pad count matches the schematic symbol.
   * A mismatched footprint would silently drop pins (the old code always
   * emitted two pads, so every 3-48 pin part lost connectivity).
   */
  private getComponentFootprint(component: Component): string {
    const pinCount = component.pins.length;
    const name = component.name.toLowerCase();
    let candidates: string[] = [];

    switch (component.category) {
      case 'passive':
        candidates = name.includes('cap') ? ['cap_0603'] : ['res_0402'];
        break;
      case 'semiconductor':
        candidates = ['sot_23'];
        break;
      case 'connector':
        candidates = ['header_2x1', 'header_2x2', 'header_2x3', 'header_2x4'];
        break;
      case 'ic':
      case 'microcontroller':
      case 'memory':
      case 'timing':
        candidates = footprintLibrary.getFootprintsByCategory('ic').map(footprint => footprint.id);
        break;
    }

    const match = candidates
      .map(id => footprintLibrary.getFootprint(id))
      .find(footprint => footprint && footprint.pads.length === pinCount);

    return match?.id ?? 'GENERIC';
  }

  /**
   * Pads are keyed by the schematic pin id, not by a synthetic index: nets,
   * DRC, and the router all address connectivity through that id.
   */
  private generatePads(component: Component, footprintId: string): PCBPad[] {
    const footprint = footprintLibrary.getFootprint(footprintId);
    const pinIds = component.pins.map(pin => pin.id);

    if (footprint && footprint.pads.length === pinIds.length) {
      return footprint.pads.map((pad, index) => ({
        id: pinIds[index],
        shape: pad.shape,
        position: { ...pad.position },
        size: { ...pad.size },
        drill: pad.drillDiameter,
      }));
    }

    return this.generateGenericPads(pinIds);
  }

  /** DIP-style fallback for parts the footprint library does not cover. */
  private generateGenericPads(pinIds: string[]): PCBPad[] {
    if (pinIds.length <= 2) {
      const positions = pinIds.length === 1
        ? [{ x: 0, y: 0 }]
        : [{ x: -1, y: 0 }, { x: 1, y: 0 }];
      return pinIds.map((id, index) => ({
        id,
        shape: 'circle' as const,
        position: positions[index],
        size: { width: 0.8, height: 0.8 },
      }));
    }

    const pitchMm = 2.54;
    const perSide = Math.ceil(pinIds.length / 2);
    return pinIds.map((id, index) => {
      const side = index < perSide ? -1 : 1;
      const row = index < perSide ? index : index - perSide;
      return {
        id,
        shape: 'circle' as const,
        position: { x: side * 3.81, y: (row - (perSide - 1) / 2) * pitchMm },
        size: { width: 1.5, height: 1.5 },
        drill: 0.8,
      };
    });
  }

  /**
   * Deterministic pairwise-swap placement that minimises half-perimeter
   * wirelength (HPWL) over the netlist. Swaps that leave the board or overlap a
   * neighbour's pad envelope are rejected, and rotations are left untouched, so
   * the result is always routable in the same way as the grid start.
   */
  private optimizeComponentPlacement(layout: PCBLayout): void {
    this.autoPlaceComponents(layout);
    const components = layout.components;
    if (components.length < 2) return;

    const marginMm = 0.5;
    const insideBoard = () => components.every(component => {
      const bounds = this.componentBounds(component);
      return bounds.minX >= marginMm && bounds.minY >= marginMm
        && bounds.maxX <= layout.width - marginMm && bounds.maxY <= layout.height - marginMm;
    });
    const withoutOverlap = () => {
      const envelopes = components.map(component => this.componentBounds(component));
      for (let i = 0; i < envelopes.length; i += 1) {
        for (let j = i + 1; j < envelopes.length; j += 1) {
          const a = envelopes[i];
          const b = envelopes[j];
          if (a.minX < b.maxX + marginMm && b.minX < a.maxX + marginMm
            && a.minY < b.maxY + marginMm && b.minY < a.maxY + marginMm) {
            return false;
          }
        }
      }
      return true;
    };

    let bestWirelength = this.placementWirelength(components);
    let improved = true;
    let passes = 0;
    while (improved && passes < 25) {
      improved = false;
      passes += 1;
      for (let i = 0; i < components.length; i += 1) {
        for (let j = i + 1; j < components.length; j += 1) {
          const a = components[i];
          const b = components[j];
          const ax = a.position.x;
          const ay = a.position.y;
          a.position.x = b.position.x;
          a.position.y = b.position.y;
          b.position.x = ax;
          b.position.y = ay;

          const wirelength = this.placementWirelength(components);
          if (wirelength + 1e-9 < bestWirelength && insideBoard() && withoutOverlap()) {
            bestWirelength = wirelength;
            improved = true;
          } else {
            const bx = a.position.x;
            const by = a.position.y;
            a.position.x = b.position.x;
            a.position.y = b.position.y;
            b.position.x = bx;
            b.position.y = by;
          }
        }
      }
    }
  }

  /** Half-perimeter wirelength over every net that reaches two or more pads. */
  private placementWirelength(components: PCBComponent[]): number {
    const bounds = new Map<string, { minX: number; minY: number; maxX: number; maxY: number }>();
    for (const component of components) {
      for (const pad of component.pads) {
        if (!pad.net) continue;
        const position = this.padWorldPosition(component, pad);
        const current = bounds.get(pad.net);
        if (current) {
          current.minX = Math.min(current.minX, position.x);
          current.minY = Math.min(current.minY, position.y);
          current.maxX = Math.max(current.maxX, position.x);
          current.maxY = Math.max(current.maxY, position.y);
        } else {
          bounds.set(pad.net, {
            minX: position.x, minY: position.y, maxX: position.x, maxY: position.y,
          });
        }
      }
    }
    let total = 0;
    for (const box of bounds.values()) {
      total += (box.maxX - box.minX) + (box.maxY - box.minY);
    }
    return total;
  }

  private componentBounds(component: PCBComponent): { minX: number; minY: number; maxX: number; maxY: number } {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const pad of component.pads) {
      const position = this.padWorldPosition(component, pad);
      minX = Math.min(minX, position.x - pad.size.width / 2);
      minY = Math.min(minY, position.y - pad.size.height / 2);
      maxX = Math.max(maxX, position.x + pad.size.width / 2);
      maxY = Math.max(maxY, position.y + pad.size.height / 2);
    }
    if (!Number.isFinite(minX)) {
      return {
        minX: component.position.x - 0.5,
        minY: component.position.y - 0.5,
        maxX: component.position.x + 0.5,
        maxY: component.position.y + 0.5,
      };
    }
    return { minX, minY, maxX, maxY };
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
        layer: layout.layers.find(layer => layer.type === 'signal')?.id ?? 'signal-1',
        width: layout.designRules.minTraceWidth,
        points: wire.points.map(p => ({ x: p.x, y: p.y })),
        clearance: layout.designRules.minTraceClearance
      };

      traces.push(trace);
    });

    return traces;
  }

  /**
   * Route the connectivity graph with the shared A* router. Pads are the
   * router's anchors, so routing follows the netlist rather than hoping a
   * schematic wire endpoint happens to land on a placed pad (the previous
   * implementation silently dropped every net when it did not).
   */
  private async autoRouteTraces(layout: PCBLayout, wires: Wire[]): Promise<void> {
    const pads = this.buildRouterPads(layout);
    if (pads.length === 0) {
      layout.traces = this.convertWiresToTraces(wires, layout);
      return;
    }

    const copperLayers = layout.layers
      .filter(layer => layer.type === 'signal' || layer.type === 'power' || layer.type === 'ground')
      .map(layer => layer.id);
    const rules = layout.designRules;
    const result = autoroute(pads, {
      boardWidthMm: layout.width,
      boardHeightMm: layout.height,
      layers: copperLayers,
      gridMm: 0.5,
      minTraceWidthMm: rules.minTraceWidth,
      minSpacingMm: rules.minTraceClearance,
      viaDrillMm: rules.minDrillSize,
      viaPadMm: rules.minDrillSize + rules.minAnnularRing * 2,
      viaPenalty: 8,
    });

    layout.traces.push(...result.traces.map((trace, index): PCBTrace => ({
      id: `auto-trace-${index}`,
      net: trace.netId,
      layer: trace.layerId,
      width: trace.widthMm,
      points: trace.points,
      clearance: rules.minTraceClearance,
    })));

    layout.vias.push(...result.vias.map((via, index): PCBVia => ({
      id: `auto-via-${index}`,
      position: { x: via.x, y: via.y },
      drill: via.drillMm,
      pad: via.padMm,
      layers: copperLayers,
      net: via.netId,
    })));
  }

  private buildRouterPads(layout: PCBLayout): RouterPad[] {
    const defaultLayer = layout.layers.find(layer => layer.type === 'signal')?.id ?? 'signal-1';
    const pads: RouterPad[] = [];

    for (const component of layout.components) {
      for (const pad of component.pads) {
        if (!pad.net) continue;
        const position = this.padWorldPosition(component, pad);
        pads.push({
          netId: pad.net,
          componentId: component.componentId,
          pinId: pad.id,
          x: position.x,
          y: position.y,
          layer: defaultLayer,
          // The footprint knows the real copper; the router otherwise assumes a
          // 1.6 mm through-hole disc and over-blocks fine-pitch SMD pins.
          padDiameterMm: Math.max(pad.size.width, pad.size.height),
        });
      }
    }

    return pads;
  }

  getPCBLayout(layoutId: string): PCBLayout | undefined {
    return this.layouts.get(layoutId);
  }

  /**
   * Top-copper-only RS-274X Gerber for a converted layout. Complete fabrication
   * output (masks, silk, outline, Excellon drill) lives in `buildFabPackage`;
   * this method exists for previewing the routed copper from a conversion.
   */
  exportToGerber(layout: PCBLayout): string {
    const scale = 1_000_000;
    const coord = (value: number) => Math.round(value * scale).toString();
    const lines: string[] = [
      'G04 Converted top copper — Folio*',
      '%FSLAX46Y46*%',
      '%MOMM*%',
      '%LPD*%',
    ];

    const traceApertures = new Map<string, number>();
    layout.traces.forEach(trace => {
      const key = trace.width.toFixed(4);
      if (!traceApertures.has(key)) traceApertures.set(key, 10 + traceApertures.size);
    });
    traceApertures.forEach((code, width) => {
      lines.push(`%ADD${code}C,${width}*%`);
    });

    const padApertures = new Map<string, number>();
    layout.components.forEach(component => {
      component.pads.forEach(pad => {
        const shape = pad.shape === 'rectangle' ? 'R' : 'C';
        const key = `${shape}:${pad.size.width.toFixed(4)}X${pad.size.height.toFixed(4)}`;
        if (!padApertures.has(key)) padApertures.set(key, 20 + padApertures.size);
      });
    });
    padApertures.forEach((code, key) => {
      const [shape, size] = key.split(':');
      lines.push(`%ADD${code}${shape},${size}*%`);
    });

    layout.traces.forEach(trace => {
      if (trace.points.length < 2) return;
      const aperture = traceApertures.get(trace.width.toFixed(4))!;
      lines.push(`D${aperture}*`);
      lines.push(`X${coord(trace.points[0].x)}Y${coord(trace.points[0].y)}D02*`);
      for (let index = 1; index < trace.points.length; index += 1) {
        lines.push(`X${coord(trace.points[index].x)}Y${coord(trace.points[index].y)}D01*`);
      }
    });

    layout.components.forEach(component => {
      component.pads.forEach(pad => {
        const shape = pad.shape === 'rectangle' ? 'R' : 'C';
        const key = `${shape}:${pad.size.width.toFixed(4)}X${pad.size.height.toFixed(4)}`;
        const aperture = padApertures.get(key)!;
        const position = this.padWorldPosition(component, pad);
        lines.push(`D${aperture}*`);
        lines.push(`X${coord(position.x)}Y${coord(position.y)}D03*`);
      });
    });

    lines.push('M02*');
    return `${lines.join('\n')}\n`;
  }

  validateDesign(layout: PCBLayout): { valid: boolean; errors: string[]; warnings: string[] } {
    const result = new DesignRuleChecker(this.toPcbDesign(layout), this.drcSettings(layout)).runDRC();
    const errors = result.violations.filter(v => v.severity === 'error').map(v => v.message);
    const warnings = result.violations.filter(v => v.severity === 'warning').map(v => v.message);

    // A netless pad is a layout connectivity fact the geometric DRC does not
    // model. Report it once per pad rather than once per net.
    for (const component of layout.components) {
      for (const pad of component.pads) {
        if (!pad.net) {
          warnings.push(`Pad ${pad.id} of component ${component.id} is not connected to any net`);
        }
      }
    }

    warnings.push(...this.runEMCSimulation(layout).warnings);

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /** Map converter rules onto the shared DRC settings. */
  private drcSettings(layout: PCBLayout): Partial<DRCSettings> {
    const rules = layout.designRules;
    return {
      minTraceWidth: rules.minTraceWidth,
      minTraceClearance: rules.minTraceClearance,
      minViaDiameter: rules.minDrillSize + rules.minAnnularRing * 2,
      minViaDrillDiameter: rules.minDrillSize,
      minPadDiameter: DEFAULT_DRC_RULES.minPadDiameter,
      minAnnularRing: rules.minAnnularRing,
      maxTraceWidth: rules.maxTraceWidth ?? DEFAULT_DRC_RULES.maxTraceWidth,
      minHoleDiameter: rules.minDrillSize,
      checkUnconnectedNets: true,
      checkAcuteAngles: true,
      checkTraceLength: false,
    };
  }

  /** Adapt the converter's layout to the shared PCB model used by DRC. */
  private toPcbDesign(layout: PCBLayout): PCBDesign {
    const copperLayers = layout.layers.filter(layer =>
      layer.type === 'signal' || layer.type === 'power' || layer.type === 'ground'
    );
    const copperLayerIds = copperLayers.map(layer => layer.id);
    const settings = this.drcSettings(layout);

    const pads: DesignPad[] = [];
    for (const component of layout.components) {
      for (const pad of component.pads) {
        pads.push({
          id: `${component.id}:${pad.id}`,
          componentId: component.componentId,
          pinId: pad.id,
          position: this.padWorldPosition(component, pad),
          shape: pad.shape,
          size: pad.size,
          drillDiameter: pad.drill,
          layers: copperLayerIds,
          netId: pad.net,
        });
      }
    }

    const netNames = new Set<string>();
    for (const pad of pads) if (pad.netId) netNames.add(pad.netId);
    for (const trace of layout.traces) if (trace.net) netNames.add(trace.net);
    for (const via of layout.vias) if (via.net) netNames.add(via.net);

    return {
      id: layout.id,
      name: layout.name,
      dimensions: {
        width: layout.width,
        height: layout.height,
        thickness: layout.designRules.boardThickness,
      },
      layers: copperLayers.map(layer => ({
        id: layer.id,
        name: layer.name,
        type: 'copper',
        thickness: layer.thickness,
        material: layer.material,
      })),
      traces: layout.traces.map(trace => ({
        id: trace.id,
        netId: trace.net,
        layerId: trace.layer,
        width: trace.width,
        points: trace.points,
        clearance: trace.clearance,
      })),
      vias: layout.vias.map(via => ({
        id: via.id,
        position: via.position,
        diameter: via.pad,
        drillDiameter: via.drill,
        layers: via.layers,
        netId: via.net,
      })),
      pads,
      components: [],
      nets: Array.from(netNames).map(name => ({
        id: name,
        name,
        connectedPins: [],
        wires: [],
      })),
      designRules: {
        minTraceWidth: settings.minTraceWidth ?? DEFAULT_DRC_RULES.minTraceWidth,
        minTraceSpacing: settings.minTraceClearance ?? DEFAULT_DRC_RULES.minTraceClearance,
        minViaDiameter: settings.minViaDiameter ?? DEFAULT_DRC_RULES.minViaDiameter,
        minViaDrillDiameter: settings.minViaDrillDiameter ?? DEFAULT_DRC_RULES.minViaDrillDiameter,
        minPadDiameter: settings.minPadDiameter ?? DEFAULT_DRC_RULES.minPadDiameter,
        minHoleDiameter: settings.minHoleDiameter ?? DEFAULT_DRC_RULES.minHoleDiameter,
        copperThickness: layout.designRules.copperThickness,
        solderMaskClearance: 0.1,
        silkScreenClearance: 0.15,
      },
    };
  }

  private padWorldPosition(component: PCBComponent, pad: PCBPad): { x: number; y: number } {
    const radians = (component.rotation * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return {
      x: component.position.x + pad.position.x * cos - pad.position.y * sin,
      y: component.position.y + pad.position.x * sin + pad.position.y * cos,
    };
  }

  private runEMCSimulation(layout: PCBLayout): { warnings: string[] } {
    const warnings: string[] = [];

    // Basic EMC analysis
    layout.traces.forEach(trace => {
      // Check for long traces that might radiate
      const length = polylineLength(trace.points);
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
    // First-order IPC-2141 microstrip estimate. Assumes a two-layer FR4 board
    // (the full board thickness is the dielectric height), εr = 4.5, and no
    // solder-mask or copper-roughness correction. Multi-layer stackups need the
    // dedicated stackup solver, which carries the real dielectric heights.
    const height = layout.designRules.boardThickness || 1.6; // mm
    const er = 4.5;
    const w = trace.width;
    const t = layout.designRules.copperThickness || 0.035; // mm
    return 87 / Math.sqrt(er + 1.41) * Math.log(5.98 * height / (0.8 * w + t));
  }
}

export const schematicToPcbConverter = new SchematicToPcbConverter();