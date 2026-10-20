import { describe, expect, it } from 'vitest';
import { probeWebGpuSupport } from './webgpuDevice';

describe('WebGPU Device Probing', () => {
  it('returns fallback context safely in headless/jsdom environment without crashing', async () => {
    const ctx = await probeWebGpuSupport();
    expect(ctx).toBeDefined();
    expect(typeof ctx.supported).toBe('boolean');
    expect(typeof ctx.isFallback).toBe('boolean');
    // In jsdom without hardware WebGPU, isFallback should be true
    expect(ctx.isFallback).toBe(true);
  });
});
