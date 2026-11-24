/**
 * The model index is the only contract between the library dock and the
 * workspace: a row the dock offers has to be a row a solver can actually run.
 *
 * This is the defect the structures workspace hit with two lists — a catalog that
 * named a preset its panel could not load — and the reason `loadBioModel` throws
 * instead of defaulting. These tests walk the index rather than trusting the
 * comment: every row loads, comes back as the same row, sits at the scale its id
 * claims, and appears in the dock with that same id in its payload.
 */
import { describe, expect, it } from 'vitest'
import { bioCatalog } from '../library/catalog'
import { BIOLOGICAL_SCALES } from './scales'
import {
  bioModelRow,
  bioModelRows,
  loadBioModel,
  type BioModelFamily,
} from './models'

/** Every family the loader routes. A new member of the union needs a row. */
const ROUTED_FAMILIES: readonly BioModelFamily[] = [
  'kinetics',
  'oxphos',
  'hodgkin-huxley',
  'fitzhugh-nagumo',
  'integrate-and-fire',
  'gene-circuit',
  'cable',
  'oscillators',
  'circulation',
  'starling',
  'pharmacokinetics',
]

describe('biology model index', () => {
  it('gives each row a unique id that carries its own scale', () => {
    const rows = bioModelRows()
    const ids = rows.map((row) => row.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const row of rows) {
      expect(row.id.startsWith(`${row.scale}-`), `${row.id} does not name its scale`).toBe(true)
      expect(row.name.trim().length).toBeGreaterThan(3)
      expect(row.category.trim().length).toBeGreaterThan(2)
      expect(row.spec.trim().length).toBeGreaterThan(0)
      expect(row.description.trim().length).toBeGreaterThan(24)
    }
  })

  it('has a loadable model at every scale on the ladder', () => {
    const scales = new Set(bioModelRows().map((row) => row.scale))
    for (const scale of BIOLOGICAL_SCALES) {
      expect(scales.has(scale), `no model at the ${scale} scale`).toBe(true)
    }
  })

  it('has a row for every family the loader routes, and none it does not', () => {
    const present = new Set(bioModelRows().map((row) => row.family))
    for (const family of ROUTED_FAMILIES) {
      expect(present.has(family), `no row reaches ${family}`).toBe(true)
    }
    expect(present.size).toBe(ROUTED_FAMILIES.length)
  })

  it('loads every row and hands back the row it was indexed by', () => {
    for (const row of bioModelRows()) {
      const loaded = loadBioModel(row.id)
      expect(loaded.row.id, `${row.id} came back as another row`).toBe(row.id)
      expect(loaded.family, `${row.id} came back with another family`).toBe(row.family)
    }
  })

  it('offers the dock only rows the workspace can place', () => {
    for (const item of bioCatalog()) {
      const row = bioModelRow(item.payload.presetId)
      expect(row, `${item.id} names a preset the index does not carry`).not.toBeNull()
      expect(item.payload.scale).toBe(row?.scale)
      expect(item.name).toBe(row?.name)
      expect(item.category).toBe(row?.category)
    }
    expect(bioCatalog().length).toBe(bioModelRows().length)
  })

  it('refuses an id that is not in the index', () => {
    expect(bioModelRow('molecule-no-such-preset')).toBeNull()
    expect(() => loadBioModel('molecule-no-such-preset')).toThrow(/not a model the biology workspace can load/)
  })
})
