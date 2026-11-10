/**
 * Where a provider key lives, and why it never lives in a project.
 *
 * Folio's designs sync, get committed to the project's version history and can
 * be exported as a bundle. A credential that travelled with any of those is a
 * breach with a paper trail, so keys are stored apart from every design store by
 * a separate mechanism, in a separate localStorage namespace, and are excluded
 * from snapshots by construction rather than by a filter that could be forgotten.
 */
import type { KeyPersistence } from './providers'

const CONFIG_KEY = 'folio.models.v1'
const KEY_RING = 'folio.models.keys.v1'

/** In-memory tier: survives navigation within this page, nothing after a reload. */
const memoryKeys = new Map<string, string>()

function readLocalStorageKeys(): Record<string, string> {
  try {
    const raw = localStorage.getItem(KEY_RING)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    )
  } catch {
    return {}
  }
}

function writeLocalStorageKeys(map: Record<string, string>): void {
  try {
    // An empty ring is removed, not written as "{}": a leftover `{}` reads as
    // "this device once held a key", which is exactly the wrong thing to imply.
    if (!Object.keys(map).length) localStorage.removeItem(KEY_RING)
    else localStorage.setItem(KEY_RING, JSON.stringify(map))
  } catch {
    /* storage full or blocked; the in-memory tier still works for this page */
  }
}

function readSessionKeys(): Record<string, string> {
  try {
    const raw = sessionStorage.getItem(KEY_RING)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    )
  } catch {
    return {}
  }
}

function writeSessionKeys(map: Record<string, string>): void {
  try {
    if (!Object.keys(map).length) sessionStorage.removeItem(KEY_RING)
    else sessionStorage.setItem(KEY_RING, JSON.stringify(map))
  } catch {
    /* private mode blocks sessionStorage; the memory tier still serves this page */
  }
}

export function readProviderKey(providerId: string, persistence: KeyPersistence): string {
  if (memoryKeys.has(providerId)) return memoryKeys.get(providerId) ?? ''
  if (persistence === 'session') return readSessionKeys()[providerId] ?? ''
  if (persistence === 'local') return readLocalStorageKeys()[providerId] ?? ''
  // 'memory' with nothing in memory is simply no key.
  return ''
}

export function writeProviderKey(providerId: string, key: string, persistence: KeyPersistence): void {
  if (!key) {
    clearProviderKey(providerId)
    return
  }
  if (persistence === 'memory') {
    memoryKeys.set(providerId, key)
    return
  }
  memoryKeys.delete(providerId)
  if (persistence === 'session') {
    const map = readSessionKeys()
    map[providerId] = key
    writeSessionKeys(map)
    // A key that moved to the tab also leaves the device, or "this tab only"
    // would silently keep the copy the user thought they had replaced.
    const device = readLocalStorageKeys()
    if (device[providerId]) {
      delete device[providerId]
      writeLocalStorageKeys(device)
    }
    return
  }
  const map = readLocalStorageKeys()
  map[providerId] = key
  writeLocalStorageKeys(map)
  const tab = readSessionKeys()
  if (tab[providerId]) {
    delete tab[providerId]
    writeSessionKeys(tab)
  }
}

/** Removes the key from every tier: a delete that misses one is not a delete. */
export function clearProviderKey(providerId: string): void {
  memoryKeys.delete(providerId)
  const device = readLocalStorageKeys()
  if (device[providerId]) {
    delete device[providerId]
    writeLocalStorageKeys(device)
  }
  const tab = readSessionKeys()
  if (tab[providerId]) {
    delete tab[providerId]
    writeSessionKeys(tab)
  }
}

export function providersWithStoredKeys(): string[] {
  return [...new Set([...memoryKeys.keys(), ...Object.keys(readLocalStorageKeys()), ...Object.keys(readSessionKeys())])].sort()
}

/**
 * The config is safe to keep in one place: it names a provider, a model and a
 * URL. It is the key that is separated, which is why this reads and writes a
 * different namespace from the key ring.
 */
export function readStoredConfig(): string {
  try {
    return localStorage.getItem(CONFIG_KEY) ?? ''
  } catch {
    return ''
  }
}

export function writeStoredConfig(value: string): void {
  try {
    localStorage.setItem(CONFIG_KEY, value)
  } catch {
    /* nothing to do: the settings simply will not survive the reload */
  }
}

export const MODEL_CONFIG_KEY = CONFIG_KEY
export const MODEL_KEY_RING = KEY_RING
