/**
 * One hook turns any element into a library drop target.
 *
 * A zone declares which kinds it takes. A compatible drag lights the accept
 * edge and can be dropped; an incompatible one is refused with a reason that
 * stays on screen for a moment. Silent rejection was the defect this replaces:
 * before it, dragging a part onto a workspace that did not accept drops did
 * nothing at all, and the user could not tell whether the app was broken or the
 * part was wrong.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react'
import {
  dragCarriesLibrary,
  dragLibraryKinds,
  placementPoint,
  readLibraryDrag,
  type PlacementPoint,
} from './drag'
import type { LibraryItem, LibraryKind } from './types'

const REFUSAL_MS = 2600

/**
 * What a zone takes: a list of kinds, or a predicate that returns `true` for a
 * row it can place and a sentence for one it cannot. The sentence is the
 * refusal the user reads, so a panel that knows *why* a row is unusable — a
 * preset its solver has no table for, a bus a branch never names — can say so
 * instead of shrugging.
 */
export type LibraryAccepts = readonly LibraryKind[] | ((item: LibraryItem) => true | string)

export interface LibraryZoneOptions {
  accepts: LibraryAccepts
  onPlace: (item: LibraryItem, point: PlacementPoint) => void
  /** The item armed in the dock by click; clicking the zone places it. */
  pending?: LibraryItem | null
  /** What the zone is called in the refusal sentence. */
  as?: string
}

export interface LibraryZone {
  /** A compatible drag is over the zone — draw the accept edge. */
  accepting: boolean
  /** Why the last drop was refused, or `null`. */
  refusal: string | null
  /** An armed row can be placed here; the panel offers a button for it. */
  pendingActive: boolean
  placePending: () => void
  acceptsItem: (item: LibraryItem) => boolean
  zoneProps: {
    onDragOver: (event: DragEvent<HTMLElement>) => void
    onDragEnter: (event: DragEvent<HTMLElement>) => void
    onDragLeave: () => void
    onDrop: (event: DragEvent<HTMLElement>) => void
    onClick: (event: MouseEvent<HTMLElement>) => void
    'data-library-drop': 'accept' | 'refuse' | 'idle'
  }
}

/**
 * Whether a row may be placed here, as `true` or as the sentence to show.
 *
 * A kind list refuses by kind; a predicate refuses with a reason only the panel
 * knows — the preset its solver has no table for, the bus a branch never names.
 */
export function matchReason(item: LibraryItem, accepts: LibraryAccepts, zoneName?: string): true | string {
  if (typeof accepts === 'function') return accepts(item)
  if (accepts.includes(item.kind)) return true
  return `${item.name} is a ${KIND_WORDS[item.kind].one} — ${
    zoneName ? `${zoneName} takes ${describe(accepts)}.` : 'this surface places no library items.'
  }`
}

export function itemMatches(item: LibraryItem, accepts: LibraryAccepts): boolean {
  return matchReason(item, accepts) === true
}

/**
 * Whether the drag under the pointer is one this zone can place.
 *
 * The payload is unreadable until the drop, so the kind published in the type
 * list is the only evidence available — which is exactly what a hover state
 * needs. A predicate zone cannot be judged from a kind alone, so it lights for
 * every row and refuses at the drop, where the reason is known.
 */
function dragIsCompatible(dataTransfer: DataTransfer | null, accepts: LibraryAccepts): boolean {
  if (typeof accepts === 'function') return true
  const kinds = dragLibraryKinds(dataTransfer)
  // A row from before the kind key existed: assume it may fit, the drop still checks.
  if (kinds.length === 0) return true
  return kinds.some((kind) => accepts.includes(kind))
}

export function useLibraryZone({ accepts, onPlace, pending, as: zoneName }: LibraryZoneOptions): LibraryZone {
  const [accepting, setAccepting] = useState(false)
  /** A library drag the pointer is over that this zone cannot place. */
  const [rejecting, setRejecting] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  /** Nested children fire enter/leave; only the outermost exit may clear the edge. */
  const depth = useRef(0)
  const refusalTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const acceptsRef = useRef(accepts)
  acceptsRef.current = accepts
  const onPlaceRef = useRef(onPlace)
  onPlaceRef.current = onPlace
  const zoneNameRef = useRef(zoneName)
  zoneNameRef.current = zoneName

  useEffect(() => () => {
    if (refusalTimer.current) clearTimeout(refusalTimer.current)
  }, [])

  const refuse = useCallback((message: string) => {
    setRefusal(message)
    if (refusalTimer.current) clearTimeout(refusalTimer.current)
    refusalTimer.current = setTimeout(() => setRefusal(null), REFUSAL_MS)
  }, [])

  const acceptsItem = useCallback(
    (item: LibraryItem) => matchReason(item, acceptsRef.current, zoneNameRef.current) === true,
    [],
  )

  const pendingActive = Boolean(pending && acceptsItem(pending))

  const onDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    // `types` is readable during a drag when the data itself is not, so the
    // edge can follow the pointer without parsing the payload.
    if (!dragCarriesLibrary(event.dataTransfer)) return
    // The drag is always consumed: a `text/plain` payload left unconsumed makes
    // the browser navigate to it.
    event.preventDefault()
    const compatible = dragIsCompatible(event.dataTransfer, acceptsRef.current)
    if (event.dataTransfer) event.dataTransfer.dropEffect = compatible ? 'copy' : 'none'
    setAccepting(compatible)
    setRejecting(!compatible)
  }, [])

  const onDragEnter = useCallback((event: DragEvent<HTMLElement>) => {
    if (!dragCarriesLibrary(event.dataTransfer)) return
    depth.current += 1
  }, [])

  const onDragLeave = useCallback(() => {
    depth.current = Math.max(0, depth.current - 1)
    if (depth.current === 0) {
      setAccepting(false)
      setRejecting(false)
    }
  }, [])

  const onDrop = useCallback((event: DragEvent<HTMLElement>) => {
    depth.current = 0
    setAccepting(false)
    setRejecting(false)
    if (!dragCarriesLibrary(event.dataTransfer)) return
    const item = readLibraryDrag(event.dataTransfer)
    if (!item) return
    event.preventDefault()
    const verdict = matchReason(item, acceptsRef.current, zoneNameRef.current)
    if (verdict !== true) {
      refuse(verdict)
      return
    }
    onPlaceRef.current(item, placementPoint(event, event.currentTarget))
  }, [refuse])

  const onClick = useCallback((event: MouseEvent<HTMLElement>) => {
    if (!pending || !acceptsItem(pending)) return
    // A click inside a real control (input, button) is that control's business.
    if (event.target !== event.currentTarget) return
    onPlaceRef.current(pending, placementPoint(event, event.currentTarget))
  }, [acceptsItem, pending])

  const placePending = useCallback(() => {
    if (!pending || !acceptsItem(pending)) return
    onPlaceRef.current(pending, { clientX: 0, clientY: 0, localX: 0, localY: 0 })
  }, [acceptsItem, pending])

  const state: LibraryZone['zoneProps']['data-library-drop'] = refusal || rejecting
    ? 'refuse'
    : accepting || pendingActive
      ? 'accept'
      : 'idle'

  return useMemo(
    () => ({
      accepting,
      refusal,
      pendingActive,
      placePending,
      acceptsItem,
      zoneProps: { onDragOver, onDragEnter, onDragLeave, onDrop, onClick, 'data-library-drop': state },
    }),
    [accepting, refusal, pendingActive, placePending, acceptsItem, onDragOver, onDragEnter, onDragLeave, onDrop, onClick, state],
  )
}

/** How each kind is named in a refusal sentence, singular and plural. */
const KIND_WORDS: Readonly<Record<LibraryKind, { one: string; many: string }>> = {
  component: { one: 'schematic part', many: 'schematic parts' },
  solid: { one: 'mechanical solid', many: 'mechanical solids' },
  'robot-element': { one: 'robot element', many: 'robot elements' },
  'tf-block': { one: 'transfer-function block', many: 'transfer-function blocks' },
  'rf-element': { one: 'RF chain element', many: 'amplifiers, filters and antennas' },
  machine: { one: 'electric machine', many: 'electric machines' },
  'grid-element': { one: 'power-grid element', many: 'buses, lines and transformers' },
  snippet: { one: 'code snippet', many: 'code' },
  'model-card': { one: 'SPICE model card', many: 'device model cards' },
  truss: { one: 'standard truss', many: 'standard trusses' },
  'bio-model': { one: 'biological model', many: 'biological models' },
}

function describe(accepts: LibraryAccepts): string {
  if (typeof accepts === 'function') return 'a narrower set of items'
  return accepts.map((kind) => KIND_WORDS[kind].many).join(' and ')
}
