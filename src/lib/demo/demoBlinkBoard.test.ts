import { describe, expect, it } from 'vitest';
import { buildBlinkBoard } from './demoBlinkBoard';
import { buildBlinkPcb } from './demoBlinkPcb';
import { buildCircuitNetlist } from '../simulation/netlistBuilder';
import { spiceEngine } from '../simulation/spiceEngine';
import { buildFabPackage } from '../manufacturing/fabExport';
import type { PlacedComponent } from '../../types';

const toPlaced = (board: ReturnType<typeof buildBlinkBoard>): PlacedComponent[] =>
  board.components.map((c) => ({
    id: c.id, componentId: c.componentId,
    component: {
      id: c.component.id ?? c.componentId, name: c.component.name,
      category: typeof c.component.category === 'string' ? c.component.category : 'passive',
      symbol: c.component.symbol_data, pins: c.component.pins.map((p) => ({ ...p })),
      properties: c.properties,
    },
    position: { x: 10 + (c.x / 800) * 70, y: 10 + (c.y / 500) * 40 },
    rotation: 0, scale: 1, reference: c.reference, properties: c.properties,
  }));

describe('blink board — two-transistor astable demo', () => {
  it('builds 12 parts on 6 nets', () => {
    const board = buildBlinkBoard();
    expect(board.components).toHaveLength(12);
    expect(board.summary.nets).toEqual(['VCC', 'GND', 'MID1', 'COL1', 'MID2', 'COL2', 'BASE1', 'BASE2']);
  });

  it('lands every wire endpoint exactly on a real pin (no open joints)', () => {
    const board = buildBlinkBoard();
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
  });

  it('oscillates in a transient run: each collector swings and each LED flashes', async () => {
    const board = buildBlinkBoard();
    const tran = buildCircuitNetlist('blink transient', board.components, board.wires, {
      type: 'transient', stopTime: 3.0, stepTime: 5e-3,
    });
    const result = await spiceEngine.simulate(tran);
    expect(result.success).toBe(true);
    for (const net of ['COL1', 'COL2']) {
      const wave = result.waveforms.find((w) => w.name === `V(${net})`);
      expect(wave, `no waveform for ${net}`).toBeDefined();
      const values = (wave?.data ?? []).map((p) => p.y);
      const swing = Math.max(...values) - Math.min(...values);
      // The LED clamps the high level (its forward drop), so the swing is
      // rail-minus-LED, never a full 5 V — but it must be decisive.
      expect(swing, `${net} barely moves`).toBeGreaterThan(1.5);
    }
    for (const part of ['LED1', 'LED2']) {
      const wave = result.waveforms.find((w) => w.name === `I(${part})`);
      expect(wave, `no waveform for ${part}`).toBeDefined();
      const values = (wave?.data ?? []).map((p) => Math.abs(p.y));
      expect(Math.max(...values), `${part} never flashes`).toBeGreaterThan(5e-3);
      expect(Math.min(...values), `${part} never goes dark`).toBeLessThan(5e-4);
    }
  });

  it('routes every net on the 80 × 45 mm two-layer board', () => {
    const pcb = buildBlinkPcb();
    expect(pcb.scene.components).toHaveLength(11); // G1 is a net marker, not a part.
    expect(pcb.summary.totalNets).toBe(8);
    expect(pcb.summary.routedNets).toBe(pcb.summary.totalNets);
    expect(pcb.summary.unrouted).toEqual([]);
    expect(pcb.traces.length).toBeGreaterThan(0);
    expect(pcb.scene.traces.length).toBe(pcb.traces.length);
  });

  it('exports a shippable fab package (Gerber + Excellon + PnP + BOM)', () => {
    const board = buildBlinkBoard();
    // PCB placement (mm) is NOT schematic canvas (px): spread parts on the
    // 80x45 outline so no copper overlaps; skip the schematic ground symbol,
    // which is a net marker, not a part with pads.
    const placedParts = toPlaced(board).filter((p) => p.reference !== 'G1');
    const grid: Record<string, { x: number; y: number }> = {
      V1: { x: 5, y: 10 }, R3: { x: 15, y: 10 }, R_A: { x: 22, y: 10 },
      LED1: { x: 10, y: 20 }, Q1: { x: 25, y: 22 }, Q2: { x: 38, y: 22 },
      LED2: { x: 40, y: 10 }, R_B: { x: 55, y: 10 }, R4: { x: 47, y: 10 },
      C_A: { x: 30, y: 15 }, C_B: { x: 32, y: 25 },
    };
    for (const p of placedParts) {
      const g = grid[p.reference];
      if (g) p.position = { x: g.x, y: g.y };
    }
    const pack = buildFabPackage(placedParts, [], { boardWidth: 80, boardHeight: 45, projectName: 'demo-blink' });
    expect(pack.violations).toEqual([]);
    expect(pack.shippable).toBe(true);
    const names = [...pack.files.keys()];
    expect(names.some((n) => n.endsWith('-F_Cu.gtl'))).toBe(true);
    expect(names.some((n) => n.endsWith('.drl'))).toBe(true);
    expect(names.some((n) => n.includes('centroid'))).toBe(true);
    expect(names.some((n) => n.includes('bom'))).toBe(true);
  });
});
