/**
 * Minimal, dependency-free ZIP archive writer (STORE method).
 *
 * Why stored rather than deflated:
 *   - The workbench targets the browser, where node's zlib does not exist.
 *     Compression would have to come from a dependency or the platform; fab
 *     houses accept stored archives, and the package is ~100 kB of text.
 *   - CRC-32 and the record framing are the parts that must be exactly
 *     right; a hand-rolled deflate is a correctness risk for zero value here.
 *
 * Format references: APPNOTE.TXT (PKWARE), sections 4.3 (local file header),
 * 4.4 (central directory file header), 4.5 (end of central directory record).
 * CRC-32 is the IEEE 802.3 polynomial (0xEDB88320), the same one every
 * shipping ZIP reader verifies.
 *
 * Only flat, regular entries are emitted: a fab package is a flat bundle of
 * Gerber/Excellon/CSV/TXT files, and directories would add records nothing
 * downstream reads.
 */

const LOCAL_HEADER_SIGNATURE = 0x04034b50
const CENTRAL_HEADER_SIGNATURE = 0x02014b50
const END_OF_CENTRAL_SIGNATURE = 0x06054b50
const UTF8_FLAG = 0x0800
const STORE_METHOD = 0
const VERSION_NEEDED = 20
const EXTERNAL_ATTRS_REGULAR = (0o100644 << 16) >>> 0
const MAX_ARCHIVE_BYTES = 0xffffffff

let crcTable: Uint32Array | null = null

function table(): Uint32Array {
  if (crcTable) return crcTable
  const entries = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let value = i
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? (value >>> 1) ^ 0xedb88320 : value >>> 1
    }
    entries[i] = value >>> 0
  }
  crcTable = entries
  return entries
}

export function crc32(bytes: Uint8Array): number {
  const lookup = table()
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i += 1) {
    crc = ((crc >>> 8) ^ lookup[(crc ^ bytes[i]) & 0xff]) >>> 0
  }
  return (crc ^ 0xffffffff) >>> 0
}

function dosDateTime(date: Date): { time: number; date: number } {
  const clampYear = Math.min(2107, Math.max(1980, date.getFullYear()))
  const dosTime = ((date.getSeconds() >> 1) & 0x1f) | ((date.getMinutes() << 5) & 0x7e0) | ((date.getHours() << 11) & 0xf800)
  const dosDate = (date.getDate() & 0x1f) | (((date.getMonth() + 1) << 5) & 0x1e0) | (((clampYear - 1980) << 9) & 0xfe00)
  return { time: dosTime >>> 0, date: dosDate >>> 0 }
}

function writeUint16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value & 0xffff, true)
}

function writeUint32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true)
}

/**
 * Build the archive bytes for `entries`. `now` is injectable so tests can
 * produce byte-identical archives.
 *
 * Throws when the archive would exceed the 32-bit offset field — silently
 * wrapping an offset would produce a corrupt package a fab house refuses.
 */
export function createZipBytes(
  entries: Iterable<{ name: string; data: Uint8Array }>,
  now: Date = new Date(),
): Uint8Array {
  const encoder = new TextEncoder()
  const stamps = dosDateTime(now)
  const rows: Array<{
    nameBytes: Uint8Array
    data: Uint8Array
    crc: number
    localOffset: number
  }> = []

  let cursor = 0
  for (const entry of entries) {
    if (!entry.name || entry.name.includes('/') || entry.name.includes('\\')) {
      throw new Error(`Zip entry name must be a flat file name, got ${JSON.stringify(entry.name)}`)
    }
    const nameBytes = encoder.encode(entry.name)
    const crc = crc32(entry.data)
    rows.push({ nameBytes, data: entry.data, crc, localOffset: cursor })
    cursor += 30 + nameBytes.length + entry.data.length
    if (cursor > MAX_ARCHIVE_BYTES) {
      throw new Error('Zip64 is required for archives over 4 GB; refusing to emit a corrupt archive')
    }
  }

  const centralSize = rows.reduce((sum, row) => sum + 46 + row.nameBytes.length, 0)
  const endOffset = cursor + centralSize
  const buffer = new Uint8Array(endOffset + 22)
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)

  for (const row of rows) {
    const localOffset = row.localOffset
    writeUint32(view, localOffset, LOCAL_HEADER_SIGNATURE)
    writeUint16(view, localOffset + 4, VERSION_NEEDED)
    writeUint16(view, localOffset + 6, UTF8_FLAG)
    writeUint16(view, localOffset + 8, STORE_METHOD)
    writeUint16(view, localOffset + 10, stamps.time)
    writeUint16(view, localOffset + 12, stamps.date)
    writeUint32(view, localOffset + 14, row.crc)
    writeUint32(view, localOffset + 18, row.data.length)
    writeUint32(view, localOffset + 22, row.data.length)
    writeUint16(view, localOffset + 26, row.nameBytes.length)
    writeUint16(view, localOffset + 28, 0)
    buffer.set(row.nameBytes, localOffset + 30)
    buffer.set(row.data, localOffset + 30 + row.nameBytes.length)
  }

  let centralCursor = cursor
  for (const row of rows) {
    writeUint32(view, centralCursor, CENTRAL_HEADER_SIGNATURE)
    writeUint16(view, centralCursor + 4, VERSION_NEEDED)
    writeUint16(view, centralCursor + 6, VERSION_NEEDED)
    writeUint16(view, centralCursor + 8, UTF8_FLAG)
    writeUint16(view, centralCursor + 10, STORE_METHOD)
    writeUint16(view, centralCursor + 12, stamps.time)
    writeUint16(view, centralCursor + 14, stamps.date)
    writeUint32(view, centralCursor + 16, row.crc)
    writeUint32(view, centralCursor + 20, row.data.length)
    writeUint32(view, centralCursor + 24, row.data.length)
    writeUint16(view, centralCursor + 28, row.nameBytes.length)
    writeUint16(view, centralCursor + 30, 0)
    writeUint16(view, centralCursor + 32, 0)
    writeUint16(view, centralCursor + 34, 0)
    writeUint16(view, centralCursor + 36, 0)
    writeUint32(view, centralCursor + 38, EXTERNAL_ATTRS_REGULAR)
    writeUint32(view, centralCursor + 42, row.localOffset)
    buffer.set(row.nameBytes, centralCursor + 46)
    centralCursor += 46 + row.nameBytes.length
  }

  writeUint32(view, endOffset, END_OF_CENTRAL_SIGNATURE)
  writeUint16(view, endOffset + 4, 0)
  writeUint16(view, endOffset + 6, 0)
  writeUint16(view, endOffset + 8, rows.length)
  writeUint16(view, endOffset + 10, rows.length)
  writeUint32(view, endOffset + 12, centralSize)
  writeUint32(view, endOffset + 16, cursor)
  writeUint16(view, endOffset + 20, 0)

  return buffer
}

/** Encode a `filename → text content` map into a stored archive. */
export function createTextZipBytes(
  files: Iterable<readonly [string, string]>,
  now: Date = new Date(),
): Uint8Array {
  const encoder = new TextEncoder()
  return createZipBytes(
    Array.from(files, ([name, text]) => ({ name, data: encoder.encode(text) })),
    now,
  )
}
