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
      authorName: 'Ada',
    })
    const parsed = parseCommunityTemplate(JSON.parse(JSON.stringify(built)))
    expect(parsed.name).toBe('Buck converter 5 V')
    expect(parsed.description).toBe('Two-cell to 3.3 V')
    expect(parsed.discipline).toBe('circuits')
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

  it('round-trips a template built without a licence field', () => {
    const built = buildCommunityTemplate({
      name: 'X', description: '', discipline: 'circuits', authorName: 'A',
    })
    const parsed = parseCommunityTemplate(JSON.parse(JSON.stringify(built)))
    expect(parsed.name).toBe('X')
    expect(parsed.authorName).toBe('A')
  })

  it('applies a well-formed payload to the live stores and marks it dirty', () => {
    useProjectStore.setState({
      components: [{
        id: 'p1',
        componentId: 'c1',
        component: {
          name: 'Resistor',
          category: 'passive',
          is_standard: true,
          symbol_data: { width: 40, height: 20, paths: ['M 0 10 H 40'] },
          pins: [
            { id: 'p1', name: 'A', x: 0, y: 10, type: 'passive' },
            { id: 'p2', name: 'B', x: 40, y: 10, type: 'passive' },
          ],
        },
        x: 100,
        y: 100,
        rotation: 0,
        reference: 'R1',
        properties: {},
      }] as never,
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
      name: 'Fixture', description: '', discipline: 'circuits', authorName: 'Test',
    })
    const result = applyTemplateFile(parseCommunityTemplate(JSON.parse(JSON.stringify(built))))
    expect(result).toBe(true)
    expect(useProjectStore.getState().isDirty).toBe(true)
  })
})
