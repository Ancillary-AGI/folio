import { describe, expect, it } from 'vitest';
import {
  describeMechanism,
  exportMechanismStep,
  mechanismStep,
  type ExportLink,
} from './mechanismExport';

const PLA = { modulus: 3.5e9, yieldStrength: 50e6 };
const BED = { bedWidth: 250, bedDepth: 210, bedHeight: 250 };
const WIDE_BED = { bedWidth: 400, bedDepth: 400, bedHeight: 400 };
const OPTIONS = { jointBore: 4, name: 'folio-arm' };

/** A 150 mm round 10 mm link weighing 100 g, held out straight. */
function link(id: string, overrides: Partial<ExportLink> = {}): ExportLink {
  return { id, length: 150, depth: 10, width: 10, section: 'round', mass: 0.1, angle: 0, ...overrides };
}

const base = { material: PLA, printer: WIDE_BED, payload: 2 };

describe('mechanism STEP geometry', () => {
  it('emits a well-formed AP214 document', () => {
    const result = mechanismStep([link('upper'), link('lower', { angle: 0 })], OPTIONS);
    expect(result.ok).toBe(true);
    expect(result.step.startsWith('ISO-10303-21;')).toBe(true);
    expect(result.step).toContain("FILE_NAME('folio-arm'");
    expect(result.step).toContain('CARTESIAN_POINT');
    expect(result.step).toContain('CLOSED_SHELL');
    expect(result.step).toContain('MANIFOLD_SOLID_BREP');
    expect(result.step.trimEnd().endsWith('END-ISO-10303-21;')).toBe(true);
  });

  it('spans the chain end to end when every link is straight', () => {
    const result = mechanismStep([link('upper'), link('lower')], OPTIONS);
    expect(result.chainLength).toBeCloseTo(300, 12);
    expect(result.bounds.maxX - result.bounds.minX).toBeCloseTo(300, 9);
    expect(result.bounds.maxZ).toBeCloseTo(10, 12);
  });

  it('folds the chain by the joint angle', () => {
    // A 90° second link turns the chain up, so the reach becomes the first link only.
    const result = mechanismStep([link('upper'), link('lower', { angle: Math.PI / 2 })], OPTIONS);
    expect(result.bounds.maxX - result.bounds.minX).toBeCloseTo(150, 9);
    expect(result.bounds.maxY - result.bounds.minY).toBeCloseTo(150, 9);
    expect(result.chainLength).toBeCloseTo(300, 12);
  });

  it('omits the bores when the diameter is zero', () => {
    const withBores = mechanismStep([link('upper')], OPTIONS);
    const without = mechanismStep([link('upper')], { ...OPTIONS, jointBore: 0 });
    expect(withBores.step.length).toBeGreaterThan(without.step.length);
    // Twelve-gon prisms contribute 12 points each; without bores only the box's 24 remain.
    expect((without.step.match(/CARTESIAN_POINT/g) ?? []).length).toBe(24);
  });

  it('rejects an empty mechanism and a bad link', () => {
    expect(() => mechanismStep([], OPTIONS)).toThrow(/at least one link/);
    expect(() => mechanismStep([link('bad', { length: 0 })], OPTIONS)).toThrow(/invalid length/);
    expect(() => mechanismStep([link('bad', { angle: Number.NaN })], OPTIONS)).toThrow(/non-finite/);
    expect(() =>
      mechanismStep([link('upper')], { ...OPTIONS, jointBore: -1 }),
    ).toThrow(/jointBore/);
  });
});

describe('gated export', () => {
  it('returns STEP for a design that passes every check', () => {
    const result = exportMechanismStep([link('upper'), link('lower')], base, OPTIONS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.step).toContain('CLOSED_SHELL');
  });

  it('refuses to emit STEP when a link overhangs the bed', () => {
    const result = exportMechanismStep(
      [link('long', { length: 400 })],
      { ...base, printer: BED },
      OPTIONS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings.some((f) => f.check === 'bed-fit')).toBe(true);
    expect('step' in result).toBe(false);
  });

  it('refuses to emit STEP when the payload would buckle a link', () => {
    const result = exportMechanismStep(
      [link('thin', { length: 240, depth: 6 })],
      { ...base, payload: 400 },
      OPTIONS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.findings.some((f) => f.check === 'buckling' || f.check === 'bending')).toBe(true);
  });

  it('carries the caller joint limits into the gate', () => {
    const result = exportMechanismStep(
      [link('upper', { angle: 2 })],
      {
        ...base,
        joints: [{ id: 'shoulder', min: -1, max: 1, assembled: 2 }],
      },
      OPTIONS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.findings.some((f) => f.check === 'joint-limit')).toBe(true);
  });

  it('accepts an angle the derived ±π stop allows but a supplied narrow stop rejects', () => {
    const links = [link('upper', { angle: 2 })];
    const derived = exportMechanismStep(links, base, OPTIONS);
    expect(derived.ok).toBe(true);
    const narrow = exportMechanismStep(
      links,
      { ...base, joints: [{ id: 'shoulder', min: -1, max: 1, assembled: 2 }] },
      OPTIONS,
    );
    expect(narrow.ok).toBe(false);
  });

  it('is deterministic: the same design yields byte-identical STEP apart from the timestamp', () => {
    const strip = (text: string): string => text.replace(/FILE_NAME\('[^']*','[^']*'/, 'FILE_NAME');
    const first = exportMechanismStep([link('upper'), link('lower', { angle: 0.4 })], base, OPTIONS);
    const second = exportMechanismStep([link('upper'), link('lower', { angle: 0.4 })], base, OPTIONS);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(strip(first.step)).toBe(strip(second.step));
  });
});

describe('describeMechanism', () => {
  it('pairs each link with the joint driving it, in order', () => {
    const { links, joints } = describeMechanism([
      { id: 'a', length: 100, depth: 10, mass: 0.2, angle: 0.3, jointMin: -1, jointMax: 1 },
      { id: 'b', length: 80, depth: 8, mass: 0.1, angle: -0.5, jointMin: -2, jointMax: 2 },
    ]);
    expect(links.map((l) => l.id)).toEqual(['a', 'b']);
    expect(joints.map((j) => j.assembled)).toEqual([0.3, -0.5]);
    expect(joints.map((j) => [j.min, j.max])).toEqual([
      [-1, 1],
      [-2, 2],
    ]);
    // A round section carries its depth across as the width, so the area is defined.
    expect(links[0].width).toBe(10);
    expect(links[0].section).toBe('round');
  });

  it('honours an explicit rectangular section', () => {
    const { links } = describeMechanism(
      [{ id: 'a', length: 50, depth: 6, mass: 0.1, angle: 0, jointMin: 0, jointMax: 1 }],
      'rectangular',
    );
    expect(links[0].section).toBe('rectangular');
    expect(links[0].width).toBe(6);
  });

  it('rejects an empty mechanism and any non-physical measurement', () => {
    expect(() => describeMechanism([])).toThrow(/at least one link/);
    const bad = { id: 'a', depth: 10, mass: 0.1, angle: 0, jointMin: 0, jointMax: 1 };
    expect(() => describeMechanism([{ ...bad, length: 0 }])).toThrow(/invalid length/);
    expect(() => describeMechanism([{ ...bad, length: 10, depth: 0 }])).toThrow(/invalid depth/);
    expect(() => describeMechanism([{ ...bad, length: 10, mass: -1 }])).toThrow(/invalid mass/);
    // A NaN angle would otherwise land in the STEP file as a NaN coordinate.
    expect(() => describeMechanism([{ ...bad, length: 10, angle: Number.NaN }])).toThrow(
      /non-finite angle/,
    );
    expect(() => describeMechanism([{ ...bad, length: 10, jointMin: Number.NaN }])).toThrow(
      /non-finite joint limit/,
    );
    expect(() => describeMechanism([{ ...bad, length: 10, jointMin: 2, jointMax: 1 }])).toThrow(
      /greater than max/,
    );
  });

  it('feeds straight into the gated export', () => {
    const { links, joints } = describeMechanism([
      { id: 'arm', length: 120, depth: 10, mass: 0.1, angle: 0, jointMin: -Math.PI, jointMax: Math.PI },
    ]);
    const result = exportMechanismStep(links, { ...base, joints }, OPTIONS);
    expect(result.ok).toBe(true);
  });
});
