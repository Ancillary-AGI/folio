import { describe, expect, it } from 'vitest';
import { catalogComponents, layoutPins } from './componentCatalog';
import { standardComponents } from '../componentLibrary';
import { STANDARD_MCUS } from './microcontrollers';
import { STANDARD_AMPLIFIERS } from './amplifiers';
import { STANDARD_POWER_PARTS } from './powerManagement';
import { resolveFootprint } from '../manufacturing/footprintLibrary';

describe('catalog component adapter', () => {
  it('turns every datasheet pin into a positioned schematic pin', () => {
    for (const component of catalogComponents) {
      expect(component.pins.length).toBeGreaterThan(0);
      const ids = new Set(component.pins.map((pin) => pin.id));
      expect(ids.size).toBe(component.pins.length);
      for (const pin of component.pins) {
        expect(pin.x).toBeGreaterThanOrEqual(0);
        expect(pin.x).toBeLessThanOrEqual(component.symbol_data.width);
        expect(pin.y).toBeGreaterThanOrEqual(0);
        expect(pin.y).toBeLessThanOrEqual(component.symbol_data.height);
      }
    }
  });

  it('keeps names unique so the parts browser has no ambiguous rows', () => {
    const names = catalogComponents.map((component) => component.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('places pin 1 at the top-left and numbers down the left edge', () => {
    const layout = layoutPins([
      { number: 1, name: 'A', kind: 'input' },
      { number: 2, name: 'B', kind: 'input' },
      { number: 3, name: 'C', kind: 'input' },
      { number: 4, name: 'D', kind: 'input' },
    ]);
    expect(layout.pins[0]).toMatchObject({ id: 'p1', x: 0, y: 20 });
    expect(layout.pins[1]).toMatchObject({ id: 'p2', x: 0, y: 40 });
    // The second half runs up the right edge in the same datasheet order.
    expect(layout.pins[2]).toMatchObject({ id: 'p3', x: layout.width, y: 20 });
    expect(layout.pins[3]).toMatchObject({ id: 'p4', x: layout.width, y: 40 });
  });

  it('classifies ground pins as ground and bidirectional pins as io', () => {
    const layout = layoutPins([
      { number: 1, name: 'GND', kind: 'power' },
      { number: 2, name: 'VCC', kind: 'power' },
      { number: 3, name: 'SDA', kind: 'bidirectional' },
    ]);
    expect(layout.pins.map((pin) => pin.type)).toEqual(['ground', 'power', 'io']);
  });

  it('recognises the suffixed and domain-specific ground names datasheets use', () => {
    const layout = layoutPins([
      { number: 1, name: 'GND1', kind: 'power' },
      { number: 2, name: 'GND2', kind: 'power' },
      { number: 3, name: 'DGND', kind: 'power' },
      { number: 4, name: 'VSS_5', kind: 'power' },
      { number: 5, name: 'VCC2', kind: 'power' },
      { number: 6, name: 'VREF1', kind: 'power' },
    ]);
    expect(layout.pins.map((pin) => pin.type)).toEqual([
      'ground', 'ground', 'ground', 'ground', 'power', 'power',
    ]);
  });

  it('files the analogue, converter, power and sensor catalogs under their own groups', () => {
    const find = (partNumber: string) =>
      catalogComponents.find((component) => component.part_number === partNumber);
    expect(find('LM358')?.category).toBe('amplifier');
    expect(find('LM393')?.category).toBe('amplifier');
    expect(find('ADS1115')?.category).toBe('converter');
    expect(find('TL431ACDBZR')?.category).toBe('reference');
    expect(find('LM7805')?.category).toBe('regulator');
    expect(find('BME280')?.category).toBe('sensor');
    // Every one of them keeps the datasheet behind the pin table.
    for (const partNumber of ['LM358', 'ADS1115', 'LM7805', 'BME280']) {
      expect(find(partNumber)?.datasheet_url).toMatch(/^https?:\/\//);
    }
  });

  it('prints a supply range as the datasheet text instead of inventing a voltage', () => {
    const find = (partNumber: string) =>
      catalogComponents.find((component) => component.part_number === partNumber);
    // A range rendered as `${n}V` would read "2.25 V to 5.5 VV".
    const iso = find('ISO7741DW');
    expect(iso?.default_properties.voltage).toBe('2.25 V to 5.5 V on each side');
    expect(String(iso?.default_properties.voltage)).not.toMatch(/VV/);
    expect(find('MAX3485')?.default_properties.voltage).toBe('3.3V');
  });

  it('omits a property the catalog does not carry', () => {
    const propsOf = (partNumber: string) =>
      catalogComponents.find((component) => component.part_number === partNumber)
        ?.default_properties ?? {}

    // Two of the MCU documents state no clock or I/O supply figure, so those rows
    // must not show one — a property that is a guess is worse than no property.
    for (const spec of STANDARD_MCUS) {
      const props = propsOf(spec.partNumber);
      expect('clock' in props, `${spec.partNumber} clock`).toBe(spec.maxClockHz !== undefined);
      expect('voltage' in props, `${spec.partNumber} voltage`).toBe(spec.supplyVolts !== undefined);
    }

    // Only a part with a real subcircuit in the model library may claim one.
    for (const spec of [...STANDARD_AMPLIFIERS, ...STANDARD_POWER_PARTS]) {
      expect(
        'spice' in propsOf(spec.partNumber),
        `${spec.partNumber} spice claim`,
      ).toBe(Boolean(spec.spiceModel));
    }
  });

  it('exports real parts into the standard library with their datasheet pin counts', () => {
    const atmega = standardComponents.find((component) => component.part_number === 'ATmega328P-PU');
    expect(atmega?.pins).toHaveLength(28);
    expect(atmega?.category).toBe('microcontroller');

    const nand = standardComponents.find((component) => component.part_number === '74HC00');
    expect(nand?.name).toBe('74HC00 Quad 2-input NAND');
    expect(nand?.pins).toHaveLength(14);
    expect(nand?.pins.find((pin) => pin.id === 'p14')?.type).toBe('power');
  });

  it('carries the datasheet identity for every sourced part', () => {
    // A part row is only as good as the document behind it, so anything the
    // catalogs ship with a manufacturer must also ship its package and the URL
    // the pinout was read from — otherwise the dock is asking for trust.
    const sourced = catalogComponents.filter((component) => component.manufacturer);
    expect(sourced.length).toBeGreaterThan(0);
    for (const component of sourced) {
      expect(component.part_number, `${component.name} has no MPN`).toBeTruthy();
      expect(component.default_properties.package, `${component.name} has no package`).toBeTruthy();
      // http is allowed only because the AMS1117 document is served that way and
      // its https endpoint does not complete a handshake; everything else is https.
      expect(component.datasheet_url ?? '', `${component.name} cites no datasheet`).toMatch(
        /^https?:\/\//,
      );
    }

    const rs485 = standardComponents.find((component) => component.part_number === 'MAX3485');
    expect(rs485?.pins).toHaveLength(8);
    expect(rs485?.pins.find((pin) => pin.id === 'p6')?.name).toBe('A');
    expect(rs485?.category).toBe('interface');

    const darlington = standardComponents.find((component) => component.part_number === 'TIP120');
    expect(darlington?.pins.map((pin) => pin.name)).toEqual(['BASE', 'COLLECTOR', 'EMITTER']);
    expect(darlington?.category).toBe('semiconductor');
  });

  it('hands the board tools a package that has copper lands', () => {
    // A datasheet part that reaches the PCB with too few lands is unroutable: the
    // board draws a body the router cannot connect and nets disappear without a
    // word. So every sourced part must carry the package its datasheet declares,
    // and that package must resolve to a pattern with at least one land per symbol
    // pin. More lands than pins is legal — the tab of a SOT-223 is copper that
    // carries heat, not a pin the symbol names.
    //
    // The set below is the gap this leaves open, and it is open on purpose.
    // Espressif draws each module's castellation grid only in a land-pattern
    // figure, and a TO-220 or TO-92 is its tab, its mounting hole and its body
    // depth off the board; none of that follows from a lead pitch, and a spacing
    // read off a drawing without the drawing would look sourced and may not be.
    // Those parts reach the board with the warning the scene builder raises
    // instead of invented copper. Anything else joining this list is a real defect.
    const noPatternYet = [
      'DS18B20',
      'ESP32-C3-MINI-1',
      'ESP32-C6-MINI-1-N4',
      'ESP32-S3-WROOM-1-N8',
      'ESP32-WROOM-32',
      'LM317T',
      'LM7805',
      'LM7812',
      'TIP120',
    ];
    const sourced = catalogComponents.filter((component) => component.manufacturer);
    expect(sourced.length).toBeGreaterThan(0);

    const unroutable: string[] = [];
    const detail: string[] = [];
    for (const component of sourced) {
      const footprint = String(component.default_properties.footprint ?? '');
      const resolved = footprint
        ? resolveFootprint(footprint, component.category, component.pins.length)
        : undefined;
      const lands = (resolved?.pads ?? []).filter((pad) => pad.id !== 'padthermal');
      if (lands.length >= component.pins.length) continue;
      unroutable.push(String(component.part_number));
      detail.push(
        `${component.part_number}: "${footprint || 'no footprint'}" lands ${lands.length} of ${component.pins.length} pins`,
      );
    }
    expect(unroutable.sort(), detail.join('; ')).toEqual(noPatternYet.sort());
  });
});
