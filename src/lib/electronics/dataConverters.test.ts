import { describe, expect, it } from 'vitest';
import {
  ADC_ADS1115,
  DAC_DAC8564,
  DAC_MCP4725,
  REF_REF3025,
  REF_REF3033,
  REF_TL431,
  STANDARD_CONVERTERS,
  converterByPartNumber,
} from './dataConverters';

describe('data converter and reference pinouts', () => {
  it('numbers every pin 1..N and cites a document that was opened', () => {
    for (const part of STANDARD_CONVERTERS) {
      expect(part.pins).toHaveLength(part.pinCount);
      expect(part.pins.map((p) => p.number)).toEqual(
        Array.from({ length: part.pinCount }, (_, i) => i + 1),
      );
      expect(part.datasheetUrl).toMatch(/^https?:\/\//);
      expect(part.supplyRange.length).toBeGreaterThan(2);
    }
  });

  it('puts the four analog inputs of the ADS1115 on consecutive pins 4..7', () => {
    const byNumber = new Map(ADC_ADS1115.pins.map((p) => [p.number, p.name]));
    expect([4, 5, 6, 7].map((n) => byNumber.get(n))).toEqual(['AIN0', 'AIN1', 'AIN2', 'AIN3']);
    expect(byNumber.get(1)).toBe('ADDR');
    // ALERT/RDY is open-drain, so the row has to say what it is, not hide it as a supply.
    expect(ADC_ADS1115.pins[1].name).toBe('ALERT/RDY');
    expect(ADC_ADS1115.pins[1].kind).toBe('output');
    expect(byNumber.get(9)).toBe('SDA');
    expect(byNumber.get(10)).toBe('SCL');
  });

  it('brings all four DAC8564 outputs out, not two of them', () => {
    const outputNames = DAC_DAC8564.pins.filter((p) => p.kind === 'output').map((p) => p.name);
    expect(outputNames.sort()).toEqual(['VOUTA', 'VOUTB', 'VOUTC', 'VOUTD']);
    const byNumber = new Map(DAC_DAC8564.pins.map((p) => [p.number, p.name]));
    expect(byNumber.get(3)).toBe('VREFH/VREFOUT');
    expect(byNumber.get(16)).toBe('LDAC');
  });

  it('gives the six-pin MCP4725 its output on pin 1, where a trim DAC wants to be', () => {
    expect(DAC_MCP4725.pins.map((p) => p.name)).toEqual(['VOUT', 'VSS', 'VDD', 'SDA', 'SCL', 'A0']);
    expect(DAC_MCP4725.family).toBe('dac');
  });

  it('shares one pin table between the REF30xx siblings, because it is one die', () => {
    expect(REF_REF3033.pins.map((p) => p.name)).toEqual(REF_REF3025.pins.map((p) => p.name));
    expect(REF_REF3025.keyRating).toContain('2.5 V');
    expect(REF_REF3033.keyRating).toContain('3.3 V');
  });

  it('labels the TL431 as a shunt device, so nobody treats it as a supply', () => {
    expect(REF_TL431.pins.map((p) => p.name)).toEqual(['CATHODE', 'REF', 'ANODE']);
    expect(REF_TL431.keyRating).toMatch(/shunt/i);
    // The same part in SOT-23-5 numbers differently, and the row says so.
    expect(REF_TL431.description).toMatch(/SOT-23-5/i);
  });

  it('looks converters up by part number and refuses unknown ones', () => {
    expect(converterByPartNumber('ADS1115')).toBe(ADC_ADS1115);
    expect(converterByPartNumber('MCP4725A0T-E/CH')).toBe(DAC_MCP4725);
    expect(() => converterByPartNumber('ADS99999')).toThrow(/Unknown converter part/);
  });
});
