import { describe, expect, it } from 'vitest';
import { angleBetween, assertFrame, mateHolds, solveMateTranslation, transformDirection, transformPoint } from './assembly';
import type { BodyFrame } from './assembly';

const IDENTITY: BodyFrame = { position: [0, 0, 0], rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1] };
const ROT_Z90: BodyFrame = { position: [0, 0, 0], rotation: [0, -1, 0, 1, 0, 0, 0, 0, 1] };

describe('assembly frames', () => {
  it('applies R*p + t to points and R only to directions', () => {
    const f: BodyFrame = { position: [10, 0, 0], rotation: ROT_Z90.rotation };
    expect(transformPoint(f, [1, 0, 0])).toEqual([10, 1, 0]);
    expect(transformDirection(f, [1, 0, 0])).toEqual([0, 1, 0]);
  });
  it('rejects a left-handed rotation and a bad bottom row', () => {
    expect(() => assertFrame({ position: [0, 0, 0], rotation: [-1, 0, 0, 0, 1, 0, 0, 0, 1] })).toThrow(/right-handed/);
    expect(() => assertFrame({ position: [0, 0, 0], rotation: [NaN, 0, 0, 0, 1, 0, 0, 0, 1] })).toThrow(/finite/);
  });
});

describe('coincident mate', () => {
  it('slides B so the mate points coincide', () => {
    const a: BodyFrame = { position: [5, 0, 0], rotation: IDENTITY.rotation };
    const b: BodyFrame = { position: [0, 7, 0], rotation: IDENTITY.rotation };
    const pos = solveMateTranslation(a, b, { kind: 'coincident', pointA: [0, 0, 0], pointB: [0, 0, 0] });
    expect(pos).toEqual([5, 0, 0]);
    expect(mateHolds(a, { ...b, position: pos }, { kind: 'coincident', pointA: [1, 2, 3], pointB: [1, 2, 3] })).toBe(true);
  });
});

describe('concentric mate', () => {
  it('removes only the perpendicular offset, keeping axial slide', () => {
    const a: BodyFrame = IDENTITY;
    const b: BodyFrame = { position: [0, 3, 9], rotation: IDENTITY.rotation };
    const mate = { kind: 'concentric' as const, pointA: [0, 0, 0] as const, pointB: [0, 0, 0] as const, axisA: [0, 0, 1] as const, axisB: [0, 0, 1] as const };
    const pos = solveMateTranslation(a, b, { kind: 'concentric', pointA: [0, 0, 0], pointB: [0, 0, 0], axisA: [0, 0, 1], axisB: [0, 0, 1] });
    expect(pos[0]).toBeCloseTo(0, 12);
    expect(pos[1]).toBeCloseTo(0, 12);
    expect(pos[2]).toBeCloseTo(9, 12);
    expect(mate).toBeDefined();
  });
  it('refuses non-parallel axes instead of inventing a slide', () => {
    expect(() => solveMateTranslation(IDENTITY, IDENTITY, { kind: 'concentric', pointA: [0, 0, 0], pointB: [0, 0, 0], axisA: [1, 0, 0], axisB: [0, 1, 0] })).toThrow(/parallel/);
  });
});

describe('distance mate', () => {
  it('places B exactly at the requested separation', () => {
    const a: BodyFrame = IDENTITY;
    const b: BodyFrame = { position: [3, 4, 0], rotation: IDENTITY.rotation };
    const pos = solveMateTranslation(a, b, { kind: 'distance', pointA: [0, 0, 0], pointB: [0, 0, 0], value: 10 });
    expect(Math.hypot(pos[0], pos[1], pos[2])).toBeCloseTo(10, 12);
    expect(mateHolds(a, { ...b, position: pos }, { kind: 'distance', pointA: [0, 0, 0], pointB: [0, 0, 0], value: 10 })).toBe(true);
  });
  it('rejects negative and undefined values and the degenerate direction', () => {
    expect(() => solveMateTranslation(IDENTITY, IDENTITY, { kind: 'distance', pointA: [0, 0, 0], pointB: [0, 0, 0], value: -1 })).toThrow(/>= 0/);
    expect(() => solveMateTranslation(IDENTITY, IDENTITY, { kind: 'distance', pointA: [0, 0, 0], pointB: [0, 0, 0] })).toThrow(/finite/);
  });
});

describe('angle checks', () => {
  it('measures 90 degrees and parallel/perpendicular mates', () => {
    expect(angleBetween([1, 0, 0], [0, 1, 0])).toBeCloseTo(Math.PI / 2, 12);
    expect(mateHolds(IDENTITY, ROT_Z90, { kind: 'perpendicular', pointA: [0, 0, 0], pointB: [0, 0, 0], axisA: [1, 0, 0], axisB: [1, 0, 0] })).toBe(true);
    expect(mateHolds(IDENTITY, ROT_Z90, { kind: 'parallel', pointA: [0, 0, 0], pointB: [0, 0, 0], axisA: [1, 0, 0], axisB: [1, 0, 0] })).toBe(false);
    expect(mateHolds(IDENTITY, IDENTITY, { kind: 'angle', pointA: [0, 0, 0], pointB: [0, 0, 0], axisA: [1, 0, 0], axisB: [1, 0, 0], value: 0 })).toBe(true);
  });
  it('refuses orientation mates on the translation solver', () => {
    expect(() => solveMateTranslation(IDENTITY, IDENTITY, { kind: 'parallel', pointA: [0, 0, 0], pointB: [0, 0, 0], axisA: [1, 0, 0], axisB: [1, 0, 0] })).toThrow(/orientation/);
  });
});
