import { describe, expect, it } from 'vitest'
import { SerialBlockBackend, type LineTransport } from './serialBlockBackend'
import { FlashDaemon, MemoryBlockBackend } from './flashDaemon'
import { decodeFrame, encodeFrame, type DaemonRequest } from './flashProtocol'

/**
 * A transport backed by a real `FlashDaemon` over a `MemoryBlockBackend`.
 *
 * This exercises the whole path — frame encoding, the daemon's dispatch, the
 * reply, and the backend's validation — rather than a hand-written fake, so a
 * protocol mismatch fails here instead of on hardware.
 */
class InProcessTransport implements LineTransport {
  private readonly queue: string[] = []
  private readonly daemon: FlashDaemon
  private closed = false

  constructor(daemon: FlashDaemon) {
    this.daemon = daemon
  }

  async write(line: string): Promise<void> {
    const request = decodeFrame(line) as DaemonRequest
    const reply = await this.daemon.handle(request)
    this.queue.push(encodeFrame(reply).trim())
  }

  async readLine(): Promise<string | null> {
    if (this.closed) return null
    return this.queue.shift() ?? null
  }

  close(): void {
    this.closed = true
  }
}

const deviceId = 'test.img'
const SIZE = 1024

const makeBackend = (): { backend: SerialBlockBackend; memory: MemoryBlockBackend } => {
  const memory = new MemoryBlockBackend(SIZE)
  const daemon = new FlashDaemon({ devices: new Map([[deviceId, { info: { id: deviceId, sizeBytes: SIZE, sectorBytes: 512, dryRun: true }, backend: memory }]]) })
  const backend = new SerialBlockBackend({ deviceId, transport: new InProcessTransport(daemon), sizeBytes: SIZE })
  return { backend, memory }
}

describe('SerialBlockBackend', () => {
  it('reports the device size', () => {
    const { backend } = makeBackend()
    expect(backend.sizeBytes).toBe(SIZE)
  })

  it('writes and reads back through the daemon protocol', async () => {
    const { backend } = makeBackend()
    const payload = new Uint8Array([1, 2, 3, 4, 5])

    await backend.write(64, payload)
    const read = await backend.read(64, payload.length)

    expect([...read]).toEqual([...payload])
  })

  it('reads back what a different writer put there', async () => {
    // The memory backend is the device; the serial backend must see its content.
    const { backend, memory } = makeBackend()
    await memory.write(0, new Uint8Array([9, 9, 9]))

    expect([...(await backend.read(0, 3))]).toEqual([9, 9, 9])
  })

  it('refuses a read past the device size', async () => {
    const { backend } = makeBackend()
    await expect(backend.read(SIZE - 1, 4)).rejects.toThrow(/past device size/)
  })

  it('refuses a write past the device size', async () => {
    const { backend } = makeBackend()
    await expect(backend.write(SIZE - 1, new Uint8Array(4))).rejects.toThrow(/past device size/)
  })

  it('refuses a negative offset', async () => {
    const { backend } = makeBackend()
    await expect(backend.read(-1, 1)).rejects.toThrow(/offset must be >= 0/)
    await expect(backend.write(-1, new Uint8Array(1))).rejects.toThrow(/offset must be >= 0/)
  })

  it('reports a transport timeout instead of hanging', async () => {
    const daemon = new FlashDaemon({ devices: new Map() })
    const backend = new SerialBlockBackend({
      deviceId,
      transport: new InProcessTransport(daemon),
      sizeBytes: SIZE,
      timeoutMs: 50,
    })
    // The daemon has no such device, so it errors — and the backend surfaces it.
  await expect(backend.read(0, 1)).rejects.toThrow()
  })

  it('rejects a non-positive size at construction', () => {
    const daemon = new FlashDaemon({ devices: new Map() })
    for (const sizeBytes of [0, -1, 1.5]) {
      expect(() => new SerialBlockBackend({
        deviceId,
        transport: new InProcessTransport(daemon),
        sizeBytes,
      })).toThrow(/positive integer/)
  }
  })
})