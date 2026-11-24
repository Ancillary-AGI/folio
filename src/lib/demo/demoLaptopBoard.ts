/**
 * Laptop mainboard demo: a 245 x 90 mm portable-computer board on an eight-copper
 * stackup (14-inch class outline).
 *
 * This is the layout side of the tool shown at the scale a modern computer is
 * really built: a BGA SoC with its supplies under the die, two BGA memory
 * devices, an embedded controller, SPI BIOS flash, two buck regulators and an
 * LDO sized by the power library, a USB-C power entry with its CC resistors, an
 * M.2 2280 SSD socket, an eDP panel header, keyboard and trackpad headers, a
 * debug header, a coin-cell RTC holder, power and charge LEDs, and six plated
 * mounting holes.
 *
 * What is real here, and what is not:
 *
 * - Every land comes from `footprintLibrary`. The SoC and memory ball maps come
 *   from the perimeter-signal template in `socPackages`, which is the geometry a
 *   two-layer router can actually escape: signal on the outer ring, rails and
 *   return in the core where the poured planes reach them.
 * - The rails (VBAT, V3V3, V1V0, GND) are declared as inner-film pours with anti-pad
 *   keepouts drawn from the barrels that cross them, and every surface land on a
 *   rail is stitched to its plane with a plated via of its own net.
 * - The signal copper is the output of the same A* autorouter the PCB workspace
 *   runs, at the rules declared below. Its rip-up-and-reroute pass is measured off
 *   on this board (`ripUpPasses: 0` below says why): every net the greedy order
 *   misses here is walled in by neighbouring lands, which lifting copper cannot
 *   move, so the extra sweeps only cost time. Rip-up stays on by default for every
 *   other board and `autorouter.test.ts` exercises it there. What this copper is
 *   not: single-ended Manhattan traces with no differential pairing, no length
 *   matching and no impedance control. A production board routes the USB and PCIe
 *   pairs as coupled differential traces on controlled impedance; here each half
 *   of a pair is an ordinary net, and `summary.unrouted` says exactly which nets
 *   this router could not finish. Nothing in this file claims more than that
 *   number, and `demoLaptopBoard.test.ts` re-measures it.
 * - Part values are the demo's own: the buck inductors, duties and output
 *   capacitances are computed by `calculateBuckConverter` and the feedback
 *   dividers by `feedbackPair` below, so the numbers printed on the board are
 *   the ones the tool derives for the declared rail, load and switching
 *   frequency rather than figures typed in by hand.
 */
import type { PcbSceneInput } from '../pcb/pcbScene'
import type { PlaneBoardPart, PlaneBoardPour, PlaneBoardResult, PlaneBoardSpec } from '../pcb/planeBoard'
import type { DRCResult } from '../manufacturing/drc'
import type { RouterConfig } from '../manufacturing/autorouter'
import type { PerimeterSignalPlan } from '../electronics/socPackages'
import { padNets, perimeterSignalPackage, validateBallMap } from '../electronics/socPackages'
import { calculateBuckConverter } from '../electronics/powerSources'
import { resolveFootprint } from '../manufacturing/footprintLibrary'
import { buildPlaneBoard, planeBoardDrc } from '../pcb/planeBoard'

export const LAPTOP_BOARD = {
  widthMm: 245,
  heightMm: 90,
  thicknessMm: 1.6,
  copperThicknessMm: 0.035,
} as const

/** Keep-in from the outline, and the spacing this layout demands of its copper. */
const POUR_MARGIN_MM = 1.5
const LAND_GAP_MM = 0.3
const PLANE_CLEARANCE_MM = 0.3
/**
 * The autorouter's own rules. 0.2 / 0.15 mm is the ordinary signal rule a
 * prototype fab prints without argument. The cell has to be at least as fine as
 * the spacing rule the board claims: a routed cell blocks its neighbours by
 * `ceil((spacing + width/2) / gridMm)` cells, so a 0.4 mm cell inflates a 0.35 mm
 * legal gap into a 0.8 mm one and seals the 0.8 mm-pitch escape lanes shut. At
 * 0.25 mm the claim rounds to one cell either side and the corridors a real
 * board uses stay open — still ~1 s of search, not a minute.
 */
const ROUTER_RULES = {
  gridMm: 0.25,
  minTraceWidthMm: 0.2,
  minSpacingMm: 0.15,
  viaDrillMm: 0.3,
  viaPadMm: 0.6,
  viaPenalty: 6,
}

/**
 * The rails this board carries on poured copper. No 0.2 mm signal trace pretends
 * to be a 10 A path: the battery input, the protected bus rail, the 5 V bus, the
 * 3.3 V and core rails and ground all get a film of their own, and every surface
 * land on one of them reaches it through a plated stitch via.
 */
export const LAPTOP_PLANE_NETS = new Set(['GND', 'VBAT', 'VBUS_PROT', 'V5', 'V3V3', 'V1V0'])

const POURS: PlaneBoardPour[] = [
  { net: 'GND', layerId: 'in1-cu', side: 'inner' },
  { net: 'VBAT', layerId: 'in2-cu', side: 'inner' },
  { net: 'VBUS_PROT', layerId: 'in3-cu', side: 'inner' },
  { net: 'V3V3', layerId: 'in4-cu', side: 'inner' },
  { net: 'V1V0', layerId: 'in5-cu', side: 'inner' },
  { net: 'V5', layerId: 'in6-cu', side: 'inner' },
]

const LAYERS: PcbSceneInput['layers'] = [
  { id: 'top-cu', name: 'Top Copper', kind: 'copper', color: '#cc0000', side: 'top' },
  { id: 'in1-cu', name: 'Ground Plane', kind: 'copper', color: '#ffaa00', net: 'GND' },
  { id: 'in2-cu', name: 'Battery Plane', kind: 'copper', color: '#d33b2f', net: 'VBAT' },
  { id: 'in3-cu', name: 'Protected Rail', kind: 'copper', color: '#e8734a', net: 'VBUS_PROT' },
  { id: 'in4-cu', name: '3.3 V Plane', kind: 'copper', color: '#7a4fd3', net: 'V3V3' },
  { id: 'in5-cu', name: 'Core Plane', kind: 'copper', color: '#2f86d3', net: 'V1V0' },
  { id: 'in6-cu', name: '5 V Plane', kind: 'copper', color: '#2fa36b', net: 'V5' },
  { id: 'bot-cu', name: 'Bottom Copper', kind: 'copper', color: '#ff6a00', side: 'bottom' },
  { id: 'top-silk', name: 'Top Silkscreen', kind: 'silk', color: '#ffffff', side: 'top' },
  { id: 'top-mask', name: 'Top Soldermask', kind: 'mask', color: '#008800', side: 'top' },
  { id: 'bot-mask', name: 'Bottom Soldermask', kind: 'mask', color: '#004400', side: 'bottom' },
]

// ── Power: what the regulators are set to, computed rather than typed ──────────
const V3V3_SET = calculateBuckConverter({ vinV: 11.1, voutV: 3.3, ioutA: 2, switchingFreqHz: 400_000 })
const V1V0_SET = calculateBuckConverter({ vinV: 11.1, voutV: 1.0, ioutA: 8, switchingFreqHz: 600_000 })

/**
 * The divider that programs a buck's feedback pin: with the regulator holding its
 * reference at `vrefV`, the top resistor is (Vout/Vref - 1) times the bottom one.
 * Written as a function because both rails need it and the ratio is the whole
 * reason the resistor values on the board are what they are.
 */
function feedbackPair(voutV: number, vrefV: number, rBottomOhms: number): { rTop: number, rBottom: number } {
  if (voutV <= vrefV) throw new Error(`Feedback divider: ${voutV} V out is below the ${vrefV} V reference.`)
  return { rTop: (voutV / vrefV - 1) * rBottomOhms, rBottom: rBottomOhms }
}

const V3V3_FEEDBACK = feedbackPair(3.3, 0.76, 20_000)
const V1V0_FEEDBACK = feedbackPair(1.0, 0.76, 20_000)

/**
 * The SoC's ring, in pad order: 16 balls along the top, then left and right
 * alternately down the sides, then 16 along the bottom. Its two memory devices
 * sit directly above and below, so the DDR bytes leave the top and bottom rows
 * into the rows that face them; the SPI bus escapes west to the BIOS flash, the
 * PCIe, eDP and controller interface escape east to the ports, and the crystal
 * pair leaves west too.
 */
const SOC_RING: string[] = [
  // Row 0 (faces the memory above): return, rails, then DDR byte 0-7.
  'GND', 'GND', 'V3V3', 'V3V3',
  'DDR1_0', 'DDR1_1', 'DDR1_2', 'DDR1_3', 'DDR1_4', 'DDR1_5', 'DDR1_6', 'DDR1_7',
  'V3V3', 'V3V3', 'GND', 'LID_SW',
  // Rows 1-14: west ball, east ball.
  'SPI_CLK', 'SSD_TXP', 'GND', 'GND', 'SPI_CS', 'SSD_TXN', 'V3V3', 'V1V0',
  'SPI_DQ0', 'SSD_RXP', 'GND', 'GND', 'SPI_DQ1', 'SSD_RXN', 'V3V3', 'EDP_DP0P',
  'SPI_DQ2', 'EDP_DP0N', 'GND', 'GND', 'SPI_DQ3', 'EC_SDA', 'V3V3', 'EC_SCL',
  'XIN', 'SSD_CLKP', 'XOUT', 'SSD_CLKN',
  // Row 15 (faces the memory below): DDR byte 0-7 of the second channel.
  'GND', 'GND', 'V1V0', 'V1V0',
  'DDR2_0', 'DDR2_1', 'DDR2_2', 'DDR2_3', 'DDR2_4', 'DDR2_5', 'DDR2_6', 'DDR2_7',
  'V1V0', 'USB1_DP', 'USB1_DM', 'GND',
]

/**
 * A memory device's ring: eight balls facing the SoC carry its byte, the rest of
 * the perimeter is return and rail so the plane under the part has something to
 * connect to on every side.
 *
 * `mirror` reverses which ball carries lane 0 for a device placed rotated 180°.
 * Rotation flips its facing row left-to-right, so an unmirrored list puts the
 * SoC's lane 0 opposite the memory's lane 7 and every lane has to cross the
 * others to get home. Renumbering within a byte is allowed (the DRAM spec lets a
 * device's eight DQ lanes be swapped inside their byte, not across bytes), so the
 * mirrored order is the same circuit drawn the way the copper wants it: lane *n*
 * faces lane *n* and the escape runs straight.
 */
function memoryRing(byte: string, mirror = false): string[] {
  const facesSoC = Array.from({ length: 8 }, (_, index) => `${byte}_${mirror ? 7 - index : index}`)
  return [
    'GND', 'V1V0', 'V1V0', 'GND', 'GND', 'V1V0', 'V1V0', 'GND',
    'GND', 'GND', 'GND', 'GND', 'GND', 'GND',
    'GND', 'GND', 'GND', 'GND', 'GND', 'GND',
    ...facesSoC,
  ]
}

const SOC_PLAN: PerimeterSignalPlan = {
  name: 'SOC-BGA256',
  partNumber: 'FOLIO-SOC256-2L',
  manufacturer: 'Folio template',
  rows: 16,
  cols: 16,
  pitch: 0.8,
  padDiameter: 0.4,
  returnNet: 'GND',
  coreRail: 'V1V0',
  ringSignals: SOC_RING,
}

/**
 * The memory device template without its ring: each of the two sockets gets the
 * byte lanes of its own bus, so the ring is supplied per instance below.
 */
const DDR_PLAN: Omit<PerimeterSignalPlan, 'ringSignals'> = {
  name: 'LPDDR-BGA64',
  partNumber: 'FOLIO-DDR64-2L',
  manufacturer: 'Folio template',
  rows: 8,
  cols: 8,
  pitch: 0.8,
  padDiameter: 0.4,
  returnNet: 'GND',
  coreRail: 'V1V0',
}

/**
 * A USB-C receptacle's 16 lands, in the footprint's pad order: lands 1-8 are the
 * A row, 9-16 the mirrored B row. The two ground lands sit at the row ends and
 * the VBUS lands one step in from them, which is what keeps a plane stitch on one
 * of them clear of a plane stitch on the next land — at 0.65 mm pitch two adjacent
 * stitched lands cannot both carry a 0.55 mm ring and still keep 0.15 mm apart.
 * SBU1/SBU2 are left unconnected: they only matter in alternate-mode audio.
 */
const USB_C_NETS = (data: [string, string], cc: [string, string]): string[] => [
  'GND', 'V5', cc[0], data[0], data[1], '', 'V5', 'GND',
  'GND', 'V5', '', data[1], data[0], cc[1], 'V5', 'GND',
]

/**
 * The M.2 socket's 28 card-edge lands at 0.5 mm pitch. The footprint alternates
 * its lands between the two card-edge faces, so every odd position is on the same
 * face 1.0 mm from its neighbour: ground and the 3.3 V supply take those odd
 * positions and the signals the even ones. That is what makes the rail lands
 * legal at all — two adjacent plane lands on one 0.5 mm face could not both carry
 * a 0.55 mm stitch ring and still clear each other by the 0.15 mm this board is
 * designed to. The PCIe lanes, reference clock, reset and presence occupy the even
 * positions; the socket's SMBus lands are left unconnected because this design
 * talks to the drive over PCIe alone, and a land with no place to go stays open
 * rather than being tied to a net it does not belong to.
 */
const M2_NETS = [
  'GND', '', 'V3V3', 'SSD_TXP', 'GND', 'SSD_TXN', 'V3V3', 'SSD_RXP',
  'GND', 'SSD_RXN', 'V3V3', 'SSD_CLKP', 'GND', 'SSD_CLKN', 'V3V3', 'SSD_PERST',
  'GND', 'SSD_PRE', 'V3V3', '', 'GND', '', 'V3V3', '',
  'GND', '', 'V3V3', '',
]

/** The embedded controller, pins in TQFP-32 order: bottom, right, top, left. */
const EC_NETS = [
  // 1-8 bottom edge: debug UART, coin-cell keep-alive, the 32.768 kHz crystal.
  'GND', 'DBG_TX', 'DBG_RX', 'GND', 'V3V3', 'RTC_BAT', 'X32K_IN', 'X32K_OUT',
  // 9-16 right edge: the SSD's sideband, the second USB data pair, and the
  // decoupling the package wants between its I/O banks. The reference clock is
  // not here — the root complex generates it, so it leaves the SoC's east ring.
  'SSD_PERST', 'V3V3', 'GND', 'SSD_PRE', 'USB2_DP', 'USB2_DM', 'GND', 'V3V3',
  // 17-24 top edge: keyboard matrix, trackpad interrupt, service UART.
  'KB1', 'KB2', 'KB3', 'KB4', 'TP_INT', 'EC_TX', 'EC_RX', 'V3V3',
  // 25-32 left edge: the four lines that face the SoC, plus power and inputs.
  'GND', 'V3V3', 'EC_SDA', 'EC_SCL', 'BL_PWM', 'EDP_HPD', 'PWRBTN', 'LID_SW',
]

/** The board's parts: exported so a workspace or test can name a land without re-deriving it. */
export const LAPTOP_PARTS: PlaneBoardPart[] = [
  // ── Battery input, protection and the two core rails
  // The pack's SMBus lands hang off the controller's I2C, which is what a
  // multi-drop SMBus segment is: battery, trackpad and controller share the pair.
  { ref: 'J1', footprint: 'header_2x4', value: '8-pin battery', x: 12, y: 16, nets: ['VBAT', 'VBAT', 'VBAT', 'VBAT', 'EC_SDA', 'EC_SCL', 'GND', 'GND'], color: '#0f766e' },
  { ref: 'D1', footprint: 'smc_do214ab', value: 'SS54', x: 26, y: 12, nets: ['VBAT', 'VBUS_PROT'] },
  { ref: 'C1', footprint: 'cap_1812', value: '47 uF', x: 36, y: 12, nets: ['VBUS_PROT', 'GND'] },
  { ref: 'U2', footprint: 'd2pak_5', value: `${(V3V3_SET.dutyCycle * 100).toFixed(1)}% 3.3 V buck`, x: 52, y: 14, nets: ['VBUS_PROT', 'GND', 'SW3', 'EN', 'FB3', 'SW3'], color: '#111827' },
  { ref: 'L1', footprint: 'ind_6x6', value: `${V3V3_SET.inductanceMicroH.toFixed(1)} uH`, x: 65, y: 14, nets: ['SW3', 'V3V3'], color: '#1f2937' },
  { ref: 'D2', footprint: 'smc_do214ab', value: 'SS34', x: 58, y: 26, rotationDeg: 90, nets: ['GND', 'SW3'] },
  { ref: 'C2', footprint: 'cap_1210', value: '22 uF', x: 74, y: 10, nets: ['V3V3', 'GND'] },
  { ref: 'R1', footprint: 'res_0603', value: `${(V3V3_FEEDBACK.rBottom / 1000).toFixed(1)} k`, x: 74, y: 22, nets: ['FB3', 'GND'] },
  { ref: 'R2', footprint: 'res_0603', value: `${(V3V3_FEEDBACK.rTop / 1000).toFixed(1)} k`, x: 74, y: 28, nets: ['V3V3', 'FB3'] },
  { ref: 'U3', footprint: 'd2pak_5', value: `${(V1V0_SET.dutyCycle * 100).toFixed(1)}% core buck`, x: 30, y: 60, nets: ['VBUS_PROT', 'GND', 'SWC', 'EN', 'FBC', 'SWC'], color: '#111827' },
  { ref: 'L2', footprint: 'ind_6x6', value: `${V1V0_SET.inductanceMicroH.toFixed(1)} uH`, x: 44, y: 60, nets: ['SWC', 'V1V0'], color: '#1f2937' },
  { ref: 'D3', footprint: 'smc_do214ab', value: 'SS34', x: 36, y: 72, rotationDeg: 90, nets: ['GND', 'SWC'] },
  { ref: 'C3', footprint: 'cap_1210', value: '22 uF', x: 54, y: 56, nets: ['V1V0', 'GND'] },
  { ref: 'R3', footprint: 'res_0603', value: `${(V1V0_FEEDBACK.rBottom / 1000).toFixed(1)} k`, x: 54, y: 66, nets: ['FBC', 'GND'] },
  { ref: 'R4', footprint: 'res_0603', value: `${(V1V0_FEEDBACK.rTop / 1000).toFixed(1)} k`, x: 54, y: 72, nets: ['V1V0', 'FBC'] },

  // ── USB bus power: an LDO off the protected battery rail
  { ref: 'U4', footprint: 'sot_223', value: 'AMS1117-5.0', x: 18, y: 44, nets: ['GND', 'V5', 'VBUS_PROT', 'V5', 'V5'], color: '#0b3d91' },
  { ref: 'C4', footprint: 'cap_0805', value: '10 uF', x: 28, y: 48, rotationDeg: 90, nets: ['V5', 'GND'] },

  // ── Silicon: SoC with a memory device above and below, flash to the west
  { ref: 'U5', footprint: 'bga_256', value: 'SoC BGA-256', x: 115, y: 45, nets: padNets(perimeterSignalPackage(SOC_PLAN)), color: '#0f172a' },
  { ref: 'U6', footprint: 'bga_64', value: 'LPDDR BGA-64', x: 115, y: 26, nets: padNets(perimeterSignalPackage({ ...DDR_PLAN, ringSignals: memoryRing('DDR1') })), color: '#1e293b' },
  { ref: 'U7', footprint: 'bga_64', value: 'LPDDR BGA-64', x: 115, y: 64, rotationDeg: 180, nets: padNets(perimeterSignalPackage({ ...DDR_PLAN, ringSignals: memoryRing('DDR2', true) })), color: '#1e293b' },
  // SOIC-8 BIOS flash: pins 3 and 7 are /WP and /HOLD in single-SPI, IO2 and IO3
  // in quad mode, so the demo names them as the quad pair.
  { ref: 'U8', footprint: 'soic_8', value: 'SPI flash', x: 98, y: 20, rotationDeg: 90, nets: ['SPI_CS', 'SPI_DQ1', 'SPI_DQ2', 'GND', 'SPI_DQ0', 'SPI_CLK', 'SPI_DQ3', 'V3V3'], color: '#111827' },
  { ref: 'Y1', footprint: 'xtal_3225', value: '25 MHz', x: 96, y: 58, nets: ['XIN', 'GND', 'XOUT', 'GND'] },
  { ref: 'C5', footprint: 'cap_0402', value: '100 nF', x: 92, y: 54, nets: ['XIN', 'GND'] },
  { ref: 'C6', footprint: 'cap_0402', value: '100 nF', x: 92, y: 62, nets: ['XOUT', 'GND'] },
  { ref: 'Y2', footprint: 'xtal_3225', value: '32.768 kHz', x: 140, y: 57, nets: ['X32K_IN', 'GND', 'X32K_OUT', 'GND'] },

  // ── Decoupling: one ring per rail around the SoC, each stitched to its plane
  { ref: 'C7', footprint: 'cap_0402', value: '100 nF', x: 107, y: 31, nets: ['V3V3', 'GND'] },
  { ref: 'C8', footprint: 'cap_0402', value: '100 nF', x: 115, y: 31, nets: ['V3V3', 'GND'] },
  { ref: 'C9', footprint: 'cap_0402', value: '100 nF', x: 123, y: 31, nets: ['V3V3', 'GND'] },
  { ref: 'C10', footprint: 'cap_0402', value: '100 nF', x: 107, y: 59, nets: ['V1V0', 'GND'] },
  { ref: 'C11', footprint: 'cap_0402', value: '100 nF', x: 123, y: 59, nets: ['V1V0', 'GND'] },

  // ── Embedded controller, immediately east of the SoC it reports to
  { ref: 'U9', footprint: 'qfp_32', value: 'EC TQFP-32', x: 140, y: 42, nets: EC_NETS, color: '#131a2a' },
  { ref: 'R5', footprint: 'res_0402', value: '10 k', x: 129, y: 33, nets: ['PWRBTN', 'V3V3'] },
  { ref: 'R6', footprint: 'res_0402', value: '10 k', x: 129, y: 37, nets: ['LID_SW', 'V3V3'] },
  { ref: 'SW1', footprint: 'tact_6x6', value: 'POWER', x: 133, y: 76, nets: ['PWRBTN', 'PWRBTN', 'GND', 'GND'], color: '#111827' },

  // ── Ports along the right edge, each facing the outline it exits through
  { ref: 'J2', footprint: 'usb_c_16', value: 'USB-C host', x: 232, y: 10, rotationDeg: -90, nets: USB_C_NETS(['USB1_DP', 'USB1_DM'], ['CC1', 'CC2']), color: '#9ca3af' },
  { ref: 'J3', footprint: 'usb_c_16', value: 'USB-C device', x: 241, y: 22, nets: USB_C_NETS(['USB2_DP', 'USB2_DM'], ['CC3', 'CC4']), color: '#9ca3af' },
  { ref: 'J4', footprint: 'm2_2280', value: 'M.2 2280 SSD', x: 195, y: 6, rotationDeg: 180, nets: M2_NETS, color: '#6b7280' },
  { ref: 'R7', footprint: 'res_0603', value: '5.1 k', x: 218, y: 10, nets: ['CC1', 'GND'] },
  { ref: 'R8', footprint: 'res_0603', value: '5.1 k', x: 226, y: 10, nets: ['CC2', 'GND'] },
  { ref: 'R9', footprint: 'res_0603', value: '5.1 k', x: 212, y: 30, nets: ['CC3', 'GND'] },
  { ref: 'R10', footprint: 'res_0603', value: '5.1 k', x: 226, y: 30, nets: ['CC4', 'GND'] },
  { ref: 'J5', footprint: 'header_1x8', value: 'eDP panel', x: 241, y: 45, nets: ['V3V3', 'GND', 'EDP_DP0P', 'EDP_DP0N', 'BL_PWM', 'GND', 'V3V3', 'EDP_HPD'], color: '#1f2937' },
  { ref: 'J6', footprint: 'header_1x6', value: 'Keyboard', x: 168, y: 10, rotationDeg: 90, nets: ['V3V3', 'GND', 'KB1', 'KB2', 'KB3', 'KB4'], color: '#1f2937' },
  { ref: 'J7', footprint: 'header_2x3', value: 'Trackpad', x: 186, y: 12, nets: ['V3V3', 'GND', 'TP_INT', 'EC_SDA', 'EC_SCL', 'GND'], color: '#1f2937' },
  { ref: 'J8', footprint: 'header_2x3', value: 'DEBUG', x: 148, y: 79, nets: ['GND', 'DBG_TX', 'DBG_RX', 'V3V3', 'GND', 'EC_TX'], color: '#1f2937' },

  // ── Status, keep-alive and fixings
  { ref: 'R11', footprint: 'res_0603', value: '1 k', x: 224, y: 50, nets: ['V3V3', 'PWR_K'] },
  { ref: 'D4', footprint: 'led_0805', value: 'PWR green', x: 228, y: 50, rotationDeg: 90, nets: ['PWR_K', 'GND'], color: '#22c55e' },
  { ref: 'R12', footprint: 'res_0603', value: '1 k', x: 224, y: 56, nets: ['V3V3', 'CHG_K'] },
  { ref: 'D5', footprint: 'led_0805', value: 'CHG amber', x: 228, y: 56, rotationDeg: 90, nets: ['CHG_K', 'GND'], color: '#f59e0b' },
  // The coin cell sits by the controller it keeps alive, not by the port it
  // happens to clear: a 190 mm keep-alive run is a voltage drop nobody designs.
  { ref: 'RT1', footprint: 'coin_cr2032', value: 'CR2032', x: 175, y: 78, nets: ['RTC_BAT', 'GND'], color: '#cbd5e1' },
  { ref: 'MH1', footprint: 'mount_m3', value: 'M3', x: 4.5, y: 4.5, nets: [] },
  { ref: 'MH2', footprint: 'mount_m3', value: 'M3', x: 122.5, y: 4.5, nets: [] },
  { ref: 'MH3', footprint: 'mount_m3', value: 'M3', x: 240.5, y: 85.5, nets: [] },
  { ref: 'MH4', footprint: 'mount_m3', value: 'M3', x: 4.5, y: 85.5, nets: [] },
  { ref: 'MH5', footprint: 'mount_m3', value: 'M3', x: 122.5, y: 85.5, nets: [] },
  { ref: 'MH6', footprint: 'mount_m3', value: 'M3', x: 240.5, y: 4.5, nets: [] },
]

/**
 * Both ball maps are checked against the footprint they will be landed on before
 * anything routes: a 16x16 template must agree with `bga_256` ball for ball, or
 * the demo would be drawing one geometry and routing another.
 */
function assertBallMapsMatchFootprints(): void {
  const soc = perimeterSignalPackage(SOC_PLAN)
  const ddr = perimeterSignalPackage({ ...DDR_PLAN, ringSignals: memoryRing('DDR1') })
  validateBallMap(soc)
  validateBallMap(ddr)
  for (const [footprintId, pkg] of [['bga_256', soc], ['bga_64', ddr]] as const) {
    const footprint = resolveFootprint(footprintId)
    if (!footprint) throw new Error(`${footprintId} is not in the footprint library.`)
    if (footprint.pads.length !== pkg.balls.length) {
      throw new Error(`${pkg.partNumber}: ball map has ${pkg.balls.length} balls, ${footprintId} has ${footprint.pads.length} lands.`)
    }
    footprint.pads.forEach((pad, index) => {
      const ball = pkg.balls[index]
      const dx = Math.abs(pad.position.x - ball.x)
      const dy = Math.abs(pad.position.y - ball.y)
      if (dx > 1e-9 || dy > 1e-9) {
        throw new Error(
          `${pkg.partNumber} ball ${index} is at (${ball.x.toFixed(3)}, ${ball.y.toFixed(3)}) but ${footprintId} land ${pad.id} is at (${pad.position.x.toFixed(3)}, ${pad.position.y.toFixed(3)}).`,
        )
      }
      if (Math.abs(pad.size.width - pkg.padDiameter) > 1e-9 || Math.abs(pad.size.height - pkg.padDiameter) > 1e-9) {
        throw new Error(`${pkg.partNumber} ball ${index} is ${pkg.padDiameter} mm but ${footprintId} land ${pad.id} is ${pad.size.width} x ${pad.size.height} mm.`)
      }
    })
  }
}

const SPEC: PlaneBoardSpec = {
  name: 'Laptop mainboard',
  idPrefix: 'laptop',
  board: LAPTOP_BOARD,
  parts: LAPTOP_PARTS,
  planeNets: LAPTOP_PLANE_NETS,
  pours: POURS,
  router: {
    boardWidthMm: LAPTOP_BOARD.widthMm,
    boardHeightMm: LAPTOP_BOARD.heightMm,
    layers: ['F.Cu', 'B.Cu'],
    ...ROUTER_RULES,
    // Measured on this board, not guessed: two sweeps recover no net that the
    // greedy pass missed, and six recover no net either — every signal that
    // fails here is walled in by neighbouring lands, which lifting copper cannot
    // move, or is blocked by a copper mass wider than the lift budget. So the
    // demo spends its time on the search that works (7 s) rather than on the one
    // that proves it cannot (32 s). Rip-up stays on by default for every other
    // board, and autorouter.test.ts exercises it there.
    ripUpPasses: 0,
  } satisfies RouterConfig,
  layers: LAYERS,
  pourMarginMm: POUR_MARGIN_MM,
  landGapMm: LAND_GAP_MM,
  planeClearanceMm: PLANE_CLEARANCE_MM,
  stitchPadFor: (land) => Math.min(land.widthMm, land.depthMm) * 0.62,
  stitchVia: { drillMm: 0.1, minAnnularRingMm: 0.05 },
}

export interface LaptopPcb {
  board: typeof LAPTOP_BOARD
  scene: PcbSceneInput
  summary: PlaneBoardResult['summary']
  /** Every land the board prints, plane lands included, so a checker can audit the copper. */
  lands: PlaneBoardResult['lands']
  /**
   * The lands as the router saw them — positions, layers, plating — which is the
   * input the editor's flyline solve takes. Carrying it lets a test check the
   * panel's "what still needs routing" against what this board actually left open.
   */
  pads: PlaneBoardResult['pads']
  /**
   * The routed copper audited by `DesignRuleChecker` at this board's own rules,
   * with drilled lands carried on both faces. Measured when the board is built, so
   * "DRC clean" on the demo card is a reading and not an assertion.
   */
  drc: DRCResult
  power: {
    v3v3: { dutyCycle: number, inductanceMicroH: number, peakCurrentA: number, minOutputCapacitanceUf: number }
    v1v0: { dutyCycle: number, inductanceMicroH: number, peakCurrentA: number, minOutputCapacitanceUf: number }
    feedback: { v3v3Top: number, v3v3Bottom: number, v1v0Top: number, v1v0Bottom: number }
  }
}

let cached: LaptopPcb | null = null

function badgeOf(set: ReturnType<typeof calculateBuckConverter>) {
  return {
    dutyCycle: set.dutyCycle,
    inductanceMicroH: set.inductanceMicroH,
    peakCurrentA: set.inductorPeakCurrentA,
    minOutputCapacitanceUf: set.minOutputCapacitanceUf,
  }
}

export function buildLaptopPcb(): LaptopPcb {
  if (cached) return cached
  assertBallMapsMatchFootprints()
  const { scene, summary, lands, pads } = buildPlaneBoard(SPEC)
  cached = {
    board: LAPTOP_BOARD,
    scene,
    summary,
    lands,
    pads,
    drc: planeBoardDrc(SPEC, scene, lands),
    power: {
      v3v3: badgeOf(V3V3_SET),
      v1v0: badgeOf(V1V0_SET),
      feedback: {
        v3v3Top: V3V3_FEEDBACK.rTop,
        v3v3Bottom: V3V3_FEEDBACK.rBottom,
        v1v0Top: V1V0_FEEDBACK.rTop,
        v1v0Bottom: V1V0_FEEDBACK.rBottom,
      },
    },
  }
  return cached
}
