import { describe, expect, it } from 'vitest';
import { lookupVendorModel } from '../simulation/vendorModels';
import {
  BUCK_TPS5430,
  BUCK_TPS54331,
  LDO_TPS7A4700,
  REG_AMS1117_33,
  REG_LM317MPX,
  REG_LM317T,
  REG_LM7805,
  REG_LM7812,
  STANDARD_POWER_PARTS,
  powerByPartNumber,
} from './powerManagement';

describe('regulator and converter pinouts', () => {
  it('numbers every pin 1..N and cites a document that was opened', () => {
    for (const part of STANDARD_POWER_PARTS) {
      expect(part.pins).toHaveLength(part.pinCount);
      expect(part.pins.map((p) => p.number)).toEqual(
        Array.from({ length: part.pinCount }, (_, i) => i + 1),
      );
      expect(part.datasheetUrl).toMatch(/^https?:\/\//);
      expect(part.ioutA).toBeGreaterThan(0);
      expect(part.vinMaxV).toBeGreaterThan(0);
    }
  });

  it('names only SPICE subcircuits the solver actually carries', () => {
    const modelled = STANDARD_POWER_PARTS.filter((p) => p.spiceModel);
    for (const part of modelled) {
      expect(lookupVendorModel(part.spiceModel as string), part.partNumber).toBeDefined();
    }
    // Only these three have a model in the deck library, so no row may claim more.
    expect(modelled.map((p) => p.partNumber).sort()).toEqual(['LM317MPX', 'LM317T', 'LM7805']);
  });

  it('distinguishes the 78xx from the LM317 by ground position, which is the swap that fries boards', () => {
    expect(REG_LM7805.pins.map((p) => p.name)).toEqual(['INPUT', 'GND', 'OUTPUT']);
    expect(REG_LM7812.pins.map((p) => p.name)).toEqual(['INPUT', 'GND', 'OUTPUT']);
    expect(REG_LM317T.pins.map((p) => p.name)).toEqual(['ADJUST', 'OUTPUT', 'INPUT']);
    expect(REG_LM7805.vout).toBe('5 V');
    expect(REG_LM7812.vout).toBe('12 V');
    expect(REG_LM317T.vout).toMatch(/1\.25 V to 37 V/);
  });

  it('adds the SOT-223 tab as a fourth pin carrying the output, not a fifth supply', () => {
    expect(REG_LM317MPX.pinCount).toBe(4);
    const byNumber = new Map(REG_LM317MPX.pins.map((p) => [p.number, p.name]));
    expect(byNumber.get(4)).toBe('OUTPUT');
    expect(byNumber.get(2)).toBe('OUTPUT');
    expect(REG_LM317MPX.keyRating).toMatch(/tab/i);
  });

  it('grounds pin 1 on the fixed AMS1117 and flags that the adjustable one uses it differently', () => {
    expect(REG_AMS1117_33.pins.map((p) => p.name)).toEqual(['GROUND', 'VOUT', 'VIN']);
    expect(REG_AMS1117_33.description).toMatch(/adjust/i);
  });

  it('keeps the two TI bucks on different pin maps instead of pretending they are one footprint', () => {
    expect(BUCK_TPS54331.pins.map((p) => p.name)).not.toEqual(BUCK_TPS5430.pins.map((p) => p.name));
    // Both switch on pin 8 and boot-strap on pin 1, which is what a designer reuses.
    expect(BUCK_TPS54331.pins[0].name).toBe('BOOT');
    expect(BUCK_TPS5430.pins[0].name).toBe('BOOT');
    expect(new Map(BUCK_TPS54331.pins.map((p) => [p.number, p.name])).get(8)).toBe('PH');
    expect(new Map(BUCK_TPS5430.pins.map((p) => [p.number, p.name])).get(8)).toBe('PH');
    expect(BUCK_TPS5430.pins.filter((p) => p.name === 'NC')).toHaveLength(2);
    expect(BUCK_TPS5430.pins[8].name).toBe('DAP');
  });

  it('spreads the TPS7A4700 output across three pins and grounds the exposed pad', () => {
    const names = LDO_TPS7A4700.pins.map((p) => p.name);
    expect(names.filter((n) => n === 'OUT')).toHaveLength(3);
    expect(names.filter((n) => n === 'IN')).toHaveLength(2);
    expect(LDO_TPS7A4700.pins[6].name).toBe('GND');
    expect(LDO_TPS7A4700.keyRating).toMatch(/exposed pad is ground/i);
  });

  it('looks regulators up by part number and refuses unknown ones', () => {
    expect(powerByPartNumber('LM7805')).toBe(REG_LM7805);
    expect(powerByPartNumber('TPS54331DR')).toBe(BUCK_TPS54331);
    expect(() => powerByPartNumber('LM9999')).toThrow(/Unknown power part/);
  });
});
