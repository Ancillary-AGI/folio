/**
 * Demo board: LED flasher, two-transistor astable multivibrator.
 *
 * Laid out like the rectifier demo — one column per branch, the VCC rail and
 * the GND return straight through, every vertical part's body centred on the
 * sheet midline with equal stubs, and the harness as short as the topology
 * allows: every crossover that cannot be avoided lands in exactly one place.
 * Proven by `demoBlinkBoard.test.ts`.
 *
 * Circuit: V1 5 V across VCC/GND; per branch RA/RB 220 Ω → LED → collector;
 * base drops R3 100 kΩ / R4 82 kΩ from VCC; emitters to GND. Cross-coupling:
 * COL1 → CA 10 µF → BASE2 and COL2 → CB 10 µF → BASE1.
 *
 * R4 is 82 kΩ, not 100 kΩ — a perfectly symmetric pair sits on an unstable
 * equilibrium the MNA solver lands on exactly, so no oscillation ever starts.
 * The 18 kΩ of asymmetry guarantees oscillation and costs nothing on the
 * fabricated board.
 *
 * LED branch current ≈ (5 − 2 − 0.1)/220 ≈ 13 mA; CA/CB rated 16 V; both
 * junctions inside the 2N3904 40 V Vceo envelope.
 *
 * Grid: 1 unit = 1 mm, sheet extent 0..460 × 0..400.
 * Pin worlds (rotation 90° CW maps local (x, y) → (−y, x); unrotated parts
 * place pins as-is, NPN pos P has B = (P.x, P.y+30), C = (P.x+60, P.y+10),
 * E = (P.x+60, P.y+50); capacitor pos Q has p1 = (Q.x, Q.y+20),
 * p2 = (Q.x+60, Q.y+20)):
 *   V1    +(30,175)   −(30,235)             DC Voltage Source, 5 V
 *   R3    p1(170,160) p2(170,240) 100 kΩ    vertical, centred on midline
 *   R4    p1(370,160) p2(370,240)  82 kΩ    vertical, centred on midline
 *   RA    p1(230,80)  p2(230,160)  220 Ω    vertical
 *   RB    p1(430,80)  p2(430,160)  220 Ω    vertical
 *   LED1  A(230,180)  K(230,240)   vertical, cathode down
 *   LED2  A(430,180)  K(430,240)   vertical, cathode down
 *   Q1    pos(170,250) C(230,260) B(170,280) E(230,300)
 *   Q2    pos(370,250) C(430,260) B(370,280) E(430,300)
 *   CA    p1(250,250) p2(310,250)   COL1 → BASE2
 *   CB    p1(100,312) p2(160,312)   COL2 → BASE1
 *   G1    gnd(230,380)               on the GND rail at the E1 joint
 *
 * Wires (each endpoint either on a pin or on another wire of the same net —
 * checked point by point by the test):
 *   vcc   (30,175)→(30,80)→(170,80)→(230,80)→(370,80)→(430,80)   one rail, V1+ to RB.p1
 *   gnd   (30,235)→(30,380)→(230,380)→(430,380)                  one return, V1− to G1 joint
 *   r3-up (170,160)→(170,80)     r4-up (370,160)→(370,80)         tap the VCC rail
 *   mid1  (230,160)→(230,180)    mid2  (430,160)→(430,180)        RA→LED / RB→LED
 *   col1  (230,240)→(230,260)    col2  (430,240)→(430,260)        LED.K → collector
 *   base1 (170,240)→(170,280)    base2 (370,240)→(370,280)        R3/R4 → base, straight
 *   e1    (230,300)→(230,380)    e2    (430,300)→(430,380)        emitter → GND rail
 *   ca1   (230,250)→(250,250)    ca2   (310,250)→(370,250)        COL1 → CA → BASE2 tap
 *   cb1   (430,250)→(455,250)→(455,312)→(160,312)                 COL2 → CB.p2 (hops e1/e2)
 *   cb2   (100,312)→(100,245)→(170,245)                           CB.p1 → BASE1 tap
 *
 * Crossings (different nets): exactly two — cb1 over e1 at (230,312) and cb1
 * over e2 at (430,312). Both are drawn as hop arcs by the renderer.
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
    placed('V1', 'DC Voltage Source', 0, 175, { type: 'DC', voltage: '5V', footprint: '0805' }),
    placed('R3', 'Resistor', 190, 160, { value: '100 kΩ', footprint: '0805' }, 90),
    placed('RA', 'Resistor', 250, 80, { value: '220 Ω', footprint: '0805' }, 90),
    placed('LED1', 'LED', 250, 180, { type: 'LED', is: '1e-16', n: '2', color: 'red', vbr: '5V', footprint: '0805' }, 90),
    placed('Q1', 'NPN Transistor', 170, 250, { type: '2N3904', footprint: 'SOT-23' }),
    placed('CA', 'Capacitor', 250, 230, { value: '10 µF', voltage: '16V', footprint: '1206' }),
    placed('CB', 'Capacitor', 100, 292, { value: '10 µF', voltage: '16V', footprint: '1206' }),
    placed('R4', 'Resistor', 390, 160, { value: '82 kΩ', footprint: '0805' }, 90),
    placed('RB', 'Resistor', 450, 80, { value: '220 Ω', footprint: '0805' }, 90),
    placed('LED2', 'LED', 450, 180, { type: 'LED', is: '1e-16', n: '2', color: 'red', vbr: '5V', footprint: '0805' }, 90),
    placed('Q2', 'NPN Transistor', 370, 250, { type: '2N3904', footprint: 'SOT-23' }),
    placed('G1', 'Ground', 210, 380, {}),
  ];
  const P = (ref: string, ...pinIds: string[]): Array<{ componentId: string; pinId: string }> =>
    pinIds.map((pinId) => ({ componentId: `blink-${ref}`, pinId }));
  const wires: CanvasWire[] = [
    // VCC — one polyline: V1+ rises to the rail and the rail serves every branch.
    wire('vcc', 'VCC', [...P('V1', 'positive'), ...P('RA', 'p1'), ...P('RB', 'p1')],
      [{ x: 30, y: 175 }, { x: 30, y: 80 }, { x: 170, y: 80 }, { x: 230, y: 80 }, { x: 370, y: 80 }, { x: 430, y: 80 }]),
    wire('r3-up', 'VCC', [...P('R3', 'p1')],
      [{ x: 170, y: 160 }, { x: 170, y: 80 }]),
    wire('r4-up', 'VCC', [...P('R4', 'p1')],
      [{ x: 370, y: 160 }, { x: 370, y: 80 }]),
    // GND — one return: V1− drops to the rail, the rail collects both emitters.
    wire('gnd', 'GND', [...P('V1', 'negative'), ...P('G1', 'gnd')],
      [{ x: 30, y: 235 }, { x: 30, y: 380 }, { x: 230, y: 380 }, { x: 430, y: 380 }]),
    wire('e1', 'GND', [...P('Q1', 'emitter')],
      [{ x: 230, y: 300 }, { x: 230, y: 380 }]),
    wire('e2', 'GND', [...P('Q2', 'emitter')],
      [{ x: 430, y: 300 }, { x: 430, y: 380 }]),
    // MID — RA to LED1, RB to LED2.
    wire('mid1', 'MID1', [...P('RA', 'p2'), ...P('LED1', 'anode')],
      [{ x: 230, y: 160 }, { x: 230, y: 180 }]),
    wire('mid2', 'MID2', [...P('RB', 'p2'), ...P('LED2', 'anode')],
      [{ x: 430, y: 160 }, { x: 430, y: 180 }]),
    // COL — LED cathode to the transistor collector.
    wire('col1', 'COL1', [...P('LED1', 'cathode'), ...P('Q1', 'collector')],
      [{ x: 230, y: 240 }, { x: 230, y: 260 }]),
    wire('col2', 'COL2', [...P('LED2', 'cathode'), ...P('Q2', 'collector')],
      [{ x: 430, y: 240 }, { x: 430, y: 260 }]),
    // BASE — R3/R4 drop straight into the base pin, no bends.
    wire('base1', 'BASE1', [...P('R3', 'p2'), ...P('Q1', 'base')],
      [{ x: 170, y: 240 }, { x: 170, y: 280 }]),
    wire('base2', 'BASE2', [...P('R4', 'p2'), ...P('Q2', 'base')],
      [{ x: 370, y: 240 }, { x: 370, y: 280 }]),
    // CA — COL1 taps off its stub, straight through to the BASE2 tap.
    wire('ca1', 'COL1', [...P('CA', 'p1')],
      [{ x: 230, y: 250 }, { x: 250, y: 250 }]),
    wire('ca2', 'BASE2', [...P('CA', 'p2')],
      [{ x: 310, y: 250 }, { x: 370, y: 250 }]),
    // CB — COL2 stubs right, drops to y=312, runs home under both branches,
    // then rises into the BASE1 leg. Hops e1 and e2 (the only crossings).
    wire('cb1', 'COL2', [...P('CB', 'p2')],
      [{ x: 430, y: 250 }, { x: 455, y: 250 }, { x: 455, y: 312 }, { x: 160, y: 312 }]),
    wire('cb2', 'BASE1', [...P('CB', 'p1')],
      [{ x: 100, y: 312 }, { x: 100, y: 245 }, { x: 170, y: 245 }]),
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
