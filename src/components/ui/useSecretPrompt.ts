import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Asks for a secret the app must never see again afterwards — today, the
 * passphrase that seals an encrypted export.
 */
export interface SecretRequest {
  /** Names the dialog for a screen reader and for the person reading it. */
  title: string
  /** Why the value is wanted and what happens if it is lost. */
  detail: string
  fieldLabel: string
  confirmLabel: string
  placeholder?: string
  /** States the rule the value has to meet, instead of rejecting it later. */
  hint?: string
  /** Anything shorter is refused by the field, so an empty answer is never a "yes". */
  minLength?: number
}

export interface UseSecretPrompt {
  /** The open request, or null when nothing is being asked. Pass to `SecretDialog`. */
  request: SecretRequest | null
  /** Ask, and await what was typed. `null` means the question was declined. */
  ask: (request: SecretRequest) => Promise<string | null>
  /** Settle the open request. Pass to `SecretDialog`'s `onResolve`. */
  resolve: (value: string | null) => void
}

/**
 * The text-answer twin of `useConfirm`: same promise handoff, same rule that an
 * abandoned question settles rather than hanging, but the answer is what was
 * typed, and a decline is `null` rather than `false`.
 */
export function useSecretPrompt(): UseSecretPrompt {
  const [request, setRequest] = useState<SecretRequest | null>(null)
  const pending = useRef<((value: string | null) => void) | null>(null)

  const ask = useCallback((next: SecretRequest): Promise<string | null> => {
    return new Promise((resolvePromise) => {
      // One question at a time; a replaced one is declined, not left waiting.
      pending.current?.(null)
      pending.current = resolvePromise
      setRequest(next)
    })
  }, [])

  const resolve = useCallback((value: string | null) => {
    const settle = pending.current
    pending.current = null
    setRequest(null)
    settle?.(value)
  }, [])

  useEffect(
    () => () => {
      pending.current?.(null)
      pending.current = null
    },
    [],
  )

  return { request, ask, resolve }
}
