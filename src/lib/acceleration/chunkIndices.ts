/** Split indices into contiguous, near-equal batches for a worker pool. */
export function chunkIndices(total: number, chunks: number): number[][] {
  const count = Math.max(1, Math.min(Math.floor(chunks), Math.max(1, total)))
  const base = Math.floor(total / count)
  const remainder = total % count
  const result: number[][] = []
  let next = 0
  for (let batch = 0; batch < count; batch += 1) {
    const size = base + (batch < remainder ? 1 : 0)
    const indices = new Array<number>(size)
    for (let offset = 0; offset < size; offset += 1) indices[offset] = next + offset
    result.push(indices)
    next += size
  }
  return result
}
