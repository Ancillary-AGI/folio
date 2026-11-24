/**
 * Library drags under jsdom.
 *
 * jsdom implements neither `DataTransfer` nor `DragEvent`, so the payload a real
 * browser hands a drop target is assembled here once and reused by every panel's
 * drop-zone tests. The keys match `drag.ts`, which is what makes the zone's
 * hover check and its drop check see the same row a user would be dragging.
 */
import { fireEvent } from '@testing-library/react'
import { LIBRARY_KIND_PREFIX, LIBRARY_MIME } from '../../lib/library/drag'
import { useAppStore } from '../../stores/useAppStore'
import type { LibraryItem } from '../../lib/library/types'

export function dataTransferFor(item: LibraryItem): DataTransfer {
  const bag = new Map<string, string>([
    [LIBRARY_MIME, JSON.stringify(item)],
    [`${LIBRARY_KIND_PREFIX}${item.kind}`, ''],
    ['text/plain', item.name],
  ])
  return {
    types: Array.from(bag.keys()),
    getData: (type: string) => bag.get(type) ?? '',
    setData: (type: string, value: string) => {
      bag.set(type, value)
    },
    dropEffect: 'none',
    effectAllowed: 'uninitialized',
  } as unknown as DataTransfer
}

/** Release a row over the zone. */
export function dropLibraryItem(target: Element, item: LibraryItem): void {
  const event = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clientX', { value: 0 })
  Object.defineProperty(event, 'clientY', { value: 0 })
  Object.defineProperty(event, 'dataTransfer', { value: dataTransferFor(item) })
  fireEvent(target, event)
}

/** Hover with a row in the drag — the state that sets the accept or refuse edge. */
export function dragLibraryOver(target: Element, item: LibraryItem): void {
  const event = new Event('dragover', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: dataTransferFor(item) })
  fireEvent(target, event)
}

/** Arm a row the way a click in the dock does, so the Place button can spend it. */
export function armLibraryItem(item: LibraryItem): void {
  useAppStore.getState().setArmedLibraryItem(item)
}
