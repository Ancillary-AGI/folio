/**
 * Hardware Programming & Companion Daemon Bridge.
 * Dual-path architecture:
 * 1. Direct In-Browser WebSerial / WebUSB whenever browser permissions permit.
 * 2. Companion Daemon Bridge (`folio-bridge` WebSocket RPC) for OS-privileged raw block
 *    SD/eMMC card flashing and OpenOCD JTAG/SWD hardware in-circuit debugging.
 */

import { bytesToHex, type DaemonReply, type DaemonRequest, type FlashDevice } from './flashProtocol';

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
   */
  async sendRequest(request: DaemonRequest): Promise<DaemonReply> {
    if (!this.connected || !this.ws) {
      throw new Error('Companion daemon is not connected. Launch folio-bridge companion on host.');
    }

    return new Promise((resolve, reject) => {
      const handler = (event: MessageEvent) => {
        try {
          const reply = JSON.parse(event.data) as DaemonReply;
          const sock = this.ws;
          if (sock) sock.removeEventListener('message', handler);
          resolve(reply);
        } catch (err) {
          reject(err);
        }
      };

      const sock = this.ws;
      if (!sock) {
        reject(new Error('Companion daemon is not connected. Launch folio-bridge companion on host.'));
        return;
      }
      sock.addEventListener('message', handler);
      sock.send(JSON.stringify(request));
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
    if (chunkSize <= 0) throw new Error('Chunk size must be positive.');

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
