import { describe, expect, it } from 'vitest';
import { DesignMarketplace } from './designMarketplace';

type PublishInput = Parameters<DesignMarketplace['publish']>[0];

const listing = (overrides: Partial<PublishInput> = {}): PublishInput => ({
  title: 'Test Board',
  author: 'Tester',
  category: 'pcb',
  description: 'A board for tests',
  version: '1.0.0',
  license: 'MIT',
  tags: ['test'],
  rating: 4,
  payload: { layers: 2 },
  ...overrides,
});

describe('DesignMarketplace', () => {
  it('seeds a non-empty catalog with unique ids', () => {
    const marketplace = new DesignMarketplace();
    const items = marketplace.search();
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
    expect(items.every((item) => item.downloads === 0)).toBe(true);
    expect(items.every((item) => /^\d+\.\d+\.\d+$/.test(item.version))).toBe(true);
  });

  it('searches title, author, description and tags case-insensitively', () => {
    const marketplace = new DesignMarketplace();
    expect(marketplace.search('ARDUINO').map((item) => item.title)).toContain('Arduino Motor Driver Shield');
    expect(marketplace.search('motionforge')).toHaveLength(1);
    expect(marketplace.search('current sense')).toHaveLength(1);
    expect(marketplace.search('SIEM')).toHaveLength(1);

    marketplace.publish(listing({ title: 'Uppercase Tags', tags: ['UltraWide', 'RF'] }));
    expect(marketplace.search('ultrawide')).toHaveLength(1);
  });

  it('filters by category and combines the category with the query', () => {
    const marketplace = new DesignMarketplace();
    const robotics = marketplace.search('', 'robotics');
    expect(robotics).toHaveLength(1);
    expect(robotics[0].category).toBe('robotics');
    expect(marketplace.search('motor', 'robotics')).toHaveLength(0);
    expect(marketplace.search('motor', 'pcb')).toHaveLength(1);
  });

  it('publishes a listing with a zeroed download count and stable payload', () => {
    const marketplace = new DesignMarketplace();
    const payload = { layers: 4, nets: 42 };
    const published = marketplace.publish(listing({ title: 'Four Layer', payload }));
    expect(published.id).toMatch(/^mkt_\d+_\d+$/);
    expect(published.downloads).toBe(0);
    expect(published.publishedAt).toBeGreaterThan(0);
    expect(published.payload).toBe(payload);
    expect(marketplace.search('four layer')[0]).toBe(published);
    expect(marketplace.search('four layer')[0].payload).toEqual({ layers: 4, nets: 42 });
  });

  it('issues unique ids for rapid publishes', () => {
    const marketplace = new DesignMarketplace();
    const ids = Array.from({ length: 50 }, (_, index) => marketplace.publish(listing({ title: `Board ${index}` })).id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('installs a listing, increments downloads, and lists it once', () => {
    const marketplace = new DesignMarketplace();
    const published = marketplace.publish(listing({ downloads: 7 }));
    const installed = marketplace.install(published.id);
    expect(installed?.downloads).toBe(8);
    marketplace.install(published.id);
    expect(marketplace.getInstalled()).toHaveLength(1);
    expect(marketplace.getInstalled()[0].downloads).toBe(9);
    expect(marketplace.search('Test Board')[0].downloads).toBe(9);
  });

  it('returns undefined when installing an unknown listing', () => {
    const marketplace = new DesignMarketplace();
    expect(marketplace.install('missing')).toBeUndefined();
    expect(marketplace.getInstalled()).toEqual([]);
  });

  it('rejects malformed listings at the boundary', () => {
    const marketplace = new DesignMarketplace();
    expect(() => marketplace.publish(listing({ title: '  ' }))).toThrow(/requires a title/);
    expect(() => marketplace.publish(listing({ author: '' }))).toThrow(/requires an author/);
    expect(() => marketplace.publish(listing({ version: 'v1' }))).toThrow(/semver/);
    expect(() => marketplace.publish(listing({ rating: 6 }))).toThrow(/between 0 and 5/);
    expect(() => marketplace.publish(listing({ rating: Number.NaN }))).toThrow(/between 0 and 5/);
    expect(() => marketplace.publish(listing({ downloads: -1 }))).toThrow(/non-negative integer/);
    expect(() => marketplace.publish(listing({ downloads: 1.5 }))).toThrow(/non-negative integer/);
  });

  it('keeps listings isolated per marketplace instance', () => {
    const a = new DesignMarketplace();
    const b = new DesignMarketplace();
    const published = a.publish(listing({ title: 'Only In A' }));
    expect(b.search('only in a')).toHaveLength(0);
    expect(a.search('only in a')[0]).toBe(published);
    expect(published).toMatchObject({ title: 'Only In A', category: 'pcb' });
  });
});
