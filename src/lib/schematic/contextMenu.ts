/**
 * Schematic context menu + symbol validation (was Not-implemented).
 *
 * No right-click menu existed anywhere, and symbols are raw SVG path bags
 * with no validity contract — a bad path renders as nothing with no error.
 * This module is both halves:
 *
 *  1. `CONTEXT_ACTIONS`: the menu model the canvas renders — rotate,
 *     duplicate, delete, bring-to-front — each a pure reducer over the
 *     component list so the menu is testable without Konva.
 *  2. `validateSymbol`: the symbol contract — positive body, at least one
 *     path or shape, pins with unique ids inside the body, finite
 *     coordinates. Fail-loud: returns reasons, never throws, never renders
 *     a half-symbol.
 */
import type { CanvasComponent } from '../../stores/useProjectStore'

export type ContextActionId = 'rotate' | 'duplicate' | 'delete' | 'front' | 'back'

export interface ContextAction {
  id: ContextActionId
  label: string
}

export const CONTEXT_ACTIONS: ContextAction[] = [
  { id: 'rotate', label: 'Rotate 90°' },
  { id: 'duplicate', label: 'Duplicate' },
  { id: 'front', label: 'Bring to front' },
  { id: 'back', label: 'Send to back' },
  { id: 'delete', label: 'Delete' },
]

/** Apply one menu action to the component list; returns the new list. */
export function applyContextAction(
  components: CanvasComponent[],
  targetId: string,
  action: ContextActionId,
  makeId: () => string = () => `comp-${Date.now()}`,
): CanvasComponent[] {
  const target = components.find((component) => component.id === targetId)
  if (!target) return components
  switch (action) {
    case 'rotate':
      return components.map((component) =>
        component.id === targetId ? { ...component, rotation: (component.rotation + 90) % 360 } : component,
      )
    case 'delete':
      return components.filter((component) => component.id !== targetId)
    case 'duplicate': {
      const copy: CanvasComponent = {
        ...target,
        id: makeId(),
        x: target.x + 20,
        y: target.y + 20,
        reference: `${target.reference}'`,
      }
      return [...components, copy]
    }
    case 'front':
      return [...components.filter((component) => component.id !== targetId), target]
    case 'back':
      return [target, ...components.filter((component) => component.id !== targetId)]
  }
}

export interface SymbolShape {
  width: number
  height: number
  paths: string[]
  circles?: Array<{ cx: number; cy: number; r: number }>
  rectangles?: Array<{ x: number; y: number; width: number; height: number }>
}

export interface SymbolPin {
  id: string
  x: number
  y: number
}

/** Validate a symbol body + pins; empty array means valid. */
export function validateSymbol(shape: SymbolShape, pins: SymbolPin[]): string[] {
  const reasons: string[] = []
  if (!(shape.width > 0) || !(shape.height > 0)) reasons.push('body must have positive width and height')
  const hasPaths = (shape.paths ?? []).length > 0
  const hasShapes = (shape.circles ?? []).length > 0 || (shape.rectangles ?? []).length > 0
  if (!hasPaths && !hasShapes) reasons.push('symbol needs at least one path, circle or rectangle')
  for (const [index, path] of (shape.paths ?? []).entries()) {
    if (typeof path !== 'string' || path.trim().length === 0) {
      reasons.push(`path ${index} is empty`)
      continue
    }
    if (!/[MLHVCSQTAZmlhvcsqtaz]/.test(path)) reasons.push(`path ${index} has no SVG commands`)
  }
  const seen = new Set<string>()
  for (const pin of pins) {
    if (!pin.id) {
      reasons.push('a pin is missing its id')
      continue
    }
    if (seen.has(pin.id)) reasons.push(`duplicate pin id ${pin.id}`)
    seen.add(pin.id)
    if (!Number.isFinite(pin.x) || !Number.isFinite(pin.y)) reasons.push(`pin ${pin.id} has non-finite coordinates`)
    if (pin.x < 0 || pin.y < 0 || pin.x > shape.width || pin.y > shape.height) {
      reasons.push(`pin ${pin.id} lies outside the symbol body`)
    }
  }
  return reasons
}
