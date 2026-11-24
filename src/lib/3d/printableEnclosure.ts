/**
 * Watertight printable tray for the demo enclosure.
 *
 * `enclosureStep` describes the case as a tub plus a separate lid. FDM prints
 * the tub as one open-top tray, so this module emits the triangle mesh of that
 * tray (floor, four walls, open cavity) at the same dimensions. It is a solid
 * boundary: every edge is shared by exactly two triangles, which is what the
 * slicer needs to produce closed contours.
 *
 * Coordinates are millimetres with Y as the build direction.
 */
import { enclosureStep, type EnclosureSpec } from '../manufacturing/enclosureStep';
import type { GCodeMeshData } from './gcodeExporter';

export interface PrintableEnclosure {
  mesh: GCodeMeshData;
  outerMm: { width: number; depth: number; height: number };
  wallMm: number;
  floorMm: number;
}

export function buildEnclosureTrayMesh(spec: EnclosureSpec): PrintableEnclosure {
  const outer = enclosureStep(spec);
  const width = outer.outerW;
  const depth = outer.outerD;
  const floor = spec.wall;
  const height = spec.boardThickness + spec.clearanceZ + floor;
  if (!(width > 2 * spec.wall) || !(depth > 2 * spec.wall) || !(height > floor)) {
    throw new Error('Enclosure spec is too small to contain its own wall thickness.');
  }

  const t = spec.wall;
  const innerW = width - 2 * t;
  const innerD = depth - 2 * t;

  // Outer bottom (0..3), outer top (4..7), cavity floor (8..11), cavity top rim (12..15).
  const vertices = [
    [0, 0, 0], [width, 0, 0], [width, 0, depth], [0, 0, depth],
    [0, height, 0], [width, height, 0], [width, height, depth], [0, height, depth],
    [t, floor, t], [t + innerW, floor, t], [t + innerW, floor, t + innerD], [t, floor, t + innerD],
    [t, height, t], [t + innerW, height, t], [t + innerW, height, t + innerD], [t, height, t + innerD],
  ];

  const faces: number[][] = [
    // Floor.
    [0, 2, 1], [0, 3, 2],
    // Outer walls.
    [0, 1, 5], [0, 5, 4],
    [1, 2, 6], [1, 6, 5],
    [2, 3, 7], [2, 7, 6],
    [3, 0, 4], [3, 4, 7],
    // Cavity floor (faces up into the cavity).
    [8, 9, 10], [8, 10, 11],
    // Inner walls.
    [8, 12, 13], [8, 13, 9],
    [9, 13, 14], [9, 14, 10],
    [10, 14, 15], [10, 15, 11],
    [11, 15, 12], [11, 12, 8],
    // Top rim.
    [4, 5, 13], [4, 13, 12],
    [5, 6, 14], [5, 14, 13],
    [6, 7, 15], [6, 15, 14],
    [7, 4, 12], [7, 12, 15],
  ];

  return {
    mesh: { vertices, faces },
    outerMm: { width, depth, height },
    wallMm: t,
    floorMm: floor,
  };
}
