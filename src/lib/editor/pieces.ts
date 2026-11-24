/**
 * Line layout for the code editor backdrop.
 *
 * The editor paints a highlighted `<pre>` underneath a transparent textarea,
 * so every row of the backdrop must be one-to-one with a row of the textarea.
 * This module turns a line's token segments plus the overlays the editor wants
 * (find matches, the bracket pair, a ghost completion) into the exact spans to
 * render, splitting tokens at overlay boundaries so a match inside a keyword
 * still shows both colours.
 */
import type { Segment, TokenKind } from './languages'

export interface Decoration {
  /** Column, not offset: everything here works a line at a time. */
  from: number
  to: number
  className: string
  /** Text to paint at `from` without consuming anything — the ghost suffix. */
  insert?: string
}

export interface Piece {
  kind: TokenKind | null
  text: string
  className?: string
  key: string
}

const EMPTY: Piece[] = []

export function decorateLine(segments: Segment[], decorations: Decoration[]): Piece[] {
  if (segments.length === 0 && decorations.length === 0) return EMPTY
  const length = segments.reduce((sum, segment) => sum + segment.text.length, 0)
  const bounds = new Set<number>([0, length])
  for (const decoration of decorations) {
    if (decoration.insert === undefined) {
      bounds.add(clamp(decoration.from, 0, length))
      bounds.add(clamp(decoration.to, 0, length))
    } else {
      bounds.add(clamp(decoration.from, 0, length))
    }
  }
  const cuts = [...bounds].filter(value => value > 0 && value < length).sort((a, b) => a - b)

  // Split every token at the cut columns so overlays can only ever cover a
  // whole atomic run.
  type Atom = { kind: TokenKind | null; from: number; to: number; text: string }
  const atoms: Atom[] = []
  let column = 0
  let cutIndex = 0
  for (const segment of segments) {
    let rest = segment.text
    let start = column
    while (rest.length > 0) {
      const next = cuts[cutIndex]
      if (next === undefined) break
      if (next <= start) { cutIndex += 1; continue }
      if (next >= start + rest.length) break
      const width = next - start
      atoms.push({ kind: segment.kind, from: start, to: next, text: rest.slice(0, width) })
      rest = rest.slice(width)
      start = next
      cutIndex += 1
    }
    if (rest.length > 0) atoms.push({ kind: segment.kind, from: start, to: start + rest.length, text: rest })
    column += segment.text.length
  }

  const covering = (from: number, to: number): string | undefined =>
    decorations.find(decoration =>
      decoration.insert === undefined &&
      decoration.from <= from &&
      decoration.to >= to &&
      decoration.to > decoration.from,
    )?.className

  const insertsAt = new Map<number, Decoration[]>()
  for (const decoration of decorations) {
    if (decoration.insert === undefined) continue
    const at = clamp(decoration.from, 0, length)
    const list = insertsAt.get(at)
    if (list) list.push(decoration)
    else insertsAt.set(at, [decoration])
  }

  const out: Piece[] = []
  const emitInserts = (columnAt: number) => {
    const pending = insertsAt.get(columnAt)
    if (!pending) return
    pending.forEach((decoration, index) => {
      out.push({ kind: null, text: decoration.insert!, className: decoration.className, key: `${columnAt}i${index}` })
    })
    insertsAt.delete(columnAt)
  }

  emitInserts(0)
  atoms.forEach((atom, index) => {
    out.push({ kind: atom.kind, text: atom.text, className: covering(atom.from, atom.to), key: String(index) })
    emitInserts(atom.to)
  })
  // An insert at the very end of an empty line has no atom to hang off.
  insertsAt.forEach((pending, at) => {
    pending.forEach((decoration, index) => {
      out.push({ kind: null, text: decoration.insert!, className: decoration.className, key: `${at}t${index}` })
    })
  })
  return out.filter(piece => piece.text.length > 0)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Overlay spans for one line given whole-document match offsets. */
export function decorationsForLine(
  lineStart: number,
  lineLength: number,
  matches: number[],
  matchLength: number,
  activeMatch: number,
): Decoration[] {
  const out: Decoration[] = []
  for (const offset of matches) {
    if (offset < lineStart || offset > lineStart + lineLength) continue
    const className = offset === activeMatch ? 'code-match code-match-active' : 'code-match'
    out.push({ from: offset - lineStart, to: offset - lineStart + matchLength, className })
  }
  return out
}
