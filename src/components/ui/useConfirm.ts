import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * A question the app asks before it does something the engineer has to live
 * with: deleting a project, restoring a commit, replacing an unsaved sheet.
 *
 * Until now these were `window.confirm()` calls — a browser chrome box that
 * matches nothing in this product, cannot be styled, cannot be tested, and blocks
 * the main thread while it waits. The pair here (`useConfirm` +
 * `ConfirmDialog`) keeps the same *ask before you act* behaviour but renders it
 * as a panel of the app, and hands the answer back as a promise so a caller reads
 * as one line: `if (!(await confirm({...}))) return`.
 */
export interface ConfirmSpec {
  /** What is about to happen, as a question the answer settles. */
  title: string
  /** The consequence, in one or two sentences — what is lost and what is kept. */
  detail: string
  /** The verb on the button that acts. A noun ("OK") says nothing. */
  confirmLabel: string
  /** Defaults to "Cancel" — the label has to describe going back, not agreeing. */
  cancelLabel?: string
  /** Renders the action button in the destructive colour. Use for irreversible acts. */
  destructive?: boolean
}

export interface UseConfirm {
  /** The open request, or null when nothing is being asked. Pass to `ConfirmDialog`. */
  spec: ConfirmSpec | null
  /** Ask, and await the answer. Resolves false if the question is dismissed. */
  confirm: (spec: ConfirmSpec) => Promise<boolean>
  /** Settle the open request. Pass to `ConfirmDialog`'s `onResolve`. */
  resolve: (accepted: boolean) => void
}

export function useConfirm(): UseConfirm {
  const [spec, setSpec] = useState<ConfirmSpec | null>(null)
  // The waiting promise's resolver, kept in a ref so settling it never re-renders.
  const pending = useRef<((accepted: boolean) => void) | null>(null)

  const confirm = useCallback((next: ConfirmSpec): Promise<boolean> => {
    return new Promise((resolvePromise) => {
      /*
       * One question at a time. If a caller asks again while a panel is open,
       * the earlier question is answered "no" rather than left unresolved — its
       * caller then falls through the same path as a dismissal instead of
       * hanging on a promise nobody can settle.
       */
      pending.current?.(false)
      pending.current = resolvePromise
      setSpec(next)
    })
  }, [])

  const resolve = useCallback((accepted: boolean) => {
    const settle = pending.current
    pending.current = null
    setSpec(null)
    settle?.(accepted)
  }, [])

  useEffect(
    () => () => {
      // An unmount with a question open (a route change, a dialog parent
      // closing) must not strand the awaiting caller forever.
      pending.current?.(false)
      pending.current = null
    },
    [],
  )

  return { spec, confirm, resolve }
}
