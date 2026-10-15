import { describe, expect, it } from 'vitest';
import { buildDemoMarketplaceBundle } from './demoMarketplace';
import { DesignMarketplace } from '../marketplace/designMarketplace';

describe('demo marketplace — blinker bundle round-trips', () => {
  it('publishes and installs with the payload intact', () => {
    const marketplace = new DesignMarketplace();
    const demo = buildDemoMarketplaceBundle(marketplace);
    expect(demo.parts).toBe(9);
    expect(demo.installedOk).toBe(true);
    expect(demo.verdict).toMatch(/^PASS/);
    expect(marketplace.search('blinker').length).toBeGreaterThan(0);
  });
});
