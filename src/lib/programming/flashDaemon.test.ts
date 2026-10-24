import { describe, expect, it } from 'vitest';
import { FlashDaemon, MemoryBlockBackend } from './flashDaemon';
import { bytesToHex, decodeFrame, encodeFrame } from './flashProtocol';

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function daemon(size = 4096): FlashDaemon {
  return new FlashDaemon({
    devices: new Map([
      ['dryrun.img', {
        info: { id: 'dryrun.img', sizeBytes: size, sectorBytes: 512, dryRun: true },
        backend: new MemoryBlockBackend(size),
      }],
    ]),
  });
}

describe('flash sidecar daemon', () => {
  it('announces its devices on hello', async () => {
    const reply = await daemon().handle({ kind: 'hello' });
    expect(reply.kind).toBe('ready');
    if (reply.kind !== 'ready') throw new Error('unreachable');
    expect(reply.devices).toEqual([{ id: 'dryrun.img', sizeBytes: 4096, sectorBytes: 512, dryRun: true }]);
  });
  it('writes with hash check and read-back, then reads the bytes back', async () => {
    const d = daemon();
    const data = new Uint8Array([1, 2, 3, 4]);
    const hash = await sha256Hex(data);
    const wrote = await d.handle({ kind: 'write', device: 'dryrun.img', offset: 512, dataHex: bytesToHex(data), sha256: hash });
    expect(wrote).toEqual({ kind: 'wrote', offset: 512, length: 4 });
    const read = await d.handle({ kind: 'read', device: 'dryrun.img', offset: 512, length: 4 });
    expect(read).toEqual({ kind: 'data', offset: 512, dataHex: bytesToHex(data) });
  });
  it('refuses hash mismatches, overruns, unknown devices, and bad frames', async () => {
    const d = daemon(1024);
    const data = new Uint8Array([9, 9]);
    const bad = await d.handle({ kind: 'write', device: 'dryrun.img', offset: 0, dataHex: bytesToHex(data), sha256: '0'.repeat(64) });
    expect(bad.kind).toBe('error');
    const over = await d.handle({ kind: 'read', device: 'dryrun.img', offset: 1000, length: 100 });
    expect(over.kind).toBe('error');
    const nodev = await d.handle({ kind: 'read', device: 'nope', offset: 0, length: 1 });
    expect(nodev.kind).toBe('error');
    expect(() => decodeFrame('not json')).toThrow(/malformed JSON/);
    expect(() => decodeFrame('{"nope":1}')).toThrow(/without kind/);
  });
  it('round-trips frames through encode/decode', async () => {
    const line = encodeFrame({ kind: 'write', device: 'd', offset: 0, dataHex: '00ff', sha256: 'x' });
    expect(line.endsWith('\n')).toBe(true);
    expect(decodeFrame(line)).toEqual({ kind: 'write', device: 'd', offset: 0, dataHex: '00ff', sha256: 'x' });
  });
  it('rejects unknown kinds and ill-typed frames at the protocol boundary', () => {
    expect(() => decodeFrame('{"kind":"format-everything"}')).toThrow(/unknown kind/);
    expect(() => decodeFrame('{"kind":"write","device":"d","offset":-1,"dataHex":"00","sha256":"x"}')).toThrow(/offset/);
    expect(() => decodeFrame('{"kind":"write","device":"d","offset":0,"dataHex":123,"sha256":"x"}')).toThrow(/dataHex/);
    expect(() => decodeFrame('{"kind":"read","device":"d","offset":0}')).toThrow(/length/);
    expect(() => decodeFrame('{"kind":"ready","devices":[]}')).not.toThrow();
    expect(() => decodeFrame('{"kind":"ready"}')).toThrow(/devices/);
  });
  it('closes cleanly on bye instead of reporting an error', async () => {
    const d = daemon();
    const reply = await d.handle({ kind: 'bye' });
    expect(reply).toEqual({ kind: 'bye' });
    expect((await d.handle({ kind: 'hello' })).kind).toBe('error');
  });
});
