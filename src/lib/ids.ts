/**
 * Identifiers for records that outlive the page.
 *
 * Job, session and other persisted records are written to localStorage or a
 * server store and read back on the next launch, so their ids must be unique
 * across reloads. A module-level counter restarts at 0 every time the bundle is
 * evaluated, so a record created in the same millisecond as one from a previous
 * session would collide — and the stores overwrite silently rather than merging.
 *
 * `crypto.randomUUID` is used when the platform provides it (all modern
 * browsers, Node 19+, and every secure context). The fallback keeps a time and
 * randomness component so it is still collision-resistant where `randomUUID` is
 * unavailable, which is why it is not simply an incrementing counter.
 */
const randomChunk = (): string => Math.random().toString(36).slice(2, 10)

/** A unique id with the given prefix, safe to persist and reload. */
export function newPersistedId(prefix: string): string {
  const cryptoApi: Crypto | undefined = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return `${prefix}-${cryptoApi.randomUUID()}`
  }
  return `${prefix}-${Date.now().toString(36)}-${randomChunk()}`
}