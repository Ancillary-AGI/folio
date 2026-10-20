import { describe, expect, it } from 'vitest';
import { CompanionBridge } from './companionBridge';

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
});
