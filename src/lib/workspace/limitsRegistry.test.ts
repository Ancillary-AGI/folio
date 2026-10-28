/**
 * The registry is the app's own statement of what it will and will not claim, so
 * these tests are about integrity, not behaviour:
 *
 *   • a record may not cite a test file that does not exist;
 *   • no workspace may be left out of it;
 *   • the prose that presents a result as computed must not overclaim.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CAPABILITY_FAMILIES,
  CAPABILITY_FILTERS,
  CAPABILITY_MODES,
  CAPABILITY_RECORDS,
  CLOUD_ONLY_CAPABILITY_COUNT,
  familyLabel,
  filterCapabilities,
  matchesQuery,
} from './limitsRegistry'
import { WORKSPACE_MODES } from './modes'

/** Positive assertions are policed; honest limits live in `notCovered` by design. */
const OVERCLAIM = /(guarantee[sd]?|certif|proven (?:correct|safe)|zero (?:errors?|defects?|violations?)|always correct|perfect|foolproof)/i

describe('capability and limits registry', () => {
  it('cites test files that exist in this repository', () => {
    for (const record of CAPABILITY_RECORDS) {
      expect(record.validatedBy.length, `${record.id} cites no test`).toBeGreaterThan(0)
      for (const path of record.validatedBy) {
        expect(() => readFileSync(path, 'utf8'), `${record.id} -> ${path} is not a real file`).not.toThrow()
      }
    }
  })

  it('names every workspace mode at least once', () => {
    const missing = WORKSPACE_MODES.filter((mode) => !CAPABILITY_MODES.includes(mode.id))
    expect(missing.map((mode) => mode.id)).toEqual([])
  })

  it('only names modes and families that exist', () => {
    const familyIds = new Set(CAPABILITY_FAMILIES.map((family) => family.id))
    const modeIds = new Set(WORKSPACE_MODES.map((mode) => mode.id))
    for (const record of CAPABILITY_RECORDS) {
      expect(familyIds.has(record.family), `${record.id} family`).toBe(true)
      expect(record.modes.length, `${record.id} has no workspace`).toBeGreaterThan(0)
      for (const mode of record.modes) expect(modeIds.has(mode), `${record.id} -> ${mode}`).toBe(true)
    }
  })

  it('keeps records unique, described and bounded', () => {
    const ids = CAPABILITY_RECORDS.map((record) => record.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const record of CAPABILITY_RECORDS) {
      expect(record.title.length).toBeGreaterThan(3)
      // A claim with no named method is not a computed result.
      expect(record.method.length, `${record.id} states no method`).toBeGreaterThan(24)
      expect(record.computes.length, `${record.id} states no deliverable`).toBeGreaterThan(24)
      // The limits are the point of the panel; an empty block fails the premise.
      expect(record.notCovered.length, `${record.id} states no limits`).toBeGreaterThanOrEqual(2)
      for (const line of record.notCovered) expect(line.trim().length).toBeGreaterThan(12)
      expect(ids.filter((id) => id === record.id)).toHaveLength(1)
    }
  })

  it('never overclaims in the text that presents a result', () => {
    for (const record of CAPABILITY_RECORDS) {
      expect(OVERCLAIM.test(record.computes), `${record.id} computes: ${record.computes}`).toBe(false)
      expect(OVERCLAIM.test(record.method), `${record.id} method: ${record.method}`).toBe(false)
    }
  })

  it('covers every family and gives each one a label', () => {
    const used = new Set(CAPABILITY_RECORDS.map((record) => record.family))
    for (const family of CAPABILITY_FAMILIES) {
      expect(used.has(family.id), `family ${family.id} has no record`).toBe(true)
      expect(familyLabel(family.id)).toBe(family.label)
      expect(family.description.length).toBeGreaterThan(16)
    }
  })

  it('labels cloud-dependent capabilities instead of hiding them', () => {
    expect(CLOUD_ONLY_CAPABILITY_COUNT).toBeGreaterThan(0)
    for (const record of CAPABILITY_RECORDS.filter((entry) => entry.cloudOnly)) {
      expect(
        record.notCovered.some((line) => /supabase|credential|cloud|provider|server/i.test(line)),
        `${record.id} is cloud-gated but never says so`,
      ).toBe(true)
    }
  })

  it('names the agent tools exactly as the harness registers them', () => {
    const registered = new Set<string>()
    for (const path of [
      'src/lib/agents/cadTools.ts',
      'src/lib/agents/edaTools.ts',
      'src/lib/agents/mechanicalTools.ts',
    ]) {
      for (const match of readFileSync(path, 'utf8').matchAll(/name: '((?:cad|eda|mech)\.[A-Za-z]+)'/g)) {
        registered.add(match[1])
      }
    }
    expect(registered.size).toBeGreaterThan(0)

    const record = CAPABILITY_RECORDS.find((entry) => entry.id === 'agents-surface')
    if (!record) throw new Error('the registry has no agents-surface record')
    // The panel is the only place an engineer reads the surface, so every tool
    // the harness can dispatch has to appear there, and the per-domain counts in
    // the headline sentence have to be the counts in the code.
    for (const name of registered) {
      const short = name.split('.')[1]
      expect(record.method.includes(short), `${name} is registered but never named`).toBe(true)
    }
    const countOf = (prefix: string) =>
      [...registered].filter((name) => name.startsWith(`${prefix}.`)).length
    expect(record.computes).toContain(`${countOf('cad')} sheet tools`)
    expect(record.computes).toContain(`${countOf('eda')} board tools`)
    expect(record.computes).toContain(`${countOf('mech')} mechanical tools`)
  })

  it('filters by family, by workspace and by free text', () => {
    expect(filterCapabilities('all', '')).toHaveLength(CAPABILITY_RECORDS.length)
    expect(CAPABILITY_FILTERS[0]).toBe('all')
    for (const filter of CAPABILITY_FILTERS) {
      const rows = filterCapabilities(filter, '')
      expect(rows.length).toBeGreaterThan(0)
      if (filter !== 'all') expect(rows.every((record) => record.family === filter)).toBe(true)
    }

    const mna = filterCapabilities('all', 'modified nodal analysis')
    expect(mna.some((record) => record.id === 'circuit-dc')).toBe(true)

    const controlOnly = filterCapabilities('all', '', 'control')
    expect(controlOnly.length).toBeGreaterThan(0)
    expect(controlOnly.every((record) => record.modes.includes('control'))).toBe(true)
    expect(filterCapabilities('all', '', 'pcb')).not.toEqual(controlOnly)

    expect(matchesQuery(CAPABILITY_RECORDS[0], '   ')).toBe(true)
    expect(filterCapabilities('all', 'a phrase nobody wrote anywhere')).toHaveLength(0)
  })
})
