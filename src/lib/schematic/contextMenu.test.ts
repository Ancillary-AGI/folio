/**
 * Context-menu + symbol proofs.
 */
import { describe, expect, it } from 'vitest'
import { applyContextAction, CONTEXT_ACTIONS, validateSymbol } from './contextMenu'
import type { CanvasComponent } from '../../stores/useProjectStore'

const part = (id: string): CanvasComponent => ({
  id,
  componentId: `${id}-lib`,
  component: {
    id: `${id}-lib`,
    name: 'Resistor',
    category: 'passive',
    is_standard: true,
    symbol_data: { width: 40, height: 20, paths: ['M0 0 L40 20'] },
    pins: [{ id: 'p1', name: '1', x: 0, y: 10, type: 'passive' }],
    default_properties: {},
  },
  x: 100,
  y: 100,
  rotation: 0,
  reference: 'R1',
  properties: {},
})

describe('context menu', () => {
  it('offers the five actions', () => {
    expect(CONTEXT_ACTIONS.map((action) => action.id)).toEqual(['rotate', 'duplicate', 'front', 'back', 'delete'])
  })

  it('rotates, duplicates, reorders and deletes', () => {
    const list = [part('a'), part('b')]
    expect(applyContextAction(list, 'a', 'rotate')[0].rotation).toBe(90)
    const duplicated = applyContextAction(list, 'a', 'duplicate', () => 'copy')
    expect(duplicated).toHaveLength(3)
    expect(duplicated[2].id).toBe('copy')
    expect(applyContextAction(list, 'a', 'front').map((c) => c.id)).toEqual(['b', 'a'])
    expect(applyContextAction(list, 'a', 'back').map((c) => c.id)).toEqual(['a', 'b'])
    expect(applyContextAction(list, 'a', 'delete').map((c) => c.id)).toEqual(['b'])
  })

  it('ignores unknown targets instead of corrupting the sheet', () => {
    const list = [part('a')]
    expect(applyContextAction(list, 'ghost', 'delete')).toBe(list)
  })
})

describe('symbol validation', () => {
  it('accepts a well-formed symbol', () => {
    expect(validateSymbol({ width: 40, height: 20, paths: ['M0 0 L40 20'] }, [{ id: 'p1', x: 0, y: 10 }])).toEqual([])
  })

  it('rejects empties, bad paths, duplicate and stray pins', () => {
    expect(validateSymbol({ width: 0, height: 20, paths: [] }, [])).toContain('body must have positive width and height')
    expect(validateSymbol({ width: 40, height: 20, paths: [] }, [])).toContain('symbol needs at least one path, circle or rectangle')
    expect(validateSymbol({ width: 40, height: 20, paths: ['000 111'] }, [])[0]).toMatch(/no SVG commands/)
    expect(validateSymbol({ width: 40, height: 20, paths: ['M0 0 L1 1'] }, [{ id: 'p', x: 0, y: 0 }, { id: 'p', x: 1, y: 1 }])[0]).toMatch(/duplicate/)
    expect(validateSymbol({ width: 40, height: 20, paths: ['M0 0 L1 1'] }, [{ id: 'p', x: 99, y: 99 }])[0]).toMatch(/outside/)
  })
})
