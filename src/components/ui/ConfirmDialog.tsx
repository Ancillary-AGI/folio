import { useRef } from 'react'
import { AlertTriangle, HelpCircle } from 'lucide-react'
import DialogShell from './DialogShell'
import { Button } from './button'
import type { ConfirmSpec } from './useConfirm'

interface ConfirmDialogProps {
  /** The open question; null renders nothing. */
  spec: ConfirmSpec | null
  /** Settles it. Escape, the backdrop and Cancel all answer `false`. */
  onResolve: (accepted: boolean) => void
}

/**
 * The app's own version of the browser's confirm box.
 *
 * `window.confirm()` was used for four irreversible actions — deleting a project,
 * restoring a commit or a backup, and replacing an unsaved sheet with a demo. It
 * works, but it is the operating system's dialog, not this product's: it cannot
 * state the consequence in more than a line, it cannot be styled, it cannot be
 * tested, and while it is up it freezes the page. This panel says what is lost
 * and what is kept, and names both buttons with the verb they perform.
 *
 * The cancel button takes focus, not the action button. Every question here
 * precedes something hard to undo, so the keyboard's default has to be the safe
 * answer; the action is still one keypress away (Tab, then Enter).
 */
export default function ConfirmDialog({ spec, onResolve }: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  if (!spec) return null

  return (
    <DialogShell
      onClose={() => onResolve(false)}
      labelledBy="confirm-title"
      describedBy="confirm-detail"
      initialFocus={cancelRef}
      className="max-w-lg"
    >
      <div className="app-panel-header flex-shrink-0">
        <span
          className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md ${
            spec.destructive ? 'bg-destructive/15 text-destructive' : 'bg-primary/15 text-primary'
          }`}
          aria-hidden="true"
        >
          {spec.destructive ? <AlertTriangle className="h-4 w-4" /> : <HelpCircle className="h-4 w-4" />}
        </span>
        <h2 id="confirm-title" className="min-w-0 flex-1 text-sm font-semibold">
          {spec.title}
        </h2>
      </div>

      <p id="confirm-detail" className="px-4 py-4 text-[13px] leading-relaxed text-muted-foreground">
        {spec.detail}
      </p>

      {/* One grid, one height: the two answers are always the same size, so
          neither reads as the default. */}
      <div className="cad-footer-row justify-end">
        <div className="cad-action-pair">
          <Button ref={cancelRef} variant="outline" onClick={() => onResolve(false)}>
            {spec.cancelLabel ?? 'Cancel'}
          </Button>
          <Button variant={spec.destructive ? 'destructive' : 'default'} onClick={() => onResolve(true)}>
            {spec.confirmLabel}
          </Button>
        </div>
      </div>
    </DialogShell>
  )
}
