import { useEffect, useRef } from 'react'
import { useAppStore } from '../../stores/useAppStore'

/**
 * Consume a one-shot demo bootstrap addressed to this panel.
 *
 * The gallery writes the request before the lazy panel mounts, so the panel
 * must look for it on every render until it is consumed. The ref keeps the
 * effect stable when the handler closes over fresh state.
 */
export function useDemoRequest(request: string, handler: () => void): void {
  const demoRequest = useAppStore((state) => state.demoRequest)
  const handlerRef = useRef(handler)

  useEffect(() => {
    handlerRef.current = handler
  }, [handler])

  useEffect(() => {
    if (demoRequest !== request) return
    // Consume before invoking: StrictMode replays effects on mount with the
    // closure from the first render, so clearing afterwards would run the
    // one-shot bootstrap twice.
    if (useAppStore.getState().demoRequest !== request) return
    useAppStore.getState().clearDemoRequest()
    handlerRef.current()
  }, [demoRequest, request])
}
