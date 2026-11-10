/**
 * CodeEditor — the code surface every text-entry panel in Folio shares.
 *
 * Why a textarea and not a bundled editor: the buffer is a plain string that
 * dozens of panels already own, the solvers take its text as their input, and
 * the suites drive it with `getByLabelText` + `fireEvent.change`. What those
 * panels lacked was everything that makes an editor usable, so the textarea
 * stays the source of truth for caret, selection and paste, and the appearance
 * is painted in a backdrop underneath it — `.code-metrics` in index.css gives
 * the two identical metrics, and only the backdrop carries colour while the
 * textarea keeps its caret and selection.
 *
 * What it adds, and where each part comes from:
 *   • syntax highlighting from `src/lib/editor/languages.ts`, one lexer per
 *     language the workbench edits;
 *   • auto-indent, bracket and quote pairing, block tab, smart Home, and
 *     comment toggling from `src/lib/editor/edits.ts` (pure, unit-tested);
 *   • completions drawn from the language's own vocabulary plus identifiers
 *     already in the buffer — lexical, never invented, and labelled as such in
 *     the popup so nobody mistakes the list for a model's guess;
 *   • a ghost suggestion at the caret, accepted with the same Tab;
 *   • a find bar that marks every match, walks them and can replace them;
 *   • a gutter with line numbers, an active line, bracket-pair marking and an
 *     Ln/Col readout.
 *
 * Only the lines in view are rendered, so a multi-thousand-line deck scrolls as
 * cheaply as a ten-line one.
 */
import { forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useImperativeHandle } from 'react'
import { ArrowDown, ArrowUp, CaseSensitive, Replace, Search, X } from 'lucide-react'
import { Button } from '../ui/button'
import { cn } from '../../lib/utils'
import {
  LANGUAGE_SPECS,
  commonPrefix,
  completionVocabulary,
  rankCompletions,
  tokenizeLines,
  type LanguageId,
  type Segment,
  type TokenKind,
} from '../../lib/editor/languages'
import {
  BRACKET_PAIRS,
  applyCompletion,
  backspacePair,
  findMatches,
  indentSelection,
  insertNewline,
  lineStartOf,
  matchingBracket,
  outdentSelection,
  positionOf,
  replaceRange,
  toggleLineComment,
  wordPrefixAt,
  wrapQuotes,
  type CursorState,
} from '../../lib/editor/edits'
import { decorateLine, decorationsForLine, type Decoration } from '../../lib/editor/pieces'
import { usePreferenceValue } from '../../lib/settings/usePreference'

/**
 * The base pair must match `.code-metrics` in index.css: the geometry below
 * derives from it. The font size is a setting, so the line height is its
 * multiple — the backdrop rows, the gutter and the textarea all take the same
 * number, and the CSS takes it as a custom property from the frame.
 */
const BASE_FONT_SIZE = 12
const LINE_HEIGHT_RATIO = 20 / BASE_FONT_SIZE
const lineHeightFor = (fontSize: number) => Math.round(fontSize * LINE_HEIGHT_RATIO)
const PADDING_X = 8
const PADDING_Y = 8
const GUTTER_WIDTH = 48
const OVERSCAN = 6
const POPUP_HEIGHT = 180
const POPUP_WIDTH = 256

const OPENERS = new Set(Object.keys(BRACKET_PAIRS).filter(key => BRACKET_PAIRS[key] !== key))
const CLOSERS = new Set(Object.values(BRACKET_PAIRS))

interface CompletionState {
  from: number
  prefix: string
  items: string[]
  active: number
}

interface FindState {
  query: string
  caseSensitive: boolean
  index: number
}

export interface CodeEditorProps {
  value: string
  onChange: (value: string) => void
  language: LanguageId
  /** Accessible name of the buffer, e.g. "SPICE deck". */
  ariaLabel: string
  placeholder?: string
  /** Classes on the editor frame. */
  className?: string
  /** Classes on the scrolling code area (background, border). */
  bodyClassName?: string
  lineNumbers?: boolean
  status?: boolean
  readOnly?: boolean
  spellCheck?: boolean
  autoFocus?: boolean
  id?: string
  dataTour?: string
  onBlur?: () => void
  /** Runs before the editor's own handling; call preventDefault to win. */
  onKeyDown?: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void
}

/**
 * What a host panel can ask the editor to do without owning its caret.
 *
 * The library dock and the agent both drop or generate text that belongs where
 * the cursor is, not at the end of the buffer, so the editor takes the request
 * and applies it through its own commit path — same undo, same selection, same
 * completion dismissal as typing would.
 */
export interface CodeEditorHandle {
  /** Replace the selection (or insert at the caret) and focus the buffer. */
  insertAtCaret: (text: string) => void
  focus: () => void
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const wrapIndex = (value: number, length: number) => (length <= 0 ? 0 : (value + length) % length)

const TOKEN_CLASS: Record<Exclude<TokenKind, 'identifier'>, string> = {
  keyword: 'text-syntax-keyword',
  type: 'text-syntax-type',
  string: 'text-syntax-string',
  number: 'text-syntax-number',
  comment: 'text-syntax-comment italic',
  operator: 'text-syntax-operator',
  preprocessor: 'text-syntax-preproc',
  builtin: 'text-syntax-builtin',
}

const tokenClass = (kind: TokenKind | null): string | undefined =>
  kind === null || kind === 'identifier' ? undefined : TOKEN_CLASS[kind]

export const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(function CodeEditor({
  value,
  onChange,
  language,
  ariaLabel,
  placeholder,
  className,
  bodyClassName,
  lineNumbers,
  status = true,
  readOnly = false,
  spellCheck = false,
  autoFocus,
  id,
  dataTour,
  onBlur,
  onKeyDown,
}: CodeEditorProps, ref) {
  /*
   * Typing aids are preferences, not per-call decisions: a buffer in the firmware
   * panel and a deck in the simulation panel behave the same way, because the
   * user asked them to. A host can still force the gutter off for a one-line
   * field, which is why `lineNumbers` overrides the preference when given.
   */
  const fontSize = usePreferenceValue('editorFontSize')
  const suggestionsEnabled = usePreferenceValue('editorSuggestions')
  const autoCloseBrackets = usePreferenceValue('editorAutoCloseBrackets')
  const autoIndent = usePreferenceValue('editorAutoIndent')
  const gutterFromPreference = usePreferenceValue('editorLineNumbers')
  const activeLineHighlight = usePreferenceValue('editorActiveLine')
  const showGutter = lineNumbers ?? gutterFromPreference
  const LINE_HEIGHT = lineHeightFor(fontSize)
  const spec = LANGUAGE_SPECS[language]
  const tabSize = usePreferenceValue('editorTabSize')
  /*
   * The indent unit is the one thing the language table gets to say about
   * typing, and it is the user's call, not the grammar's: a SPICE deck and a
   * Verilog module both want whatever the person editing them uses. Overriding
   * here rather than in `languages.ts` keeps the tables pure data that the
   * tokenizer tests can pin.
   */
  const specWithIndent = useMemo(() => ({ ...spec, tabText: ' '.repeat(tabSize) }), [spec, tabSize])
  const listId = id ? `${id}-completions` : `${ariaLabel.replace(/[^a-zA-Z0-9]+/g, '')}-completions`
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLSpanElement>(null)
  const charWidth = useRef(7.2)
  /** Selection the controlled value restores after React commits. */
  const pendingSelection = useRef<{ start: number; end: number } | null>(null)

  const [caret, setCaret] = useState({ start: 0, end: 0 })
  const [scroll, setScroll] = useState({ top: 0, left: 0 })
  const [viewport, setViewport] = useState({ width: 640, height: 240 })
  const [completion, setCompletion] = useState<CompletionState | null>(null)
  const [ghost, setGhost] = useState<string | null>(null)
  const [find, setFind] = useState<FindState | null>(null)

  const lines = useMemo(() => value.split('\n'), [value])
  const tokenLines = useMemo(() => tokenizeLines(value, spec), [value, spec])
  const vocabulary = useMemo(() => completionVocabulary(spec, value), [spec, value])

  const lineStarts = useMemo(() => {
    const offsets: number[] = [0]
    for (let index = 1; index < lines.length; index += 1) offsets.push(offsets[index - 1] + lines[index - 1].length + 1)
    return offsets
  }, [lines])

  const caretLine = useMemo(() => {
    let index = 0
    while (index + 1 < lineStarts.length && lineStarts[index + 1] <= caret.start) index += 1
    return index
  }, [caret.start, lineStarts])

  const matches = useMemo(
    () => (find && find.query ? findMatches(value, find.query, find.caseSensitive) : []),
    [value, find],
  )
  const activeOffset = matches.length > 0 ? matches[clamp(find?.index ?? 0, 0, matches.length - 1)] : -1

  const bracketPair = useMemo(() => {
    if (readOnly || caret.start !== caret.end) return null
    const anchor = caret.start > 0 && /[)\]}]/.test(value[caret.start]) ? caret.start - 1 : caret.start
    const mate = matchingBracket(value, anchor)
    return mate === null || mate === anchor ? null : [anchor, mate]
  }, [value, caret.start, caret.end, readOnly])

  /* ── Which lines to paint ────────────────────────────────────────────────── */
  const firstLine = Math.max(0, Math.floor(scroll.top / LINE_HEIGHT) - OVERSCAN)
  const lastLine = Math.min(lines.length - 1, firstLine + Math.ceil(viewport.height / LINE_HEIGHT) + OVERSCAN * 2)

  const readScroll = useCallback(() => {
    const node = textareaRef.current
    if (!node) return
    setScroll(current => (current.top === node.scrollTop && current.left === node.scrollLeft
      ? current
      : { top: node.scrollTop, left: node.scrollLeft }))
  }, [])

  useEffect(() => {
    const node = frameRef.current
    if (!node) return
    const measure = () => setViewport(current => (current.width === node.clientWidth && current.height === node.clientHeight
      ? current
      : { width: node.clientWidth, height: node.clientHeight }))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const node = textareaRef.current
    if (!node || !pendingSelection.current) return
    const { start, end } = pendingSelection.current
    pendingSelection.current = null
    node.selectionStart = start
    node.selectionEnd = end
    setCaret({ start, end })
  }, [value])

  useEffect(() => {
    const probe = measureRef.current
    if (!probe) return
    const width = probe.getBoundingClientRect().width
    if (width > 0) charWidth.current = width / 8
  }, [viewport.width])

  const commit = useCallback((next: CursorState) => {
    pendingSelection.current = { start: next.start, end: next.end }
    onChange(next.value)
  }, [onChange])

  const updateCaret = useCallback(() => {
    const node = textareaRef.current
    if (!node) return
    setCaret({ start: node.selectionStart, end: node.selectionEnd })
  }, [])

  const closeCompletion = useCallback(() => {
    setCompletion(current => (current === null ? current : null))
    setGhost(current => (current === null ? current : null))
  }, [])

  /* ── Completions ─────────────────────────────────────────────────────────── */
  const refreshCompletions = useCallback((nextValue: string, caretStart: number) => {
    // Off means nothing appears at the caret that the user did not type.
    if (readOnly || !suggestionsEnabled) {
      closeCompletion()
      return
    }
    const { prefix, start } = wordPrefixAt(nextValue, caretStart)
    if (prefix.length < 2 || !/^[A-Za-z_$.]/.test(prefix)) {
      closeCompletion()
      return
    }
    const items = rankCompletions(prefix, vocabulary)
    if (items.length === 0) {
      closeCompletion()
      return
    }
    const best = items[0]
    setCompletion({ from: start, prefix, items, active: 0 })
    setGhost(best.length > prefix.length ? best.slice(prefix.length) : null)
  }, [closeCompletion, readOnly, suggestionsEnabled, vocabulary])

  const acceptCompletion = useCallback((word: string, from: number) => {
    const node = textareaRef.current
    if (!node) return
    const state: CursorState = { value, start: node.selectionStart, end: node.selectionEnd }
    closeCompletion()
    commit(applyCompletion(state, word, from))
  }, [closeCompletion, commit, value])

  const activeItem = completion ? completion.items[clamp(completion.active, 0, completion.items.length - 1)] : null

  /* ── Find ────────────────────────────────────────────────────────────────── */
  const openFind = useCallback(() => {
    const node = textareaRef.current
    const selected = node ? value.slice(node.selectionStart, node.selectionEnd) : ''
    setFind({ query: !selected.includes('\n') && selected.length <= 80 ? selected : '', caseSensitive: false, index: 0 })
  }, [value])

  const focusEditor = useCallback(() => {
    const node = textareaRef.current
    if (node) node.focus({ preventScroll: true })
  }, [])

  const insertAtCaret = useCallback(
    (text: string) => {
      const node = textareaRef.current
      if (!node || readOnly || text === '') return
      const state: CursorState = { value, start: node.selectionStart, end: node.selectionEnd }
      closeCompletion()
      commit(replaceRange(state, state.start, state.end, text))
      focusEditor()
    },
    [closeCompletion, commit, focusEditor, readOnly, value],
  )

  useImperativeHandle(ref, () => ({ insertAtCaret, focus: focusEditor }), [insertAtCaret, focusEditor])

  const jumpToMatch = useCallback((delta: number, offsets: number[], length: number) => {
    if (offsets.length === 0 || !find) return
    const nextIndex = clamp(find.index + delta, 0, offsets.length - 1)
    const offset = offsets[nextIndex]
    setFind({ ...find, index: nextIndex })
    const node = textareaRef.current
    if (!node) return
    const wasFocused = document.activeElement === node
    if (!wasFocused) focusEditor()
    node.setSelectionRange(offset, offset + length)
    node.scrollTop = Math.max(0, value.slice(0, offset).split('\n').length * LINE_HEIGHT - node.clientHeight / 2)
    readScroll()
    setCaret({ start: offset, end: offset + length })
    if (!wasFocused) frameRef.current?.querySelector<HTMLInputElement>('[data-find-input]')?.focus()
  }, [find, focusEditor, LINE_HEIGHT, readScroll, value])

  const replaceMatches = useCallback((query: string, replacement: string, all: boolean) => {
    if (!query) return
    const offsets = findMatches(value, query, find?.caseSensitive ?? false)
    if (offsets.length === 0) return
    const targets = all ? offsets : [offsets[clamp(find?.index ?? 0, 0, offsets.length - 1)]]
    let next = value
    for (let index = targets.length - 1; index >= 0; index -= 1) {
      const edited = replaceRange({ value: next, start: 0, end: 0 }, targets[index], targets[index] + query.length, replacement)
      next = edited.value
    }
    const shift = all ? (next.length - value.length) : 0
    commit({ value: next, start: clamp(caret.start + shift, 0, next.length), end: clamp(caret.start + shift, 0, next.length) })
    setFind(current => (current ? { ...current, index: 0 } : current))
  }, [caret.start, commit, find, value])

  /* ── Keyboard ────────────────────────────────────────────────────────────── */
  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    onKeyDown?.(event)
    if (event.defaultPrevented) return
    const node = event.currentTarget
    const state: CursorState = { value, start: node.selectionStart, end: node.selectionEnd }
    const mod = event.ctrlKey || event.metaKey

    if (mod && event.key.toLowerCase() === 'f') {
      event.preventDefault()
      openFind()
      return
    }
    if (mod && event.key === '/') {
      if (readOnly) return
      event.preventDefault()
      closeCompletion()
      commit(toggleLineComment(state, spec))
      return
    }
    if (event.key === 'Escape') {
      if (completion) {
        event.preventDefault()
        closeCompletion()
      } else if (find) {
        event.preventDefault()
        setFind(null)
      }
      return
    }
    if (mod) return

    switch (event.key) {
      case 'Tab': {
        // Escape closes the popup first, so Tab never strands a keyboard user.
        if (readOnly && !completion) return
        if (completion || ghost) event.preventDefault()
        if (completion && activeItem) {
          acceptCompletion(activeItem, completion.from)
          return
        }
        if (readOnly) return
        commit(event.shiftKey ? outdentSelection(state, specWithIndent) : indentSelection(state, specWithIndent))
        return
      }
      case 'Enter': {
        if (completion && activeItem) {
          event.preventDefault()
          acceptCompletion(activeItem, completion.from)
          return
        }
        if (find) {
          event.preventDefault()
          jumpToMatch(event.shiftKey ? -1 : 1, matches, find.query.length)
          return
        }
        if (readOnly) return
        event.preventDefault()
        closeCompletion()
        // With auto-indent off, Enter does exactly what a plain textarea does:
        // a newline and nothing else, no copied column, no extra step.
        commit(autoIndent ? insertNewline(state, specWithIndent) : replaceRange(state, state.start, state.end, '\n'))
        return
      }
      case 'Backspace': {
        if (readOnly) return
        const pair = autoCloseBrackets ? backspacePair(state, spec) : null
        if (pair) {
          event.preventDefault()
          closeCompletion()
          commit(pair)
        }
        return
      }
      case 'Home': {
        const start = lineStartOf(value, state.start)
        const line = value.slice(start, lineEnd(value, start))
        const indent = /^[ \t]*/.exec(line)![0].length
        const firstText = start + indent
        if (!indent || state.start <= start || state.start === firstText) return
        event.preventDefault()
        const to = event.shiftKey ? state.end : firstText
        node.setSelectionRange(firstText, to)
        setCaret({ start: firstText, end: to })
        return
      }
      case 'ArrowDown':
      case 'ArrowUp': {
        if (completion) {
          event.preventDefault()
          const step = event.key === 'ArrowDown' ? 1 : -1
          const active = wrapIndex(completion.active + step, completion.items.length)
          const word = completion.items[active]
          setCompletion({ ...completion, active })
          setGhost(word.length > completion.prefix.length ? word.slice(completion.prefix.length) : null)
          return
        }
        if (matches.length > 0) {
          event.preventDefault()
          jumpToMatch(event.key === 'ArrowDown' ? 1 : -1, matches, find!.query.length)
          return
        }
        return
      }
      case 'ArrowLeft':
      case 'ArrowRight':
        closeCompletion()
        return
      default:
        break
    }

    if (readOnly || event.key.length !== 1 || !autoCloseBrackets) return

    if (OPENERS.has(event.key) || spec.quotes.includes(event.key)) {
      event.preventDefault()
      const isQuote = spec.quotes.includes(event.key)
      commit(wrapQuotes(state, event.key, BRACKET_PAIRS[event.key] ?? event.key, !isQuote && state.start !== state.end))
      return
    }

    if (CLOSERS.has(event.key) && value[state.start] === event.key && state.start === state.end) {
      event.preventDefault()
      node.setSelectionRange(state.start + 1, state.start + 1)
      setCaret({ start: state.start + 1, end: state.start + 1 })
    }
  }

  /* ── Rendering ───────────────────────────────────────────────────────────── */
  const rows = useMemo(() => {
    const out: { index: number; pieces: ReturnType<typeof decorateLine> }[] = []
    for (let index = firstLine; index <= lastLine; index += 1) {
      const segments: Segment[] = tokenLines[index] ?? []
      const lineStart = lineStarts[index]
      const length = lines[index].length
      const decorations: Decoration[] = []

      if (matches.length > 0 && find) {
        decorations.push(...decorationsForLine(lineStart, length, matches, find.query.length, activeOffset))
      }
      if (bracketPair) {
        for (const offset of bracketPair) {
          if (offset < lineStart || offset > lineStart + length) continue
          const from = offset - lineStart
          if (from === length) continue
          decorations.push({ from, to: from + 1, className: 'code-bracket' })
        }
      }
      if (ghost && caret.start >= lineStart && caret.start <= lineStart + length) {
        decorations.push({ from: caret.start - lineStart, to: caret.start - lineStart, className: 'code-ghost', insert: ghost })
      }

      out.push({ index, pieces: decorateLine(segments, decorations) })
    }
    return out
  }, [activeOffset, bracketPair, caret.start, firstLine, find, ghost, lastLine, lineStarts, lines, matches, tokenLines])

  const position = positionOf(value, caret.start)
  const selectedCharacters = caret.end - caret.start
  const gutterPad = showGutter ? GUTTER_WIDTH : 0
  const caretColumn = caret.start - lineStarts[caretLine]
  const popupLeft = clamp(gutterPad + PADDING_X + caretColumn * charWidth.current - scroll.left, 4, Math.max(4, viewport.width - POPUP_WIDTH - 4))
  const below = PADDING_Y + (caretLine + 1) * LINE_HEIGHT - scroll.top
  const popupTop = below + POPUP_HEIGHT + 4 > viewport.height ? Math.max(4, below - POPUP_HEIGHT - LINE_HEIGHT) : below
  const shared = completion && completion.items.length > 1 ? commonPrefix(completion.items).slice(completion.prefix.length) : ''

  return (
    <div
      ref={frameRef}
      className={cn('code-frame relative flex min-h-0 flex-col overflow-hidden rounded-md border border-border bg-background', className)}
      data-editor-language={language}
      // The painted backdrop, the gutter and the transparent textarea all read
      // these two, so a font size from Settings moves the three of them together.
      style={{ '--cad-editor-font': `${fontSize}px`, '--cad-editor-line': `${LINE_HEIGHT}px` } as React.CSSProperties}
    >
      <span ref={measureRef} aria-hidden="true" className="code-metrics pointer-events-none absolute -top-[9999px] -left-[9999px]">
        00000000
      </span>

      {find && (
        <FindBar
          query={find.query}
          caseSensitive={find.caseSensitive}
          index={matches.length > 0 ? clamp(find.index, 0, matches.length - 1) + 1 : 0}
          total={matches.length}
          onQuery={next => setFind(current => (current ? { ...current, query: next, index: 0 } : current))}
          onCase={() => setFind(current => (current ? { ...current, caseSensitive: !current.caseSensitive, index: 0 } : current))}
          onPrevious={() => jumpToMatch(-1, matches, find.query.length)}
          onNext={() => jumpToMatch(1, matches, find.query.length)}
          onReplace={replacement => replaceMatches(find.query, replacement, false)}
          onReplaceAll={replacement => replaceMatches(find.query, replacement, true)}
          onClose={() => {
            setFind(null)
            focusEditor()
          }}
        />
      )}

      <div className={cn('relative min-h-0 flex-1 overflow-hidden', bodyClassName)}>
        {activeLineHighlight && (
          <div
            aria-hidden="true"
            className="code-active-line pointer-events-none absolute left-0 right-0"
            style={{ top: PADDING_Y + caretLine * LINE_HEIGHT - scroll.top, height: LINE_HEIGHT }}
          />
        )}

        {showGutter && (
          <div
            data-code-gutter
            className="pointer-events-none absolute bottom-0 left-0 top-0 z-10 w-12 overflow-hidden border-r border-border bg-canvas"
          >
            <div className="code-metrics absolute left-0 right-0 text-right tabular-nums" style={{ top: PADDING_Y - scroll.top }}>
              {rows.map(row => (
                <div
                  key={row.index}
                  className={cn('px-1.5 text-muted-foreground/70', row.index === caretLine && 'font-semibold text-foreground')}
                  style={{ height: LINE_HEIGHT }}
                >
                  {row.index + 1}
                </div>
              ))}
            </div>
          </div>
        )}

        <div aria-hidden="true" className="code-backdrop absolute bottom-0 top-0 overflow-hidden" style={{ left: gutterPad, right: 0 }}>
          <pre
            className="code-metrics absolute left-0 top-0 w-max min-w-full"
            style={{ transform: `translate3d(${-scroll.left}px, ${PADDING_Y - scroll.top}px, 0)` }}
          >
            {rows.map(row => (
              <div key={row.index} style={{ height: LINE_HEIGHT, paddingLeft: PADDING_X }} className="pr-6">
                {row.pieces.length === 0
                  ? <span>{' '}</span>
                  : row.pieces.map(piece => (
                    <span key={piece.key} className={piece.className ?? tokenClass(piece.kind)}>{piece.text}</span>
                  ))}
              </div>
            ))}
          </pre>
        </div>

        <textarea
          ref={textareaRef}
          id={id}
          data-tour={dataTour}
          aria-label={ariaLabel}
          aria-autocomplete="list"
          aria-expanded={completion ? true : undefined}
          aria-controls={completion ? listId : undefined}
          aria-haspopup={completion ? 'listbox' : undefined}
          aria-activedescendant={completion ? `${listId}-option-${completion.active}` : undefined}
          className={cn(
            // No text-colour utility may appear here: `text-*` lands in the
            // utilities layer and would beat `.code-input { color: transparent }`,
            // repainting the textarea's glyphs over the coloured backdrop.
            'code-input code-metrics scrollbar-thin absolute bottom-0 left-0 top-0 z-20 h-full w-full border-0 outline-none',
          )}
          // Both layers must put their first glyph in the same pixel, or the
          // caret and selection sit under the wrong coloured text. The backdrop
          // starts at `gutterPad` and indents each line by `PADDING_X`, so the
          // textarea takes the same total as padding — one source of truth, no
          // class-name arithmetic for the two sides to drift apart on.
          style={{ paddingLeft: gutterPad + PADDING_X, paddingRight: PADDING_X, paddingTop: PADDING_Y, paddingBottom: PADDING_Y }}
          value={value}
          placeholder={placeholder}
          readOnly={readOnly}
          spellCheck={spellCheck}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          wrap="off"
          rows={3}
          autoFocus={autoFocus}
          onChange={event => {
            const node = event.target
            if (node.value === value) return
            const { selectionStart, selectionEnd } = node
            pendingSelection.current = { start: selectionStart, end: selectionEnd }
            onChange(node.value)
            setCaret({ start: selectionStart, end: selectionEnd })
            refreshCompletions(node.value, selectionStart)
          }}
          onSelect={updateCaret}
          onClick={updateCaret}
          onKeyUp={event => {
            if (event.key.startsWith('Arrow') || event.key === 'Delete') updateCaret()
          }}
          onKeyDown={handleKeyDown}
          onFocus={updateCaret}
          onBlur={() => {
            closeCompletion()
            onBlur?.()
          }}
          onScroll={readScroll}
        />

        {completion && (
          <ul
            id={listId}
            role="listbox"
            aria-label={`${ariaLabel} completions`}
            className="absolute z-30 max-h-44 w-64 overflow-y-auto rounded-sm border border-border bg-popover py-1 font-mono text-xs shadow-lg scrollbar-thin"
            style={{ left: popupLeft, top: popupTop }}
            onMouseDown={event => event.preventDefault()}
          >
            <li role="presentation" className="px-2 pb-1 text-[11px] text-muted-foreground">
              {spec.label} words and names in this buffer
            </li>
            {completion.items.map((item, index) => (
              <li
                key={item}
                id={`${listId}-option-${index}`}
                role="option"
                aria-selected={index === completion.active}
                className={cn(
                  'flex cursor-pointer items-center gap-2 px-2 py-1',
                  index === completion.active ? 'bg-accent text-accent-foreground' : 'text-popover-foreground',
                )}
                onMouseEnter={() => {
                  setCompletion(current => (current ? { ...current, active: index } : current))
                  setGhost(item.length > completion.prefix.length ? item.slice(completion.prefix.length) : null)
                }}
                onClick={() => acceptCompletion(item, completion.from)}
              >
                <span className="truncate">
                  <span className="font-semibold">{item.slice(0, completion.prefix.length)}</span>
                  {item.slice(completion.prefix.length)}
                </span>
                {index === completion.active && <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">Tab</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {status && (
        <div className="flex flex-shrink-0 items-center gap-3 border-t border-border bg-canvas px-2 py-1 text-[10px] text-muted-foreground">
          <span className="tabular-nums">Ln {position.line + 1}, Col {position.column + 1}</span>
          {selectedCharacters > 0 && <span className="tabular-nums">{selectedCharacters} selected</span>}
          {matches.length > 0 && (
            <span className="tabular-nums">
              {clamp(find?.index ?? 0, 0, matches.length - 1) + 1} of {matches.length}
            </span>
          )}
          <span className="ml-auto flex min-w-0 items-center gap-3">
            {shared && <span className="truncate text-info">Tab adds {shared}</span>}
            {!shared && ghost && <span className="truncate text-info">Tab accepts {ghost}</span>}
            <span className="tabular-nums">{lines.length} lines</span>
            <span className="hidden sm:inline">{spec.label}</span>
          </span>
        </div>
      )}
    </div>
  )
})

function lineEnd(value: string, from: number): number {
  const index = value.indexOf('\n', from)
  return index === -1 ? value.length : index
}

interface FindBarProps {
  query: string
  caseSensitive: boolean
  index: number
  total: number
  onQuery: (query: string) => void
  onCase: () => void
  onPrevious: () => void
  onNext: () => void
  onReplace: (replacement: string) => void
  onReplaceAll: (replacement: string) => void
  onClose: () => void
}

function FindBar({
  query, caseSensitive, index, total, onQuery, onCase, onPrevious, onNext, onReplace, onReplaceAll, onClose,
}: FindBarProps) {
  const [replacement, setReplacement] = useState('')
  return (
    <div className="flex flex-shrink-0 flex-wrap items-center gap-1 border-b border-border bg-surface px-2 py-1.5">
      <label className="cad-search flex h-7 min-w-0 flex-1 items-center gap-2 rounded-sm border border-input bg-background px-2 sm:max-w-56">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">Find</span>
        <input
          data-find-input=""
          type="search"
          value={query}
          onChange={event => onQuery(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault()
              if (event.shiftKey) onPrevious()
              else onNext()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              onClose()
            }
          }}
          placeholder="Find…"
          aria-label="Find"
          className="min-w-0 flex-1 bg-transparent text-xs outline-none"
        />
        <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground" aria-hidden="true">
          {query ? (total > 0 ? `${index}/${total}` : 'no match') : ''}
        </span>
      </label>
      <label className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-sm border border-input bg-background px-2 sm:max-w-56">
        <Replace className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">Replace with</span>
        <input
          type="text"
          value={replacement}
          onChange={event => setReplacement(event.target.value)}
          placeholder="Replace…"
          aria-label="Replace with"
          className="min-w-0 flex-1 bg-transparent text-xs outline-none"
        />
      </label>
      <Button
        variant={caseSensitive ? 'default' : 'ghost'}
        size="icon"
        className="h-7 w-7"
        onClick={onCase}
        aria-label={caseSensitive ? 'Matching case' : 'Ignoring case'}
        aria-pressed={caseSensitive}
        title="Match upper and lower case exactly, or ignore it.">
        <CaseSensitive className="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onPrevious} aria-label="Previous match" disabled={total === 0} title="Jump to the match above the cursor.">
        <ArrowUp className="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onNext} aria-label="Next match" disabled={total === 0} title="Jump to the match below the cursor.">
        <ArrowDown className="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onReplace(replacement)} aria-label="Replace match" disabled={total === 0} title="Replace the current match with the text in the replace box.">
        <Replace className="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => onReplaceAll(replacement)} disabled={total === 0}>
        Replace all
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={onClose} aria-label="Close find bar" title="Close the find bar; the file is left as it is.">
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

export default CodeEditor
