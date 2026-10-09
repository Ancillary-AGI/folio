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

let stepId = 0
const nextId = (): number => {
  stepId += 1
  return stepId
}

/** Axis-aligned box as 8 corners; faces emitted as 4-point polygons. */
function boxFaces(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number[][][] {
  const c = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ]
  return [
    [c[0], c[1], c[2], c[3]], [c[4], c[5], c[6], c[7]],
    [c[0], c[1], c[5], c[4]], [c[2], c[3], c[7], c[6]],
    [c[1], c[2], c[6], c[5]], [c[0], c[3], c[7], c[4]],
  ]
}

/** Cylinder side as an N-gon prism (STEP without a kernel: faceted holes). */
function holePrism(cx: number, cy: number, z0: number, z1: number, diameter: number, sides = 12): number[][][] {
  const ring = (z: number): number[][] => {
    const pts: number[][] = []
    for (let i = 0; i < sides; i++) {
      const a = (2 * Math.PI * i) / sides
      pts.push([cx + (diameter / 2) * Math.cos(a), cy + (diameter / 2) * Math.sin(a), z])
    }
    return pts
  }
  const bottom = ring(z0)
  const top = ring(z1)
  const faces: number[][][] = []
  for (let i = 0; i < sides; i++) {
    faces.push([bottom[i], bottom[(i + 1) % sides], top[(i + 1) % sides], top[i]])
  }
  return faces
}

const fmt = (n: number): string => Number(n.toFixed(4)).toString()

/**
 * Build the enclosure STEP: base tub (floor + 4 walls) with corner
 * standoff holes, plus a flat lid. Returns STEP text and outer dims.
 */
export function enclosureStep(spec: EnclosureSpec): StepExport {
  stepId = 0
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
  // Emit AP214-ish: CARTESIAN_POINT + POLYLINE per face + CLOSED_SHELL.
  const lines: string[] = [
    'ISO-10303-21;',
    'HEADER;',
    'FILE_DESCRIPTION((\'Folio enclosure\'),\'2;1\');',
    `FILE_NAME('folio-enclosure','${new Date().toISOString()}',('folio'),('folio'),' ',' ',' ');`,
    'FILE_SCHEMA((\'AUTOMOTIVE_DESIGN\'));',
    'ENDSEC;',
    'DATA;',
  ]
  const faceIds: number[] = []
  for (const face of faces) {
    const pointIds: number[] = []
    for (const [x, y, z] of face) {
      const id = nextId()
      lines.push(`#${id}=CARTESIAN_POINT('',(${fmt(x)},${fmt(y)},${fmt(z)}));`)
      pointIds.push(id)
    }
    const poly = nextId()
    lines.push(`#${poly}=POLYLINE('',(${pointIds.map((id) => `#${id}`).join(',')}));`)
    const adv = nextId()
    lines.push(`#${adv}=ADVANCED_FACE('',(#${poly}),.T.);`)
    faceIds.push(adv)
  }
  const shell = nextId()
  lines.push(`#${shell}=CLOSED_SHELL('',(${faceIds.map((id) => `#${id}`).join(',')}));`)
  const solid = nextId()
  lines.push(`#${solid}=MANIFOLD_SOLID_BREP('',#${shell});`)
  lines.push('ENDSEC;', 'END-ISO-10303-21;')
  return { step: lines.join('\n'), outerW, outerD, outerH }
}
