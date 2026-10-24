import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompanionBridge } from './companionBridge';

/** Minimal WebSocket stand-in: records sends and lets the test deliver replies. */
class FakeSocket {
  handler: ((event: MessageEvent) => void) | null = null;
  readonly sent: string[] = [];

  addEventListener(type: string, handler: EventListener): void {
    if (type === 'message') this.handler = handler as (event: MessageEvent) => void;
  }

  removeEventListener(type: string, handler: EventListener): void {
    if (type === 'message' && this.handler === handler) this.handler = null;
  }

  send(payload: string): void {
    this.sent.push(payload);
  }

  respond(payload: string): void {
    if (!this.handler) throw new Error('no message handler registered');
    this.handler({ data: payload } as MessageEvent);
  }
}

function connectedBridge(socket: FakeSocket): CompanionBridge {
  const bridge = new CompanionBridge();
  const internals = bridge as unknown as { ws: unknown; connected: boolean };
  internals.ws = socket;
  internals.connected = true;
  return bridge;
}

const flush = (): Promise<unknown> => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.useRealTimers();
});

describe('Companion Bridge Hardware Programming', () => {
  it('detects available programming transports', () => {
    const bridge = new CompanionBridge();
    const transports = bridge.detectAvailableTransports();
    expect(transports.includes('companion-daemon')).toBe(true);
  });

  it('fails safely when companion daemon is offline without unhandled exceptions', async () => {
    const bridge = new CompanionBridge('ws://127.0.0.1:49999'); // Non-existent port
    const connected = await bridge.connect();
    expect(connected).toBe(false);
    expect(bridge.isConnected).toBe(false);

    await expect(bridge.sendRequest({ kind: 'list-devices' })).rejects.toThrow(
      /not connected/,
    );
  });

  it('refuses to report flash success while the daemon is offline', async () => {
    const bridge = new CompanionBridge();
    const dummyImage = new Uint8Array(1024);
    dummyImage.fill(0x55);

    await expect(bridge.flashImage('drive-sd-0', dummyImage)).rejects.toThrow(
      /not connected/,
    );
  });

  it('decodes a valid reply frame', async () => {
    const socket = new FakeSocket();
    const bridge = connectedBridge(socket);

    const pending = bridge.sendRequest({ kind: 'list-devices' });
    await flush();
    expect(socket.sent).toEqual(['{"kind":"list-devices"}']);
    socket.respond('{"kind":"ready","devices":[]}');

    await expect(pending).resolves.toEqual({ kind: 'ready', devices: [] });
    expect(socket.handler).toBeNull();
  });

  it('rejects malformed and binary reply frames instead of guessing', async () => {
    const socket = new FakeSocket();
    const bridge = connectedBridge(socket);

    const malformed = bridge.sendRequest({ kind: 'hello' });
    await flush();
    socket.respond('not json');
    await expect(malformed).rejects.toThrow(/malformed JSON/);

    const binary = bridge.sendRequest({ kind: 'hello' });
    await flush();
    socket.handler?.({ data: new ArrayBuffer(4) } as MessageEvent);
    await expect(binary).rejects.toThrow(/binary frame/);
  });

  it('serialises requests because the wire protocol has no request ids', async () => {
    const socket = new FakeSocket();
    const bridge = connectedBridge(socket);

    const first = bridge.sendRequest({ kind: 'hello' });
    const second = bridge.sendRequest({ kind: 'list-devices' });
    await flush();
    expect(socket.sent).toHaveLength(1);

    socket.respond('{"kind":"ready","devices":[]}');
    await first;
    await flush();
    expect(socket.sent).toHaveLength(2);

    socket.respond('{"kind":"ready","devices":[]}');
    await second;
  });

  it('times out instead of hanging when the daemon never replies', async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const bridge = connectedBridge(socket);

    const pending = bridge.sendRequest({ kind: 'hello' });
    const assertion = expect(pending).rejects.toThrow(/did not reply to "hello"/);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
  });

  it('rejects a fractional chunk size before slicing the image', async () => {
    const socket = new FakeSocket();
    const bridge = connectedBridge(socket);
    const image = new Uint8Array([1, 2, 3, 4]);

    await expect(bridge.flashImage('dryrun.img', image, undefined, 0.5)).rejects.toThrow(
      /positive integer/,
    );
    expect(socket.sent).toHaveLength(0);
  });
});
