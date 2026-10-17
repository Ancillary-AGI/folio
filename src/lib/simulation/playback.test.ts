import { describe, expect, it } from 'vitest';
import { playbackDuration, playbackFrame, sampleAt } from './playback';

const VOUT = { name: 'V(OUT)', unit: 'V', data: [{ x: 0, y: 0 }, { x: 1, y: 5 }, { x: 2, y: 5 }] };
const ID1 = { name: 'I(D1)', unit: 'A', data: [{ x: 0, y: 0 }, { x: 1, y: 0.02 }, { x: 2, y: 0.02 }] };

describe('live playback', () => {
  it('interpolates voltages and clamps outside the grid', () => {
    expect(sampleAt(VOUT, 0.5)).toBeCloseTo(2.5, 9);
    expect(sampleAt(VOUT, -1)).toBe(0);
    expect(sampleAt(VOUT, 99)).toBe(5);
  });
  it('lights diodes from branch-current sign and glows nodes by swing', () => {
    const off = playbackFrame([VOUT, ID1], 0);
    expect(off.lit['D1']).toBe(false);
    expect(off.glow['OUT']).toBeCloseTo(0, 9);
    const on = playbackFrame([VOUT, ID1], 2);
    expect(on.lit['D1']).toBe(true);
    expect(on.glow['OUT']).toBeCloseTo(1, 9);
  });
  it('measures run duration from the grid', () => {
    expect(playbackDuration([VOUT, ID1])).toBe(2);
  });
});
