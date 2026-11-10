import { describe, expect, it } from 'vitest';
import {
  IC_4N35,
  IC_ISO7741,
  IC_LAN8720A,
  IC_MAX232,
  IC_MAX3485,
  IC_PCA9306,
  IC_PC817,
  IC_SN65HVD230,
  IC_SP3485,
  IC_TXB0104,
  IC_ULN2003A,
  Q_BSS138,
  Q_TIP120,
  STANDARD_INTERFACE_PARTS,
  interfaceByPartNumber,
} from './interfaceParts';

describe('interface, isolation and driver parts', () => {
  it('numbers every pin 1..N and cites the datasheet it came from', () => {
    for (const part of STANDARD_INTERFACE_PARTS) {
      expect(part.pins).toHaveLength(part.pinCount);
      expect(part.pins.map((p) => p.number)).toEqual(
        Array.from({ length: part.pinCount }, (_, i) => i + 1),
      );
      expect(part.manufacturer.length).toBeGreaterThan(1);
      expect(part.package).toMatch(/(DIP|SOIC|NSOIC|SSOP|TSSOP|VSSOP|WSON|QFN|TO-220|SOT-23)/);
      expect(part.datasheetUrl).toMatch(/^https?:\/\//);
      if (typeof part.supplyVolts === 'number') {
        expect(part.supplyVolts).toBeGreaterThan(0);
      } else {
        // A range or per-rail string must still say what the rails are, in volts.
        expect(part.supplyVolts).toMatch(/V/);
      }
    }
  });

  it('pairs the RS-485 bus pins and puts the direction controls beside them', () => {
    const byNumber = new Map(IC_MAX3485.pins.map((p) => [p.number, p]));
    expect(byNumber.get(6)?.name).toBe('A');
    expect(byNumber.get(7)?.name).toBe('B');
    expect(byNumber.get(6)?.kind).toBe('bidirectional');
    expect(byNumber.get(2)?.name).toBe('/RE');
    expect(byNumber.get(3)?.name).toBe('DE');
    // MaxLinear's part is a second source, so it has to land on the same footprint.
    expect(IC_SP3485.pins.map((p) => p.name)).toEqual(IC_MAX3485.pins.map((p) => p.name));
  });

  it('names the CAN pins as the datasheet does, not as the MCU calls them', () => {
    const byNumber = new Map(IC_SN65HVD230.pins.map((p) => [p.number, p]));
    // D is the driver input and R the receiver output: reading them the other way
    // round is the classic way to build a CAN bus that never talks.
    expect(byNumber.get(1)?.name).toBe('D');
    expect(byNumber.get(1)?.kind).toBe('input');
    expect(byNumber.get(4)?.name).toBe('R');
    expect(byNumber.get(4)?.kind).toBe('output');
    expect(byNumber.get(6)?.name).toBe('CANL');
    expect(byNumber.get(7)?.name).toBe('CANH');
    expect(byNumber.get(8)?.name).toBe('RS');
  });

  it('keeps the MAX232 charge-pump pins separate from its logic-side pins', () => {
    const names = IC_MAX232.pins.map((p) => p.name);
    expect(names.slice(0, 6)).toEqual(['C1+', 'V+', 'C1-', 'C2+', 'C2-', 'V-']);
    // Two channels: each has a transmit and a receive side, T1/T2 into R1/R2 out.
    expect(names.filter((name) => /^T\dIN$/.test(name))).toHaveLength(2);
    expect(names.filter((name) => /^T\dOUT$/.test(name))).toHaveLength(2);
    expect(names.filter((name) => /^R\dIN$/.test(name))).toHaveLength(2);
    expect(names.filter((name) => /^R\dOUT$/.test(name))).toHaveLength(2);
    expect(IC_MAX232.supplyVolts).toBe(5);
  });

  it('puts the optocoupler LED on the low pins and the transistor on the high ones', () => {
    expect(IC_PC817.pins.map((p) => p.name)).toEqual(['Anode', 'Cathode', 'Emitter', 'Collector']);
    // The 4N35 is the six-pin part: pin 3 is unconnected and pin 6 brings the base out.
    expect(IC_4N35.pins[2].name).toBe('N/C');
    expect(IC_4N35.pins[5].name).toBe('BASE');
    expect(IC_4N35.keyRating).toContain('200 mW');
  });

  it('mirrors the ULN2003A outputs in reverse, the way the package is numbered', () => {
    const byNumber = new Map(IC_ULN2003A.pins.map((p) => [p.number, p.name]));
    expect(byNumber.get(1)).toBe('1B');
    expect(byNumber.get(7)).toBe('7B');
    expect(byNumber.get(9)).toBe('COM');
    expect(byNumber.get(10)).toBe('7C');
    expect(byNumber.get(16)).toBe('1C');
    expect(IC_ULN2003A.keyRating).toContain('500 mA');
  });

  it('numbers the TO-220 Darlington as its datasheet does, not as hobby diagrams do', () => {
    const byNumber = new Map(Q_TIP120.pins.map((p) => [p.number, p.name]));
    expect(byNumber.get(1)).toBe('BASE');
    expect(byNumber.get(2)).toBe('COLLECTOR');
    expect(byNumber.get(3)).toBe('EMITTER');
    expect(byNumber.get(2)).not.toBe('EMITTER');
  });

  it('gives the SOT-23 FET gate-source-drain in datasheet order', () => {
    expect(Q_BSS138.pins.map((p) => p.name)).toEqual(['GATE', 'SOURCE', 'DRAIN']);
    expect(Q_BSS138.supplyVolts).toBe(50);
  });

  it('gives the digital isolator two supplies and two grounds per side', () => {
    const byNumber = new Map(IC_ISO7741.pins.map((p) => [p.number, p]));
    expect(byNumber.get(1)?.name).toBe('VCC1');
    expect(byNumber.get(16)?.name).toBe('VCC2');
    // Ground on both sides of each barrier half, never one shared pin.
    expect(byNumber.get(2)?.name).toBe('GND1');
    expect(byNumber.get(8)?.name).toBe('GND1');
    expect(byNumber.get(9)?.name).toBe('GND2');
    expect(byNumber.get(15)?.name).toBe('GND2');
    expect(byNumber.get(3)?.name).toBe('INA');
    expect(byNumber.get(14)?.name).toBe('OUTA');
    // The reverse channel is the one that makes this ISO7741 and not ISO7740.
    expect(byNumber.get(11)?.name).toBe('IND');
    expect(byNumber.get(11)?.kind).toBe('input');
    expect(byNumber.get(6)?.name).toBe('OUTD');
    expect(byNumber.get(6)?.kind).toBe('output');
    expect(IC_ISO7741.pins.map((p) => p.name).filter((n) => n === 'GND1')).toHaveLength(2);
    expect(IC_ISO7741.keyRating).toMatch(/5000 VRMS/);
  });

  it('keeps the TXB0104 A port on the low pins and the mirrored B port on the high ones', () => {
    const byNumber = new Map(IC_TXB0104.pins.map((p) => [p.number, p]));
    expect(byNumber.get(1)?.name).toBe('VCCA');
    expect(byNumber.get(14)?.name).toBe('VCCB');
    expect(byNumber.get(7)?.name).toBe('GND');
    expect(byNumber.get(8)?.name).toBe('OE');
    // The two ports run in opposite order so the tracks do not cross inside the body.
    expect(byNumber.get(2)?.name).toBe('A1');
    expect(byNumber.get(13)?.name).toBe('B1');
    expect(byNumber.get(10)?.name).toBe('B4');
    expect(IC_TXB0104.pins.map((p) => p.name).filter((n) => /^A\d$/.test(n))).toHaveLength(4);
    expect(IC_TXB0104.pins.map((p) => p.name).filter((n) => /^B\d$/.test(n))).toHaveLength(4);
    // Both rails carry the same restriction the datasheet prints on page 1.
    expect(IC_TXB0104.supplyVolts).toMatch(/VCCA.*1\.2.*3\.6/);
    expect(IC_TXB0104.supplyVolts).toMatch(/must not exceed VCCB/);
  });

  it('treats the PCA9306 as a pass switch, so the bus pairs mirror across the body', () => {
    expect(IC_PCA9306.pins.map((p) => p.name)).toEqual([
      'GND', 'VREF1', 'SCL1', 'SDA1', 'SDA2', 'SCL2', 'VREF2', 'EN',
    ]);
    // All four bus pins are two-way: the part drives nothing, it connects.
    for (const pin of IC_PCA9306.pins.filter((p) => /^(SCL|SDA)/.test(p.name))) {
      expect(pin.kind).toBe('bidirectional');
    }
    expect(IC_PCA9306.keyRating).toMatch(/64 mA/);
    // The rails are not free to be any two voltages: the switch only translates
    // while they sit at least one threshold apart, which is a layout rule.
    expect(IC_PCA9306.supplyVolts).toMatch(/0\.6 V/);
    expect(IC_PCA9306.description).toMatch(/EN/);
  });

  it('separates the LAN8720A supplies, RMII side and analog line pairs', () => {
    const byNumber = new Map(IC_LAN8720A.pins.map((p) => [p.number, p]));
    expect(byNumber.get(1)?.name).toBe('VDD2A');
    expect(byNumber.get(19)?.name).toBe('VDD1A');
    expect(byNumber.get(9)?.name).toBe('VDDIO');
    expect(byNumber.get(6)?.name).toBe('VDDCR');
    expect(byNumber.get(24)?.name).toBe('RBIAS');
    expect(byNumber.get(24)?.kind).toBe('passive');
    // The MAC drives these, so they are inputs to the PHY — the reverse of how a
    // schematic reader assumes a pin named TX* behaves.
    expect(byNumber.get(16)?.name).toBe('TXEN');
    expect(byNumber.get(16)?.kind).toBe('input');
    expect(byNumber.get(17)?.kind).toBe('input');
    expect(byNumber.get(18)?.kind).toBe('input');
    // The line pairs are analogue in both directions: same copper, transmit and receive.
    for (const number of [20, 21, 22, 23]) {
      expect(byNumber.get(number)?.kind).toBe('bidirectional');
    }
    expect(byNumber.get(21)?.name).toBe('TXP');
    expect(byNumber.get(23)?.name).toBe('RXP');
    // Receive data doubles as the reset straps, so the buffer is two-way.
    expect(byNumber.get(7)?.name).toBe('RXD1/MODE1');
    expect(byNumber.get(7)?.kind).toBe('bidirectional');
    expect(byNumber.get(11)?.name).toBe('CRS_DV/MODE2');
    expect(IC_LAN8720A.keyRating).toMatch(/not 5 V tolerant/);
    expect(IC_LAN8720A.keyRating).toMatch(/12\.1 k/);
    expect(IC_LAN8720A.keyRating).toMatch(/exposed pad is VSS/);
  });

  it('looks parts up and refuses unknown ones', () => {
    expect(interfaceByPartNumber('MAX3485')).toBe(IC_MAX3485);
    expect(interfaceByPartNumber('ULN2003A')).toBe(IC_ULN2003A);
    expect(interfaceByPartNumber('ISO7741DW')).toBe(IC_ISO7741);
    expect(interfaceByPartNumber('LAN8720A')).toBe(IC_LAN8720A);
    expect(() => interfaceByPartNumber('MAX99999')).toThrow(/Unknown interface part/);
  });
});
