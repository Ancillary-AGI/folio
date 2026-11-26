/**
 * A `BlockBackend` that speaks the flash daemon protocol over a line transport.
 *
 * `FlashDaemon` is a protocol engine: it needs something that can read and write
 * a device's blocks. Only an in-memory backend shipped, which made the daemon
 * usable in tests and nowhere else. This is the real one — it drives any
 * newline-delimited JSON transport (WebSerial, a WebSocket, a TCP socket, stdio),
 * so the same daemon code runs against real hardware.
 */
import { bytesToHex, decodeFrame, encodeFrame, hexToBytes } from './flashProtocol'
import type { DaemonReply, DaemonRequest } from './flashProtocol'
import type { BlockBackend } from './flashDaemon'

/** A newline-delimited JSON transport. */
export interface LineTransport {
  /** Send one frame (no trailing newline needed). */
  write(line: string): Promise<void>
  /** Read one reply frame, or null if none arrives within `timeoutMs`. */
  readLine(timeoutMs?: number): Promise<string | null>
  /** Release the transport. */
  close(): void
}

export interface SerialBlockBackendOptions {
  /** The device id the daemon knows this backend as. */
  deviceId: string
  transport: LineTransport
  /** Total device size in bytes. */
  sizeBytes: number
  /** Per-request timeout. */
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 5_000

/** `decodeFrame` types its result as either direction; this narrows to a reply. */
const isReply = (value: DaemonRequest | DaemonReply): value is DaemonReply =>
  value.kind === 'ready'
  || value.kind === 'wrote'
  || value.kind === 'data'
  || value.kind === 'bye'
  || value.kind === 'error'

export class SerialBlockBackend implements BlockBackend {
  private readonly deviceId: string
  private readonly transport: LineTransport
  private readonly timeoutMs: number
  private readonly size: number

  constructor(options: SerialBlockBackendOptions) {
    if (!options.deviceId) throw new Error('deviceId is required')
    if (!Number.isInteger(options.sizeBytes) || options.sizeBytes <= 0) {
      throw new Error(`sizeBytes must be a positive integer, got ${options.sizeBytes}`)
    }
    this.deviceId = options.deviceId
    this.transport = options.transport
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.size = options.sizeBytes
  }

  get sizeBytes(): number {
    return this.size
  }

  /** Send one request and wait for the matching reply. */
  private async call(request: DaemonRequest): Promise<DaemonReply> {
    await this.transport.write(encodeFrame(request).trim())
    const line = await this.transport.readLine(this.timeoutMs)
    if (line === null) throw new Error(`no reply from device ${this.deviceId} within ${this.timeoutMs} ms`)
    const reply = decodeFrame(line)
    /* The transport is reply-only here, but `decodeFrame` types its result as
 * either direction — refuse anything that is not a reply rather than
 * casting. */
    if (!isReply(reply)) {
      throw new Error(`unexpected frame from device ${this.deviceId}: ${reply.kind}`)
    }
    if (reply.kind === 'error') throw new Error(reply.message)
    return reply
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    if (!Number.isInteger(offset) || offset < 0) throw new Error(`read offset must be >= 0, got ${offset}`)
    if (!Number.isInteger(length) || length < 0) throw new Error(`read length must be >= 0, got ${length}`)
    if (offset + length > this.size) {
      throw new Error(`read [${offset}, ${offset + length}) past device size ${this.size}`)
    }
    const reply = await this.call({ kind: 'read', device: this.deviceId, offset, length })
    if (reply.kind !== 'data') throw new Error(`unexpected reply to read: ${reply.kind}`)
    if (reply.offset !== offset) throw new Error(`reply offset ${reply.offset} does not match request ${offset}`)
    const bytes = hexToBytes(reply.dataHex)
    if (bytes.length !== length) {
  throw new Error(`reply length ${bytes.length} does not match request ${length}`)
  }
    return bytes
  }

  async write(offset: number, data: Uint8Array): Promise<void> {
    if (!Number.isInteger(offset) || offset < 0) throw new Error(`write offset must be >= 0, got ${offset}`)
    if (offset + data.length > this.size) {
      throw new Error(`write [${offset}, ${offset + data.length}) past device size ${this.size}`)
    }
    /* The daemon hash-checks every write before reporting success, so the
 * digest has to be the real one — an empty or guessed hash is refused. */
    const reply = await this.call({
      kind: 'write',
      device: this.deviceId,
      offset,
      dataHex: bytesToHex(data),
      sha256: await sha256Hex(data),
    })
    if (reply.kind !== 'wrote') throw new Error(`unexpected reply to write: ${reply.kind}`)
    if (reply.offset !== offset || reply.length !== data.length) {
      throw new Error(`write reply ${reply.offset}+${reply.length} does not match request ${offset}+${data.length}`)
    }
  }
}

/** SHA-256 hex via WebCrypto, which both the browser and Node 19+ provide. */
async function sha256Hex(data: Uint8Array): Promise<string> {
  // Copy into a concrete ArrayBuffer: `subtle.digest` rejects a view backed by
  // a SharedArrayBuffer, which the generic Uint8Array type permits.
  const copy = new Uint8Array(data.length)
  copy.set(data)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copy)
  return bytesToHex(new Uint8Array(digest))
}