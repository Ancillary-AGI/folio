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

export class OBJExporter {
  exportMeshes(meshes: OBJMesh[], materialName = 'default'): OBJExportResult {
    const lines: string[] = ['# Folio OBJ export', `mtllib model.mtl`, `usemtl ${materialName}`];
    const mtl = [
      `newmtl ${materialName}`,
      'Kd 0.7 0.7 0.75',
      'Ka 0.1 0.1 0.1',
      'Ks 0.3 0.3 0.3',
      'Ns 20',
    ].join('\n');

    let vertexOffset = 1;
    let triangleCount = 0;

    for (const mesh of meshes) {
      lines.push(`o ${mesh.name || 'mesh'}`);
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
