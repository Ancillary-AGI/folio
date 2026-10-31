import type { Component } from '../supabase'
import type { CanvasComponent } from '../../stores/useProjectStore'
import { generateId } from '../utils'
import { nextReference, referencePrefixFor } from './references'

/**
 * Turning a library part into a placed symbol.
 *
 * Both drops in an e-CAD workspace — the sheet's canvas and the board's — create
 * the same document object, so they build it here: one id, one next-free
 * reference, one copy of the part's default properties. Building it at each call
 * site is how the two drops end up naming the same part R7.
 */
export function placePart(
  part: Component,
  components: readonly CanvasComponent[],
  position: { x: number; y: number },
  rotation = 0,
): CanvasComponent {
  return {
    id: generateId('comp'),
    componentId: part.id ?? part.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    component: part,
    x: position.x,
    y: position.y,
    rotation,
    reference: nextReference(components, referencePrefixFor(part.name)),
    properties: { ...part.default_properties },
  }
}

const boundingBox = (component: CanvasComponent): { x: number; y: number; width: number; height: number } => {
  const width = component.component.symbol_data.width ?? 60
  const height = component.component.symbol_data.height ?? 40
  return { x: component.x, y: component.y, width, height }
}

const overlaps = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
  margin = 24,
): boolean =>
  a.x < b.x + b.width + margin
  && a.x + a.width + margin > b.x
  && a.y < b.y + b.height + margin
  && a.y + a.height + margin > b.y

/** First free slot on a drafting grid, so a part added from the board lands tidily on the sheet. */
export function autoPlace(
  components: readonly CanvasComponent[],
  symbol: Omit<Component, 'id' | 'created_at'>,
): { x: number; y: number } {
  const width = symbol.symbol_data.width ?? 60
  const height = symbol.symbol_data.height ?? 40
  for (let row = 0; row < 20; row++) {
    for (let column = 0; column < 12; column++) {
      const candidate = { x: 40 + column * Math.max(120, width + 40), y: 60 + row * Math.max(100, height + 45), width, height }
      if (!components.some((component) => overlaps(candidate, boundingBox(component)))) {
        return { x: candidate.x, y: candidate.y }
      }
    }
  }
  return { x: 40, y: 60 + components.length * 100 }
}
