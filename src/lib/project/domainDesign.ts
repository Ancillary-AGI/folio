import { useEffect, useRef } from 'react'
import { useProjectStore } from '../../stores/useProjectStore'

/**
 * Domain design state lives in the project store so one project can carry a
 * schematic, board, mechanical assembly and any number of other CAD domains.
 * VCS snapshots, project saves and backups all include the same bag.
 *
 * Panels stay in control of their own React state (their fields are heavily
 * interdependent); this module mirrors the serialisable design into the store
 * and adopts external changes — a VCS checkout or project load — back into the
 * panel while it is mounted.
 */

export type DomainDesign<T> = Partial<T>

/** Read a saved domain design once, for use in `useState` initialisers. */
export function loadDomainDesign<T>(key: string): DomainDesign<T> | null {
  const value = useProjectStore.getState().domainDesigns[key]
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as DomainDesign<T>)
    : null
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * Publish `design` whenever it changes, and call `hydrate` when the stored
 * design changes underneath us (checkout, import, another panel instance).
 * Designs must be plain JSON; functions and class instances are not supported.
 */
export function usePublishDomainDesign<T extends object>(
  key: string,
  design: T,
  hydrate?: (saved: T) => void,
): void {
  const stored = useProjectStore((state) => state.domainDesigns[key])
  const setDomainDesign = useProjectStore((state) => state.setDomainDesign)
  const serialized = JSON.stringify(design)
  const lastPublished = useRef<string | null>(null)
  const hydrateRef = useRef(hydrate)
  hydrateRef.current = hydrate

  useEffect(() => {
    const storedJson = isPlainObject(stored) ? JSON.stringify(stored) : ''
    if (storedJson === serialized) {
      lastPublished.current = serialized
      return
    }
    const external = Boolean(storedJson) && storedJson !== lastPublished.current
    if (external && hydrateRef.current && isPlainObject(stored)) {
      // Never overwrite a restored design with the panel's pre-restore state.
      hydrateRef.current(stored as unknown as T)
      lastPublished.current = storedJson
      return
    }
    setDomainDesign(key, JSON.parse(serialized) as unknown)
    lastPublished.current = serialized
  }, [key, serialized, stored, setDomainDesign])
}
