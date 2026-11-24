/**
 * The operator's rich-text editor.
 *
 * A contentEditable surface with a formatting toolbar, not a Markdown box. The
 * field is deliberately uncontrolled: React renders it once and the DOM is the
 * draft while the operator types. The save button reads the DOM back through
 * `serializeRichTextDom`, so no keystroke can be lost to a React re-render and
 * the editor can never write raw HTML to the database.
 *
 * Pasting is reduced to plain text. That is a deliberate limit: an operator can
 * format with the toolbar, and a paste from a word processor cannot smuggle a
 * tag, a stylesheet or a script into the stored document.
 */
import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { Bold, Code, Italic, Link as LinkIcon, List, ListOrdered, Pilcrow, Quote, Redo2, RotateCcw, Strikethrough, Underline, Undo2 } from 'lucide-react'
import {
  normalizeRichText, richTextHasText, richTextToHtml, safeRichTextHref,
  serializeRichTextDom, type RichTextBlock,
} from '../lib/legal/richText'
import HoverHelp from '../components/ui/HoverHelp'
import RichText from '../components/legal/RichText'

export interface RichTextEditorHandle {
  /** Read what is on screen. Returns the normalised document model. */
  read: () => RichTextBlock[]
}

interface RichTextEditorProps {
  id: string
  label: string
  value: RichTextBlock[]
  disabled?: boolean
  hint?: string
}

type Command =
  | { kind: 'exec'; command: string; argument?: string }
  | { kind: 'link' }
  | { kind: 'unlink' }

const TOOLBAR: Array<{ label: string; title: string; description: string; icon: typeof Bold; action: Command }> = [
  { label: 'Bold', title: 'Bold (Ctrl+B)', description: 'Make the selected text bold.', icon: Bold, action: { kind: 'exec', command: 'bold' } },
  { label: 'Italic', title: 'Italic (Ctrl+I)', description: 'Slant the selected text.', icon: Italic, action: { kind: 'exec', command: 'italic' } },
  { label: 'Underline', title: 'Underline (Ctrl+U)', description: 'Underline the selected text.', icon: Underline, action: { kind: 'exec', command: 'underline' } },
  { label: 'Strikethrough', title: 'Strikethrough', description: 'Draw a line through the selected text.', icon: Strikethrough, action: { kind: 'exec', command: 'strikeThrough' } },
  { label: 'Inline code', title: 'Inline code', description: 'Mark the selected text as code.', icon: Code, action: { kind: 'exec', command: 'insertHTML' } },
  { label: 'Paragraph', title: 'Paragraph', description: 'Turn the current block into body text.', icon: Pilcrow, action: { kind: 'exec', command: 'formatBlock', argument: '<p>' } },
  { label: 'Heading 2', title: 'Heading 2', description: 'Turn the current block into a section heading.', icon: Pilcrow, action: { kind: 'exec', command: 'formatBlock', argument: '<h2>' } },
  { label: 'Heading 3', title: 'Heading 3', description: 'Turn the current block into a subheading.', icon: Pilcrow, action: { kind: 'exec', command: 'formatBlock', argument: '<h3>' } },
  { label: 'Quote', title: 'Quote', description: 'Turn the current block into a block quote.', icon: Quote, action: { kind: 'exec', command: 'formatBlock', argument: '<blockquote>' } },
  { label: 'Bulleted list', title: 'Bulleted list', description: 'Start a bulleted list.', icon: List, action: { kind: 'exec', command: 'insertUnorderedList' } },
  { label: 'Numbered list', title: 'Numbered list', description: 'Start a numbered list.', icon: ListOrdered, action: { kind: 'exec', command: 'insertOrderedList' } },
  { label: 'Undo', title: 'Undo (Ctrl+Z)', description: 'Undo the last change in this editor.', icon: Undo2, action: { kind: 'exec', command: 'undo' } },
  { label: 'Redo', title: 'Redo (Ctrl+Shift+Z)', description: 'Redo the last undone change.', icon: Redo2, action: { kind: 'exec', command: 'redo' } },
  { label: 'Clear formatting', title: 'Clear formatting', description: 'Remove bold, italic, links and other inline marks.', icon: RotateCcw, action: { kind: 'exec', command: 'removeFormat' } },
]

const COMMAND_GROUPS: number[][] = [
  [0, 1, 2, 3, 4, 13],
  [5, 6, 7, 8],
  [9, 10],
  [11, 12],
]

function setSelection(range: Range): void {
  const selection = window.getSelection()
  if (!selection) return
  selection.removeAllRanges()
  selection.addRange(range)
}

const RichTextEditor = forwardRef<RichTextEditorHandle, RichTextEditorProps>(function RichTextEditor(
  { id, label, value, disabled = false, hint },
  ref,
) {
  const editorRef = useRef<HTMLDivElement>(null)
  const savedRange = useRef<Range | null>(null)
  const [linkHref, setLinkHref] = useState('')
  const [message, setMessage] = useState('')
  const [preview, setPreview] = useState<RichTextBlock[]>(() => normalizeRichText(value))
  const [showPreview, setShowPreview] = useState(false)

  const initialHtml = useMemo(() => richTextToHtml(normalizeRichText(value)), [value])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    editor.innerHTML = initialHtml
    setPreview(normalizeRichText(value))
    // The editor is keyed by page/section by its caller; this effect is the
    // single moment its initial document is written.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialHtml])

  const read = useCallback((): RichTextBlock[] => {
    const editor = editorRef.current
    if (!editor) return []
    return serializeRichTextDom(editor)
  }, [])

  useImperativeHandle(ref, () => ({ read }), [read])

  const rememberSelection = useCallback(() => {
    const editor = editorRef.current
    const selection = window.getSelection()
    if (!editor || !selection || selection.rangeCount === 0) return
    const anchor = selection.anchorNode
    if (anchor && editor.contains(anchor)) {
      savedRange.current = selection.getRangeAt(0).cloneRange()
    }
  }, [])

  useEffect(() => {
    document.addEventListener('selectionchange', rememberSelection)
    return () => document.removeEventListener('selectionchange', rememberSelection)
  }, [rememberSelection])

  const refresh = useCallback(() => {
    const blocks = read()
    setPreview(blocks)
    return blocks
  }, [read])

  const insertInlineCode = useCallback(() => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return
    const range = selection.getRangeAt(0)
    if (range.collapsed) return
    const code = document.createElement('code')
    try {
      code.appendChild(range.extractContents())
      range.insertNode(code)
    } catch {
      return
    }
    const next = document.createRange()
    next.selectNodeContents(code)
    setSelection(next)
  }, [])

  const runExec = useCallback((command: string, argument?: string) => {
    if (disabled) return
    if (command === 'insertHTML') {
      insertInlineCode()
    } else if (typeof document.execCommand === 'function') {
      document.execCommand(command, false, argument)
    }
    editorRef.current?.focus()
    refresh()
  }, [disabled, insertInlineCode, refresh])

  const addLink = useCallback(() => {
    if (disabled) return
    const href = safeRichTextHref(linkHref)
    if (!href) {
      setMessage('Links must start with https://, http:// or mailto:.')
      return
    }
    const editor = editorRef.current
    const range = savedRange.current
    if (!editor || !range) {
      setMessage('Select the text to link first.')
      return
    }
    setSelection(range)
    if (range.collapsed) {
      const anchor = document.createElement('a')
      anchor.href = href
      anchor.textContent = href
      anchor.rel = 'noopener noreferrer'
      range.insertNode(anchor)
      const next = document.createRange()
      next.setStartAfter(anchor)
      next.collapse(true)
      setSelection(next)
    } else if (typeof document.execCommand === 'function') {
      document.execCommand('createLink', false, href)
    }
    editor.focus()
    setLinkHref('')
    setMessage('')
    refresh()
  }, [disabled, linkHref, refresh])

  const unlink = useCallback(() => {
    if (disabled) return
    if (savedRange.current) setSelection(savedRange.current)
    if (typeof document.execCommand === 'function') {
      document.execCommand('unlink')
    }
    editorRef.current?.focus()
    refresh()
  }, [disabled, refresh])

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    /* Enter inside a heading should continue as body text, not as another
       heading; the browser's default would keep the block type. */
    if (event.key === 'Enter' && !event.shiftKey) {
      const selection = window.getSelection()
      const node = selection?.anchorNode?.parentElement
      const heading = node?.closest('h1,h2,h3,h4,h5,h6')
      if (heading && editorRef.current?.contains(heading)) {
        event.preventDefault()
        if (typeof document.execCommand === 'function') {
          document.execCommand('formatBlock', false, '<p>')
          document.execCommand('insertParagraph')
        }
        refresh()
      }
    }
  }

  return (
    <div className="space-y-2">
      <div
        role="toolbar"
        aria-label={`${label} formatting`}
        className="flex flex-wrap items-center gap-1 rounded-md border border-border bg-muted/40 p-1"
      >
        {COMMAND_GROUPS.map((group, groupIndex) => (
          <div key={groupIndex} className="flex items-center gap-1 border-r border-border pr-1 last:border-r-0 last:pr-0">
            {group.map((index) => {
              const item = TOOLBAR[index]
              const Icon = item.icon
              return (
                <HoverHelp key={item.label} title={item.title} description={item.description}>
                  <button
                    type="button"
                    aria-label={item.title}
                    disabled={disabled}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      if (item.action.kind === 'exec') runExec(item.action.command, item.action.argument)
                    }}
                    className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </HoverHelp>
              )
            })}
            {groupIndex === 2 && (
              <>
                <HoverHelp
                  title="Add link"
                  description="Turn the selected text into a link to an http(s) or mailto address."
                >
                  <button
                    type="button"
                    aria-label="Add link"
                    disabled={disabled}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={addLink}
                    className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
                  >
                    <LinkIcon className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </HoverHelp>
                <button
                  type="button"
                  title="Remove link"
                  aria-label="Remove link"
                  disabled={disabled}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={unlink}
                  className="inline-flex h-7 px-1.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
                >
                  Unlink
                </button>
              </>
            )}
          </div>
        ))}
        <button
          type="button"
          aria-pressed={showPreview}
          onClick={() => setShowPreview((current) => !current)}
          className="ml-auto inline-flex h-7 items-center rounded px-2 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {showPreview ? 'Hide preview' : 'Preview'}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`${id}-link`} className="text-[11px] text-muted-foreground">Link target</label>
        <input
          id={`${id}-link`}
          value={linkHref}
          onChange={(event) => setLinkHref(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              addLink()
            }
          }}
          placeholder="https://… or mailto:…"
          inputMode="url"
          className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          disabled={disabled}
        />
      </div>

      <div
        id={id}
        ref={editorRef}
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        aria-describedby={`${id}-hint`}
        contentEditable={!disabled}
        suppressContentEditableWarning
        onInput={() => { void refresh() }}
        onKeyUp={rememberSelection}
        onMouseUp={rememberSelection}
        onBlur={rememberSelection}
        onKeyDown={onKeyDown}
        onPaste={(event) => {
          const plain = event.clipboardData.getData('text/plain')
          if (!plain) return
          event.preventDefault()
          if (typeof document.execCommand === 'function') {
            document.execCommand('insertText', false, plain)
          }
          refresh()
        }}
        className="legal-rich-editor min-h-[9rem] rounded-md border border-input bg-background px-3 py-2 text-sm leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{ whiteSpace: 'pre-wrap' }}
      />

      <p id={`${id}-hint`} className="text-[11px] text-muted-foreground">
        {hint ?? 'Select text to format it. Pasting is inserted as plain text.'}
        {!richTextHasText(preview) && ' The section is empty until you write something.'}
      </p>
      {message && <p className="text-[11px] text-destructive">{message}</p>}

      {showPreview && (
        <div className="rounded-md border border-border bg-background p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Preview</p>
          {richTextHasText(preview)
            ? <RichText blocks={preview} />
            : <p className="text-xs text-muted-foreground">Nothing to preview yet.</p>}
        </div>
      )}
    </div>
  )
})

export default RichTextEditor
