/**
 * The library zone every domain panel uses.
 *
 * `useLibraryZone` knows about drags; this adds the two things a panel should
 * not have to wire itself: which row the dock currently has armed (kept in the
 * store, because the panels are lazy-loaded and take no library props) and the
 * fact that placing a row consumes it.
 */
import { useCallback } from 'react'
import { useAppStore } from '../../stores/useAppStore'
import { useLibraryZone, type LibraryAccepts, type LibraryZone } from './dropZone'
import type { PlacementPoint } from './drag'
import type { LibraryItem } from './types'

export interface DomainZoneOptions {
  /** Kinds this surface places — the same list the dock's catalog declares. */
  accepts: LibraryAccepts
  /** What the surface is called in a refusal sentence, e.g. `the viewport`. */
  as: string
  /** Called once per accepted drop or armed placement; then the row is spent. */
  onPlace: (item: LibraryItem, point: PlacementPoint) => void
}

export function useDomainLibraryZone({ accepts, as, onPlace }: DomainZoneOptions): LibraryZone {
  const armed = useAppStore((state) => state.armedLibraryItem)
  const setArmed = useAppStore((state) => state.setArmedLibraryItem)

  const consume = useCallback<DomainZoneOptions['onPlace']>(
    (item, point) => {
      onPlace(item, point)
      setArmed(null)
    },
    [onPlace, setArmed],
  )

  return useLibraryZone({ accepts, as, pending: armed, onPlace: consume })
}
