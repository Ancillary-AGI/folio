/**
 * Shared STEP (AP214) geometry primitives.
 *
 * STEP here is plain text with no kernel behind it, so every solid is a faceted
 * CLOSED_SHELL: boxes as four-point polygons and holes as N-gon prisms. The enclosure,
 * mechanism and any future mechanical exporter all emit through these helpers so the
 * dialect cannot drift between them. All coordinates are millimetres.
 */

let stepId = 0;
const nextId = (): number => {
  stepId += 1;
  return stepId;
};

const fmt = (n: number): string => Number(n.toFixed(4)).toString();

/** Axis-aligned box as 8 corners; faces emitted as 4-point polygons. */
export function boxFaces(
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
): number[][][] {
  const c = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  return [
    [c[0], c[1], c[2], c[3]], [c[4], c[5], c[6], c[7]],
    [c[0], c[1], c[5], c[4]], [c[2], c[3], c[7], c[6]],
    [c[1], c[2], c[6], c[5]], [c[0], c[3], c[7], c[4]],
  ];
}

/** Cylinder side as an N-gon prism; a kernel-less STEP needs faceted holes. */
export function holePrism(
  cx: number,
  cy: number,
  z0: number,
  z1: number,
  diameter: number,
  sides = 12,
): number[][][] {
  const ring = (z: number): number[][] => {
    const pts: number[][] = [];
    for (let i = 0; i < sides; i += 1) {
      const a = (2 * Math.PI * i) / sides;
      pts.push([cx + (diameter / 2) * Math.cos(a), cy + (diameter / 2) * Math.sin(a), z]);
    }
    return pts;
  };
  const bottom = ring(z0);
  const top = ring(z1);
  const faces: number[][][] = [];
  for (let i = 0; i < sides; i += 1) {
    faces.push([bottom[i], bottom[(i + 1) % sides], top[(i + 1) % sides], top[i]]);
  }
  return faces;
}

/** One solid in an assembly file. */
export interface StepSolid {
  name: string;
  faces: readonly number[][][];
}

/**
 * Wraps several closed shells in one AP214 document. Each part gets its own
 * CLOSED_SHELL / MANIFOLD_SOLID_BREP; merging disjoint parts into a single
 * shell would not be a valid solid.
 */
export function stepAssemblyDocument(
  solids: readonly StepSolid[],
  name: string,
  /**
   * FILE_NAME timestamp. Defaults to the STEP epoch rather than wall-clock time
   * so exporting the same solid twice yields byte-identical files (reproducible
   * builds, reviewable diffs). Pass `new Date().toISOString()` for traceability.
   */
  timestamp = '1970-01-01T00:00:00Z',
): string {
  stepId = 0;
  const escape = (value: string): string => value.replace(/'/g, "''");
  const lines: string[] = [
    'ISO-10303-21;',
    'HEADER;',
    `FILE_DESCRIPTION(('${escape(name)}'),'2;1');`,
    `FILE_NAME('${escape(name)}','${escape(timestamp)}',('folio'),('folio'),' ',' ',' ');`,
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));",
    'ENDSEC;',
    'DATA;',
  ];
  for (const solid of solids) {
    const faceIds: number[] = [];
    for (const face of solid.faces) {
      const pointIds: number[] = [];
      for (const [x, y, z] of face) {
        const id = nextId();
        lines.push(`#${id}=CARTESIAN_POINT('',(${fmt(x)},${fmt(y)},${fmt(z)}));`);
        pointIds.push(id);
      }
      const poly = nextId();
      lines.push(`#${poly}=POLYLINE('',(${pointIds.map((id) => `#${id}`).join(',')}));`);
      const adv = nextId();
      lines.push(`#${adv}=ADVANCED_FACE('',(#${poly}),.T.);`);
      faceIds.push(adv);
    }
    const shell = nextId();
    lines.push(`#${shell}=CLOSED_SHELL('',(${faceIds.map((id) => `#${id}`).join(',')}));`);
    const brep = nextId();
    lines.push(`#${brep}=MANIFOLD_SOLID_BREP('${escape(solid.name)}',#${shell});`);
  }
  lines.push('ENDSEC;', 'END-ISO-10303-21;');
  return lines.join('\n');
}

/** Wraps a list of polygonal faces in a complete AP214 document. */
export function stepDocument(faces: readonly number[][][], name: string): string {
  return stepAssemblyDocument([{ name, faces }], name);
}
