import { useEffect, useRef, useState } from 'react'
import { Eye, EyeOff, Lock } from 'lucide-react'
import DialogShell from './DialogShell'
import { Button } from './button'
import type { SecretRequest } from './useSecretPrompt'

interface SecretDialogProps {
  /** The open request; null renders nothing. */
  request: SecretRequest | null
  /** Settles the question with what was typed, or `null` when declined. */
  onResolve: (value: string | null) => void
}

/**
 * A passphrase asked for in the app, not in a browser box.
 *
 * `window.prompt()` was used for the encrypted export, which is the worst place
 * for it: the box echoes the secret in plain text on screen, its chrome belongs
 * to the operating system rather than to this product, and it cannot say what
 * losing the passphrase actually means. This panel masks the field, lets the
 * person check what they typed without leaving it visible to anyone looking at
 * the screen, and states the consequence and the rule before they commit.
 *
 * The value lives only in this component's state, and the component mounts for
 * one question at a time — so nothing typed here outlives the answer.
 */
export default function SecretDialog({ request, onResolve }: SecretDialogProps) {
  const [value, setValue] = useState('')
  const [revealed, setRevealed] = useState(false)
  const fieldRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // A new question is a new secret: the previous one must not still be sitting
    // in the field for the next export to seal with.
    setValue('')
    setRevealed(false)
  }, [request])

  if (!request) return null

  const enough = value.trim().length >= (request.minLength ?? 1)

  return (
    <DialogShell
      onClose={() => onResolve(null)}
      labelledBy="secret-title"
      describedBy="secret-detail"
      initialFocus={fieldRef}
      className="max-w-md"
    >
      <div className="app-panel-header flex-shrink-0">
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary" aria-hidden="true">
          <Lock className="h-4 w-4" />
        </span>
        <h2 id="secret-title" className="min-w-0 flex-1 text-sm font-semibold">
          {request.title}
        </h2>
      </div>

      <div className="flex flex-col gap-3 px-4 py-4">
        <p id="secret-detail" className="text-[13px] leading-relaxed text-muted-foreground">
          {request.detail}
        </p>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="secret-field" className="text-xs font-medium text-foreground">
            {request.fieldLabel}
          </label>
          <div className="flex items-center gap-1.5">
            <input
              id="secret-field"
              ref={fieldRef}
              type={revealed ? 'text' : 'password'}
              value={value}
              // A secret the app is being asked to create, not one it remembers.
              autoComplete="new-password"
              spellCheck={false}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && enough) {
                  event.preventDefault()
                  onResolve(value)
                }
              }}
              aria-describedby={request.hint ? 'secret-hint' : undefined}
              placeholder={request.placeholder}
              className="cad-ctl h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-[13px] text-foreground"
            />
            {/* Checking what was typed has to be possible, but not permanent. */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setRevealed((shown) => !shown)}
              aria-label={revealed ? 'Hide the passphrase' : 'Show the passphrase'}
              title={revealed ? 'Hide the passphrase again' : 'Show the passphrase to check it'}
              className="flex-shrink-0"
            >
              {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>
          {request.hint && (
            <p id="secret-hint" className="text-xs text-muted-foreground">
              {request.hint}
            </p>
          )}
        </div>
      </div>

      <div className="cad-footer-row justify-end">
        <div className="cad-action-pair">
          <Button variant="outline" onClick={() => onResolve(null)}>
            Cancel
          </Button>
          <Button disabled={!enough} onClick={() => onResolve(value)}>
            {request.confirmLabel}
          </Button>
        </div>
      </div>
    </DialogShell>
  )
}
