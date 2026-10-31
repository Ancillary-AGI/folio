/**
 * Showcase board: a 90 x 68 mm 5 V / 3.3 V controller board on a four-layer
 * stackup.
 *
 * The rectifier demo proves the solver chain on a six-part sheet. This one
 * exists to show what the layout side of the tool actually draws: real
 * package footprints (screw terminal, D2PAK buck, shielded inductor, SOT-223
 * LDO, TQFP-32 MCU, 3225 crystal, chip LEDs, tact switch, pin headers, M3
 * mounting holes), ground and 3.3 V planes poured on the buried copper, and
 * signal copper produced by the same A* autorouter the PCB workspace uses.
 * Nothing here is hand-drawn geometry: the traces, vias, anti-pads and
 * completion numbers in `summary` are the router's own output, including any
 * net it fails to finish.
 *
 * The construction itself lives in `../pcb/planeBoard`, shared with the laptop
 * mainboard demo, so both boards are proven by the same validated path.
 */
import type { RouterConfig } from '../manufacturing/autorouter'
import type { PcbSceneInput } from '../pcb/pcbScene'
import type { PlaneBoardPart, PlaneBoardPour, PlaneBoardResult, PlaneBoardSpec } from '../pcb/planeBoard'
import type { DRCResult } from '../manufacturing/drc'
import { buildPlaneBoard, planeBoardDrc } from '../pcb/planeBoard'

export const SHOWCASE_BOARD = {
  widthMm: 90,
  heightMm: 68,
  thicknessMm: 1.6,
  copperThicknessMm: 0.035,
} as const

/**
 * Placement is the reason this board routes at all.
 *
 * The power path runs along the top, the LDO feeds the buried 3.3 V plane from
 * the middle, and the MCU sits at the bottom with its pins assigned to the
 * package side their net actually leaves from — crystals and expansion UART on
 * the left, the LED bundle and SWD to the right, reset and the user button out
 * of the bottom corners. The channel from x 53 to x 66 below the buck is
 * deliberately empty: it is where the MCU's right-hand fan-out escapes, and a
 * plated part parked in it (a switch, a header) walls off both copper layers at
 * once because a barrel passes the whole stackup.
 */
const PARTS: PlaneBoardPart[] = [
  // ── Power entry and reverse-polarity protection
  { ref: 'J1', footprint: 'term_508_2', value: '12 V in', x: 15, y: 13, nets: ['VIN', 'GND'], color: '#1d4ed8' },
  { ref: 'D1', footprint: 'smc_do214ab', value: 'SS54', x: 26, y: 13, nets: ['VIN', 'VBUS'] },
  { ref: 'C1', footprint: 'cap_elec_63', value: '220 uF', x: 37, y: 13, nets: ['VBUS', 'GND'], color: '#153a72' },
  { ref: 'C2', footprint: 'cap_1210', value: '10 uF', x: 45, y: 10, rotationDeg: 90, nets: ['VBUS', 'GND'] },
  { ref: 'R1', footprint: 'res_0603', value: '100 k', x: 50, y: 7, nets: ['VBUS', 'EN'] },

  // ── Buck converter
  { ref: 'U1', footprint: 'd2pak_5', value: 'LM2596-5.0', x: 57, y: 14, nets: ['VBUS', 'GND', 'SW', 'EN', 'FB', 'SW'] },
  { ref: 'L1', footprint: 'ind_6x6', value: '33 uH', x: 68, y: 13, nets: ['SW', 'V5'] },
  { ref: 'D2', footprint: 'smc_do214ab', value: 'SS34', x: 62, y: 24, rotationDeg: 90, nets: ['GND', 'SW'] },
  { ref: 'C3', footprint: 'cap_1210', value: '22 uF', x: 79, y: 9, nets: ['V5', 'GND'] },
  { ref: 'C4', footprint: 'cap_0805', value: '10 uF', x: 84, y: 17, rotationDeg: 90, nets: ['V5', 'GND'] },
  { ref: 'R2', footprint: 'res_0603', value: '20 k', x: 76, y: 32, nets: ['FB', 'GND'] },
  { ref: 'R3', footprint: 'res_0603', value: '36 k', x: 76, y: 26, rotationDeg: 90, nets: ['V5', 'FB'] },

  // ── 3.3 V LDO: input faces the buck, output and tab land on the V3 plane
  { ref: 'U2', footprint: 'sot_223', value: 'AMS1117-3.3', x: 46, y: 26, rotationDeg: 180, nets: ['GND', 'V3', 'V5', 'V3', 'V3'] },
  { ref: 'C5', footprint: 'cap_0805', value: '10 uF', x: 53, y: 30, rotationDeg: 90, nets: ['V5', 'GND'] },
  { ref: 'C6', footprint: 'cap_0805', value: '10 uF', x: 42, y: 22, rotationDeg: 90, nets: ['V3', 'GND'] },

  // ── Microcontroller: each pin is on the package side its net leaves from
  { ref: 'U3', footprint: 'qfp_32', value: 'MCU QFP-32', x: 48, y: 50, nets: [
    // 1-8, top edge (the corner pair carries SWO out to the debug header)
    'V3', 'V3', 'GND', 'SWO', '', 'GND', 'V3', 'GND',
    // 9-16, right edge: SWD pair, then the four status LEDs
    'GND', 'V3', 'SWDIO', 'SWCLK', 'LED1', 'LED2', 'LED3', 'LED4',
    // 17-24, bottom edge: key input, reset, reference decoupling
    'GND', 'V3', 'KEY', 'GND', 'NRST', 'VREF', 'GND', 'V3',
    // 25-32, left edge: clock pair, UART, analog input
    'GND', 'V3', 'TX', 'RX', 'ADC', 'V3', 'XIN', 'XOUT',
  ] },
  { ref: 'Y1', footprint: 'xtal_3225', value: '8 MHz', x: 31, y: 46, nets: ['XIN', 'GND', 'XOUT', 'GND'] },
  { ref: 'C7', footprint: 'cap_0603', value: '18 pF', x: 26, y: 42, nets: ['XIN', 'GND'] },
  { ref: 'C8', footprint: 'cap_0603', value: '18 pF', x: 26, y: 50, nets: ['XOUT', 'GND'] },
  { ref: 'R4', footprint: 'res_0603', value: '10 k', x: 58, y: 56, nets: ['NRST', 'V3'] },
  { ref: 'C9', footprint: 'cap_0603', value: '100 nF', x: 42, y: 56, rotationDeg: 90, nets: ['VREF', 'GND'] },
  { ref: 'C10', footprint: 'cap_0402', value: '100 nF', x: 44, y: 45, rotationDeg: 90, nets: ['V3', 'GND'] },
  { ref: 'C11', footprint: 'cap_0402', value: '100 nF', x: 53, y: 45, nets: ['V3', 'GND'] },
  { ref: 'C12', footprint: 'cap_0402', value: '100 nF', x: 44, y: 55, nets: ['V3', 'GND'] },
  { ref: 'C13', footprint: 'cap_0402', value: '100 nF', x: 53, y: 55, rotationDeg: 90, nets: ['V3', 'GND'] },
  { ref: 'R11', footprint: 'res_0603', value: '10 k', x: 36, y: 54, rotationDeg: 90, nets: ['V5', 'ADC'] },
  { ref: 'R12', footprint: 'res_0603', value: '10 k', x: 32, y: 58, rotationDeg: 90, nets: ['ADC', 'GND'] },

  // ── User I/O: every LED is in series with its own 1 k, so the rail-to-cathode
  //    path a viewer sees is the path a builder would solder.
  { ref: 'R5', footprint: 'res_0603', value: '1 k', x: 68, y: 24, nets: ['V3', 'PWR_K'] },
  { ref: 'D3', footprint: 'led_0805', value: 'PWR green', x: 80, y: 24, rotationDeg: 90, nets: ['PWR_K', 'GND'], color: '#22c55e' },
  { ref: 'R6', footprint: 'res_0603', value: '1 k', x: 68, y: 31, nets: ['LED1', 'LED1_K'] },
  { ref: 'D4', footprint: 'led_0805', value: 'STAT blue', x: 80, y: 31, rotationDeg: 90, nets: ['LED1_K', 'GND'], color: '#3b82f6' },
  { ref: 'R7', footprint: 'res_0603', value: '1 k', x: 68, y: 38, nets: ['LED2', 'LED2_K'] },
  { ref: 'D5', footprint: 'led_0805', value: 'RX amber', x: 80, y: 38, rotationDeg: 90, nets: ['LED2_K', 'GND'], color: '#f59e0b' },
  { ref: 'R8', footprint: 'res_0603', value: '1 k', x: 68, y: 45, nets: ['LED3', 'LED3_K'] },
  { ref: 'D6', footprint: 'led_0805', value: 'TX white', x: 80, y: 45, rotationDeg: 90, nets: ['LED3_K', 'GND'], color: '#e8f3ff' },
  { ref: 'R9', footprint: 'res_0603', value: '1 k', x: 68, y: 52, nets: ['LED4', 'LED4_K'] },
  { ref: 'D7', footprint: 'led_0805', value: 'USR pink', x: 80, y: 52, rotationDeg: 90, nets: ['LED4_K', 'GND'], color: '#ec4899' },
  { ref: 'R10', footprint: 'res_0603', value: '10 k', x: 44, y: 58, rotationDeg: 90, nets: ['KEY', 'V3'] },
  { ref: 'SW1', footprint: 'tact_6x6', value: 'RESET', x: 54, y: 62, nets: ['NRST', 'NRST', 'GND', 'GND'] },
  { ref: 'SW2', footprint: 'tact_6x6', value: 'USER', x: 38, y: 62, nets: ['KEY', 'KEY', 'GND', 'GND'] },
  { ref: 'J2', footprint: 'header_1x6', value: 'EXPANSION', x: 20, y: 62, rotationDeg: 90, nets: ['V3', 'GND', 'TX', 'RX', 'ADC', 'GND'] },
  { ref: 'J3', footprint: 'header_2x3', value: 'DEBUG', x: 66, y: 63, nets: ['V3', 'SWDIO', 'SWCLK', 'GND', 'GND', 'SWO'] },

  // ── Board fixings: copper ring, no net, no body
  { ref: 'MH1', footprint: 'mount_m3', value: 'M3', x: 4.5, y: 4.5, nets: [] },
  { ref: 'MH2', footprint: 'mount_m3', value: 'M3', x: 85.5, y: 4.5, nets: [] },
  { ref: 'MH3', footprint: 'mount_m3', value: 'M3', x: 4.5, y: 63.5, nets: [] },
  { ref: 'MH4', footprint: 'mount_m3', value: 'M3', x: 85.5, y: 63.5, nets: [] },
]

export interface ShowcasePcb {
  board: typeof SHOWCASE_BOARD
  scene: PcbSceneInput
  summary: PlaneBoardResult['summary']
  /** Every land the board prints, plane lands included, so a checker can audit the copper. */
  lands: PlaneBoardResult['lands']
  /**
   * The lands as the router saw them — positions, layers, plating. The editor's
   * flyline solve takes exactly this, so carrying it lets a test check the panel's
   * "what still needs routing" against what the router actually left open.
   */
  pads: PlaneBoardResult['pads']
  /**
   * The routed copper audited by `DesignRuleChecker` at this board's own rules.
   * Measured when the board is built, so a claim of "DRC clean" is a reading
   * rather than an assertion.
   */
  drc: DRCResult
}

/**
 * Nets the demo carries on poured plane copper instead of routed traces.
 *
 * This is the stackup a real four-layer board uses — signal, ground plane,
 * power plane, signal — and it is why the autorouter can finish this board at
 * all: 0.25 mm traces do not carry a rail that 40 lands draw from. The router
 * still sees two routing layers (F.Cu, B.Cu); the plane layers are declared as
 * pours, and every surface land on a plane net reaches its plane through a
 * plated stitch via of its own net.
 */
const PLANE_NETS = new Set(['GND', 'V3'])
/**
 * The plane nets and the buried copper each is poured on. Both are inner
 * layers, so no surface land touches them directly — every plane connection is
 * a plated barrel, and the barrels of the *other* net are the anti-pads the
 * pour has to clear.
 */
const POURS: PlaneBoardPour[] = [
  { net: 'GND', layerId: 'in1-cu', side: 'inner' },
  { net: 'V3', layerId: 'in2-cu', side: 'inner' },
]
/** Keep-in distance from the board outline for every pour. */
const POUR_MARGIN_MM = 1.2
/** Minimum spacing the demo demands between two parts' copper. */
const LAND_GAP_MM = 0.3
/** Clearance the plane keeps from copper that is not its own net. */
const PLANE_CLEARANCE_MM = 0.3

const CONFIG: RouterConfig = {
  boardWidthMm: SHOWCASE_BOARD.widthMm,
  boardHeightMm: SHOWCASE_BOARD.heightMm,
  layers: ['F.Cu', 'B.Cu'],
  // 0.3 mm cells resolve the 0.8 mm QFP pitch into two clear escape lanes per
  // land, which is what the fine-pitch fan-out needs. Measured on this netlist:
  // 0.4 mm still closes all 26, 0.5 mm loses five, so the grid — not the rules —
  // is what bounds the escape. Still ~100 ms of search; `demoShowcase.test.ts`
  // sweeps it.
  gridMm: 0.3,
  // 0.2 / 0.15 mm is the ordinary signal rule for a prototype four-layer fab.
  minTraceWidthMm: 0.2,
  minSpacingMm: 0.15,
  viaDrillMm: 0.3,
  viaPadMm: 0.6,
  viaPenalty: 6,
}

/**
 * A stitch ring sized to its own land: 0.62 of the copper, which is what a
 * plated hole needs to sit inside the land it joins. The board then caps it at
 * its own via and cuts it to whatever the copper next door leaves — the 0.55 mm
 * floor this used to insist on is wider than the gap between two 0.4 mm-pitch
 * lands, and 51 of these printed straight over their neighbours.
 */
function stitchPadFor(land: { widthMm: number, depthMm: number }): number {
  return Math.min(land.widthMm, land.depthMm) * 0.62
}

const LAYERS: PcbSceneInput['layers'] = [
  { id: 'top-cu', name: 'Top Copper', kind: 'copper', color: '#cc0000', side: 'top' },
  { id: 'in1-cu', name: 'Ground Plane', kind: 'copper', color: '#ffaa00', net: 'GND' },
  { id: 'in2-cu', name: '3.3 V Plane', kind: 'copper', color: '#7a4fd3', net: 'V3' },
  { id: 'bot-cu', name: 'Bottom Copper', kind: 'copper', color: '#ff6a00', side: 'bottom' },
  { id: 'top-silk', name: 'Top Silkscreen', kind: 'silk', color: '#ffffff', side: 'top' },
  { id: 'top-mask', name: 'Top Soldermask', kind: 'mask', color: '#008800', side: 'top' },
  { id: 'bot-mask', name: 'Bottom Soldermask', kind: 'mask', color: '#004400', side: 'bottom' },
]

/**
 * Exported so `demoShowcase.test.ts` can re-run the same netlist at a different
 * cell size. The `gridMm` comment above makes a measured claim about what a coarser
 * grid does to this board, and a claim about a solver belongs in a test.
 */
export const SHOWCASE_SPEC: PlaneBoardSpec = {
  name: 'Showcase board',
  idPrefix: 'showcase',
  board: SHOWCASE_BOARD,
  parts: PARTS,
  planeNets: PLANE_NETS,
  pours: POURS,
  router: CONFIG,
  layers: LAYERS,
  pourMarginMm: POUR_MARGIN_MM,
  landGapMm: LAND_GAP_MM,
  planeClearanceMm: PLANE_CLEARANCE_MM,
  stitchPadFor,
  stitchVia: { drillMm: 0.1, minAnnularRingMm: 0.05 },
}

let cached: ShowcasePcb | null = null

export function buildShowcasePcb(): ShowcasePcb {
  if (cached) return cached
  const { scene, summary, lands, pads } = buildPlaneBoard(SHOWCASE_SPEC)
  cached = { board: SHOWCASE_BOARD, scene, summary, lands, pads, drc: planeBoardDrc(SHOWCASE_SPEC, scene, lands) }
  return cached
}
