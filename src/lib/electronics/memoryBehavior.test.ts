import { describe, expect, it } from 'vitest'
import {
  MemoryDevice,
  ShiftRegister165,
  ShiftRegister595,
  decode138,
  memoryDeviceFromSpec,
} from './memoryBehavior'
import { IC_23LC1024, IC_24LC256, IC_74HC138, IC_74HC595, IC_W25Q128 } from './logicMemory'

describe('74HC595 behaviour', () => {
  it('shifts MSB-first and copies the shift register to the latch on RCLK', () => {
    const register = new ShiftRegister595()
    const bits = [1, 0, 1, 1, 0, 0, 1, 0]
    let state = register.step({ ser: false, srclk: false, rclk: false, oeBar: true, srclrBar: true })
    for (const bit of bits) {
      register.step({ ser: bit === 1, srclk: true, rclk: false, oeBar: true, srclrBar: true })
      state = register.step({ ser: bit === 1, srclk: false, rclk: false, oeBar: true, srclrBar: true })
    }
    expect(state.shiftRegister).toBe(0b10110010)
    expect(state.latchRegister).toBe(0)
    expect(state.serialOut).toBe(1)

    state = register.step({ ser: false, srclk: false, rclk: true, oeBar: true, srclrBar: true })
    expect(state.latchRegister).toBe(0b10110010)
    state = register.step({ ser: false, srclk: false, rclk: false, oeBar: false, srclrBar: true })
    expect(state.latchRegister).toBe(0b10110010)
    expect(state.outputsEnabled).toBe(true)
    expect(state.outputs).toEqual([0, 1, 0, 0, 1, 1, 0, 1])
  })

  it('does not shift or latch without a rising edge', () => {
    const register = new ShiftRegister595()
    register.step({ ser: true, srclk: true, rclk: false, oeBar: true, srclrBar: true })
    const held = register.step({ ser: false, srclk: true, rclk: true, oeBar: true, srclrBar: true })
    const unchanged = register.step({ ser: true, srclk: true, rclk: true, oeBar: true, srclrBar: true })
    expect(held.latchRegister).toBe(1)
    expect(unchanged.shiftRegister).toBe(1)
    expect(unchanged.latchRegister).toBe(1)
  })

  it('clears asynchronously when SRCLR is low', () => {
    const register = new ShiftRegister595()
    register.step({ ser: true, srclk: true, rclk: true, oeBar: true, srclrBar: true })
    const cleared = register.step({ ser: true, srclk: true, rclk: true, oeBar: true, srclrBar: false })
    expect(cleared.shiftRegister).toBe(0)
  })
})

describe('74HC165 behaviour', () => {
  it('loads parallel data and shifts it out through QH', () => {
    const register = new ShiftRegister165()
    let state = register.step({ parallel: [1, 0, 1, 0, 0, 1, 1, 0], plBar: false, ceBar: false, cp: false, ser: false })
    expect(state.register).toBe(0b01100101)
    expect(state.qh).toBe(0)

    state = register.step({ parallel: new Array(8).fill(0), plBar: true, ceBar: false, cp: true, ser: true })
    expect(state.register).toBe(0b11001011)
    expect(state.qh).toBe(1)
  })

  it('ignores clocks while CE is high', () => {
    const register = new ShiftRegister165()
    register.step({ parallel: [1, 1, 1, 1, 1, 1, 1, 1], plBar: false, ceBar: false, cp: false, ser: false })
    const state = register.step({ parallel: new Array(8).fill(0), plBar: true, ceBar: true, cp: true, ser: false })
    expect(state.register).toBe(0xff)
  })
})

describe('74HC138 decoder', () => {
  it('pulls exactly the selected output low when enabled', () => {
    const decoded = decode138({ a: true, b: false, c: true, g1: true, g2aBar: false, g2bBar: false })
    expect(decoded.selected).toBe(5)
    expect(decoded.outputs).toEqual([1, 1, 1, 1, 1, 0, 1, 1])
  })

  it('disables all outputs when any enable is wrong', () => {
    const decoded = decode138({ a: false, b: false, c: false, g1: true, g2aBar: true, g2bBar: false })
    expect(decoded.enabled).toBe(false)
    expect(decoded.selected).toBeNull()
    expect(decoded.outputs).toEqual(new Array(8).fill(1))
  })
})

describe('MemoryDevice', () => {
  it('overwrites SRAM instantly and rejects out-of-range addresses', () => {
    const sram = memoryDeviceFromSpec(IC_23LC1024)
    const write = sram.writeByte(1234, 0xa5)
    expect(write.timeMs).toBe(0)
    expect(sram.readByte(1234)).toBe(0xa5)
    expect(() => sram.readByte(131_072)).toThrow(/outside/)
    expect(() => sram.writeByte(0, 256)).toThrow(/not a byte/)
    expect(() => sram.writePage(0, [1])).toThrow(/no page-write/)
  })

  it('writes EEPROM pages with a write cycle and refuses boundary crossings', () => {
    const eeprom = memoryDeviceFromSpec(IC_24LC256)
    expect(eeprom.readByte(0)).toBe(0xff)
    const result = eeprom.writePage(0, [1, 2, 3, 4])
    expect(result.bytesWritten).toBe(4)
    expect(result.timeMs).toBe(5)
    eeprom.writeByte(0, 0x5a)
    expect(eeprom.readByte(0)).toBe(0x5a)
    expect(() => eeprom.writePage(60, new Array(8).fill(0))).toThrow(/crosses/)
  })

  it('models NOR flash as clear-bits-until-erase', () => {
    const flash = memoryDeviceFromSpec(IC_W25Q128)
    expect(flash.readByte(0)).toBe(0xff)
    expect(flash.writeByte(0, 0x0f).stored).toBe(0x0f)
    expect(flash.writeByte(0, 0xf0).stored).toBe(0x00)
    expect(flash.writeByte(0, 0xff).stored).toBe(0x00)
    const erased = flash.eraseSector(0)
    expect(erased.bytesErased).toBe(4096)
    expect(erased.timeMs).toBe(400)
    expect(flash.readByte(0)).toBe(0xff)
  })

  it('rejects erase on non-flash memories and parts without an array', () => {
    const eeprom = memoryDeviceFromSpec(IC_24LC256)
    expect(() => eeprom.eraseSector(0)).toThrow(/only defined for NOR flash/)
    expect(() => memoryDeviceFromSpec(IC_74HC595)).toThrow(/not a byte-addressed/)
    expect(() => memoryDeviceFromSpec(IC_74HC138)).toThrow(/not a byte-addressed/)
  })

  it('validates constructor geometry', () => {
    expect(() => new MemoryDevice({ kind: 'sram', capacityBytes: 0 })).toThrow(/capacity/)
    expect(() => new MemoryDevice({ kind: 'eeprom', capacityBytes: 32, pageSizeBytes: 64 })).toThrow(/page size/i)
    expect(() => new MemoryDevice({ kind: 'sram', capacityBytes: 16, blankValue: 300 })).toThrow(/Blank value/)
  })
})
