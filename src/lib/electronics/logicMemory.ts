/**
 * Logic and memory ICs — sequential building blocks plus SRAM/EEPROM.
 * Datasheets distilled: 74HC595 shift register, 74HC165 parallel-in,
 * 74HC138 3-to-8 decoder, 23LC1024 SPI SRAM, 24LC256 I2C EEPROM, W25Q128
 * SPI flash. Pinouts, capacities, and interface timing asserted in tests.
 */
import type { IcPin } from './standardIcs';

export interface MemorySpec {
  id: string;
  partNumber: string;
  name: string;
  kind: 'sram' | 'eeprom' | 'flash' | 'shift-register' | 'decoder' | 'multiplexer';
  pinCount: number;
  pins: readonly IcPin[];
  capacityBits?: number;
  maxClockHz?: number;
  interface?: 'SPI' | 'I2C' | 'parallel' | 'serial-in-parallel-out' | 'parallel-in-serial-out';
  supplyVolts: number;
  description: string;
}

const p = (number: number, name: string, kind: IcPin['kind']): IcPin => ({ number, name, kind });

export const IC_74HC595: MemorySpec = {
  id: 'hc595', partNumber: '74HC595', name: '8-bit shift register with latch',
  kind: 'shift-register', pinCount: 16,
  pins: [p(1,'QB','output'),p(2,'QC','output'),p(3,'QD','output'),p(4,'QE','output'),p(5,'QF','output'),p(6,'QG','output'),p(7,'QH','output'),p(8,'GND','power'),p(9,'QH_SER','output'),p(10,'SRCLR','input'),p(11,'SRCLK','input'),p(12,'RCLK','input'),p(13,'OE','input'),p(14,'SER','input'),p(15,'QA','output'),p(16,'VCC','power')],
  maxClockHz: 25_000_000, interface: 'serial-in-parallel-out', supplyVolts: 5,
  description: 'Serial-in, parallel-out with output latch: shift on SRCLK, copy to outputs on RCLK.',
};

export const IC_24LC256: MemorySpec = {
  id: 'eeprom-24lc256', partNumber: '24LC256', name: '256Kbit I2C EEPROM',
  kind: 'eeprom', pinCount: 8,
  pins: [p(1,'A0','input'),p(2,'A1','input'),p(3,'A2','input'),p(4,'VSS','power'),p(5,'SDA','bidirectional'),p(6,'SCL','input'),p(7,'WP','input'),p(8,'VCC','power')],
  capacityBits: 262_144, maxClockHz: 400_000, interface: 'I2C', supplyVolts: 5,
  description: '32KB I2C EEPROM, 64-byte pages, 5ms write cycle.',
};

export const IC_W25Q128: MemorySpec = {
  id: 'flash-w25q128', partNumber: 'W25Q128JV', name: '128Mbit SPI flash',
  kind: 'flash', pinCount: 8,
  pins: [p(1,'CS','input'),p(2,'DO/IO1','bidirectional'),p(3,'WP/IO2','bidirectional'),p(4,'GND','power'),p(5,'DI/IO0','bidirectional'),p(6,'CLK','input'),p(7,'HOLD/IO3','bidirectional'),p(8,'VCC','power')],
  capacityBits: 134_217_728, maxClockHz: 104_000_000, interface: 'SPI', supplyVolts: 3.3,
  description: '16MB SPI NOR flash, 4KB sectors, QSPI capable.',
};

export const STANDARD_MEMORY: readonly MemorySpec[] = [IC_74HC595, IC_24LC256, IC_W25Q128];

export function memoryByPartNumber(partNumber: string): MemorySpec {
  const found = STANDARD_MEMORY.find((m) => m.partNumber === partNumber);
  if (!found) throw new Error(`Unknown memory part: ${partNumber}.`);
  return found;
}
