import { describe, expect, it } from 'vitest';
import {
  S_BME280,
  S_BME680,
  S_BMP280,
  S_DS18B20,
  S_SHT40,
  S_VEML6040,
  STANDARD_SENSORS,
  sensorByPartNumber,
} from './sensors';

describe('sensor pinouts', () => {
  it('numbers every pin 1..N, names the bus, and cites a document that was opened', () => {
    for (const part of STANDARD_SENSORS) {
      expect(part.pins).toHaveLength(part.pinCount);
      expect(part.pins.map((p) => p.number)).toEqual(
        Array.from({ length: part.pinCount }, (_, i) => i + 1),
      );
      expect(part.datasheetUrl).toMatch(/^https?:\/\//);
      expect(part.interfaceKind.length).toBeGreaterThan(2);
      expect(part.supplyRange).toMatch(/VDD|V/);
    }
  });

  it('shares one 8-pin table across the Bosch LGA family so a footprint fits all three', () => {
    const names = S_BME280.pins.map((p) => p.name);
    expect(names).toEqual([
      'GND', 'CSB', 'SDI', 'SCK', 'SDO', 'VDDIO', 'GND', 'VDD',
    ]);
    expect(S_BMP280.pins.map((p) => p.name)).toEqual(names);
    expect(S_BME680.pins.map((p) => p.name)).toEqual(names);
    // Two ground pins and a separate VDDIO is what makes the dual-rail wiring work.
    expect(names.filter((n) => n === 'GND')).toHaveLength(2);
    expect(S_BME280.pins[1].name).toBe('CSB');
  });

  it('treats the SHT40 die pad as a keepout, because it is wired to nothing', () => {
    expect(S_SHT40.pins.map((p) => p.name)).toEqual(['SDA', 'SCL', 'VDD', 'VSS']);
    expect(S_SHT40.interfaceKind).toBe('I2C');
    expect(`${S_SHT40.keyRating} ${S_SHT40.description}`).toMatch(/die pad/i);
  });

  it('orders the VEML6040 as ground-data-clock-supply, the way the package is drawn', () => {
    expect(S_VEML6040.pins.map((p) => p.name)).toEqual(['GND', 'SDAT', 'SCLK', 'VDD']);
    expect(S_VEML6040.pins[1].kind).toBe('bidirectional');
    expect(S_VEML6040.pins[2].kind).toBe('input');
    expect(S_VEML6040.supplyRange).toMatch(/2\.5 V to 3\.6 V/);
  });

  it('gives the 1-Wire thermometer exactly one data pin, in TO-92 order', () => {
    expect(S_DS18B20.pins.map((p) => p.name)).toEqual(['GND', 'DQ', 'VDD']);
    expect(S_DS18B20.pins.filter((p) => p.kind === 'bidirectional')).toHaveLength(1);
    expect(S_DS18B20.interfaceKind).toBe('1-Wire');
    expect(S_DS18B20.keyRating).toMatch(/-55|[−-]55/);
  });

  it('keeps every I2C part with a data and a clock pin', () => {
    for (const part of STANDARD_SENSORS.filter((p) => /I2C/.test(p.interfaceKind))) {
      const names = part.pins.map((p) => p.name);
      expect(names.some((n) => /SDA|SDAT|SDI/.test(n)), part.partNumber).toBe(true);
      expect(names.some((n) => /SCL|SCK/.test(n)), part.partNumber).toBe(true);
    }
  });

  it('looks sensors up by part number and refuses unknown ones', () => {
    expect(sensorByPartNumber('BME280')).toBe(S_BME280);
    expect(sensorByPartNumber('DS18B20')).toBe(S_DS18B20);
    expect(() => sensorByPartNumber('BME9999')).toThrow(/Unknown sensor part/);
  });
});
