import { describe, expect, it } from 'vitest';
import { buildDemoEnclosure } from '../demo/demoEnclosure';
import { GCodeExporter } from './gcodeExporter';
import { buildEnclosureTrayMesh } from './printableEnclosure';

function contourArea(points: Array<{ x: number; y: number }>): number {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

describe('buildEnclosureTrayMesh', () => {
  const spec = buildDemoEnclosure().spec;
  const part = buildEnclosureTrayMesh(spec);

  it('emits a watertight shell (every edge is shared by exactly two triangles)', () => {
    const { vertices, faces } = part.mesh;
    const edges = new Map<string, number>();
    faces.forEach((face) => {
      for (let i = 0; i < 3; i += 1) {
        const a = face[i];
        const b = face[(i + 1) % 3];
        const key = [vertices[a], vertices[b]]
          .map((vertex) => vertex.join(','))
          .sort()
          .join('|');
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    });
    edges.forEach((count) => expect(count).toBe(2));
  });

  it('has the enclosure outer dimensions and an open cavity', () => {
    expect(part.outerMm.width).toBe(70);
    expect(part.outerMm.depth).toBe(63);
    expect(part.outerMm.height).toBeCloseTo(11.6, 9);
    expect(part.wallMm).toBe(2);

    const exporter = new GCodeExporter({ upAxis: 'y', layerHeight: 0.2, raft: false, retractionDistance: 0 });
    const layers = exporter.sliceMesh(part.mesh);
    expect(layers).toHaveLength(58);

    // First layer is solid floor; a mid layer is a ring: shell CCW, cavity CW.
    expect(layers[0].contours).toHaveLength(1);
    expect(contourArea(layers[0].contours[0])).toBeCloseTo(70 * 63, 6);

    const mid = layers[Math.floor(layers.length / 2)];
    expect(mid.contours).toHaveLength(2);
    const areas = mid.contours.map(contourArea);
    expect(Math.max(...areas)).toBeCloseTo(70 * 63, 6);
    expect(Math.min(...areas)).toBeCloseTo(-66 * 59, 6);
    expect(mid.infill.length).toBeGreaterThan(0);

    const gcode = exporter.exportMeshToGCode(part.mesh);
    expect(gcode).toContain('M83');
    expect(gcode).toContain('; Layer 0');
    expect(exporter.getWarnings().filter((warning) => warning.includes('open chain'))).toHaveLength(0);
  });
});
