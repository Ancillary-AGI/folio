/**
 * OBJ import. Parses wavefront geometry and hands the resulting triangle soup
 * to meshMeasure, so an OBJ reports the same envelope, area, volume and shell
 * verdicts as an STL of the same shape.
 *
 * OBJ carries no units and no reliable normal convention. Coordinates are read
 * as millimetres; texture coordinates, vertex normals, groups, objects and
 * material directives are recognised and skipped, because facet normals are
 * rebuilt from winding here exactly as they are for STL.
 */

import {
  MAX_MESH_TRIANGLES,
  MeshImportError,
  measureMesh,
  triangleLimitError,
  type MeshReport,
  type RawMesh,
} from './meshMeasure';

/** A face needs at least three corners to enclose anything. */
const MIN_FACE_VERTICES = 3;

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function numberField(token: string, label: string): number {
  const value = Number(token);
  if (!Number.isFinite(value)) {
    throw new MeshImportError(`OBJ ${label} has a non-numeric value "${token}".`);
  }
  return value;
}

/**
 * Resolve a 1-based OBJ index against the count defined so far. Negative indices
 * count back from the current position, which is why the walk is single-pass.
 */
function resolveIndex(token: string, count: number, faceNumber: number): number {
  const raw = numberField(token, `face ${faceNumber} vertex index`);
  if (!Number.isInteger(raw)) {
    throw new MeshImportError(`OBJ face ${faceNumber} has a fractional vertex index "${token}".`);
  }
  const zeroBased = raw < 0 ? count + raw : raw - 1;
  if (zeroBased < 0 || zeroBased >= count) {
    throw new MeshImportError(
      `OBJ face ${faceNumber} references vertex index ${raw}, but only ${count} vertices are defined at that point.`,
    );
  }
  return zeroBased;
}

/** Face vertex tokens, or null when the line is not a face. */
function faceTokens(line: string): string[] | null {
  if (!/^f(\s|$)/.test(line)) return null;
  return line.slice(1).trim().split(/\s+/).filter((token) => token.length > 0);
}

/**
 * Count the triangles the faces produce before any coordinate buffer is
 * allocated, so the import ceiling is a refusal rather than a memory accident.
 */
function countFaceTriangles(lines: string[]): number {
  let triangles = 0;
  for (const line of lines) {
    const token = line.trim();
    const tokens = faceTokens(token);
    if (!tokens) continue;
    if (tokens.length < MIN_FACE_VERTICES) {
      throw new MeshImportError(
        `OBJ face has ${tokens.length} vertices; a face needs at least ${MIN_FACE_VERTICES}.`,
      );
    }
    triangles += tokens.length - 2;
  }
  return triangles;
}

function readVertex(line: string, vertexTotal: number, coordinates: number[]): boolean {
  if (!/^v(\s|$)/.test(line)) return false;
  const fields = line.slice(1).trim().split(/\s+/);
  if (fields.length < 3) {
    throw new MeshImportError(`OBJ vertex ${vertexTotal + 1} has fewer than three coordinates.`);
  }
  for (let axis = 0; axis < 3; axis += 1) {
    coordinates.push(numberField(fields[axis], `vertex ${vertexTotal + 1} coordinate`));
  }
  return true;
}

function parseObjText(text: string): RawMesh {
  const body = stripBom(text);

  if (/ISO-10303-21|\bSTEP\s*;/i.test(body.slice(0, 2048))) {
    throw new MeshImportError('This is a STEP file, not an OBJ. Export the model as OBJ or STL and import that.');
  }
  if (/^\s*solid\b[\s\S]*\bfacet\b/i.test(body)) {
    throw new MeshImportError('This is an ASCII STL file, not an OBJ. Import it as an STL instead.');
  }

  const lines = body.split(/\r?\n/);
  const triangleCount = countFaceTriangles(lines);
  if (triangleCount === 0) {
    throw new MeshImportError('OBJ contains no faces. A wavefront file needs "f" lines referencing vertices.');
  }
  if (triangleCount > MAX_MESH_TRIANGLES) throw triangleLimitError('OBJ', triangleCount);

  const coordinates: number[] = [];
  const positions = new Float32Array(triangleCount * 9);
  let vertexTotal = 0;
  let faceTotal = 0;
  let cursor = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;

    if (readVertex(line, vertexTotal, coordinates)) {
      vertexTotal += 1;
      continue;
    }

    const tokens = faceTokens(line);
    if (!tokens) continue;

    faceTotal += 1;
    const indices: number[] = [];
    for (const token of tokens) {
      // Only the position index is used; /vt and //vn are skipped by design.
      indices.push(resolveIndex(token.split('/')[0], vertexTotal, faceTotal));
    }

    // Polygons are fanned from the first corner. The fan keeps the winding of the
    // original ring, which is what the shell check then reads.
    for (let i = 1; i + 1 < indices.length; i += 1) {
      for (const vertex of [indices[0], indices[i], indices[i + 1]]) {
        const base = vertex * 3;
        positions[cursor] = coordinates[base];
        positions[cursor + 1] = coordinates[base + 1];
        positions[cursor + 2] = coordinates[base + 2];
        cursor += 3;
      }
    }
  }

  return { positions, triangleCount, format: 'obj' };
}

function decodeBuffer(buffer: ArrayBuffer): string {
  if (buffer.byteLength >= 84) {
    const declared = new DataView(buffer).getUint32(80, true);
    if (declared > 0 && 84 + declared * 50 === buffer.byteLength) {
      throw new MeshImportError('This is a binary STL file, not an OBJ. Import it as an STL instead.');
    }
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(buffer);
}

export function parseObj(input: ArrayBuffer | string): MeshReport {
  if (typeof input !== 'string' && input.byteLength === 0) {
    throw new MeshImportError('The selected OBJ file is empty.');
  }
  const text = typeof input === 'string' ? input : decodeBuffer(input);
  if (text.trim().length === 0) throw new MeshImportError('The selected OBJ file is empty.');
  return measureMesh(parseObjText(text));
}
