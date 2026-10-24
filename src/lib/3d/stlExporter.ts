import * as THREE from 'three';

export interface STLExportOptions {
  binary?: boolean;
  includeNormals?: boolean;
  scale?: number;
}

export interface TriangleMeshData {
  vertices: number[][];
  faces: number[][];
}

export class STLExporter {
  private static readonly DEFAULT_OPTIONS: Required<STLExportOptions> = {
    binary: false,
    includeNormals: true,
    scale: 1
  };

  private static resolveOptions(options: STLExportOptions): Required<STLExportOptions> {
    const opts = { ...this.DEFAULT_OPTIONS, ...options };
    if (!Number.isFinite(opts.scale) || opts.scale <= 0) {
      throw new Error('STL export requires a finite positive scale');
    }
    return opts;
  }

  static exportScene(scene: THREE.Scene, options: STLExportOptions = {}): string | ArrayBuffer {
    const opts = this.resolveOptions(options);
    // World matrices are lazy; an un-updated scene would export stale transforms.
    scene.updateMatrixWorld(true);
    const geometries = this.collectGeometries(scene, opts.scale);

    if (opts.binary) {
      return this.exportBinary(geometries, opts);
    } else {
      return this.exportASCII(geometries, opts);
    }
  }

  static exportMesh(mesh: THREE.Mesh, options: STLExportOptions = {}): string | ArrayBuffer {
    const opts = this.resolveOptions(options);
    mesh.updateMatrixWorld(true);
    const geometries = [this.processGeometry(mesh.geometry, mesh.matrixWorld, opts.scale)];

    if (opts.binary) {
      return this.exportBinary(geometries, opts);
    } else {
      return this.exportASCII(geometries, opts);
    }
  }

  static exportToSTL(geometry: THREE.BufferGeometry | TriangleMeshData, filename = 'Folio_Model'): string {
    const opts = this.resolveOptions({});
    const bufferGeometry = geometry instanceof THREE.BufferGeometry ? geometry : this.createBufferGeometry(geometry);
    const processedGeometry = this.processGeometry(bufferGeometry, new THREE.Matrix4(), opts.scale);
    const solidName = filename.replace(/[^a-zA-Z0-9_.-]/g, '_') || 'Folio_Model';
    return this.exportASCII([processedGeometry], opts, solidName);
  }

  private static createBufferGeometry(mesh: TriangleMeshData): THREE.BufferGeometry {
    if (!Array.isArray(mesh.vertices) || !Array.isArray(mesh.faces) || mesh.vertices.length < 3 || mesh.faces.length === 0) {
      throw new Error('STL export requires at least three vertices and one triangle');
    }
    if (mesh.vertices.some(vertex => vertex.length !== 3 || vertex.some(value => !Number.isFinite(value)))) {
      throw new Error('Every STL vertex must contain three finite coordinates');
    }
    if (mesh.faces.some(face => face.length !== 3 || face.some(index =>
      !Number.isInteger(index) || index < 0 || index >= mesh.vertices.length
    ))) {
      throw new Error('Every STL face must contain three valid vertex indices');
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.vertices.flat(), 3));
    geometry.setIndex(mesh.faces.flat());
    geometry.computeVertexNormals();
    return geometry;
  }

  private static collectGeometries(scene: THREE.Scene, scale: number): Array<{ vertices: Float32Array; normals: Float32Array; indices: Uint32Array }> {
    const geometries: Array<{ vertices: Float32Array; normals: Float32Array; indices: Uint32Array }> = [];

    scene.traverse((object) => {
      if (object instanceof THREE.Mesh && object.geometry) {
        geometries.push(this.processGeometry(object.geometry, object.matrixWorld, scale));
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
    for (let i = 0; i < vertices.length; i++) {
      if (!Number.isFinite(vertices[i])) {
        throw new Error('STL export requires finite vertex coordinates');
      }
    }
    if (!transformedGeometry.index && vertices.length % 9 !== 0) {
      throw new Error('STL export requires non-indexed positions in whole triangles');
    }

    // Get or compute normals
    let normals: Float32Array;
    if (transformedGeometry.attributes.normal) {
      normals = new Float32Array(transformedGeometry.attributes.normal.array);
    } else {
      transformedGeometry.computeVertexNormals();
      const normalAttribute = transformedGeometry.attributes.normal as THREE.BufferAttribute | undefined;
      if (normalAttribute) {
        normals = new Float32Array(normalAttribute.array);
      } else {
        // Fallback: create default normals
        normals = new Float32Array(vertices.length);
        for (let i = 0; i < normals.length; i += 3) {
          normals[i] = 0;     // nx
          normals[i + 1] = 0; // ny
          normals[i + 2] = 1; // nz
        }
      }
    }
    for (let i = 0; i < normals.length; i++) {
      if (!Number.isFinite(normals[i])) {
        throw new Error('STL export requires finite vertex normals');
      }
    }

    // Get indices. STL stores triangles, so partial/index-out-of-range data is
    // rejected rather than written as a NaN vertex.
    const vertexCount = vertices.length / 3;
    let indices: Uint32Array;
    if (transformedGeometry.index) {
      const source = transformedGeometry.index.array;
      if (source.length % 3 !== 0) {
        throw new Error('STL export requires an index buffer containing whole triangles');
      }
      indices = new Uint32Array(source.length);
      for (let i = 0; i < source.length; i++) {
        const index = source[i];
        if (!Number.isInteger(index) || index < 0 || index >= vertexCount) {
          throw new Error('STL export has a face index outside the vertex buffer');
        }
        indices[i] = index;
      }
    } else {
      // Generate indices for non-indexed geometry (already verified as whole triangles)
      indices = new Uint32Array(vertexCount);
      for (let i = 0; i < indices.length; i++) {
        indices[i] = i;
      }
    }

    return { vertices, normals, indices };
  }

  /**
   * Unit facet normal from the triangle winding. STL stores one normal per
   * facet, so this is the correct fallback when vertex normals are absent or
   * explicitly excluded; writing (0,0,1) would be a lie about the geometry.
   */
  private static facetNormal(vertices: Float32Array, i0: number, i1: number, i2: number): [number, number, number] {
    const ax = vertices[i1] - vertices[i0];
    const ay = vertices[i1 + 1] - vertices[i0 + 1];
    const az = vertices[i1 + 2] - vertices[i0 + 2];
    const bx = vertices[i2] - vertices[i0];
    const by = vertices[i2 + 1] - vertices[i0 + 1];
    const bz = vertices[i2 + 2] - vertices[i0 + 2];
    let nx = ay * bz - az * by;
    let ny = az * bx - ax * bz;
    let nz = ax * by - ay * bx;
    const length = Math.hypot(nx, ny, nz);
    if (length > 0) {
      nx /= length;
      ny /= length;
      nz /= length;
    }
    return [nx, ny, nz];
  }

  private static normalForTriangle(
    vertices: Float32Array,
    normals: Float32Array,
    options: Required<STLExportOptions>,
    i0: number,
    i1: number,
    i2: number,
  ): [number, number, number] {
    if (!options.includeNormals || normals.length === 0) {
      return this.facetNormal(vertices, i0, i1, i2);
    }
    let nx = (normals[i0] + normals[i1] + normals[i2]) / 3;
    let ny = (normals[i0 + 1] + normals[i1 + 1] + normals[i2 + 1]) / 3;
    let nz = (normals[i0 + 2] + normals[i1 + 2] + normals[i2 + 2]) / 3;
    const length = Math.hypot(nx, ny, nz);
    if (length > 0) {
      nx /= length;
      ny /= length;
      nz /= length;
    } else {
      return this.facetNormal(vertices, i0, i1, i2);
    }
    return [nx, ny, nz];
  }

  private static exportASCII(
    geometries: Array<{ vertices: Float32Array; normals: Float32Array; indices: Uint32Array }>,
    options: Required<STLExportOptions>,
    solidName = 'Folio_Model',
  ): string {
    let stl = `solid ${solidName}\n`;

    geometries.forEach(geometry => {
      const { vertices, normals, indices } = geometry;

      // Process triangles
      for (let i = 0; i < indices.length; i += 3) {
        const i0 = indices[i] * 3;
        const i1 = indices[i + 1] * 3;
        const i2 = indices[i + 2] * 3;

        // Facet normal from averaged vertex normals when available; otherwise
        // from the triangle itself.
        const [nx, ny, nz] = this.normalForTriangle(vertices, normals, options, i0, i1, i2);

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

    stl += `endsolid ${solidName}\n`;
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
    const header = 'Folio Binary STL Export';
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
        const [nx, ny, nz] = this.normalForTriangle(vertices, normals, options, i0, i1, i2);

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
      const text = data.trim();
      return text.startsWith('solid ') && /endsolid\s+\S+$/.test(text) && text.includes('facet normal');
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