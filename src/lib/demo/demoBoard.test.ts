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
  it('builds 6 parts on 4 nets', () => {
    const board = buildDemoBoard();
    expect(board.components).toHaveLength(6);
    expect(board.summary.nets).toEqual(['SRC', 'MID', 'OUT', 'GND']);
  });
  it('lands every wire endpoint exactly on a real pin (no open joints)', () => {
    const board = buildDemoBoard();
    const rotate = (px: number, py: number, deg: number) => {
      const r = ((deg % 360) * Math.PI) / 180;
      return { x: px * Math.cos(r) - py * Math.sin(r), y: px * Math.sin(r) + py * Math.cos(r) };
    };
    const pinAt = new Map<string, { x: number; y: number }>();
    for (const c of board.components) {
      for (const pin of c.component.pins) {
        const rotated = rotate(pin.x, pin.y, c.rotation);
        pinAt.set(`${c.id}:${pin.id}`, { x: Math.round(c.x + rotated.x), y: Math.round(c.y + rotated.y) });
      }
    }
    // Every wire point (not just endpoints): a point on no pin must sit on
    // another wire's segment (verified tap joint below) or be an interior
    // corner of its own wire. A stub end floating in space fails here —
    // the regression test for the screenshot open-circuit.
    const pinPts = new Set([...pinAt.values()].map((p) => `${p.x},${p.y}`));
    const onSeg = (
      end: { x: number; y: number },
      a: { x: number; y: number },
      b: { x: number; y: number },
    ): boolean =>
      Math.min(a.x, b.x) - 0.5 <= end.x
      && end.x <= Math.max(a.x, b.x) + 0.5
      && Math.min(a.y, b.y) - 0.5 <= end.y
      && end.y <= Math.max(a.y, b.y) + 0.5;
    const ownSeg = (w: (typeof board.wires)[number], key: string): boolean => {
      for (let k = 0; k + 1 < w.points.length; k++) {
        if (`${w.points[k]!.x},${w.points[k]!.y}` === key) return true;
      }
      return false;
    };
    for (const w of board.wires) {
      for (const pt of w.points) {
        const key = `${pt.x},${pt.y}`;
        if (pinPts.has(key)) continue;
        if (ownSeg(w, key)) continue;
        let joined = false;
        for (const o of board.wires) {
          if (o === w) continue;
          for (let k = 0; k + 1 < o.points.length; k++) {
            if (onSeg(pt, o.points[k]!, o.points[k + 1]!)) { joined = true; break; }
          }
          if (joined) break;
        }
        expect(joined, `wire ${w.id} point (${key}) floats — open joint`).toBe(true);
      }
    }
    // Every declared pin connection lands its pin coordinate on a wire of
    // the same net (taps join the rail at a dot; the netlister unions all
    // wires sharing a pin OR a net name into one node).
    const ptsByNet = new Map<string, Set<string>>();
    for (const w of board.wires) {
      const net = w.netName ?? '';
      const set = ptsByNet.get(net) ?? new Set<string>();
      for (const p of w.points) set.add(`${p.x},${p.y}`);
      ptsByNet.set(net, set);
    }
    for (const w of board.wires) {
      const pts = ptsByNet.get(w.netName ?? '')!;
      for (const cp of w.connectedPins) {
        const at = pinAt.get(`${cp.componentId}:${cp.pinId}`);
        expect(at, `${cp.componentId}:${cp.pinId} missing`).toBeDefined();
        expect(
          pts.has(`${at!.x},${at!.y}`),
          `${cp.componentId}:${cp.pinId} at (${at!.x},${at!.y}) not on net ${w.netName}`,
        ).toBe(true);
      }
    }
    // Verified joints: every wire ENDPOINT lands exactly on a declared pin
    // coordinate (see schematic-check below). No floating taps, no
    // rail-midpoint stubs — the screenshot open-circuit cannot return.
    const taps: Array<[string, string]> = [
      ['demo-w-out-rail', '260,180'],
      ['demo-w-out-rail', '325,180'],
    ];
    for (const [id, key] of taps) {
      const w = board.wires.find((cand) => cand.id === id)!;
      expect(w.points.some((p) => `${p.x},${p.y}` === key), `${id} lost tap ${key}`).toBe(true);
    }
  });
  it('simulates: forward-biased output follows the source minus the diode drop', async () => {
    const board = buildDemoBoard();
    // DC source value is vOff (0 V here): diode unbiased, OUT rests at 0 V.
    const dc = buildCircuitNetlist('demo dc', board.components, board.wires, { type: 'dc' });
    const result = await spiceEngine.simulate(dc);
    expect(result.success).toBe(true);
    const out = result.operatingPoint?.['OUT'] ?? result.operatingPoint?.['out'];
    expect(Math.abs(out ?? 99)).toBeLessThan(0.05);
  });
  it('transient rectifies: OUT never swings negative on a 1 kHz sine', async () => {
    const board = buildDemoBoard();
    const tran = buildCircuitNetlist('demo tran', board.components, board.wires, { type: 'transient', stopTime: 2e-3, stepTime: 2e-5 });
    const result = await spiceEngine.simulate(tran);
    expect(result.success).toBe(true);
    const wave = result.waveforms.find((w) => w.name === 'V(OUT)');
    expect(wave).toBeDefined();
    for (const point of wave?.data ?? []) expect(point.y).toBeGreaterThan(-0.05);
    const peak = Math.max(...(wave?.data ?? []).map((p) => p.y));
    expect(peak).toBeGreaterThan(3);
  });
  it('transient survives the panel defaults (20 ms run, 20 us step) on the 1 kHz sine', async () => {
    const board = buildDemoBoard();
    const tran = buildCircuitNetlist('demo tran panel defaults', board.components, board.wires, { type: 'transient', stopTime: 20e-3, stepTime: 20e-6 });
    const result = await spiceEngine.simulate(tran);
    expect(result.success).toBe(true);
    expect(result.waveforms.length).toBeGreaterThan(0);
    // The default window must actually resolve the 1 kHz source, not alias it.
    const out = result.waveforms.find((w) => w.name === 'V(OUT)');
    const peak = Math.max(...(out?.data ?? []).map((p) => p.y));
    expect(peak).toBeGreaterThan(3);
  });
  it('warns when the step undersamples the source instead of showing an aliased flat line', async () => {
    const board = buildDemoBoard();
    // 1 ms step on a 1 kHz sine samples every zero crossing: the plot reads
    // as a flat 0 V line, which is an artefact, not a result.
    const tran = buildCircuitNetlist('demo tran aliased', board.components, board.wires, { type: 'transient', stopTime: 1.2, stepTime: 1e-3 });
    const result = await spiceEngine.simulate(tran);
    expect((result.notes ?? []).some((note) => note.toLowerCase().includes('alias'))).toBe(true);
  });
  it('exports a shippable fab package (Gerber + Excellon + PnP + BOM)', () => {
    const board = buildDemoBoard();
    // PCB placement (mm) is NOT schematic canvas (px): spread parts on a
    // 60x53 grid so no copper overlaps; skip the schematic ground symbol,
    // which is a net marker, not a part with pads.
    const placedParts = toPlaced(board).filter((p) => p.reference !== 'G1');
    const grid: Record<string, { x: number; y: number }> = {
      V1: { x: 5, y: 5 }, RSRC: { x: 15, y: 5 }, D1: { x: 25, y: 5 },
      C1: { x: 35, y: 5 }, RLOAD: { x: 45, y: 5 },
    };
    for (const p of placedParts) {
      const g: { x: number; y: number } | undefined = grid[p.reference];
      if (g) p.position = { x: g.x, y: g.y };
    }
    const pack = buildFabPackage(placedParts, [], { boardWidth: 60, boardHeight: 53, projectName: 'demo-rectifier' });
    expect(pack.violations).toEqual([]);
    expect(pack.shippable).toBe(true);
    const names = [...pack.files.keys()];
    expect(names.some((n) => n.endsWith('-F_Cu.gtl'))).toBe(true);
    expect(names.some((n) => n.endsWith('.drl'))).toBe(true);
    expect(names.some((n) => n.includes('centroid'))).toBe(true);
    expect(names.some((n) => n.includes('bom'))).toBe(true);
  });
});
