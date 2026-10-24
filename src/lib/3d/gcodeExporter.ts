/**
 * FDM G-code export.
 *
 * Slicing is a real triangle–plane intersection, not a bounds approximation:
 * every mesh triangle is cut at each layer height, the resulting segments are
 * chained into closed loops, loops are oriented by nesting depth (outer CCW,
 * holes CW), and rectilinear infill is clipped with the even-odd rule. Shell
 * layers (first/last `solidLayers`) print solid; interior layers use the
 * requested infill density.
 *
 * Units are millimetres. Three.js scenes are Y-up, so by default world Y maps
 * to the printer's Z axis and the footprint is (world X, world Z). Set
 * `upAxis: 'z'` for Z-up assets.
 *
 * Honest limits: one perimeter path per loop (no wall offsetting), no support
 * generation, and FDM only. Enabling supports or selecting SLA/SLS throws
 * instead of emitting G-code that cannot be printed as intended.
 */
import { ThreeDModel, ThreeDScene } from './threeManager';
import * as THREE from 'three';

export interface GCodeMeshData {
  vertices: number[][];
  faces: number[][];
}

export interface GCodeMeshConfig {
  printerType: 'FDM' | 'SLA' | 'SLS';
  layerHeight: number;
  nozzleTemp: number;
  bedTemp: number;
  printSpeed: number;
  infillDensity: number;
}

export interface GCodeConfig {
  printer: 'fdm' | 'sla' | 'sls';
  layerHeight: number; // mm
  printSpeed: number; // mm/s
  travelSpeed: number; // mm/s
  nozzleTemperature: number; // °C
  bedTemperature: number; // °C
  infill: number; // 0-100%
  support: boolean;
  raft: boolean;
  skirt: boolean;
  brim: number; // loops around the footprint
  retractionDistance: number; // mm
  retractionSpeed: number; // mm/s
  extrusionWidth: number; // mm
  filamentDiameter: number; // mm
  solidLayers: number; // top/bottom shell layers
  raftLayers: number;
  skirtLoops: number;
  skirtGap: number; // mm outside the model footprint
  retractionMinTravel: number; // mm
  upAxis: 'x' | 'y' | 'z';
}

export interface SliceLayer {
  layerNumber: number;
  z: number;
  contours: Array<Array<{ x: number; y: number }>>;
  infill: Array<Array<{ x: number; y: number }>>;
}

type Vec3 = [number, number, number];
type Point2 = { x: number; y: number };

interface Triangle {
  a: Vec3;
  b: Vec3;
  c: Vec3;
}

interface Bounds2 {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const EPS = 1e-9;
const KEY_DECIMALS = 6;
const RAFT_MARGIN = 3;

function pointKey(point: Point2): string {
  return `${point.x.toFixed(KEY_DECIMALS)}|${point.y.toFixed(KEY_DECIMALS)}`;
}

function distance(a: Point2, b: Point2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function signedArea(points: Point2[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

function pointInPolygon(point: Point2, polygon: Point2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    const crosses = a.y > point.y !== b.y > point.y;
    if (crosses) {
      const x = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
      if (x > point.x) inside = !inside;
    }
  }
  return inside;
}

/**
 * Small sequential writer that tracks the nozzle so travel/retraction and
 * relative extrusion stay consistent.
 */
class GCodeWriter {
  readonly lines: string[] = [];
  private x = 0;
  private y = 0;
  private z = 0;
  private hasExtruded = false;

  constructor(private readonly config: GCodeConfig) {}

  comment(text: string): void {
    text.split('\n').forEach((line) => this.lines.push(`; ${line}`));
  }

  raw(line: string): void {
    this.lines.push(line);
  }

  layer(z: number): void {
    this.raw(`G0 Z${z.toFixed(3)} F${(this.config.travelSpeed * 60).toFixed(0)}`);
    this.z = z;
  }

  travel(target: Point2): void {
    if (distance({ x: this.x, y: this.y }, target) <= EPS) return;
    const shouldRetract =
      this.hasExtruded &&
      this.config.retractionDistance > 0 &&
      distance({ x: this.x, y: this.y }, target) > this.config.retractionMinTravel;
    if (shouldRetract) {
      this.raw(`G1 E-${this.config.retractionDistance.toFixed(4)} F${(this.config.retractionSpeed * 60).toFixed(0)}`);
    }
    this.raw(`G0 X${target.x.toFixed(3)} Y${target.y.toFixed(3)} F${(this.config.travelSpeed * 60).toFixed(0)}`);
    this.x = target.x;
    this.y = target.y;
    if (shouldRetract) {
      this.raw(`G1 E${this.config.retractionDistance.toFixed(4)} F${(this.config.retractionSpeed * 60).toFixed(0)}`);
    }
  }

  extrudeTo(target: Point2): void {
    const length = distance({ x: this.x, y: this.y }, target);
    if (length <= EPS) return;
    const filamentArea = Math.PI * (this.config.filamentDiameter / 2) ** 2;
    const extrusion = (length * this.config.extrusionWidth * this.config.layerHeight) / filamentArea;
    this.raw(
      `G1 X${target.x.toFixed(3)} Y${target.y.toFixed(3)} E${extrusion.toFixed(5)} F${(this.config.printSpeed * 60).toFixed(0)}`,
    );
    this.x = target.x;
    this.y = target.y;
    this.hasExtruded = true;
  }

  loop(points: Point2[]): void {
    if (points.length < 3) return;
    this.travel(points[0]);
    for (let i = 1; i < points.length; i += 1) this.extrudeTo(points[i]);
    this.extrudeTo(points[0]);
  }

  line(a: Point2, b: Point2): void {
    const here = { x: this.x, y: this.y };
    const [start, end] = distance(here, a) <= distance(here, b) ? [a, b] : [b, a];
    this.travel(start);
    this.extrudeTo(end);
  }

  finalize(): string {
    if (this.hasExtruded && this.config.retractionDistance > 0) {
      this.raw(`G1 E-${this.config.retractionDistance.toFixed(4)} F${(this.config.retractionSpeed * 60).toFixed(0)}`);
    }
    this.raw('G0 Z' + (this.z + 10).toFixed(3) + ' ; Lift nozzle');
    this.raw('M104 S0 ; Turn off extruder');
    this.raw('M140 S0 ; Turn off bed');
    this.raw('G28 X Y ; Home X and Y');
    this.raw('M84 ; Disable motors');
    return this.lines.join('\n');
  }
}

export class GCodeExporter {
  private config: GCodeConfig;
  private warnings: string[] = [];

  constructor(config: Partial<GCodeConfig> = {}) {
    this.config = {
      printer: 'fdm',
      layerHeight: 0.2,
      printSpeed: 50,
      travelSpeed: 150,
      nozzleTemperature: 200,
      bedTemperature: 60,
      infill: 20,
      support: false,
      raft: true,
      skirt: false,
      brim: 0,
      retractionDistance: 2.0,
      retractionSpeed: 25,
      extrusionWidth: 0.45,
      filamentDiameter: 1.75,
      solidLayers: 3,
      raftLayers: 2,
      skirtLoops: 2,
      skirtGap: 3,
      retractionMinTravel: 2,
      upAxis: 'y',
      ...config,
    };
    this.validateConfig();
  }

  setConfig(config: Partial<GCodeConfig>): void {
    this.config = { ...this.config, ...config };
    this.validateConfig();
  }

  getConfig(): GCodeConfig {
    return { ...this.config };
  }

  /** Slice a raw triangle mesh with the current layer height and up-axis. */
  sliceMesh(mesh: GCodeMeshData): SliceLayer[] {
    this.warnings = [];
    const triangles = this.meshTriangles(mesh);
    return this.sliceTriangles(triangles).layers;
  }

  /** Slice every model in a scene using its position/rotation/scale. */
  sliceScene(scene: Pick<ThreeDScene, 'models'>): SliceLayer[] {
    this.warnings = [];
    const triangles = this.sceneTriangles(scene.models);
    return this.sliceTriangles(triangles).layers;
  }

  exportToGCode(scene: Pick<ThreeDScene, 'models'>): string {
    this.assertMachineSupported();
    this.warnings = [];
    const triangles = this.sceneTriangles(scene.models);
    return this.composeGCode(triangles);
  }

  /** G-code for a single mesh using this exporter's full configuration. */
  exportMeshToGCode(mesh: GCodeMeshData): string {
    this.assertMachineSupported();
    this.warnings = [];
    const triangles = this.meshTriangles(mesh);
    return this.composeGCode(triangles);
  }

  /** Warnings produced by the most recent slice/export call. */
  getWarnings(): string[] {
    return [...this.warnings];
  }

  /** Convenience entry point for a single mesh. */
  generateGCode(model: GCodeMeshData, config: GCodeMeshConfig): string {
    if (config.printerType !== 'FDM') {
      throw new Error('G-code export currently supports FDM only; SLA/SLS jobs need a different machine format.');
    }
    this.assertMesh(model);
    this.setConfig({
      printer: 'fdm',
      layerHeight: config.layerHeight,
      nozzleTemperature: config.nozzleTemp,
      bedTemperature: config.bedTemp,
      printSpeed: config.printSpeed,
      infill: config.infillDensity,
    });
    this.assertMachineSupported();
    this.warnings = [];
    const triangles = this.meshTriangles(model);
    return this.composeGCode(triangles);
  }

  private validateConfig(): void {
    const positive: Array<[string, number]> = [
      ['Layer height', this.config.layerHeight],
      ['Print speed', this.config.printSpeed],
      ['Travel speed', this.config.travelSpeed],
      ['Extrusion width', this.config.extrusionWidth],
      ['Filament diameter', this.config.filamentDiameter],
    ];
    positive.forEach(([name, value]) => {
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`${name} must be a finite value > 0.`);
      }
    });
    if (!Number.isFinite(this.config.infill) || this.config.infill < 0 || this.config.infill > 100) {
      throw new Error('Infill must be between 0 and 100 %.');
    }
    if (!Number.isInteger(this.config.brim) || this.config.brim < 0) {
      throw new Error('Brim must be a non-negative integer loop count.');
    }
    if (!Number.isInteger(this.config.raftLayers) || this.config.raftLayers < 0) {
      throw new Error('Raft layers must be a non-negative integer.');
    }
    if (!Number.isInteger(this.config.skirtLoops) || this.config.skirtLoops < 0) {
      throw new Error('Skirt loops must be a non-negative integer.');
    }
  }

  private assertMachineSupported(): void {
    if (this.config.printer !== 'fdm') {
      throw new Error('G-code export currently supports FDM only; SLA/SLS jobs need a different machine format.');
    }
    if (this.config.support) {
      throw new Error('Support generation is not implemented; disable support before exporting.');
    }
  }

  private assertMesh(model: GCodeMeshData): void {
    if (model.vertices.length < 3 || model.faces.length === 0) {
      throw new Error('G-code generation requires a mesh with vertices and faces');
    }
    if (model.vertices.some((vertex) => vertex.length !== 3 || vertex.some((value) => !Number.isFinite(value)))) {
      throw new Error('Every mesh vertex must contain three finite coordinates');
    }
    if (
      model.faces.some(
        (face) =>
          face.length !== 3 ||
          face.some((index) => !Number.isInteger(index) || index < 0 || index >= model.vertices.length),
      )
    ) {
      throw new Error('Every mesh face must contain three valid vertex indices');
    }
  }

  /** Map a mesh-space point into printer space (Z = build height). */
  private toPrinter([x, y, z]: Vec3): Vec3 {
    switch (this.config.upAxis) {
      case 'x':
        return [y, z, x];
      case 'z':
        return [x, y, z];
      default:
        return [x, z, y];
    }
  }

  private meshTriangles(mesh: GCodeMeshData): Triangle[] {
    this.assertMesh(mesh);
    const triangles: Triangle[] = [];
    mesh.faces.forEach((face) => {
      const [ia, ib, ic] = face;
      const a = mesh.vertices[ia];
      const b = mesh.vertices[ib];
      const c = mesh.vertices[ic];
      triangles.push({
        a: this.toPrinter([a[0], a[1], a[2]]),
        b: this.toPrinter([b[0], b[1], b[2]]),
        c: this.toPrinter([c[0], c[1], c[2]]),
      });
    });
    return triangles;
  }

  private sceneTriangles(models: ThreeDModel[]): Triangle[] {
    const triangles: Triangle[] = [];
    models.forEach((model) => {
      const position = model.geometry.getAttribute('position');
      if (!position) {
        this.warnings.push(`Model "${model.name}" has no position attribute and was skipped.`);
        return;
      }
      const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3(model.position.x, model.position.y, model.position.z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(model.rotation.x, model.rotation.y, model.rotation.z)),
        new THREE.Vector3(model.scale.x, model.scale.y, model.scale.z),
      );
      const index = model.geometry.getIndex();
      const indices = index ? Array.from(index.array) : Array.from({ length: position.count }, (_, i) => i);
      if (indices.length % 3 !== 0) {
        throw new Error(`Model "${model.name}" has an index count that is not a multiple of three.`);
      }
      const vertex = new THREE.Vector3();
      for (let i = 0; i < indices.length; i += 3) {
        const points = [indices[i], indices[i + 1], indices[i + 2]].map((vertexIndex) => {
          vertex.fromBufferAttribute(position, vertexIndex).applyMatrix4(matrix);
          return this.toPrinter([vertex.x, vertex.y, vertex.z]);
        });
        triangles.push({ a: points[0], b: points[1], c: points[2] });
      }
    });
    return triangles;
  }

  private sliceTriangles(triangles: Triangle[]): { layers: SliceLayer[] } {
    if (triangles.length === 0) {
      this.warnings.push('No mesh triangles were available to slice.');
      return { layers: [] };
    }
    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    triangles.forEach((triangle) => {
      [triangle.a, triangle.b, triangle.c].forEach((vertex) => {
        minZ = Math.min(minZ, vertex[2]);
        maxZ = Math.max(maxZ, vertex[2]);
      });
    });
    const height = maxZ - minZ;
    if (!(height > EPS)) {
      this.warnings.push('Model has zero height along the build axis; there is nothing to print.');
      return { layers: [] };
    }

    const layerCount = Math.max(1, Math.ceil(height / this.config.layerHeight));
    const layers: SliceLayer[] = [];
    for (let i = 0; i < layerCount; i += 1) {
      const sliceZ = minZ + Math.min((i + 0.5) * this.config.layerHeight, height - 1e-7);
      const contours = this.contoursAt(triangles, sliceZ);
      const solid = i < this.config.solidLayers || i >= layerCount - this.config.solidLayers;
      layers.push({
        layerNumber: i,
        z: (i + 0.5) * this.config.layerHeight,
        contours,
        infill: contours.length > 0 ? this.infillLines(contours, i, solid) : [],
      });
    }
    return { layers };
  }

  private contoursAt(triangles: Triangle[], z: number): Point2[][] {
    const segments: Array<[Point2, Point2]> = [];
    const seenSegments = new Set<string>();

    triangles.forEach((triangle) => {
      const vertices: Vec3[] = [triangle.a, triangle.b, triangle.c];
      const distances = vertices.map((vertex) => vertex[2] - z);
      if (distances.every((d) => Math.abs(d) <= EPS)) return; // coplanar cap

      const points: Vec3[] = [];
      const add = (vertex: Vec3) => {
        const candidate = { x: vertex[0], y: vertex[1] };
        if (!points.some((existing) => pointKey({ x: existing[0], y: existing[1] }) === pointKey(candidate))) {
          points.push([vertex[0], vertex[1], 0]);
        }
      };

      for (let i = 0; i < 3; i += 1) {
        const j = (i + 1) % 3;
        const da = distances[i];
        const db = distances[j];
        if (Math.abs(da) <= EPS) add(vertices[i]);
        if ((da > EPS && db < -EPS) || (da < -EPS && db > EPS)) {
          const t = da / (da - db);
          add([
            vertices[i][0] + t * (vertices[j][0] - vertices[i][0]),
            vertices[i][1] + t * (vertices[j][1] - vertices[i][1]),
            0,
          ]);
        }
      }

      if (points.length < 2) return;
      const a: Point2 = { x: points[0][0], y: points[0][1] };
      const b: Point2 = { x: points[1][0], y: points[1][1] };
      if (distance(a, b) <= EPS) return;
      const segmentKey = [pointKey(a), pointKey(b)].sort().join('>');
      if (seenSegments.has(segmentKey)) return;
      seenSegments.add(segmentKey);
      segments.push([a, b]);
    });

    if (segments.length === 0) return [];

    const nodes = new Map<string, number[]>();
    segments.forEach(([a, b], index) => {
      const ak = pointKey(a);
      const bk = pointKey(b);
      nodes.set(ak, [...(nodes.get(ak) ?? []), index]);
      nodes.set(bk, [...(nodes.get(bk) ?? []), index]);
    });

    const used = new Set<number>();
    const loops: Point2[][] = [];
    let openChains = 0;

    for (let start = 0; start < segments.length; start += 1) {
      if (used.has(start)) continue;
      used.add(start);
      const [startPoint, second] = segments[start];
      const startKey = pointKey(startPoint);
      const points: Point2[] = [startPoint, second];
      let current = second;
      let closed = false;

      for (let guard = 0; guard <= segments.length; guard += 1) {
        if (pointKey(current) === startKey) {
          closed = true;
          break;
        }
        const candidates = nodes.get(pointKey(current)) ?? [];
        const next = candidates.find((index) => !used.has(index));
        if (next === undefined) break;
        used.add(next);
        const [a, b] = segments[next];
        current = pointKey(a) === pointKey(current) ? b : a;
        points.push(current);
      }

      if (!closed) {
        openChains += 1;
        continue;
      }
      points.pop(); // drop the repeated start point
      if (points.length >= 3) loops.push(points);
    }

    if (openChains > 0) {
      this.warnings.push(`${openChains} open chain(s) discarded at Z=${z.toFixed(3)} mm (mesh may not be watertight).`);
    }

    return this.orientContours(loops);
  }

  /** Drop collinear vertices introduced where a slice crosses a mesh edge. */
  private simplifyLoop(input: Point2[]): Point2[] {
    const points = [...input];
    let changed = true;
    while (changed && points.length > 3) {
      changed = false;
      for (let i = 0; i < points.length; i += 1) {
        const previous = points[(i - 1 + points.length) % points.length];
        const current = points[i];
        const next = points[(i + 1) % points.length];
        const cross =
          (current.x - previous.x) * (next.y - current.y) -
          (current.y - previous.y) * (next.x - current.x);
        const scale = Math.max(
          1,
          Math.abs(current.x - previous.x) + Math.abs(current.y - previous.y) +
            Math.abs(next.x - current.x) + Math.abs(next.y - current.y),
        );
        if (Math.abs(cross) <= 1e-9 * scale) {
          points.splice(i, 1);
          changed = true;
          break;
        }
      }
    }
    return points;
  }

  /** Orient outer loops CCW and holes CW using even-odd nesting depth. */
  private orientContours(loops: Point2[][]): Point2[][] {
    const meta = loops
      .map((points) => this.simplifyLoop(points))
      .map((points) => ({ points, area: signedArea(points) }))
      .filter((entry) => entry.points.length >= 3 && Math.abs(entry.area) > EPS);

    return meta.map((entry) => {
      const depth = meta.filter(
        (other) => other !== entry && pointInPolygon(entry.points[0], other.points),
      ).length;
      const wantCounterClockwise = depth % 2 === 0;
      const isCounterClockwise = entry.area > 0;
      return wantCounterClockwise === isCounterClockwise ? entry.points : [...entry.points].reverse();
    });
  }

  private infillLines(contours: Point2[][], layerIndex: number, solid: boolean): Array<[Point2, Point2]> {
    const density = solid ? 100 : this.config.infill;
    if (density <= 0) return [];
    const spacing = this.config.extrusionWidth / (density / 100);
    const angle = ((layerIndex % 2 === 0 ? 45 : 135) * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    const transformed = contours.map((contour) =>
      contour.map((point) => ({
        u: point.x * cos + point.y * sin,
        v: -point.x * sin + point.y * cos,
      })),
    );

    let minV = Number.POSITIVE_INFINITY;
    let maxV = Number.NEGATIVE_INFINITY;
    transformed.forEach((contour) => {
      contour.forEach((point) => {
        minV = Math.min(minV, point.v);
        maxV = Math.max(maxV, point.v);
      });
    });
    if (!Number.isFinite(minV) || !Number.isFinite(maxV)) return [];

    const lines: Array<[Point2, Point2]> = [];
    const startV = Math.ceil(minV / spacing) * spacing;
    const lineCount = Math.max(0, Math.floor((maxV - startV) / spacing));
    let lineIndex = 0;

    for (let step = 0; step <= lineCount; step += 1) {
      const v = startV + step * spacing;
      const intersections: number[] = [];
      transformed.forEach((contour) => {
        for (let i = 0; i < contour.length; i += 1) {
          const a = contour[i];
          const b = contour[(i + 1) % contour.length];
          if ((a.v <= v && b.v > v) || (b.v <= v && a.v > v)) {
            const t = (v - a.v) / (b.v - a.v);
            intersections.push(a.u + t * (b.u - a.u));
          }
        }
      });
      intersections.sort((a, b) => a - b);
      for (let i = 0; i + 1 < intersections.length; i += 2) {
        if (intersections[i + 1] - intersections[i] <= EPS) continue;
        const toXY = (u: number): Point2 => ({
          x: u * cos - v * sin,
          y: u * sin + v * cos,
        });
        const start = toXY(intersections[i]);
        const end = toXY(intersections[i + 1]);
        lines.push(lineIndex % 2 === 0 ? [start, end] : [end, start]);
        lineIndex += 1;
      }
    }

    return lines;
  }

  private contourBounds(layers: SliceLayer[]): Bounds2 | null {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    layers.forEach((layer) => {
      layer.contours.forEach((contour) => {
        contour.forEach((point) => {
          minX = Math.min(minX, point.x);
          minY = Math.min(minY, point.y);
          maxX = Math.max(maxX, point.x);
          maxY = Math.max(maxY, point.y);
        });
      });
    });
    return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
  }

  private rectangle(bounds: Bounds2, offset: number): Point2[] {
    return [
      { x: bounds.minX - offset, y: bounds.minY - offset },
      { x: bounds.maxX + offset, y: bounds.minY - offset },
      { x: bounds.maxX + offset, y: bounds.maxY + offset },
      { x: bounds.minX - offset, y: bounds.maxY + offset },
    ];
  }

  private composeGCode(triangles: Triangle[]): string {
    const writer = new GCodeWriter(this.config);
    writer.comment('G-code generated by Folio');
    writer.comment(`Date: ${new Date().toISOString()}`);
    writer.comment(`Printer: ${this.config.printer.toUpperCase()}`);
    writer.comment(`Layer height: ${this.config.layerHeight} mm`);
    writer.comment(`Extrusion width: ${this.config.extrusionWidth} mm`);
    writer.comment(`Filament: ${this.config.filamentDiameter} mm`);
    writer.comment(`Infill: ${this.config.infill} %`);
    writer.comment('Extrusion mode: relative (M83)');
    this.warnings.forEach((warning) => writer.comment(`Warning: ${warning}`));

    writer.raw('; Initialize printer');
    writer.raw('G21 ; Set units to millimeters');
    writer.raw('G90 ; Use absolute coordinates');
    writer.raw('M83 ; Set extruder to relative mode');
    writer.raw(`M104 S${this.config.nozzleTemperature} ; Set extruder temperature`);
    writer.raw(`M140 S${this.config.bedTemperature} ; Set bed temperature`);
    writer.raw('G28 ; Home all axes');
    writer.raw('G29 ; Auto bed leveling');
    writer.raw(`M109 S${this.config.nozzleTemperature} ; Wait for extruder temperature`);
    writer.raw(`M190 S${this.config.bedTemperature} ; Wait for bed temperature`);
    writer.raw('');

    const { layers } = this.sliceTriangles(triangles);
    const bounds = this.contourBounds(layers);
    if (!bounds || !layers.some((layer) => layer.contours.length > 0)) {
      writer.comment('No closed contours were produced; nothing can be printed.');
      writer.raw('M84 ; Disable motors');
      return writer.lines.join('\n');
    }

    let zOffset = 0;
    if (this.config.raft && this.config.raftLayers > 0) {
      zOffset = this.printRaft(writer, bounds);
    }

    const firstLayerZ = zOffset + this.config.layerHeight / 2;
    if (this.config.brim > 0) {
      writer.comment(`Brim: ${this.config.brim} loop(s)`);
      writer.layer(firstLayerZ);
      for (let i = 0; i < this.config.brim; i += 1) {
        writer.loop(this.rectangle(bounds, (i + 1) * this.config.extrusionWidth));
      }
    }
    if (this.config.skirt) {
      writer.comment(`Skirt: ${this.config.skirtLoops} loop(s)`);
      writer.layer(firstLayerZ);
      for (let i = 0; i < this.config.skirtLoops; i += 1) {
        writer.loop(this.rectangle(bounds, this.config.skirtGap + i * this.config.extrusionWidth));
      }
    }

    layers.forEach((layer) => {
      if (layer.contours.length === 0) return;
      writer.comment(`Layer ${layer.layerNumber} at Z=${(zOffset + layer.z).toFixed(3)} mm`);
      writer.layer(zOffset + layer.z);
      layer.contours.forEach((contour) => writer.loop(contour));
      if (layer.infill.length > 0) {
        writer.comment('Infill');
        layer.infill.forEach(([a, b]) => writer.line(a, b));
      }
    });

    return writer.finalize();
  }

  private printRaft(writer: GCodeWriter, bounds: Bounds2): number {
    const spacing = this.config.extrusionWidth;
    const minX = bounds.minX - RAFT_MARGIN;
    const maxX = bounds.maxX + RAFT_MARGIN;
    const minY = bounds.minY - RAFT_MARGIN;
    const maxY = bounds.maxY + RAFT_MARGIN;
    writer.comment(`Raft: ${this.config.raftLayers} layer(s), ${RAFT_MARGIN} mm margin`);

    for (let i = 0; i < this.config.raftLayers; i += 1) {
      const z = (i + 0.5) * this.config.layerHeight;
      writer.layer(z);
      if (i % 2 === 0) {
        for (let y = minY; y <= maxY + EPS; y += spacing) {
          writer.line({ x: minX, y }, { x: maxX, y });
        }
      } else {
        for (let x = minX; x <= maxX + EPS; x += spacing) {
          writer.line({ x, y: minY }, { x, y: maxY });
        }
      }
    }
    return this.config.raftLayers * this.config.layerHeight;
  }
}

export const gcodeExporter = new GCodeExporter();
