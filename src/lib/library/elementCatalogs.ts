/**
 * Library catalogs for the domains whose "parts" are not components.
 *
 * The rule the whole library follows: a row exists only if a panel can place it
 * and something in the app can then solve it. So these rows are built from the
 * data each domain already computes with — the control library's polynomial
 * forms, the link budget's own inputs, the load-flow case shape, the robot
 * architectures the kinematics engine accepts and code that the app's own HDL
 * and firmware parsers elaborate. `domainCatalogs.test.ts` runs every snippet
 * through those parsers, so a row cannot advertise code the editor would reject.
 */
import type { LibraryItemOf } from './types'
import { ROBOT_ARCHITECTURES } from '../robotics/robotLibrary'
import { ACC_CPU_VERILOG } from '../fpga/accCpu'
import { FIR_DSP_VERILOG } from '../fpga/firDsp'
import type { FeederNode, PowerBranch, PowerBus } from '../power/loadFlow'

/* ------------------------------------------------------------------ *
 * Control: transfer-function blocks
 * ------------------------------------------------------------------ */

/**
 * Canonical forms, coefficients in descending powers of s. Each row states the
 * pole/zero data it was built from, so the number on the sheet is checkable
 * against `src/lib/control/transferFunction.ts`.
 */
const CONTROL_BLOCKS: Array<{
  id: string
  name: string
  category: string
  form: string
  numerator: number[]
  denominator: number[]
  description: string
}> = [
  {
    id: 'tf-gain', name: 'Gain K = 10', category: 'Building blocks', form: 'K',
    numerator: [10], denominator: [1],
    description: 'Static gain. No dynamics, so it cannot change stability — only the crossover.',
  },
  {
    id: 'tf-integrator', name: 'Integrator', category: 'Building blocks', form: '1/s',
    numerator: [1], denominator: [1, 0],
    description: 'Type-1 pole at the origin. Tracking to a step becomes perfect, phase starts at −90°.',
  },
  {
    id: 'tf-double-integrator', name: 'Double integrator (mass)', category: 'Building blocks', form: '1/s²',
    numerator: [1], denominator: [1, 0, 0],
    description: 'A rigid mass driven by force. Phase starts at −180°, so it needs lead to close cleanly.',
  },
  {
    id: 'tf-lag-05', name: 'First-order lag, τ = 0.5 s', category: 'Building blocks', form: '1/(0.5s+1)',
    numerator: [1], denominator: [0.5, 1],
    description: 'Pole at −2 rad/s (0.318 Hz). Corner frequency is where the magnitude bends.',
  },
  {
    id: 'tf-2nd-10-03', name: 'Underdamped pair, ωn = 10, ζ = 0.3', category: 'Resonant plants', form: '100/(s²+6s+100)',
    numerator: [100], denominator: [1, 6, 100],
    description: 'ζ from the 2ζωn = 6 term. Overshoots ≈ 37 % open loop and rings near 9.6 rad/s.',
  },
  {
    id: 'tf-2nd-20-07', name: 'Damped pair, ωn = 20, ζ = 0.7', category: 'Resonant plants', form: '400/(s²+28s+400)',
    numerator: [400], denominator: [1, 28, 400],
    description: 'The well-behaved case: ≈ 4.6 % overshoot, settling near 0.23 s at the 2 % band.',
  },
  {
    id: 'tf-lead', name: 'Lead network, a = 10, T = 0.1 s', category: 'Compensators', form: '(s+10)/(s+1)',
    numerator: [1, 1], denominator: [0.1, 1],
    description: 'Zero at 1 rad/s, pole at 10 rad/s. Adds up to 55° of phase between them.',
  },
  {
    id: 'tf-lag-net', name: 'Lag network, β = 10, T = 0.5 s', category: 'Compensators', form: '(s+2)/(s+0.2)',
    numerator: [0.5, 1], denominator: [5, 1],
    description: 'Pole at 0.2, zero at 2 rad/s. Raises low-frequency gain without hurting the crossover much.',
  },
  {
    id: 'tf-real-derivative', name: 'Practical derivative, τ = 0.01 s', category: 'Compensators', form: '0.01s/(0.01s+1)',
    numerator: [0.01, 0], denominator: [0.01, 1],
    description: 'A pure differentiator amplifies noise, so the useful form rolls off above 100 rad/s.',
  },
  {
    id: 'tf-motor-plant', name: 'DC servo plant, K/(s(τs+1))', category: 'Plants from machines', form: '4/(s(0.5s+1))',
    numerator: [4], denominator: [0.5, 1, 0],
    description: 'Rotor inertia plus viscous friction. Matches the DC presets in the machines library.',
  },
  {
    id: 'tf-delay-pade', name: 'Dead time 0.2 s, 2/2 Padé', category: 'Plants from machines', form: '(1 − s/10 + s²/300)/(1 + s/10 + s²/300)',
    numerator: [1 / 300, -1 / 10, 1], denominator: [1 / 300, 1 / 10, 1],
    description:
      'e^(−0.2s) approximated by a [2/2] Padé, which is what this solver can integrate. A right-half-plane zero appears, and it limits achievable bandwidth.',
  },
]

export function controlCatalog(): LibraryItemOf<'tf-block'>[] {
  return CONTROL_BLOCKS.map(block => ({
    id: block.id,
    kind: 'tf-block' as const,
    name: block.name,
    category: block.category,
    spec: block.form,
    description: block.description,
    tags: ['control', 'transfer-function'],
    payload: { numerator: block.numerator, denominator: block.denominator, form: block.form },
  }))
}

/* ------------------------------------------------------------------ *
 * RF: link-budget elements
 * ------------------------------------------------------------------ */

/**
 * The single-hop budget exposes antenna gains, transmit/receive feed loss, a
 * receiver noise figure and an "additional loss" bucket. Each row therefore
 * names the one input it writes, and the panel reports it. Values are published
 * or typical figures for the class of part, not measured on your build.
 */
const RF_ELEMENTS: Array<{
  id: string
  name: string
  category: string
  spec: string
  role: 'antenna' | 'lna' | 'cable' | 'attenuator' | 'filter'
  valueDb: number
  side?: 'rx' | 'tx'
  description: string
  tags: string[]
}> = [
  {
    id: 'rf-patch-2450', name: 'Patch antenna, 2.45 GHz', category: 'Antennas', spec: '+6 dBi',
    role: 'antenna', valueDb: 6, side: 'rx',
    description: 'Typical single-element microstrip patch broadside gain. Design your own on the Antenna tab for a real value.',
    tags: ['antenna', 'wifi', '2.4ghz'],
  },
  {
    id: 'rf-helio-146', name: '4-turn helix, 146 MHz', category: 'Antennas', spec: '+10 dBi',
    role: 'antenna', valueDb: 10, side: 'tx',
    description: 'Circular-polarisation axial-mode helix, gain from the classic 12° half-power relation. Transmit side.',
    tags: ['antenna', 'vhf', 'circular'],
  },
  {
    id: 'rf-lmr400-10m', name: 'Coax feed, 10 m LMR-400 at 2.4 GHz', category: 'Feeds and loss', spec: '−1.6 dB',
    role: 'cable', valueDb: 1.6, side: 'rx',
    description: 'Published attenuation ≈ 4.9 dB per 100 ft at 2.4 GHz, scaled to 10 m. Receive feed loss.',
    tags: ['cable', 'loss', 'feedline'],
  },
  {
    id: 'rf-sma-pair', name: 'SMA mated pair', category: 'Feeds and loss', spec: '−0.1 dB',
    role: 'cable', valueDb: 0.1, side: 'tx',
    description: 'Typical connector insertion loss to a few GHz. Transmit side.',
    tags: ['connector', 'loss'],
  },
  {
    id: 'rf-lna-sige', name: 'SiGe LNA front end', category: 'Receiver', spec: '1.5 dB NF',
    role: 'lna', valueDb: 1.5,
    description: 'Sets the receiver noise figure. The budget models one NF at the receiver, not a cascade.',
    tags: ['lna', 'noise', 'receiver'],
  },
  {
    id: 'rf-lna-cold', name: 'Cryogenic-grade low-NF front end', category: 'Receiver', spec: '0.4 dB NF',
    role: 'lna', valueDb: 0.4,
    description: 'Best-case receiver figure; useful to see how much margin the noise floor actually costs.',
    tags: ['lna', 'noise', 'receiver'],
  },
  {
    id: 'rf-pad-10', name: 'Fixed 10 dB attenuator pad', category: 'Feeds and loss', spec: '−10 dB',
    role: 'attenuator', valueDb: 10,
    description: 'Writes the "additional loss" term (body, foliage, clutter or a deliberate pad).',
    tags: ['attenuator', 'pad', 'loss'],
  },
  {
    id: 'rf-filter-il', name: 'LC band filter insertion loss', category: 'Receiver', spec: '−1.5 dB',
    role: 'filter', valueDb: 1.5, side: 'rx',
    description: 'Typical passband loss for a 5th-order LC filter. Receive feed loss term.',
    tags: ['filter', 'insertion-loss'],
  },
]

export function rfCatalog(): LibraryItemOf<'rf-element'>[] {
  return RF_ELEMENTS.map(element => ({
    id: element.id,
    kind: 'rf-element' as const,
    name: element.name,
    category: element.category,
    spec: element.spec,
    description: element.description,
    tags: element.tags,
    payload: {
      role: element.role,
      valueDb: element.valueDb,
      ...(element.side ? { side: element.side } : {}),
      note: element.description,
    },
  }))
}

/* ------------------------------------------------------------------ *
 * Power grid: buses, branches and feeder nodes
 * ------------------------------------------------------------------ */

const GRID_ITEMS: Array<{
  id: string
  name: string
  category: string
  spec: string
  description: string
  role: 'bus' | 'branch' | 'feeder-node'
  bus?: PowerBus
  branch?: Omit<PowerBranch, 'id'>
  feederNode?: FeederNode
  /** Feeder sections carry the conductor that joins the node it drops behind. */
  section?: { resistanceOhm: number; reactanceOhm: number; lengthKm: number }
}> = [
  {
    id: 'grid-bus-slack-132', name: 'Slack bus, 132 kV', category: 'Transmission buses', spec: 'slack · 132 kV',
    role: 'bus',
    description: 'Angle reference and automatic imbalance carrier. Exactly one slack per case or the solver says so.',
    bus: { id: 'slack-132', name: 'Slack 132 kV', type: 'slack', baseKv: 132, voltageSetpointPu: 1 },
  },
  {
    id: 'grid-bus-pv-33', name: 'Generation bus, 33 kV / 20 MW', category: 'Transmission buses', spec: 'pv · 20 MW',
    role: 'bus',
    description: 'PV bus scheduled at 20 MW and 1.00 pu, with the reactive limits a real machine unit needs.',
    bus: {
      id: 'gen-33', name: 'Gen 33 kV', type: 'pv', baseKv: 33, generationMw: 20,
      voltageSetpointPu: 1, reactiveMinMvar: -12, reactiveMaxMvar: 12,
    },
  },
  {
    id: 'grid-bus-pq-11', name: 'Load bus, 11 kV / 5 MW', category: 'Transmission buses', spec: 'pq · 5 MW + 1 Mvar',
    role: 'bus',
    description: 'Fixed consumption at 0.98 power factor. The most common bus in a study.',
    bus: { id: 'load-11', name: 'Load 11 kV', type: 'pq', baseKv: 11, loadMw: 5, loadMvar: 1 },
  },
  {
    id: 'grid-bus-cap', name: 'Capacitor bank bus, 11 kV', category: 'Transmission buses', spec: 'pq · +2 Mvar',
    role: 'bus',
    description: 'Shunt capacitive susceptance at 1 pu, i.e. a bank that supplies 2 Mvar and lifts its own node.',
    bus: { id: 'cap-11', name: 'Cap bank 11 kV', type: 'pq', baseKv: 11, shuntMvar: 2 },
  },
  {
    id: 'grid-line-3km', name: 'Overhead line, 3 km', category: 'Branches', spec: '0.9 + j1.2 Ω',
    role: 'branch',
    description:
      '11 kV conductor at ≈ 0.3 + j0.4 Ω/km for 3 km. Ohms only work between buses of the same base kV, so this joins the two 11 kV buses.',
    branch: { from: 'load-11', to: 'cap-11', resistanceOhm: 0.9, reactanceOhm: 1.2, ratingMva: 8 },
  },
  {
    id: 'grid-xfmr-132-33', name: 'Power transformer 132/33 kV', category: 'Branches', spec: '100 MVA · Z 12.5 %',
    role: 'branch',
    description:
      'Series impedance in per unit, because ohms have no single base across windings. Each bus keeps its own base kV, so the 132/33 ratio is already in the per-unit system and this changer is on its nominal tap.',
    branch: {
      from: 'slack-132', to: 'gen-33',
      seriesImpedancePu: { resistance: 0.005, reactance: 0.125 },
      tapRatio: 1, ratingMva: 100, chargingMvar: 2,
    },
  },
  {
    id: 'grid-xfmr-33-11', name: 'Distribution transformer 33/11 kV', category: 'Branches', spec: '40 MVA · Z 10 % · −5 % tap',
    role: 'branch',
    description:
      'The substation transformer that reaches the 11 kV buses from the 33 kV level: 0.1 pu on its 40 MVA nameplate is 0.25 pu on this study\'s 100 MVA base. The tap is one position below nominal, which lifts the whole 11 kV side by about 5 %.',
    branch: {
      from: 'gen-33', to: 'load-11',
      seriesImpedancePu: { resistance: 0.01, reactance: 0.25 },
      tapRatio: 0.95, ratingMva: 40,
    },
  },
  {
    id: 'grid-feeder-100kw', name: 'Distribution node, 100 kW', category: 'Feeder nodes', spec: '100 kW + 30 kvar',
    role: 'feeder-node',
    description: 'A rural/urban DP on the radial feeder, dropped behind the last node through 400 m of conductor.',
    feederNode: { id: 'dp-100', loadKw: 100, loadKvar: 30 },
    section: { resistanceOhm: 0.12, reactanceOhm: 0.11, lengthKm: 0.4 },
  },
  {
    id: 'grid-feeder-25kw', name: 'Distribution node, 25 kW', category: 'Feeder nodes', spec: '25 kW + 8 kvar',
    role: 'feeder-node',
    description: 'A small service point, the load that usually decides the end-of-feeder voltage.',
    feederNode: { id: 'dp-25', loadKw: 25, loadKvar: 8 },
    section: { resistanceOhm: 0.15, reactanceOhm: 0.13, lengthKm: 0.5 },
  },
  {
    id: 'grid-feeder-pv5', name: 'Rooftop PV node, 5 kW', category: 'Feeder nodes', spec: '−5 kW injection',
    role: 'feeder-node',
    description: 'Generation at the end of a lightly loaded feeder — the case that raises feeder voltage above nominal. The inverter injects 5 kW and 0.5 kvar, so its power factor is leading.',
    feederNode: { id: 'pv-5', generationKw: 5, generationKvar: 0.5 },
    section: { resistanceOhm: 0.18, reactanceOhm: 0.15, lengthKm: 0.6 },
  },
]

export function gridCatalog(): LibraryItemOf<'grid-element'>[] {
  return GRID_ITEMS.map(item => ({
    id: item.id,
    kind: 'grid-element' as const,
    name: item.name,
    category: item.category,
    spec: item.spec,
    description: item.description,
    tags: ['power', item.role],
    payload: {
      role: item.role,
      ...(item.bus ? { bus: item.bus } : {}),
      ...(item.branch ? { branch: item.branch } : {}),
      ...(item.feederNode ? { feederNode: item.feederNode } : {}),
      ...(item.section ? { section: item.section } : {}),
    },
  }))
}

/* ------------------------------------------------------------------ *
 * Robotics: architectures the solver accepts
 * ------------------------------------------------------------------ */

export function robotCatalog(): LibraryItemOf<'robot-element'>[] {
  return ROBOT_ARCHITECTURES.map(architecture => ({
    id: `robot-${architecture.id}`,
    kind: 'robot-element' as const,
    name: architecture.name,
    category: architecture.category,
    spec: architecture.spec,
    description: architecture.description,
    tags: [...architecture.tags, 'robot'],
    payload: { architecture: architecture.id },
  }))
}

/* ------------------------------------------------------------------ *
 * Code: snippets the app's own parsers accept
 * ------------------------------------------------------------------ */

const SNIPPETS: Array<{
  id: string
  name: string
  category: string
  language: 'verilog' | 'systemverilog' | 'vhdl' | 'c' | 'cpp'
  spec: string
  description: string
  text: string
}> = [
  {
    id: 'hdl-mux2',
    name: '2-input mux (structural)',
    category: 'Verilog',
    language: 'verilog',
    spec: 'gate level',
    description: 'Structural Verilog in the subset the FPGA elaborator parses: gates, wires and assigns only.',
    text: `// 2:1 multiplexer, structural
module mux2 (input a, input b, input sel, output y);
  wire not_sel, sa, sb;
  not (not_sel, sel);
  and (sa, a, not_sel);
  and (sb, b, sel);
  or  (y, sa, sb);
endmodule
`,
  },
  {
    id: 'hdl-dff',
    name: 'D flip-flop with reset',
    category: 'Verilog',
    language: 'verilog',
    spec: 'gate level',
    description: 'Two cross-coupled NANDs — the same structural style the netlist runs.',
    text: `// Gated D latch built from NANDs
module dff (input d, input clk, input rst_n, output q, output q_n);
  wire g1, g2;
  nand (g1, d, clk);
  nand (g2, g1, rst_n);
  nand (q, g2, q_n);
  nand (q_n, g2, q);
endmodule
`,
  },
  {
    id: 'hdl-acc-cpu',
    name: '8-bit accumulator CPU',
    category: 'Verilog',
    language: 'verilog',
    spec: 'clocked RTL',
    description: 'Buses, expression logic, a ripple-carry ALU and an inferred DFF register. Simulates and synthesises to SKY130.',
    text: ACC_CPU_VERILOG,
  },
  {
    id: 'hdl-fir-dsp',
    name: '4-tap FIR filter (DSP)',
    category: 'Verilog',
    language: 'verilog',
    spec: 'clocked datapath',
    description: 'A three-register delay line and a 12-bit weighted adder tree (1, 2, 2, 1). Uses + and −, simulates, and maps to SKY130 DFFs.',
    text: FIR_DSP_VERILOG,
  },
  {
    id: 'hdl-full-adder-vhdl',
    name: 'Full adder (structural)',
    category: 'VHDL',
    language: 'vhdl',
    spec: 'port map',
    description: 'VHDL entity plus a structural architecture using the and2/xor2 cells the parser knows.',
    text: `-- 1-bit full adder, structural
entity full_adder is
  port (
    a, b, cin : in  std_logic;
    sum, cout : out std_logic
  );
end entity;

architecture struct of full_adder is
  signal w1, w2 : std_logic;
begin
  u1 : xor2 port map (sum, a, b);
  u2 : and2 port map (w1, a, b);
  u3 : and2 port map (w2, w1, cin);
  u4 : or2  port map (cout, w1, w2);
end architecture;
`,
  },
  {
    id: 'fw-arduino-blink',
    name: 'Arduino blink loop',
    category: 'Firmware',
    language: 'c',
    spec: 'setup + loop',
    description: 'The static analyser requires setup() and loop(); this is the shortest program that passes.',
    text: `// Turn an LED on PB5 (Arduino Uno pin 13) over at 2 Hz.
void setup() {
  pinMode(13, OUTPUT);
}

void loop() {
  digitalWrite(13, HIGH);
  delay(500);
  digitalWrite(13, LOW);
  delay(500);
}
`,
  },
  {
    id: 'fw-esp32-pwm',
    name: 'ESP32 PWM fade',
    category: 'Firmware',
    language: 'cpp',
    spec: 'ledc fade',
    description: 'ESP32 target template: LEDC timer, channel and a fade step per loop pass.',
    text: `// 5 kHz LEDC on GPIO17, one fade step per loop pass.
const int PWM_PIN = 17;

void setup() {
  ledcSetup(0, 5000, 8);
  ledcAttachPin(PWM_PIN, 0);
  ledcWrite(0, 0);
}

void loop() {
  static uint8_t duty = 0;
  duty += 8;
  ledcWrite(0, duty);
  delay(20);
}
`,
  },
]

export function snippetCatalog(): LibraryItemOf<'snippet'>[] {
  return SNIPPETS.map(snippet => ({
    id: snippet.id,
    kind: 'snippet' as const,
    name: snippet.name,
    category: snippet.category,
    spec: snippet.spec,
    description: snippet.description,
    tags: ['code', snippet.language],
    payload: { language: snippet.language, text: snippet.text },
  }))
}

/** Every snippet's source, for the test that proves the app parses what it offers. */
export function snippetSources(): Array<{ id: string; language: string; text: string }> {
  return SNIPPETS.map(s => ({ id: s.id, language: s.language, text: s.text }))
}
