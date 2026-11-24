/**
 * Yield one macrotask so the UI can render the latest iteration.
 *
 * `setTimeout(0)` is clamped to one second in hidden tabs and to once per
 * minute under Chrome's intensive throttling, which turns a background
 * autopilot into a crawl. MessageChannel tasks are not timers, so they keep
 * yielding at normal task speed while still letting the renderer flush.
 */
export function yieldToUi(): Promise<void> {
  if (typeof MessageChannel !== 'function') {
    return new Promise((resolve) => setTimeout(resolve, 0))
  }
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    channel.port1.onmessage = () => {
      channel.port1.close()
      resolve()
    }
    channel.port1.start()
    channel.port2.postMessage(null)
  })
}
