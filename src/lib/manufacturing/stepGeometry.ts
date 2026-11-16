/**
 * Shared STEP (AP214) geometry primitives.
 *
 * STEP here is plain text with no kernel behind it, so every solid is a faceted
 * CLOSED_SHELL: boxes as four-point polygons and holes as N-gon prisms. The
 * enclosure, mechanism and any future mechanical exporter all emit through
 * these helpers so the dialect cannot drift between them. The document is
 * written with a length unit context (millimetres by default; a metre caller
 * passes `unit: 'm'` so the numbers it writes are read back correctly).
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
    [c[1], c[2], c[6], c[5]], [c[0], c[4], c[7], c[3]],
  ];
}

/**
 * Box oriented by three axes, origin at the centre of one end face.
 * `axisU` runs along the box's length (0 → sizeU), `axisV` across its width
 * (±sizeV/2 either side of the axis), `axisW` through its height (0 → sizeW).
 * Axes are normalised inside. The axis-aligned `boxFaces` is the special case
 * with u = +X, v = +Y, w = +Z.
 */
export function orientedBoxFaces(
  origin: readonly [number, number, number],
  axisU: readonly [number, number, number],
  axisV: readonly [number, number, number],
  axisW: readonly [number, number, number],
  sizeU: number,
  sizeV: number,
  sizeW: number,
): number[][][] {
  const unit = (axis: readonly [number, number, number]): [number, number, number] => {
    const length = Math.hypot(axis[0], axis[1], axis[2]);
    if (length === 0) throw new Error('orientedBoxFaces needs three non-zero axes.');
    return [axis[0] / length, axis[1] / length, axis[2] / length];
  };
  const u = unit(axisU);
  const v = unit(axisV);
  const w = unit(axisW);
  const scale = (axis: [number, number, number], length: number) =>
    [axis[0] * length, axis[1] * length, axis[2] * length] as const;
  const uVec = scale(u, sizeU);
  const vHalf = scale(v, sizeV / 2);
  const wVec = scale(w, sizeW);
  const originArray = [origin[0], origin[1], origin[2]] as const;
  const add = (...points: ReadonlyArray<readonly [number, number, number]>): [number, number, number] => [
    points.reduce((sum, point) => sum + point[0], 0),
    points.reduce((sum, point) => sum + point[1], 0),
    points.reduce((sum, point) => sum + point[2], 0),
  ];
  const O = [originArray[0], originArray[1], originArray[2]] as const;
  const negV = [-vHalf[0], -vHalf[1], -vHalf[2]] as const;
  const c000 = add(O, negV);
  const c100 = add(O, uVec, negV);
  const c010 = add(O, vHalf);
  const c110 = add(O, uVec, vHalf);
  const c001 = add(c000, wVec);
  const c101 = add(c100, wVec);
  const c011 = add(c010, wVec);
  const c111 = add(c110, wVec);
  return [
    [c000, c100, c110, c010],
    [c001, c101, c111, c011],
    [c000, c100, c101, c001],
    [c010, c110, c111, c011],
    [c000, c001, c011, c010],
    [c100, c110, c111, c101],
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
 * Wraps several faceted shells in one AP214 document, as a real ADVANCED_BREP
 * product structure.
 *
 * Each face becomes a PLANE bounded by an EDGE_LOOP of LINE EDGE_CURVEs (the
 * `FACETED_BREP` dialect, which every mainstream reader — FreeCAD, Onshape,
 * OCC-based importers — loads as a valid solid). The context block carries
 * the millimetre unit, steradian and uncertainty so the file is complete, not
 * a bag of entities with no schema context. Points and edges are deduplicated
 * by identity, which keeps the entity count linear in the input.
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
  /**
   * Length unit of every coordinate in `solids` (default mm, the CAD unit).
   * The header SI_UNIT declaration is written to match — a file that says
   * millimetres while its numbers are metres imports 1000× small.
   */
  unit: 'mm' | 'm' = 'mm',
): string {
  stepId = 0;
  // STEP strings: control characters stripped, quotes doubled, clipped.
  const escape = (value: string): string =>
    value.replace(/[^\x20-\x7E]/g, ' ').replace(/'/g, "''").slice(0, 128);
  const lines: string[] = [
    'ISO-10303-21;',
    'HEADER;',
    `FILE_DESCRIPTION(('Folio faceted export'),'2;1');`,
    `FILE_NAME('${escape(name)}','${escape(timestamp)}',('Folio'),('Folio'),' ',' ',' ');`,
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));",
    'ENDSEC;',
    'DATA;',
  ];

  // ── Shared context ───────────────────────────────────────────────────────
  const applicationContext = nextId();
  lines.push(`#${applicationContext}=APPLICATION_CONTEXT(('automotive design'));`);
  const applicationProtocol = nextId();
  lines.push(`#${applicationProtocol}=APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#${applicationContext});`);
  const productContext = nextId();
  lines.push(`#${productContext}=PRODUCT_CONTEXT('',#${applicationContext},'mechanical');`);
  const definitionContext = nextId();
  lines.push(`#${definitionContext}=PRODUCT_DEFINITION_CONTEXT('part definition',#${applicationContext},'design');`);
  const lengthUnit = nextId();
  const lengthSi = unit === 'mm' ? '.MILLI.,.METRE.' : '$,.METRE.';
  lines.push(`#${lengthUnit}=( LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(${lengthSi}) );`);
  const angleUnit = nextId();
  lines.push(`#${angleUnit}=( NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.) );`);
  const solidAngleUnit = nextId();
  lines.push(`#${solidAngleUnit}=( NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT() );`);
  const uncertainty = nextId();
  const uncertaintyMeters = unit === 'mm' ? 'LENGTH_MEASURE(1.E-05)' : 'LENGTH_MEASURE(1.E-08)';
  lines.push(
    `#${uncertainty}=UNCERTAINTY_MEASURE_WITH_UNIT(${uncertaintyMeters},#${lengthUnit},'distance_accuracy_value','maximum model space distance between geometric entities at the time of data creation');`,
  );
  const geometricContext = nextId();
  lines.push(
    `#${geometricContext}=( GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${uncertainty}))GLOBAL_UNIT_ASSIGNED_CONTEXT((#${lengthUnit},#${angleUnit},#${solidAngleUnit}))REPRESENTATION_CONTEXT('3D Context with UNIT and UNCERTAINTY','3D Context with UNIT and UNCERTAINTY') );`,
  );

  const pointByKey = new Map<string, number>();
  const vertexByKey = new Map<string, number>();
  const edgeByKey = new Map<string, number>();
  const pointEntity = ([x, y, z]: number[]): number => {
    const key = `${fmt(x)},${fmt(y)},${fmt(z)}`;
    const existing = pointByKey.get(key);
    if (existing) return existing;
    const id = nextId();
    lines.push(`#${id}=CARTESIAN_POINT('',(${fmt(x)},${fmt(y)},${fmt(z)}));`);
    pointByKey.set(key, id);
    return id;
  };
  const vertexEntity = (position: number[]): number => {
    const key = `${fmt(position[0])},${fmt(position[1])},${fmt(position[2])}`;
    const existing = vertexByKey.get(key);
    if (existing) return existing;
    const point = pointEntity(position);
    const id = nextId();
    lines.push(`#${id}=VERTEX_POINT('',#${point});`);
    vertexByKey.set(key, id);
    return id;
  };
  /** LINE between two points; identical for either direction. */
  const edgeEntity = (first: number[], second: number[]): { edge: number; forward: boolean } => {
    const a = `${fmt(first[0])},${fmt(first[1])},${fmt(first[2])}`;
    const b = `${fmt(second[0])},${fmt(second[1])},${fmt(second[2])}`;
    const [lowKey, highKey] = a <= b ? [a, b] : [b, a];
    const key = `${lowKey}|${highKey}`;
    const forward = a <= b;
    const existing = edgeByKey.get(key);
    if (existing) return { edge: existing, forward };
    const start = vertexEntity(first);
    const end = vertexEntity(second);
    const p1 = pointEntity(first);
    const directionVector = nextId();
    lines.push(`#${directionVector}=DIRECTION('',(${fmt(second[0] - first[0])},${fmt(second[1] - first[1])},${fmt(second[2] - first[2])}));`);
    const lineGeom = nextId();
    lines.push(`#${lineGeom}=LINE('',#${p1},VECTOR('',#${directionVector},1.));`);
    const id = nextId();
    lines.push(`#${id}=EDGE_CURVE('',#${start},#${end},#${lineGeom},.T.);`);
    edgeByKey.set(key, id);
    return { edge: id, forward };
  };

  const emitSolid = (solid: StepSolid): number => {
    const faceIds: number[] = [];
    let faceIndex = 0;
    for (const face of solid.faces) {
      faceIndex += 1;
      if (face.length < 3) continue; // degenerate: nothing to bound
      const vertices: number[][] = face.map((point) => point.map(Number));
      // Newell normal; zero-area faces are kept (readers tolerate them better
      // than a silent count hole) but get a Z-plane fallback.
      let nx = 0, ny = 0, nz = 0;
      for (let index = 0; index < vertices.length; index += 1) {
        const current = vertices[index];
        const next = vertices[(index + 1) % vertices.length];
        nx += (current[1] - next[1]) * (current[2] + next[2]);
        ny += (current[2] - next[2]) * (current[0] + next[0]);
        nz += (current[0] - next[0]) * (current[1] + next[1]);
      }
      const length = Math.hypot(nx, ny, nz);
      const normal: [number, number, number] = length > 1e-12 ? [nx / length, ny / length, nz / length] : [0, 0, 1];
      const reference: [number, number, number] = Math.abs(normal[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
      const tX = normal[1] * reference[2] - normal[2] * reference[1];
      const tY = normal[2] * reference[0] - normal[0] * reference[2];
      const tZ = normal[0] * reference[1] - normal[1] * reference[0];
      const tLength = Math.hypot(tX, tY, tZ) || 1;

      const planeOrigin = pointEntity(vertices[0]);
      const directionNormal = nextId();
      lines.push(`#${directionNormal}=DIRECTION('',(${fmt(normal[0])},${fmt(normal[1])},${fmt(normal[2])}));`);
      const directionRef = nextId();
      lines.push(`#${directionRef}=DIRECTION('',(${fmt(tX / tLength)},${fmt(tY / tLength)},${fmt(tZ / tLength)}));`);
      const axis = nextId();
      lines.push(`#${axis}=AXIS2_PLACEMENT_3D('',#${planeOrigin},#${directionNormal},#${directionRef});`);
      const plane = nextId();
      lines.push(`#${plane}=PLANE('',#${axis});`);

      // Loop over oriented edges in winding order.
      const oriented: number[] = [];
      for (let index = 0; index < vertices.length; index += 1) {
        const start = vertices[index];
        const end = vertices[(index + 1) % vertices.length];
        if (Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]) < 1e-9) continue; // drop zero-length segments
        const { edge, forward } = edgeEntity(start, end);
        const orientedEdge = nextId();
        lines.push(`#${orientedEdge}=ORIENTED_EDGE('',*,*,#${edge},${forward ? '.T.' : '.F.'});`);
        oriented.push(orientedEdge);
      }
      if (oriented.length < 3) continue;
      const loop = nextId();
      lines.push(`#${loop}=EDGE_LOOP('',(${oriented.map((id) => `#${id}`).join(',')}));`);
      const bound = nextId();
      lines.push(`#${bound}=FACE_OUTER_BOUND('',#${loop},.T.);`);
      const faceEntityId = nextId();
      lines.push(`#${faceEntityId}=ADVANCED_FACE('',(#${bound}),#${plane},.T.);`);
      faceIds.push(faceEntityId);
    }
    if (faceIds.length === 0) return 0;
    const shell = nextId();
    lines.push(`#${shell}=CLOSED_SHELL('',(${faceIds.map((id) => `#${id}`).join(',')}));`);
    const brep = nextId();
    lines.push(`#${brep}=FACETED_BREP('${escape(solid.name)}',#${shell});`);
    return brep;
  };

  const representations: number[] = [];
  for (const solid of solids) {
    const brep = emitSolid(solid);
    if (!brep) continue;
    const product = nextId();
    lines.push(`#${product}=PRODUCT('${escape(solid.name)}','${escape(solid.name)}','',(#${productContext}));`);
    const formation = nextId();
    lines.push(`#${formation}=PRODUCT_DEFINITION_FORMATION('1','1',#${product});`);
    const definition = nextId();
    lines.push(`#${definition}=PRODUCT_DEFINITION('design','design',#${formation},#${definitionContext});`);
    const shape = nextId();
    lines.push(`#${shape}=PRODUCT_DEFINITION_SHAPE('','',#${definition});`);
    const origin = nextId();
    lines.push(`#${origin}=CARTESIAN_POINT('',(0.,0.,0.));`);
    const zDirection = nextId();
    lines.push(`#${zDirection}=DIRECTION('',(0.,0.,1.));`);
    const xDirection = nextId();
    lines.push(`#${xDirection}=DIRECTION('',(1.,0.,0.));`);
    const placement = nextId();
    lines.push(`#${placement}=AXIS2_PLACEMENT_3D('',#${origin},#${zDirection},#${xDirection});`);
    const representation = nextId();
    lines.push(`#${representation}=ADVANCED_BREP_SHAPE_REPRESENTATION('${escape(solid.name)}',(#${placement},#${brep}),#${geometricContext});`);
    const shapeRepresentation = nextId();
    lines.push(`#${shapeRepresentation}=SHAPE_DEFINITION_REPRESENTATION(#${shape},#${representation});`);
    representations.push(shapeRepresentation);
  }

  lines.push('ENDSEC;', 'END-ISO-10303-21;');
  return lines.join('\n');
}

/** Wraps a list of polygonal faces in a complete AP214 document. */
export function stepDocument(faces: readonly number[][][], name: string): string {
  return stepAssemblyDocument([{ name, faces }], name);
}
