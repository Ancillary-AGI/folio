/**
 * Real design edits from spoken commands.
 *
 * Placing a part and wiring two named references are deliberately small,
 * deterministic operations: they use the shipped library, the same world
 * coordinates the canvas uses, and the project store's undoable actions. When a
 * command cannot be carried out the result says so — nothing is reported as
 * applied unless the store really changed.
 */
import type { Component } from '../supabase'
import { standardComponents } from '../componentLibrary'
import { useProjectStore, type CanvasComponent, type CanvasWire } from '../../stores/useProjectStore'
import { pinWorldCoord } from '../schematic/drawingLayout'
import { generateId } from '../utils'

export interface DesignActionResult {
  applied: boolean
  detail: string
  [key: string]: unknown
}

const TYPE_ALIASES: ReadonlyArray<readonly [readonly string[], string]> = [
  [['resistor', 'resistance'], 'Resistor'],
  [['capacitor', 'cap'], 'Capacitor'],
  [['inductor', 'coil'], 'Inductor'],
  [['transformer'], 'Transformer'],
  [['diode'], 'Diode'],
  [['led', 'light'], 'LED'],
  [['npn'], 'NPN Transistor'],
  [['pnp'], 'PNP Transistor'],
  [['transistor', 'bjt'], 'NPN Transistor'],
  [['mosfet', 'fet'], 'N-Channel MOSFET'],
  [['finfet'], 'N-Channel FinFET'],
  [['hemt', 'gan'], 'N-Channel GaN HEMT'],
  [['jfet'], 'N-Channel JFET'],
  [['opamp'], 'Op-Amp'],
  [['op', 'amp'], 'Op-Amp'],
  [['ground', 'gnd', 'earth'], 'Ground'],
  [['battery', 'source', 'supply'], 'DC Voltage Source'],
  [['regulator', 'ldo'], 'Voltage Regulator'],
  [['crystal', 'oscillator'], 'Crystal Oscillator'],
  [['sensor', 'thermistor'], 'Temperature Sensor'],
  [['arduino', 'microcontroller', 'mcu'], 'Arduino Uno'],
  [['button', 'switch'], 'Push Button'],
  [['header', 'connector'], 'Header Pin'],
  [['testpoint', 'probe'], 'Test Point'],
  [['eeprom', 'memory'], 'EEPROM'],
  [['lcd', 'display'], 'LCD Display'],
  [['servo', 'motor'], 'Servo Motor'],
  [['wifi', 'radio'], 'WiFi Module'],
  [['and'], 'Logic Gate AND'],
  [['or'], 'Logic Gate OR'],
  [['not', 'inverter'], 'Logic Gate NOT'],
]

const REFERENCE_PREFIX: ReadonlyArray<readonly [RegExp, string]> = [
  [/resistor/i, 'R'],
  [/capacitor/i, 'C'],
  [/inductor/i, 'L'],
  [/transformer/i, 'T'],
  [/diode|led/i, 'D'],
  [/transistor|mosfet|finfet|hemt|jfet/i, 'Q'],
  [/op-amp|arduino|eeprom|lcd|regulator|wifi|sensor/i, 'U'],
  [/crystal|oscillator/i, 'Y'],
  [/switch|button/i, 'SW'],
  [/header|pin/i, 'J'],
  [/ground/i, 'G'],
  [/source|battery/i, 'V'],
  [/test/i, 'TP'],
]

const tokensOf = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

const singular = (token: string): string =>
  token.length > 3 && token.endsWith('s') ? token.slice(0, -1) : token

/** The library part a phrase asks for, or null when nothing matches. */
export function libraryPartForText(text: string): string | null {
  const tokens = tokensOf(text).map(singular)
  for (const [aliases, name] of TYPE_ALIASES) {
    if (aliases.some((alias) => tokens.includes(alias))) return name
  }
  return null
}

function nextReference(name: string, used: ReadonlySet<string>): string {
  const prefix = REFERENCE_PREFIX.find(([pattern]) => pattern.test(name))?.[1] ?? 'U'
  let index = 1
  while (used.has(`${prefix}${index}`)) index += 1
  return `${prefix}${index}`
}

const boundsOverlap = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
  margin: number,
): boolean =>
  a.x < b.x + b.width + margin &&
  a.x + a.width + margin > b.x &&
  a.y < b.y + b.height + margin &&
  a.y + a.height + margin > b.y

/** First free slot on a coarse grid, so a spoken part never lands on another. */
function findFreeOrigin(
  width: number,
  height: number,
  occupied: ReadonlyArray<{ x: number; y: number; width: number; height: number }>,
): { x: number; y: number } {
  for (let row = 0; row < 6; row += 1) {
    for (let column = 0; column < 7; column += 1) {
      const candidate = {
        x: 80 + column * 140,
        y: 80 + row * 120,
        width,
        height,
      }
      if (!occupied.some((bounds) => boundsOverlap(candidate, bounds, 24))) {
        return { x: candidate.x, y: candidate.y }
      }
    }
  }
  return { x: 80 + (occupied.length % 7) * 140, y: 80 + Math.floor(occupied.length / 7) * 120 }
}

/** Place a library part named in the phrase. The store action is undoable. */
export function placeComponentFromText(text: string): DesignActionResult {
  const name = libraryPartForText(text)
  if (!name) {
    return {
      applied: false,
      detail: `I could not tell which part you meant. Try “place a resistor” or “add a capacitor”.`,
    }
  }
  const template = standardComponents.find((part) => part.name === name)
  if (!template) {
    return { applied: false, detail: `The library has no “${name}” part, so nothing was placed.` }
  }

  const project = useProjectStore.getState()
  const usedReferences = new Set(project.components.map((component) => component.reference))
  const reference = nextReference(name, usedReferences)
  const occupied = project.components.map((component) => ({
    x: component.x,
    y: component.y,
    width: component.component.symbol_data.width,
    height: component.component.symbol_data.height,
  }))
  const origin = findFreeOrigin(template.symbol_data.width, template.symbol_data.height, occupied)

  const part: Component = {
    ...template,
    id: generateId('lib'),
    created_at: new Date().toISOString(),
  }
  const placed: CanvasComponent = {
    id: generateId('comp'),
    componentId: part.id ?? part.name,
    component: part,
    x: origin.x,
    y: origin.y,
    rotation: 0,
    reference,
    properties: { ...template.default_properties },
  }
  project.addComponent(placed)
  return {
    applied: true,
    detail: `Placed ${reference} (${name}) at ${origin.x}, ${origin.y}.`,
    reference,
    name,
    x: origin.x,
    y: origin.y,
  }
}

interface NamedPart {
  component: CanvasComponent
  pinIndex: number
}

/** Match a phrase side to the placed parts by reference, then by part name. */
function findPart(side: string[], components: readonly CanvasComponent[]): NamedPart | null {
  const pinAt = side.indexOf('pin')
  const pinNumber = pinAt >= 0 ? Number(side[pinAt + 1]) : NaN
  const pinIndex = Number.isFinite(pinNumber) && pinNumber >= 1 ? Math.floor(pinNumber) - 1 : 0

  const byReference = components.find((component) =>
    side.includes(component.reference.toLowerCase()),
  )
  if (byReference) return { component: byReference, pinIndex }

  let best: CanvasComponent | null = null
  let bestWords = 0
  for (const component of components) {
    const words = tokensOf(component.component.name).map(singular)
    if (!words.every((word) => side.includes(word))) continue
    if (words.length > bestWords) {
      best = component
      bestWords = words.length
    }
  }
  return best ? { component: best, pinIndex } : null
}

const pinName = (component: CanvasComponent, index: number): string => {
  const pin = component.component.pins[index]
  return pin ? `${component.reference}.${pin.name || pin.id}` : `${component.reference}.?`
}

/** Wire two named references with an orthogonal route. Undoable. */
export function connectPartsFromText(text: string): DesignActionResult {
  const tokens = tokensOf(text)
  const toIndex = tokens.indexOf('to')
  const connectIndex = tokens.findIndex((token) =>
    ['connect', 'wire', 'link', 'join', 'route', 'attach'].includes(token),
  )
  if (toIndex < 0 || connectIndex < 0 || toIndex <= connectIndex + 1) {
    return {
      applied: false,
      detail: 'Name both ends, for example “connect R1 to D1”.',
    }
  }
  if (tokens.length <= toIndex + 1) {
    return { applied: false, detail: 'I heard the first end but not the second. Try “connect R1 to D1”.' }
  }

  const project = useProjectStore.getState()
  const from = findPart(tokens.slice(connectIndex + 1, toIndex), project.components)
  const to = findPart(tokens.slice(toIndex + 1), project.components)
  if (!from || !to) {
    const available = project.components.map((component) => component.reference).join(', ') || 'none'
    const missing = !from && !to ? 'both ends' : !from ? 'the first end' : 'the second end'
    return {
      applied: false,
      detail: `I could not find ${missing} on this sheet. Placed references: ${available}.`,
    }
  }
  if (from.component.id === to.component.id) {
    return { applied: false, detail: 'Both names point at the same part, so no wire was drawn.' }
  }
  const fromPin = from.component.component.pins[from.pinIndex]
  const toPin = to.component.component.pins[to.pinIndex]
  if (!fromPin || !toPin) {
    return {
      applied: false,
      detail: `${from.component.reference} or ${to.component.reference} has no pin ${Math.max(from.pinIndex, to.pinIndex) + 1}.`,
    }
  }

  const start = pinWorldCoord(from.component, fromPin)
  const end = pinWorldCoord(to.component, toPin)
  const midX = Math.round((start.x + end.x) / 20) * 10
  const points =
    Math.abs(start.y - end.y) < 1e-6
      ? [{ ...start }, { ...end }]
      : [{ ...start }, { x: midX, y: start.y }, { x: midX, y: end.y }, { ...end }]

  const netNumber =
    project.wires.reduce((highest, wire) => {
      const match = wire.netName?.match(/^NET(\d+)$/)
      return match ? Math.max(highest, Number(match[1])) : highest
    }, 0) + 1
  const wire: CanvasWire = {
    id: generateId('wire'),
    points,
    netName: `NET${netNumber}`,
    connectedPins: [
      { componentId: from.component.id, pinId: fromPin.id },
      { componentId: to.component.id, pinId: toPin.id },
    ],
  }
  project.addWire(wire)
  return {
    applied: true,
    detail: `Connected ${pinName(from.component, from.pinIndex)} to ${pinName(to.component, to.pinIndex)} on NET${netNumber}.`,
    from: from.component.reference,
    to: to.component.reference,
  }
}
