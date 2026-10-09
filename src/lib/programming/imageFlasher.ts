/**
 * Bulk image flasher core (Pi-class leg 6).
 * A Pi-class board takes an OS image: gigabytes to SD/eMMC, chunked,
 * checksummed, verified — not UART bytes. A browser cannot touch block
 * devices, so this module is the half that CAN live here: image parsing
 * (MBR partition table), chunk plan with per-chunk SHA-256, progress
 * accounting, and verify-against-source. The companion daemon (Node/USB)
 * executes the plan; this module builds and verifies it, and the tests
 * prove the plan byte-exact on a synthetic image.
 */
export interface MbrPartition {
  index: number
  bootable: boolean
  type: number
  lbaStart: number
  sectors: number
  sizeBytes: number
}

export interface FlashChunk {
  index: number
  offset: number
  length: number
  sha256: string
}

const SECTOR = 512

/** Parse the MBR partition table (first sector, 0x55AA signature). */
export function parseMbr(image: Uint8Array): { partitions: MbrPartition[]; error?: string } {
  if (image.length < SECTOR) return { partitions: [], error: 'image smaller than one sector' }
  if (image[510] !== 0x55 || image[511] !== 0xaa) return { partitions: [], error: 'missing MBR signature 0x55AA' }
  const view = new DataView(image.buffer, image.byteOffset, image.byteLength)
  const partitions: MbrPartition[] = []
  for (let i = 0; i < 4; i++) {
    const base = 446 + i * 16
    const type = image[base + 4] ?? 0
    if (type === 0) continue
    const lbaStart = view.getUint32(base + 8, true)
    const sectors = view.getUint32(base + 12, true)
    partitions.push({ index: i, bootable: (image[base] ?? 0) === 0x80, type, lbaStart, sectors, sizeBytes: sectors * SECTOR })
  }
  return { partitions }
}

/** SHA-256 hex of bytes (async: SubtleCrypto). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Chunk plan: fixed-size chunks with per-chunk hashes (last may be short). */
export async function flashPlan(image: Uint8Array, chunkSize = 1024 * 1024): Promise<FlashChunk[]> {
  const chunks: FlashChunk[] = []
  let index = 0
  for (let offset = 0; offset < image.length; offset += chunkSize) {
    const slice = image.subarray(offset, Math.min(offset + chunkSize, image.length))
    chunks.push({ index, offset, length: slice.length, sha256: await sha256Hex(slice) })
    index += 1
  }
  return chunks
}

/** Verify written bytes against the plan: first mismatch or success. */
export async function verifyFlash(
  written: Uint8Array,
  plan: FlashChunk[],
): Promise<{ ok: boolean; badChunk?: number; message: string }> {
  for (const chunk of plan) {
    const slice = written.subarray(chunk.offset, chunk.offset + chunk.length)
    if (slice.length !== chunk.length) return { ok: false, badChunk: chunk.index, message: `chunk ${chunk.index}: short read` }
    const hash = await sha256Hex(slice)
    if (hash !== chunk.sha256) return { ok: false, badChunk: chunk.index, message: `chunk ${chunk.index}: hash mismatch` }
  }
  return { ok: true, message: `verified ${plan.length} chunks` }
}
