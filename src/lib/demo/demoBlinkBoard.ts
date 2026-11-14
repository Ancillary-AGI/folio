/**
 * Demo board: LED flasher, two-transistor astable multivibrator.
 *
 * The classic community bring-up circuit, laid out on a deterministic grid
 * the same way the rectifier demo is — every pin world computed by hand, every
 * wire segment listed point by point, nothing floating. It runs for real on
 * the sheet: 5 V supply, 2N3904s, red LEDs, and an oscillation frequency
 * around 0.7 Hz (R3·C_A ≈ R4·C_B). Proven by `demoBlinkBoard.test.ts`.
 *
 * Circuit: V1 5 V ─┬─ R_A 220 Ω ─ LED1 ─┬─ Q1 collector
 *                   │                   └─ C_B ─ Q2 base column
 *                   ├─ R_B 220 Ω ─ LED2 ─┬─ Q2 collector
 *                   │                   └─ C_A ─ Q1 base column
 *                   └─ R3 100 kΩ → Q1 base, R4 82 kΩ → Q2 base
 *                  Q1/Q2 emitters to GND, G1 on the rail.
 *
 * R4 is 82 kΩ, deliberately not 100 kΩ: a perfectly symmetric pair sits on
 * an unstable equilibrium the MNA solver lands on exactly, so no oscillation
 * would ever start in simulation. The 18 kΩ of asymmetry is what a real
 * matched-pair datasheet would not give you — it guarantees the oscillation
 * in the demo, and it costs nothing on the fabricated board.
 *
 * LED saturation current Is = 1e-16, emission n = 2 — datasheet-typical red
 * gallium phosphide values, so the branch current lands within a percent of
 * (5 − 2 − 0.1)/220 ≈ 13 mA at the collector, which is what the design
 * margins table expects to see against a 20 mA LED rating.
 *
 * Pin worlds (rotation 90° CW maps local (x, y) → (−y, x)):
 *   V1    +(30,120)   −(30,180)   DC Voltage Source, 5 V
 *   RA    p1(260,120)  p2(260,200) 220 Ω vertical
 *   LED1  a (260,210)  k (260,270) vertical, cathode down
 *   Q1    c (260,300)  b (200,320) e (260,340) unrotated
 *   RB    p1(640,120)  p2(640,200) mirror branch
 *   LED2  a (640,210)  k (640,270)
 *   Q2    c (640,300)  b (580,320) e (640,340)
 *   R3    p1(120,120)  p2(120,200) 100 kΩ base, branch 1
 *   R4    p1(540,120)  p2(540,200) 82 kΩ base, branch 2
 *   CA    p1(430,240)  p2(490,240) horizontal, Q1-collector → Q2 base
 *   CB    p1(430,180)  p2(490,180) horizontal, Q2-collector → Q1 base
 *   G1    gnd(350,340)
 *
 * CB and CA switch roles between the two half-cycles, which is why both are
 * non-polarised ceramic 10 µF parts, never electrolytics.
 *
 * Sheet extent: x 0..700, y 120..340 — grid units, 10 u = 1 mm.
 * PCB millimetre extent: 70 × 22 mm of placement; DEMO_BLINK_PCB_BOARD is
 * 80 × 45 mm to leave routing room around the branches.
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
  if (!found) throw new Error(`Blink board: library symbol "${name}" missing.`);
  return { ...found, id: `blink-lib-${name}`, pins: found.pins.map((p) => ({ ...p })) } as Component;
};

const placed = (
  ref: string, symbol: string, x: number, y: number,
  properties: Record<string, string | number | boolean>, rotation = 0,
): CanvasComponent => {
  const component = findSymbol(symbol);
  return {
    id: `blink-${ref}`, componentId: component.id ?? symbol, component,
    x, y, rotation, reference: ref, properties, visible: true,
  };
};

const wire = (
  id: string, netName: string,
  pins: Array<{ componentId: string; pinId: string }>,
  points: Array<{ x: number; y: number }>,
): CanvasWire => ({
  id: `blink-w-${id}`, netName, connectedPins: pins, points,
});

export function buildBlinkBoard(): DemoBoard {
  const components: CanvasComponent[] = [
    placed('V1', 'DC Voltage Source', 0, 120, { type: 'DC', voltage: '5V', footprint: '0805' }),
    placed('R_A', 'Resistor', 280, 120, { value: '220 Ω', footprint: '0805' }, 90),
    placed('LED1', 'LED', 280, 210, { type: 'LED', is: '1e-16', n: '2', color: 'red', vbr: '5V', footprint: '0805' }, 90),
    placed('Q1', 'NPN Transistor', 200, 290, { type: '2N3904', footprint: 'SOT-23' }),
    placed('R_B', 'Resistor', 660, 120, { value: '220 Ω', footprint: '0805' }, 90),
    placed('LED2', 'LED', 660, 210, { type: 'LED', is: '1e-16', n: '2', color: 'red', vbr: '5V', footprint: '0805' }, 90),
    placed('Q2', 'NPN Transistor', 580, 290, { type: '2N3904', footprint: 'SOT-23' }),
    placed('R3', 'Resistor', 140, 120, { value: '100 kΩ', footprint: '0805' }, 90),
    placed('R4', 'Resistor', 560, 120, { value: '82 kΩ', footprint: '0805' }, 90),
    placed('C_A', 'Capacitor', 430, 220, { value: '10 µF', voltage: '16V', footprint: '1206' }),
    placed('C_B', 'Capacitor', 430, 160, { value: '10 µF', voltage: '16V', footprint: '1206' }),
    placed('G1', 'Ground', 330, 340, {}),
  ];
  const P = (ref: string, ...pinIds: string[]): Array<{ componentId: string; pinId: string }> =>
    pinIds.map((pinId) => ({ componentId: `blink-${ref}`, pinId }));
  const wires: CanvasWire[] = [
    // VCC rail — V1+ straight through R3/RA/R4/RB taps; endpoints are pins.
    wire('vcc-rail', 'VCC', [...P('V1', 'positive'), ...P('R3', 'p1'), ...P('R_A', 'p1'), ...P('R4', 'p1'), ...P('R_B', 'p1')],
      [{ x: 30, y: 120 }, { x: 120, y: 120 }, { x: 260, y: 120 }, { x: 540, y: 120 }, { x: 640, y: 120 }]),
    // GND rail — Q1/Q2 emitters and G1; V1− drops in at the left end.
    wire('gnd-rail', 'GND', [...P('Q1', 'emitter'), ...P('G1', 'gnd'), ...P('Q2', 'emitter')],
      [{ x: 30, y: 340 }, { x: 260, y: 340 }, { x: 350, y: 340 }, { x: 640, y: 340 }]),
    wire('v1-drop', 'GND', [...P('V1', 'negative')],
      [{ x: 30, y: 180 }, { x: 30, y: 340 }]),
    // Collector columns — R_A feeds LED1's anode on MID1; the cathode drops
    // onto COL1 through Q1's collector. One wire per node, never both
    // terminals of a part on the same net (ERC caught exactly that).
    wire('mid1', 'MID1', [...P('R_A', 'p2'), ...P('LED1', 'anode')],
      [{ x: 260, y: 200 }, { x: 260, y: 210 }]),
    wire('col1', 'COL1', [...P('LED1', 'cathode'), ...P('Q1', 'collector')],
      [{ x: 260, y: 270 }, { x: 260, y: 300 }]),
    wire('mid2', 'MID2', [...P('R_B', 'p2'), ...P('LED2', 'anode')],
      [{ x: 640, y: 200 }, { x: 640, y: 210 }]),
    wire('col2', 'COL2', [...P('LED2', 'cathode'), ...P('Q2', 'collector')],
      [{ x: 640, y: 270 }, { x: 640, y: 300 }]),
    // Base resistors down from the rail.
    wire('r3-base', 'BASE1', [...P('R3', 'p2'), ...P('Q1', 'base')],
      [{ x: 120, y: 200 }, { x: 120, y: 320 }, { x: 200, y: 320 }]),
    wire('r4-base', 'BASE2', [...P('R4', 'p2'), ...P('Q2', 'base')],
      [{ x: 540, y: 200 }, { x: 540, y: 320 }, { x: 580, y: 320 }]),
    // Cross-coupling: Q1 collector → C_A → Q2 base, and the mirror.
    wire('ca-tap', 'COL1', [...P('C_A', 'p1')],
      [{ x: 260, y: 280 }, { x: 360, y: 280 }, { x: 360, y: 240 }, { x: 430, y: 240 }]),
    wire('ca-base', 'BASE2', [...P('C_A', 'p2'), ...P('Q2', 'base')],
      [{ x: 490, y: 240 }, { x: 490, y: 330 }, { x: 580, y: 330 }, { x: 580, y: 320 }]),
    wire('cb-tap', 'COL2', [...P('C_B', 'p2')],
      [{ x: 640, y: 285 }, { x: 575, y: 285 }, { x: 575, y: 180 }, { x: 490, y: 180 }]),
    wire('cb-base', 'BASE1', [...P('C_B', 'p1'), ...P('Q1', 'base')],
      [{ x: 430, y: 180 }, { x: 380, y: 180 }, { x: 380, y: 320 }, { x: 200, y: 320 }]),
  ];
  return {
    components,
    wires,
    summary: {
      parts: components.length,
      nets: ['VCC', 'GND', 'MID1', 'COL1', 'MID2', 'COL2', 'BASE1', 'BASE2'],
      boardMm: { w: 80, h: 45 },
    },
  };
}
