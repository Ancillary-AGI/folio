/**
 * Schematic symbol drafts — the model behind the symbol editor.
 *
 * A library part stores its symbol as an SVG path bag plus pin coordinates in
 * a `width × height` box. The editor works on a draft (plain numbers and
 * strings) so every keystroke is representable, validates it with the same
 * contract the canvas renders by, and only then writes it back to the placed
 * instances. Circles, rectangles and text survive an edit untouched: this tool
 * edits the body outline and the pin table, it does not discard artwork.
 */
import type { Component } from '../supabase'
import type { CanvasComponent } from '../../stores/useProjectStore'
import { validateSymbol } from './contextMenu'

export type SymbolPinType = Component['pins'][number]['type']

export const SYMBOL_PIN_TYPES: SymbolPinType[] = [
  'passive',
  'input',
  'output',
  'io',
  'power',
  'ground',
  'nc',
]

export interface SymbolPinDraft {
  id: string
  name: string
  x: number
  y: number
  type: SymbolPinType
}

export interface SymbolDraft {
  width: number
  height: number
  paths: string[]
  pins: SymbolPinDraft[]
}

export function draftFromComponent(placed: CanvasComponent): SymbolDraft {
  const symbol = placed.component.symbol_data
  return {
    width: symbol.width,
    height: symbol.height,
    paths: [...(symbol.paths ?? [])],
    pins: (placed.component.pins ?? []).map((pin) => ({
      id: pin.id,
      name: pin.name,
      x: pin.x,
      y: pin.y,
      type: pin.type,
    })),
  }
}

/**
 * Everything the editor refuses to save. `validateSymbol` owns the geometry and
 * pin contract; this adds the two things only a typed draft can violate — a
 * non-numeric size or pin coordinate, and a pin id that collides with another.
 */
export function symbolDraftFaults(draft: SymbolDraft): string[] {
  const reasons: string[] = []
  if (!Number.isFinite(draft.width) || !Number.isFinite(draft.height)) {
    reasons.push('body size must be finite numbers')
  }
  const numericPins = draft.pins.map((pin) => ({ id: pin.id, x: pin.x, y: pin.y }))
  reasons.push(...validateSymbol({ width: draft.width, height: draft.height, paths: draft.paths }, numericPins))
  const unnamed = draft.pins.filter((pin) => !pin.name.trim())
  if (unnamed.length > 0) reasons.push(`${unnamed.length} pin(s) have no name`)
  return reasons
}

/** The component with the draft's body and pins, everything else preserved. */
export function withDraft(component: Component, draft: SymbolDraft): Component {
  return {
    ...component,
    symbol_data: {
      ...component.symbol_data,
      width: draft.width,
      height: draft.height,
      paths: [...draft.paths],
    },
    pins: draft.pins.map((pin) => ({ id: pin.id, name: pin.name, x: pin.x, y: pin.y, type: pin.type })),
  }
}

/**
 * Rewrite every placed instance that shares this library part. Editing one
 * resistor must not leave the other seven drawing the old body, and the pin
 * ids must stay stable or their wires detach.
 */
export function applyDraftToInstances(
  components: CanvasComponent[],
  componentId: string,
  draft: SymbolDraft,
): CanvasComponent[] {
  return components.map((placed) =>
    placed.componentId === componentId
      ? { ...placed, component: withDraft(placed.component, draft) }
      : placed,
  )
}
