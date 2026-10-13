import { describe, expect, it } from 'vitest';
import { IC_24LC256, IC_74HC595, IC_W25Q128, STANDARD_MEMORY, memoryByPartNumber } from './logicMemory';

describe('logic and memory ICs', () => {
  it('numbers every pin 1..N', () => {
    for (const part of STANDARD_MEMORY) {
      expect(part.pins.map((p) => p.number)).toEqual(Array.from({ length: part.pinCount }, (_, i) => i + 1));
    }
  });
  it('gives the 595 shift/latch clocks and the EEPROM its I2C pins', () => {
    const names595 = IC_74HC595.pins.map((p) => p.name);
    expect(names595).toContain('SRCLK');
    expect(names595).toContain('RCLK');
    expect(names595).toContain('SER');
    const eeprom = new Map(IC_24LC256.pins.map((p) => [p.number, p]));
    expect(eeprom.get(5)?.name).toBe('SDA');
    expect(eeprom.get(6)?.name).toBe('SCL');
    expect(IC_24LC256.capacityBits).toBe(262_144);
  });
  it('sizes the SPI flash at 16MB with QSPI-capable pins', () => {
    expect(IC_W25Q128.capacityBits).toBe(134_217_728);
    expect(IC_W25Q128.interface).toBe('SPI');
    expect(IC_W25Q128.supplyVolts).toBe(3.3);
  });
  it('looks parts up and refuses unknown ones', () => {
    expect(memoryByPartNumber('24LC256')).toBe(IC_24LC256);
    expect(() => memoryByPartNumber('NOPE')).toThrow(/Unknown memory/);
  });
});
