/**
 * A project's name, edited where it is read.
 *
 * The name of the thing you are working on is the one label in this app that is
 * pure user data, so it is edited in place: click it, type, click away or press
 * Enter and the write happens; Escape puts the old name back. Two surfaces show a
 * project name — the workspace header and the launcher's cards — and both use this
 * same gesture, which is why the write is handed in rather than duplicated: this
 * file owns the gesture, the caller owns where the name is stored.
 *
 * A failed write does not silently restore the old title. The reason stays visible
 * under the field, because the alternative is a name that looks saved and is not.
 */
import { useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { Pencil } from 'lucide-react'
import { cn } from '../lib/utils'

interface EditableProjectTitleProps {
  /** The name the caller holds for this project. */
  name: string
  /** Writes the new name. Rejects with the reason when the write fails. */
  onRename: (nextName: string) => Promise<void>
  /** The heading the name sits in: `<h1>` in the shell header, `<h3>` on a card. */
  headingLevel?: 'h1' | 'h3'
  /** A name in a surface that opens on click is renamed, not opened. */
  stopClickPropagation?: boolean
  inputClassName?: string
  titleClassName?: string
}

export default function EditableProjectTitle({
  name,
  onRename,
  headingLevel = 'h1',
  stopClickPropagation = false,
  inputClassName = '',
  titleClassName = '',
}: EditableProjectTitleProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const [error, setError] = useState<string | null>(null)
  /*
   * Enter commits and then the field loses focus, so blur would commit a second
   * time. The phase says which gesture is currently allowed to write; a click
   * outside an unchanged field is not a write at all.
   */
  const phase = useRef<'idle' | 'editing' | 'committing'>('idle')

  const start = () => {
    phase.current = 'editing'
    setDraft(name)
    setError(null)
    setEditing(true)
  }

  const stop = () => {
    phase.current = 'idle'
    setEditing(false)
    setDraft(name)
  }

  const commit = async () => {
    if (phase.current !== 'editing') return
    phase.current = 'committing'
    const next = draft.trim()
    if (next === '' || next === name) {
      stop()
      setError(next === '' ? 'A project needs a name, so this one kept the old one.' : null)
      return
    }
    try {
      await onRename(next)
      phase.current = 'idle'
      setEditing(false)
      setError(null)
    } catch (reason) {
      phase.current = 'idle'
      setEditing(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const Heading = headingLevel

  /*
   * One heading whether the name is being read or typed: the project title is a
   * document outline entry, and swapping it for a bare input mid-edit would move
   * the outline a screen reader is holding.
   *
   * The guard is on the heading, not on the button that starts the edit, because
   * the name owns the click for as long as it is being typed. Guarding only the
   * resting button let the *second* click — inside the open field — reach the
   * card underneath and open the project, which is the moment the rename was
   * supposed to happen.
   */
  return (
    <Heading
      className="min-w-0"
      onClick={stopClickPropagation ? (event: ReactMouseEvent) => event.stopPropagation() : undefined}
    >
      {editing ? (
        <input
          type="text"
          autoFocus
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
            setError(null)
          }}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={() => {
            void commit()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              stop()
              return
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              void commit()
            }
          }}
          aria-label={`New name for ${name}`}
          aria-invalid={error !== null}
          className={cn(
            'h-6 w-full min-w-0 max-w-[34ch] truncate rounded-md border border-primary bg-background px-2 text-[13px] font-semibold leading-tight text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring',
            inputClassName,
          )}
        />
      ) : (
        <button
          type="button"
          onClick={start}
          /*
           * The name is the control, so it is laid out as a name: left-aligned,
           * never centred by the shared button geometry, and with an edit mark that
           * appears only when the pointer or the caret is on it.
           */
          className={cn(
            'editable-title group inline-flex max-w-full items-center gap-1.5 rounded-sm text-left leading-tight text-foreground outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring',
            titleClassName,
          )}
          title={`Rename this project — currently “${name}”. Enter saves, Escape cancels, clicking away saves.`}
          aria-label={`Rename ${name}`}
        >
          <span className="min-w-0 truncate">{name}</span>
          <Pencil
            aria-hidden="true"
            className="editable-title__mark h-3.5 w-3.5 flex-shrink-0 text-primary"
          />
        </button>
      )}
      {error && (
        <p role="alert" className="truncate text-[11px] leading-tight text-destructive">
          {error}
        </p>
      )}
    </Heading>
  )
}
