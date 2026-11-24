/**
 * Flash sidecar protocol (bulk SD writer, companion daemon half).
 *
 * The browser half (`imageFlasher.ts`) builds a chunk plan with per-chunk
 * SHA-256 and verifies the result — but a browser cannot touch block devices.
 * This module is the shared protocol both halves speak: JSON-framed messages
 * over newline-delimited UTF-8, so the browser (WebSocket) and the daemon
 * (Node, stdio or TCP) agree byte-for-byte on every command and reply.
 *
 * Message flow:
 *   browser → daemon: { kind: 'hello' }
 *   daemon → browser: { kind: 'ready', devices: [...] }
 *   browser → daemon: { kind: 'write', device, offset, dataHex, sha256 }
 *   daemon → browser: { kind: 'wrote', offset, length }
 *   browser → daemon: { kind: 'read', device, offset, length }
 *   daemon → browser: { kind: 'data', offset, dataHex }
 *   browser → daemon: { kind: 'bye' }
 *
 * Every write is hash-checked by the daemon before it reports success, and
 * every failure names the device, offset, and reason. No silent truncation:
 * writes past the device size are refused, not clipped.
 */

export interface FlashDevice {
  /** Stable identifier, e.g. `/dev/sdb` or `dryrun.img`. */
  id: string;
  /** Total size in bytes. */
  sizeBytes: number;
  /** Sector size in bytes (512 for SD). */
  sectorBytes: number;
  /** True only for the file-backed dry-run device tests use. */
  dryRun: boolean;
}

export type DaemonRequest =
  | { kind: 'hello' }
  | { kind: 'write'; device: string; offset: number; dataHex: string; sha256: string }
  | { kind: 'read'; device: string; offset: number; length: number }
  | { kind: 'bye' }
  | { kind: 'list-devices' };

export type DaemonReply =
  | { kind: 'ready'; devices: FlashDevice[] }
  | { kind: 'wrote'; offset: number; length: number }
  | { kind: 'data'; offset: number; dataHex: string }
  | { kind: 'bye' }
  | { kind: 'error'; message: string };

/** Encode one protocol frame (a JSON line). */
export function encodeFrame(message: DaemonRequest | DaemonReply): string {
  return `${JSON.stringify(message)}\n`;
}

const REQUEST_KINDS = new Set(['hello', 'write', 'read', 'bye', 'list-devices']);
const REPLY_KINDS = new Set(['ready', 'wrote', 'data', 'bye', 'error']);

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

/**
 * Decode one protocol frame. Malformed JSON, unknown kinds and frames with
 * missing or ill-typed fields are rejected here, so the daemon never guesses.
 */
export function decodeFrame(line: string): DaemonRequest | DaemonReply {
  const trimmed = line.trim();
  if (!trimmed) throw new Error('flash protocol: empty frame');
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(`flash protocol: malformed JSON: ${trimmed.slice(0, 80)}`);
  }
  if (typeof parsed !== 'object' || parsed === null || !('kind' in parsed)) {
    throw new Error('flash protocol: frame without kind');
  }
  const kind = (parsed as { kind: unknown }).kind;
  if (typeof kind !== 'string') throw new Error('flash protocol: frame kind must be a string');
  if (!REQUEST_KINDS.has(kind) && !REPLY_KINDS.has(kind)) {
    throw new Error(`flash protocol: unknown kind "${kind}"`);
  }

  const frame = parsed as Record<string, unknown>;
  const requireString = (field: string): void => {
    if (typeof frame[field] !== 'string') {
      throw new Error(`flash protocol: "${kind}" frame needs a string "${field}"`);
    }
  };
  const requireOffset = (field: string): void => {
    if (!isNonNegativeInteger(frame[field])) {
      throw new Error(`flash protocol: "${kind}" frame needs a non-negative integer "${field}"`);
    }
  };

  if (kind === 'write') {
    requireString('device');
    requireOffset('offset');
    requireString('dataHex');
    requireString('sha256');
  } else if (kind === 'read') {
    requireString('device');
    requireOffset('offset');
    requireOffset('length');
  } else if (kind === 'wrote') {
    requireOffset('offset');
    requireOffset('length');
  } else if (kind === 'data') {
    requireOffset('offset');
    requireString('dataHex');
  } else if (kind === 'error') {
    requireString('message');
  } else if (kind === 'ready' && !Array.isArray(frame.devices)) {
    throw new Error('flash protocol: "ready" frame needs a devices array');
  }

  return parsed as DaemonRequest | DaemonReply;
}

/** Hex-decode with strict validation (even length, hex digits only). */
export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('flash protocol: odd-length hex');
  if (!/^[0-9a-fA-F]*$/.test(hex)) throw new Error('flash protocol: non-hex digits');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Hex-encode bytes (lowercase). */
export function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
