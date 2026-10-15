/**
 * Demo marketplace bundle: the blinker project as an installable listing.
 *
 * The marketplace engine (publish/search/install) is real but seeded with
 * sample data — nothing proves YOUR designs can round-trip through it. This
 * demo publishes the blinker bundle (schematic canvas + fab summary +
 * firmware sketch id) as a versioned listing, then installs it back and
 * verifies the payload survives byte-for-byte. Proven by
 * `demoMarketplace.test.ts`.
 */
import { DesignMarketplace } from '../marketplace/designMarketplace';
import { buildDemoBoard } from './demoBoard';
import { DEMO_SKETCH } from './demoFirmware';

export interface DemoMarketplaceBundle {
  listingId: string;
  title: string;
  parts: number;
  sketchBytes: number;
  installedOk: boolean;
  verdict: string;
}

export function buildDemoMarketplaceBundle(marketplace = new DesignMarketplace()): DemoMarketplaceBundle {
  const board = buildDemoBoard();
  const payload = {
    schematic: {
      components: board.components.map((c) => ({ reference: c.reference, symbol: c.component.name, properties: c.properties })),
      wires: board.wires.map((w) => ({ net: w.netName, pins: w.connectedPins.length })),
    },
    boardMm: board.summary.boardMm,
    nets: board.summary.nets,
    firmwareSketchBytes: new TextEncoder().encode(DEMO_SKETCH).length,
  };
  const listing = marketplace.publish({
    title: 'Blinker Starter Kit (tested)',
    author: 'Folio Demos',
    category: 'pcb',
    description: '2N2222 low-side LED blinker: schematic, fab-ready layout data, firmware sketch.',
    version: '1.0.0',
    license: 'CERN-OHL-S',
    tags: ['blinker', 'demo', 'tested'],
    rating: 5,
    payload,
  });
  const installed = marketplace.install(listing.id);
  const installedOk = installed !== undefined
    && JSON.stringify(installed.payload) === JSON.stringify(payload);
  if (!installedOk) throw new Error('Marketplace bundle did not round-trip.');
  const verdict = `PASS: "${listing.title}" v${listing.version} publishes + installs with payload intact (${board.components.length} parts).`;
  return {
    listingId: listing.id, title: listing.title,
    parts: board.components.length,
    sketchBytes: payload.firmwareSketchBytes,
    installedOk, verdict,
  };
}
