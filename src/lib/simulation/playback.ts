/**
 * Live simulation playback — the circuit runs, not just plots.
 *
 * A transient result is a time series per node. This player steps through it
 * on a clock: every frame it interpolates each node voltage at the playhead
 * time, maps it to a color/brightness, and reports per-part states (LED
 * on/off from diode-branch current sign, source level, logic level). The
 * 2D sheet tints live parts and the 3D viewer brightens bodies from the same
 * frame — one clock, every view. Pure + tested: no timers in the module.
 */
export interface PlaybackFrame {
  /** Playhead time, seconds. */
  time: number;
  /** Node name → interpolated voltage. */
  voltages: Record<string, number>;
  /** 0..1 brightness per node (normalized to the waveform's own swing). */
  glow: Record<string, number>;
  /** Reference → on/off for LED/diode branches with current data. */
  lit: Record<string, boolean>;
}

export interface PlaybackSeries {
  name: string;
  unit: string;
  data: Array<{ x: number; y: number }>;
}

/** Linear interpolate `series` at time `t`; clamps outside the grid. */
export function sampleAt(series: PlaybackSeries, t: number): number {
  const data = series.data;
  if (data.length === 0) return 0;
  if (t <= data[0].x) return data[0].y;
  const last = data[data.length - 1];
  if (t >= last.x) return last.y;
  for (let i = 1; i < data.length; i += 1) {
    const prev = data[i - 1];
    const curr = data[i];
    if (t >= prev.x && t <= curr.x) {
      const span = curr.x - prev.x;
      const fraction = span === 0 ? 0 : (t - prev.x) / span;
      return prev.y + (curr.y - prev.y) * fraction;
    }
  }
  return last.y;
}

/**
 * Build one frame at time `t` from transient voltage/current waveforms.
 * Current waveforms are named `I(name)`; a positive diode current lights it.
 */
export function playbackFrame(
  waveforms: readonly PlaybackSeries[],
  t: number,
): PlaybackFrame {
  const voltages: Record<string, number> = {};
  const glow: Record<string, number> = {};
  const currents: Record<string, number> = {};
  for (const wave of waveforms) {
    const value = sampleAt(wave, t);
    const currentMatch = /^I\((.+)\)$/i.exec(wave.name);
    if (currentMatch) {
      currents[currentMatch[1].toUpperCase()] = value;
      continue;
    }
    const nodeMatch = /^V\((.+)\)$/i.exec(wave.name);
    const key = nodeMatch ? nodeMatch[1].toUpperCase() : wave.name.toUpperCase();
    voltages[key] = value;
  }
  // Normalize glow per node across its own swing at this instant: reuse the
  // full-series min/max so brightness is stable frame to frame.
  for (const wave of waveforms) {
    if (/^I\(/i.test(wave.name)) continue;
    const nodeMatch = /^V\((.+)\)$/i.exec(wave.name);
    const key = nodeMatch ? nodeMatch[1].toUpperCase() : wave.name.toUpperCase();
    if (wave.data.length === 0) {
      // No samples: report neutral brightness instead of NaN from an empty range.
      glow[key] = 0.5;
      continue;
    }
    // Loop rather than spreading into Math.min/max: a long transient can hold
    // far more samples than the engine's argument limit.
    let lo = Infinity;
    let hi = -Infinity;
    for (const point of wave.data) {
      if (point.y < lo) lo = point.y;
      if (point.y > hi) hi = point.y;
    }
    const span = hi - lo;
    glow[key] = span <= 0 ? 0.5 : (voltages[key] - lo) / span;
  }
  const lit: Record<string, boolean> = {};
  for (const [branch, current] of Object.entries(currents)) {
    lit[branch] = current > 1e-9;
  }
  return { time: t, voltages, glow, lit };
}

/** Duration of the transient run: max x across waveforms, seconds. */
export function playbackDuration(waveforms: readonly PlaybackSeries[]): number {
  let max = 0;
  for (const wave of waveforms) {
    for (const point of wave.data) {
      if (point.x > max) max = point.x;
    }
  }
  return max;
}
