export interface OBJMesh {
  name: string;
  vertices: Array<{ x: number; y: number; z: number }>;
  faces: number[][];
}

export interface OBJExportResult {
  obj: string;
  mtl: string;
  triangleCount: number;
}

/** OBJ tokens cannot contain newlines or tabs without corrupting the file. */
function cleanToken(value: string, fallback: string): string {
  const cleaned = value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned || fallback;
}

/** Reject data that would emit an OBJ file no loader can interpret. */
function validateMesh(mesh: OBJMesh): void {
  const label = mesh.name ? `OBJ mesh "${mesh.name}"` : 'OBJ mesh';
  for (const vertex of mesh.vertices) {
    if (!Number.isFinite(vertex.x) || !Number.isFinite(vertex.y) || !Number.isFinite(vertex.z)) {
      throw new Error(`${label} has a non-finite vertex coordinate`);
    }
  }
  mesh.faces.forEach((face, faceIndex) => {
    if (face.length < 3) return; // documented degenerate-face skip
    for (const index of face) {
      if (!Number.isInteger(index) || index < 0 || index >= mesh.vertices.length) {
        throw new Error(`${label} face ${faceIndex} has an index outside its vertex list`);
      }
    }
  });
}

export class OBJExporter {
  exportMeshes(meshes: OBJMesh[], materialName = 'default'): OBJExportResult {
    const material = cleanToken(materialName, 'default');
    for (const mesh of meshes) validateMesh(mesh);
    const lines: string[] = ['# Folio OBJ export', `mtllib model.mtl`, `usemtl ${material}`];
    const mtl = [
      `newmtl ${material}`,
      'Kd 0.7 0.7 0.75',
      'Ka 0.1 0.1 0.1',
      'Ks 0.3 0.3 0.3',
      'Ns 20',
    ].join('\n');

    let vertexOffset = 1;
    let triangleCount = 0;

    for (const mesh of meshes) {
      lines.push(`o ${cleanToken(mesh.name, 'mesh')}`);
      for (const v of mesh.vertices) {
        lines.push(`v ${v.x.toFixed(6)} ${v.y.toFixed(6)} ${v.z.toFixed(6)}`);
      }
      for (const face of mesh.faces) {
        if (face.length < 3) continue;
        const indices = face.map((i) => i + vertexOffset);
        lines.push(`f ${indices.join(' ')}`);
        triangleCount += Math.max(0, face.length - 2);
      }
      vertexOffset += mesh.vertices.length;
    }

    return { obj: lines.join('\n') + '\n', mtl, triangleCount };
  }

  exportBox(width: number, height: number, depth: number, name = 'box'): OBJExportResult {
    for (const [label, value] of [['width', width], ['height', height], ['depth', depth]] as const) {
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`OBJ box ${label} must be a finite positive number`);
      }
    }
    const w = width / 2;
    const h = height / 2;
    const d = depth / 2;
    const vertices = [
      { x: -w, y: -h, z: -d },
      { x: w, y: -h, z: -d },
      { x: w, y: h, z: -d },
      { x: -w, y: h, z: -d },
      { x: -w, y: -h, z: d },
      { x: w, y: -h, z: d },
      { x: w, y: h, z: d },
      { x: -w, y: h, z: d },
    ];
    const faces = [
      [0, 1, 2, 3],
      [4, 7, 6, 5],
      [0, 4, 5, 1],
      [2, 6, 7, 3],
      [0, 3, 7, 4],
      [1, 5, 6, 2],
    ];
    return this.exportMeshes([{ name, vertices, faces }]);
  }
}

export const objExporter = new OBJExporter();
