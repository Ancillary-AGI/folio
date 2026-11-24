import { describe, expect, it } from 'vitest'
import { HEX_RECORD, bytesToIntelHex, hexChecksum, parseIntelHex, textToBytes } from './intelHex'

/**
 * Intel HEX codec tests.
 *
 * The format is fully specified, so it can be checked exactly: known-good records
 * from the specification, checksum arithmetic, extended addressing beyond 64 KiB,
 * and rejection of corrupted input.
 */

describe('hexChecksum', () => {
  it('is the two\u2019s complement of the 8-bit sum', () => {
    expect(hexChecksum([0x10, 0x00, 0x00, 0x00])).toBe(0xf0)
    expect(hexChecksum([0x00, 0x00, 0x00, 0x01])).toBe(0xff)
  })

  it('wraps modulo 256', () => {
    expect(hexChecksum([0xff, 0xff])).toBe(0x02)
    expect(hexChecksum([0x00])).toBe(0x00)
  })
})

describe('bytesToIntelHex', () => {
  it('emits the specification-shaped records for a 16-byte block', () => {
    const data = Uint8Array.from([
      0x21, 0x46, 0x01, 0x36, 0x01, 0x21, 0x47, 0x01, 0x36, 0x00, 0x21, 0x48, 0x01, 0x36, 0x00, 0x21,
    ])
    const records = bytesToIntelHex(data, { baseAddress: 0x0100 }).trim().split('\n')

    // Type-04 extended linear address first, then the data record, then EOF.
    expect(records[0]).toBe(':020000040000FA')
    expect(records[1].startsWith(':10010000')).toBe(true)
    expect(records[2]).toBe(':00000001FF')
  })

  it('round-trips arbitrary data exactly', () => {
    const original = new Uint8Array(5000)
    for (let index = 0; index < original.length; index += 1) original[index] = (index * 31 + 7) & 0xff

    const parsed = parseIntelHex(bytesToIntelHex(original, { baseAddress: 0x0800 }))
    expect('error' in parsed).toBe(false)
    if ('error' in parsed) return

    expect(parsed.baseAddress).toBe(0x0800)
    expect(parsed.bytes).toEqual(original)
    expect(parsed.dataRecords).toBe(Math.ceil(5000 / 16))
  })

  it('opens a new extended-address record above 64 KiB', () => {
    const hex = bytesToIntelHex(new Uint8Array(0x10100), { baseAddress: 0 })
    const typeFour = hex.trim().split('\n').filter((line) => line.slice(7, 9) === '04')
    expect(typeFour).toHaveLength(2)
    expect(typeFour[1]).toBe(':020000040001F9')
  })

  it('round-trips an image spanning a 64 KiB boundary', () => {
    const base = 0x10000 - 8
    const data = Uint8Array.from({ length: 64 }, (_, index) => index)

    const parsed = parseIntelHex(bytesToIntelHex(data, { baseAddress: base }))
    expect('error' in parsed).toBe(false)
    if ('error' in parsed) return
    expect(parsed.baseAddress).toBe(base)
    expect(parsed.bytes).toEqual(data)
  })

  it('rejects an out-of-range base address', () => {
    expect(() => bytesToIntelHex(new Uint8Array(1), { baseAddress: -1 })).toThrow(/32 bits/)
    expect(() => bytesToIntelHex(new Uint8Array(1), { baseAddress: 0x1_0000_0000 })).toThrow(/32 bits/)
  })

  it('handles an empty image as EOF only', () => {
    const hex = bytesToIntelHex(new Uint8Array(0))
    expect(hex.trim()).toBe(':00000001FF')
    const parsed = parseIntelHex(hex)
    expect('error' in parsed).toBe(false)
    if ('error' in parsed) return
    expect(parsed.bytes).toHaveLength(0)
  })
})

describe('parseIntelHex', () => {
  it('detects a corrupted checksum and names the line', () => {
    const lines = bytesToIntelHex(Uint8Array.from([1, 2, 3]), { baseAddress: 0 }).trim().split('\n')
    // Flip the last data nibble without recomputing the checksum.
    const record = lines[1]
    lines[1] = `${record.slice(0, record.length - 3)}${record[record.length - 3] === '0' ? '1' : '0'}${record.slice(record.length - 2)}`

    const parsed = parseIntelHex(lines.join('\n'))
    expect('error' in parsed).toBe(true)
    if (!('error' in parsed)) return
    expect(parsed.error).toBe('Checksum mismatch')
    expect(parsed.line).toBe(2)
  })

  it('rejects malformed records with a useful message', () => {
    const missingColon = parseIntelHex('00000001FF')
    expect('error' in missingColon && missingColon.error).toMatch(/start with/)

    const oddDigits = parseIntelHex(':00000001FFF')
    expect('error' in oddDigits && oddDigits.error).toMatch(/odd number/)

    const notHex = parseIntelHex(':ZZ000001FF')
    expect('error' in notHex && notHex.error).toMatch(/non-hexadecimal/)

    // A well-formed image with its final EOF record removed.
    const withoutEof = bytesToIntelHex(Uint8Array.from([1, 2, 3]), { baseAddress: 0 })
      .trim()
      .split('\n')
      .slice(0, -1)
      .join('\n')
    const noEof = parseIntelHex(withoutEof)
    expect('error' in noEof).toBe(true)
    if (!('error' in noEof)) return
    expect(noEof.error).toMatch(/end-of-file/)

    // A record whose type code is not in the specification, with a valid checksum.
    const unknownBody = [0x00, 0x00, 0x00, 0x06]
    const unknownRecord = `:${unknownBody.map((byte) => byte.toString(16).padStart(2, '0')).join('')}${hexChecksum(
      unknownBody,
    )
      .toString(16)
      .padStart(2, '0')}`
    const unknownType = parseIntelHex(`${unknownRecord}\n:00000001FF`)
    expect('error' in unknownType && unknownType.error).toMatch(/Unknown record type/)
  })

  it('rejects a length field that disagrees with the payload', () => {
    // Declares 4 data bytes but carries 2; the checksum is correct, so length is the fault.
    const body = [0x04, 0x00, 0x00, 0x00, 0xaa, 0xbb]
    const record = `:${body.map((byte) => byte.toString(16).padStart(2, '0')).join('')}${hexChecksum(body)
      .toString(16)
      .padStart(2, '0')}`
    const parsed = parseIntelHex(`${record}\n:00000001FF`)
    expect('error' in parsed && parsed.error).toMatch(/declares 4 data bytes/)
  })

  it('accepts a start-linear-address record without treating it as loadable data', () => {
    const startLinear = [0x04, 0x00, 0x00, 0x05, 0x00, 0x00, 0x08, 0x00]
    const record = `:${startLinear.map((byte) => byte.toString(16).padStart(2, '0')).join('')}${hexChecksum(
      startLinear,
    )
      .toString(16)
      .padStart(2, '0')}`
    const parsed = parseIntelHex(`${record}\n:00000001FF`)
    expect('error' in parsed).toBe(false)
    if ('error' in parsed) return
    expect(parsed.dataRecords).toBe(0)
  })
})

describe('textToBytes', () => {
  it('encodes UTF-8, including multi-byte characters', () => {
    expect(Array.from(textToBytes('Ω'))).toEqual([0xce, 0xa9])
  })
})

describe('record type constants', () => {
  it('match the specification', () => {
    expect(HEX_RECORD.data).toBe(0)
    expect(HEX_RECORD.endOfFile).toBe(1)
    expect(HEX_RECORD.extendedLinearAddress).toBe(4)
  })
})
