/**
 * The community payload contract, pinned at the seams: a template file is
 * either a well-formed, safe template — or it is refused with a reason, and
 * never applied.
 */
import { describe, expect, it } from 'vitest'
import {
  buildCommunityTemplate,
  parseCommunityTemplate,
  applyTemplateFile,
} from '../lib/community/community'
import { useProjectStore } from '../stores/useProjectStore'

describe('community template payload', () => {
  it('round-trips a build into a parse with identical fields', () => {
    const built = buildCommunityTemplate({
      name: '  Buck converter 5 V  ',
      description: 'Two-cell to 3.3 V',
      discipline: 'circuits',
      license: 'cc-by-4.0',
      authorName: 'Ada',
    })
    const parsed = parseCommunityTemplate(JSON.parse(JSON.stringify(built)))
    expect(parsed.name).toBe('Buck converter 5 V')
    expect(parsed.description).toBe('Two-cell to 3.3 V')
    expect(parsed.discipline).toBe('circuits')
    expect(parsed.license).toBe('cc-by-4.0')
    expect(parsed.authorName).toBe('Ada')
    expect(parsed.design.components).toBeDefined()
    expect(parsed.design.wires).toBeDefined()
  })

  it('refuses a file that is not a community template, with a human reason', () => {
    expect(() => parseCommunityTemplate(null)).toThrow(/not an object/i)
    expect(() => parseCommunityTemplate({ format: 'nope' })).toThrow(/not a Folio/i)
    expect(() => parseCommunityTemplate({ format: 'folio-community-template/1', design: 'nope' })).toThrow(/design payload/i)
    expect(() => parseCommunityTemplate({ format: 'folio-community-template/1', design: {} })).toThrow(/components and wires/i)
  })

  it('refuses unknown licences instead of guessing one', () => {
    const built = buildCommunityTemplate({
      name: 'X', description: '', discipline: 'circuits', license: 'cc-by-4.0', authorName: 'A',
    })
    const tampered = { ...built, license: 'mit' }
    expect(() => parseCommunityTemplate(tampered)).toThrow(/licence|license/i)
  })

  it('applies a well-formed payload to the live stores and marks it dirty', () => {
    useProjectStore.setState({
      components: [{ id: 'p1', componentId: 'c1' }] as never,
      wires: [],
      currentProject: null,
      isDirty: false,
      pcbLayout: null,
      mechanicalParts: [],
      domainDesigns: {},
      firmwareCode: '',
      simulationRuns: [],
    } as never)

    const built = buildCommunityTemplate({
      name: 'Fixture', description: '', discipline: 'circuits', license: 'cc-by-4.0', authorName: 'Test',
    })
    const result = applyTemplateFile(parseCommunityTemplate(JSON.parse(JSON.stringify(built))))
    expect(result).toBe(true)
    expect(useProjectStore.getState().isDirty).toBe(true)
  })
})
