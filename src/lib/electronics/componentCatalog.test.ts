import { describe, expect, it } from 'vitest';
import { catalogComponents, layoutPins } from './componentCatalog';
import { standardComponents } from '../componentLibrary';

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

  it('exports real parts into the standard library with their datasheet pin counts', () => {
    const atmega = standardComponents.find((component) => component.part_number === 'ATmega328P-PU');
    expect(atmega?.pins).toHaveLength(28);
    expect(atmega?.category).toBe('microcontroller');

    const nand = standardComponents.find((component) => component.part_number === '74HC00');
    expect(nand?.name).toBe('74HC00 Quad 2-input NAND');
    expect(nand?.pins).toHaveLength(14);
    expect(nand?.pins.find((pin) => pin.id === 'p14')?.type).toBe('power');
  });
});
