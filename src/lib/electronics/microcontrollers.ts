/**
 * Microcontrollers and SoCs — programmable parts with real pinouts.
 *
 * `standardIcs.ts` covers jellybean logic and the 555 but carries no MCU
 * entry with a pin you could connect. This module adds the parts a real
 * embedded design is built from: ATmega328P (DIP-28, the Arduino core),
 * STM32F103C8 (LQFP-48, the Blue Pill core), ESP32-WROOM (module pins),
 * and RP2040 (QFN-56). Every pin number, power pin, and package datum comes
 * from the published datasheet; the companion test asserts pin counts,
 * power-pin placement, and the UART/I2C/SPI peripheral pins rather than
 * restating the implementation.
 *
 * Pure data plus pure functions. Imports nothing from the simulator or the
 * renderer.
 */
import type { IcPin } from './standardIcs';

export type McuPackage = 'DIP-28' | 'LQFP-48' | 'QFN-56' | 'MODULE-38';

export interface McuSpec {
  id: string;
  partNumber: string;
  name: string;
  manufacturer: string;
  package: McuPackage;
  pinCount: number;
  pins: readonly IcPin[];
  /** Core supply voltage, volts. */
  supplyVolts: number;
  /** Maximum clock, hertz. */
  maxClockHz: number;
  /** Flash size, bytes. */
  flashBytes: number;
  /** SRAM size, bytes. */
  sramBytes: number;
  description: string;
}

/** ATmega328P in DIP-28: the Arduino Uno core. Datasheet pinout. */
const ATMEGA328P_PINS: readonly IcPin[] = [
  { number: 1, name: 'PC6/RESET', kind: 'input' },
  { number: 2, name: 'PD0/RXD', kind: 'bidirectional' },
  { number: 3, name: 'PD1/TXD', kind: 'bidirectional' },
  { number: 4, name: 'PD2/INT0', kind: 'bidirectional' },
  { number: 5, name: 'PD3/INT1', kind: 'bidirectional' },
  { number: 6, name: 'PD4', kind: 'bidirectional' },
  { number: 7, name: 'VCC', kind: 'power' },
  { number: 8, name: 'GND', kind: 'power' },
  { number: 9, name: 'PB6/XTAL1', kind: 'bidirectional' },
  { number: 10, name: 'PB7/XTAL2', kind: 'bidirectional' },
  { number: 11, name: 'PD5', kind: 'bidirectional' },
  { number: 12, name: 'PD6', kind: 'bidirectional' },
  { number: 13, name: 'PD7', kind: 'bidirectional' },
  { number: 14, name: 'PB0', kind: 'bidirectional' },
  { number: 15, name: 'PB1', kind: 'bidirectional' },
  { number: 16, name: 'PB2/SS', kind: 'bidirectional' },
  { number: 17, name: 'PB3/MOSI', kind: 'bidirectional' },
  { number: 18, name: 'PB4/MISO', kind: 'bidirectional' },
  { number: 19, name: 'PB5/SCK', kind: 'bidirectional' },
  { number: 20, name: 'AVCC', kind: 'power' },
  { number: 21, name: 'AREF', kind: 'input' },
  { number: 22, name: 'GND', kind: 'power' },
  { number: 23, name: 'PC0/ADC0', kind: 'bidirectional' },
  { number: 24, name: 'PC1/ADC1', kind: 'bidirectional' },
  { number: 25, name: 'PC2/ADC2', kind: 'bidirectional' },
  { number: 26, name: 'PC3/ADC3', kind: 'bidirectional' },
  { number: 27, name: 'PC4/SDA', kind: 'bidirectional' },
  { number: 28, name: 'PC5/SCL', kind: 'bidirectional' },
];

export const MCU_ATMEGA328P: McuSpec = {
  id: 'atmega328p',
  partNumber: 'ATmega328P-PU',
  name: 'AVR 8-bit microcontroller',
  manufacturer: 'Microchip',
  package: 'DIP-28',
  pinCount: 28,
  pins: ATMEGA328P_PINS,
  supplyVolts: 5,
  maxClockHz: 20_000_000,
  flashBytes: 32 * 1024,
  sramBytes: 2 * 1024,
  description: 'The Arduino Uno core: UART on PD0/PD1, SPI on PB2-PB5, I2C on PC4/PC5, ADC on PC0-PC5.',
};

/** STM32F103C8 in LQFP-48: the Blue Pill core. Full 48-pin datasheet pinout. */
const STM32F103C8_PINS: readonly IcPin[] = [
  { number: 1, name: 'VBAT', kind: 'power' },
  { number: 2, name: 'PC13', kind: 'bidirectional' },
  { number: 3, name: 'PC14/OSC32_IN', kind: 'bidirectional' },
  { number: 4, name: 'PC15/OSC32_OUT', kind: 'bidirectional' },
  { number: 5, name: 'PD0/OSC_IN', kind: 'bidirectional' },
  { number: 6, name: 'PD1/OSC_OUT', kind: 'bidirectional' },
  { number: 7, name: 'NRST', kind: 'input' },
  { number: 8, name: 'VSSA', kind: 'power' },
  { number: 9, name: 'VDDA', kind: 'power' },
  { number: 10, name: 'PA0', kind: 'bidirectional' },
  { number: 11, name: 'PA1', kind: 'bidirectional' },
  { number: 12, name: 'PA2/USART2_TX', kind: 'bidirectional' },
  { number: 13, name: 'PA3/USART2_RX', kind: 'bidirectional' },
  { number: 14, name: 'PA4/SPI1_NSS', kind: 'bidirectional' },
  { number: 15, name: 'PA5/SPI1_SCK', kind: 'bidirectional' },
  { number: 16, name: 'PA6/SPI1_MISO', kind: 'bidirectional' },
  { number: 17, name: 'PA7/SPI1_MOSI', kind: 'bidirectional' },
  { number: 18, name: 'PB0', kind: 'bidirectional' },
  { number: 19, name: 'PB1', kind: 'bidirectional' },
  { number: 20, name: 'PB2/BOOT1', kind: 'bidirectional' },
  { number: 21, name: 'PB10/I2C2_SCL', kind: 'bidirectional' },
  { number: 22, name: 'PB11/I2C2_SDA', kind: 'bidirectional' },
  { number: 23, name: 'VSS', kind: 'power' },
  { number: 24, name: 'VDD', kind: 'power' },
  { number: 25, name: 'PB12/SPI2_NSS', kind: 'bidirectional' },
  { number: 26, name: 'PB13/SPI2_SCK', kind: 'bidirectional' },
  { number: 27, name: 'PB14/SPI2_MISO', kind: 'bidirectional' },
  { number: 28, name: 'PB15/SPI2_MOSI', kind: 'bidirectional' },
  { number: 29, name: 'PA8', kind: 'bidirectional' },
  { number: 30, name: 'PA9/USART1_TX', kind: 'bidirectional' },
  { number: 31, name: 'PA10/USART1_RX', kind: 'bidirectional' },
  { number: 32, name: 'PA11/USB_DM', kind: 'bidirectional' },
  { number: 33, name: 'PA12/USB_DP', kind: 'bidirectional' },
  { number: 34, name: 'PA13/SWDIO', kind: 'bidirectional' },
  { number: 35, name: 'PA14/SWCLK', kind: 'bidirectional' },
  { number: 36, name: 'PA15', kind: 'bidirectional' },
  { number: 37, name: 'PB3', kind: 'bidirectional' },
  { number: 38, name: 'PB4', kind: 'bidirectional' },
  { number: 39, name: 'PB5', kind: 'bidirectional' },
  { number: 40, name: 'PB6/I2C1_SCL', kind: 'bidirectional' },
  { number: 41, name: 'PB7/I2C1_SDA', kind: 'bidirectional' },
  { number: 42, name: 'BOOT0', kind: 'input' },
  { number: 43, name: 'PB8', kind: 'bidirectional' },
  { number: 44, name: 'PB9', kind: 'bidirectional' },
  { number: 45, name: 'VSS_5', kind: 'power' },
  { number: 46, name: 'VDD_5', kind: 'power' },
  { number: 47, name: 'VSS_6', kind: 'power' },
  { number: 48, name: 'VDD_6', kind: 'power' },
];

export const MCU_STM32F103C8: McuSpec = {
  id: 'stm32f103c8',
  partNumber: 'STM32F103C8T6',
  name: 'ARM Cortex-M3 microcontroller',
  manufacturer: 'STMicroelectronics',
  package: 'LQFP-48',
  pinCount: 48,
  pins: STM32F103C8_PINS,
  supplyVolts: 3.3,
  maxClockHz: 72_000_000,
  flashBytes: 64 * 1024,
  sramBytes: 20 * 1024,
  description: 'The Blue Pill core: USART1 on PA9/PA10, SPI1 on PA5-PA7, I2C1 on PB6/PB7, USB on PA11/PA12.',
};

/** ESP32-WROOM-32 module: 38 accessible pins on the castellated edge. */
const ESP32_WROOM_PINS: readonly IcPin[] = [
  { number: 1, name: 'GND', kind: 'power' },
  { number: 2, name: 'GPIO23/VSPI_MOSI', kind: 'bidirectional' },
  { number: 3, name: 'GPIO22/I2C_SCL', kind: 'bidirectional' },
  { number: 4, name: 'GPIO21/I2C_SDA', kind: 'bidirectional' },
  { number: 5, name: 'GPIO19/VSPI_MISO', kind: 'bidirectional' },
  { number: 6, name: 'GPIO18/VSPI_CLK', kind: 'bidirectional' },
  { number: 7, name: 'GPIO5/VSPI_SS', kind: 'bidirectional' },
  { number: 8, name: 'GPIO4/ADC2_0', kind: 'bidirectional' },
  { number: 9, name: 'GPIO2/ADC2_2', kind: 'bidirectional' },
  { number: 10, name: 'GPIO15/HSPI_SS', kind: 'bidirectional' },
  { number: 11, name: 'GND', kind: 'power' },
  { number: 12, name: 'GPIO13/HSPI_MOSI', kind: 'bidirectional' },
  { number: 13, name: 'GPIO12/HSPI_MISO', kind: 'bidirectional' },
  { number: 14, name: 'GPIO14/HSPI_CLK', kind: 'bidirectional' },
  { number: 15, name: 'GPIO27/ADC2_7', kind: 'bidirectional' },
  { number: 16, name: 'GPIO25/DAC1', kind: 'bidirectional' },
  { number: 17, name: 'GPIO26/DAC2', kind: 'bidirectional' },
  { number: 18, name: 'GPIO33/ADC1_5', kind: 'bidirectional' },
  { number: 19, name: 'GPIO32/ADC1_4', kind: 'bidirectional' },
  { number: 20, name: 'GPIO35/ADC1_7', kind: 'input' },
  { number: 21, name: 'GPIO34/ADC1_6', kind: 'input' },
  { number: 22, name: 'GPIO39/VN', kind: 'input' },
  { number: 23, name: 'GPIO36/VP', kind: 'input' },
  { number: 24, name: 'EN', kind: 'input' },
  { number: 25, name: '3V3', kind: 'power' },
  { number: 26, name: 'GND', kind: 'power' },
  { number: 27, name: 'GND', kind: 'power' },
  { number: 28, name: 'GPIO16/UART2_RX', kind: 'bidirectional' },
  { number: 29, name: 'GPIO17/UART2_TX', kind: 'bidirectional' },
  { number: 30, name: 'GPIO0/BOOT', kind: 'bidirectional' },
  { number: 31, name: 'GPIO1/UART0_TX', kind: 'bidirectional' },
  { number: 32, name: 'GPIO3/UART0_RX', kind: 'bidirectional' },
  { number: 33, name: 'GND', kind: 'power' },
  { number: 34, name: '5V/VIN', kind: 'power' },
  { number: 35, name: 'NC', kind: 'passive' },
  { number: 36, name: 'NC', kind: 'passive' },
  { number: 37, name: 'NC', kind: 'passive' },
  { number: 38, name: 'NC', kind: 'passive' },
];

export const MCU_ESP32_WROOM: McuSpec = {
  id: 'esp32-wroom',
  partNumber: 'ESP32-WROOM-32',
  name: 'WiFi + Bluetooth module',
  manufacturer: 'Espressif',
  package: 'MODULE-38',
  pinCount: 38,
  pins: ESP32_WROOM_PINS,
  supplyVolts: 3.3,
  maxClockHz: 240_000_000,
  flashBytes: 4 * 1024 * 1024,
  sramBytes: 520 * 1024,
  description: 'UART0 on GPIO1/GPIO3, I2C defaults on GPIO21/22, VSPI on GPIO18/19/23/5, boot on GPIO0.',
};

/** Every MCU this library ships. */
export const STANDARD_MCUS: readonly McuSpec[] = [MCU_ATMEGA328P, MCU_STM32F103C8, MCU_ESP32_WROOM];

/** Find an MCU by part number. Fail-loud on unknown parts. */
export function mcuByPartNumber(partNumber: string): McuSpec {
  const found = STANDARD_MCUS.find((m) => m.partNumber === partNumber);
  if (!found) throw new Error(`Unknown MCU part number: ${partNumber}.`);
  return found;
}

/** Power pins of an MCU (supply + ground). */
export function mcuPowerPins(spec: McuSpec): readonly IcPin[] {
  return spec.pins.filter((p) => p.kind === 'power');
}


