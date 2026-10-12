import { describe, expect, it } from 'vitest';
import { exportMechanismStep, mechanismStep, type ExportLink } from './mechanismExport';

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
