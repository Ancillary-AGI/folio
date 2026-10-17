import { describe, expect, it } from 'vitest';
import { averagePower, efficiency, measureWaveform, powerSeries, waveformsToCsv } from './scopeAnalysis';

const sine = (freq: number, periods = 4, points = 4001): { name: string; unit: string; data: Array<{ x: number; y: number }> } => ({
  name: 'V(OUT)', unit: 'V',
  data: Array.from({ length: points }, (_, i) => ({ x: (i / (points - 1)) * (periods / freq), y: 5 * Math.sin(2 * Math.PI * freq * (i / (points - 1)) * (periods / freq)) })),
});

describe('scope measurements + power analysis', () => {
  it('measures a 5 V sine: pp=10, rms=5/sqrt2, f correct', () => {
    const m = measureWaveform(sine(1000));
    expect(m.peakToPeak).toBeCloseTo(10, 1);
    expect(m.rms).toBeCloseTo(5 / Math.SQRT2, 1);
    expect(m.frequencyHz).toBeCloseTo(1000, 0);
    expect(m.dutyCycle).toBeCloseTo(0.5, 1);
  });
  it('returns null frequency for a DC trace', () => {
    const m = measureWaveform({ name: 'V(X)', unit: 'V', data: [{ x: 0, y: 2.5 }, { x: 1, y: 2.5 }] });
    expect(m.frequencyHz).toBeNull();
    expect(m.rms).toBeCloseTo(2.5, 9);
  });
  it('integrates V*I to average power and efficiency', () => {
    const v = { name: 'V(L)', unit: 'V', data: [{ x: 0, y: 5 }, { x: 1, y: 5 }] };
    const i = { name: 'I(L)', unit: 'A', data: [{ x: 0, y: 0.02 }, { x: 1, y: 0.02 }] };
    const p = powerSeries(v, i);
    expect(p[0].y).toBeCloseTo(0.1, 9);
    expect(averagePower(p)).toBeCloseTo(0.1, 9);
    expect(efficiency(0.09, 0.1)).toBeCloseTo(0.9, 9);
    expect(() => efficiency(0.1, 0)).toThrow(/no power/);
  });
  it('exports CSV with a header + aligned columns', () => {
    const csv = waveformsToCsv([{ ...sine(10), data: sine(10).data.slice(0, 5) }]);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('t,V(OUT)');
    expect(lines).toHaveLength(6);
  });
  it('fails loud on empty or mismatched series', () => {
    expect(() => measureWaveform({ name: 'V(E)', unit: 'V', data: [] })).toThrow(/no data/);
    expect(() => powerSeries(
      { name: 'V', unit: 'V', data: [{ x: 0, y: 1 }] },
      { name: 'I', unit: 'A', data: [{ x: 0, y: 1 }, { x: 1, y: 1 }] },
    )).toThrow(/matching grids/);
  });
});
