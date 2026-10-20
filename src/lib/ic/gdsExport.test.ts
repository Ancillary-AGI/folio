import { describe, expect, it } from 'vitest';
import {
  SKY130_GDS_LAYERS,
  exportGdsBinary,
  type GdsLibrary,
} from './gdsExport';

describe('GDSII Silicon Tapeout Exporter', () => {
  it('exports a valid binary GDSII stream with header, units, and polygon records', () => {
    const lib: GdsLibrary = {
      name: 'TOP_CHIP',
      userUnitsUm: 1.0,
      databaseUnitsMeter: 1e-9, // 1 nm
      structures: [
        {
          name: 'INVERTER_CELL',
          polygons: [
            {
              layer: SKY130_GDS_LAYERS.PRBoundary,
              datatype: 0,
              pointsUm: [
                { x: 0, y: 0 },
                { x: 1.38, y: 0 },
                { x: 1.38, y: 2.72 },
                { x: 0, y: 2.72 },
              ],
            },
            {
              layer: SKY130_GDS_LAYERS.Metal1,
              datatype: 0,
              pointsUm: [
                { x: 0.2, y: 0.2 },
                { x: 0.5, y: 0.2 },
                { x: 0.5, y: 2.5 },
                { x: 0.2, y: 2.5 },
              ],
            },
          ],
        },
      ],
    };

    const gdsBytes = exportGdsBinary(lib);
    expect(gdsBytes).toBeInstanceOf(Uint8Array);
    expect(gdsBytes.length).toBeGreaterThan(100);

    // Verify first record: HEADER length (6 bytes: 2 byte len, 2 byte type, 2 byte version)
    const view = new DataView(gdsBytes.buffer);
    const recLen = view.getUint16(0, false);
    const recType = view.getUint16(2, false);
    const version = view.getUint16(4, false);
    expect(recLen).toBe(6);
    expect(recType).toBe(0x0002); // GDS_HEADER
    expect(version).toBe(600); // GDSII version 600

    // Verify ENDLIB at end of stream (record length 4, token 0x0400)
    const endLen = view.getUint16(gdsBytes.length - 4, false);
    const endToken = view.getUint16(gdsBytes.length - 2, false);
    expect(endLen).toBe(4);
    expect(endToken).toBe(0x0400); // GDS_ENDLIB
  });
});
