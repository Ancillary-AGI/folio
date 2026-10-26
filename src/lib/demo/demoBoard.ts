/**
 * Demo board: half-wave rectifier with filter (2-layer, 60 x 53 mm).
 *
 * Every part is BOTH simulatable (SINE source, R, C, Schottky diode)
 * AND stocked with a real IPC footprint (0805/1206/SMC), so the SAME
 * canvas data flows schematic -> simulate -> DRC-gated fab export -> 3D
 * viewer with nothing invented. Proven by `demoBoard.test.ts`.
 *
 * Circuit: 6 Vpk 1 kHz sine into 10 ohm source resistance, 1N5817
 * Schottky, 10 uF filter across a 100 ohm load. Hand-checkable: OUT only
 * conducts on the positive half-cycle and never swings negative; at the
 * panel defaults it peaks near 4.4 V (source IR + diode drop) with roughly
 * 2.3 V of ripple, since the capacitor is an ideal 10 uF with no ESR.
 */
import type { CanvasComponent, CanvasWire } from '../../stores/useProjectStore';
import type { Component } from '../supabase';
import { standardComponents } from '../componentLibrary';

export interface DemoBoard {
  components: CanvasComponent[];
  wires: CanvasWire[];
  summary: { parts: number; nets: string[]; boardMm: { w: number; h: number } };
}

const findSymbol = (name: string): Component => {
  const found = standardComponents.find((c) => c.name === name);
  if (!found) throw new Error(`Demo board: library symbol "${name}" missing.`);
  return { ...found, id: `demo-lib-${name}`, pins: found.pins.map((p) => ({ ...p })) } as Component;
};

const placed = (
  ref: string, symbol: string, x: number, y: number,
  properties: Record<string, string | number | boolean>, rotation = 0,
): CanvasComponent => {
  const component = findSymbol(symbol);
  return {
    id: `demo-${ref}`, componentId: component.id ?? symbol, component,
    x, y, rotation, reference: ref, properties, visible: true,
  };
};

const wire = (id: string, netName: string, pins: Array<{ componentId: string; pinId: string }>, points: Array<{ x: number; y: number }>): CanvasWire => ({
  id: `demo-w-${id}`, netName, connectedPins: pins, points,
});

export function buildDemoBoard(): DemoBoard {
  // Half-wave rectifier with filter — CircuitLab-clean: one straight top
  // rail (y=180), one ground rail (y=260), zero crossings, zero jumps.
  // V1 SINE 6 Vpk 1 kHz -> R_SRC 10 -> D1 1N5817 -> C1 10 uF || R_LOAD 100.
  // The vertical resistor is 80 long, so the ground rail sits at y=260: a
  // 60-high rail at y=240 would run straight through the RLOAD body.
  // Pin worlds: V1 (70,180)/(70,240), R_SRC (100,180)/(180,180),
  // D1 (190,180)/(250,180), C1 rot90 (260,180)/(260,240),
  // R_LOAD rot90 (325,180)/(325,260), G1 (200,260),
  // TP_IN (100,180), TP_OUT (300,180).
  const components: CanvasComponent[] = [
    placed('V1', 'Sine Voltage Source', 40, 180, { type: 'SINE', vo: '0V', va: '6V', freq: '1kHz', phase: '0', footprint: '0805' }),
    placed('RSRC', 'Resistor', 100, 165, { value: '10', footprint: '0805' }),
    // Ratings are the real part's, so the margins table has something true to
    // compare against: 1N5817 is a 40 V Schottky; the 1206 ceramic is 50 V.
    placed('D1', 'Diode', 190, 160, { type: '1N5817', is: '1e-8', n: '1.1', vbr: '40V', footprint: 'SMC' }),
    placed('C1', 'Capacitor', 280, 180, { value: '10uF', voltage: '50V', footprint: '1206' }, 90),
    placed('RLOAD', 'Resistor', 340, 180, { value: '100', footprint: '1206' }, 90),
    placed('G1', 'Ground', 180, 260, {}),
  ];
  const P = (ref: string, ...pinIds: string[]): Array<{ componentId: string; pinId: string }> =>
    pinIds.map((pinId) => ({ componentId: `demo-${ref}`, pinId }));
  const wires: CanvasWire[] = [
    wire('src-top', 'SRC', [...P('V1', 'positive'), ...P('RSRC', 'p1')],
      [{ x: 70, y: 180 }, { x: 80, y: 180 }, { x: 90, y: 180 }, { x: 100, y: 180 }]),
    wire('mid', 'MID', [...P('RSRC', 'p2'), ...P('D1', 'anode')],
      [{ x: 180, y: 180 }, { x: 190, y: 180 }]),
    wire('out-rail', 'OUT', [...P('D1', 'cathode'), ...P('C1', 'p1'), ...P('RLOAD', 'p1')],
      [{ x: 250, y: 180 }, { x: 260, y: 180 }, { x: 320, y: 180 }, { x: 325, y: 180 }]),
    wire('gnd-rail', 'GND', [...P('V1', 'negative'), ...P('G1', 'gnd'), ...P('C1', 'p2')],
      [{ x: 70, y: 240 }, { x: 70, y: 260 }, { x: 200, y: 260 }, { x: 260, y: 260 }, { x: 260, y: 240 }]),
    wire('gnd-load', 'GND', [...P('RLOAD', 'p2'), ...P('G1', 'gnd')],
      [{ x: 325, y: 260 }, { x: 200, y: 260 }]),
  ];
  return {
    components, wires,
    summary: { parts: components.length, nets: ['SRC', 'MID', 'OUT', 'GND'], boardMm: { w: 60, h: 53 } },
  };
}

