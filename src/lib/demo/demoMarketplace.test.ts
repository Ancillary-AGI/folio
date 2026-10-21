import { describe, expect, it } from 'vitest';
import { buildDemoMarketplaceBundle } from './demoMarketplace';
import { DesignMarketplace } from '../marketplace/designMarketplace';

describe('demo marketplace — rectifier bundle round-trips', () => {
  it('publishes and installs with the payload intact', () => {
    const marketplace = new DesignMarketplace();
    const demo = buildDemoMarketplaceBundle(marketplace);
    expect(demo.parts).toBe(6);
    expect(demo.installedOk).toBe(true);
    expect(demo.verdict).toMatch(/^PASS/);
    expect(marketplace.search('rectifier').length).toBeGreaterThan(0);
  });
});
