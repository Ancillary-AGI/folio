import { useEffect, useRef, type ReactNode, type RefObject } from 'react'

interface DialogShellProps {
  /** Answers the question with "no": Escape, the backdrop, or the close control. */
  onClose: () => void
  /** The heading that names this dialog for a screen reader. */
  labelledBy: string
  /** The body text that explains it, when there is one. */
  describedBy?: string
  /** Where focus starts. Defaults to the panel's first field, else its first button. */
  initialFocus?: RefObject<HTMLElement | null>
  /** Extra classes on the panel; width belongs to the caller, structure does not. */
  className?: string
  children: ReactNode
}

/**
 * The modal shell every asking surface in the app is built on.
 *
 * `ConfirmDialog` and `SecretDialog` need the same five things, and getting any
 * one of them wrong is invisible until someone tries to use the app without a
 * mouse: the scrim that dims and dismisses, the panel that is a real `dialog`
 * with an `aria-modal`, the heading that names it, the focus that arrives on
 * open and goes back where it came from, and a Tab ring that cannot walk out
 * into the page behind. Those live here once.
 *
 * It mounts only while it is open, so all of that is setup and teardown — no
 * hidden dialog sitting in the tree, and no state surviving into the next
 * question.
 */
export default function DialogShell({
  onClose,
  labelledBy,
  describedBy,
  initialFocus,
  className,
  children,
}: DialogShellProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  // Whatever held focus before the question opened, given back when it closes.
  const returnFocus = useRef<Element | null>(null)

  // A caller may swap the handler every render; reacting to its identity would
  // tear down and rebuild the keyboard handling on unrelated parent renders.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    returnFocus.current = document.activeElement

    const focusables = () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'input:not([type="hidden"]), select, textarea, button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      )

    const start = initialFocus?.current ?? focusables()[0] ?? null
    // One frame later, so the panel is painted and the field exists to focus.
    const focusFrame = requestAnimationFrame(() => start?.focus())

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        // Claimed before it can reach the shell's own shortcuts: one key, one
        // action, otherwise Escape closes this panel and whatever is behind it.
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const ring = focusables()
      if (ring.length === 0) return
      const first = ring[0]
      const last = ring[ring.length - 1]
      // A browser moves focus itself in the middle of the ring; only the two
      // ends have to be turned back into the panel.
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      cancelAnimationFrame(focusFrame)
      window.removeEventListener('keydown', onKeyDown, true)
      const target = returnFocus.current
      if (target instanceof HTMLElement) target.focus()
    }
    // Mounted while open, unmounted on the answer: this runs exactly once per
    // question, which is why the handler identity is not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      className="modal-scrim"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCloseRef.current()
      }}
    >
      <div
        ref={panelRef}
        className={`app-panel cad-panel-shell animate-rise-in ${className ?? 'max-w-lg'}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
