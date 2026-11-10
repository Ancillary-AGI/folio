/**
 * The scale ladder is the vocabulary the whole biology domain shares, so these
 * tests are about its integrity rather than its content: every scale the model
 * index can name has exactly one definition, each definition says both what the
 * scale resolves and what it does not, and the size bands really do climb.
 *
 * The `doesNotResolve` half is not decoration. It is the sentence that keeps an
 * engineer from over-reading a plot — a lumped windkessel drawn at "Organ"
 * magnitude is not a heart, and the panel has to be able to say so.
 */
import { describe, expect, it } from 'vitest'
import { BIOLOGICAL_SCALES, SCALE_DEFINITIONS, scaleDefinition } from './scales'
import { bioModelRows } from './models'

describe('biological scale ladder', () => {
  it('defines each scale exactly once, in ladder order', () => {
    expect(SCALE_DEFINITIONS.map((definition) => definition.id)).toEqual([...BIOLOGICAL_SCALES])
  })

  it('states what each scale resolves and what it leaves out', () => {
    for (const definition of SCALE_DEFINITIONS) {
      expect(definition.label.trim().length).toBeGreaterThan(2)
      expect(definition.resolves.length, `${definition.id} resolves nothing`).toBeGreaterThan(24)
      expect(definition.doesNotResolve.length, `${definition.id} has no stated limit`).toBeGreaterThan(24)
      expect(definition.sizeMeters).toBeGreaterThan(0)
    }
  })

  it('climbs from molecule to system', () => {
    const sizes = SCALE_DEFINITIONS.map((definition) => definition.sizeMeters)
    for (let index = 1; index < sizes.length; index += 1) {
      expect(sizes[index], `${SCALE_DEFINITIONS[index].id} is not bigger than the scale below it`).toBeGreaterThan(
        sizes[index - 1],
      )
    }
  })

  it('carries every scale the model index uses', () => {
    for (const row of bioModelRows()) {
      expect(() => scaleDefinition(row.scale), row.id).not.toThrow()
    }
  })

  it('refuses a scale that is not on the ladder', () => {
    expect(() => scaleDefinition('organoid' as never)).toThrow(/No scale definition registered/)
  })
})
