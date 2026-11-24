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
  /**
   * Rotation the pad's footprint was placed with, in degrees. `size` is stated in
   * the footprint's own frame, so an end-fire part prints its lands turned 90°:
   * without this the checker measures a rotated oblong as its unrotated box and
   * calls copper the clearance the router reserved for the real outline.
   */
  rotationDeg?: number;
  drillDiameter?: number;
  layers: string[];
  netId?: string;
}

/**
 * A region the designer has reserved: no copper may be placed inside it.
 *
 * The rectangle is stated in board millimetres from the outline origin, the same
 * frame traces and vias use, so the checker, the router and the canvas all read
 * one geometry. An empty `layers` list means every copper layer — the common
 * case for an antenna clearing, a mounting hole or a creepage slot.
 */
export interface PCBKeepout {
  id: string;
  /** Top-left corner, board millimetres. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Layer ids the region bars copper from; empty means every layer. */
  layers: string[];
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
  /**
   * Copper-free windows the designer drew. Optional so a design built before
   * keepouts existed stays valid; absent is the same board as `[]`.
   */
  keepouts?: PCBKeepout[];
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
