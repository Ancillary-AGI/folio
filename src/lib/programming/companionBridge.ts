/**
 * Hardware Programming & Companion Daemon Bridge.
 * Dual-path architecture:
 * 1. Direct In-Browser WebSerial / WebUSB whenever browser permissions permit.
 * 2. Companion Daemon Bridge (`folio-bridge` WebSocket RPC) for OS-privileged raw block
 *    SD/eMMC card flashing and OpenOCD JTAG/SWD hardware in-circuit debugging.
 */

import { bytesToHex, decodeFrame, type DaemonReply, type DaemonRequest, type FlashDevice } from './flashProtocol';

/** Replies are small control frames; a longer silence means the daemon is wedged. */
const REQUEST_TIMEOUT_MS = 30_000;

export type ProgrammingTransport = 'browser-webserial' | 'browser-webusb' | 'companion-daemon';

export interface CompanionStatus {
  online: boolean;
  version?: string;
  transport: ProgrammingTransport;
  availableDevices: FlashDevice[];
  activePort?: string;
}

export interface FlashProgress {
  bytesWritten: number;
  totalBytes: number;
  percent: number;
  stage: 'preparing' | 'writing' | 'verifying' | 'completed' | 'error';
  speedMbPerSec?: number;
}

export class CompanionBridge {
  private ws: WebSocket | null = null;
  private readonly daemonUrl: string;
  private connected = false;
  /** Serialises requests: replies carry no id, so only one may be in flight. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(daemonUrl: string = 'ws://127.0.0.1:48123') {
    this.daemonUrl = daemonUrl;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  /**
   * Determine available programming transports in current environment.
   */
  detectAvailableTransports(): ProgrammingTransport[] {
    const transports: ProgrammingTransport[] = [];
    if (typeof navigator !== 'undefined') {
      if ('serial' in navigator) transports.push('browser-webserial');
      if ('usb' in navigator) transports.push('browser-webusb');
    }
    // Companion daemon is always an option via local loopback
    transports.push('companion-daemon');
    return transports;
  }

  /**
   * Connect to the local companion daemon sidecar.
   */
  async connect(): Promise<boolean> {
    if (typeof WebSocket === 'undefined') {
      this.connected = false;
      return false;
    }

    return new Promise((resolve) => {
      try {
        const socket = new WebSocket(this.daemonUrl);
        const timeout = setTimeout(() => {
          socket.close();
          this.connected = false;
          resolve(false);
        }, 1500);

        socket.onopen = () => {
          clearTimeout(timeout);
          this.ws = socket;
          this.connected = true;
          resolve(true);
        };

        socket.onerror = () => {
          clearTimeout(timeout);
          this.connected = false;
          resolve(false);
        };

        // If the daemon exits after a successful handshake, stop reporting it
        // as connected instead of failing every later request with a silent send.
        socket.onclose = () => {
          if (this.ws === socket) {
            this.ws = null;
            this.connected = false;
          }
        };
      } catch {
        this.connected = false;
        resolve(false);
      }
    });
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }

  /**
   * Send a typed request to the daemon and await its reply.
   *
   * Requests are serialised because the wire protocol has no request ids: two
   * concurrent sends would each accept the other's reply.
   */
  sendRequest(request: DaemonRequest): Promise<DaemonReply> {
    const run = this.queue.then(() => this.requestOnce(request));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async requestOnce(request: DaemonRequest): Promise<DaemonReply> {
    const sock = this.ws;
    if (!this.connected || !sock) {
      throw new Error('Companion daemon is not connected. Launch folio-bridge companion on host.');
    }
    const socket: WebSocket = sock;

    return new Promise((resolve, reject) => {
      let settled = false;

      function finish(settle: () => void): void {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.removeEventListener('message', handler);
        settle();
      }

      const handler = (event: MessageEvent) => {
        // Decode before finish() marks the request settled: a decode failure
        // must still reach the catch block and reject the promise.
        try {
          if (typeof event.data !== 'string') {
            throw new Error('Companion daemon sent a binary frame; the protocol is JSON text.');
          }
          const reply = decodeFrame(event.data) as DaemonReply;
          finish(() => resolve(reply));
        } catch (err) {
          finish(() => reject(err));
        }
      };

      const timer = setTimeout(() => {
        finish(() => reject(new Error(
          `Companion daemon did not reply to "${request.kind}" within ${REQUEST_TIMEOUT_MS} ms.`,
        )));
      }, REQUEST_TIMEOUT_MS);

      socket.addEventListener('message', handler);
      socket.send(JSON.stringify(request));
    });
  }

  /**
   * Chunked image flash through the daemon with per-chunk SHA-256.
   * Refuses to run offline: reports success only after the daemon confirms
   * every chunk, never from local slicing alone.
   */
  async flashImage(
    deviceId: string,
    imageBytes: Uint8Array,
    onProgress?: (progress: FlashProgress) => void,
    chunkSize: number = 65536,
  ): Promise<{ success: boolean; totalBytes: number; hash: string }> {
    if (imageBytes.length === 0) throw new Error('Cannot flash an empty image.');
    if (!this.connected || !this.ws) {
      throw new Error('Companion daemon is not connected. Launch folio-bridge companion on host.');
    }
    if (!Number.isInteger(chunkSize) || chunkSize <= 0) throw new Error('Chunk size must be a positive integer.');

    const totalBytes = imageBytes.length;
    let bytesWritten = 0;
    let offset = 0;

    onProgress?.({
      bytesWritten: 0,
      totalBytes,
      percent: 0,
      stage: 'preparing',
    });

    const digest = await crypto.subtle.digest('SHA-256', imageBytes as BufferSource);
    const hash = bytesToHex(new Uint8Array(digest));

    while (offset < totalBytes) {
      const end = Math.min(offset + chunkSize, totalBytes);
      const chunk = imageBytes.slice(offset, end);
      const chunkDigest = await crypto.subtle.digest('SHA-256', chunk as BufferSource);
      const reply = await this.sendRequest({
        kind: 'write',
        device: deviceId,
        offset,
        dataHex: bytesToHex(chunk),
        sha256: bytesToHex(new Uint8Array(chunkDigest)),
      });
      if (reply.kind === 'error') {
        onProgress?.({ bytesWritten, totalBytes, percent: Math.round((bytesWritten / totalBytes) * 100), stage: 'error' });
        throw new Error(`flash write failed at offset ${offset}: ${reply.message}`);
      }
      if (reply.kind !== 'wrote' || reply.length !== end - offset) {
        throw new Error(`flash daemon short write at offset ${offset}: expected ${end - offset} bytes.`);
      }
      offset = end;
      bytesWritten = offset;

      onProgress?.({
        bytesWritten,
        totalBytes,
        percent: Math.round((bytesWritten / totalBytes) * 100),
        stage: bytesWritten === totalBytes ? 'verifying' : 'writing',
      });
    }

    onProgress?.({
      bytesWritten: totalBytes,
      totalBytes,
      percent: 100,
      stage: 'completed',
    });

    return { success: true, totalBytes, hash };
  }
}

export const companionBridge = new CompanionBridge();
