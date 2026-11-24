/**
 * Flash sidecar daemon (bulk SD writer, executor half).
 *
 * Runs under Node only — never imported by the browser bundle. Opens a
 * file-backed block device (the dry-run path tests and development use; a
 * real deployment opens the SD device node with the same interface), applies
 * `write` frames after hash-checking the payload, serves `read` frames, and
 * refuses out-of-range access instead of clipping it.
 *
 * The daemon never touches the browser half: it speaks only the
 * `flashProtocol.ts` frames, so the two sides stay byte-compatible by
 * construction and every behaviour below is unit-tested without hardware.
 */
import { bytesToHex, decodeFrame, encodeFrame, hexToBytes } from './flashProtocol';
import type { DaemonReply, DaemonRequest, FlashDevice } from './flashProtocol';

export interface BlockBackend {
  readonly sizeBytes: number;
  read(offset: number, length: number): Promise<Uint8Array>;
  write(offset: number, data: Uint8Array): Promise<void>;
}

/** File-backed block backend over an in-memory image (dry-run + tests). */
export class MemoryBlockBackend implements BlockBackend {
  private readonly image: Uint8Array;

  constructor(sizeBytes: number) {
    if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
      throw new Error(`block backend size must be a positive integer, got ${sizeBytes}`);
    }
    this.image = new Uint8Array(sizeBytes);
  }

  get sizeBytes(): number {
    return this.image.length;
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    if (!Number.isInteger(offset) || offset < 0) throw new Error(`read offset must be >= 0, got ${offset}`);
    if (!Number.isInteger(length) || length < 0) throw new Error(`read length must be >= 0, got ${length}`);
    if (offset + length > this.image.length) {
      throw new Error(`read [${offset}, ${offset + length}) past device size ${this.image.length}`);
    }
    return this.image.slice(offset, offset + length);
  }

  async write(offset: number, data: Uint8Array): Promise<void> {
    if (!Number.isInteger(offset) || offset < 0) throw new Error(`write offset must be >= 0, got ${offset}`);
    if (offset + data.length > this.image.length) {
      throw new Error(`write [${offset}, ${offset + data.length}) past device size ${this.image.length}`);
    }
    this.image.set(data, offset);
  }
}

/** SHA-256 hex using Node's crypto (daemon side; browser uses SubtleCrypto). */
async function sha256HexNode(bytes: Uint8Array): Promise<string> {
  const crypto = await import(/* @vite-ignore */ 'node:crypto');
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export interface FlashDaemonOptions {
  devices: Map<string, { info: FlashDevice; backend: BlockBackend }>;
}

export class FlashDaemon {
  private readonly devices: Map<string, { info: FlashDevice; backend: BlockBackend }>;
  private closed = false;

  constructor(options: FlashDaemonOptions) {
    this.devices = options.devices;
  }

  /** Handle one decoded request frame, returning the reply frame. */
  async handle(request: DaemonRequest): Promise<DaemonReply> {
    if (this.closed) return { kind: 'error', message: 'daemon is closed' };
    switch (request.kind) {
      case 'hello':
        return { kind: 'ready', devices: [...this.devices.values()].map((d) => d.info) };
      case 'bye':
        this.closed = true;
        // A clean shutdown is not an error: the client should not surface it
        // as a failure.
        return { kind: 'bye' };
      case 'list-devices':
        return { kind: 'ready', devices: [...this.devices.values()].map((d) => d.info) };
      case 'write': {
        const entry = this.devices.get(request.device);
        if (!entry) return { kind: 'error', message: `unknown device ${request.device}` };
        let data: Uint8Array;
        try {
          data = hexToBytes(request.dataHex);
        } catch (error) {
          return { kind: 'error', message: error instanceof Error ? error.message : 'bad hex' };
        }
        const actual = await sha256HexNode(data);
        if (actual !== request.sha256.toLowerCase()) {
          return { kind: 'error', message: `chunk at ${request.offset}: hash mismatch` };
        }
        try {
          await entry.backend.write(request.offset, data);
        } catch (error) {
          return { kind: 'error', message: error instanceof Error ? error.message : 'write failed' };
        }
        // Read-back: prove the bytes landed before reporting success.
        try {
          const back = await entry.backend.read(request.offset, data.length);
          if (back.length !== data.length || !back.every((b, i) => b === data[i])) {
            return { kind: 'error', message: `chunk at ${request.offset}: read-back mismatch` };
          }
        } catch (error) {
          return { kind: 'error', message: error instanceof Error ? error.message : 'read-back failed' };
        }
        return { kind: 'wrote', offset: request.offset, length: data.length };
      }
      case 'read': {
        const entry = this.devices.get(request.device);
        if (!entry) return { kind: 'error', message: `unknown device ${request.device}` };
        try {
          const data = await entry.backend.read(request.offset, request.length);
          return { kind: 'data', offset: request.offset, dataHex: bytesToHex(data) };
        } catch (error) {
          return { kind: 'error', message: error instanceof Error ? error.message : 'read failed' };
        }
      }
      default:
        return { kind: 'error', message: `unknown request kind ${(request as { kind: unknown }).kind}` };
    }
  }

  /** Handle one raw line, returning the encoded reply line. */
  async handleLine(line: string): Promise<string> {
    try {
      const request = decodeFrame(line);
      const reply = await this.handle(request as DaemonRequest);
      return encodeFrame(reply);
    } catch (error) {
      return encodeFrame({ kind: 'error', message: error instanceof Error ? error.message : 'bad frame' });
    }
  }
}
