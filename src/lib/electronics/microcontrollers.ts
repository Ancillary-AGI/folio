/**
 * Microcontrollers and modules — programmable parts with real pinouts.
 *
 * `standardIcs.ts` covers jellybean logic and the 555 but carries no MCU entry
 * with a pin you could connect. This module ships the parts an embedded design is
 * actually built from, and every row carries the document its pin table was read
 * from. Where a datasheet's own page could not be opened from here, the row is
 * absent rather than remembered: the STM32F401CC, the nRF54L15 (whose full pin
 * table sits behind distributor bot walls) and any board-level "Uno"-style part,
 * which is an assembly of these components, not a component.
 *
 * Numbers are only recorded where the document was read with them. A module whose
 * supply range, clock or memory was not in the section consulted leaves those
 * fields out — the dock shows what is known and stays quiet about what is not.
 *
 * Pure data plus pure functions. Imports nothing from the simulator or the
 * renderer.
 */
import type { IcPin } from './standardIcs';

export interface McuSpec {
  id: string;
  partNumber: string;
  name: string;
  manufacturer: string;
  /** Package as the datasheet names it: `DIP-28`, `LQFP-48`, `MODULE-38`, … */
  package: string;
  pinCount: number;
  pins: readonly IcPin[];
  /** Core supply, volts or a rail range — only when the document read states it. */
  supplyVolts?: number | string;
  /** Maximum clock, hertz. */
  maxClockHz?: number;
  /** Internal or on-module flash, bytes. Zero means the part boots from external flash. */
  flashBytes?: number;
  /** SRAM size, bytes. */
  sramBytes?: number;
  /** Where this pin table was read from. */
  datasheetUrl: string;
  description: string;
}

const pins = (names: Array<[number, string, IcPin['kind']]>): IcPin[] =>
  names.map(([number, name, kind]) => ({ number, name, kind }));

/** ATmega328P in DIP-28: the Arduino Uno core. Datasheet pinout. */
const ATMEGA328P_PINS = pins([
  [1, 'PC6/RESET', 'input'], [2, 'PD0/RXD', 'bidirectional'], [3, 'PD1/TXD', 'bidirectional'],
  [4, 'PD2/INT0', 'bidirectional'], [5, 'PD3/INT1', 'bidirectional'], [6, 'PD4', 'bidirectional'],
  [7, 'VCC', 'power'], [8, 'GND', 'power'], [9, 'PB6/XTAL1', 'bidirectional'], [10, 'PB7/XTAL2', 'bidirectional'],
  [11, 'PD5', 'bidirectional'], [12, 'PD6', 'bidirectional'], [13, 'PD7', 'bidirectional'],
  [14, 'PB0', 'bidirectional'], [15, 'PB1', 'bidirectional'], [16, 'PB2/SS', 'bidirectional'],
  [17, 'PB3/MOSI', 'bidirectional'], [18, 'PB4/MISO', 'bidirectional'], [19, 'PB5/SCK', 'bidirectional'],
  [20, 'AVCC', 'power'], [21, 'AREF', 'input'], [22, 'GND', 'power'],
  [23, 'PC0/ADC0', 'bidirectional'], [24, 'PC1/ADC1', 'bidirectional'], [25, 'PC2/ADC2', 'bidirectional'],
  [26, 'PC3/ADC3', 'bidirectional'], [27, 'PC4/SDA', 'bidirectional'], [28, 'PC5/SCL', 'bidirectional'],
]);

export const MCU_ATMEGA328P: McuSpec = {
  id: 'atmega328p',
  partNumber: 'ATmega328P-PU',
  name: 'AVR 8-bit microcontroller',
  manufacturer: 'Microchip Technology',
  package: 'DIP-28',
  pinCount: 28,
  pins: ATMEGA328P_PINS,
  supplyVolts: 5,
  maxClockHz: 20_000_000,
  flashBytes: 32 * 1024,
  sramBytes: 2 * 1024,
  datasheetUrl:
    'https://ww1.microchip.com/downloads/en/DeviceDoc/Atmel-7810-Automotive-Microcontrollers-ATmega328P_Datasheet.pdf',
  description: 'The Arduino Uno core: UART on PD0/PD1, SPI on PB2-PB5, I2C on PC4/PC5, ADC on PC0-PC5.',
};

/** ATmega4809 in TQFP-48: the modern AVR core, with the port set the 48-pin body bonds out. */
export const MCU_ATMEGA4809: McuSpec = {
  id: 'atmega4809',
  partNumber: 'ATmega4809-AF',
  name: 'AVR 8-bit microcontroller, 48-TQFP',
  manufacturer: 'Microchip Technology',
  package: 'TQFP-48',
  pinCount: 48,
  pins: pins([
    [1, 'PA5', 'bidirectional'], [2, 'PA6', 'bidirectional'], [3, 'PA7', 'bidirectional'],
    [4, 'PB0', 'bidirectional'], [5, 'PB1', 'bidirectional'], [6, 'PB2', 'bidirectional'],
    [7, 'PB3', 'bidirectional'], [8, 'PB4', 'bidirectional'], [9, 'PB5', 'bidirectional'],
    [10, 'PC0', 'bidirectional'], [11, 'PC1', 'bidirectional'], [12, 'PC2', 'bidirectional'],
    [13, 'PC3', 'bidirectional'], [14, 'VDD', 'power'], [15, 'GND', 'power'],
    [16, 'PC4', 'bidirectional'], [17, 'PC5', 'bidirectional'], [18, 'PC6', 'bidirectional'], [19, 'PC7', 'bidirectional'],
    [20, 'PD0/AIN0', 'bidirectional'], [21, 'PD1/AIN1', 'bidirectional'], [22, 'PD2/AIN2', 'bidirectional'],
    [23, 'PD3/AIN3', 'bidirectional'], [24, 'PD4/AIN4', 'bidirectional'], [25, 'PD5/AIN5', 'bidirectional'],
    [26, 'PD6/AIN6', 'bidirectional'], [27, 'PD7/AIN7/VREFA', 'bidirectional'],
    [28, 'AVDD', 'power'], [29, 'GND', 'power'],
    [30, 'PE0/AIN8', 'bidirectional'], [31, 'PE1/AIN9', 'bidirectional'],
    [32, 'PE2/AIN10', 'bidirectional'], [33, 'PE3/AIN11', 'bidirectional'],
    [34, 'PF0/TOSC1', 'bidirectional'], [35, 'PF1/TOSC2', 'bidirectional'],
    [36, 'PF2', 'bidirectional'], [37, 'PF3', 'bidirectional'], [38, 'PF4/RESET', 'bidirectional'],
    [39, 'PF5', 'bidirectional'], [40, 'PF6', 'bidirectional'], [41, 'UPDI', 'bidirectional'],
    [42, 'VDD', 'power'], [43, 'GND', 'power'],
    [44, 'PA0/EXTCLK', 'bidirectional'], [45, 'PA1', 'bidirectional'], [46, 'PA2', 'bidirectional'],
    [47, 'PA3/CLKOUT', 'bidirectional'], [48, 'PA4', 'bidirectional'],
  ]),
  supplyVolts: '1.8 V to 5.5 V (20 MHz only at 4.5-5.5 V)',
  maxClockHz: 20_000_000,
  flashBytes: 48 * 1024,
  sramBytes: 6 * 1024,
  datasheetUrl:
    'https://ww1.microchip.com/downloads/en/DeviceDoc/ATmega4808-4809-Data-Sheet-DS40002173A.pdf',
  description:
    '41 GPIO on the 48-pin body, ADC0 on PD0-PD7 and PE0-PE3, programmed over UPDI on pin 41. PB6/PB7 and PA beyond PA7 are not bonded in this package.',
};

/** STM32F103C8 in LQFP-48: the Blue Pill core. Full 48-pin datasheet pinout. */
export const MCU_STM32F103C8: McuSpec = {
  id: 'stm32f103c8',
  partNumber: 'STM32F103C8T6',
  name: 'ARM Cortex-M3 microcontroller',
  manufacturer: 'STMicroelectronics',
  package: 'LQFP-48',
  pinCount: 48,
  pins: pins([
    [1, 'VBAT', 'power'], [2, 'PC13', 'bidirectional'], [3, 'PC14/OSC32_IN', 'bidirectional'],
    [4, 'PC15/OSC32_OUT', 'bidirectional'], [5, 'PD0/OSC_IN', 'bidirectional'], [6, 'PD1/OSC_OUT', 'bidirectional'],
    [7, 'NRST', 'input'], [8, 'VSSA', 'power'], [9, 'VDDA', 'power'],
    [10, 'PA0', 'bidirectional'], [11, 'PA1', 'bidirectional'], [12, 'PA2/USART2_TX', 'bidirectional'],
    [13, 'PA3/USART2_RX', 'bidirectional'], [14, 'PA4/SPI1_NSS', 'bidirectional'], [15, 'PA5/SPI1_SCK', 'bidirectional'],
    [16, 'PA6/SPI1_MISO', 'bidirectional'], [17, 'PA7/SPI1_MOSI', 'bidirectional'],
    [18, 'PB0', 'bidirectional'], [19, 'PB1', 'bidirectional'], [20, 'PB2/BOOT1', 'bidirectional'],
    [21, 'PB10/I2C2_SCL', 'bidirectional'], [22, 'PB11/I2C2_SDA', 'bidirectional'],
    [23, 'VSS', 'power'], [24, 'VDD', 'power'],
    [25, 'PB12/SPI2_NSS', 'bidirectional'], [26, 'PB13/SPI2_SCK', 'bidirectional'],
    [27, 'PB14/SPI2_MISO', 'bidirectional'], [28, 'PB15/SPI2_MOSI', 'bidirectional'],
    [29, 'PA8', 'bidirectional'], [30, 'PA9/USART1_TX', 'bidirectional'], [31, 'PA10/USART1_RX', 'bidirectional'],
    [32, 'PA11/USB_DM', 'bidirectional'], [33, 'PA12/USB_DP', 'bidirectional'],
    [34, 'PA13/SWDIO', 'bidirectional'], [35, 'PA14/SWCLK', 'bidirectional'], [36, 'PA15', 'bidirectional'],
    [37, 'PB3', 'bidirectional'], [38, 'PB4', 'bidirectional'], [39, 'PB5', 'bidirectional'],
    [40, 'PB6/I2C1_SCL', 'bidirectional'], [41, 'PB7/I2C1_SDA', 'bidirectional'], [42, 'BOOT0', 'input'],
    [43, 'PB8', 'bidirectional'], [44, 'PB9', 'bidirectional'],
    [45, 'VSS_5', 'power'], [46, 'VDD_5', 'power'], [47, 'VSS_6', 'power'], [48, 'VDD_6', 'power'],
  ]),
  supplyVolts: 3.3,
  maxClockHz: 72_000_000,
  flashBytes: 64 * 1024,
  sramBytes: 20 * 1024,
  datasheetUrl: 'https://www.st.com/resource/en/datasheet/cd00161566.pdf',
  description: 'The Blue Pill core: USART1 on PA9/PA10, SPI1 on PA5-PA7, I2C1 on PB6/PB7, USB on PA11/PA12.',
};

/** STM32G071RB in LQFP-64. Port names only — the alternate functions are per the datasheet's AF table. */
export const MCU_STM32G071RB: McuSpec = {
  id: 'stm32g071rb',
  partNumber: 'STM32G071RBT6',
  name: 'ARM Cortex-M0+ microcontroller',
  manufacturer: 'STMicroelectronics',
  package: 'LQFP-64',
  pinCount: 64,
  pins: pins([
    [1, 'PC11', 'bidirectional'], [2, 'PC12', 'bidirectional'], [3, 'PC13', 'bidirectional'],
    [4, 'PC14-OSC32_IN', 'bidirectional'], [5, 'PC15-OSC32_OUT', 'bidirectional'],
    [6, 'VBAT', 'power'], [7, 'VREF+', 'power'], [8, 'VDD/VDDA', 'power'], [9, 'VSS/VSSA', 'power'],
    [10, 'PF0-OSC_IN', 'bidirectional'], [11, 'PF1-OSC_OUT', 'bidirectional'], [12, 'PF2-NRST', 'bidirectional'],
    [13, 'PC0', 'bidirectional'], [14, 'PC1', 'bidirectional'], [15, 'PC2', 'bidirectional'], [16, 'PC3', 'bidirectional'],
    [17, 'PA0', 'bidirectional'], [18, 'PA1', 'bidirectional'], [19, 'PA2', 'bidirectional'], [20, 'PA3', 'bidirectional'],
    [21, 'PA4', 'bidirectional'], [22, 'PA5', 'bidirectional'], [23, 'PA6', 'bidirectional'], [24, 'PA7', 'bidirectional'],
    [25, 'PC4', 'bidirectional'], [26, 'PC5', 'bidirectional'], [27, 'PB0', 'bidirectional'], [28, 'PB1', 'bidirectional'],
    [29, 'PB2', 'bidirectional'], [30, 'PB10', 'bidirectional'], [31, 'PB11', 'bidirectional'],
    [32, 'PB12', 'bidirectional'], [33, 'PB13', 'bidirectional'], [34, 'PB14', 'bidirectional'], [35, 'PB15', 'bidirectional'],
    [36, 'PA8', 'bidirectional'], [37, 'PA9', 'bidirectional'], [38, 'PC6', 'bidirectional'], [39, 'PC7', 'bidirectional'],
    [40, 'PD8', 'bidirectional'], [41, 'PD9', 'bidirectional'],
    [42, 'PA10', 'bidirectional'], [43, 'PA11', 'bidirectional'], [44, 'PA12', 'bidirectional'],
    [45, 'PA13', 'bidirectional'], [46, 'PA14-BOOT0', 'bidirectional'], [47, 'PA15', 'bidirectional'],
    [48, 'PC8', 'bidirectional'], [49, 'PC9', 'bidirectional'],
    [50, 'PD0', 'bidirectional'], [51, 'PD1', 'bidirectional'], [52, 'PD2', 'bidirectional'],
    [53, 'PD3', 'bidirectional'], [54, 'PD4', 'bidirectional'], [55, 'PD5', 'bidirectional'], [56, 'PD6', 'bidirectional'],
    [57, 'PB3', 'bidirectional'], [58, 'PB4', 'bidirectional'], [59, 'PB5', 'bidirectional'],
    [60, 'PB6', 'bidirectional'], [61, 'PB7', 'bidirectional'], [62, 'PB8', 'bidirectional'], [63, 'PB9', 'bidirectional'],
    [64, 'PC10', 'bidirectional'],
  ]),
  supplyVolts: 'VDD 1.7-3.6 V, VDDA 2.0-3.6 V',
  maxClockHz: 64_000_000,
  flashBytes: 128 * 1024,
  sramBytes: 36 * 1024,
  datasheetUrl: 'https://www.st.com/resource/en/datasheet/stm32g071rb.pdf',
  description:
    'Sixty GPIO on this body with one shared VDD/VDDA on pad 8 and VSS/VSSA on 9. Pin numbers and port names are the datasheet LQFP64 map; the alternate functions of each pin live in the AF table of that document, not on this symbol.',
};

/** STM32F411CE in UFQFPN-48 — the package the Black Pill F411 actually uses. */
export const MCU_STM32F411CE: McuSpec = {
  id: 'stm32f411ce',
  partNumber: 'STM32F411CEU6',
  name: 'ARM Cortex-M4F microcontroller',
  manufacturer: 'STMicroelectronics',
  package: 'UFQFPN-48',
  pinCount: 48,
  pins: pins([
    [1, 'VBAT', 'power'], [2, 'PC13/ANTI_TAMP', 'bidirectional'], [3, 'PC14/OSC32_IN', 'bidirectional'],
    [4, 'PC15/OSC32_OUT', 'bidirectional'], [5, 'PH0/OSC_IN', 'bidirectional'], [6, 'PH1/OSC_OUT', 'bidirectional'],
    [7, 'NRST', 'input'], [8, 'VSSA', 'power'], [9, 'VREF+', 'power'],
    [10, 'PA0-WKUP', 'bidirectional'], [11, 'PA1', 'bidirectional'], [12, 'PA2', 'bidirectional'], [13, 'PA3', 'bidirectional'],
    [14, 'PA4', 'bidirectional'], [15, 'PA5', 'bidirectional'], [16, 'PA6', 'bidirectional'], [17, 'PA7', 'bidirectional'],
    [18, 'PB0', 'bidirectional'], [19, 'PB1', 'bidirectional'], [20, 'PB2/BOOT1', 'bidirectional'],
    [21, 'PB10', 'bidirectional'], [22, 'VCAP_1', 'power'], [23, 'VSS', 'power'], [24, 'VDD', 'power'],
    [25, 'PB12', 'bidirectional'], [26, 'PB13', 'bidirectional'], [27, 'PB14', 'bidirectional'], [28, 'PB15', 'bidirectional'],
    [29, 'PA8', 'bidirectional'], [30, 'PA9', 'bidirectional'], [31, 'PA10', 'bidirectional'], [32, 'PA11', 'bidirectional'],
    [33, 'PA12', 'bidirectional'], [34, 'PA13', 'bidirectional'], [35, 'VSS', 'power'], [36, 'VDD', 'power'],
    [37, 'PA14', 'bidirectional'], [38, 'PA15', 'bidirectional'], [39, 'PB3', 'bidirectional'], [40, 'PB4', 'bidirectional'],
    [41, 'PB5', 'bidirectional'], [42, 'PB6', 'bidirectional'], [43, 'PB7', 'bidirectional'], [44, 'BOOT0', 'input'],
    [45, 'PB8', 'bidirectional'], [46, 'PB9', 'bidirectional'], [47, 'VSS', 'power'], [48, 'VDD', 'power'],
  ]),
  maxClockHz: 100_000_000,
  flashBytes: 512 * 1024,
  sramBytes: 128 * 1024,
  datasheetUrl: 'https://www.st.com/resource/en/datasheet/stm32f411ce.pdf',
  description:
    'Cortex-M4F with 512 KB flash. VCAP_2 is not bonded in UFQFPN-48, and this part has no LQFP-48 option, so a 48-pin F411 footprint is always the QFN.',
};

/** ATSAMD21G18A: the 48-pin Cortex-M0+ used by Feather-class boards. */
export const MCU_SAMD21G18: McuSpec = {
  id: 'samd21g18a',
  partNumber: 'ATSAMD21G18A-A',
  name: 'ARM Cortex-M0+ microcontroller',
  manufacturer: 'Microchip Technology',
  package: 'QFN-48 / TQFP-48',
  pinCount: 48,
  pins: pins([
    [1, 'PA00', 'bidirectional'], [2, 'PA01', 'bidirectional'], [3, 'PA02', 'bidirectional'], [4, 'PA03', 'bidirectional'],
    [5, 'GNDANA', 'power'], [6, 'VDDANA', 'power'], [7, 'PB08', 'bidirectional'], [8, 'PB09', 'bidirectional'],
    [9, 'PA04', 'bidirectional'], [10, 'PA05', 'bidirectional'], [11, 'PA06', 'bidirectional'], [12, 'PA07', 'bidirectional'],
    [13, 'PA08', 'bidirectional'], [14, 'PA09', 'bidirectional'], [15, 'PA10', 'bidirectional'], [16, 'PA11', 'bidirectional'],
    [17, 'VDDIO', 'power'], [18, 'GND', 'power'], [19, 'PB10', 'bidirectional'], [20, 'PB11', 'bidirectional'],
    [21, 'PA12', 'bidirectional'], [22, 'PA13', 'bidirectional'], [23, 'PA14', 'bidirectional'], [24, 'PA15', 'bidirectional'],
    [25, 'PA16', 'bidirectional'], [26, 'PA17', 'bidirectional'], [27, 'PA18', 'bidirectional'], [28, 'PA19', 'bidirectional'],
    [29, 'PA20', 'bidirectional'], [30, 'PA21', 'bidirectional'], [31, 'PA22', 'bidirectional'], [32, 'PA23', 'bidirectional'],
    [33, 'PA24', 'bidirectional'], [34, 'PA25', 'bidirectional'], [35, 'GND', 'power'], [36, 'VDDIO', 'power'],
    [37, 'PA27', 'bidirectional'], [38, 'RESET', 'input'], [39, 'PA28', 'bidirectional'], [40, 'GND', 'power'],
    [41, 'VDDCORE', 'power'], [42, 'VDDIN', 'power'], [43, 'PA30', 'bidirectional'], [44, 'PA31', 'bidirectional'],
    [45, 'PB02', 'bidirectional'], [46, 'PB03', 'bidirectional'], [47, 'PB22', 'bidirectional'], [48, 'PB23', 'bidirectional'],
  ]),
  maxClockHz: 48_000_000,
  flashBytes: 256 * 1024,
  sramBytes: 32 * 1024,
  datasheetUrl:
    'https://ww1.microchip.com/downloads/aemDocuments/documents/MCU32/ProductDocuments/DataSheets/SAM-D21-DA1-Family-Data-Sheet-DS40001882.pdf',
  description:
    'The G package bonds out PA00-PA25, PA27-PA31 and PB02/PB03, PB08-PB11, PB22/PB23; PB00, PB01 and PA26 are absent from this body, which is why a 64-pin sketch will not compile onto this footprint.',
};

/** nRF52832 QFN-48: the BLE 4/5 SoC behind many beacons and a lot of Arduino-compatible boards. */
export const MCU_NRF52832: McuSpec = {
  id: 'nrf52832',
  partNumber: 'nRF52832-QFAA',
  name: 'BLE 5 SoC, Cortex-M4',
  manufacturer: 'Nordic Semiconductor',
  package: 'QFN-48',
  pinCount: 48,
  pins: pins([
    [1, 'DEC1', 'power'], [2, 'P0.00/XL1', 'bidirectional'], [3, 'P0.01/XL2', 'bidirectional'],
    [4, 'P0.02/AIN0', 'bidirectional'], [5, 'P0.03/AIN1', 'bidirectional'], [6, 'P0.04/AIN2', 'bidirectional'],
    [7, 'P0.05/AIN3', 'bidirectional'], [8, 'P0.06', 'bidirectional'], [9, 'P0.07', 'bidirectional'], [10, 'P0.08', 'bidirectional'],
    [11, 'NFC1/P0.09', 'bidirectional'], [12, 'NFC2/P0.10', 'bidirectional'], [13, 'VDD', 'power'],
    [14, 'P0.11', 'bidirectional'], [15, 'P0.12', 'bidirectional'], [16, 'P0.13', 'bidirectional'],
    [17, 'P0.14/TRACEDATA3', 'bidirectional'], [18, 'P0.15/TRACEDATA2', 'bidirectional'], [19, 'P0.16/TRACEDATA1', 'bidirectional'],
    [20, 'P0.17', 'bidirectional'], [21, 'P0.18/TRACEDATA0/SWO', 'bidirectional'], [22, 'P0.19', 'bidirectional'],
    [23, 'P0.20/TRACECLK', 'bidirectional'], [24, 'P0.21/nRESET', 'input'], [25, 'SWDCLK', 'input'], [26, 'SWDIO', 'bidirectional'],
    [27, 'P0.22', 'bidirectional'], [28, 'P0.23', 'bidirectional'], [29, 'P0.24', 'bidirectional'],
    [30, 'ANT', 'bidirectional'], [31, 'VSS', 'power'], [32, 'DEC2', 'power'], [33, 'DEC3', 'power'],
    [34, 'XC1', 'passive'], [35, 'XC2', 'passive'], [36, 'VDD', 'power'],
    [37, 'P0.25', 'bidirectional'], [38, 'P0.26', 'bidirectional'], [39, 'P0.27', 'bidirectional'],
    [40, 'P0.28/AIN4', 'bidirectional'], [41, 'P0.29/AIN5', 'bidirectional'], [42, 'P0.30/AIN6', 'bidirectional'],
    [43, 'P0.31/AIN7', 'bidirectional'], [44, 'NC', 'passive'], [45, 'VSS', 'power'], [46, 'DEC4', 'power'],
    [47, 'DCC', 'power'], [48, 'VDD', 'power'],
  ]),
  flashBytes: 512 * 1024,
  sramBytes: 64 * 1024,
  datasheetUrl: 'https://docs.arduino.cc/resources/datasheets/nRF52832_PS_v1.1.pdf',
  description:
    'P0.00-P0.31 with the ADC on P0.02-P0.05 and P0.28-P0.31, antenna on 30, decoupling monitors DEC1-DEC4 and DCC, and the die pad as VSS. The 32.768 kHz crystal shares P0.00/P0.01 while XC1/XC2 drive the 32 MHz.',
};

/** RP2040 QFN-56: dual Cortex-M0+, no internal flash — the QSPI pins are the boot path. */
export const MCU_RP2040: McuSpec = {
  id: 'rp2040',
  partNumber: 'RP2040',
  name: 'Dual Cortex-M0+ microcontroller',
  manufacturer: 'Raspberry Pi Ltd',
  package: 'QFN-56',
  pinCount: 57,
  pins: pins([
    [1, 'IOVDD', 'power'], [2, 'GPIO0', 'bidirectional'], [3, 'GPIO1', 'bidirectional'], [4, 'GPIO2', 'bidirectional'],
    [5, 'GPIO3', 'bidirectional'], [6, 'GPIO4', 'bidirectional'], [7, 'GPIO5', 'bidirectional'], [8, 'GPIO6', 'bidirectional'],
    [9, 'GPIO7', 'bidirectional'], [10, 'IOVDD', 'power'], [11, 'GPIO8', 'bidirectional'], [12, 'GPIO9', 'bidirectional'],
    [13, 'GPIO10', 'bidirectional'], [14, 'GPIO11', 'bidirectional'], [15, 'GPIO12', 'bidirectional'], [16, 'GPIO13', 'bidirectional'],
    [17, 'GPIO14', 'bidirectional'], [18, 'GPIO15', 'bidirectional'], [19, 'TESTEN', 'input'], [20, 'XIN', 'passive'],
    [21, 'XOUT', 'passive'], [22, 'IOVDD', 'power'], [23, 'DVDD', 'power'], [24, 'SWCLK', 'input'], [25, 'SWD', 'bidirectional'],
    [26, 'RUN', 'input'], [27, 'GPIO16', 'bidirectional'], [28, 'GPIO17', 'bidirectional'], [29, 'GPIO18', 'bidirectional'],
    [30, 'GPIO19', 'bidirectional'], [31, 'GPIO20', 'bidirectional'], [32, 'GPIO21', 'bidirectional'], [33, 'IOVDD', 'power'],
    [34, 'GPIO22', 'bidirectional'], [35, 'GPIO23', 'bidirectional'], [36, 'GPIO24', 'bidirectional'], [37, 'GPIO25', 'bidirectional'],
    [38, 'GPIO26/ADC0', 'bidirectional'], [39, 'GPIO27/ADC1', 'bidirectional'], [40, 'GPIO28/ADC2', 'bidirectional'],
    [41, 'GPIO29/ADC3', 'bidirectional'], [42, 'IOVDD', 'power'], [43, 'ADC_AVDD', 'power'], [44, 'VREG_VIN', 'power'],
    [45, 'VREG_VOUT', 'power'], [46, 'USB_DM', 'bidirectional'], [47, 'USB_DP', 'bidirectional'], [48, 'USB_VDD', 'power'],
    [49, 'IOVDD', 'power'], [50, 'DVDD', 'power'], [51, 'QSPI_SD3', 'bidirectional'], [52, 'QSPI_SCLK', 'bidirectional'],
    [53, 'QSPI_SD0', 'bidirectional'], [54, 'QSPI_SD2', 'bidirectional'], [55, 'QSPI_SD1', 'bidirectional'],
    [56, 'QSPI_CSn', 'bidirectional'], [57, 'GND', 'power'],
  ]),
  supplyVolts: 'IOVDD 1.8-3.3 V',
  maxClockHz: 133_000_000,
  flashBytes: 0,
  sramBytes: 264 * 1024,
  datasheetUrl:
    'https://pip-assets.raspberrypi.com/categories/814-rp2040/documents/RP-008371-DS-1-rp2040-datasheet.pdf',
  description:
    'GPIO0-GPIO29 (ADC on 26-29), USB on 46/47 and the external flash on the QSPI group. Pin 57 is the exposed centre pad; the die has no other ground pin, so a schematic that grounds RP2040 through a numbered lead is describing a part that does not exist.',
};

/** RP2350A QFN-60: 150 MHz dual M33 — and not pin-compatible with RP2040. */
export const MCU_RP2350A: McuSpec = {
  id: 'rp2350a',
  partNumber: 'RP2350A',
  name: 'Dual Cortex-M33 microcontroller',
  manufacturer: 'Raspberry Pi Ltd',
  package: 'QFN-60',
  pinCount: 60,
  pins: pins([
    [1, 'IOVDD', 'power'], [2, 'GPIO0', 'bidirectional'], [3, 'GPIO1', 'bidirectional'], [4, 'GPIO2', 'bidirectional'],
    [5, 'GPIO3', 'bidirectional'], [6, 'DVDD', 'power'], [7, 'GPIO4', 'bidirectional'], [8, 'GPIO5', 'bidirectional'],
    [9, 'GPIO6', 'bidirectional'], [10, 'GPIO7', 'bidirectional'], [11, 'IOVDD', 'power'], [12, 'GPIO8', 'bidirectional'],
    [13, 'GPIO9', 'bidirectional'], [14, 'GPIO10', 'bidirectional'], [15, 'GPIO11', 'bidirectional'], [16, 'GPIO12', 'bidirectional'],
    [17, 'GPIO13', 'bidirectional'], [18, 'GPIO14', 'bidirectional'], [19, 'GPIO15', 'bidirectional'], [20, 'IOVDD', 'power'],
    [21, 'XIN', 'passive'], [22, 'XOUT', 'passive'], [23, 'DVDD', 'power'], [24, 'SWCLK', 'input'], [25, 'SWDIO', 'bidirectional'],
    [26, 'RUN', 'input'], [27, 'GPIO16', 'bidirectional'], [28, 'GPIO17', 'bidirectional'], [29, 'GPIO18', 'bidirectional'],
    [30, 'IOVDD', 'power'], [31, 'GPIO19', 'bidirectional'], [32, 'GPIO20', 'bidirectional'], [33, 'GPIO21', 'bidirectional'],
    [34, 'GPIO22', 'bidirectional'], [35, 'GPIO23', 'bidirectional'], [36, 'GPIO24', 'bidirectional'], [37, 'GPIO25', 'bidirectional'],
    [38, 'IOVDD', 'power'], [39, 'DVDD', 'power'], [40, 'GPIO26/ADC0', 'bidirectional'], [41, 'GPIO27/ADC1', 'bidirectional'],
    [42, 'GPIO28/ADC2', 'bidirectional'], [43, 'GPIO29/ADC3', 'bidirectional'], [44, 'ADC_AVDD', 'power'], [45, 'IOVDD', 'power'],
    [46, 'VREG_AVDD', 'power'], [47, 'VREG_PGND', 'power'], [48, 'VREG_LX', 'power'], [49, 'VREG_VIN', 'power'],
    [50, 'VREG_FB', 'input'], [51, 'USB_DM', 'bidirectional'], [52, 'USB_DP', 'bidirectional'], [53, 'USB_OTP_VDD', 'power'],
    [54, 'QSPI_IOVDD', 'power'], [55, 'QSPI_SD3', 'bidirectional'], [56, 'QSPI_SCLK', 'bidirectional'], [57, 'QSPI_SD0', 'bidirectional'],
    [58, 'QSPI_SD2', 'bidirectional'], [59, 'QSPI_SD1', 'bidirectional'], [60, 'QSPI_SS', 'bidirectional'],
  ]),
  supplyVolts: 'IOVDD 1.62-3.63 V',
  maxClockHz: 150_000_000,
  flashBytes: 0,
  sramBytes: 520 * 1024,
  datasheetUrl: 'https://datasheets.raspberrypi.com/rp2350/rp2350-datasheet.pdf',
  description:
    'The A-body pin map: GPIO0-29, USB, QSPI and the switch-mode supply pins of the on-die regulator. Ground is the central exposed pad, which carries no pin number. RP2350B is the 80-pin body with different numbering.',
};

/** ESP32-WROOM-32 module: 38 accessible pins on the castellated edge. */
export const MCU_ESP32_WROOM: McuSpec = {
  id: 'esp32-wroom',
  partNumber: 'ESP32-WROOM-32',
  name: 'WiFi + Bluetooth module',
  manufacturer: 'Espressif Systems',
  package: 'MODULE-38',
  pinCount: 38,
  pins: pins([
    [1, 'GND', 'power'], [2, 'GPIO23/VSPI_MOSI', 'bidirectional'], [3, 'GPIO22/I2C_SCL', 'bidirectional'],
    [4, 'GPIO21/I2C_SDA', 'bidirectional'], [5, 'GPIO19/VSPI_MISO', 'bidirectional'], [6, 'GPIO18/VSPI_CLK', 'bidirectional'],
    [7, 'GPIO5/VSPI_SS', 'bidirectional'], [8, 'GPIO4/ADC2_0', 'bidirectional'], [9, 'GPIO2/ADC2_2', 'bidirectional'],
    [10, 'GPIO15/HSPI_SS', 'bidirectional'], [11, 'GND', 'power'], [12, 'GPIO13/HSPI_MOSI', 'bidirectional'],
    [13, 'GPIO12/HSPI_MISO', 'bidirectional'], [14, 'GPIO14/HSPI_CLK', 'bidirectional'], [15, 'GPIO27/ADC2_7', 'bidirectional'],
    [16, 'GPIO25/DAC1', 'bidirectional'], [17, 'GPIO26/DAC2', 'bidirectional'], [18, 'GPIO33/ADC1_5', 'bidirectional'],
    [19, 'GPIO32/ADC1_4', 'bidirectional'], [20, 'GPIO35/ADC1_7', 'input'], [21, 'GPIO34/ADC1_6', 'input'],
    [22, 'GPIO39/VN', 'input'], [23, 'GPIO36/VP', 'input'], [24, 'EN', 'input'], [25, '3V3', 'power'],
    [26, 'GND', 'power'], [27, 'GND', 'power'], [28, 'GPIO16/UART2_RX', 'bidirectional'], [29, 'GPIO17/UART2_TX', 'bidirectional'],
    [30, 'GPIO0/BOOT', 'bidirectional'], [31, 'GPIO1/UART0_TX', 'bidirectional'], [32, 'GPIO3/UART0_RX', 'bidirectional'],
    [33, 'GND', 'power'], [34, '5V/VIN', 'power'], [35, 'NC', 'passive'], [36, 'NC', 'passive'], [37, 'NC', 'passive'], [38, 'NC', 'passive'],
  ]),
  supplyVolts: 3.3,
  maxClockHz: 240_000_000,
  flashBytes: 4 * 1024 * 1024,
  sramBytes: 520 * 1024,
  datasheetUrl:
    'https://www.espressif.com/sites/default/files/documentation/esp32-wroom-32_datasheet_en.pdf',
  description: 'UART0 on GPIO1/GPIO3, I2C defaults on GPIO21/22, VSPI on GPIO18/19/23/5, boot on GPIO0.',
};

/** ESP32-S3-WROOM-1-N8: 41 pads, including the 8-pad ground plane as pad 41. */
export const MCU_ESP32_S3_WROOM: McuSpec = {
  id: 'esp32-s3-wroom',
  partNumber: 'ESP32-S3-WROOM-1-N8',
  name: 'WiFi + BLE module, dual LX7',
  manufacturer: 'Espressif Systems',
  package: 'MODULE-41',
  pinCount: 41,
  pins: pins([
    [1, 'GND', 'power'], [2, '3V3', 'power'], [3, 'EN', 'input'],
    [4, 'IO4', 'bidirectional'], [5, 'IO5', 'bidirectional'], [6, 'IO6', 'bidirectional'], [7, 'IO7', 'bidirectional'],
    [8, 'IO15', 'bidirectional'], [9, 'IO16', 'bidirectional'], [10, 'IO17', 'bidirectional'], [11, 'IO18', 'bidirectional'],
    [12, 'IO8', 'bidirectional'], [13, 'IO19', 'bidirectional'], [14, 'IO20', 'bidirectional'], [15, 'IO3', 'bidirectional'],
    [16, 'IO46', 'bidirectional'], [17, 'IO9', 'bidirectional'], [18, 'IO10', 'bidirectional'], [19, 'IO11', 'bidirectional'],
    [20, 'IO12', 'bidirectional'], [21, 'IO13', 'bidirectional'], [22, 'IO14', 'bidirectional'], [23, 'IO21', 'bidirectional'],
    [24, 'IO47', 'bidirectional'], [25, 'IO48', 'bidirectional'], [26, 'IO45', 'bidirectional'], [27, 'IO0', 'bidirectional'],
    [28, 'IO35', 'bidirectional'], [29, 'IO36', 'bidirectional'], [30, 'IO37', 'bidirectional'], [31, 'IO38', 'bidirectional'],
    [32, 'IO39', 'bidirectional'], [33, 'IO40', 'bidirectional'], [34, 'IO41', 'bidirectional'], [35, 'IO42', 'bidirectional'],
    [36, 'RXD0', 'bidirectional'], [37, 'TXD0', 'bidirectional'], [38, 'IO2', 'bidirectional'], [39, 'IO1', 'bidirectional'],
    [40, 'GND', 'power'], [41, 'EPAD', 'power'],
  ]),
  supplyVolts: '3.0-3.6 V (VDD33)',
  maxClockHz: 240_000_000,
  flashBytes: 8 * 1024 * 1024,
  sramBytes: 512 * 1024,
  datasheetUrl:
    'https://documentation.espressif.com/esp32-s3-wroom-1_wroom-1u_datasheet_en.pdf',
  description:
    'Thirty-six exposed I/O pads plus USB (IO19/IO20) and UART0 on RXD0/TXD0. N8 means 8 MB flash and no PSRAM; on N8R8 the octal PSRAM consumes IO35-IO37. Pad 41 is the ground plane.',
};

/** ESP32-C3-MINI-1: 53 pads, most of them the ground ring — the land pattern people get wrong. */
export const MCU_ESP32_C3_MINI: McuSpec = {
  id: 'esp32-c3-mini',
  partNumber: 'ESP32-C3-MINI-1',
  name: 'WiFi + BLE module, RISC-V',
  manufacturer: 'Espressif Systems',
  package: 'MODULE-53',
  pinCount: 53,
  pins: pins([
    [1, 'GND', 'power'], [2, 'GND', 'power'], [3, '3V3', 'power'], [4, 'NC', 'passive'],
    [5, 'IO2', 'bidirectional'], [6, 'IO3', 'bidirectional'], [7, 'NC', 'passive'], [8, 'EN', 'input'],
    [9, 'NC', 'passive'], [10, 'NC', 'passive'], [11, 'GND', 'power'], [12, 'IO0', 'bidirectional'],
    [13, 'IO1', 'bidirectional'], [14, 'GND', 'power'], [15, 'NC', 'passive'], [16, 'IO10', 'bidirectional'],
    [17, 'NC', 'passive'], [18, 'IO4', 'bidirectional'], [19, 'IO5', 'bidirectional'], [20, 'IO6', 'bidirectional'],
    [21, 'IO7', 'bidirectional'], [22, 'IO8', 'bidirectional'], [23, 'IO9', 'bidirectional'], [24, 'NC', 'passive'],
    [25, 'NC', 'passive'], [26, 'IO18', 'bidirectional'], [27, 'IO19', 'bidirectional'], [28, 'NC', 'passive'],
    [29, 'NC', 'passive'], [30, 'RXD0', 'bidirectional'], [31, 'TXD0', 'bidirectional'], [32, 'NC', 'passive'],
    [33, 'NC', 'passive'], [34, 'NC', 'passive'], [35, 'NC', 'passive'],
    [36, 'GND', 'power'], [37, 'GND', 'power'], [38, 'GND', 'power'], [39, 'GND', 'power'], [40, 'GND', 'power'],
    [41, 'GND', 'power'], [42, 'GND', 'power'], [43, 'GND', 'power'], [44, 'GND', 'power'], [45, 'GND', 'power'],
    [46, 'GND', 'power'], [47, 'GND', 'power'], [48, 'GND', 'power'], [49, 'GND', 'power'], [50, 'GND', 'power'],
    [51, 'GND', 'power'], [52, 'GND', 'power'], [53, 'GND', 'power'],
  ]),
  datasheetUrl: 'https://documentation.espressif.com/esp32-c3-mini-1_datasheet_en.pdf',
  description:
    'RISC-V single-core module. Only eleven pads carry I/O (IO0-IO10 plus USB on IO18/IO19); the rest are no-connects or the ground ring, which is why a footprint drawn from a 16-pin hobby table will not solder.',
};

/** ESP32-C6-MINI-1-N4: the same 53-pad body with WiFi 6 and the redesigned land pattern. */
export const MCU_ESP32_C6_MINI: McuSpec = {
  id: 'esp32-c6-mini',
  partNumber: 'ESP32-C6-MINI-1-N4',
  name: 'WiFi 6 + BLE module, RISC-V',
  manufacturer: 'Espressif Systems',
  package: 'MODULE-53',
  pinCount: 53,
  pins: pins([
    [1, 'GND', 'power'], [2, 'GND', 'power'], [3, '3V3', 'power'], [4, 'NC', 'passive'],
    [5, 'IO2', 'bidirectional'], [6, 'IO3', 'bidirectional'], [7, 'NC', 'passive'], [8, 'EN', 'input'],
    [9, 'IO4', 'bidirectional'], [10, 'IO5', 'bidirectional'], [11, 'GND', 'power'], [12, 'IO0', 'bidirectional'],
    [13, 'IO1', 'bidirectional'], [14, 'GND', 'power'], [15, 'IO6', 'bidirectional'], [16, 'IO7', 'bidirectional'],
    [17, 'IO12', 'bidirectional'], [18, 'IO13', 'bidirectional'], [19, 'IO14', 'bidirectional'], [20, 'IO15', 'bidirectional'],
    [21, 'NC', 'passive'], [22, 'IO8', 'bidirectional'], [23, 'IO9', 'bidirectional'], [24, 'IO18', 'bidirectional'],
    [25, 'IO19', 'bidirectional'], [26, 'IO20', 'bidirectional'], [27, 'IO21', 'bidirectional'], [28, 'IO22', 'bidirectional'],
    [29, 'IO23', 'bidirectional'], [30, 'RXD0', 'bidirectional'], [31, 'TXD0', 'bidirectional'], [32, 'NC', 'passive'],
    [33, 'NC', 'passive'], [34, 'NC', 'passive'], [35, 'NC', 'passive'],
    [36, 'GND', 'power'], [37, 'GND', 'power'], [38, 'GND', 'power'], [39, 'GND', 'power'], [40, 'GND', 'power'],
    [41, 'GND', 'power'], [42, 'GND', 'power'], [43, 'GND', 'power'], [44, 'GND', 'power'], [45, 'GND', 'power'],
    [46, 'GND', 'power'], [47, 'GND', 'power'], [48, 'GND', 'power'], [49, 'GND', 'power'], [50, 'GND', 'power'],
    [51, 'GND', 'power'], [52, 'GND', 'power'], [53, 'GND', 'power'],
  ]),
  supplyVolts: '3.0-3.6 V (VDD33)',
  maxClockHz: 160_000_000,
  flashBytes: 4 * 1024 * 1024,
  sramBytes: 540_672,
  datasheetUrl: 'https://documentation.espressif.com/esp32-c6-mini-1_mini-1u_datasheet_en.pdf',
  description:
    'Datasheet v1.5 describes the redesigned 13.2 x 16.6 mm MINI-1 with this 53-pad pattern; the older 18.0 x 12.4 mm, 25-pad module is a different footprint, so check the board file before reusing a library part.',
};

/** Every MCU and module this library ships. */
export const STANDARD_MCUS: readonly McuSpec[] = [
  MCU_ATMEGA328P,
  MCU_ATMEGA4809,
  MCU_STM32F103C8,
  MCU_STM32G071RB,
  MCU_STM32F411CE,
  MCU_SAMD21G18,
  MCU_NRF52832,
  MCU_RP2040,
  MCU_RP2350A,
  MCU_ESP32_WROOM,
  MCU_ESP32_S3_WROOM,
  MCU_ESP32_C3_MINI,
  MCU_ESP32_C6_MINI,
];

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
