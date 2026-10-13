import { describe, expect, it } from 'vitest';
import { MCU_ATMEGA328P, MCU_ESP32_WROOM, MCU_STM32F103C8, STANDARD_MCUS, mcuByPartNumber, mcuPowerPins } from './microcontrollers';

describe('microcontroller pinouts', () => {
  it('numbers every pin 1..N with no gaps or duplicates', () => {
    for (const mcu of STANDARD_MCUS) {
      expect(mcu.pins).toHaveLength(mcu.pinCount);
      const numbers = mcu.pins.map((p) => p.number).sort((a, b) => a - b);
      expect(numbers).toEqual(Array.from({ length: mcu.pinCount }, (_, i) => i + 1));
    }
  });
  it('places ATmega328P power where the datasheet puts it', () => {
    const byNumber = new Map(MCU_ATMEGA328P.pins.map((p) => [p.number, p]));
    expect(byNumber.get(7)?.name).toBe('VCC');
    expect(byNumber.get(8)?.name).toBe('GND');
    expect(byNumber.get(20)?.name).toBe('AVCC');
    expect(byNumber.get(2)?.name).toContain('RXD');
    expect(byNumber.get(27)?.name).toContain('SDA');
    expect(byNumber.get(28)?.name).toContain('SCL');
  });
  it('carries STM32F103C8 SWD, USB, and USART1 on the right pins', () => {
    const byNumber = new Map(MCU_STM32F103C8.pins.map((p) => [p.number, p]));
    expect(byNumber.get(30)?.name).toContain('USART1_TX');
    expect(byNumber.get(34)?.name).toContain('SWDIO');
    expect(byNumber.get(35)?.name).toContain('SWCLK');
    expect(byNumber.get(32)?.name).toContain('USB_DM');
    expect(mcuPowerPins(MCU_STM32F103C8).length).toBeGreaterThanOrEqual(6);
  });
  it('carries ESP32 boot, UART0, and I2C defaults on the right pins', () => {
    const byNumber = new Map(MCU_ESP32_WROOM.pins.map((p) => [p.number, p]));
    expect(byNumber.get(30)?.name).toContain('BOOT');
    expect(byNumber.get(31)?.name).toContain('UART0_TX');
    expect(byNumber.get(3)?.name).toContain('I2C_SCL');
    expect(byNumber.get(4)?.name).toContain('I2C_SDA');
    expect(MCU_ESP32_WROOM.flashBytes).toBe(4 * 1024 * 1024);
  });
  it('looks parts up by part number and refuses unknown ones', () => {
    expect(mcuByPartNumber('ATmega328P-PU')).toBe(MCU_ATMEGA328P);
    expect(mcuByPartNumber('ESP32-WROOM-32')).toBe(MCU_ESP32_WROOM);
    expect(() => mcuByPartNumber('NOPE-9000')).toThrow(/Unknown MCU/);
  });
});
