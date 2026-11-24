/**
 * Deterministic SVG identicons for human names.
 *
 * The standalone deployment has no server to fetch avatars from, so every
 * profile gets one drawn from the same hash — same name, same avatar, forever.
 * The grid is a symmetric 5×5 pattern (mirrored both axes) on a hue chosen
 * by the hash so two people sharing a first letter never look alike.
 */

export interface Identicon {
  /** Solid background colour for the avatar square. */
  background: string
  /** 5×5 fill cells, already mirrored horizontally. */
  cells: readonly boolean[]
  /** Contrasting ink for the face features. */
  ink: string
}

/** FNV-1a — fast, stable across engines, no dependencies. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5 >>> 0
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

const PALETTES: ReadonlyArray<{ background: string; ink: string }> = [
  { background: '#1B3A4B', ink: '#E8C468' },
  { background: '#33231B', ink: '#FF8A5C' },
  { background: '#1E3524', ink: '#7DE3A1' },
  { background: '#352B1E', ink: '#F5C561' },
  { background: '#2E1E35', ink: '#D29BFF' },
  { background: '#1E2F35', ink: '#5FD4D8' },
  { background: '#3A1E1E', ink: '#FF6B5C' },
  { background: '#1F1E33', ink: '#7A9BFF' },
]

const CELL_COUNT = 15 // 5 rows × 3 columns; the two outer columns mirror the left one.

export function identicon(name: string): Identicon {
  const hash = fnv1a(name.trim().toLowerCase() || '?')
  const palette = PALETTES[hash % PALETTES.length]
  // 15 bits from a different position of the stream for the cell pattern.
  const pattern = (hash >>> 3) & 0x7fff
  const cells: Array<boolean> = []
  for (let i = 0; i < CELL_COUNT; i += 1) {
    const bit = ((pattern >>> i) & 1) === 1
    cells.push(bit)
  }
  return { background: palette.background, ink: palette.ink, cells }
}

/** The viewBox-friendly cell coordinates to paint, in "px" units. */
export function identiconCells(cells: readonly boolean[]): Array<{ x: number; y: number }> {
  const rows = 5
  const leftColumns = 3
  const out: Array<{ x: number; y: number }> = []
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < leftColumns; col += 1) {
      const index = row * leftColumns + col
      if (!cells[index]) continue
      out.push({ x: col, y: row })
      if (col < 2) out.push({ x: 4 - col, y: row })
    }
  }
  return out
}
