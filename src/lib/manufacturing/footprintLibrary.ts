import { Point } from '../../types';
import { generatedFootprint, declaresUnpatternedPackage } from './landPattern';

export interface FootprintPad {
  id: string;
  shape: 'circle' | 'rectangle' | 'oval';
  position: Point;
  size: { width: number; height: number };
  drillDiameter?: number;
  layers: string[];
}

export interface Footprint {
  id: string;
  name: string;
  description: string;
  category: string;
  pads: FootprintPad[];
  dimensions: { width: number; height: number };
  /** Physical body height for 3-D display; falls back to a category default. */
  bodyHeightMm?: number;
  courtyard?: Point[]; // Polygon defining component boundary
  silkScreen?: unknown[]; // Silk screen elements
  assembly?: unknown[]; // Assembly layer elements
  metadata: {
    manufacturer?: string;
    partNumber?: string;
    datasheet?: string;
    ipcStandard?: string;
    thermalPad?: boolean;
  };
}

export class FootprintLibrary {
  private footprints: Map<string, Footprint> = new Map();

  constructor() {
    this.initializeStandardLibrary();
  }

  private initializeStandardLibrary(): void {
    // Resistor footprints
    this.addFootprint({
      id: 'res_0402',
      name: '0402',
      description: '0402 SMD Resistor',
      category: 'resistor',
      pads: [
        {
          id: 'pad1',
          shape: 'rectangle',
          position: { x: -0.5, y: 0 },
          size: { width: 0.6, height: 0.6 },
          layers: ['top_copper', 'bottom_copper']
        },
        {
          id: 'pad2',
          shape: 'rectangle',
          position: { x: 0.5, y: 0 },
          size: { width: 0.6, height: 0.6 },
          layers: ['top_copper', 'bottom_copper']
        }
      ],
      dimensions: { width: 1.0, height: 0.5 },
      courtyard: [
        { x: -0.85, y: -0.45 },
        { x: 0.85, y: -0.45 },
        { x: 0.85, y: 0.45 },
        { x: -0.85, y: 0.45 }
      ],
      metadata: {
        ipcStandard: 'IPC-7351',
        thermalPad: false
      }
    });

    // Capacitor footprints
    this.addFootprint({
      id: 'cap_0603',
      name: '0603',
      description: '0603 SMD Capacitor',
      category: 'capacitor',
      pads: [
        {
          id: 'pad1',
          shape: 'rectangle',
          position: { x: -0.75, y: 0 },
          size: { width: 0.8, height: 0.8 },
          layers: ['top_copper', 'bottom_copper']
        },
        {
          id: 'pad2',
          shape: 'rectangle',
          position: { x: 0.75, y: 0 },
          size: { width: 0.8, height: 0.8 },
          layers: ['top_copper', 'bottom_copper']
        }
      ],
      dimensions: { width: 1.6, height: 0.8 },
      courtyard: [
        { x: -1.2, y: -0.5 },
        { x: 1.2, y: -0.5 },
        { x: 1.2, y: 0.5 },
        { x: -1.2, y: 0.5 }
      ],
      metadata: {
        ipcStandard: 'IPC-7351',
        thermalPad: false
      }
    });

    // IC footprints
    /*
     * SOIC-8 (IPC-7351 "narrow", body 3.9 x 4.9 mm): 1.27 mm pitch, lands 0.6 mm
     * across the pitch and 1.5 mm along the lead, with the lead row 5.4 mm apart.
     * The pitch is the distance between neighbouring lands *along* the row, so a
     * 0.6 mm land at 0.635 mm spacing leaves 0.035 mm of gap between pins 1 and 2 —
     * which is not a fan-out channel, it is a near-short, and every net on the part
     * walls out at its own footprint. Positions below are the real ±0.635, ±1.905.
     */
    this.addFootprint({
      id: 'soic_8',
      name: 'SOIC-8',
      description: '8-pin Small Outline IC',
      category: 'ic',
      pads: [
        { id: 'pad1', shape: 'rectangle', position: { x: -2.7, y: 1.905 }, size: { width: 1.5, height: 0.6 }, layers: ['top_copper'] },
        { id: 'pad2', shape: 'rectangle', position: { x: -2.7, y: 0.635 }, size: { width: 1.5, height: 0.6 }, layers: ['top_copper'] },
        { id: 'pad3', shape: 'rectangle', position: { x: -2.7, y: -0.635 }, size: { width: 1.5, height: 0.6 }, layers: ['top_copper'] },
        { id: 'pad4', shape: 'rectangle', position: { x: -2.7, y: -1.905 }, size: { width: 1.5, height: 0.6 }, layers: ['top_copper'] },
        { id: 'pad5', shape: 'rectangle', position: { x: 2.7, y: -1.905 }, size: { width: 1.5, height: 0.6 }, layers: ['top_copper'] },
        { id: 'pad6', shape: 'rectangle', position: { x: 2.7, y: -0.635 }, size: { width: 1.5, height: 0.6 }, layers: ['top_copper'] },
        { id: 'pad7', shape: 'rectangle', position: { x: 2.7, y: 0.635 }, size: { width: 1.5, height: 0.6 }, layers: ['top_copper'] },
        { id: 'pad8', shape: 'rectangle', position: { x: 2.7, y: 1.905 }, size: { width: 1.5, height: 0.6 }, layers: ['top_copper'] }
      ],
      dimensions: { width: 3.9, height: 4.9 },
      courtyard: [
        { x: -3.5, y: -2.4 },
        { x: 3.5, y: -2.4 },
        { x: 3.5, y: 2.4 },
        { x: -3.5, y: 2.4 }
      ],
      metadata: {
        ipcStandard: 'IPC-7351',
        thermalPad: false
      }
    });

    // QFP footprint
    this.addFootprint({
      id: 'qfp_32',
      name: 'TQFP-32',
      description: '32-pin Thin Quad Flat Pack',
      category: 'ic',
      pads: this.generateQFP32Pads(),
      dimensions: { width: 7.0, height: 7.0 },
      courtyard: [
        { x: -5.0, y: -5.0 },
        { x: 5.0, y: -5.0 },
        { x: 5.0, y: 5.0 },
        { x: -5.0, y: 5.0 }
      ],
      metadata: {
        ipcStandard: 'IPC-7351',
        thermalPad: true
      }
    });

    // Through-hole footprints
    /*
     * DIP-8, 2.54 mm pitch in the row and 7.62 mm between rows, with a 1.5 mm
     * round land. At 1.27 mm spacing those lands overlap by 0.23 mm, which shorts
     * neighbouring pins of the same package — the row positions below are the real
     * +/-1.27 and +/-3.81.
     */
    this.addFootprint({
      id: 'dip_8',
      name: 'DIP-8',
      description: '8-pin Dual Inline Package',
      category: 'ic',
      pads: [
        { id: 'pad1', shape: 'circle', position: { x: -3.81, y: 3.81 }, size: { width: 1.5, height: 1.5 }, drillDiameter: 0.8, layers: ['top_copper', 'bottom_copper'] },
        { id: 'pad2', shape: 'circle', position: { x: -3.81, y: 1.27 }, size: { width: 1.5, height: 1.5 }, drillDiameter: 0.8, layers: ['top_copper', 'bottom_copper'] },
        { id: 'pad3', shape: 'circle', position: { x: -3.81, y: -1.27 }, size: { width: 1.5, height: 1.5 }, drillDiameter: 0.8, layers: ['top_copper', 'bottom_copper'] },
        { id: 'pad4', shape: 'circle', position: { x: -3.81, y: -3.81 }, size: { width: 1.5, height: 1.5 }, drillDiameter: 0.8, layers: ['top_copper', 'bottom_copper'] },
        { id: 'pad5', shape: 'circle', position: { x: 3.81, y: -3.81 }, size: { width: 1.5, height: 1.5 }, drillDiameter: 0.8, layers: ['top_copper', 'bottom_copper'] },
        { id: 'pad6', shape: 'circle', position: { x: 3.81, y: -1.27 }, size: { width: 1.5, height: 1.5 }, drillDiameter: 0.8, layers: ['top_copper', 'bottom_copper'] },
        { id: 'pad7', shape: 'circle', position: { x: 3.81, y: 1.27 }, size: { width: 1.5, height: 1.5 }, drillDiameter: 0.8, layers: ['top_copper', 'bottom_copper'] },
        { id: 'pad8', shape: 'circle', position: { x: 3.81, y: 3.81 }, size: { width: 1.5, height: 1.5 }, drillDiameter: 0.8, layers: ['top_copper', 'bottom_copper'] }
      ],
      dimensions: { width: 10.16, height: 7.62 },
      courtyard: [
        { x: -4.7, y: -4.7 },
        { x: 4.7, y: -4.7 },
        { x: 4.7, y: 4.7 },
        { x: -4.7, y: 4.7 }
      ],
      metadata: {
        ipcStandard: 'IPC-7351',
        thermalPad: false
      }
    });

    // Additional resistor footprints
    ['0603', '0805', '1206', '2512'].forEach(size => {
      const dimensions: Record<string, { width: number; height: number; padSpacing: number; padSize: { width: number; height: number } }> = {
        '0603': { width: 1.6, height: 0.8, padSpacing: 1.4, padSize: { width: 0.8, height: 0.8 } },
        '0805': { width: 2.0, height: 1.25, padSpacing: 1.8, padSize: { width: 1.0, height: 1.0 } },
        '1206': { width: 3.2, height: 1.6, padSpacing: 3.0, padSize: { width: 1.2, height: 1.2 } },
        '2512': { width: 6.3, height: 3.2, padSpacing: 6.1, padSize: { width: 1.5, height: 1.5 } }
      };

      const dims = dimensions[size];
      this.addFootprint({
        id: `res_${size}`,
        name: size,
        description: `${size} SMD Resistor`,
        category: 'resistor',
        pads: [
          {
            id: 'pad1',
            shape: 'rectangle',
            position: { x: -dims.padSpacing / 2, y: 0 },
            size: dims.padSize,
            layers: ['top_copper', 'bottom_copper']
          },
          {
            id: 'pad2',
            shape: 'rectangle',
            position: { x: dims.padSpacing / 2, y: 0 },
            size: dims.padSize,
            layers: ['top_copper', 'bottom_copper']
          }
        ],
        dimensions: { width: dims.width, height: dims.height },
        metadata: {
          ipcStandard: 'IPC-7351',
          thermalPad: false
        }
      });
    });

    // Additional capacitor footprints
    ['0402', '0805', '1210', '1812'].forEach(size => {
      const dimensions: Record<string, { width: number; height: number; padSpacing: number; padSize: { width: number; height: number } }> = {
        '0402': { width: 1.0, height: 0.5, padSpacing: 0.8, padSize: { width: 0.6, height: 0.6 } },
        '0805': { width: 2.0, height: 1.25, padSpacing: 1.8, padSize: { width: 1.0, height: 1.0 } },
        '1210': { width: 3.2, height: 2.5, padSpacing: 3.0, padSize: { width: 1.2, height: 1.2 } },
        '1812': { width: 4.5, height: 3.2, padSpacing: 4.3, padSize: { width: 1.5, height: 1.5 } }
      };

      const dims = dimensions[size];
      this.addFootprint({
        id: `cap_${size}`,
        name: size,
        description: `${size} SMD Capacitor`,
        category: 'capacitor',
        pads: [
          {
            id: 'pad1',
            shape: 'rectangle',
            position: { x: -dims.padSpacing / 2, y: 0 },
            size: dims.padSize,
            layers: ['top_copper', 'bottom_copper']
          },
          {
            id: 'pad2',
            shape: 'rectangle',
            position: { x: dims.padSpacing / 2, y: 0 },
            size: dims.padSize,
            layers: ['top_copper', 'bottom_copper']
          }
        ],
        dimensions: { width: dims.width, height: dims.height },
        metadata: {
          ipcStandard: 'IPC-7351',
          thermalPad: false
        }
      });
    });

    // BGA footprints
    [16, 64, 144, 256].forEach(pinCount => {
      const side = Math.sqrt(pinCount);
      const pitch = 0.8;
      const size = (side - 1) * pitch;
      const pads: FootprintPad[] = [];

      for (let row = 0; row < side; row++) {
        for (let col = 0; col < side; col++) {
          pads.push({
            id: `pad_${row}_${col}`,
            shape: 'circle',
            position: {
              x: -size / 2 + col * pitch,
              y: -size / 2 + row * pitch
            },
            size: { width: 0.4, height: 0.4 },
            layers: ['top_copper']
          });
        }
      }

      this.addFootprint({
        id: `bga_${pinCount}`,
        name: `BGA-${pinCount}`,
        description: `${pinCount}-pin Ball Grid Array`,
        category: 'ic',
        pads,
        dimensions: { width: size + 1, height: size + 1 },
        metadata: {
          ipcStandard: 'IPC-7351',
          thermalPad: true
        }
      });
    });

    // SOT-23 footprint (2N2222 / jellybean NPN workhorse)
    this.addFootprint({
      id: 'sot_23',
      name: 'SOT-23',
      description: 'SOT-23 3-pin SMD transistor',
      category: 'semiconductor',
      pads: [
        { id: 'pad1', shape: 'rectangle', position: { x: -0.95, y: 0.95 }, size: { width: 0.8, height: 0.9 }, layers: ['top_copper'] },
        { id: 'pad2', shape: 'rectangle', position: { x: 0.95, y: 0.95 }, size: { width: 0.8, height: 0.9 }, layers: ['top_copper'] },
        { id: 'pad3', shape: 'rectangle', position: { x: 0, y: -0.95 }, size: { width: 0.8, height: 0.9 }, layers: ['top_copper'] },
      ],
      dimensions: { width: 2.9, height: 2.4 },
      metadata: { ipcStandard: 'IPC-7351', thermalPad: false },
    });

    // DO-214AB / SMC — the 1N5817-class rectifier package used by the demo board.
    this.addFootprint({
      id: 'smc_do214ab',
      name: 'SMC',
      description: 'SMC / DO-214AB 2-pad SMD diode',
      category: 'semiconductor',
      pads: [
        { id: 'pad1', shape: 'rectangle', position: { x: -3.4, y: 0 }, size: { width: 2.4, height: 3.4 }, layers: ['top_copper'] },
        { id: 'pad2', shape: 'rectangle', position: { x: 3.4, y: 0 }, size: { width: 2.4, height: 3.4 }, layers: ['top_copper'] },
      ],
      dimensions: { width: 7.1, height: 2.6 },
      // DO-214AB body is 7.11 x 2.62 x 2.3 mm; it sits over the inner half of
      // each land, leaving the lead tails exposed.
      bodyHeightMm: 2.3,
      metadata: { ipcStandard: 'IPC-7351', thermalPad: false },
    });

    /*
     * Board-mount and product parts. These exist so a layout can carry the
     * pieces a real enclosure needs — an M3 boss hole, a screw terminal, an
     * electrolytic bulk can, a shielded crystal, a buck inductor, a tact
     * switch — instead of standing all of that in with 0805s.
     *
     * Body heights are the published package dimensions, because the 3-D
     * preview and any enclosure clearance check read them.
     */

    // M3 mounting hole: a plain annular ring, no body.
    this.addFootprint({
      id: 'mount_m3',
      name: 'MTH-M3',
      description: 'M3 plated mounting hole, 3.2 mm drill',
      category: 'mechanical',
      pads: [
        { id: 'pad1', shape: 'circle', position: { x: 0, y: 0 }, size: { width: 6.0, height: 6.0 }, drillDiameter: 3.2, layers: ['top_copper', 'bottom_copper'] },
      ],
      dimensions: { width: 6.0, height: 6.0 },
      bodyHeightMm: 0,
      metadata: { ipcStandard: 'IPC-2221', thermalPad: false },
    });

    // 2012 (0805) chip LED — its own category so the preview gives it a lens.
    this.addFootprint({
      id: 'led_0805',
      name: 'LED-0805',
      description: '0805 chip LED, 2.0 x 1.25 mm',
      category: 'led',
      pads: [
        { id: 'pad1', shape: 'rectangle', position: { x: -0.9, y: 0 }, size: { width: 1.0, height: 1.2 }, layers: ['top_copper'] },
        { id: 'pad2', shape: 'rectangle', position: { x: 0.9, y: 0 }, size: { width: 1.0, height: 1.2 }, layers: ['top_copper'] },
      ],
      dimensions: { width: 2.0, height: 1.25 },
      bodyHeightMm: 0.85,
      metadata: { ipcStandard: 'IPC-7351', thermalPad: false },
    });

    // Radial aluminium electrolytic, 6.3 mm can.
    this.addFootprint({
      id: 'cap_elec_63',
      name: 'ELEC-6.3',
      description: 'Radial electrolytic, 6.3 mm can, 2.5 mm pitch',
      category: 'capacitor',
      pads: [
        { id: 'pad1', shape: 'circle', position: { x: -1.25, y: 0 }, size: { width: 1.9, height: 1.9 }, drillDiameter: 0.9, layers: ['top_copper', 'bottom_copper'] },
        { id: 'pad2', shape: 'circle', position: { x: 1.25, y: 0 }, size: { width: 1.9, height: 1.9 }, drillDiameter: 0.9, layers: ['top_copper', 'bottom_copper'] },
      ],
      dimensions: { width: 6.3, height: 6.3 },
      bodyHeightMm: 5.0,
      metadata: { ipcStandard: 'IPC-7351', thermalPad: false },
    });

    // 3225 crystal oscillator: four corner pads, two of them the can.
    this.addFootprint({
      id: 'xtal_3225',
      name: 'XTAL-3225',
      description: '3.2 x 2.5 mm four-pad crystal',
      category: 'crystal',
      pads: [
        { id: 'pad1', shape: 'rectangle', position: { x: -1.1, y: 1.15 }, size: { width: 1.0, height: 0.9 }, layers: ['top_copper'] },
        { id: 'pad2', shape: 'rectangle', position: { x: 1.1, y: 1.15 }, size: { width: 1.0, height: 0.9 }, layers: ['top_copper'] },
        { id: 'pad3', shape: 'rectangle', position: { x: 1.1, y: -1.15 }, size: { width: 1.0, height: 0.9 }, layers: ['top_copper'] },
        { id: 'pad4', shape: 'rectangle', position: { x: -1.1, y: -1.15 }, size: { width: 1.0, height: 0.9 }, layers: ['top_copper'] },
      ],
      dimensions: { width: 3.2, height: 2.5 },
      bodyHeightMm: 0.8,
      metadata: { ipcStandard: 'IPC-7351', thermalPad: false },
    });

    // Shielded power inductor for a buck converter.
    this.addFootprint({
      id: 'ind_6x6',
      name: 'IND-6X6',
      description: 'Shielded 6 x 6 mm power inductor, 3 mm tall',
      category: 'inductor',
      pads: [
        { id: 'pad1', shape: 'rectangle', position: { x: -2.4, y: 0 }, size: { width: 1.6, height: 4.0 }, layers: ['top_copper'] },
        { id: 'pad2', shape: 'rectangle', position: { x: 2.4, y: 0 }, size: { width: 1.6, height: 4.0 }, layers: ['top_copper'] },
      ],
      dimensions: { width: 6.5, height: 6.5 },
      bodyHeightMm: 3.0,
      metadata: { ipcStandard: 'IPC-7351', thermalPad: true },
    });

    // SOT-223 — the usual LDO package: three leads and a drain tab.
    this.addFootprint({
      id: 'sot_223',
      name: 'SOT-223',
      description: 'SOT-223 four-pad regulator with drain tab',
      category: 'ic',
      pads: [
        { id: 'pad1', shape: 'rectangle', position: { x: -2.4, y: 2.3 }, size: { width: 1.5, height: 0.9 }, layers: ['top_copper'] },
        { id: 'pad2', shape: 'rectangle', position: { x: -2.4, y: 0 }, size: { width: 1.5, height: 0.9 }, layers: ['top_copper'] },
        { id: 'pad3', shape: 'rectangle', position: { x: -2.4, y: -2.3 }, size: { width: 1.5, height: 0.9 }, layers: ['top_copper'] },
        { id: 'pad4', shape: 'rectangle', position: { x: 2.4, y: 2.3 }, size: { width: 1.5, height: 0.9 }, layers: ['top_copper'] },
        { id: 'pad5', shape: 'rectangle', position: { x: 2.4, y: -0.6 }, size: { width: 2.2, height: 3.8 }, layers: ['top_copper'] },
      ],
      dimensions: { width: 6.5, height: 3.5 },
      bodyHeightMm: 1.6,
      metadata: { ipcStandard: 'IPC-7351', thermalPad: true },
    });

    // D2PAK / TO-263 — the buck switcher the demo board regulates with.
    // 1.8 mm lead pitch, so a land may be 1.1 mm across the row: the 2.2 mm figure
    // this pattern used to carry overlapped neighbouring pins by 0.4 mm and left the
    // switcher's own enable and feedback pins shorted inside the footprint.
    this.addFootprint({
      id: 'd2pak_5',
      name: 'D2PAK-5',
      description: 'TO-263-5 power package with drain tab',
      category: 'ic',
      pads: [
        { id: 'pad1', shape: 'rectangle', position: { x: -3.2, y: 2.7 }, size: { width: 2.0, height: 1.1 }, layers: ['top_copper'] },
        { id: 'pad2', shape: 'rectangle', position: { x: -3.2, y: 0.9 }, size: { width: 2.0, height: 1.1 }, layers: ['top_copper'] },
        { id: 'pad3', shape: 'rectangle', position: { x: -3.2, y: -0.9 }, size: { width: 2.0, height: 1.1 }, layers: ['top_copper'] },
        { id: 'pad4', shape: 'rectangle', position: { x: -3.2, y: -2.7 }, size: { width: 2.0, height: 1.1 }, layers: ['top_copper'] },
        { id: 'pad5', shape: 'rectangle', position: { x: 3.6, y: 2.7 }, size: { width: 2.0, height: 1.1 }, layers: ['top_copper'] },
        { id: 'pad6', shape: 'rectangle', position: { x: 3.6, y: -1.2 }, size: { width: 3.6, height: 5.2 }, layers: ['top_copper'] },
      ],
      dimensions: { width: 10.0, height: 9.0 },
      bodyHeightMm: 4.2,
      metadata: { ipcStandard: 'IPC-7351', thermalPad: true },
    });

    // 6 x 6 mm tactile switch: four corner pads, wired in pairs.
    this.addFootprint({
      id: 'tact_6x6',
      name: 'TACT-6X6',
      description: '6 x 6 mm four-pad tactile switch',
      category: 'switch',
      pads: [
        { id: 'pad1', shape: 'circle', position: { x: -3.25, y: 2.25 }, size: { width: 1.8, height: 1.8 }, drillDiameter: 0.9, layers: ['top_copper', 'bottom_copper'] },
        { id: 'pad2', shape: 'circle', position: { x: 3.25, y: 2.25 }, size: { width: 1.8, height: 1.8 }, drillDiameter: 0.9, layers: ['top_copper', 'bottom_copper'] },
        { id: 'pad3', shape: 'circle', position: { x: -3.25, y: -2.25 }, size: { width: 1.8, height: 1.8 }, drillDiameter: 0.9, layers: ['top_copper', 'bottom_copper'] },
        { id: 'pad4', shape: 'circle', position: { x: 3.25, y: -2.25 }, size: { width: 1.8, height: 1.8 }, drillDiameter: 0.9, layers: ['top_copper', 'bottom_copper'] },
      ],
      dimensions: { width: 6.6, height: 6.6 },
      bodyHeightMm: 3.5,
      metadata: { ipcStandard: 'IPC-7351', thermalPad: false },
    });

    // 5.08 mm two-way screw terminal — the board's power entry.
    this.addFootprint({
      id: 'term_508_2',
      name: 'TERM-2P-5.08',
      description: 'Two-position 5.08 mm screw terminal block',
      category: 'connector',
      pads: [
        { id: 'pad1', shape: 'circle', position: { x: -2.54, y: 0 }, size: { width: 2.4, height: 2.4 }, drillDiameter: 1.1, layers: ['top_copper', 'bottom_copper'] },
        { id: 'pad2', shape: 'circle', position: { x: 2.54, y: 0 }, size: { width: 2.4, height: 2.4 }, drillDiameter: 1.1, layers: ['top_copper', 'bottom_copper'] },
      ],
      dimensions: { width: 12.7, height: 12.2 },
      bodyHeightMm: 11.0,
      metadata: { ipcStandard: 'IPC-7341', thermalPad: false },
    });

    /*
     * Portable-computer ports. These three land patterns exist so a mainboard
     * layout can carry the connectors a laptop actually has — a USB-C receptacle,
     * an M.2 2280 card-edge socket and a coin-cell holder for the RTC — instead
     * of standing them in with pin headers.
     *
     * They are the tool's own IPC-derived patterns for the interface group, not
     * a drop-in for one vendor's part number: pad counts, pitches and body
     * envelopes follow the connector specifications, and a board house would
     * still check them against the datasheet of the part it buys.
     */

    // USB Type-C receptacle, 16-land USB 2.0 + Power Delivery subset. Lands 1-8
    // are one contact row and 9-16 the other, numbered so that the two rows read
    // in opposite directions across the tongue — which is how the receptacle's
    // own A/B pin groups mirror each other.
    const usbCPads: FootprintPad[] = [];
    for (let slot = 0; slot < 8; slot++) {
      usbCPads.push({
        id: `pad${slot + 1}`,
        shape: 'rectangle',
        position: { x: (slot - 3.5) * 0.65, y: 0.85 },
        size: { width: 0.35, height: 0.9 },
        layers: ['top_copper'],
      });
    }
    for (let slot = 0; slot < 8; slot++) {
      usbCPads.push({
        id: `pad${slot + 9}`,
        shape: 'rectangle',
        position: { x: (3.5 - slot) * 0.65, y: -0.85 },
        size: { width: 0.35, height: 0.9 },
        layers: ['top_copper'],
      });
    }
    this.addFootprint({
      id: 'usb_c_16',
      name: 'USB-C-16',
      description: 'USB Type-C receptacle, 16 lands (VBUS, GND, CC1/CC2, DP/DM, SBU1/SBU2), 0.65 mm pitch',
      category: 'connector',
      pads: usbCPads,
      dimensions: { width: 8.34, height: 7.3 },
      bodyHeightMm: 3.2,
      metadata: { ipcStandard: 'IPC-7341', thermalPad: false },
    });

    // M.2 2280 socket, Key-M card edge: 0.5 mm pitch positions that alternate
    // between the two faces of the card, fourteen lands per face. This pattern
    // carries the 28 positions a two-layer demo board connects; a production
    // Key-M socket lands the full signal complement.
    const m2Pads: FootprintPad[] = [];
    for (let position = 0; position < 28; position++) {
      m2Pads.push({
        id: `pad${position + 1}`,
        shape: 'rectangle',
        position: { x: (position - 13.5) * 0.5, y: position % 2 === 0 ? 0.55 : -0.55 },
        size: { width: 0.3, height: 1.0 },
        layers: ['top_copper'],
      });
    }
    this.addFootprint({
      id: 'm2_2280',
      name: 'M.2-2280-KM',
      description: 'M.2 2280 Key-M card-edge socket, 28 lands at 0.5 mm pitch',
      category: 'connector',
      pads: m2Pads,
      dimensions: { width: 22.6, height: 8.9 },
      bodyHeightMm: 2.6,
      metadata: { ipcStandard: 'IPC-7341', thermalPad: false },
    });

    // CR2032 coin cell in a keyed holder — the board keeps its RTC alive through
    // a battery swap or a flat main pack.
    this.addFootprint({
      id: 'coin_cr2032',
      name: 'CR2032-KEYED',
      description: 'CR2032 20 mm coin cell in a two-terminal keyed holder',
      category: 'battery',
      pads: [
        { id: 'pad1', shape: 'rectangle', position: { x: -8.9, y: 0 }, size: { width: 3.0, height: 3.5 }, layers: ['top_copper'] },
        { id: 'pad2', shape: 'rectangle', position: { x: 8.9, y: 0 }, size: { width: 3.0, height: 3.5 }, layers: ['top_copper'] },
      ],
      dimensions: { width: 20.0, height: 20.0 },
      bodyHeightMm: 3.2,
      metadata: { ipcStandard: 'IPC-7341', thermalPad: false },
    });

    // Connector footprints. Pads are centred on the footprint origin so the
    // silkscreen outline and the 3-D body sit over the copper they belong to.
    ['header_1x1', 'header_1x2', 'header_1x3', 'header_1x4', 'header_1x6', 'header_1x8',
     'header_2x1', 'header_2x2', 'header_2x3', 'header_2x4'].forEach(type => {
      const match = type.match(/header_(\d+)x(\d+)/);
      const columns = match ? parseInt(match[1]) : 1;
      const rows = match ? parseInt(match[2]) : 1;
      const pitch = 2.54;
      const pads: FootprintPad[] = [];

      // Number pins the way the package does: down each column, left to right.
      let number = 1;
      for (let col = 0; col < columns; col++) {
        for (let row = 0; row < rows; row++) {
          pads.push({
            id: `pad${number}`,
            shape: 'circle',
            position: {
              x: (col - (columns - 1) / 2) * pitch,
              y: (row - (rows - 1) / 2) * pitch,
            },
            size: { width: 1.7, height: 1.7 },
            drillDiameter: 1.0,
            layers: ['top_copper', 'bottom_copper'],
          });
          number++;
        }
      }

      this.addFootprint({
        id: type,
        name: type.replace(/_/g, ' ').toUpperCase(),
        description: `${columns}x${rows} pin header connector`,
        category: 'connector',
        pads,
        dimensions: {
          width: (columns - 1) * pitch + 3,
          height: (rows - 1) * pitch + 3,
        },
        // A shrouded box over the pin array: what the eye expects to see on a
        // through-hole header, not a 2.6 mm sliver.
        bodyHeightMm: 9.0,
        metadata: {
          ipcStandard: 'IPC-7351',
          thermalPad: false
        }
      });
    });
  }

  /**
   * TQFP-32, 7 x 7 mm body at 0.8 mm pitch, per IPC-7351's gull-wing pattern.
   *
   * The lands reach from just inside the body edge out to the toe, which is what
   * keeps the corner pair legal: rows that stop at +/-2.8 mm and lands whose heel
   * starts at 3.3 mm leave 0.35 mm diagonally between the last land of one side
   * and the first of the next. Lands centred on the body edge instead overlap each
   * other at all four corners, which is a short between two different nets and
   * walls those pins in — the autorouter cannot escape a land whose own corner is
   * buried in a neighbour's copper. `footprintLibrary.test.ts` measures the gap.
   */
  private generateQFP32Pads(): FootprintPad[] {
    const pads: FootprintPad[] = [];
    const padCount = 8; // 8 pads per side
    const pitch = 0.8; // 0.8mm pitch
    const start = -((padCount - 1) / 2) * pitch; // -2.8, so each row is centred
    const heel = 3.3; // under the lead's bend, still inside the body outline
    const toe = 4.4; // where the lead lands on the pad
    const land = toe - heel;
    const centre = heel + land / 2;
    const landWidth = 0.3;

    // Bottom side (1-8), left to right
    for (let i = 0; i < padCount; i++) {
      pads.push({
        id: `pad${i + 1}`,
        shape: 'rectangle',
        position: { x: start + i * pitch, y: -centre },
        size: { width: landWidth, height: land },
        layers: ['top_copper']
      });
    }

    // Right side (9-16), bottom to top
    for (let i = 0; i < padCount; i++) {
      pads.push({
        id: `pad${i + 9}`,
        shape: 'rectangle',
        position: { x: centre, y: start + i * pitch },
        size: { width: land, height: landWidth },
        layers: ['top_copper']
      });
    }

    // Top side (17-24), right to left
    for (let i = 0; i < padCount; i++) {
      pads.push({
        id: `pad${i + 17}`,
        shape: 'rectangle',
        position: { x: start + (padCount - 1 - i) * pitch, y: centre },
        size: { width: landWidth, height: land },
        layers: ['top_copper']
      });
    }

    // Left side (25-32), top to bottom
    for (let i = 0; i < padCount; i++) {
      pads.push({
        id: `pad${i + 25}`,
        shape: 'rectangle',
        position: { x: -centre, y: start + (padCount - 1 - i) * pitch },
        size: { width: land, height: landWidth },
        layers: ['top_copper']
      });
    }

    return pads;
  }

  addFootprint(footprint: Footprint): void {
    this.footprints.set(footprint.id, footprint);
  }

  getFootprint(id: string): Footprint | undefined {
    return this.footprints.get(id);
  }

  getFootprintsByCategory(category: string): Footprint[] {
    return Array.from(this.footprints.values()).filter(fp => fp.category === category);
  }

  searchFootprints(query: string): Footprint[] {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.footprints.values()).filter(fp =>
      fp.name.toLowerCase().includes(lowerQuery) ||
      fp.description.toLowerCase().includes(lowerQuery) ||
      fp.category.toLowerCase().includes(lowerQuery)
    );
  }

  getAllFootprints(): Footprint[] {
    return Array.from(this.footprints.values());
  }

  validateFootprint(footprint: Footprint): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!footprint.name) errors.push('Footprint name is required');
    if (!footprint.category) errors.push('Footprint category is required');
    if (footprint.pads.length === 0) errors.push('Footprint must have at least one pad');

    footprint.pads.forEach((pad, index) => {
      if (!pad.id) errors.push(`Pad ${index + 1} is missing ID`);
      if (pad.size.width <= 0 || pad.size.height <= 0) {
        errors.push(`Pad ${pad.id} has invalid size`);
      }
      if (pad.drillDiameter && pad.drillDiameter >= pad.size.width) {
        errors.push(`Pad ${pad.id} drill diameter is too large for pad size`);
      }
    });

    return { isValid: errors.length === 0, errors };
  }

  exportFootprintToJSON(footprint: Footprint): string {
    return JSON.stringify(footprint, null, 2);
  }

  importFootprintFromJSON(jsonString: string): Footprint | null {
    try {
      const footprint = JSON.parse(jsonString) as Footprint;
      const validation = this.validateFootprint(footprint);
      if (validation.isValid) {
        this.addFootprint(footprint);
        return footprint;
      } else {
        console.error('Invalid footprint:', validation.errors);
        return null;
      }
    } catch (error) {
      console.error('Failed to parse footprint JSON:', error);
      return null;
    }
  }
}

export const footprintLibrary = new FootprintLibrary();

/**
 * Resolution order: exact footprint id, footprint name, the nominal pattern for
 * the package the string names, then the family category.
 *
 * The generated step is what keeps a datasheet part usable: without it a 16-pin
 * isolator resolves to nothing and reaches the board as a body with no copper
 * lands, which the router cannot connect and a fabricator cannot read.
 *
 * The category step is a last resort for a part whose name says nothing about a
 * package, and it is only allowed when the land count matches the symbol. A
 * 16-pin part handed an 8-land SOIC loses eight nets silently, and a board whose
 * nets have vanished routes into shapes nobody asked for — a warning and no
 * copper is the better answer. It is also refused for a package this CAD
 * deliberately does not pattern (a TO-220, a module castellation ring): dressing
 * a through-hole regulator in an SOT-23's reflow lands is a wrong footprint that
 * passes a pad-count check.
 */
export function resolveFootprint(
  footprint: string,
  category?: string,
  padCount?: number,
): Footprint | undefined {
  const direct = footprintLibrary.getFootprint(footprint)
  if (direct) return direct
  const byName = footprintLibrary
    .getAllFootprints()
    .find((entry) => entry.name.toLowerCase() === footprint.toLowerCase())
  if (byName) return byName
  const generated = generatedFootprint(footprint, padCount)
  if (generated) return generated
  if (category && !declaresUnpatternedPackage(footprint)) {
    const byCategory = footprintLibrary
      .getFootprintsByCategory(category)
      .find((entry) => padCount === undefined || entry.pads.length === padCount)
    if (byCategory) return byCategory
  }
  return undefined
}