/**
 * Behavioural models for logic and memory ICs.
 *
 * The catalog describes the pins and capacity of the 74HC595, 74HC165,
 * 74HC138, 23LC1024 SRAM, 24LC256 EEPROM and W25Q128 flash. This module makes
 * those parts testable: clocked shift/latch semantics, active-low decoder
 * outputs, SRAM overwrite, EEPROM page writes, and NOR-flash erase-before-
 * program. Every operation validates its address/byte range and reports the
 * time it would take on the datasheet's timing, so a simulation cannot claim
 * an out-of-range store or an instantaneous EEPROM write.
 */
import type { MemorySpec } from './logicMemory'

export interface ShiftRegister595Inputs {
  /** Serial data input. */
  ser: boolean
  /** Shift clock, rising-edge triggered. */
  srclk: boolean
  /** Storage-register (latch) clock, rising-edge triggered. */
  rclk: boolean
  /** Output enable, active low. */
  oeBar: boolean
  /** Shift-register clear, active low and asynchronous. */
  srclrBar: boolean
}

export interface ShiftRegister595Outputs {
  shiftRegister: number
  latchRegister: number
  serialOut: number
  outputsEnabled: boolean
  /** QA..QH as logic levels, regardless of OE. */
  outputs: number[]
}

/** 74HC595 serial-in, parallel-out shift register with output latch. */
export class ShiftRegister595 {
  private shiftRegister = 0
  private latchRegister = 0
  private previousSrclk = false
  private previousRclk = false

  step(inputs: ShiftRegister595Inputs): ShiftRegister595Outputs {
    if (!inputs.srclrBar) {
      this.shiftRegister = 0
    } else if (inputs.srclk && !this.previousSrclk) {
      // QA takes SER; QB..QH take the previous QA..QG.
      this.shiftRegister = ((this.shiftRegister << 1) & 0xff) | (inputs.ser ? 1 : 0)
    }
    if (inputs.rclk && !this.previousRclk) {
      this.latchRegister = this.shiftRegister
    }
    this.previousSrclk = inputs.srclk
    this.previousRclk = inputs.rclk

    return {
      shiftRegister: this.shiftRegister,
      latchRegister: this.latchRegister,
      serialOut: (this.shiftRegister >> 7) & 1,
      outputsEnabled: !inputs.oeBar,
      outputs: Array.from({ length: 8 }, (_, bit) => (this.latchRegister >> bit) & 1),
    }
  }

  reset(): void {
    this.shiftRegister = 0
    this.latchRegister = 0
    this.previousSrclk = false
    this.previousRclk = false
  }
}

export interface ShiftRegister165Inputs {
  parallel: number[]
  /** Active-low parallel load. */
  plBar: boolean
  /** Clock inhibit, active high. */
  ceBar: boolean
  cp: boolean
  /** Serial input used when not loading in parallel. */
  ser: boolean
}

export interface ShiftRegister165Outputs {
  register: number
  qh: number
  qhBar: number
}

/** 74HC165 parallel-in, serial-out shift register. */
export class ShiftRegister165 {
  private register = 0
  private previousCp = false

  step(inputs: ShiftRegister165Inputs): ShiftRegister165Outputs {
    if (inputs.parallel.length !== 8 || inputs.parallel.some((bit) => bit !== 0 && bit !== 1)) {
      throw new Error('74HC165 needs eight parallel bits (0 or 1).')
    }
    if (!inputs.plBar) {
      // D0..D7 map to register bits 0..7; QH presents bit 7 first.
      this.register = inputs.parallel.reduce((value, bit, index) => value | ((bit ? 1 : 0) << index), 0)
    } else if (inputs.cp && !this.previousCp && !inputs.ceBar) {
      this.register = ((this.register << 1) & 0xff) | (inputs.ser ? 1 : 0)
    }
    this.previousCp = inputs.cp
    return {
      register: this.register,
      qh: (this.register >> 7) & 1,
      qhBar: ((this.register >> 7) & 1) === 1 ? 0 : 1,
    }
  }

  reset(): void {
    this.register = 0
    this.previousCp = false
  }
}

export interface Decoder138Inputs {
  a: boolean
  b: boolean
  c: boolean
  /** Active-high enable. */
  g1: boolean
  /** Active-low enables. */
  g2aBar: boolean
  g2bBar: boolean
}

export interface Decoder138Outputs {
  enabled: boolean
  /** Y0..Y7, active low; all ones when the device is disabled. */
  outputs: number[]
  selected: number | null
}

/** 74HC138 3-to-8 inverting decoder. */
export function decode138(inputs: Decoder138Inputs): Decoder138Outputs {
  const enabled = inputs.g1 && !inputs.g2aBar && !inputs.g2bBar
  if (!enabled) {
    return { enabled: false, outputs: new Array<number>(8).fill(1), selected: null }
  }
  const selected = (inputs.a ? 1 : 0) | (inputs.b ? 2 : 0) | (inputs.c ? 4 : 0)
  return {
    enabled: true,
    outputs: Array.from({ length: 8 }, (_, index) => (index === selected ? 0 : 1)),
    selected,
  }
}

export type MemoryDeviceKind = 'sram' | 'eeprom' | 'flash'

export interface MemoryDeviceOptions {
  kind: MemoryDeviceKind
  capacityBytes: number
  /** EEPROM/flash page size; writes may not cross a page boundary. */
  pageSizeBytes?: number
  /** Datasheet page-write time. */
  writeCycleMs?: number
  /** NOR flash sector size and erase time. */
  eraseSectorBytes?: number
  eraseTimeMs?: number
  /** Erased value for EEPROM/flash (0xff) or power-on value for SRAM (0x00). */
  blankValue?: number
}

export interface MemoryWriteResult {
  address: number
  stored: number
  changed: boolean
  timeMs: number
}

export interface MemoryPageWriteResult {
  startAddress: number
  bytesWritten: number
  timeMs: number
}

/**
 * Byte-addressed memory with the timing and write rules of its technology:
 * SRAM overwrites instantly, EEPROM writes in pages with a 5 ms cycle, and
 * NOR flash can only clear bits until the containing sector is erased.
 */
export class MemoryDevice {
  readonly kind: MemoryDeviceKind
  readonly capacityBytes: number
  readonly pageSizeBytes: number
  readonly writeCycleMs: number
  readonly eraseSectorBytes: number
  readonly eraseTimeMs: number
  private readonly data: Uint8Array

  constructor(options: MemoryDeviceOptions) {
    const { kind, capacityBytes } = options
    if (!Number.isInteger(capacityBytes) || capacityBytes <= 0) {
      throw new Error(`Memory capacity must be a positive integer, got ${capacityBytes}.`)
    }
    this.kind = kind
    this.capacityBytes = capacityBytes
    this.pageSizeBytes = options.pageSizeBytes ?? (kind === 'eeprom' ? 64 : kind === 'flash' ? 256 : capacityBytes)
    this.writeCycleMs = options.writeCycleMs ?? (kind === 'eeprom' ? 5 : kind === 'flash' ? 0.4 : 0)
    this.eraseSectorBytes = options.eraseSectorBytes ?? (kind === 'flash' ? 4096 : capacityBytes)
    this.eraseTimeMs = options.eraseTimeMs ?? (kind === 'flash' ? 400 : 0)
    if (!Number.isInteger(this.pageSizeBytes) || this.pageSizeBytes <= 0 || this.pageSizeBytes > capacityBytes) {
      throw new Error(`Page size ${this.pageSizeBytes} does not fit a ${capacityBytes}-byte device.`)
    }
    if (kind === 'flash' && (!Number.isInteger(this.eraseSectorBytes) || this.eraseSectorBytes <= 0)) {
      throw new Error(`Flash sector size must be a positive integer, got ${this.eraseSectorBytes}.`)
    }
    const blank = options.blankValue ?? (kind === 'sram' ? 0x00 : 0xff)
    if (!Number.isInteger(blank) || blank < 0 || blank > 255) {
      throw new Error(`Blank value must be one byte, got ${blank}.`)
    }
    this.data = new Uint8Array(capacityBytes).fill(blank)
  }

  private assertAddress(address: number): void {
    if (!Number.isInteger(address) || address < 0 || address >= this.capacityBytes) {
      throw new Error(`Address ${address} is outside 0..${this.capacityBytes - 1}.`)
    }
  }

  readByte(address: number): number {
    this.assertAddress(address)
    return this.data[address]
  }

  /** Raw array access for CRC checks; callers must not mutate it. */
  bytes(): Readonly<Uint8Array> {
    return this.data
  }

  writeByte(address: number, value: number): MemoryWriteResult {
    this.assertAddress(address)
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      throw new Error(`Value ${value} is not a byte.`)
    }
    const previous = this.data[address]
    let stored = value
    if (this.kind === 'flash') {
      // NOR programming can only clear bits. Bits the caller tries to set
      // remain zero rather than being invented.
      stored = previous & value
    }
    this.data[address] = stored
    return {
      address,
      stored,
      changed: stored !== previous,
      timeMs: this.kind === 'sram' ? 0 : this.writeCycleMs,
    }
  }

  writePage(startAddress: number, values: readonly number[]): MemoryPageWriteResult {
    this.assertAddress(startAddress)
    if (values.length === 0) throw new Error('A page write needs at least one byte.')
    if (values.length > this.pageSizeBytes) {
      throw new Error(`Page write of ${values.length} bytes exceeds the ${this.pageSizeBytes}-byte page.`)
    }
    values.forEach((value) => {
      if (!Number.isInteger(value) || value < 0 || value > 255) {
        throw new Error(`Value ${value} is not a byte.`)
      }
    })
    if (this.kind === 'sram') {
      throw new Error('SRAM has no page-write cycle; write bytes individually.')
    }
    const pageOffset = startAddress % this.pageSizeBytes
    if (pageOffset + values.length > this.pageSizeBytes) {
      throw new Error(
        `Page write from 0x${startAddress.toString(16)} crosses a ${this.pageSizeBytes}-byte page boundary.`,
      )
    }
    values.forEach((value, index) => {
      this.writeByte(startAddress + index, value)
    })
    return { startAddress, bytesWritten: values.length, timeMs: this.writeCycleMs }
  }

  /** Erase one NOR-flash sector to 0xFF. EEPROM/SRAM reject the operation. */
  eraseSector(address: number): { startAddress: number; bytesErased: number; timeMs: number } {
    if (this.kind !== 'flash') {
      throw new Error(`Erase is only defined for NOR flash, not ${this.kind}.`)
    }
    this.assertAddress(address)
    const start = address - (address % this.eraseSectorBytes)
    const end = Math.min(this.capacityBytes, start + this.eraseSectorBytes)
    this.data.fill(0xff, start, end)
    return { startAddress: start, bytesErased: end - start, timeMs: this.eraseTimeMs }
  }
}

/** Build the behavioural device described by a catalog part. */
export function memoryDeviceFromSpec(spec: MemorySpec): MemoryDevice {
  if (!spec.capacityBits) {
    throw new Error(`${spec.partNumber} is not a byte-addressed memory array.`)
  }
  const capacityBytes = spec.capacityBits / 8
  switch (spec.kind) {
    case 'sram':
      return new MemoryDevice({ kind: 'sram', capacityBytes })
    case 'eeprom':
      return new MemoryDevice({
        kind: 'eeprom',
        capacityBytes,
        pageSizeBytes: 64,
        writeCycleMs: 5,
        blankValue: 0xff,
      })
    case 'flash':
      return new MemoryDevice({
        kind: 'flash',
        capacityBytes,
        pageSizeBytes: 256,
        writeCycleMs: 0.4,
        eraseSectorBytes: 4096,
        eraseTimeMs: 400,
        blankValue: 0xff,
      })
    default:
      throw new Error(`${spec.partNumber} (${spec.kind}) has no byte-addressed model.`)
  }
}
