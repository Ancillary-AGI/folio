/**
 * STL import. Parses ASCII and binary triangle meshes and hands the geometry to
 * meshMeasure, which reports what the file actually contains — open edges,
 * non-manifold edges and inverted winding — instead of assuming a clean solid.
 *
 * STL carries no unit system. Coordinates are treated as millimetres, and every
 * measurement is labelled accordingly.
 */

import {
  MAX_MESH_TRIANGLES,
  MeshImportError,
  measureMesh,
  triangleLimitError,
  type MeshReport,
  type RawMesh,
} from './meshMeasure'

const VERTEX_PATTERN = /\bvertex\s+(\S+)\s+(\S+)\s+(\S+)/gi;
const LOOP_PATTERN = /\bouter\s+loop\b/gi;

function countMatches(pattern: RegExp, text: string): number {
  pattern.lastIndex = 0;
  let count = 0;
  while (pattern.exec(text) !== null) count += 1;
  pattern.lastIndex = 0;
  return count;
}

/** Exporters on Windows occasionally prepend a UTF-8 byte-order mark. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function parseAscii(text: string): RawMesh {
  const body = stripBom(text);

  if (/ISO-10303-21|\bSTEP\s*;/i.test(body.slice(0, 2048))) {
    throw new MeshImportError('This is a STEP file, not an STL. Export the model as STL or OBJ and import that.');
  }
  if (!/^\s*solid\b/i.test(body)) {
    throw new MeshImportError('Not an ASCII STL: the file must begin with "solid <name>".');
  }
  if (!/\bendsolid\b/i.test(body)) {
    throw new MeshImportError('ASCII STL is truncated: no "endsolid" terminator was found.');
  }
  if (!/\bfacet\b/i.test(body)) {
    throw new MeshImportError('ASCII STL contains no facets.');
  }

  const vertexCount = countMatches(VERTEX_PATTERN, body);
  if (vertexCount === 0) {
    throw new MeshImportError('ASCII STL contains no "vertex" lines.');
  }
  if (vertexCount % 3 !== 0) {
    throw new MeshImportError(`ASCII STL has ${vertexCount} vertices, which is not a whole number of triangles.`);
  }
  const triangleCount = vertexCount / 3;
  if (triangleCount > MAX_MESH_TRIANGLES) throw triangleLimitError('ASCII STL', triangleCount);

  // One "outer loop" per facet is the cheapest structural check that each
  // triangle really has a full vertex set rather than a malformed line.
  const loopCount = countMatches(LOOP_PATTERN, body);
  if (loopCount !== triangleCount) {
    throw new MeshImportError(`Malformed ASCII STL: ${loopCount} facet loops for ${triangleCount} triangles.`);
  }

  const positions = new Float32Array(vertexCount * 3);
  let index = 0;
  VERTEX_PATTERN.lastIndex = 0;
  let match = VERTEX_PATTERN.exec(body);
  while (match !== null) {
    for (let axis = 1; axis <= 3; axis += 1) {
      const token = match[axis];
      const value = Number(token);
      if (!Number.isFinite(value)) {
        throw new MeshImportError(
          `ASCII STL vertex ${Math.floor(index / 3) + 1} has a non-numeric coordinate "${token}".`,
        );
      }
      positions[index] = value;
      index += 1;
    }
    match = VERTEX_PATTERN.exec(body);
  }

  return { positions, triangleCount, format: 'ascii' };
}

function parseBinary(buffer: ArrayBuffer, triangleCount: number): RawMesh {
  if (triangleCount > MAX_MESH_TRIANGLES) throw triangleLimitError('Binary STL', triangleCount);

  const view = new DataView(buffer);
  const positions = new Float32Array(triangleCount * 9);
  let offset = 84;
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    // The stored facet normal is skipped: it is redundant with the winding and
    // frequently left as zero by exporters. Normals are rebuilt from winding.
    offset += 12;
    for (let coordinate = 0; coordinate < 9; coordinate += 1) {
      const value = view.getFloat32(offset, true);
      offset += 4;
      if (!Number.isFinite(value)) {
        throw new MeshImportError(`Binary STL triangle ${triangle + 1} has a non-finite coordinate.`);
      }
      positions[triangle * 9 + coordinate] = value;
    }
    offset += 2; // attribute byte count
  }

  return { positions, triangleCount, format: 'binary' };
}

function parseBuffer(buffer: ArrayBuffer): MeshReport {
  const byteLength = buffer.byteLength;

  if (byteLength >= 84) {
    const declared = new DataView(buffer).getUint32(80, true);
    // Exact-size match first: binary files whose 80-byte header starts with
    // "solid" would otherwise be misread as ASCII.
    if (declared > 0 && 84 + declared * 50 === byteLength) {
      return measureMesh(parseBinary(buffer, declared));
    }
  }

  const text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  if (/^\s*solid\b/i.test(stripBom(text))) {
    return measureMesh(parseAscii(text));
  }
  // An OBJ named ".stl" would otherwise be reported as a corrupt binary header,
  // because arbitrary ASCII looks like an enormous triangle count.
  if (/^v(\s|$)/m.test(text) && /^f(\s|$)/m.test(text)) {
    throw new MeshImportError('This is an OBJ file, not an STL. Rename it to .obj and import it again.');
  }

  if (byteLength >= 84) {
    const declared = new DataView(buffer).getUint32(80, true);
    if (declared === 0) throw new MeshImportError('Binary STL contains no triangles.');
    // A non-STL file has arbitrary bytes at offset 80, so this is reported as a
    // layout mismatch: calling it a triangle-limit failure would be a fiction.
    throw new MeshImportError(
      `Not an STL file: the binary header at byte 80 declares ${declared} triangles, which needs ${84 + declared * 50} bytes, but the file is ${byteLength} bytes.`,
    );
  }

  throw new MeshImportError('Not an STL file: expected a binary header or an ASCII "solid" block.');
}

export function parseStl(input: ArrayBuffer | string): MeshReport {
  if (typeof input === 'string') {
    if (input.trim().length === 0) throw new MeshImportError('The selected STL file is empty.');
    return measureMesh(parseAscii(input));
  }
  if (input.byteLength === 0) throw new MeshImportError('The selected STL file is empty.');
  return parseBuffer(input);
}
