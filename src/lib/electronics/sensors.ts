/**
 * Sensors — the parts that turn the world into a digital signal.
 *
 * Every pin table here was read from the document named in `datasheetUrl`, and
 * the supply and package figures come from the same page, because an I2C sensor
 * wired by a remembered pinout is a sensor that never answers. Parts whose pin
 * tables could not be opened from here are absent rather than remembered.
 *
 * Two of the notes below are the ones that actually cost people boards: Bosch
 * numbers its LGA pins clockwise in top view, and the Sensirion DFN die pad is
 * not connected to any pin, so tying it to ground shorts the supply.
 *
 * Pure data plus pure lookups; imports nothing from the simulator or renderer.
 */
import type { IcPin } from './standardIcs';

export type SensorFamily =
  | 'environmental'
  | 'pressure'
  | 'temperature'
  | 'humidity'
  | 'color-light';

export interface SensorSpec {
  id: string;
  partNumber: string;
  name: string;
  manufacturer: string;
  family: SensorFamily;
  /** Package the pin table above applies to, with the body size as printed. */
  package: string;
  pinCount: number;
  pins: readonly IcPin[];
  /** Bus the part speaks, as the datasheet's interface chapter names it. */
  interfaceKind: string;
  /** Supply range from the recommended-operating-conditions table. */
  supplyRange: string;
  /** The number a designer checks first: range, accuracy, or a bus address. */
  keyRating: string;
  /** Where this pin table was read from. */
  datasheetUrl: string;
  description: string;
}

const pins = (names: Array<[number, string, IcPin['kind']]>): IcPin[] =>
  names.map(([number, name, kind]) => ({ number, name, kind }));

/**
 * Bosch's 8-pin metal-lid LGA environmental/pressure family.
 *
 * The numbering runs clockwise seen from the top (counter-clockwise from the
 * bottom), which is the opposite of a DIP, and the same three rails appear in
 * all three parts: two GND pins, a VDD for the sensor die and a VDDIO for the
 * I/O domain.
 */
const BOSCH_LGA8 = pins([
  [1, 'GND', 'power'],
  [2, 'CSB', 'input'],
  [3, 'SDI', 'bidirectional'],
  [4, 'SCK', 'input'],
  [5, 'SDO', 'bidirectional'],
  [6, 'VDDIO', 'power'],
  [7, 'GND', 'power'],
  [8, 'VDD', 'power'],
]);

const BOSCH_SUPPLY = 'VDD 1.71 V to 3.6 V; VDDIO 1.2 V to 3.6 V';

/** BME280 — humidity, pressure and temperature in one 2.5 × 2.5 mm module. */
export const S_BME280: SensorSpec = {
  id: 'sensor-bme280',
  partNumber: 'BME280',
  name: 'Humidity, pressure and temperature sensor',
  manufacturer: 'Bosch Sensortec',
  family: 'environmental',
  package: 'LGA-8, 2.5 × 2.5 × 0.93 mm',
  pinCount: 8,
  pins: BOSCH_LGA8,
  interfaceKind: 'I2C / SPI',
  supplyRange: BOSCH_SUPPLY,
  keyRating:
    'Pressure 300–1100 hPa, ±1 hPa absolute; temperature −40…+85 °C, ±0.5 °C at 25 °C; I2C address 0x76 or 0x77 from SDO',
  datasheetUrl:
    'https://www.bosch-sensortec.com/media/boschsensortec/downloads/datasheets/bst-bme280-ds002.pdf',
  description:
    '4-in-1 environmental sensor on I2C or SPI. CSB low selects I2C, high selects SPI; SDO sets the I2C address.',
};

/** BMP280 — pressure only, register-compatible with the BME280. */
export const S_BMP280: SensorSpec = {
  id: 'sensor-bmp280',
  partNumber: 'BMP280',
  name: 'Absolute barometric pressure sensor',
  manufacturer: 'Bosch Sensortec',
  family: 'pressure',
  package: 'LGA-8, 2.0 × 2.5 × 0.95 mm',
  pinCount: 8,
  pins: BOSCH_LGA8,
  interfaceKind: 'I2C / SPI',
  supplyRange: BOSCH_SUPPLY,
  keyRating: 'Pressure 300–1100 hPa; 2.7 µA at 1 Hz forced mode; I2C address 0x76 or 0x77 from SDO',
  datasheetUrl:
    'https://www.bosch-sensortec.com/media/boschsensortec/downloads/datasheets/bst-bmp280-ds001.pdf',
  description:
    'Barometric pressure on I2C or SPI, register and performance compatible with the BME280, so one footprint serves both.',
};

/** BME680 — gas, humidity, pressure and temperature in a 3.0 × 3.0 mm module. */
export const S_BME680: SensorSpec = {
  id: 'sensor-bme680',
  partNumber: 'BME680',
  name: 'Gas, humidity, pressure and temperature sensor',
  manufacturer: 'Bosch Sensortec',
  family: 'environmental',
  package: 'LGA-8, 3.0 × 3.0 × 1.00 mm',
  pinCount: 8,
  pins: BOSCH_LGA8,
  interfaceKind: 'I2C / SPI',
  supplyRange: BOSCH_SUPPLY,
  keyRating:
    'MOX gas sensor plus humidity, pressure and temperature; optimized for 1.8 V; vent hole needs open air flow',
  datasheetUrl:
    'https://www.bosch-sensortec.com/media/boschsensortec/downloads/datasheets/bst-bme680-ds001.pdf',
  description:
    '4-in-1 air-quality sensor. Same CSB/SDI/SCK/SDO SPI-4W, SPI-3W and I2C connection options as the BME280.',
};

/**
 * SHT40 — humidity and temperature in an open-cavity DFN.
 *
 * The datasheet states the die pad is not connected to any pin, so a copper pad
 * under it is a keepout, not a ground plane.
 */
export const S_SHT40: SensorSpec = {
  id: 'sensor-sht40',
  partNumber: 'SHT40',
  name: 'Humidity and temperature sensor with heater',
  manufacturer: 'Sensirion',
  family: 'humidity',
  package: 'DFN-4, open cavity',
  pinCount: 4,
  pins: pins([
    [1, 'SDA', 'bidirectional'],
    [2, 'SCL', 'input'],
    [3, 'VDD', 'power'],
    [4, 'VSS', 'power'],
  ]),
  interfaceKind: 'I2C',
  supplyRange: 'VDD 1.08 V to 3.6 V',
  keyRating: 'Two-wire I2C only; on-board heater; die pad is not connected to any pin',
  datasheetUrl:
    'https://sensirion.com/media/documents/33FD6951/6555C40E/Sensirion_Datasheet_SHT4x.pdf',
  description:
    'SHT4x family in a 4-pin DFN: SDA on 1, SCL on 2, VDD on 3, VSS on 4. No copper under the sensor except the pin pads.',
};

/** VEML6040 — colour sensor with four 16-bit channels behind one I2C address. */
export const S_VEML6040: SensorSpec = {
  id: 'sensor-veml6040',
  partNumber: 'VEML6040',
  name: 'RGB colour light sensor',
  manufacturer: 'Vishay',
  family: 'color-light',
  package: 'OPLGA-4, 2.0 × 1.25 × 1.0 mm',
  pinCount: 4,
  pins: pins([
    [1, 'GND', 'power'],
    [2, 'SDAT', 'bidirectional'],
    [3, 'SCLK', 'input'],
    [4, 'VDD', 'power'],
  ]),
  interfaceKind: 'I2C',
  supplyRange: 'VDD 2.5 V to 3.6 V',
  keyRating: 'Red, green, blue and clear channels, 16-bit each, 0.007865 lux per step',
  datasheetUrl: 'https://www.vishay.com/docs/84276/veml6040.pdf',
  description:
    'I2C colour sensor: GND on 1, SDAT (open-drain data) on 2, SCLK on 3, VDD on 4, with 16-bit registers read a word at a time.',
};

/**
 * DS18B20 — 1-Wire thermometer.
 *
 * The TO-92, SO and µSOP bodies number the same three terminals differently, so
 * the row is explicitly the through-hole TO-92 pinout and the SO/µSOP numbering
 * lives in the datasheet's own pin-description table.
 */
export const S_DS18B20: SensorSpec = {
  id: 'sensor-ds18b20',
  partNumber: 'DS18B20',
  name: '1-Wire digital thermometer (TO-92)',
  manufacturer: 'Analog Devices / Maxim Integrated',
  family: 'temperature',
  package: 'TO-92-3',
  pinCount: 3,
  pins: pins([
    [1, 'GND', 'power'],
    [2, 'DQ', 'bidirectional'],
    [3, 'VDD', 'power'],
  ]),
  interfaceKind: '1-Wire',
  supplyRange: 'VDD 3.0 V to 5.5 V',
  keyRating: '−55…+125 °C, ±0.5 °C from −10…+85 °C; resolution set by the host from 9 to 12 bits',
  datasheetUrl:
    'https://www.analog.com/media/en/technical-documentation/data-sheets/ds18b20.pdf',
  description:
    'One port pin drives a whole bus of these: GND on 1, DQ on 2, VDD on 3 in TO-92. Ground VDD instead of powering it to run parasite-powered.',
};

/** Every sensor this library ships. */
export const STANDARD_SENSORS: readonly SensorSpec[] = [
  S_BME280, S_BMP280, S_BME680, S_SHT40, S_VEML6040, S_DS18B20,
];

/** Find a sensor by part number. Fail-loud on unknown parts. */
export function sensorByPartNumber(partNumber: string): SensorSpec {
  const found = STANDARD_SENSORS.find((s) => s.partNumber === partNumber);
  if (!found) throw new Error(`Unknown sensor part number: ${partNumber}.`);
  return found;
}
