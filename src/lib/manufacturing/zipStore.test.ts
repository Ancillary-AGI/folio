import { describe, expect, it } from 'vitest'
import { createTextZipBytes, createZipBytes, crc32 } from './zipStore'

const readUInt16 = (view: DataView, offset: number) => view.getUint16(offset, true)
const readUInt32 = (view: DataView, offset: number) => view.getUint32(offset, true)

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

const LOCAL_HEADER = 0x04034b50
const CENTRAL_HEADER = 0x02014b50
const END_OF_CENTRAL = 0x06054b50

interface ParsedEntry {
  nameBytes: Uint8Array
  crc: number
  dataOffset: number
  size: number
}

function parseArchive(bytes: Uint8Array): { entries: ParsedEntry[]; central: number; end: number } {
  const data = view(bytes)
  if (readUInt32(data, 0) !== LOCAL_HEADER) throw new Error('No local file header at offset 0')
  const entries: ParsedEntry[] = []

  let offset = 0
  while (readUInt32(data, offset) === LOCAL_HEADER) {
    const nameLength = readUInt16(data, offset + 26)
    const extraLength = readUInt16(data, offset + 28)
    const size = readUInt32(data, offset + 18)
    const crc = readUInt32(data, offset + 14)
    const nameStart = offset + 30
    entries.push({
      nameBytes: bytes.subarray(nameStart, nameStart + nameLength),
      crc,
      dataOffset: nameStart + nameLength + extraLength,
      size,
    })
    offset = nameStart + nameLength + extraLength + size
  }

  if (readUInt32(data, offset) !== CENTRAL_HEADER) {
    throw new Error(`Expected central directory after last entry, found 0x${readUInt32(data, offset).toString(16)}`)
  }
  const central = offset
  let cursor = central
  while (readUInt32(data, cursor) === CENTRAL_HEADER) {
    const nameLength = readUInt16(data, cursor + 28)
    const extraLength = readUInt16(data, cursor + 30)
    const commentLength = readUInt16(data, cursor + 32)
    cursor += 46 + nameLength + extraLength + commentLength
  }
  if (readUInt32(data, cursor) !== END_OF_CENTRAL) {
    throw new Error('Expected end-of-central-directory after central directory')
  }
  return { entries, central, end: cursor }
}

describe('crc32', () => {
  it('matches the canonical IEEE check vector', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
    expect(crc32(new Uint8Array(0))).toBe(0)
  })
})

describe('createZipBytes', () => {
  it('emits an empty but valid archive when there are no entries', () => {
    const bytes = createZipBytes([])
    expect(bytes.byteLength).toBe(22)
    const data = view(bytes)
    expect(readUInt32(data, 0)).toBe(END_OF_CENTRAL)
    expect(readUInt16(data, 10)).toBe(0)
  })

  it('round-trips one text file through the local header and central directory', () => {
    const bytes = createTextZipBytes([['folio.gbr', 'G04*M02*']], new Date(2026, 10, 11, 10, 30, 40))
    const { entries, central, end } = parseArchive(bytes)

    expect(entries).toHaveLength(1)
    expect(new TextDecoder().decode(entries[0].nameBytes)).toBe('folio.gbr')
    expect(entries[0].size).toBe(8)
    expect(entries[0].crc).toBe(crc32(new TextEncoder().encode('G04*M02*')))
    expect(new TextDecoder().decode(bytes.subarray(entries[0].dataOffset, entries[0].dataOffset + entries[0].size))).toBe('G04*M02*')

    const data = view(bytes)
    // Local header DOS date decodes to the injected date (2026-11-11).
    const dosDate = readUInt16(data, 12)
    expect((dosDate >> 9) + 1980).toBe(2026)
    expect(((dosDate >> 5) & 0x0f)).toBe(11)
    expect(dosDate & 0x1f).toBe(11)
    // Rebuilding with the same injected date is byte-identical.
    expect(createTextZipBytes([['folio.gbr', 'G04*M02*']], new Date(2026, 10, 11, 10, 30, 40))).toEqual(bytes)
    expect(readUInt32(data, end + 16)).toBe(central)
  })

  it('records every entry with matching CRCs and consistent offsets', () => {
    const files: Array<[string, string]> = [
      ['F.Cu.gbr', '%FSLAX24Y24*'],
      ['B_Cu.gbr', '%FSLAX24Y24*\nG04*\n'],
      ['drill.drl', 'M48\n'],
      ['board-centroid.csv', 'Ref,Val,Package,PosX,PosY,Rot,Side\n'],
      ['bom.csv', 'Item,Qty,Reference,Value,Package\n'],
    ]
    const bytes = createTextZipBytes(files, new Date(2026, 10, 11))
    const { entries, central, end } = parseArchive(bytes)
    const data = view(bytes)

    expect(entries.map((entry) => new TextDecoder().decode(entry.nameBytes))).toEqual(files.map(([name]) => name))
    for (const entry of entries) {
      const payload = bytes.subarray(entry.dataOffset, entry.dataOffset + entry.size)
      expect(entry.crc).toBe(crc32(payload))
    }
    expect(readUInt16(data, end + 8)).toBe(files.length)
    expect(readUInt16(data, end + 10)).toBe(files.length)
    // The end-of-central-directory points at the central directory header, which
    // sits exactly after the last local entry.
    expect(readUInt32(data, end + 16)).toBe(central)
    expect(central).toBe(entries[entries.length - 1].dataOffset + entries[entries.length - 1].size)
  })

  it('survives non-ASCII file names without corrupting the name bytes', () => {
    const bytes = createTextZipBytes([['pièce-etched.gbr', 'G04*']], new Date(2026, 10, 11))
    const { entries } = parseArchive(bytes)
    expect(new TextDecoder().decode(entries[0].nameBytes)).toBe('pièce-etched.gbr')
  })

  it('rejects a path-shaped entry name rather than emitting a traversal entry', () => {
    expect(() => createTextZipBytes([['../evil.txt', 'nope']])).toThrow(/flat file name/)
    expect(() => createTextZipBytes([['dir/file.txt', 'nope']])).toThrow(/flat file name/)
  })

  it('writes DOS timestamps clamped to the supported range', () => {
    const bytes = createTextZipBytes([['t.txt', 'x']], new Date(1970, 0, 1))
    const data = view(bytes)
    const dosDate = readUInt16(data, 12)
    expect((dosDate >> 9) + 1980).toBe(1980)
  })
})
