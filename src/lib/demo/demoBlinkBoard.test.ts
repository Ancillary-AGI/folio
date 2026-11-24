import { describe, expect, it } from 'vitest';
import { buildBlinkBoard } from './demoBlinkBoard';
import { buildBlinkPcb } from './demoBlinkPcb';
import { buildCircuitNetlist } from '../simulation/netlistBuilder';
import { spiceEngine } from '../simulation/spiceEngine';
import { buildFabPackage } from '../manufacturing/fabExport';
import { runSchematicERC } from '../manufacturing/erc';
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
    position: { x: 5 + (c.x / 700) * 70, y: 5 + (c.y / 520) * 34 },
    rotation: 0, scale: 1, reference: c.reference, properties: c.properties,
  }));

describe('blink board — LM358 relaxation oscillator demo', () => {
  it('builds 11 parts on 8 nets', () => {
    const board = buildBlinkBoard();
    expect(board.components).toHaveLength(11);
    expect(board.summary.nets).toEqual(['VCC', 'GND', 'VEE', 'INP', 'INM', 'OUT', 'LEDK', 'INB']);
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

  it('passes the electrical rule check with zero errors', () => {
    const board = buildBlinkBoard();
    const result = runSchematicERC({ components: board.components, wires: board.wires, nets: [] } as never);
    expect(result.violations, JSON.stringify(result.violations, null, 2)).toEqual([]);
    expect(result.summary.errors).toBe(0);
    expect(result.summary.warnings).toBe(0);
  });

  it('oscillates from zero stored energy: it blinks at about 0.85 Hz', async () => {
    const board = buildBlinkBoard();
    const tran = buildCircuitNetlist('blink transient', board.components, board.wires, {
      type: 'transient', stopTime: 6.0, stepTime: 1e-3, useInitialConditions: true,
    });
    const result = await spiceEngine.simulate(tran);
    expect(result.success).toBe(true);
    const out = result.waveforms.find((w) => w.name === 'V(OUT)');
    const led = result.waveforms.find((w) => w.name === 'I(LED1)');
    expect(out, 'no waveform for V(OUT)').toBeDefined();
    expect(led, 'no waveform for I(LED1)').toBeDefined();
    const outData = out?.data ?? [];
    const swing = Math.max(...outData.map((p) => p.y)) - Math.min(...outData.map((p) => p.y));
    // The rail-to-rail op-amp macromodel: the swing must be decisive.
    expect(swing, 'V(OUT) barely moves').toBeGreaterThan(4);
    const ledMax = Math.max(...(led?.data ?? []).map((p) => p.y));
    const ledMin = Math.min(...(led?.data ?? []).map((p) => p.y));
    expect(ledMax, 'LED never flashes').toBeGreaterThan(8e-3);
    expect(ledMin, 'LED never goes dark').toBeLessThan(5e-4);
    // Rising crossings of the output through zero volts, measured on the solver.
    const rising = outData.reduce<number[]>((acc, p, i, arr) => {
      if (i > 0 && arr[i - 1].y < 0 && p.y >= 0) acc.push(p.x);
      return acc;
    }, []);
    expect(rising.length, 'fewer than 3 full cycles in 6 s').toBeGreaterThanOrEqual(4);
    const periods = rising.slice(1).map((x, i) => x - rising[i]!);
    const mean = periods.reduce((a, b) => a + b, 0) / periods.length;
    // Measured on the solver: 1.18 s, rock-steady across every cycle.
    expect(mean, 'period out of band').toBeGreaterThan(0.9);
    expect(mean).toBeLessThan(1.5);
  });

  it('routes every net on the 80 × 45 mm two-layer board', () => {
    const pcb = buildBlinkPcb();
    expect(pcb.scene.components).toHaveLength(10); // G1 is a net marker, not a part.
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
      V1: { x: 3, y: 8 }, V2: { x: 3, y: 24 }, U1: { x: 12, y: 10 },
      R1: { x: 22, y: 6 }, R2: { x: 40, y: 10 }, R3: { x: 32, y: 22 },
      C1: { x: 40, y: 28 }, R5: { x: 14, y: 28 }, R4: { x: 52, y: 6 },
      LED1: { x: 56, y: 18 },
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
