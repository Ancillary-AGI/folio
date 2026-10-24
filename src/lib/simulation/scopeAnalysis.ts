/**
 * Scope measurements + power analysis over simulated waveforms.
 *
 * The SimulationPanel plotted waveforms but answered no questions about
 * them: no cursors/measurements, no CSV export, no power/efficiency math.
 * Every function here is pure over waveform data and independently tested:
 * peak/peak-to-peak/RMS/mean/frequency/duty, V·I instantaneous power with
 * trapezoidal integration, efficiency = Pout/Pin. Fail-loud on empty or
 * mismatched series — never a fabricated number.
 */
export interface WaveformPoint { x: number; y: number }
export interface WaveformSeries { name: string; unit: string; data: WaveformPoint[] }

export interface ScopeMeasurement {
  min: number; max: number; peakToPeak: number; mean: number; rms: number;
  frequencyHz: number | null; dutyCycle: number | null;
}

/** Require a non-empty series; name the offender. */
function requireSeries(series: WaveformSeries): WaveformPoint[] {
  if (!series || series.data.length === 0) throw new Error(`Scope: waveform "${series?.name ?? '?'}" has no data.`);
  return series.data;
}

/**
 * Full measurement set: min/max/pp/mean/RMS plus frequency + duty from
 * rising-edge crossings of the mid level (null for DC-like traces).
 */
export function measureWaveform(series: WaveformSeries): ScopeMeasurement {
  const data = requireSeries(series);
  let min = Infinity, max = -Infinity, sum = 0, sumSquares = 0;
  let weighted = 0, weightedSquares = 0, timeSpan = 0;
  for (let index = 0; index < data.length; index += 1) {
    const point = data[index];
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new Error(`Scope: waveform "${series.name}" contains a non-finite sample.`);
    }
    if (point.y < min) min = point.y;
    if (point.y > max) max = point.y;
    sum += point.y;
    sumSquares += point.y * point.y;
    if (index > 0) {
      const previous = data[index - 1];
      const dt = point.x - previous.x;
      if (!(dt >= 0)) {
        throw new Error(`Scope: waveform "${series.name}" time axis must be non-decreasing.`);
      }
      // Trapezoidal time weighting: transient grids are adaptive, so a plain
      // sample average would over-weight the closely spaced edge samples.
      weighted += ((previous.y + point.y) / 2) * dt;
      weightedSquares += ((previous.y * previous.y + point.y * point.y) / 2) * dt;
      timeSpan += dt;
    }
  }
  const mean = timeSpan > 0 ? weighted / timeSpan : sum / data.length;
  const rms = Math.sqrt(Math.max(0, timeSpan > 0 ? weightedSquares / timeSpan : sumSquares / data.length));
  // Rising crossings of the mid level mark full periods.
  const mid = (min + max) / 2;
  const crossings: number[] = [];
  for (let i = 1; i < data.length; i += 1) {
    if (data[i - 1].y < mid && data[i].y >= mid) {
      const span = data[i].x - data[i - 1].x;
      const fraction = span === 0 ? 0 : (mid - data[i - 1].y) / (data[i].y - data[i - 1].y);
      crossings.push(data[i - 1].x + fraction * span);
    }
  }
  let frequencyHz: number | null = null;
  let dutyCycle: number | null = null;
  if (crossings.length >= 2) {
    const periods = crossings.slice(1).map((c, i) => c - crossings[i]);
    const period = periods.reduce((a, b) => a + b, 0) / periods.length;
    if (period > 0) {
      frequencyHz = 1 / period;
      // Time above mid between the first and last rising crossing. Measuring
      // the *duration* keeps duty cycle independent of the sample density.
      const windowStart = crossings[0];
      const windowEnd = crossings[crossings.length - 1];
      let highTime = 0;
      let totalTime = 0;
      for (let index = 1; index < data.length; index += 1) {
        const previous = data[index - 1];
        const point = data[index];
        if (previous.x < windowStart || point.x > windowEnd) continue;
        const dt = point.x - previous.x;
        if (!(dt >= 0)) continue;
        totalTime += dt;
        if ((previous.y + point.y) / 2 >= mid) highTime += dt;
      }
      dutyCycle = totalTime > 0 ? highTime / totalTime : null;
    }
  }
  return { min, max, peakToPeak: max - min, mean, rms, frequencyHz, dutyCycle };
}

/** Instantaneous V·I power series; both series share the x grid. */
export function powerSeries(voltage: WaveformSeries, current: WaveformSeries): WaveformPoint[] {
  const v = requireSeries(voltage);
  const c = requireSeries(current);
  if (v.length !== c.length) {
    throw new Error(`Scope: power needs matching grids (${voltage.name}: ${v.length}, ${current.name}: ${c.length}).`);
  }
  return v.map((point, i) => ({ x: point.x, y: point.y * c[i].y }));
}

/** Average power by the trapezoidal rule over the run. */
export function averagePower(power: WaveformPoint[]): number {
  if (power.length < 2) throw new Error('Scope: power needs at least two samples to integrate.');
  let energy = 0;
  for (let i = 1; i < power.length; i += 1) {
    const dt = power[i].x - power[i - 1].x;
    if (!(dt >= 0)) throw new Error('Scope: power time axis must be non-decreasing.');
    energy += ((power[i].y + power[i - 1].y) / 2) * dt;
  }
  const span = power[power.length - 1].x - power[0].x;
  if (!(span > 0)) throw new Error('Scope: power time span must be positive.');
  return energy / span;
}

/**
 * Efficiency = average load power / average supply power, in [0, 1].
 * Throws when the supply delivers nothing (open circuit, not 100 %).
 */
export function efficiency(loadPowerW: number, supplyPowerW: number): number {
  if (!Number.isFinite(loadPowerW) || !Number.isFinite(supplyPowerW)) {
    throw new Error('Scope: power figures must be finite.');
  }
  if (!(supplyPowerW > 0)) throw new Error('Scope: supply delivers no power — efficiency undefined.');
  const eta = loadPowerW / supplyPowerW;
  if (eta < 0 || eta > 1) throw new Error(`Scope: efficiency ${eta} outside [0, 1] — check probe signs.`);
  return eta;
}

/** Waveforms → CSV text (x + one column per series), for scope export. */
export function waveformsToCsv(seriesList: readonly WaveformSeries[]): string {
  if (seriesList.length === 0) throw new Error('Scope: nothing to export.');
  if (seriesList.some((series) => series.data.length === 0)) {
    throw new Error('Scope: every series needs at least one sample to export.');
  }
  const rows = seriesList[0].data.length;
  seriesList.forEach((series) => {
    if (series.data.length !== rows) {
      throw new Error(
        `Scope: CSV export needs one shared time grid ("${seriesList[0].name}" has ${rows} samples, ` +
          `"${series.name}" has ${series.data.length}).`,
      );
    }
    for (let i = 0; i < rows; i += 1) {
      if (series.data[i].x !== seriesList[0].data[i].x) {
        throw new Error(
          `Scope: CSV export needs one shared time grid ("${series.name}" differs at sample ${i}).`,
        );
      }
    }
  });
  const header = ['t', ...seriesList.map((s) => s.name)].join(',');
  const lines = [header];
  for (let i = 0; i < rows; i += 1) {
    lines.push([seriesList[0].data[i].x, ...seriesList.map((s) => s.data[i].y)].join(','));
  }
  return `${lines.join('\n')}\n`;
}
