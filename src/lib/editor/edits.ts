/**
 * Pure editing operations for `CodeEditor`.
 *
 * Every function here takes the buffer plus a caret range and returns a new
 * buffer plus a caret range. Keeping them pure means the behaviours that make
 * an editor feel like an editor — auto-indent, bracket pairs, comment
 * toggling, tab indenting a block — are testable without a DOM and identical
 * in tests and in the browser.
 */
import type { LanguageSpec } from './languages'

export interface CursorState {
  value: string
  start: number
  end: number
}

export interface Edit extends CursorState {
  /** True when the operation changed anything, so callers can let the native
   *  key behave otherwise. */
  changed: boolean
}

export const BRACKET_PAIRS: Record<string, string> = {
  '(': ')',
  '[': ']',
  '{': '}',
  '"': '"',
  "'": "'",
  '`': '`',
}

const OPENERS = new Set(['(', '[', '{'])
const CLOSERS = new Set([')', ']', '}'])
const QUOTES = new Set(['"', "'", '`'])

export function lineStartOf(value: string, index: number): number {
  const nl = value.lastIndexOf('\n', Math.max(0, index - 1))
  return nl + 1
}

export function lineEndOf(value: string, index: number): number {
  const nl = value.indexOf('\n', index)
  return nl === -1 ? value.length : nl
}

/** Zero-based line/column of an offset — what the status readout shows. */
export function positionOf(value: string, index: number): { line: number; column: number } {
  const upto = value.slice(0, index)
  const lines = upto.split('\n')
  return { line: lines.length - 1, column: lines[lines.length - 1].length }
}

export function wordPrefixAt(value: string, caret: number): { prefix: string; start: number } {
  let i = caret
  while (i > 0 && /[A-Za-z0-9_$.@]/.test(value[i - 1])) i -= 1
  return { prefix: value.slice(i, caret), start: i }
}

export function selectLineRange(value: string, start: number, end: number): { from: number; to: number } {
  return { from: lineStartOf(value, start), to: lineEndOf(value, Math.max(start, end)) }
}

function unchanged(state: CursorState): Edit {
  return { ...state, changed: false }
}

function indentWidth(spec: LanguageSpec): number {
  return spec.tabText.replace(/\t/g, '    ').length
}

/** The leading whitespace of the line the caret sits on, plus one more level
 *  when the text before the caret opens a block. */
export function nextIndent(value: string, caret: number, spec: LanguageSpec): string {
  const from = lineStartOf(value, caret)
  const line = value.slice(from, caret)
  const match = /^[ \t]*/.exec(line)![0]
  const trimmed = line.trim()
  if (!trimmed) return match
  const opensBlock = new RegExp(spec.indentOpen).test(line)
  return opensBlock ? match + spec.tabText : match
}

export function insertNewline(state: CursorState, spec: LanguageSpec): Edit {
  const { value, start, end } = state
  const caret = Math.max(start, end)
  const indent = nextIndent(value, caret, spec)
  // Brackets the cursor is sitting between: put the closer on its own line and
  // leave the caret in the middle, which is what an editor does for `{|}`.
  const betweenPairs = OPENERS.has(value[caret - 1] ?? '') && value[caret] === BRACKET_PAIRS[value[caret - 1]]
  const before = value.slice(0, start)
  const after = value.slice(end)
  if (betweenPairs) {
    // `foo(|)` becomes three lines: the caret gets one level in, the closer
    // returns to the line's own indentation.
    const raw = /^[ \t]*/.exec(value.slice(lineStartOf(value, caret), caret))![0]
    const body = raw + spec.tabText
    const next = `${before}\n${body}\n${raw}${value[caret]}${after.slice(1)}`
    const caretNext = before.length + 1 + body.length
    return { value: next, start: caretNext, end: caretNext, changed: true }
  }
  const next = `${before}\n${indent}${after}`
  const caretNext = before.length + 1 + indent.length
  return { value: next, start: caretNext, end: caretNext, changed: true }
}

export function indentSelection(state: CursorState, spec: LanguageSpec): Edit {
  const { value, start, end } = state
  const multiLine = value.slice(start, end).includes('\n')
  if (!multiLine && start === end) {
    // Between a bracket pair, tab jumps over the closer instead of inserting.
    if (CLOSERS.has(value[start]) || QUOTES.has(value[start])) {
      return { value, start: start + 1, end: start + 1, changed: true }
    }
    const next = `${value.slice(0, start)}${spec.tabText}${value.slice(start)}`
    const caret = start + spec.tabText.length
    return { value: next, start: caret, end: caret, changed: true }
  }
  const { from, to } = selectLineRange(value, start, end)
  const block = value.slice(from, to)
  const width = indentWidth(spec)
  const blockLines = block.split('\n')
  let delta = 0
  const lines = blockLines.map((line, index) => {
    if (!line.trim() && index === blockLines.length - 1) return line
    if (line.startsWith(spec.tabText)) { delta -= spec.tabText.length; return line.slice(spec.tabText.length) }
    const spaces = /^[ ]+/.exec(line)?.[0].length ?? 0
    if (spaces >= width) { delta -= width; return line.slice(width) }
    if (spaces > 0) { delta -= spaces; return line.slice(spaces) }
    delta += spec.tabText.length
    return spec.tabText + line
  })
  const next = value.slice(0, from) + lines.join('\n') + value.slice(to)
  return { value: next, start: Math.max(from, start + spec.tabText.length), end: to + delta, changed: true }
}

export function outdentSelection(state: CursorState, spec: LanguageSpec): Edit {
  const { value, start, end } = state
  const width = indentWidth(spec)
  if (start === end && !value.slice(start, end).includes('\n')) {
    const before = value.slice(Math.max(0, start - spec.tabText.length), start)
    if (before === spec.tabText) {
      const next = value.slice(0, start - spec.tabText.length) + value.slice(start)
      return { value: next, start: start - spec.tabText.length, end: start - spec.tabText.length, changed: true }
    }
    if (/^[ ]{1,}/.test(before)) {
      const trim = Math.min(before.length, width)
      const next = value.slice(0, start - trim) + value.slice(start)
      return { value: next, start: start - trim, end: start - trim, changed: true }
    }
    return unchanged(state)
  }
  const { from, to } = selectLineRange(value, start, end)
  const lines = value.slice(from, to).split('\n')
  let delta = 0
  let firstDelta = 0
  const out = lines.map((line, index) => {
    if (line.startsWith(spec.tabText)) {
      const removed = spec.tabText.length
      if (index === 0) firstDelta = -removed
      else delta -= removed
      return line.slice(spec.tabText.length)
    }
    const spaces = /^[ ]+/.exec(line)?.[0].length ?? 0
    const removed = Math.min(spaces, width)
    if (!removed) return line
    if (index === 0) firstDelta = -removed
    else delta -= removed
    return line.slice(removed)
  })
  const next = value.slice(0, from) + out.join('\n') + value.slice(to)
  return { value: next, start: Math.max(from, start + firstDelta), end: Math.max(from, to + delta), changed: delta !== 0 || firstDelta !== 0 }
}

export function wrapQuotes(state: CursorState, open: string, close: string, expandSelection = true): Edit {
  const { value, start, end } = state
  const selected = value.slice(start, end)
  if (selected && expandSelection) {
    const next = `${value.slice(0, start)}${open}${selected}${close}${value.slice(end)}`
    return { value: next, start: start + open.length, end: start + open.length + selected.length, changed: true }
  }
  const after = value.slice(end)
  // Typing a closer that is already there moves past it instead of doubling.
  if (!selected && close === open && after.startsWith(close) && !isEscapeDoubled(value, end)) {
    return { value, start: end + close.length, end: end + close.length, changed: true }
  }
  if (after.startsWith(close) && !OPENERS.has(open)) return { value, start: end + 1, end: end + 1, changed: true }
  const next = `${value.slice(0, start)}${open}${close}${value.slice(end)}`
  const caret = start + open.length
  return { value: next, start: caret, end: caret, changed: true }
}

function isEscapeDoubled(value: string, index: number): boolean {
  let backslashes = 0
  let i = index - 1
  while (i >= 0 && value[i] === '\\') { backslashes += 1; i -= 1 }
  return backslashes % 2 === 1
}

/** Backspace between a bracket pair, or on an empty quoted pair, removes both. */
export function backspacePair(state: CursorState, spec: LanguageSpec): Edit | null {
  const { value, start, end } = state
  if (start !== end) return null
  const ch = value[start - 1] ?? ''
  const next = value[start] ?? ''
  const paired = BRACKET_PAIRS[ch] === next && (OPENERS.has(ch) || spec.quotes.includes(ch))
  if (!paired) return null
  return { value: value.slice(0, start - 1) + value.slice(start + 1), start: start - 1, end: start - 1, changed: true }
}

export function toggleLineComment(state: CursorState, spec: LanguageSpec): Edit {
  const marker = spec.lineComments[0]
  if (!marker) return unchanged(state)
  const { value, start, end } = state
  const { from, to } = selectLineRange(value, start, end)
  const lines = value.slice(from, to).split('\n')
  const allCommented = lines.every(line => !line.trim() || line.trimStart().startsWith(marker))
  let delta = 0
  let firstDelta = 0
  const out = lines.map((line, index) => {
    const apply = () => {
      const leading = /^[ \t]*/.exec(line)![0]
      const rest = line.slice(leading.length)
      const inserted = `${leading}${marker} ${rest}`
      const change = inserted.length - line.length
      if (index === 0) firstDelta = change
      else delta += change
      return inserted
    }
    const remove = () => {
      const trimmed = line.replace(/^([ \t]*)[ ]?/, '$1')
      const position = trimmed.indexOf(marker)
      if (position < 0) return line
      const nextLine = trimmed.slice(0, position) + trimmed.slice(position + marker.length).replace(/^[ ]/, '')
      const change = nextLine.length - line.length
      if (index === 0) firstDelta = change
      else delta += change
      return nextLine
    }
    if (!line.trim()) return line
    return allCommented ? remove() : apply()
  })
  const next = value.slice(0, from) + out.join('\n') + value.slice(to)
  return { value: next, start: Math.max(from, start + firstDelta), end: to + delta, changed: true }
}

/** Offset of the bracket that matches the one at `index`, or null. Scans both
 *  directions so the highlight works whether the caret sits on the opener or
 *  the closer. */
export function matchingBracket(value: string, index: number): number | null {
  const ch = value[index] ?? ''
  const isOpener = OPENERS.has(ch)
  if (!isOpener && !CLOSERS.has(ch)) return null
  if (isOpener) {
    const closer = BRACKET_PAIRS[ch]
    let depth = 0
    for (let i = index; i < value.length; i += 1) {
      if (value[i] === ch) depth += 1
      else if (value[i] === closer) {
        depth -= 1
        if (depth === 0) return i
      }
    }
    return null
  }
  const opener = Object.keys(BRACKET_PAIRS).find(key => BRACKET_PAIRS[key] === ch && OPENERS.has(key))!
  let depth = 0
  for (let i = index; i >= 0; i -= 1) {
    if (value[i] === ch) depth += 1
    else if (value[i] === opener) {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return null
}

export function applyCompletion(state: CursorState, completion: string, replaceFrom: number): Edit {
  const { value, end } = state
  const caret = Math.max(state.start, end)
  // Swallow the word suffix already on the line so completing `qsort` over
  // `quick` does not leave the old tail behind.
  let tail = caret
  while (tail < value.length && /[A-Za-z0-9_$.@]/.test(value[tail])) tail += 1
  const next = `${value.slice(0, replaceFrom)}${completion}${value.slice(tail)}`
  const caretNext = replaceFrom + completion.length
  return { value: next, start: caretNext, end: caretNext, changed: true }
}

/** Replace one found match; used by the find bar. */
export function replaceRange(state: CursorState, from: number, to: number, text: string): Edit {
  const next = state.value.slice(0, from) + text + state.value.slice(to)
  const caret = from + text.length
  return { value: next, start: caret, end: caret, changed: true }
}

export function findMatches(value: string, query: string, caseSensitive: boolean): number[] {
  if (!query) return []
  const haystack = caseSensitive ? value : value.toLowerCase()
  const needle = caseSensitive ? query : query.toLowerCase()
  const out: number[] = []
  let i = haystack.indexOf(needle)
  while (i !== -1) {
    out.push(i)
    i = haystack.indexOf(needle, i + needle.length)
  }
  return out
}
