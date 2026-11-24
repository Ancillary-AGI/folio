import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearProviderKey,
  MODEL_CONFIG_KEY,
  MODEL_KEY_RING,
  providersWithStoredKeys,
  readProviderKey,
  readStoredConfig,
  writeProviderKey,
  writeStoredConfig,
} from './credentials'

const ring = (where: 'localStorage' | 'sessionStorage') => window[where].getItem(MODEL_KEY_RING)

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  clearProviderKey('a')
  clearProviderKey('b')
})

describe('where a key is allowed to live', () => {
  it('keeps a memory key in memory only', () => {
    writeProviderKey('a', 'sk-mem', 'memory')
    expect(readProviderKey('a', 'memory')).toBe('sk-mem')
    expect(ring('localStorage')).toBeNull()
    expect(ring('sessionStorage')).toBeNull()
    // The in-page copy is the freshest, so it answers for every tier until the
    // page reloads; after that, only what was actually persisted remains.
    expect(readProviderKey('a', 'local')).toBe('sk-mem')
    clearProviderKey('a')
    expect(readProviderKey('a', 'local')).toBe('')
    expect(readProviderKey('a', 'session')).toBe('')
  })

  it('keeps a session key in the tab and a local key on the device', () => {
    writeProviderKey('a', 'sk-tab', 'session')
    writeProviderKey('b', 'sk-device', 'local')
    expect(readProviderKey('a', 'session')).toBe('sk-tab')
    expect(readProviderKey('b', 'local')).toBe('sk-device')
    expect(JSON.parse(String(ring('sessionStorage')))).toEqual({ a: 'sk-tab' })
    expect(JSON.parse(String(ring('localStorage')))).toEqual({ b: 'sk-device' })
  })

  it('moves a key between tiers instead of leaving a copy behind', () => {
    writeProviderKey('a', 'sk-1', 'local')
    writeProviderKey('a', 'sk-1', 'session')
    expect(ring('localStorage')).toBeNull()
    expect(readProviderKey('a', 'session')).toBe('sk-1')
    writeProviderKey('a', 'sk-1', 'local')
    expect(ring('sessionStorage')).toBeNull()
    expect(readProviderKey('a', 'local')).toBe('sk-1')
  })

  it('deletes from every tier, and removes an emptied ring entirely', () => {
    writeProviderKey('a', 'sk-mem', 'memory')
    writeProviderKey('a', 'sk-dev', 'local')
    writeProviderKey('a', 'sk-tab', 'session')
    clearProviderKey('a')
    expect(readProviderKey('a', 'memory')).toBe('')
    expect(readProviderKey('a', 'local')).toBe('')
    expect(readProviderKey('a', 'session')).toBe('')
    // A leftover `{}` would read as "this device once held a key".
    expect(ring('localStorage')).toBeNull()
    expect(ring('sessionStorage')).toBeNull()
  })

  it('treats saving an empty key as a delete', () => {
    writeProviderKey('a', 'sk-x', 'local')
    writeProviderKey('a', '', 'local')
    expect(readProviderKey('a', 'local')).toBe('')
    expect(localStorage.getItem(MODEL_KEY_RING)).toBeNull()
  })

  it('lists every provider that holds a key, once and in order', () => {
    writeProviderKey('b', 'k1', 'local')
    writeProviderKey('a', 'k2', 'session')
    writeProviderKey('a', 'k3', 'memory')
    expect(providersWithStoredKeys()).toEqual(['a', 'b'])
  })

  it('ignores a corrupt ring instead of throwing', () => {
    localStorage.setItem(MODEL_KEY_RING, '{not json')
    expect(readProviderKey('a', 'local')).toBe('')
    localStorage.setItem(MODEL_KEY_RING, JSON.stringify(['a']))
    expect(readProviderKey('a', 'local')).toBe('')
  })
})

describe('the config namespace', () => {
  it('is a different key from the ring, so a design export cannot carry both', () => {
    writeStoredConfig(JSON.stringify({ providerId: 'openai', plannerModel: 'gpt' }))
    writeProviderKey('openai', 'sk-secret', 'local')
    expect(MODEL_CONFIG_KEY).not.toBe(MODEL_KEY_RING)
    expect(readStoredConfig()).not.toContain('sk-secret')
  })

  it('reads back empty when nothing was stored', () => {
    expect(readStoredConfig()).toBe('')
  })
})
