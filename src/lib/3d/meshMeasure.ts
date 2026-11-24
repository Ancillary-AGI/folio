/**
 * Shared measurement for imported triangle meshes.
 *
 * A mesh file says where the triangles are; it does not say whether the shell
 * closes, which way it is wound, or what a coordinate means. This module
 * answers those questions from the geometry alone so every importer reports the
 * same verdicts, and reports "unknown" where the geometry does not support an
 * answer.
 *
 * No mesh format here carries units. Coordinates are read as millimetres and
 * every measurement is labelled accordingly.
 */

/** Import ceiling. One million triangles is ~36 MB of position data before normals. */
export const MAX_MESH_TRIANGLES = 1_000_000;

/**
 * Above this count the closed-shell walk is skipped: pairing ~3 edges per
 * triangle behind string keys gets expensive, and the viewer still renders.
 */
export const TOPOLOGY_TRIANGLE_LIMIT = 400_000;

export type MeshFormat = 'ascii' | 'binary' | 'obj';

export interface MeshBounds {
  min: [number, number, number];
  max: [number, number, number];
  size: [number, number, number];
}

export interface MeshTopology {
  /** False when the mesh exceeded TOPOLOGY_TRIANGLE_LIMIT and the walk was skipped. */
  analysed: boolean;
  /** True only when every edge is shared by exactly two triangles with opposite winding. */
  watertight: boolean | null;
  openEdges: number;
  nonManifoldEdges: number;
  inconsistentEdges: number;
}

export interface MeshReport {
  format: MeshFormat;
  /** Triangle soup: nine floats per triangle, in millimetres. */
  positions: Float32Array;
  /** One unit normal per triangle, repeated for its three vertices (zero for degenerate facets). */
  normals: Float32Array;
  triangleCount: number;
  /** Facets with zero area. They render as nothing and are excluded from the shell walk. */
  degenerateTriangles: number;
  bounds: MeshBounds;
  surfaceAreaMm2: number;
  /** Divergence-theorem volume. Only meaningful when the shell is closed. */
  volumeMm3: number;
  topology: MeshTopology;
  assumedUnit: 'mm';
}

export class MeshImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MeshImportError';
  }
}

/** Raised before a huge file is allocated, so the ceiling is not a memory accident. */
export function triangleLimitError(kind: string, count: number): MeshImportError {
  return new MeshImportError(
    `${kind} has ${count} triangles; the viewer accepts at most ${MAX_MESH_TRIANGLES}. Decimate the model before importing.`,
  );
}

/**
 * What the shell walk found, as a sentence the reader can put straight in front
 * of them, or null when the mesh is a closed solid. Every surface that measures
 * a mesh quotes this instead of writing its own verdict, so an open shell is not
 * described as a box in one panel and a hole in another.
 */
export function shellProblem(mesh: MeshReport): string | null {
  const { topology } = mesh;
  if (!topology.analysed) {
    return `Shell check skipped above ${TOPOLOGY_TRIANGLE_LIMIT.toLocaleString('en-US')} triangles`;
  }
  if (topology.watertight) return null;
  const count = (value: number, noun: string): string | null =>
    value > 0 ? `${value} ${noun}${value === 1 ? '' : 's'}` : null;
  const problems = [
    count(topology.openEdges, 'open edge'),
    count(topology.nonManifoldEdges, 'non-manifold edge'),
    count(topology.inconsistentEdges, 'reversed face'),
  ].filter((entry): entry is string => entry !== null);
  return `Not a closed solid: ${problems.join(', ')}`;
}

export interface RawMesh {
  positions: Float32Array;
  triangleCount: number;
  format: MeshFormat;
}

function walkTopology(positions: Float32Array, triangleCount: number, extent: number): MeshTopology {
  if (triangleCount > TOPOLOGY_TRIANGLE_LIMIT) {
    return { analysed: false, watertight: null, openEdges: 0, nonManifoldEdges: 0, inconsistentEdges: 0 };
  }

  // Shared vertices rarely match bit-for-bit between facets, so coordinates are
  // quantised to the mesh extent before edges are paired.
  const tolerance = Math.max(1e-6, extent * 1e-6);
  const scale = 1 / tolerance;
  const vertexKey = (index: number): string =>
    `${Math.round(positions[index] * scale)},${Math.round(positions[index + 1] * scale)},${Math.round(positions[index + 2] * scale)}`;

  const edges = new Map<string, { count: number; forward: number }>();
  const addEdge = (start: string, end: string): void => {
    const forward = start < end;
    const key = forward ? `${start}|${end}` : `${end}|${start}`;
    const record = edges.get(key);
    if (record) {
      record.count += 1;
      if (forward) record.forward += 1;
    } else {
      edges.set(key, { count: 1, forward: forward ? 1 : 0 });
    }
  };

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const i = triangle * 9;
    const e1x = positions[i + 3] - positions[i];
    const e1y = positions[i + 4] - positions[i + 1];
    const e1z = positions[i + 5] - positions[i + 2];
    const e2x = positions[i + 6] - positions[i];
    const e2y = positions[i + 7] - positions[i + 1];
    const e2z = positions[i + 8] - positions[i + 2];
    const cx = e1y * e2z - e1z * e2y;
    const cy = e1z * e2x - e1x * e2z;
    const cz = e1x * e2y - e1y * e2x;
    if (cx * cx + cy * cy + cz * cz === 0) continue;

    const a = vertexKey(i);
    const b = vertexKey(i + 3);
    const c = vertexKey(i + 6);
    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
  }

  let openEdges = 0;
  let nonManifoldEdges = 0;
  let inconsistentEdges = 0;
  for (const { count, forward } of edges.values()) {
    if (count === 1) openEdges += 1;
    else if (count > 2) nonManifoldEdges += 1;
    else if (count === 2 && forward !== 1) inconsistentEdges += 1;
  }

  return {
    analysed: true,
    watertight: openEdges === 0 && nonManifoldEdges === 0 && inconsistentEdges === 0,
    openEdges,
    nonManifoldEdges,
    inconsistentEdges,
  };
}

/** Bounds, normals, area, volume and the shell walk for a triangle soup. */
export function measureMesh(raw: RawMesh): MeshReport {
  const { positions, triangleCount, format } = raw;
  const normals = new Float32Array(positions.length);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let surfaceArea = 0;
  let signedVolume = 0;
  let degenerateTriangles = 0;

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const i = triangle * 9;
    for (let axis = 0; axis < 3; axis += 1) {
      for (let vertex = 0; vertex < 3; vertex += 1) {
        const value = positions[i + vertex * 3 + axis];
        if (value < min[axis]) min[axis] = value;
        if (value > max[axis]) max[axis] = value;
      }
    }

    const ax = positions[i];
    const ay = positions[i + 1];
    const az = positions[i + 2];
    const bx = positions[i + 3];
    const by = positions[i + 4];
    const bz = positions[i + 5];
    const cx = positions[i + 6];
    const cy = positions[i + 7];
    const cz = positions[i + 8];

    const e1x = bx - ax;
    const e1y = by - ay;
    const e1z = bz - az;
    const e2x = cx - ax;
    const e2y = cy - ay;
    const e2z = cz - az;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    const length = Math.hypot(nx, ny, nz);

    if (length === 0) {
      degenerateTriangles += 1;
    } else {
      surfaceArea += length / 2;
      const ux = nx / length;
      const uy = ny / length;
      const uz = nz / length;
      for (let vertex = 0; vertex < 3; vertex += 1) {
        const base = i + vertex * 3;
        normals[base] = ux;
        normals[base + 1] = uy;
        normals[base + 2] = uz;
      }
    }

    signedVolume += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
  }

  const size: [number, number, number] = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const extent = Math.max(size[0], size[1], size[2]);

  return {
    format,
    positions,
    normals,
    triangleCount,
    degenerateTriangles,
    bounds: { min, max, size },
    surfaceAreaMm2: surfaceArea,
    volumeMm3: Math.abs(signedVolume),
    topology: walkTopology(positions, triangleCount, extent),
    assumedUnit: 'mm',
  };
}

/**
 * Read an uploaded model to bytes.
 *
 * FileReader rather than `Blob.arrayBuffer()`: the promise form is absent on
 * Safari before 14 and in this project's test engine, and a read that throws a
 * TypeError looks exactly like a file that is corrupt. Every mesh importer in
 * the app goes through here so the failure path is one path.
 */
export function readMeshFile(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
        return;
      }
      reject(new MeshImportError(`"${file.name}" could not be read as a model file.`));
    };
    reader.onerror = () => {
      reject(new MeshImportError(`"${file.name}" could not be read (${reader.error?.name ?? 'read error'}).`));
    };
    reader.readAsArrayBuffer(file);
  });
}
