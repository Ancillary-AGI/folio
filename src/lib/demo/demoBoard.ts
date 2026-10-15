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
  properties: Record<string, string | number | boolean>,
): CanvasComponent => {
  const component = findSymbol(symbol);
  return {
    id: `demo-${ref}`, componentId: component.id ?? symbol, component,
    x, y, rotation: 0, reference: ref, properties, visible: true,
  };
};

const wire = (id: string, netName: string, pins: Array<{ componentId: string; pinId: string }>, points: Array<{ x: number; y: number }>): CanvasWire => ({
  id: `demo-w-${id}`, netName, connectedPins: pins, points,
});

export function buildDemoBoard(): DemoBoard {
  // One ground symbol net-wide: extra GND symbols would each demand a
  // footprint from fabExport, which correctly refuses to invent pads.
  // The diode stands in for the red LED (LED symbols carry color/current,
  // not IS/N — the solver fails loud instead of guessing a curve).
  const components: CanvasComponent[] = [
    placed('V1', 'DC Voltage Source', 60, 120, { voltage: '5V', type: 'DC', footprint: '0805' }),
    placed('G1', 'Ground', 60, 420, {}),
    placed('C1', 'Capacitor', 140, 200, { value: '100nF', footprint: '0603' }),
    placed('V2', 'Pulse Voltage Source', 300, 360, { type: 'PULSE', v1: '0V', v2: '5V', td: '10u', tr: '10n', tf: '10n', pw: '0.5s', per: '1s', footprint: '0805' }),
    placed('RB', 'Resistor', 300, 220, { value: '4.7k', footprint: '0805' }),
    placed('RPD', 'Resistor', 420, 280, { value: '10k', footprint: '0805' }),
    placed('Q1', 'NPN Transistor', 480, 200, { type: '2N2222', footprint: 'SOT-23' }),
    placed('RC1', 'Resistor', 620, 80, { value: '330', footprint: '0805' }),
    placed('D1', 'Diode', 620, 170, { is: '1e-14', n: '1.8', footprint: '0805' }),
  ];
  const P = (ref: string, ...pinIds: string[]): Array<{ componentId: string; pinId: string }> =>
    pinIds.map((pinId) => ({ componentId: `demo-${ref}`, pinId }));
  const wires: CanvasWire[] = [
    wire('vcc', 'VCC', [...P('V1', 'positive'), ...P('C1', 'p1'), ...P('RC1', 'p1')],
      [{ x: 60, y: 120 }, { x: 140, y: 200 }, { x: 620, y: 80 }]),
    wire('gnd', 'GND', [...P('V1', 'negative'), ...P('G1', 'gnd'), ...P('C1', 'p2'), ...P('V2', 'negative'), ...P('RPD', 'p2'), ...P('Q1', 'emitter')],
      [{ x: 60, y: 420 }, { x: 140, y: 320 }, { x: 300, y: 460 }, { x: 420, y: 380 }, { x: 540, y: 330 }]),
    wire('gpio', 'GPIO', [...P('V2', 'positive'), ...P('RB', 'p1')],
      [{ x: 300, y: 360 }, { x: 300, y: 220 }]),
    wire('base', 'BASE', [...P('RB', 'p2'), ...P('RPD', 'p1'), ...P('Q1', 'base')],
      [{ x: 300, y: 220 }, { x: 420, y: 280 }, { x: 480, y: 200 }]),
    wire('leda', 'LED_A', [...P('RC1', 'p2'), ...P('D1', 'anode')],
      [{ x: 620, y: 80 }, { x: 620, y: 170 }]),
    wire('ledk', 'LED_K', [...P('D1', 'cathode'), ...P('Q1', 'collector')],
      [{ x: 620, y: 170 }, { x: 480, y: 200 }]),
  ];
  return {
    components, wires,
    summary: { parts: components.length, nets: ['VCC', 'GND', 'GPIO', 'BASE', 'LED_A', 'LED_K'], boardMm: { w: 60, h: 53 } },
  };
}

