/**
 * The drag payload contract.
 *
 * A dropped row is JSON from a string bag, so the receiver decides whether it is
 * one of ours. These tests pin the two ways that has gone wrong: a kind the
 * runtime list does not know about is swallowed without a word (which is exactly
 * how the structures rows arrived and vanished), and a payload from a stale tab
 * must be refused rather than handed to a panel that would fail mid-placement.
 */
import { describe, expect, it } from 'vitest'
import type { Component } from '../supabase'
import {
  LIBRARY_KIND_PREFIX,
  LIBRARY_MIME,
  dragCarriesLibrary,
  dragLibraryKinds,
  readLibraryDrag,
  writeLibraryDrag,
} from './drag'
import { LIBRARY_KINDS, type LibraryItem, type LibraryKind } from './types'
import {
  bioCatalog,
  electricalCatalog,
  machineCatalog,
  mechanicalCatalog,
  modelCardCatalog,
  trussCatalog,
} from './catalog'
import { controlCatalog, gridCatalog, rfCatalog, robotCatalog, snippetCatalog } from './elementCatalogs'

/** A part list entry with only what the dock reads. */
const componentFixture: Component = {
  name: 'Resistor',
  category: 'passive',
  is_standard: true,
  symbol_data: { width: 80, height: 30, paths: ['M 0,15 L 80,15'] },
  pins: [],
  default_properties: { value: '10k' },
}

/**
 * Which catalog produces each kind. A kind with no producer here is a row the
 * dock can never offer, so it belongs in the union not at all.
 */
const PRODUCERS: Readonly<Record<LibraryKind, () => readonly LibraryItem[]>> = {
  component: () => electricalCatalog([componentFixture]),
  solid: mechanicalCatalog,
  'robot-element': robotCatalog,
  'tf-block': controlCatalog,
  'rf-element': rfCatalog,
  machine: machineCatalog,
  'grid-element': gridCatalog,
  snippet: snippetCatalog,
  'model-card': modelCardCatalog,
  truss: trussCatalog,
  'bio-model': bioCatalog,
}

/** The string bag a browser hands a drop target, as jsdom cannot. */
function bag(): DataTransfer {
  const store = new Map<string, string>()
  const transfer = {
    types: [] as string[],
    getData: (type: string) => store.get(type) ?? '',
    setData: (type: string, value: string) => {
      store.set(type, value)
      // `types` is what a dragover handler can read, so it has to stay in step.
      transfer.types = Array.from(store.keys())
    },
  }
  return transfer as unknown as DataTransfer
}

describe('library drag payloads', () => {
  it('names every kind the contract declares', () => {
    expect([...LIBRARY_KINDS].sort()).toEqual(Object.keys(PRODUCERS).sort())
  })

  it.each(LIBRARY_KINDS)('a %s row is offered by a catalog and survives the round trip', (kind) => {
    const rows = PRODUCERS[kind]()
    expect(rows.length, `${kind} has no catalog rows to place`).toBeGreaterThan(0)
    const row = rows[0]
    expect(row.kind).toBe(kind)

    const dataTransfer = bag()
    writeLibraryDrag(dataTransfer, row as LibraryItem)

    // The hover state is decided from the type list alone, before the drop.
    expect(dragCarriesLibrary(dataTransfer)).toBe(true)
    expect(dragLibraryKinds(dataTransfer)).toEqual([kind])
    // The payload comes back as it was written, minus the fields JSON drops
    // (an absent optional key stays absent rather than arriving as undefined).
    expect(readLibraryDrag(dataTransfer)).toMatchObject({
      id: row.id,
      kind,
      payload: JSON.parse(JSON.stringify(row.payload)),
    })
  })

  it('refuses a payload whose kind the contract does not have', () => {
    const dataTransfer = bag()
    dataTransfer.setData(LIBRARY_MIME, JSON.stringify({
      id: 'x-1',
      kind: 'not-a-kind',
      name: 'Ghost row',
      category: 'Nowhere',
      payload: {},
    }))
    expect(readLibraryDrag(dataTransfer)).toBeNull()
  })

  it('refuses a malformed or foreign payload instead of half-placing it', () => {
    const broken = bag()
    broken.setData(LIBRARY_MIME, '{ "id": "half-written')
    expect(readLibraryDrag(broken)).toBeNull()

    const shapeless = bag()
    shapeless.setData(LIBRARY_MIME, JSON.stringify({ id: 'x', kind: 'truss' }))
    expect(readLibraryDrag(shapeless)).toBeNull()

    const empty = bag()
    empty.setData('text/plain', 'a file from another app')
    expect(dragCarriesLibrary(empty)).toBe(false)
    expect(readLibraryDrag(empty)).toBeNull()
  })

  it('publishes the kind as its own type so a zone can light its edge early', () => {
    const dataTransfer = bag()
    writeLibraryDrag(dataTransfer, trussCatalog()[0] as LibraryItem)
    expect(dataTransfer.types).toContain(`${LIBRARY_KIND_PREFIX}truss`)
    expect(dataTransfer.getData(LIBRARY_MIME)).toContain('"presetId"')
  })
})
