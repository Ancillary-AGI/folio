/**
 * Upload-session proofs (Giant 3).
 *
 * A scripted fake transport plays bootloader: sync, load-address,
 * program-page, read-page — with programmable faults (NACK, corrupt
 * echo, silence). No hardware, no serial ports, deterministic.
 */
import { describe, expect, it } from 'vitest'
import { bytesToIntelHex } from '../compilation/intelHex'
import {
  STK_INSYNC,
  STK_OK,
  uploadHexImage,
  type ByteTransport,
} from './uploadSession'

/** In-memory flash with an STK500v1 bootloader personality. */
class FakeBootloader implements ByteTransport {
  flash = new Uint8Array(32 * 1024).fill(0xff)
  wordAddress = 0
  faults: Array<'nack' | 'corrupt' | 'silent'> = []
  written: Uint8Array[] = []
  private listeners: Array<(data: Uint8Array) => void> = []

  onData(callback: (data: Uint8Array) => void): void {
    this.listeners.push(callback)
  }

  private emit(bytes: Uint8Array): void {
    queueMicrotask(() => this.listeners.forEach((listener) => listener(bytes)))
  }

  async write(data: Uint8Array): Promise<void> {
    this.written.push(Uint8Array.from(data))
    const fault = this.faults.shift()
    if (fault === 'silent') return // never replies: caller must time out
    const command = data[0] ?? 0
    if (command === 0x30) {
      this.emit(fault === 'nack' ? Uint8Array.from([0x15, 0x10]) : Uint8Array.from([STK_INSYNC, STK_OK]))
      return
    }
    if (command === 0x55) {
      this.wordAddress = ((data[2] ?? 0) << 8) | (data[1] ?? 0)
      this.emit(fault === 'nack' ? Uint8Array.from([STK_INSYNC, 0x11]) : Uint8Array.from([STK_INSYNC, STK_OK]))
      return
    }
    if (command === 0x64) {
      const length = ((data[1] ?? 0) << 8) | (data[2] ?? 0)
      const payload = data.slice(4, 4 + length)
      this.flash.set(payload, this.wordAddress * 2)
      this.emit(fault === 'nack' ? Uint8Array.from([0x15, 0x10]) : Uint8Array.from([STK_INSYNC, STK_OK]))
      return
    }
    if (command === 0x74) {
      const length = ((data[1] ?? 0) << 8) | (data[2] ?? 0)
      const echo = this.flash.slice(this.wordAddress * 2, this.wordAddress * 2 + length)
      if (fault === 'corrupt') echo[0] = (echo[0] ?? 0) ^ 0xff
      this.emit(Uint8Array.from([STK_INSYNC, ...echo, STK_OK]))
      return
    }
    this.emit(Uint8Array.from([0x15, 0x10]))
  }
}

const image = (length = 300): string => {
  const bytes = Uint8Array.from({ length }, (_, index) => index & 0xff)
  return bytesToIntelHex(bytes, { baseAddress: 0 })
}

describe('upload session — STK500v1 with read-back verification', () => {
  it('uploads and verifies a multi-page image', async () => {
    const bootloader = new FakeBootloader()
    const seen: number[] = []
    const result = await uploadHexImage(bootloader, image(), {
      onProgress: (progress) => seen.push(progress.pagesDone),
    })
    expect(result.success).toBe(true)
    expect(result.pagesTotal).toBe(3)
    expect(result.bytesVerified).toBe(3 * 128)
    expect(seen).toEqual([1, 2, 3])
    expect(result.message).toContain('verified')
  })

  it('refuses a malformed image instead of flashing garbage', async () => {
    const bootloader = new FakeBootloader()
    const result = await uploadHexImage(bootloader, ':ZZZZ\n:00000001FF\n')
    expect(result.success).toBe(false)
    expect(result.message).toContain('Intel HEX')
    expect(bootloader.written).toHaveLength(0)
  })

  it('refuses an image larger than flash instead of truncating', async () => {
    const bootloader = new FakeBootloader()
    const result = await uploadHexImage(bootloader, image(), { flashSize: 128 })
    expect(result.success).toBe(false)
    expect(result.message).toContain('exceed flash')
    expect(bootloader.written).toHaveLength(0)
  })

  it('fails loudly when the bootloader never syncs', async () => {
    const bootloader = new FakeBootloader()
    bootloader.faults = ['silent']
    const result = await uploadHexImage(bootloader, image(), { timeoutMs: 50 })
    expect(result.success).toBe(false)
    expect(result.message).toContain('sync')
  })

  it('fails loudly on a NACK mid-program', async () => {
    const bootloader = new FakeBootloader()
    // Sync clean, then NACK the first LOAD_ADDRESS.
    const originalWrite = bootloader.write.bind(bootloader)
    let calls = 0
    bootloader.write = async (data: Uint8Array): Promise<void> => {
      calls += 1
      if (calls === 2) bootloader.faults = ['nack']
      await originalWrite(data)
    }
    const result = await uploadHexImage(bootloader, image())
    expect(result.success).toBe(false)
    expect(result.message).toContain('Programming failed')
  })

  it('catches a corrupt read-back instead of reporting success', async () => {
    const corrupting = new FakeBootloader()
    let reads = 0
    const originalWrite = corrupting.write.bind(corrupting)
    corrupting.write = async (data: Uint8Array): Promise<void> => {
      if ((data[0] ?? 0) === 0x74) {
        reads += 1
        if (reads === 1) {
          corrupting.faults = ['corrupt']
        }
      }
      await originalWrite(data)
    }
    const result = await uploadHexImage(corrupting, image())
    expect(result.success).toBe(false)
    expect(result.message).toContain('mismatch')
  })
})
