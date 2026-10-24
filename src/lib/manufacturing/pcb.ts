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
