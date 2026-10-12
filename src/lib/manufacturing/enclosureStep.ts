import { boxFaces, holePrism, stepDocument } from './stepGeometry';

/**
 * Enclosure STEP export (Pi-class leg 5).
 * A Pi-class board ships in a case: board body, standoff holes, lid with
 * vent slots. STEP AP214 (plain-text, no kernel needed): CLOSED_SHELL of
 * ADVANCED_FACE rectangles per box + cylinders per hole. All in mm.
 */
export interface EnclosureSpec {
  boardWidth: number
  boardHeight: number
  boardThickness: number
  wall: number
  clearanceXY: number
  clearanceZ: number
  lidThickness: number
  standoffDiameter: number
}

export interface StepExport {
  step: string
  outerW: number
  outerD: number
  outerH: number
}

/**
 * Build the enclosure STEP: base tub (floor + 4 walls) with corner
 * standoff holes, plus a flat lid. Returns STEP text and outer dims.
 */
export function enclosureStep(spec: EnclosureSpec): StepExport {
  const outerW = spec.boardWidth + 2 * (spec.clearanceXY + spec.wall)
  const outerD = spec.boardHeight + 2 * (spec.clearanceXY + spec.wall)
  const floorT = spec.wall
  const tubH = spec.boardThickness + spec.clearanceZ + floorT
  const outerH = tubH + spec.lidThickness
  const faces: number[][][] = []
  // Floor slab.
  faces.push(...boxFaces(0, 0, 0, outerW, outerD, floorT))
  // Four walls.
  const t = spec.wall
  faces.push(...boxFaces(0, 0, floorT, outerW, t, tubH))
  faces.push(...boxFaces(0, outerD - t, floorT, outerW, outerD, tubH))
  faces.push(...boxFaces(0, floorT, floorT, t, outerD, tubH))
  faces.push(...boxFaces(outerW - t, floorT, floorT, outerW, outerD, tubH))
  // Lid slab on top.
  faces.push(...boxFaces(0, 0, tubH, outerW, outerD, outerH))
  // Corner standoff holes through floor + lid.
  const corners: Array<[number, number]> = [
    [t + spec.standoffDiameter, t + spec.standoffDiameter],
    [outerW - t - spec.standoffDiameter, t + spec.standoffDiameter],
    [t + spec.standoffDiameter, outerD - t - spec.standoffDiameter],
    [outerW - t - spec.standoffDiameter, outerD - t - spec.standoffDiameter],
  ]
  for (const [cx, cy] of corners) {
    faces.push(...holePrism(cx, cy, 0, floorT, spec.standoffDiameter))
    faces.push(...holePrism(cx, cy, tubH, outerH, spec.standoffDiameter))
  }
  return { step: stepDocument(faces, 'folio-enclosure'), outerW, outerD, outerH };
}
