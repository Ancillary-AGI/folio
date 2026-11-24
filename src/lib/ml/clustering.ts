/**
 * k-means clustering with k-means++ seeding.
 *
 * Engineering use here is partitioning — group measured operating points into
 * regimes, cluster fault signatures, reduce a large training set to prototypes.
 * Lloyd's algorithm converges to a local minimum only, so every run reports the
 * restarts tried, the inertia achieved and the stopping reason. Nothing in this
 * file claims a globally optimal partition.
 */

import { createRandomSource } from './random'

export interface KMeansOptions {
  /** Number of centroids. */
  clusters: number
  maxIterations?: number
  /** Relative centroid movement that counts as converged. */
  tolerance?: number
  /** Independent restarts; the lowest-inertia result is returned. */
  restarts?: number
  seed?: number
}

export interface KMeansResult {
  centroids: number[][]
  /** Cluster index per input point, in input order. */
  assignments: number[]
  /** Sum of squared distances to the assigned centroid. */
  inertia: number
  /** Mean silhouette width over all points, in [−1, 1]; NaN when clusters=1. */
  silhouette: number
  iterations: number
  restarts: number
  termination: 'converged' | 'iteration limit'
}

function squaredDistance(a: readonly number[], b: readonly number[]): number {
  let sum = 0
  for (let d = 0; d < a.length; d += 1) sum += (a[d] - b[d]) ** 2
  return sum
}

function validate(points: readonly (readonly number[])[], clusters: number): number {
  if (points.length === 0) throw new Error('k-means needs at least one point.')
  if (!Number.isInteger(clusters) || clusters < 1) throw new Error(`Cluster count must be a positive integer, got ${clusters}.`)
  if (clusters > points.length) {
    throw new Error(`Cannot place ${clusters} centroids on ${points.length} points; each cluster needs at least one member.`)
  }
  const dimension = points[0].length
  if (dimension === 0) throw new Error('k-means points must have at least one coordinate.')
  if (points.some((p) => p.length !== dimension)) throw new Error('Ragged point set: every point needs the same dimensionality.')
  if (points.some((p) => p.some((v) => !Number.isFinite(v)))) throw new Error('k-means points must all be finite.')
  return dimension
}

/**
 * k-means++ seeding: the next centroid is drawn with probability proportional
 * to its squared distance from the nearest existing centroid, so the starting
 * set is spread out instead of clumped.
 */
function seedCentroids(
  points: readonly (readonly number[])[],
  clusters: number,
  random: ReturnType<typeof createRandomSource>,
): number[][] {
  const centroids: number[][] = [[...points[random.integer(points.length)]]]
  while (centroids.length < clusters) {
    const distances = points.map((point) =>
      Math.min(...centroids.map((centroid) => squaredDistance(point, centroid))),
    )
    const total = distances.reduce((sum, value) => sum + value, 0)
    if (total <= 0) {
      // Every remaining point coincides with a centroid (duplicate data).
      // Re-use a centroid rather than invent a cluster boundary that has no
      // evidence behind it; the inertia reported is still the true one.
      centroids.push([...centroids[0]])
      continue
    }
    let target = random.next() * total
    let chosen = 0
    for (let i = 0; i < points.length; i += 1) {
      target -= distances[i]
      if (target <= 0) {
        chosen = i
        break
      }
    }
    centroids.push([...points[chosen]])
  }
  return centroids
}

function assign(points: readonly (readonly number[])[], centroids: readonly (readonly number[])[]): number[] {
  return points.map((point) => {
    let bestIndex = 0
    let bestDistance = Number.POSITIVE_INFINITY
    for (let c = 0; c < centroids.length; c += 1) {
      const distance = squaredDistance(point, centroids[c])
      if (distance < bestDistance) {
        bestDistance = distance
        bestIndex = c
      }
    }
    return bestIndex
  })
}

function inertiaOf(points: readonly (readonly number[])[], centroids: readonly (readonly number[])[], assignments: readonly number[]): number {
  let sum = 0
  for (let i = 0; i < points.length; i += 1) sum += squaredDistance(points[i], centroids[assignments[i]])
  return sum
}

/**
 * Mean silhouette width: (b − a) / max(a, b) where a is the mean intra-cluster
 * distance and b the nearest other cluster's mean distance. It is O(n²), so it
 * is meant for the few hundred points a partition task actually uses.
 */
export function silhouetteWidth(
  points: readonly (readonly number[])[],
  assignments: readonly number[],
  clusters: number,
): number {
  if (clusters < 2 || points.length < 2) return Number.NaN
  if (assignments.length !== points.length) throw new Error('Silhouette needs one assignment per point.')
  const present = new Set(assignments)
  if (present.size < 2) return Number.NaN

  let total = 0
  for (let i = 0; i < points.length; i += 1) {
    let intraSum = 0
    let intraCount = 0
    const perCluster = new Map<number, { sum: number; count: number }>()
    for (let j = 0; j < points.length; j += 1) {
      if (i === j) continue
      const distance = Math.sqrt(squaredDistance(points[i], points[j]))
      if (assignments[j] === assignments[i]) {
        intraSum += distance
        intraCount += 1
      } else {
        const bucket = perCluster.get(assignments[j]) ?? { sum: 0, count: 0 }
        bucket.sum += distance
        bucket.count += 1
        perCluster.set(assignments[j], bucket)
      }
    }
    if (intraCount === 0) continue
    const a = intraSum / intraCount
    let b = Number.POSITIVE_INFINITY
    for (const bucket of perCluster.values()) b = Math.min(b, bucket.sum / bucket.count)
    if (!Number.isFinite(b)) continue
    const denominator = Math.max(a, b)
    total += denominator === 0 ? 0 : (b - a) / denominator
  }
  return total / points.length
}

/**
 * Lloyd's algorithm with k-means++ seeding and multiple restarts.
 * Empty clusters are re-seeded on the worst-fitted point, which is what keeps a
 * bad start from silently discarding a requested cluster.
 */
export function cluster(points: readonly (readonly number[])[], options: KMeansOptions): KMeansResult {
  const dimension = validate(points, options.clusters)
  const maxIterations = options.maxIterations ?? 200
  const tolerance = options.tolerance ?? 1e-8
  const restarts = options.restarts ?? 8
  if (!Number.isInteger(maxIterations) || maxIterations < 1) throw new Error(`Max iterations must be a positive integer, got ${maxIterations}.`)
  if (!(tolerance > 0) || !Number.isFinite(tolerance)) throw new Error(`Tolerance must be a positive finite number, got ${tolerance}.`)
  if (!Number.isInteger(restarts) || restarts < 1) throw new Error(`Restart count must be a positive integer, got ${restarts}.`)

  const random = createRandomSource(options.seed ?? 2024)
  let best: KMeansResult | null = null

  for (let restart = 0; restart < restarts; restart += 1) {
    let centroids = seedCentroids(points, options.clusters, random)
    let assignments = assign(points, centroids)
    let iterations = 0
    let termination: KMeansResult['termination'] = 'iteration limit'

    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      iterations = iteration + 1
      const sums = Array.from({ length: options.clusters }, () => new Array<number>(dimension).fill(0))
      const counts = new Array<number>(options.clusters).fill(0)
      for (let i = 0; i < points.length; i += 1) {
        counts[assignments[i]] += 1
        for (let d = 0; d < dimension; d += 1) sums[assignments[i]][d] += points[i][d]
      }

      const updated = centroids.map((_centroid, c) => {
        if (counts[c] === 0) {
          // Re-seed an empty cluster on the point furthest from its centroid.
          let worstIndex = 0
          let worstDistance = -1
          for (let i = 0; i < points.length; i += 1) {
            const distance = squaredDistance(points[i], centroids[assignments[i]])
            if (distance > worstDistance) {
              worstDistance = distance
              worstIndex = i
            }
          }
          return [...points[worstIndex]]
        }
        return sums[c].map((sum) => sum / counts[c])
      })

      const movement = Math.max(...updated.map((centroid, c) => Math.sqrt(squaredDistance(centroid, centroids[c]))))
      centroids = updated
      assignments = assign(points, centroids)
      if (movement <= tolerance * Math.max(1, inertiaScale(centroids))) {
        termination = 'converged'
        break
      }
    }

    const candidate: KMeansResult = {
      centroids,
      assignments,
      inertia: inertiaOf(points, centroids, assignments),
      silhouette: silhouetteWidth(points, assignments, options.clusters),
      iterations,
      restarts: restart + 1,
      termination,
    }
    if (!best || candidate.inertia < best.inertia) best = candidate
    // Identical inertia means the restarts are not adding information; stop.
    if (best && Math.abs(best.inertia) < 1e-15) break
  }

  if (!best) throw new Error('k-means produced no partition (internal: restart loop never ran).')
  return best
}

function inertiaScale(centroids: readonly (readonly number[])[]): number {
  let max = 0
  for (const centroid of centroids) {
    for (const value of centroid) max = Math.max(max, Math.abs(value))
  }
  return max
}

/**
 * Pick k by the elbow heuristic: run k-means for each candidate k and report
 * the inertia and silhouette curve. This is a diagnostic, not an oracle — the
 * curve is returned so a human can see the bend rather than trust a number.
 */
export function evaluateClusterCounts(
  points: readonly (readonly number[])[],
  candidates: readonly number[],
  options: Omit<KMeansOptions, 'clusters'> = {},
): Array<{ clusters: number; inertia: number; silhouette: number }> {
  if (candidates.length === 0) throw new Error('Provide at least one cluster count to evaluate.')
  return candidates.map((clusters) => {
    const result = cluster(points, { ...options, clusters })
    return { clusters, inertia: result.inertia, silhouette: result.silhouette }
  })
}
