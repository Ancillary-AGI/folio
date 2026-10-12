import { describe, expect, it } from 'vitest';
import { assessManufacturability, type ManufacturabilityInput } from './manufacturability';
import {
  bendingStress,
  circleInertia,
  eulerBucklingLoad,
  rectangleInertia,
} from '../mechanical/structural';

/** SLS nylon-ish: strong, light, easy to print. */
const PLA = { modulus: 3.5e9, yieldStrength: 50e6 };

const BED = { bedWidth: 250, bedDepth: 210, bedHeight: 250 };

/** One 200 mm round 12 mm link weighing 120 g, assembled straight out. */
function singleLink(overrides: Partial<ManufacturabilityInput['links'][number]> = {}) {
  return {
    id: 'arm',
    length: 200,
    depth: 12,
    width: 12,
    section: 'round' as const,
    mass: 0.12,
    ...overrides,
  };
}

/** Section constants in the millimetre set the assessor works in. */
function sectionOf(link: ReturnType<typeof singleLink>) {
  return {
    inertia: link.section === 'round' ? circleInertia(link.depth) : rectangleInertia(link.width, link.depth),
    fibre: link.depth / 2,
    yieldMPa: PLA.yieldStrength / 1e6,
  };
}

function input(overrides: Partial<ManufacturabilityInput> = {}): ManufacturabilityInput {
  return {
    links: [singleLink()],
    joints: [{ id: 'shoulder', min: -Math.PI, max: Math.PI, assembled: 0 }],
    material: PLA,
    printer: BED,
    payload: 2,
    ...overrides,
  };
}

describe('bed fit', () => {
  it('passes a modest arm with a light payload', () => {
    const report = assessManufacturability(input());
    expect(report.manufacturable).toBe(true);
    expect(report.findings).toEqual([]);
    expect(report.totalMass).toBeCloseTo(0.12, 12);
  });

  it('reports the envelope it measured, folded by the assembled angle', () => {
    const straight = assessManufacturability(input());
    expect(straight.envelope.width).toBeCloseTo(200, 9);
    expect(straight.envelope.height).toBeCloseTo(12, 9);

    // Raised vertical, the same link projects nothing horizontally.
    const raised = assessManufacturability(
      input({ joints: [{ id: 'shoulder', min: 0, max: Math.PI / 2, assembled: Math.PI / 2 }] }),
    );
    expect(raised.envelope.width).toBeCloseTo(0, 9);
    expect(raised.envelope.height).toBeCloseTo(212, 9);
  });

  it('rejects a link longer than the bed', () => {
    const report = assessManufacturability(input({ links: [singleLink({ length: 400 })] }));
    expect(report.manufacturable).toBe(false);
    const finding = report.findings.find((f) => f.check === 'bed-fit' && f.subject === 'arm');
    expect(finding).toBeDefined();
    expect(finding?.margin).toBeLessThan(0);
    expect(finding?.reason).toMatch(/400\.0 mm long/);
  });

  it('rejects an assembled pose taller than the bed', () => {
    const report = assessManufacturability(
      input({
        links: [singleLink({ length: 240 })],
        joints: [{ id: 'shoulder', min: 0, max: Math.PI / 2, assembled: Math.PI / 2 }],
        printer: { bedWidth: 300, bedDepth: 300, bedHeight: 200 },
      }),
    );
    expect(report.manufacturable).toBe(false);
    expect(report.findings.some((f) => /bed height/.test(f.reason))).toBe(true);
  });
});

describe('joint limits', () => {
  it('passes an assembled angle inside the declared travel', () => {
    const report = assessManufacturability(
      input({ joints: [{ id: 'elbow', min: -1, max: 2, assembled: 0.5 }] }),
    );
    expect(report.findings.some((f) => f.check === 'joint-limit')).toBe(false);
  });

  it('rejects an assembled angle past either stop', () => {
    const low = assessManufacturability(
      input({ joints: [{ id: 'elbow', min: 0, max: 1, assembled: -0.5 }] }),
    );
    expect(low.manufacturable).toBe(false);
    expect(low.findings.find((f) => f.subject === 'elbow')?.margin).toBeCloseTo(-0.5, 12);

    const high = assessManufacturability(
      input({ joints: [{ id: 'elbow', min: 0, max: 1, assembled: 1.75 }] }),
    );
    expect(high.findings.find((f) => f.subject === 'elbow')?.margin).toBeCloseTo(-0.75, 12);
  });

  it('accepts an angle exactly on a stop', () => {
    const report = assessManufacturability(
      input({ joints: [{ id: 'elbow', min: -1, max: 1, assembled: 1 }] }),
    );
    expect(report.findings.some((f) => f.check === 'joint-limit')).toBe(false);
  });
});

describe('structural checks against the closed forms', () => {
  it('flags bending exactly when σ = Mc/I passes the yield strength', () => {
    const link = singleLink();
    const { inertia, fibre, yieldMPa } = sectionOf(link);
    // Payload plus the link's own weight act at the tip of a 200 mm cantilever.
    const load = 2 + link.mass * 9.81;
    expect(bendingStress(load * link.length, fibre, inertia)).toBeLessThan(yieldMPa);

    // A much heavier payload must push the same section past yield.
    const heavy = assessManufacturability(input({ payload: 60 }));
    const finding = heavy.findings.find((f) => f.check === 'bending');
    expect(finding).toBeDefined();
    expect(heavy.manufacturable).toBe(false);
    const recomputed = bendingStress((60 + link.mass * 9.81) * link.length, fibre, inertia);
    expect(recomputed).toBeGreaterThan(yieldMPa);
    expect(finding?.reason).toMatch(/MPa bending/);
  });

  it('flags buckling exactly when the load passes the Euler critical load', () => {
    const link = singleLink();
    const critical = eulerBucklingLoad(PLA.modulus / 1e6, circleInertia(link.depth), link.length, 'fixed-free');
    expect(2 + link.mass * 9.81).toBeLessThan(critical);

    const heavy = assessManufacturability(input({ payload: 5000 }));
    const finding = heavy.findings.find((f) => f.check === 'buckling');
    expect(finding).toBeDefined();
    expect(finding?.reason).toMatch(/Euler critical load/);
    expect(finding?.margin).toBeLessThan(0);
  });

  it('carries each link weight onto its parent, so the root sees the whole arm', () => {
    const links = [singleLink({ id: 'upper', length: 150 }), singleLink({ id: 'lower', length: 150 })];
    // A wide bed keeps this case about the structural checks, not the reach.
    const wideBed = { bedWidth: 400, bedDepth: 400, bedHeight: 400 };
    const light = assessManufacturability(input({ links, joints: [], payload: 0, printer: wideBed }));
    expect(light.manufacturable).toBe(true);
    expect(light.totalMass).toBeCloseTo(0.24, 12);

    const heavy = assessManufacturability(
      input({
        links,
        joints: [],
        payload: 40,
        printer: wideBed,
        material: { modulus: 3.5e9, yieldStrength: 1e6 },
      }),
    );
    const subjects = heavy.findings.filter((f) => f.check === 'bending').map((f) => f.subject);
    expect(subjects).toContain('upper');
    expect(subjects).toContain('lower');
    // The upper link carries strictly more, so its margin is strictly worse.
    const upper = heavy.findings.find((f) => f.subject === 'upper');
    const lower = heavy.findings.find((f) => f.subject === 'lower');
    expect(upper?.margin).toBeLessThan(lower?.margin ?? 0);
  });

  it('uses the rectangular section when the link is not round', () => {
    const square = singleLink({ section: 'rectangular', width: 12, depth: 12 });
    // πd⁴/64 versus bd³/12 differ, so the two sections must give different answers.
    expect(rectangleInertia(12, 12)).toBeCloseTo((12 * 12 ** 3) / 12, 12);
    expect(rectangleInertia(12, 12)).not.toBeCloseTo(circleInertia(12), 12);
    const report = assessManufacturability(input({ links: [square], payload: 100 }));
    expect(report.findings.some((f) => f.check === 'bending')).toBe(true);
  });
});

describe('input validation', () => {
  it('rejects an empty mechanism', () => {
    expect(() => assessManufacturability(input({ links: [] }))).toThrow(/at least one link/);
  });

  it('rejects a non-positive material or bed dimension', () => {
    expect(() =>
      assessManufacturability(input({ material: { modulus: 0, yieldStrength: 1 } })),
    ).toThrow(/material\.modulus/);
    expect(() =>
      assessManufacturability(input({ material: { modulus: 1, yieldStrength: 0 } })),
    ).toThrow(/material\.yieldStrength/);
    expect(() => assessManufacturability(input({ printer: { ...BED, bedHeight: 0 } }))).toThrow(
      /printer\.bedHeight/,
    );
  });

  it('rejects a negative payload and a non-finite assembled angle', () => {
    expect(() => assessManufacturability(input({ payload: -1 }))).toThrow(/payload/);
    expect(() =>
      assessManufacturability(
        input({ joints: [{ id: 'j', min: 0, max: 1, assembled: Number.NaN }] }),
      ),
    ).toThrow(/non-finite/);
  });

  it('rejects a joint whose minimum exceeds its maximum', () => {
    expect(() =>
      assessManufacturability(input({ joints: [{ id: 'j', min: 2, max: 1, assembled: 0 }] })),
    ).toThrow(/min .* greater than max/);
  });

  it('rejects a link with a non-positive length or depth', () => {
    expect(() => assessManufacturability(input({ links: [singleLink({ length: 0 })] }))).toThrow(
      /length/,
    );
    expect(() => assessManufacturability(input({ links: [singleLink({ depth: -1 })] }))).toThrow(
      /depth/,
    );
  });
});
