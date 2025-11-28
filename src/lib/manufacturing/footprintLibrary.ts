import { Point } from '../../types';

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
        { x: -0.75, y: -0.35 },
        { x: 0.75, y: -0.35 },
        { x: 0.75, y: 0.35 },
        { x: -0.75, y: 0.35 }
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
        { x: -1.0, y: -0.6 },
        { x: 1.0, y: -0.6 },
        { x: 1.0, y: 0.6 },
        { x: -1.0, y: 0.6 }
      ],
      metadata: {
        ipcStandard: 'IPC-7351',
        thermalPad: false
      }
    });

    // IC footprints
    this.addFootprint({
      id: 'soic_8',
      name: 'SOIC-8',
      description: '8-pin Small Outline IC',
      category: 'ic',
      pads: [
        { id: 'pad1', shape: 'rectangle', position: { x: -2.4, y: 1.27 }, size: { width: 0.6, height: 1.5 }, layers: ['top_copper'] },
        { id: 'pad2', shape: 'rectangle', position: { x: -2.4, y: 0.635 }, size: { width: 0.6, height: 1.5 }, layers: ['top_copper'] },
        { id: 'pad3', shape: 'rectangle', position: { x: -2.4, y: -0.635 }, size: { width: 0.6, height: 1.5 }, layers: ['top_copper'] },
        { id: 'pad4', shape: 'rectangle', position: { x: -2.4, y: -1.27 }, size: { width: 0.6, height: 1.5 }, layers: ['top_copper'] },
        { id: 'pad5', shape: 'rectangle', position: { x: 2.4, y: -1.27 }, size: { width: 0.6, height: 1.5 }, layers: ['top_copper'] },
        { id: 'pad6', shape: 'rectangle', position: { x: 2.4, y: -0.635 }, size: { width: 0.6, height: 1.5 }, layers: ['top_copper'] },
        { id: 'pad7', shape: 'rectangle', position: { x: 2.4, y: 0.635 }, size: { width: 0.6, height: 1.5 }, layers: ['top_copper'] },
        { id: 'pad8', shape: 'rectangle', position: { x: 2.4, y: 1.27 }, size: { width: 0.6, height: 1.5 }, layers: ['top_copper'] }
      ],
      dimensions: { width: 5.0, height: 4.0 },
      courtyard: [
        { x: -3.0, y: -2.0 },
        { x: 3.0, y: -2.0 },
        { x: 3.0, y: 2.0 },
        { x: -3.0, y: 2.0 }
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
        { x: -4.0, y: -4.0 },
        { x: 4.0, y: -4.0 },
        { x: 4.0, y: 4.0 },
        { x: -4.0, y: 4.0 }
      ],
      metadata: {
        ipcStandard: 'IPC-7351',
        thermalPad: true
      }
    });

    // Through-hole footprints
    this.addFootprint({
      id: 'dip_8',
      name: 'DIP-8',
      description: '8-pin Dual Inline Package',
      category: 'ic',
      pads: [
        { id: 'pad1', shape: 'circle', position: { x: -3.81, y: 2.54 }, size: { width: 1.5, height: 1.5 }, drillDiameter: 0.8, layers: ['top_copper', 'bottom_copper'] },
        { id: 'pad2', shape: 'circle', position: { x: -3.81, y: 1.27 }, size: { width: 1.5, height: 1.5 }, drillDiameter: 0.8, layers: ['top_copper', 'bottom_copper'] },
        { id: 'pad3', shape: 'circle', position: { x: -3.81, y: 0 }, size: { width: 1.5, height: 1.5 }, drillDiameter: 0.8, layers: ['top_copper', 'bottom_copper'] },
        { id: 'pad4', shape: 'circle', position: { x: -3.81, y: -1.27 }, size: { width: 1.5, height: 1.5 }, drillDiameter: 0.8, layers: ['top_copper', 'bottom_copper'] },
        { id: 'pad5', shape: 'circle', position: { x: 3.81, y: -1.27 }, size: { width: 1.5, height: 1.5 }, drillDiameter: 0.8, layers: ['top_copper', 'bottom_copper'] },
        { id: 'pad6', shape: 'circle', position: { x: 3.81, y: 0 }, size: { width: 1.5, height: 1.5 }, drillDiameter: 0.8, layers: ['top_copper', 'bottom_copper'] },
        { id: 'pad7', shape: 'circle', position: { x: 3.81, y: 1.27 }, size: { width: 1.5, height: 1.5 }, drillDiameter: 0.8, layers: ['top_copper', 'bottom_copper'] },
        { id: 'pad8', shape: 'circle', position: { x: 3.81, y: 2.54 }, size: { width: 1.5, height: 1.5 }, drillDiameter: 0.8, layers: ['top_copper', 'bottom_copper'] }
      ],
      dimensions: { width: 10.16, height: 7.62 },
      courtyard: [
        { x: -5.5, y: -4.0 },
        { x: 5.5, y: -4.0 },
        { x: 5.5, y: 4.0 },
        { x: -5.5, y: 4.0 }
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

    // Connector footprints
    ['header_2x1', 'header_2x2', 'header_2x3', 'header_2x4'].forEach(type => {
      const match = type.match(/header_2x(\d+)/);
      const rows = match ? parseInt(match[1]) : 1;
      const pitch = 2.54;
      const pads: FootprintPad[] = [];

      for (let row = 0; row < rows; row++) {
        pads.push({
          id: `pad_${row}_1`,
          shape: 'circle',
          position: { x: 0, y: row * pitch },
          size: { width: 1.5, height: 1.5 },
          drillDiameter: 1.0,
          layers: ['top_copper', 'bottom_copper']
        });
        pads.push({
          id: `pad_${row}_2`,
          shape: 'circle',
          position: { x: pitch, y: row * pitch },
          size: { width: 1.5, height: 1.5 },
          drillDiameter: 1.0,
          layers: ['top_copper', 'bottom_copper']
        });
      }

      this.addFootprint({
        id: type,
        name: type.replace('_', ' ').toUpperCase(),
        description: `${rows}x2 pin header connector`,
        category: 'connector',
        pads,
        dimensions: { width: pitch + 3, height: (rows - 1) * pitch + 3 },
        metadata: {
          ipcStandard: 'IPC-7351',
          thermalPad: false
        }
      });
    });
  }

  private generateQFP32Pads(): FootprintPad[] {
    const pads: FootprintPad[] = [];
    const padCount = 8; // 8 pads per side
    const pitch = 0.8; // 0.8mm pitch
    const startX = -2.4;
    const startY = -2.4;

    // Bottom side (1-8)
    for (let i = 0; i < padCount; i++) {
      pads.push({
        id: `pad${i + 1}`,
        shape: 'rectangle',
        position: { x: startX + i * pitch, y: -3.0 },
        size: { width: 0.3, height: 1.5 },
        layers: ['top_copper']
      });
    }

    // Right side (9-16)
    for (let i = 0; i < padCount; i++) {
      pads.push({
        id: `pad${i + 9}`,
        shape: 'rectangle',
        position: { x: 3.0, y: startY + i * pitch },
        size: { width: 1.5, height: 0.3 },
        layers: ['top_copper']
      });
    }

    // Top side (17-24)
    for (let i = 0; i < padCount; i++) {
      pads.push({
        id: `pad${i + 17}`,
        shape: 'rectangle',
        position: { x: startX + (padCount - 1 - i) * pitch, y: 3.0 },
        size: { width: 0.3, height: 1.5 },
        layers: ['top_copper']
      });
    }

    // Left side (25-32)
    for (let i = 0; i < padCount; i++) {
      pads.push({
        id: `pad${i + 25}`,
        shape: 'rectangle',
        position: { x: -3.0, y: startY + (padCount - 1 - i) * pitch },
        size: { width: 1.5, height: 0.3 },
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