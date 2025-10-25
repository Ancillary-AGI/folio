import * as THREE from 'three';

export interface STLExportOptions {
  binary?: boolean;
  includeNormals?: boolean;
  scale?: number;
}

export class STLExporter {
  private static readonly DEFAULT_OPTIONS: Required<STLExportOptions> = {
    binary: false,
    includeNormals: true,
    scale: 1
  };

  static exportScene(scene: THREE.Scene, options: STLExportOptions = {}): string | ArrayBuffer {
    const opts = { ...this.DEFAULT_OPTIONS, ...options };
    const geometries = this.collectGeometries(scene);

    if (opts.binary) {
      return this.exportBinary(geometries, opts);
    } else {
      return this.exportASCII(geometries, opts);
    }
  }

  static exportMesh(mesh: THREE.Mesh, options: STLExportOptions = {}): string | ArrayBuffer {
    const opts = { ...this.DEFAULT_OPTIONS, ...options };
    const geometries = [this.processGeometry(mesh.geometry, mesh.matrixWorld, opts.scale)];

    if (opts.binary) {
      return this.exportBinary(geometries, opts);
    } else {
      return this.exportASCII(geometries, opts);
    }
  }

  private static collectGeometries(scene: THREE.Scene): Array<{ vertices: Float32Array; normals: Float32Array; indices: Uint32Array }> {
    const geometries: Array<{ vertices: Float32Array; normals: Float32Array; indices: Uint32Array }> = [];

    scene.traverse((object) => {
      if (object instanceof THREE.Mesh && object.geometry) {
        geometries.push(this.processGeometry(object.geometry, object.matrixWorld, 1));
      }
    });

    return geometries;
  }

  private static processGeometry(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, scale: number): { vertices: Float32Array; normals: Float32Array; indices: Uint32Array } {
    // Ensure geometry has position attribute
    if (!geometry.attributes.position) {
      throw new Error('Geometry must have position attribute');
    }

    // Apply transformation matrix and scale
    const transformedGeometry = geometry.clone();
    transformedGeometry.applyMatrix4(matrix);
    transformedGeometry.scale(scale, scale, scale);

    // Get vertices
    const positionAttribute = transformedGeometry.attributes.position;
    const vertices = new Float32Array(positionAttribute.array);

    // Get or compute normals
    let normals: Float32Array;
    if (transformedGeometry.attributes.normal) {
      normals = new Float32Array(transformedGeometry.attributes.normal.array);
    } else {
      transformedGeometry.computeVertexNormals();
      normals = new Float32Array(transformedGeometry.attributes.normal.array);
    }

    // Get indices
    let indices: Uint32Array;
    if (transformedGeometry.index) {
      indices = new Uint32Array(transformedGeometry.index.array);
    } else {
      // Generate indices for non-indexed geometry
      indices = new Uint32Array(vertices.length / 3);
      for (let i = 0; i < indices.length; i++) {
        indices[i] = i;
      }
    }

    return { vertices, normals, indices };
  }

  private static exportASCII(geometries: Array<{ vertices: Float32Array; normals: Float32Array; indices: Uint32Array }>, options: Required<STLExportOptions>): string {
    let stl = 'solid CircuitCAD_Model\n';

    geometries.forEach(geometry => {
      const { vertices, normals, indices } = geometry;

      // Process triangles
      for (let i = 0; i < indices.length; i += 3) {
        const i0 = indices[i] * 3;
        const i1 = indices[i + 1] * 3;
        const i2 = indices[i + 2] * 3;

        // Calculate face normal if not provided
        let nx = 0, ny = 0, nz = 1;
        if (options.includeNormals && normals.length > 0) {
          // Average normals of the three vertices
          nx = (normals[i0] + normals[i1] + normals[i2]) / 3;
          ny = (normals[i0 + 1] + normals[i1 + 1] + normals[i2 + 1]) / 3;
          nz = (normals[i0 + 2] + normals[i1 + 2] + normals[i2 + 2]) / 3;
        }

        stl += `  facet normal ${nx} ${ny} ${nz}\n`;
        stl += '    outer loop\n';

        // Vertex 1
        stl += `      vertex ${vertices[i0]} ${vertices[i0 + 1]} ${vertices[i0 + 2]}\n`;
        // Vertex 2
        stl += `      vertex ${vertices[i1]} ${vertices[i1 + 1]} ${vertices[i1 + 2]}\n`;
        // Vertex 3
        stl += `      vertex ${vertices[i2]} ${vertices[i2 + 1]} ${vertices[i2 + 2]}\n`;

        stl += '    endloop\n';
        stl += '  endfacet\n';
      }
    });

    stl += 'endsolid CircuitCAD_Model\n';
    return stl;
  }

  private static exportBinary(geometries: Array<{ vertices: Float32Array; normals: Float32Array; indices: Uint32Array }>, options: Required<STLExportOptions>): ArrayBuffer {
    // Calculate total number of triangles
    let totalTriangles = 0;
    geometries.forEach(geometry => {
      totalTriangles += Math.floor(geometry.indices.length / 3);
    });

    // STL binary format: 80-byte header + 4-byte triangle count + 50 bytes per triangle
    const bufferSize = 80 + 4 + totalTriangles * 50;
    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);
    const uint8View = new Uint8Array(buffer);

    // Write header (80 bytes)
    const header = 'CircuitCAD Binary STL Export';
    for (let i = 0; i < Math.min(header.length, 80); i++) {
      uint8View[i] = header.charCodeAt(i);
    }

    // Write triangle count (4 bytes, little-endian)
    view.setUint32(80, totalTriangles, true);

    let offset = 84; // Start after header and triangle count

    geometries.forEach(geometry => {
      const { vertices, normals, indices } = geometry;

      for (let i = 0; i < indices.length; i += 3) {
        const i0 = indices[i] * 3;
        const i1 = indices[i + 1] * 3;
        const i2 = indices[i + 2] * 3;

        // Normal vector (12 bytes)
        let nx = 0, ny = 0, nz = 1;
        if (options.includeNormals && normals.length > 0) {
          nx = (normals[i0] + normals[i1] + normals[i2]) / 3;
          ny = (normals[i0 + 1] + normals[i1 + 1] + normals[i2 + 1]) / 3;
          nz = (normals[i0 + 2] + normals[i1 + 2] + normals[i2 + 2]) / 3;
        }

        view.setFloat32(offset, nx, true); offset += 4;
        view.setFloat32(offset, ny, true); offset += 4;
        view.setFloat32(offset, nz, true); offset += 4;

        // Vertex 1 (12 bytes)
        view.setFloat32(offset, vertices[i0], true); offset += 4;
        view.setFloat32(offset, vertices[i0 + 1], true); offset += 4;
        view.setFloat32(offset, vertices[i0 + 2], true); offset += 4;

        // Vertex 2 (12 bytes)
        view.setFloat32(offset, vertices[i1], true); offset += 4;
        view.setFloat32(offset, vertices[i1 + 1], true); offset += 4;
        view.setFloat32(offset, vertices[i1 + 2], true); offset += 4;

        // Vertex 3 (12 bytes)
        view.setFloat32(offset, vertices[i2], true); offset += 4;
        view.setFloat32(offset, vertices[i2 + 1], true); offset += 4;
        view.setFloat32(offset, vertices[i2 + 2], true); offset += 4;

        // Attribute byte count (2 bytes) - unused, set to 0
        view.setUint16(offset, 0, true); offset += 2;
      }
    });

    return buffer;
  }

  static downloadSTL(data: string | ArrayBuffer, filename: string = 'model.stl'): void {
    const blob = new Blob([data], {
      type: typeof data === 'string' ? 'text/plain' : 'application/octet-stream'
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  static validateSTL(data: string | ArrayBuffer): boolean {
    if (typeof data === 'string') {
      // ASCII STL validation
      return data.startsWith('solid ') && data.endsWith('endsolid ') && data.includes('facet normal');
    } else {
      // Binary STL validation
      const view = new DataView(data);
      if (data.byteLength < 84) return false; // Minimum size

      const triangleCount = view.getUint32(80, true);
      const expectedSize = 84 + triangleCount * 50;

      return data.byteLength === expectedSize;
    }
  }
}