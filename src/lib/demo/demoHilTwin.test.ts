import { describe, expect, it } from 'vitest';
import { buildDemoHilTwin } from './demoHilTwin';

describe('demo HIL + twin — rectifier closes its own loop', () => {
  it('validates the HIL suite and verifies the twin envelope', async () => {
    const demo = await buildDemoHilTwin();
    expect(demo.hilTests).toBe(2);
    expect(demo.hilReady).toBe(true);
    expect(demo.envelopeSignals.length).toBeGreaterThan(0);
    expect(demo.verified).toBe(true);
    expect(demo.driftedFails).toBe(true);
    expect(demo.verdict).toMatch(/^PASS/);
  });
});
