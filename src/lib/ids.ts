/**
 * Ids for persisted records.
 *
 * A module counter restarts at 0 on reload, so a same-millisecond record from a
 * previous session would collide and the stores overwrite silently. Persisted ids
 * must be unique across reloads.
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