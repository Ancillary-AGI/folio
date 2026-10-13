import { describe, expect, it } from 'vitest';
import { CONN_BARREL_JACK, CONN_USB_C, RELAY_SRD_05, STANDARD_PASSIVES, SW_TACTILE, passiveByPartNumber } from './connectors';

describe('connectors, power, switches', () => {
  it('numbers every pin 1..N with no gaps', () => {
    for (const part of STANDARD_PASSIVES) {
      expect(part.pins).toHaveLength(part.pinCount);
      expect(part.pins.map((p) => p.number)).toEqual(Array.from({ length: part.pinCount }, (_, i) => i + 1));
    }
  });
  it('places USB-C power on VBUS/GND and doubles the data pairs', () => {
    const byNumber = new Map(CONN_USB_C.pins.map((p) => [p.number, p]));
    expect(byNumber.get(4)?.name).toBe('VBUS');
    expect(byNumber.get(6)?.name).toBe('Dp1');
    expect(byNumber.get(14)?.name).toBe('Dp2');
    expect(CONN_USB_C.pins.filter((p) => p.name === 'VBUS')).toHaveLength(2);
  });
  it('gives the relay a coil pair and COM/NO/NC contacts', () => {
    const names = RELAY_SRD_05.pins.map((p) => p.name);
    expect(names).toEqual(['COIL+', 'COIL-', 'COM', 'NO', 'NC']);
    expect(RELAY_SRD_05.maxCurrentA).toBe(10);
  });
  it('rates the barrel jack above USB-C current and the tactile below both', () => {
    expect(CONN_BARREL_JACK.maxCurrentA).toBeGreaterThan(CONN_USB_C.maxCurrentA);
    expect(SW_TACTILE.maxCurrentA).toBeLessThan(1);
  });
  it('looks parts up and refuses unknown ones', () => {
    expect(passiveByPartNumber('PJ-102A')).toBe(CONN_BARREL_JACK);
    expect(() => passiveByPartNumber('NOPE-1')).toThrow(/Unknown passive/);
  });
});
