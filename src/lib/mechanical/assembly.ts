/**
 * Rigid-body assembly mates for the mechanical CAD domain.
 * Closed-form translation solvers; fail-loud on malformed input.
 */

export type Vec3 = readonly [number, number, number];
export type Mat3 = readonly [number, number, number, number, number, number, number, number, number];

export interface BodyFrame {
  position: Vec3;
  rotation: Mat3;
}

export type MateKind = 'coincident' | 'concentric' | 'parallel' | 'perpendicular' | 'distance' | 'angle';

export interface Mate {
  kind: MateKind;
  pointA: Vec3;
  pointB: Vec3;
  axisA?: Vec3;
  axisB?: Vec3;
  value?: number;
}

function assertVec3(v: Vec3, name: string): void {
  if (v.length !== 3) throw new Error(`${name} must have 3 elements.`);
  for (let i = 0; i < 3; i += 1) {
    if (!Number.isFinite(v[i])) throw new Error(`${name}[${i}] is not finite.`);
  }
}

function assertMat3(m: Mat3): void {
  if (m.length !== 9) throw new Error(`Rotation must have 9 elements, got ${m.length}.`);
  for (let i = 0; i < 9; i += 1) {
    if (!Number.isFinite(m[i])) throw new Error(`Rotation element ${i} is not finite.`);
  }
  const rows: Vec3[] = [[m[0], m[1], m[2]], [m[3], m[4], m[5]], [m[6], m[7], m[8]]];
  for (let r = 0; r < 3; r += 1) {
    const n = Math.hypot(rows[r][0], rows[r][1], rows[r][2]);
    if (Math.abs(n - 1) > 1e-9) throw new Error(`Rotation row ${r} is not unit length (|r|=${n}).`);
  }
  const dot01 = rows[0][0] * rows[1][0] + rows[0][1] * rows[1][1] + rows[0][2] * rows[1][2];
  const dot02 = rows[0][0] * rows[2][0] + rows[0][1] * rows[2][1] + rows[0][2] * rows[2][2];
  const dot12 = rows[1][0] * rows[2][0] + rows[1][1] * rows[2][1] + rows[1][2] * rows[2][2];
  if (Math.abs(dot01) > 1e-9 || Math.abs(dot02) > 1e-9 || Math.abs(dot12) > 1e-9) {
    throw new Error('Rotation rows are not mutually orthogonal.');
  }
  const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
  if (Math.abs(det - 1) > 1e-9) throw new Error(`Rotation must be right-handed (det=${det}).`);
}

export function assertFrame(f: BodyFrame): void {
  assertVec3(f.position, 'position');
  assertMat3(f.rotation);
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

function norm(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

function normalize(a: Vec3, name: string): Vec3 {
  const n = norm(a);
  if (!(n > 0) || !Number.isFinite(n)) throw new Error(`${name} must be a non-zero finite vector.`);
  return [a[0] / n, a[1] / n, a[2] / n];
}

/** Apply a body frame to a local point: R*p + t. */
export function transformPoint(frame: BodyFrame, p: Vec3): Vec3 {
  assertFrame(frame);
  assertVec3(p, 'point');
  const r = frame.rotation;
  return [
    r[0] * p[0] + r[1] * p[1] + r[2] * p[2] + frame.position[0],
    r[3] * p[0] + r[4] * p[1] + r[5] * p[2] + frame.position[1],
    r[6] * p[0] + r[7] * p[1] + r[8] * p[2] + frame.position[2],
  ];
}

/** Rotate a local direction into world (no translation). */
export function transformDirection(frame: BodyFrame, d: Vec3): Vec3 {
  assertFrame(frame);
  assertVec3(d, 'direction');
  const r = frame.rotation;
  return [
    r[0] * d[0] + r[1] * d[1] + r[2] * d[2],
    r[3] * d[0] + r[4] * d[1] + r[5] * d[2],
    r[6] * d[0] + r[7] * d[1] + r[8] * d[2],
  ];
}

export function solveMateTranslation(fixedA: BodyFrame, movingB: BodyFrame, mate: Mate): Vec3 {
  assertFrame(fixedA);
  assertFrame(movingB);
  assertVec3(mate.pointA, 'pointA');
  assertVec3(mate.pointB, 'pointB');
  const worldA = transformPoint(fixedA, mate.pointA);
  const r = movingB.rotation;
  const offset: Vec3 = [
    r[0] * mate.pointB[0] + r[1] * mate.pointB[1] + r[2] * mate.pointB[2],
    r[3] * mate.pointB[0] + r[4] * mate.pointB[1] + r[5] * mate.pointB[2],
    r[6] * mate.pointB[0] + r[7] * mate.pointB[1] + r[8] * mate.pointB[2],
  ];
  switch (mate.kind) {
    case 'coincident':
      return sub(worldA, offset);
    case 'concentric': {
      if (!mate.axisA || !mate.axisB) throw new Error('concentric mate needs axisA and axisB.');
      const aA = normalize(transformDirection(fixedA, mate.axisA), 'axisA');
      const aB = normalize(transformDirection(movingB, mate.axisB), 'axisB');
      if (Math.abs(Math.abs(dot(aA, aB)) - 1) > 1e-9) {
        throw new Error('concentric mate needs parallel axes; rotate B first.');
      }
      const worldB = add(movingB.position, offset);
      const delta = sub(worldB, worldA);
      const perp = sub(delta, scale(aA, dot(delta, aA)));
      return sub(movingB.position, perp);
    }
    case 'distance': {
      if (mate.value === undefined || !Number.isFinite(mate.value)) {
        throw new Error('distance mate needs a finite value.');
      }
      if (mate.value < 0) throw new Error('distance mate value must be >= 0.');
      const worldB = add(movingB.position, offset);
      const delta = sub(worldB, worldA);
      const d = norm(delta);
      if (d === 0) {
        if (mate.value === 0) return movingB.position;
        throw new Error('distance mate direction is undefined for coincident points.');
      }
      const target = add(worldA, scale(delta, mate.value / d));
      return add(movingB.position, sub(target, worldB));
    }
    case 'parallel':
    case 'perpendicular':
    case 'angle':
      throw new Error(`${mate.kind} mate constrains orientation, not translation.`);
    default:
      throw new Error(`Unknown mate kind: ${String((mate as { kind: unknown }).kind)}.`);
  }
}

/** Angle in radians between two world directions, in [0, PI]. */
export function angleBetween(a: Vec3, b: Vec3): number {
  const c = Math.min(1, Math.max(-1, dot(normalize(a, 'a'), normalize(b, 'b'))));
  return Math.acos(c);
}

/** Check whether a mate holds between two placed bodies within tolerance. */
export function mateHolds(a: BodyFrame, b: BodyFrame, mate: Mate, tol = 1e-9): boolean {
  assertFrame(a);
  assertFrame(b);
  const worldA = transformPoint(a, mate.pointA);
  const worldB = transformPoint(b, mate.pointB);
  switch (mate.kind) {
    case 'coincident':
      return norm(sub(worldA, worldB)) <= tol;
    case 'distance': {
      if (mate.value === undefined) throw new Error('distance mate needs a finite value.');
      return Math.abs(norm(sub(worldA, worldB)) - mate.value) <= tol;
    }
    case 'concentric': {
      if (!mate.axisA || !mate.axisB) throw new Error('concentric mate needs axisA and axisB.');
      const aA = normalize(transformDirection(a, mate.axisA), 'axisA');
      const aB = normalize(transformDirection(b, mate.axisB), 'axisB');
      if (Math.abs(Math.abs(dot(aA, aB)) - 1) > 1e-6) return false;
      const delta = sub(worldB, worldA);
      return norm(sub(delta, scale(aA, dot(delta, aA)))) <= tol;
    }
    case 'parallel': {
      if (!mate.axisA || !mate.axisB) throw new Error('parallel mate needs axisA and axisB.');
      const d = dot(normalize(transformDirection(a, mate.axisA), 'axisA'), normalize(transformDirection(b, mate.axisB), 'axisB'));
      return Math.abs(Math.abs(d) - 1) <= 1e-9;
    }
    case 'perpendicular': {
      if (!mate.axisA || !mate.axisB) throw new Error('perpendicular mate needs axisA and axisB.');
      const d = dot(normalize(transformDirection(a, mate.axisA), 'axisA'), normalize(transformDirection(b, mate.axisB), 'axisB'));
      return Math.abs(d) <= 1e-9;
    }
    case 'angle': {
      if (!mate.axisA || !mate.axisB) throw new Error('angle mate needs axisA and axisB.');
      if (mate.value === undefined) throw new Error('angle mate needs a finite value in radians.');
      const d = angleBetween(transformDirection(a, mate.axisA), transformDirection(b, mate.axisB));
      return Math.abs(d - mate.value) <= 1e-9;
    }
    default:
      throw new Error(`Unknown mate kind: ${String((mate as { kind: unknown }).kind)}.`);
  }
}

