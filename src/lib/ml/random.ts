/**
 * Deterministic randomness. Every heuristic/learning routine in this toolbox
 * must be reproducible from a seed, because an engineer re-running a tuning
 * search has to be able to see the same gains or the result is not verifiable.
 */

export interface RandomSource {
  /** Uniform in [0, 1). */
  next(): number
  /** Standard normal via Box-Muller. */
  normal(mean?: number, stdDev?: number): number
  /** Uniform integer in [0, bound). */
  integer(bound: number): number
  /** Uniform in [low, high). */
  range(low: number, high: number): number
}

/** mulberry32: 32-bit state, period 2^32, passes the usual smoke tests. */
export function createRandomSource(seed: number): RandomSource {
  let state = (seed >>> 0) || 0x9e3779b9
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  return {
    next,
    normal(mean = 0, stdDev = 1): number {
      // Box-Muller; the log argument is clamped away from 0 so a perfect 0 draw
      // cannot produce -Infinity.
      const u1 = Math.max(next(), Number.MIN_VALUE)
      const u2 = next()
      const radius = Math.sqrt(-2 * Math.log(u1))
      return mean + stdDev * radius * Math.cos(2 * Math.PI * u2)
    },
    integer(bound: number): number {
      if (!Number.isInteger(bound) || bound <= 0) {
        throw new Error(`Random integer bound must be a positive integer, got ${bound}.`)
      }
      return Math.floor(next() * bound)
    },
    range(low: number, high: number): number {
      if (!(high > low)) throw new Error(`Random range needs high > low, got [${low}, ${high}].`)
      return low + next() * (high - low)
    },
  }
}

/** Fisher-Yates in-place shuffle driven by `random`. */
export function shuffleInPlace<T>(items: T[], random: RandomSource): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = random.integer(i + 1)
    const swap = items[i]
    items[i] = items[j]
    items[j] = swap
  }
  return items
}
