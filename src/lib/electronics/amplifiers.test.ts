import { describe, expect, it } from 'vitest';
import { lookupVendorModel } from '../simulation/vendorModels';
import {
  AMP_ADA4528_2,
  AMP_INA128,
  AMP_INA180,
  AMP_LM358,
  AMP_OPA2134,
  AMP_TL072,
  CMP_LM393,
  CMP_TLV3501,
  STANDARD_AMPLIFIERS,
  amplifierByPartNumber,
} from './amplifiers';

describe('amplifier and comparator pinouts', () => {
  it('numbers every pin 1..N and cites a document that was opened', () => {
    for (const part of STANDARD_AMPLIFIERS) {
      expect(part.pins).toHaveLength(part.pinCount);
      expect(part.pins.map((p) => p.number)).toEqual(
        Array.from({ length: part.pinCount }, (_, i) => i + 1),
      );
      expect(part.datasheetUrl).toMatch(/^https?:\/\//);
      expect(part.package.length).toBeGreaterThan(2);
      expect(part.supplyRange.length).toBeGreaterThan(2);
    }
  });

  it('names only SPICE subcircuits the solver actually carries', () => {
    for (const part of STANDARD_AMPLIFIERS.filter((p) => p.spiceModel)) {
      expect(lookupVendorModel(part.spiceModel as string), part.partNumber).toBeDefined();
    }
    expect(STANDARD_AMPLIFIERS.filter((p) => p.spiceModel).length).toBeGreaterThan(0);
  });

  it('puts the lowest supply on pin 4 of every 8-pin dual, so single-supply wiring works', () => {
    const byNumber = (spec: typeof AMP_LM358) => new Map(spec.pins.map((p) => [p.number, p]));
    for (const spec of [AMP_LM358, AMP_TL072, AMP_OPA2134, CMP_LM393]) {
      const pins = byNumber(spec);
      expect(pins.get(4)?.kind, spec.partNumber).toBe('power');
      expect(pins.get(4)?.name, spec.partNumber).toMatch(/^(V-|GND|VCC-)$/);
      expect(pins.get(8)?.kind, spec.partNumber).toBe('power');
      expect(pins.get(8)?.name, spec.partNumber).toMatch(/^(V\+|VCC|VCC\+)$/);
    }
    // The instrumentation amp reuses that body but not that map: pin 8 is its gain
    // resistor port, so its positive rail has to move to pin 7.
    const ina = byNumber(AMP_INA128);
    expect(ina.get(4)?.name).toBe('V-');
    expect(ina.get(7)?.name).toBe('V+');
    expect(ina.get(8)?.name).toBe('RG');
  });

  it('mirrors the second channel on 5-7 rather than repeating the first', () => {
    const names = AMP_LM358.pins.map((p) => p.name);
    expect(names.slice(0, 3)).toEqual(['OUT1', 'IN1-', 'IN1+']);
    expect(names.slice(4, 7)).toEqual(['IN2+', 'IN2-', 'OUT2']);
    // The TL072 is the same physical layout with its own rail labels.
    expect(AMP_TL072.pins.map((p) => p.kind)).toEqual(AMP_LM358.pins.map((p) => p.kind));
  });

  it('leaves both gain pins of the INA128 unnumbered as supply, because RG is a resistor port', () => {
    const byNumber = new Map(AMP_INA128.pins.map((p) => [p.number, p]));
    expect(byNumber.get(1)?.name).toBe('RG');
    expect(byNumber.get(8)?.name).toBe('RG');
    expect(byNumber.get(1)?.kind).toBe('passive');
    expect(byNumber.get(5)?.name).toBe('REF');
    expect(byNumber.get(6)?.name).toBe('VO');
  });

  it('keeps the INA180 A-grade pinout distinct from the mirrored B-grade one', () => {
    const byNumber = new Map(AMP_INA180.pins.map((p) => [p.number, p]));
    expect(byNumber.get(1)?.name).toBe('OUT');
    expect(byNumber.get(2)?.name).toBe('GND');
    expect(byNumber.get(5)?.name).toBe('VS');
    // The document warns about this, so the row has to say it too.
    expect(AMP_INA180.description).toMatch(/B-grade|mirrored/i);
  });

  it('gives the SOT-23-6 comparator a shutdown pin and an open-collector comparator a pull-up warning', () => {
    expect(CMP_TLV3501.pins.map((p) => p.name)).toEqual([
      '-IN', 'V-', '+IN', 'V+', 'OUT', 'SHDN',
    ]);
    expect(CMP_LM393.keyRating).toMatch(/pull-up/i);
  });

  it('does not claim an SO-8 footprint for the part that only ships MSOP or LFCSP', () => {
    expect(AMP_ADA4528_2.package).not.toMatch(/SO-8|SOIC-8/);
    expect(AMP_ADA4528_2.supplyRange).toMatch(/2\.2 V to 5\.5 V/);
  });

  it('looks parts up by the number a purchaser types and refuses unknown ones', () => {
    expect(amplifierByPartNumber('LM358')).toBe(AMP_LM358);
    expect(amplifierByPartNumber('INA180A1')).toBe(AMP_INA180);
    expect(() => amplifierByPartNumber('LM99999')).toThrow(/Unknown amplifier part/);
  });
});
