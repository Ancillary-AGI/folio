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
    expect(parsed.pins.find((p) => p.name === 'VDD')?.kind).toBe('power');
    expect(parsed.pins.find((p) => p.name === 'DGND')?.kind).toBe('ground');
  });

  it('synthesizes schematic symbol, IPC-7351 footprint, and SPICE macromodel', () => {
    const raw = `
      MPN: NE555D
      Manufacturer: Texas Instruments
      Description: Precision Timer
      Supply Voltage: 4.5V to 16.0V
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

    // SPICE subcircuit check
    expect(synthesized.spiceSubcircuit).toContain('.SUBCKT NE555D');
    expect(synthesized.spiceSubcircuit).toContain('.ENDS NE555D');
  });

  it('rejects empty datasheet text', () => {
    expect(() => parseDatasheetText('')).toThrow(/empty/);
  });
});
