import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE_SELECTOR =
  'input:not([type="hidden"]), select, textarea, button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'

/**
 * The modal contract every bespoke dialog owes its users:
 *   · focus arrives on open (the initial control, else the first field, else the panel);
 *   · it goes back to whatever held it before the dialog opened;
 *   · Tab and Shift+Tab circulate inside the panel instead of walking into the page behind;
 *   · Escape asks the caller to close, claimed before the shell can see it.
 *
 * DialogShell implements the same contract for dialogs built on it; this is
 * that behaviour for dialogs whose layout predates the shell. Pass
 * `active: false` while the dialog is closed — the hook arms on mount and on
 * the false→true transition.
 */
export function useModalFocus(
  panelRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  options: { initialFocus?: RefObject<HTMLElement | null>; active?: boolean } = {},
): void {
  // A caller may swap the handler every render; reacting to its identity
  // would tear the keyboard handling down on unrelated parent renders.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  const initialFocusRef = useRef(options.initialFocus)
  const active = options.active ?? true

  useEffect(() => {
    if (!active) return
    const returnFocus = document.activeElement

    const focusables = (): HTMLElement[] =>
      Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [])

    const start = initialFocusRef.current?.current ?? focusables()[0] ?? null
    // One frame later, so the panel is painted and the field exists to focus.
    const focusFrame = requestAnimationFrame(() => start?.focus())

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        // Claimed before it can reach the shell's own shortcuts: one key, one action.
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const ring = focusables()
      if (ring.length === 0) return
      const first = ring[0]
      const last = ring[ring.length - 1]
      // Only the two ends need to be turned back into the panel.
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
      const target = returnFocus
      if (target instanceof HTMLElement) target.focus()
    }
    // Armed per open, not per render; onCloseRef carries the latest handler.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])
}
