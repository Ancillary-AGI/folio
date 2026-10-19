/**
 * Demo board: 2N2222 low-side LED blinker (2-layer, 60 x 53 mm).
 *
 * Every part is BOTH simulatable (DC/PULSE sources, R, C, NPN, LED-as-diode)
 * AND stocked with a real IPC footprint (0805/0603/SOT-23), so the SAME
 * canvas data flows schematic -> simulate -> DRC-gated fab export -> 3D
 * viewer with nothing invented. Proven by `demoBoard.test.ts`.
 *
 * Circuit: 5 V rail, 100 nF decoupling, 1 Hz PULSE GPIO through a 4.7 k
 * base resistor into a 2N2222; 10 k base pulldown; low-side red LED with
 * a 330 ohm collector resistor. Hand-verifiable: GPIO high saturates Q1
 * (Vce < 0.3 V, LED on); GPIO low cuts Q1 off (collector at ~5 V).
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
  // Closed low-side LED switcher, Manhattan-routed, zero crossings (so no
  // hop bows can double or open a joint). Every branch leaves its pin
  // orthogonally — pin exit directions come from libraryPinExit().
  //
  //   V1+ --[330R]--+-- D1 anode -> cathode --+-- Q1 C
  //    |            |                          |
  //   C1          shelf                      Q1 E
  //    |            |                          |
  //   GND  V2 --[4.7k]--+-- Q1 B    10k pulldown to GND
  //
  // Pin worlds (pos + pin offset; every endpoint below is one of these):
  // V1 (120,100): + (150,100), - (150,160)
  // V2 (120,300): + (150,300), - (150,360)
  // RC1 (330,95) rot -90: p1 (345,95), p2 (345,175)
  // D1 (345,170): anode (345,190), cathode (405,190)
  // Q1 (480,200): base (480,230), collector (540,205), emitter (540,255)
  // RB (330,200): p1 (330,215), p2 (410,215)
  // RPD (420,345): p1 (420,360), p2 (500,360)
  // C1 (220,120): p1 (220,140), p2 (280,140)
  // G1 (250,450): gnd (270,450). VCC stubs y=60, GND bus y=440.
  const components: CanvasComponent[] = [
    placed('V1', 'DC Voltage Source', 120, 100, { voltage: '5V', type: 'DC', footprint: '0805' }),
    placed('C1', 'Capacitor', 220, 120, { value: '100nF', footprint: '0603' }),
    placed('V2', 'Pulse Voltage Source', 120, 300, { type: 'PULSE', v1: '0V', v2: '5V', td: '10u', tr: '10n', tf: '10n', pw: '0.5s', per: '1s', footprint: '0805' }),
    placed('RB', 'Resistor', 330, 200, { value: '4.7k', footprint: '0805' }),
    placed('RPD', 'Resistor', 420, 345, { value: '10k', footprint: '0805' }),
    placed('Q1', 'NPN Transistor', 480, 200, { type: '2N2222', footprint: 'SOT-23' }),
    placed('RC1', 'Resistor', 360, 95, { value: '330', footprint: '0805' }, 90),
    placed('D1', 'Diode', 345, 170, { is: '1e-14', n: '1.8', footprint: '0805' }),
    placed('G1', 'Ground', 250, 450, {}),
  ];
  const P = (ref: string, ...pinIds: string[]): Array<{ componentId: string; pinId: string }> =>
    pinIds.map((pinId) => ({ componentId: `demo-${ref}`, pinId }));
  const wires: CanvasWire[] = [
    // VCC: source top rises to the shelf; rail is one bare backbone (pins
    // land on it via junctions, never drawn twice).
    wire('vcc-rail', 'VCC', [], [{ x: 150, y: 60 }, { x: 345, y: 60 }]),
    wire('vcc-v1', 'VCC', [...P('V1', 'positive')], [{ x: 150, y: 100 }, { x: 150, y: 60 }]),
    wire('vcc-c1', 'VCC', [...P('C1', 'p1')], [{ x: 220, y: 140 }, { x: 220, y: 60 }]),
    wire('vcc-rc1', 'VCC', [...P('RC1', 'p1')], [{ x: 345, y: 95 }, { x: 345, y: 60 }]),
    // GND: source bottom drops to the bus; same single-backbone rule.
    wire('gnd-rail', 'GND', [], [{ x: 90, y: 440 }, { x: 560, y: 440 }]),
    wire('gnd-v1', 'GND', [...P('V1', 'negative')], [{ x: 150, y: 160 }, { x: 150, y: 440 }]),
    wire('gnd-g1', 'GND', [...P('G1', 'gnd')], [{ x: 270, y: 450 }, { x: 270, y: 440 }]),
    wire('gnd-c1', 'GND', [...P('C1', 'p2')], [{ x: 280, y: 140 }, { x: 280, y: 440 }]),
    wire('gnd-v2', 'GND', [...P('V2', 'negative')], [{ x: 150, y: 360 }, { x: 180, y: 360 }, { x: 180, y: 440 }]),
    wire('gnd-rpd', 'GND', [...P('RPD', 'p2')], [{ x: 500, y: 360 }, { x: 500, y: 440 }]),
    wire('gnd-q1', 'GND', [...P('Q1', 'emitter')], [{ x: 540, y: 255 }, { x: 540, y: 440 }]),
    // GPIO drive: V2+ east, north in a free channel, then west onto the
    // resistor's west pin. The channel sits clear of the C1 ground drop.
    wire('gpio', 'GPIO', [...P('V2', 'positive'), ...P('RB', 'p1')],
      [{ x: 150, y: 300 }, { x: 310, y: 300 }, { x: 310, y: 215 }, { x: 330, y: 215 }]),
    // BASE: resistor east pin south, east, north onto the transistor base.
    // The pulldown joins at a T on the south run (BASE node, one dot only).
    wire('base-a', 'BASE', [...P('RB', 'p2'), ...P('Q1', 'base')],
      [{ x: 410, y: 215 }, { x: 455, y: 215 }, { x: 455, y: 320 }, { x: 480, y: 320 }, { x: 480, y: 230 }]),
    wire('base-b', 'BASE', [...P('RPD', 'p1')], [{ x: 420, y: 360 }, { x: 420, y: 320 }, { x: 455, y: 320 }]),
    // LED_A: RC1 bottom falls straight onto the anode above it — one line,
    // series string VCC -> 330R -> LED, exactly as the schematic reads.
    wire('led-a', 'LED_A', [...P('RC1', 'p2'), ...P('D1', 'anode')], [{ x: 345, y: 175 }, { x: 345, y: 190 }]),
    // LED_K: cathode east clear of the body, south in a free channel, west
    // below the base runs, north onto the collector. Crosses nothing.
    wire('led-k', 'LED_K', [...P('D1', 'cathode'), ...P('Q1', 'collector')],
      [{ x: 405, y: 190 }, { x: 520, y: 190 }, { x: 520, y: 205 }, { x: 540, y: 205 }]),
  ];
  return {
    components, wires,
    summary: { parts: components.length, nets: ['VCC', 'GND', 'GPIO', 'BASE', 'LED_A', 'LED_K'], boardMm: { w: 60, h: 53 } },
  };
}

