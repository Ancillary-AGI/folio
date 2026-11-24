import { useCallback } from 'react'
import { useAppStore, type AppSettings } from '../../stores/useAppStore'

/**
 * One preference, read and written, straight from the persisted store.
 *
 * Panels used to hold a `useState` mirror of a display option and the settings
 * page used to edit a draft copy of it, so the same choice could be true in two
 * places and neither was the one the app acted on. Binding a control to
 * `usePreference('viewerGrid')` instead makes the persisted setting the only
 * copy: the panel, the settings editor and the renderer read the same field, and
 * a change applies the moment it is made — which is what an IDE does.
 */
export function usePreference<Key extends keyof AppSettings>(
  key: Key,
): [AppSettings[Key], (value: AppSettings[Key]) => void] {
  const value = useAppStore((state) => state.settings[key])
  const updateSettings = useAppStore((state) => state.updateSettings)
  const setValue = useCallback(
    (next: AppSettings[Key]) => updateSettings({ [key]: next } as Partial<AppSettings>),
    [key, updateSettings],
  )
  return [value, setValue]
}

/** The read-only half, for a renderer that should never write. */
export function usePreferenceValue<Key extends keyof AppSettings>(key: Key): AppSettings[Key] {
  return useAppStore((state) => state.settings[key])
}
