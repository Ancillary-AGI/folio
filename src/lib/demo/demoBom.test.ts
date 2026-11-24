import { describe, expect, it } from 'vitest';
import { buildDemoBom } from './demoBom';

describe('demo BOM — canvas rows match the shippable fab package', () => {
  it('covers every placed part with footprint + MPN, mirrored in centroid', () => {
    const demo = buildDemoBom();
    expect(demo.parts).toBe(5);
    for (const row of demo.rows) {
      expect(row.footprint.length).toBeGreaterThan(0);
      expect(row.partNumber.length).toBeGreaterThan(0);
      expect(demo.fabReferences).toContain(row.reference);
    }
    expect(demo.verdict).toMatch(/^PASS/);
  });
});
