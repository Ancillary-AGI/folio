import { describe, expect, it } from 'vitest'
import { standardComponents } from '../componentLibrary'
import type { Component } from '../supabase'
import type { CanvasComponent } from '../../stores/useProjectStore'
import {
  applyDraftToInstances,
  draftFromComponent,
  symbolDraftFaults,
  withDraft,
  type SymbolDraft,
} from './symbolEditor'

const resistor = (): Component =>
  ({ ...standardComponents.find((entry) => entry.name === 'Resistor')!, id: 'lib-resistor' }) as Component

const placed = (id: string, reference: string): CanvasComponent => ({
  id,
  componentId: 'lib-resistor',
  component: resistor(),
  x: 100,
  y: 100,
  rotation: 0,
  reference,
  properties: { value: '10k' },
})

const draft = (patch: Partial<SymbolDraft> = {}): SymbolDraft => ({
  ...draftFromComponent(placed('c1', 'R1')),
  ...patch,
})

describe('symbol editor drafts', () => {
  it('round-trips a library symbol through a draft', () => {
    const source = placed('c1', 'R1')
    expect(withDraft(source.component, draftFromComponent(source))).toEqual(source.component)
  })

  it('keeps circles, rectangles and text that the editor does not touch', () => {
    const component: Component = {
      ...resistor(),
      symbol_data: {
        width: 40,
        height: 20,
        paths: ['M 0,10 L 40,10'],
        circles: [{ cx: 20, cy: 10, r: 4 }],
        rectangles: [{ x: 2, y: 2, width: 8, height: 8 }],
        text: [{ x: 4, y: 4, text: 'X' }],
      },
    }
    const edited = withDraft(component, { width: 60, height: 30, paths: ['M 0,15 L 60,15'], pins: [] })
    expect(edited.symbol_data).toMatchObject({
      width: 60,
      height: 30,
      paths: ['M 0,15 L 60,15'],
      circles: component.symbol_data.circles,
      rectangles: component.symbol_data.rectangles,
      text: component.symbol_data.text,
    })
  })

  it('refuses an empty body, a body with no outline and a pin outside it', () => {
    expect(symbolDraftFaults(draft({ paths: [] }))).toContain('symbol needs at least one path, circle or rectangle')
    expect(symbolDraftFaults(draft({ width: 0 }))).toContain('body must have positive width and height')
    const outside = symbolDraftFaults(draft({
      pins: [{ id: 'p1', name: '1', x: 500, y: 5, type: 'passive' }],
    }))
    expect(outside.some((reason) => reason.includes('outside the symbol body'))).toBe(true)
  })

  it('refuses a non-numeric size and an unnamed pin', () => {
    expect(symbolDraftFaults(draft({ width: Number.NaN })).length).toBeGreaterThan(0)
    const unnamed = symbolDraftFaults(draft({
      pins: [{ id: 'p1', name: '  ', x: 0, y: 15, type: 'passive' }],
    }))
    expect(unnamed).toContain('1 pin(s) have no name')
  })

  it('rewrites every instance of the part and leaves other parts alone', () => {
    const other: CanvasComponent = { ...placed('c3', 'R9'), componentId: 'lib-cap', id: 'c3' }
    const next = applyDraftToInstances([placed('c1', 'R1'), placed('c2', 'R2'), other], 'lib-resistor', draft({ width: 120 }))
    expect(next.map((entry) => entry.component.symbol_data.width)).toEqual([120, 120, other.component.symbol_data.width])
    expect(next[2]).toBe(other)
  })

  it('keeps pin ids stable so existing wires still resolve', () => {
    const source = placed('c1', 'R1')
    const next = applyDraftToInstances([source], 'lib-resistor', draft({ height: 40 }))
    expect(next[0].component.pins.map((pin) => pin.id)).toEqual(source.component.pins.map((pin) => pin.id))
  })
})
