/**
 * The one sentence a drop zone says out loud.
 *
 * A refused drop used to vanish silently, which left the user guessing whether
 * the app was broken or the row was wrong. This states the reason instead, and
 * while a row is armed it names the row and offers a keyboard-reachable way to
 * spend it. Both branches are `role="status"`, so a screen reader hears them
 * without the focus leaving the workspace.
 */
import { Button } from '../ui/button'
import { cn } from '../../lib/utils'
import { useAppStore } from '../../stores/useAppStore'
import type { LibraryZone } from '../../lib/library/dropZone'

interface LibraryDropNoteProps {
  zone: LibraryZone
  /** The surface in the sentence, e.g. `the viewport`. */
  surface: string
  /** Where the panel pins it — a viewport floats, a card sits in the flow. */
  className?: string
}

export default function LibraryDropNote({ zone, surface, className }: LibraryDropNoteProps) {
  const armed = useAppStore((state) => state.armedLibraryItem)

  if (zone.refusal) {
    return (
      <p role="status" aria-live="polite" className={cn('cad-drop-note cad-drop-note--refuse', className)}>
        <span className="min-w-0 truncate">{zone.refusal}</span>
      </p>
    )
  }

  if (!zone.pendingActive || !armed) return null

  return (
    <p role="status" aria-live="polite" className={cn('cad-drop-note', className)}>
      <span className="min-w-0 truncate">
        Armed <span className="font-semibold text-foreground">{armed.name}</span> — drop it on {surface} or place it
        here.
      </span>
      <Button
        type="button"
        size="sm"
        variant="default"
        className="h-6 flex-shrink-0 px-2 text-[11px]"
        onClick={zone.placePending}
      >
        Place
      </Button>
    </p>
  )
}
