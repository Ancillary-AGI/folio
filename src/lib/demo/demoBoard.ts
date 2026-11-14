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
  // Half-wave rectifier with filter — one horizontal current path, every
  // shunt centred on the sheet's horizontal midline, every wire segment
  // listed point by point. Units: 10 × 1 mm per grid unit.
  //
  // Series rail y=110, ground rail y=250, shunt centreline y=180.
  // V1 SINE 6 Vpk 1 kHz -> R_SRC 10 Ω -> D1 1N5817 -> C1 10 µF || R_LOAD 100 Ω.
  //
  // Pin worlds (rotation 90° CW maps local (x, y) → (−y, x)):
  //   V1    +(30,150)  −(30,210)
  //   RSRC  p1(140,110) p2(220,110)
  //   D1    a(260,110)  k(320,110)
  //   C1    p1(340,150) p2(340,210)   body centred on y=180
  //   RLOAD p1(400,140) p2(400,220)   body centred on y=180
  //   G1    gnd(200,250)
  // Each shunt's body is centred on the sheet midline; equal stubs top and
  // bottom connect it to the rails, so no part is pushed to a rail edge.
  const components: CanvasComponent[] = [
    placed('V1', 'Sine Voltage Source', 0, 150, { type: 'SINE', vo: '0V', va: '6V', freq: '1kHz', phase: '0', footprint: '0805' }),
    placed('RSRC', 'Resistor', 140, 90, { value: '10 Ω', footprint: '0805' }),
    // Ratings are the real part's, so the margins table has something true to
    // compare against: 1N5817 is a 40 V Schottky; the 1206 ceramic is 50 V.
    placed('D1', 'Diode', 260, 90, { type: '1N5817', is: '1e-8', n: '1.1', vbr: '40V', footprint: 'SMC' }),
    placed('C1', 'Capacitor', 360, 150, { value: '10 µF', voltage: '50V', footprint: '1206' }, 90),
    placed('RLOAD', 'Resistor', 420, 140, { value: '100 Ω', footprint: '1206' }, 90),
    placed('G1', 'Ground', 180, 250, {}),
  ];
  const P = (ref: string, ...pinIds: string[]): Array<{ componentId: string; pinId: string }> =>
    pinIds.map((pinId) => ({ componentId: `demo-${ref}`, pinId }));
  const wires: CanvasWire[] = [
    // SRC — source plus to the top of the series path.
    wire('src-rail', 'SRC', [...P('RSRC', 'p1')],
      [{ x: 30, y: 110 }, { x: 140, y: 110 }]),
    wire('v1-up', 'SRC', [...P('V1', 'positive')],
      [{ x: 30, y: 150 }, { x: 30, y: 110 }]),
    // MID — R_SRC to the diode.
    wire('mid', 'MID', [...P('RSRC', 'p2'), ...P('D1', 'anode')],
      [{ x: 220, y: 110 }, { x: 260, y: 110 }]),
    // OUT — diode to the filter cap and the load. One shared rail: the
    // stubs branch off it to the bodies and carry their own pin claims.
    wire('out-rail', 'OUT', [...P('D1', 'cathode'), ...P('C1', 'p1'), ...P('RLOAD', 'p1')],
      [{ x: 320, y: 110 }, { x: 340, y: 110 }, { x: 400, y: 110 }]),
    wire('c1-up', 'OUT', [],
      [{ x: 340, y: 150 }, { x: 340, y: 110 }]),
    wire('rload-up', 'OUT', [],
      [{ x: 400, y: 140 }, { x: 400, y: 110 }]),
    // GND — one straight return into the source and the ground marker.
    wire('c1-down', 'GND', [...P('C1', 'p2')],
      [{ x: 340, y: 210 }, { x: 340, y: 250 }]),
    wire('rload-down', 'GND', [...P('RLOAD', 'p2')],
      [{ x: 400, y: 220 }, { x: 400, y: 250 }]),
    wire('v1-down', 'GND', [...P('V1', 'negative')],
      [{ x: 30, y: 210 }, { x: 30, y: 250 }]),
    wire('gnd-rail', 'GND', [...P('V1', 'negative'), ...P('G1', 'gnd'), ...P('C1', 'p2'), ...P('RLOAD', 'p2')],
      [{ x: 30, y: 250 }, { x: 200, y: 250 }, { x: 340, y: 250 }, { x: 400, y: 250 }]),
  ];
  return {
    components, wires,
    summary: { parts: components.length, nets: ['SRC', 'MID', 'OUT', 'GND'], boardMm: { w: 60, h: 53 } },
  };
}

