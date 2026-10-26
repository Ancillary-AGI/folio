/**
 * Compact, honest summaries of solved waveforms.
 *
 * An agent iterating on a design cannot read a thousand-point trace per call,
 * but it must not be handed a decimated trace that hides a spike either. Stats
 * are computed on the full series; optional samples preserve extrema per
 * bucket. Every number here comes from the solver's own points — nothing is
 * smoothed or extrapolated.
 */
import type { SimulationResult } from './spiceEngine'

export interface Point {
  x: number
  y: number
}

export interface SeriesStats {
  points: number
  start: number
  final: number
  min: number
  max: number
  peakToPeak: number
  absMax: number
  mean: number
  rms: number
}

export interface WaveformSummary {
  name: string
  type: 'voltage' | 'current' | 'power'
  unit: string
  stats: SeriesStats
  /**
   * Statistics over the settled tail of a transient. A rectifier's full-window
   * ripple is dominated by the startup ramp; engineering ripple is measured
   * after the filter has charged.
   */
  settled?: SeriesStats
  /** Downsampled points, only when the caller asks for them. */
  samples?: Point[]
}

const integrate = (data: readonly Point[], square = false): number => {
  let area = 0
  for (let index = 1; index < data.length; index++) {
    const previous = data[index - 1]
    const point = data[index]
    const width = point.x - previous.x
    if (!(width > 0)) continue
    const left = square ? previous.y * previous.y : previous.y
    const right = square ? point.y * point.y : point.y
    area += ((left + right) / 2) * width
  }
  return area
}

export function seriesStats(data: readonly Point[]): SeriesStats | undefined {
  if (data.length === 0) return undefined
  let min = Infinity
  let max = -Infinity
  let absMax = 0
  for (const point of data) {
    if (point.y < min) min = point.y
    if (point.y > max) max = point.y
    absMax = Math.max(absMax, Math.abs(point.y))
  }
  const span = data.length > 1 ? data[data.length - 1].x - data[0].x : 0
  const mean = data.length === 1 ? data[0].y : span > 0 ? integrate(data) / span : data.reduce((sum, p) => sum + p.y, 0) / data.length
  const meanSquare = data.length === 1 ? data[0].y * data[0].y : span > 0 ? integrate(data, true) / span : data.reduce((sum, p) => sum + p.y * p.y, 0) / data.length
  return {
    points: data.length,
    start: data[0].y,
    final: data[data.length - 1].y,
    min,
    max,
    peakToPeak: max - min,
    absMax,
    mean,
    rms: Math.sqrt(Math.max(0, meanSquare)),
  }
}

/**
 * Keep one representative per bucket plus the bucket's extrema, so a narrow
 * switching spike survives decimation that would otherwise drop it.
 */
export function downsample(data: readonly Point[], maxPoints: number): Point[] {
  if (maxPoints <= 0 || data.length <= maxPoints) return data.map((point) => ({ ...point }))
  const buckets = Math.max(1, Math.floor(maxPoints / 3))
  const size = data.length / buckets
  const result: Point[] = []
  for (let bucket = 0; bucket < buckets; bucket++) {
    const start = Math.floor(bucket * size)
    const end = Math.min(data.length, Math.floor((bucket + 1) * size))
    if (end <= start) continue
    let lowest = data[start]
    let highest = data[start]
    for (let index = start + 1; index < end; index++) {
      if (data[index].y < lowest.y) lowest = data[index]
      if (data[index].y > highest.y) highest = data[index]
    }
    if (lowest.x <= highest.x) {
      result.push({ ...lowest })
      if (highest !== lowest) result.push({ ...highest })
    } else {
      result.push({ ...highest })
      if (highest !== lowest) result.push({ ...lowest })
    }
  }
  const first = data[0]
  const last = data[data.length - 1]
  if (result.length === 0 || result[0].x !== first.x) result.unshift({ ...first })
  if (result[result.length - 1].x !== last.x) result.push({ ...last })
  return result
}

export function summarizeWaveforms(
  result: SimulationResult,
  options: { includeSamples?: boolean; maxPoints?: number; settledFraction?: number } = {},
): WaveformSummary[] {
  return result.waveforms.map((waveform) => {
    const stats = seriesStats(waveform.data)
    const fraction = options.settledFraction
    const settled = fraction !== undefined && fraction > 0 && fraction < 1 && waveform.data.length > 1
      ? seriesStats(
          waveform.data.slice(
            Math.min(waveform.data.length - 1, Math.max(0, Math.floor(waveform.data.length * fraction))),
          ),
        )
      : undefined
    return {
      name: waveform.name,
      type: waveform.type,
      unit: waveform.unit,
      stats: stats ?? {
        points: 0, start: 0, final: 0, min: 0, max: 0, peakToPeak: 0, absMax: 0, mean: 0, rms: 0,
      },
      ...(settled ? { settled } : {}),
      ...(options.includeSamples
        ? { samples: downsample(waveform.data, options.maxPoints ?? 120) }
        : {}),
    }
  })
}

/** Find a waveform by exact name, or by bare net/device reference. */
export function findWaveform(
  result: SimulationResult,
  name: string,
): SimulationResult['waveforms'][number] | undefined {
  const wanted = name.trim().toLowerCase()
  const exact = result.waveforms.find((waveform) => waveform.name.toLowerCase() === wanted)
  if (exact) return exact
  if (!wanted.includes('(')) {
    return (
      result.waveforms.find((waveform) => waveform.name.toLowerCase() === `v(${wanted})`)
      ?? result.waveforms.find((waveform) => waveform.name.toLowerCase() === `i(${wanted})`)
    )
  }
  return undefined
}

export type Statistic = 'peak' | 'minimum' | 'mean' | 'rms' | 'final' | 'start' | 'ripple'

export function statisticValue(stats: SeriesStats, statistic: Statistic): number {
  switch (statistic) {
    case 'peak':
      return stats.max
    case 'minimum':
      return stats.min
    case 'mean':
      return stats.mean
    case 'rms':
      return stats.rms
    case 'final':
      return stats.final
    case 'start':
      return stats.start
    case 'ripple':
      return stats.peakToPeak
  }
}
