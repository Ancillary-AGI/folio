/**
 * Intel HEX codec.
 *
 * Intel HEX is the interchange format AVR and many other bootloaders accept, and
 * it is completely specified: a sequence of ASCII records
 *   `:` + length + address (2 bytes, big-endian) + type + data + checksum
 * where the checksum is the two's complement of the 8-bit sum of every preceding
 * byte in the record.
 *
 * Why this module exists: the compiler previously produced its `hex` field by
 * concatenating `Math.random().toString(16)` — a string that *looks* like a hex
 * file, has no valid checksums, and would be rejected (or worse, mis-written) by a
 * programmer. Generating and *verifying* the real format is cheap, so it is done
 * properly here and round-trip tested.
 */

/** Record type codes defined by the Intel HEX specification. */
export const HEX_RECORD = Object.freeze({
  data: 0x00,
  endOfFile: 0x01,
  extendedSegmentAddress: 0x02,
  startSegmentAddress: 0x03,
  extendedLinearAddress: 0x04,
  startLinearAddress: 0x05,
})

const DEFAULT_RECORD_LENGTH = 16
const ADDRESS_SPACE = 0x10000

/** Two's complement of the 8-bit sum of `bytes`, as the spec requires. */
export function hexChecksum(bytes: readonly number[]): number {
  let sum = 0
  for (const byte of bytes) sum = (sum + byte) & 0xff
  return (0x100 - sum) & 0xff
}

const toHexByte = (value: number): string => (value & 0xff).toString(16).padStart(2, '0').toUpperCase()

function buildRecord(address: number, type: number, data: readonly number[]): string {
  /*
   * Header is four bytes: length (1), address (2, big-endian), type (1).
   * Emitting a two-byte length — as an earlier version did — produces records no
   * programmer will accept, because the parser then reads the type byte as data.
   */
  if (data.length > 255) throw new Error('Intel HEX: a record may carry at most 255 bytes.')
  const body = [data.length & 0xff, (address >> 8) & 0xff, address & 0xff, type, ...data]
  return `:${body.map(toHexByte).join('')}${toHexByte(hexChecksum(body))}`
}

export interface IntelHexOptions {
  /** Load address of the first byte. */
  baseAddress?: number
  /** Bytes per data record; 16 is the near-universal convention. */
  recordLength?: number
}

/**
 * Encode `bytes` as Intel HEX.
 *
 * Addresses above 64 KiB are opened with a type-04 extended-linear-address record,
 * which is what makes this correct for images larger than one 16-bit segment.
 */
export function bytesToIntelHex(bytes: Uint8Array, options: IntelHexOptions = {}): string {
  const baseAddress = options.baseAddress ?? 0
  const recordLength = Math.max(1, Math.min(255, options.recordLength ?? DEFAULT_RECORD_LENGTH))
  if (baseAddress < 0 || baseAddress > 0xffffffff) throw new Error('Intel HEX: base address must fit in 32 bits.')

  const lines: string[] = []
  let currentUpper = -1

  for (let offset = 0; offset < bytes.length; offset += recordLength) {
    const absolute = baseAddress + offset
    const upper = Math.floor(absolute / ADDRESS_SPACE)
    if (upper !== currentUpper) {
      lines.push(buildRecord(0, HEX_RECORD.extendedLinearAddress, [(upper >> 8) & 0xff, upper & 0xff]))
      currentUpper = upper
    }
    const chunk = Array.from(bytes.subarray(offset, Math.min(offset + recordLength, bytes.length)))
    lines.push(buildRecord(absolute % ADDRESS_SPACE, HEX_RECORD.data, chunk))
  }

  lines.push(buildRecord(0, HEX_RECORD.endOfFile, []))
  return `${lines.join('\n')}\n`
}

/** UTF-8 encode a string, for embedding text in an image. */
export function textToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

export interface ParsedIntelHex {
  bytes: Uint8Array
  /** Lowest address written. */
  baseAddress: number
  /** Number of data records consumed. */
  dataRecords: number
}

export interface IntelHexParseFailure {
  error: string
  /** 1-based line number of the offending record. */
  line: number
}

/**
 * Parse and *verify* an Intel HEX image: every checksum is recomputed and any
 * malformed record is reported with its line number. Used by the test suite to
 * prove the encoder emits something a real programmer would accept.
 */
export function parseIntelHex(text: string): ParsedIntelHex | IntelHexParseFailure {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  const segments: Array<{ address: number; data: number[] }> = []
  let upper = 0
  let dataRecords = 0
  let sawEnd = false

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const lineNumber = index + 1
    if (!line.startsWith(':')) return { error: 'Record does not start with ":"', line: lineNumber }
    const payload = line.slice(1)
    if (payload.length % 2 !== 0) return { error: 'Record has an odd number of hex digits', line: lineNumber }
    if (!/^[0-9a-fA-F]+$/.test(payload)) {
      return { error: 'Record contains non-hexadecimal characters', line: lineNumber }
    }

    const bytes: number[] = []
    for (let pair = 0; pair < payload.length; pair += 2) {
      bytes.push(parseInt(payload.slice(pair, pair + 2), 16))
    }
    if (bytes.length < 5) return { error: 'Record is shorter than the 5-byte header', line: lineNumber }

    const byteCount = bytes[0]
    const address = (bytes[1] << 8) | bytes[2]
    const type = bytes[3]
    const data = bytes.slice(4, 4 + byteCount)

    if (bytes.length !== 5 + byteCount) {
      return {
        error: `Record declares ${byteCount} data bytes but carries ${bytes.length - 5}`,
        line: lineNumber,
      }
    }
    if (hexChecksum(bytes.slice(0, bytes.length - 1)) !== bytes[bytes.length - 1]) {
      return { error: 'Checksum mismatch', line: lineNumber }
    }

    switch (type) {
      case HEX_RECORD.data:
        segments.push({ address: upper + address, data })
        dataRecords += 1
        break
      case HEX_RECORD.extendedLinearAddress:
        if (data.length !== 2) {
          return { error: 'Extended linear address record must carry 2 bytes', line: lineNumber }
        }
        upper = ((data[0] << 8) | data[1]) * ADDRESS_SPACE
        break
      case HEX_RECORD.endOfFile:
        sawEnd = true
        break
      case HEX_RECORD.extendedSegmentAddress:
      case HEX_RECORD.startSegmentAddress:
      case HEX_RECORD.startLinearAddress:
        // Valid records that carry no loadable data.
        break
      default:
        return { error: `Unknown record type 0x${toHexByte(type)}`, line: lineNumber }
    }
  }

  if (!sawEnd) return { error: 'Missing end-of-file record', line: lines.length }
  if (segments.length === 0) return { bytes: new Uint8Array(0), baseAddress: 0, dataRecords: 0 }

  const baseAddress = Math.min(...segments.map((segment) => segment.address))
  const endAddress = Math.max(...segments.map((segment) => segment.address + segment.data.length))
  const image = new Uint8Array(endAddress - baseAddress)
  for (const segment of segments) image.set(segment.data, segment.address - baseAddress)

  return { bytes: image, baseAddress, dataRecords }
}
