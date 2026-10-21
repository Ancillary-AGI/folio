import { describe, expect, it } from 'vitest';
import { buildDemoFirmware, DEMO_SKETCH } from './demoFirmware';

describe('demo firmware — sketch to HEX to verified upload', () => {
  it('analyses, packs, uploads and verifies the rectifier companion sketch', async () => {
    const demo = await buildDemoFirmware();
    expect(demo.staticOk).toBe(true);
    expect(demo.hexRecords).toBeGreaterThan(5);
    expect(demo.hexBytes).toBe(new TextEncoder().encode(DEMO_SKETCH).length);
    expect(demo.uploadOk).toBe(true);
    expect(demo.verifiedBytes).toBeGreaterThan(0);
    expect(demo.verdict).toMatch(/^PASS/);
  });
});
