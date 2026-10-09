/**
 * Image-flasher proofs (Pi-class leg 6).
 * Synthetic MBR image: signature, two partitions, chunk plan + verify,
 * corruption caught at the right chunk.
 */
import { describe, expect, it } from 'vitest'
import { flashPlan, parseMbr, verifyFlash } from './imageFlasher'

/** 4-sector image: MBR + boot (1 sector, 0x0C) + root (2 sectors, 0x83). */
function syntheticImage(): Uint8Array {
  const image = new Uint8Array(4 * 512)
  const view = new DataView(image.buffer)
  // Partition 0: bootable, type 0x0C, LBA 1, 1 sector.
  image[446] = 0x80
  image[446 + 4] = 0x0c
  view.setUint32(446 + 8, 1, true)
  view.setUint32(446 + 12, 1, true)
  // Partition 1: type 0x83, LBA 2, 2 sectors.
  image[462 + 4] = 0x83
  view.setUint32(462 + 8, 2, true)
  view.setUint32(462 + 12, 2, true)
  // Payload markers.
  image[512] = 0x42
  image[1024] = 0x52
  image[510] = 0x55
  image[511] = 0xaa
  return image
}

describe('image flasher', () => {
  it('parses the MBR partition table', () => {
    const { partitions, error } = parseMbr(syntheticImage())
    expect(error).toBeUndefined()
    expect(partitions).toHaveLength(2)
    expect(partitions[0]).toMatchObject({ bootable: true, type: 0x0c, lbaStart: 1, sectors: 1 })
    expect(partitions[1]).toMatchObject({ bootable: false, type: 0x83, lbaStart: 2, sectors: 2 })
  })

  it('rejects an image without the MBR signature', () => {
    expect(parseMbr(new Uint8Array(512)).error).toContain('0x55AA')
    expect(parseMbr(new Uint8Array(10)).error).toContain('smaller')
  })

  it('plans chunks and verifies a clean write', async () => {
    const image = syntheticImage()
    const plan = await flashPlan(image, 512)
    expect(plan).toHaveLength(4)
    expect(plan[0].offset).toBe(0)
    expect(plan[0].length).toBe(512)
    const verdict = await verifyFlash(image, plan)
    expect(verdict.ok).toBe(true)
    expect(verdict.message).toContain('4 chunks')
  })

  it('catches corruption at the right chunk', async () => {
    const image = syntheticImage()
    const plan = await flashPlan(image, 512)
    const bad = Uint8Array.from(image)
    bad[1025] = bad[1025] ^ 0xff
    const verdict = await verifyFlash(bad, plan)
    expect(verdict.ok).toBe(false)
    expect(verdict.badChunk).toBe(2)
  })

  it('catches a short write', async () => {
    const image = syntheticImage()
    const plan = await flashPlan(image, 512)
    const verdict = await verifyFlash(image.subarray(0, 1000), plan)
    expect(verdict.ok).toBe(false)
  })
})
