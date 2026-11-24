import { describe, expect, it } from 'vitest';
import {
  parseDatasheetText,
  synthesizeComponentFromDatasheet,
} from './datasheetParser';

describe('AI Datasheet-to-Component Ingestion', () => {
  it('parses structured datasheet text and extracts pins and electrical limits', () => {
    const rawDatasheet = `
      MPN: MCP3008-I/SL
      Manufacturer: Microchip Technology
      Description: 8-Channel 10-Bit ADC with SPI Interface
      Supply Voltage: 2.7V to 5.5V

      Pinout Table:
      | 1 | CH0 | Analog Input |
      | 2 | CH1 | Analog Input |
      | 3 | CH2 | Analog Input |
      | 4 | CH3 | Analog Input |
      | 5 | CH4 | Analog Input |
      | 6 | CH5 | Analog Input |
      | 7 | CH6 | Analog Input |
      | 8 | CH7 | Analog Input |
      | 9 | DGND | Ground |
      | 10 | CS | Input |
      | 11 | DIN | Input |
      | 12 | DOUT | Output |
      | 13 | CLK | Input |
      | 14 | AGND | Ground |
      | 15 | VREF | Input |
      | 16 | VDD | Power |
    `;

    const parsed = parseDatasheetText(rawDatasheet);
    expect(parsed.partNumber).toBe('MCP3008-I/SL');
    expect(parsed.manufacturer).toBe('Microchip Technology');
    expect(parsed.electrical.minSupplyVoltageV).toBe(2.7);
    expect(parsed.electrical.maxSupplyVoltageV).toBe(5.5);
    expect(parsed.pins.length).toBe(16);
    expect(parsed.packaging.packageName).toBe('SOIC-16');
    expect(parsed.packaging.pinCount).toBe(16);
    expect(parsed.packaging.bodyHeightMm).toBeGreaterThan(4.9);
    expect(parsed.pins.find((p) => p.name === 'VDD')?.kind).toBe('power');
    expect(parsed.pins.find((p) => p.name === 'DGND')?.kind).toBe('ground');
    // A two-word description ("Analog Input") must still classify the pin.
    expect(parsed.pins.find((p) => p.name === 'CH0')?.kind).toBe('input');
  });

  it('synthesizes a schematic symbol and a wide-body land pattern, without inventing a SPICE model', () => {
    const raw = `
      MPN: NE555D
      Manufacturer: Texas Instruments
      Description: Precision Timer
      Supply Voltage: 4.5V to 16.0V
      Package: SOIC-8
      | 1 | GND | Ground |
      | 2 | TRIG | Input |
      | 3 | OUT | Output |
      | 4 | RESET | Input |
      | 5 | CONT | Input |
      | 6 | THRES | Input |
      | 7 | DISCH | Output |
      | 8 | VCC | Power |
    `;

    const parsed = parseDatasheetText(raw);
    const synthesized = synthesizeComponentFromDatasheet(parsed);

    // Schematic Symbol check
    expect(synthesized.component.pins.length).toBe(8);
    expect(synthesized.component.symbol_data.paths.length).toBeGreaterThan(0);
    expect(synthesized.component.name).toBe('NE555D');

    // Footprint check
    expect(synthesized.footprint.pads.length).toBe(8);
    expect(synthesized.footprint.courtyard.width).toBeGreaterThan(0);

    // No fabricated electrical model travels with the part.
    expect(synthesized).not.toHaveProperty('spiceSubcircuit');

    // Only stated ratings become declared properties.
    expect(synthesized.component.default_properties.minSupplyV).toBe('4.5');
    expect(synthesized.component.default_properties.maxSupplyV).toBe('16');
  });

  it('states no supply rating when the datasheet states none', () => {
    const parsed = parseDatasheetText('MPN: TEST8\n| 1 | A | Input |\n| 2 | B | Output |');
    const synthesized = synthesizeComponentFromDatasheet(parsed);
    expect(synthesized.component.default_properties).not.toHaveProperty('minSupplyV');
    expect(synthesized.component.default_properties).not.toHaveProperty('maxSupplyV');
  });

  it('marks an unstated package as assumed and honours narrow vs wide bodies', () => {
    const assumed = parseDatasheetText('MPN: TEST8\n| 1 | A | Input |\n| 2 | B | Output |');
    expect(assumed.packaging.packageStated).toBe(false);
    expect(assumed.packaging.bodyWidthMm).toBe(3.9);

    const pins = Array.from({ length: 16 }, (_, i) => `| ${i + 1} | P${i + 1} | Input |`).join('\n');
    const narrow = parseDatasheetText(`MPN: TEST16\nPackage: SOIC-16\n${pins}`);
    expect(narrow.packaging.packageStated).toBe(true);
    expect(narrow.packaging.bodyWidthMm).toBe(3.9);

    const wide = parseDatasheetText(`MPN: TEST16W\nPackage: SOIC-16W\n${pins}`);
    expect(wide.packaging.bodyWidthMm).toBe(7.5);
    const footprint = synthesizeComponentFromDatasheet(wide).footprint;
    const outerEdge = Math.abs(footprint.pads[0].position.x) + footprint.pads[0].size.width / 2;
    expect(outerEdge).toBeGreaterThan(5);
  });

  it('honours an explicit SOIC package line when no pin table is present', () => {
    const parsed = parseDatasheetText('MPN: TEST16\nPackage: SOIC-16\nSupply Voltage: 3V to 5V');
    expect(parsed.packaging.packageName).toBe('SOIC-16');
    expect(parsed.packaging.pinCount).toBe(16);
    expect(parsed.packaging.bodyHeightMm).toBeGreaterThan(4.9);
  });

  it('rejects empty datasheet text', () => {
    expect(() => parseDatasheetText('')).toThrow(/empty/);
  });
});
