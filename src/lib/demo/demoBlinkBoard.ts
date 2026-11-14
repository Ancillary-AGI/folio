/**
 * Demo board: LED flasher, two-transistor astable multivibrator.
 *
 * The classic community bring-up circuit, laid out on a deterministic grid
 * the same way the rectifier demo is — every pin world computed by hand, every
 * wire segment listed point by point, nothing floating. It runs for real on
 * the sheet: 5 V supply, 2N3904s, red LEDs, and an oscillation frequency
 * around 0.7 Hz (R3·CA ≈ R4·CB). Proven by `demoBlinkBoard.test.ts`.
 *
 * Circuit: V1 5 V ─┬─ RA 220 Ω ─ LED1 ─┬─ Q1 collector
 *                   │                   └─ CB ─ Q2 base column
 *                   ├─ RB 220 Ω ─ LED2 ─┬─ Q2 collector
 *                   │                   └─ CA ─ Q1 base column
 *                   └─ R3 100 kΩ → Q1 base, R4 82 kΩ → Q2 base
 *
 * R4 is 82 kΩ, deliberately not 100 kΩ: a perfectly symmetric pair sits on
 * an unstable equilibrium the MNA solver lands on exactly, so no oscillation
 * would ever start in simulation. The 18 kΩ of asymmetry guarantees oscillation
 * in the demo and costs nothing on the fabricated board.
 *
 * LED saturation current Is = 1e-16, emission n = 2 — datasheet-typical red
 * gallium phosphide values, so the branch current lands within a percent of
 * (5 − 2 − 0.1)/220 ≈ 13 mA at the collector, which is what the design
 * margins table expects to see against a 20 mA LED rating.
 *
 * Pin worlds (rotation 90° CW maps local (x, y) → (−y, x)):
 *   V1    +(30,120)   −(30,180)   DC Voltage Source, 5 V
 *   R3    p1(120,120)  p2(120,200) 100 kΩ, vertical, base-1 drop
 *   RA   p1(260,120)  p2(260,200) 220 Ω, vertical, branch-1 series
 *   LED1  a (260,220)  k (260,280) vertical, cathode down
 *   Q1    c (260,300)  b (200,320) e (260,340) unrotated
 *   G1    gnd(350,400) on the bottom rail
 *   R4    p1(480,120)  p2(480,200) 82 kΩ, vertical, base-2 drop
 *   RB   p1(620,120)  p2(620,200) 220 Ω, vertical, branch-2 series
 *   LED2  a (620,220)  k (620,280)
 *   Q2    c (660,300)  b (600,320) e (660,340) unrotated
 *   CA   p1(370,220)  p2(430,220) horizontal, COL1 → BASE2
 *   CB   p1(370,370)  p2(430,370) horizontal, COL2 → BASE1
 *
 * Wire segments (grid units, 10 u = 1 mm):
 *   vcc-rail  (30,120)→(120,120)→(260,120)→(460,120)→(620,120)
 *   v1-drop   (30,180)→(30,400)        gnd-rail  (30,400)→(260,400)→(350,400)→(660,400)
 *   e1        (260,340)→(260,400)      e2        (660,340)→(660,400)
 *   mid1      (260,200)→(260,220)      mid2      (620,200)→(620,220)
 *   col1      (260,280)→(260,300)      col2      (620,280)→(620,300)→(660,300)
 *   base1     (120,200)→(120,320)→(200,320)
 *   base2     (460,200)→(460,320)→(600,320)
 *   ca1       (260,280)→(330,280)→(330,220)→(370,220)   CA.p1 ← COL1 tap
 *   ca2       (430,220)→(460,220)       CA.p2 → BASE2 (T on vertical x=460)
 *   cb1       (370,370)→(80,370)→(80,200)→(120,200)    CB.p1 ← BASE1 (the wire ends on R3.p2)
 *   cb2       (430,370)→(700,370)→(700,300)→(660,300)  CB.p2 → COL2
 *
 * Sheet extent: x 0..720, y 120..400 — grid units, 10 u = 1 mm.
 * PCB millimetre extent: 72 × 28 mm of placement; DEMO_BLINK_PCB_BOARD is
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
    placed('R3', 'Resistor', 140, 120, { value: '100 kΩ', footprint: '0805' }, 90),
    placed('RA', 'Resistor', 280, 120, { value: '220 Ω', footprint: '0805' }, 90),
    placed('LED1', 'LED', 280, 220, { type: 'LED', is: '1e-16', n: '2', color: 'red', vbr: '5V', footprint: '0805' }, 90),
    placed('Q1', 'NPN Transistor', 200, 290, { type: '2N3904', footprint: 'SOT-23' }),
    placed('CA', 'Capacitor', 370, 200, { value: '10 µF', voltage: '16V', footprint: '1206' }),
    placed('CB', 'Capacitor', 370, 350, { value: '10 µF', voltage: '16V', footprint: '1206' }),
    placed('R4', 'Resistor', 480, 120, { value: '82 kΩ', footprint: '0805' }, 90),
    placed('RB', 'Resistor', 640, 120, { value: '220 Ω', footprint: '0805' }, 90),
    placed('LED2', 'LED', 640, 220, { type: 'LED', is: '1e-16', n: '2', color: 'red', vbr: '5V', footprint: '0805' }, 90),
    placed('Q2', 'NPN Transistor', 600, 290, { type: '2N3904', footprint: 'SOT-23' }),
    placed('G1', 'Ground', 330, 400, {}),
  ];
  const P = (ref: string, ...pinIds: string[]): Array<{ componentId: string; pinId: string }> =>
    pinIds.map((pinId) => ({ componentId: `blink-${ref}`, pinId }));
  const wires: CanvasWire[] = [
    // VCC rail — V1+ straight through R3/RA/R4/RB taps; endpoints are pins.
    wire('vcc-rail', 'VCC', [...P('V1', 'positive'), ...P('R3', 'p1'), ...P('RA', 'p1'), ...P('R4', 'p1'), ...P('RB', 'p1')],
      [{ x: 30, y: 120 }, { x: 120, y: 120 }, { x: 260, y: 120 }, { x: 460, y: 120 }, { x: 620, y: 120 }]),
    wire('v1-drop', 'GND', [...P('V1', 'negative')],
      [{ x: 30, y: 180 }, { x: 30, y: 400 }]),
    wire('e1', 'GND', [...P('Q1', 'emitter')],
      [{ x: 260, y: 340 }, { x: 260, y: 400 }]),
    wire('e2', 'GND', [...P('Q2', 'emitter')],
      [{ x: 660, y: 340 }, { x: 660, y: 400 }]),
    wire('gnd-rail', 'GND', [...P('V1', 'negative'), ...P('Q1', 'emitter'), ...P('G1', 'gnd'), ...P('Q2', 'emitter')],
      [{ x: 30, y: 400 }, { x: 260, y: 400 }, { x: 350, y: 400 }, { x: 660, y: 400 }]),
    wire('mid1', 'MID1', [...P('RA', 'p2'), ...P('LED1', 'anode')],
      [{ x: 260, y: 200 }, { x: 260, y: 220 }]),
    wire('mid2', 'MID2', [...P('RB', 'p2'), ...P('LED2', 'anode')],
      [{ x: 620, y: 200 }, { x: 620, y: 220 }]),
    wire('col1', 'COL1', [...P('LED1', 'cathode'), ...P('Q1', 'collector')],
      [{ x: 260, y: 280 }, { x: 260, y: 300 }]),
    wire('col2', 'COL2', [...P('LED2', 'cathode'), ...P('Q2', 'collector')],
      [{ x: 620, y: 280 }, { x: 620, y: 300 }, { x: 660, y: 300 }]),
    wire('base1', 'BASE1', [...P('R3', 'p2'), ...P('Q1', 'base')],
      [{ x: 120, y: 200 }, { x: 120, y: 320 }, { x: 200, y: 320 }]),
    wire('base2', 'BASE2', [...P('R4', 'p2'), ...P('Q2', 'base')],
      [{ x: 460, y: 200 }, { x: 460, y: 320 }, { x: 600, y: 320 }]),
    wire('ca1', 'COL1', [...P('CA', 'p1')],
      [{ x: 260, y: 280 }, { x: 330, y: 280 }, { x: 330, y: 220 }, { x: 370, y: 220 }]),
    wire('ca2', 'BASE2', [...P('CA', 'p2')],
      [{ x: 430, y: 220 }, { x: 460, y: 220 }]),
    wire('cb1', 'BASE1', [...P('CB', 'p1')],
      [{ x: 370, y: 370 }, { x: 80, y: 370 }, { x: 80, y: 200 }, { x: 120, y: 200 }]),
    wire('cb2', 'COL2', [...P('CB', 'p2')],
      [{ x: 430, y: 370 }, { x: 700, y: 370 }, { x: 700, y: 300 }, { x: 660, y: 300 }]),
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
