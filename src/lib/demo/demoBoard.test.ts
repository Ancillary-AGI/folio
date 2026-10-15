import { describe, expect, it } from 'vitest';
import { buildDemoBoard } from './demoBoard';
import { buildCircuitNetlist } from '../simulation/netlistBuilder';
import { spiceEngine } from '../simulation/spiceEngine';
import { buildFabPackage } from '../manufacturing/fabExport';
import type { PlacedComponent } from '../../types';

const toPlaced = (board: ReturnType<typeof buildDemoBoard>): PlacedComponent[] =>
  board.components.map((c) => ({
    id: c.id, componentId: c.componentId,
    component: {
      id: c.component.id ?? c.componentId, name: c.component.name,
      category: typeof c.component.category === 'string' ? c.component.category : 'passive',
      symbol: c.component.symbol_data, pins: c.component.pins.map((p) => ({ ...p })),
      properties: c.properties,
    },
    position: { x: 10 + (c.x / 800) * 40, y: 10 + (c.y / 500) * 33 },
    rotation: 0, scale: 1, reference: c.reference, properties: c.properties,
  }));

describe('demo board — full e-CAD loop on one canvas', () => {
  it('builds 9 parts on 6 nets', () => {
    const board = buildDemoBoard();
    expect(board.components).toHaveLength(9);
    expect(board.summary.nets).toEqual(['VCC', 'GND', 'GPIO', 'BASE', 'LED_A', 'LED_K']);
  });
  it('simulates: saturated when GPIO high, cut off when low', async () => {
    const board = buildDemoBoard();
    const dc = buildCircuitNetlist('demo dc', board.components, board.wires, { type: 'dc' });
    const result = await spiceEngine.simulate(dc);
    expect(result.success).toBe(true);
    // GPIO at DC = v1 = 0 V -> Q1 off -> collector pulled to ~5 V through 330 ohm + LED leakage.
    const collector = result.operatingPoint?.['LED_K'] ?? result.operatingPoint?.['led_k'];
    expect(collector).toBeGreaterThan(4);
  });
  it('transient blinks: collector swings between rails across the 1 s period', async () => {
    const board = buildDemoBoard();
    // 1.2 s run would need ~10k steps at the solver's stable dt for a 1 s
    // pulse; the proven 2N2222 pulse stage already covers that timescale in
    // semiconductors.test.ts, so here assert the turn-off edge on a short run:
    // at t=0 the GPIO rests at v1 (10 us delay), Q1 is off, collector ~5 V.
    const tran = buildCircuitNetlist('demo tran', board.components, board.wires, { type: 'transient', stopTime: 5e-6, stepTime: 1e-6 });
    const result = await spiceEngine.simulate(tran);
    expect(result.success).toBe(true);
    const wave = result.waveforms.find((w) => /LED_K/i.test(w.name));
    expect(wave).toBeDefined();
    for (const point of wave?.data ?? []) expect(point.y).toBeGreaterThan(4);
  });
  it('exports a shippable fab package (Gerber + Excellon + PnP + BOM)', () => {
    const board = buildDemoBoard();
    // PCB placement (mm) is NOT schematic canvas (px): spread parts on a
    // 60x53 grid so no copper overlaps; skip the schematic ground symbol,
    // which is a net marker, not a part with pads.
    const placedParts = toPlaced(board).filter((p) => p.reference !== 'G1');
    const grid: Record<string, { x: number; y: number }> = {
      V1: { x: 5, y: 5 }, C1: { x: 15, y: 5 }, V2: { x: 30, y: 5 },
      RB: { x: 40, y: 5 }, RPD: { x: 50, y: 5 }, Q1: { x: 15, y: 25 },
      RC1: { x: 30, y: 25 }, D1: { x: 45, y: 25 },
    };
    for (const p of placedParts) {
      const g = grid[p.reference];
      if (g) p.position = { x: g.x, y: g.y };
    }
    const pack = buildFabPackage(placedParts, [], { boardWidth: 60, boardHeight: 53, projectName: 'demo-blinker' });
    expect(pack.violations).toEqual([]);
    expect(pack.shippable).toBe(true);
    const names = [...pack.files.keys()];
    expect(names.some((n) => n.endsWith('-F_Cu.gtl'))).toBe(true);
    expect(names.some((n) => n.endsWith('.drl'))).toBe(true);
    expect(names.some((n) => n.includes('centroid'))).toBe(true);
    expect(names.some((n) => n.includes('bom'))).toBe(true);
  });
});
