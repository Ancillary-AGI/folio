/**
 * Drag payload plumbing shared by the dock and every drop target.
 *
 * HTML5 drag data is a string bag, so the only safety a receiver gets is what
 * it checks itself. `readLibraryDrag` re-validates the shape rather than
 * trusting the sender: a payload from a stale tab, another app, or a hand-edited
 * drop must not be able to hand a panel an object that fails mid-placement.
 */
import { LIBRARY_KINDS, type LibraryItem, type LibraryKind } from './types'

/** Custom type so a foreign `text/plain` drag never looks like a library row. */
export const LIBRARY_MIME = 'application/x-folio-library-item+json'

/**
 * A second, empty type that names the row's kind.
 *
 * A drop handler cannot read the payload while a drag is in progress, but it can
 * read the type list — so publishing the kind there is what lets a zone light
 * its edge only for rows it can actually place, instead of promising every row
 * and refusing it after the release.
 */
export const LIBRARY_KIND_PREFIX = 'application/x-folio-kind/'

/** Kept for the schematic and board canvases, which already read this key. */
export const LEGACY_COMPONENT_KEY = 'componentId'

/**
 * The kinds a payload may name, derived from the contract in `types.ts` so it
 * cannot fall behind it.
 */
const KINDS: ReadonlySet<string> = new Set<string>(LIBRARY_KINDS)

export function writeLibraryDrag(dataTransfer: DataTransfer, item: LibraryItem): void {
  dataTransfer.setData(LIBRARY_MIME, JSON.stringify(item))
  dataTransfer.setData(`${LIBRARY_KIND_PREFIX}${item.kind}`, '')
  // Every drag destination outside Folio gets a readable label.
  dataTransfer.setData('text/plain', item.spec ? `${item.name} (${item.spec})` : item.name)
  if (item.kind === 'component' && typeof item.payload.componentId === 'string') {
    dataTransfer.setData(LEGACY_COMPONENT_KEY, item.payload.componentId)
  }
  dataTransfer.effectAllowed = 'copy'
}

function hasShape(value: unknown): value is LibraryItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.id === 'string' &&
    typeof record.name === 'string' &&
    typeof record.category === 'string' &&
    typeof record.kind === 'string' &&
    KINDS.has(record.kind) &&
    typeof record.payload === 'object' &&
    record.payload !== null
  )
}

/** The item a drag carries, or `null` when the drag is not a library row. */
export function readLibraryDrag(dataTransfer: DataTransfer | null): LibraryItem | null {
  if (!dataTransfer) return null
  const raw = dataTransfer.getData(LIBRARY_MIME)
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return hasShape(parsed) ? parsed : null
  } catch {
    // Malformed JSON is simply not one of ours.
  }
  return null
}

/** `true` while a drag in progress could be dropped here, without reading it. */
export function dragCarriesLibrary(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false
  const types = Array.from(dataTransfer.types ?? []).map((type) => type.toLowerCase())
  return types.includes(LIBRARY_MIME)
}

/**
 * The kinds a drag in progress carries, read from the type list.
 *
 * `getData` returns an empty string during `dragover` for security, but
 * `types` is readable, which is the only way a zone can decide whether to light
 * its edge before the drop. An empty array means a row from before this key
 * existed (or a stale tab), so the caller must fall back to accepting blindly.
 */
export function dragLibraryKinds(dataTransfer: DataTransfer | null): LibraryKind[] {
  if (!dataTransfer) return []
  const types = Array.from(dataTransfer.types ?? []).map((type) => type.toLowerCase())
  return types
    .filter((type) => type.startsWith(LIBRARY_KIND_PREFIX))
    .map((type) => type.slice(LIBRARY_KIND_PREFIX.length))
    .filter((kind): kind is LibraryKind => KINDS.has(kind))
}

export interface PlacementPoint {
  /** Viewport coordinates of the drop. */
  clientX: number
  clientY: number
  /** Same point relative to the drop target's own box. */
  localX: number
  localY: number
}

export function placementPoint(event: { clientX: number; clientY: number }, target: Element): PlacementPoint {
  const rect = target.getBoundingClientRect()
  return {
    clientX: event.clientX,
    clientY: event.clientY,
    localX: event.clientX - rect.left,
    localY: event.clientY - rect.top,
  }
}
