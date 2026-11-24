import { describe, expect, it } from 'vitest';
import { MarketplaceService, type MarketplaceEntry } from './marketplaceService';

describe('Marketplace Service', () => {
  it('registers, discovers, and installs packages after checking declared capabilities', () => {
    const service = new MarketplaceService();

    const entry: MarketplaceEntry = {
      id: 'org.folio.jlcpcb-rules',
      manifest: {
        id: 'org.folio.jlcpcb-rules',
        name: 'JLCPCB 4-Layer DFM Rules',
        version: '1.2.0',
        description: 'Advanced 4-layer and 6-layer DRC profiles',
        author: 'JLCPCB Integration Team',
        permissions: ['ui:panels', 'write:components'],
        enabled: true,
        entry: 'index.js',
        category: 'manufacturing',
        apiVersion: '1.0.0',
      },
      author: 'JLCPCB',
      // An external author: the flag records who shipped the package, not that
      // any authority vouched for it.
      firstPartyPublisher: false,
      downloadsCount: 1420,
      rating: 4.9,
      tags: ['drc', 'manufacturing', 'jlcpcb'],
      packagePayload: {
        tools: [{ name: 'jlcpcb.drc4layer', description: '4-layer DRC checker' }],
        components: [{ name: 'JLCPCB Test Coupler', category: 'rf' }],
      },
    };

    service.registerPackage(entry);
    expect(service.listPackages().length).toBe(1);
    expect(service.listPackages('manufacturing').length).toBe(1);

    const installResult = service.installPackage('org.folio.jlcpcb-rules');
    expect(installResult.success).toBe(true);
    expect(installResult.declaredToolCount).toBe(1);
    expect(installResult.declaredComponentCount).toBe(1);
    expect(service.isInstalled('org.folio.jlcpcb-rules')).toBe(true);

    service.uninstallPackage('org.folio.jlcpcb-rules');
    expect(service.isInstalled('org.folio.jlcpcb-rules')).toBe(false);
  });

  it('rejects malformed manifests at registration instead of installing them', () => {
    const service = new MarketplaceService();
    const broken: MarketplaceEntry = {
      id: 'acme-broken',
      manifest: {
        id: 'acme-broken',
        name: 'Broken Package',
        version: '1.0.0',
        description: 'No entry point',
        author: 'ACME',
        enabled: true,
        permissions: [],
        entry: '',
        apiVersion: '1.0.0',
      },
      author: 'ACME',
      firstPartyPublisher: false,
      downloadsCount: 0,
      rating: 0,
      tags: [],
      packagePayload: {},
    };

    expect(() => service.registerPackage(broken)).toThrow(/Invalid plugin manifest acme-broken: entry must be/);
    expect(service.listPackages()).toHaveLength(0);
  });

  it('rejects installation of packages attempting unauthorized actions', () => {
    const service = new MarketplaceService();

    const rogueEntry: MarketplaceEntry = {
      id: 'org.folio.rogue',
      manifest: {
        id: 'org.folio.rogue',
        name: 'Rogue Package',
        version: '1.0.0',
        description: 'Missing permissions',
        author: 'Unknown',
        permissions: [], // No permissions declared!
        enabled: true,
        entry: 'index.js',
        category: 'tools',
        apiVersion: '1.0.0',
      },
      author: 'Unknown',
      firstPartyPublisher: false,
      downloadsCount: 0,
      rating: 1.0,
      tags: [],
      packagePayload: {
        tools: [{ name: 'steal.data', description: 'tool' }],
      },
    };

    service.registerPackage(rogueEntry);
    expect(() => service.installPackage('org.folio.rogue')).toThrow(/without permission/);
  });
});
