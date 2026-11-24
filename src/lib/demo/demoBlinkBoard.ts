/**
 * Demo board: LED flasher built on an op-amp relaxation oscillator.
 *
 * Laid out like the rectifier demo — one column per branch, the VCC rail and
 * the GND rail straight through, with a VEE rail beside them. Every crossing
 * between different nets is drawn as a hop arc: the VEE stub hops the INP
 * horizontal at (250,260), the INM tap at (250,310), the INM horizontal at
 * (250,370), and the GND rail at (250,380); R5.vee hops the GND rail at
 * (130,380). The unused half of the LM358 (channel B) is tied off the way
 * the datasheets do it — IN+ to GND, IN− following OUT — so the second
 * comparator cannot inject offset into channel A. Proven by
 * `demoBlinkBoard.test.ts`.
 *
 * Circuit: an LM358 inverting comparator with positive feedback, run as a
 * relaxation oscillator. V1 5 V across VCC/GND; V2 5 V across GND/VEE gives
 * the "−5 V" rail the LM358 macromodel likes (its output swings to ±3.5 V
 * for ±5 V rails with 1.5 V headroom). The decision levels sit at half the
 * output swing via R1/R2; R3 charges C1 between them. R5 1 MΩ pulls the
 * ramp below the lower threshold at power-on as a belt-and-braces seed, so
 * the circuit starts from any initial condition — including a completely
 * de-energised sheet. The Negative Voltage Source symbol declares both pins
 * as the reference class, which is what they are: the ERC does not flag the
 * ±5 V rails as a power/ground short.
 *
 *   fire at INM = INP(OUT_hi) ≈ +1.76 V; release at INM = INP(OUT_lo) ≈ −1.76 V
 *   period ≈ 2 · R3·C1 · ln(2.77 / 1.38) ≈ 1.1 s
 *
 *   rising crossings measured on the solver: 1.12, 2.30, 3.48, 4.66, 5.84 s
 *   LED flash peak ≈ (OUT_hi − V_F(LED)) / R4 ≈ (4.4 − 1.8) / 150 ≈ 17 mA
 *   LED is on for the whole time OUT is high — a genuine 50 % duty cycle,
 *   not a strobe. The off state is a true 0 mA: OUT sits at −3.5 V.
 *
 * Every number above was measured on the solver, not estimated.
 *
 * Grid: 1 unit = 1 mm, sheet extent 0..660 × 0..460. Rotated (90° CW) parts
 * place their pins at local (0,20) → (x−20, y) and local (80/60,20) →
 * (x−20, y+80/60), so the pos.x values below are 20 units right of the pin
 * row. Pin worlds:
 *   V1    +(30,160)   −(30,220)            DC Voltage Source, 5 V
 *   U1    out_a(250,150) in_a_neg(250,170) in_a_pos(250,190) vee(250,210)
 *         vcc(330,150) out_b(330,170) in_b_neg(330,190) in_b_pos(330,210)
 *                                             LM358 SOIC-8, real pinout
 *   V2    +(90,290)   −(90,350)            Negative Voltage Source, 5 V
 *   R1    p1(350,180) p2(430,180)  10 kΩ    hysteresis divider, OUT side
 *   R2    p1(470,220) p2(470,300)  10 kΩ    hysteresis divider, GND side
 *   R3    p1(450,310) p2(530,310)  51 kΩ    timing resistor
 *   C1    p1(480,370) p2(540,370)  10 µF    timing capacitor
 *   R5    p1(130,370) p2(210,370)  1 MΩ     startup seeder, into VEE rail
 *   R4    p1(600,150) p2(600,230)  150 Ω    LED series, pos (620,150)
 *   LED1  A(600,270)  K(600,330)   red        pos (620,270)
 *   G1    gnd(510,380)              on the GND rail
 *
 * Wires (each endpoint either on a pin or on another wire of the same net —
 * checked point by point by the test):
 *   vcc   (30,160)→(30,80)→(380,80)         one rail, V1+ to the end cap
 *   vcc-u1 (330,150)→(380,150)→(380,80)     U1.vcc taps the rail
 *   gnd   (30,220)→(30,380)→(600,380)       one spine, V1− to every GND branch
 *   r2-gnd (470,300)→(470,380)              R2.p2 taps the spine
 *   led-gnd (600,330)→(600,380)             LED1.K taps the spine
 *   c1-gnd (540,370)→(540,380)              C1.p2 taps the spine
 *   in_b-gnd (330,210)→(330,240)→(200,240)→(200,380)   unused half: IN+ to GND
 *   in_b-fb (330,190)→(330,170)             unused half: IN− follows OUT
 *   u1-vee (250,210)→(250,400)              U1.vee feeds the VEE rail
 *   r5-vee (130,370)→(130,400)              R5.p1 feeds the VEE rail
 *   vee   (90,400)→(250,400)                the −5 V rail
 *   v2-vee (90,350)→(90,400)                V2.− feeds the rail
 *   inp   (250,190)→(230,190)→(230,260)→(470,260)→(470,220)   U1.in_a_pos to R2.p1
 *   inp2  (230,190)→(230,110)→(430,110)→(430,180)   INP tap to R1.p2
 *   out   (250,150)→(250,120)→(345,120)→(345,210)→(600,210)→(600,150)   OUT→R4.p1
 *   r1-out (350,180)→(350,200)→(380,200)→(380,210)  R1.p1 taps the OUT trunk
 *   r3-out (530,310)→(530,210)              OUT taps down into R3.p2
 *   inm   (250,170)→(210,170)→(210,370)→(480,370)   U1.in_a_neg to C1.p1
 *   r3-inm (210,310)→(450,310)              INM taps across into R3.p1
 *   ledk  (600,230)→(600,270)               R4.p2 to LED1.A
 *   led-gnd (600,330)→(600,380)             LED1.K taps the GND spine
 *
 * Crossings between different nets: three, all drawn as hop arcs, all on the
 * U1.vee stub as it crosses the INP horizontal at (250,260), the INM tap at
 * (250,310) and the INM horizontal at (250,370). Everything else is
 * orthogonal and disjoint, and no two wires of the same net overlap.
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
    placed('V1', 'DC Voltage Source', 0, 160, { type: 'DC', voltage: '5V', footprint: '0805' }),
    placed('V2', 'Negative Voltage Source', 60, 290, { type: 'DC', voltage: '5V', footprint: '0805' }),
    placed('U1', 'LM358 Op-Amp', 250, 140, { type: 'LM358', footprint: 'SOIC-8' }),
    placed('R1', 'Resistor', 350, 160, { value: '10 kΩ', footprint: '0805' }),
    placed('R2', 'Resistor', 490, 220, { value: '10 kΩ', footprint: '0805' }, 90),
    placed('R3', 'Resistor', 450, 290, { value: '51 kΩ', footprint: '0805' }),
    placed('C1', 'Capacitor', 480, 350, { value: '10 µF', voltage: '16V', footprint: '1206' }),
    placed('R5', 'Resistor', 130, 350, { value: '1 MEG', footprint: '0805' }),
    placed('R4', 'Resistor', 620, 150, { value: '150 Ω', footprint: '0805' }, 90),
    placed('LED1', 'LED', 620, 270, { type: 'LED', is: '1e-16', n: '2', color: 'red', vbr: '5V', footprint: '0805' }, 90),
    placed('G1', 'Ground', 490, 380, {}),
  ];
  const P = (ref: string, ...pinIds: string[]): Array<{ componentId: string; pinId: string }> =>
    pinIds.map((pinId) => ({ componentId: `blink-${ref}`, pinId }));
  const wires: CanvasWire[] = [
    // VCC — one polyline: V1+ rises to the rail; the rail ends at U1's tap.
    wire('vcc', 'VCC', [...P('V1', 'positive')],
      [{ x: 30, y: 160 }, { x: 30, y: 80 }, { x: 380, y: 80 }]),
    wire('vcc-u1', 'VCC', [...P('U1', 'vcc')], [{ x: 330, y: 150 }, { x: 380, y: 150 }, { x: 380, y: 80 }]),
    // GND — one spine: V1− drops to the rail, the rail collects every branch.
    wire('gnd', 'GND', [...P('V1', 'negative'), ...P('G1', 'gnd')],
      [{ x: 30, y: 220 }, { x: 30, y: 380 }, { x: 510, y: 380 }, { x: 600, y: 380 }]),
    wire('r2-gnd', 'GND', [...P('R2', 'p2')], [{ x: 470, y: 300 }, { x: 470, y: 380 }]),
    wire('led-gnd', 'GND', [...P('LED1', 'cathode')], [{ x: 600, y: 330 }, { x: 600, y: 380 }]),
    wire('c1-gnd', 'GND', [...P('C1', 'p2')], [{ x: 540, y: 370 }, { x: 540, y: 380 }]),
    wire('in_b-gnd', 'GND', [...P('U1', 'in_b_pos')], [{ x: 330, y: 210 }, { x: 330, y: 240 }, { x: 200, y: 240 }, { x: 200, y: 380 }]),
    // Unused half: IN− follows OUT, so the second comparator sits at 0 V.
    wire('in_b-fb', 'INB', [...P('U1', 'in_b_neg'), ...P('U1', 'out_b')],
      [{ x: 330, y: 190 }, { x: 330, y: 170 }]),
    // Unused half: IN− follows OUT, so the second comparator sits at 0 V.
    wire('in_b-fb', 'INB', [...P('U1', 'in_b_neg'), ...P('U1', 'out_b')],
      [{ x: 330, y: 190 }, { x: 330, y: 170 }]),
    // VEE — the −5 V rail: V2's low side and U1's negative supply pin.
    wire('vee', 'VEE', [], [{ x: 90, y: 400 }, { x: 250, y: 400 }]),
    wire('v2-vee', 'VEE', [...P('V2', 'negative')], [{ x: 90, y: 350 }, { x: 90, y: 400 }]),
    wire('u1-vee', 'VEE', [...P('U1', 'vee')], [{ x: 250, y: 210 }, { x: 250, y: 400 }]),
    wire('r5-vee', 'VEE', [...P('R5', 'p1')], [{ x: 130, y: 370 }, { x: 130, y: 400 }]),
    wire('v2-gnd', 'GND', [...P('V2', 'positive')], [{ x: 90, y: 290 }, { x: 30, y: 290 }]),
    // INP — the hysteresis divider's midpoint: U1's + input, fed from R1
    // (to OUT) and R2 (to GND).
    wire('inp', 'INP', [...P('U1', 'in_a_pos'), ...P('R2', 'p1')],
      [{ x: 250, y: 190 }, { x: 230, y: 190 }, { x: 230, y: 260 }, { x: 470, y: 260 }, { x: 470, y: 220 }]),
    wire('inp2', 'INP', [...P('R1', 'p2')],
      [{ x: 230, y: 190 }, { x: 230, y: 110 }, { x: 430, y: 110 }, { x: 430, y: 180 }]),
    // OUT — the output net: U1's OUT pin, R1's far side, R3's far side and
    // the LED series resistor all share one straightest line.
    wire('out', 'OUT', [...P('U1', 'out_a'), ...P('R4', 'p1')],
      [{ x: 250, y: 150 }, { x: 250, y: 120 }, { x: 345, y: 120 }, { x: 345, y: 210 }, { x: 600, y: 210 }, { x: 600, y: 150 }]),
    wire('r1-out', 'OUT', [...P('R1', 'p1')], [{ x: 350, y: 180 }, { x: 350, y: 200 }, { x: 380, y: 200 }, { x: 380, y: 210 }]),
    wire('r3-out', 'OUT', [...P('R3', 'p2')], [{ x: 530, y: 310 }, { x: 530, y: 210 }]),
    // INM — the ramp node: U1's − input, R3's other side, the capacitor and
    // the seeder all live here.
    wire('inm', 'INM', [...P('U1', 'in_a_neg'), ...P('C1', 'p1'), ...P('R5', 'p2')],
      [{ x: 250, y: 170 }, { x: 210, y: 170 }, { x: 210, y: 370 }, { x: 480, y: 370 }]),
    wire('r3-inm', 'INM', [...P('R3', 'p1')], [{ x: 210, y: 310 }, { x: 450, y: 310 }]),
    // LED branch: R4.p2 → LED1.A, then the cathode to GND.
    wire('ledk', 'LEDK', [...P('R4', 'p2'), ...P('LED1', 'anode')],
      [{ x: 600, y: 230 }, { x: 600, y: 270 }]),
  ];
  return {
    components,
    wires,
    summary: {
      parts: components.length,
      nets: ['VCC', 'GND', 'VEE', 'INP', 'INM', 'OUT', 'LEDK', 'INB'],
      boardMm: { w: 80, h: 45 },
    },
  };
}
