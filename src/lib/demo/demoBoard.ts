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
  // Closed low-side LED switcher. Rails run full-width; every tap lands on
  // its rail at a junction dot. Exactly one crossing (GPIO x GND drop) uses
  // a jump-over hop. Pin worlds: V1 (80,100), V2 (80,300), C1 (200,120),
  // RB (300,235), RPD (415,300) rot90, Q1 (420,220), RC1 (360,80) rot90,
  // D1 (345,170), G1 (280,420).
  const components: CanvasComponent[] = [
    placed('V1', 'DC Voltage Source', 80, 100, { voltage: '5V', type: 'DC', footprint: '0805' }),
    placed('C1', 'Capacitor', 200, 120, { value: '100nF', footprint: '0603' }),
    placed('V2', 'Pulse Voltage Source', 80, 300, { type: 'PULSE', v1: '0V', v2: '5V', td: '10u', tr: '10n', tf: '10n', pw: '0.5s', per: '1s', footprint: '0805' }),
    placed('RB', 'Resistor', 300, 235, { value: '4.7k', footprint: '0805' }),
    placed('RPD', 'Resistor', 415, 300, { value: '10k', footprint: '0805' }, 90),
    placed('Q1', 'NPN Transistor', 420, 220, { type: '2N2222', footprint: 'SOT-23' }),
    placed('RC1', 'Resistor', 360, 80, { value: '330', footprint: '0805' }, 90),
    placed('D1', 'Diode', 345, 170, { is: '1e-14', n: '1.8', footprint: '0805' }),
    placed('G1', 'Ground', 280, 420, {}),
  ];
  const P = (ref: string, ...pinIds: string[]): Array<{ componentId: string; pinId: string }> =>
    pinIds.map((pinId) => ({ componentId: `demo-${ref}`, pinId }));
  const wires: CanvasWire[] = [
    wire('vcc-rail', 'VCC', [...P('RC1', 'p1')], [{ x: 110, y: 80 }, { x: 345, y: 80 }]),
    wire('vcc-v1', 'VCC', [...P('V1', 'positive')], [{ x: 110, y: 100 }, { x: 110, y: 80 }]),
    wire('vcc-c1', 'VCC', [...P('C1', 'p1')], [{ x: 200, y: 140 }, { x: 200, y: 80 }]),
    wire('gnd-rail', 'GND', [...P('G1', 'gnd')], [{ x: 70, y: 420 }, { x: 300, y: 420 }, { x: 480, y: 420 }]),
    wire('gnd-v1', 'GND', [...P('V1', 'negative')], [{ x: 110, y: 160 }, { x: 70, y: 160 }, { x: 70, y: 420 }]),
    wire('gnd-c1', 'GND', [...P('C1', 'p2')], [{ x: 260, y: 140 }, { x: 260, y: 420 }]),
    wire('gnd-v2', 'GND', [...P('V2', 'negative')], [{ x: 110, y: 360 }, { x: 110, y: 420 }]),
    wire('gnd-rpd', 'GND', [...P('RPD', 'p2')], [{ x: 400, y: 380 }, { x: 400, y: 420 }]),
    wire('gnd-q1', 'GND', [...P('Q1', 'emitter')], [{ x: 480, y: 275 }, { x: 480, y: 420 }]),
    wire('gpio', 'GPIO', [...P('V2', 'positive'), ...P('RB', 'p1')],
      [{ x: 110, y: 300 }, { x: 280, y: 300 }, { x: 280, y: 250 }, { x: 300, y: 250 }]),
    wire('base', 'BASE', [...P('RB', 'p2'), ...P('Q1', 'base')], [{ x: 380, y: 250 }, { x: 420, y: 250 }]),
    wire('base-pd', 'BASE', [...P('RPD', 'p1')], [{ x: 400, y: 300 }, { x: 400, y: 250 }]),
    wire('led-a', 'LED_A', [...P('RC1', 'p2'), ...P('D1', 'anode')], [{ x: 345, y: 160 }, { x: 345, y: 190 }]),
    wire('led-k', 'LED_K', [...P('D1', 'cathode'), ...P('Q1', 'collector')],
      [{ x: 405, y: 190 }, { x: 480, y: 190 }, { x: 480, y: 225 }]),
  ];
  return {
    components, wires,
    summary: { parts: components.length, nets: ['VCC', 'GND', 'GPIO', 'BASE', 'LED_A', 'LED_K'], boardMm: { w: 60, h: 53 } },
  };
}

